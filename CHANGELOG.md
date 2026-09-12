# Changelog

Tracks notable changes across migrations, RPC contracts, frontend types, and project
documentation. Append new entries at the top with the date in ISO-8601 format.

> An entry that reflects a real architectural decision cites the doc that carries the
> reasoning — `docs/architecture/NN`, or a decision id where one exists. The point is to make a
> shipped behaviour traceable to the reasoning behind it without archaeology. **Forward-only:
> older entries are not backfilled**; link them if you happen to touch them.

Where the catalog (`supabase/migrations/migration-catalog.md`) is the engineering and security
record of a migration, an entry here is the human-facing summary of the same event.


## 2026-09-12 — money, and three rules the database now enforces instead of trusting

### Added

- **Rate cards, proposals, quotations and the client portal (007).**
- **A quotation's total cannot disagree with its lines.** Each line's total is derived from its own
  unit price and quantity, the header is recomputed from the lines, and a transaction that leaves
  the two disagreeing cannot commit. The check is deferred to the end of the transaction, because a
  multi-line edit legitimately passes through moments where they do not match.
- **Two floor prices, and the database decides which one binds.** One is an absolute commercial
  figure; the other is derived from cost and the margin floor. Both are computed in the database
  rather than in the application, so the costing screen and the approval screen cannot disagree
  about the limit. On the contract's own example they differ by about three and a half thousand
  ringgit.
- **The client portal never stores a link.** Only a hash of it, so a database copy does not hand
  anyone a working client link. And a proposal can be accepted once: a double-clicked Accept button
  cannot create a second binding acceptance, whatever the handler does.

### Fixed

- **Three defects in the money specification, found by executing it.** The floor rule could not be
  written as a simple column constraint at all: it made a quotation impossible to create, because
  the total legitimately starts at zero and is filled in from the lines. It is now checked at the
  end of the transaction instead. Two related checks were reading a stale copy of the row and
  rejecting correct work. And one of the tests asserted the wrong thing about the contract's own
  worked example, which was corrected rather than left to pass for the wrong reason.
 and a trainer who cannot be in two places

### Added

- **Programmes, pricing tiers, materials, trainers, availability and bookings (006).**
- **A trainer cannot hold two overlapping confirmed bookings.** The database refuses it outright
  rather than leaving it to a validation rule someone might route around. Two confirmed bookings on
  overlapping dates is a trainer in the wrong city, a client with no facilitator, and a training
  grant claim that cannot be filed. Provisional holds are still allowed to overlap, because holding
  two options for a client while they decide is the whole point of a hold.
- **The availability calendar is maintained by the bookings, not beside them.** Confirming writes the
  booked days and moving a booking releases the days it no longer covers. The release is the half
  that gets forgotten, and the symptom is a trainer who looks busy on dates nobody booked.

### Note

- Tier floor prices are absolute figures set by commercial policy, not margins calculated from cost.
  The two differ by about seven hundred ringgit on the contract's own worked example, and the
  difference would appear as a discrepancy between the approval screen and the quote.

## 2026-09-12 — the sales path, and a tenant boundary the storage engine enforces

### Added

- **Organisations, contacts, enquiries, opportunities, follow-ups and the needs analysis (005).**
  Fourteen tables covering the path from an inbound message to a qualified opportunity.
- **Consent is a ledger, not a switch.** Personal-data law asks what someone agreed to on a date,
  not what they agree to now, so withdrawal adds a record rather than editing one, and the original
  agreement cannot be rewritten afterwards.

### Security

- **A record cannot be attached to another customer's record, at all.** Every foreign key carries
  the tenant alongside it, so a contact in one customer's account physically cannot point at an
  organisation in another's. The database rejects it before any access rule is consulted. Access
  rules can be misconfigured in a migration nobody reviews; this cannot.

### Note

- Two columns on organisations cache the proposal count for the record header and are marked in the
  schema as unusable by the approval gate, which computes that answer live. A cached value that
  looks authoritative is exactly what a later author would trust.

## 2026-09-12 — one procedure gives every table the same posture

### Added

- **A single table finaliser (004).** Composite tenant-safe keys, the tenant index, the timestamp
  trigger, frozen identity columns, reference allocation, and row-level security enabled *and
  forced* with no policy at all. Eighty tables will go through it. Written out per table it would be
  six hundred lines of copy-paste in which exactly one table ends up missing the "forced" flag, and
  nothing notices until that table is the one that leaks.
- **Human references allocate per tenant.** Two customers creating their first template both get
  `TPL-0001`. A shared counter would let each customer read every other customer's record volume
  straight off a reference, and no access-control test would ever catch it because no row is
  exposed. The year in a dated reference comes from the tenant's own timezone, so a record created
  at eight in the morning in Kuala Lumpur on 1 January is a January record.
- **Stage names and their order are configuration.** The contract shows two different lifecycles for
  the same object, six steps in one place and nine in another. Those are two configuration rows, not
  two hardcoded lists in two components.

### Security

- **No table is ever open, not even briefly.** Row-level security is switched on and forced at the
  moment a table is created, with zero policies, so the default is deny-all and the policies added
  later can only widen it. The alternative — create now, secure in a later migration — leaves a
  window that is only closed if that later migration remembers every table.

## 2026-09-12 — the status vocabulary, generated from the contract instead of copied

### Added

- **Sixty-nine enum types, generated from the TypeScript contract package (003).** Every closed
  status catalogue the API contract freezes now exists in the database, emitted by reading
  `packages/contract/src/enums.ts` rather than by transcribing it. The database and the contract are
  the same list by construction, not by review, and each type records in a comment which constant it
  came from. A misspelt enum label is valid SQL: it creates cleanly, matches nothing, and surfaces
  weeks later as a row that will not insert.
- **Order is pinned, not just membership.** Postgres compares and sorts enums by declaration order,
  so a type recreated alphabetically would pass every membership test and quietly sort breaching
  approvals to the bottom of the queue. The test demonstrates the two orderings that carry meaning.

### Note

- Open, configuration-driven sets are deliberately absent: action types, lifecycle step keys,
  compliance check keys, document types, metric keys and tier keys arrive as reference tables, not
  as types. Stage names and their order render from configuration, and a check constraint is code
  while a table is data an administrator can edit.

## 2026-09-12 — multi-tenancy: the tenant registry, 109 permissions as data, and the escalation stop

### Added

- **Tenancy exists from row zero (002).** Five identity tables, every one with row-level security
  enabled *and forced*. Forcing is the part usually skipped and the part that matters: it removes
  the table owner's exemption, so a database function running as the owner no longer silently sees
  every tenant's data.
- **The role-to-permission matrix is data, not code.** 399 grants over 109 permissions, so a
  managing director can move `discount:approve` between roles without a migration. It is seeded by
  parsing the architecture doc's own table rather than transcribing it — a 74-row by 7-column grid
  copied by hand is a typo generator, and a missing tick is a silent authorisation hole that no test
  for a different permission would catch.
- **One body builds the login claims.** The access-token hook and the agent-token minter both call
  `app.principal_claims()`, because the hook does not run for a self-minted agent token and two
  copies of that logic would drift apart exactly when it mattered.

### Security

- **An administrator cannot edit their own membership row.** This is the escalation that would end
  the product: write yourself any role, any data scope, any tenant. The ordinary admin-write policy
  permits it, because you *are* an admin of that tenant while you do it. A restrictive policy is
  what stops it, and restrictive is deliberate — a permissive policy of the same name reads
  identically in a diff and does the opposite. Bootstrapping a tenant's first administrator is
  therefore a provisioning act, which is what it always should have been.
- **Multi-factor authentication is enforced in the database, not in a route guard.** An admin
  membership write at `aal1` is refused by the policy itself.
- **`anon` is refused before a policy is ever consulted.** It holds no table grant at all, so the
  denial happens at the grant layer. The test asserts that specifically rather than accepting an
  empty result — a future grant to `anon` would still return zero rows under RLS and would look
  identical to a test that only counted.

### Fixed

- **Three defects in the architecture docs' own SQL, found by executing it.** The owner-scope helper
  did not compile: `= ANY ((SELECT …))` is the subquery form of `ANY` and the function returns an
  array, so Postgres rejected it. The corrected cast also preserves the performance property the doc
  was after — the lookup now runs once per statement rather than once per row, confirmed in the
  query plan. The doc's permission count was stale (94 claimed, 109 actual in both its own
  catalogue and its own matrix). And this migration's rollback crashed on a second run, because a
  Postgres `::regclass` cast raises on a missing table instead of returning nothing; it is now safe
  to re-run and says so.

## 2026-09-12 — the repo floor: one workspace, one token file, and gates that can say no

### Added

- **An npm workspaces monorepo.** `apps/web` is the console and depends on
  `@trainos/contract` by name, so the shared type surface reaches the app as a
  package rather than a relative path. Vite 5, React 18, TypeScript 5.8,
  Tailwind 3, shadcn.
- **The strict-TypeScript ratchet, on day one with an empty allowlist.**
  `tsconfig.strict.json` turns the full strict family on for the files listed in
  its `include`, and CI enforces it. Files graduate one at a time. This is
  cheap now and a project later.
- **One token file.** `apps/web/src/styles/tokens.css` carries every light token
  from the design pack and the complete light-to-dark map, stored as RGB
  triplets so Tailwind composes them with an alpha modifier. Dark is a straight
  token swap: no component, layout or geometry changes between themes. Six dark
  chip values are marked DERIVED because the pack gives only the text colour for
  warning and danger.
- **The app shell, with navigation generated rather than restated.** The design
  pack's TREE and ROLE map are transcribed verbatim; every route path is derived
  from them by one rule, and the route table is generated from the same tree, so
  there is no second list of paths that can drift.
- **The typed data boundary.** One `TrainOsClient` interface grouped by contract
  section, 41 methods, every one returning a `{ data, error }` tuple typed from
  `@trainos/contract`. Domain refusals and transport failures are different
  types, so a `FORBIDDEN` is never retried and never rendered as "something went
  wrong". The fixture client declares every method and refuses each one by name,
  so an unbuilt screen fails loudly instead of looking empty.
- **A shared empty/loading/error kit**, built before the second screen needed
  one, with every sentence taken as a prop.
- **Two git-hook tiers and a 17-job CI pipeline.** The baseline tier always
  blocks; the advisory tier is pausable and can never silence the baseline or
  the safety guard. The summary job fails on `failure`, `cancelled` **and
  `skipped`** — an install failure marks every blocking job skipped, and a gate
  that ignores that passes a run which executed nothing.
- **Three Supabase-coupled checks**, written from the documented patterns: SQL
  parse over every migration, rollback and test through the real Postgres
  grammar; static grant hygiene with per-function revocation tracking; and a
  contract-drift check on the envelope seam. All three run clean against the
  migrations landed so far.

### Changed

- **The dev server binds 5180, not the house default 8080.** A sibling app owns
  8080 on at least one developer machine, which also made the bundle-budget
  dev-server probe refuse to build. Recorded as D-101 in `ai/state.md`.
- **The kit's three supplementary tokens were folded into `tokens.css`.** They
  had been parked in a second file because the scaffold owned the first. Two
  token files is exactly the divergence the design principles call a defect.
  Recorded as D-100.

### Note

The `arch:graph` script from the house reference could not have worked as
written: `dependency-cruiser` 16 renamed `--validate` to `--config`, and running
it from the repo root made TypeScript resolve the app tsconfig's `include`
against a directory that does not exist. Both surfaced only because the command
was run rather than assumed good.

## 2026-09-12 — the database floor: three schemas, five shared helpers, and two baseline lines that do not work

### Added

- **The foundation migration (001).** Schemas `app` (helpers and the action gate, not reachable
  from the API), `core` (the domain, reachable) and `extensions`; four extensions, each with the
  downstream consumer that needs it named rather than installed speculatively; and five shared
  helpers. The rounding rule from DECISIONS §7 now has exactly one definition in the database
  (`app.round_half_up_minor`) instead of being a sentence every money migration re-implements.
- **The RPC envelope is a function, not a convention.** `app.ok()` and `app.err()` build the
  `{success, data}` / `{success, error}` shapes rather than asking each author to reproduce them.
  A top-level sibling key is the failure that silently flips every client from auto-unwrap to
  pass-through; it is now something a later author cannot add by accident, only by deleting the
  call.
- **One immutability trigger instead of N.** `app.enforce_immutable_columns` takes the frozen
  column names as trigger arguments, so `ref`, a sent proposal's body and an applied quotation all
  freeze through the same implementation. It refuses erasure as well as change, and it raises
  loudly when attached to a column that does not exist — the quiet version of that bug would leave
  `ref` writable across the whole model with every migration still looking correct.

### Changed

- **The domain lives in schema `core`, not `public`.** `docs/architecture/03` names it and uses it
  throughout its own executable SQL; `docs/architecture/02` writes the same tables as `public.*`.
  03 outranks 02, so the domain is `core` and doc 02's policy catalogue is re-targeted onto it.
  `core` is added to PostgREST's exposed schemas in `supabase/config.toml`; without that the entire
  domain is invisible to the API and nothing says why.

### Security

- **Two lines of the documented schema baseline do not do what they say, and are no longer relied
  on.** `alter default privileges … revoke all on tables from public` is vacuous, because Postgres
  grants PUBLIC no default table privilege to revoke. The functions equivalent is not vacuous and
  still fails: measured on PostgreSQL 17.11 it records no row in `pg_default_acl`, and a function
  created afterwards remains executable by PUBLIC and by `anon`. The same statement in GRANT form
  records correctly. Both lines are kept as the documented baseline and are explicitly not the
  guard: every migration revokes EXECUTE per function at creation, and the pin sweeps every
  function in `app`, `core` and `public` for a PUBLIC or `anon` grant outside the portal allowlist.
  Found by a pin assertion that failed, not by review.
