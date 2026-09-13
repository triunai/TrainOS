import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    // Three Radix-menu tests open a menu and wait for an item, and each takes
    // six to nine seconds under jsdom:
    //   shared/components/kit/__tests__/RowActionMenu.test.tsx
    //     "runs the action the reader chose"                        ~6.2s
    //   features/pipeline/__tests__/pipeline.test.tsx
    //     "offers every other stage in the card's menu"             ~8.3s
    //   features/knowledge/__tests__/knowledge.test.tsx
    //     "keeps Check and Re-ingest out of every row"              ~6s
    // They are not slower than they were: measured on vitest 2 they took the
    // same six to nine seconds and passed anyway, because vitest 2 did not
    // hold them to the 5s default. Vitest 3 does, so the limit has to be
    // stated rather than inherited.
    //
    // None of that time is the UI. Measured: the menu item is in the DOM 13ms
    // after the keypress, and a synchronous `getByRole` against it costs 1ms.
    // The seconds are spent inside the `findBy*` wrapper, which runs the query
    // through `asyncAct` while floating-ui keeps scheduling position work for
    // the open menu. Swapping those three awaits for a settle plus `getByRole`
    // is the real fix and would return ~21s to the suite; it edits three files
    // this branch has no other business in, so it is left for its own change.
    // Until then this is a ceiling for a hung test, not a budget.
    testTimeout: 30_000,
    setupFiles: ["./src/test/setup.ts"],
    // Explicit describe/it/expect imports are preferred — clearer, and no
    // tsconfig types[] fiddling. The runtime supports both.
    globals: false,
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // The API base URL is read at module load by the HTTP client once it
    // exists. Pin it so a transitive import cannot reach a real origin.
    env: {
      VITE_API_BASE_URL: "http://localhost:54321/v1",
      // Anything that renders an instant as a wall-clock date or time reads
      // the process timezone. Unpinned, an assertion written on a Malaysian
      // laptop passes there and fails on a UTC runner, which is what CI was
      // reporting. Pin the zone to the tenant default the schema ships
      // (`tenant.timezone DEFAULT 'Asia/Kuala_Lumpur'`), which is also the
      // offset every fixture timestamp carries, so a local run and CI agree
      // and both agree with the audience the screens render for.
      TZ: "Asia/Kuala_Lumpur",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/test/**",
        "src/**/*.types.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      // Thresholds start unset on purpose — a ratchet, not a wall. Set the
      // first floor once ~5-10 tests have landed and raise it as coverage
      // grows. An 80% threshold on day one kills test culture before it forms.
    },
  },
});
