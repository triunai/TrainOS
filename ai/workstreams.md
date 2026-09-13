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
anything to the hosted project before that QA gate passes.**

**Scope:** Everything under `supabase/`. Migrations, rollbacks, the executable
pins, the catalog, and the architecture documents they implement.

**State:** 001–013 authored, EXECUTED against a local PostgreSQL 17.11 shim,
and committed to main (013 in `bc15b17`). 014–017 (RLS, realtime+cron, and the
remainder) are being written by cloud lane `cloud/migrations`, no PR yet as of
19:25. 018 (the RPC pack) has the user's go-ahead as of 19:23 and is running in
worktree lane `lane/rpc-018` at `~/Repos/personal-work/trainos-wt/rpc-018`.
Nothing has been applied to any hosted database.

⚠ **Carried from the paused state, not re-verified this session.** Critic Part
2 (7 CRITICAL, 29 HIGH against 001–009 as of 2026-09-12) — whether 010–013
closed any of it is unconfirmed; recheck before 014 lands. `N-01`
(`pg_cron`/`pg_net`/`vector` extension enablement) and `knowledge_chunks.embedding`
(pgvector unavailable in the authoring environment, created conditionally with
a loud NOTICE on skip) were both still open as of the same date.

**Refs:** `supabase/HANDOFF.md`, `supabase/migrations/migration-catalog.md`,
`docs/architecture/01`–`06`, `D-102`, `D-111`, `D-112`, `D-113`.

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

**State:** `cloud/web-swap` in flight, no PR yet. Hosted project
`balzmmsmrawzmefkavte` is ACTIVE_HEALTHY with zero migrations applied. Still
open for the user: `core` exposed in the dashboard (R-F), n8n in the proposal.

**Refs:** `ai/briefs/2026-09-13-api-phase-plan.md`, `ai/resume-brief.md`,
`docs/architecture/07-api-layer-decision.md`.

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

**State:** All three launched at 19:25, no commits reported yet. On landing,
fold each into the kit per CLAUDE.md's consolidation rule rather than leaving
a per-feature copy.

**Refs:** `ai/resume-brief.md` (verifier carry-over section),
`docs/reviews/2026-09-13-verification.md`.

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

⚠ **Every "green" in this repository is a local run.** See CI below.

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

## ⛔ CI AND BRANCH PROTECTION — the pipeline has never executed (2026-09-12)

**Resume:** A person has to do this; nothing in this repository can. Create the
remote, push, then mark the blocking checks required on `main` in the host's
settings and set `VITE_SITE_URL` and `VITE_API_BASE_URL` as CI secrets. Only
then is the first real run of the seventeen jobs meaningful.

**Scope:** `.github/workflows/ci.yml`, branch protection, CI secrets.

**State:** Seventeen jobs are written, the summary job hard-fails on `failure`,
`cancelled` **and** `skipped`, and the three Supabase-coupled checks run clean
locally against migrations 001 to 009. None of that has ever run in CI.

⚠ **This is the one blocker that makes every other green claim provisional.**
The pipeline is decoration until the checks are required, and it is untested
until it has run once. A workflow file that has never executed is a hypothesis.

**Refs:** `.github/workflows/ci.yml`, `ai/state-backlog.md`, `CLAUDE.md` R10.
