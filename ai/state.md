# State

> Backlog, decisions and session log in one file until it outgrows this shape.
>
> Split triggers, stated once so nobody re-derives them under pressure:
> backlog + decisions + log tangled past readability → split into
> `state-backlog.md` and `decisions.md`. More than ~5 threads in flight →
> add a `workstreams.md` parkable board. More than ~5 living docs to route
> between → promote the routing table out of `CLAUDE.md`. A review sweep
> producing more than a couple of findings → open a
> `docs/reviews/YYYY-MM-DD-{slug}/` lane folder.

## Backlog

**OPEN (2026-09-12, scaffold) — BRANCH PROTECTION IS NOT ON.** The CI pipeline
hard-fails correctly, including on `skipped`, but nothing requires it. Until a
person marks the blocking checks required on `main` in the host's settings, a
green run is a badge and not custody. No file in this repo can close this.

**OPEN (2026-09-12, scaffold) — THE `compliance` NAV ROLE IS UNREACHABLE.** The
design pack's ROLE map has six keys; the contract's `Role` union has nine
values, and none of them maps to `compliance`. The key is kept verbatim in
`navTree.ts` because it is source. Either the contract needs a compliance role
or the pack's key is dead — somebody who knows the org has to say which.

**OPEN (2026-09-12, scaffold) — SIX DARK TOKENS ARE DERIVED, NOT SOURCED.** The
pack's dark map gives only the text colour for warning and danger, so their dark
chip fills and four chip borders were derived at the same lightness step as
their sourced neighbours. Marked DERIVED in `tokens.css`. A designer should
confirm or replace them before the first dark screenshot is treated as
canonical.

**OPEN (2026-09-12, scaffold) — 8 npm ADVISORIES, 2 CRITICAL, ALL IN DEV TOOLING.**
`npm audit` reports critical findings against `vitest` and `@vitest/coverage-v8`
and high findings against `vite`, plus moderate ones against `react-router`.
Every one is a dev-server or test-runner exposure, not a shipped-bundle
vulnerability: the paths are the Vite dev server's file handling, the Vitest UI
server, and a `@vitest/mocker` redirect. None of that code reaches production.
Clearing them means Vite 8 and Vitest 5, two major versions past the house stack
this repo was told to mirror, so the `deps-audit` CI job is advisory on purpose.
Closing this is a stack-upgrade decision for the whole house, not a TrainOS one.
Until then: do not expose the dev server or the Vitest UI on an untrusted
network.

**OPEN (2026-09-12, scaffold) — NO COVERAGE FLOOR YET.** Deliberate: a
threshold set before there is anything to measure kills test culture before it
forms. Set the first floor once roughly 5 to 10 tests have landed, then ratchet.

**OPEN (2026-09-12, scaffold) — ROUTE-LEVEL ROLE GUARDS ARE NOT WIRED.** The nav
is role-filtered but every route mounts for anyone who types the URL. That is
correct today — there is no session and no data — and must not stay true once
the HTTP client lands. Guards wrap the element, not the path.

**OPEN (2026-09-13, PR #23/fix-014) — MIGRATION 016's HARDCODED `dated` REF
PREFIXES CONFLICT WITH THE DOMAIN MODEL.** `016`'s hardcoded `dated` flag
list disagrees with `docs/architecture/01-domain-model.md` on whether
several prefixes (`OPP`, `FUP`, `ENG`, `SES` among them) should be treated
as date-bearing refs. Refs are immutable once allocated, so a wrong value
here ships a permanent per-tenant defect from day one. The original
015-017 review flagged this itself as "not independently confirmed by the
security pass," and `fix-014` deliberately left it unfixed pending a human
call rather than guessing. Needs someone who knows the domain model to
rule which prefixes are actually dated before 016 merges.

## Decisions

<!-- Latest first. SUPERSEDE, never delete. -->

### Rulings applied on 2026-09-12, compact form

Twenty-one rulings were settled in one day across nine parallel lanes. Written
out at the length of `D-100` and `D-101` below they would bury the two entries
that already carry their full reasoning, so each is recorded here as one dated
line naming the document or commit that carries the argument. Promote one to the
long form the moment it is challenged, superseded or asked about twice.

**D-102 · Domain tables live in schema `core` · ACTIVE (2026-09-12).** `public`
keeps identity and tenancy, `app` keeps what only workers touch, and `core` is
the only schema exposed to PostgREST; doc 03 names it across its own executable
SQL and outranks doc 02, which wrote the same tables as `public.*`. Refs:
`docs/architecture/03`, `supabase/config.toml`, `2a24c76`, `d896b07`.

**D-103 · The tenant reader is `app.current_tenant_id()` · ACTIVE
(2026-09-12).** Three lanes had three names for one function; the gate calls
`app.require_tenant_id()` when absence is an error. Refs:
`docs/architecture/02`, `2e2ef37`, `d0ccf30`.

**D-104 · Write-back is `app.report_effect_result(effect_id, status, result,
error)` · ACTIVE (2026-09-12).** Keyed on the effect's primary key, so the
function needs no lookup and no composite string to parse; `job_key` stays on
the outbox row as the dedupe key, which is a different job from addressing.
Refs: `docs/architecture/03` §2.7, `docs/architecture/05`, `ffa29a6`, `2357080`.

**D-105 · `app.effect_applier` is the only applier key · ACTIVE (2026-09-12).**
`trainos.unlock_action_id` is withdrawn. A boolean in a session variable is the
caller's own assertion; an action request id resolved against a table the caller
cannot write is evidence, and it covers the attendance unlock too. Refs:
`docs/architecture/01`, `03`, `9c8d80b`, `ca85480`.

**D-106 · Two independent price floors, both generated, with
`binding_floor_basis` naming which one binds · ACTIVE (2026-09-12).** One
absolute commercial figure, one derived from cost and the margin floor; both are
computed in the database so the costing screen and the approval screen cannot
disagree about the limit. Refs: `docs/architecture/04`, `5549a35`, `1c73e18`.

**D-107 · Agents authenticate by GoTrue sign-in, never by self-minted JWTs ·
ACTIVE (2026-09-12).** The spike confirmed self-minting is supported and uses
one project-wide signing key whose `role` claim may be set to `service_role`, so
a holder could mint a BYPASSRLS token and void every policy in the design. An
external OIDC issuer narrows the blast radius and does not remove the exposure.
Refs: `docs/architecture/spikes/2026-09-12-agent-jwt-minting.md`, `284e275`,
`f5cc811`, `5608025`.

**D-108 · The table and the path are `quotations`, not `costings` · ACTIVE
(2026-09-12).** Contract ruling R2. `core.quotations` and `/v1/quotations`,
including the `quotation:read`/`write`/`apply` permission strings — a contract
change, not only a schema one. Refs: `273a12f`, `84416db`, `9c8d80b`.

**D-109 · `CREATE` normalises to `ADD`, so `DiffLine.op` and `Effect.op` are one
union · ACTIVE (2026-09-12).** Contract ruling R1. Contract §7 requires
`effects[]` to equal `diff[]`, which two vocabularies for the same operation
would make impossible to assert. Refs: `packages/contract`, `57ef512`.

**D-110 · `ACCOUNT_TRADING_HOLD` is the 22nd action type, MD-gated · ACTIVE
(2026-09-12).** Contract ruling R3. The collections ladder previously gated a
trading hold on `REMINDER_SEND` with a `TRADING_HOLD` stage, which made its most
consequential step a variant of sending a message. Refs: `3d6e484`, `d896b07`,
`cf2ed54`, `5da2fff`.

**D-111 · Every function sets `search_path = ''`, and the CI assertion compares
the exact stored string · ACTIVE (2026-09-12).** Measured on PostgreSQL 17.11,
not reasoned about. The quoted list form `'app, pg_catalog'` is not a two-schema
path but a one-schema path naming a schema that does not exist, so it silently
resolves nothing while looking more careful than the correct spelling — and a
`proconfig IS NOT NULL` test passes all three spellings including the broken one.
The assertion must be containment of the literal `search_path=""`, not
positional, because a function that also sets `statement_timeout` moves the
entry off index 1. Refs: `docs/architecture/02` §8.7, `4192381`, `5eec24f`,
`a5b9521`, `e532d09`.

**D-112 · Every jsonb CHECK asserts key presence · ACTIVE (2026-09-12).** A
naive `->> 'mode' IN (...)` constraint passes when the key is absent: `->>`
yields NULL, `NULL IN (...)` yields NULL, and a CHECK evaluating to NULL PASSES.
Ruling R-JSONB. Pinned in migration 007 on the exact payload the naive
constraint lets past. Refs: `docs/architecture/04`, `9c8d80b`, `5549a35`.

**D-113 · Compliance rules are bitemporal: validity and known are separate
ranges · ACTIVE (2026-09-12).** A circular published in November can change a
rule taking effect the following January, and a claim assessed in October must
still re-check as correct. One time axis makes re-checking an old engagement
silently re-decide it, and the audit trail then calls the original decision a
mistake. A GiST exclusion over both axes makes "which rule applied" have exactly
one answer. Refs: `docs/architecture/04`, `261d166`,
`supabase/migrations/migration-catalog.md`.

**D-114 · `FEATURE_ROUTES` is spread before the generated nav placeholders, and
`PUBLIC_ROUTES` is a sibling of the shell · ACTIVE (2026-09-12).** React Router
scores two identical paths the same and breaks the tie on declaration order, so
a real screen mounted after the placeholder list loses to `PlaceholderPage` on
its own path. The client portal at `/p/:token` mounts outside `AppShell` because
a client with no account has nothing to navigate to. Refs:
`apps/web/src/routes/routes.tsx`, `6816188`.

**D-115 · One `useApi` and one `useAction`, in `src/shared/api` · ACTIVE, landed
`d4ae83d` (2026-09-13).** Thirteen modules carried a copy in four incompatible
shapes, not the seven first counted, and the boundary defect below turned out to
be live rather than cosmetic — see `B-012`. `ApiProvider` is mounted at the
root; the scaffold's `TrainOsClient` interface and its all-`NOT_IMPLEMENTED`
stub are deleted rather than wired, because they described a seam the app had
outgrown. The entry as first written: Seven feature `api.ts` files declare a private `useApi()` marked
`TEMPORARY SHAPE` and two `client.ts` files carry their own `toApiError`. The
consolidation also has to make `shared/api/errors.ts` recognise a
`ContractError` structurally, since `instanceof` fails across a duplicated
module instance and a refusal then arrives as a transport error with a retry
button on it. Refs: `a9ba812`, `e811fd4`, `8b0716c`, `ai/state-backlog.md`.

**D-116 · `ActionOutcome` lives in the kit, not per feature · ACTIVE
(2026-09-12).** Five features wrote it independently and three had already
diverged. It takes described data rather than a thrown value, so it imports
nothing from the API layer and can be rendered in a test or a showcase; the
load-bearing rule it carries is that a QUEUED action is a SUCCESS, because
rendering it as a failure is how an approval queue becomes invisible. Refs:
`apps/web/src/shared/components/kit/ActionOutcome.tsx`, `efe8ad2`, `dc71db6`.

**D-117 · No bar in the kit is ever green · ACTIVE (2026-09-12).** Every bar in
the artboards is ink; amber and red appear only as a limit nears. A completeness
bar at 100% is not an achievement, it is a blocker that stopped blocking, and
`BarState` refuses `success` by type rather than by comment. Refs:
`apps/web/src/shared/components/kit`, `e2ae358`.

**D-118 · Status colour is confined to the reading surface, stated as
`StatusChip.tsx` states it · ACTIVE (2026-09-12).** The docblock previously
claimed the three status tokens appear in that file and nowhere else and offered
a grep to prove it; the grep disproved it at thirteen files. Outside the chip
they are legitimate in three shapes that ARE the status rather than decoration
on it — a banner whose whole row is the state, a single textless mark, and an
error that must reach the eye at the field. The check that replaced it is one a
screen can fail: a status fill anywhere under the screens tree means someone
skipped the chip. A rule stated more strongly than it is true is worse than no
rule. Refs: `apps/web/src/shared/components/kit/StatusChip.tsx`, `8604b3e`.

**D-119 · `sonner` is the app's toast surface; the shadcn toast trio stays
unmounted · ACTIVE (2026-09-12).** The centralised `MutationCache` calls sonner.
`ui/toast.tsx`, `ui/toaster.tsx` and `hooks/use-toast.ts` arrived with the
shadcn base primitive set and are unused on purpose — mounting both is debt, not
a pattern. Recorded in the gotchas list so the next reader does not "fix" it by
wiring the second one. Refs: `CLAUDE.md` gotchas, `fa88a24`.

**D-120 · Never `--amend`, `reset` or `rebase` in a shared worktree · ACTIVE
(2026-09-12).** The git index is process-wide and several agents commit on the
same branch at once, so rewriting the tip rewrites whatever a sibling lane
committed into it in the meantime. Pathspec-only commits (R9) prevent taking
someone else's staged work; this prevents destroying work already committed.
Refs: `CLAUDE.md` **R12** and R9, `AGENTS.md`, `5609dbe`,
`ai/findings-log.md` B-007.

**D-121 · Check the file, not the message · ACTIVE (2026-09-12).** A commit
message is a claim about a file, and this session produced at least one commit
whose message described an edit the file did not receive. Every cross-lane
premise was verified by reading the artefact — `git show`, the catalog, the
`proconfig` value, the emitted chunk — before it was relied on. Refs:
`CLAUDE.md` **R13**, `AGENTS.md`, `ai/findings-log.md`,
`docs/reviews/2026-09-12-ui-blast-lane-review.md`.

**D-122 · No silent `else` over a value another lane owns · ACTIVE
(2026-09-12).** A two-branch `CASE` over a foreign vocabulary fails silently
toward whichever branch is the `else`, so one wrong constant recorded every
delivered email as dead-lettered and surfaced as `PARTIALLY_FAILED` on actions
that fully succeeded. The durable fix is to raise on an unrecognised value, not
to get the constant right; the same reasoning makes `app.job_type_for` a raising
lookup table rather than a `CASE` returning null. Refs: `CLAUDE.md` **R14**,
`AGENTS.md`, `docs/architecture/05` §2.7, `85cb624`, `cc3a330`, `1caca0b`.

**Rules table.** This file has none; the numbered rules live in `CLAUDE.md`
Part 3. Pathspec-only commits are R9 and the CI-assertion-for-every-control rule
is R11, both already written there. `D-120`, `D-121` and `D-122` were added to
`CLAUDE.md` Part 3 and `AGENTS.md` in the same pass as this entry, as **R12**
(never rewrite a commit in a shared worktree), **R13** (check the file, not the
message) and **R14** (the receiving side rejects an unknown value).

## D-101 · The dev server owns port 5180, not the house default 8080 · ACTIVE

**Context (2026-09-12).** A sibling house app was already listening on 8080 on
the developer machine. The bundle-budget check probes that port for a live Vite
server, because building while one is running corrupts `node_modules/.vite` and
produces duplicate module instances, which surface as "must be used within a
Provider" white screens. The probe correctly saw a Vite server and refused to
build — it just was not ours.

**Decision.** TrainOS binds 5180. `vite.config.ts`, the bundle check's
`DEV_PORT` and `.env.example` all say 5180, and the check reads
`TRAINOS_DEV_PORT` if a machine needs to move it again.

**Why sharpening the probe does not fit.** Distinguishing our dev server from
another project's means matching on served HTML, which is fragile and would fail
open on exactly the case the probe exists to catch.

**Consequence to accept honestly.** TrainOS now differs from the house default,
so anyone carrying muscle memory from the sibling repo will type the wrong port
once. It is written in the README, the gotchas list and `.env.example`.

**Refs.** `apps/web/vite.config.ts`, `scripts/bundle-budget-check.mjs`.

## D-100 · One token file, and the kit's three supplements were folded into it · ACTIVE

**Context (2026-09-12).** The kit work needed three colours the pack's §1.1
token table does not name — an AI popover surface, a low-confidence amber dot
and an allowed-hours peak band. They were parked in a second file,
`styles/kit-tokens.css`, because `tokens.css` belonged to the scaffold.

**Decision.** All three moved into `tokens.css` with their sources and their
reasoning intact, light and dark. `styles/kit-tokens.css` and the `kit.css` that
imports it are now redundant and should be deleted.

**Why leaving them split does not fit.** CLAUDE.md's consolidation rule is
explicit: never a second mechanism for a problem the first already solves. Two
token files is the divergence that rule names as a defect, and the second one
would have been the place every future unnamed colour landed.

**Consequence to accept honestly.** The scaffold now owns three tokens the
design pack does not name, and their dark values are derived. They are marked as
such.

**Refs.** `apps/web/src/styles/tokens.css`, `apps/web/src/shared/components/kit/tokens.ts`.

## Session Log

<!-- Latest first, append-only. -->

## 2026-09-13 22:4x — PR #23 (014 re-review) MERGE-WITH-FIXES; fix-014 pushed 015-017 fixes at bdd49aa; new human ruling needed on 016's dated refs

- PR #23 confirmed merged (`db0ec94`): Opus thermonuclear + security
  re-review of 014's fixes, both original CRITICALs confirmed genuinely
  closed by G6 execution. New HIGH: `run:read` governs seven `core`
  tables, only one is gated. Two pin-only defects found by running it:
  T11a is a tautology (passes even against the pre-fix database), and
  the pin's own header contradicts its own assertion counts (says
  001-014, needs 001-017). Codex still owed until 14 Sep 00:29.
- `fix-014` separately pushed 015-017's fixes to `cloud/migrations` at
  `bdd49aa` (not yet a PR): 015's overload guard, 016's rollback now
  scoped to its own derivation, 017's SST trigger/backfill plus VALIDATE
  and PDPA rollback guards. Two premise corrections recorded in place
  (015's trap already aborted for a different reason than claimed; the
  post-rollback policy count is 228→234→228, not `<> 222`). 016's
  hardcoded `dated` ref-prefix conflict with the domain model was
  deliberately left unfixed — added to the Backlog as a new OPEN item
  needing a human ruling. Re-review of 015-017 reported dispatched, not
  yet independently confirmed. See `ai/project-log.md` 22:4x block and
  `ai/workstreams.md` SUPABASE SCHEMA thread for full detail.

## 2026-09-13 22:3x — PR #22 independently confirms all 6 of 018's Blockers via real G6 execution; two nuances on B4/B6

- PR #22 confirmed merged (`279edc3`): independent review + actual G6 run
  (18/18 pins, twice through rollback/reapply) BLOCKs, agreeing with the
  thermo report — all 6 Blockers reconfirmed, execution pass does NOT
  clear B1/B3/H2/H3/H4. B4's `test_014` failure traced one pack earlier
  than 018 (017's fault) but 018 still worsens it. B6's row-preservation
  design is empirically correct; only its guard (R4) checks the wrong
  trigger. Codex slot still owed until 14 Sep 00:29, priorities named:
  pipeline-seed trigger/backfill/id-collision safety + ten client RPCs
  vs `rpcClient.ts`. See `ai/project-log.md` 22:3x block for full detail.

## 2026-09-13 22:2x — PR #21 adds Blocker B6 to 018 (now 6); fix-014 confirmed complete and pushed; Codex quota-blocked, no verdict

- PR #21 confirmed merged: 018 now 6 Blocker/5 High/8 Medium/6 Low. New
  B6 confirmed: pipeline seed rollback keeps rows (FK-forced) so it can't
  restore prior state, and pin R4 falsely claims to assert row survival.
  Routed to fix-018. Separately, fix-014's work confirmed complete and
  pushed to cloud/migrations at 21ec975: both CRITICALs fixed with
  exercising pins, plus 3 more execution-only defects found and fixed
  (rollback-while-017, erasable role gate, a third destroyed USAGE
  grant). All counts confirmed exactly (18/18, 17/17, 4/4, 228 policies,
  52/52 lint). BLOCKER: Codex quota-blocked until 14 Sep 00:29, confirmed
  verbatim -- no MERGE verdict for 014 yet. Fallback to Opus
  thermonuclear + security pass in effect for remaining reviews. Full
  detail in `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 22:1x — PR #20 merged, 018 BLOCK (thermonuclear pass); report's blocker list was wrong, missed two real Blockers

- PR #20 confirmed merged, one file, thermonuclear review of 018 at
  fc9550c. VERDICT BLOCK confirmed, 5/5/8/6 severity counts confirmed.
  Corrected the report's "5 blockers" list: only B1 (five list-engine
  copies) and B3 (p_view discarded) are actually Blockers; the pagination
  bugs are H2/H3, regenerate_proposal_section is H1, provenance/backfill
  items are M1/M5 (Medium, not Blocker). Two real Blockers were missing
  from the report: B4 (018 breaks 014's own pin, 121->124 grants,
  confirmed by reproducing the exact failure) and B5 (no transaction
  wrapper on a data-writing migration). Confirmed clean: no reachable
  cross-tenant read, no error swallowed into app.ok, rollback drops
  exactly its 47 objects. fix-018 lane confirmed active. Full detail in
  `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 22:0x — PR #18 merged (second D-012 pass formal); finding #19; "nineteen" pin-edit figure confirmed wrong

- PR #18 confirmed merged, one file, cut from main per the new
  review-branch rule (held this time). Verdicts unchanged: 015
  MERGE-WITH-FIXES, 016 BLOCK, 017 BLOCK. 564dd64 confirmed sound. New
  finding #19: 017's third provisioning trigger is unchecked by
  provision_tenant's completeness guard, routed to fix-014 with a request
  for one registry-driven check (018 makes it a fourth trigger). The
  "nineteen" pin-edit figure is confirmed wrong after three recounts:
  always 14 hunks over 10 files. Corrected in place in workstreams.md.
  codex-review-014-017 stays alive for the re-review. Full detail in
  `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 21:5x — GitHub Actions down on billing (confirmed); PR #16 final with SST landed; PR #11 pipeline seed shipped

- GitHub Actions confirmed unavailable on every branch since ~20:36
  (billing annotation confirmed verbatim via the API). Merges now go on
  local gates + independent review until the user fixes billing. PR #16
  final at f8d00fc: SST fix confirmed landed via app.resolve_tax_policy(),
  three new pins (T7d/T7e/T7f) confirmed. Corrected this session's own
  prior finding: the pipeline stage seed was NOT blocked, only DEAL_CHAIN
  itself is -- confirmed the seed shipped as a fourth tenant trigger at
  PR #11's new head fc9550c, plus a real cross-join defect fix in
  test_009. Full detail in `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 21:4x — second D-012 pass BLOCKs all of 014-017 (branch only, not on main); scratchpad collision; SST confirmed queued

- Confirmed via git show on branch review/codex-014-017 (not merged, no
  PR yet): 014 BLOCK unchanged, 015 MERGE-WITH-FIXES, 016 BLOCK (rollback
  over-deletes ref_formats, same class as 014), 017 BLOCK (SST silent
  zero-tax, false lock-safety claim, unguarded VALIDATE will abort on
  live data, rollback drops the PDPA breach register, T3b never
  executes). All routed to fix-014, now covering all four packs.
  Negative result: two rollbacks in one PR destroyed state they never
  created -- added a standing checklist line. SST discrepancy from last
  round resolved (confirmed queued, not landed). Scratchpad collision
  between two lanes recorded; new convention: lane files under
  <scratchpad>/<lane-name>/. Full detail in `ai/project-log.md` and
  `ai/workstreams.md`.

## 2026-09-13 21:3x — PR #17 merged; PR #11 rebased with 5 confirmed findings; SST fix reported but missing from PR #16's diff

- PR #17 confirmed merged, both lanes shut down. Conformance suite caveat
  recorded: no test executes 011's real RAISE path (oracle transport, not
  real Postgres). PR #11 confirmed rebased onto cloud/migrations with 5
  findings verified (arity overload/PGRST203, SST half-wired, immutable
  provenance.origin, check:rpc existence-gate gap, pipeline seed blocked
  on a real architecture decision). PR #16 pipeline-id formula corrected
  by measurement (two real defects caught before shipping), confirmed
  exactly with new pins T2k/T2l. Confirmed exactly 3 trainers accredited.
  SST ruling reported as fixed but NOT found in the current diff --
  flagged as an open discrepancy. Full detail in `ai/project-log.md` and
  `ai/workstreams.md`.

## 2026-09-13 21:2x — trainer TDF re-corrected (later commit superseded it); PR #15 confirmed blocked; PR #17 confirmed

- Re-checked the trainer HRD-TDF item at PR #16's current head: a later
  commit changed it back to true with a real (not fabricated) reused TTT
  expiry date, pinned by three new assertions. Previous correction was
  accurate for the commit it read; this supersedes it. PR #15 confirmed
  genuinely blocked (two Radix tests still time out at 30s on the runner,
  confirmed on a live failing run); raising the timeout is now a
  confirmed dead lever at both 15s and 30s. PR #17 confirmed open and
  matching its description exactly, 1504 tests. Full detail in
  `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 21:1x — PR #13 merged; seeds now on 001-017 with a real RLS pin; one reported ruling was backwards

- PR #13 confirmed merged despite still-failing inherited checks. PR #16
  retargets 001-017 and adds T10, an RLS-visibility pin with exact counts
  (6/10/136/78/10/7/16) confirmed verbatim. cloud/migrations pushed
  564dd64 adding provision_tenant(p_id) with a confirmed-mandatory DROP
  FUNCTION. Corrected a reported ruling that was backwards: the seed does
  NOT invent a trainer's HRD-TDF expiry, it deliberately writes a
  known-wrong false rather than fabricate a compliance date. fix-pr5's
  Radix-test slowness confirmed as asyncAct/floating-ui, not Radix. Full
  detail in `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 21:0x — PR #14 merged (main red on Grant Hygiene only); PR #16 seeds open; new review-branch rule

- PR #14 confirmed merged, npm audit genuinely passes on main now. Main
  red on Grant Hygiene only (014's SECURITY DEFINER test, confirmed
  intentional to leave on main pending fix-014). New lane
  fix-approval-hash doing the client half of 014's HIGH-4. fix-014 hit a
  real port collision, now asserts data_directory before every run. New
  standing rule: review branches cut from main with one doc file, never
  from the PR under review. PR #16 (seeds) confirmed open with 22 schema
  gaps enumerated, three rulings recorded. PR #13 open but failing two
  inherited main-red checks. Full detail in `ai/project-log.md` and
  `ai/workstreams.md`.

## 2026-09-13 20:5x — correction: "015-017 don't exist" was a stale reviewer checkout, not a fact

- Confirmed by timestamp: 015/016/017 were committed to cloud/migrations
  at 19:35/19:42/19:59, all before the D-012 review doc was written at
  20:08. The reviewer's checkout never fetched after 014's commit, so it
  reported non-existence wrongly. 014's two CRITICAL findings still stand.
  Two active lanes now: fix-014 (fixing 014 directly) and
  codex-review-014-017's continuation (now reviewing 015-017 correctly).
  PR #5 confirmed 17/18 checks green; PR #14 and PR #15 (draft) both
  confirmed real for the audit-scope and toolchain-upgrade work. Full
  detail in `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 20:4x — 014 BLOCKED by D-012 review (2 CRITICAL); PR #5 and #10 both merged

- Correction to this log's own 20:3x entry: 014-017 were NOT all landed and
  reviewed. PR #12 (D-012 review) merged with VERDICT BLOCK on 014 (a
  DELETE-grant escalation path and a rollback that strips 002's original
  grants, both confirmed in the SQL); 015-017 didn't even exist at review
  time and remain unreviewed by anyone. PR #5 and PR #10 both confirmed
  merged (found while verifying, not separately reported). New PR #10
  rebase findings: a real DANGER/ALERT tone bug fixed, Collections
  thresholds now read the configured ladder, and new follow-up (g) --
  StatusChip.tsx:118 ignores tone on an accent card, so the claim-window
  severity fix has no visible effect yet. Full detail in
  `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 20:3x — 014-017 land on PR #6, 018 becomes PR #11, hosted-apply hard rule confirmed

- PR #6 confirmed 4/4 packs (014-017) with real defects fixed (ungranted
  require_tenant_id, missing index, ungrantable views deferred to 018).
  018 is now PR #11, confirmed open: 23/24 RPC_NAMES done, me_profile
  deferred, R-C resolved by grep (tax_policies genuinely absent), a keyset
  paging bug found and fixed, DEAL_CHAIN divergence deliberately pinned.
  Hard rule confirmed baked into 018's own test: it self-detects and warns
  if applied to a hosted project before 014. Full detail in
  `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 20:2x — PR #8 merged too; main-red recount (five, not four); MoneyText correction

- PR #8 confirmed merged at a4ea833 after review-pr8's MERGE verdict (1004
  tests, isolated worktree pinned to 6dfd281). Corrected main-red to five
  checks (Vitest unit was also failing, missed earlier). fix-pr5's fixes
  confirmed in PR #5's own commit history. npm audit ruling only partly
  live (continue-on-error, not the full --omit=dev + toolchain-PR plan).
  Corrected this log's own earlier claim that the MoneyText follow-up was
  fully closed — two screens still carry independent font-mono wrappers.
  Full detail in `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 20:1x — PR #9 merged (reported open); PR #10 open, six deviations confirmed

- PR #9 (ui/tokens) already merged at ed3c337 by the time it was checked;
  every substantive claim (rows 1b/1c, contrast 33→49, mono-caps counts,
  participants x275 false violation, two unfixed defects) confirmed exact.
  PR #10 (ui/lists) confirmed open with all six deviations verified against
  its diff. One queued kit follow-up (MoneyText font-mono) is already fixed
  by PR #9, not open. Full detail in `ai/project-log.md` and
  `ai/workstreams.md`.

## 2026-09-13 20:0x — PR #7 merged (fixed Gitleaks repo-wide); PR #8 open, reviewed

- PR #7 confirmed merged at 0910b9d; ci-gitleaks lane shut down. fix-pr5 has
  three real CI-fix commits now (still branch fix/pr5, name mismatch
  unresolved). codex-014-017 detached HEAD confirmed legitimate (Codex's own
  review checkout of PR #6). PR #8 (ui/states) open under review-pr8; three
  verification-doc deviations confirmed and logged. Full detail in
  `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 19:5x — main CI red since 9fdcb4d; PR #6/#7 open; R-F confirmed live

- Main fails the same four checks as PR #5. PR #6 gated on
  `codex-review-014-017`'s verdict and fails Grant Hygiene (a test defines
  its own `SECURITY DEFINER` function). PR #7's Gitleaks passes but three
  main-red failures remain. Fix lane's actual branch is `fix/pr5`, not the
  reported `fix/main-ci`. R-F (core not exposed) confirmed by a direct
  `PGRST106` probe. Full detail in `ai/project-log.md` and
  `ai/workstreams.md`.

## 2026-09-13 19:4x — PR #5/#6 open; PR #5 has four real CI failures, not one

- Corrected the report of "gates green except Gitleaks": Prettier drift, npm
  audit high+ (2 critical) and a Vite artifact-upload quota also fail. Ten
  missing RPC functions found in PR #5 handed to `lane/rpc-018`. New lanes
  `seeds` and `codex-review-011-013`. GitHub repo is
  `PARALLELPARADIGMS/alex-project`, not "trainos". Full detail in
  `ai/project-log.md` and `ai/workstreams.md`.

## 2026-09-13 19:25 — headless blast (API phase + UI carry-over)

- Six lanes running: `cloud/migrations` (014–017), `cloud/web-swap`, plus
  worktree lanes `lane/rpc-018`, `ui/tokens`, `ui/lists`, `ui/states`. Full
  detail in `ai/project-log.md` and `ai/resume-brief.md` BLAST 19:25 entry.

## 2026-09-12 — repo scaffold

- Laid the whole floor: workspaces, build config, tokens, theme, shell, data
  boundary, state kit, hooks, CI, guardrails, doc spine, design pack copy.

**Four things worth telling future-me:**

1. The reference stack's `arch:graph` script could not have worked as written.
   `dependency-cruiser` 16 renamed `--validate` to `--config`, and running it
   from the repo root made TypeScript resolve the app tsconfig's
   `include: ["src"]` against a directory that does not exist. Both only showed
   up because the command was actually run instead of being assumed good.
2. A boundary rule that passes on an empty tree proves nothing. Both
   dependency-cruiser rules were probed with deliberate violations, confirmed to
   fire, and the probes removed. Do that for every new rule.
3. The first nav test failed on ordering and the test was wrong, not the code:
   the sidebar renders in TREE order, while the pack's ROLE map lists parents in
   a different order. The ROLE map controls visibility, never sequence.
4. The design pack's role vocabulary and the API contract's role vocabulary are
   different sets, and nothing in either document says so. Reconciling them
   needed two judgement calls that are now written down in
   `shared/config/roles.ts` rather than buried in a filter expression.
