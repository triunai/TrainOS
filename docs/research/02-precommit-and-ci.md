# Pre-commit, commit-convention, and CI/CD patterns — showroom & vern-vault

Source repos (read-only, inspected 2026-09-12):
- `/Users/khumeren/Repos/personal-work/showroom` — mature reference (product: a wedding-invitation SPA, "wishes2vows"; repo/package name is a leftover Lovable scaffold name `vite_react_shadcn_ts`)
- `/Users/khumeren/Repos/personal-work/vern-vault` — younger sibling repo (product: a luxury-vehicle marketplace SPA, "Vern"/"Revura"; same scaffold name)

Headline finding: **the two repos are not at the same maturity level for this domain.** showroom has a full lefthook + commitlint + lint-staged + prettier + 13-job CI pipeline. vern-vault has almost none of it — no lefthook, no commitlint, no prettier config, and its `.github/workflows/ci.yml` is a literally empty placeholder file, despite an Obsidian case-study describing a working CI pipeline for it. Treat showroom as the pattern to copy and vern-vault mostly as a "what NOT to leave unfinished" cautionary example, except for one piece it does have polished: the PR auto-sync-from-hot-state automation.

---

## 1. lefthook.yml (showroom only — vern-vault has none)

`showroom/lefthook.yml` in full (61 lines):

```yaml
# lefthook.yml — git hook orchestrator for the self-healing guardrail stack.
# Migrated off husky 2026-06-11. Spec:
#   docs/superpowers/specs/2026-06-11-self-healing-guardrail-stack-design.md
#
# TWO CLASSES OF COMMAND:
#   - tag `baseline`  — proven, always-on guards (byte-equivalent to the old husky
#     setup). NOT silenced by the guardrails toggle.
#   - tag `guardrail` — the NEW advisory layer (Fallow + dependency-cruiser +
#     Codex seam-gate). Routed through scripts/guard.mjs, which (a) no-ops when the
#     `.guardrails-off` sentinel is present and (b) makes every check advisory
#     (exits 0 so it can never fail the hook — Lefthook has NO `continue_on_error`
#     flag, so the wrapper exiting 0 is the ONLY way to make a command non-blocking).
#
# TWO WAYS TO PAUSE THE GUARDRAILS:
#   - global, persistent:     npm run guardrails:off                 (sentinel file)
#   - one-shot, per-invoke:   LEFTHOOK_EXCLUDE=guardrail git push    (tag exclude)
#
# NOTE: lefthook does NOT auto-`git add` fixed files (unlike lint-staged). We
# delegate staged-file handling to `lint-staged` itself, so this is a non-issue.

pre-commit:
  commands:
    lint-staged:
      tags: baseline
      run: npx lint-staged

commit-msg:
  commands:
    commitlint:
      tags: baseline
      # {1} = the commit-message file path git passes to the commit-msg hook.
      run: npx --no -- commitlint --edit {1}

pre-push:
  parallel: true
  commands:
    check-rpc:
      tags: baseline
      # RPC contract drift guard — blocks the push on failure (unchanged behavior).
      run: npm run check:rpc
    check-grants:
      tags: baseline
      # Grant-hygiene guard (SEC-3): no SECURITY DEFINER / anon-grant in tests, no
      # new anon/PUBLIC grant to a non-allowlisted fn in migrations > 065, allowlist
      # in sync across script/migration/pin. Baseline = un-toggleable, blocks push.
      run: npm run check:grants
    seam-review:
      tags: baseline
      # Codex adversarial seam review. UN-TOGGLEABLE on purpose (self-healing v2,
      # D-015): invoked DIRECTLY (not via guard.mjs), so `guardrails:off` /
      # `LEFTHOOK_EXCLUDE=guardrail` silences the NOISY advisory layer but NEVER
      # the seam reviewer — exactly how check:rpc above bypasses the toggle.
      # Non-blocking (launch-and-warn; codex-gate always exits 0).
      run: node scripts/codex-gate.mjs
    guardrails:
      tags: guardrail
      # The NOISY advisory layer: Fallow + dependency-cruiser + hygiene-check.
      # (codex-gate MOVED OUT to `seam-review` above so the toggle can't silence
      # it.) Toggle-aware via guard.mjs (always exits 0). Pause with
      # `npm run guardrails:off` or `LEFTHOOK_EXCLUDE=guardrail`.
      run: node scripts/guard.mjs all
```
(`showroom/lefthook.yml:1-61`)

**What runs where:**

| Git stage | Command(s) | Tag | Blocking? |
|---|---|---|---|
| `pre-commit` | `npx lint-staged` | `baseline` | yes |
| `commit-msg` | `npx --no -- commitlint --edit {1}` | `baseline` | yes |
| `pre-push` | `npm run check:rpc`, `npm run check:grants`, `node scripts/codex-gate.mjs` | `baseline` | first two: yes; codex-gate: exits 0 always (advisory by design, but un-silenceable — it still *runs*) |
| `pre-push` | `node scripts/guard.mjs all` | `guardrail` | no (advisory layer, always exits 0) |

**The tag mechanism is the core idea worth reproducing:** two classes of hook command —
- `baseline` commands are byte-equivalent to what a plain husky setup would run and are never silenced.
- `guardrail` commands are a newer, noisier advisory layer that can be paused two ways: a persistent sentinel file (`npm run guardrails:off`, checked by `scripts/guard.mjs`) or a one-shot env var (`LEFTHOOK_EXCLUDE=guardrail git push`).
- The `seam-review` (Codex) command is a third, deliberate category: tagged `baseline` (so the toggle can't touch it) but internally implemented to always exit 0 (so it never blocks a push even though it can't be silenced) — "launch-and-warn." This is a "you can turn off the noise but not the review" pattern, motivated by an internal decision record (D-015, "self-healing v2") reasoning that an agent operating the toggle itself can't be the sole control — see `docs/superpowers/specs/2026-06-11-self-healing-guardrail-stack-design.md` (exists, not read in depth — guardrail script internals are out of scope for this doc per the research brief).
- Lefthook has no `continue_on_error` flag — the *only* way to make a lefthook command non-blocking is for the wrapped script to itself exit 0. That's why `guard.mjs` and `codex-gate.mjs` are designed to always succeed at the shell level even when they detect and report problems.

**Migration note:** the file's own header says lefthook replaced husky on 2026-06-11, "byte-equivalent" for the baseline tier. No `.husky/` directory exists in showroom today (confirmed absent) — the migration is clean, no orphaned husky files. I could not find a CHANGELOG or AGENTS.md entry documenting that migration (searched both, no hits) — the only record is the comment block at the top of `lefthook.yml` itself.

**wired via `prepare`:** `showroom/package.json:50` — `"prepare": "lefthook install"`. This is the standard npm lifecycle hook: `lefthook install` runs automatically on every `npm install` (including CI's `npm ci`, though CI never actually exercises git hooks — it calls the underlying npm scripts directly instead, see §4). No manual `lefthook install` step is documented anywhere; it's fully automatic for anyone who clones and runs `npm install`.

vern-vault has no `lefthook.yml`, no `.husky/`, no `prepare` script, and no `lefthook` entry anywhere in `package.json` (confirmed by full-file read of `vern-vault/package.json`, all 101 lines — 15 dependencies, 24 devDependencies, none of them lefthook/husky/commitlint/lint-staged/prettier). There is **no git-hook layer of any kind** in vern-vault today.

---

## 2. commitlint.config.cjs (showroom only)

`showroom/commitlint.config.cjs` in full (73 lines):

```js
/**
 * commitlint configuration — Conventional Commits + project-specific scopes.
 *
 * .cjs because package.json is `"type": "module"` and commitlint loads its
 * config via CommonJS require() (commitlint v19).
 *
 * Wired via .husky/commit-msg.
 *
 * NOTE: scope-enum is currently SET BUT NOT ENFORCED (severity 1 = warn).
 * Flip to severity 2 once the list below is validated against your domain
 * naming. See docs/ci-cd-plan.md (or this file's history) for the rollout.
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", "fix", "docs", "style", "refactor", "perf",
        "test", "build", "ci", "chore", "revert",
      ],
    ],
    // Inferred from git log + CLAUDE.md domains. EDIT THIS LIST.
    "scope-enum": [
      1,
      "always",
      [
        "rsvp", "wishes", "admin", "studio", "runtime", "showroom",
        "landing-v2", "theme", "rpc", "migration", "auth", "config",
        "ui", "ci", "deps", "docs", "tests", "release", "art", "lib",
        "templates", "store", "editor", "supabase", "perf", "routing",
        "state", "seating", "importer",
      ],
    ],
    "header-max-length": [2, "always", 100],
    "subject-case": [0, "never"],
    "scope-empty": [0, "never"],
  },
};
```
(`showroom/commitlint.config.cjs:1-73`)

**Contradiction found:** the file's own docblock says "Wired via `.husky/commit-msg`" (`commitlint.config.cjs:7`), but there is no `.husky/` directory in the repo — the actual wiring is `lefthook.yml`'s `commit-msg` stage (`lefthook.yml:27-32`). This is a stale comment left over from before the husky→lefthook migration (`lefthook.yml:2`, dated 2026-06-11). Also stale: the docblock points to `docs/ci-cd-plan.md` for the scope-enum rollout plan (`commitlint.config.cjs:11`) — that file does not exist anywhere in the repo (searched, no hit).

**Rule severities, precisely:**
- `type-enum`: severity **2 (error, blocking)**. Allowed types: `feat fix docs style refactor perf test build ci chore revert` — this is exactly `@commitlint/config-conventional`'s default type list re-declared explicitly (not narrowed).
- `scope-enum`: severity **1 (warn only, non-blocking)** — the docblock is explicit that this is deliberate, pending validation of the domain-specific scope list (`rsvp`, `wishes`, `seating`, `importer`, etc. — all specific to the wedding-invitation domain).
- `header-max-length`: **2 (error)**, 100 chars.
- `subject-case`: **0 (disabled)** — any case allowed in the subject.
- `scope-empty`: **0 (disabled)** — scope is optional (a commit with no `(scope)` is fine).

**Actual convention observed in `git log --oneline -20` (showroom):**
```
0a563a1d docs(reviews): pre-apply gate on migrations 120/121/124 — DO-NOT-APPLY
f8de1d68 docs(state): renumber D-108 -> D-110 before it collides with Shern's D-108
1acd814c docs(docs): couple-media-pipeline skill + the onboard-a-couple router
3abcd433 docs(reviews): record the §9 stop conditions and how they were discharged
8727b077 docs(state): record main's flaky deploy gate — deploys fail ~2 runs in 3
02c74a56 docs(state): Shern retrofit review — 5 lanes, 3 verdicts, D-109/ADR-030
baa63e1d docs(state): D-108 / ADR-029 — a shared surface may not default to a real customer
3c115b5f docs(reviews): re-measure the Shern branch table — 3 real targets, not 6
3fca7d9a docs(docs): mirror the recurring-shapes ADR norm into the committed memory
04d8d4d5 docs(state): wrap the deeva-annesha session — hot-state, board thread
2ef789dc docs(docs): fitness ledger, rolling review log, and the headless Shern contract
43bd88cb feat(wedding): opt-in dark page surface; fixes reception text legibility
c32c01c7 fix(wedding): portrait swap tracks same-slug refetch; fold 11b/11c review rounds
c39b8ea8 docs(discovery): four scoping reports from the deeva-annesha session
7ac834fa chore(supabase): seeds for the banner/FAQ fix and the reception portrait
bc1b74e0 feat(wedding): arch portrait for the reception; banner = venue only; FAQ without dashes
7ac00268 fix(supabase): SHARE-lock studio_saved_drafts across the media seed transaction
1c321dd2 fix(supabase): acknowledge the one pre-existing stale church draft in the media seed
c6cae640 fix(supabase): harden deeva-annesha media seed to a locked compare-and-set
d70fffa9 chore(supabase): seed deeva-annesha music + Guest Guide banners into config_json
```
Style: strict `type(scope): imperative, lower-case summary` — heavily dominated by `docs(state)` / `docs(reviews)` (recording decisions/reviews into a living project journal — see the "hot-state"/decision-log pattern this project already tracks elsewhere) and `fix`/`feat` scoped to product areas (`wedding`, `supabase`, `market`). Scopes used in practice are a subset of the declared `scope-enum` list plus a few not in the enum (`reviews`, `state`, `discovery`, `docs`) — consistent with severity 1 (warn, not enforced) on scope.

**Contrast — vern-vault's `git log --oneline -20`** (no commitlint at all, so this is unenforced convention only):
```
e4a3cfc fix(admin): stop stale autosaved drafts hijacking the Add Vehicle form
9574027 docs(handover): client handover pack
2cb77c0 docs(alerts): cutover runbook + reconcile infra drift
e0b0c4a feat(alerts): lenient multi-recipient parsing in send-lead-alert
47534cb chore: ignore .omc/ operational state
0bec960 fix(market): restore lead form submission — omit doorman columns when flag off
9461e39 chore: rebrand all 'Satish' -> 'Vern' across the app
e0ba917 Merge pull request #23 from triunai/feat/lead-alert-pipeline
e0ffd91 docs(audit): fold security + SEO readiness findings into audit doc
954328f fix(market): rail sizes to its own content + stays sticky (revert stretch)
b0dc032 Merge pull request #21 from triunai/feat/lead-alert-pipeline
6e71155 feat(about): 1992 workshop underlay + fix clipped numeral + match Prestige font
dc435a2 Merge remote-tracking branch 'origin/main' into feat/lead-alert-pipeline
9be23f9 Merge branch 'feat/lead-photo-doorman' into feat/lead-alert-pipeline
4e3f36d feat(market): F6 lead-photo doorman — backend draft + optional success-panel upload UI
fd71ec6 docs(state): log admin private-market backlog + F6 upload-placement note
6c2307a feat(admin): drag-to-reorder vehicle photos + fix footer overlap
0360c24 feat(admin): private-market lead search + known-gap notes
af33790 feat(market): video hero underlay, rail/form height parity, Vern rebrand
d1d291c feat(vdp): detail-page polish pass
```
Same conventional-commits *style* (type(scope): summary) is followed by discipline/habit even without tooling enforcing it, plus ordinary GitHub merge commits (which would fail `type-enum` if commitlint were wired, since `Merge pull request …` doesn't match any conventional type — worth noting if trainos adopts commitlint with PR-merge workflows: either exempt merge commits or squash-merge only).

---

## 3. lint-staged, prettier, editorconfig

**showroom** — all present:

`showroom/package.json:53-59` (`lint-staged` block):
```json
"lint-staged": {
  "*.{ts,tsx,js,jsx}": ["prettier --write"],
  "*.{json,md,yml,yaml,css,html}": ["prettier --write"]
}
```
Note: lint-staged here runs **prettier only**, not eslint — ESLint is a separate, non-git-hook CI job (`lint` / `lint-full`, see §4), not enforced at commit time. Lefthook's own header comment (`lefthook.yml:18-19`) explains why lint-staged (not lefthook) is trusted to `git add` the fixed files back — lefthook itself has no auto-restage behavior.

`showroom/.prettierrc.json` (full):
```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "arrowParens": "always",
  "bracketSpacing": true,
  "endOfLine": "lf"
}
```

`showroom/.prettierignore` (full):
```
dist
build
node_modules
coverage

package-lock.json
*.lock

.husky
.github

supabase/migrations
public

CHANGELOG.md
```
Note the `.husky` exclusion is itself a fossil of the pre-migration setup (the directory no longer exists) — harmless but another stale reference, alongside the commitlint docblock's `.husky/commit-msg` mention.

`showroom/.editorconfig` (full):
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[*.{yml,yaml}]
indent_size = 2

[*.sql]
indent_size = 4
```

**vern-vault** — none of the three exist. `find` for `.prettierrc*`, `.prettierignore`, `.editorconfig` at repo root returns nothing; `lint-staged` key in `package.json` is absent (confirmed via full-file read).

---

## 4. `.github/workflows/ci.yml` — both repos

### showroom — full pipeline (13 jobs), reproduced in full with commentary

```yaml
name: CI

# TypeScript and React hook-order checks are deployment gates in render.yaml.
# CI reports the same contracts; branch protection should require them for PRs.
# Broad lint/format/dependency debt remains advisory until its baseline is clean.

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  install:
    name: Install (cached)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - name: Upload node_modules for reuse
        # continue-on-error: uploading ~all of node_modules per run is what
        # exhausted the repo's Actions artifact quota on 2026-07-31 and turned
        # every push red with zero code defects. Quota exhaustion must degrade
        # (consumers fall back to their own npm ci), not fail the pipeline.
        # Real fix queued: swap this artifact pattern for actions/cache.
        continue-on-error: true
        uses: actions/upload-artifact@v4
        with:
          name: node_modules
          path: node_modules/
          retention-days: 1
          if-no-files-found: error

  lint:
    name: React Hook Order
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run lint:hooks

  lint-full:
    name: ESLint (full, advisory)
    needs: install
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run lint

  format:
    name: Prettier (drift check)
    needs: install
    runs-on: ubuntu-latest
    continue-on-error: true # observe-only — legacy files drift heals via lint-staged
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run format:check

  typecheck:
    name: TypeScript (loose, base config)
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run typecheck

  typecheck-strict:
    name: TypeScript (strict allowlist)
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run typecheck:strict

  build:
    name: Vite build
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - name: Build
        # VITE_ env vars are inlined into bundle at build time. They are
        # public-by-design (the publishable Supabase key ships in the JS).
        # Storing them as GH secrets is hygiene, not security.
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY }}
      - name: Report bundle sizes
        run: |
          echo "## Bundle sizes" >> $GITHUB_STEP_SUMMARY
          echo '```' >> $GITHUB_STEP_SUMMARY
          du -sh dist/assets/*.js dist/assets/*.css 2>/dev/null | sort -h >> $GITHUB_STEP_SUMMARY || true
          echo '```' >> $GITHUB_STEP_SUMMARY
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist/, retention-days: 7 }

  test:
    name: Vitest (unit)
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - name: Run tests
        run: npm test
      - name: Coverage report (advisory until first threshold lands)
        run: npm run test:coverage
        continue-on-error: true
      - name: Upload coverage report
        if: always()
        uses: actions/upload-artifact@v4
        with: { name: coverage-report, path: coverage/, retention-days: 7 }

  rpc-contract:
    name: RPC Contract Drift
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run check:rpc

  sql-parse:
    # BLOCKING. A migration or pin that does not parse is not a migration or a
    # pin — test_097 once carried psql `\set` meta-commands unparseable by
    # anything but psql, and it sat that way while the catalog recorded it as
    # executed and passing. Gates like the typechecks do, not advisory tier.
    name: SQL Parse (migrations, rollbacks, pins)
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run lint:sql

  grant-hygiene:
    name: Grant Hygiene (SEC-3)
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run check:grants

  secrets-scan:
    name: Gitleaks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"

  deps-audit:
    name: npm audit (high+)
    needs: install
    runs-on: ubuntu-latest
    continue-on-error: true # advisory — keep main green when transitive vulns appear
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm audit --audit-level=high

  sast-semgrep:
    name: Semgrep SAST
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install Semgrep
        run: pip install semgrep
      - name: Custom domain rules — ERROR severity (blocking)
        run: semgrep scan --config .semgrep/rules.yml --severity ERROR --error
      - name: Custom domain rules — WARNING/INFO (advisory)
        run: semgrep scan --config .semgrep/rules.yml --severity WARNING --severity INFO
        continue-on-error: true
      - name: Registry rulesets — OWASP / React / TS (advisory)
        run: >-
          semgrep scan
          --config p/typescript
          --config p/react
          --config p/owasp-top-ten
          --config p/javascript
        continue-on-error: true

  summary:
    name: CI Summary
    needs: [lint, lint-full, format, typecheck, typecheck-strict, build, test,
            rpc-contract, grant-hygiene, sql-parse, sast-semgrep, secrets-scan, deps-audit]
    runs-on: ubuntu-latest
    if: always()
    steps:
      - name: Aggregate
        run: |
          echo "## CI Result Matrix" >> $GITHUB_STEP_SUMMARY
          echo "| Job | Result |" >> $GITHUB_STEP_SUMMARY
          echo "|---|---|" >> $GITHUB_STEP_SUMMARY
          echo "| React hook order | ${{ needs.lint.result }} |" >> $GITHUB_STEP_SUMMARY
          # ... one row per job (13 rows total), advisory jobs annotated "(advisory)"
      - name: Fail when a blocking job failed
        # "skipped" IS A FAILURE HERE. Every blocking job `needs: install`, so
        # if install fails they are all SKIPPED, not failed — a naive check for
        # just failure/cancelled would pass green having run nothing at all.
        if: >-
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.lint.result) ||
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.typecheck.result) ||
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.typecheck-strict.result) ||
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.build.result) ||
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.test.result) ||
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.rpc-contract.result) ||
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.grant-hygiene.result) ||
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.sql-parse.result) ||
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.secrets-scan.result) ||
          contains(fromJSON('["failure","cancelled","skipped"]'), needs.sast-semgrep.result)
        run: |
          echo "::error::A blocking CI job failed or was cancelled — see the matrix above."
          exit 1
```
(`showroom/.github/workflows/ci.yml:1-326`, trimmed only in the `install` block's repeated `setup-node` boilerplate and the summary job's 13-row echo list, both collapsed above for length — nothing substantive cut)

**Job graph and gating, summarized:**

| Job | Trigger dependency | Gate class |
|---|---|---|
| `install` | none (root) | infra (all others `needs: install`, except `secrets-scan` & `sast-semgrep` which run standalone) |
| `lint` (React hook order) | install | **blocking** |
| `lint-full` (full ESLint) | install | advisory (`continue-on-error: true`) |
| `format` (Prettier check) | install | advisory |
| `typecheck` (loose) | install | **blocking** |
| `typecheck-strict` | install | **blocking** |
| `build` (Vite) | install | **blocking**, uploads `dist` artifact |
| `test` (Vitest) | install | **blocking** for the run itself; coverage sub-step is advisory |
| `rpc-contract` | install | **blocking** |
| `sql-parse` | install | **blocking** |
| `grant-hygiene` | install | **blocking** |
| `secrets-scan` (Gitleaks) | none | **blocking** |
| `deps-audit` (npm audit) | install | advisory |
| `sast-semgrep` | none | ERROR-severity step **blocking**; WARNING/INFO and registry rulesets advisory |
| `summary` | all of the above | aggregates + **hard-fails the whole workflow** if any blocking job's result is `failure`, `cancelled`, or `skipped` |

The two design lessons worth reproducing verbatim in a new repo's CI:
1. **A `continue-on-error: true` step is a lie unless something downstream re-checks it.** The `summary` job exists specifically because an earlier version of this pipeline had `if: always()` produce a green "CI Summary" purely from `echo` steps, sitting on top of a red job matrix — a status check that could never say no. The fix is a dedicated final job that reads every blocking job's `.result` and explicitly `exit 1`s.
2. **`skipped` must be treated as a failure for blocking jobs**, not ignored. Every blocking job depends on `install`; if `install` fails, GitHub marks all dependents `skipped`, not `failed` — a naive `contains(["failure","cancelled"], ...)` check would then pass a fully-broken run as green.

**Known caveat documented in the workflow itself** (`ci.yml:1-5`): branch protection is *not confirmed on* — the header comment says CI "should" gate merges, phrased as aspiration. Corroborated by extensive internal docs (`docs/discovery/2026-06-12-self-healing-v2-agentic-blindspots.md:87-97`, `docs/ai/state/decisions.md:30` as quoted in `docs/discovery/2026-06-14-importer-smoke-codex-gate.md:9367`, `docs/ai/state/workstreams.md:3059`, `docs/ai/state/project-log.md:2727`): branch protection is explicitly called out as "Step 0," user-only (not something an agent/CI config can flip), and one entry (`docs/ai/state/project-log.md:2727`) records it as blocked because the plan was on a private free-tier GitHub repo returning HTTP 403 on the branch-protection API. **This is the single most important lesson for trainos: a 13-job hard-failing CI pipeline provides zero actual custody until GitHub branch protection on `main` is turned on requiring those checks — that switch lives outside any file in the repo and must be done by a human in GitHub settings.**

### vern-vault — `ci.yml` is an empty placeholder

`vern-vault/.github/workflows/ci.yml` is **1 byte** (a single newline, confirmed via `wc -c` = 1 and `od -c` showing only `\n`) — there is no workflow definition at all. `find .github -type f` shows only this file plus `pull_request_template.md`; no other workflow files exist.

**Contradiction with documentation:** an Obsidian case-study, `Projects/Vern/Patterns Applied/CI Pipeline (Vern).md`, describes a fully working pipeline in detail — a single `build-and-test` job on `push` to `main`/`feat/**` and `pull_request` to `main`, steps `checkout → setup-node@v4 (Node 20) → npm ci → npx tsc --noEmit → npx vitest run --reporter=junit → upload test-results → npm run build → upload vern-dist artifact`, media-file exclusions to keep the artifact ~1.1 MB instead of ~40 MB, and a stated run time of "~40 s" (`CI Pipeline (Vern).md:19-26, 51-53`). **None of this exists in the actual repo.** Either the workflow was removed/reverted after the case study was written, or the case study documents a different branch/checkout that was never merged to what's on disk now. Two more specific mismatches inside that same doc:
- It describes the project as "a Vite + React **19** SPA" (`CI Pipeline (Vern).md:15`), but `vern-vault/package.json:61` pins `"react": "^18.3.1"`.
- It says `push-all.sh` pushes to a `parallel` remote (`PARALLELPARADIGMS/vern` mirror) in addition to `origin` (also stated in `scripts/push-all.sh:11-14` itself), but `git config --get-regexp '^remote\.'` in the working copy shows only `origin` → `https://github.com/triunai/vernmotors-vault.git`. The mirror remote is either not configured on this machine/checkout or was retired.

**What vern-vault does have that is real and accurate:** the "PR Auto-Sync from Hot-State" automation — see §6, which I verified line-for-line against the actual scripts and it matches the second Obsidian doc closely.

---

## 5. Other workflows, CODEOWNERS, PR templates, branch protection, dependabot/renovate

- **CODEOWNERS**: absent in both repos (searched recursively, excluding `node_modules`).
- **dependabot.yml / renovate.json**: absent in both repos.
- **Additional workflow files**: neither repo has any workflow beyond the single `ci.yml` (showroom's real, vern-vault's empty).
- **PR templates** — the two repos use genuinely different templates, each fitted to that project's own review discipline:

  **showroom** — `.github/PULL_REQUEST_TEMPLATE.md` (note the ALL-CAPS filename GitHub also recognizes), full:
  ```markdown
  # Pull Request

  ## Summary
  <!-- 1-3 bullets: what changed and why -->

  ## Test plan
  <!-- How was this verified? Commands run, paths exercised, screenshots if UI -->
  - [ ]

  ---

  ## RPC Contract Discipline (skip if PR doesn't touch SQL RPCs, `rpc.ts`, `rpc.types.ts`, or any `rpc(...)` consumer)

  > Triggered by the April 2026 `get_ticket` envelope incident.
  > Full rule: `CLAUDE.md` → "Supabase & Security Model" → "RPC Contract Discipline".
  > Postmortem: `docs/postmortems/2026-04-28-get-ticket-envelope.md`.

  If this PR changes an RPC signature, modifies a `jsonb_build_object(...)` return shape, or touches the `rpc()` / `rpcEnvelope()` wrapper, ALL SEVEN must be verified:

  - [ ] **SQL envelope shape** — `jsonb_build_object(...)` top-level keys reviewed (source of truth)
  - [ ] **Wrapper behavior** — confirmed whether `rpc.ts` auto-unwraps Shape 1, passes through Shape 1+extras, or returns raw. Adding ANY sibling key beside `data` flips the wrapper from unwrap to pass-through
  - [ ] **`RpcMap` entry** in `src/lib/rpc.types.ts` updated — both `args` and `response`
  - [ ] **Every `rpc('function_name', ...)` consumer** grepped and verified
  - [ ] **Every `as unknown as ...`** cast around the RPC verified — this pattern bypasses the compiler exactly where the ABI is most fragile
  - [ ] **Reload / edit / session-restore paths** exercised (not just first-submit happy path)
  - [ ] **Public-route error boundary** coverage verified for any new throw point — `/w/:slug` and `/demo/*` are covered by `PublicErrorBoundary`; new public routes need it too

  If unsure: run `npm run check:rpc` locally — it audits drift between SQL truth, `RpcMap`, and consumer casts. Treat any non-PASS row as a contract regression.

  ---

  ## Other checks
  - [ ] No new `as unknown as <Type>` cast added without a runtime guard
  - [ ] No `console.log` left in production paths (build uses esbuild, no stripping)
  - [ ] Dark mode verified for any new UI (project default is dark; see CLAUDE.md → "Coding Rules")
  - [ ] Mobile-first verified for any new UI (iPhone SE 320px baseline, 44px touch targets)
  ```
  This is a **static, incident-driven checklist template** — born from a real production bug (a postmortem-linked "RPC envelope" incident) and hard-coded to that domain's fragile seams. It is filled in by hand each PR.

  **vern-vault** — `.github/pull_request_template.md` (lowercase filename), full:
  ```markdown
  # <!-- 1-line PR title goes in the GitHub UI title field, not here -->

  ## Summary
  <!-- 1-3 bullets describing what this PR ships. Keep it human; the hot-state
       sync below will fill in the focus + next-task automatically. -->
  -
  -

  ## Changes
  <!-- High-level groupings — frontend / schema / docs / scripts. -->
  -

  ## Test plan
  - [ ] `npx tsc --noEmit` clean
  - [ ] `npm run build` succeeds
  - [ ] Visual smoke on `/inventory` and `/inventory/<id>` (desktop + mobile)
  - [ ] (if schema) v3 SQL applied to a test Supabase project; RLS spot-checked
  - [ ] (if a new component) hover/click states + reduced-motion respected

  ## Schema / architecture impact
  <!-- If this touches supabase/, link the migration + any new design-spec doc.
       Otherwise: N/A. -->
  -

  ---

  <!-- AUTO-SYNC:focus-start -->
  ## Hot state — Focus
  _(populated by `scripts/sync-pr-from-hot-state.sh`)_
  <!-- AUTO-SYNC:focus-end -->

  <!-- AUTO-SYNC:next-task-start -->
  ## Hot state — Next active task
  _(populated by `scripts/sync-pr-from-hot-state.sh`)_
  <!-- AUTO-SYNC:next-task-end -->

  <!-- AUTO-SYNC:blockers-start -->
  ## Blockers
  _(populated by `scripts/sync-pr-from-hot-state.sh`)_
  <!-- AUTO-SYNC:blockers-end -->

  ---

  🤖 The three sections above are auto-synced from `ai/hot-state.md` on every push. Run `bash scripts/push-all.sh` to push to both `origin` + `parallel` and update this PR body in one shot. Sections OUTSIDE the AUTO-SYNC markers (Summary, Changes, Test plan, Schema impact) are preserved across syncs.
  ```
  This is a **hybrid static/dynamic template**: human sections (Summary/Changes/Test plan/Schema impact) plus three machine-owned, marker-fenced sections that get rewritten automatically — see §6.

- **Branch protection**: neither repo has it verifiably active. showroom's own CI header calls it aspirational (§4); vern-vault's docs never mention it at all in what I read. I could not check either repo's actual GitHub branch-protection settings via API (no network/GitHub access in this task) — this doc reports only what's inferable from committed files and Obsidian notes.

---

## 6. PR Auto-Sync from Hot-State (Vern) — verified against the actual repo

Source: Obsidian note `Projects/Vern/Patterns Applied/PR Auto-Sync from Hot-State (Vern).md`. I cross-checked every claim against `vern-vault/scripts/push-all.sh` (65 lines), `vern-vault/scripts/sync-pr-from-hot-state.sh` (155 lines), `vern-vault/scripts/claude-hook-post-push.sh` (42 lines), `vern-vault/.claude/settings.local.json`, and `vern-vault/ai/hot-state.md`. **This pattern is accurately documented and does exist on disk as described** — unlike the CI-pipeline case study in §4.

**What it is:** the project's living status doc, `ai/hot-state.md`, is the single source of truth for "what's happening right now." Rather than hand-copying its Focus / Next Active Task / Blockers sections into every PR description, a script extracts those three sections and rewrites only the corresponding marker-fenced regions of the open PR's body, leaving human-authored sections (Summary, Changes, Test plan) untouched.

**How it's wired, end to end:**

1. `ai/hot-state.md` contains headings the extractor keys off exactly: `### Focus` (`ai/hot-state.md:82`), `### Next Active Task …` (`ai/hot-state.md:107`, extra trailing text after the heading is fine — the awk pattern isn't anchored with `$` for this one), `### Blockers …` (`ai/hot-state.md:158`). Renaming a heading silently breaks extraction (falls back to a placeholder) — the heading names are an implicit contract, called out as debt in the case study (`PR Auto-Sync from Hot-State (Vern).md:51`) and confirmed true by reading the extractor's exact `awk` patterns in `sync-pr-from-hot-state.sh:61-63`.

2. `scripts/sync-pr-from-hot-state.sh` (`set -euo pipefail`):
   - Extracts each section with an `awk` state machine (`extract_section`, lines 46-59) that reads from the matched `### ` heading to the next `### ` or `## ` heading or EOF, then trims leading/trailing blank lines with a `tac | awk | tac` idiom (line 58).
   - Falls back to a placeholder string per section if empty (lines 65-67).
   - Finds the open PR for the current branch via `gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number // empty'` (line 72) and **exits 0 silently** if none exists (lines 74-77) — this is what makes it safe to fire unconditionally on every push.
   - If the current PR body is empty or missing the `AUTO-SYNC:focus-start` marker, it seeds the body from `.github/pull_request_template.md` (lines 84-91) — this is what makes the *first* push after `gh pr create` produce a fully-fenced body instead of doing nothing.
   - Replaces each fenced region with a second `awk` state machine, `replace_region` (lines 97-126) — deliberately awk, not sed, because (per the script's own comment, line 95) "sed is a footgun for multi-line" replacement.
   - Maintains a single-line, idempotent timestamp footer under an `<!-- AUTO-SYNC:timestamp -->` marker, replacing in place rather than stacking a new line every run (lines 133-149).
   - Writes back with `gh pr edit "$PR_NUMBER" --body-file -` (line 154).

3. `scripts/push-all.sh` is the entry point a developer actually runs: it pushes the current branch to **both** `origin` (canonical, `triunai/vernmotors-vault`) and `parallel` (mirror, `PARALLELPARADIGMS/vern`) — mirror-push failures are non-fatal (lines 11-14, 23-24) — runs a pre-push gate (`npx tsc --noEmit && npm test`, skippable with `NO_VERIFY=1`, lines 26-36), then calls the sync script non-fatally (sync failure doesn't undo an already-successful push).
   - **Caveat found during verification**: no `parallel` remote is actually configured in this checkout (`git config --get-regexp '^remote\.'` shows only `origin`) — so today, `push-all.sh`'s second push would fail (non-fatally, by design) unless a `parallel` remote is added back. Whether that's an intentional retirement of the mirror or an environment gap, I can't tell from the repo alone.

4. The trigger is **not a git hook** — it's a Claude Code `PostToolUse` hook, wired in `vern-vault/.claude/settings.local.json:9-19` (`matcher: "Bash"` → runs `bash scripts/claude-hook-post-push.sh`). That script (`scripts/claude-hook-post-push.sh`) reads the JSON tool-call envelope Claude Code passes on stdin, extracts `.tool_input.command` via `jq` (falling back to a grep/sed one-liner if `jq` is unavailable, lines 26-29), and only invokes the sync script if the command matched `git push` or `push-all.sh` (lines 33-39). This means the auto-sync is coupled to the *agent's* tool use, not to git itself — a plain `git push` typed by a human in a terminal outside Claude Code would not trigger it. That's a meaningful adoption caveat for trainos if humans (not just agents) will be pushing.

**For trainos:** this pattern is a strong fit if trainos adopts a similar living "hot state" doc (the codebase's own `CLAUDE.md` already implies a working-principles doc; a project status doc following the same convention would pair well). The `awk`-not-`sed` region-replace technique and the seed-from-template-on-first-sync behavior are the two most reusable ideas, independent of Vern's specific three section names.

---

## 7. render.yaml deploy config and its relation to CI

**showroom** — `render.yaml`, full (101 lines, heavily commented):
```yaml
services:
  - type: web
    runtime: static
    name: wishes2vows-studio
    buildCommand: npm ci && npm run verify:deploy && npm run build
    staticPublishPath: dist
    envVars:
      - key: VITE_SITE_URL
        value: https://wishes2vows.com
    headers:
      - path: /*
        name: Content-Security-Policy
        value: frame-ancestors 'self'
      - path: /*
        name: X-Frame-Options
        value: SAMEORIGIN
      - path: /*
        name: Referrer-Policy
        value: strict-origin-when-cross-origin
      - path: /*
        name: X-Content-Type-Options
        value: nosniff
    routes:
      - type: rewrite
        source: /admin-lite/*
        destination: /index.html
      - type: rewrite
        source: /admin-lite
        destination: /index.html
      - type: rewrite
        source: /*
        destination: /index.html
```
(`showroom/render.yaml:1-101`, comment blocks explaining the CSP/clickjacking rationale trimmed above for length — see the file directly for the full narrative, it's unusually well-documented reasoning about a specific clickjacking threat model)

The load-bearing detail: **`buildCommand` runs `npm run verify:deploy` before `npm run build`**, and `verify:deploy` is defined in `package.json` as `npm run typecheck && npm run lint:hooks && npm run typecheck:strict && npm run test` — i.e., Render's own build step re-runs the same gates CI runs, so **the deploy step is a second, independent enforcement of the blocking CI checks**, not merely downstream of a CI green light. This matters given branch protection is not confirmed on (§4): even if a bad commit reached `main` past CI, Render's build would still refuse to ship it (the static site would simply fail to deploy). This is a meaningful defense-in-depth pattern given the branch-protection gap.

**vern-vault** — `render.yaml`, full (10 lines, no comments):
```yaml
services:
  - type: web
    name: revura
    runtime: static
    buildCommand: npm install && npm run build
    staticPublishPath: ./dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```
No `verify:deploy`-style gate — `npm run build` runs directly with no typecheck/test step in between. No security headers. No env vars declared. Consistent with the overall gap in vern-vault's guardrails: **the deploy step provides zero additional custody beyond a successful `npm install && vite build`.**

---

## 8. The `prepare` script and how lefthook installs

Already covered in §1, restated for completeness: `showroom/package.json:50` — `"prepare": "lefthook install"`. npm/yarn/pnpm all run the `prepare` lifecycle script automatically after `install` (and after cloning a repo with npm ≥7, on the first `npm install`), so every contributor gets hooks installed with zero manual step. `lefthook install` writes the actual `.git/hooks/*` shims that shell out to lefthook, which then reads `lefthook.yml` at run time. There's no separate `lefthook.yml`-committed hooks directory to keep in sync — the shims are regenerated fresh from `lefthook.yml` every `prepare` run, so editing `lefthook.yml` alone is sufficient; no reinstall step is needed by other contributors beyond their normal `npm install`.

vern-vault has no `prepare` script and no lefthook dependency — nothing runs automatically on `npm install` here.

---

## Recommended for trainos

**Copy verbatim (showroom's setup, it's clean and well-reasoned):**
- The `lefthook.yml` two-tier `baseline` / `guardrail` tag structure, even if trainos starts with only the `baseline` tier (lint-staged pre-commit, commitlint commit-msg) and adds a `guardrail` tier later as advisory checks accumulate.
- `.prettierrc.json`, `.prettierignore`, `.editorconfig` verbatim (generic, no project-specific assumptions baked in beyond what a fresh TypeScript/React project needs — just retarget the `.prettierignore` domain-specific excludes like `supabase/migrations` to whatever trainos' actual generated-artifact directories are).
- The `commitlint.config.cjs` skeleton: `type-enum` at severity 2 (blocking) using the stock Conventional Commits type list, `header-max-length` at 100, `subject-case`/`scope-empty` disabled. Start `scope-enum` at severity 1 (warn) with a placeholder domain list and graduate to severity 2 once trainos' actual module/scope names stabilize — copy the "EDIT THIS LIST" self-documenting comment style.
- The CI `summary` job's two hard-won correctness rules: (a) a final job that explicitly checks every blocking job's `.result` and calls `exit 1` — never trust an `if: always()` job with only echo steps to represent failure; (b) treat `skipped` as a failure for any job in the blocking set, not just `failure`/`cancelled`, since an upstream `install` failure cascades as `skipped`, not `failed`.
- The Render `buildCommand: ... && npm run verify:deploy && npm run build` pattern — re-running gates at deploy time is cheap insurance against a branch-protection gap.
- The PR-body auto-sync-from-status-doc pattern (§6) if trainos maintains (or will maintain) a living project-status doc — the `awk`-based, marker-fenced, seed-from-template mechanism is solid and worth reusing structurally even with different section names.

**Adapt:**
- The CI job list — showroom's jobs (`rpc-contract`, `sql-parse`, `grant-hygiene`) are specific to a Supabase-RPC-heavy architecture and are explicitly out of scope for this doc (guardrail-script internals, per the research brief's non-goals) but the *shape* (typecheck loose + typecheck strict + test + build + a domain-specific contract-drift check, all in the blocking set; lint-full/format/deps-audit advisory) is a reasonable template to retarget at trainos' own stack.
- The Semgrep job's split between custom-rule ERROR severity (blocking) and everything else (advisory) — trainos would need its own `.semgrep/rules.yml` for the custom part to mean anything; the registry rulesets (`p/typescript`, `p/react`, `p/owasp-top-ten`, `p/javascript`) can be adopted as-is as an advisory layer from day one.
- The PR template's static incident-driven checklist (showroom's "RPC Contract Discipline" section) — the *pattern* (a named, postmortem-linked checklist embedded in the PR template for a known-fragile seam) is worth adopting the day trainos has its own first production incident to write a checklist against; there's nothing to copy verbatim since it's specific to showroom's RPC envelope bug.

**Drop:**
- vern-vault's current state as a target to imitate for anything in this doc's scope — it is missing lefthook, commitlint, prettier config, and a working CI file entirely. Its only reusable piece is the hot-state PR-sync automation (already called out above).
- Any reliance on `.husky/*` — both repos have already moved past husky (showroom explicitly migrated away; vern-vault never had it), so trainos should start directly on lefthook with no husky legacy to carry.
- The stale cross-references inside showroom's own config (`commitlint.config.cjs`'s "wired via `.husky/commit-msg`" docblock comment, its dead link to a non-existent `docs/ci-cd-plan.md`, and `.prettierignore`'s leftover `.husky` exclusion) — don't copy these comments verbatim into trainos; they're artifacts of an incomplete migration cleanup, not intentional design.

## What I could NOT verify

- **Actual GitHub branch-protection settings** for either repo — no GitHub API/network access in this task. Everything reported about branch protection here is inferred from committed file comments and Obsidian project-log entries, all of which describe it as *not* confirmed active (showroom) or don't mention it (vern-vault).
- **Whether vern-vault's CI pipeline described in the Obsidian case study ever actually existed on `main`** — I checked only the current working tree's `.github/workflows/ci.yml` (1 byte). It's possible the described pipeline exists on a different branch, was reverted in a commit I didn't inspect, or the case study was written speculatively/aspirationally and never actually shipped. I did not run `git log -p -- .github/workflows/ci.yml` to check history, since the research brief scoped this to current-state file inspection; a follow-up `git log --follow -p .github/workflows/ci.yml` in vern-vault would resolve this definitively.
- **Whether the `parallel` git remote (`PARALLELPARADIGMS/vern`) is genuinely retired or just missing from this particular clone** — only `origin` is configured in the checkout I inspected.
- **Whether GitHub secrets referenced in showroom's CI (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, implicit `GITHUB_TOKEN`) are actually populated in the repo's Actions settings** — I can see the workflow references them by name only; I have no access to GitHub's secrets store to confirm values exist (nor would I want their values — only confirming presence/absence would be in scope, and that also requires API access I don't have here).
- **The internal mechanics of `scripts/guard.mjs`, `scripts/codex-gate.mjs`, `scripts/rpc-contract-check.js`, `scripts/check-grants.mjs`, `tools/sql-lint.mjs`** — explicitly out of scope per the research brief's non-goals ("guardrail scripts internals"); I confirmed only that the files exist and read their `lefthook.yml`/`ci.yml` invocation sites, not their bodies.
- **`docs/superpowers/specs/2026-06-11-self-healing-guardrail-stack-design.md`** — confirmed to exist (cited as the design source for the lefthook tag mechanism) but not read in depth, for the same non-goals reason.
