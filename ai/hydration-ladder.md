# Hydration Ladder

> How to load context to resume cold. Levelled: read only as deep as your task
> needs. This file exists so a session does not burn its context window on
> archaeology.

**Level 0 — orient (always):**

- `README.md` — what TrainOS is
- `ai/hot-state.md` — what is happening right now

**Level 1 — what is in flight:**

- `git status --short --branch`
- `git log --oneline -5`
- Note: this is a SHARED worktree. Other agents' uncommitted work will show up
  in `git status`. Do not stage it.

**Level 2 — standing context:**

- `ai/state.md` — backlog, decisions, session log
- `CLAUDE.md` Part 3 — rules R1 to R10

**Level 3 — rules and architecture (before touching a contract):**

- `CLAUDE.md` in full, including the Gotchas list
- `AGENTS.md` — the guardrail stack and the shared-worktree protocol
- `packages/contract/README.md` and the section of `src/` you are touching
- `supabase/migrations/migration-catalog.md` before any schema work
- `docs/architecture/` — 01 domain, 02 tenancy/RLS, 03 action envelope,
  04 money, 05 events

**Level 4 — building UI:**

- `docs/design/REPORT.md` and `docs/design/DECISIONS.md`
- `docs/research/09-design-pack-inventory.md` — tokens §1, nav §2, kit §3,
  screens §4, layout §5, fixtures §6, rules §7, and §8 for what is unverified
- the `.dc.html` artboard for the screen you are building
- `apps/web/src/styles/tokens.css` — the token vocabulary

**Level 5 — operational and debugging:**

- the header comment of each script in `scripts/` — every guardrail states the
  incident it exists for
- `docs/research/` 01 to 08 — how the stack, hooks, CI and Supabase
  conventions were chosen
- `.github/workflows/ci.yml` — what actually gates a merge

<!-- Add as the project grows:
**Level 6 — full rehydration:**
- docs/postmortems/, docs/audits/
-->

## Maintaining this file

A new durable doc gets a line here at the level a reader would first need it,
**in the same commit that creates the doc**. A doc nobody can find is a doc
nobody has.
