---
name: stack-bootstrap
description: Use when standing up a new repository on the proven house stack, or when an existing repo is missing its git hooks, CI pipeline, guardrail scripts, doc spine, agent tooling, or Supabase conventions. Triggers - "bootstrap a new repo", "new project setup", "scaffold the stack", "set up CI and hooks", "seed the doc spine", "stack-bootstrap".
---

# Stack Bootstrap

## Overview

Stands up a repository with the house stack already wired: strict-ratchet TypeScript,
two-tier git hooks, a CI pipeline whose summary job can actually say no, a self-healing
guardrail layer, a doc spine sized to the project's real complexity, a typed data layer,
and Supabase conventions that pair every migration with a rollback, a test and a catalog
entry.

**Core principle: ratchets, not walls.** Every gate ships with an empty or
immediately-passing baseline and tightens from there. A threshold nobody can hit today
gets disabled tomorrow, which is worse than no threshold at all.

The content here is extracted from two production repos plus current Supabase guidance.
Where the sources disagreed, this skill states the ruling once — see **Rulings**. Where a
source was unverified, contradicted, or specific to a domain this skill does not carry,
it was dropped or marked optional rather than presented as proven.

## When to Use

- A new repo needs its whole floor laid before the first feature.
- An existing repo has code but no hooks, no CI, no guardrails, or no doc spine.
- Someone asks "what's our standard setup" and you would otherwise re-derive it.

Do **not** use this to redesign an existing, working setup. If the repo already has a
lefthook tier structure and a CI summary job, read its config before proposing changes.

## Inputs it expects

Ask for whatever is missing before starting. All but the first two have defaults.

| Input | Meaning | Default |
|---|---|---|
| `PROJECT` | Repo/package name, kebab-case. Substituted for `{{PROJECT}}` throughout the references. | required |
| `PROJECT_PATH` | Absolute path to the repo root. | required |
| `SUPABASE` | `yes` / `no`. Drives steps 9 and parts of 7. | `yes` |
| `PLATFORM` | `web` / `mobile`. See the note below. | `web` |
| `DESIGN_PACK` | Path to an existing design-token or component-kit source to seed theme tokens and the state kit from. | none |
| `DEPLOY` | `render` / `none`. Step 10. | `render` |

**PLATFORM=mobile**: only `references/stack.md` and the Vite/Tailwind/render parts of
step 2, 3 and 10 are web-specific. Hooks, CI shape, guardrails, doc spine, Supabase
conventions and agent tooling all carry over unchanged. This skill has **no verified
React Native or Expo config** — build that part from the platform's own docs and reuse
everything else here. Do not fabricate a mobile config from the web one.

## Non-negotiables

These are the parts that are cheap on day one and expensive to retrofit. Do not defer
them "until the project is bigger" — that is exactly when they stop being possible.

1. **Strict-ratchet tsconfig from day one, with an empty allowlist.** `tsconfig.strict.json`
   extends the app config, turns the full strict family on, and its `include` starts with
   only the ambient `.d.ts` file. Files graduate one at a time. Never flip `strict: true`
   globally on a codebase that has any history.
2. **Two hook tiers.** `baseline` commands (format-on-commit, commit-message lint) always
   run and always block. `guardrail` commands route through `guard.mjs`, are advisory, and
   can be paused. The pause must never be able to silence the baseline tier.
3. **A CI summary job that fails on `skipped`.** A final job reads every blocking job's
   `.result` and exits 1 on `failure`, `cancelled` **or** `skipped`. An upstream install
   failure marks dependents skipped, not failed — a gate that ignores `skipped` passes a
   run that executed nothing.
4. **Typed RPC map data layer. No Effect.ts.** One `rpc()` wrapper, one `RpcMap` type
   registry, plain `async/await` returning `{ data, error }`, a discriminated error type.
   Both source repos' authors independently concluded a functional-effects runtime does not
   pay for one-step calls, and the more mature of the two does not use one.
5. **Doc spine at the light tier, with named split triggers.** Four living files, not a
   fourteen-file split. Each split has a written trigger so nobody re-derives it under
   pressure. See `references/doc-spine.md`.
6. **Additive doc surgery.** Living docs are edited by appending whole lines anchored on an
   existing neighbour, never by mid-line splice. Prove it with `git diff --numstat` showing
   pure insertions.
7. **A shared empty / loading / error state kit before the second screen needs one.**
   Neither source repo built this and both paid for it in drift. Build it first.
8. **Supabase batches ship as one commit**: forward migration, rollback, SQL test, catalog
   entry and changelog line together. A migration whose catalog entry lands in a follow-up
   commit fails review.
9. **The safe-command-guard hook**, wired as `PreToolUse(Bash)` in `.claude/settings.json`,
   from the first commit. It is a safety guard, not a quality gate, and the guardrail toggle
   must never reach it.
10. **New key model only**: `sb_publishable_` / `sb_secret_` API keys and asymmetric ES256
    JWT signing keys. The legacy `anon` / `service_role` JWT plus shared HS256 secret is the
    deprecated path being phased out through end of 2026.

## Rulings

Stated once here so they are not re-litigated per step.

- **Rollback location**: `supabase/rollbacks/NNN_<slug>_rollback.sql`, a separate top-level
  directory. The migration-QA skill's path string says otherwise; the real repo layout wins.
- **RLS posture**: pick one per project, never per table. Default is **RPC-only deny-all**
  (RLS enabled, zero policies, `REVOKE ALL`, every access through a `SECURITY DEFINER` RPC)
  because it is the posture the typed RPC map assumes. Choose per-operation `CREATE POLICY`
  with helper functions only if clients read tables or facade views directly — and then the
  RLS performance rules in `references/supabase.md` apply in full.
- **`search_path` on functions**: pin it. Prefer `SET search_path = ''` with every object
  schema-qualified. The explicit four-schema form
  `SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'` is the accepted
  equivalent when extension functions are called unqualified. Never leave it unset.
- **Money**: `bigint` in the currency's minor unit, plus a `currencies` lookup table holding
  each currency's minor-unit exponent. The generic Postgres advice is "use `numeric`"; the
  money-specific literature and payment-processor wire formats favour integer minor units,
  and that wins for a multi-currency system.
- **Folder layout**: `src/features/<name>/` with a barrel from day one; cross-cutting code
  stays flat at `src/components` and `src/hooks` until it earns a `src/shared/` extraction.
- **Rollback of an applied migration**: production migrations roll forward. The committed
  rollback file exists to be reviewed and tested before apply, and to restore a
  non-production environment — not as a promise you can undo a shipped change safely.

## Procedure

Work through in order. Each step's verification command must pass before the next.
Steps 4 and 5 are the ones most often skipped and most expensive to add later.

### 1. Repo skeleton and dependencies

Create the repo, `git init`, write `package.json` with `"name": "{{PROJECT}}"` and
`"type": "module"`, install the core dependency set, add the script block. Core versus
optional lists and the full script table: `references/stack.md` §1–§2.

```
node -e "const p=require('./package.json');if(p.name!=='{{PROJECT}}')process.exit(1)" && npm ls --depth=0 >/dev/null
```

### 2. Config files

Write every config from `references/stack.md` §3–§10: `vite.config.ts`, `tsconfig.json`,
`tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.strict.json`, `tailwind.config.ts`,
`postcss.config.js`, `components.json`, `eslint.config.js`, `eslint.hooks.config.js`,
`vitest.config.ts`, `src/test/setup.ts`, `.prettierrc.json`, `.prettierignore`,
`.editorconfig`, `.env.example`.

```
npm run typecheck && npm run typecheck:strict && npm run lint:hooks && npm run format:check
```

### 3. Source skeleton, data layer and state kit

`src/lib/supabase.ts` (the only `createClient` call site), `src/lib/queryClient.ts`
(shared client with the `MutationCache` error-toast convention), `src/lib/rpc.ts` and
`src/lib/rpc.types.ts` (the typed map), `src/lib/queryKeys.ts`, the shared
empty/loading/error state kit, the form-field kit, the role-filtered nav config, the
theme provider. Patterns and code: `references/app-architecture.md`. If `DESIGN_PACK` was
given, seed theme tokens and the state kit from it before writing any screen.

```
npm run typecheck && npm test
```

### 4. Safety hook

`.claude/settings.json` with the `PreToolUse(Bash)` hook, plus
`scripts/safe-command-guard.mjs`. Source and rule list: `references/guardrails.md` §1.

```
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | node scripts/safe-command-guard.mjs; test $? -eq 2
```

### 5. Baseline hook tier

`lefthook.yml` with the `baseline` tier only, `commitlint.config.cjs`, the `lint-staged`
block in `package.json`, and `"prepare": "lefthook install"`. Literal files:
`references/hooks-and-ci.md` §1–§3.

```
npx lefthook install && npx lefthook run pre-commit && echo "chore: probe" | npx --no -- commitlint
```

### 6. CI and PR template

`.github/workflows/ci.yml` including the summary job, and
`.github/pull_request_template.md`. Literal workflow: `references/hooks-and-ci.md` §4–§5.
Then flag the human-only step below.

```
npx --yes @action-validator/cli -s github .github/workflows/ci.yml 2>/dev/null || node -e "require('js-yaml')" 2>/dev/null || echo "parse-check the workflow in the Actions tab after first push"
```

**Human-only, outside any file in the repo**: turn on branch protection for the default
branch and mark the blocking checks as required. A thirteen-job hard-failing pipeline
provides zero custody until someone does this in the host's settings. Say so explicitly
and do not mark the bootstrap complete while it is outstanding.

### 7. Guardrail tier

`scripts/guardrails.config.mjs`, `scripts/guard.mjs`, `scripts/hygiene-check.mjs`,
`.dependency-cruiser.cjs` plus an empty `.dependency-cruiser-known-violations.json`,
`.semgrep/rules.yml`, `scripts/bundle-budget-check.mjs` and its baseline. Add the
`guardrail` tier to `lefthook.yml`. All sources: `references/guardrails.md`.

Register only the checks whose tooling exists. The `requires` probe skips an unwired
check quietly, so a partial stack never breaks a hook.

```
npm run guardrails:status && node scripts/guard.mjs all && npm run arch:graph && npm run sast
```

### 8. Doc spine

`CLAUDE.md`, optional `AGENTS.md`, `README.md` written for the actual product,
`CHANGELOG.md`, and `ai/hot-state.md`, `ai/state.md`, `ai/hydration-ladder.md`. Seed
`docs/postmortems/README.md` with an empty index table. Skeletons, split triggers and the
additive-editing rules: `references/doc-spine.md`.

```
test -f CLAUDE.md && test -f CHANGELOG.md && test -f ai/hot-state.md && test -f ai/state.md && test -f ai/hydration-ladder.md && ! grep -q "{{PROJECT}}" README.md
```

### 9. Supabase (skip if `SUPABASE=no`)

Folder layout, `config.toml`, the migration/rollback/test/catalog/changelog quintet, RLS
authoring style, the RPC seven-point contract, and the agentic defaults table:
`references/supabase.md`. Create the folders and the catalog and changelog headers now;
the first real migration follows the same-commit rule from its first line.

```
test -d supabase/migrations && test -d supabase/rollbacks && test -d supabase/tests && test -f supabase/migrations/migration-catalog.md && npm run lint:sql
```

### 10. Deploy config (skip if `DEPLOY=none`)

`render.yaml` with `npm ci`, a `verify:deploy` gate ahead of the build, the four security
headers, and the SPA rewrite. Literal file: `references/stack.md` §10.

```
npm run verify:deploy
```

### 11. Agent tooling

`.claude/settings.local.json` permissions, `.claude/commands/`, `.gitignore` entries, and
the optional PR auto-sync scripts. Sources: `references/agent-tooling.md` and
`references/hooks-and-ci.md` §6.

```
git check-ignore -q .omc/ && git check-ignore -q .guardrails-off && git status --short
```

### 12. Final verification

```
npm ci && npm run verify:deploy && npm run lint && node scripts/guard.mjs all && git log --oneline -1
```

Then report: what was created, what was skipped and why, and the outstanding human-only
steps (branch protection, CI secrets, the first `.env` values).

## Quick reference

| Concern | File | Blocking? |
|---|---|---|
| Dangerous shell commands | `scripts/safe-command-guard.mjs` | yes, always on, un-pausable |
| Format on commit | `lefthook.yml` → `lint-staged` | yes, baseline |
| Commit message shape | `commitlint.config.cjs` | type yes, scope warn-only |
| Type safety, loose | `tsconfig.app.json` | yes, in CI |
| Type safety, strict subset | `tsconfig.strict.json` | yes, in CI |
| Hook-order bugs | `eslint.hooks.config.js` | yes, in CI |
| Broad lint / format drift / dep audit | `eslint.config.js`, prettier, `npm audit` | advisory |
| Architecture boundaries | `.dependency-cruiser.cjs` | advisory, ratchet with `--block` |
| Custom SAST | `.semgrep/rules.yml` | ERROR rules yes, rest advisory |
| Bundle growth | `scripts/bundle-budget-check.mjs` | advisory ratchet |
| Doc staleness | `scripts/hygiene-check.mjs` | never, advisory only |

## Common mistakes

- **Registering a guardrail check whose script does not exist yet.** The `requires` probe
  handles it, but only if you write the `requires` clause. Without it the hook errors.
- **Copying a config's comments along with its content.** The source repos carry fossil
  references to tools they no longer use. The references here are already cleaned; keep
  them that way.
- **Setting a coverage threshold or a bundle budget before there is anything to measure.**
  Ship the ratchet with no threshold, set the first floor once real numbers exist.
- **Treating a green CI as custody.** Without branch protection it is decoration.
- **Adding a second toast library.** One toast library, one mutation-error path.
- **Writing a migration without its rollback and test in the same commit.** The review gate
  rejects it and you will have lost the context by the time you come back.
- **`git add` then a bare `git commit` in a shared checkout.** The index is process-wide, so
  that commit takes whatever anyone else has staged. Commit with explicit pathspecs — see
  `references/agent-tooling.md` §7.

## References

- `references/stack.md` — dependencies, every config file, deploy config.
- `references/hooks-and-ci.md` — lefthook, commitlint, lint-staged, the CI workflow, PR sync.
- `references/guardrails.md` — guard toggle, safe-command-guard, dependency-cruiser, semgrep,
  bundle budget, and the Supabase-coupled checks as patterns.
- `references/doc-spine.md` — folder tree, every skeleton, split triggers, editing rules.
- `references/supabase.md` — layout, naming, catalog, templates, RLS, RPC contract, defaults.
- `references/app-architecture.md` — auth, nav, typed RPC map, errors, forms, theme, routing.
- `references/agent-tooling.md` — settings, hooks, permissions, commands, gitignore, and the
  pathspec commit rule for a shared worktree.
