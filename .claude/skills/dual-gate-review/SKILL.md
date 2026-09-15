---
name: dual-gate-review
description: Run the two-reviewer adversarial gate over a diff — Codex gpt-5.6-sol at xhigh and a Kimi fleet, dispatched in parallel, both carrying the thermo-nuclear rubric — then cross-check, fold, and re-review until no new HIGH/MED, pinning every catch. Use before merging or applying anything touching a critical seam. Triggers - "dual gate", "dual review", "gate this seam", "codex+kimi review", "run the two-reviewer gate", "adversarial review this branch".
---

# Dual-Gate Review

## Why this exists

One reviewer is a sampler, not a gate. TrainOS's own review history makes the
case (`ai/project-log.md`, `docs/reviews/`):

- Migration **031** (membership `actor_kind` lock) was a CRITICAL finding a
  reviewer caught — an ADMIN could flip a *different* member's `actor_kind` to
  `SYSTEM` through the ordinary membership-update policy, and `perform_action`
  treats `SYSTEM` as exempt from approval on every action type, money-moving
  included. The hole was live and unexploited, which is exactly the kind of
  defect a green test suite does not surface: nothing was failing, because
  nothing had walked that path yet.
- The 001 `COMMENT ON SCHEMA cron` statement passed on the local shim (where
  the migrating role owns everything) and only failed against hosted's real
  ownership shape — a class of defect a single-environment review or a single
  reviewer reading the DDL in isolation does not catch, because the DDL reads
  as correct.
- The retrofit passes in `docs/reviews/2026-09-13-codex-retrofit-018.md` and
  the 011–013/014–017 rounds in this repo consistently show the two lanes
  surfacing **disjoint** findings on the same diff — this is the concrete
  precedent for running both rather than picking one.

The gate is the standing practice for anything touching a critical seam. This
skill is the ritual, so it stops being re-described per review.

## Is the gate mandatory here?

**MANDATORY — both lanes, iterate to convergence** when the diff touches:
migrations or any DDL · the RPC contract (`app.ok()`/`app.err()` envelope
shapes, `TrainOsClient` typing, `as unknown as` casts in
`apps/web/src/shared/api`) · auth / grants / RLS (search_path, FORCE RLS,
`anon` allowlist, `app.current_tenant_id()`) · the money path (invoice,
quotation, receivables, BYOK provider keys) · the two spines — the action
envelope (`app.submit_action`, the policy gate, `action_request`/
`action_effect`) and pipeline configuration (`pipeline_step`) · the guardrail
control plane itself (`scripts/guard.mjs`, `check-rpc-contract.mjs`,
`check-grants.mjs`, `check-sql-parse.mjs`).

**CALIBRATED-LIGHTER — one lane, one round** for plain UI, copy, styling,
docs, or test-only diffs with no seam contact. Say so in the report, and why.
Lighter is not skipped: a dark-mode or state-management defect is exactly the
class a component-only glance misses, so a UI diff still gets a reviewer.

When unsure, treat it as mandatory. Getting a money-path or auth defect onto
hosted is the expensive failure mode here.

## The dispatch

Both lanes go out **in one message** so they run concurrently, against the
**same diff**, with the **same rubric**, and with **no knowledge of each
other** — independence is what makes their findings disjoint. Never show lane
A's output to lane B. Both briefs point at
`.claude/skills/thermo-nuclear-code-quality-review/SKILL.md` and instruct the
reviewer to apply it; never paste or paraphrase its contents, because a
drifting copy of a rubric is worse than no copy.

**Lane A — Codex `gpt-5.6-sol` at `xhigh`.** Go through the codex plugin
(`/codex:rescue`, told to run the Codex CLI itself), never a hand-rolled
`codex exec`. This is the project's standing routing for hard SQL/backend
reviews (Sonnet runs every orchestrating lane, no Opus lanes; Codex is the
model reserved for this). Brief it to TRACE rather than opine: every consumer
of every touched symbol (`grep -rn "<name>" apps/web/src packages/
supabase/migrations`), every prior definition, whether the change is additive
against the live surface.

**Lane B — Kimi fleet** — see [[dispatching-kimi-fleets]] first. The binding
constraint: **output caps near 8.2K tokens and truncation looks like a
finished answer**, so scope each invocation to one narrow deliverable and ask
for a findings TABLE (`file:line` · severity · one-line fix), not prose. A big
diff is 3–5 scoped invocations you concatenate yourself. A read-only fleet
needs no worktrees.

Every brief carries the four: stated base SHA · file ownership · **"verify
this brief's premises against source; end with what you could NOT verify"** ·
a reviewer **reports, it does not refactor**.

**Never trust an exit code.** Both harnesses exit 0 on a crashed, truncated, or
degraded run, and the codex gate emits an `approve`/dummy placeholder when it
fails. READ the captured verdict. A reply ending mid-row is a truncated one.

## Cross-check before folding

**A review is evidence, not a verdict.** Reviews have contradicted each other
before findings were checked against source — verify before propagating a
claim into `ai/state.md`, `ai/hot-state.md`, or a wrap.

For each finding, in this order:

1. Open the cited `file:line` and confirm the claim is true **today**.
2. Classify: CRIT / HIGH / MED / LOW / **REJECTED-with-reason**. A reject stays
   in the report with its reason — that record is what stops the next round
   re-raising it.
3. Track **convergent** findings (both lanes hit it) separately. Convergence
   raises confidence, not severity, and never substitutes for step 1.
4. Fold CRIT/HIGH before the next round; MED folds or defers with an owner in
   `ai/state-backlog.md`.

## Iterate

Re-run **both lanes on the folded diff**. Each fix is new code and gets the
same scrutiny as the original — 035's own fix (`btrim` for `trim`) was proved
by rolling back to reproduce the original error, then re-applying, not by
assertion. Stop when a full round returns **no new HIGH or MED** — not when
the reviewers stop talking, and not when it feels reviewed enough. Multiple
rounds is normal on a seam like the action envelope or RLS.

## Pin every catch

No HIGH or MED closes without a pin. The fix is not the pin — the pin is what
makes the bug unable to return:

- **Loose-type / envelope** → a `TrainOsClient` method typed against
  `@trainos/contract`, or a `check-rpc-contract.mjs` E1/E2/E3 assertion.
- **Behavioural** → a regression test that FAILS on the pre-fix code. Verify it
  fails, or you have pinned nothing.
- **Pattern / structure** → a fitness function (`check-grants.mjs`,
  `check-sql-parse.mjs`, `dependency-cruiser`).
- **SQL** → a runnable `supabase/tests/test_NNN_*.sql` pin, executed and read
  — see [[migration-retrofit-qa]] G4 for what "runnable" requires.

Log every catch — folded, rejected and deferred alike — in
`ai/findings-log.md` (the `B-NNN` inbox, severity CRITICAL/HIGH/MED/LOW, `Pin
type`, `Status` OPEN/PINNED). Promote a recurring one to `ai/state.md`'s
Decisions section rather than re-logging it a third time; a heavy one may also
warrant its own dated entry in `docs/reviews/`.

## Degraded mode

Codex quota **fluctuates** — this repo has hit hard "usage limit, retry at
<time>" blocks repeatedly (`ai/project-log.md`). Check before relying on it.

- Say so plainly. Never substitute a failed, dummy, or `approve`-placeholder
  verdict for a real pass.
- Run the surviving lane alone, to completion.
- Mark the report **DEGRADED**, record the missing pass as **OWED** with its
  reset time — the same convention `ai/project-log.md` and `ai/workstreams.md`
  already use for owed Codex passes.
- A degraded gate does **not** clear a mandatory seam for merge or apply. It
  clears a calibrated-lighter diff.

## What the invoking orchestrator must provide

Ask before dispatching if any is missing — a lane briefed on the wrong base is
worse than no lane.

- **The diff**: branch or explicit base SHA…HEAD, and how to reproduce it.
- **Seam classification**: which mandatory category, or "none — lighter".
- **Prior-round findings**: what was folded, what was rejected and why. Round N
  briefs carry round N-1's rejects so they are not re-litigated.
- **Non-goals**: what is deliberately out of scope.

## Report format

```
DUAL GATE — <branch/sha> · round <N>
seam            MANDATORY <category> | LIGHTER — <why>
lane A codex    <verdict> — <n> findings   | QUOTA-BLOCKED, OWED until <time>
lane B kimi     <verdict> — <n> findings   | truncated? <no|re-scoped into N>
convergent      <findings both lanes hit>
disjoint        <A-only> / <B-only>
verified        <n confirmed> · <n REJECTED — reason each>
folded          CRIT <n/n> · HIGH <n/n> · MED <n folded, n deferred to <owner>>
pins            <file:line of each pin — type, and "fails pre-fix" confirmed>
logged          ai/findings-log.md ✓ | promoted to ai/state.md Decisions | docs/reviews/
VERDICT         CONVERGED (no new HIGH/MED) | ANOTHER ROUND | DEGRADED — <owed>
```

Never report CONVERGED after a single round, on an unread verdict, or with an
unpinned HIGH.

## Worked invocation

> "Dual gate `fix/023-review` from `<base sha>`. Touches BYOK provider-key
> RLS and the action envelope — mandatory."

1. Classify: auth/grants/RLS + action envelope → mandatory, both lanes,
   iterate.
2. Dispatch in one message — Codex rescue (`gpt-5.6-sol`, `xhigh`, trace every
   consumer of the touched RPCs and every prior definition) **and** three
   scoped Kimi invocations (RLS policy predicates, `anon`/`authenticated`
   grants, the vault key-reveal path), each asked for a table, both lanes
   pointed at the thermo rubric.
3. Read both captured outputs. Codex flags a policy that reads a membership
   table inline (RLS recursion risk); Kimi flags a `GRANT` outside the `anon`
   allowlist plus one already-fixed line — open all three, confirm the first
   two, **REJECT the third with its reason**.
4. Fold the two real ones: rewrite the policy through
   `app.current_tenant_id()`, and drop the stray grant plus a
   `test_zz_anon_surface.sql` assertion that fails on the pre-fix ACL. Confirm
   the pin fails on pre-fix code.
5. Round 2 on the folded diff: Codex returns a MED on a missing role
   re-check inside the RPC body. Fold.
6. Round 3: no new HIGH/MED → CONVERGED. Log all three catches (the reject
   included) to `ai/findings-log.md`.
