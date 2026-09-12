# Migration Catalog

> The canonical record of every Supabase migration in TrainOS. One Migration Order row and one
> Migration Detail section per migration, updated in the SAME commit as the migration itself.

**Migrations:** 4 · **Applied:** 0 · **Authored, not applied:** 4
**Last snapshot of `tables/`:** never

---

<!-- Dated narrative entries go here, newest first, prepended. Each names the migration
     number, the concrete change, the evidence checked, and what was deliberately left
     alone. A correction to an earlier entry is a NEW dated entry pointing at the old one;
     the old one is left standing. -->

**Last updated:** 2026-09-12 — **004 authored and EXECUTED. The important object in it is not a table: it is `app.finalise_table()`.** Doc 01's Conventions say every table carries the same eight columns, the same `UNIQUE (tenant_id, id)` and `(tenant_id, ref)`, the same `updated_at` trigger and a frozen `ref`; doc 02 §4.1 says every one is RLS-enabled AND FORCED with a tenant index. That is eight facts across roughly eighty tables. Written per table it is six hundred lines of copy-paste in which exactly one table ends up missing FORCE and nothing notices until that table is the one that leaks. Written once, a single pin proves it for all of them — and the pin tests the FUNCTION on a throwaway table rather than the fourteen tables it happened to be applied to, because otherwise it would not prove the fifteenth table gets the same treatment. This is the project's own consolidation rule applied to SQL. **`finalise_table` refuses a table with no `tenant_id`**, which is the check that matters: a table reaching 014 without one gets no tenant predicate, and a policy that cannot filter by tenant does not isolate. **Two defects found by running it.** (1) The composite FKs failed on first apply — `(tenant_id, attachment_id) → attachments (tenant_id, id)` needs the parent's composite unique to exist first, so the finaliser calls had to be interleaved with the CREATEs in dependency order rather than batched at the end. (2) Re-running 004 failed with `relation "ref_formats_tenant_id_key" already exists`: Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, which the Supabase schema guidance names explicitly as a migration trap. The finaliser now guards each ADD CONSTRAINT with a `pg_constraint` lookup and 004 is re-runnable. **Ref allocation is per tenant and T4 exists to keep it that way**: two tenants creating their first template must BOTH get `TPL-0001`. A global counter would let every customer read every other customer's record volume off a ref, and no access-control test would ever catch it because no row is exposed. **Conflict C4 resolved:** doc 01 wants `action_types` tenant-scoped in `core`; doc 03 §1.1 defines `app.action_types` as global, "the product's vocabulary... Tenants customise policies and grants, never the catalogue". 03 outranks 01 and is right — an action type is a capability the software has, not a per-customer setting.

**Last updated:** 2026-09-12 — **003 authored and EXECUTED: 69 enum types, 271 labels, GENERATED from `packages/contract/src/enums.ts` rather than transcribed.** Sixty-two of the sixty-nine are emitted by reading the contract package's `as const` arrays, one `CREATE TYPE` per array, so the database and the TypeScript contract are the same list by construction rather than by review. Each carries a COMMENT naming the constant it came from, so provenance survives into `\dT+`. The reason is that a misspelt enum label is perfectly valid SQL: `ACT_WITH_APROVAL` creates cleanly, matches nothing at run time, and first shows up as a row that will not insert in staging weeks later. The pin is generated from the migration and asserts every label **in declaration order**, because ORDER is semantic for a Postgres enum — comparisons and ORDER BY use declaration order, so a type recreated alphabetically would pass every membership test and silently sort BREACHING approvals last. T4 demonstrates that rather than asserting it abstractly. **Seven types are NOT in the contract package** and are listed separately with the doc section each came from; `travel_region` is the weakest of them — doc 01 names the type but gives no values, so `KLANG_VALLEY · PENINSULAR · EAST_MALAYSIA` are taken from DECISIONS §5's rate-card travel bands and are flagged. **Conflict C3 recorded, not resolved by precedence:** doc 03 §1 states "check constraints in place of enum types" for its own `app.*` gate tables and doc 01 chooses native enums for the domain, with reasons. These are not in conflict — each document describes the tables it owns — so the gate uses `text` + CHECK and the domain uses enums, and the asymmetry is recorded so nobody "unifies" it in one direction and breaks the other lane's design. **The rollback refuses rather than cascading:** `DROP TYPE ... CASCADE` does not fail on a dependent column, it DROPS THE COLUMN, which on `engagements.status` is silent irreversible data loss dressed as a successful rollback. The guard names every dependent column in one message instead of failing sixty-nine times.

**Last updated:** 2026-09-12 — **002 authored and EXECUTED; three defects found by running the docs' own SQL rather than reading it.** (1) **Doc 02 §4.1's `app.can_see_owner` does not compile.** It writes `p_owner = any ((select app.my_team_user_ids()))`; `ANY ((SELECT ...))` is parsed as the SUBQUERY form of ANY, which wants a set, while the function returns one `uuid[]` value, so Postgres reports `operator does not exist: uuid = uuid[]`. Corrected to `= ANY ((SELECT app.my_team_user_ids())::uuid[])`, which compiles AND keeps the property the doc wanted — `EXPLAIN` shows the whole expression hoisted to `(InitPlan 1).col1`, so the team lookup runs once per statement, not once per row. Calling the function bare also compiles but gives up that guarantee. (2) **Doc 02 §2.2 says "Ninety-four strings"; its own catalogue and its own §2.3 matrix each hold 109.** The seed was built by PARSING the markdown table rather than transcribing it — 74 rows, 109 distinct permissions, 399 (role, permission) pairs — because a hand transcription of a 74×7 grid is a typo generator and a missing tick is a silent authorisation hole no test for a different permission would catch. The prose count is stale; the data is self-consistent; the seed follows the data. (3) **The rollback crashed when re-run.** `'public.tenants'::regclass` RAISES on a missing relation, so a second run produced a bare cast error from inside a guard instead of "nothing to roll back"; and a plpgsql `RETURN` exits its block, not the script, so an early short-circuit did not stop the REVOKE below it. Both fixed with `to_regclass()` and per-statement existence guards; the rollback now round-trips and is safe to re-run. **The three pre-flight guards were tested by making each condition true** and confirming the refusal, not by reading them. **`public.user_profiles` is an AUTHOR ADDITION** — doc 02 §1.2 assigns it to sb-erd and names the two columns it requires, doc 01 never defines it, and the hook and every display-name policy need it to exist. Flagged rather than folded in silently.

**Last updated:** 2026-09-12 — **001 authored and EXECUTED; nothing applied to any hosted database.** The foundation lands: schemas `app`, `core` and `extensions`, four extensions, and five shared helpers. Two things were found by running it rather than by reading it, and both changed the migration. **(1) The rollback's first execution aborted on `cannot drop extension pgcrypto because other objects depend on it`.** That was correct behaviour exposing an incorrect design: Supabase installs pgcrypto on every project, so 001's `CREATE EXTENSION IF NOT EXISTS pgcrypto` is a no-op on the real target and 001 does not own it. Dropping it would not restore the prior state, it would destroy a piece of it. The rollback now drops only the three extensions 001 genuinely creates (citext, btree_gist, pg_trgm) and says why pgcrypto is absent from the list. **(2) Doc 02 §4.1's baseline line `alter default privileges in schema public revoke all on tables from public` does not do what it says, and neither does the functions equivalent.** Measured on PostgreSQL 17.11: for tables it is vacuous, because PUBLIC holds no default table privilege to revoke; for functions it is not vacuous and still does not take — the statement records no row in `pg_default_acl` and a function created afterwards is still executable by PUBLIC and by `anon`. The same statement in GRANT form records correctly, so the mechanism is live and it is the revoke-from-PUBLIC direction that fails. Both lines are kept as the documented baseline and are explicitly **not** the guard; the guard is per-object `REVOKE` at creation in every migration plus test_014's schema-wide sweep. The pin was rewritten to stop asserting the fiction — it had originally asserted a `pg_default_acl` row and failed, which is how this was found. **Conflict C1 resolved and applied here:** the domain lives in schema `core`, not `public`. Doc 03 §1 states it outright and then uses `core.proposals`, `core.quotations`, `core.invoices`, `core.engagements` and `core.hrdc_packets` across twenty places of its own executable SQL including index DDL it prescribes; doc 02 writes the same tables as `public.*` throughout its RLS catalogue. 03 outranks 02. `core` is therefore added to PostgREST's exposed schemas in `config.toml` — without that line the whole domain is invisible to the API with no error to explain it.

## Migration Order

| # | File | Summary |
|---|------|---------|
| 004 | `004_shell_config_and_ref_allocation.sql` | **The shell: `app.finalise_table()`, ref allocation, and 14 configuration and reference tables (2026-09-12).** One procedure gives a tenant-scoped table its whole standard posture — composite `(tenant_id, id)` and `(tenant_id, ref)` uniques, tenant index, `updated_at` trigger, frozen `tenant_id`/`ref` plus any extra columns, ref allocation, and **RLS enabled AND FORCED with zero policies**, so no table in this set is ever open, not even for the duration of one migration. Ref allocation is one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` per `(tenant, prefix, period)`, serialising per prefix per tenant rather than globally; the year comes from the TENANT's timezone, because a record created at 08:00 MYT on 1 January is a January record and UTC would call it December. `pipeline_steps` is the point of the migration: the contract shows two different lifecycles for the same object (six steps on the relations panel, nine on the engagement detail) and those are two `pipelines` rows, not two hardcoded arrays. `templates` are versioned and never edited, so a five-year-old proposal still renders as sent. `app.action_types` created here as the global catalogue (conflict C4); seeded in 011. Spine: `finalise_table` IS a new spine object and is pinned hardest. |
| 003 | `003_enum_types.sql` | **69 native enum types in `core`, 271 labels, generated from the contract package (2026-09-12).** Closed catalogues frozen by contract §12/§17 become native enums — four bytes on disk across a model full of status columns, and real union types in the generated TypeScript. Open, config-driven sets (`action_type`, lifecycle step key, compliance check key, `hrdc_document_type`, metric key, tier key, template type, TNA constraint code) deliberately do NOT appear here: they arrive in 004 as reference tables, because the project rule is that stage names and order render from configuration, and a CHECK constraint is code while a reference table is data. 62 types generated from `packages/contract/src/enums.ts`; 7 named by doc 01 alone and listed separately. `app_role` and `actor_kind` are NOT duplicated into `core` — doc 02 owns both and creates them in `app` (conflict C2). Spine untouched: types only, no table, no function, no policy. |
| 002 | `002_tenancy_identity_and_permissions.sql` | **Multi-tenancy from row zero: five identity tables, 109 permissions as data, and the access-token hook (2026-09-12).** `public.tenants`, `teams`, `team_members`, `memberships` and `user_profiles` (author addition), all RLS-enabled AND **forced** — forced removes the table owner's exemption, so a function running as `postgres` no longer silently sees every tenant. Three enum types in `app` (`app_role`, `actor_kind`, `data_scope`) per doc 02 §1.2. Eighteen claim readers and predicates: `app.current_tenant_id` (the spelling three lanes converged on — `app.tenant_id()` does not exist and must not be created), `app.has_permission`, `app.can_see_owner`, `app.my_team_user_ids`, `app.aal`, and `app.principal_claims` as the SINGLE claim-building body shared by the GoTrue hook and the agent-token minter, because §3.1 notes the hook does not run for a self-minted token and two bodies would drift. `app.role_permissions` seeded with 399 (role, permission) pairs over 109 permissions, parsed from doc 02 §2.3 rather than transcribed. **The escalation stop is a RESTRICTIVE policy**: `memberships_no_self_edit` — without it an ADMIN can UPDATE their own row to any role, scope or tenant, and `memberships_write_admin` permits it because they ARE an admin of that tenant while they do it. ADMIN writes additionally require `aal2`. Spine untouched — the action envelope does not exist yet; 002 is the authorization the spine will rest on. |
| 001 | `001_foundation_schemas_and_helpers.sql` | **The floor: three schemas, four extensions, five shared helpers (2026-09-12).** Creates `app` (helpers + the action gate, NOT exposed to PostgREST), `core` (the 86-table domain, exposed), and `extensions`. Installs citext (case-insensitive email, so `EXACT_DOMAIN` contact matching does not silently miss on case), btree_gist (the EXCLUDE constraint that stops a trainer being double-booked, 008), pg_trgm (⌘K search) and pgcrypto (share-token hashing — platform-provided on Supabase, so 001 does not own it and the rollback leaves it). Five helpers: `app.set_updated_at`, `app.enforce_immutable_columns` (generic, column names as trigger arguments — one implementation, N attachments, instead of N triggers that drift), `app.round_half_up_minor` (the single definition of DECISIONS §7's rounding rule), and `app.ok`/`app.err`. **The envelope is a FUNCTION, not a convention:** point 2 of the contract check is structural rather than review-dependent because `app.ok(jsonb)` BUILDS the object, so a top-level sibling key is not something a later author can add by accident. Applies doc 02 §4.1's schema baseline to `public` and `core` — and records that two of its four lines do not work. No spine yet; this creates the primitives the spine is built from. |

---

## Tables

### `public.tenants` — 002
`id uuid PK`, `slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')`, `name text NOT NULL`, `status text NOT NULL DEFAULT 'ACTIVE' CHECK IN (ACTIVE, SUSPENDED, CLOSED)`, `timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur'`, `locale text NOT NULL DEFAULT 'en-MY'`, `created_at`, `updated_at`. RLS enabled + forced. SELECT own row only; UPDATE by tenant ADMIN; **no INSERT and no DELETE policy** — creating and closing a tenant is `service_role` provisioning, not a button.

### `public.teams` — 002
`id uuid PK`, `tenant_id → tenants ON DELETE CASCADE`, `name`, `manager_user_id → auth.users ON DELETE SET NULL`, timestamps. `UNIQUE (tenant_id, name)`. RLS enabled + forced; tenant-wide SELECT, ADMIN write.

### `public.team_members` — 002
`tenant_id`, `team_id → teams CASCADE`, `user_id → auth.users CASCADE`, `PRIMARY KEY (team_id, user_id)`. Read by `app.my_team_user_ids()` (SECURITY DEFINER, so the table's own policy cannot recurse into it).

### `public.memberships` — 002
`PRIMARY KEY (tenant_id, user_id)` — a human CAN hold memberships in more than one tenant; nothing at launch uses that, and the hook pins the single `is_default` row. Columns: `role app.app_role`, `actor_kind app.actor_kind DEFAULT 'HUMAN'`, `agent_id text`, `primary_team_id`, `trainer_id uuid` (FK deferred to 006, when `core.trainers` exists), `client_scope`/`team_scope app.data_scope`, `mfa_required bool`, `status CHECK IN (ACTIVE, SUSPENDED, REMOVED)`, `is_default bool`. Three check constraints tie agent identity together: `(actor_kind='AGENT') = (agent_id IS NOT NULL)`, an AGENT must hold role `AGENT`, a TRAINER must carry a `trainer_id`. Partial unique indexes: one default membership per user, one agent id per tenant. `tenant_id` and `user_id` are frozen by `app.enforce_immutable_columns` — allowing either to move would silently transplant a role into another tenant. **No DELETE policy**: removal is `status = 'REMOVED'`, so "who had access in November" stays answerable.

### `public.user_profiles` — 002 ⚠ AUTHOR ADDITION
`PRIMARY KEY (tenant_id, user_id)`, `display_name`, `email citext`, `locale`, `timezone`, `theme CHECK IN (LIGHT, DARK)`, `avatar_url`. Doc 02 §1.2 assigns it to sb-erd and names only the two columns it requires; doc 01 never defines it. Created here so the identity layer is complete rather than split across a lane boundary; the remaining columns come from the `GET /v1/me` shape in contract §2.

### `app.role_permissions` — 002
`(role app.app_role, permission text) PRIMARY KEY`, permission shape enforced by `CHECK (permission ~ '^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)+$')`. 399 rows over 109 permissions. **No RLS and no grants**: `app` is not exposed to PostgREST and no role holds SELECT; it is reached only through `app.has_permission()`, which is SECURITY DEFINER for exactly that reason.

---

## Indexes

### public.teams — 002
`teams_tenant_id_idx (tenant_id)` · `teams_manager_user_id_idx (manager_user_id)`

### public.team_members — 002
`team_members_tenant_user_idx (tenant_id, user_id)` · `team_members_user_idx (user_id)`

### public.memberships — 002
`memberships_user_id_idx (user_id)` — the hook searches by user ACROSS tenants, so the `(tenant_id, user_id)` PK does not serve it ·
`memberships_one_default_per_user UNIQUE (user_id) WHERE is_default AND status='ACTIVE'` ·
`memberships_agent_unique UNIQUE (tenant_id, agent_id) WHERE agent_id IS NOT NULL`

### public.user_profiles — 002
`user_profiles_user_id_idx (user_id)`

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

#### Claim readers — 002
All `STABLE`, all reading nothing but `request.jwt.claims`, none `SECURITY DEFINER` because there is nothing to define away — they tell the caller about the caller. `app.jwt() → jsonb` · `app.current_tenant_id() → uuid` · `app.role() → app.app_role` · `app.actor_kind() → app.actor_kind` · `app.client_scope()` / `app.team_scope() → app.data_scope` · `app.aal() → text` · `app.is_agent() → boolean` · `app.agent_id() → text` · `app.trainer_id() → uuid`. **Every one defaults to the LEAST privilege when the claim is absent** — no tenant, no role, `MY_ACCOUNTS`, `aal1` — pinned by T4.

#### `app.has_permission(text)` → boolean — 002
`STABLE SECURITY DEFINER`. Purely so no login role needs SELECT on `app.role_permissions`. Takes no identity argument and reads only the caller's own claim, so there is no privilege to escalate — the self-check the Supabase guidance requires is structural here rather than written out. EXECUTE to `authenticated`.

#### `app.my_team_user_ids()` → uuid[] — 002
`STABLE SECURITY DEFINER`. Reads `team_members` without that table's policy recursing into it. Resolves the caller from `auth.uid()` internally, so it cannot be pointed at someone else's team. Returns an array the policies test with `= ANY(...)` — the flattening the Supabase RLS-performance guidance prescribes, done once instead of per policy.

#### `app.can_see_owner(uuid)` → boolean — 002
`STABLE`. `ALL` → true; `MY_TEAM` → owner is in `my_team_user_ids()`; otherwise owner is the caller. See the dated entry above for the compile error in the doc's version of this body and why the `::uuid[]` cast matters for the InitPlan.

#### `app.require_tenant_id()` → uuid — 002
`STABLE`, raises `NO_TENANT` when the claim is absent. **For gate functions only. A POLICY MUST NOT CALL THIS** — a predicate that raises turns an empty result set into a 500, which is both a worse experience and an existence oracle.

#### `app.has_role(text)` → boolean — 002
Exists because sb-actions asked for it. Prefer `app.has_permission()` wherever a permission string fits: the matrix is data, so an MD can move a permission between roles without a migration, while a role check hard-codes today's matrix into the caller.

#### `app.current_actor()` → table(actor_id text, actor_kind text, role text) — 002
sb-actions' actor record. `actor_kind` has four values: portal RPCs write `CLIENT`.

#### `app.principal_claims(uuid)` → jsonb — 002
`STABLE SECURITY DEFINER`. The SINGLE claim-building body. Resolves the caller's default ACTIVE membership in an ACTIVE tenant and returns the nine identity claims. A user with no active membership gets `{tenant_id: null, app_role: null, actor_kind: 'HUMAN'}` — claims that satisfy no policy anywhere, which is the correct failure direction.

#### `app.custom_access_token_hook(jsonb)` → jsonb — 002
GoTrue hook; merges `app.principal_claims()` into the event's claims. EXECUTE to `supabase_auth_admin` ONLY. That role is neither superuser nor `BYPASSRLS`, so it needs the SELECT grants AND the two `*_auth_admin_read` policies — without them the hook returns no row, every token issues with `tenant_id: null`, and the only symptom is that nobody can see anything.

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

## Migration Detail — 004 (`004_shell_config_and_ref_allocation.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED.** Sources: `docs/architecture/01` §3.6 and
Conventions, `docs/architecture/02` §4.1, `docs/architecture/03` §1.1, DECISIONS §4.

### What it does

Fourteen `core` tables plus global `app.action_types`, `app.finalise_table()`, `core.next_ref()` and
`core.assign_ref()`. See the Tables and RPC sections. Three design points carry the weight:

- **The finaliser is a spine object.** Every table migration from 005 on goes through it, so a
  defect is a defect in eighty tables at once and will not look like one.
- **It refuses an untenanted table.** `RAISE ... undefined_column` rather than silently finalising
  something no policy can isolate.
- **It is migration-role only.** It runs `EXECUTE format(...)` on its arguments. Every identifier is
  quoted with `%I` AND `EXECUTE` is revoked from every client role, because either alone would be
  insufficient — a client-reachable function of this shape is an arbitrary-DDL primitive.

### The 7-point RPC contract check, worked

1. **Envelope** — no client-callable RPC. 2. **Unwrap** — no envelope crosses the boundary.
3. **RpcMap** — none; these are tables the Data API reads directly once 014 grants them.
4. **Call sites** — `finalise_table` is called by 005–013; `assign_ref` fires on every table with a
   `ref`. 5. **Casts** — none. 6. **Reload/restore** — no client behaviour yet.
7. **Public routes** — none; `anon` receives nothing.

### Pin — `tests/test_004_shell_config_and_ref_allocation.sql`

Eight checks, all executed, all PASS. T1 every `core` table RLS-forced with **zero** policies ·
T2 undated and dated refs match the contract's `TPL-0001` / `ENQ-2026-0001` shapes · T3 an explicit
ref is honoured then frozen, and a row cannot be transplanted between tenants · **T4 counters are
per tenant** (a global counter leaks record volume across customers and no access-control test would
catch it) · **T5 the FINALISER itself**, on a throwaway table, all eight properties asserted
including behaviour: allocation, `updated_at` override, and the extra frozen column · T6 it refuses
an untenanted table and a missing one · T7 neither `finalise_table` nor `next_ref` is client-callable
· T8 the two constraints that encode a business rule — a non-WhatsApp template may not carry a
per-message rate, and a `MEASURED` hours-saved basis may not exist without a sign-off, because that
is how an illustrative number becomes a published ROI claim.

**RLS four-way: deliberately deferred to test_014.** These tables have RLS forced and no policies, so
every impersonated read returns nothing and would prove nothing.

### Rollback — `rollbacks/004_shell_config_and_ref_allocation_rollback.sql`

Header carries the export commands and states what is not derivable: pipelines and steps are the only
definition of stage names and order; templates are the only copy a sent proposal renders from.
**`attachments` and `signatures` get their own guard**: dropping `attachments` destroys the index
into object storage while the objects survive unreferenced and unfindable, and a `signatures` row IS
the evidence — signer, timestamp, IP, method — with no copy in the bucket. Four guards (G0 already
rolled back, G1 a `core` table 004 did not create, G2 any attachment or signature row, G3 any
`app.action_types` row). CASCADE is used here and explicitly justified as safe only because G1 has
already proved nothing outside 004 exists in `core` — with a pointer to rollback 003's header for
the case where CASCADE would have silently dropped a column. Round-tripped, idempotent.

---

## Migration Detail — 003 (`003_enum_types.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED.** Source: `docs/architecture/01` Conventions
(the enum-versus-reference-table split and the type list), `packages/contract/src/enums.ts` (the
values), contract §12 and §17.

### What it does

69 `CREATE TYPE ... AS ENUM` in `core`, each idempotent behind a `duplicate_object` handler and each
carrying a `COMMENT` recording its source. No table, no function, no policy, no grant — a type is
not a privileged object and there is nothing sensitive in a label.

### The 7-point RPC contract check, worked

1. **Envelope** / 2. **Unwrap** — no RPC, no jsonb across the boundary.
3. **RpcMap** — no entries, but this is the one migration where the SQL and
   `packages/contract/src/enums.ts` MUST stay in lockstep, and it is generated from that file
   precisely so they do.
4. **Call sites** — every domain table in 004–013 types a column with one of these. Zero today is
   expected.
5. **Casts** — none. 6. **Reload/restore** — no behaviour. 7. **Public routes** — none.

### Pin — `tests/test_003_enum_types.sql`

Six checks, all executed, all PASS. The expected list is generated from the migration, so pin and
migration are the same list by construction and a disagreement means one was hand-edited.
T1 all 69 types exist · T2 no UNEXPECTED type crept in (one nobody generated is one somebody typed) ·
T3 every label matches **in declaration order** · T4 ordering is semantic, demonstrated:
`BREACHING < TODAY` and `OBSERVE < AUTONOMOUS`, so a ceiling comparison written `level <= ceiling`
keeps meaning what it says · T5 every type carries its provenance comment · T6 `actor_kind` and
`app_role` exist in `app` and NOT in `core`.

**RLS four-way: not applicable** — 003 creates no table.

### Rollback — `rollbacks/003_enum_types_rollback.sql`

One guard that answers the real question in one message: which columns are still declared with a
`core` enum, so the operator knows which migration to roll back first, rather than sixty-nine
separate refusals. Drops are alphabetical because enum types do not depend on one another, and
pretending there is a dependency order would imply one exists. **CASCADE is deliberately absent and
must not be added** — it drops the dependent column rather than refusing. Round-tripped: applied →
rolled back → re-applied, verify green each time.

---

## Migration Detail — 002 (`002_tenancy_identity_and_permissions.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED to any hosted database.** Sources:
`docs/architecture/02` §1.2, §1.3, §2.2, §2.3, §2.4, §3.1, §4.1, §4.3.

### What it does

See the Tables and RPC sections above. Three things are worth restating because they are the
reasons this migration is dangerous:

- **RLS is FORCED, not merely enabled.** Forcing removes the table owner's exemption, so a function
  running as `postgres` no longer silently sees every tenant. It does not affect `service_role`,
  which holds `BYPASSRLS` and bypasses regardless — intended, and the reason `service_role` must
  never reach a browser.
- **`memberships_no_self_edit` is RESTRICTIVE.** A permissive policy of the same name reads
  identically in a diff and does the opposite: permissive is an OR branch that grants, restrictive
  is the AND that denies. T6c asserts `permissive = 'RESTRICTIVE'` off `pg_policies` for exactly
  that reason.
- **Grants are the floor under RLS, not a substitute.** `anon` holds no table grant at all, so it is
  refused before a policy is ever consulted. T5e2 asserts that distinction rather than accepting an
  empty result: a future migration that hands `anon` a SELECT grant would still return 0 rows under
  RLS and would look identical to a pin that only counted.

### The 7-point RPC contract check, worked

1. **Envelope** — no RPC added; nothing here returns an envelope. `app.principal_claims` returns
   jsonb, but it is a GoTrue-internal shape and `app` is not an exposed schema.
2. **Unwrap** — not applicable; no jsonb envelope crosses the API boundary.
3. **RpcMap** — no entries. `packages/contract/src` describes HTTP endpoints; none of these
   functions is one.
4. **Call sites** — `app.current_tenant_id`, `app.has_permission`, `app.can_see_owner`, `app.aal`
   and `app.role` are consumed by every policy in 014 and by the gate in 011. Zero consumers today
   is expected, not a dead-RPC finding: the consumers are later migrations in this same set.
5. **Casts** — one, and it is load-bearing: `(SELECT app.my_team_user_ids())::uuid[]`. It is not a
   compiler bypass, it is what selects the array form of `ANY` over the subquery form. See the dated
   entry.
6. **Reload/restore** — ⚠ **a role or scope change does NOT take effect until the access token
   refreshes**, because those are claims rather than a lookup. Doc 02 §7.4 requires forcing
   `refreshSession()` after any privilege change. That is a client obligation this migration cannot
   enforce; it is recorded here so it is not later discovered as a bug.
7. **Public routes** — none. `anon` holds EXECUTE on nothing and SELECT on nothing (T11).

### Pin — `tests/test_002_tenancy_identity_and_permissions.sql`

Twelve checks, all executed, all PASS.
T1 five tables RLS enabled + forced ·
T2 no policy left at the implicit PUBLIC (which would also match `anon`) ·
T3 399 grants / 109 permissions and all three of doc 02's deliberate asymmetries, plus that a
scope-narrowed `○` was stored as a GRANT and not a denial ·
T4 claim readers read the claim, and absent claims default to least privilege ·
**T5 THE FOUR-WAY MATRIX** on one membership row — owner 1, same-tenant peer 0, other tenant 0
(and other tenant sees exactly 1 tenant row, its own), `anon` DENIED_BY_GRANT, and a **positive
control**: the tenant's ADMIN sees 1. Without the positive control, "everything is denied" passes
as a security property ·
T6 an ADMIN cannot edit their OWN membership but CAN edit someone else's, and the policy is
RESTRICTIVE ·
T7 an ADMIN write at `aal1` is refused — MFA lives in the policy, not in a front-end route guard ·
T8 `can_see_owner` across all three scopes, including that `MY_TEAM` does NOT see the other team ·
T9 the hook resolves tenant, role, scope and team **as `supabase_auth_admin`**, and T9b that an
unknown user receives claims satisfying nothing ·
T10 a membership cannot be transplanted into another tenant ·
T11 `anon` holds no EXECUTE in `app` and no SELECT anywhere.

Fixtures: two tenants, five `auth.users`, two teams. The second tenant exists for exactly one
purpose — to be invisible.

### Rollback — `rollbacks/002_tenancy_identity_and_permissions_rollback.sql`

Header carries the export commands for the three tables that cannot be reconstructed
(`tenants`, `memberships`, `team_members`) and states plainly that dropping `memberships` destroys
the only record of who had access to which tenant in which role.

Five guards, none with an override: **G0** already rolled back → say so and stop; **G1** any table
in `core`; **G2** any `app` function neither 001 nor 002 created; **G3** any foreign key into
`public.tenants` from outside 002 (using `to_regclass`, never a bare `::regclass` cast, which
raises on a missing relation); **G4** `app.role_permissions` no longer holds exactly the 399 seeded
rows, which means an operator edited the live matrix and re-applying 002 would NOT restore it —
`ON CONFLICT DO NOTHING` re-adds the seed but cannot resurrect a deleted row.

**G1, G2 and G4 were tested by making each condition true** and confirming the refusal and its
message, not by reading them. Drop order is the reverse of forward, with the enum types last
because `memberships` columns depend on them. Round-tripped: applied → rolled back → rolled back
AGAIN (idempotent, says "nothing to do") → re-applied → pin green.

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
