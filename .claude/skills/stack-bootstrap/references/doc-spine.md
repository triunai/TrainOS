# The doc spine

A project's durable memory, split by **lifecycle** rather than by topic: what is happening
now, what is parked, why decisions were made, what is open, and what happened.

The core insight, from the pattern this is drawn from: a single "current state" file models
**one** thread. Real work is N threads you pivot between. Give each thread a one-line
`Resume:` and a cold reader — a new session, a new person, future-you — can pick up any of
them immediately instead of re-deriving from `git log`.

**Start at the light tier.** Four living files, not a fourteen-file split. The heavy tier
is real and earned, but it was earned over twenty-odd parallel threads and a hundred-plus
migrations. Split only when a named trigger fires (§5).

---

## 1. Folder tree to create

```
{{PROJECT}}/
  CLAUDE.md            # the constitution: stack, architecture, hard rules, conventions
  AGENTS.md            # ONLY if a second agent harness needs instructions distinct from
                       #   CLAUDE.md. Otherwise skip and fold agent-ops into CLAUDE.md.
  README.md            # written for the actual product — never scaffold boilerplate
  CHANGELOG.md         # root, curated, forward-only, product-facing
  ai/
    hot-state.md       # what changed THIS session, newest block first
    state.md           # backlog + decisions + session log, until one outgrows the file
    hydration-ladder.md # leveled context loader, levels 0-2 to start
  docs/
    architecture/      # design + business-rules docs, YYYY-MM-DD-{slug}.md
    research/          # one-off deep dives, {slug}-YYYY-MM-DD.md
    postmortems/       # one file per incident + a README.md index table
      README.md
    audits/            # security / engineering audit reports, YYYY-MM-DD-{slug}.md
```

**Do not create yet.** These are real patterns with real triggers, not defaults:
a fourteen-file `docs/ai/state/` split, `docs/superpowers/{specs,plans}/`, lane-review
folders, a separate `hygiene.md` router, a fitness ledger, a retrofit review log, a
test-failure ledger, a parkable-threads board. §5 names the trigger for each.

---

## 2. Naming and lifecycle conventions

| Folder | Naming | Lifecycle |
|---|---|---|
| `ai/*.md` | fixed filenames, no dates | living |
| `docs/architecture/` | `YYYY-MM-DD-{slug}.md` | append-only once landed |
| `docs/research/` | `{slug}-YYYY-MM-DD.md` | append-only |
| `docs/postmortems/` | `YYYY-MM-DD-{short-slug}.md`, dated by day **identified** | archive, never deleted |
| `docs/audits/` | `YYYY-MM-DD-{slug}.md` | append-only evidence |
| `docs/_archive/` (when needed) | `YYYY-MM-DD-{reason}/` mirroring original subpaths | archive |

One rule that prevents a real recurring confusion: **exactly one curated, forward-only,
product-facing `CHANGELOG.md` at the repo root.** Anything else that wants to be called a
changelog is really a design or discovery doc and belongs under a dated-slug convention in
its own folder. One source repo has three things named some variant of "changelog" and the
distinction has to be re-explained every time.

---

## 3. Skeletons

### CLAUDE.md

If the project already has a `CLAUDE.md` carrying product or design rules, **append** these
sections rather than restructuring what is there.

```markdown
# {{PROJECT}} — Claude Code context

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite 5 |
| Routing | React Router 6 |
| Server state | TanStack Query 5 |
| Validation | Zod 3 |
| Forms | React Hook Form + zodResolver |
| UI | shadcn/ui (Radix) + Tailwind 3 |
| Backend | Supabase (Postgres + Auth + Edge Functions) |
| Tests | Vitest + Testing Library |

## Architecture

<directory tree — src/ down to one level inside features/>

Feature modules are black boxes. A feature is reachable only through its
`index.ts` barrel; its internals are private. `src/shared/**` (when it exists)
must never import a feature. Enforced by `.dependency-cruiser.cjs`.

## Data access (CRITICAL)

- One `createClient()` call site: `src/lib/supabase.ts`. Nothing else imports the
  client library directly.
- Every read and write goes through the typed RPC wrapper in `src/lib/rpc.ts`.
  Types come from the `RpcMap` in `src/lib/rpc.types.ts`, updated in the SAME
  commit as the SQL.
- RLS is deny-all with zero policies; authorization lives inside
  `SECURITY DEFINER` RPCs.
- Read the RPC contract discipline below before touching any migration.

### RPC contract discipline

<the 7-point check — see references/supabase.md §5>

## Rules

### R1 — <one bold rule name>
<one paragraph, plus a short code snippet if the rule is easier shown than said>

### R2 — ...

## Documentation system

| Doc | Purpose |
|---|---|
| `ai/hydration-ladder.md` | How to load context to resume cold |
| `ai/hot-state.md` | What is actively being worked on right now |
| `ai/state.md` | Backlog, decisions, session log |
| `CHANGELOG.md` | What shipped, product-facing |

## Session start ritual

1. Read `ai/hydration-ladder.md` to the depth this task needs.
2. Read `ai/hot-state.md` — this session's starting point.
3. `git status --short --branch` and `git log --oneline -5`.

## Current work

Pointers only. Never a live snapshot here — it rots. See `ai/hot-state.md`.

## Gotchas and warnings

<A running list. When an entry stops being true, STRIKE IT THROUGH and mark it
RESOLVED or STALE rather than deleting it — a reader who half-remembers the old
claim needs to see the correction, not silence.>

## Commands

<the npm script table from references/stack.md §2>
```

The numbered-rules-with-a-snippet form (`R1`, `R2`, …) is a good compact substitute for a
separate hard-rules file and is what to start with.

### AGENTS.md (only if needed)

Pairs with `CLAUDE.md` rather than duplicating it.

```markdown
# AGENTS.md

Operational instructions for coding agents. The deeper constitution — security
model and hard rules — is in CLAUDE.md; this file is how to work here.

## Setup
<install, the one command that proves the checkout is healthy>

## The guardrail stack

| Juncture | Runs | Blocks? |
|---|---|---|
| every Bash tool call | safe-command-guard | yes, always |
| pre-commit | lint-staged (prettier) | yes |
| commit-msg | commitlint | yes |
| pre-push | guard.mjs all (advisory layer) | no |
| CI | the 13-job pipeline | yes, via the summary job |

### Toggle
`npm run guardrails:off` pauses the advisory layer only. Baseline hooks and the
safety guard are unaffected and cannot be paused.

### Architecture rules
<the three dependency-cruiser rules, one line each>

## The doc control plane

One question per file.

| File | The one question it answers |
|---|---|
| `ai/hydration-ladder.md` | How deep do I need to read for this task? |
| `ai/hot-state.md` | What changed this session? |
| `ai/state.md` | What is open, what was decided, what happened? |
| `CHANGELOG.md` | What shipped? |

## Session wrap
<the ordered list of files to touch at the end of a session>

## Skills
<One bullet per available skill, name plus one line. NEVER paste SKILL.md bodies
here — some agent harnesses truncate their combined instruction file at a size
limit, and a bloated list silently drops the tail.>
```

### README.md

Write it for the actual product from day one. Leaving scaffold boilerplate in place is the
single most common doc-rot failure in a new repo, and it stays wrong for months because
nobody's task is ever "fix the README".

Until the module count justifies more, this is enough:

```markdown
# {{PROJECT}}

<One paragraph: what this is and who it is for.>

## Stack
<table>

## Quick start

### Prerequisites
### Environment variables
Copy `.env.example` to `.env` and fill it in. Every variable is documented there.

### Install and run
### Build and checks

## Routes
<route family -> what lives there>

## Documentation
See `CLAUDE.md` for conventions and `ai/hydration-ladder.md` for context loading.
```

The encyclopedia form — a numbered outline running from product scope through a recursive
module map to a file-pointer index — is what this grows into once there are enough modules
to get lost in. Do not start there.

### CHANGELOG.md

```markdown
# Changelog

Tracks notable shipped changes across migrations, data contracts, frontend types
and project documentation. Append new entries at the top, ISO-8601 dates.
Forward-only: older gaps are not backfilled.

> **Decision links.** An entry reflecting a real architectural decision cites it
> as `(D-NNN)`, and that decision's entry in `ai/state.md` carries a
> `Changelog:` line pointing back here. The point is to make a shipped behaviour
> traceable to its reasoning without archaeology — a postmortem you can read
> forward.

## YYYY-MM-DD — <headline>

### Added
- **<Bold lead phrase, user-visible>.** <Plain-prose detail.> (`<short-hash>`)

### Changed
### Fixed
### Security
### Note
```

Use `### Note` to point at a sibling entry rather than duplicating it when two entries land
the same day from the same merge.

### ai/hydration-ladder.md

Seed with levels 0 to 2. Add 3 to 5 once there are hard rules, architecture docs and
postmortems worth pointing at.

```markdown
# Hydration Ladder

> How to load context to resume cold. Leveled: read only as deep as your task
> needs.

**Level 0 — orient (always):**
- README.md
- ai/hot-state.md

**Level 1 — what is in flight:**
- `git status --short --branch`
- `git log --oneline -5`

**Level 2 — standing context:**
- ai/state.md (backlog + decisions + recent sessions)

<!-- Add as the project grows:
**Level 3 — rules and architecture (before touching contracts):**
- CLAUDE.md, module CLAUDE.md files, supabase/migrations/migration-catalog.md

**Level 4 — operational / debugging:**
- docs/architecture/, the guardrail script headers

**Level 5 — full rehydration:**
- docs/postmortems/, docs/audits/
-->

## Maintaining this file

A new durable doc gets a line here at the level a reader would first need it, in
the same commit that creates the doc. A doc nobody can find is a doc nobody has.
```

### ai/hot-state.md

```markdown
# Hot State

> What is actively being worked on right now. Newest session block first.
> Historical detail moves to CHANGELOG.md once a chunk ships.

<!-- Session block template — PREPEND a new one, never overwrite:

## SESSION YYYY-MM-DD — <ALL-CAPS TITLE>

> **Last updated:** YYYY-MM-DD — <one line>

### Focus
<what this session is actually about, one short paragraph>

### Shipped
-

### Next Active Task
<the exact next action, cold-startable — someone with no context can begin here>

### Blockers
<or "none">

### New durable artifacts
<files created that outlive this session>

---
-->
```

The three `###` headings `Focus`, `Next Active Task` and `Blockers` are an implicit contract
if the PR auto-sync in `references/hooks-and-ci.md` §6 is adopted — the extractor keys on
those literal strings. Renaming one silently degrades that PR section to a placeholder.

Despite "newest first", in practice this file grows by **prepending** and leaving history
below a horizontal rule rather than literally overwriting. That is fine and is the observed
behaviour; the header just tells a reader which end is current.

### ai/state.md

```markdown
# State

> Backlog, decisions and session log in one file until it outgrows this shape.
> Split triggers are in the project's stack-bootstrap notes; do not re-derive
> them under pressure.

## Backlog

<!-- Entry format:
**OPEN (YYYY-MM-DD, <context>) — <ALL-CAPS HEADLINE>.** <Prose: the gap, its
root cause, and what closing it needs.>

OPEN work only. A settled item moves OUT to Decisions below. This is not a
thread-status board.
-->

## Decisions

<!-- Latest first. SUPERSEDE, never delete. Entry format:

## D-NNN · <one-line decision title> · ACTIVE|SUPERSEDED

**Context (YYYY-MM-DD).** <what forced the decision, with file:line specifics>

**Decision.** <the ruling, stated as a rule others can follow>

**Why <the obvious alternative> does not fit.** <reasoning>

**The constraints that make this safe.** <numbered list, if it is a risky pattern>

**Consequence to accept honestly.** <the trade-off, stated without spin>

**Refs.** <files, review docs, other D-NNN>
-->

## Session Log

<!-- Latest first, append-only. One block per session:

## YYYY-MM-DD — <summary>

- <what happened>

**N things worth telling future-me:**
1. <a negative result, a wrong assumption that got refuted, a process lesson>

That numbered list is the most valuable habit in this file. Outcomes survive in
git; the reasoning that was wrong does not, unless it is written here.
-->
```

**`D-NNN` collision warning, learned the expensive way**: two long-lived branches each
independently allocated the same decision numbers to different decisions, and the merge
preserved both silently. The recovery is a permanent collision banner at the top of the
file, **not** renumbering — renumbering misdirects every existing citation elsewhere in the
spine. Allocate `D-NNN` from the merge target, or accept the banner as the recovery move.
Convention alone does not prevent this once more than one long-lived branch exists.

### docs/postmortems/README.md

```markdown
# Postmortems

One file per incident, `YYYY-MM-DD-{short-slug}.md`, **dated by the day
identified, not the day resolved**. Never deleted, occasionally referenced.

Separation from the backlog: backlog = we should do this when convenient.
Postmortem = this is what we learned.

| Date | Incident | Severity | Durable rule produced |
|---|---|---|---|
```

Incident file section order: header block (`Date identified`, `Severity`, `Status`) →
`## Summary` → `## Impact` → `## Timeline` (a `When | What` table) → `## Root Cause`
(numbered contributing factors) → `## Why <the safety net> did not catch it` →
`## What went well` / `## What went wrong` → `## Mitigation` → `## Durable Rule` →
`## References`.

`## Why the safety net did not catch it` is the section that earns the file. The incident
is usually less interesting than the gate that should have caught it and did not.

---

## 4. Additive doc surgery

Living docs get edited by concurrent sessions and branches. These rules keep those edits
from clobbering each other or triggering a formatter rewrite that guarantees a conflict.

1. **Anchor every edit on an existing neighbour line and insert whole new lines.** Never a
   mid-line splice of an existing line.
2. **Table rows are one physical line.** No pipes or newlines inside a cell. Keep each cell
   shorter than the widest existing cell in that column — an overflow triggers a formatter
   re-pad, which rewrites the whole table, which is a guaranteed merge conflict.
3. **On a branch, do not overwrite an "overwrite each session" doc.** Append a
   `## Worktree addendum — YYYY-MM-DD · branch <name>` block instead, and note in it that
   the main branch's top block wins on conflict.
4. **Run the formatter yourself before committing, then prove the footprint**:
   `git diff --numstat` must show pure insertions (`N 0`) on every edited doc.
5. **State the conflict rule where the next reader will look.** Append-style docs: union
   both sides. Overwrite-style docs: main wins, re-append.

---

## 5. Split triggers

Each named once here so it is not re-derived under pressure. Watch for the trigger; do not
pre-empt it.

| Trigger | Split to make |
|---|---|
| `ai/state.md` stops being readable — backlog, decisions and session log tangled | split into `hot-state.md` / `state-backlog.md` / `decisions.md` |
| More than ~5 threads in flight and a single "current work" paragraph starts losing one while advancing another | add a `workstreams.md` parkable board (§6). **The highest-value split** — it is the direct anti-context-loss tool |
| More than ~5 living docs to route between | promote the "docs to read first" table out of `CLAUDE.md` into its own router file |
| A review sweep produces more than a couple of findings at once | start a `docs/reviews/YYYY-MM-DD-{slug}/` lane folder rather than writing findings straight into a permanent log |
| Three or more incidents of the same failure *shape* | write a decision entry, not a fourth regression test |
| Cross-cutting UI and hooks outgrow `src/components` / `src/hooks` across 3+ features | extract `src/shared/`, change the `components.json` aliases, rewrite imports in one pass, enable the third dependency-cruiser rule |
| Per-feature design docs start colliding in `docs/architecture/` | split into `specs/` (the why/what) and `plans/` (the how); a plan cites its spec |

---

## 6. Patterns to reach for when a trigger fires

Sketched, not seeded. Enough to implement correctly without re-researching.

### workstreams.md — the parkable board

Every initiative is a first-class, parkable thread rather than a single "current work"
snapshot. Status markers: `ACTIVE` · `PARKED` · `BLOCKED` · `DONE`.

```markdown
## <THREAD NAME IN CAPS> — <one-line state> (YYYY-MM-DD) · ACTIVE

**Resume:** <exact next action, cold-startable>

**Scope:** <what this thread covers>

**Warning:** <any standing warning specific to this thread>

**Refs:** <file paths, spec/plan links, D-NNN ids>
```

Parking a thread = flip the status and write the `Resume:` line. Picking one up = read the
block, jump to its refs, flip back. Threads go to the session log once cold.

### findings-log.md — the review-catch inbox

A table per catch: `date · area · catch · severity · pin-type · pin-ref · status`.

The rule that makes it work: **no HIGH or MEDIUM finding closes without a pin** — either a
branded type (for loose-type bugs) or a regression test (for logic and async bugs).
`OPEN` means owed work. Recurring findings promote out of this file into a decision entry
or a postmortem. This file is the inbox; the decisions log is the curated archive.

### test-failure-ledger.md — the taxonomy for a red test

Reusable verbatim, and worth adopting early even without the file, because the categories
are how you should think about any failing test:

| Category | Meaning | Obligation |
|---|---|---|
| REAL BUG | the code is wrong | fix the code, never touch the assertion |
| PIN DEFECT | the test is wrong | fix the test, state why in the test, check sibling tests |
| PREMISE RETIRED | the test was right, the world changed | replace the assertion with the surviving invariant |
| HARNESS | missing provider/mock/env, not a real signal | fix the harness; make it a shared fixture if it recurs |

### Lane reviews — the three-stage pipeline

Raw lane review → triage ledger → pinned finding. Keep the stages distinct rather than
writing findings straight into the permanent log.

One dated folder per sweep, containing a dispatcher-verification file plus one file per
lane. Each lane file opens with a provenance line (what was read, on which branch, against
which database, confirmed how), a bold finding count by severity, and — the part worth
copying above all — a **"Premises I was handed — corrections"** table with `Brief claim |
Verdict` rows, checking the dispatcher's assumptions against the live repo before trusting
any of them.

Triage then reclassifies raw findings by "what must be true before this can hurt someone"
rather than by severity, into buckets like LIVE-OPEN / PRE-MERGE / PRE-APPLY / PRE-DEPLOY /
CLOSED / REFUTED. Only survivors get pinned.

---

## 7. Retiring a doc

**Archive, do not delete.** `git mv` into `docs/_archive/<original/subpath>`, never `rm`, so
history and a one-line restore both survive.

Staleness is judged on two independent axes, crossed — never collapsed into one signal:

| | linked by something LIVE | orphaned (no live inbound link) |
|---|---|---|
| **content live** | LIVE — keep | WIRE — undiscoverable; add a link, never archive |
| **content dead** | redirect the link, then archive | archive clean |

Full verdict set: **LIVE** · **WIRE** · **ARCHIVE–superseded** (a named, confirmed successor
exists) · **ARCHIVE–absorbed** (the conclusion now lives in a living doc — confirm by
grepping the destination for the actual conclusion, not just that a file exists) ·
**ARCHIVE–dead-context** (references branches, repos or state that no longer exist) ·
**REFRESH** (still canonical, just factually stale — update it, do not archive it) ·
**UNSURE** (ambiguous; escalate to a person, never archive on suspicion).

Process: grep the inbound-link graph path-scoped (generic filenames like `decisions.md`
collide across projects) → classify each doc to exactly one verdict with evidence → archive
only if no live inbound link, or redirect every live link **in the same commit** as the
move → produce a manifest (`path · verdict · why · successor · live inbound links ·
proposed redirect`) for sign-off → execute in staged, reversible commits, each doing the
move and its redirects together so the tree is never left with a dangling link.

Record *why* each doc was retired where a reader would look, rather than letting it vanish
silently.

---

## 8. If an external knowledge vault is in play

One rule, stated identically on both sides: **the repo is the source of truth; the vault is
a teaching mirror. If they disagree, the repo wins**, and the disagreement gets logged in
the vault rather than silently resolved by editing the repo to match a note.

Writes flow repo → vault only, by convention, not automation. Never vault → repo.

**Resolve the vault root by probing, never by trusting a hardcoded path in a doc.** A
single recorded path caused a real incident: an agent trusted it, concluded the vault was
unreachable, and both notes it wanted were sitting on disk the whole time. Probe the
candidate locations and take the first that exists.
