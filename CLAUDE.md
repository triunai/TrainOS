# TrainOS — Claude Code context

TrainOS is a training-operations console: enquiry to proposal to engagement to
HRD Corp claim to invoice, with an approval gate and a fleet of agents in the
middle. This file is the constitution. The design principles below came with the
design pack and are unchanged; the engineering rules were added when the repo
was scaffolded.

---

## Part 1 — Working principles (design)

### Consolidation over repetition

Any pattern that appears on more than two screens with the same behaviour must
be standardised as a named component before it is used again. If a screen needs
something the kit does not have, add it to the kit first, then use it. Never
invent a second visual language for a problem the kit already solves.

Applies to: RecordHeader, MetricStrip, LifecycleStepper, pill tab group, data
table, filter bar, status/AI/autonomy chips, approval banner, proposed-action
card, agent-run card, empty/loading/error states, drawers.

When two variants of one pattern exist, the newer one wins and the older is
migrated in the same pass — divergence is a defect, not a style.

### Standing rules

- One design system, one component library, one file per module.
- Three colours: ink neutrals, electric blue #1F5BFF, charcoal #181A1F.
  Status colour lives on chips only. Blue budget 5–15% per screen.
- AI is the primary hue at 6% tint plus the ✦ glyph and a text label, never a
  solid fill and never a fourth accent. Solid blue means a human triggered it.
- One solid primary button per view.
- Record identity appears once per page: RecordHeader owns it, the breadcrumb
  owns the path. Never duplicate either.
- Hierarchy comes from typography, alignment, spacing and separators before
  borders. If removing a border does not make a relationship ambiguous, remove it.
- Muted text #69717C or darker; non-text UI affordances at 3:1 or better.
- Stage names and order render from pipeline configuration, never hardcoded.

---

## Part 2 — Tech stack

| Layer        | Choice                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| Repo         | npm workspaces — `apps/*`, `packages/*`                                |
| Framework    | React 18 + Vite 5 (`@vitejs/plugin-react-swc`)                         |
| Routing      | React Router 6, lazy from day one                                      |
| Server state | TanStack Query 5                                                       |
| Validation   | Zod 3                                                                  |
| Forms        | React Hook Form + zodResolver                                          |
| UI           | shadcn/ui (Radix) + Tailwind 3                                         |
| Types        | `@trainos/contract` — the shared surface derived from the API contract |
| Backend      | Supabase (Postgres + Auth + Edge Functions) behind a REST `/v1` API    |
| Tests        | Vitest + Testing Library                                               |

## Architecture

```
apps/web/src/
  main.tsx  App.tsx  index.css
  styles/tokens.css        every colour, type, geometry and elevation token
  routes/                  the route table, GENERATED from the nav tree
  pages/                   route-level components — nothing imports a page
  features/<name>/         feature modules; index.ts is the ONLY public surface
  shared/                  cross-cutting: api, components, config, hooks, theme, lib
  test/setup.ts
packages/contract/         types only, no runtime
supabase/                  migrations, rollbacks, tests, catalog
scripts/                   the guardrail stack
```

Feature modules are black boxes. A feature is reachable only through its
`index.ts` barrel; its internals are private. `shared/**` must never import a
feature. Enforced by `.dependency-cruiser.cjs`, and both rules have been probed
with deliberate violations to confirm they fire.

---

## Part 3 — Rules

### R1 — One data boundary

Every read and write goes through the typed client in
`apps/web/src/shared/api/client.ts`. Nothing else builds a request, and no
screen imports `fetch`. Every response type comes from `@trainos/contract`, so a
contract change is a compile error at each call site rather than a silent shape
mismatch. The implementation is selected once, in `shared/api/index.ts`.

Enforced by the semgrep rule `no-raw-network-outside-api-layer`.

### R2 — A refusal is not a failure

`ApiError` is a discriminated union. A **domain** error is the server answering:
`FORBIDDEN`, `FLOOR_PRICE_BREACH`, `ATTENDANCE_LOCKED` are facts about the
request. They are never retried and usually have a designed surface. A
**transport** error is the request never getting an answer it could read, and is
the only kind a retry can help.

Collapsing the two means retrying a refusal, or rendering "something went wrong"
over a policy decision the user could have acted on.

### R3 — A fire-and-forget mutation must surface its error

```ts
mutate(...)               // nothing awaits it -> meta: { toastOnError: true } REQUIRED
await mutateAsync(...)    // inside try/catch rendering inline -> no flag, or it double-reports
```

Approve and reject buttons are exactly the first shape. Omitting the flag there
is how a denied write ends up showing nothing at all, and "the button does
nothing" is the only symptom anyone reports.

### R4 — One colour mechanism

Every colour lives in `apps/web/src/styles/tokens.css` as an `R G B` triplet and
is reached through a Tailwind token class (`text-ink`, `bg-ai-tint`,
`border-border`). No hex literal, no `rgba()`, no second palette. A literal does
not follow the light-to-dark swap, so it silently stays light-mode in dark.

A token the design pack does not name gets added to `tokens.css` with its source
cited, not to a second token file.

### R5 — Features are black boxes

Import a sibling feature through `@/features/<name>` only. If the symbol is not
exported there, add it to that feature's barrel — do not deep-link the internal
path. Importing your own feature's internals is fine.

### R6 — Strict is a ratchet, not a wall

`tsconfig.app.json` is loose. `tsconfig.strict.json` is the graduation
allowlist: audit a file, fix its strict errors, add its path, and CI enforces
strict for that file forever. New files should be added the day they are
created, before they have anything to fix. Never flip `strict` on globally.

### R7 — Nav, routes and roles come from one config

`shared/config/navTree.ts` is the design pack's tree transcribed verbatim.
`shared/config/nav.ts` derives every path by one stated rule and performs
exactly one role-filtering pass. The route table is generated from that tree, so
there is no second list of paths to drift.

A filtered rail is a rendering convenience. The API is the authorization
boundary, and a denied call must still be handled visibly in the UI.

### R8 — A migration ships complete or not at all

Forward migration, rollback, SQL test, catalog entry and changelog line in the
SAME commit. `npm run lint:sql` parses every one through the real Postgres
grammar, and `npm run check:grants` refuses a public EXECUTE grant outside the
written allowlist. A file in the tree is a claim that it runs; those checks turn
the claim into a fact.

### R9 — Commit with explicit pathspecs

This repository is worked on by several agents in one shared worktree. Never
`git add .` and never a bare `git commit -a`. Stage the paths you own and commit
them by name:

```
git add -- <paths>
git commit -F <message-file> -- <the same paths>
```

`.prettierignore` excludes `docs/`, `packages/`, `supabase/` and `.claude/` for
the same reason: reformatting a file you do not own rewrites someone else's work
and manufactures a merge conflict.

### R10 — A gate that cannot say no is not a gate

The CI summary job hard-fails on `failure`, `cancelled` **and `skipped`**. Every
blocking job needs `install`, so an install failure marks them skipped rather
than failed — and a gate that only looks for `failure` passes green having run
nothing at all. Any new blocking job joins that condition in the same change
that adds it.

The same principle applies locally: `guard.mjs` treats a spawn failure as a tool
error, not a pass, so a missing binary cannot certify a check as clean.

---

## Documentation system

| Doc                                        | The one question it answers                             |
| ------------------------------------------ | ------------------------------------------------------- |
| `ai/hydration-ladder.md`                   | How deep do I need to read for this task?               |
| `ai/hot-state.md`                          | What is actively being worked on right now?             |
| `ai/state.md`                              | What is open, what was decided, what happened?          |
| `CHANGELOG.md`                             | What shipped, product-facing?                           |
| `AGENTS.md`                                | How do I work in this repo?                             |
| `docs/architecture/`                       | How the domain, tenancy, actions, money and events work |
| `docs/research/`                           | The dated deep dives the scaffold was built from        |
| `docs/design/`                             | The design pack: artboards, kit, tokens, decisions      |
| `supabase/migrations/migration-catalog.md` | What each migration did and why                         |

## Session start ritual

1. Read `ai/hydration-ladder.md` to the depth this task needs.
2. Read `ai/hot-state.md` — this session's starting point.
3. `git status --short --branch` and `git log --oneline -5`.

## Current work

Pointers only. Never a live snapshot here — it rots. See `ai/hot-state.md`.

## Gotchas and warnings

A running list. When an entry stops being true, **strike it through** and mark
it RESOLVED or STALE rather than deleting it — a reader who half-remembers the
old claim needs to see the correction, not silence.

- **The dev server is on 5180, not the house default 8080.** A sibling app owns
  8080 on at least one developer machine. The bundle-budget dev-server probe
  reads the same port and will refuse to build if it sees a Vite server there.
- **`dependency-cruiser` 16 has no `--validate` flag.** It is `--config`. Older
  house scripts carry the dead flag.
- **`depcruise` runs with `apps/web` as its cwd**, because TypeScript resolves a
  tsconfig's `include` relative to the process cwd. The config lives at the root
  with the rest of the control plane, but every path inside it is
  apps/web-relative.
- **Six dark chip fills and borders in `tokens.css` are DERIVED**, not sourced:
  the design pack's dark map gives only the text colour for warning and danger.
  They are marked in place.
- **The design pack's `compliance` nav-role key is unreachable.** No role in the
  contract's `Role` union maps to it. The key is kept verbatim; the gap is real.
- **Branch protection is not on.** Until the blocking checks are required on
  `main` in the host's settings, CI is decoration rather than custody.

## Commands

| Command                                      | What it does                                            |
| -------------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                                | Vite dev server on :5180                                |
| `npm run build`                              | Production build                                        |
| `npm run typecheck`                          | Loose typecheck, web + contract                         |
| `npm run typecheck:strict`                   | The strict allowlist                                    |
| `npm run lint` / `lint:hooks`                | Broad lint (advisory) / hook order (blocking)           |
| `npm test`                                   | Vitest                                                  |
| `npm run verify:deploy`                      | The single gate name: typecheck + hooks + strict + test |
| `npm run guard -- all`                       | Every advisory guardrail                                |
| `npm run guardrails:off` / `:on` / `:status` | Pause, resume, inspect the advisory layer               |
| `npm run arch:graph`                         | Dependency-cruiser boundaries                           |
| `npm run bundle:check` / `:baseline`         | Bundle budget, and re-ratchet it                        |
| `npm run lint:sql`                           | Parse every migration, rollback and SQL test            |
| `npm run check:grants`                       | Static grant hygiene                                    |
| `npm run check:rpc`                          | Contract drift across the data seam                     |
| `npm run sast`                               | Semgrep, custom rules                                   |
