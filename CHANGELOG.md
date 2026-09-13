# Changelog

Tracks notable changes across migrations, RPC contracts, frontend types, and project
documentation. Append new entries at the top with the date in ISO-8601 format.

> An entry that reflects a real architectural decision cites the doc that carries the
> reasoning — `docs/architecture/NN`, or a decision id where one exists. The point is to make a
> shipped behaviour traceable to the reasoning behind it without archaeology. **Forward-only:
> older entries are not backfilled**; link them if you happen to touch them.

Where the catalog (`supabase/migrations/migration-catalog.md`) is the engineering and security
record of a migration, an entry here is the human-facing summary of the same event.


## 2026-09-13 — every button in the product now goes through one door

Authored and executed against a scratch database. Applied nowhere. Engineering detail is in
`supabase/migrations/migration-catalog.md`.

### Added

- **The action envelope.** Every primary button and every agent proposal now passes through a
  single evaluated path that decides one of three outcomes: it happened, it needs an approval,
  or it is a suggestion for a human to accept. What made the decision is recorded with the
  action, so "why did this need my approval" has an answer that is not somebody's memory.
  Reasoning: `docs/architecture/03`.
- **Approvals, with the self-approval rule enforced rather than assumed.** Somebody cannot
  approve their own request, and — the part that had been getting through — a request with no
  named requester cannot be approved either. An unnamed requester used to read as "not you".
- **Actions that move money require a second factor**, checked against the session the login
  service actually wrote rather than against a claim the caller hands us.
- **Stage changes are now legal or refused, per record type.** An invoice cannot be marked SENT
  by writing SENT into it; it gets there by being pushed, and the push is an action somebody is
  accountable for. The same holds for enquiries, quotations, proposals, engagements, attendance
  days, trainer bookings, compliance rules and claim packets. Which moves are legal is
  configuration, not code: `docs/architecture/01` §5.
- **An agent cannot raise its own autonomy.** This is the one access rule that ships ahead of
  the rest, because the gap it closes is an agent promoting itself while nothing is watching.

### Fixed

- **A payment reversal can put the money back.** The legal-transition set described only the
  forward direction, so reversing a payment would have been refused outright and the invoice
  would have stayed looking paid. Three edges added, flagged for the domain owner to ratify.
- **An approval escalation is no longer scheduled after its own expiry.** One rule in the
  catalogue escalated at 48 hours and expired at 24, so the escalation would have arrived a day
  after there was anything left to escalate.

### Known issue

- **A programme's "times run" count returns to zero when its engagements are closed out.** The
  count is decremented whenever an engagement stops being DELIVERED, and closing out is the
  normal end of every engagement. Pinned in `test_008` so the fix cannot land unnoticed; the fix
  belongs to the delivery migration and is not made here.

## 2026-09-13 — billing, and the tax document that finally has somewhere to put its own identity

Authored and executed against a scratch database. Applied nowhere. Engineering detail is in
`supabase/migrations/migration-catalog.md`.

### Added

- **Invoicing end to end**: invoices and their lines, payments, credit notes, receivables aging
  and the collections ladder. An invoice total is now derived from its lines rather than supplied
  alongside them, so a header that disagrees with what it is made of cannot be saved at all.
- **Service tax is calculated once on the whole invoice, not line by line.** On a three-line
  invoice at 8% the two methods differ by one sen, and the one-sen version is the one that ends up
  in a dispute.
- **A payment can never be edited or deleted.** A correction is a reversal entry that names what
  it reverses and why, so the original and the correction are both visible. The alternative quietly
  rewrites history and leaves the bank reconciliation unexplainable.
- **Credit notes.** Until now a validated invoice was frozen with no way out of a mistake except
  editing a filed tax document. A credit note is the legal exit, and it cannot be written for more
  than the invoice it credits.
- **Everything a Malaysian e-invoice needs to be mirrored back.** The document reference and the
  batch reference are now separate fields rather than one, the QR token has somewhere to live, the
  status can express "submitted, awaiting validation" instead of guessing, and a rejection arrives
  as a list of fields rather than a sentence. The company's own tax registration details and the
  customer's now exist as data; previously there was nowhere to put either.
- **The 72-hour cancellation window is enforced by the database.** Inside it, a cancellation with
  a stated reason is accepted. Outside it, the cancellation is refused and the route is a credit
  note. The deadline cannot be pushed back by writing a later date into it.
- **Receivables buckets and the reminder ladder are settings, not code.** A finance lead moves the
  second reminder from 30 days to 21 without a release. Two things stay fixed because the business
  decided they are fixed: the third reminder is always sent by a person, and a trading hold always
  needs the managing director.

### Fixed

- **Overlapping receivables buckets are now impossible.** Two buckets covering the same range
  would count the same invoice twice, and the resulting total is wrong in the direction nobody
  questions.

## 2026-09-13 — the database can now schedule, send and remember, and one rule that would have locked everybody out

Nothing in this release is applied to any hosted database. These are amendments to migrations
001–009, which are authored and executed against a scratch PostgreSQL 17.11 cluster and applied
nowhere. Engineering detail is in `supabase/migrations/migration-catalog.md`; the reasoning is in
`docs/architecture/01`–`05`.

### Added

- **The scheduler, outbound HTTP, and semantic search now exist.** Nine behaviours the design
  depends on happening on a schedule — clearing out old records, retrying failed sends, warning
  when a training grant balance has gone stale — had nothing to run them. Sixteen places that send
  a request to an external service had no way to send one. The knowledge corpus had no way to
  store what it had learned. Three database extensions close all three gaps at the floor of the
  schema, where every later migration can rely on them, rather than each one assuming.
- **Every compliance rule vocabulary now records where it came from.** Thirteen categories of rule
  grammar carried no note saying whether they were generated from the shared contract or written by
  hand. Seven of them were written by hand, which is legitimate and is now stated. "Where did this
  list of values come from" is the first question anyone asks when one of them looks wrong.

### Fixed

- **The permission system would have denied everything to everyone.** A security rule requiring
  every table to enforce its access policy even against the database's own owner is correct, and
  applying it to the table that stores who may do what would have made every permission check
  answer "no" — silently, with no error, on the first day. Measured on a database configured the
  way the hosted one is, not reasoned about. The tables that back permissions and the action
  catalogue now carry an explicit internal-read rule, and no customer-facing account can reach
  either of them.
- **A table holding part of the data model was reachable from a browser.** It held no customer
  data — it is a list of nine table names — but it sat in the schema the API exposes with no access
  rule at all. It now has one, and it is the last such table in the set.
- **The sign-in step that stamps a user's company onto their session was running as the wrong
  identity.** It worked, but only by accident: the permissions and access rules written for it were
  never being consulted. It now genuinely runs as the sign-in service, which is what makes those
  rules real. Correcting it immediately revealed a missing permission that the accident had been
  hiding.
- **The only check on what an automated action is allowed to submit could be switched off by a
  typo.** A single misspelled key in configuration made the check silently accept everything, while
  the configuration still looked complete. A misspelling is now rejected when it is saved.
- **The knowledge corpus quietly shipped without the column it exists for.** Where the extension
  that stores machine-readable meaning was unavailable, the migration skipped the column, logged a
  note and carried on — so the database built successfully and then failed later, far from the
  cause. It is no longer optional.
- **Three checks in the test suite had only ever been run at the moment that flattered them.**
  Run against the complete database rather than immediately after their own step, they failed. All
  three failures were real: two were defects in the checks, one was the missing access rule above.
  Every check now runs against the whole set.

## 2026-09-12 — twenty-seven screens, and a rule that is checkable rather than read

### Added

- **Every screen the design pack names, across fourteen modules.** The dashboard, the approval
  inbox and detail, the enquiry inbox and detail, the follow-up queue, the organisation record,
  the needs-analysis detail, the programme catalogue and record, the proposal builder and pricing
  worksheet, the client portal, the engagement record, the attendance sheet, the HRD Corp claim
  packet, the rules registry and rule-change review, the invoice detail and the collections queue.
- **The one-solid-primary-button rule is now something a test can fail.** Buttons register
  themselves, so the claim is checked rather than confirmed by reading the markup. Two screens
  deliberately have no primary at all, and the tests assert that too.
- **Every primary action renders the answer it got back, never the answer it expected.** An action
  the policy gate queues for approval is a success, and is shown as one. Rendering it as a failure
  is how an approval queue becomes invisible and how people learn to read a policy decision as a
  bug.
- **A trail of where you are, in one place.** A screen declares its path and the top bar renders
  it; no screen draws its own. A route that declares nothing shows nothing, rather than inheriting
  the last screen's path and being confidently wrong about where the reader is.
- **The notification bell counts all three things that need a person**, not just approvals — a bell
  that only watched approvals would go quiet while a training grant claim window ran out.

### Fixed

- **Six things only a rendered page shows**, found by opening the app rather than by running the
  tests. Two names for one fact on the same screen; training grant scheme codes rendered as
  sentence case rather than as the proper nouns they are; dates shown in raw machine form in a
  table a person reads; and a margin gauge drawing its floor marker in the middle of the track
  while the floor was elsewhere. A gauge that misplaces the limit it exists to show is worse than
  no gauge.
- **A messaging rate shown to four decimal places that was wrong in the second one.** The figure
  was derived from a rounded value, so RM 0.0564 rendered as RM 0.0600 — a wrong number shown
  precisely, which is the most convincing way to be wrong. The same panel also only showed its
  comparison when the alternative was cheaper, so the case the artboard actually draws rendered
  nothing at all.

### Note

- These screens have only ever been seen against sample data. Every figure, refusal and empty state
  on them comes from the in-memory fixtures package; nothing has yet been rendered against a real
  API response.

## 2026-09-12 — one component library, and the only place a status colour lives

### Added

- **The component kit: every pattern the design pack names, built once.** Record headers, metric
  strips, lifecycle steppers, the data table, filter bars, pill tabs, status and AI chips, approval
  banners, proposed-action cards, agent-run cards, drawers, dialogs, the command palette, and the
  empty, loading and error states.
- **A gallery at `/dev/kit` that is the library's contract with the people building screens.** Every
  component and every variant, rendered twice — once light, once dark — inside the real application
  shell. A pattern that is not on that page is not in the kit, and inventing it on a screen is the
  divergence this library exists to prevent.
- **Status colour is confined to chips, and the confinement is checkable.** A status fill anywhere
  in the screens tree means somebody skipped the chip.
- **A confirmation dialog opens with Cancel focused, not the destructive button.** A stray Enter on
  a dialog that opens the other way is a deleted record.
- **Money is never a floating-point number anywhere in the interface.** One component owns both
  directions of the conversion, so no screen multiplies by a hundred and no rounding error reaches
  a quotation. A training date is read as a calendar date and never as an instant, which is what
  stops a Kuala Lumpur course rendering a day early.

### Changed

- **No progress bar is ever green.** Amber and red appear only as a limit nears. A completeness bar
  at 100% is not an achievement, it is a blocker that stopped blocking.
- **A bar takes its colour from what the server said, never from its own ratio.** 87% of a cap the
  server has flagged is amber; 87% of one it has not is still neutral. Deciding that in the
  interface would make a display component decide policy.

### Fixed

- **The claim in one file's documentation was stated more strongly than it was true**, and a reader
  running the grep it offered would have found thirteen counter-examples. Every one was legitimate;
  the rule was rewritten to describe what it actually protects. A rule stated too strongly is worse
  than no rule, because the first person to disprove it stops believing the rest of the file.

## 2026-09-12 — sample data that tells the whole story, including the awkward parts

### Added

- **An in-memory client implementing the whole published interface**, so every screen could be
  built, tested and demonstrated before a single line of the real backend existed.
- **The sample data covers the states that are easy to leave out**: the low-confidence
  classification a person has to look at, the message that turned out not to be an enquiry, the
  recommendation that honestly does not fit, the locked attendance day, the claim missing two
  documents, the superseded compliance rule, the escalated receivable, the failed automated run,
  and the provider key that has expired.
- **The policy gate in the sample data enforces rather than pretends.** Permissions are refused,
  not merely reported; the value a rule is measured against is read from the stored record and
  never from the request, so an agent understating a proposal is still measured against the real
  figure; and re-proposing the same thing returns the approval already waiting rather than creating
  a second one.

### Note

- Five places where the published interface's own worked examples contradict themselves, and twelve
  gaps where it cannot express something the design requires, were reported rather than quietly
  patched. Both lists ship with the package.

## 2026-09-12 — an agent that stops when the rules say stop

### Added

- **The automation runtime**: an orchestrator that plans, four bounded sub-agents that each hold one
  set of tools, a jury that reviews, and a run that ends by submitting to the same policy gate a
  person's action goes through.
- **Being stopped is a successful outcome, not a failure.** The demo run reaches the approval gate
  and halts there, and the record of the run is what proves nothing was sent.
- **Bring your own key.** One interface for every model provider, keys held only in an injected
  store, never logged and never written down, and a mock provider so the whole system runs with no
  key at all.
- **A run survives being killed.** Cloud functions are stopped at a fixed wall clock, so a long run
  writes a checkpoint and continues in the next one, keeping its identity, its numbering and its
  total duration across every slice.

### Fixed

- **Two ways a run could have appeared healthy while making no progress at all**, both found by
  building the resumption rather than by reasoning about it. A budget counted across the whole run
  can never be satisfied by starting again, so a resumed run began over its limit and yielded
  forever; and a stage that restarted from its beginning never finished if it needed more work than
  one slice allows. Both would have looked like a busy queue.
- **A dissenting reviewer is recorded rather than overruled**, and an unreadable verdict counts as
  dissent. A review that fails open stops working the day a model changes its formatting.

## 2026-09-12 — the design pack, copied rather than adapted

### Added

- **Thirty artboards, the written records and eighteen screenshots**, copied into the repository
  exactly as drawn. These files are the record of what was designed and the thing every screen is
  checked against; editing one to record a later decision silently rewrites the reference.
- **A provenance note saying where each piece of the pack now lives in the application**, and
  pointing at the two sections a builder has to read before trusting a number: what the inventory
  could not verify, and the three corrections to values the artboards still draw.

## 2026-09-12 — five design documents, and a review that disagreed with them

### Added

- **The domain model, the tenancy and access design, the action envelope and policy gate, the money
  and versioning model, and the events and audit backbone.** Eighty-nine tables, the complete
  entity diagram, and the rules each of them enforces.
- **A two-part critical review of all five**, kept as written rather than tidied after the fixes, so
  the record shows what was wrong and when — including the parts still open.
- **A spike on how an automated agent should authenticate**, which changed the answer: an agent
  signs in like any other principal and never issues its own credential, because the alternative
  uses one project-wide signing key that could be used to void every access rule in the system.

### Changed

- **Where the reasoning moved, the documents say so.** The five were written in parallel and
  reconciled against each other afterwards, and several conclusions reversed in the process. Each
  reversal is recorded with the argument that won rather than silently applied.

### Note

- Two constants that cross a boundary between two of these documents each moved four times in
  conversation before being pinned as a table duplicated verbatim on both sides. Prose reads
  plausibly whichever way round it is written, which is how they kept drifting.

## 2026-09-12 — one published interface, shared by the database and the application

### Added

- **A typed package derived from the API contract**, used by both the application and the database
  work, so the two cannot drift apart silently. The database's own type vocabulary is generated
  from it, which means a change there is a change to the schema.
- **One word for one operation.** An approval screen must be able to show that what was approved is
  exactly what will happen, and two vocabularies for the same operation make that impossible to
  check, so the two were merged into one.
- **A trading hold is its own action, and needs the managing director.** It had previously been
  modelled as a variant of sending a reminder, which made the most consequential step of the
  collections ladder look like a message.

## 2026-09-12 — nine research documents, and the skill they became

### Added

- **Research covering the stack, the commit and CI gates, the guardrails, the database conventions,
  the documentation system, the application architecture, the agent tooling, agentic database
  practice and the design pack**, each written from two live reference projects rather than from
  first principles.
- **A reusable setup skill synthesised from all nine**, carrying the literal configurations,
  scripts and templates, and parameterised so it stands up a second project without edits.

## 2026-09-12 — compliance rules that remember what we knew, and when

### Added

- **The training-grant rule registry, claim packets and the knowledge corpus (009).**
- **Rules carry two dates, not one: when a rule is in force, and when we learned about it.** A
  circular published in November can change a rule that takes effect the following January. A claim
  assessed in October was assessed correctly against what the registry said in October, and
  re-running that check later must still say so. With a single date, re-checking an old engagement
  silently re-decides it against today's rules and the audit trail calls the original decision a
  mistake.
- **"Which rule applied" has exactly one answer.** The database refuses two rules that could both
  apply to the same situation, so a compliance check cannot depend on which record happened to be
  read first.
- **Rules are national, with local overrides.** One shared set for the whole platform, because a
  corrected circular has to reach everyone, plus optional stricter rules per customer that apply
  only to them. No customer's administrator can change compliance for anyone else.
- **A rule cannot become active without a named person verifying it against the circular.** Rules
  extracted by a model load as proposals. This is the point at which an extraction would otherwise
  quietly become policy.

### Note

- One column could not be created in the authoring environment: the vector embedding on knowledge
  chunks needs an extension that was not available. It is created automatically where the extension
  exists, and the migration says loudly when it is skipped.

## 2026-09-12 — delivery, and attendance that genuinely cannot be edited

### Added

- **Engagements, sessions, participants, attendance, certificates and evaluations (008).**
- **Approved attendance is immutable, including the individual marks.** The lock covers the day and
  every attendance row on it. Protecting only the day would leave every tick editable while the
  screen showed a locked sheet, and that is what the training grant claim rests on.
- **Unlocking states a reason and counts itself.** It clears the approval, reopens capture, and
  increments a counter the caller cannot set, so the person who unlocks cannot also erase the record
  that they did. A day that was unlocked once is not the same as a day that was never locked.
- **Capture is switched off by the lock, not by the interface.** All three capture modes become false
  on the record itself, so the response cannot contradict the rule and the front end has nothing to
  get wrong.

### Security

- **Participants' identity numbers are never stored.** A hash and the last four digits are enough to
  match a person against the employer's own record and to display the masked form. A copy of the
  database no longer exposes a national identity number for thirty people per course.
- **A sent message records which consent it relied on.** Not as a claim made afterwards, but as a
  link to the consent record itself.

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
## 2026-09-12 — the catalogue, and a trainer who cannot be in two places

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
