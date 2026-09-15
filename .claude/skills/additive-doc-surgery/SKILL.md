---
name: additive-doc-surgery
description: Use when recording session results into shared living docs that multiple concurrent lanes edit (ai/resume-brief.md, ai/hot-state.md, ai/state.md, ai/workstreams.md, ai/findings-log.md, ai/state-backlog.md, ai/project-log.md, supabase/migrations/migration-catalog.md) — especially from a worktree under trainos-wt/ that isn't main, or when an edit risks prettier rewriting a table or clobbering another lane's entries.
---

# Additive Doc Surgery

## Overview

Fold session or lane results into TrainOS's shared doc spine with **additive, anchored, whole-line edits**, then **prove the footprint**: the diff must show only your inserted lines — 0 removed, 0 modified. Multiple lanes — in the same worktree or in parallel worktrees under `trainos-wt/<lane>/` — edit these files concurrently. Any line you touch that isn't yours is a future merge casualty.

## Step 0 — bind to the doc spine

Resolve which file gets your content before editing anything. Each file states its own convention in its header blockquote — read it, don't guess:

| File | Convention | Edit shape |
|---|---|---|
| `ai/resume-brief.md` | Newest `## WRAP <date> +08 — START HERE` block at the **top**, explicitly superseding the previous one ("Supersedes the HH:MM entry below, still accurate for X") — never rewrite an old block | insert-at-top |
| `ai/hot-state.md` | Newest `## SESSION <date>` block first; `Focus` / `Next Active Task` / `Blockers` headings are a literal-string contract a PR-body extractor keys on — never rename them | insert-at-top |
| `ai/workstreams.md` | New bullet inside YOUR thread's `🟢/⏸/⛔/✅` block, or a new block; extend that thread's `Resume:` line in place so it stays cold-startable | insert-at-anchor |
| `ai/findings-log.md` | ONE table row at the top of the table (newest-first) **and** its own `## B-NNN · ...` section below — table rows are one physical line, no `|` or newline inside a cell, cell shorter than that column's widest existing cell | insert-at-anchor |
| `ai/state-backlog.md` | Bullet under the matching section; every entry needs an **Owner** (a lane, never a person) and a **Trigger** (the event that makes it due) | insert-at-anchor |
| `ai/project-log.md` | New `## <date>` entry **above** the previous newest entry (latest-first), never edited once written — a correction is a new dated entry pointing at the old one | insert-at-anchor |
| `supabase/migrations/migration-catalog.md` | New dated narrative entry **prepended** above the `<!-- Dated narrative entries... -->` marker, plus the Migration Order/summary line updated in the **same commit** as the migration itself (`supabase/CLAUDE.md`'s same-commit hard rule) | insert-at-anchor |
| `docs/reviews/*.md` | Dated, per-review file — usually a fresh file, not an edit; if amending one already open, append a dated correction block rather than rewriting a verdict | append or new file |

`ai/hydration-ladder.md` names the read order (`workstreams.md` before `hot-state.md` — seven threads can be in flight and only one is the newest session block). `ai/state.md`'s Decisions section takes only SETTLED calls, never proposals.

## Procedure

1. Anchor every Edit on an existing neighbor line and insert your content as whole new lines beside it. Never end an anchor mid-line — a mid-line `old_string` splices someone else's sentence onto yours. For a line you can't retype byte-exactly (a prettier-padded `findings-log.md` row), anchor on a **unique line-start prefix** of the neighbor row and prepend `your-row\n` before it.
2. Table rows (`findings-log.md`, `migration-catalog.md`'s summary line): one physical line, no `|` or newlines inside cells, each cell **shorter than that column's widest existing cell** — an overflowing cell makes prettier re-pad the whole table, turning a one-row insert into a whole-file rewrite and a guaranteed merge conflict.
3. `ai/hot-state.md` and `ai/resume-brief.md` read "newest block first" but are still **append-style relative to the top**, not overwrite-style: don't delete or edit the previous block, insert a new one above it. If you are ever asked to edit a genuinely overwrite-per-session doc from a non-main worktree, don't overwrite — append a clearly-marked `## Worktree addendum — <date> · branch <name>` block at file end instead, noting that on conflict the top block wins and the addendum re-appends.
4. After all edits, run `npx prettier --write <files>` yourself before committing — `lint-staged` runs it at commit anyway; running it first means you see the damage while it's still yours to fix.
5. **Prove the footprint:** `git diff --numstat -- <edited files>` — every file must be pure insertions (`N 0`); the only tolerated deletion is a line you deliberately extended in place (e.g. a thread's `Resume:` line, or the migration-catalog summary line's counts). Any other deletion: revert and re-anchor.
6. Commit with an explicit pathspec — `git add -- <files> && git commit -m "..." -- <files>`, never a bare `git commit` or `git add -A`/`git add .`. This repo runs concurrent lanes in shared worktrees; a pathspec commit still records the **current working tree** of the named file, not just your hunks. Before committing a shared doc, run `git diff --cached --numstat -- <file>` and confirm the line count is yours — if another lane's uncommitted edit to the same file is sitting in the working tree, your commit will include it. After committing, `git show HEAD -- <file>` to verify only your lines landed.
7. If your branch/worktree merges later, state the conflict rule where the next reader will look (PR body, or the addendum header itself): append-style docs (`workstreams.md`, `findings-log.md`, `project-log.md`, `state-backlog.md`, `migration-catalog.md`) → union, keep both sides; "overwrite each session" docs → main's top block wins, re-append your addendum.

## Why this matters here

A scratchpad collision already cost a real PR-body leak in this repo — `lane/seeds` and `lane/rpc-018` both wrote to the session scratchpad's root and one lane's PR description briefly leaked into the other's PR (`ai/project-log.md`, 2026-09-13 21:4x entry). The fix adopted repo-wide: lane-specific scratch files go under `<scratchpad>/<lane-name>/`, never the scratchpad root — the same discipline this skill asks for on the doc spine: never write where another lane's uncommitted content already lives without checking first.

## Common mistakes

- **Write-tool whole-file rewrite** of a shared doc — instant clobber of concurrent edits. Always Edit with anchors, never Write.
- Editing another lane's `Resume:` line, table row, or dated entry instead of adding your own — even a "fix" to someone else's line is a conflict magnet unless you are the owner of that thread.
- Trusting prettier's exit code or "0 files changed" — check the **git diff**, not the tool's own report.
- Recording a proposal as a Decision in `ai/state.md`, or unshipped work in `migration-catalog.md`'s summary line.
- Touching `supabase/migrations/migration-catalog.md` in a follow-up commit instead of the same commit as the migration — this fails the review gate (`supabase/CLAUDE.md` same-commit hard rule).
- Bare `git commit` or `git add -A` on a shared worktree — stages and commits a sibling lane's uncommitted edits along with yours.
