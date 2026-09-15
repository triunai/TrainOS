# TrainOS project skills

Skills for Claude Code sessions working in this repo. Each is a
`.claude/skills/<name>/SKILL.md` with a `description` that doubles as its
trigger sentence — Claude auto-loads a skill when a request matches its
trigger, or it can be invoked explicitly via `/oh-my-claudecode:<name>` (or
just `/<name>` where a project-level slash command exists).

Ported from the house skill set (the global `~/.claude/skills/*` skills and
the sibling Wishes2Vows/showroom repo's `.claude/skills/*`) and adapted so
every path, command, and incident cited is true for TrainOS specifically — see
each skill's own text for what changed.

| Skill | Trigger |
| --- | --- |
| [`agent-task-contract`](agent-task-contract/SKILL.md) | Use BEFORE dispatching any agent, subagent, worktree fleet, or long autonomous run — turns a request into a ten-part contract (objective, current/desired state, allowed files, architecture rules, acceptance criteria, validation commands, non-goals, stop conditions, commit slices) and requires agents to verify the premises they were handed. |
| [`dispatching-kimi-fleets`](dispatching-kimi-fleets/SKILL.md) | Use when dispatching Kimi K3 for audits, reviews, sweeps, or multi-agent/parallel fleet work — and when choosing between one shared worktree and isolated worktrees for concurrent agents. Ships with `fleet-patterns.md`, worked dispatch patterns. |
| [`dual-gate-review`](dual-gate-review/SKILL.md) | Run the two-reviewer adversarial gate (Codex `gpt-5.6-sol` xhigh + a Kimi fleet, in parallel, both carrying the thermo-nuclear rubric) over a diff before merging or applying anything touching a critical seam — RLS, the action envelope, the RPC contract, the money path. |
| [`migration-retrofit-qa`](migration-retrofit-qa/SKILL.md) | Use before applying ANY Supabase migration, and whenever one is authored, amended, or reviewed. Runs the retrofit QA gate (four artifacts, retrofit-vs-bolt-on, the E1/E2/E3 RPC contract check, the traps that have actually bitten this repo, a runnable SQL pin) then the dual adversarial review, then EXECUTES the pin before anything applies. |
| [`additive-doc-surgery`](additive-doc-surgery/SKILL.md) | Use when recording session results into shared living docs (`ai/resume-brief.md`, `ai/hot-state.md`, `ai/state.md`, `ai/workstreams.md`, `ai/findings-log.md`, `ai/state-backlog.md`, `ai/project-log.md`, `supabase/migrations/migration-catalog.md`) — especially from a worktree under `trainos-wt/` — with additive, anchored, whole-line edits that prove a pure-insertion footprint. |
| [`retiring-stale-docs`](retiring-stale-docs/SKILL.md) | Use when `docs/` or the `ai/` doc spine has grown bloated with stale, superseded, one-off, or dead-context files — classifies each doc (LIVE / WIRE / ARCHIVE / REFRESH / UNSURE) on content + live-inbound-links and archives (never deletes) with redirects in the same commit. |
| [`sprint`](sprint/SKILL.md) | Use at the start of every coding session. Walks `ai/hydration-ladder.md`'s reading order, generates a seed prompt, and assigns a random historical/fictional narrator for the session. Ends by pointing at `wrap-session`. |
| [`wrap-session`](wrap-session/SKILL.md) | End-of-session/feature doc-hygiene ritual. Walks the `ai/` doc spine in write order (`resume-brief.md` → `hot-state.md` → `workstreams.md` → `state.md` → `state-backlog.md` → `findings-log.md` → `project-log.md` → `CHANGELOG.md` → `migration-catalog.md`), worktree hygiene, and Claude memory — each step conditioned on what actually changed this session. |
| [`thermo-nuclear-code-quality-review`](thermo-nuclear-code-quality-review/SKILL.md) | An unusually strict maintainability review for abstraction quality, giant files, and spaghetti-condition growth, tied to TrainOS's real feature-module boundary (`apps/web/src/features/<name>/index.ts` as sole public surface, enforced by `.dependency-cruiser.cjs`) and its CLAUDE.md consolidation rule. |
| [`stack-bootstrap`](stack-bootstrap/SKILL.md) | Use when standing up a new repository on the house stack, or when an existing repo is missing its git hooks, CI pipeline, guardrail scripts, doc spine, agent tooling, or Supabase conventions. Already TrainOS-native (this repo was itself bootstrapped from it); ported unchanged — the global copy is byte-identical. |

## Skipped (wedding-product specific, no TrainOS meaning)

Not ported — each is specific to the Wishes2Vows/showroom wedding-sites
product and has no TrainOS analogue:

- **`couple-media-pipeline`** — wedding photo/video ingestion pipeline for
  couple media galleries.
- **`onboard-a-couple`** — the wedding-site onboarding flow for a new couple.
- **`update-share-invite-message`** — copy/logic for the wedding site's guest
  share-invite message.
- **`template-final-qc`** — final QC gate for wedding template/theme visual
  work in a multi-tenant wedding-site repo.
- **`algorithmic-art`** — generative-art tooling for wedding site visuals
  (p5.js generators/viewers), unrelated to TrainOS's product surface.

## Not ported as a project skill

- **`omc-reference`** — this is oh-my-claudecode plugin documentation (agent
  catalog, tool list, team pipeline routing), not project-specific. It ships
  with the OMC plugin itself and doesn't belong copied into a product repo.

## Notes on merges

- **`additive-doc-surgery`** merges the global `additive-doc-surgery` skill
  with showroom's `additive-spine-surgery` (same concept, different name) —
  kept the global name, re-anchored every convention to TrainOS's real `ai/`
  doc spine and shared-worktree pathspec-commit rule.
- **`migration-retrofit-qa`** and **`thermo-nuclear-code-quality-review`**
  merge the global and showroom copies — both source pairs were close to
  identical, so the richer copy was ported and then grounded in TrainOS's own
  `supabase/CLAUDE.md` rules, `ai/project-log.md` incidents, and
  `docs/reviews/` history rather than the wedding repo's.
- **`agent-task-contract`** and **`dispatching-kimi-fleets`** had no real
  content divergence between their global and showroom copies; the richer
  (showroom) copy was ported, `dispatching-kimi-fleets` bringing its
  `fleet-patterns.md` reference along.
