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
