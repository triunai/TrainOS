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
