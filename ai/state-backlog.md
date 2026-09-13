# State Backlog

> OPEN work only. Not settled decisions — those live in `ai/state.md` under
> Decisions. Not thread status — that lives in `ai/workstreams.md`. This file
> answers one question: what is owed, by whom, and what makes it due.
>
> Entry format: a bold dated headline, then prose saying what the gap is, what
> caused it, and what closing it needs. **Owner** is the lane that owes the
> work, never a person's name. **Trigger** is the event that makes it due — an
> item with no trigger is a wish, not a backlog entry.
>
> An item that settles moves OUT of this file into a `D-NNN` decision. An item
> that turns out to be a defect rather than a gap moves into
> `ai/findings-log.md` and comes back only if it needs work after the pin.
>
> The five scaffold-era items at the foot of this file are carried verbatim from
> `ai/state.md`'s Backlog section, which stays their home until that file is
> split. They are repeated here rather than moved so neither file is wrong.

---

## Deferred on 2026-09-12 when the UI work took priority

**CLOSED 2026-09-13 by `d4ae83d` (2026-09-12, consolidation) — `useApi` AND
`useAction` ARE DECLARED SEVEN TIMES.** The count was wrong and understated:
thirteen modules carried a copy, in four incompatible shapes. The boundary
defect this entry named as the root cause was real and was live — the fixture
client throws a `ContractError` for a refusal, every thrown value is an `Error`,
so a 403 was classified as a transport `UNKNOWN` and `ErrorState` drew a retry
button on a policy decision while replacing the server's sentence with
"Something went wrong". Pinned by a test that renders a 403 and asserts the
retry affordance is absent even when `onRetry` is passed. Recorded as `B-012`.
The scaffold's `TrainOsClient` interface and stub are deleted rather than
wired. Original text follows.

**~~OPEN~~ (2026-09-12, consolidation) — `useApi` AND `useAction` ARE DECLARED
SEVEN TIMES.** Seven feature `api.ts` files carry a private `useApi()` marked
`TEMPORARY SHAPE`, and `dashboard/client.ts` and `approvals/client.ts` each
carry a private `toApiError` adaptation. The root cause is one boundary defect,
not seven lapses: `shared/api/errors.ts` recognises only `ApiErrorException`, so
a thrown `ContractError` arrives as an unknown TRANSPORT error, every policy
refusal reads as a dropped connection and earns a retry button, and each lane
patched around it locally rather than blocking on another lane's file. Closing
it needs one `useApi` and one `useAction` in `src/shared/api`, structural
recognition of a `ContractError` rather than `instanceof` — which also fails
across a duplicated module instance — and then deletion of the nine local
copies.
**Owner:** the web lane. **Trigger:** now; this is the work in flight.
**Refs:** `D-115`, `B-012`, `d4ae83d`, `a9ba812`, `e811fd4`, `8b0716c`.

**OPEN (2026-09-12, verification) — NO LANE HAS BEEN VERIFIED BY ANYONE BUT
ITSELF.** Nine lanes ran in parallel and each reported its own work green.
CLAUDE.md forbids self-approval in the authoring context precisely because that
report is not evidence, and the verifier pass that was meant to supply the
evidence was deferred. What makes this more than procedure: this session
produced at least one commit whose message described an edit the file did not
receive, so a message is not a substitute for the file. Closing it needs a
verifier in a fresh context that takes no premise from any commit message.
**Owner:** a verifier lane, not yet dispatched. **Trigger:** now. This became
the front of the queue on 2026-09-13 when `d4ae83d` closed the consolidation,
and it gates the Supabase resume as well as the first real CI run.
**Refs:** `docs/reviews/2026-09-12-ui-blast-lane-review.md`, `D-121`, `B-007`.

**CLOSED 2026-09-13 by `e148a34` (2026-09-12, contract) — RULINGS R4 AND R5 ARE
UNAPPLIED.** Struck rather than deleted: R4 to R8 landed a few minutes after
this entry was written, from a concurrent lane in the same worktree, and a
reader who half-remembers the entry needs the correction rather than silence.
R5 widened `RunStatus` with a `RESUMABLE` member rather than blessing the
runtime's wrapper, so the open question below is answered. **The agent runtime
still reports a yielded run as `RUNNING` with the disposition outside the
contract, and that is now owed work** — moved to the contract thread in
`ai/workstreams.md`. Original text follows.

**~~OPEN~~ (2026-09-12, contract) — RULINGS R4 AND R5 ARE UNAPPLIED.** R4 adds
OPENROUTER to the provider vocabulary. R5 adds RESUMABLE as a run disposition,
and it carries a shape question that has to be answered rather than assumed: the
contract's `RunStatus` has no `RESUMABLE` member, so a yielded run currently
reports `RUNNING` on the `AutomationRun` with the disposition on the runtime's
own wrapper. R5 either widens `RunStatus` or blesses the wrapper; it must say
which, because the screens read `RunStatus`.
**Owner:** the contract lane. **Trigger:** before M18 agent screens are wired to
anything but fixtures.
**Refs:** `packages/contract`, `2fb7c51`, `ai/workstreams.md`.

**OPEN (2026-09-12, kit) — THE KIT DUPLICATE SWEEP HAS NOT RUN.** The kit
absorbed `ActionOutcome`, two tone maps, `formatDateRange` and the breadcrumb,
but no sweep has confirmed the features hold nothing else the kit now exports.
Two known survivors: `StandInField.tsx` exists twice, in finance and hrdc,
because no kit `TextField` or `DateField` exists and those screens' primaries
capture typed references.
**Owner:** the kit lane. **Trigger:** when the kit ships `TextField` and
`DateField`, which is what the stand-ins are waiting on. Down to those two files
as of `d4ae83d`; the data-layer half of this sweep is closed.
**Refs:** `apps/web/src/shared/components/kit/**`, `/dev/kit`, `D-116`.

**OPEN (2026-09-12, supabase) — MIGRATIONS 010 TO 016 ARE NOT WRITTEN, AND 001
TO 009 CARRY SEVEN UNAPPLIED RULINGS.** The lane paused at 009. Seven rulings
from the critic and the cross-lane settlement were never applied to the
migrations that exist, the most consequential being that 001 never gained
`pg_cron`, `pg_net` or `vector`, so nine scheduled jobs have no scheduler and
nothing in the outbox is ever claimed. Roughly twenty-five migration functions
also use the four-part `search_path` list and therefore fail doc 02 §8.7's
exact-string sweep — the gate both lanes depend on contradicts the migrations it
gates, and one spelling has to win.
**Owner:** the supabase lane. **Trigger:** when the UI work frees quota; the
handoff is written and cold-startable now.
**Refs:** `supabase/HANDOFF.md`, `docs/architecture/06-critic-review.md` Part 2,
`D-111`.

**OPEN (2026-09-12, contract) — EIGHT CONTRACT GAPS ARE STILL REPORTED, NOT
PATCHED.** Corrected 2026-09-13: four of the original twelve were closed by R6,
R7 and R8 in `e148a34`, and each took a local decorator or `Omit<>` out with it.
`Quotation` now carries both floors and `bindingFloorBasis`,
`Engagement.finance` is optional so the OPS projection types as an
`Engagement`, and `CollectionNextAction.type` is widened to `AnyActionType`. The
original entry read:

> The fixtures and screen lanes each hit places where the typed surface
> cannot express what the design or the rulings require, and reported rather
> than widened the contract unilaterally — which was right, and leaves the gaps
> open. Named ones: `Quotation` cannot say which floor binds;
> `Engagement.finance` is required, so the OPS projection needs its own type
> rather than a zeroed block; `CollectionNextAction.type` cannot hold the ruled
> action; and there is no permission vocabulary beyond `QUOTATION_PERMISSIONS`.
> Five places where the contract's own verbatim JSON examples are internally
> inconsistent are recorded alongside them.

**Owner:** the contract lane. **Trigger:** as one batch, the way R4 to R8 were
taken — not one at a time as each screen trips over them.
**Refs:** `packages/fixtures/README.md`, `1c73e18`, `705c54c`.

**OPEN (2026-09-13, contract) — `AlternativeCategoryRate` CANNOT CARRY THE RATE
IT DOCUMENTS.** The type holds `ratePerMessage: Money` and nothing else, while
the doc comment five lines above it in the same file already promises the
opposite: "expressed in minor units rounded to the sen at estimate time, with
the exact rate returned as a string for display." There is no such string. So
`WhatsAppCostStrip` renders RM 0.35 where the pack draws RM 0.3467, and it is
right to: under the two-decimal money rule a `Money` of 35 sen has no fourth
decimal to show. This is a contract gap, NOT a screen defect — do not send it
back to the web lane as a rounding bug. Closing it means adding the
exact-decimal string beside the `Money`, as the comment already says it does,
and having the fixture emit it.
**Owner:** the contract lane. **Trigger:** with the batch above, not on its own
— it is the same shape as the named gaps there.
**Refs:** `packages/contract/src/domain/enquiries.ts:176-186`,
`apps/web/src/shared/components/kit/WhatsAppCostStrip.tsx:40`.

**OPEN (2026-09-12, supabase) — `knowledge_chunks.embedding` DOES NOT EXIST.**
pgvector was unavailable in the authoring environment, so the column and its
HNSW index are created conditionally with a loud NOTICE on skip. It is the one
object in migrations 001 to 009 not executed in its intended form, which means
semantic search over the knowledge corpus is unexercised end to end.
**Owner:** the supabase lane. **Trigger:** the first environment with pgvector
available — re-run 009 there before trusting the corpus.
**Refs:** `261d166`, `supabase/migrations/migration-catalog.md`.

**OPEN (2026-09-13, docs) — `ai/state.md` IS CARRYING FOUR JOBS.** Backlog,
decisions, session log and now twenty-one compact rulings are in one file, and
this backlog file exists beside it. That is the named split trigger from
`docs/research/05-doc-spine.md` §5 half-taken: the backlog and the journal have
moved out, the decisions have not.
**Owner:** the docs lane. **Trigger:** when the next reader has to scroll past
the decisions to reach the session log — or at `D-130`, whichever comes first.
Split to `ai/decisions.md` then, and leave a pointer.
**Refs:** `docs/research/05-doc-spine.md` §5, `ai/state.md`.

---

## Carried from the scaffold (2026-09-12), still open

These are the five items `ai/state.md` recorded when the repository floor
landed. They are unchanged and are repeated here in summary so this file is a
complete answer to "what is owed". `ai/state.md` holds the full text.

**OPEN (2026-09-12, scaffold) — BRANCH PROTECTION IS NOT ON.** No file in this
repository can close this. Until a person marks the blocking checks required on
`main`, a green run is a badge and not custody — and since there is no remote,
the seventeen-job pipeline has still never executed even once.
**Owner:** a person with host settings access. **Trigger:** before the first
merge that matters.

**OPEN (2026-09-12, scaffold) — THE `compliance` NAV ROLE IS UNREACHABLE.** The
design pack's ROLE map has six keys; the contract's `Role` union has nine
values and none maps to `compliance`. Somebody who knows the organisation has to
say whether the contract needs the role or the pack's key is dead.
**Owner:** the client, via the decisions register.
**Trigger:** before route-level role guards are wired, since the guard will need
to name it.

**OPEN (2026-09-12, scaffold) — SIX DARK TOKENS ARE DERIVED, NOT SOURCED.** The
pack's dark map gives only the text colour for warning and danger, so their dark
chip fills and four chip borders were derived at the same lightness step as
their sourced neighbours and marked DERIVED in place.
**Owner:** a designer. **Trigger:** before the first dark screenshot is treated
as canonical — which the twenty-seven screens have now made urgent, since every
one of them was captured in dark.

**OPEN (2026-09-12, scaffold) — 8 npm ADVISORIES, 2 CRITICAL, ALL IN DEV
TOOLING.** Every one is a dev-server or test-runner exposure, not a shipped
bundle vulnerability. Clearing them means Vite 8 and Vitest 5, two majors past
the house stack, so `deps-audit` is advisory on purpose. Until then: do not
expose the dev server or the Vitest UI on an untrusted network.
**Owner:** the house, not TrainOS. **Trigger:** the next house stack upgrade.

**OPEN (2026-09-12, scaffold) — NO COVERAGE FLOOR YET.** Deliberate: a threshold
set before there is anything to measure kills test culture before it forms.
**Owner:** the web lane. **Trigger:** now overtaken by events — there are 409
web tests, 116 fixtures tests, 101 agent-runtime tests and 213 kit tests, so the
"roughly 5 to 10 tests" condition passed some time ago. Set the first floor from
the current numbers and ratchet.

**OPEN (2026-09-12, scaffold) — ROUTE-LEVEL ROLE GUARDS ARE NOT WIRED.** The nav
is role-filtered but every route mounts for anyone who types the URL. That was
correct when there was no session and no data. Twenty-seven screens now exist
and one of them, the programmes record, already renders a role-gated refusal in
its own body — so the app now has two role mechanisms and only one of them is
at the route.
**Owner:** the web lane. **Trigger:** the moment the HTTP client lands. Guards
wrap the element, not the path.

- [ ] **Design tightening pass** (13 Sep, user-endorsed critique): see docs/design/2026-09-13-design-tightening-brief.md — kit typography/radius/surface tokens, flatten containers, sidebar two-mechanism hierarchy, table typography; Collections page is the reference. Owner: next session, first UI item after verifier.
- [ ] Fixtures: default MD persona → Alex Selvarajah (brief §13); demo index narrated to him.
- [ ] Screens: zebra rows + inline workflow strips per artboard (brief §11).
- [ ] i18n pass: full EN/BM catalogue for all 27 screens + portal (brief §17); native BM review.
