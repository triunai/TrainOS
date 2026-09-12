# 05 — The Doc Spine: what showroom and vern-vault do, and what to seed for trainos

Research pass over two live repos (`~/Repos/personal-work/showroom`, `~/Repos/personal-work/vern-vault`), the Obsidian teaching/pattern vault, and the `additive-doc-surgery` / `retiring-stale-docs` skills that encode the editing rules. Goal: extract the reusable "doc spine" shape so trainos starts with the same bones instead of re-deriving them under pressure.

Two repos, two tiers of the same idea. **showroom** (Wedding Radiance / Wishes2Vows) is the heavy, mature tier — ~20+ parallel threads, a solo founder plus AI agents, migrations touching live customer data, so the spine is elaborate (17 files under `docs/ai/state/`, several 100–400KB). **vern-vault** (Vern Motors) is the light tier — single-founder brokerage site, four files total (`ai/state.md`, `ai/hot-state.md`, `ai/CHANGELOG.md`, `ai/hydration-ladder.md`). Both share the same underlying pattern (hygiene/router → hydration ladder → hot-state → decisions → backlog → journal); vern-vault just hasn't needed to split it yet. trainos should start at the vern-vault tier and only fork files the way showroom did once a single file visibly strains (see "When to split," below).

## 1. The `docs/` tree in showroom (full inventory)

| Folder | Purpose | Naming convention | Example | Lifecycle |
|---|---|---|---|---|
| `docs/ai/state/` | The spine itself — 14 SRP files (see §2) | fixed filenames, no dates | `docs/ai/state/hot-state.md` | **living** — several overwritten or prepended every session |
| `docs/ai/backlog/` | Deep detail behind numbered `state-backlog.md` initiatives | `backlog-{N.0}-{slug}.md`, some dated `YYYY-MM-DD-{slug}.md` for one-off audits | `backlog-6.0-big-file-refactor-map.md` | living (edited as items progress) |
| `docs/ai/reviews/` | Ad hoc review briefs + their outputs, small volume | `YYYY-MM-DD-{slug}.md` | `2026-08-12-migration-086-090-review-brief.md` | append-only once a review closes |
| `docs/ai/memory-mirror/` | Committed copy of `~/.claude/projects/*/memory/*.md` so auto-memory survives a laptop change | mirrors the memory naming: `feedback_{slug}.md`, `reference_{slug}.md`, `norm_{slug}.md`, plus `MEMORY.md` index | `feedback_answer_short_and_plain.md` | living — re-synced at wrap time, "on conflict, `~/.claude/` wins on the machine that wrote last" |
| `docs/change_log` | A single legacy resolved changelog entry, effectively frozen | `YYYYMMDD_{slug}.md.resolved` | `20260302_Core_Deluxe_Showrrom_v1.md.resolved` | frozen (predates root `CHANGELOG.md`) |
| `changelog/` (repo root, not under `docs/`) | Large narrative changelog write-ups, one big markdown per theme/date, and one `.txt` | `YYYYMMDD_{slug}.md` or a dated subfolder | `20260609_template_expansion_splash_overhaul.md`, `20260411_shern/` | append-only, historical narrative (distinct from the curated root `CHANGELOG.md` — see §5) |
| `docs/deployment/` | Deploy/cutover write-ups | `YYYY-MM-DD-{slug}.md` | `2026-07-27-pkce-flow-cutover.md` | append-only evidence |
| `docs/design/` | Deep architecture + business-rules design docs, the "ADR library" `decisions.md` indexes into | `YYYY-MM-DD-{slug}.md`, often huge (up to 230KB) | `2026-07-27-onboarding-stepper-ux.md` | append-only, never edited after landing |
| `docs/discovery/` | Audit / adversarial-review trails — durable evidence | `NNN-{slug}.md` (task-numbered) or `YYYY-MM-DD-{slug}.md` | `2026-05-09-planned-guestlist-C-adversarial.md` | **archive** — "never edit historical ones" |
| `docs/guides/` | How-to pipelines for a specific technique | `{slug}.md`, no date | `seamless-music-loop-pipeline.md` | living reference |
| `docs/perf/` | Performance autopsies | `YYYY-MM-DD-{slug}.md` | `2026-08-01-losh-runtime-perf-autopsy.md` | append-only evidence |
| `docs/plans/` | Older paired design+plan docs (pre-`superpowers/` convention) | `YYYY-MM-DD-{slug}-design.md` / `-plan.md` | `2026-03-09-package-tier-demos-plan.md` | append-only, superseded by `superpowers/` for new work |
| `docs/postmortems/` | Incident postmortems, one file per incident, indexed | `YYYY-MM-DD-{short-slug}.md` + `README.md` index table | `2026-04-28-get-ticket-envelope.md` | **archive** — "never deleted, occasionally referenced" |
| `docs/prompts/` | Saved prompt-engineering scoping docs | `YYYY-MM-DD-{slug}.md` | `2026-07-19-pixel-animated-layer-scoping.md` | append-only |
| `docs/reference/` | Small static reference material (an invoice subfolder) | free-form subfolder | `docs/reference/invoice/` | living reference |
| `docs/research/` | One-off deep-dive research primers | `{slug}-YYYY-MM-DD.md` | `stripe-primer-2026-05-28.md` | append-only |
| `docs/reviews/` | **Lane-review** output — one dated folder per multi-agent review sweep | `YYYY-MM-DD-{slug}/` folder containing `L{N}-{area}.md` / `M{N}-{area}.md` / `S{N}-{area}.md` lane files + a dispatcher-verification file + sometimes a `.log` | `docs/reviews/2026-09-07-shern-14-lane-review/M1-rsvp-wishes.md` | **archive** once triaged into `docs/ai/state/findings-log.md` |
| `docs/seeds/` | Sample data fixtures (xlsx) used for QA imports | `{slug}.xlsx` | `qa-losh-import-EDGECASES.xlsx` | living fixtures |
| `docs/superpowers/specs/` | Per-feature **design** docs (the "why" — current, replaces `docs/tasks/`) | `YYYY-MM-DD-{feature-slug}-design.md` | `2026-08-16-bulk-whatsapp-messaging-design.md` | living until feature ships, then frozen evidence |
| `docs/superpowers/plans/` | Per-feature **implementation** docs (the "how"), plus session "seed" prompts | `YYYY-MM-DD-{feature-slug}.md` or `YYYY-MM-DD-{topic}-seed.md` | `2026-06-09-rsvp-extensions-primitive.md`, `2026-07-26-fable-seed-prompt.md` | living until shipped |
| `docs/superpowers/smoke/` | Manual smoke-test scripts for a specific build | `YYYY-MM-DD-{slug}-smoke(s).md` | `2026-05-29-studio-canvas-v1.4-phase9-smokes.md` | frozen once run |
| `docs/tasks/` | Per-feature PRDs, the **frozen** predecessor of `superpowers/` | `task-{NNN}[{letter}]-{slug}.md` + a `README.md` correcting stale status headers in bulk | `task-014-admin-ops-console.md` | **frozen** — "keep/reference, don't add new" |
| `docs/template/` | The PRD template that `docs/tasks/` used | single file | `golden-task-template.md` | frozen reference |
| `docs/testing/` | A single giant living test inventory | single file, no date | `test-inventory.md` | living (grows with the suite) |
| `docs/timeline/` | Old daily journal, **superseded** by `docs/ai/state/project-log.md` | `DD-M-YYYY[-slug].md` | `27-2-2026.md` | archive-pending (superseded, not yet moved) |
| `docs/_archive/` | Retired docs, `git mv`'d not deleted | `YYYY-MM-DD-{reason}/` mirroring original subpaths | `docs/_archive/2026-08-02-retired-stale-docs/` | archive |
| `docs/couples/`, `docs/design_handoff_dashboard/`, `docs/legal_docs/` | Product-content / handoff folders, out of scope for the doc-spine pattern itself (customer-content and dashboard hand-off artifacts, not project-state docs) | — | — | — |

**vern-vault's equivalent tree is much shallower** — no `docs/ai/state/` split, no `superpowers/`, no `postmortems/`. Its docs live under:

| Folder | Purpose | Convention |
|---|---|---|
| `ai/` (repo root, not under `docs/`) | The whole living spine: `hot-state.md`, `state.md` (backlog+sprint status combined), `CHANGELOG.md`, `hydration-ladder.md` | fixed filenames |
| `docs/audits/` | Security/engineering audit reports | `YYYY-MM-DD-{slug}.md` |
| `docs/design-specs/` | Design + architecture specs (showroom's `superpowers/specs` equivalent, not yet split into specs vs. plans) | `YYYY-MM-DD-{slug}.md` |
| `docs/patterns/` | Local mirror of a pattern before it's promoted to the Obsidian pattern library | Obsidian-style frontmatter (`title`, `aliases`, `tags`, `status`, `related`) | `idle-hydrated-storage-asset.md` |
| `docs/tasks/`, `docs/superpowers/specs/` | PRDs / specs, thin, few files | `{NNN}-{slug}.md` |
| `docs/handover/` | A **numbered client-facing handover pack** (see §7) | `{NN}-{slug}.md` | 
| `docs/seo/` | A numbered SEO workstream (`01-audit`, `02-schema`, `03-architecture`, `04-ai-seo`, `05-content`) plus loose briefs | numbered subfolders |
| `docs/database/` | `table-catalogue.md` + `tables/` + `stored-procedures/` — the DB-surface source of truth, showroom's `migration-catalog.md` equivalent | fixed + per-table files |

## 2. The living docs — formats and rules

### 2.1 `hygiene.md` (showroom root) — the router

This is the single most load-bearing file in showroom's spine. It is explicitly **not** a place for content — it is an index plus a phrase-to-action lookup table. Skeleton:

```markdown
# hygiene.md — doc & state router

> **What this is:** the single map of the project's durable memory. ...
> **Read-me-first order for any agent/human:** hydration-ladder.md → hard-rules.md → workstreams.md → hot-state.md.
> **Last reconciled:** <date> — <what changed>

## Clean mental model
<one-line-per-file ASCII map, e.g.:>
hygiene.md              = where does everything live? (this file)
hard-rules.md           = what am I never allowed to do?
...

## Canonical artifacts
<table: Artifact | Path | Question it answers>

## Phrase → action routing
<table/list: "what are the rules" → file; "park this" → file; "update all artifacts" → numbered
 sequence of files to touch, in order>

## Working rules (lean)
<bullet list of "after X happens, touch Y">

## Onboarding mirror (Obsidian — external)
<pointer to the vault, with the standing correction that the vault path is per-machine>
```

vern-vault has no separate router file — `CLAUDE.md`'s own "Docs to Read First" table plays that role, because there are only 4 files to route between. **The router pattern only earns its own file once the spine has more than ~5 living docs** — below that, a table inside `CLAUDE.md` is enough.

### 2.2 `hydration-ladder.md` — leveled context loader

Fixed shape in both repos: numbered levels 0 through 5, each a bullet list of files, going from "always read" to "full deep history." showroom's skeleton:

```markdown
# Hydration Ladder
> How to load context to resume cold... Leveled: read only as deep as your task needs.

## The ladder
**Level 0 — orient (always):** README.md, workstreams.md, hot-state.md
**Level 1 — what's in flight:** git status/branch, hot-state's Active section
**Level 2 — standing context:** decisions.md, state-backlog.md, project-log.md
**Level 3 — rules + architecture (before touching contracts):** CLAUDE.md, module CLAUDE.md's, migration-catalog.md
**Level 4 — operational / debugging:** WORKFLOW.md, backlog-implementation-reference.md
**Level 5 — full rehydration:** postmortems, discovery, design docs

## Auto-loaded surfaces (don't reinvent)
## Maintaining this file
```

### 2.3 `hot-state.md` — "what did I touch THIS session"

**Rule from its own header: "Rolling — newest block first."** Despite the header saying "overwrite each session," in practice showroom's file has grown to 101KB by **prepending** a new `## ✅ SESSION <date-range> — <ALL-CAPS TITLE>` block and leaving history below a horizontal rule, with the top of the file carrying a stack of `> **Last updated:** ...` summary lines (superseded ones kept, newest first) rather than literally deleting old content. Each session block: bold summary line, `**Shipped:**` bullet, any `**CRIT found...**` callouts, `**New durable artifacts:**`, `**Reviewed:**`, `**Resume next session:**` pointer, `**Open, owner-owed:**`. vern-vault's `ai/hot-state.md` follows the same shape at smaller scale: `## Current Session — YYYY-MM-DD` blocks, newest first, each with a bold one-line status quote, then `### <headline>` subsections, then `### ⛔ Remaining before production-ready`.

### 2.4 `workstreams.md` — the parkable board (showroom only; vern-vault folds this into `ai/state.md`'s "Sprint Status")

The core trick, per the Obsidian teaching note and ADR-002: **every initiative is a first-class, parkable thread**, not a single "current work" snapshot. Status markers: `🟢 ACTIVE` · `⏸ PARKED` · `⛔ BLOCKED` · `✅ DONE`. Skeleton per thread:

```markdown
## 🟢 <THREAD NAME IN CAPS> — <one-line state> (<date>)

**Resume:** <exact next action, cold-startable>

**Scope:** <what this thread covers>

| <optional table for sub-items, e.g. branches/lanes> | ... |

⚠ **<any standing warning specific to this thread>**

**Refs:** <file paths, spec/plan links, D-NNN decision ids>
```

Parking a thread = set status to `⏸` + write the `Resume:` line; picking one up = read the block, jump to its plan/spec, flip to `🟢`. Threads are pruned to `project-log.md` once cold. This is the single idea most worth carrying into trainos even at small scale — it's cheap (one markdown block) and directly solves "context evaporates between sessions."

### 2.5 `decisions.md` — ADR-lite log, `D-NNN`

Latest-first, **supersede, don't delete**. Format per entry:

```markdown
## D-NNN [⚠ collision marker if any] · <one-line decision title> · ACTIVE|SUPERSEDED

**Context (<date>).** <what forced the decision, with file:line specifics>

**Decision.** <the ruling, stated as a rule others can follow>

**Why <the obvious alternative> does not fit.** <reasoning>

**The constraints that make this safe.** <numbered list of guardrails, if it's a risky pattern>

**Consequence to accept honestly.** <trade-off, stated without spin>

**Refs.** <migration files, review docs, other D-NNN>
```

showroom hit a real failure mode worth recording for trainos: **two long-lived branches each independently allocated `D-098`/`D-099` to different decisions**, and the merge preserved both silently. The file now carries a permanent `⚠ ID COLLISION` banner at the top rather than silently renumbering (renumbering would misdirect the 33 existing citations elsewhere in the spine). **Lesson for trainos: allocate `D-NNN` ids from the merge target, or accept the collision-banner pattern as the recovery move; don't try to prevent it by convention alone once there's more than one long-lived branch.**

### 2.6 `state-backlog.md` — OPEN work, NOT settled decisions, NOT thread status

Entries use a `**🆕 OPEN (<date>, <context>) — <ALL-CAPS HEADLINE>.**` bold lead-in followed by prose paragraph(s) explaining the gap, its root cause, and what closing it needs. Settled items move OUT to `decisions.md`.

### 2.7 `project-log.md` — the journal

Latest-first, append-only, one `## YYYY-MM-DD — <summary>` block per session with bullet points of what happened, and often a **"N things worth telling future-me"** numbered list of negative results / lessons — this is the file's most valuable habit: it captures *process* lessons (a triage vocabulary gap, a wrong review verdict that was refuted) that would otherwise be lost the moment the session ends.

### 2.8 `findings-log.md` (B) — review-catch → pin inbox

Table format per catch: `date · area · catch · sev · pin-type · pin-ref · status`. Full narrative entries include a markdown table `# | Sev | Finding | Pin`. **The rule (D-016): no HIGH/MED finding closes without a pin** — a branded type (loose-type bugs) or a regression test (logic/async bugs). `OPEN` = owed work. Heavy/recurring findings **promote to A** (`decisions.md`, `docs/discovery/`, or a postmortem) — "B is the inbox; A is the curated archive."

### 2.9 `fitness-ledger.md` and `retrofit-review-log.md` — grouped-by-shape indices (showroom only, added late)

Two files that emerged once the spine matured: `fitness-ledger.md` groups every executable invariant (pinned test) by the **failure shape** it protects, not by directory, with an explicit rule "three or more incidents of one shape is the trigger to write an ADR, not a fourth pin." `retrofit-review-log.md` is deliberately tiny and append-only — a **shape tally table** (`# | Shape | Count | Status`) that survives between review sessions so the next review doesn't re-derive "have we seen this before." Both are late additions (added at showroom's most mature stage) — **not needed for trainos v1**, but worth knowing the shape for when the review cadence picks up.

### 2.10 `test-failure-ledger.md` — four-category taxonomy for red tests

Notable for its **explicit decision taxonomy**, reusable verbatim:

| Category | Meaning | Obligation |
|---|---|---|
| REAL BUG | code is wrong | fix code, never touch the assertion |
| PIN DEFECT | the test itself is wrong | fix test, state why in the test, check sibling pins |
| PREMISE RETIRED | test was right, world changed | replace the assertion with the surviving invariant |
| HARNESS | missing provider/mock/env, not a real signal | fix the harness; shared fixture if it recurs |

### 2.11 Additive editing rules (from the `additive-doc-surgery` skill)

Because these files are edited concurrently by multiple sessions/branches, the skill mandates:

1. **Anchor every edit on an existing neighbor line**, insert whole new lines — never a mid-line `old_string` splice.
2. Table rows: one physical line, no `|`/newlines inside cells, keep cells shorter than the widest existing cell in that column (an overflow triggers a formatter re-pad = a whole-file rewrite = guaranteed merge conflicts).
3. "Overwrite each session" docs (like `hot-state.md`), when on a branch: **don't overwrite** — append a `## Worktree addendum — <date> · branch <name>` block instead, noting main's top block wins on conflict.
4. Run the formatter yourself before committing, then **prove the footprint**: `git diff --numstat` must show pure insertions (`N 0`) on every edited doc.
5. If the branch merges later, state the conflict rule where the next agent will look: append-style docs → union both sides; overwrite-style docs → main wins, re-append.

## 3. `CLAUDE.md` and `AGENTS.md`

**Division of labour (showroom's explicit framing): `CLAUDE.md` is "the deeper constitution — security model + hard rules"; `AGENTS.md` is operational instructions for coding agents generally (Codex, Claude Code); `hygiene.md` is the doc/state router.** All three cross-reference each other in their opening lines.

`CLAUDE.md` section order (239 lines): `# <Project> — Claude Code Context` → `## Tech Stack` → `## Architecture` (with a literal directory tree) → `## Supabase & Security Model (CRITICAL)` → `### RPC Contract Discipline (read before any migration)` → `## Coding Rules` (`### Must Follow` / `### Conventions` / `### Don't`) → `## Documentation System` → `## Session Start Ritual` → `## Long-Term Direction` → `## Current Work` (explicitly told **not** to hold a live snapshot — "it rots" — just pointers) → `## Gotchas & Warnings` (a running list, with struck-through entries left visible and marked `RESOLVED`/`STALE` rather than deleted, so a reader who half-remembers the old claim sees the correction, not silence) → `## Testing` → `## Deployment` → `## Self-Healing Guardrail Stack` → `## Commands`.

`AGENTS.md` section order (226 lines): `# AGENTS.md` (one-line pairing note to CLAUDE.md + hygiene.md) → `## Setup` → `## The self-healing guardrail stack` (a table: Juncture | Runs | Blocks?) → `### Toggle` → `### Architecture rules` → `## The doc control-plane (SRP — each file answers ONE question)` (a table naming each state file and the one question it answers) → `## Review gate matrix` → `## Conversion — pin every catch` → `## Hard rules (full detail in CLAUDE.md)` → `## Session wrap` → `## Skills` (`### Available skills` — one bullet per skill, explicitly capped: "Keep it to one entry per skill — never paste SKILL.md bodies here," because Codex truncates its combined instruction file at 32 KiB) → `### How to use skills`.

vern-vault's single `CLAUDE.md` (199 lines, no separate `AGENTS.md`) compresses both roles: `# <Project> — Developer Reference` → `## Project Identity` → `## Stack` (table) → `## Architecture: Feature-Module` (tree + numbered `Rules` R1–R10, each a bold rule name + one paragraph + optional code snippet) → `## Stale Times (TanStack Query)` (table) → `## State Ladder` → `## Image Delivery` → `## Auth` → `## Motion Library Rules` → `## Supabase Docs — Always Updated in Parallel` (table: What changed | Update this file) → `## Docs to Read First` (table — this is vern-vault's router-in-miniature) → `## Dev Checklist for New Features` (numbered steps). **Length scales with maturity**: vern-vault's is 199 lines for a single-founder project; showroom's is 239 lines of prose but backed by 14 satellite files. **The number-rules-with-code-snippet pattern (R1–R10) is a good compact substitute for a full `hard-rules.md` split, and is what trainos should start with.**

## 4. README structure

showroom's README (815 lines) is a full **recursive module map**, not a quick-start blurb: `# <Project> (<internal name>)` → `## 1) Product Scope` → `## 2) Runtime Stack and Tooling` → `## 3) Quick Start` (`### Prerequisites` / `### Environment variables` / `### Install and run` / `### Build and checks`) → `## 4) Route Architecture` (by route family) → `## 5) Repository Module Map (Recursive)` → `## 6) Domain Business Rules (Critical)` (one numbered subsection per domain, e.g. `6.1 RSVP Domain Rules`) → `## 7) Module-by-Module Reference` (one numbered subsection per feature, going down to individual files) → `## 8) Public Component Reference` → `## 9) Supabase Schema and RPC Reference` → `## 10) Persistence Map (Client)` → `## 11) Interaction and UX Contracts` → `## 12) Documentation System and Workflow` → `## 13) Known Drift and Caveats` → `## 14) Operations Checklist for Contributors` → `## 15) File Pointers (Fast Entry)` → `## 16) v2 Delivery Track`. This is a **numbered-outline, encyclopedia-style README** — the pattern to imitate once trainos's module count justifies it, not from day one.

vern-vault's README is the unmodified Lovable.dev scaffold boilerplate (73 lines, generic "how to clone/run/deploy" content) — it has never been rewritten to describe the actual product. **Gap worth flagging for trainos: write the README for the product, don't leave scaffold boilerplate in place** (this is vern-vault's own doc-rot, not a pattern to copy).

## 5. changelog/ vs CHANGELOG.md vs docs/change_log — the rule

Three different things with overlapping names, and the distinction matters:

- **`CHANGELOG.md`** (repo root) — the curated, **product-facing**, Keep-a-Changelog-style file. Newest entry at the top, one `## YYYY-MM-DD — <headline>` per ship, subsections `### Fixed` / `### Changed` / `### Security` / `### Added`. Its own header states the rule explicitly: *"Tracks notable changes across migrations, RPC contracts, frontend types, and project documentation. Append new entries at the top... **Forward-only: older entries are not backfilled**."* Since 2026-08-17 it also links real architectural decisions as `(ADR-NNN)`, with the ADR itself carrying a `Changelog:` back-link — "a pseudo-postmortem you can read forward."
- **`changelog/` (repo root folder, plural-ish, separate from the singular file)** — large narrative write-ups, one markdown file per theme or date, sized like design docs (up to 39KB), not meant to be read end-to-end as a release log. This is closer to `docs/design/` in spirit than to `CHANGELOG.md` — a deep-dive artifact that happens to be named "changelog" because it documents a large piece of work chronologically.
- **`docs/change_log`** (singular, under `docs/`) — a single legacy `.md.resolved` file, effectively a fossil from before the root `CHANGELOG.md` convention existed. Not actively used.

**The rule to carry into trainos: pick ONE curated, forward-only, product-facing file at repo root (`CHANGELOG.md`) for what shipped. Anything else calling itself a "changelog" is really a design/discovery doc that should live under a dated-slug convention in its own folder, not be confused with the curated one.** vern-vault avoids the ambiguity entirely — it has exactly one changelog, `ai/CHANGELOG.md`, sprint-grouped rather than per-release.

## 6. `docs/superpowers/specs` and `plans` — naming convention

Both use `YYYY-MM-DD-{feature-slug}.md`, with specs additionally suffixed `-design.md` (e.g. `2026-08-16-bulk-whatsapp-messaging-design.md`) and plans left bare or suffixed by role (e.g. `2026-06-09-rsvp-extensions-primitive.md`) or, for lightweight session-continuation docs, `-seed.md` (e.g. `2026-07-26-fable-seed-prompt.md` — a prompt to hand a fresh agent to resume exactly where a session left off). **Specs = the "why/what" design doc; plans = the "how" implementation breakdown; a plan usually cites its spec.** `docs/superpowers/smoke/` holds one-off manual QA scripts, `YYYY-MM-DD-{build}-smoke(s).md`. This trio (specs/plans/smoke) replaced the older `docs/tasks/` PRD-per-feature convention, which is now explicitly frozen.

## 7. `docs/reviews` lane-review format

Example: `docs/reviews/2026-09-07-shern-14-lane-review/`. One dated folder per multi-agent review sweep, containing:

- `00-dispatcher-verified.md` — confirms the dispatch premise was checked against the repo before lanes ran.
- Per-lane files named by a severity/scope prefix and a slug: `L{N}-{area}.md` (large/broad lanes, e.g. `L1-edge-waba.md`), `M{N}-{area}.md` (medium, e.g. `M1-rsvp-wishes.md`), `S{N}-{area}.md` (small/security-focused, e.g. `S6-spine.md`).
- Each lane file: `# <lane-id> — <scope title>`, a one-line "Read-only audit. Branch X. DB: Y — confirmed via Z before any query." provenance line, a bold count line (`**14 findings — 0 CRIT, 4 HIGH, 5 MED, 5 LOW.**`), a **"Premises I was handed — corrections"** table (`Brief claim | Verdict`) that explicitly checks the dispatcher's assumptions against the live repo before trusting them, then `## HIGH` / `## MED` / `## LOW` sections each with `### H1 — <one-line finding>`, file:line citation, code excerpt, and root-cause narrative.
- Optional `gates-merged-tree.log` — raw tool output kept alongside the narrative.

Downstream, these lane files get **triaged** into a `docs/reviews/YYYY-MM-DD-triage-wave/LEDGER.md` that reclassifies raw findings by "what must be true before this can hurt someone" (not by severity) into buckets like LIVE-OPEN / PRE-MERGE / PRE-APPLY / PRE-DEPLOY / CLOSED / REFUTED, and only the surviving pins get promoted into `findings-log.md`. **This is a three-stage pipeline: raw lane review → triage ledger → pinned finding**, worth keeping distinct rather than writing findings straight into the permanent log.

## 8. `docs/postmortems` format

Convention, stated in its own `README.md`:

- One file per incident, `YYYY-MM-DD-{short-slug}.md`, **dated by the day identified, not resolved**.
- Standard section order: `## Summary` → `## Impact` → `## Timeline` (table: When | What) → `## Root Cause` (numbered contributing factors) → `## Why <the safety net> didn't catch it` → `## What went well` / `## What went wrong` → `## Mitigation` → `## Durable Rule` → `## References`.
- A header block up top: `> **Date identified:** ... **Severity:** ... **Status:** Resolved/Open.`
- The folder's `README.md` also carries an index table (`Date | Incident | Severity | Durable rule produced`) — so postmortems are discoverable without opening each file.
- Explicit separation from backlog: "Backlog = we should do this when convenient... Postmortem = this is what we learned — never deleted, occasionally referenced."

## 9. Obsidian vault structure

### 9.1 Project wiki (Wishes2Vows example — the largest)

```
Projects/Wishes2Vows/
  wiki/
    00-index/Codebase Wiki — Index.md      # the MOC, links everything below
    adr/ADR-{NNN} {Title}.md               # 30 ADRs, one decision per file
    onboarding/{NN} — {Title}.md           # 42 numbered teaching notes, 00–41
  _meta/AGENT-ACCESS.md                     # how an agent/MCP reaches this vault
  _retrofit/RETROFIT-PLAYBOOK.md            # the enrichment-pass process record
  raw/                                      # (older layout — 40 onboarding notes lived
                                             #  here before promotion into wiki/onboarding/)
  todo/, todo-backlog.md                    # loose personal task notes, not part of the spine
```

**Onboarding numbering (`wiki/onboarding/00`–`41`):** grouped by theme but numbered flat and sequential, not by theme-prefix. Groups, in numeric order: orientation/process (01, 06, 13, 19, 20), data/contract boundary (02–05), frontend (07–10, 24, 25, 31–33), features (11, 21–23, 27, 29, 30, 34, 35), provisioning/ops/quality (12, 14–17, 26, 36–39), playbooks (18, 28), reference maps (40, 41). Each note's frontmatter carries `type: onboarding-discovery`, `status: pass-2 enriched...`, `audience: new-hire`, `derived_from: [<repo files verified against>]` — that last field is the cheapest way to re-verify a claim later. The `00 — START HERE` note is the single entry point: a one-paragraph product summary with a mermaid flowchart, a "fast path" of 4 must-read notes, a themed link table for the rest, and a **"7 big ideas that recur everywhere"** numbered list (durable cross-cutting lessons, e.g. "every stateful boundary needs a contract, a guard, and a fallback").

**ADR numbering (`wiki/adr/ADR-{NNN} {Title}.md`):** one file per decision, frontmatter `type: adr`, `status: accepted`, `repo:`, `module:`, `date:`, `last_verified:`, `derived_from: [...]`. Body: `## Status` → `## Context` → `## Decision` → `## Alternatives Considered` (each rejected option with why) → `## Consequences` (`### Positive` / `### Negative / risks`) → `## Related` (wikilinks to onboarding notes + repo file pointers). **ADRs here mirror `decisions.md` `D-NNN` entries in the repo** — the ADR carries a `Changelog:` line pointing back to the repo's `CHANGELOG.md`, and the repo's `D-NNN` is the canonical numbering; the ADR is the fuller narrative form. (ADR-002 itself documents this whole doc-spine system — reproduced in §2 above.)

Vern's smaller wiki (`Projects/Vern/wiki/`) uses a lighter version of the same idea: `00-index/`, `adr/`, plus theme folders (`architecture/`, `conventions/`, `glossary/`, `runbooks/`) instead of a flat onboarding sequence — appropriate for a smaller codebase.

### 9.2 "Patterns Applied" — the Tier-2 case-study template

Every project folder has a `Patterns Applied/` subfolder (confirmed at `Projects/Vern/Patterns Applied/`, not `Projects/Vern (Patterns Applied)` — the parenthetical in scope questions was informal shorthand, not the real path). One file per shipped pattern instance. Frontmatter:

```yaml
---
title: <Pattern Name> (<Project>)
tags: [case-study, <project>, <tech tags>]
type: project-case-study
created: YYYY-MM-DD
pattern: ["[[<Generic Pattern Note Name>]]"]
project: ["[[<Project>]]"]
posts: ["[[<optional LinkedIn post draft title>]]"]
---
```

Body shape (from `Lead Alert Pipeline (Vern).md`, reproduced as the template):

```markdown
# <Pattern Name> — <Project>

> [!info] Tier-2 case study
> Concrete implementation of the pattern **[[<Generic Pattern>]]**. Project: [[<Project>]].

**Context:** <the real business problem, 1-2 sentences>

## What shipped (<date>)
- **<layer>** — <what was built, with real file/migration names>
...

## <Project>-specific decisions
- <a decision that would NOT belong in the generic pattern note, because it's specific
  to this project's constraints>

## War stories (post fodder)
- **<a memorable specific incident>.** <what happened, what was learned>

## Smoke test
<how it was verified live>

## Related — <Project> wiki
- [[<any ADR this connects to>]]

---
**Links:** Pattern → [[<generic pattern>]] · Post → [[<post if drafted>]] · Project → [[<project>]]
```

This is a genuinely three-tier system, stated explicitly in the pattern-library index: **Tier 1 (generic pattern, no project specifics, lives in `Software Engineering Patterns/<Family>/`) ← Tier 2 (this project case-study, file paths + war stories) → Tier 3 (a dated LinkedIn post narrative, in `Posts/Drafts/` → `Posts/Published/`)**. The generic note stays reusable; the project specifics and the "what actually went wrong" war stories live only in Tier 2, so the Tier-1 note never accumulates one project's baggage.

### 9.3 Software Engineering Patterns note — what it contains

`Software Engineering Patterns/Software Engineering Patterns.md` is the top-level MOC (map-of-content), not a single long pattern list — it indexes **families** (each family is its own folder with its own index note), plus a separate table of cross-cutting "AI-Assisted Development" meta-patterns that sit at the folder root because they aren't a code family. Full inventory, one line each:

**Pattern families (folder + index note per family):**
- **SMTP-Email** → *Transactional Outbox Email Alerts (Resend + Supabase)* — durable outbox table + webhook + provider send, so a failed alert can never lose or roll back the underlying business event.
- **Data & Supabase** → *Zod-Boundary Data Slice* (parse every Supabase response through Zod before it enters UI); *Fail-Closed Authz (Parse the Role)* (a role read that fails must deny, never default-allow); *Three-Layer Authz Shell (RLS is the Guard)* (RLS is the real boundary; app-layer checks are cosmetic convenience only).
- **UI & Animation** → *Self-Throttling Canvas Loop* (a RAF/canvas loop that throttles itself rather than running unconditionally); *Gated Lazy Intro Overlay* (a first-visit overlay gated by `useFirstVisit`/`useFocusTrap`, not just a boolean flag).
- **Records & Forms** → *Deterministic Completeness Scorer* (one rule-set drives a completeness badge, a triage queue, and a publish-preflight gate, instead of three divergent implementations).
- **Principles** (not code patterns — engineering judgment calls) → *Parse at the Boundary (Don't Cast)*; *RLS is the Boundary, the UI is Cosmetic*; *When an Abstraction is a Tax (the Effect.ts lesson)*; *Dead Code Belongs in Git History, Not a Disabled File*; *Best-Practice Is a Hypothesis — Grade It Against Your Estate*.
- **DevOps & Automation** → *Marker-Fenced Doc-PR Region Sync* (keep a doc region and a PR description in sync via fenced markers); *Lean SPA CI*; also (found in the family folder but not yet indexed on the MOC page) *Parallel-Agent Worktree Isolation* and *Single-Worktree Agent Fleet* — two competing topologies for running multiple agents against one repo.

**AI-Assisted Development meta-patterns (cross-cutting, at folder root):**
- **Self-Healing Guardrail Stack** (+ v2) — protects **the code**: advisory-first hooks/gates that stop bad code at commit/push without blocking velocity.
- **Thread-Aware Doc-Spine for AI-Assisted Development** — protects **the context**: this whole doc-spine pattern, generalized (see §9.4 — this is the Tier-1 note behind showroom's `workstreams.md`/`hygiene.md` implementation).
- **Verified Onboarding Mirror for AI-Assisted Development** — protects **comprehension**: a source-verified, agent-built teaching mirror of the codebase (this is the Tier-1 note behind the `wiki/onboarding/` 40-note structure in §9.1).

Every pattern note follows a fixed 10-part house style (stated on the MOC page): one-liner → problem → naive approach and why it's wrong → the pattern (with a diagram) → building blocks (generic, `<placeholders>`) → key design decisions (table) → pitfalls & mitigations → when to use / when not → implementations (links to Tier-2 case studies) → reusable checklist.

### 9.4 The Thread-Aware Doc-Spine pattern note (generalized form)

This is the Tier-1, project-agnostic version of everything in §2. Its core insight, stated as the TL;DR: *"A single 'current state' file models **one** thread; real work is **N** threads you pivot between. Split your project memory by **lifecycle** — now / all-threads / why / open / journal — give each thread a one-line `Resume:`, and a cold AI agent (or future-you) can pick up any of them in O(1) instead of re-deriving from `git log`."* It names the same file set as showroom's `hygiene.md` map and is explicitly the design source showroom's spine was built from — the repo instance and the vault pattern note are two tiers of the same idea, not independent inventions.

## 10. Relationship between repo docs and Obsidian — the sync convention

Stated identically in both showroom's `hygiene.md` and the vault's `AGENT-ACCESS.md`:

> **Repo `docs/` is the source of truth. The vault is a teaching mirror + map. If the two disagree, the repo wins** — the disagreement gets logged in the vault (showroom's note `16 — Known Doc-Drift & Things To Fix`), never silently resolved by editing the repo to match the vault.

Concretely:
- **Repo → vault, one-way, by convention, not automation.** Nothing pushes vault content into the repo. The repo's `hygiene.md` carries a signpost block ("Onboarding mirror (Obsidian — external)") so a cold agent can *find* the vault, but the full map lives only in the vault.
- **Vault → repo, never.** `_meta/AGENT-ACCESS.md`: *"Writes are additive + verify-first. The repo is read-only from here: never edit a repo file to 'fix' a note — fix the note (the repo is truth), or log the drift."*
- **The vault root is per-machine**, and this has actually caused an incident: `hygiene.md` recorded only the Windows path (`C:\ObsidianVault\Radiant`); on the Mac the real path is `/Users/khumeren/Obsidian/Radiant/`. An agent that trusted the single hardcoded path concluded the vault was "unreachable" while both notes it wanted sat on disk. **The corrected rule: resolve the vault root by probing (`ls -d ~/Obsidian/Radiant 2>/dev/null || ls -d /c/ObsidianVault/Radiant 2>/dev/null`), never by trusting a hardcoded path in a doc.**
- **Access mechanism:** an `obsidian` MCP server with deferred tool schemas (`read_note`, `read_multiple_notes`, `search_notes`, `list_directory`, `get_frontmatter`), loaded via `ToolSearch("select:mcp__obsidian__...")` before first use. Paths are vault-relative with forward slashes.
- **What promotes from repo evidence into a vault ADR (and vice versa):** a repo `D-NNN` in `decisions.md` is the canonical record; if it represents a *recurring* pattern worth teaching (not just a one-off call), it also gets written as a vault ADR with a `Changelog:` back-link to the repo's `CHANGELOG.md` entry. A pattern proven on a specific project gets extracted from its repo/vault case-study note up into the generic `Software Engineering Patterns/` Tier-1 note, per §9.2's three-tier flow.

## 11. `retiring-stale-docs` — the lifecycle of a doc

The skill (`~/.claude/skills/retiring-stale-docs/SKILL.md`) formalizes what showroom's `docs/_archive/` already practices. Core rule: **archive, don't delete** — retire via `git mv` into `docs/_archive/<original/subpath>`, never `rm`, so history and a one-line restore both survive.

**Staleness is judged on two independent axes, crossed in a table, never collapsed to one signal:**

| | linked by something LIVE | orphaned (no live inbound link) |
|---|---|---|
| **content live** | LIVE — keep | WIRE — undiscoverable, add a link, never archive |
| **content dead** | redirect the link, then archive | archive clean |

Full verdict taxonomy: **LIVE** (keep) · **WIRE** (content fine, just unlinked — fix discoverability, don't archive) · **ARCHIVE–superseded** (a named, `ls`-confirmed successor exists) · **ARCHIVE–absorbed** (the conclusion now lives inside a living doc — confirm by grepping the destination for the actual conclusion, not just that a file exists) · **ARCHIVE–dead-context** (references branches/repos/state that no longer exist) · **REFRESH** (still canonical, just factually stale — update it, don't archive it) · **UNSURE** (ambiguous or unconfirmed successor — escalate to a human, never archive on suspicion).

Process: (1) confirm disposition is "move," set up a mirrored archive tree; (2) mechanical pre-pass — grep the inbound-link graph path-scoped (generic filenames like `decisions.md` collide across projects) and check git recency (a hint, never a verdict); (3) classify each doc to exactly one verdict, with evidence; (4) safety rule — archive only if no live inbound link, or redirect every live link **in the same commit** as the move; (5) produce a reviewed manifest (`path · verdict · why · successor · live inbound links · proposed redirect`) and get human sign-off before any file moves; (6) execute in staged, reversible commits, each commit doing the `git mv` and its redirects together so the tree is never left with a dangling link.

showroom's own archive folders follow this exactly: `docs/_archive/2026-08-02-retired-stale-docs/` mirrors the original path of each retired file, and `hygiene.md` records *why* each was retired inline rather than just vanishing them (e.g. the struck-through-but-visible "Gotchas" entries in `CLAUDE.md`, and the corrected claim about `docs/tech-debt.md` not actually being deleted when a stale line said it was).

## Doc spine template for trainos

trainos is a new repo; start at the **vern-vault tier** (4 living files, one `CLAUDE.md`), not the showroom tier (14-file split) — split a file only when it visibly strains (see the trigger note below). Given trainos's own `CLAUDE.md` already exists with product design rules (RecordHeader/MetricStrip/etc.), this spine is additive to that, not a replacement.

### Folder tree to create

```
trainos/
  CLAUDE.md                      # already exists — leave as is, this spine doesn't touch it
  AGENTS.md                      # NEW — only if a second agent harness (Codex, etc.) needs
                                  #   instructions distinct from CLAUDE.md; otherwise skip and
                                  #   fold agent-ops content into CLAUDE.md, vern-vault-style
  README.md                      # NEW or rewritten — do NOT leave scaffold boilerplate (see §4)
  CHANGELOG.md                   # NEW — root, curated, forward-only, Keep-a-Changelog style
  ai/
    hot-state.md                 # NEW — seed empty (see below)
    state.md                     # NEW — seed empty; combined backlog+decisions+journal until
                                  #   any one section visibly outgrows the file (see trigger note)
    hydration-ladder.md          # NEW — seed with Level 0-2 only; add 3-5 once rules/postmortems exist
  docs/
    research/                    # EXISTS — dated deep-dives, `{slug}-YYYY-MM-DD.md`
    architecture/                # EXISTS — design-specs equivalent, `YYYY-MM-DD-{slug}.md`
    postmortems/                 # seed empty with a README.md index (table skeleton, no rows yet)
    audits/                      # seed empty — security/engineering audit reports land here
```

Do NOT create yet, until the project reaches showroom's scale: `docs/ai/state/` split into 14 files, `docs/superpowers/{specs,plans}/`, `docs/reviews/` lane-review folders, `docs/tasks/`, `fitness-ledger.md`, `retrofit-review-log.md`, `test-failure-ledger.md`. These are real patterns worth returning to this file for when the trigger below fires, not defaults to scaffold now.

**The one trigger worth watching for each split, stated once so it isn't re-derived under pressure:**
- `ai/state.md` outgrows readability (backlog + sprint-status + decisions tangled together) → split into `hot-state.md` / `state-backlog.md` / `decisions.md`, exactly as showroom's `docs/ai/STATE.md` did on 2026-06-11 (documented in ADR-002 §"One big STATE.md (tried, superseded)").
- More than ~5 threads are in flight at once and a single "current work" paragraph starts losing one while advancing another → add a `workstreams.md` parkable board (§2.4). This is the single highest-value split to watch for, because it's the one showroom's own teaching note calls "the anti-context-loss tool."
- A router file becomes necessary once there are more than ~5 living docs to route between (§2.1) — before that, a table inside `CLAUDE.md` does the job.
- A review sweep produces more than a couple of findings at once → start a `docs/reviews/YYYY-MM-DD-{slug}/` lane-review folder (§7) rather than writing findings directly into a permanent log.

### Skeleton content

**`CLAUDE.md` additions** (append a new section to the existing file, don't restructure what's there):

```markdown
## Docs to Read First

| Doc | Purpose |
|-----|---------|
| `ai/hydration-ladder.md` | Full context ramp-up for new sessions |
| `ai/hot-state.md` | What is actively being worked on right now |
| `ai/state.md` | Full backlog + decisions + session status |
| `CHANGELOG.md` | What shipped, product-facing |
```

**`README.md`** — write it for the actual product from day one (see §4's vern-vault gap warning), following the numbered-outline shape only once there's enough surface to justify it; until then a plain Product / Stack / Quick Start / Route Map is enough.

**`CHANGELOG.md`**:

```markdown
# Changelog

Tracks notable shipped changes. Append new entries at the top, ISO-8601 dates.
Forward-only: older gaps are not backfilled.

## YYYY-MM-DD — <headline>

### Added
### Changed
### Fixed
```

**`ai/hydration-ladder.md`** (seed with Levels 0-2 only; add deeper levels once there's a `CLAUDE.md` hard-rules section and postmortems to point to):

```markdown
# Hydration Ladder

> How to load context to resume cold. Leveled: read only as deep as your task needs.

**Level 0 — orient (always):**
- README.md
- ai/hot-state.md

**Level 1 — what's in flight:**
- git status + branch diff

**Level 2 — standing context:**
- ai/state.md (backlog + decisions + recent sessions)
```

**`ai/hot-state.md`** — seed empty except the header (no session blocks yet):

```markdown
# Hot State

> What's actively being worked on right now. Newest session block first.
> Historical detail moves to CHANGELOG.md once a chunk ships.
```

**`ai/state.md`** — seed empty except the header and section scaffolding (combined backlog/decisions/journal until it needs to split):

```markdown
# State

> Backlog, decisions, and session log in one file until it outgrows this shape
> (split trigger: see docs/research/05-doc-spine.md "When to split").

## Backlog

## Decisions

## Session Log
```

### What I could NOT verify

- **The exact live path of "Vern (Patterns Applied)" named in the brief** — the real Obsidian folder is `Projects/Vern/` with a `Patterns Applied/` subfolder inside it, not a folder literally named `Vern (Patterns Applied)`. Treated the brief's naming as shorthand for that subfolder; flagging in case a different, not-yet-created folder was intended.
- **Whether `docs/ai/backlog/2026-08-01-lane-seeds-kimi.md` and `2026-08-01-priority-queue.md` follow the numbered `backlog-N.0-` convention or a separate dated one-off convention** — skimmed by filename only, not opened; they appear to be one-off audit outputs rather than part of the numbered initiative series, but I did not open them to confirm their internal structure matches other backlog files.
- **Full contents of `docs/design/`, `docs/discovery/`, and `docs/superpowers/specs/plans` beyond the files explicitly read** — these folders are large (some individual files 100-230KB); I verified naming convention and skimmed structure/headers on 2-3 representative files each rather than reading every file in full, per the "skim large files by headings" instruction.
- **Whether vern-vault's `docs/handover/` numbering (00-04) is meant as a general repo-doc convention or is specific to this one client-handoff deliverable** — I read only the `00-overview.md` head; did not confirm whether `01`-`04` follow an identical section-order convention or diverge by content type (accounts/runbook/limitations/support are different enough in kind that I'd expect divergent internal structure).
- **Whether trainos's own existing `docs/architecture/` folder (already present, currently empty) is intended to hold `superpowers/specs`-style design docs or something else** — I mapped it to the "design-specs equivalent" by name-matching alone; no content exists yet to confirm intent, and it should be reconciled with whatever the scope-answer session decides architecture docs should look like.
- **The Vern Obsidian wiki's `raw/2026-06-05 Standup Reconciliation + Plan.md` and Wishes2Vows's `raw/` onboarding notes' relationship to the promoted `wiki/onboarding/` copies** — Wishes2Vows appears to have promoted `raw/onboarding/` content into `wiki/onboarding/`, but I did not diff the two to confirm `raw/` is now fully superseded versus still holding unpromoted drafts.
