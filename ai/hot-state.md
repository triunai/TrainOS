# Hot State

> What is actively being worked on right now. Newest session block first.
> Historical detail moves to `CHANGELOG.md` once a chunk ships.
>
> The three headings `Focus`, `Next Active Task` and `Blockers` are an implicit
> contract — a PR-body extractor keys on those literal strings. Renaming one
> silently degrades that section to a placeholder.

## SESSION 2026-09-12 — REPO FLOOR LAID

> **Last updated:** 2026-09-12 — the scaffold is in and every gate runs clean.

### Focus

Standing up the TrainOS repository on the house stack so a React team can start
building kit components and screens immediately: workspaces, build config,
design tokens, the app shell, the data boundary, the guardrail stack, CI, and
the doc spine.

### Shipped

- npm workspaces monorepo; `apps/web` depends on `@trainos/contract` by name.
- Four tsconfigs including the strict ratchet, shipped with an empty allowlist.
- `src/styles/tokens.css`: every light token and the full dark map as a straight
  token swap, stored as RGB triplets so Tailwind alpha modifiers work.
- next-themes with `data-theme` and three states; the token swap is the whole
  theme.
- Sidebar + topbar shell at the pack's dimensions, role-filtered from one config
  pass, with the route table generated from the same tree.
- The typed client boundary: one interface by contract section, 41 methods, a
  `{ data, error }` Result, and a domain-versus-transport error split.
- EmptyState, LoadingState, ErrorState.
- Two hook tiers, 17-job CI whose summary fails on `skipped`, dependency-cruiser
  with both boundary rules probed, a bundle baseline, and three Supabase-coupled
  checks running clean against the live migrations.

### Next Active Task

Wire the HTTP client behind `TrainOsClient` and let the fixtures package replace
`fixture-client.ts` method by method. Nothing else in the app moves when that
happens — that is what the boundary is for. The first screen to build is the one
the approvals queue needs, since it exercises the approval envelope, the badge
count and the fire-and-forget mutation rule all at once.

### Blockers

- **Branch protection is not on.** Nothing in this repo can turn it on. Until
  the blocking checks are required on `main` in the host's settings, the
  pipeline is decoration.
- **CI secrets are unset**: `VITE_SITE_URL` and `VITE_API_BASE_URL`.

### New durable artifacts

`CLAUDE.md`, `AGENTS.md`, `README.md`, `ai/*`, `scripts/*`,
`.github/workflows/ci.yml`, `.dependency-cruiser.cjs`, `.semgrep/rules.yml`,
`apps/web/**`, `docs/design/**`.

---

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
