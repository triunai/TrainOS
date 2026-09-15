---
name: agent-task-contract
description: Use BEFORE dispatching any agent, subagent, worktree fleet, or long autonomous run in TrainOS — and when deciding single-worktree vs multi-worktree vs hybrid topology. Turns a request into a CONTRACT (objective, current state, desired state, allowed files, architecture rules, acceptance criteria, validation commands, non-goals, stop conditions, commit slices), splits discovery from implementation, makes machine checks the gatekeeper, and requires agents to verify the premises they were handed. Triggers - "spawn an agent", "dispatch agents", "worktree fleet", "parallel agents", "task packet", "brief an agent", "run this autonomously".
---

# Agent Task Contract

## The problem this solves

An agent given a _request_ optimises for looking helpful. An agent given a
_contract_ optimises for satisfying it. The difference shows up 10–20 minutes
later, when the run is already expensive:

- it "improved" three unrelated systems on the way past
- it worked from a premise in the brief that was **false**
- it returned one enormous diff whose reasoning is unrecoverable
- it reported success against gates it never ran
- two parallel agents implemented the same concept twice, differently

Every one of those is preventable at dispatch time, for the cost of a longer
prompt. The prompt is always cheaper than the run.

## 1 · The packet — ten parts, none optional

A dispatch is not ready until all ten are written down.

| #   | Part                                                                 | The failure it prevents                            |
| --- | --------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | **Objective** — one sentence, in outcome terms                        | A run that optimises for activity                  |
| 2   | **Current state** — what is true NOW, with `file:line`                | A fix for a problem that no longer exists          |
| 3   | **Desired final state** — observable, not aspirational                | "Done" meaning whatever the agent decides          |
| 4   | **Files/modules allowed to change**                                   | Collateral edits in shared files                   |
| 5   | **Architecture rules** it must obey                                   | A local fix that violates a global invariant       |
| 6   | **Acceptance criteria** — binary, checkable                           | A confident report with nothing behind it          |
| 7   | **Validation commands** — literal, copy-pasteable                     | "Tests pass" as an assertion rather than an output |
| 8   | **Explicit NON-GOALS**                                                | The helpful improvement nobody asked for           |
| 9   | **Stop conditions** — when to halt and report instead of pushing on   | An hour spent on a blocked path                    |
| 10  | **Expected commits / checkpoints**                                    | One unreviewable mystery diff                      |

**Non-goals do the most work.** A capable agent that finds a mess adjacent to
its task will fix the mess, because that reads as diligence. Name the adjacent
systems it must leave alone — especially the doc spine (`ai/resume-brief.md`,
`ai/hot-state.md`, `ai/state.md`, `ai/workstreams.md`), shared config
(`tsconfig*`, barrels, `supabase/migrations/migration-catalog.md`), and
anything another agent is holding.

## 2 · Split discovery from implementation

Three phases in one dispatch. The agent may run straight through; the point is
that it must **materialise the plan** before acting on it.

```
Phase 1  INSPECT   map dependencies, identify risks, state the plan
Phase 2  EXECUTE   the plan from Phase 1
Phase 3  VALIDATE  run the gates, and REPORT DEVIATIONS from the plan
```

Phase 3's deviation report is the part people drop, and it is the part that
tells you whether Phase 1's plan survived contact. "I planned X, found Y, did Z
instead, because —" is worth more than a green checkmark.

## 3 · Machine checks are the gatekeeper

Human eyeballing is essential for UI and worthless for contracts. Put the
machine first, then look.

**TrainOS's baseline gate** (npm workspaces, root `package.json` scripts):

```bash
npm run typecheck          # apps/web + packages/contract + packages/fixtures + packages/agent-runtime + apps/worker
npm run typecheck:strict   # apps/web graduated allowlist ratchet
npm run lint                # eslint; lint:hooks is a separate, focused pass
VITE_API_MODE=fixtures VITE_SHOW_ERROR_DETAILS=false npm test -- --run
npm run build
```

**Never run a bare `vitest` at the repo root.** It skips `apps/web`'s Vite
alias config and produces phantom failures across dozens of files that have
nothing to do with the change — always go through `npm run test` (which
delegates to `apps/web`, `packages/fixtures`, `packages/agent-runtime`,
`apps/worker`) with the env vars above, or run `vitest` from inside `apps/web`
directly.

**Add the feature-specific gates** — these are where real defects are caught:

| If the work touches…            | Also run / assert                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Any RPC or migration              | `npm run check:rpc` (0 BROKEN), `npm run check:grants`, the [[migration-retrofit-qa]] skill, and **execute the SQL pin** in `supabase/tests/test_NNN_<slug>.sql` |
| A migration's reversibility       | The rollback in `supabase/rollbacks/NNN_<slug>_rollback.sql` applies, and restores the PRIOR definition faithfully     |
| Public/portal routes              | `git diff --stat <base>..HEAD -- <public paths>` — state the diff, and whether it was allowed                         |
| Generated assets (barrels, types) | Inspect the OUTPUT, not the generator. `npm run check:barrels`. A silent no-op prints success                         |
| Auth / tenancy / RLS               | Signed-out, signed-in, wrong-tenant, and no-access — all four, explicitly; plus `anon` vs `authenticated` grants       |
| Architecture (feature boundaries)  | `npm run arch:graph` (0 violations against `.dependency-cruiser.cjs`)                                                  |
| Anything shipped                  | `npm run verify:deploy`                                                                                                |

Two rules that came from real incidents in this repo:

- **Never trust an exit code.** A build script or reviewer tool can exit 0
  while degraded or truncated. **Read the output.**
- **An authored test that was never executed is not a test.** `ai/project-log.md`
  records a catalog SQL pin (`T3b`) whose fixture selected `FROM core.engagements
  LIMIT 1` against a table with zero rows in that pin — the dependent `IF FOUND`
  was false, so the assertion it claimed to prove silently never ran. The same
  standard applies to any `supabase/tests/test_NNN_*.sql` pin: it must end in
  `ROLLBACK` and it must actually have been executed, not merely authored.

## 4 · Commit in slices

A two-hour run must not end in one diff. Slice so the reasoning is legible from
`git log` alone, without reading the transcript:

```
1  schema / contract foundation      (supabase/migrations, packages/contract)
2  backend behaviour                  (RPC bodies, packages/agent-runtime)
3  frontend integration               (apps/web/src/features/**)
4  tests + generated assets           (supabase/tests, barrels, fixtures)
5  cleanup discovered during validation
```

Slice 5 matters more than it looks — it is where "what the run learned" lives,
and it is the slice most often silently folded into slice 2.

## 5 · Worktree topology — pick by dependency shape

**Parallelism pays only when the merge surface is smaller than the time saved.**

| Shape                            | Use                                                                          | Because                                              |
| --------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Single worktree, agent fleet**  | Tasks keep touching the same central files — contracts, migrations, kit       | Isolation would only move the conflict to merge time |
| **Multi-worktree**                | Genuinely separable work — one RPC domain / an isolated frontend feature / docs | No shared surface to contend on                      |
| **Hybrid**                        | A shared foundation with independent consumers                               | Serialise the contract, parallelise what consumes it |

```
Hybrid:   main agent lands the shared contract/migration
                          ↓
          parallel agents implement independent consumers
                          ↓
          integration agent merges and validates
```

Worktrees for this repo live under `/Users/khumeren/Repos/personal-work/trainos-wt/<lane-name>`
(the primary checkout is `/Users/khumeren/Repos/personal-work/trainos`). Cut
each from a stated, verified base SHA — see [[dispatching-kimi-fleets]] for the
multi-lane dispatch mechanics.

**Isolate unconditionally when** the work breaks a property the base branch
holds (e.g. a verified zero-public-route-diff, a clean `check:grants`), touches
the spine (`app.submit_action`, the policy gate, `pipeline_step`), or is
expected to be thrown away.

**Known limit, learned here:** N agents in ONE worktree with file-ownership
contracts does prevent file conflicts — but it does **not** prevent
concept-duplication (two agents inventing the same abstraction differently) or
commit-ordering failures (a consumer committed before its producer, leaving a
HEAD that references an untracked module). One afternoon of parallel screen
work produced `ActionOutcome` written five times with three copies already
diverged, one tone-mapping helper rewritten four times, `formatDateRange`
twice, and the breadcrumb five times — no lane was careless, each was just
correctly unwilling to block on another lane's file (`ai/project-log.md`,
2026-09-13). Agent gates are advisory in a shared tree. Budget review time for
exactly this class of defect — the consolidation rule in `CLAUDE.md` only
holds if the kit lands *before* the screen lanes that would otherwise reinvent
it.

## 6 · Verify the premises you were handed

_(The addition this repo learned the hard way — a brief is not evidence.)_

Every packet must instruct the agent:

> **Before acting on any factual claim in this brief, verify it against the
> repository.** Docs in `ai/` and `docs/reviews/` rot fast in a multi-lane repo.
> If a claim is false, say so, state what is actually true with `file:line`,
> and proceed on the corrected fact rather than the brief.

And every agent must end its report with:

> **What I could NOT verify**, and what would settle it.

Instances from this repo's own log:

- A thermonuclear review of migration 018 reported "5 Blockers" as its headline
  count, but the summary mixed severity levels and **omitted two real
  Blockers** — only reading the doc's own B1–B5/H1–H5/M1–M8 headings against
  its text caught it (`ai/project-log.md`, 2026-09-13 22:1x entry).
- A documented "fails invisibly with a green-looking cron table" trap for
  migration 015 was itself overstated relative to what the migration actually
  did — recorded and corrected in the same log (`ai/project-log.md:1233`).
- (From the sibling Wishes2Vows/showroom repo, kept because the lesson
  generalises: an owner-approved design doc built its central rule on a
  component that had already been deleted from the tree. Followed literally,
  it would have shipped the wrong thing — this is why "verify against the repo,
  not the doc" is step one, not a courtesy.)

**A review, a plan and a design doc are all EVIDENCE TO VERIFY, not verdicts to
fold.** Two independent reviewers in this repo, given the same diff, have
reported disjoint findings and contradicted each other's severity calls more
than once — read the primary evidence they cite, not just their verdict line.

## Dispatch checklist

```
[ ] All ten packet parts written
[ ] Non-goals name the adjacent systems to leave alone (doc spine, shared config, other lanes)
[ ] Phase 1/2/3 stated, with a deviation report required in Phase 3
[ ] Validation commands are literal and include the feature-specific gates
[ ] Test invocation uses VITE_API_MODE=fixtures VITE_SHOW_ERROR_DETAILS=false npm test -- --run
[ ] Commit slices named
[ ] Topology chosen by dependency shape, and isolation forced where a branch
    property or the spine is at risk
[ ] "Verify the premises" + "what I could not verify" clauses included
[ ] Told what OTHER agents are doing, so it does not duplicate or collide
```
