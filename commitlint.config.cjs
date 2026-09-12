/**
 * commitlint configuration — Conventional Commits plus project scopes.
 *
 * .cjs because package.json is "type": "module" and commitlint v19 loads its
 * config via CommonJS require().
 *
 * Wired via lefthook.yml's commit-msg stage.
 *
 * NOTE: scope-enum is SET BUT NOT ENFORCED (severity 1 = warn). Flip to
 * severity 2 once the list below has been validated against real usage.
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    // EDIT THIS LIST as the module names stabilise. Structural scopes first,
    // then the TrainOS domain scopes as features land.
    "scope-enum": [
      1,
      "always",
      [
        "auth",
        "config",
        "ui",
        "ci",
        "deps",
        "docs",
        "tests",
        "release",
        "lib",
        "state",
        "routing",
        "perf",
        "rpc",
        "migration",
        "supabase",
        "scaffold",
        "shell",
        "tokens",
        "nav",
        "api",
        "contract",
        "fixtures",
        "agents",
      ],
    ],
    "header-max-length": [2, "always", 100],
    "subject-case": [0, "never"],
    "scope-empty": [0, "never"],
  },
};
