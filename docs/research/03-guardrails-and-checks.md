# Guardrails and Self-Healing Checks — Showroom Inventory

Source repo (read-only): `/Users/khumeren/Repos/personal-work/showroom`. Secondary repo checked
(`/Users/khumeren/Repos/personal-work/vern-vault`): its `scripts/` and `test/` contain only
project-specific glue (a post-push hook, an inventory-extraction Python script, a seed-vehicles
generator, PR-sync shell scripts) and **no** lefthook config, no `.semgrep`, no
`.dependency-cruiser.cjs`, no `guard.mjs`-equivalent, no `safe-command-guard.mjs`. It has nothing
this doc needs to add — every item below comes from showroom.

All findings below are from reading the actual script source (not inferred from filenames).
Non-goals honored: lefthook/CI YAML content is cited only for cross-reference, not re-analyzed;
package deps, Supabase migration conventions, and docs-folder conventions are left to other
agents.

---

## 1. `scripts/guard.mjs` — the toggle keystone

**Purpose.** One cross-platform chokepoint that Lefthook, the Claude Code `Stop` hook, and
`npm run guard` all route through, so a single sentinel file can pause/resume the *advisory*
guardrail layer without touching multiple call sites.

**Inputs.** Subcommand argv: `off | on | status | all | run <check> [--block]`. Reads
`scripts/guardrails.config.mjs` for the `SENTINEL` path and the `CHECKS` registry.

**What it checks / does.**
- `off` → writes the sentinel file (`.guardrails-off`, gitignored, repo-root) with an
  informational timestamp. Presence/absence is what matters, not content.
- `on` → deletes the sentinel.
- `status` → prints ON/OFF plus which layer is baseline (always runs) vs advisory (toggled).
- `all` / `run <check>` → iterates the `CHECKS` registry (or one named check), skips a check
  whose `requires.file` or `requires.npmScript` isn't present yet ("phase tolerance" — never
  errors on a partially-built stack), and spawns each check's command via `spawnSync(..., {
  shell: true })`.
- Exit-code handling is deliberately layered (`scripts/guard.mjs:96-121`):
  - `res.status == null` (spawn failure / signal kill) → treated as tool error, code 2.
  - Non-zero + not `--block` → swallowed to 0, but logged loudly at different severities:
    spawn failure ("FAILED TO RUN"), code ≥ 2 ("TOOL ERROR"), code 1 ("reported findings").
  - Non-zero + `--block` → propagates (this is the ratchet path to make a check a real gate).

**Pass/fail output.** Pass: check runs, prints its own output, no findings text from guard.mjs
itself beyond the header line. Fail (advisory): `⚠️ guard: <label> reported findings (advisory —
not blocking)`. Fail (tool error, advisory): `🟠 guard: <label> EXITED <code> — looks like a TOOL
ERROR, not findings.` Paused: `(guardrails paused — skipping all guardrail checks)`.

**Exit codes.** `all`/`run` exit with `block ? worst : 0` — i.e. 0 always unless `--block` is
passed, in which case the worst child exit code propagates. `run` with no check name → exit 2.
Unknown subcommand → exit 2.

**Baseline vs advisory / record mode.** No baseline file of its own — it is the *orchestrator*
for other checks' baselines. Design rule embedded in the header comment: baseline hooks
(lint-staged, commitlint, `check:rpc`) deliberately do **not** route through `guard.mjs` — they
always run, toggle or not. Only the "NEW layer" (Fallow, dependency-cruiser, hygiene, compositor
budget, bundle budget, edge-deploy parity) is pausable via this sentinel.

**Config location.** `scripts/guardrails.config.mjs` (sentinel name, `CHECKS` registry,
`SEAM_GLOBS`, `CODEX_DAILY_CAP`, `CODEX_LEDGER_DIR` — single source of truth so the toggle, the
Codex gate, and the check registry can't drift from each other).

**Invoked by.**
- `lefthook.yml:55-61` — pre-push `guardrails` command, `tags: guardrail`, runs
  `node scripts/guard.mjs all` (toggle-aware, always exits 0 per lefthook's lack of a
  "continue on error" flag).
- `package.json` scripts: `guard`, `guardrails:on`, `guardrails:off`, `guardrails:status`.
- **Not** invoked directly by `.github/workflows/ci.yml` — CI runs the underlying npm scripts
  individually (`check:rpc`, `check:grants`, `lint:sql`, `sast-semgrep`) rather than through the
  toggle, which is correct: CI must never silently skip because someone paused guardrails
  locally.

**Classification: frontend-generic.** The toggle mechanism, phase-tolerant `requires` probe, and
advisory/blocking exit-code discipline are stack-agnostic and directly portable. The *registered
checks themselves* vary in coupling (see below).

---

## 2. `scripts/guardrails.config.mjs` — single source of truth

**Purpose.** Central config consumed by `guard.mjs` (check registry + sentinel) and
`codex-gate.mjs` (seam manifest + daily cap), so the toggle name, the "what is a critical seam"
definition, and the check list can never drift into three copies.

**Exports:**
- `SENTINEL = ".guardrails-off"` — gitignored, repo-root, machine-local pause flag.
- `CODEX_LEDGER_DIR = ".codex-reviews"` — dedup ledger for the seam-gate (one JSON file per
  reviewed diff fingerprint).
- `CODEX_DAILY_CAP = 8` — max Codex launches/day (UTC); 0 = uncapped. Cost guard, not a
  correctness guard.
- `SEAM_GLOBS` — repo-root-relative globs defining "critical seams" (RPC layer, Supabase config
  context, auth hooks, semgrep rules, and — deliberately — the guardrail control-plane files
  themselves: `guard.mjs`, `codex-gate.mjs`, `guardrails.config.mjs`,
  `safe-command-guard.mjs`, `lefthook.yml`, `.claude/settings.json`,
  `.claude/settings.local.json`, `.dependency-cruiser-known-violations.json`). The self-reference
  is intentional: an edit to the guardrail jail must trigger review of that edit.
- `CHECKS` — registry keyed by short name → `{ label, run: [argv...], requires: { file? |
  npmScript? } }`. Current entries: `fallow` (→ `npm run fallow:audit`), `depcruise` (→ `npm run
  arch:graph`), `hygiene` (→ `node scripts/hygiene-check.mjs`), `compositor` (→
  `compositor-budget-check.mjs`), `bundle` (→ `bundle-budget-check.mjs`), `edgeDeploy` (→
  `check-edge-deploy.mjs`). Notably `codex-gate` is **not** in this registry — it was
  deliberately moved out to be un-toggleable (see §7).

**Classification: frontend-generic** for the mechanism (sentinel name, cap, registry shape);
**wedding-specific/project-specific** for the actual `SEAM_GLOBS` contents (they name this repo's
files) and the `CHECKS` entries that point at wedding-domain checks (compositor budget, edge
deploy). Port the *shape*, replace the *contents*.

---

## 3. `.semgrep/rules.yml` — custom SAST rules

**Purpose.** Domain-specific static analysis Semgrep can express that ESLint's
`no-restricted-syntax` cannot (multi-construct / metavariable-flow patterns). Each rule is
explicitly described as "the enforcement copy" of a rule stated in `CLAUDE.md`.

**Run locally:** `npm run sast` (needs `semgrep` on PATH, or Docker per the file header).
**Run in CI:** `.github/workflows/ci.yml` job `sast-semgrep` (lines 248–274) — see below.

**Every rule, verbatim purpose:**

| id | severity | catches |
|---|---|---|
| `no-dangerously-set-inner-html` | ERROR | `dangerouslySetInnerHTML={...}` anywhere under `src` — categorical XSS ban. |
| `no-direct-supabase-table-access` | ERROR | `supabase.from(...).select/insert/update/delete/upsert(...)` — bypassing the RPC-only + RLS-REVOKE-ALL security model. |
| `as-unknown-as-double-cast` | WARNING | `$EXPR as unknown as $TYPE` — the exact pattern that hid a real RPC envelope-drift incident at compile time; ~29 legitimate historical sites exist, so it only blocks new unguarded ones. |
| `no-console-log-in-src` | WARNING | `console.log(...)` in `src` (excluding `*.test.ts(x)`) — esbuild does not strip it, so it ships to production. |
| `no-offset-pagination` | WARNING | `$Q.range($FROM,$TO)` / `$Q.offset($N)` — offset pagination table-scans and double-counts under concurrent inserts; the repo's convention is keyset (`created_at DESC, id DESC`) cursors. |
| `raw-hsl-theme-token-leak` | WARNING (marked TODO in-file) | `$OBJ.accent ?? $FALLBACK` — an intentionally **unfinished starter rule**; the file's own comments say only the `accent` token is wired and the other four (`accentLight`, `accentFaint`, `rose`, `roseMuted`) are commented out as `TODO(you)`, with an explicit narrow-vs-broad design choice left to the next author. **Do not port as "done" — port as a template pattern only.** |
| `structural-typing-trap-loose-canonical-field` | WARNING | A bare `string`/`string[]` field whose name matches `(comparison_?keys?|canonical|event_?keys?|_tokens?)` (case-insensitive) under `src/features` — TypeScript's structural typing can't see a load-bearing "canonical value" contract, so a raw value can masquerade as one. Heuristic, name-based, explicitly "advisory starter." |

**Pass output:** semgrep's normal "no findings" run. **Fail:** semgrep prints matches; CI treats
severity tiers differently (see CI section). Metadata blocks (CWE/OWASP refs, `confidence`) are
present on every rule and are informational only — semgrep doesn't gate on them.

**Config/baseline location:** the rules file itself is the only config; there is no separate
baseline file for semgrep (unlike dependency-cruiser/bundle/compositor).

**Classification: frontend-generic**, rules 1, 3, 4 (XSS, unsafe cast, console.log) — universally
applicable to any React/TS codebase. **Supabase-coupled**: rule 2 (`no-direct-supabase-table-access`)
and rule 5 (offset pagination, phrased around a Supabase query builder) — port once Supabase
exists, adapt the exact API pattern if TrainOS uses a different backend. **Wedding-specific**:
rules 6 and 7 name TrainOS-irrelevant token names (`rose`, `roseMuted`) and field-name heuristics
(`event_keys`) — port the *technique* (name-based structural-typing-trap detection, theme-token
misuse detection), not the literal patterns.

---

## 4. `.dependency-cruiser.cjs` + `.dependency-cruiser-known-violations.json`

**Purpose.** Enforces the feature-module boundary: `src/features/<name>/` modules are black
boxes reachable only through their `index.ts` barrel, and `src/shared/**` must never depend on
`src/features/**` (dependency direction must be features → shared).

**Every rule (all `severity: "error"`, all blocking once run):**
1. `no-circular` — `to: { circular: true }` — no dependency cycles anywhere in the graph.
2. `no-cross-feature-internals` — the headline rule. `from.path` captures the importing
   feature's name into `$1` (`^src/features/([^/]+)/`); `to.path` matches every feature file
   except its root barrel (`^src/features/([^/]+)/(?!index\.[cm]?[jt]sx?$).+`); `to.pathNot`
   excludes same-feature internal imports via the `$1` back-reference
   (`^src/features/$1/`). Net effect: flagged iff the target is *some other* feature's internal
   path. Importing your own feature's internals is fine.
3. `shared-no-features` — `from.path: "^src/shared/"`, `to.path: "^src/features/"` — shared
   code must never import a feature.

**Options:** `tsPreCompilationDeps: true` (follows TS's pre-compile graph, including type-only
imports — needed because many cross-feature edges are type-only); `tsConfig.fileName:
"tsconfig.app.json"` (resolves `@/*` alias); `doNotFollow.path: "node_modules"`;
`enhancedResolveOptions.extensions` matching the bundler's resolution order; `exclude.path`
skips `node_modules`, `dist`, and `*.test/spec.*` files.

**Baseline file:** `.dependency-cruiser-known-violations.json` — currently `[]` (empty). Config
header states the legacy baseline was retired after the graph reached zero violations on
2026-07-23, and the file "must stay empty." `npm run arch:baseline` (in `package.json`) would
regenerate it via `--output-type baseline`, but doing so today would just re-emit `[]`.

**Run command / gate:** `npm run arch:graph` = `depcruise src --validate .dependency-cruiser.cjs
--ignore-known --cache`. Wired through `guard.mjs` as the `depcruise` check (advisory unless
`--block`'d) — see `guardrails.config.mjs:89-93`. **Not** in `.github/workflows/ci.yml` as a
standalone job — dependency-cruiser runs only through the local/pre-push guard sweep, not CI.

**Pass/fail:** depcruise's own console output (per-violation `from → to` lines) on fail; silent
on pass with `--cache`.

**Classification: frontend-generic.** The three-rule shape (no-circular, feature-barrel
enforcement, shared-must-not-import-features) is pure architecture and has zero Supabase or
wedding coupling. Directly portable once TrainOS has an equivalent `src/features/*` /
`src/shared/*` layout — the regex depends on that folder convention existing.

---

## 5. `scripts/bundle-budget-check.mjs` — bundle size budget

**Purpose.** Answers "what actually ships to a guest's phone" — gzip-measures every emitted JS
chunk from a scratch Vite build against a committed baseline, catching a mis-imported vendor or a
broken lazy-loading boundary.

**Inputs:** none required for `check` mode beyond the committed baseline; `--baseline` flag
rebuilds and regenerates it.

**Mechanism:**
- Probes the Vite dev-server port (8080, both `127.0.0.1` and `::1`) via a **content probe**
  (looks for `/@vite/client` in the response body), not a bare TCP probe — so a non-Vite process
  squatting the port (e.g. Apache/XAMPP) doesn't false-positive a skip. If a real Vite dev server
  is live, the check **skips with exit 0** (never runs `vite build`, because building while `npm
  run dev` is live corrupts `node_modules/.vite` and causes white-screens — documented as a real
  bit-twice incident, 2026-06-08).
- Baseline-gate-before-build: if not `--baseline` and no baseline file exists, exits 2
  immediately (fail fast, don't pay for a full build with nothing to compare against).
- Builds to a scratch `outDir` (`.bundle-check/`, gitignored) via `npx vite build --outDir
  .bundle-check --emptyOutDir`.
- Measures gzip size of every `.js` file under `<outDir>/assets`, collapsing Vite's 8-char
  content hash out of filenames (`stableName`) so baseline keys survive hash churn across builds.
  Sums sizes on stable-name collision.
- Identifies the entry chunk from `index.html`'s `<script type="module" src=...>` tag —
  label-only; the budget itself gates all chunks uniformly.
- Tolerance: per-chunk `max(4096 bytes, 3% of baseline)`; total `max(8192 bytes, 2% of
  baseline)`.

**Pass output:** per-chunk size table plus `bundle-budget: OK — within the committed baseline.`
**Fail output:** `✗ <chunk> grew <old> → <new> (allowed <max>)` lines, plus a total-size line if
the total budget is exceeded, ending with `bundle-budget: N budget regression(s) vs
.bundle-size-baseline.json.` and hints (`npm run bundle:analyze` to dig in via
`vite-bundle-visualizer`, `npm run bundle:baseline` to ratchet).

**Exit codes:** 0 = OK or skipped (dev server live); 1 = findings (budget regression); 2 = tool
error (build failed, baseline missing/unreadable, `assets/` missing after build).

**Baseline file:** `.bundle-size-baseline.json` (repo root) — committed, contains `{ entry,
chunks: {name: gzipBytes}, totalGzipJs }`. Regenerated via `npm run bundle:baseline`.

**Invoked by:** `guardrails.config.mjs` `bundle` check (advisory, toggleable). `npm run
bundle:check` / `bundle:baseline` / `bundle:analyze` (the last is the human-facing
`vite-bundle-visualizer` treemap, not part of the gate).

**Classification: frontend-generic.** Entirely Vite/bundler-specific, zero Supabase coupling.
Directly portable to any Vite-based frontend (confirm TrainOS uses Vite; if it uses a different
bundler, port the *concept* — gzip-measured per-chunk ratchet baseline with dev-server-collision
avoidance — and re-target the build invocation and dev-port probe).

---

## 6. `scripts/compositor-budget-check.mjs` — D-034 compositor budget

**Purpose.** A grep-gate for GPU compositor-cost CSS patterns (`backdrop-filter`,
`backdrop-blur`, `blur-3xl`, `drop-shadow`) on "wedding-facing" component roots, ratcheted
against a per-file baseline. Root cause it defends against: filter surfaces that are invisible or
imperceptible still force per-frame GPU work, and on mobile GPUs `backdrop-filter` under a
transformed layer can composite as a black box (a cited real incident, 2026-07-10).

**Scan roots (this repo):** `src/components/wedding`, `src/shared/templates`,
`src/shared/components/ui` — explicitly scoped to guest-facing surfaces, excluding
marketing/admin ("different budget, different reviewers").

**Mechanism:**
- Walks `.ts`/`.tsx` files under the scan roots.
- Offender regex: `backdrop-filter|backdropFilter|backdrop-blur|blur-3xl|drop-shadow|dropShadow`.
- A hit is excused if the same line or the line directly above it contains `d034-ok` (case
  insensitive) — a justification-comment escape hatch, e.g.
  `{/* d034-ok: translucent overlay above scrolling page content */}`.
- Tracks block-comment state line-by-line (not just line-local regex) specifically to avoid two
  documented false-positive/negative classes: counting prose *inside* a multi-line comment as a
  real hit, and skipping real code that happens to start with `*`.
- Per-file hit counts are compared against `.compositor-budget-baseline.json`; a file exceeding
  its baseline allowance fails. Reducing hits is always allowed; growing requires either the
  `d034-ok:` comment or an explicit `--baseline` re-ratchet.

**Pass output:** `compositor-budget: OK — no wedding surface exceeds the D-034 baseline.`
**Fail output:** per-file `✗ <file> — N unjustified filter surface(s), baseline allows M:` plus
per-hit `:<line> <text>` listing, then a summary suggesting fix / justify / ratchet.

**Exit codes:** 0 = clean; 1 = findings; 2 = no baseline found or baseline unreadable.

**Baseline file:** `.compositor-budget-baseline.json` — `{ "<relative/path>.tsx": count, ... }`.
Note in the header: renaming a file with grandfathered hits resets its allowance to 0 — re-ratchet
in the same commit as the rename.

**Invoked by:** `guardrails.config.mjs` `compositor` check (advisory). `npm run
compositor:check` / `compositor:baseline`.

**Classification: wedding-specific mechanism scope** (the scan roots and the very concept of a
"D-034 compositor budget" are this repo's naming), but the **underlying technique is
frontend-generic**: a baseline-ratcheted grep-gate for expensive-CSS-property regressions with an
inline justification-comment escape hatch. Recommended for TrainOS: port the *pattern* (baseline
ratchet + justify-comment + per-file allowance), re-target scan roots and offender regex to
whatever CSS/perf risk TrainOS actually has (if any) rather than copying the wedding scan paths
verbatim.

---

## 7. RPC / grants / applied / edge-deploy checks (Supabase-coupled)

These four are the most Supabase-specific of the set — **port once Supabase exists**, not before.

### 7a. `scripts/rpc-contract-check.js`

**Purpose.** Detects drift between SQL RPC envelope shapes (as authored in
`supabase/migrations/*.sql`), the `rpc()`/`rpcEnvelope()` wrapper's auto-unwrap behavior
(`src/lib/rpc.ts`), the declared `RpcMap` response types (`src/lib/rpc.types.ts`), and consumer
cast sites in `src/`. Named after a real incident: an April 2026 `get_ticket` envelope
regression where adding a sibling key beside `data` flipped the wrapper from auto-unwrap to
pass-through, and a consumer's `as unknown as <Type>` cast silently corrupted the rendered shape.

**Mechanism (five stages):**
1. Parse every `supabase/migrations/NNN*.sql` in numeric order; for each `CREATE [OR REPLACE]
   FUNCTION` (schema-qualifier tolerant), find the last `jsonb_build_object`/`json_build_object`
   call in the function body whose first key is `'success'` with value `true`, and record its key
   list as the "envelope shape." Both `json_` and `jsonb_` builder forms are scanned — a
   2026-09-07 finding notes migration 109 used only the `json_` form and was previously invisible
   to an alternation that scanned `jsonb_` only, producing a false PASS.
2. Parse `src/lib/rpc.types.ts`'s `RpcMap` interface for each entry's declared `response` type
   (hand-rolled brace/paren-depth scanner, not a TS compiler).
3. Also collect every named `interface`/`type` alias in `rpc.types.ts` that itself contains a
   `data:` field, so a response declared as a named "envelope-shaped" type is recognized as
   acknowledging the envelope, not just an inline `{ data: ... }`.
4. Grep `src/**/*.ts(x)` for `rpc(...)`/`rpcEnvelope(...)` call sites, tracking whether each uses
   the paginated wrapper.
5. Classify each `RpcMap` entry into **PASS / WATCH / BROKEN** based on wrapper behavior
   (`raw` / `shape1-unwrap` / `shape1-extras` / `shape3`) crossed with whether the declared
   response type acknowledges the envelope and whether callsites use the right wrapper function.

**Pass/fail output:** a markdown report to stdout — counts (`PASS: n WATCH: n BROKEN: n`), then a
`## BROKEN` section (function name, migration, why, declared response, consumer callsites) and a
`## WATCH` section if any.

**Exit codes:** 0 = no BROKEN rows; 1 = ≥1 BROKEN row; 2 = script error (uncaught exception in
`main()`).

**Invoked by:** `npm run check:rpc`; `lefthook.yml:37-40` pre-push `check-rpc` command (`tags:
baseline` — un-toggleable, blocks push on failure); `.github/workflows/ci.yml` job `rpc-contract`
(lines 172-183) and required in the `summary` job's blocking list (line 319).

**Classification: supabase-coupled.** The entire mechanism depends on Postgres
`jsonb_build_object` envelope conventions and a specific TS RPC-wrapper pattern. Port the
*concept* (a static drift-checker between a backend contract's authored shape and its typed
consumer surface) once TrainOS has an equivalent backend/RPC layer; the parsing logic itself is
not reusable as-is.

### 7b. `scripts/check-grants.mjs` — grant hygiene (SEC-3)

**Purpose.** Static (no DB connection) guard against anon/PUBLIC EXECUTE grants on
non-allowlisted `SECURITY DEFINER` functions — closes the vector from a real incident (SEC-1/
SEC-2, 2026-07-14) where a `SECURITY DEFINER` helper granted to `anon` became an unauthenticated
cross-tenant DELETE.

**Checks:**
- **T1** — no `supabase/tests/*.sql` file may define a `SECURITY DEFINER` function.
- **T2** — no test file may `GRANT EXECUTE` to `anon`/`authenticated`/`public`.
- **M1** — any migration numbered above the hardening cutoff (065) must not `GRANT EXECUTE` to
  `anon`/`public` on a function outside `ANON_ALLOWLIST` (a hardcoded `Set` of ~9 function
  names), including the schema-wide `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` form (never
  allowlistable). A grant is excused if a **strictly later** migration revokes it — the script
  tracks per-function "revoked-at" migration numbers rather than judging each file in isolation,
  specifically to avoid flagging a grant that a later migration already closed (a real false
  positive it documents: migration 082 revoked what 069 had granted).
- **A1** — the allowlist must be textually identical across three homes: the script's
  `ANON_ALLOWLIST` constant, migration `065_grant_hygiene_revoke_anon.sql`'s `v_allow` array, and
  `supabase/tests/test_065_grant_hygiene.sql`'s `v_allow` array.

**Pass output:** prints the allowlist, then `PASS: no grant-hygiene violations.` plus a note that
the live-state assertion is a companion SQL test run separately (not by this script). **Fail:**
`FAIL: N violation(s):` with `[rule] file` / message pairs.

**Exit codes:** 0 = clean; 1 = ≥1 violation; 2 = script error.

**Invoked by:** `npm run check:grants`; `lefthook.yml:41-46` pre-push (`tags: baseline`,
blocking); `.github/workflows/ci.yml` job `grant-hygiene` (lines 205-216), required in `summary`.

**Classification: supabase-coupled.** The mechanism (three-way allowlist-sync + a
static grant-drift linter over a set of "migration" files) is a genuinely good pattern for any
system with an authorization allowlist expressed in more than one artifact, but the
implementation is Postgres-GRANT-syntax-specific. Port the *pattern* once TrainOS has an
equivalent permission-grant surface; do not port the regexes.

### 7c. `scripts/check-applied.mjs` — applied-vs-authored parity

**Purpose.** Verifies every migration file claiming to exist in `supabase/migrations/` actually
ran in production, using a **committed snapshot** of the `supabase_migrations.schema_migrations`
ledger (`supabase/migrations/.applied-state.json`), not a live DB query — because this needs to
run in CI/pre-push without prod credentials. Motivated by a real incident: migration 078 sat in
the repo, was cited by later migrations as established fact, and had never been applied; the
actual live state was an unrelated open security hole closed three months later by migration 117.

**Checks:** L1 (repo file ≥ ledger-start with no ledger row = BROKEN, "the 078 shape"), L2
(ledger row with no matching repo file = BROKEN, something ran that the repo never described), L3
(one ledger name with >1 row = WATCH, ambiguous for name-based rollback), L4 (slug matches but
leading number differs/absent = WATCH), L5 (snapshot missing/malformed/never recorded = BROKEN),
L6 (a `DELIBERATE_NON_APPLIES` entry that IS in the ledger = BROKEN, the excuse is now false), L7
(a `DELIBERATE_NON_APPLIES` entry with no matching file = WATCH, stale excuse).

Matching is by **slug** (filename minus leading `NNN_` and `.sql`), because ledger names are
operator-typed free text and are not reliably unique or numbered — documented with five concrete
examples of number-stripped ledger names and two duplicate-name pairs. `DELIBERATE_NON_APPLIES`
is a hardcoded object requiring a `reason` + `citation` string per entry, printed in full on every
run (anti-rubber-stamp discipline).

Explicitly documented limit: this compares the tree against a **record** of the ledger, not
against production — cannot catch a `--record` run by someone who never actually read prod.
Explicitly documented non-goal: no body-hash comparison (measured to be ~87% false-positive on
real data, since the ledger stores executed SQL, not the file's byte range).

**Modes:** default check mode; `--record <ledger-dump.json>` ingests a JSON dump (array or
`{rows:[...]}`/`{result:[...]}`) and stamps the snapshot file with `recordedAt`/`recordedFrom`.
`--state <path>` / `--migrations-dir <path>` for fixture-driven testing.

**Exit codes:** 0 = no BROKEN; 1 = ≥1 BROKEN; 2 = script error.

**Invoked by:** `npm run check:applied` / `check:applied:record`. **Not found wired into
`lefthook.yml` or `ci.yml`** in the files inspected — appears to be a manually-run gate at
migration-review time (paired with the `migration-retrofit-qa` skill referenced in `hygiene.md`),
not an automatic hook. *(Could not verify further wiring — see §"What I could NOT verify.")*

**Classification: supabase-coupled** (ledger table name, migration-file numbering convention) but
the **underlying idea is broadly valuable and worth flagging to TrainOS regardless of backend**:
a file in version control is a *claim*, not a *fact*, about a deployed system, and a
committed-snapshot-vs-tree parity check is the cheapest way to catch "authored but never shipped."
Recommended for trainos once there's any out-of-band-deployed artifact (migrations, edge
functions, config) whose deployment state isn't visible from `git log`.

### 7d. `scripts/check-edge-deploy.mjs` — edge-function deploy parity

**Purpose.** The same "claim vs fact" problem as `check-applied.mjs`, but for Supabase Edge
Functions, which deploy **out of band** — `git push` does nothing to them. Motivated by a real
three-day production incident (2026-08-16): a checkout function's template allowlist was fixed in
the repo two hours after the last deploy, and every customer reaching four of five templates got
`400 Invalid templateId` for three days despite 5,127 green tests and a clean `check:rpc`.

**Mechanism:**
- For each directory under `supabase/functions/` (excluding `_shared` and anything without an
  `index.ts`), resolves the transitive closure of **local** files it imports (only relative
  specifiers `./...`/`../...` are followed; `npm:`/`jsr:`/`https://` remote imports are left alone
  because a version bump there changes the entrypoint's own bytes and is caught anyway).
- Hashes the sorted file-path-plus-content set with SHA-256 (path is hashed too, so moving a file
  between `_shared/` and a function directory is visible even with identical bytes).
- Compares against `supabase/functions/.deployed-state.json`'s recorded `treeSha256` per
  function. Status: `IN SYNC` / `SKEWED` / `UNRECORDED`.

**Modes:** default check; `--record` (optionally `--only <name>`) stamps the state file
immediately **after** a real deploy — recording is framed as part of deploying, not a step after
it.

**Pass/fail output:** a table of `✓/✖ <function> <status> (deployed vN, date)`; on skew, prints
the two hash prefixes and the bundled file list; final message includes copy-pasteable
`npx supabase functions deploy <name>` + `--record --only <name>` remediation commands.

**Exit codes:** 0 = no functions found, or all in sync; 1 = ≥1 skewed. (No distinct "tool error"
exit path documented beyond unreadable state JSON, which exits 1.)

**Invoked by:** `guardrails.config.mjs` `edgeDeploy` check (advisory, toggleable via
`guard.mjs`). `npm run check:edge` / `check:edge:record`.

**Classification: supabase-coupled** (Supabase Edge Functions specifically), but again the
**pattern is universal**: any serverless/edge-function-style deploy target that moves
out-of-band from `git push` benefits from a content-hash-vs-last-known-deploy parity check.
Recommended for trainos if/when it adopts any out-of-band-deployed compute (edge functions,
Lambda, Cloudflare Workers, etc.).

---

## 8. `tools/sql-lint.mjs`

**Purpose.** Parses every migration, test pin, and rollback SQL file through `libpg-query` (the
real Postgres parser, compiled to WASM) to catch syntax errors before a migration ever reaches a
database. Closes a documented real gap: `test_073`/`test_075` were authored but could not
actually run (2026-07-26 finding).

**Inputs:** optional argv filter strings (substring match against filename); with no args,
checks all matching files.

**Targets:** `supabase/migrations/*.sql` (numeric-prefixed), `supabase/tests/test_*.sql`,
`supabase/rollbacks/*.sql` (dir absence is tolerated, not a failure — e.g. rollbacks may not
exist yet).

**What it checks:** parse-only — syntax validity, not semantics (missing columns, grants, etc.
stay the job of the executed-pin discipline elsewhere).

**Pass output:** `✓ sql-lint: N SQL file(s) parse clean.` **Fail:** `✗ sql-lint: N/M file(s) fail
to parse:` with one `<dir>/<file>: <first line of parser error>` per failure. Zero files matched
→ also an error (`✗ sql-lint: no SQL files found...` or "...no SQL files matched filter").

**Exit codes:** 0 = all parse; 1 = any parse failure or zero files found.

**Invoked by:** `npm run lint:sql`; `.github/workflows/ci.yml` job `sql-parse` (lines 185-203,
explicitly called out in a comment as **BLOCKING** — "a migration or pin that does not parse is
not a migration or a pin" — and included in the `summary` job's required list).

**Classification: supabase-coupled** (targets Supabase's migration/test/rollback directory
convention and uses a Postgres-specific parser), but the **technique — parse every SQL artifact
through the real target-database grammar before it's trusted as executable — is broadly
recommended** for any project authoring raw SQL migrations against any SQL dialect with an
available parser library.

---

## 9. Dev-loop and build scripts

### 9a. `scripts/dev-fresh.mjs`

**Purpose.** One-command dev-server-lifecycle ritual defending against a documented recurring
failure mode ("Ops Console couldn't load" ×5, always traced to a stale/poisoned/dying Vite
process, never to app code). Kills whatever listens on port 8080, **verifies** the port actually
came free via a real socket probe (not trust-the-kill), clears `node_modules/.vite`, then starts
Vite with `--strictPort` so a survivor process fails loudly instead of silently hopping ports.

Notable documented bug-then-fix: an earlier version used Windows-only tools
(`Get-NetTCPConnection`/`taskkill`) inside a `try/catch` that silently treated any thrown error
(including "command not found" on macOS/Linux) as "port already free," which caused it to delete
the Vite cache **under a live server** — exactly the corruption it exists to prevent. Fixed by
moving to a real cross-platform socket probe/kill/verify in `scripts/lib/port-guard.mjs`
(referenced but not separately read in this pass — see "could not verify").

**Exit codes:** 1 if the port doesn't free up, if Vite isn't installed, or if the child process
exits with a signal (treats a signal-kill as failure rather than silently reporting exit 0, which
it flags was itself a prior bug: an OOM-killed dev server used to report success).

**Invoked by:** `npm run dev:fresh`.

**Classification: frontend-generic.** Kill-verify-clear-restart dev-server ritual is applicable
to any Vite (or similar dev-server) project experiencing stale-process pain. Zero Supabase
coupling; the only wedding-specific detail is the hardcoded port 8080 and the incident anecdotes
in comments.

### 9b. `scripts/generate-demos.js`

**Purpose.** Post-build step that reads the already-built `dist/index.html` (so script hashes are
correct) and generates static per-route preview pages with per-route Open Graph / Twitter meta
tags (title, description, image, canonical URL), for both fixed demo routes (`demo/malay`,
`demo/indian`, etc.) and runtime customer share-URLs (`w/pavis-and-selvams`).

**Notable design point (documented as a fixed real bug):** meta tags are located and swapped by
their `property`/`name` attribute via a non-global per-tag regex, not by matching the old literal
copy string — because matching copy silently no-ops the moment the copy changes elsewhere, which
is exactly what happened in production (every route, including a real paying customer's page,
served the generic showroom OG card on every platform for some period). A `missing` array
collects any tag whose regex found no match, and the script **exits 1** rather than shipping
silently-wrong share cards.

**Exit codes:** 1 if `dist/index.html` is missing, if any expected `<meta>` tag pattern isn't
found, or on any thrown error.

**Invoked by:** `npm run build` (`"build": "vite build && node scripts/generate-demos.js"`).

**Classification: wedding-specific.** The demo route list and OG-copy strings are entirely
project content. **The technique — assert-on-missing-match instead of silent regex no-op for
build-time content injection — is worth porting as a coding pattern**, but the script itself is
not reusable.

### 9c. `scripts/optimize-assets.mjs`

**Purpose.** CLI asset pipeline: converts a couple's raw media (`public/images/couples/<slug>/
raw/*.{gif,png,jpg,jpeg,webp}`) into optimized WebP siblings — animated GIF → animated WebP
(quality 90, effort 4 for speed on long animations), stills → lossless WebP (pixel-art default)
or lossy quality-80 WebP with `--photos`. Falls back to keeping the original file if WebP came out
larger. Rejects filenames containing `?#%` or whitespace (URL-hostile). Flags any output file
over 1MB.

**Invoked by:** `npm run assets:optimize -- <couple-slug> [--photos] [--only=<substring>]`
(manual, not part of any hook/CI).

**Classification: wedding-specific** (the `public/images/couples/<slug>/` convention and its
`raw/` sibling-output layout are this repo's domain model), though the WebP-conversion technique
using `sharp` is generic image-tooling; not something a guardrails/checks port needs to carry.

---

## 10. `scripts/hygiene-check.mjs` and `hygiene.md`

### 10a. `scripts/hygiene-check.mjs`

**Purpose.** A single deterministic advisory nudge: "have you committed a bunch since the
project-state spine (`docs/ai/state/hot-state.md`) was last touched?" Never blocks; only
suggests running the `/wrap-session` skill.

**Mechanism:** `git log -1 --format=%H -- <hot-state-path>` to find the last commit touching that
file; `git rev-list --count <that-commit>..HEAD` to count commits since. Threshold = 3 commits.

**Pass output:** `hygiene-check: <path> is fresh (N commit(s) since last update).` **"Fail"
(still exit 0):** `🟡 hygiene-check: N commits since <path> was last updated. ... Run the
/wrap-session skill...`. Always `process.exit(0)` — explicitly advisory, never a gate.

**Invoked by:** `guardrails.config.mjs` `hygiene` check (toggleable via `guard.mjs`).

**Classification: frontend-generic mechanism** (a "docs are stale relative to commit velocity"
nudge is applicable to any repo with a living state file), but it is **hardcoded to this repo's
specific doc path and threshold** — trivially portable by changing one constant.

### 10b. `hygiene.md`

**This is not a "hygiene rules" document** despite the name — it is the **doc/state router**: an
index of ~15 canonical living documents under `docs/ai/state/` (hard-rules, entity-relationships,
failure-modes, tooling, hot-state, workstreams, decisions, state-backlog, project-log,
findings-log, test-failure-ledger, fitness-ledger, retrofit-review-log, hydration-ladder) plus a
large "phrase → action routing" table mapping natural-language triggers ("park this", "what are
the rules", "log the session") to which file to update/read and in what order. It also documents
an external Obsidian-vault onboarding mirror with a per-machine path gotcha.

It states no executable "rules" of its own (that's `docs/ai/state/hard-rules.md`, not read in
this pass — out of scope per the task's docs-folder-conventions non-goal). **Classification:
wedding-project-specific content, but the router pattern itself (one index file mapping trigger
phrases to canonical docs, read-order, and update discipline) is a documentation-architecture
technique other agents may already be covering for trainos's own docs conventions — flagging,
not analyzing further, per the stated non-goal.**

---

## 11. `fallow` — audit / health / dead-code / dupes

**What it is.** A third-party npm-installed Rust-native CLI (`fallow`, v2.92.1, platform binary
via `@fallow-cli/darwin-arm64` etc.), described in its own `package.json` as "Deterministic
codebase intelligence for TypeScript and JavaScript. Quality, risk, architecture, dependencies,
duplication, and safe cleanup evidence for humans, CI, and agents." It is **not** authored in this
repo — it is a dependency, invoked via its CLI.

**How showroom configures it:** `.fallowrc.json` at repo root —
```json
{
  "ignorePatterns": [
    "Wishes2Vows Design System/**",
    "docs/**",
    "art/**",
    "skills/**",
    "scripts/codex-gate.mjs",
    "scripts/hygiene-check.mjs",
    "scripts/safe-command-guard.mjs"
  ]
}
```
The three script exclusions are notable: Fallow's dead-code/duplication analysis would otherwise
flag guardrail infrastructure scripts as unused/dead, since they're invoked only via hooks/CI, not
imported by application code.

**How showroom invokes it, four ways (all via `npm run fallow:*` wrappers in `package.json`):**
- `fallow:audit` = `fallow audit --changed-since origin/main` — the diff-scoped audit. Used by
  (a) `guardrails.config.mjs`'s `fallow` check (full advisory sweep, via `guard.mjs`) and (b)
  `codex-gate.mjs`'s "third review lens" (`runFallowLens`, `scripts/codex-gate.mjs:158-200`) which
  runs it synchronously (60s timeout) scoped to the actual diff base, treats any non-empty
  stdout/stderr as usable output even on non-zero exit (a "warn"/"fail" verdict still prints a
  real report), condenses to signal lines (`Audit scope:` + verdict markers `✗●■`), writes the
  full report to `docs/discovery/2026-06-11-codex-seam-gate-<fingerprint>-fallow.md`, and is
  **strictly fail-open** — any Fallow error/absence must never block the un-toggleable Codex
  launch it accompanies.
- `fallow:health` = `fallow health` (not seen wired into guard/CI/lefthook in the files read —
  appears to be a manual command).
- `fallow:dead` = `fallow dead-code` (same — not seen wired elsewhere).
- `fallow:dupes` = `fallow dupes` (same — not seen wired elsewhere).

**Classification: frontend-generic.** Fallow itself is a general-purpose TS/JS tool with no
Supabase or wedding coupling; only the `.fallowrc.json` ignore list and the specific invocation
points are project-specific and trivially adapted.

---

## 12. `loadtests/` — k6 runtime fitness functions (structure only, per scope)

**What it is.** The "behavioral sibling" of the static guards — proves a Postgres rate limiter
engages under real concurrency through the full PostgREST stack, and that public RPCs meet
latency SLOs. Framed as complementary to `check:rpc`/`check:grants`/`bundle:check`, which are all
static.

**The one design fact that shapes everything (from `loadtests/README.md`):** the app's RPCs
always return HTTP 200; the pass/fail verdict lives inside the JSON envelope
(`{success:false, error:{code:"RATE_LIMITED"}}`). So k6's built-in `http_req_failed`/status checks
are meaningless here — every real assertion is a **custom metric parsed from the response body**,
and only k6 **thresholds** gate the run (k6 exits 99 on a failed threshold); `check()` calls are
diagnostic only.

**Directory layout** (from `loadtests/README.md` + `find`):
```
lib/        config (env + fail-fast), client (RPC wrapper), metrics (the correctness
            contract), checks (diagnostics), summary (verdict box + JSON), cleanup (purge)
scenarios/  flow logic only (submit_wish.js, get_wishes.js)
tests/      smoke.js | rate-limit-probe.js | latency-slo.js  (load shape + thresholds)
config/     workloads.js (arrival profiles) + environments.js (QA-target allowlist)
results/    gitignored machine-readable summaries
verify.mjs  independent post-run auditor
```

**Run commands:** `npm run loadtest:smoke` (1 VU, 3 iters), `loadtest:probe` (~90 submits @ 6/s
vs a 30/60s cap — the rate-limiter gate), `loadtest:slo` (sustained reads, warn-first latency),
`loadtest:verify` (the auditor, see below).

**`loadtests/verify.mjs`** — an independent auditor, deliberately **not** k6 and **not** the
purge RPC itself (actor and auditor are different mechanisms so a bug in one can't hide a leak in
the other). Paginates the public `get_wishes` RPC via anon-key REST calls, counts any row whose
`author_name` starts with `k6-loadtest`, and exits 1 if any remain (leftover test data on a
shared prod-adjacent project).

**Safety contract (README, verbatim substance):** writes go only to a hardcoded QA-wedding
allowlist (`config/environments.js`); every written row is marked `k6-loadtest*` for precise
cleanup; anon key only (never a service-role/secret key — the suite is documented to "refuse keys
that look privileged"); bounded rates and short windows; explicitly **no stress/breakpoint/soak**
against the shared project. Three-layer cleanup: purge-before in `setup()`, purge-after in
`teardown()` via a dedicated allowlisted+marker-gated RPC, and the independent `verify.mjs`
auditor.

**Classification: supabase-coupled at the RPC-call layer** (the client wraps Supabase RPC calls
and reads `success`/`error.code` envelope shape), but **the k6 architecture itself is
frontend/backend-agnostic and well worth adopting wholesale**: separating scenario logic from
load-shape/threshold definitions, parsing correctness out of the response body rather than trusting
HTTP status when an API always returns 200, and an independent (non-actor) post-run auditor as a
third cleanup layer distinct from the purge mechanism it's auditing. Recommended for trainos:
port the *structure and safety-contract discipline* verbatim once there's an equivalent
rate-limited or load-sensitive RPC surface to test; the `lib/client.js` RPC wrapper needs
rewriting for whatever backend TrainOS uses.

---

## 13. Claude Code hooks that act as guardrails

**Only one hooks file exists at the project root:** `/Users/khumeren/Repos/personal-work/showroom/.claude/settings.json`:
```json
{
  "enabledPlugins": { "firecrawl@claude-plugins-official": true },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "node scripts/safe-command-guard.mjs", "timeout": 10 }
      ]}
    ],
    "Stop": [
      { "hooks": [
        { "type": "command", "command": "node scripts/codex-gate.mjs", "timeout": 120 }
      ]}
    ]
  }
}
```
(`.claude/settings.local.json` was not read in this pass — typically machine-local permissions,
out of scope per the non-goals; numerous `.claude/worktrees/*/.claude/settings*.json` copies exist
but are per-worktree duplicates of the same mechanism, not distinct guardrails.)

### 13a. `scripts/safe-command-guard.mjs` — PreToolUse(Bash) hook

**Purpose.** A **Tier-1, always-on safety guard** (explicitly distinguished from the *quality*
guardrail layer — this one is never silenced by `.guardrails-off`) that blocks a small, precise
set of catastrophic shell commands before they execute. Fires on every single Bash tool call.

**Design bias, stated explicitly:** false positives are worse than misses — a bad match blocks
legitimate work and trains the operator to distrust the guard, so rules are narrow, and anything
unmatched is silently allowed. Pure Node, zero dependencies; any malformed input, non-Bash tool
call, or unreadable stdin fails open (allow).

**Protocol.** Reads a JSON object off stdin: `{ tool_name, tool_input: { command } }`. On a match,
emits **both** documented blocking channels for maximum harness compatibility: structured JSON on
stdout (`hookSpecificOutput.permissionDecision: "deny"` + a human-readable reason) **and** a
non-zero exit (2) with the reason on stderr. On no match: exit 0, no output (defers to normal
permission flow — silence is not auto-approval).

**Every rule, with its trigger and stated reason:**

| Rule | Trigger | Notes |
|---|---|---|
| `rm -rf` on a dangerous target | `rm` with both a recursive flag and a force flag (any order: `-rf`,`-fr`,`--recursive --force`, etc.) whose non-flag operand is `/`, `~`, `.`/`..`, a bare glob (`*`), a bare drive root (`C:\`), `$HOME`/`%USERPROFILE%`, or a one-level absolute system path (`/etc`, `/usr`) | Narrow paths like `rm -rf node_modules/.vite` or `dist` are explicitly allowed — "this repo's normal hygiene commands." No discernible target at all is treated as unsafe (blocked). |
| `git push --force`/`-f` | any force-push variant | `--force-with-lease` is explicitly exempted (safe — aborts if remote moved). Comment notes this repo's `origin` remote dual-pushes to two remotes at once, raising the blast radius. |
| `git worktree remove --force`/`-f` | | Banned outright — cites a real 2026-06-03 incident where this command deleted a Windows worktree's `.git` plus 265 working files. |
| `curl`/`wget`/`iwr`/`Invoke-WebRequest` piped into a shell | pipe target is `bash/sh/zsh/ksh/dash/fish/pwsh/powershell/cmd`, or piped into anything invoked with `-c` | Classic curl-pipe-bash remote-code-execution pattern. |
| Reading a `.env*` file via `cat/type/Get-Content/bat/less/more/head/tail` | any `.env` or `.env.<suffix>` **except** `.env.example`/`.env.<suffix>.example`/`.sample`/`.template` | Prevents secrets from being printed into the transcript; explicitly carves out the safe reference file. |
| Echoing a secret-shaped env var | `echo`/`printenv`/`printf`/`Write-Output`/`Write-Host`/bare `set`/`env`, combined with a var name matching `service_role`, `stripe_secret`, `sk_live`/`sk_test`, `private_key`, `access_token`, `auth_token`, `password`, `client_secret`, etc. | A negative lookbehind explicitly exempts any `VITE_`-prefixed name, since those are public-by-design (shipped in the client bundle). |
| `chmod -R 777` | recursive + literal `777` | World-writable + recursive foot-gun. |
| `git reset --hard` | | This repo's norm is `git stash` (recoverable) instead. |

**Invoked by:** `.claude/settings.json`'s `PreToolUse` hook on the `Bash` matcher, 10-second
timeout.

**Classification: frontend-generic** (nearly every rule — dangerous rm, force-push, curl-pipe-
bash, secret-printing, chmod 777, reset --hard — is universal shell-safety hygiene with zero
project coupling). Two rules carry light project-specific detail that's easy to strip: the
`git worktree remove --force` ban cites a showroom-specific incident but the underlying command is
dangerous in any repo using worktrees; the dual-remote note in the force-push reason is
showroom-specific commentary, not logic. **Strongly recommended to port near-verbatim** — this is
exactly the kind of Tier-1 safety net that has no reason to differ project-to-project.

### 13b. `scripts/codex-gate.mjs` — Stop hook + Lefthook pre-push `seam-review`

**Purpose.** A diff-gated, fingerprint-deduped, **non-blocking** trigger for a Codex adversarial
code review, designed to make "should a deep review run" a pure function of the diff rather than
relying on an LLM's judgment to remember to ask for one (stated as unreliable — "it gets
skipped").

**Mechanism:**
1. Resolve a diff base by trying `--base=<ref>` (default `origin/main`), then `origin/HEAD`,
   `main`, `HEAD~1` in order, falling back to `null` (working-tree-vs-HEAD) if none resolve.
2. Compute changed files = union of (`git diff <base>` or `git diff HEAD`) and `git diff --cached`.
3. Match against `SEAM_GLOBS` from `guardrails.config.mjs` via a hand-rolled glob→regex
   translator (`**/` = any depth, `**` = anything, `*` = one path segment, `?` = one char); test
   and spec files are explicitly excluded from ever counting as a seam touch even if their path
   matches (a config *test* changing isn't a contract change).
4. If zero seam files touched → silent exit 0.
5. Otherwise, fingerprint = SHA-256 of `(sorted seam file list + diff body)`, truncated to 16 hex
   chars. If a ledger file already exists for that exact fingerprint under `.codex-reviews/` →
   skip (dedup — the *same* diff never re-launches).
6. **Third review lens** runs here regardless of dedup-adjacent gates (see §11 above) — a
   synchronous, fail-open `fallow audit --changed-since <base>` scoped to the diff.
7. `--dry-run` stops here (detect + dedup + Fallow lens preview, no launch) — used for smoke
   tests.
8. Daily cap check: if `CODEX_DAILY_CAP` (8) launches already recorded today (UTC, scanned from
   ledger file timestamps) → skip, record a `daily-cap` ledger entry, exit 0.
9. Resolves the newest installed `codex-companion.mjs` runner from
   `~/.claude/plugins/cache/openai-codex/codex/<version>/scripts/codex-companion.mjs`
   (version-agnostic, picks the highest semver-ish directory name). If none found → prints a
   manual fallback `codex exec` command, records a `no-runner` ledger entry, exit 0.
10. Spawns the Codex review **detached and unref'd** (`spawn(..., { detached: true, stdio:
    "ignore" }); child.unref()`) so the hook returns immediately — the review runs fully in the
    background and never holds the push/commit.
11. Records the ledger entry (`{fingerprint, seamFiles, launched, runner, at}`) regardless of
    outcome — best-effort, wrapped so a ledger-write failure can't break the gate.

**The review prompt itself** (`buildPrompt`) instructs Codex to check five specific regression
classes for this repo: RPC envelope/shape drift, migration correctness (grants, search_path,
idempotency), identity-resolution over-counting on reconciliation/ingest, "spine integrity"
(specific RPC names), and reload/edit/session-restore paths — all wedding/Supabase-specific
content, defaulting to "REWORK if uncertain" because it guards live customer weddings.

**Pass/no-action output:** `codex-gate: no critical-seam files changed — no review needed.` or a
dedup/no-runner/cap message. **On launch:** prints the seam file list, the Fallow rot-lens
summary, and `codex-gate: Codex adversarial review launched in background... non-blocking — your
push/commit is NOT held.` **Exit code is always 0** — this script is designed to never fail the
hook or the push under any code path (errors are swallowed with comments explicitly stating "must
never crash the gate").

**Invoked by:** `.claude/settings.json` `Stop` hook (120s timeout — runs at the end of every
Claude Code turn) **and** `lefthook.yml:47-54` pre-push `seam-review` command, `tags: baseline`
(un-toggleable — deliberately *not* routed through `guard.mjs`, so pausing the noisy advisory
layer via `.guardrails-off` can never silence this reviewer).

**Classification: mechanism is frontend-generic, content is wedding/supabase-specific.** The
diff-gate → fingerprint-dedup → daily-cap → background-launch architecture for triggering an
expensive/paid review only on contract-risk diffs is fully portable to any project with (a) a
definable set of "critical seam" glob patterns and (b) a Codex/agent runner capable of a
detached background launch. The `SEAM_GLOBS` contents and the review prompt's five numbered
regression classes are 100% this repo's domain and must be rewritten for TrainOS's own
contract-fragile surfaces.

---

## Dependency order for porting

1. **`scripts/safe-command-guard.mjs`** (as-is, near-verbatim) + wire it into the target repo's
   `.claude/settings.json` `PreToolUse(Bash)` hook. No dependencies on anything else here; this is
   pure safety and should exist from day one.
2. **`scripts/guardrails.config.mjs`** shape (sentinel constant, empty/starter `CHECKS` registry,
   empty/starter `SEAM_GLOBS`) + **`scripts/guard.mjs`** verbatim mechanism. This is the
   chokepoint everything else below plugs into — build it before adding any individual check.
3. **`.semgrep/rules.yml`** rules 1/3/4 (dangerous-HTML, unsafe-cast, console.log) — no
   dependency on Supabase or the feature-folder convention; wire into a CI job mirroring
   `sast-semgrep`.
4. **`.dependency-cruiser.cjs`** (all three rules) — requires TrainOS to already have (or adopt)
   a `src/features/<name>/index.ts` barrel + `src/shared/**` folder convention; do this port only
   after that convention exists, otherwise the rules have nothing to enforce.
5. **`scripts/bundle-budget-check.mjs`** — requires Vite (confirm TrainOS's bundler) and an empty
   starter `.bundle-size-baseline.json`; register as the `bundle` entry in the `CHECKS` registry
   from step 2.
6. **`scripts/hygiene-check.mjs`** — trivial, needs only a target "living state doc" path;
   register as the `hygiene` entry.
7. **`fallow`** — add as an npm dependency, write a starter `.fallowrc.json` (ignore the
   guardrail scripts themselves the same way showroom does), wire `fallow:audit` as the `fallow`
   entry in `CHECKS`.
8. **`scripts/compositor-budget-check.mjs`** pattern (not the wedding-specific scan
   roots/regex) — only if TrainOS has an equivalent perf-sensitive CSS-property risk to ratchet;
   otherwise skip.
9. **`tools/sql-lint.mjs`** pattern + **RPC/grants/applied/edge-deploy** family (§7) — only once
   Supabase (or an equivalent backend with migrations/RPCs/out-of-band deploys) exists in TrainOS.
   Port `check-applied.mjs`'s and `check-edge-deploy.mjs`'s *concept* (committed-snapshot parity
   for anything that deploys out of band) even if the concrete implementation must be rewritten.
10. **`scripts/codex-gate.mjs`** — build last, once step 2's `SEAM_GLOBS` has real entries worth
    protecting and TrainOS has (or plans to have) a Codex/agent background-review runner
    available; write TrainOS's own five-or-so regression classes into the review prompt instead
    of copying the wedding ones.
11. **`loadtests/` (k6)** — only once there's a rate-limited or latency-sensitive RPC/API surface
    worth load-testing; port the architecture (scenario/tests/config/lib separation,
    body-parsed-metric verdicts, independent post-run auditor) rather than the k6 scripts
    themselves.
12. **`scripts/dev-fresh.mjs`** — independent of everything else; port opportunistically whenever
    TrainOS's dev team reports the same stale-dev-server pain (kill-verify-clear-restart pattern).

## Recommended for trainos

- `safe-command-guard.mjs` verbatim — zero cost, zero coupling, immediate safety value.
- The `guard.mjs` / `guardrails.config.mjs` toggle architecture — cheap to stand up empty and
  extend incrementally; the "phase tolerance" (`requires: {file|npmScript}`) design means it
  never breaks a hook while the stack is partially built.
- `dependency-cruiser` with the three-rule shape (circular / cross-feature-barrel /
  shared-no-features), once (and only once) the feature-folder convention exists — this is
  cheap, high-signal architecture enforcement with no runtime cost.
- Semgrep rules 1/3/4 (XSS ban, unsafe double-cast, console.log) as immediate, stack-agnostic
  wins; treat rules 2/5 as templates to rewrite against TrainOS's actual data-access layer;
  treat rules 6/7 as *technique* references (name-heuristic structural-typing-trap detection,
  theme-token misuse detection) rather than literal rules to copy.
- The bundle-budget-check pattern (gzip-per-chunk ratchet baseline with dev-server-collision
  avoidance) if TrainOS ships a bundled frontend via Vite.
- The **applied-vs-authored / deploy-parity** pattern in general (§7c/7d) as a design principle
  worth adopting the moment TrainOS has anything that deploys out of band from `git push` —
  independent of whether it ends up being Supabase-flavored.
- The Codex seam-gate's **architecture** (diff → seam-glob match → fingerprint dedup → daily cap
  → detached background launch, never blocking) as a template for any expensive/paid automated
  review TrainOS wants gated by risk rather than by turn count.
- The k6 loadtest suite's **safety-contract discipline** (hardcoded QA-only write allowlist,
  universally-marked test rows, independent non-actor auditor, explicit no-stress-testing-shared-
  infra rule) as a checklist for any future load/perf testing against shared or prod-adjacent
  infrastructure.

## What I could NOT verify

- **`scripts/lib/port-guard.mjs`** — referenced by `dev-fresh.mjs` as the cross-platform
  probe/kill/verify implementation, and its pin test `src/test/scripts/devFreshPortGuard.test.ts`
  — neither file was opened in this pass (out of the explicitly-named script list); the
  correctness of the actual socket-probe logic is taken on the header comment's word only.
- **`check-applied.mjs`'s actual wiring into lefthook/CI** — I did not find `check:applied` or
  `check:applied:record` referenced in `lefthook.yml` or `.github/workflows/ci.yml`. It appears to
  be a manually-invoked gate (likely part of the `migration-retrofit-qa` skill's flow per
  `hygiene.md`'s routing table), but I could not confirm that skill actually shells out to it —
  the skill file itself (`/.claude/skills/migration-retrofit-qa/SKILL.md`) was not read in this
  pass.
- **`fallow:health` / `fallow:dead` / `fallow:dupes`** — these three npm scripts exist in
  `package.json` but I found no reference to them in `guard.mjs`'s `CHECKS` registry, `lefthook.yml`,
  or `ci.yml`. They appear to be ad hoc manual commands, not part of the automated guardrail
  chain — could not confirm whether any other doc/skill invokes them on a schedule.
  - "fallow (audit/health/dead-code/dupes) — what it is, how configured" per the task's own
    phrasing is answered above for `audit` (well-documented, two call sites) and for
    configuration (`.fallowrc.json`); `health`/`dead-code`/`dupes` are confirmed to exist as
    commands but their intended usage cadence is not established in the files read.
- **`.claude/settings.local.json`** at the showroom root was not opened (machine-local
  permissions file, judged out of scope per the "hooks under `.claude/` that act as guardrails"
  instruction, since `PreToolUse`/`Stop` hooks live in `settings.json` per this repo's own
  `SEAM_GLOBS` comment at `guardrails.config.mjs:59-60` — "there is no `.claude/hooks/` dir — the
  hooks live in settings.json"). If it contains additional hooks beyond permissions, they are not
  captured here.
- **`docs/superpowers/specs/2026-06-11-self-healing-guardrail-stack-design.md`** — cited
  repeatedly by nearly every script in this inventory as "the design spec," but reading it was
  out of scope (docs-folder conventions belong to other agents per the task's non-goals). Some
  design rationale above is therefore reconstructed from in-script comments only, not the spec
  itself.
- **`docs/ai/state/hard-rules.md`**, **`docs/ai/state/tooling.md`**, **`docs/ai/state/
  fitness-ledger.md`** — `hygiene.md` points to these as the canonical "what am I never allowed to
  do" / "what runs when" / "is this already pinned" documents, which likely contain additional
  guardrail cross-references (e.g. the fitness-ledger's claimed "57 invariants"). Not read, per
  the docs-folder-conventions non-goal — flagging that the guardrail picture in this doc may be
  incomplete relative to what `fitness-ledger.md` alone documents.
