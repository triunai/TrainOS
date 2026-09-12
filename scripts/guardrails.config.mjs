// scripts/guardrails.config.mjs
//
// Single source of truth for the guardrail stack. Read by scripts/guard.mjs
// (the toggle runner) and by any diff-gated review trigger. Keeping the
// sentinel name, the seam manifest and the check registry in ONE file is
// deliberate: three copies would drift, and drift between a contract and its
// consumers is the failure class this stack exists to prevent.

/**
 * Toggle sentinel. When this file exists at the repo root, the advisory
 * guardrail layer is PAUSED — only the baseline hooks run. Gitignored,
 * machine-local, created/removed via `npm run guardrails:off|on`.
 */
export const SENTINEL = ".guardrails-off";

/**
 * Critical-seam manifest (globs, repo-root-relative). A diff touching ANY of
 * these is a contract-risk diff; a diff touching none is routine.
 *
 * EDIT THIS LIST as the surface evolves. Seeded with the data-layer contract,
 * the shared type surface, the database, and the guardrail control plane.
 */
export const SEAM_GLOBS = [
  "apps/web/src/shared/api/**",
  "apps/web/src/shared/config/nav.ts",
  "apps/web/src/shared/config/navTree.ts",
  "apps/web/src/shared/config/roles.ts",
  "apps/web/src/shared/hooks/useMe.ts",
  "packages/contract/src/**",
  "supabase/migrations/**",
  "supabase/rollbacks/**",
  ".semgrep/rules.yml",
  // The guardrail CONTROL PLANE itself: editing the jail must trigger review
  // OF that edit. Without these, an agent under finish-pressure could weaken
  // guard.mjs, drop a CHECKS entry, or rip out the hook with zero review.
  // Listed as LITERAL paths — a `scripts/guard*.mjs` glob would miss siblings,
  // and the hooks live in settings.json, not a hooks directory.
  "scripts/guard.mjs",
  "scripts/guardrails.config.mjs",
  "scripts/safe-command-guard.mjs",
  "lefthook.yml",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".dependency-cruiser-known-violations.json",
];

/**
 * Check registry. guard.mjs routes every guardrail through here.
 *   - `run`: argv to spawn (shell:true, so npm/npx resolve on Windows).
 *   - `requires`: phase-tolerance probe. While the stack is built
 *     incrementally, a check whose tool or script is not wired yet is SKIPPED
 *     quietly instead of erroring — so a partial state never breaks a hook.
 *
 * All checks are ADVISORY by default (guard.mjs swallows non-zero exits).
 * Pass --block to make one gate. Ratchet individual checks to blocking once
 * their baseline is clean: never set a number you cannot immediately hit.
 */
export const CHECKS = {
  depcruise: {
    label: "dependency-cruiser boundaries",
    run: ["npm", "run", "arch:graph"],
    requires: { npmScript: "arch:graph" },
  },
  hygiene: {
    label: "doc/state hygiene staleness",
    run: ["node", "scripts/hygiene-check.mjs"],
    requires: { file: "scripts/hygiene-check.mjs" },
  },
  bundle: {
    label: "bundle size budget",
    run: ["node", "scripts/bundle-budget-check.mjs"],
    requires: { file: "scripts/bundle-budget-check.mjs" },
  },
  sqlparse: {
    label: "SQL parse (migrations, rollbacks, tests)",
    run: ["npm", "run", "lint:sql"],
    requires: { file: "scripts/check-sql-parse.mjs" },
  },
  grants: {
    label: "grant hygiene",
    run: ["npm", "run", "check:grants"],
    requires: { file: "scripts/check-grants.mjs" },
  },
  rpc: {
    label: "RPC contract drift",
    run: ["npm", "run", "check:rpc"],
    requires: { file: "scripts/check-rpc-contract.mjs" },
  },
};
