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

## ⏸ SUPABASE SCHEMA — paused at migration 009 of 016 (2026-09-12)

**Resume:** Read `supabase/HANDOFF.md` in full, then
`docs/research/04-supabase-conventions.md`, then
`docs/architecture/06-critic-review.md` Part 2. Apply the seven open rulings the
handoff lists — starting with `N-01`, which is the only CRITICAL that blocks the
rest: migration 001 never gained `pg_cron`, `pg_net` or `vector`, so nine
scheduled jobs have no scheduler and nothing in the outbox is ever claimed. Then
write 010 finance, 011 action envelope, 012 events/outbox, 013 ai-ops, 014 RLS,
015 realtime+cron, 016 seed. **Do not apply to any remote project.**

**Scope:** Everything under `supabase/`. Migrations, rollbacks, the executable
pins, the catalog, and the architecture documents they implement.

**State:** 001 to 009 authored and EXECUTED against a local PostgreSQL 17.11
shim with a Supabase platform shim. No Supabase CLI and no Docker were
available, so nothing ran against a real Supabase stack and nothing was applied
to any hosted database. Every migration carries its own pin; all pins green.

⚠ **Critic Part 2 is open: 7 CRITICAL and 29 HIGH.** The four that matter most
are `N-01` (extensions never enabled), `N-05` (roughly 25 migration functions
use the four-part `search_path` list and fail doc 02 §8.7's exact-string sweep,
so the gate both lanes depend on contradicts the migrations it gates), `N-02`
(doc 05 has no constraint of any kind on any of its fourteen structured jsonb
columns) and `N-04` (doc 01 still carries the snapshot rule-versioning model
that doc 04 tested and rejected).

⚠ **`knowledge_chunks.embedding` was never created.** pgvector is unavailable in
the authoring environment. It is created conditionally with a loud NOTICE on
skip, and it is the one object in the whole set not executed in its intended
form.

**Refs:** `supabase/HANDOFF.md`, `supabase/migrations/migration-catalog.md`,
`docs/architecture/01`–`06`, `D-102`, `D-111`, `D-112`, `D-113`.

---

## ✅ UI SCREENS — twenty-seven screens across fourteen features (2026-09-12)

**Resume:** Nothing. This thread is closed; what is left of it lives in
CONSOLIDATION below.

**Scope:** Every screen the design-pack inventory §4 names, built from the kit
and reading only `@trainos/fixtures`, with render tests and light and dark
screenshots at 1440x900.

**State:** All fourteen features declare their own route array and appear once
in `FEATURE_ROUTES`. The three feature folders that were sitting untracked were
committed with their route files rather than separately, because a route file
that lazy-imports a feature absent from the same commit is a commit that does
not build.

⚠ **These screens have only ever been seen against fixtures.** Every number,
refusal and empty state on them comes from the in-memory client. Nothing has
been rendered against a real API response, and the data boundary the scaffold
built is not in the path — see CONSOLIDATION.

**Refs:** `apps/web/src/features/**`, `apps/web/src/routes/routes.tsx`,
`docs/research/09-design-pack-inventory.md`, `docs/design/REPORT.md`,
`docs/design/DECISIONS.md`, `D-114`, `D-116`.

---

## ✅ CONSOLIDATION — one data seam, closed by `d4ae83d` (2026-09-13)

**Resume:** Nothing on the data layer. What remains of the consolidation idea
lives in KIT DUPLICATE SWEEP below, which is down to two files.

**Closed 2026-09-13 10:40.** Thirteen modules had grown their own copy of the
client hook in four incompatible shapes — seven with a private role table, three
ignoring the role toggle, one with a different return type, three importing the
singleton and skipping the hook. `shared/api/useApi.ts` is the only one now and
`ApiProvider` is mounted at the root. The scaffold's `TrainOsClient` interface
and its all-`NOT_IMPLEMENTED` stub are deleted: they described a boundary the
app had outgrown, and a second client surface beside the real one is the
divergence CLAUDE.md forbids.

**Scope:** Anything that exists in more than one feature and should exist once.
CLAUDE.md's consolidation rule is the standing instruction: when two variants of
one pattern exist, the newer one wins and the older is migrated in the same pass.

**State:** The kit has already absorbed `ActionOutcome` (five copies, three
divergent), `ENQUIRY_TONE` and `FOLLOW_UP_TONE` (four copies), `formatDateRange`
(two copies) and the breadcrumb (five screens drew their own). `af92507` landed
the last three `ActionOutcome` deletions — finance, hrdc and engagements — and
moved the five screens that drew their own `Breadcrumb` onto the shell's slot.
`useApi`/`useAction` is the last duplicate and the largest.

⚠ **The error split was the load-bearing part, and it was a live defect, not a
tidiness problem.** The fixture client throws a `ContractError` for a refusal;
every thrown value is an `Error`, so `toApiError`'s `instanceof` check
classified a 403 as a transport `UNKNOWN` — and `ErrorState` reads exactly that
classification to decide whether to draw "Try again". A policy decision came
with a retry button, and the server's sentence naming the missing role and
permission was replaced with "Something went wrong". Pinned as `B-012`.

**Refs:** `apps/web/src/shared/api/useApi.ts`,
`apps/web/src/shared/api/errors.ts`, `d4ae83d`, `af92507`, `D-115`, `B-012`.

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
