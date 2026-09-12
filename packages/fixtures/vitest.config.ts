import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The alias mirrors the `paths` entry in tsconfig.json, so the tests resolve
 * `@trainos/contract` from source whether or not the workspace has been
 * installed.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@trainos/contract": fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
