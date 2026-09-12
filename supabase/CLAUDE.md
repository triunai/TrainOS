# Supabase — Claude Code Context

Database schema, RPCs, and security model. **Security-critical — read before touching any
migration.**

TrainOS is **multi-tenant from row zero**. Every business table carries `tenant_id`, every
foreign key is composite (`tenant_id, parent_id`), and every policy is tenant-scoped. A
cross-tenant read is a product-ending defect, not a bug.

## Where the truth lives

| Question | File |
|---|---|
| What migrations exist, what each did, the worked contract check | `supabase/migrations/migration-catalog.md` |
| What shipped, in human/product terms, and when | `CHANGELOG.md` (repo root) |
| A table's current cumulative shape, without replaying migrations | `supabase/tables/<table>.sql` (point-in-time snapshot, **not executable**) |
| Why the schema is shaped this way | `docs/architecture/01`–`05` |

The catalog is canonical. This file is orientation, never an inventory.

## The four artifacts — a migration is not reviewable until all four exist

| Artifact | Path |
|---|---|
| Forward SQL | `supabase/migrations/NNN_<slug>.sql` |
| Rollback | `supabase/rollbacks/NNN_<slug>_rollback.sql` |
| SQL pin | `supabase/tests/test_NNN_<slug>.sql` |
| Catalog | `supabase/migrations/migration-catalog.md` — Migration Order row **and** Detail section |

**Same-commit hard rule:** any touch to `supabase/migrations/` updates the catalog in the SAME
commit. A catalog entry that lands in a follow-up commit fails the gate.

The rollback **reproduces the prior definition in full**. A rollback that says "see migration
007" depends on another file being readable at the moment you need it, which is not a
rollback. State the drop ORDER — normally the reverse of the forward order.

The pin ends in `ROLLBACK` and writes nothing durable. **An authored pin that was never run is
not a pin.**

## Security rules (MANDATORY)

1. Every function is `SECURITY DEFINER` with
   `SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'` — pg_catalog first,
   pg_temp last. Never the bare two-schema form.
2. RLS is **enabled and FORCED** on every table in `public` and `app`. No exceptions, including
   config and reference tables.
3. Every policy predicate resolves the caller's tenant through `app.current_tenant_id()`, never
   by reading a membership table inline — an inline read re-triggers RLS on that table and
   recurses.
4. `auth.uid()` inside a policy is always wrapped: `(SELECT auth.uid())`. Unwrapped, it is
   re-evaluated per row.
5. `anon` is hostile by default. It holds EXECUTE on exactly the functions in the public-token
   allowlist (client portal) and nothing else. `GRANT ... TO anon` outside that allowlist is a
   review blocker.
6. `authenticated` is necessary, never sufficient — every RPC re-checks role and tenant inside
   the body.
7. Leading-underscore functions (`_assert_tenant`, `_next_ref`) are internal. `REVOKE ALL` from
   anon and authenticated; only other functions call them.
8. Secrets are never stored in plaintext. `ai_provider_key` holds a masked prefix and a hash —
   the material lives in the platform secret store.

## The spine — what a migration must not casually rewrite

TrainOS's spine is the **action envelope**: `app.submit_action()`, the policy gate it calls,
and `action_request` / `action_effect`. Every primary button in the product and every agent
proposal passes through it. New capability ships as a new action *type* plus its own handler,
registered in data — never as a branch bolted into the envelope.

Second spine: **pipeline configuration**. Stage names and order render from `pipeline_step`
rows. A hardcoded stage list anywhere in SQL is a defect.

Every catalog Detail section closes with a "Spine untouched" line, or states the justification.

## Money

Integer minor units (`sen`), `bigint`, column suffix `_minor`, with one `currency char(3)` per
table. Never `numeric`, never `float`, never a composite type — composites round-trip badly
through PostgREST and generate unusable TypeScript.

**Total-from-lines, always.** Each line is `unit_minor × qty` rounded half-up; totals sum the
rounded lines; tax is computed on the summed net. A trigger rejects a header total that is not
the sum of its lines. A per-pax figure is display-only and has no column.

## Rates and scores

`numeric(6,4)` for margin, commission and tax rates. `numeric(4,3)` for confidence, fit and
eval scores, with `CHECK (x >= 0 AND x <= 1)`. Never `float`.

## Gotchas

- `ref` (`ENQ-2026-0912`) is a human reference, never a primary key, and is **immutable after
  insert** — a trigger enforces it. `id` is the key.
- Refs are **not gapless**. A rolled-back transaction burns a number. This is accepted for
  every prefix; see the catalog's `INV-` note for why finance was consulted.
- Attendance is **immutable once locked**. The lock is one-way and enforced by a trigger, not
  by application code. Unlocking is an action type with its own approval.
- `created_by_id` is `text`, not a FK — agents and system principals are not rows in `app_user`.
- An enum type is `ALTER TYPE ... ADD VALUE`-only; it cannot be removed. Native enums are used
  exclusively for catalogues the API contract froze. Anything config-driven is a reference
  table with an FK.

## Running things locally

There is no Supabase CLI or Docker in the authoring environment. Migrations are executed
against a scratch Postgres cluster with a platform shim that supplies the `auth` schema, the
three API roles, and `auth.uid()`. See the catalog's "How this set was validated" note for the
exact commands and what that harness does and does not prove.
