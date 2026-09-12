# Claude Code / Agent Tooling Setup

Research document for seeding trainos with the agent scaffolding from showroom and vern-vault.

## Directory Structure

### `.claude/` — Project-local Claude Code Configuration

```
.claude/
├── settings.json              # Global project hooks, enabled plugins
├── settings.local.json        # User-specific permissions and allowlist
├── commands/                  # Custom slash commands for roles/patterns
│   ├── frontend-dev.md       # Frontend development guidelines
│   └── frontend-agent.md     # Senior frontend developer activation protocol
├── skills/                    # Project-scoped reusable workflows
│   ├── sprint/
│   ├── additive-spine-surgery/
│   ├── agent-task-contract/
│   ├── dispatching-kimi-fleets/
│   ├── migration-retrofit-qa/
│   ├── template-final-qc/
│   └── [13 total project skills]
├── agents/                    # NOT OBSERVED in showroom/vern-vault
└── worktrees/                 # git worktree checkouts (git-linked, machine-local)
```

**Committed to git**: `settings.json`, `commands/`, `skills/` (entire subtree)  
**NOT committed**: `settings.local.json`, `worktrees/`, `scheduled_tasks.lock`

### `.omc/` — OMC (oh-my-claudecode) Runtime State

```
.omc/
├── project-memory.json        # Persistent session facts (7-day TTL by default)
├── state/
│   ├── agent-replay-*.jsonl   # Agent execution logs
│   ├── hud-stdin-cache.json
│   ├── idle-notif-cooldown.json
│   ├── session-end-jobs/      # Background task artifacts
│   ├── checkpoints/           # Execution snapshots
│   └── [state subdirs]
├── sessions/                  # Per-session logs (one dir per session)
│   └── {sessionId}/
└── plans/ research/ logs/      # Generated outputs during execution
```

**NOT committed to git** (ignored via `.gitignore`).  
Regenerated each run. Session logs are ephemeral but `project-memory.json` persists facts across sessions.

### `docs/ai/` — AI Session State and Documentation

```
docs/ai/
├── WORKFLOW.md                # Feature pipeline: brainstorm → ship → snapshot
├── FRAGILE-SEAMS.md           # Boundary risks and contract patterns
├── state/
│   ├── hydration-ladder.md    # Leveled context map (depth 0–5)
│   ├── workstreams.md         # Parkable thread board with Resume: lines
│   ├── hot-state.md           # This session's changes + pointers to workstreams
│   ├── hard-rules.md          # Non-negotiable constraints
│   ├── entity-relationships.md
│   ├── failure-modes.md       # Known breakage modes
│   ├── retrofit-review-log.md # Migration review history
│   ├── test-failure-ledger.md
│   ├── fitness-ledger.md
│   ├── project-log.md         # Session narrator + timestamp log
│   └── [state-tracking files]
├── backlog/
│   └── [numbered feature docs]
├── memory-mirror/             # Decision log + feedback capture
│   ├── README.md
│   ├── MEMORY.md              # Index of decisions
│   ├── feedback_*.md          # User guidance on workflow
│   └── reference_*.md         # External resource pointers
├── reviews/                   # Dual-engine code review outputs
│   └── {date}-{topic}-review.md
└── [task-*.md, discovery/, etc.]
```

**Committed to git**: All WORKFLOW.md, state/ files, backlog/, memory-mirror/, reviews/ (archival).  
**NOT committed**: Session-generated logs, ephemeral handoff files.

## Settings Configuration

### `.claude/settings.json` — Hooks & Plugins (showroom)

```json
{
  "enabledPlugins": {
    "firecrawl@claude-plugins-official": true
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/safe-command-guard.mjs",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/codex-gate.mjs",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

**Purpose**:
- `PreToolUse` hook on Bash runs `safe-command-guard.mjs` before any shell command (validates unsafe patterns, 10s timeout)
- `Stop` hook runs `codex-gate.mjs` when session ends (async code review gate for mission-critical changes, 120s timeout)
- Firecrawl plugin enabled for web scraping

### `.claude/settings.local.json` — Permissions Allow-List (showroom)

Sample block from showroom (Windows path normalization — adapt for macOS):

```json
{
  "permissions": {
    "allow": [
      "WebFetch(domain:github.com)",
      "WebFetch(domain:raw.githubusercontent.com)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(npx tsc:*)",
      "Bash(npm run build:*)",
      "Bash(npm run lint)",
      "Bash(npx eslint:*)",
      "Bash(find:*)",
      "Bash(npm install *)",
      "Bash(npm run *)",
      "Skill(codex:rescue)",
      "Bash(git push *)",
      "Bash(git worktree *)",
      "Bash(git branch *)",
      "mcp__plugin_supabase_supabase__list_projects",
      "mcp__plugin_supabase_supabase__list_organizations"
    ]
  },
  "outputStyle": "Explanatory"
}
```

**Best practice**: Start permissive, then add granular allow-list entries based on session patterns. See `/fewer-permission-prompts` skill to auto-generate allowlist from transcript.

### `.claude/settings.local.json` — vern-vault variant

```json
{
  "permissions": {
    "allow": [
      "Bash(npx tsc:*)",
      "Bash(npm run build:*)",
      "Bash(npm run dev:*)",
      "Bash(bash scripts/push-all.sh:*)",
      "Bash(bash scripts/sync-pr-from-hot-state.sh:*)",
      "Bash(git push:*)",
      "Bash(git remote -v:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git branch:*)",
      "Bash(gh pr list:*)",
      "Bash(gh pr view:*)",
      "Bash(gh pr edit:*)",
      "Bash(gh pr create:*)",
      "Bash(python3 scripts/search.py ...)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/claude-hook-post-push.sh",
            "timeout": 30000
          }
        ]
      }
    ]
  },
  "outputStyle": "Explanatory"
}
```

**Difference**: PostToolUse hook (not Stop), fires after successful Bash command, runs sync/push script (30s timeout).

## Commands — Custom Slash Command Protocols

### `frontend-dev.md` — Guidelines + Checklist (showroom)

Located: `.claude/commands/frontend-dev.md`

Contains:
- Component checklist (PascalCase, TypeScript, Suspense, shadcn/ui, Tailwind, useCallback, mobile-first)
- Feature checklist (directories, barrel exports, Zod schemas, Zustand stores)
- Import aliases (only `@/` → `src/`)
- Component structure pattern (Props → Hooks → Handlers → Render → Export)
- Data fetching pattern (Supabase RPC + TanStack Query)
- Styling rules (Tailwind + shadcn/ui, no CSS-in-JS, 44px touch targets)
- State management mapping (Query data, UI state, forms, ephemeral state)
- TypeScript standards (strict, no `any`, Zod for schemas)
- Performance targets (Lighthouse >90, LCP <2.5s, CLS <0.1)
- Accessibility rules (WCAG 2.1 AA, semantic HTML, contrast ratios)
- Security rules (no `dangerouslySetInnerHTML`, RPC-only access, non-enumerable errors)

**Trigger**: Use when creating/modifying React components.

### `frontend-agent.md` — Senior Dev Execution Protocol (showroom)

Located: `.claude/commands/frontend-agent.md`

Protocol:
1. **Before writing code**: Read `docs/ai/STATE.md` → active task doc → existing components → `CLAUDE.md` conventions
2. **Deliberate UI questions** (in your head, don't output): Does component exist? What stores/keys? Mobile layout? What shadcn primitives? New RPCs?
3. **Parallel execution**: Read multiple files in parallel; read STATE.md + task + sources together
4. **Sequential gates**: Types/schemas → Hooks → Components → Page integration
5. **Verification**: Build? Lint? Mobile (320px, 44px targets)? Barrel exports? RPC-only?

**Trigger**: `/frontend-agent` at session start for UI-heavy work.

## Project-Scoped Skills

Located: `.claude/skills/{skill-name}/SKILL.md`

### List from showroom (13 total)

1. **sprint** — Session hydration protocol. Reads `hygiene.md` → `hydration-ladder.md` → `workstreams.md` → `hot-state.md` → git status/log. Generates seed prompt block + picks random narrator from legendary roster (Solomon, Al-Khwarizmi, Aryabhata, etc.). Enforces state-first resumption.

2. **agent-task-contract** — BEFORE dispatching agents. Turns request into CONTRACT (objective, current state, desired state, allowed files, architecture rules, acceptance criteria, validation commands, non-goals). Splits discovery from implementation. Triggers: "spawn an agent", "dispatch agents", "worktree fleet", "parallel agents".

3. **additive-spine-surgery** — When editing shared living docs that multiple sessions touch (state boards, hot-state, findings logs). Prevents clobbering and formatter rewrites. Used for session handoff.

4. **dispatching-kimi-fleets** — When dispatching Kimi K3 for audits, reviews, multi-agent swarms. Chooses between shared worktree vs isolated worktrees for concurrent agents.

5. **migration-retrofit-qa** — Pre-apply gate for Supabase migrations. Runs forward SQL, rollback, RPC contract check (7-point), dual adversarial review (thermonuclear + Codex), then EXECUTES test before apply. Triggers: "check this migration", "review migration NNN", "migration QA".

6. **template-final-qc** — Pre-PR gate for wedding template changes. Quality gate for multi-tenant component changes (shared component serves all live weddings).

7. **thermo-nuclear-code-quality-review** — Deep multi-pass code review (implied by showroom's extensive use).

8. **dual-gate-review** — Coordinate parallel review lanes (two independent reviewers in lanes).

9. **additive-spine-surgery** — Session result recording into shared docs.

10. **wrap-session** — End-of-session cleanup and STATE.md update.

11. **couple-media-pipeline** — Handle multimedia ingestion for couple content.

12. **onboard-a-couple** — Onboarding workflow for new wedding couples.

13. **algorithmic-art** — Generative/artistic component patterns.

**Pattern**: Each skill has a SKILL.md frontmatter with `name`, `description`, optional `user-invocable: false`.

## Global Skills Registry

Located: `/Users/khumeren/.claude/skills/`

These are shared across all projects (not project-scoped). Invoked via `/oh-my-claudecode:<name>`.

### Tier-0 Workflows (primary orchestration)

- `autopilot` — Full autonomous execution from idea to working code
- `ralph` — Persistence loop until completion with verification
- `ultrawork` — High-throughput parallel execution
- `team` — Coordinated team orchestration
- `ralplan` — Consensus planning workflow

### Common Skills

- `superpowers:brainstorming` — Creative direction without implementation
- `superpowers:writing-plans` — Task doc → ordered execution plan
- `superpowers:systematic-debugging` — Root-cause diagnosis
- `superpowers:subagent-driven-development` — Parallel agent lanes
- `superpowers:verification-before-completion` — Evidence-based done checklist
- `superpowers:requesting-code-review` — Solicited review workflow
- `superpowers:finishing-a-development-branch` — Merge/PR workflow
- `superpowers:test-driven-development` — TDD mode

### Domain-Specific Skills

- `stripe:*` — Stripe integration, testing, docs
- `postman:*` — API testing, documentation, mocks
- `coderabbit:code-review` — CodeRabbit review agent
- `codex:rescue` — Codex/GPT-5 second opinion on stuck problems
- `supabase:supabase` — Supabase docs + setup
- `frontend-design:frontend-design` — Visual design production

## `.gitignore` Entries — Agent State Management

From showroom:

```gitignore
# Logs
logs
*.log

# Local Claude Code harness state — machine-specific, regenerated each run
.claude/scheduled_tasks.lock

# Self-healing guardrail stack
.guardrails-off
# Codex seam-review dedup ledger
.codex-reviews/

# Transient guardrail reports (seam-gate rot-lens) — regenerated per diff
docs/discovery/*-fallow.md

# Environment variables
.env
.env.local
.env.*.local
!.env.example

# Customer PII (guest-list exports)
/docs/*.xlsx
/*.xlsx

# Couple raw media (uncut originals)
/docs/couples/**/*-raw/

# Throwaway scratch (k6 summaries, codex scratchpads)
/loadtest-summary.json
/scratchpad/

# Entire OMC state directory
.omc/
```

**Pattern**: Ignore all `.claude/worktrees/`, `.omc/`, ephemeral reports, and PII. Keep `.claude/settings.json`, `.claude/commands/`, `.claude/skills/`.

## Docs Structure — AI-Assisted Development Workflow

### WORKFLOW.md — Feature Pipeline

Located: `docs/ai/WORKFLOW.md` (showroom)

```
BRAINSTORM → RESEARCH → SPEC → PLAN → DESIGN → BUILD → VERIFY → SHIP → SNAPSHOT
```

| Stage       | Skill / Tool                      | Output                          |
|-------------|-----------------------------------|---------------------------------|
| Brainstorm  | `/superpowers:brainstorming`      | Creative brief (emotion/intent) |
| Research    | Ask Claude (Shackleton auto)      | Vetted technical approach       |
| Verify      | Ask Claude (Nansen auto)          | Evidence + challenges           |
| Spec        | Task doc template                 | `docs/task-{NNN}-{slug}.md`     |
| Plan        | `/superpowers:writing-plans`      | Ordered build sequence          |
| Design      | `/frontend-design:frontend-design` | Visual direction + markup       |
| Build       | `/frontend-agent`                 | Working code on feature branch  |
| Verify      | `/verification-before-completion` | Build/lint pass + criteria met  |
| Review      | `/requesting-code-review`         | Verified code                   |
| Ship        | `/finishing-a-development-branch` | Merged/PR created               |
| Snapshot    | Update `docs/ai/STATE.md`         | Session handoff                 |

**Keyword triggers for stage shortcuts**:
- `"autopilot"` → `autopilot` (full pipeline)
- `"ralph"` → `ralph` (persistence loop)
- `"deep interview"` → `deep-interview` (requirements clarification)
- `"deslop"` / `"anti-slop"` → `ai-slop-cleaner` (regression-safe cleanup)

### State Files — Session Hydration

Located: `docs/ai/state/`

- **`hydration-ladder.md`** — Leveled context map (depth 0–5 + read-to-depth guidance)
- **`workstreams.md`** — Parkable thread board; each thread lists `Resume:` line for session pickup
- **`hot-state.md`** — What changed THIS session + pointers back to workstreams
- **`hard-rules.md`** — Non-negotiable constraints (RPC-only access, security rules, contract discipline)
- **`entity-relationships.md`** — Data model overview
- **`failure-modes.md`** — Known breakage patterns
- **`project-log.md`** — Timestamp log + narrator assignment (for `/sprint` skill)

**Hydration ritual** (from `sprint` skill):
1. Read `hygiene.md` (doc router)
2. Read `hydration-ladder.md` (to appropriate depth)
3. Read `workstreams.md` (thread status + Resume lines)
4. Read `hot-state.md` (THIS session's context)
5. Run `git status` + `git log --oneline -5`

### Memory Mirror — Decision Log

Located: `docs/ai/memory-mirror/`

Pattern: Each decision/feedback lives as one file.

- **`feedback_*.md`** — User guidance (e.g., "no chrome devtools", "iterative commits", "Opus for agents")
- **`reference_*.md`** — External resources (Stripe wiring, ADRs, supabase config)
- **`norm_*.md`** — Established norms (DB protocol, field specs)
- **`MEMORY.md`** — Index of all memory files

**Why separate from CLAUDE.md**: Memory persists session-to-session but is more fluid; CLAUDE.md is stable repo law.

## AI Folder — vern-vault

Located: `vern-vault/ai/`

Files observed:
- `CHANGELOG.md` — Historical change log
- `hot-state.md` — Session-specific changes
- `hydration-ladder.md` — Context loading map
- `state.md` — Comprehensive state snapshot

**Pattern**: Similar to showroom's `docs/ai/state/`, but at repo root under `ai/` instead of `docs/ai/state/`.

## Tools Directory — Utility Scripts

Located: `showroom/tools/`

- **`sql-lint.mjs`** — Node.js script to lint Supabase migrations (executable, 2.5 KB)

**Pattern**: Project-specific CLI hooks that integrate with Claude hooks (e.g., `safe-command-guard.mjs` in scripts/).

## Hookify Rules

None observed in showroom or vern-vault `.claude/` directories.

**Note**: Hookify is a skill (`/oh-my-claudecode:hookify`) for analyzing transcripts and configuring hooks reactively, but neither repo has pre-configured hookify rules (`.claude/hookify*.json`).

## No Agents Defined

Neither showroom nor vern-vault has `.claude/agents/*.md` files.

**Why**: Agent definitions are typically managed globally via `/oh-my-claudecode:deepinit` or invoked dynamically within skills (e.g., `/team N:executor "task"`), not stored in the project.

## Recommended for trainos

### Minimum Viable Setup

1. **Create `.claude/settings.json`** with safe-command-guard hook (baseline security) + firecrawl plugin if web scraping needed.

2. **Create `.claude/settings.local.json`** with permissive allow-list:
   ```json
   {
     "permissions": {
       "allow": [
         "Bash(npx tsc:*)",
         "Bash(npm run build:*)",
         "Bash(npm run lint)",
         "Bash(npm run dev:*)",
         "Bash(git add:*)",
         "Bash(git commit:*)",
         "Bash(git push:*)",
         "Bash(git branch:*)",
         "Bash(gh pr:*)"
       ]
     }
   }
   ```

3. **Create `.claude/commands/`** with domain-appropriate guidelines (e.g., frontend-dev.md for UI work, adapt for your domain).

4. **Create `docs/ai/`** structure:
   ```
   docs/ai/
   ├── WORKFLOW.md              # Copy from showroom, adapt stages to trainos flow
   ├── FRAGILE-SEAMS.md         # Boundary risks specific to trainos
   └── state/
       ├── hydration-ladder.md  # Context load levels
       ├── workstreams.md       # Active threads + Resume lines
       ├── hot-state.md         # Session changes (regenerated each session)
       ├── hard-rules.md        # Non-negotiable constraints
       └── [other state files]
   ```

5. **Create `.gitignore` entries**:
   ```gitignore
   .claude/scheduled_tasks.lock
   .omc/
   .guardrails-off
   .codex-reviews/
   ```

6. **Optional: Project-scoped skills** in `.claude/skills/` if trainos has recurring workflows not covered by global skills.

### Integration with oh-my-claudecode

Trainos should leverage global OMC skills via the triggers defined in CLAUDE.md:

```markdown
# oh-my-claudecode Triggers

- `"autopilot"` → `/oh-my-claudecode:autopilot`
- `"ralph"` → `/oh-my-claudecode:ralph`
- `"deep interview"` → `/oh-my-claudecode:deep-interview`
- `"deslop"` → `/oh-my-claudecode:ai-slop-cleaner`
- `"tdd"` → TDD mode
- `"ultrawork"` → `/oh-my-claudecode:ultrawork`
```

### Hook Configuration Strategy

- **PreToolUse**: Optional, if security scanning needed (like showroom's safe-command-guard)
- **Stop**: Optional, if post-session gating needed (like showroom's codex-gate, vern-vault's post-push)
- **PostToolUse**: Optional, if workflow hooks needed (like vern-vault's sync script)

## What Could NOT Be Verified

1. **Obsidian MCP Integration** — `/Users/khumeren/Obsidian/Radiant/Main/Claude Code/` contains MCP server docs (Codex, Context7, Figma, Supabase) but the actual configuration (`~/.claude/mcp.json` or equivalent) was not found in the read-only sources.

2. **Port AI-Assisted Dev Workflow Note** — The Obsidian file "Port AI-Assisted Dev Workflow to Workplace Repo.md" was expected but not present at the checked path.

3. **Project-Specific Agent Definitions** — No `.claude/agents/*.md` files were found, suggesting agents are defined globally or dynamically.

4. **Hookify Rules** — No `.claude/hookify*.json` configuration was found, though the `/hookify` skill is available.

5. **Workspace-Level OMC State** — If using `OMC_STATE_DIR` environment variable for centralized state across multiple worktrees, that configuration was not observed.

---

## Cited Paths

- `.claude/settings.json` — `/Users/khumeren/Repos/personal-work/showroom/.claude/settings.json`
- `.claude/settings.local.json` — showroom and vern-vault variants
- `.claude/commands/` — `/Users/khumeren/Repos/personal-work/showroom/.claude/commands/`
- `.claude/skills/` — `/Users/khumeren/Repos/personal-work/showroom/.claude/skills/` (13 project skills)
- `docs/ai/` — `/Users/khumeren/Repos/personal-work/showroom/docs/ai/` (comprehensive state tracking)
- `docs/ai/state/` — State files under showroom and vern-vault
- `vern-vault/ai/` — `/Users/khumeren/Repos/personal-work/vern-vault/ai/`
- Global skills — `/Users/khumeren/.claude/skills/` (8 skill directories, Tier-0 + domain-specific)
- `.gitignore` — `/Users/khumeren/Repos/personal-work/showroom/.gitignore`
- Obsidian — `/Users/khumeren/Obsidian/Radiant/Main/Claude Code/`
