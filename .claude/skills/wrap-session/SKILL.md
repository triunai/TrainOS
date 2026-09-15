---
name: wrap-session
description: End-of-session/feature doc-hygiene ritual for TrainOS. Use when the user says "wrap up", "wrap the session", "update all artifacts", "update the docs", "do the doc hygiene", "log the session", "snapshot", or finishes a feature/lane — walks the ai/ doc spine in order so nobody re-derives the routing each time.
---

# Wrap Session — TrainOS doc/state hygiene ritual

The executable form of `ai/hydration-ladder.md`'s routing, run in reverse. **Read
`ai/hydration-ladder.md` Level 0–2 first** if you have not already this session —
it is the source of truth for which file owns which fact; this skill just runs
the write-side phrase→action table so the ritual does not get re-explained
every session. See also [[additive-doc-surgery]] for the mechanics of editing
a file more than one lane touches.

TrainOS has no `hygiene.md`; the routing lives in `ai/hydration-ladder.md` plus
the split triggers documented in `ai/state.md`'s and `ai/state-backlog.md`'s own
header comments.

## Steps (in order — skip a step only when its condition is unmet)

1. **`ai/resume-brief.md`** — prepend a new `## WRAP <date> <time> (+08) —
   <one-line summary>` block at the TOP, marked to be read first. Real
   convention (see the file): the new block explicitly supersedes the entry it
   replaces — `"START HERE. Supersedes the HH:MM entry below (still accurate
   for X)"` — and states, in prose: what's live on hosted, what merged, what
   PRs are open, the next-up list in priority order, and any working rules the
   user restated this session. This is the FIRST file a cold session reads
   (`ai/hydration-ladder.md` Level 0 defers to it implicitly via
   `ai/workstreams.md`/`ai/hot-state.md`, but in practice every WRAP-tagged
   session has started here). Never overwrite an old WRAP block — stack.
2. **`ai/hot-state.md`** — prepend (do not edit in place) a new `## SESSION
   <date> — <slug>` block at the top with THIS session's truth: what you
   touched, uncommitted state, a `Resume next session` pointer. Keep the three
   literal headings **`### Focus`**, **`### Next Active Task`**, **`###
   Blockers`** exactly as spelled — a PR-body extractor keys on those literal
   strings; renaming one silently degrades that section to a placeholder.
3. **`ai/workstreams.md`** — update EACH thread you touched: flip the status
   marker (🟢 ACTIVE / ⏸ PARKED / ⛔ BLOCKED / ✅ DONE) and rewrite its
   `Resume:` line so a session with no memory of this one can cold-start from
   that line alone. Park what you pivoted away from; mark done what shipped;
   add a new thread block for anything that started. A thread that has gone
   cold moves OUT of this file and into `ai/project-log.md`. **The
   anti-context-loss step** — this is the one most often skipped and most
   expensive to have skipped.
4. **`ai/state.md`** — ONLY if a design/architecture decision SETTLED or was
   superseded this session: prepend a `D-NNN` entry under Decisions (decision +
   why + refs), and remove the matching open question from
   `ai/state-backlog.md` if it lived there.
5. **`ai/state-backlog.md`** — fold in any new owed work discovered this
   session. Entry format: a bold dated headline, then what the gap is, what
   caused it, what closing it needs. **Owner** is the lane that owes the work,
   never a person's name. **Trigger** is the event that makes it due — an item
   with no trigger is a wish, not a backlog entry. An item that settles moves
   OUT into a `D-NNN` in `ai/state.md`; an item that turns out to be a defect
   rather than a gap moves into `ai/findings-log.md` instead.
6. **`ai/findings-log.md`** — ONLY if a review pass (yours, Codex's, or a
   sibling lane's) caught a defect this session: log it, severity judged on
   what it would have done in production, never on how hard it was to find.
   **No HIGH or CRITICAL finding closes without a pin** — an executable
   assertion (a regression test, a migration check, a CI job, a branded type),
   not a comment and not a note in a commit message. `OPEN` means owed work;
   `PINNED` means the assertion exists.
7. **`ai/project-log.md`** — prepend a dated entry (latest-first, absolute
   dates, never "yesterday"): what was attempted/changed, and — the section
   this file is actually for — anything future-you needs told that isn't a
   fact any other file owns (a refuted assumption, a gotcha, a "things worth
   telling future-me" note).
8. **`CHANGELOG.md`** — ONLY if user-visible or shipped behaviour changed
   this session: a curated, latest-first entry under a dated `##` heading,
   forward-only (older entries are never backfilled), citing the
   `docs/architecture/NN` doc or `D-NNN` decision the change traces to where
   one exists.
9. **`supabase/migrations/migration-catalog.md`** — ONLY if
   `supabase/migrations/` was touched THIS session: same-commit catalog
   discipline (see `supabase/CLAUDE.md`) — bump the Migration Order row, add
   the Detail section, list affected RPCs/tables, close with a "Spine
   untouched" line or the justification if the action envelope or pipeline
   config WAS touched. Then run `npm run check:rpc` and `npm run lint:sql`
   before the commit that touches migrations, not after.
10. **Worktree hygiene** — prune only lane worktrees under
    `~/Repos/personal-work/trainos-wt/<lane>/` that are clean AND pushed.
    Never prune a worktree before its owning lane has confirmed shutdown (a
    worktree can hold uncommitted work another lane still needs — this has
    cost real work here before; see `ai/project-log.md`'s 13 Sep entries).
    List what's left standing in the `ai/resume-brief.md` WRAP block you wrote
    in step 1.
11. **Claude's own persistent memory** (`~/.claude/projects/<project>/memory/`,
    NOT a repo file) — ONLY if a durable user preference, fact, or working
    norm emerged this session that isn't already there: check `MEMORY.md` for
    an existing file to update before creating a new one; one fact per file
    plus a one-line pointer in `MEMORY.md`.
12. **`ai/hydration-ladder.md`** — ONLY if a new artifact TYPE was introduced
    this session (a new `ai/*.md` file, a new `docs/` subtree, a new level of
    context): add it at the right level so the router stays complete.

## Rules

- Link with paths; do not duplicate content across artifacts. `ai/state.md`
  owns settled decisions, `ai/state-backlog.md` owns what's owed,
  `ai/workstreams.md` owns thread status, `ai/findings-log.md` owns unpinned
  defects — a fact belongs in exactly one of these, referenced from the rest.
- **Edit additively.** Anchor on an existing neighbour line and insert whole
  new lines; never splice mid-line or reflow a table to fit one new cell. Prove
  it with `git diff --numstat` showing pure insertions on every doc you touch
  that isn't `ai/hot-state.md` (which is explicitly overwrite-at-the-top, see
  step 2). Full mechanics: [[additive-doc-surgery]].
- **This is very likely a shared worktree.** Per `AGENTS.md`: commit with
  explicit pathspecs only (`git add -- <paths>` then `git commit -F <file> --
  <the same paths>`), never `git add .`/`git add -A`/`git commit -a`. Before
  committing a file another lane might also be touching, `git diff --cached
  --numstat -- <file>` to confirm the line count is yours — a pathspec commit
  records the file's current WORKING TREE, not just your hunks. After, `git
  show HEAD -- <file>` to verify. Never `--amend`/`reset`/`rebase` on a shared
  branch (R9, R12).
- Never edit historical records (old `docs/reviews/*.md` verdicts, prior
  `project-log.md` entries, closed `D-NNN` decisions) — partition current-state
  (migrate forward) from historical (preserve) before writing.
- If "update artifacts" is ambiguous about which feature/session/lane, confirm
  scope before touching shared files.
- Finish with a one-line-per-artifact summary of what you touched (or "no
  change — condition unmet" for a skipped step), plus the worktree/lane list
  from step 10.

## Relationship to the guardrail stack

`scripts/hygiene-check.mjs` (advisory, wired into the `guardrail` lefthook tier
— see `npm run guardrails:status`) nudges you to run this ritual when
`ai/hot-state.md` has gone stale relative to recent commits. This skill is the
manual/on-demand counterpart; together they keep the end-of-session hygiene
mostly automatic without nagging every turn.
