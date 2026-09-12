/**
 * The Node entry: everything in the default entry, plus what needs a
 * filesystem and a `process`.
 *
 * Split out rather than guarded inline because a bundler decides what to
 * include by reading imports, not by reading conditions. `node:fs` imported at
 * module scope fails a browser build whether or not the code path runs.
 *
 *     import { runAgent } from '@trainos/agent-runtime';        // anywhere
 *     import { loadEnvLocal } from '@trainos/agent-runtime/node';  // Node only
 */

export * from './index';
export * from './keys/dotenv';
