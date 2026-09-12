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
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // Cut the dev-route import GRAPH in a production build.
      //
      // `routes.tsx` already mounts dev routes behind `import.meta.env.DEV`, so
      // the ROUTE does not exist in production. That is not enough: Rollup
      // creates a chunk at every `import()` it can resolve statically, whether
      // or not the reference sits in a provably dead branch. The kit gallery
      // was shipping as its own 175 kB chunk (55 kB gzipped) that nothing could
      // ever fetch.
      //
      // Aliasing the specifier to an empty module means the real dev.routes is
      // never resolved, so nothing it registers is reachable and no chunk is
      // emitted. Doing it at this ONE module covers every dev page the mount
      // point carries, now and later, instead of naming each one here.
      ...(mode === "production"
        ? [
            {
              find: /^\.\/dev\.routes$/,
              replacement: path.resolve(__dirname, "./src/routes/dev.routes.prod.ts"),
            },
          ]
        : []),
    ],
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
