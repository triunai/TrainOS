---
name: retiring-stale-docs
description: Use when TrainOS's docs/ tree (architecture, reviews, design, bd, audits, postmortems, research, deploy) or the ai/ doc spine has grown bloated with stale, superseded, one-off, or dead-context files and needs cleanup — determining what is actually stale and retiring it without deleting history or breaking cross-references. Triggers - "clean up the docs", "these docs are stale/bloated", "archive old docs", "retire dead files", "too many files in docs/reviews", doc-rot, doc sprawl.
---

# Retiring Stale Docs

## Overview

TrainOS's doc tree rots the normal way: `docs/reviews/*.md` accumulates a dated file per review pass and never gets pruned; `docs/architecture/spikes/` holds explorations some of which were absorbed into the numbered `01`–`09` architecture docs; `ai/briefs/*.md` holds one-off session plans (e.g. `2026-09-13-api-phase-plan.md`) that get absorbed into `ai/workstreams.md` or `ai/state.md` once the work lands; `docs/bd/ai-explorations/` and `docs/design/` accumulate brainstorm and design-brief files superseded by later revisions. The instinct is to `rm` the clutter. That loses recoverable history and silently breaks navigation (`ai/hydration-ladder.md`'s level-2 pointers, `ai/resume-brief.md`'s "read this first" links, cross-references inside `docs/architecture/06-critic-review.md` and similar).

**Two core principles:**
1. **Archive, don't delete.** Retire a doc by *moving* it (`git mv`) to an archive tree, e.g. `docs/_archive/<original/subpath>` — history travels, restore is one line. Deletion is a last resort.
2. **Staleness is two axes, and they cross.** Judge each doc on *content* (still true/needed?) **and** *live inbound links* (does anything still-live point at it?). Never collapse to one signal — low inbound is NOT an archive signal by itself:

| | linked by something LIVE | orphaned (no live inbound) |
|---|---|---|
| **content live** | **LIVE** — keep | **WIRE** — live but undiscoverable → add a link, never archive |
| **content dead** | redirect the link, *then* archive | archive clean |

Age is a signal, never a verdict: `ai/project-log.md`'s numbered "things worth telling future-me" lists stay canonical no matter how old, because nothing else records refuted assumptions; a `docs/reviews/*.md` file written yesterday can already be dead-context if the PR it reviewed was superseded by a re-review the same day (this repo has done exactly that: `docs/reviews/2026-09-14-011-013-final.md` and its BLOCKED verdict was superseded once the fix landed).

**What counts as a *live* inbound link — this rule makes or breaks the graph:** only a link from a doc that is *itself* LIVE. A link from another archive candidate, a closed/completed `ai/briefs/*.md` plan, or inside a frozen `docs/reviews/` verdict you may not edit is **not** load-bearing — it travels to the archive with its source. Resolve the graph **live-first**: settle the obviously-live spine (`ai/resume-brief.md`, `ai/hydration-ladder.md`, `ai/workstreams.md`, `CLAUDE.md`, `supabase/CLAUDE.md`, the current `ai/state.md`), then a doc is only held back by a link whose *source* survives.

## When to use

- `docs/reviews/` or `ai/briefs/` has too many dated files to navigate; a reader can't tell which review verdict or which brief is still authoritative.
- After a migration or consolidation pass left superseded design briefs, one-off brainstorm docs, or pre-consolidation evidence lying around (`docs/bd/ai-explorations/`, `docs/design/*.md`, `docs/architecture/spikes/`).
- The doc spine's own convention is "never rewrite, only append/supersede" (`ai/project-log.md`, `ai/resume-brief.md`'s WRAP blocks) — this skill honors that by archiving old material instead of deleting it.

**Not for:** deleting genuinely worthless *untracked* junk (just delete it); a handful of files (do it by hand); reorganizing *live* docs like the numbered `docs/architecture/01`–`09` set (that's restructuring, not retiring); pruning `ai/findings-log.md` rows (that file has its own lifecycle — a row closes when PINNED, it doesn't get archived) or `supabase/migrations/migration-catalog.md` entries (migrations are immutable history once applied to hosted — see `supabase/CLAUDE.md` — and their catalog entries are never retired, only superseded by a later dated entry above them).

## The method

1. **Confirm disposition = archive.** Get explicit sign-off that flagged docs are *moved*, not deleted. Set up an archive tree mirroring original paths (e.g. `docs/_archive/reviews/<original-filename>.md`) so provenance is obvious and restore is trivial.
2. **Pre-pass — mechanical signals (no judgment yet).** For every candidate: (a) **inbound-link graph** — grep each file's path + basename across `ai/`, `docs/`, `CLAUDE.md`, `supabase/CLAUDE.md`, and the repo root README; (b) **git recency** — `git log -1 --format=%cd -- <path>`. Two traps, both real on this spine:
   - **Generic filenames collide.** `README.md`, `CLAUDE.md`, `HANDOFF.md` recur across `apps/web/`, `supabase/`, and repo root — **path-scope** the grep or you'll count phantom cross-directory links.
   - **Direction.** A basename match may be the *candidate* linking out to the spine (outbound, e.g. a stale brief citing `ai/state.md`), not the spine linking the candidate. Open the linker and confirm who is the subject before counting it inbound.
   These are inputs, never the verdict.
3. **Classify each doc — one verdict** (see table). Require *evidence*, and confirm the successor is **real**, not suspected:
   - **superseded** (v1→v2): `ls` the successor file — e.g. a `docs/reviews/2026-09-13-codex-retrofit-011-013.md` superseded by `...-011-013-rereview.md` in the same directory.
   - **absorbed**: the successor is usually a *section* of a living doc (a decision in `ai/state.md`, a bullet in `ai/workstreams.md`), not a file you can `ls` — confirm by grepping the destination for the doc's actual **conclusion**, not just that some file exists.
   - If superseded-vs-REFRESH turns on a successor you **cannot locate**, the verdict is **UNSURE (keep)**, never archive-on-suspicion.
4. **Safety rule.** A doc is archived only if it's `ARCHIVE-*` **and** no *live* inbound link (per the live-linker rule above) — or its live links get redirected to the successor **in the same commit**. A redirect is sometimes a *content* fix (e.g. `ai/hydration-ladder.md` citing a now-archived review by name), not just a path swap.
   - **Redirect ≠ the archive decision.** The live-linker rule decides whether the *target* can be archived; it does NOT decide which links to fix. Repoint **every** reference from a file that itself stays in the live tree — including a closed-but-on-disk `ai/briefs/` plan. Skip a reference only when its *own file* is also being archived in the same pass. The final basename-grep across the staying tree is what catches the ones a content-verdict pass scopes out.
5. **Review gate.** Produce a manifest (one row per doc: path · verdict · why · successor · live inbound links · proposed redirect) and get human sign-off before *any* file moves. Reversible ≠ unsupervised.
6. **Execute in staged, reversible commits** on a dedicated branch/worktree, using the explicit pathspec commit discipline this repo requires for shared docs (see [[additive-doc-surgery]]). Each commit does the `git mv` **and** the redirects together, so the tree never has a dangling link. Stage by tier (obvious-dead first); one `git revert` undoes a stage.

## Staleness taxonomy (quick reference)

| Verdict | Meaning | Action |
|---|---|---|
| **LIVE** | current source of a fact, or linked by something live | keep in place |
| **WIRE** | content live but no live inbound link (orphaned) | **do not archive** — add a link so it's findable |
| **ARCHIVE — superseded** | a newer doc / re-review / revised brief replaced it (v1→v2) | redirect live links, then move |
| **ARCHIVE — absorbed** | scratch/working doc whose conclusion now lives in `ai/state.md`, `ai/workstreams.md`, or a consolidated doc | redirect, then move |
| **ARCHIVE — dead-context** | references branches/worktrees/lanes that no longer exist (e.g. a pruned `trainos-wt/<lane>` this doc still names as active) | move |
| **REFRESH** | still the canonical current-state doc but factually stale | **do not archive** — flag for update |
| **UNSURE** | ambiguous, or successor unconfirmed | escalate — human decides one by one |

## Common mistakes

- **`rm` instead of `git mv`.** Deletion throws away the cheap, recoverable safety net. Archive by default.
- **Judging by age.** Old ≠ stale. Recency is a hint; classify on content + live links.
- **Treating low inbound as "archivable."** Live content with no inbound is a *wiring* bug (→ WIRE), not a retirement. Cross the axes.
- **Counting dead links as live.** A link from another archive candidate or from a frozen `docs/reviews/` verdict doesn't hold a doc back. Resolve live-first.
- **Redirecting only "live" linkers, leaving broken links in frozen-but-on-disk files.** Live-vs-non-live decides archivability, not link hygiene — repoint every reference from a file that *stays*, then grep to confirm none remain.
- **Archiving on a suspected successor.** "Probably absorbed into `ai/state.md`" you can't locate → UNSURE, not archive.
- **Big-bang move with no manifest/review.** Moving every file in `docs/reviews/` unsupervised is how a still-cited verdict goes missing. Gate on a reviewed manifest.
- **Move and redirect in separate commits.** Leaves a window of dangling links. Do both in one commit, per stage, with an explicit pathspec (never `git add -A`).
- **Archiving a `REFRESH`.** A stale-but-canonical current-state page (e.g. `ai/state.md` before a needed edit) needs updating, not retiring.
- **Archiving an applied Supabase migration or its catalog entry.** Migrations applied to hosted are immutable forward-fix-only history (`supabase/CLAUDE.md`) — this skill does not apply to `supabase/migrations/`, `supabase/rollbacks/`, or `supabase/tests/`.

## For large trees

Classifying 20+ files (e.g. all of `docs/reviews/`) is a fan-out job: the pre-pass link graph is mechanical (one batched grep over all basenames + one git-date pass), so the bottleneck is grep-*volume*, not per-file judgment. Give a reader per doc, then an adversarial pass that re-checks every ARCHIVE verdict against the live-link graph (verdict says "superseded" but `ai/hydration-ladder.md` still links it → not safe yet). Enumerate, then verify the enumeration against the graph — never trust content verdicts alone.
