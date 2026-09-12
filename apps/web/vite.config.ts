import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    // 8080 is the house default and is already owned by a sibling app on a
    // developer machine running both. TrainOS owns 5180 so the two can run at
    // once and the bundle-budget dev-server probe cannot confuse them.
    host: "::",
    port: 5180,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Strip console.* and debugger from production builds; keep them in dev.
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  build: {
    minify: "esbuild",
    target: "es2020",
    sourcemap: mode === "development",
    chunkSizeWarningLimit: 500,
  },
}));
