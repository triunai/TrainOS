# TrainOS

TrainOS is the operating system for a corporate training provider. It carries a
deal from the enquiry that starts it, through training-needs analysis, proposal
and costing, to the delivered engagement, the HRD Corp grant claim, the invoice
and the collection — with an approval gate in the middle and a fleet of agents
doing the parts that do not need a person.

Two things shape every screen. **Nothing that moves money or leaves the building
happens without a human deciding it**, so the approval envelope is a first-class
surface rather than a modal. And **anything an agent produced says so**, with its
sources, its confidence and its provenance attached, because an operator who
cannot tell what the machine wrote cannot supervise it.

## Stack

| Layer        | Choice                                                              |
| ------------ | ------------------------------------------------------------------- |
| Repo         | npm workspaces — `apps/*`, `packages/*`                             |
| App          | React 18 + Vite 5 + TypeScript 5.8                                  |
| Routing      | React Router 6                                                      |
| Server state | TanStack Query 5                                                    |
| UI           | shadcn/ui (Radix) + Tailwind 3                                      |
| Types        | `@trainos/contract`                                                 |
| Backend      | Supabase (Postgres + Auth + Edge Functions) behind a REST `/v1` API |
| Tests        | Vitest + Testing Library                                            |

## Quick start

### Prerequisites

Node 20 or newer, and npm 10 or newer.

### Environment variables

```
cp apps/web/.env.example apps/web/.env
```

Every variable is documented in `.env.example`, which is the canonical answer to
"what does this need to run". Every `VITE_` value is public by design: Vite
inlines it into the client bundle. Secrets never live there.

### Install and run

```
npm install          # also installs the git hooks
npm run dev          # http://localhost:5180
```

### Checks

```
npm run verify:deploy   # typecheck + hook order + strict allowlist + tests
npm run guard -- all    # the advisory guardrail layer
```

## Layout

| Path                | What lives there                                        |
| ------------------- | ------------------------------------------------------- |
| `apps/web`          | the console: shell, routes, features, the shared kit    |
| `packages/contract` | the shared type surface derived from the API contract   |
| `supabase`          | migrations, rollbacks, SQL tests, the migration catalog |
| `scripts`           | the guardrail stack — safety guard, toggle, ratchets    |
| `docs/design`       | the design pack: artboards, kit, tokens, decisions      |
| `docs/architecture` | domain model, tenancy, action envelope, money, events   |
| `docs/research`     | the dated deep dives this repo was built from           |
| `ai`                | hydration ladder, hot state, backlog and decisions      |

## Routes

Routes are generated from the navigation tree in
`apps/web/src/shared/config/navTree.ts`, which is the design pack's tree
transcribed verbatim. There is no second list of paths.

| Family                                  | What lives there                                                    |
| --------------------------------------- | ------------------------------------------------------------------- |
| `/dashboard`, `/approvals`, `/my-tasks` | the operator's own queue                                            |
| `/sales/*`                              | enquiries, leads, organisations, contacts, pipeline, TNA, proposals |
| `/relationships/*`                      | renewals, cross-sell, marketing                                     |
| `/training/*`                           | programmes, engagements, calendar, trainers, participants           |
| `/compliance/*`                         | HRD Corp, rules, rule changes, documents, deadlines                 |
| `/finance/*`                            | quotations, invoices, collections, commissions, profitability       |
| `/knowledge/*`                          | library, sources, templates, knowledge base                         |
| `/automation/*`                         | agents, runs, failures, policies                                    |
| `/reports`, `/settings/*`               | reporting and configuration                                         |

Which of these a person sees is filtered by role from one config. That filter is
a convenience: the API is the authorization boundary.

## Documentation

`CLAUDE.md` carries the design principles and the engineering rules.
`AGENTS.md` is how to work in this repo. `ai/hydration-ladder.md` says how deep
to read before starting.

The living state is in `ai/`, one question per file: `workstreams.md` for what
is in flight and how to resume it, `hot-state.md` for the current session,
`state.md` for the decisions, `state-backlog.md` for what is owed,
`findings-log.md` for what broke and whether it is pinned, and `project-log.md`
for the journal. `CHANGELOG.md` is what shipped. Per-lane audits live in
`docs/reviews/`.
