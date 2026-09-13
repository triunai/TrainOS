# AGENTS.md

Operational instructions for coding agents. The constitution — the design
principles, the security model and rules R1 to R14 — is in `CLAUDE.md`. This
file is how to work here.

## Setup

```
npm install          # installs every workspace and runs `lefthook install`
npm run verify:deploy
```

`verify:deploy` passing is what proves the checkout is healthy. It is one
command and it is the same gate CI runs as separate jobs.

## This is a shared worktree

Several agents write into this repository at once, on the same branch.

- **Commit with explicit pathspecs, always.** `git add -- <paths>` then
  `git commit -F <file> -- <the same paths>`. Never `git add .`, never
  `git commit -a`.
- **Do not format a file you do not own.** `.prettierignore` excludes `docs/`,
  `packages/`, `supabase/` and `.claude/`. Running `prettier --write .` outside
  your own tree rewrites someone else's work and guarantees a conflict.
- **Living docs are edited additively.** Anchor on an existing neighbour line
  and insert whole new lines; never splice mid-line. Prove the footprint with
  `git diff --numstat` — it should show pure insertions on every edited doc.
- **Never rewrite a commit.** No `--amend`, no `reset`, no `rebase`. R9 stops
  you taking another lane's staged work; nothing stops you destroying their
  committed work, and the branch tip is as shared as the index. If a commit is
  wrong, add one that corrects it. This has already happened here once. (R12)
- **Verify the artefact, not the message.** `git show` the diff, read the
  catalog entry, measure the bytes. A commit message is a claim about a file,
  and this repository contains at least one that was wrong. The same goes for
  any premise another lane hands you — check it against the tree and say so when
  it does not hold. (R13)
- **Raise on a value you do not recognise.** An `else` branch over a vocabulary
  another lane owns fails silently in whichever direction the else points. (R14)
- **Re-check where you are before editing after a resume or a compaction.**
  `git status --short --branch`, your cwd, and `ai/hot-state.md`.

## The guardrail stack

| Juncture             | Runs                             | Blocks?                  |
| -------------------- | -------------------------------- | ------------------------ |
| every Bash tool call | `safe-command-guard.mjs`         | yes, always, unpausable  |
| pre-commit           | lint-staged (prettier)           | yes                      |
| commit-msg           | commitlint                       | yes                      |
| pre-push             | `guard.mjs all` (advisory layer) | no                       |
| CI                   | the 17-job pipeline              | yes, via the summary job |

### Toggle

`npm run guardrails:off` pauses the advisory layer only, via a gitignored
sentinel. One-shot alternative: `LEFTHOOK_EXCLUDE=guardrail git push`. The
baseline hooks and the safety guard are unaffected and cannot be paused.

That asymmetry is deliberate: you can turn off the noise, not the safety guard,
and not the commit-message gate.

### Architecture rules

1. `no-circular` — no dependency cycles anywhere.
2. `no-cross-feature-internals` — reach another feature only through its barrel.
3. `shared-no-features` — `shared/**` must never import a feature.
4. `no-imports-from-pages` — a page is a composition root; nothing imports it.

### The checks, and what each one is for

| Command                | Catches                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run lint:sql`     | a migration, rollback or SQL test that cannot actually run                                          |
| `npm run check:grants` | a public EXECUTE grant on a definer function, outside the allowlist                                 |
| `npm run check:rpc`    | a hand-built envelope, a double cast in the data layer, a client method not typed from the contract |
| `npm run arch:graph`   | a broken module boundary                                                                            |
| `npm run bundle:check` | a chunk that grew past the committed baseline                                                       |
| `npm run sast`         | the custom semgrep rules, one per CLAUDE.md rule                                                    |

Every ratchet ships with a baseline it passes today. Do not set a threshold
nobody can hit — a gate that is disabled tomorrow is worse than no gate.

## The doc control plane

One question per file.

| File                     | The one question it answers                    |
| ------------------------ | ---------------------------------------------- |
| `ai/hydration-ladder.md` | How deep do I need to read for this task?      |
| `ai/hot-state.md`        | What changed this session?                     |
| `ai/state.md`            | What is open, what was decided, what happened? |
| `ai/workstreams.md`      | What threads exist, and how do I resume one?   |
| `ai/state-backlog.md`    | What is owed, and what makes it due?           |
| `ai/findings-log.md`     | What broke, and is it pinned?                  |
| `ai/project-log.md`      | What happened, and what did we get wrong?      |
| `CHANGELOG.md`           | What shipped?                                  |

## Session wrap

1. Prepend a session block to `ai/hot-state.md` — Focus, Shipped, Next Active
   Task, Blockers, New durable artifacts. Those three heading names are a
   contract; renaming one breaks the PR-body extractor.
2. Add anything decided to `ai/state.md` under Decisions, as `D-NNN`, superseding
   rather than deleting.
3. Add a `CHANGELOG.md` entry if something shipped.
4. Add a line to `ai/hydration-ladder.md` for any new durable doc, in the same
   commit that creates it. A doc nobody can find is a doc nobody has.
5. Flip the marker and rewrite the `Resume:` line of every thread in
   `ai/workstreams.md` you touched. A parked thread with a stale `Resume:` is
   worse than no board, because the next session trusts it.
6. Any defect you found by RUNNING something goes in `ai/findings-log.md` with
   its pin, or with a note saying why it has none. No HIGH or CRITICAL closes
   without a pin.
7. Anything you got wrong goes in `ai/project-log.md`'s numbered list. The
   outcome survives in `git log`; the refuted assumption does not.

## Skills

One line each. Never paste a SKILL.md body here — some harnesses truncate their
combined instruction file at a size limit, and a bloated list silently drops the
tail.

- `stack-bootstrap` — standing up or repairing the repo's floor: hooks, CI,
  guardrails, doc spine, Supabase conventions.
- `migration-retrofit-qa` — the gate every migration passes before it is applied.
- `additive-doc-surgery` — how to edit a living doc that other sessions also edit.
- `agent-task-contract` — how to brief an agent before dispatching one.
