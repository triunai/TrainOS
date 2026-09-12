/**
 * The default entry must load in a browser.
 *
 * The web app imports this package to run the mock agent on M18-S04. A
 * `node:fs` import anywhere in the default entry's module graph fails a Vite
 * build — not at runtime, at build time, and not in the file that did it —
 * so the guard has to be a test rather than a convention.
 *
 * This caught a real regression: `src/index.ts` re-exported the `.env.local`
 * loader, which imports `node:fs` at module scope, and `EnvKeyStore` read
 * `process.env` as a constructor default. Both took the consuming build down.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EnvKeyStore } from '../src/keys/keystore';
import { createRuntime } from '../src/runtime';
import { leadToProposalAgent } from '../src/agents/lead-to-proposal';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Resolve one relative specifier to a file on disk, the way a bundler would. */
function resolveImport(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      /* try the next shape */
    }
  }
  return undefined;
}

/** Strip comments so a mention of `node:fs` in prose is not a finding. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function importsOf(source: string): string[] {
  const out: string[] = [];
  const pattern = /(?:from|import)\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

/** Every file a bundler would pull in, starting from one entry. */
function moduleGraph(entry: string): Map<string, string> {
  const files = new Map<string, string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;

    const raw = readFileSync(file, 'utf8');
    files.set(file, raw);

    for (const specifier of importsOf(stripComments(raw))) {
      const resolved = resolveImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }

  return files;
}

const relative = (file: string): string => file.slice(SRC.length + 1);

describe('the default entry is bundler-safe', () => {
  const graph = moduleGraph(join(SRC, 'index.ts'));

  it('reaches the modules it is supposed to', () => {
    // A guard that proves nothing because it walked nothing is worse than none.
    const files = [...graph.keys()].map(relative);
    expect(files.length).toBeGreaterThan(10);
    expect(files).toEqual(
      expect.arrayContaining([
        'index.ts',
        'runtime.ts',
        'orchestrator/run.ts',
        'providers/anthropic.ts',
        'agents/lead-to-proposal.ts',
      ]),
    );
  });

  it('imports no Node builtin anywhere in its graph', () => {
    const offenders: string[] = [];
    for (const [file, source] of graph) {
      for (const specifier of importsOf(stripComments(source))) {
        if (specifier.startsWith('node:')) offenders.push(`${relative(file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not pull in the dotenv loader or the CLI', () => {
    const files = [...graph.keys()].map(relative);
    // Both are Node-only. They belong behind `@trainos/agent-runtime/node`.
    expect(files).not.toContain('keys/dotenv.ts');
    expect(files).not.toContain('cli.ts');
  });

  it('touches process only behind a typeof guard', () => {
    const offenders: string[] = [];
    for (const [file, source] of graph) {
      const code = stripComments(source);
      if (!/\bprocess\b/.test(code)) continue;
      // The one permitted shape: prove it is absent before reading it.
      if (!/typeof process === ['"]undefined['"]/.test(code)) {
        offenders.push(relative(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the node entry still carries everything', () => {
  const graph = moduleGraph(join(SRC, 'node.ts'));

  it('adds the dotenv loader on top of the default entry', () => {
    const files = [...graph.keys()].map(relative);
    expect(files).toContain('keys/dotenv.ts');
    expect(files).toContain('index.ts');
  });
});

describe('running with no ambient process', () => {
  /** Run a function with `globalThis.process` removed, then put it back. */
  function withoutProcess<T>(fn: () => T): T {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
    Reflect.deleteProperty(globalThis, 'process');
    try {
      return fn();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'process', descriptor);
    }
  }

  it('constructs an EnvKeyStore that simply has no keys', () => {
    const store = withoutProcess(() => new EnvKeyStore());
    expect(store.list()).toEqual([]);
  });

  it('builds a runtime that falls back to the mock provider', () => {
    // This is the M18-S04 "Run now (mock)" path: no keys, no process, and the
    // whole routing config still resolves.
    const runtime = withoutProcess(() =>
      createRuntime({ agentId: leadToProposalAgent.id, provider: 'mock' }),
    );

    expect(runtime.usingMock).toBe(true);
    expect(runtime.liveProviders).toEqual([]);
    for (const tier of ['CHEAP', 'MID', 'STRONG_1', 'STRONG_2', 'STRONG_3'] as const) {
      expect(runtime.router.isReachable(tier)).toBe(true);
    }
  });

  it('builds a runtime on the auto path too', () => {
    // `auto` reads the key store before it knows there is nothing to read,
    // which is exactly where the ReferenceError used to be thrown.
    const runtime = withoutProcess(() => createRuntime({ agentId: leadToProposalAgent.id }));
    expect(runtime.usingMock).toBe(true);
  });

  it('still prefers an explicitly supplied environment', () => {
    const store = withoutProcess(
      () => new EnvKeyStore({ ANTHROPIC_API_KEY: 'sk-ant-api03-aaaabbbbcccc' }),
    );
    expect(store.list().map((r) => r.id)).toEqual(['ANTHROPIC_API_KEY']);
  });
});
