# Migration Catalog

> The canonical record of every Supabase migration in TrainOS. One Migration Order row and one
> Migration Detail section per migration, updated in the SAME commit as the migration itself.

**Migrations:** 1 · **Applied:** 0 · **Authored, not applied:** 1
**Last snapshot of `tables/`:** never

---

<!-- Dated narrative entries go here, newest first, prepended. Each names the migration
     number, the concrete change, the evidence checked, and what was deliberately left
     alone. A correction to an earlier entry is a NEW dated entry pointing at the old one;
     the old one is left standing. -->

**Last updated:** 2026-09-12 — **001 authored and EXECUTED; nothing applied to any hosted database.** The foundation lands: schemas `app`, `core` and `extensions`, four extensions, and five shared helpers. Two things were found by running it rather than by reading it, and both changed the migration. **(1) The rollback's first execution aborted on `cannot drop extension pgcrypto because other objects depend on it`.** That was correct behaviour exposing an incorrect design: Supabase installs pgcrypto on every project, so 001's `CREATE EXTENSION IF NOT EXISTS pgcrypto` is a no-op on the real target and 001 does not own it. Dropping it would not restore the prior state, it would destroy a piece of it. The rollback now drops only the three extensions 001 genuinely creates (citext, btree_gist, pg_trgm) and says why pgcrypto is absent from the list. **(2) Doc 02 §4.1's baseline line `alter default privileges in schema public revoke all on tables from public` does not do what it says, and neither does the functions equivalent.** Measured on PostgreSQL 17.11: for tables it is vacuous, because PUBLIC holds no default table privilege to revoke; for functions it is not vacuous and still does not take — the statement records no row in `pg_default_acl` and a function created afterwards is still executable by PUBLIC and by `anon`. The same statement in GRANT form records correctly, so the mechanism is live and it is the revoke-from-PUBLIC direction that fails. Both lines are kept as the documented baseline and are explicitly **not** the guard; the guard is per-object `REVOKE` at creation in every migration plus test_014's schema-wide sweep. The pin was rewritten to stop asserting the fiction — it had originally asserted a `pg_default_acl` row and failed, which is how this was found. **Conflict C1 resolved and applied here:** the domain lives in schema `core`, not `public`. Doc 03 §1 states it outright and then uses `core.proposals`, `core.quotations`, `core.invoices`, `core.engagements` and `core.hrdc_packets` across twenty places of its own executable SQL including index DDL it prescribes; doc 02 writes the same tables as `public.*` throughout its RLS catalogue. 03 outranks 02. `core` is therefore added to PostgREST's exposed schemas in `config.toml` — without that line the whole domain is invisible to the API with no error to explain it.

## Migration Order

| # | File | Summary |
|---|------|---------|
| 001 | `001_foundation_schemas_and_helpers.sql` | **The floor: three schemas, four extensions, five shared helpers (2026-09-12).** Creates `app` (helpers + the action gate, NOT exposed to PostgREST), `core` (the 86-table domain, exposed), and `extensions`. Installs citext (case-insensitive email, so `EXACT_DOMAIN` contact matching does not silently miss on case), btree_gist (the EXCLUDE constraint that stops a trainer being double-booked, 008), pg_trgm (⌘K search) and pgcrypto (share-token hashing — platform-provided on Supabase, so 001 does not own it and the rollback leaves it). Five helpers: `app.set_updated_at`, `app.enforce_immutable_columns` (generic, column names as trigger arguments — one implementation, N attachments, instead of N triggers that drift), `app.round_half_up_minor` (the single definition of DECISIONS §7's rounding rule), and `app.ok`/`app.err`. **The envelope is a FUNCTION, not a convention:** point 2 of the contract check is structural rather than review-dependent because `app.ok(jsonb)` BUILDS the object, so a top-level sibling key is not something a later author can add by accident. Applies doc 02 §4.1's schema baseline to `public` and `core` — and records that two of its four lines do not work. No spine yet; this creates the primitives the spine is built from. |

---

## Tables

*None yet — 001 creates no table. First tables arrive in 002.*

---

## Indexes

*None yet.*

---

## RPCs (Functions)

### Helper Functions

Internal, never client-callable. Every one below is `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.

#### `app.set_updated_at()` → trigger — 001
`BEFORE UPDATE FOR EACH ROW`. Stamps `NEW.updated_at := now()`. Attached by every table migration.

#### `app.enforce_immutable_columns()` → trigger — 001
`BEFORE UPDATE FOR EACH ROW`, frozen column names passed as trigger arguments. A column freezes once it holds a value: `NULL → value` is allowed (several columns in this model are stamped after insert — `ref` by a BEFORE INSERT trigger, `accepted_at` once), `value → other` and `value → NULL` both raise `IMMUTABLE_COLUMN`. A no-op re-save of the same value is not a violation. A column named in the trigger that does not exist on the row raises `undefined_column` rather than silently protecting nothing — that failure mode would leave `ref` freely writable across the whole model with every migration still looking correct, and it is pinned by T9.

#### `app.round_half_up_minor(numeric)` → bigint — 001
`IMMUTABLE STRICT PARALLEL SAFE`. The single definition of DECISIONS §7: half-up, away from zero, to whole minor units. `STRICT`, so a NULL amount yields NULL and never a silent zero. Pinned against banker's rounding at 2.5 → 3.

#### `app.ok(jsonb DEFAULT '{}')` → jsonb — 001
Builds exactly `{success: true, data}`. `data` is the sole non-`success` key, which is the precondition the client's auto-unwrap depends on.

#### `app.err(text, jsonb DEFAULT NULL)` → jsonb — 001
Builds exactly `{success: false, error: {code[, details]}}`. Details nest INSIDE `error`; a top-level sibling is the failure mode this function exists to make unreachable.

### Public RPCs

*None yet. The first client-callable surface arrives in 011 (the action envelope) and 014 (the portal).*

---

## Migration Detail — 001 (`001_foundation_schemas_and_helpers.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED to any hosted database.** Executed against a
scratch PostgreSQL 17.11 cluster with a platform shim (see "How this set was validated" below).
Source docs: `docs/architecture/01` (conventions, `set_updated_at`, `enforce_immutable_columns`),
`docs/architecture/02` §1.2 and §4.1 (the `app` schema, the schema baseline),
`docs/architecture/03` §1 (the `core` schema), `DECISIONS.md` §7 (rounding).

### What it does

- **Schemas `app`, `core`, `extensions`.** `app` is not exposed to PostgREST; `core` is, and
  `config.toml` carries that with the reason. `public` keeps only identity and tenancy.
- **Extensions** pgcrypto, citext, btree_gist, pg_trgm — each installed into `extensions`, never
  into `public`, and each with the specific downstream consumer named in the header.
- **`app.set_updated_at()`**, **`app.enforce_immutable_columns()`**, **`app.round_half_up_minor()`**,
  **`app.ok()`**, **`app.err()`** — see the RPC section above.
- **Grants:** `USAGE` on `app` to anon + authenticated (an RLS predicate is evaluated in the
  CALLER's context and must be able to resolve `app.<fn>`), `EXECUTE` on nothing.
- **Spine untouched:** there is no spine yet. 001 creates the primitives the action envelope (011)
  is built from.

### The 7-point RPC contract check, worked

1. **Envelope** — no RPC added. `app.ok`/`app.err` are the constructors that make the envelope
   structurally correct for every RPC from 011 onward; their own shape is asserted by test_001 T5
   with an exact key-set comparison, not a "contains" check.
2. **Unwrap** — `app.ok` emits exactly `{success, data}`; `app.err` exactly `{success, error}`,
   with `details` nested inside `error`. A sibling key fails T5f.
3. **RpcMap** — no entries. `packages/contract/src` does not exist yet and 001 adds no
   client-callable surface to describe.
4. **Call sites** — none; new objects with no consumers. Expected, not a dead-RPC finding.
5. **Casts** — none.
6. **Reload/restore** — no client-visible behaviour.
7. **Public routes** — none. Nothing in 001 is reachable from an unauthenticated request; the
   portal's public surface arrives in 014.

The repo has no `check:rpc` / `check:grants` script yet (those are `docs/research/03`'s port list,
owned by another lane). The equivalent invariants are asserted structurally by test_001 T3 and T4.

### Pin — `tests/test_001_foundation_schemas_and_helpers.sql`

Eleven checks, all executed, all PASS.
T1 schemas exist, USAGE yes and CREATE no on `app` ·
T2 four extensions, in `extensions` rather than `public` ·
T3 every helper pins `search_path` (pg_catalog first, pg_temp last) ·
T4 zero anon/authenticated EXECUTE grants in `app` ·
T4b PUBLIC holds neither CREATE nor USAGE on app/core/public ·
T5 both envelopes carry exactly two keys and `details` nests inside `error` ·
T6 rounding is half-up and not banker's (2.5 → 3), away from zero, STRICT on NULL ·
T7 `set_updated_at` actually advances the column ·
T8 immutability freezes on first value, refuses change AND erasure, allows a no-op re-save ·
T9 a trigger naming a column that does not exist RAISES instead of silently protecting nothing ·
T10 `anon` is genuinely refused `app.ok` — asserted by becoming anon, not only by reading
`has_function_privilege`.

**RLS four-way: not applicable.** 001 creates no table and therefore no policy. The
owner/peer/other-tenant/anon matrix begins in `test_014_rls_policies`, against tables that exist.

T4b is where a real defect was caught: it originally asserted a `pg_default_acl` row and FAILED,
which is what exposed the ALTER DEFAULT PRIVILEGES finding recorded in the dated entry above. The
assertion was corrected to pin what is true rather than what was expected.

### Rollback — `rollbacks/001_foundation_schemas_and_helpers_rollback.sql`

Three pre-flight guards, none with an override: **G1** any function in `app` that 001 did not create
means a later migration put it there; **G2** any trigger still bound to the shared trigger functions
means a table still depends on them; **G3** any relation in `public` or `core` means business tables
exist. Then, in reverse of the forward order: grants, `public`'s default privileges restored to the
way Postgres ships them, five functions, three extensions (no CASCADE), `app` and `core` dropped
`RESTRICT`. `pgcrypto` and the `extensions` and `public` schemas are deliberately left standing —
all three are platform-provided and none is 001's to drop. Round-tripped: applied → rolled back →
re-applied, verify green each time.

---

## How this set was validated

There is **no Supabase CLI and no Docker** in the authoring environment, so `supabase start` and
`supabase db reset` were not available and were not run. Nothing in this set has been applied to any
hosted Supabase project, and no Supabase MCP apply/execute tool was used.

What WAS run: a scratch **PostgreSQL 17.11** cluster (Homebrew, started on `127.0.0.1:55432` inside
the session scratch directory, `wal_level = logical`), seeded with a platform shim that supplies the
parts of a Supabase database a migration is entitled to assume — the `anon` / `authenticated` /
`service_role` / `authenticator` roles, the `auth` schema with `auth.users`, `auth.uid()`,
`auth.jwt()` and `auth.role()` reading `request.jwt.claims`, the `supabase_realtime` publication, a
recording no-op `cron` schema, and a `storage.buckets` stub. Every migration in this set was applied
to that cluster in numeric order, every rollback was executed, and every pin was executed and its
output read.

**What that does and does not prove.** It proves the SQL parses, executes, that the constraints and
triggers behave as claimed, that RLS policies admit and refuse the right callers under impersonation,
and that each rollback restores the prior state. It does **not** prove behaviour against Supabase's
real `auth` schema, GoTrue's custom-access-token hook, real `pg_cron`, real logical-replication
delivery to Realtime subscribers, or Supabase's own role grants and platform extensions. Those are
listed under "What I could NOT verify" in the authoring report and must be re-verified on a real
project before apply.

---

## End of Catalog
