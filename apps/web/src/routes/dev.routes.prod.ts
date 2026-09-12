import type { DevRoute } from "./dev.routes";

/**
 * The production stand-in for `dev.routes.tsx`.
 *
 * `vite.config.ts` aliases the `./dev.routes` specifier to this file when the
 * mode is production, so a production build never resolves the real module and
 * therefore never reaches anything it registers.
 *
 * WHY THIS FILE EXISTS AT ALL. Gating the ROUTE behind `import.meta.env.DEV`
 * removes the route, not the code: Rollup creates a chunk at every `import()`
 * it can resolve statically, whether or not the reference sits in a branch that
 * is provably dead. A dev gallery was shipping as its own 175 kB chunk that
 * nothing could ever fetch. Cutting the import GRAPH is the only thing that
 * removes it, and cutting it at this one module covers everything the mount
 * point registers — today's entries and tomorrow's — rather than naming each
 * dev page in the build config.
 *
 * The `import type` above is erased before module resolution, so this file does
 * not resolve the module it replaces.
 */
export const devRoutes: DevRoute[] = [];
