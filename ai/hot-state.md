# Hot State

> What is actively being worked on right now. Newest session block first.
> Historical detail moves to `CHANGELOG.md` once a chunk ships.
>
> The three headings `Focus`, `Next Active Task` and `Blockers` are an implicit
> contract — a PR-body extractor keys on those literal strings. Renaming one
> silently degrades that section to a placeholder.

## SESSION 2026-09-13 — HEADLESS BLAST, API PHASE + UI CARRY-OVER

> **BLAST 13 Sep 19:25 +08** — orchestrator launched four lanes on top of the
> 19:05 recovery, each in its own worktree under `~/Repos/personal-work/trainos-wt/`
> opening a PR to main: `lane/rpc-018` (worktree `rpc-018`, 018 RPC pack, user
> go-ahead), `ui/tokens` (worktree `ui-tokens`, kit contrast tokens +
> mono-uppercase reduction), `ui/lists` (worktree `ui-lists`, HRD Corp +
> Invoices list leaves, Collections §10b, zebra on two hand-rolled tables),
> `ui/states` (worktree `ui-states`, nine empty states, ten tone ternaries,
> Drawer primary scope, ListToolbar on agent registry). `cloud/migrations`
> (014–017) and `cloud/web-swap` continue from the 19:05 entry, no PRs yet.
> Start from `ai/resume-brief.md` BLAST 19:25 entry.

> **BLAST 13 Sep 19:4x +08** — PR #5 (`cloud/web-swap`) and PR #6
> (`cloud/migrations`) open. PR #5's CI is NOT green except Gitleaks —
> verified directly (`gh pr checks 5`): four checks fail (Gitleaks license,
> Prettier drift, npm audit high+ with 2 critical/1 high, Vite
> artifact-upload storage quota). `ci-gitleaks` (worktree `ci-gitleaks`,
> branch `ci/gitleaks`) is fixing the license one. PR #5 also surfaced ten
> missing RPC functions, now `lane/rpc-018`'s scope. New lanes: `seeds`
> (worktree `seeds`, branch `lane/seeds`, shim :5434, fixture-world seed
> data) and `codex-review-011-013` (worktree `codex-011-013`, branch
> `review/codex-011-013`, D-012 review of packs 011–013). GitHub repo is
> `PARALLELPARADIGMS/alex-project`, not "trainos". See
> `ai/workstreams.md` API-PHASE, SEEDS, SUPABASE SCHEMA and CI AND BRANCH
> PROTECTION threads for detail.

> **BLAST 13 Sep 19:5x +08** — root cause found: main has been red since
> `9fdcb4d` on the same four checks (Gitleaks, Prettier, npm audit, Vite
> artifact-upload), so PR #5, #6 and #7 all inherit them regardless of their
> own diffs. PR #6 (`cloud/migrations`) and PR #7 (`ci/gitleaks`) are open;
> PR #7's Gitleaks check now passes but its other three main-red failures do
> not. PR #6 also fails Grant Hygiene (a test file defines its own
> `SECURITY DEFINER` function) and is gated on `codex-review-014-017`'s
> MERGE/MERGE-WITH-FIXES/BLOCK verdict before it can land. A fix lane is
> meant to be repairing main's CI on branch `fix/main-ci`, but the actual
> worktree on disk is on branch `fix/pr5` with a web-swap feature commit, not
> a CI fix — flagged, not yet resolved. R-F confirmed live: probing the
> hosted project's REST endpoint directly returned `PGRST106`, `core` is not
> exposed. See `ai/workstreams.md` for full detail.

> **BLAST 13 Sep 20:0x +08** — PR #7 (`ci/gitleaks`) merged at `0910b9d`,
> confirmed on main; Gitleaks now passes on main's own CI, though Prettier
> drift, Vite artifact-quota and npm audit still fail there. `fix-pr5` (still
> on branch `fix/pr5`, not the reported `fix/main-ci`) has three real fix
> commits now — Prettier, timezone, artifact quota — resolving the earlier
> "flagged, not yet resolved" concern about that lane's progress, though the
> branch-name gap itself is unexplained. The `codex-014-017` detached-HEAD
> worktree is confirmed legitimate: it is `codex-review-014-017`'s own
> checkout of PR #6's tip for review, not a stray lane. PR #8 (`ui/states`,
> "fix(screens): empty states, tone ternaries, drawer primary and the
> registry toolbar") opened, under review by `review-pr8`; three deviations
> from the verification doc confirmed and logged in `ai/workstreams.md`
> UI-CARRYOVER, plus carryover items handed to `cloud/web-swap` and
> `ui/lists`.

> **BLAST 13 Sep 20:1x +08** — PR #9 (`ui/tokens`) is already MERGED
> (`ed3c337`), not "open" as reported — verified `gh pr view 9` directly.
> Every substantive claim about it checked out exactly against
> `docs/reviews/2026-09-13-verification.md`: rows 1b/1c closed (6.54:1
> light / 4.82:1 dark), contrast suite 33→49, mono-caps counts exact on all
> four routes, the participants "x275" confirmed a false violation (record
> references the brief keeps in mono), and both unfixed defects (destructive
> alias 2.22:1 dark, dead `ui/button.tsx`) confirmed real. PR #10
> (`ui/lists`) confirmed open, 5 commits/17 files exact, 1009 tests
> confirmed in its own body; all six deviations confirmed against the diff.
> One kit follow-up item queued off PR #10 turned out to already be done:
> `Money.tsx`'s `font-mono` was fixed by PR #9 itself, not left open — drop
> it from the list rather than reassign it. Full detail in
> `ai/workstreams.md` UI-CARRYOVER.

> **Last updated:** 2026-09-13 20:1x — PR #9 merged (was reported open); PR
> #10 open under review; one queued follow-up already resolved by PR #9.

### Focus

Getting the API phase moving (018 RPC pack, hosted apply once 014 passes
retrofit QA) while three UI carry-over lanes close out contrast, list-leaf and
empty-state debt from the verifier pass, without losing the SUPABASE SCHEMA
thread's state (013 committed; 014–017 in cloud) or any in-flight cloud PR.

### Next Active Task

Record each lane's result in the doc spine as it lands (one commit per
update, by `spine-keeper`), then fold ui/tokens, ui/lists and ui/states back
into the kit per CLAUDE.md's consolidation rule once merged.

### Blockers

Four items still need the user: exposing `core` in the dashboard (R-F,
**confirmed still not exposed** by a direct `PGRST106` probe at 19:5x — this
is the one thing actually blocking the first hosted apply once 014 passes
review), n8n in the proposal, and the four UI rulings tracked in
`ai/resume-brief.md`. Branch protection on `main` cannot be set at all on the
current GitHub plan/visibility (403, confirmed 19:40) — needs a user decision
to upgrade or make the repo public.

## SESSION 2026-09-13 — UI BLAST LANDED, CONSOLIDATION

> **WRAP 13 Sep 19:05 +08** — outage recovered; routing and worker PRs merged; migrations 014–017, web-swap and pack-v3 relaunched in the cloud on `cloud/*` branches. Start from `ai/resume-brief.md` 19:05 entry; check GitHub PRs first.
>
> **WRAP 13 Sep 13:55 +08** — UI paused by user decision; all 45 nav leaves built; API phase next. Start from `ai/resume-brief.md` (research blast E, migrations A, API-layer decision C). Previous wrap note kept below for history.
>
> **WRAP 13 Sep 11:52 +08** — session cleared for context. Start the next session from `ai/resume-brief.md` (agents to relaunch, blast A–E, eyeball list). In-flight at wrap: shell-fix, applier-2, proto-header — check `git log` for their last commits before relaunching.

> **Last updated:** 2026-09-13 — twenty-seven screens across fourteen features are
> mounted and reading fixtures; the kit absorbed the duplicates they were each
> carrying; `useApi`/`useAction` is the consolidation still open.

### Focus

Closing the divergence the parallel screen build left behind. Fourteen feature
lanes wrote screens at once against `@trainos/fixtures`, and each lane carried a
private copy of whatever the kit did not have yet — an outcome banner, a tone
map, a date-range formatter, a breadcrumb, a data hook. The kit now owns all of
those, so this session moves the last local copies out and closes the two shared
hooks five features still declare privately and mark TEMPORARY.

### Shipped

- **Twenty-seven screens across fourteen features**, each built only from the
  kit and reading only the fixture client, with render tests over the fixtures
  and light and dark screenshots at 1440x900.
- **The component kit**: tokens supplement, chips, layout, data table, filter
  bar, pill tabs, AI/approval/agent components, overlays and inputs, plus the
  `/dev/kit` showcase that is its contract with the screen lanes — a pattern not
  on that page is not in the kit.
- **The route table closed.** All fourteen features declare their own array;
  `FEATURE_ROUTES` is spread BEFORE the generated nav placeholders, and
  `PUBLIC_ROUTES` mounts the client portal as a sibling of the shell.
- **The breadcrumb lifted to the shell.** A screen declares a trail through
  `useBreadcrumb` and the 56px top bar renders it. No screen draws its own.
- **`ActionOutcome` consolidated into the kit** after five independently written
  copies, three of which had already diverged.
- **`@trainos/fixtures`**: the seed dataset for the whole demo story, an
  in-memory client over the contract surface, and 116 tests.
- **`@trainos/agent-runtime`**: BYOK provider layer, §17 routing, the
  orchestrator, run slicing for the 400s worker, and a browser-safe default
  entry pinned by a module-graph test.
- **Migrations 001 to 009 authored and EXECUTED** on a local PostgreSQL 17.11
  shim. Nothing applied to any hosted database.
- **Five architecture documents and a two-part critic review**, plus the agent
  JWT-minting spike that settled agent auth.
- **The dev gallery stopped shipping.** A production build was emitting the
  showcase as a 175 kB chunk nothing could fetch; `vite.config.ts` now aliases
  the dev route module to an empty array in production.

### Next Active Task

Finish the `useApi`/`useAction` consolidation. Seven feature `api.ts` files
declare a local `useApi()` marked `TEMPORARY SHAPE`, and `dashboard/client.ts`
and `approvals/client.ts` each carry a private `toApiError` adaptation because
`shared/api/errors.ts` recognises only `ApiErrorException` and therefore reads a
thrown `ContractError` as a transport failure — which puts a retry button on a
policy refusal, the exact R2 collapse CLAUDE.md warns about. Move one `useApi`
and one `useAction` into `src/shared/api`, make `errors.ts` recognise a
`ContractError` structurally rather than by `instanceof`, then delete the nine
local copies and the two `StandInField.tsx` stand-ins once the kit ships
`TextField`/`DateField`. The verifier pass runs after it.

**Superseded 2026-09-13 10:40 by `d4ae83d` — the consolidation is done.** The
task above is complete and is left standing rather than rewritten, because the
shape of what was found is worth more than the instruction. Thirteen modules had
grown their own copy of the hook in four incompatible shapes, not the seven this
block counted. `shared/api/useApi.ts` is now the only one and `ApiProvider` is
mounted at the root. `toApiError` recognises a `ContractError` and carries its
code, status, details and approval reference through, and a test renders a 403
and asserts the retry affordance is absent **even when `onRetry` is passed** —
the component refusing it is what stops a caller reintroducing the defect. The
scaffold's `TrainOsClient` interface and its all-`NOT_IMPLEMENTED` stub are
deleted: nothing imported them, and a second client surface beside the real one
is the divergence CLAUDE.md forbids.

**The new next action is the verifier pass.** It is the only thing left that
gates everything else, and nothing in this repository has been verified by
anyone but the lane that wrote it. After it: the kit duplicate sweep, which is
now down to the two `StandInField.tsx` copies waiting on a kit `TextField` and
`DateField`, and pointing the agent runtime at the contract's new `RESUMABLE`
run status instead of its own wrapper.

**Updated 2026-09-13, earlier the same morning.** Two concurrent lanes landed
while this block was being written. `af92507` finished the `ActionOutcome`
consolidation — finance, hrdc and engagements all import the kit's now — and
moved the last five screens that drew their own `Breadcrumb` onto the shell's
slot, so those are done rather than in the working tree. `e148a34` landed
contract rulings R4 to R8, which closes four of the twelve reported contract
gaps and adds a `RESUMABLE` member to `RunStatus`; the agent runtime still
reports a yielded run as `RUNNING` with the disposition on its own wrapper and
should now be changed to use the contract's member. Neither changes the next
action above: `useApi` and `useAction` are still declared seven times.

### Blockers

- **The Supabase lane is PAUSED at migration 009** with critic Part 2 open — 7
  critical and 29 high. `supabase/HANDOFF.md` carries the resume pointer and the
  seven rulings not yet applied to migrations.
- **CI has never executed.** There is no remote and no branch protection, so the
  17-job pipeline has never run once against this repository. Every "green"
  claim in this session is a local run.
- **CI secrets are unset**: `VITE_SITE_URL` and `VITE_API_BASE_URL`.

### New durable artifacts

`ai/workstreams.md`, `ai/state-backlog.md`, `ai/project-log.md`,
`ai/findings-log.md`, `docs/reviews/2026-09-12-ui-blast-lane-review.md`,
`packages/fixtures/**`, `packages/agent-runtime/**`,
`apps/web/src/shared/components/kit/**`, `apps/web/src/features/**`,
`apps/web/src/routes/**`, `supabase/migrations/001`–`009`,
`docs/architecture/01`–`06`, `docs/architecture/spikes/**`.

---

## SESSION 2026-09-12 — REPO FLOOR LAID

> **Last updated:** 2026-09-12 — the scaffold is in and every gate runs clean.

### Focus

Standing up the TrainOS repository on the house stack so a React team can start
building kit components and screens immediately: workspaces, build config,
design tokens, the app shell, the data boundary, the guardrail stack, CI, and
the doc spine.

### Shipped

- npm workspaces monorepo; `apps/web` depends on `@trainos/contract` by name.
- Four tsconfigs including the strict ratchet, shipped with an empty allowlist.
- `src/styles/tokens.css`: every light token and the full dark map as a straight
  token swap, stored as RGB triplets so Tailwind alpha modifiers work.
- next-themes with `data-theme` and three states; the token swap is the whole
  theme.
- Sidebar + topbar shell at the pack's dimensions, role-filtered from one config
  pass, with the route table generated from the same tree.
- The typed client boundary: one interface by contract section, 41 methods, a
  `{ data, error }` Result, and a domain-versus-transport error split.
- EmptyState, LoadingState, ErrorState.
- Two hook tiers, 17-job CI whose summary fails on `skipped`, dependency-cruiser
  with both boundary rules probed, a bundle baseline, and three Supabase-coupled
  checks running clean against the live migrations.

### Next Active Task

Wire the HTTP client behind `TrainOsClient` and let the fixtures package replace
`fixture-client.ts` method by method. Nothing else in the app moves when that
happens — that is what the boundary is for. The first screen to build is the one
the approvals queue needs, since it exercises the approval envelope, the badge
count and the fire-and-forget mutation rule all at once.

**Correction (2026-09-13) — what actually happened.** The plan above is left
standing because a reader who half-remembers it needs the correction rather than
silence. None of it ran as written. The HTTP client behind `TrainOsClient` was
never wired and no method of `fixture-client.ts` was replaced; instead
`@trainos/fixtures` shipped as a separate workspace package with its own
in-memory client over the whole contract surface, and every screen imports that
package directly through a local `useApi()` rather than through the
`shared/api` boundary the scaffold built. The approvals queue was not first
either — the database, contract, architecture, kit and fixtures lanes all ran
ahead of it, and M02-S01 landed in the middle of a twenty-seven-screen batch
(`e811fd4`). The boundary's claim that nothing in the app moves when the client
changes is therefore still untested: the thing it was meant to protect went
around it. Closing that is the consolidation named in the 2026-09-13 block,
which `d4ae83d` completed the same morning by deleting the boundary rather than
wiring it: the interface described a seam the app had already outgrown.

### Blockers

- **Branch protection is not on.** Nothing in this repo can turn it on. Until
  the blocking checks are required on `main` in the host's settings, the
  pipeline is decoration.
- **CI secrets are unset**: `VITE_SITE_URL` and `VITE_API_BASE_URL`.

### New durable artifacts

`CLAUDE.md`, `AGENTS.md`, `README.md`, `ai/*`, `scripts/*`,
`.github/workflows/ci.yml`, `.dependency-cruiser.cjs`, `.semgrep/rules.yml`,
`apps/web/**`, `docs/design/**`.

---

<!-- Session block template — PREPEND a new one, never overwrite:

## SESSION YYYY-MM-DD — <ALL-CAPS TITLE>

> **Last updated:** YYYY-MM-DD — <one line>

### Focus
<what this session is actually about, one short paragraph>

### Shipped
-

### Next Active Task
<the exact next action, cold-startable — someone with no context can begin here>

### Blockers
<or "none">

### New durable artifacts
<files created that outlive this session>

---
-->
