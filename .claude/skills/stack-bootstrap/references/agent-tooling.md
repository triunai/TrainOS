# Agent tooling

What to seed under `.claude/`, what to commit, and what to ignore.

---

## 1. What is committed and what is not

```
.claude/
  settings.json              # COMMITTED — project hooks, enabled plugins
  settings.local.json        # NOT committed — per-machine permissions
  commands/                  # COMMITTED — custom slash commands
  skills/                    # COMMITTED — project-scoped skills
  worktrees/                 # NOT committed — git-linked, machine-local
  scheduled_tasks.lock       # NOT committed — harness state
```

`settings.json` holds the hooks every contributor and agent must run.
`settings.local.json` holds one person's permission allowlist and must not be shared —
it encodes what *that* machine has approved, not project policy.

---

## 2. .claude/settings.json

Seed exactly this on day one. The safety hook is a non-negotiable from `SKILL.md`.

```json
{
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
    ]
  }
}
```

Three hook events are available and each has a different right use:

| Event | Fires | Use it for |
|---|---|---|
| `PreToolUse` | before a matching tool call | safety gates that must block. The safe-command-guard lives here |
| `PostToolUse` | after a matching tool call | workflow reactions — e.g. syncing a PR body after a push |
| `Stop` | at the end of a turn | end-of-turn gates, such as a diff-gated background review |

Add a `Stop` hook only once the diff-gated review trigger in `references/guardrails.md` §8
exists. Give it a generous timeout and make the script itself always exit 0 — an end-of-turn
gate that can fail is an end-of-turn gate that gets removed.

A `PostToolUse` Bash hook fires after **every** Bash call, so the script must cheaply decide
it has nothing to do and exit 0. The example in `references/hooks-and-ci.md` §6 shows the
shape: read the JSON envelope from stdin, extract the command, match it, and bail silently
otherwise.

Add `enabledPlugins` here only for plugins the whole project genuinely needs.

---

## 3. .claude/settings.local.json

Not committed. Seed it for the person running the bootstrap; everyone else generates their
own. Start permissive on the commands this project actually runs, then tighten.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npx tsc:*)",
      "Bash(npx vitest:*)",
      "Bash(node scripts/*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git branch:*)",
      "Bash(git push:*)",
      "Bash(git worktree *)",
      "Bash(gh pr list:*)",
      "Bash(gh pr view:*)",
      "Bash(gh pr create:*)",
      "Bash(gh pr edit:*)",
      "Bash(find:*)",
      "WebFetch(domain:github.com)",
      "WebFetch(domain:raw.githubusercontent.com)"
    ]
  },
  "outputStyle": "Explanatory"
}
```

Add MCP tool names as they get used, e.g. read-only database tools like
`mcp__<server>__list_projects`. Grant read-only tools freely and write tools deliberately.

A permission allowlist is **not** a safety boundary — `safe-command-guard.mjs` is. The
allowlist reduces prompts; the guard blocks damage. Do not loosen the guard to reduce
prompts.

---

## 4. .claude/commands/

One markdown file per recurring role or protocol. Two that pay for themselves early:

**A domain-guidelines command** — the checklist for building in this codebase. Component
naming, the directory and barrel convention, which state goes where (server state in the
query cache, UI state local, form state in the form library), the import alias rule
(`@/` only), the component structure order (props → hooks → handlers → render → export), the
data-fetching pattern (the typed RPC wrapper plus the query library, never a direct table
call), styling rules, TypeScript standards, accessibility floor, and the security rules.

**An execution-protocol command** — what to do *before* writing code:

1. Read the hot-state doc, then the active task doc, then the existing components in the
   area, then the conventions in `CLAUDE.md`.
2. Answer, privately, before typing: does this component already exist? Which query keys
   does it touch? What does it look like at 320px? Which primitives does it compose? Does it
   need a new RPC?
3. Read files in parallel where they are independent.
4. Move through sequential gates: types and schemas → hooks → components → page integration.
5. Verify: build, lint, mobile at 320px with 44px touch targets, barrel exports intact, no
   direct table access.

Keep each command file to what an agent must *do*. A command file that restates `CLAUDE.md`
drifts from it.

---

## 5. Project-scoped skills

`.claude/skills/<name>/SKILL.md`, committed. Create one when a workflow in this repo recurs
and is not covered by a global skill. Frontmatter carries `name` and a `description` that
states **when** to use it, not what it does.

Do not seed speculative skills during bootstrap. The ones worth having emerge from the
second or third time you explain the same procedure.

---

## 6. .gitignore

```gitignore
# Dependencies and build output
node_modules
dist
dist-ssr
coverage
*.local

# Logs
logs
*.log
npm-debug.log*

# Editor
.DS_Store
.vscode/*
!.vscode/extensions.json
.idea
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Environment
.env
.env.local
.env.*.local
!.env.example

# Agent harness state — machine-specific, regenerated each run
.claude/scheduled_tasks.lock
.claude/settings.local.json
.claude/worktrees/

# Guardrail stack
.guardrails-off
.bundle-check/
.codex-reviews/

# OMC operational state
.omc/
```

Notes on the non-obvious entries:

- `.guardrails-off` is the pause sentinel. It must be machine-local — a committed pause
  would silence the advisory layer for everyone.
- `.bundle-check/` is the bundle budget's scratch build directory. `.bundle-size-baseline.json`
  at the root is **committed**; only the scratch output is ignored.
- `.omc/` is regenerated operational state. The one intentional exception to ignoring it is
  `.omc/skills/**` if this project uses project-scoped skills from that layer.
- Any generated report that is regenerated per diff belongs here too, not in git.

Add ignores for customer data or PII exports the moment such a file could plausibly land in
the tree. That is much cheaper than removing one from history.

---

## 7. Agent-facing docs

The doc spine in `references/doc-spine.md` is what an agent reads to orient. Two files there
do the heavy lifting for agents specifically:

- `ai/hydration-ladder.md` — read only as deep as the task needs. This is the file that
  stops a session burning its context window on archaeology.
- `AGENTS.md` — operational instructions, if a second harness needs something distinct from
  `CLAUDE.md`. Keep its skills section to **one line per skill**; some harnesses truncate
  their combined instruction file at a size limit, and a bloated list silently drops the
  tail.

---

## 8. What was not verified

- **Project-scoped agent definitions** (`.claude/agents/*.md`): neither reference repo has
  any. Agents appear to be defined globally or dispatched dynamically from within skills.
  No project-local pattern to copy.
- **Pre-configured hookify rules**: neither reference repo has one, though the tooling
  exists. Nothing to seed.
- **Workspace-level centralized state** via an environment variable pointing agent state
  outside the repo: not observed in either repo. Worth knowing it exists if a multi-worktree
  setup starts losing state when a worktree is removed, but there is no verified
  configuration here to copy.
- **The MCP server configuration itself**: documentation for several servers was present but
  the actual configuration file was not found in the sources, so there is no verified MCP
  block to seed.
