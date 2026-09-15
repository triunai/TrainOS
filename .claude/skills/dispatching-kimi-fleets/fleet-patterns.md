# Fleet patterns — topologies, failure modes, pre-dispatch checklist

Distilled from two vault notes, both derived from real runs (originally across
the sibling Wishes2Vows/showroom repo and this one):

- `Single-Worktree Agent Fleet.md` (2026-07-26) — 6 concurrent lanes, one tree
- `Parallel-Agent Worktree Isolation.md` (2026-07-13) — the layered isolation rig

Canonical copies (keep them updated, see SKILL.md):
`/Users/khumeren/Obsidian/Radiant/Main/Software Engineering Patterns/DevOps & Automation/`

---

## The two topologies, and what each actually buys

|                        | Single worktree                                           | Isolated worktrees                             |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| Enforcement            | **Prose only** — the brief is the lock                       | **Filesystem** — disjointness is real              |
| Cross-lane consumption | Immediate (lane B imports lane A's 14:00 commit at 14:05)    | Needs fetch/rebase                                 |
| Setup tax              | One `node_modules`, one env, one dev server                  | Per-worktree install                               |
| Converts               | nothing — a clobber is silent                                 | silent corruption → **visible merge conflict**     |
| Fails at               | shared config clobber, dev-server reload storms               | nothing it can't see                               |

**The core insight from the first full run:**

> **Isolation fixes contention, not duplication.**

Two agents told to model the same concept will model it twice regardless of
topology — different file paths means no merge conflict, so it lands silently
in both. Measured in this repo: one afternoon of parallel screen-building
produced `ActionOutcome` written five times with three copies already
diverged, one status/tone-mapping helper rewritten four times,
`formatDateRange` twice, and the breadcrumb component five times
(`ai/project-log.md`, 2026-09-13). No lane was careless — each was correctly
unwilling to block on another lane's file. Isolation would not have caught
this; per-task review structurally cannot either.

## The recommended shape (hybrid — prefer this over either pure form)

1. **Land primitives first, sequentially, on the branch.** Design tokens, the
   kit component (`apps/web/src/shared/components/kit`), cross-cutting seam
   fixes, the contract package. Small verified commits, dependency order.
2. **Then fan consumers into worktrees branched off that commit.** They get
   isolation AND the primitive — no fetch dance, no merge-day surprise about
   which version they built against.
3. **Shared files get exactly ONE owner — the integrator.** `tsconfig*`,
   barrels (`index.ts` per feature), `supabase/migrations/migration-catalog.md`,
   lockfiles. Neither topology fixes contention; only ownership does.
4. **Name the canonical module in the brief.** The duplication above happened
   because several briefs each said "render this status" without saying where
   the existing tone helper lived. "The status chip lives at `X`; import it"
   prevents it in either topology and costs one sentence.
5. **Serve any preview from a pinned worktree, never the live agent tree.**
   Non-negotiable once more than one agent is writing — agents rewriting
   source under a live `npm run dev` produced an error boundary firing every
   2–3s in past runs.

## The file-ownership contract

Every writer's brief opens with an enumerated allow/deny. Not "focus on X".

```
## FILE OWNERSHIP — N other agents run concurrently
**Yours:** <exact paths> · your own tests.
**NOT yours:** <exact paths of every other lane's territory>
If the work seems to require a NOT-yours file, STOP and report it as follow-up.
```

What made it hold:

- **Deny-list the other lanes by name.** "`apps/web/src/features/finance/**`
  belongs to another lane" is actionable; "don't touch unrelated files" is not.
- **State the consequence, and give a legal exit.** Without one the agent
  either stalls or trespasses.
- **Name shared read-only deps explicitly** — "READ these, do NOT edit them" —
  and say _why_ (a sibling owns it, e.g. `packages/contract`). Agents reliably
  respected this when told.
- **Hub files force sequencing.** A file wanted by 3+ tasks (`endpoints.ts`,
  the kit barrel, `migration-catalog.md`) runs in series, full stop. No
  contract fixes that. Identify hub files _before_ dispatching a wave.

## Pre-dispatch checklist

1. **Ownership matrix.** List every task's paths. Any file appearing twice is
   either a sequencing constraint or a brief bug. Resolve before dispatch.
2. **Hub-file scan.** 3+ claimants → serial.
3. **Shared-config owner.** Exactly one lane (or the orchestrator) may touch
   `tsconfig*`, barrels, `migration-catalog.md`, lockfiles.
4. **Base SHA, explicit and verified by the agent.** Not `HEAD`, not "main" —
   a SHA (`git worktree add <wt> -b <branch> <SHA>`). A stale base is how a
   lane lands behind a live fix on a money- or compliance-sensitive path
   (invoicing, HRD Corp claims) without anyone noticing.
5. **Regression net armed BEFORE the first dispatch:**
   - **test-name inventory** — a _deleted_ test is invisibly green. Diff names,
     not counts.
   - **protected-surface file list** — e.g. every public/portal route file
     (`apps/web/src/pages/**`, the client-portal RPCs). Assert a zero diff
     against baseline after each commit.
6. **Dependency order.** Primitive-producing lanes commit before consumers
   dispatch.
7. **Kill plan decided in advance** — mid-write work is DISCARDED, so the call
   isn't made under time pressure.

## Dos

- **Give each agent its §refs, not a summary.** Cite the doc section
  (`docs/architecture/0N-*.md`, `supabase/CLAUDE.md`) and let it read.
  Summarising the spec into the brief produced worse results and hid
  contradictions.
- **Invite evidence-backed contradiction of the spec, explicitly.** Highest-value
  single instruction. Several TrainOS review passes have disproved a doc's own
  claim with `file:line` citations — a "5 Blockers" count that actually mixed
  severities and dropped two real Blockers, a cron-trap description that
  overstated what the migration did (`ai/project-log.md`, 2026-09-13 entries).
  Tell agents "the doc has already needed a retraction; contradicting it with
  evidence is welcomed" and they check.
- **Bake known repo traps into the brief** — a bare `vitest` at repo root
  skipping `apps/web`'s alias config, the `SET search_path = ''` spelling
  rule, a banned colour pair. Cheap insurance; they won't open the doc.
- **Ask for the decision, not just the code** on ambiguous calls: "evaluate X
  and make a reasoned call; an unexamined 'leave it' is not acceptable." This
  has been used to _refuse_ an orchestrator's suggested refactor with evidence
  it would have regressed.
- **One commit per task, authored by the orchestrator**, body covering root
  cause, blast radius, deviations, verification. Commits are the only durable
  record when N transcripts are unreadable.

## Don'ts

- **Don't trust an agent's gate output.** In a shared tree `npm test` sees
  other agents' half-written files. Agent gates are ADVISORY; the
  orchestrator's post-commit run on the settled tree is AUTHORITATIVE. Say
  this in the brief so agents report what they see instead of "fixing" a
  number by editing someone else's file.
- **Don't let two agents near a shared config file.** A whole-file write to a
  shared config or barrel can silently erase a sibling lane's entries —
  caught only when that lane re-checks and says so.
- **Don't commit an agent's work after killing it mid-write.** A lane that has
  already deleted files as part of an unfinished refactor should be discarded
  and re-dispatched; the brief is reproducible, a half-refactor is not.
- **Don't infer "settled" from an empty diff.** A stability watcher can read
  _stable-empty_ as _finished_ while agents are still in their read phase.
- **Don't let one lane both define a contract and migrate all its call sites.**
  Splitting "define primitives" from "migrate each screen" turns an
  unreviewable mega-diff into a reviewable contract plus independent adopters.

## The real ceiling

**2–4 hot agents.** The budget is **reviewable diff lines per day**, not
compute. If the merge queue exceeds what you can honestly read, you are over
budget regardless of agent count. This repo has hit the same ceiling by a
different road more than once: the binding constraint was orchestrator review
throughput, not agent count — see the shared-worktree lessons recorded at the
top of `ai/resume-brief.md`.

## Two reviewers beat one deep pass

Two reviewers with _different_ lenses, run concurrently and blind on the same
diff, routinely find **disjoint** issues in this repo — a maintainability pass
catches structural duplication that a security/correctness pass misses, and
vice versa (see the paired thermonuclear + Codex reviews under
`docs/reviews/`). Neither pass alone suffices. Corollaries: read the captured
verdict, never the exit code; separate _fix-before-commit_ from
_fix-before-apply_; record what BOTH reviewers cleared so a later session
doesn't re-audit settled ground.

## Recurring defect class: absence read as a value

Several unrelated bugs across sessions, same shape — _"not yet" indistinguishable
from "none"_:

- Product: a permission-aware list renders `0` while rows exist but are
  filtered out by RLS, indistinguishable at a glance from "genuinely empty."
- Tooling: a stable-**empty** diff read as "agents finished."
- Testing: a test that vanished read as a passing test.

**Fix in all three: make the states structurally distinct** — a discriminated
union, a two-phase wait, a name-level inventory — rather than inferring one
from the emptiness of the other. Worth a grep whenever a `?? 0`, a
`length === 0`, or a bare count is load-bearing.

## Cheap detector for the duplication class

Isolation won't catch it and per-task review structurally can't. A grep at
integration will. Run it **before** the integration review, not after:

```bash
git diff --name-only <base>..HEAD \
  | xargs grep -hoE '^export (type|const|interface) [A-Za-z]+' \
  | sort | uniq -d
```

## Monitoring — instrumentation over scraping

You can't monitor what the worker doesn't emit. Tailing terminals is
_scraping_; state files and commits are _instrumentation_. Adopt in order;
each earns the next.

1. **Workers write state** (discipline, zero infra). Brief line: _"after every
   milestone, commit or write your status to disk — work that exists only in
   conversation doesn't exist."_ An instrumented worker is auditable
   mid-flight; an un-instrumented one can look stalled from mission control
   while actually healthy — a false alarm by construction.
2. **Pull-based polling.** A coordinator loops a read-only sweep (commits since
   fork, dirty counts per owned path, new state files) and reports **only
   deltas and stalls**. Two ticks with zero change = go poke that terminal.
3. **Push signals** — a turn-end hook appending timestamp · branch · last
   commit · dirty count. This is the ONE thing git state cannot tell you:
   "thinking for 20 minutes" vs "sitting at a permission prompt for 20
   minutes."

Git truth shows **state, not liveness**. Don't build a transcript-tailing
daemon; that's tier 3 with more moving parts.

## When NOT to use the heavy rig

- ❌ **Recipe-execution phases** (a proven procedure over a known worklist). Two
  sessions on disjoint-by-construction work need two plain worktrees and
  briefs, not eight layers of coordination. The rig here is ceremony.
- ❌ **Read-only audit fleets.** Nothing is written, so there is nothing to
  isolate. Run concurrently in one checkout with `--no-tools`.
- ✅ **Discovery / characterization swarms** on unfamiliar code — N agents
  pinning N high-fan-in modules (e.g. one migration domain each), findings
  flowing back. This is what isolation was designed for; the deliverable is
  _understanding_.
- ✅ Any phase where "who owns this path?" has no answer yet.
