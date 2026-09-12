import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `@trainos/contract` resolves through `file:../contract` once npm has linked
 * it, but the alias keeps the tests working in a bare checkout too — the
 * contract package is types-only, so pointing straight at its source is
 * correct rather than a shortcut.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@trainos/contract': fileURLToPath(new URL('../contract/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
