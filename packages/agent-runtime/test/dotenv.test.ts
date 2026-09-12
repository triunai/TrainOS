import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadEnvLocal } from '../src/keys/dotenv';
import { EnvKeyStore } from '../src/keys/keystore';

function fixtureRepo(contents: string, name = '.env.local'): string {
  const root = mkdtempSync(join(tmpdir(), 'trainos-env-'));
  writeFileSync(join(root, name), contents);
  const nested = join(root, 'packages', 'agent-runtime');
  mkdirSync(nested, { recursive: true });
  return nested;
}

describe('.env.local loading', () => {
  it('walks up to the repo root and loads keys into the environment', () => {
    const start = fixtureRepo('ANTHROPIC_API_KEY=sk-ant-api03-aaaabbbbcccc\n');
    const env: NodeJS.ProcessEnv = {};

    const result = loadEnvLocal(start, env);

    expect(result.loaded).toEqual(['ANTHROPIC_API_KEY']);
    expect(result.path).toMatch(/\.env\.local$/);
    // And the store, which reads process.env and nothing else, now sees it.
    expect(new EnvKeyStore(env).list().map((r) => r.id)).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('never overrides a variable the operator exported for this shell', () => {
    const start = fixtureRepo('ANTHROPIC_API_KEY=from-file\n');
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'from-shell' };

    expect(loadEnvLocal(start, env).loaded).toEqual([]);
    expect(env['ANTHROPIC_API_KEY']).toBe('from-shell');
  });

  it('ignores comments, blanks, quotes, export prefixes and placeholders', () => {
    const start = fixtureRepo(
      [
        '# a comment',
        '',
        'export DEEPSEEK_API_KEY="sk-quoted-value"',
        "OPENROUTER_API_KEY='sk-or-v1-single'",
        'ANTHROPIC_API_KEY=sk-ant-...',   // an untouched .env.example line
        'not a pair',
        '=novalue',
      ].join('\n'),
    );
    const env: NodeJS.ProcessEnv = {};

    const result = loadEnvLocal(start, env);

    expect(result.loaded.sort()).toEqual(['DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY']);
    expect(env['DEEPSEEK_API_KEY']).toBe('sk-quoted-value');
    expect(env['OPENROUTER_API_KEY']).toBe('sk-or-v1-single');
    // A placeholder copied from .env.example is not a key.
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('reports nothing rather than throwing when there is no file', () => {
    const start = mkdtempSync(join(tmpdir(), 'trainos-empty-'));
    expect(loadEnvLocal(start, {})).toEqual({ loaded: [] });
  });
});
