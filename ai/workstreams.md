# Workstreams

> The parkable board. Every initiative is a first-class thread that can be
> parked and picked up, not a single "current work" snapshot that loses one
> thread while advancing another.
>
> Status: 🟢 ACTIVE · ⏸ PARKED · ⛔ BLOCKED · ✅ DONE
>
> Parking a thread is two edits: flip the marker and rewrite `Resume:`. Picking
> one up is the reverse. A thread that has gone cold moves to
> `ai/project-log.md` and leaves this file.
>
> `Resume:` is the contract this file makes. It must be cold-startable — a
> session with no memory of this one should be able to begin from that line
> alone. If it needs context that is not in the line or its refs, the line is
> not finished.

---

## 🟢 SUPABASE SCHEMA — 001–013 committed; 014–017 in cloud, 018 in a lane (2026-09-13)

**Resume:** Read `supabase/HANDOFF.md` in full, then check what has actually
landed before writing anything: `git log` on `supabase/migrations/`, then the
status of `cloud/migrations` (014–017, no PR as of 19:25 13 Sep) and
`lane/rpc-018` (worktree `~/Repos/personal-work/trainos-wt/rpc-018`, branch
`lane/rpc-018`, the 018 RPC pack, user go-ahead given 19:23, opens a PR to
main). A network outage at ~16:00 on 13 Sep already killed one
migrations lane mid-014 with nothing lost; check for a live lane before
re-authoring 014–017 or 018 to avoid a second collision. Hosted apply (L3) is
authorised by the user for after 014 passes `migration-retrofit-qa` — apply
via the Supabase MCP's `apply_migration` against project `balzmmsmrawzmefkavte`
(ap-southeast-1, ACTIVE_HEALTHY, zero migrations applied), not psql; region
Singapore is confirmed by the user and by the project itself. **Do not apply
anything to the hosted project before that QA gate passes.** PR #6 does not
merge before `codex-review-014-017` reports its verdict either — see below.

**Confirmed directly 19:5x: `core` is still not exposed on the hosted
project.** Probed the live REST endpoint myself (`curl .../rest/v1/<table>`
with `Accept-Profile: core`, using the publishable key from the Supabase MCP)
and got back exactly `PGRST106`: `"Only the following schemas are exposed:
public, graphql_public"`. R-F (expose `core` in the dashboard) is a real,
still-open user action — not resolved by anything a lane can do — and
nothing else currently blocks the hosted apply once 014 passes review.

**Scope:** Everything under `supabase/`. Migrations, rollbacks, the executable
pins, the catalog, and the architecture documents they implement.

**State:** 001–013 authored, EXECUTED against a local PostgreSQL 17.11 shim,
and committed to main (013 in `bc15b17`). 014–017 (RLS, realtime+cron, and the
remainder) are being written by cloud lane `cloud/migrations`, no PR yet as of
19:25. 018 (the RPC pack) has the user's go-ahead as of 19:23 and is running in
worktree lane `lane/rpc-018` at `~/Repos/personal-work/trainos-wt/rpc-018`.
Nothing has been applied to any hosted database.

**018 scope grew 19:35+:** PR #5 (`cloud/web-swap`) found ten feature calls
with no `TrainOsClient` method and added them to `RPC_NAMES` in
`apps/web/src/shared/api/rpcClient.ts` without SQL behind them —
`patch_enquiry_extraction`, `list_follow_ups`, `get_follow_up_draft`,
`list_proposals`, `add_proposal_section`, `put_proposal_section`,
`regenerate_proposal_section`, `list_quotations`, `get_rate_card`,
`get_audit` (confirmed by diffing PR #5). `lane/rpc-018` has been told to
implement all ten in 018, marking each "spec derived from client" where
`docs/architecture/09` has no spec for it.

**Adversarial review running in parallel:** `codex-review-011-013` (Codex
gpt-5.6-sol xhigh via `codex-rescue`, worktree
`~/Repos/personal-work/trainos-wt/codex-011-013`, branch
`review/codex-011-013`) is doing the D-012 adversarial review of packs
011–013, writing to `docs/reviews/2026-09-13-codex-retrofit-011-013.md`.
Fallback order if Codex is unavailable: Kimi (not installed locally, so
effectively skipped), then a second Opus reviewer. Codex quota was reported
back as of a 19:29 probe (not independently verified here).

**Second review gates PR #6:** `codex-review-014-017` (Codex gpt-5.6-sol
xhigh, its own shim on port 5435, worktree
`~/Repos/personal-work/trainos-wt/codex-014-017`, detached HEAD at `826bb52`)
runs the retrofit gate on PR #6 and reports MERGE / MERGE-WITH-FIXES / BLOCK
to `docs/reviews/2026-09-13-codex-retrofit-014-017.md`. **Confirmed 2026-09-13
~20:00: the detached HEAD is expected, not a stray worktree** — it is the
reviewer's own checkout of PR #6's tip (`826bb52`, "feat(supabase): 014 RLS
policies, client grants and the core envelope wrappers") for review purposes,
not a lane that owes a commit. PR #6 does not merge before its verdict lands.
PR #6 also fails Grant Hygiene as of 19:5x — confirmed the exact finding:
`supabase/tests/test_014_rls_policies_and_client_grants.sql:513` defines a
`SECURITY DEFINER` function, which the guard flags because a test must not be
able to create the privilege escalation it exists to check for. The review
must explain or fix this before MERGE.

⚠ **Carried from the paused state, not re-verified this session.** Critic Part
2 (7 CRITICAL, 29 HIGH against 001–009 as of 2026-09-12) — whether 010–013
closed any of it is unconfirmed; recheck before 014 lands. `N-01`
(`pg_cron`/`pg_net`/`vector` extension enablement) and `knowledge_chunks.embedding`
(pgvector unavailable in the authoring environment, created conditionally with
a loud NOTICE on skip) were both still open as of the same date.

**Refs:** `supabase/HANDOFF.md`, `supabase/migrations/migration-catalog.md`,
`docs/architecture/01`–`06`, `apps/web/src/shared/api/rpcClient.ts`, `D-102`,
`D-111`, `D-112`, `D-113`.

---

## 🟢 API-PHASE — hosted apply gated on retrofit QA, web-swap in cloud (2026-09-13)

**Resume:** Read `ai/resume-brief.md` BLAST 19:25 entry, then
`ai/briefs/2026-09-13-api-phase-plan.md` (rulings R-A..R-G). Two cloud lanes,
neither with a PR yet as of 19:25: `cloud/web-swap` (enquiries → proposals →
approvals swapped from `@trainos/fixtures` onto the `TrainOsClient` seam) and
`cloud/migrations` (014–017, tracked under SUPABASE SCHEMA above — do not
duplicate that thread here). The first hosted apply (L3) runs only after 014
passes `migration-retrofit-qa`, via the Supabase MCP's `apply_migration`
against `balzmmsmrawzmefkavte` (ap-southeast-1). Two known negatives to check
before assuming either lane's environment is ready: the `.env.local` the
api-phase plan references does not exist at repo root, and `pg_isready` on
`/tmp:5432` reports no shim running, so a migrations lane must start one per
`supabase/HANDOFF.md`.

**Scope:** The API contract layer and the web app's swap from fixtures to a
real client: `packages/contract`, the `TrainOsClient` seam in `apps/web`, and
the hosted Supabase apply path.

**State:** `cloud/web-swap` opened PR #5 (`refactor(web): enquiries, proposals
and approvals through the TrainOsClient seam`); `cloud/migrations` opened PR
#6 (`feat(supabase): migrations 014–017`); `ci/gitleaks` opened PR #7 (`ci:
run gitleaks binary directly, no license needed`). Hosted project
`balzmmsmrawzmefkavte` is ACTIVE_HEALTHY with zero migrations applied. Still
open for the user: `core` exposed in the dashboard (R-F, confirmed live —
see SUPABASE SCHEMA above), n8n in the proposal.

⚠ **PR #5's CI is not "green except Gitleaks,"** and the root cause is
upstream of PR #5 entirely — **five checks fail on main, not four.** Checked
directly against run 34753909066 (`9fdcb4d`) job-by-job: Gitleaks (license),
Prettier (drift check), Vite build (artifact-upload step only — the build
itself passes), npm audit (high+, 8 vulnerabilities: 5 moderate, 1 high, 2
critical), **and Vitest (unit)** — missed in the first pass through this run
and confirmed only now: five wall-clock/timezone-dependent test failures
(`DateText.test.tsx`, `ClientProposalPage.test.tsx`, `knowledge.test.tsx`,
`AttendanceCapturePage.test.tsx` ×2), all assertions written against a
Malaysian wall clock with the runner's timezone unpinned. None of the five
came from PR #5's own diff. PR #5 and PR #6 both inherit all five from main.

**Fix lane's naming mismatch resolved, and its work is now IN PR #5's own
history, not a separate branch.** The `fix-pr5` worktree (branch `fix/pr5`,
never `fix/main-ci` as first reported) committed three fixes that are now
part of `cloud/web-swap`'s own commit list, confirmed via `gh pr view 5
--json commits`: `fix(web): format check-barrels.mjs so the Prettier drift
gate passes`, `fix(web): pin the suite timezone so wall-clock assertions
stop depending on the runner` (confirmed: `apps/web/vitest.config.ts` now
sets `TZ: "Asia/Kuala_Lumpur"`, with a comment citing the same tenant
default used elsewhere in the schema), and `ci: stop a shared
artifact-storage quota from failing the build and test gates` (confirmed:
`.github/workflows/ci.yml` sets `continue-on-error: true` on the
`upload-artifact` step, with a comment noting the quota is account-level and
"must not be able to report a green build as a red one"). Confirmed on
`origin/cloud/web-swap`: Gitleaks, Prettier and Vite build now pass on PR
#5's own CI run (34755634781); Vitest was still running at last check.

**npm audit ruling only partly implemented so far.** The plan as reported:
scope the CI step to `npm audit --omit=dev --audit-level=high` with the
three advisory ids (`GHSA-fx2h-pf6j-xcff` vite, `GHSA-5xrq-8626-4rwp`
vitest, plus `@vitest/coverage-v8`) in a comment, since all three are
dev-only; and land the vite 7 + vitest 3 upgrade as a separate draft PR
"chore(toolchain): vite 7 + vitest 3." **What's actually live on
`cloud/web-swap` right now is coarser than that plan**: the `deps-audit` job
just gained `continue-on-error: true` on the unchanged `npm audit
--audit-level=high` command — no `--omit=dev`, no comment with the GHSA ids.
No `chore(toolchain)` PR exists yet on GitHub as of this check (`gh pr list
--state all` shows none). Advisory content itself not independently
re-verified (which packages are dev-only) — recorded as reported, distinct
from what's confirmed live.

**PR #7 (`ci/gitleaks`) merged at `0910b9d`**, confirmed on main, fixing
Gitleaks repo-wide. Merge order: PR #5 → PR #6 (after `codex-review-014-017`'s
verdict) — PR #5 is now explicitly the vehicle that turns main green, per
the report and consistent with everything confirmed above.

**Refs:** `ai/briefs/2026-09-13-api-phase-plan.md`, `ai/resume-brief.md`,
`docs/architecture/07-api-layer-decision.md`,
`apps/web/src/shared/api/rpcClient.ts`, `apps/web/vitest.config.ts`,
`.github/workflows/ci.yml`.

---

## 🟢 SEEDS — new lane, fixture world for local/CI testing (2026-09-13)

**Resume:** Read `ai/resume-brief.md` BLAST 19:25/19:4x entries, then whatever
`lane/seeds` has committed under `supabase/seeds/`. Built against a shim on
port 5434 (separate from the other lanes' shims) so it does not collide with
`lane/rpc-018`'s or `cloud/migrations`'s. Serves the user's 19:27 goal, stated
directly: "write seeds too for test purposes."

**Scope:** `supabase/seeds/` — the fixture-world seed data, a wipe script, and
an executable pin, mirroring the pattern the migrations already use.

**State:** Launched at 19:2x (Opus, worktree
`~/Repos/personal-work/trainos-wt/seeds`, branch `lane/seeds`). No commits
reported yet.

**Refs:** `ai/resume-brief.md`, `supabase/HANDOFF.md`.

---

## 🟢 UI-CARRYOVER — three worktree lanes closing verifier-pass debt (2026-09-13)

**Resume:** Read `ai/resume-brief.md` §"Verifier carry-over" for the full
ranked list, then each lane's own commits on its branch. Each lane below runs
in its own worktree under `~/Repos/personal-work/trainos-wt/` and opens a PR
to main. `ui/tokens` (worktree `ui-tokens`): kit contrast tokens plus the
mono-uppercase reduction, closing the dark-sidebar contrast item that gates 34
of 40 failing routes. `ui/lists` (worktree `ui-lists`): HRD Corp and Invoices
list leaves (both nav leaves currently mount a detail and have no list),
Collections brought into §10b conformance, zebra striping on the two
hand-rolled tables. `ui/states` (worktree `ui-states`): the nine missing empty
states, the ten tone ternaries, the Drawer opening a primary scope, and
`ListToolbar` on the agent registry. None had a PR as of 19:25.

**Scope:** `apps/web/src/shared/components/kit/**` and the feature screens
each lane touches; no kit additions beyond what `ui/tokens` lands.

**State:** `ui/states` opened PR #8 ("fix(screens): empty states, tone
ternaries, drawer primary and the registry toolbar") at ~19:49, closing four
verifier-carry-over items. **MERGED at `a4ea833`** (confirmed: `gh pr view 8`
shows `state: MERGED`, `mergedAt` 2026-09-13T11:55:41Z), after `review-pr8`'s
MERGE verdict. The reviewer ran its own gates in an isolated worktree pinned
to `6dfd281` (the lane's actual tip, confirmed matching the earlier-recorded
`git worktree list` output) and reported typecheck clean and 1004 tests —
a different figure from the lane's own self-reported 1389 (28 new); not
reconciled here, recorded as two different counts from two different
checks rather than assumed to agree. The reviewer also recounted the tone
ternaries at 8 replaced, not 10, with the other two attributed to `ui/lists`
— consistent with what this thread already recorded independently below.
`ui-states` lane worktree is shut down (confirmed gone from disk).

**Three deviations from the verification doc, each confirmed against the
actual files:**

1. Verification doc §6 claimed `statusTone.ts` already had maps for all ten
   tone-ternary vocabularies. False — confirmed only one of the six new names
   used (`HRDC_PACKET_PANEL_TONE`) pre-existed anywhere in the kit; four new
   maps were appended to `apps/web/src/shared/components/kit/statusTone.ts`
   on `ui/states` (`AGENT_TONE`, `SEVERITY_TONE`, `MESSAGE_CATEGORY_TONE`,
   `HOURS_SAVED_TONE`), and a fifth, `PARTICIPANT_ATTENDANCE_TONE`, lives
   feature-local in `apps/web/src/features/engagements/attendanceModel.ts`.
   Approved as reported.
2. §6's kit-level "give `Drawer` a primary scope of its own" was deferred;
   `KnowledgeSourcesScreen.tsx` instead migrated to the `ProviderKeysScreen`
   pattern (a SECONDARY-labelled action standing in for a solid primary the
   kit's one-primary rule won't let it declare) — confirmed via the file's
   own comment explaining exactly this trade-off.
3. A real defect was fixed in `TnaDetailPage.tsx`: confirmed via the file's
   own comment that the old ternary "painted a DANGER constraint" as
   neutral; it now reads `SEVERITY_TONE[constraint.severity]`.

**Carried to other lanes, not dropped — listed at the bottom of PR #8:**
`EnquiryDetailPage`, `CostingWorksheetPage`, `QuotationsListPage` and three
M03 `ListToolbar` screens go to `cloud/web-swap` as follow-up;
`ClaimPacketScreen` and `CollectionsQueueScreen` go to `ui/lists`.

**PR #9 (`ui/tokens`) — MERGED at `ed3c337`, after `review-pr9`'s MERGE
verdict** (confirmed: `gh pr view 9` shows `state: MERGED`, `mergedAt`
2026-09-13T11:54:52Z). `ui-tokens` lane worktree is shut down (confirmed gone
from disk). 3 commits confirmed; file count is 35, not 33 as reported (a
small discrepancy, not disputed further — every substantive claim checked
out). No feature screen touched, confirmed (all 35 files are under
`kit/`, `styles/`, `tailwind.config.ts`, and one `docs/reviews/` doc).
Verified word-for-word against `docs/reviews/2026-09-13-verification.md` at
`ed3c337`:

- Rows 1b/1c closed exactly as reported — 1b: muted text on a selected row is
  now 6.54:1 light / 6.69:1 dark (was 4.36:1), via a `SELECTED_TINT` rebind of
  `--ink-muted` to `--ink-secondary` for that subtree; 1c: `--on-primary` on
  solid primary is now 4.82:1 dark (was 3.24:1), via a new `--primary-solid`
  / `--primary-solid-hover` token pair carrying the brand hex `#1F5BFF` in
  both themes, used only where the accent paints a fill under text.
- Contrast suite: confirmed exactly "49 cases, was 33" in the test file.
- Mono-caps counts confirmed exactly: `/dashboard` 29→11, `/sales/enquiries`
  34→21, `/compliance/hrd-corp` 22→12, `/finance/invoices` 36→22.
- The `/training/participants` "x275" figure is real (it's in the route
  table) but confirmed a false violation, exactly as reported: 350 of 354
  counted runs are `PAR-…`/`CERT-…` record references that §1 of the brief
  keeps in mono deliberately: there is no kit lever on them and none should
  exist.
- Two defects confirmed recorded, not fixed, because the owning files are
  outside this lane's scope: `--on-primary` on `--danger` is 2.22:1 in dark
  (the alias lives in `tailwind.config.ts`, which this lane owns, but the
  call site is `shared/components/ui/toast.tsx`, a shadcn primitive outside
  it); and `apps/web/src/shared/components/ui/button.tsx` has zero importers
  anywhere in the app (confirmed via `git grep`) — a dead second button
  vocabulary beside kit `Button`, the exact divergence CLAUDE.md names.

**PR #10 (`ui/lists`) confirmed open**, 5 commits, 17 files (both exact).
1009 passing / 110 test files confirmed verbatim in the PR body's own
Validation section; not independently re-run. Under review by `review-pr10`.
All deviations confirmed against the actual diff:

- Invoice totals moved to a `<dl>` under the table rather than table rows,
  because kit `DataTable` has no footer and a summary is not a line item —
  confirmed via the file's own comment citing "DECISIONS §7."
- The AI tier-assignment matrix lost its sticky first column and its staged-
  row `bg-ai-tint` on conversion to `DataTable`, because the kit has no
  sticky-column prop and no staged-row tint prop — confirmed via the diff's
  own "TWO THINGS THE CONVERSION COSTS" comment, which also notes
  `bg-ai-tint` specifically was AI-hue territory CLAUDE.md reserves, so it
  couldn't be improvised back in.
- `apps/web/tsconfig.strict.json` gained exactly three new paths (confirmed
  in the diff): `compliance/registers.ts`, `ClaimPacketsScreen.tsx`,
  `InvoicesListScreen.tsx`.
- Collections' `ListToolbar` sits above the DETAIL pane, not the table,
  because it spans the full width of a master/detail grid and constraining
  it to the table column would stack two bands — exactly what §10b forbids.
  Kept as-is; confirmed via the PR body's own explanation.
- `HRDC_RULE_CHANGES_PATH` confirmed to still carry the same "leaf opens the
  record" shape of defect that `HRDC_PACKET_PATH` had before this lane fixed
  it — confirmed via the file's own updated comment, which says so directly
  and marks it "NOT this pass's."

⚠ **Correction to this thread's own prior entry: follow-up (a) is not fully
resolved, only its kit half is.** The earlier record here said "drop (a)
rather than redo it" — too broad. What's true, confirmed by reading the
files directly: `MoneyText` itself has no `font-mono` (fixed by PR #9's
`5f01e57`, "labels take the UI font, numbers take tabular figures";
`Money.tsx` on main uses `tabular-nums` at both lines, ancestor of `ed3c337`).
But two SCREENS carry their own independent `font-mono` wrappers around
money/numeric columns that were never routed through `MoneyText` in the
first place, so PR #9's kit fix never touched them: `InvoiceDetailScreen.tsx`
hardcodes `font-mono` at ten call sites in its hand-rolled table (confirmed
at `a4ea833`) — this one closes as a side effect once PR #10's `DataTable`
conversion merges, since that table is exactly the one PR #10 replaces.
`ExecutiveDashboard.tsx` hardcodes `font-mono` at three call sites (confirmed
directly, lines 91, 349, 385) and has no lane currently touching it — this
one **stays open as a screen-level item**, tracked as verification doc §5
item 5 / §7 row 9, not a kit follow-up. Revised follow-up list: (a) DROP —
the kit half is done, the two screen instances are tracked separately, one
closing via PR #10 and one still open per above; (b) `DataTable`
`stickyFirstColumn` prop; (c) a master/detail variant of `ListToolbar`; (d)
`HRDC_RULE_CHANGES_PATH`'s leaf-opens-a-record defect, untested, unassigned;
(e) the kit-level `Drawer` primary scope PR #8 deferred; (f) the destructive
alias at 2.22:1 dark and the dead `ui/button.tsx`, both from PR #9.
Unverified by the `ui/lists` lane itself, per its own report: artboard
fidelity for its four screens, an axe pass, and the blue-budget rule.

**Refs:** `ai/resume-brief.md` (verifier carry-over section),
`docs/reviews/2026-09-13-verification.md`,
`apps/web/src/shared/components/kit/statusTone.ts`,
`apps/web/src/shared/components/kit/Money.tsx`,
`apps/web/src/shared/components/kit/tokens.ts`,
`apps/web/src/styles/tokens.css`.

---

## 🟢 CONTRACT BATCH — R1 to R8 landed; the reported gaps are the remainder (2026-09-12)

**Resume:** Work the contract gaps that R4 to R8 did not cover. Four of the
twelve reported are now closed by `e148a34`; the rest are listed in
`packages/fixtures/README.md`, together with the five places the contract's own
verbatim JSON examples contradict themselves. Take them as one batch, the way
R4 to R8 were taken, rather than one at a time as each screen trips over them.

⚠ **Corrected 2026-09-13, same day, concurrent lane.** This thread was written
while R4 and R5 were open and `e148a34` landed them a few minutes later — along
with R6, R7 and R8. R5's shape question is answered: `RunStatus` was widened
with a `RESUMABLE` member rather than the runtime's wrapper being blessed, so
the runtime can now stop reporting a yielded run as `RUNNING` with the real
disposition outside the contract. The agent runtime has not yet been changed to
use it; that is the first thing to do here.

**Scope:** `packages/contract` — the typed surface both the fixture client and
the Supabase schema code against. Types only; the sole runtime values are the
enum arrays, the endpoint table and the fixture ids.

**State:** R1 (`CREATE` normalises to `ADD`), R2 (`quotations`, not `costings`)
and R3 (`ACCOUNT_TRADING_HOLD`) landed on 12 September; R4 (`OPENROUTER` and
`OTHER` providers), R5 (`RESUMABLE` run status), R6 (both quotation floors plus
`bindingFloorBasis`), R7 (`Engagement.finance` optional,
`CollectionNextAction.type` widened) and R8 landed on 13 September in
`e148a34`. `packages/contract/src/enums.ts` generates 62 of the 69 database enum
types, so a change there is a migration — R4's two new provider members and R5's
new run status are therefore schema changes the paused Supabase lane inherits.

⚠ **Twelve contract gaps were reported rather than patched** across the fixtures
and screen lanes. Four are now closed by R6, R7 and R8: `Quotation` carries both
floors and `bindingFloorBasis`, `Engagement.finance` is optional so the OPS
projection types as an `Engagement`, and `CollectionNextAction.type` is widened
to `AnyActionType` so the collections ladder's final rung can name the action it
actually performs. The rest are listed in `packages/fixtures/README.md` and are
owed a batch of their own. Each of the four had a local decorator or `Omit<>`
standing in for it, and those come out with the ruling.

**Refs:** `packages/contract/**`, `packages/contract/README.md`, `57ef512`,
`273a12f`, `3d6e484`, `e148a34`, `D-108`, `D-109`, `D-110`.

---

## 🟢 VERIFIER PASS — never run, and now the only thing in front (2026-09-13)

**Resume:** Run a verifier over the whole tree with no premise taken from this
session's commit messages. The specific thing to check is not that the tests
pass — they do, locally — but that each lane's claims match its files, because
this session produced at least one commit whose message described an edit the
file did not receive (`B-007`). Start with the five claims in
`docs/reviews/2026-09-12-ui-blast-lane-review.md` marked "could not verify".

**Scope:** Independent verification of every lane. Deliberately a separate pass
in a separate context: CLAUDE.md's execution protocol forbids self-approval in
the same context that authored the work.

**State:** Deferred at the user's direction when the UI work took priority.
Nothing has verified any lane against any other lane's output. Picked up from
PARKED on 2026-09-13 once `d4ae83d` closed the consolidation: this is now the
work that gates everything else, including the Supabase resume.

⚠ **Every "green" claimed before 2026-09-13 19:40 was a local run only.**
CI now runs on every PR (see CI AND BRANCH PROTECTION below) and most jobs
pass there too, but that does not retroactively verify anything merged
earlier under a local-only claim.

**Refs:** `docs/reviews/2026-09-12-ui-blast-lane-review.md`,
`ai/findings-log.md`, `CLAUDE.md` execution protocols.

---

## ⏸ KIT DUPLICATE SWEEP — parked (2026-09-12)

**Resume:** Down to two files as of `d4ae83d`. Delete the two
`StandInField.tsx` stand-ins once the kit ships `TextField` and `DateField`,
then grep `apps/web/src/features/**` once more for anything else the kit now
exports — the screens' primaries capture typed
references and there is no kit input for them, which is why the stand-ins exist
at all. The showcase at `/dev/kit` is the inventory: a pattern not on that page
is not in the kit, and inventing it on a screen is the divergence CLAUDE.md
calls a defect.

**Scope:** `apps/web/src/shared/components/kit/**` and everything under
`features/` that duplicates it.

**State:** Was parked behind CONSOLIDATION, which was the same sweep on the data
layer and the more urgent half. That closed on 2026-09-13; this is now waiting
only on the two kit components, which is a real dependency rather than a
priority call.

**Refs:** `apps/web/src/features/finance/StandInField.tsx`,
`apps/web/src/features/hrdc/StandInField.tsx`, `/dev/kit`, `D-116`, `D-117`.

---

## ⛔ CI AND BRANCH PROTECTION — CI runs on every PR now; required checks still cannot be set (2026-09-13)

**Corrected 2026-09-13 ~19:40.** This thread's heading was stale: the pipeline
is no longer untested. The repo is `PARALLELPARADIGMS/alex-project` on
GitHub (not "trainos" — that name is only the local directory and the
`@trainos/*` package scope; searching GitHub for "trainos" finds nothing).
Confirmed directly against PR #5 (`gh pr checks 5`, run 34754549631, 19:40):
seventeen jobs run on every PR, most passing. See API-PHASE above for PR #5's
four real failures (Gitleaks license, Prettier drift, npm audit high+, Vite
artifact-upload quota).

**Resume:** Branch protection is still not achievable as things stand — a
person confirmed this 19:40: `gh api repos/.../branches/main/protection`
returns 403 "Upgrade to GitHub Pro or make this repository public to enable
this feature." So required-checks-on-`main` needs either a plan upgrade or
making the repo public, a decision for the user, before it can be set at all.
`VITE_SITE_URL` and `VITE_API_BASE_URL` as CI secrets is unconfirmed either
way — recheck before assuming they are set.

**Scope:** `.github/workflows/ci.yml`, branch protection, CI secrets.

**State:** Seventeen jobs are written and now run on every PR to main (PR #5,
#6, #7 confirmed). The three Supabase-coupled checks passed on PR #5. What
remains open: (1) branch protection is blocked on a plan/visibility decision,
not implementation; (2) **main itself has been red since `9fdcb4d`** (run
34753909066, confirmed 19:5x) on the same four checks PR #5 fails, so every
open PR inherits them regardless of its own diff — see API-PHASE for the fix
lane and the branch-name discrepancy found while verifying it.

⚠ **This is the one blocker that makes every other green claim provisional.**
The pipeline is decoration until the checks are required, and it is untested
until it has run once. A workflow file that has never executed is a hypothesis.

**Refs:** `.github/workflows/ci.yml`, `ai/state-backlog.md`, `CLAUDE.md` R10.
