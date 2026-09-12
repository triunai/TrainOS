# Git hooks, commit convention, and CI

Two tiers of git hook, one CI pipeline whose summary job can actually say no, and an
optional PR-body auto-sync.

---

## 1. lefthook.yml

Start with the `baseline` tier only. Add the `guardrail` block in step 7, once
`scripts/guard.mjs` exists.

```yaml
# lefthook.yml — git hook orchestrator.
#
# TWO CLASSES OF COMMAND:
#   tag `baseline`  — proven, always-on guards. NOT silenced by the guardrails
#                     toggle. These block.
#   tag `guardrail` — the advisory layer. Routed through scripts/guard.mjs,
#                     which (a) no-ops when the `.guardrails-off` sentinel is
#                     present and (b) makes every check advisory by exiting 0.
#                     Lefthook has NO `continue_on_error` flag, so a wrapper
#                     that exits 0 is the ONLY way to make a command
#                     non-blocking.
#
# TWO WAYS TO PAUSE THE ADVISORY LAYER:
#   global, persistent:    npm run guardrails:off            (sentinel file)
#   one-shot, per-invoke:  LEFTHOOK_EXCLUDE=guardrail git push
#
# NOTE: lefthook does NOT auto-`git add` files a command fixed (unlike
# lint-staged). Staged-file handling is delegated to lint-staged itself, so
# this is a non-issue here.

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
    guardrails:
      tags: guardrail
      # The advisory layer. Toggle-aware via guard.mjs (always exits 0).
      run: node scripts/guard.mjs all
```

### Installation

`"prepare": "lefthook install"` in `package.json`. npm runs `prepare` automatically after
`install`, so every contributor gets hooks with no manual step. `lefthook install` writes
`.git/hooks/*` shims that read `lefthook.yml` at run time — editing `lefthook.yml` alone is
enough, nobody needs to reinstall.

CI never exercises git hooks. It calls the underlying npm scripts directly, deliberately:
a paused local toggle must never be able to skip a CI job.

### Adding a blocking pre-push check later

A check that has earned the right to block goes in the `baseline` tier as its own command,
invoked directly rather than through `guard.mjs`:

```yaml
    contract-check:
      tags: baseline
      # Un-toggleable on purpose: the advisory toggle silences noise, never a
      # contract gate.
      run: npm run check:rpc
```

### Do not use husky

Both source repos are past it — one migrated away, one never had it. Start on lefthook
with no legacy to carry.

---

## 2. commitlint.config.cjs

```js
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
        "feat", "fix", "docs", "style", "refactor", "perf",
        "test", "build", "ci", "chore", "revert",
      ],
    ],
    // EDIT THIS LIST as the module names stabilise. Start with the structural
    // scopes every project has, add domain scopes as features land.
    "scope-enum": [
      1,
      "always",
      [
        "auth", "config", "ui", "ci", "deps", "docs", "tests", "release",
        "lib", "state", "routing", "perf", "rpc", "migration", "supabase",
      ],
    ],
    "header-max-length": [2, "always", 100],
    "subject-case": [0, "never"],
    "scope-empty": [0, "never"],
  },
};
```

Severities, precisely:

| Rule | Severity | Effect |
|---|---|---|
| `type-enum` | 2 | blocks — the stock Conventional Commits type list |
| `scope-enum` | 1 | warns only, until the list is validated |
| `header-max-length` | 2 | blocks at 100 characters |
| `subject-case` | 0 | disabled, any case allowed |
| `scope-empty` | 0 | disabled, scope optional |

**Merge-commit trap**: a GitHub merge commit (`Merge pull request #N from …`) matches no
conventional type and would fail `type-enum` if it reached the hook. Either squash-merge
only, or exempt merge commits. Decide this before turning on branch protection.

---

## 3. lint-staged

In `package.json` (already included in `references/stack.md` §2):

```json
"lint-staged": {
  "*.{ts,tsx,js,jsx}": ["prettier --write"],
  "*.{json,md,yml,yaml,css,html}": ["prettier --write"]
}
```

Prettier only, not ESLint. Formatting is mechanical and safe to apply on commit; linting
is a separate CI concern where a finding can be read, not silently rewritten under you.

---

## 4. .github/workflows/ci.yml

Thirteen jobs plus a summary. Jobs marked advisory carry `continue-on-error: true` and are
deliberately absent from the summary's blocking list.

Trim the Supabase jobs (`sql-parse`, `rpc-contract`, `grant-hygiene`) if `SUPABASE=no`, and
remove them from both the `summary` job's `needs` and its failure condition.

```yaml
name: CI

# Typecheck and hook-order are deployment gates in render.yaml as well. CI
# reports the same contracts; branch protection must require them for PRs.
# Broad lint/format/dependency debt stays advisory until its baseline is clean.

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
    continue-on-error: true # observe-only — drift heals via lint-staged
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
        # VITE_ env vars are inlined into the bundle at build time. They are
        # public-by-design (the publishable key ships in the JS). Storing them
        # as repository secrets is hygiene, not security.
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
      - name: Report bundle sizes
        # Four-space indent renders as a code block in the step summary without
        # needing literal fences inside this YAML.
        run: |
          echo "## Bundle sizes" >> $GITHUB_STEP_SUMMARY
          du -sh dist/assets/*.js dist/assets/*.css 2>/dev/null | sort -h | sed 's/^/    /' >> $GITHUB_STEP_SUMMARY || true
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
      - name: Coverage report (advisory until the first threshold lands)
        run: npm run test:coverage
        continue-on-error: true
      - name: Upload coverage report
        if: always()
        uses: actions/upload-artifact@v4
        with: { name: coverage-report, path: coverage/, retention-days: 7 }

  sql-parse:
    # BLOCKING. A migration or test pin that does not parse is not a migration
    # or a pin. Gates like the typechecks do — not advisory tier.
    name: SQL Parse (migrations, rollbacks, tests)
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run lint:sql

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

  grant-hygiene:
    name: Grant Hygiene
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
      - name: Custom rules — ERROR severity (blocking)
        run: semgrep scan --config .semgrep/rules.yml --severity ERROR --error
      - name: Custom rules — WARNING/INFO (advisory)
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
          echo "| Full lint | ${{ needs.lint-full.result }} (advisory) |" >> $GITHUB_STEP_SUMMARY
          echo "| Format | ${{ needs.format.result }} (advisory) |" >> $GITHUB_STEP_SUMMARY
          echo "| Typecheck (loose) | ${{ needs.typecheck.result }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Typecheck (strict) | ${{ needs.typecheck-strict.result }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Build | ${{ needs.build.result }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Vitest (unit) | ${{ needs.test.result }} |" >> $GITHUB_STEP_SUMMARY
          echo "| RPC contract | ${{ needs.rpc-contract.result }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Grant hygiene | ${{ needs.grant-hygiene.result }} |" >> $GITHUB_STEP_SUMMARY
          echo "| SQL parse | ${{ needs.sql-parse.result }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Semgrep SAST | ${{ needs.sast-semgrep.result }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Secrets scan | ${{ needs.secrets-scan.result }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Deps audit | ${{ needs.deps-audit.result }} (advisory) |" >> $GITHUB_STEP_SUMMARY

      # THE AGGREGATE MUST FAIL, NOT JUST NARRATE. `if: always()` makes this job
      # run after failures — and with only `echo` steps it then SUCCEEDS, so a
      # green "CI Summary" sits on top of a red matrix. Anyone using it as the
      # required check is reading a status that cannot say no. Blocking jobs are
      # listed explicitly; the advisory ones are deliberately absent.
      - name: Fail when a blocking job failed
        # "skipped" IS A FAILURE HERE. Every blocking job `needs: install`, so
        # if install fails they are all SKIPPED, not failed — and a list of just
        # failure/cancelled passes green having run nothing at all. That is the
        # worst possible green: the cascade that breaks everything is the one
        # the gate cannot see.
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

### Gate classes

| Job | Class |
|---|---|
| `install` | infra; everything except the two standalone scanners depends on it |
| `lint` (hook order) | blocking |
| `typecheck`, `typecheck-strict` | blocking |
| `build`, `test` | blocking (coverage sub-step advisory) |
| `sql-parse`, `rpc-contract`, `grant-hygiene` | blocking, Supabase only |
| `secrets-scan` | blocking, standalone |
| `sast-semgrep` | ERROR step blocking, the rest advisory |
| `lint-full`, `format`, `deps-audit` | advisory |
| `summary` | aggregates and hard-fails the workflow |

### The artifact-quota trap

Do not add a job that uploads `node_modules/` as an artifact to share between jobs. One
source repo did and exhausted its artifact quota, turning every push red with zero code
defects. Each job running its own cached `npm ci` is cheaper and cannot fail this way. If
you do add such a step, give it `continue-on-error: true` so quota exhaustion degrades
instead of failing the pipeline.

### Branch protection — the part no file can do

A thirteen-job hard-failing pipeline provides **zero** custody until branch protection on
the default branch requires those checks. That switch lives in the host's settings, not in
this repo, and a person has to flip it. One source repo's own CI header calls it
aspirational and its project log records it blocked on a plan-tier API restriction — it
never actually went on. Say so out loud at the end of the bootstrap and leave it as an
open item.

---

## 5. .github/pull_request_template.md

```markdown
# Pull Request

## Summary
<!-- 1-3 bullets: what changed and why -->
-

## Changes
<!-- High-level groupings — frontend / schema / docs / scripts -->
-

## Test plan
<!-- How was this verified? Commands run, paths exercised, screenshots if UI -->
- [ ] `npm run verify:deploy` clean
- [ ] Manual smoke on the affected routes (desktop + mobile)
- [ ] (if schema) migration + rollback + test pin applied to a test project; RLS spot-checked
- [ ] (if new UI) empty / loading / error states present; reduced-motion respected

## Schema / architecture impact
<!-- If this touches supabase/, link the migration and its catalog entry. Otherwise: N/A -->
-

## Other checks
- [ ] No new unchecked double cast added without a runtime guard
- [ ] No `console.log` left in production paths (the build strips it, but review it anyway)
- [ ] Mobile-first verified for any new UI (320px baseline, 44px touch targets)
```

**Incident-driven sections**: the day this project has its first production incident on a
fragile seam, add a named, postmortem-linked checklist section for it here. That is the
pattern worth copying; there is nothing to copy verbatim because the checklist is specific
to the incident. Keep the checklist's rule text in one place and link to it rather than
restating it.

---

## 6. PR auto-sync from the hot-state doc (optional)

Keeps three marker-fenced regions of an open PR's body in sync with the project's living
status doc, leaving every human-authored section untouched. Adopt this only if the doc
spine's `ai/hot-state.md` is actually being maintained.

Two reusable ideas beyond the specific section names: replace fenced regions with `awk`,
never `sed` (multi-line `sed` is a footgun), and seed the body from the PR template on the
first sync so a freshly-created PR ends up fully fenced instead of doing nothing.

**Heading names are an implicit contract.** The extractor keys on the literal `### Focus`,
`### Next Active Task`, `### Blockers` headings. Renaming one silently degrades that
section to a placeholder. Note this where the headings live.

### `.github/pull_request_template.md` additions

Append below the human sections:

```markdown
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

The three sections above are auto-synced from `ai/hot-state.md` on every push.
Sections OUTSIDE the AUTO-SYNC markers are preserved across syncs.
```

### scripts/sync-pr-from-hot-state.sh

```bash
#!/usr/bin/env bash
# Sync the current branch's PR body from ai/hot-state.md.
#
# Strategy: marker-based. Only the regions between
#   <!-- AUTO-SYNC:<name>-start --> ... <!-- AUTO-SYNC:<name>-end -->
# are replaced. Human-authored sections are preserved across runs.
#
# Skips silently if no PR exists for the branch. Idempotent.
# Requires: gh CLI, awk, sed.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOT_STATE="$REPO_ROOT/ai/hot-state.md"
TEMPLATE="$REPO_ROOT/.github/pull_request_template.md"

if [ ! -f "$HOT_STATE" ]; then
  echo "sync-pr: ERROR ai/hot-state.md not found" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "sync-pr: gh CLI not found; skipping" >&2
  exit 0
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "HEAD" ] || [ -z "$BRANCH" ]; then
  echo "sync-pr: detached HEAD or no branch; skipping" >&2
  exit 0
fi

# Extract a section from hot-state.md by its '### <heading>' line. Reads from
# the matched heading until the next '### ' or '## ' or EOF. Returns the body
# without the heading line, trimmed of leading/trailing blank lines.
extract_section() {
  local heading_pattern="$1"
  awk -v pat="$heading_pattern" '
    BEGIN { in_section = 0 }
    /^### / {
      if (in_section) exit
      if ($0 ~ pat) { in_section = 1; next }
    }
    /^## / {
      if (in_section) exit
    }
    in_section { print }
  ' "$HOT_STATE" | sed -e 's/[[:space:]]*$//' | awk 'NF{found=1} found' | tac | awk 'NF{found=1} found' | tac
}

FOCUS=$(extract_section '^### Focus$')
NEXT_TASK=$(extract_section '^### Next Active Task')
BLOCKERS=$(extract_section '^### Blockers')

if [ -z "${FOCUS// }" ]; then FOCUS="_(no focus block found in ai/hot-state.md)_"; fi
if [ -z "${NEXT_TASK// }" ]; then NEXT_TASK="_(no next-task block found in ai/hot-state.md)_"; fi
if [ -z "${BLOCKERS// }" ]; then BLOCKERS="_(no blockers block found in ai/hot-state.md)_"; fi

PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number // empty' 2>/dev/null || echo "")

if [ -z "$PR_NUMBER" ]; then
  echo "sync-pr: no open PR for branch '$BRANCH'; skipping"
  exit 0
fi

CURRENT_BODY=$(gh pr view "$PR_NUMBER" --json body --jq '.body // ""' 2>/dev/null || echo "")

# Empty or not yet templated: seed from the PR template so the first sync after
# `gh pr create` produces a fully-fenced body instead of a no-op.
if [ -z "${CURRENT_BODY// }" ] || ! grep -q 'AUTO-SYNC:focus-start' <<<"$CURRENT_BODY"; then
  if [ -f "$TEMPLATE" ]; then
    CURRENT_BODY=$(cat "$TEMPLATE")
  else
    echo "sync-pr: PR body empty and no template at .github/pull_request_template.md; skipping" >&2
    exit 0
  fi
fi

# awk, not sed — sed is a footgun for multi-line replacement.
replace_region() {
  local body="$1"
  local name="$2"
  local heading="$3"
  local content="$4"
  awk \
    -v start="<!-- AUTO-SYNC:${name}-start -->" \
    -v end="<!-- AUTO-SYNC:${name}-end -->" \
    -v heading="## ${heading}" \
    -v content="$content" \
  '
    BEGIN { in_region = 0 }
    index($0, start) {
      print; print ""; print heading; print ""; print content; print ""
      in_region = 1
      next
    }
    index($0, end) { in_region = 0; print; next }
    !in_region { print }
  ' <<<"$body"
}

NEW_BODY="$CURRENT_BODY"
NEW_BODY=$(replace_region "$NEW_BODY" "focus" "Hot state — Focus" "$FOCUS")
NEW_BODY=$(replace_region "$NEW_BODY" "next-task" "Hot state — Next active task" "$NEXT_TASK")
NEW_BODY=$(replace_region "$NEW_BODY" "blockers" "Blockers" "$BLOCKERS")

# Single-line, idempotent timestamp footer — replaced in place, never stacked.
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FOOTER_MARKER="<!-- AUTO-SYNC:timestamp -->"
if grep -q "$FOOTER_MARKER" <<<"$NEW_BODY"; then
  NEW_BODY=$(awk -v marker="$FOOTER_MARKER" -v stamp="$TIMESTAMP" '
    index($0, marker) { print marker; print ""; print "_Last auto-sync from ai/hot-state.md: " stamp "_"; in_skip=1; next }
    in_skip && /^_Last auto-sync/ { in_skip=0; next }
    in_skip && /^$/ { next }
    { in_skip=0; print }
  ' <<<"$NEW_BODY")
else
  NEW_BODY="${NEW_BODY}

${FOOTER_MARKER}

_Last auto-sync from ai/hot-state.md: ${TIMESTAMP}_"
fi

echo "$NEW_BODY" | gh pr edit "$PR_NUMBER" --body-file - >/dev/null
echo "sync-pr: updated PR #$PR_NUMBER body from ai/hot-state.md"
```

### scripts/claude-hook-post-push.sh

```bash
#!/usr/bin/env bash
# Claude Code PostToolUse hook entry point.
#
# Wired in .claude/settings.local.json under hooks.PostToolUse[matcher=Bash].
# Claude Code invokes this after every Bash tool use, passing the tool I/O as
# JSON on stdin. If the command was a `git push`, trigger the PR-body sync.
# Everything else is ignored.
#
# Bail-outs are silent — a hook failure must never block normal flow.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo '')"
if [ -z "$REPO_ROOT" ]; then exit 0; fi

SYNC_SCRIPT="$REPO_ROOT/scripts/sync-pr-from-hot-state.sh"
if [ ! -x "$SYNC_SCRIPT" ]; then exit 0; fi

INPUT="$(cat || true)"
if [ -z "$INPUT" ]; then exit 0; fi

COMMAND=""
if command -v jq >/dev/null 2>&1; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
else
  COMMAND=$(echo "$INPUT" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' || true)
fi

case "$COMMAND" in
  *"git push"*)
    "$SYNC_SCRIPT" 2>&1 | sed 's/^/[claude-hook] /' || true
    ;;
  *)
    : # nothing to do
    ;;
esac

exit 0
```

**Adoption caveat**: the trigger is a Claude Code `PostToolUse` hook, not a git hook. A
`git push` typed by a person in their own terminal will not fire it. If humans push
regularly, either also call the sync script from a `post-push` wrapper they use, or accept
that the PR body updates only on agent-driven pushes.

**Not included**: a dual-remote push wrapper. One source repo has one, but its second
remote is not configured in the working copy and it is unclear whether that mirror was
retired or just absent. Single remote unless the project actually needs two.
