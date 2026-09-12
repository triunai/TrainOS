# 08 — Supabase Best Practices for an Agentic, Multi-Tenant, Policy-Gated Platform

Research date: 2026-09-12. Scope: current (as of September 2026) Supabase/Postgres best
practices relevant to TrainOS's architecture — multi-role RLS, a non-human `AGENT` actor,
a single policy-gated action envelope (`POST /actions`), an event catalogue with an outbox,
integer-sen money, provenance envelopes on AI-touched fields, BYOK LLM keys, and a
migrations/testing workflow. Non-goals: no frontend UI advice, code kept to short SQL/TS
snippets only.

Every claim below is either sourced (cited inline) or explicitly flagged as this
document's own reasoned recommendation where Supabase has no first-party guidance. Several
sub-agents researched this in parallel; where their findings conflicted with each other or
with the local `supabase-postgres-best-practices` skill, that's called out rather than
silently resolved.

---

## 1. Multi-tenant RLS

**Recommendation:** one shared schema, a `tenant_id` column on every tenant-scoped table,
RLS policies for isolation, and tenant/role injected into the JWT via the **Custom Access
Token Hook** rather than a per-request profile-table lookup.

- **`tenant_id` column vs. schema-per-tenant.** Supabase does not officially compare these
  two architectures — RLS as a feature, and every example in the RLS docs, assumes a
  shared-table-with-tenant-column model. Schema-per-tenant is a valid general Postgres
  pattern but isn't Supabase-documented and adds migration/tooling overhead (CLI migrations
  need to run per schema, PostgREST schema exposure, connection pooling) that scales poorly
  past a modest tenant count. **Our recommendation (not official Supabase guidance):**
  shared tables + `tenant_id` + RLS for TrainOS; reserve schema-per-tenant only for a
  handful of enterprise tenants with hard data-residency requirements, if that ever arises.
- **Custom Access Token Hook vs. profile-table lookup.** The
  [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook.md)
  runs once at token issuance and writes `tenant_id`/`role` into the JWT, so policies read
  them via `auth.jwt()` with zero extra DB round-trips per request. A profile-table lookup
  inside RLS (`EXISTS (SELECT 1 FROM profiles WHERE ...)`) re-queries per statement instead.
  The [Custom Claims & RBAC guide](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac.md)
  documents the canonical shape: the hook queries a `user_roles`/`role_permissions` table,
  adds a `user_role` claim, and an `authorize()` SQL helper checks it inside policies.
  Caveat confirmed in the docs: claims only refresh when the token refreshes, so a role/tenant
  change can be briefly stale — force `refreshSession()` after any privilege change that must
  take effect immediately (e.g. after an MD promotes someone to ADMIN).
- **Performance patterns** (all confirmed in
  [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security.md)
  and [RLS Performance](https://supabase.com/docs/guides/database/postgres/row-level-security-performance.md)):
  - Wrap `auth.uid()`/`auth.jwt()` (and any helper function) in `(select ...)` inside policy
    expressions — this produces a cached Postgres `initPlan` instead of a per-row
    re-evaluation; the docs' own benchmarks show ~95–99.99% latency reduction.
  - Index every column used in a policy filter, including `tenant_id`. A composite PK like
    `(tenant_id, id)` does not give you a standalone index on `tenant_id` alone unless it's
    the leading key — add an explicit index if policies filter on `tenant_id` without `id`.
  - Use `SECURITY DEFINER` helper functions (`set search_path = ''`, schema-qualified names,
    kept in a **non-exposed schema**) to break recursive/cross-table RLS lookups cheaply —
    e.g. `private.user_tenant_ids()`. Never add `SECURITY DEFINER` just to make a permission
    error go away; it silently removes access control.
  - Avoid joins inside policy expressions; rewrite `auth.uid() IN (SELECT ... JOIN ...)` as a
    flat `tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = (select auth.uid()))`.
  - Always specify `TO authenticated` (or the specific role) on every policy — Postgres skips
    policy evaluation entirely for non-matching roles.
  - `service_role` (now issued as an opaque `sb_secret_...` key, see §13) maps to the
    Postgres `service_role`, which has `BYPASSRLS`. If a request carries both a user access
    token and a secret key, RLS still applies under the user's session — the secret key
    alone doesn't silently escalate an already-authenticated request.

---

## 2. Non-human service principals (the `AGENT` actor)

**This is not covered by official Supabase documentation** — there is no first-class
"service account" or "machine user" concept in Supabase Auth, and a relevant Supabase
GitHub discussion ([supabase/discussions#4419](https://github.com/orgs/supabase/discussions/4419))
shows Supabase's own team has no canonical answer either. What follows is sourced pieces
plus this document's own synthesis, clearly labeled.

- **Official primitives available:**
  - **Secret API keys** (`sb_secret_...`, replacing `service_role`) grant full RLS bypass.
    Docs explicitly recommend minting a separate secret key per backend component ("if one
    leaks, you only rotate that one") — a reasonable basis for "one secret key per agent
    class," though it's still full bypass, not per-agent row-level scoping. See
    [API keys](https://supabase.com/docs/guides/getting-started/api-keys.md) and
    [Migrating to new API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys.md).
  - **pgaudit** is officially documented and can be scoped per Postgres role
    (`ALTER ROLE "some_role" SET pgaudit.log = 'write'`) — Supabase's own example audits
    everything a role like `zapier` does. See
    [pgaudit](https://supabase.com/docs/guides/database/extensions/pgaudit.md).
  - Nothing stops creating a real `auth.users` row per agent with custom `app_metadata`, but
    this is inferred from general Auth Hook mechanics, not a documented machine-identity
    pattern.

- **Our recommendation (not official Supabase guidance):** model each `AGENT` as a row in a
  dedicated `agents` table (tenant-scoped, one row per agent instance/config), not an
  `auth.users` row. Issue each agent a revocable API key (store only a hash, never the raw
  key), validated inside a Postgres function or Edge Function before any write. On
  validation, mint a short-lived custom JWT carrying `role: AGENT`, `tenant_id`, and
  `agent_id` claims (via `supabase.auth.admin`, or self-signed using the new asymmetric
  signing key if minting outside Supabase Auth — see §13), so `AGENT` gets **the same RLS
  treatment as any human role** — policies key off `agent_id`/`tenant_id` claims identically.
  Benefits: clean revocation (disable the agent row, its key stops validating), and a
  built-in accountability trail. Every mutation table should carry `actor_type`
  (`human`/`agent`), `actor_id`, and `triggered_by_run_id` columns; layer `pgaudit` under
  that for defense-in-depth at the Postgres level. **Avoid** using one shared secret key for
  all agents — that's full RLS bypass with no per-agent revocation or accountability.

---

## 3. Implementing the policy gate / action envelope

**Recommendation: hybrid.** An Edge Function does orchestration and any network-bound work
(LLM calls, external confidence scoring); one Postgres RPC function does the atomic
rule-evaluation-plus-write.

- **Postgres function (RPC) alone.** PostgREST wraps each RPC call in its own transaction,
  so rule evaluation and the resulting writes (decision row, audit row, idempotency-key row)
  are atomic by construction — the strongest guarantee available in the stack. Limitation:
  `plpgsql` cannot make synchronous outbound network calls — `pg_net` is async/fire-and-forget
  and unsuitable for "call an LLM and use its answer inside this same transaction." See
  [Database Functions](https://supabase.com/docs/guides/database/functions.md).
- **Edge Function alone.** Good for orchestrating external calls; the
  [Edge Functions guide](https://supabase.com/docs/guides/functions.md) positions it
  explicitly for "orchestrating calls to external LLM APIs." But supabase-js from an Edge
  Function talks to Postgres over PostgREST/HTTP by default — each `.from()`/`.rpc()` call is
  its own transaction, so atomicity across several inserts doesn't span calls unless you
  either open a raw Postgres connection and issue `BEGIN`/`COMMIT` yourself, or push the
  atomic part into one RPC. (Corroborating, non-official:
  [Transactions and RLS in Supabase Edge Functions](https://marmelab.com/blog/2025/12/08/supabase-edge-function-transaction-rls.html).)
- **Hybrid (recommended shape for `POST /actions`):**
  1. Edge Function receives the request, does a fast idempotency-key pre-check, calls out to
     the LLM/confidence-scoring service and any other external context.
  2. Edge Function then calls **one** Postgres RPC — `plpgsql`, `SECURITY DEFINER`, `search_path = ''`,
     schema-qualified, kept in a **non-exposed schema** (per the RLS docs' caution against
     exposing `SECURITY DEFINER` functions to untrusted clients) — that atomically: evaluates
     autonomy level / monetary threshold / approver-role rules against the already-fetched
     inputs, decides `EXECUTED` / `QUEUED_FOR_APPROVAL` / `SUGGESTED`, writes the domain
     row(s), writes the audit/decision record, and upserts the idempotency-key row, all in
     one transaction.
  3. The function returns a structured `jsonb` (or composite) payload —
     `{status, action_id, decision_row, approver_role, reason}` — so a `QUEUED_FOR_APPROVAL`
     decision and its pending-approval row are always consistent (no window where a decision
     is returned but the row failed to write).
  4. The Edge Function calls this RPC via the `service_role`/secret key, not as
     `anon`/`authenticated` — the envelope is a privileged write path.

- **Idempotency-key storage (24h retention).** No canonical Supabase-documented pattern
  exists for this exact use case, but the
  [Resumable WebSockets example](https://supabase.com/docs/guides/functions/examples/resumable-websockets)
  demonstrates the identical shape for a different problem: a dedicated table with a unique
  constraint on the key, `insert ... on conflict do nothing`, and on conflict, look up and
  return the prior stored result instead of re-executing:

  ```sql
  create table action_idempotency_keys (
    idempotency_key uuid primary key,
    action_id bigint not null,
    response jsonb not null,
    created_at timestamptz not null default now()
  );

  insert into action_idempotency_keys (idempotency_key, action_id, response)
  values ($1, v_action_id, v_response)
  on conflict (idempotency_key) do nothing
  returning response;
  -- 0 rows returned => a prior row exists for this key; select and return it instead
  ```

  For the 24h TTL, use `pg_cron` — the
  [Cron Quickstart](https://supabase.com/docs/guides/cron/quickstart.md) shows the identical
  cleanup idiom:

  ```sql
  select cron.schedule(
    'cleanup-idempotency-keys',
    '0 * * * *',
    $$ delete from action_idempotency_keys where created_at < now() - interval '24 hours' $$
  );
  ```

  Note `cron.job_run_details` is not auto-pruned and needs its own cleanup job (see
  [Platform Upgrading guide](https://supabase.com/docs/guides/platform/upgrading.md)).

- **What's genuinely undocumented here:** Supabase publishes no first-party "workflow" or
  "action envelope" reference architecture. The end-to-end hybrid design above is this
  document's synthesis of (a) the documented RPC transaction boundary, (b) the
  `SECURITY DEFINER`/exposed-schema caution, (c) the WebSocket example's idempotency idiom,
  and (d) the `pg_cron` cleanup idiom — not a single page that states this end-to-end. The
  unique-constraint-plus-`ON CONFLICT` idempotency shape itself is a well-established
  general pattern beyond Supabase (see
  [Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys)),
  reinforcing but not confirming Supabase-specific guidance.

---

## 4. Outbox + events

**Recommendation:** `pgmq` as the durable internal outbox, drained by a worker that pushes
to Realtime **Broadcast** (not Postgres Changes) for client-facing events, with Database
Webhooks reserved for non-critical, fire-and-forget external notifications.

- **pgmq — internal reliable outbox.** Built into Postgres, exposed as Supabase Queues (a
  managed wrapper over the `pgmq` extension). `pgmq.read(queue, vt, count)` gives
  at-least-once delivery via a visibility timeout (a crashed consumer's message reappears
  for another worker); `pgmq.pop()` is weaker, effectively at-most-once — avoid it for
  anything you can't afford to lose. Recommended pattern for TrainOS: write the domain event
  (e.g. `invoice.approved`) into a `pgmq` queue **inside the same transaction** as the action
  envelope's write (no dual-write problem), then drain it via a `pg_cron`-triggered worker or
  polling Edge Function that fans events out. See
  [Queues overview](https://supabase.com/docs/guides/queues.md) and
  [pgmq guide](https://supabase.com/docs/guides/queues/pgmq.md).
  - **Doc inconsistency to note:** the Queues overview page's marketing language claims
    "exactly-once," while the `pgmq` extension's own function-level docs describe
    visibility-timeout-based at-least-once semantics via `read()`. Design consumers to be
    idempotent (dedupe by event id) regardless of which framing is authoritative.
- **pg_net — async HTTP primitive, not a queue.** `net.http_post/get/delete` fire
  asynchronously after commit; results land in an **unlogged** table (`net._http_response`,
  lost on crash/restart) with roughly 6h retention and a documented ~200 req/s cap, no
  built-in retry. It underlies both Database Webhooks and `pg_cron`'s HTTP-calling jobs. Use
  it directly only for cheap, non-critical, fire-once notifications. See
  [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net.md).
- **Database Webhooks — simple fire-and-forget to external services.** A dashboard-configured
  trigger-on-write → `pg_net` HTTP call. No documented retry/delivery guarantee. Fine for
  "create a Stripe customer on profile insert"-style eventual consistency; wrong for anything
  needing durable, retriable, 24h-outbox semantics. See
  [Database Webhooks](https://supabase.com/docs/guides/database/webhooks.md).
- **Realtime: Broadcast vs. Postgres Changes.** Supabase's own docs state Postgres Changes
  does one RLS check per subscriber per change and processes changes on a single thread to
  preserve order, so it does **not** scale with subscriber count regardless of compute size —
  Supabase explicitly recommends switching to Broadcast once you expect more than roughly
  3,000 concurrent subscribers on the same change stream, since Broadcast sends each change
  once and fans it out. See
  [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes.md),
  [Realtime Architecture](https://supabase.com/docs/guides/realtime/architecture.md), and
  [Broadcast](https://supabase.com/docs/guides/realtime/broadcast.md). You can trigger
  Broadcast **from the database** via `realtime.broadcast_changes()` in a trigger function
  (or `realtime.send()` for a free-form payload), emitting just the fields the UI needs
  rather than the full row — use this as TrainOS's push mechanism for the event catalogue,
  called from the outbox-consumer path (or directly from a trigger, for zero extra hop).
- **Realtime Authorization.** Private channels require `private: true` client-side plus RLS
  policies on `realtime.messages`; Realtime connects as an admin role and enforces access
  purely through your policies (evaluated against `auth.uid()`, JWT claims, and
  `realtime.topic()`). Name channels by tenant/record (e.g.
  `tenant:{tenant_id}:invoice:{id}`) and scope with a policy such as:

  ```sql
  create policy "tenant members can receive invoice events"
  on realtime.messages for select
  to authenticated
  using (
    exists (
      select 1 from tenant_members
      where user_id = (select auth.uid())
        and tenant_id = split_part((select realtime.topic()), ':', 2)::uuid
    )
    and realtime.messages.extension = 'broadcast'
  );
  ```

  Policies are cached per connection — a permission change needs a reconnect/new JWT to take
  effect. See [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization.md).
- **2025–2026 changelog signal:** Realtime Broadcast gained binary-payload support
  (2026-06-11) and the `realtime` schema was locked against schema modification while RLS on
  `realtime.messages` continues to work (2026-07-14) — consistent with Broadcast/RLS being
  the actively maintained forward path. No 2025–2026 changelog entries were found for pgmq,
  Database Webhooks, or idempotency features specifically; treat those as stable/unchanged.
  See [Changelog](https://supabase.com/changelog.md).

**Layering for TrainOS's event catalogue:** action-envelope RPC writes the domain row and
enqueues the event into `pgmq` in one transaction → a worker drains the queue, calls
`realtime.broadcast_changes()`/`realtime.send()` for client-facing push, and optionally fans
out to internal services via `pg_net`/HTTP with your own retry/dead-letter logic built on
pgmq's re-`send`-on-failure → Database Webhooks stay reserved for simple external
notifications that don't need outbox durability.

---

## 5. Money and numeric types

**Recommendation:** keep the existing bigint-as-sen convention; do not switch to
`numeric` or Postgres's built-in `money` type.

- Postgres's `money` type is not recommended by the wider community — it's
  locale-dependent, rounds silently, and casts poorly (see
  [PostgreSQL Monetary Types](https://www.postgresql.org/docs/current/datatype-money.html)
  and [Crunchy Data: Working with Money in Postgres](https://www.crunchydata.com/blog/working-with-money-in-postgres)).
  Never use `float`/`double precision` — binary floating point cannot represent decimal
  fractions exactly.
- **bigint-as-sen** (8 bytes): integer comparison/aggregation is fast — per
  [Numeric.substack: Money in Postgres](https://numeric.substack.com/p/money-in-postgres),
  aggregating over `numeric` runs roughly 50–60% slower than over integer types, since
  `numeric` is variable-length/arbitrary-precision with per-operation overhead — and it's
  immune to implicit rounding. Trade-off: every value must be divided by the currency's
  minor-unit exponent at the display/API boundary, and that exponent varies by currency (JPY
  has 0, most currencies have 2, BHD has 3) — track it out-of-band in a `currencies` lookup
  table, not in the column type.
- **numeric(p,s)** is self-documenting decimal precision and is what the locally installed
  `supabase-postgres-best-practices` skill reference (`schema-data-types.md`,
  Supabase-maintained) recommends generically ("Money: use numeric, not float — precision
  matters"). That guidance is written for the common single-currency case and doesn't
  anticipate multi-currency systems with varying minor-unit scales, or systems (like
  TrainOS) that already speak in integer minor units to match how payment processors
  represent money over the wire. **This is a case where the generic Postgres advice and
  domain-specific money literature diverge** — the money-specific sources plus TrainOS's
  established convention should win.
- **Currency conversion:** store FX rates as `numeric` (rates are inherently fractional), do
  the conversion at the application or a `numeric`-typed boundary, round to the target
  currency's minor unit, and store only the integer result — never persist an intermediate
  float.
- **Generated columns for totals:** use `GENERATED ALWAYS AS (...) STORED` so a computed
  total is always consistent with its inputs and remains indexable. Restrictions: the
  expression must be immutable (no `now()`), cannot reference another generated column,
  cannot use subqueries, and cannot be a partition key (see
  [Postgres: Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html)).

  ```sql
  create table order_lines (
    id bigint generated always as identity primary key,
    order_id bigint not null references orders(id),
    currency_code text not null references currencies(code),
    qty integer not null,
    unit_price_sen bigint not null,
    line_total_sen bigint generated always as (qty * unit_price_sen) stored,

    constraint order_lines_qty_positive check (qty > 0),
    constraint order_lines_unit_price_nonneg check (unit_price_sen >= 0),
    constraint order_lines_currency_iso4217 check (currency_code ~ '^[A-Z]{3}$')
  );
  ```

  Add constraints idempotently with `DO $$ ... IF NOT EXISTS ... $$`, since Postgres has no
  `ADD CONSTRAINT IF NOT EXISTS` (per the local skill's `schema-constraints.md`).

---

## 6. Provenance/jsonb conventions

**Recommendation:** keep the current-state provenance envelope as a `jsonb` column
colocated on the row, and additionally write immutable history rows to a side table if
audit/compliance queries across rows are needed (which a policy-gated agentic system likely
does need).

- **jsonb column on the row.** Simplest to write/read together with its parent row, no
  extra joins, and the "this field's provenance" relationship is implicit and can't go
  orphaned. Right default when you mostly read/write provenance alongside the row it
  describes and rarely query provenance across rows.
- **Side/audit table**, keyed by `(table_name, row_id, field_name)`, scales better for
  cross-cutting queries ("every AI-touched field below confidence 0.7 in the last 24h across
  the schema") and survives row updates/deletes without losing history (an `UPDATE` that
  overwrites the jsonb column loses prior provenance unless separately versioned). Cost: an
  extra join for the common case, and no native FK-style integrity for a table+row+field
  triple.
- No official Supabase or Postgres source directly adjudicates this trade-off — the
  recommendation above is this document's synthesis from jsonb fundamentals plus TrainOS's
  stated audit/compliance needs, not a direct citation.
- **GIN indexing** (per the local skill's `advanced-jsonb-indexing.md`, Supabase-maintained):
  use `create index ... using gin (col)` for containment queries (`@>`, `?`, `?&`, `?|`).
  Use the `jsonb_path_ops` operator class when you only need `@>` (2–3x smaller index) versus
  the default `jsonb_ops` (supports all jsonb operators, larger index). For a single hot key
  like `provenance->>'confidence'`, an expression index
  (`create index on t ((provenance->>'confidence'))`) beats a full GIN index and is cheaper
  to maintain.
- **Validating jsonb shape:** Supabase officially supports the `pg_jsonschema` extension —
  [pg_jsonschema](https://supabase.com/docs/guides/database/extensions/pg_jsonschema.md) —
  providing `json_matches_schema`/`jsonb_matches_schema`, used inside a `CHECK` constraint:

  ```sql
  create extension if not exists pg_jsonschema with schema extensions;

  alter table ai_touched_fields
  add constraint provenance_shape check (
    extensions.jsonb_matches_schema(
      '{
        "type": "object",
        "required": ["source", "confidence", "model", "timestamp"],
        "properties": {
          "source": {"type": "string"},
          "confidence": {"type": "number", "minimum": 0, "maximum": 1},
          "model": {"type": "string"},
          "timestamp": {"type": "string"}
        }
      }',
      provenance
    )
  );
  ```

  Install in a dedicated `extensions` schema, not `public`. This enforces the envelope shape
  at the database boundary regardless of write path (important since not every future code
  path, or a direct `service_role` write, is guaranteed to run the same app-level
  validator). Keep app-level validation too, as a fast pre-check with friendlier error
  messages before a row ever reaches the constraint.

---

## 7. Declarative schemas vs. migrations, branching, pgTAP, rollback

**Recommendation:** declarative schema files + `supabase db diff` for new schema work,
preview branches per feature, pgTAP wired into CI, and every migration authored with a
hand-written, reviewed, pgTAP-tested compensating migration rather than relying on tooling
to auto-generate a safe rollback.

- **Declarative schemas are Supabase's current recommended default for new projects** — see
  [Declarative Database Schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas.md),
  reinforced by
  [CLI Workflows](https://supabase.com/docs/guides/local-development/cli-workflows.md),
  which explicitly labels it "recommended for new projects." Workflow: declare desired
  end-state SQL under `supabase/schemas/*.sql`, run `supabase db diff -f <name>` to generate
  a timestamped migration by diffing your declared schema against migration history, and
  commit both together. This avoids hand-tracking every incremental `ALTER` and keeps
  views/functions editable in place rather than painfully diffed imperatively.
- **`supabase db diff`** diffs a target (`--local` default, `--linked` remote, or
  `--db-url`) against a shadow database built from existing migrations. **Doc
  inconsistency found:** the
  [CLI reference page](https://supabase.com/docs/reference/cli/supabase-db-diff) still frames
  the tool primarily around the older `migra` engine, while the newer `cli-workflows` guide
  names `pg-delta` as the current default (with `migra` as a legacy opt-in via
  `--use-migra`). Both are current Supabase docs, so this is a live inconsistency in
  Supabase's own documentation as of September 2026 — treat every generated diff as a draft
  regardless of engine. Known caveats documented on both pages: DML is never captured, and
  RLS policy renames, materialized views, view ownership/grants, partitions, and
  `create domain` don't diff cleanly — author those object types as explicit hand-written
  migrations and review every generated migration by hand.
- **Branching** — preview branches are isolated Postgres instances (own schema, data,
  Storage, Auth, Edge Functions), created per PR/Git branch, seeded once from
  `supabase/seed.sql`, with migrations applied sequentially and tracked per-branch. Schema
  drift between concurrently open branches is handled like a Git merge conflict — rebase and
  re-timestamp migrations to keep ordering monotonic. There is **no built-in rollback** for a
  bad migration on a preview branch — the documented method is to delete and recreate the
  branch, replaying all migrations from a fresh seed (any manually added data is lost). See
  [Working with Branches](https://supabase.com/docs/guides/deployment/branching/working-with-branches.md)
  and [Branching Troubleshooting](https://supabase.com/docs/guides/deployment/branching/troubleshooting.md).
- **pgTAP testing** is Supabase's recommended DB-level unit-testing framework:
  `create extension pgtap`, `supabase test new <name>` scaffolds a test file, `supabase test db`
  runs it in CI. Tests wrap `begin; select plan(n); ...; select * from finish(); rollback;`
  so they never persist side effects. For RLS-heavy multi-tenant testing, the
  `basejump-supabase_test_helpers` package (installed via `dbdev`) adds
  `tests.create_supabase_user()`, `tests.authenticate_as()`, and `tests.rls_enabled('public')`
  to test tenant isolation without hand-rolling JWT claims — directly applicable to
  TrainOS's policy-gated, multi-tenant policies. See
  [Testing Overview](https://supabase.com/docs/guides/local-development/testing/overview.md)
  and [Advanced pgTAP Testing](https://supabase.com/docs/guides/local-development/testing/pgtap-extended.md).
- **Rollback strategy.** Supabase's own declarative-schemas guide states directly that
  production migrations are not auto-reversible: locally you can reset to an earlier
  migration (`supabase db reset --version <timestamp>`), but once a migration has reached
  production, the only supported path is a new forward migration that reverts the change —
  "your production migrations are always rolling forward" — and the same doc warns such
  reverting migrations are usually destructive and need careful review. **For TrainOS**
  (money, provenance, multi-tenant data — where a destructive rollback is unacceptable),
  author every migration as a pair: the forward migration, and an explicit, hand-written,
  pgTAP-tested compensating migration reviewed *before* the forward migration touches any
  shared environment. No tooling reviewed here claims to auto-generate a safe down-migration.

---

## 8. Secrets / BYOK

**Recommendation:** Supabase Vault for per-tenant provider keys, gated behind exactly one
audited `SECURITY DEFINER` decrypt function — never Edge Function/project env secrets for
this, since those are static and project-wide, not per-tenant runtime data.

- **Vault architecture.** Built on `pgsodium`, storing secrets with authenticated encryption
  at rest — encrypted payloads persist even through backups/replication. `vault.create_secret()`
  encrypts immediately; the decrypted form is visible only through the
  `vault.decrypted_secrets` view, decrypting on the fly, never persisting plaintext. See
  [Vault](https://supabase.com/docs/guides/database/vault.md).
- **Why Vault, not env secrets, for BYOK:** Edge Function/project secrets
  (`supabase secrets set`) are one static value shared by every invocation and every
  tenant. BYOK keys are runtime, per-tenant rows, so they belong in the database. Store each
  tenant's provider key via `vault.create_secret(key_value, tenant_id || ':' || provider)`,
  keep non-sensitive metadata (provider name, key prefix for UI masking, `created_at`,
  `last_used_at`) in an ordinary table joined by secret id, and never grant
  `anon`/`authenticated` (or PostgREST generally) access to `vault.decrypted_secrets`.
- **Access pattern:** gate every decrypt behind one `SECURITY DEFINER` function that (a)
  checks the caller's tenant/role, (b) selects from `vault.decrypted_secrets` internally,
  (c) returns plaintext only to the trusted server-side caller (an Edge Function using the
  secret key), and (d) writes an audit row before returning, atomically. This pattern is
  corroborated (non-officially) by
  [makerkit's Vault tutorial](https://makerkit.dev/blog/tutorials/supabase-vault); it is not
  an official Supabase reference architecture for BYOK specifically — Vault docs cover the
  primitive, not this application. **Important distinction:** a hash-based API-key pattern
  (as used for verifying caller-presented keys) is one-way and wrong for BYOK, since you
  must send the tenant's *actual* provider key onward to OpenAI/Anthropic/etc. — you need
  reversible, audited decryption (Vault), not a hash.
- **Key-reveal auditing:** there's no built-in Vault audit log — build a
  `key_access_audit` table (`tenant_id`, `secret_id`, `actor`, `edge_function_name`,
  `decrypted_at`, `request_id`) written inside the same transaction as the decrypt, so
  "decrypt" and "log" are atomic. Every LLM-call path should go through this one
  decrypt-and-audit RPC, never query `vault.decrypted_secrets` ad hoc.
- **Key rotation — two levels, don't conflate them:**
  - *Per-secret* (tenant rotates their own key): create a new `vault.create_secret()` row,
    mark the old one inactive — routine.
  - *Root encryption key* (project-wide `pgsodium`/Vault root key): per the
    [troubleshooting guide](https://supabase.com/docs/guides/troubleshooting/issues-with-rotating-pgsodium-and-vault-root-encryption-keys-efeb47),
    this must go through the Management API's `/pgsodium` endpoint, never SQL. **Verified
    operational trap:** after root-key rotation, all existing Vault secrets encrypted under
    the old root key become unreadable and must be manually re-encrypted/re-created under
    the new key — no automated re-encryption tooling was found in docs or changelog. Flag
    this prominently in any key-rotation runbook; a naive rotate will silently break every
    tenant's stored BYOK key.

---

## 9. Edge Functions in 2026

- **Runtime.** Deno-compatible custom "Edge Runtime." The
  [changelog](https://supabase.com/changelog.md) shows Deno 2.1 compatibility became default
  across all regions around August 2025 (opt-out fallback to a 1.45-compatible mode via a
  query parameter). **No docs page pins an exact Deno point-version as of September 2026** —
  the [Edge Functions overview](https://supabase.com/docs/guides/functions.md) just says
  "Deno-compatible." Re-verify the exact version at implementation time rather than
  hard-coding a number.
- **Background Tasks.** Use `EdgeRuntime.waitUntil(promise)` for work that outlives the HTTP
  response (e.g. a multi-step agent run) — return the `Response` immediately while the
  promise continues. Per
  [Background Tasks](https://supabase.com/docs/guides/functions/background-tasks.md),
  background tasks do **not** get a separate/longer time budget — they share the same
  wall-clock/CPU/memory window as normal requests and the worker shuts down when any limit
  is hit. Use `try/catch` plus a global `unhandledrejection` listener, and a `beforeunload`
  listener to flush state before shutdown. Locally, `supabase/config.toml` needs
  `policy = "per_worker"` or background tasks get killed right after the response returns.
- **Limits** (per [Functions Limits](https://supabase.com/docs/guides/functions/limits.md)):

  | Limit | Value |
  |---|---|
  | Memory | 256 MB per function |
  | CPU time | 2 seconds per request (excludes async I/O wait) |
  | Wall-clock worker lifetime | 150s (Free) / 400s (paid) |
  | Request idle timeout | 150s (504 if no data sent in that window) |
  | Bundle size | 20 MB (CLI) / 5 MB (server-side bundled) |
  | Function count | 100 (Free) / 1000 (Pro) / 2000 (Team) / unlimited (Enterprise) |

  A blocking "call the LLM and await the whole answer in one request" flow is bounded by the
  idle timeout and wall-clock limits above — exactly why streaming or `waitUntil` background
  patterns are the documented approach for slow LLM calls.
- **Calling LLM providers + streaming.** Per the
  [AI Models guide](https://supabase.com/docs/guides/functions/ai-models.md) and the
  [OpenAI example](https://supabase.com/docs/guides/functions/examples/openai.md): call the
  provider with `stream: true`, relay chunks to the client as Server-Sent Events via a
  `ReadableStream` (`for await (const chunk of output) { controller.enqueue(...) }`,
  `Content-Type: text/event-stream`). Supabase's built-in `Supabase.ai.Session` inference is
  currently limited to the small `gte-small` embeddings model and self-hosted
  Ollama/Llamafile backends — **not** a hosted general-purpose LLM gateway. For BYOK
  GPT/Claude/etc. calls, the Edge Function calls the external provider's API directly using
  the tenant's decrypted key (§8); don't design around Supabase-hosted LLM inference.
- **Regional deployment.** Per
  [Regional Invocation](https://supabase.com/docs/guides/functions/regional-invocation.md),
  functions execute by default in the region closest to the end user (14 regions across
  NA/EU/APAC/SA) — good for latency, bad for chatty DB access from far regions. Pin execution
  to the database's region via the JS SDK's `region: FunctionRegion.X`, an `x-region`
  header, or `forceFunctionRegion`; verify actual execution region via the
  `x-sb-edge-region` response header. Trade-off: pinning improves DB round-trip latency for
  the multiple Postgres calls a typical TrainOS agent turn makes (policy check, audit write,
  RLS-scoped reads) but loses automatic multi-region failover — pinning to the DB region is
  probably the right default for TrainOS, accepting that trade-off.

---

## 10. Auth for a Vite SPA (not SSR)

**Recommendation:** PKCE (Supabase's default client flow), `getUser()` for
security-sensitive checks, `getClaims()` once on asymmetric JWT signing keys for fast local
verification, and MFA (`aal2`) enforced via a **restrictive** RLS policy for MD/ADMIN.

- **PKCE.** Confirmed default for `@supabase/ssr`; non-SSR apps may use implicit flow but
  PKCE is recommended generally, and supabase-js handles the `code_challenge`/`code_verifier`
  exchange automatically — nothing extra needed for a pure SPA beyond default client config.
  See [Server-Side Auth: Advanced Guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide.md).
- **`getClaims()` vs. `getUser()`.** `getUser()` always calls the Auth server and is
  authoritative (detects bans/deletions/logouts instantly). `getClaims()` was introduced
  alongside **asymmetric JWT signing keys** (ES256/RS256) specifically so JWTs can be
  verified locally against a cached JWKS with no network round trip — materially faster, but
  only after the project has migrated off the legacy HS256 shared-secret system (otherwise
  it falls back to a server call). supabase-js's own guidance: never trust `getSession()`'s
  user object for authorization decisions — use `getUser()` or `getClaims()`. This
  comparison isn't stated cleanly on one official page; it's assembled from the
  [signing keys](https://supabase.com/docs/guides/auth/signing-keys.md) doc plus corroborating
  community explanations (Medium, AnswerOverflow) — flagged as partly non-official.
- **Session refresh.** JWT access+refresh token pairs; refresh tokens are single-use with a
  10-second reuse-detection grace window (tolerates races across concurrent tabs).
  supabase-js auto-refreshes in the background; for a Vite SPA with no server, tokens live in
  `localStorage` by default since there's no server to hold an httpOnly cookie. See
  [Sessions](https://supabase.com/docs/guides/auth/sessions.md).
- **MFA for MD/ADMIN.** Supabase encodes assurance level as `aal` in the JWT (`aal1` =
  single factor, `aal2` = MFA-verified) and `amr` tracks the auth method chain. Restrict
  MD/ADMIN-only tables/actions with a **restrictive** policy (permissive policies OR
  together; restrictive policies AND — a plain permissive policy would not actually block
  access here):

  ```sql
  create policy "MD/ADMIN requires MFA"
    on sensitive_table
    as restrictive
    to authenticated
    using (
      (select auth.jwt()->>'role') not in ('MD','ADMIN')
      or (select auth.jwt()->>'aal') = 'aal2'
    );
  ```

  Note: org-level MFA enforcement (Pro/Team/Enterprise) governs access to the Supabase
  *dashboard* itself, not your app's end users — don't conflate the two. See
  [Auth MFA](https://supabase.com/docs/guides/auth/auth-mfa.md) and
  [Org MFA Enforcement](https://supabase.com/docs/guides/platform/mfa/org-mfa-enforcement.md).

---

## 11. Type generation and the shared contract package

**Recommendation:** generate with `supabase gen types typescript`, publish into one shared
internal package, and gate PRs on regeneration + diff — not a nightly auto-commit alone.

- Command: `npx supabase gen types typescript --project-id "$PROJECT_REF" --schema public > database.types.ts`
  (or `--local` against the local CLI stack; CLI ≥ 1.8.1). See
  [Generating Types](https://supabase.com/docs/guides/api/rest/generating-types.md).
- The officially documented CI pattern is a nightly scheduled GitHub Action that regenerates
  types and auto-commits only if the file changed — a rudimentary drift detector via
  `git status`. Supabase does **not** document a monorepo distribution pattern or a
  fail-on-drift gate; that's this document's own recommendation, not sourced guidance.
- **Recommendation:** run type generation as a required check on every PR touching
  `supabase/migrations/**` (against the local stack or a preview branch created via
  `create_branch`), diff the result against the committed shared package, and fail the PR on
  drift — nightly-only detection lets a schema change and its consuming frontend code ship
  in the same review cycle without ever being validated together. Publish the generated file
  as its own internal workspace package (e.g. in a pnpm/Turborepo monorepo) that both the
  Vite SPA and any backend services import, so drift becomes a compile error rather than a
  silent divergence. General monorepo-drift framing corroborated by third-party sources, not
  Supabase docs: [PkgPulse monorepo guide](https://www.pkgpulse.com/guides/javascript-monorepos-2026-best-practices-pitfalls),
  [Turborepo + Supabase walkthrough](https://philipp.steinroetter.com/posts/supabase-turborepo).

---

## 12. Observability

- **Logs Explorer / log drains.** Logs are stored in ClickHouse, queryable from Studio, MCP,
  or the API, covering API gateway, Auth, Storage, Realtime, Postgres, and Edge Functions;
  Prometheus-compatible metrics scraping and live Postgres statistics ("Inspect the
  database") are available, plus log drains to external sinks, W3C trace-context
  propagation, and a first-party Sentry integration capturing supabase-js errors/spans.
  Supabase also runs five scheduled automated monitoring agents (generalist daily, health
  hourly, security daily, performance hourly, capacity each morning) checking logs/stats
  against known signal patterns. See [Observability Overview](https://supabase.com/docs/guides/observability.md).
  **Unverified:** third-party coverage claims Edge Function real-time log streaming became
  available on the Pro plan around March 2026 — could not confirm this date/plan-tier from
  an official docs or changelog page; re-check before quoting it.
- **Database Advisors** (Security + Performance), available via Studio, CLI
  (`supabase db advisors`, CLI ≥ 2.81.3), Management API, or MCP's `get_advisors`. Security
  advisor flags: RLS disabled on public tables, RLS enabled with no policies (self-check
  relevant to TrainOS's per-tenant gating — this effectively locks out access entirely),
  views over `auth.users` leaking data (views bypass RLS by default), `SECURITY DEFINER`
  functions/views callable by `anon`/`authenticated` without guards, and public tables with
  apparent PII/secrets and no access control. Performance advisor flags: unindexed foreign
  keys, unused/duplicate indexes, table bloat, missing primary keys, and — most relevant here
  — slow RLS policies calling auth functions per-row instead of once per query (the
  `auth.uid()`/initplan issue from §1, fixed by the `(select ...)` wrapper). See
  [Advisors](https://supabase.com/docs/guides/observability/advisors.md). Run advisors after
  every schema/RLS change.
- **pg_stat_statements.** Enabled by default on every Supabase project. Tracks
  per-normalized-query stats (`calls`, `total_exec_time`, `mean_exec_time`, `rows`),
  queryable directly via SQL or via `supabase inspect db calls|outliers|...`. **Retention is
  capped at the 5,000 most recent distinct normalized statements** — not time-based — so
  rare query shapes get evicted under load; call `select pg_stat_statements_reset();` after
  resolving a performance issue for a clean baseline. If Studio's "Query Performance" page
  errors with "insufficient privilege," run `grant pg_read_all_stats to postgres;`. See
  [pg_stat_statements](https://supabase.com/docs/guides/database/extensions/pg_stat_statements.md)
  and [Inspect the Database](https://supabase.com/docs/guides/observability/inspect.md).

---

## 13. 2025–2026 changes that invalidate older patterns

These are confirmed and directly relevant — design against the new key/JWT model from day
one rather than the legacy pattern still described in a lot of older tutorials.

- **New API key formats.** `sb_publishable_...` replaces `anon`; `sb_secret_...` replaces
  `service_role`. These are **opaque strings, not JWTs** — sent only on the `apikey` header,
  validated by the API gateway, not parseable/verifiable downstream as a JWT. Secret keys
  reject browser use via User-Agent sniffing (HTTP 401) — a guardrail the old
  `service_role` JWT never had. You can mint multiple secret keys (recommended: one per
  backend component/agent class, see §2) for isolated rotation. Legacy JWT-based keys are
  being deprecated by end of 2026; both systems coexist during migration. See
  [API keys](https://supabase.com/docs/guides/getting-started/api-keys.md) and
  [Migrating to new API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys.md).
- **JWT signing key overhaul.** Legacy: a single shared HS256 secret signs every JWT,
  coupling `anon`/`service_role` rotation together. New: asymmetric signing keys — ES256
  (recommended, P-256, shorter tokens) and RS256, with EdDSA "coming soon." Asymmetric keys
  let JWTs be verified **locally** via a JWKS endpoint
  (`/auth/v1/.well-known/jwks.json`, cached roughly 10 minutes both edge- and client-side)
  with no Auth-server round trip, and enable instant revocation via key-state transitions
  (standby → current → previously-used → revoked) without forcing a global sign-out.
  Publishable/secret API keys are now decoupled from JWT signing keys entirely — one can
  rotate independently of the other. Migration requires confirming nothing verifies JWTs
  directly against the legacy shared secret (e.g. via `jose`/`jsonwebtoken`) before rotating;
  use `getClaims()` instead. See [Signing Keys](https://supabase.com/docs/guides/auth/signing-keys.md),
  corroborated by the [changelog](https://supabase.com/changelog.md) noting projects created
  after 2025-05-01 default to RSA asymmetric keys.
- **What `service_role` means now.** Conceptually unchanged (`BYPASSRLS` Postgres role), but
  issued as an opaque `sb_secret_...` string rather than a JWT, independently rotatable, and
  platform-level `verify_jwt` no longer authenticates API-key-only requests to Edge
  Functions — authorize the key inside your own handler now. See
  [Migrating to new API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys.md).
- **Other 2026 changes worth designing around:** the Data API stopped serving the OpenAPI
  spec to anonymous-key requests as of roughly March/April 2026 (don't rely on client-side
  introspection); the Realtime schema is fully locked against direct DDL as of July 2026
  (consistent with §4's RLS-on-`realtime.messages` approach); `@supabase/supabase-js` will
  require TypeScript 5.0+ from January 2027. See [Changelog](https://supabase.com/changelog.md).

**Design implication:** since TrainOS is starting fresh in September 2026, build directly on
`sb_publishable_`/`sb_secret_` keys and asymmetric JWT signing keys — the legacy
`anon`/`service_role` JWT + HS256 pattern still described in a lot of older
tutorials/blog posts is the deprecated path, not the target architecture.

---

## Decision defaults for TrainOS

| Area | Default | Key reason |
|---|---|---|
| Multi-tenancy | Shared tables + `tenant_id` column + RLS | Matches how RLS and every Supabase example is designed; schema-per-tenant is undocumented and adds migration/tooling overhead |
| Tenant/role in requests | Custom Access Token Hook writes `tenant_id`/`role` into JWT claims | Zero-round-trip reads in RLS vs. per-request profile lookups; force `refreshSession()` after privilege changes |
| RLS performance | `(select auth.uid())` wrapper, explicit `tenant_id` index, `SECURITY DEFINER` helpers in a non-exposed schema, `TO authenticated` on every policy | Documented ~95–99.99% latency reduction; avoids recursive/joined policy evaluation |
| `AGENT` actor | Dedicated `agents` table + hashed revocable API key + minted short-lived JWT with `role: AGENT`, `tenant_id`, `agent_id` claims | No official Supabase pattern exists; this gives per-agent RLS scoping, clean revocation, and an accountability trail — avoid one shared secret key for all agents |
| Action envelope | Edge Function (network/LLM orchestration) → one `SECURITY DEFINER` Postgres RPC (atomic decision + write + idempotency upsert), RPC kept in a non-exposed schema, called via secret key | Postgres RPC gives the only real transactional guarantee; Edge Function is the only place that can make outbound LLM calls |
| Idempotency keys | Dedicated table, unique constraint, `INSERT ... ON CONFLICT DO NOTHING` returning cached response, `pg_cron` hourly cleanup at 24h TTL | Matches Supabase's own Resumable WebSockets example idiom and the general Stripe-style idempotency pattern |
| Outbox | `pgmq`, written in the same transaction as the action-envelope write | Durable, at-least-once, avoids dual-write problem; Database Webhooks lack a documented delivery guarantee |
| Client-facing events | Realtime **Broadcast** via `realtime.broadcast_changes()`/`realtime.send()`, RLS on `realtime.messages` scoped by tenant in the channel name | Postgres Changes doesn't scale past ~3,000 concurrent subscribers per Supabase's own guidance |
| Money | `bigint` sen (unchanged) + `currencies` table for per-currency minor-unit exponent + `GENERATED ALWAYS AS ... STORED` for computed totals | Faster aggregation than `numeric`, exact by construction, matches payment-processor wire format; diverges from generic "use numeric" advice for a documented reason |
| Provenance | `jsonb` column on the row for current state + side `field_provenance_log` table for history/audit queries + `pg_jsonschema` `CHECK` constraint on shape | Colocated reads stay cheap; side table gives durable, queryable audit trail; DB-level shape validation doesn't depend on every write path calling the same validator |
| Schema workflow | Declarative schemas (`supabase/schemas/*.sql`) + `supabase db diff` + preview branches per feature + pgTAP in CI + hand-written, reviewed, tested compensating migration alongside every forward migration | Supabase's own recommended default for new projects; migrations are not auto-reversible in production |
| BYOK secrets | Supabase Vault, one row per tenant/provider, decrypt only via a single audited `SECURITY DEFINER` function, `key_access_audit` table written atomically with every decrypt | Env secrets are static/project-wide and cannot hold per-tenant runtime data; reversible decryption (not hashing) is required to relay the key onward |
| Edge Functions | Pin function region to the database's region; use `EdgeRuntime.waitUntil` for background LLM work; stream provider responses via SSE/`ReadableStream` | Reduces DB round-trip latency for chatty agent turns; avoids the 150s idle timeout on long LLM calls |
| Auth (Vite SPA) | PKCE (default), `getUser()` for authorization-sensitive checks, `getClaims()` once on asymmetric signing keys, restrictive `aal2` policy for MD/ADMIN-gated tables | `getSession()`'s embedded user object is explicitly not trustworthy for authorization per supabase-js guidance |
| Types | `supabase gen types typescript` in a required CI check against every migration-touching PR, published as one shared internal package | Nightly-only regeneration lets schema and consuming code drift within one release cycle |
| Observability | Run `get_advisors` after every schema/RLS change; monitor `pg_stat_statements` with periodic `pg_stat_statements_reset()`; treat security-advisor RLS findings as blocking | Advisors directly catch the exact RLS/initplan mistakes this document flags in §1 |
| API keys / JWTs | `sb_publishable_`/`sb_secret_` keys and asymmetric (ES256) JWT signing keys from day one | Legacy `anon`/`service_role` JWT + HS256 pattern is the deprecated path being phased out through end of 2026 |

---

## What I could NOT verify / conflicting sources

- **Schema-per-tenant vs. tenant_id column:** no official Supabase comparison exists;
  the recommendation in §1 is this document's own, not Supabase-sourced.
- **Non-human service principals:** confirmed absence of any official Supabase pattern
  (including an unresolved Supabase team GitHub discussion); the `agents`-table design in
  §2 is original synthesis, not documented guidance.
- **`getClaims()` vs. `getUser()` behavioral comparison:** assembled from the official
  signing-keys doc plus corroborating but non-official community explanations (Medium,
  AnswerOverflow); no single official page states the comparison as cleanly as presented
  here.
- **Action envelope / workflow pattern (§3):** no first-party Supabase reference
  architecture exists for this shape at all; the hybrid Edge-Function-plus-RPC design is a
  synthesis of several separately documented Supabase behaviors, not a single citable guide.
- **pgmq delivery-guarantee wording:** the Supabase Queues overview page's "exactly-once"
  marketing language conflicts with `pgmq`'s own function-level docs, which describe
  at-least-once semantics via `read()`'s visibility timeout. Design consumers to be
  idempotent regardless of which is authoritative.
- **`supabase db diff` engine:** the CLI reference page (framed around `migra`) and the
  newer CLI Workflows guide (naming `pg-delta` as default) are inconsistent with each other
  as of September 2026 — this is a live inconsistency in Supabase's own docs, not something
  further research resolved.
- **jsonb column vs. side audit table for provenance:** no official Postgres or Supabase
  source directly adjudicates this; §6's recommendation is original synthesis from jsonb
  fundamentals plus TrainOS's stated requirements.
- **`bigint` sen vs. `numeric` for money:** the locally installed Supabase-maintained
  postgres-best-practices skill generically recommends `numeric` for money, which is in
  tension with TrainOS's established bigint-sen convention. Money-specific sources
  (Crunchy Data, PostgreSQL docs, Numeric.substack) were treated as more authoritative for
  this specific multi-currency, minor-unit-integer use case — flagged as a case where
  generic best-practice guidance and a domain-specific convention diverge.
- **BYOK-via-Vault architecture:** Vault's own docs cover the encryption primitive, not this
  application pattern; the `SECURITY DEFINER`-gate-plus-audit-table design in §8 is a
  synthesis of official Vault semantics and non-official community best practice
  (makerkit), not a documented Supabase reference architecture.
- **Exact current Deno version for Edge Functions:** no docs page pins a version as of
  September 2026; only changelog history through Deno 2.1 (~August 2025) was found. Verify
  at implementation time.
- **Edge Function real-time log streaming "Pro plan, March 2026":** sourced from third-party
  blog coverage only; could not confirm the date or plan-gating from an official Supabase
  docs or changelog page. Re-verify before quoting.
- **Root Vault encryption-key rotation requiring manual re-encryption of every secret:**
  confirmed in an official troubleshooting doc, but this is exactly the kind of detail that
  could change without a prominent changelog entry — re-check before writing a production
  key-rotation runbook.
