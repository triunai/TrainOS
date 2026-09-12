/**
 * A four-line `.env.local` reader.
 *
 * The README tells people to put a key in `.env.local` at the repo root, so
 * something has to read it or that instruction is a lie. A dependency for this
 * would be silly, and `EnvKeyStore` must keep reading `process.env` and only
 * `process.env` — so this loads the file into the environment and nothing
 * else knows it happened.
 *
 * Called by the CLI, never by the library. A library that mutates the host
 * process's environment on import is a library that will surprise somebody.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Variables already set in the environment always win over the file. */
export interface LoadEnvResult {
  /** The file that was read, if any. */
  path?: string;
  /** Names loaded. Never values — this result gets logged. */
  loaded: string[];
}

/**
 * Walk up from `startDir` looking for `.env.local`, then `.env`.
 *
 * Up to six levels, which covers `packages/agent-runtime` inside a monorepo
 * without wandering off into the user's home directory.
 */
export function loadEnvLocal(startDir: string = process.cwd(), env = process.env): LoadEnvResult {
  let dir = resolve(startDir);

  for (let depth = 0; depth < 6; depth += 1) {
    for (const name of ['.env.local', '.env']) {
      const candidate = join(dir, name);
      if (!existsSync(candidate)) continue;
      return { path: candidate, loaded: applyFile(candidate, env) };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { loaded: [] };
}

function applyFile(path: string, env: NodeJS.ProcessEnv): string[] {
  const loaded: string[] = [];
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return loaded;
  }

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // An exported variable is the operator's explicit choice for this shell
    // and outranks a file they may have forgotten about.
    if (env[key] !== undefined && env[key] !== '') continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // A placeholder from `.env.example` is not a key.
    if (value === '' || value.endsWith('...')) continue;

    env[key] = value;
    loaded.push(key);
  }

  return loaded;
}
