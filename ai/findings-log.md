# Findings Log

> The review-catch inbox. A finding lands here first; the curated archive is
> `ai/state.md`'s Decisions section, and a finding that recurs is promoted there
> rather than logged a third time.
>
> **The rule that makes this file work: no HIGH or CRITICAL finding closes
> without a pin.** A pin is an executable assertion — a regression test, a
> migration check, a CI job, a branded type — not a comment and not a note in a
> commit message. `OPEN` means owed work. `PINNED` means an assertion exists
> that fails if the defect returns.
>
> Every entry below was found by **executing** something: a migration against a
> real Postgres, the app in a real browser, the actual bytes of a production
> build, `git show` on a commit. None came from reading code. That is the whole
> argument for `CLAUDE.md` R11, and it is why severity here is judged on what
> the defect would have done in production, not on how hard it was to find.
>
> Table rows are one physical line, cells short, no pipes inside a cell. An
> overflow re-pads the whole table and manufactures a merge conflict.

| Id    | Date       | Area          | Catch                                  | Sev      | Pin type       | Status |
| ----- | ---------- | ------------- | -------------------------------------- | -------- | -------------- | ------ |
| B-001 | 2026-09-12 | supabase      | Quoted search_path list is a no-op     | CRITICAL | catalogue test | OPEN   |
| B-002 | 2026-09-12 | supabase      | Default-privileges revoke never takes  | HIGH     | per-object pin | PINNED |
| B-003 | 2026-09-12 | supabase      | FORCE RLS would break the login hook   | HIGH     | settling query | OPEN   |
| B-004 | 2026-09-12 | supabase      | A jsonb CHECK on an absent key passes  | CRITICAL | migration test | PINNED |
| B-005 | 2026-09-12 | agent-runtime | Background tasks share the 400s clock  | HIGH     | slicing tests  | PINNED |
| B-006 | 2026-09-12 | agent-runtime | node:fs in the default entry           | HIGH     | graph walk     | PINNED |
| B-007 | 2026-09-12 | process       | An amend rewrote a sibling commit      | HIGH     | none yet       | OPEN   |
| B-008 | 2026-09-12 | supabase      | Cached counters the gate must not read | MEDIUM   | column comment | OPEN   |
| B-009 | 2026-09-12 | web           | text-primary-foreground resolved to no | HIGH     | tailwind probe | PINNED |
| B-010 | 2026-09-12 | web           | The dev gallery shipped in production  | MEDIUM   | measured build | PINNED |
| B-011 | 2026-09-12 | web           | Radix tests slow, and not stubbable    | LOW      | comment only   | OPEN   |
| B-012 | 2026-09-13 | web           | A 403 was classified as a transport no | HIGH     | render test    | PINNED |

---

## B-001 · A quoted `search_path` list is silently a one-schema path · CRITICAL · OPEN

`set search_path = 'app, pg_catalog'` is not a two-schema path. It is a
one-schema path naming a single schema called `app, pg_catalog`, which does not
exist — so nothing is on the path at all, while the spelling looks more careful
than the correct one. Reproduced on a scratch PostgreSQL 17.11 rather than
reasoned about, after two contradictory reports from the same lane.

Two consequences, both worse than the original bug. A SQL-bodied function fails
at `CREATE` under it; a plpgsql body creates cleanly and fails at _runtime_, so
the window between authoring and first call is silent. And a test asserting
`proconfig IS NOT NULL` passes all three spellings including the broken one —
which is the assertion the pack originally carried.

**Pin:** doc 02 §8.7's catalogue sweep, which must assert containment of the
literal `search_path=""` rather than non-nullness, must cover procedures as well
as functions, and must not be positional — a function that also sets
`statement_timeout` moves the entry off index 1, and `proconfig[1] = ...`
returns FALSE for a correctly pinned function.

**Why it is still OPEN.** The sweep is written and correct; the migrations
contradict it. Roughly twenty-five functions in migrations 001, 002 and 004 use
the four-part `SET search_path TO 'pg_catalog', 'public', 'extensions',
'pg_temp'` form, which is a _correct_ multi-schema path and stores a proconfig
that fails the sweep. One spelling has to win before the pin can run green.
Recorded as critic finding `N-05` and deviation D1 in migration 002.

**Refs:** `4192381`, `5eec24f`, `a5b9521`, `e532d09`, `D-111`,
`docs/architecture/06-critic-review.md` `N-05`.

---

## B-002 · `ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM PUBLIC` does not take · HIGH · PINNED

Doc 02 §4.1's security baseline was two lines, and measured on PostgreSQL 17.11
neither does what it says. For tables it is vacuous, because PUBLIC holds no
default table privilege to revoke. For functions it is _not_ vacuous and still
does not take: the statement records no row in `pg_default_acl`, and a function
created afterwards is still executable by PUBLIC and by `anon`. The same
statement in GRANT form records correctly, so the mechanism is live and it is
the revoke-from-PUBLIC direction that fails.

Found because the pin asserted the fiction and failed. The first version of
migration 001's check asserted a `pg_default_acl` row, went red, and that is how
anyone learned the baseline was decorative.

**Pin:** the baseline is kept as documentation and explicitly is _not_ the
guard. The guard is per-object `REVOKE` at creation in every migration, plus
`test_014`'s schema-wide sweep, plus `npm run check:grants` in CI.

**Refs:** `2a24c76`, `84416db`, `supabase/migrations/migration-catalog.md`.

---

## B-003 · `FORCE RLS` and the `SECURITY DEFINER` login hook interact · HIGH · OPEN

Migration 002 enables RLS on the identity tables without forcing it, while doc
02 §4.1 requires both and §8.7 asserts it. That is not obviously an omission.
The access-token hook is `SECURITY DEFINER`; if its owner also owns
`memberships` and the table is forced, the owner exemption is gone, no policy
admits that role, the hook returns no rows — and every login in the system
breaks.

Whether that happens depends on whether Supabase's `postgres` role carries
`BYPASSRLS`, which nobody verified and nobody asserted. The right move was to
record the question, the settling query and the two clean resolutions rather
than guess, and to raise it to the highest-priority open item.

The settling query was then itself corrected: its first version assumed the
hook's owner is `postgres`. It now resolves the owner from `pg_proc`, adds the
table owner, and checks `rolinherit`, because `BYPASSRLS` is a role _attribute_
and does not arrive through membership.

**Why it is still OPEN.** It needs one query run against a real Supabase
project, which this session never had.

**Refs:** `2b71d65`, `ed6410d`, `docs/architecture/02` §4.1, §11.

---

## B-004 · A jsonb CHECK on an absent key evaluates to NULL and therefore PASSES · CRITICAL · PINNED

`check (payload->>'mode' in ('GATE','SAMPLE','ESCALATE'))` looks like it
constrains the shape. Given a payload with no `mode` key at all, `->>` yields
NULL, `NULL IN (...)` yields NULL, and a CHECK evaluating to NULL **passes**. A
legacy boolean jury `{"enabled":true,"quorum":2,"of":3}` was accepted by exactly
that constraint in testing.

The same mechanism defeats the gate's only payload guard from the other
direction: `core.action_types.payload_schema` has no constraint on its own
shape, so a seed row spelling the key `requires` instead of `required` yields
NULL, a `coalesce` substitutes an empty array, the validation loop runs zero
times, and every payload passes.

**Pin:** migration 007's check set, exercised on the exact payload the naive
constraint lets past. Ruling R-JSONB makes key presence mandatory on every jsonb
CHECK.

**Not closed everywhere.** Doc 05 has sixteen CHECK constraints and every one is
on a scalar column; it has no key-presence operator anywhere, and fourteen
structured jsonb columns carry their required shape in a comment and nowhere
else. A table with no CHECK at all satisfies the letter of the ruling and
defeats its purpose. Tracked as critic finding `N-02`.

**Refs:** `5549a35`, `9c8d80b`, `D-112`,
`docs/architecture/06-critic-review.md` `N-02`, `N-03`.

---

## B-005 · An Edge Function worker is killed at 400s and background tasks share the clock · HIGH · PINNED

The worker design assumed a long run could hold a lease. It cannot: the wall
clock is enforced on the worker, background tasks share it, and a run that
cannot checkpoint therefore cannot exceed 400 seconds no matter how the lease is
managed.

Building the fix surfaced two livelocks, both of which would have looked like a
healthy queue rather than a stall. A _cumulative_ token budget can never be
satisfied by starting a new worker, so a resumed slice begins already over the
limit and yields forever; both slice budgets are now per slice, and a slice
always gets at least one model call, because one call per slice is the slowest
progress that is still progress. And a mid-stage yield that restarted the stage
never finished a stage needing more calls than one slice allows, so the stage's
whole conversation now travels in the checkpoint.

**Pin:** `test/slicing.test.ts`, 19 tests, asserting that a sliced run makes
exactly the same tool calls as an unsliced one — asserted, not assumed.

**Refs:** `2fb7c51`, `4ba4ca5`, `docs/architecture/05` §8.5.

---

## B-006 · `node:fs` in the runtime's default entry broke the consuming build · HIGH · PINNED

`packages/agent-runtime/src/index.ts` re-exported the `.env.local` reader, which
imports `node:fs` and `node:path` at module scope. A Vite build of the consuming
app failed — at build time, naming a file that did not cause it. `EnvKeyStore`
then read `process.env` as a constructor default and threw a `ReferenceError`
before a caller could pass their own environment.

The fix is a split, not an inline guard, and the reason is worth keeping: a
bundler decides what to include by reading imports, not by reading conditions.
`node:fs` at module scope fails the build whether or not the code path runs. The
Node-only helpers moved behind a `./node` export and the default entry is now
universal.

A sibling defect in the same package has the same shape. The root typecheck was
red on two lines of `fixture-adapter.ts` and the cause was neither line:
`apps/web` sets `strict: false`, which turns off `strictNullChecks`, under which
zod's inferred output type collapses every key to optional. The package's own
tsconfig is strict, so `tsc -p packages/agent-runtime` was green throughout —
the defect was only visible from the consumer.

**Pin:** `test/browser-safety.test.ts` walks the default entry's module graph for
Node builtins and unguarded `process`, asserts the graph is non-trivial so it
cannot pass by walking nothing, and builds a runtime with `globalThis.process`
deleted. Reintroducing the old export fails three of its nine tests — checked
before the test was trusted.

**Refs:** `db27de5`, `b698036`, `03f6d68`.

---

## B-007 · An amend rewrote a sibling lane's commit · HIGH · OPEN

Reported by the lane it happened to. By its nature it leaves nothing behind to
confirm — `git commit --amend` replaces the tip, so the evidence is the thing
that was destroyed.

`R9`'s pathspec rule is only half the protection. It stops a lane taking
another's _staged_ work under its own message; nothing in it stops a lane
rewriting another's _committed_ work. In a shared worktree the branch tip is as
process-wide as the index.

**Separately and verifiably, the same file was damaged a different way.** Commit
`5549a35` spliced a new `CHANGELOG.md` entry into the middle of the previous
entry's `##` heading, leaving a stray line reading " and a trainer who cannot be
in two places" and one fewer heading than entries. Nothing caught it:
`CHANGELOG.md` is in `.prettierignore`, so no formatter ever parsed it, and a
heading that loses its `#` is still valid markdown. Rule 1 of additive doc
surgery — anchor on a neighbour line, insert whole lines, never splice mid-line
— was written down in `docs/research/05-doc-spine.md` on the same day it was
broken. The heading is restored as of 2026-09-13.

**Why it is still OPEN.** There is no pin. `--amend`, `reset` and `rebase` are
now forbidden in `CLAUDE.md` and `AGENTS.md` as `D-120`, and a prose rule is not
a pin. The candidate is a `pre-push` check for a rewritten tip, or a
`safe-command-guard` shape that denies the three commands outright.

**Refs:** `D-120`, `5609dbe`, `CLAUDE.md` R9, `AGENTS.md`.

---

## B-008 · Cached counters that the policy gate must not read · MEDIUM · OPEN

`organisations.proposal_count` and `first_proposal_sent_at` are denormalised for
the record header, while doc 03 decision 7 requires `firstProposalToOrg` to be
computed live from the `proposals_org_sent` partial index. Both columns carry a
COMMENT saying the policy gate must not read them, because a column that looks
authoritative and is not is exactly what a later author trusts. Recorded as
deviation D2 in migration 005.

The same reconciliation removed the earlier denormalised counters in favour of
partial indexes — `proposals_org_sent` and `invoices_overdue` — so the gate
reads an index probe rather than a cached number that can be stale by exactly
the amount that matters.

**Why it is still OPEN.** A column comment is not a pin. The assertion that
would close it is a `check:rpc`-style rule that fails if gate SQL references
either column, which is precisely the `R11` shape: a control a reviewer must
remember to check.

**Refs:** `a5d9d8f`, `636cad8`, `docs/architecture/03` decision 7, `CLAUDE.md`
R11.

---

## B-009 · `text-primary-foreground` resolved to nothing at all · HIGH · PINNED

The shadcn CLI generated sixteen primitives, and every one of them says
`text-primary-foreground`. The theme defined `on-primary` instead. The class
resolved to no rule — no error, no warning, nothing in the console:
white-on-blue button text silently absent.

This is the worst break shape in the whole session. A missing colour is visible;
a class name that compiles to nothing is not, because Tailwind does not complain
about a utility it has no definition for. `primary.foreground` and
`card.foreground` now alias the same tokens, so a CLI-generated primitive is
correct with no edit and the palette stays single.

**Pin:** `npx tailwindcss` confirms `.text-primary-foreground` compiles to a
real rule. The same probe was used for `bg-ai-popover`, `warning-accent` and
`peak` when those became real Tailwind colours.

**Refs:** `fa88a24`, `9a26a33`.

---

## B-010 · The dev gallery shipped in every production build · MEDIUM · PINNED

`routes.tsx` mounts dev routes behind `import.meta.env.DEV`, and the comment in
`dev.routes.tsx` claimed that meant nothing reached a production bundle. The
_route_ did not. The _code_ did: a production build emitted `KitShowcase` as its
own chunk, 174.70 kB raw and 55.32 kB gzipped, plus a stylesheet, in files
nothing could ever fetch.

Rollup creates a chunk at every `import()` it can resolve statically, whether or
not the reference sits in a provably dead branch. The kit lane wrapped the entry
in a dead DEV branch, measured it, and got the same bytes. Cutting the import
_graph_ is the only thing that removes it, so `vite.config.ts` aliases the
`./dev.routes` specifier to an empty array in production — at that one module,
so it covers every dev page the mount point carries, today's and tomorrow's.

**Pin:** measured both ways. Production: the chunk and its CSS are gone.
`build:dev`: `KitShowcase` still emits at 174.89 kB, so the alias is mode-scoped
and the gallery is untouched where it is used. The bundle budget check holds the
baseline.

**Refs:** `bb6aad5`, `9a26a33`, `.bundle-size-baseline.json`.

---

## B-011 · The Radix tests are slow, and the obvious fix made them slower · LOW · OPEN

Three hypotheses were measured and all three failed. An inert `ResizeObserver`
stub changed nothing. A stub that actually delivers an entry on observe made a
popover-heavy file 2.4x **slower**, 22s to 54s, because every delivered entry
triggers another position pass. Disabling jsdom's animation frames looked like a
21% win in isolation and did not survive a full-suite run. All three were
reverted rather than shipped on a hunch.

What an isolated probe does show: the test body costs 4ms and `cleanup()` costs
1ms while Vitest reports the test at 4183ms. Rendering a Radix popover without
opening it is free. Opening one costs 1.8s, then 3.2s, then 4.8s — and the debt
then _decays_ across following tests that merely render, 2.0s, 0.4s, 0ms. That
is scheduled work draining and being attributed to whichever test happens to be
running. It is not a per-test cost and it is not something the harness can stub
away.

**Pin:** none, and none is owed — this is a measurement, not a defect. The stubs
that did land are hygiene rather than speed, and the inert one carries a comment
saying it was measured and must not be "improved" into firing without measuring
again. That comment is the durable artefact.

**Refs:** `9a26a33`.

---

## B-012 · A policy refusal came with a retry button · HIGH · PINNED

The fixture client **throws** a `ContractError` for a refusal. Every thrown
value is an `Error`, so `toApiError`'s `instanceof ApiErrorException` check did
not recognise it and classified a 403 as a transport `UNKNOWN`. `ErrorState`
reads exactly that classification to decide whether to draw "Try again" — so a
policy decision arrived with a retry affordance, and `readableMessage` replaced
a server sentence naming the missing role and permission with "Something went
wrong".

That is the `R2` collapse `CLAUDE.md` names, reached by accident rather than by
anyone deciding a refusal should be retried. Two features had already noticed
the symptom and patched around it locally rather than blocking on another lane's
file, which is how one boundary defect became thirteen private copies of a hook
in four incompatible shapes.

Two second-order defects fell out of the same consolidation. The copies signed
in during render and never invalidated, so switching role kept serving the
previous principal's cached projections. And two governed writes in proposals
were sending no idempotency key, which is how a double-clicked send queues two
approvals.

**Pin:** a test renders a 403 and asserts the retry affordance is absent **even
when `onRetry` is passed**. The component refusing the affordance, rather than
every caller remembering not to pass one, is what stops this being reintroduced.
`toApiError` now recognises a `ContractError` and carries its code, status,
details and approval reference through.

**Refs:** `apps/web/src/shared/api/errors.ts`,
`apps/web/src/shared/api/__tests__/errors.test.tsx`, `d4ae83d`, `8b0716c`,
`D-115`, `CLAUDE.md` R2.

---

## Unlocated

One catch was handed to this lane as "an index sweep" and could not be matched
to any artefact. On the evidence in the repository it is `B-008` — the sweep
that replaced denormalised counters with the `proposals_org_sent` and
`invoices_overdue` partial indexes — and it is written up there. If it named a
different sweep, that one is **unrecorded**, and the lane that found it should
add a `B-012` rather than assume this entry covers it. A finding that exists
only in a brief has no file behind it.

---

## Promotion

A finding that recurs stops being an inbox item. `B-001`, `B-004`, `B-007` and
`B-012` have each already produced a decision — `D-111`, `D-112`, `D-120` and
`D-115` — and those are the curated record. Three or more incidents of one _shape_ is the trigger to
write a decision, not a fourth pin.

The shape that has now recurred five times across this log is: **a construct
that is valid, reads as careful, and does nothing.** A quoted search_path list,
a default-privileges revoke, a jsonb CHECK on an absent key, a dead DEV branch
that still emits a chunk, a Tailwind class with no definition, an `instanceof`
check against a class the value was never an instance of. Six now. That shape is
what `CLAUDE.md` R11 exists for, and it is the first thing to look for in any
new control.
