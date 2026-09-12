import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "::",
    port: 8080,
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
