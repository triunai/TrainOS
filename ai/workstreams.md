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

## 🟢 CONSOLIDATION — the duplicates the parallel build left behind (2026-09-13)

**Resume:** Move one `useApi` and one `useAction` into `src/shared/api`, then
make `shared/api/errors.ts` recognise a `ContractError` structurally rather than
by `instanceof`. Then delete the seven local `useApi()` copies marked `TEMPORARY
SHAPE` in the feature `api.ts` files, the two private `toApiError` adaptations
in `dashboard/client.ts` and `approvals/client.ts`, and
`useBadgeCounts.ts`'s own note that it should be reading the shared hook.

**Scope:** Anything that exists in more than one feature and should exist once.
CLAUDE.md's consolidation rule is the standing instruction: when two variants of
one pattern exist, the newer one wins and the older is migrated in the same pass.

**State:** The kit has already absorbed `ActionOutcome` (five copies, three
divergent), `ENQUIRY_TONE` and `FOLLOW_UP_TONE` (four copies), `formatDateRange`
(two copies) and the breadcrumb (five screens drew their own). The working tree
carries the finance and hrdc `ActionOutcome` deletions for the current pass.
`useApi`/`useAction` is the last one and the largest.

⚠ **The error split is the load-bearing part, not the hook.** `toApiError`
recognises only `ApiErrorException`, so a thrown `ContractError` arrives as an
unknown TRANSPORT error — every policy refusal reads as a dropped connection and
earns a retry button, which is the R2 collapse CLAUDE.md names. Two features
already patch around it locally. Fix it at the boundary or the patches multiply.

**Refs:** `apps/web/src/shared/api/errors.ts`,
`apps/web/src/features/*/api.ts`, `D-115`, `ai/state-backlog.md`.

---

## 🟢 CONTRACT BATCH — R1 to R3 landed, R4 and R5 open (2026-09-12)

**Resume:** Apply contract ruling R4 (OPENROUTER as a provider vocabulary
member) and R5 (RESUMABLE as a run disposition). R5 has a known shape problem
worth reading before starting: the contract's `RunStatus` has no `RESUMABLE`
member, so the agent runtime currently reports a yielded run as `RUNNING` on the
`AutomationRun` and carries the disposition on its own wrapper, the same
arrangement `haltedBy` uses. Decide whether R5 widens `RunStatus` or blesses the
wrapper, and say which in the ruling.

**Scope:** `packages/contract` — the typed surface both the fixture client and
the Supabase schema code against. Types only; the sole runtime values are the
enum arrays, the endpoint table and the fixture ids.

**State:** R1 (`CREATE` normalises to `ADD`), R2 (`quotations`, not `costings`)
and R3 (`ACCOUNT_TRADING_HOLD`) are applied. `packages/contract/src/enums.ts`
generates 62 of the 69 database enum types, so a change there is a migration.

⚠ **Twelve contract gaps were reported rather than patched** across the fixtures
and screen lanes, including that `Quotation` cannot say which floor binds, that
`Engagement.finance` is required so the OPS projection needs its own type, and
that `CollectionNextAction.type` cannot hold the ruled action. They are listed
in `packages/fixtures/README.md` and are owed a batch of their own.

**Refs:** `packages/contract/**`, `57ef512`, `273a12f`, `3d6e484`,
`D-108`, `D-109`, `D-110`.

---

## ⏸ VERIFIER PASS — never run (2026-09-12)

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
Nothing has verified any lane against any other lane's output.

⚠ **Every "green" in this repository is a local run.** See CI below.

**Refs:** `docs/reviews/2026-09-12-ui-blast-lane-review.md`,
`ai/findings-log.md`, `CLAUDE.md` execution protocols.

---

## ⏸ KIT DUPLICATE SWEEP — parked (2026-09-12)

**Resume:** Grep `apps/web/src/features/**` for anything the kit now exports and
delete the local copy, then delete the two `StandInField.tsx` stand-ins once the
kit ships `TextField` and `DateField` — the screens' primaries capture typed
references and there is no kit input for them, which is why the stand-ins exist
at all. The showcase at `/dev/kit` is the inventory: a pattern not on that page
is not in the kit, and inventing it on a screen is the divergence CLAUDE.md
calls a defect.

**Scope:** `apps/web/src/shared/components/kit/**` and everything under
`features/` that duplicates it.

**State:** Parked behind CONSOLIDATION, which is the same sweep on the data
layer and is the more urgent half.

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
