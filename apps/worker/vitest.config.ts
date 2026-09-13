import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The workspace packages are linked by npm, but aliasing straight at source
 * keeps the suite runnable in a bare checkout and keeps a type-only package
 * (`@trainos/contract`) from needing a build step it does not have.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@trainos/contract": fileURLToPath(
        new URL("../../packages/contract/src/index.ts", import.meta.url),
      ),
      "@trainos/agent-runtime": fileURLToPath(
        new URL("../../packages/agent-runtime/src/index.ts", import.meta.url),
      ),
      "@trainos/fixtures": fileURLToPath(
        new URL("../../packages/fixtures/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
