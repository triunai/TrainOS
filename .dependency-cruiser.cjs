/**
 * dependency-cruiser configuration — trainos
 * =========================================
 *
 * WHERE THIS RUNS
 * ---------------
 * The config lives at the repo root, with the rest of the guardrail control
 * plane, but dependency-cruiser is invoked with apps/web as its working
 * directory (`npm run arch:graph` delegates to that workspace). TypeScript
 * resolves a tsconfig's `include` relative to the process cwd, so running it
 * from the root makes `include: ["src"]` resolve to a directory that does not
 * exist. Every path below is therefore apps/web-relative.
 *
 * WHAT THIS ENFORCES
 * ------------------
 * The dependency arrow points ONE way:
 *
 *     features  ->  shared  ->  @trainos/contract
 *
 * and never back. Concretely:
 *
 *   1. no-circular                (error) — no dependency cycles anywhere.
 *   2. no-cross-feature-internals (error) — THE HEADLINE RULE. Feature A may
 *      only reach feature B through `src/features/B/index.ts`.
 *      Importing your OWN feature's internals is allowed.
 *   3. shared-no-features         (error) — `src/shared/**` must not depend on
 *      `src/features/**`. Enabled from day one because src/shared exists from
 *      day one.
 *   4. no-app-imports-from-pages  (error) — the route table and pages compose
 *      features and shared; nothing may import a page back.
 *
 * `.dependency-cruiser-known-violations.json` starts as `[]` and must stay
 * empty. A new repo has no legacy to baseline.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "This dependency is part of a circular relationship. Cycles make modules " +
        "impossible to reason about in isolation, break tree-shaking, and cause " +
        "non-deterministic init order (a frequent source of `undefined is not a " +
        "function` at module load). FIX: invert one edge — extract the shared piece " +
        "into a lower-level module that BOTH sides import, instead of importing " +
        "each other.",
      from: {},
      to: {
        circular: true,
      },
    },

    // HOW THE REGEX WORKS (the subtle part):
    //   from.path captures the SOURCE feature name in group $1.
    //   to.path matches every feature file except its root index.ts(x), which
    //   includes top-level internals such as `types.ts`, not only subfolders.
    //   to.pathNot then EXCLUDES same-feature imports via the $1 back-reference,
    //   so a module importing its OWN internals is not flagged.
    {
      name: "no-cross-feature-internals",
      severity: "error",
      comment:
        "A feature module reached into ANOTHER feature's internals instead of its " +
        "public barrel. Features are black boxes: import siblings through " +
        "`@/features/<name>` (the index.ts barrel) only — never " +
        "`@/features/<name>/components/...`, `/hooks/...`, `/utils/...`. " +
        "FIX: import the symbol from `@/features/<name>`; if it is not exported " +
        "there, ADD it to that feature's barrel rather than deep-linking the " +
        "internal path. Importing your OWN feature's internals is fine.",
      from: {
        path: "^src/features/([^/]+)/",
      },
      to: {
        path: "^src/features/([^/]+)/(?!index\\.[cm]?[jt]sx?$).+",
        pathNot: "^src/features/$1/",
      },
    },

    {
      name: "shared-no-features",
      severity: "error",
      comment:
        "`src/shared/**` (cross-cutting code) must not import from " +
        "`src/features/**`. The arrow points features -> shared, never the " +
        "reverse — otherwise shared cannot be reused or extracted and you invite " +
        "cycles. FIX: move the feature-specific logic INTO the feature that needs " +
        "it, or hoist the genuinely cross-cutting piece down into src/shared/.",
      from: { path: "^src/shared/" },
      to: { path: "^src/features/" },
    },

    {
      name: "no-imports-from-pages",
      severity: "error",
      comment:
        "A page is a composition root: the route table mounts it and nothing else " +
        "imports it. Importing a page pulls a whole screen's dependency tree into " +
        "an unrelated module. FIX: lift the shared piece into src/shared or into " +
        "the owning feature's barrel.",
      from: { pathNot: "^src/(pages|routes)/" },
      to: { path: "^src/pages/" },
    },
  ],

  options: {
    // Follow TypeScript's pre-compilation graph so type-only imports count —
    // critical, because many cross-feature edges are type-only.
    tsPreCompilationDeps: true,

    tsConfig: {
      fileName: "tsconfig.app.json",
    },

    doNotFollow: {
      path: "node_modules",
    },

    // Match the bundler's resolution order so `@/x` -> `src/x.ts(x)` resolves.
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },

    exclude: {
      path: "(^|/)(node_modules|dist)/|\\.(test|spec)\\.[jt]sx?$",
    },
  },
};
