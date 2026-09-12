# TrainOS — tenancy, authentication, roles and row-level security

Owner: sb-tenancy · Status: design, ready for migration authoring · Target platform: Supabase (Postgres 15+, GoTrue, PostgREST, Edge Functions, Vault)

Scope of this document: how a request is attributed to a tenant, who the nine roles are, what
they may do, how the `AGENT` service principal authenticates, and the row-level security policy
for every table family. It stops at the boundary of four sibling designs:

| Owned elsewhere | Owner | This document's relationship |
|---|---|---|
| Domain model and ERD | `sb-erd` | Table and column names below are the RLS-relevant subset. Where I name a column `sb-erd` has not published, it is marked **[assumed]**. |
| Action envelope, policy gate, approvals | `sb-actions` | RLS never evaluates the autonomy matrix. See §3.4 for the exact split. |
| Money, rate cards, rule versioning, provenance | `sb-money` | I add `tenant_id` and an owner column to those tables and nothing else. |
| Events, outbox, realtime, audit | `sb-events` | I name the events I emit. I do not define the audit table. |

---

## Phase 1 — decisions taken and claims relied on

**Decisions taken in this document.**

1. **Shared schema, `tenant_id` on every row.** Not schema-per-tenant, not database-per-tenant.
2. **Tenant comes from a TOP-LEVEL JWT claim written by a custom access token hook**, not from a
   per-request profile lookup and **not from `app_metadata`**. Identity claims only: `tenant_id`,
   `app_role`, `actor_kind`, `agent_id`, `team_id`, `client_scope`, `team_scope`. Read through
   `app.current_tenant_id()`.
3. **Permissions are NOT in the JWT.** They resolve from a small static table through
   `app.has_permission()`. Reason in §1.4: a revoked permission must bite immediately, not at the
   next token refresh, and a 90-entry array on every request is dead weight.
4. **Nine application roles live in data, not in `pg_roles`.** Postgres grants stay at
   `anon` / `authenticated` / `service_role`.
5. **`CLIENT` is an actor kind, not a login.** §11 says the portal is unauthenticated by token, so
   there are no client auth users at launch.
6. **An agent credential is a hashed, revocable API key per agent per tenant**, exchanged for a
   GoTrue session whose claims the §1.3 hook injects (this answers §16 Q7 with *per tenant*).
   Revised twice: from a password credential after the research doc, then away from a self-minted
   JWT after the `spike-jwt` spike. See §3.1, §3.1a and §10.
7. **The kill switch is enforced in RLS as a blunt fact** (agent active, switch off, table family in
   the agent's scopes). Autonomy levels stay in the policy gate.
8. **Portal tokens are hashed at rest** and reachable only through `SECURITY DEFINER` RPCs called by
   `anon`. No `anon` policy exists on any base table.
9. **BYOK keys go in Supabase Vault.** The public row holds a masked string and a fingerprint. The
   vault secret id lives in a private schema with no grants at all.
10. **AAL2 is required for `MD` and `ADMIN`**, enforced by a RESTRICTIVE policy so it ANDs with
    everything else rather than being one more OR branch someone can forget.

**Claims I rely on from the Supabase Postgres best-practices skill** (loaded; files
`security-rls-basics.md`, `security-rls-performance.md`, `security-privileges.md`,
`query-missing-indexes.md`, `schema-foreign-key-indexes.md`):

- RLS is the isolation boundary; application-level filtering is not (`security-rls-basics`).
- Wrap every function call in a policy in `(select …)` so it becomes an InitPlan evaluated once per
  statement rather than once per row; the skill reports 100x on large tables
  (`security-rls-performance`).
- `SECURITY DEFINER` helpers belong in a non-exposed schema with `set search_path = ''` and
  `EXECUTE` revoked from `public`/`anon` (`security-rls-performance`).
- Every column referenced by a policy needs an index (`security-rls-performance`,
  `query-missing-indexes`).
- Least privilege: revoke the `public` defaults rather than granting broadly (`security-privileges`).

**Claims relied on from `docs/research/08-supabase-agentic-best-practices.md`** (read in full;
reconciliation in §10): §1 on the custom access token hook over a profile lookup, the initplan
wrapper, the `tenant_id` leading-key caveat, `TO authenticated` on every policy, and `service_role`
/ `BYPASSRLS` semantics. §2 on machine principals — the `agents` table plus hashed revocable API key
plus minted short-lived JWT, and the explicit rejection of one shared secret key for all agents.
§8 on Vault for BYOK, the hash-versus-reversible-encryption distinction, atomic decrypt-and-audit,
and the root-key rotation trap. §10 on PKCE, `getUser()` versus `getClaims()`, and the RESTRICTIVE
`aal2` policy. §13 on the `sb_publishable_` / `sb_secret_` key formats and ES256 signing keys. The
research doc flags its §2 and §3 as original synthesis rather than first-party Supabase guidance, and
I carry that caveat forward in §11.

---

## 0 · Cross-lane conventions

The five things the other four lanes need from here, in one place, so nobody reconstructs them.
Agreed with `sb-actions`, `sb-events` and `sb-money` in review.

| Convention | Value | Trap |
|---|---|---|
| Tenant claim path | **top-level** `tenant_id`, read via `app.current_tenant_id()` | `auth.jwt() -> 'app_metadata' ->> 'tenant_id'` returns **null**, not an error. Every policy then denies everything and it presents as a permissions bug. |
| Helper spelling | `app.current_tenant_id()`, not `app.tenant_id()` | `sb-actions` and `sb-events` converged on this name independently; mine was renamed to match. |
| Raising vs returning null | `app.current_tenant_id()` returns null; `app.require_tenant_id()` raises | Never call the raising one from a policy: a predicate that raises turns a denied read into a 500 instead of an empty set. |
| Tenant column | `tenant_id uuid not null`, **leading** column of every tenant-scoped composite index | A PK keyed `(id, tenant_id)` gives no usable index on `tenant_id` alone, and the policy seq-scans. One exception: Template E (§4.2). |
| Actor kinds | **four** — `HUMAN`, `AGENT`, `SYSTEM`, `CLIENT` | Portal RPCs write `CLIENT`. A three-value enum breaks on the first proposal acceptance. |
| Agent principal | per agent **per tenant**, so the tenant is trustworthy from the JWT | Answers §16 Q7. Agent-authored rows do not need the tenant read off the row. |
| Schemas | `core` = the domain (exposed) · `public` = identity and tenancy only (exposed) · `app` = helpers and the gate (**not** exposed) | Settled by migration 001 as conflict C1; doc 03 outranked my draft, which wrote the domain as `public.*`. My whole §4 catalogue is retargeted onto `core`. |
| Anything an endpoint renders | must be in `core` or `public` | A table in `app` is unreachable by the Data API, with no error to explain it. Gate functions belong in `app`; tables an endpoint renders do not. This has now bitten two lanes. |
| Minting JWTs | **Nobody mints tokens. Ever.** All tokens are GoTrue-issued | A holder of the project signing key can sign `role: service_role` and bypass every policy in this document. §3.1a. If a lane thinks it needs to mint, bring it to me first. |
| Committing | `git commit <path> -m "…"`, never `git add` then a bare commit | We share one index on `main`. A bare commit sweeps up every other lane's staged work. |

Prefer `app.has_permission('approval:decide')` to `app.has_role('SALES_MANAGER')` everywhere. The
role-to-permission matrix is data (§1.4), so an MD can move a permission between roles without a
migration; a role check hard-codes today's matrix into the caller.

---

## 1 · Tenancy model

### 1.1 Why shared-schema

TrainOS tenants are Malaysian training providers with tens of users each, not thousands. The
contract's §1 rule — *"Tenant is implicit from auth and never appears in a path or body"* — means
the client never names a tenant, so there is nothing to gain from physical separation and a great
deal to lose: schema-per-tenant multiplies every migration by the tenant count, breaks
`GET /v1/search` across the estate, and makes the `AGENT` principal's connection pooling
pathological. One schema, `tenant_id uuid not null` on every tenant-scoped table, RLS as the wall.

### 1.2 Core tables

```sql
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, anon, service_role;

create type app.app_role as enum (
  'SALES','SALES_MANAGER','OPS','FINANCE','MD','ADMIN','TRAINER','CLIENT','AGENT');

create type app.actor_kind as enum ('HUMAN','AGENT','SYSTEM','CLIENT');

create type app.data_scope as enum ('MY_ACCOUNTS','MY_TEAM','ALL');

create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name          text not null,
  status        text not null default 'ACTIVE'
                  check (status in ('ACTIVE','SUSPENDED','CLOSED')),
  timezone      text not null default 'Asia/Kuala_Lumpur',
  locale        text not null default 'en-MY',
  created_at    timestamptz not null default now()
);

create table public.teams (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,
  manager_user_id uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (tenant_id, name)
);
create index teams_tenant_id_idx on public.teams (tenant_id);
create index teams_manager_user_id_idx on public.teams (manager_user_id);

create table public.team_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  team_id   uuid not null references public.teams(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  primary key (team_id, user_id)
);
create index team_members_tenant_user_idx on public.team_members (tenant_id, user_id);
create index team_members_user_idx on public.team_members (user_id);

create table public.memberships (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          app.app_role not null,
  actor_kind    app.actor_kind not null default 'HUMAN',
  agent_id      text,                    -- 'agent_proposal'; null unless actor_kind = 'AGENT'
  primary_team_id uuid references public.teams(id) on delete set null,
  trainer_id    uuid,                    -- [assumed] fk to sb-erd's core.trainers(id)
  client_scope  app.data_scope not null default 'MY_ACCOUNTS',
  team_scope    app.data_scope not null default 'MY_TEAM',
  mfa_required  boolean not null default false,
  status        text not null default 'ACTIVE'
                  check (status in ('ACTIVE','SUSPENDED','REMOVED')),
  is_default    boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, user_id),
  constraint memberships_agent_id_matches_kind
    check ((actor_kind = 'AGENT') = (agent_id is not null)),
  constraint memberships_agent_role
    check (actor_kind <> 'AGENT' or role = 'AGENT'),
  constraint memberships_trainer_id_present
    check (role <> 'TRAINER' or trainer_id is not null)
);
create index memberships_user_id_idx on public.memberships (user_id);
create unique index memberships_one_default_per_user
  on public.memberships (user_id) where is_default and status = 'ACTIVE';
create unique index memberships_agent_unique
  on public.memberships (tenant_id, agent_id) where agent_id is not null;
```

`memberships` is keyed `(tenant_id, user_id)`, so a human *can* hold memberships in more than one
tenant. Nothing in the contract needs that at launch — there is no tenant switcher and §1 forbids a
tenant in the path — so the hook pins the single `is_default` row. The extension point is documented
in §1.5 rather than built.

`user_profiles` (display name, locale, timezone, theme — the rest of `GET /me`) belongs to `sb-erd`.
All I require of it is `tenant_id uuid not null` and `user_id uuid not null references auth.users`.

### 1.3 Resolving the tenant: the custom access token hook

```sql
create or replace function app.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  m       record;
begin
  select mb.tenant_id, mb.role, mb.actor_kind, mb.agent_id,
         mb.primary_team_id, mb.trainer_id, mb.client_scope, mb.team_scope, mb.mfa_required
    into m
  from public.memberships mb
  join public.tenants t on t.id = mb.tenant_id
  where mb.user_id = (event ->> 'user_id')::uuid
    and mb.status  = 'ACTIVE'
    and t.status   = 'ACTIVE'
  order by mb.is_default desc, mb.created_at asc
  limit 1;

  if m.tenant_id is null then
    -- No active membership: issue a token that satisfies no policy anywhere.
    claims := claims || jsonb_build_object('tenant_id', null, 'app_role', null,
                                           'actor_kind', 'HUMAN');
  else
    claims := claims || jsonb_build_object(
      'tenant_id',    m.tenant_id,
      'app_role',     m.role,
      'actor_kind',   m.actor_kind,
      'agent_id',     m.agent_id,
      'team_id',      m.primary_team_id,
      'trainer_id',   m.trainer_id,
      'client_scope', m.client_scope,
      'team_scope',   m.team_scope,
      'mfa_required', m.mfa_required
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;
```

The grants GoTrue needs are easy to forget and the hook fails closed without them:

```sql
grant usage  on schema app to supabase_auth_admin;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function app.custom_access_token_hook(jsonb)
  from authenticated, anon, public;

grant select on public.memberships, public.tenants to supabase_auth_admin;

-- memberships has RLS on (§4.1). supabase_auth_admin is not BYPASSRLS, so it needs a policy.
create policy memberships_auth_admin_read on public.memberships
  for select to supabase_auth_admin using (true);
create policy tenants_auth_admin_read on public.tenants
  for select to supabase_auth_admin using (true);
```

Enable it in `config.toml` / dashboard: `auth.hook.custom_access_token.enabled = true`,
`uri = "pg-functions://postgres/app/custom_access_token_hook"`.

### 1.4 Why claims for identity but a lookup for permissions

The brief asked me to choose between claims and a profile lookup. The honest answer is different per
field, because the two have opposite failure modes.

| | JWT claim | Per-request lookup |
|---|---|---|
| Cost | Zero extra reads | One indexed read per policy evaluation, per statement |
| Revocation latency | Up to the access-token TTL | Immediate |
| Blast radius if stale | The whole session acts as the old identity | None |

`tenant_id`, `actor_kind`, `agent_id` and `trainer_id` are *identity*. They do not change during a
session's life, and if one ever does, the correct response is to kill the session, not to hope the
next query notices. Claims.

`permissions[]` is *authorisation*. It changes when an admin edits the role matrix, and an
administrator who removes `invoice:push` from `OPS` expects that to bite now, not in fifty minutes.
It is also the biggest field: the ADMIN role carries roughly ninety strings, which is about 2.2 KB
before base64 and rides on every single request including the ones that do not need it. Lookup.

`app_role` sits between the two. I put it in the claim (it is one short string, it is how the UI
renders, and it is the join key for the permission lookup) and pay for that choice with a shorter
access-token TTL (§7.3) plus mandatory refresh-token revocation on role change (§7.4).

This split is not a deviation from Supabase's guidance — it *is* Supabase's guidance. The research
doc's §1 quotes the [Custom Claims & RBAC guide](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac.md)
canonical shape: the hook queries a `user_roles` / `role_permissions` pair, adds a **role** claim,
and an `authorize()` SQL helper checks the permission inside policies. `app.role_permissions` and
`app.has_permission()` are that pattern with our names. The research also confirms the staleness
caveat from the same doc — claims refresh only when the token refreshes — and its remedy: force
`refreshSession()` after any privilege change that must bite immediately (§7.4).

The lookup table is deliberately tiny and never grows with tenants:

```sql
create table app.role_permissions (
  role       app.app_role not null,
  permission text not null check (permission ~ '^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)+$'),
  primary key (role, permission)
);
-- No RLS: the app schema is not in PostgREST's exposed schemas and no role is granted select.
-- It is reached only through app.has_permission(), which is SECURITY DEFINER.
```

Two or three hundred rows, fully cached, hit by an index-only scan once per statement because
`app.has_permission()` is `STABLE` and every call site wraps it in `(select …)`.

### 1.5 Multi-tenant humans (not built at launch)

If a consultant ever needs two tenants, the path is: a `POST /v1/session/tenant` endpoint on an Edge
Function that verifies an ACTIVE membership, writes `app_metadata.active_tenant_id` through the
admin API, and forces a token refresh; the hook then prefers `event->'claims'->'app_metadata'->>'active_tenant_id'`
over `is_default`. No RLS policy changes. Flagged as an open question (§9, OQ-T3) because it changes
the audit story — "which tenant was this user in at 09:14" becomes a question the session log has to
answer.

---

## 2 · Role model

### 2.1 The nine roles

| Role | Who | Auth? | Default `client_scope` | Default `team_scope` | MFA |
|---|---|---|---|---|---|
| `SALES` | Consultant owning accounts | Yes | `MY_ACCOUNTS` | `MY_TEAM` | Optional |
| `SALES_MANAGER` | Approves sends and discounts | Yes | `MY_TEAM` | `MY_TEAM` | Optional |
| `OPS` | Scheduling, delivery, attendance | Yes | `ALL` | `ALL` | Optional |
| `FINANCE` | Invoicing, collections, HRD Corp | Yes | `ALL` | `ALL` | Optional |
| `MD` | Managing Director; autonomy, budgets, escalations | Yes | `ALL` | `ALL` | **Required** |
| `ADMIN` | System admin; agents, tiers, provider keys | Yes | `ALL` | `ALL` | **Required** |
| `TRAINER` | Delivers; sees only their engagements | Yes | *n/a* — trainer scope (§2.4) | *n/a* | Optional |
| `CLIENT` | Portal visitor | **No** — token only (§5) | *n/a* | *n/a* | *n/a* |
| `AGENT` | Service principal, one per agent per tenant | Yes (§3) | `ALL` within its scopes | `ALL` | *n/a* |

`CLIENT` is the one that is not what it looks like. §11 defines the portal as *"unauthenticated
signed link"* and §6 shows `completedBy.kind: "CLIENT"`. So `CLIENT` is an `actor_kind` stamped on
rows written by portal RPCs — identity being the token plus the self-declared name from
`POST /public/proposals/{token}/accept` — and it is in the `app_role` enum only so that
`FORBIDDEN.details.requiredRole` can name it. No `CLIENT` membership row is ever created at launch.

### 2.2 The permission catalogue

Derived from every gated endpoint in §13, the action-type list in §3, and the §17 update pass.
Permission strings follow the §2 sample shape `object:verb`.

**Session and shell**

| Permission | Source |
|---|---|
| `navigation:read` · `search:read` · `audit:read` | §2 |
| `view:read` · `view:write` · `view:share` | §2, M02-S01, M03-S01 |
| `template:read` · `template:write` | §2, M07-S02 |
| `policy:read` · `policy:write` | §2, M07-S02 |
| `pipeline:read` | §5, M04-S02 |

**Enquiries, leads, follow-ups (M03-S01, M03-S02, M03-S06)**

`enquiry:read` · `enquiry:assign` · `enquiry:edit_extraction` · `enquiry:archive` ·
`enquiry:convert` · `followup:read` · `followup:draft` · `followup:send` · `contact:consent:read`

**Organisations, contacts, opportunities (M04-S02)**

`organisation:read` · `organisation:write` · `organisation:suggestions:read` ·
`organisation:metrics:read` · `contact:read` · `contact:write` · `opportunity:read` ·
`opportunity:write` · `opportunity:stage`

**TNA, programmes, trainers (M05-S02, M06-S02)**

`tna:read` · `tna:write` · `tna:reopen` · `tna:recommendation:accept` · `programme:read` ·
`programme:write` · `trainer:read` · `trainer:write` · `trainer:book`

**Proposals and quotations (M07-S02, M07-S03)**

`proposal:read` · `proposal:write` · `proposal:regenerate` · `proposal:preview` ·
`proposal:send` · `proposal:share` · `quotation:read` · `quotation:write` · `quotation:apply` ·
`discount:approve`

**Approvals (M02-S01, M02-S02)**

`approval:read` · `approval:decide` · `approval:bulk_decide` · `approval:reassign`

**Engagements, participants, attendance (M09-S02, M10-S06)**

`engagement:read` · `engagement:write` · `engagement:close_out` · `participant:read` ·
`participant:write` · `attendance:read` · `attendance:capture` · `attendance:approve` ·
`attendance:unlock` · `attendance:export`

**HRD Corp and finance (M12-S02, M13-S02, M13-S05)**

`hrdc:read` · `hrdc:document:write` · `hrdc:export` · `hrdc:mark_submitted` · `invoice:read` ·
`invoice:create` · `invoice:push` · `payment:record` · `receivable:read` · `collection:read` ·
`collection:remind` · `broadcast:send`

**Agents and runs (M18-S01, M18-S04)**

`agent:read` · `agent:autonomy` · `agent:pause` · `run:read` · `run:retry` · `run:dead_letter` ·
`run:replay` · `eval:read`

**Dashboards and reports (M01-S01)**

`dashboard:read` · `dashboard:executive:read` · `metric:read` · `report:read`

**AI operations (M20-S20, M20-S21, M20-S16)**

`ai:tier:read` · `ai:tier:write` · `ai:routing:read` · `ai:routing:write` · `ai:provider:read` ·
`ai:provider:write` · `ai:provider:test` · `ai:provider:rotate` · `ai:provider:reveal` ·
`ai:provider:delete` · `ai:usage:read` · `ai:budget:read` · `ai:budget:write` · `ai:budget:raise`

**Compliance and knowledge (M12-S07, M12-S08, M16-S05)**

`compliance:rule:read` · `compliance:rule:write` · `compliance:rule:approve` ·
`compliance:check:read` · `knowledge:source:read` · `knowledge:source:write` ·
`knowledge:source:reingest`

**Client portal (M07-S07, issuer side)**

`portal:token:issue` · `portal:token:revoke`

Ninety-four strings. `me:read` is not a permission: every authenticated principal with a live
membership may call `GET /v1/me`.

### 2.3 Role → permission matrix

`●` granted · `○` granted but narrowed by data scope (§2.4) · blank denied.
`CLIENT` has no column: it never authenticates. `AGENT` is covered in §3.2 because it is scoped per
agent rather than per role.

| Permission group | SALES | SALES_MANAGER | OPS | FINANCE | MD | ADMIN | TRAINER |
|---|---|---|---|---|---|---|---|
| `navigation:read` `search:read` `audit:read` | ● | ● | ● | ● | ● | ● | ● |
| `view:read` `view:write` | ● | ● | ● | ● | ● | ● | |
| `view:share` | | ● | ● | ● | ● | ● | |
| `template:read` | ● | ● | ● | ● | ● | ● | |
| `template:write` | | | | | | ● | |
| `policy:read` | ● | ● | ● | ● | ● | ● | |
| `policy:write` | | | | | | ● | |
| `pipeline:read` | ● | ● | ● | ● | ● | ● | ● |
| `enquiry:read` | ○ | ○ | | | ● | ● | |
| `enquiry:assign` | | ● | | | ● | ● | |
| `enquiry:edit_extraction` `enquiry:archive` `enquiry:convert` | ○ | ○ | | | ● | ● | |
| `followup:read` `followup:draft` | ○ | ○ | | | ● | ● | |
| `followup:send` | ○ | ○ | | | ● | ● | |
| `contact:consent:read` | ○ | ○ | ● | ● | ● | ● | |
| `organisation:read` `organisation:metrics:read` | ○ | ○ | ● | ● | ● | ● | |
| `organisation:write` | ○ | ○ | | | ● | ● | |
| `organisation:suggestions:read` | ○ | ○ | | | ● | ● | |
| `contact:read` | ○ | ○ | ● | ● | ● | ● | |
| `contact:write` | ○ | ○ | ● | | ● | ● | |
| `opportunity:read` | ○ | ○ | ● | ● | ● | ● | |
| `opportunity:write` `opportunity:stage` | ○ | ○ | | | ● | ● | |
| `tna:read` | ○ | ○ | ● | | ● | ● | |
| `tna:write` `tna:reopen` `tna:recommendation:accept` | ○ | ○ | | | ● | ● | |
| `programme:read` | ● | ● | ● | ● | ● | ● | ● |
| `programme:write` | | | | | | ● | |
| `trainer:read` | ● | ● | ● | ● | ● | ● | |
| `trainer:write` | | | ● | | ● | ● | |
| `trainer:book` | | | ● | | ● | ● | |
| `proposal:read` `proposal:preview` | ○ | ○ | ● | ● | ● | ● | |
| `proposal:write` `proposal:regenerate` | ○ | ○ | | | ● | ● | |
| `proposal:send` | ○ | ○ | | | ● | ● | |
| `proposal:share` `portal:token:issue` | ○ | ○ | | | ● | ● | |
| `portal:token:revoke` | ○ | ● | | | ● | ● | |
| `quotation:read` | ○ | ○ | | ● | ● | ● | |
| `quotation:write` `quotation:apply` | ○ | ○ | | ● | ● | ● | |
| `discount:approve` | | ● | | ● | ● | | |
| `approval:read` | ○ | ● | ○ | ● | ● | ● | |
| `approval:decide` `approval:bulk_decide` | | ● | | ● | ● | | |
| `approval:reassign` | | ● | | | ● | ● | |
| `engagement:read` | ○ | ○ | ● | ● | ● | ● | ○ |
| `engagement:write` `engagement:close_out` | | | ● | | ● | ● | |
| `participant:read` | | | ● | ● | ● | ● | ○ |
| `participant:write` | | | ● | | ● | ● | |
| `attendance:read` | | | ● | ● | ● | ● | ○ |
| `attendance:capture` | | | ● | | ● | ● | ○ |
| `attendance:approve` | | | ● | | ● | ● | ○ |
| `attendance:unlock` | | | | ● | ● | ● | |
| `attendance:export` | | | ● | ● | ● | ● | |
| `hrdc:read` `hrdc:export` | | | ● | ● | ● | ● | |
| `hrdc:document:write` | | | ● | ● | ● | ● | |
| `hrdc:mark_submitted` | | | | ● | ● | | |
| `invoice:read` `receivable:read` `collection:read` | ○ | ○ | | ● | ● | ● | |
| `invoice:create` `invoice:push` `payment:record` | | | | ● | ● | | |
| `collection:remind` | | | | ● | ● | | |
| `broadcast:send` | | ● | | | ● | ● | |
| `agent:read` | | | | | ● | ● | |
| `agent:autonomy` | | | | | ● | | |
| `agent:pause` | | | | | ● | ● | |
| `run:read` `eval:read` | | | | | ● | ● | |
| `run:retry` `run:dead_letter` `run:replay` | | | | | | ● | |
| `dashboard:read` `metric:read` `report:read` | ● | ● | ● | ● | ● | ● | |
| `dashboard:executive:read` | | ● | | ● | ● | ● | |
| `ai:tier:read` `ai:routing:read` | | | | | ● | ● | |
| `ai:tier:write` `ai:routing:write` | | | | | | ● | |
| `ai:provider:read` `ai:provider:write` `ai:provider:test` `ai:provider:rotate` `ai:provider:delete` | | | | | | ● | |
| `ai:provider:reveal` | | | | | | ● | |
| `ai:usage:read` `ai:budget:read` | | | | ● | ● | ● | |
| `ai:budget:write` | | | | | | ● | |
| `ai:budget:raise` | | | | | ● | | |
| `compliance:rule:read` `compliance:check:read` | | | ● | ● | ● | ● | |
| `compliance:rule:write` | | | | ● | | ● | |
| `compliance:rule:approve` | | | | ● | ● | | |
| `knowledge:source:read` | | | | ● | ● | ● | |
| `knowledge:source:write` `knowledge:source:reingest` | | | | | | ● | |

Three deliberate asymmetries, because they are the ones a reviewer will query:

- **`ADMIN` cannot `discount:approve`, `approval:decide`, `hrdc:mark_submitted`, `invoice:create`
  or `ai:budget:raise`.** The system administrator runs the system; they do not commit the business.
  §3's rule that *"a user cannot approve their own request"* is a policy-gate rule; this is the
  structural half of the same idea.
- **`MD` holds `agent:autonomy` alone.** §10: `PUT /v1/agents/{id}/autonomy` is MD-gated, and
  DECISIONS.md §1 names the MD as the owner of the autonomy matrix.
- **`ADMIN` alone holds `run:retry` / `run:replay`.** A retry has side effects; `MD` reads traces but
  does not re-fire them.

Seed as data, not as code, so it can be edited without a migration:

```sql
insert into app.role_permissions (role, permission) values
  ('SALES','enquiry:read'), ('SALES','enquiry:convert'), … ;
```

### 2.4 Data scopes and how ownership is modelled

Two independent axes, matching the `GET /me` shape
`"dataScope": { "clients": "MY_ACCOUNTS", "teams": "MY_TEAM" }`.

**`client_scope`** governs everything rooted at an organisation — enquiries, opportunities, TNAs,
proposals, quotations, invoices seen by sales, follow-ups. Values `MY_ACCOUNTS | MY_TEAM | ALL`.

**`team_scope`** governs queue and people records where the question is "whose work is this" rather
than "whose client is this" — approvals assigned to me, saved views, run traces. Values
`MY_TEAM | ALL`.

Ownership is a plain `owner_id uuid references auth.users(id)` column on the root records, which
`sb-erd` already has as `owner` in §5 (`organisations.owner`) and §8
(`engagements.owner`). Child records do not carry an owner; they inherit through their parent, which
is why several policies below contain an `exists` against the parent rather than a local column.

```sql
create or replace function app.my_team_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct peer.user_id), array[]::uuid[])
  from public.team_members peer
  where peer.tenant_id = app.current_tenant_id()
    and peer.team_id in (
      select mine.team_id
      from public.team_members mine
      where mine.user_id = (select auth.uid())
        and mine.tenant_id = app.current_tenant_id()
    );
$$;
revoke execute on function app.my_team_user_ids() from public, anon;
grant  execute on function app.my_team_user_ids() to authenticated;
```

The function is `SECURITY DEFINER` so it can read `team_members` without that table's own policy
recursing into it. It reads the caller's identity from `auth.uid()` internally, so it cannot be used
to see anyone else's team — the required self-check from `security-rls-performance`.

`sb-erd` should treat `owner_id` as **not null** on `organisations`, `opportunities`, `enquiries`
(after assignment), `proposals` and `engagements`; a null owner is invisible to every scoped role,
which is correct for an unassigned enquiry only because §4 shows `assignedTo: null` in the inbox.
The enquiry policy therefore has an explicit `or owner_id is null` branch and nothing else does.

### 2.5 Trainer scope

`TRAINER` does not use `client_scope` at all. A trainer sees an engagement if they are assigned to
it, and nothing else:

```sql
create or replace function app.trainer_id()
returns uuid language sql stable set search_path = ''
as $$ select nullif(app.jwt() ->> 'trainer_id','')::uuid $$;

create or replace function app.trainer_on_engagement(p_engagement_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from core.engagement_trainers et            -- [assumed] sb-erd join table
    where et.engagement_id = p_engagement_id
      and et.tenant_id     = app.current_tenant_id()
      and et.trainer_id    = app.trainer_id()
  );
$$;
revoke execute on function app.trainer_on_engagement(uuid) from public, anon;
grant  execute on function app.trainer_on_engagement(uuid) to authenticated;
```

If `sb-erd` models the trainer on the session rather than the engagement (§8 shows
`sessions[].trainerRef`), the body becomes a union over `engagement_trainers` and `sessions`. Flagged
to `sb-erd`.

---

## 3 · The `AGENT` service principal

### 3.1 How an agent authenticates — decision and justification

**Decision: a hashed, revocable API key per agent per tenant, exchanged by an Edge Function for a
GoTrue session for an `auth.users` row provisioned once per agent per tenant, whose claims the
§1.3 hook injects.** This answers **§16 Q7 with *per tenant*.** §3.1a explains why the session is
obtained by sign-in rather than by minting a JWT ourselves.

This is the research doc's §2 recommendation
(`docs/research/08-supabase-agentic-best-practices.md` §2, "Decision defaults" row *`AGENT` actor*)
with one addition of mine, and it replaces the password-based sign-in I proposed in my Phase 1
header. The research is right about revocation and I was wrong: disabling an agent row stops its key
validating immediately, whereas a password credential has to be rotated and any live session waited
out.

What I take from the research, verbatim in intent:

- A dedicated `agents` table is the source of truth (the contract already has one in §10).
- Credentials are **hashed** and stored per agent — never a shared secret, never a raw key at rest.
- The Edge Function mints a **short-lived JWT** with `role: AGENT`, `tenant_id` and `agent_id`, so
  the agent gets **exactly the same RLS treatment as a human role**. Every predicate in §4 stays one
  shape.
- **One shared `sb_secret_…` key for all agents is rejected.** It is full RLS bypass with no
  per-agent revocation and no accountability (research §2; §13 on the new opaque key formats).
- `pgaudit` scoped to the agent's Postgres role as defence in depth (research §2, citing Supabase's
  own `zapier` example).

Where I add to it, and why: **the `sub` claim points at a real, inert `auth.users` row.** The
research says model the agent as an `agents` row *rather than* an `auth.users` row. Taken literally
that leaves `sub` pointing at nothing, and three things then break:

1. `created_by` / `owner_id` / `decided_by` columns are `references auth.users(id)`. An agent that
   writes a proposal has to appear in those columns or the FK has to be dropped estate-wide, which
   costs more than one inert row per agent.
2. `auth.uid()` returns null, so `app.owns()` and every policy branch that compares to it needs an
   agent-shaped special case.
3. Supabase's own session and audit tooling stops recognising the principal.

So: provision one `auth.users` row per agent per tenant at agent-creation time with no password, no
email confirmation and no ability to sign in through GoTrue. It is a **name for the principal**, not
a credential. The credential is the API key. Cost is N agents × M tenants inert rows — eight agents
and single-digit tenants is dozens, not thousands.

```sql
create table public.agent_api_keys (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  agent_id       text not null,                       -- 'agent_proposal'
  key_hash       bytea not null unique,               -- sha256 of the raw key; raw is never stored
  key_prefix     text  not null,                      -- 'tk_ag_1f2a…', for support and for logs
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  last_used_at   timestamptz
);
create index agent_api_keys_tenant_agent_idx
  on public.agent_api_keys (tenant_id, agent_id) where revoked_at is null;
```

`core.agents` gains `principal_user_id uuid not null references auth.users(id)` — flagged to
`sb-erd` as a column I need that the contract's §10 shape does not show. The agent also keeps a
`memberships` row (`actor_kind = 'AGENT'`, `role = 'AGENT'`, `agent_id` set, `client_scope = 'ALL'`),
so that one table remains the single answer to "who is a principal in this tenant" for both humans
and agents, and so the §1.3 hook has one source to read for both.

The exchange, in one Edge Function invoked with the agent's key:

1. `sha256` the presented key, look up `agent_api_keys` where `revoked_at is null` and
   `expires_at > now()`. No match, or the `agents` row is not `ACTIVE`, or `kill_switch` is true:
   `401`, nothing issued.
2. Read `tenant_id`, `agent_id`, `principal_user_id` from `agents`.
3. **Sign in as the agent's service user** through GoTrue (`signInWithPassword`, the password held
   as an Edge Function secret, or `admin.generateLink`). The custom access token hook in §1.3 runs
   and injects `tenant_id`, `agent_id`, `actor_kind` and the scopes from the `memberships` row.
4. Stamp `last_used_at`. Sign out at run end.

### 3.1a Why GoTrue sign-in and not a self-minted JWT

The `spike-jwt` spike (`docs/architecture/spikes/2026-09-12-agent-jwt-minting.md`, commit `c090de2`)
resolved the question §11 had flagged as unverified. Self-minting **is** supported and documented:
generate an ES256 key with `supabase gen signing-key`, import it as a standby key, rotate it in, and
sign your own tokens with `jose` inside an Edge Function. `auth.uid()` resolves from the `sub` claim
to whatever `auth.users` row you pre-provisioned, and custom claims read through `auth.jwt()` exactly
as the hook's do.

**I am not taking it, and the reason is one line of the spike's own findings.** There is one active
signing key per project, shared between GoTrue's real end-user sessions and any token you mint with
it, and the `role` claim *"must be set to an existing Postgres role in your database, such as
`anon`, `authenticated`, or `service_role`."*

So a holder of the minting key can sign a token claiming `role: service_role`. `service_role` holds
`BYPASSRLS`. **Every policy in this document — all thirty-six table families, the kill switch, the
approve-your-own-request backstop, tenant isolation itself — is void against that token.** They can
equally sign `sub: <the MD's user id>` and become the Managing Director.

That is not a risk to be mitigated, it is a hole straight through the wall this document exists to
build. The whole argument of §4 is that isolation is a property of the database rather than of any
handler's correctness; a key that mints arbitrary `role` claims moves it back into the mint service's
correctness, which is precisely what I rejected `service_role` for in §3.1's opening.

What self-minting buys, measured honestly: a 15-minute expiry instead of the project-wide 1800
seconds, and no sign-in round trip per run. Against a categorical escalation path, that is a poor
trade.

| | GoTrue sign-in (chosen) | Self-minted JWT |
|---|---|---|
| Blast radius of the held secret | **One agent** | **Every principal and every Postgres role, including `service_role`** |
| Token lifetime | 1800 s, project-wide | 15 min, per-token |
| Claims source | The §1.3 hook — one implementation | A second implementation that must not drift from the hook |
| Revocation | `agent_api_keys.revoked_at` | Same |
| Key material handled by us | None; Supabase manages the signing key | Raw ES256 private key in an Edge Function secret |

The claim-drift row is worth noting on its own. Self-minting means claims are constructed in two
places — the hook for humans, the mint service for agents — and nothing enforces that they agree.
Sign-in keeps one implementation and deletes that whole class of bug, along with the
`app.principal_claims()` shim I had proposed to paper over it.

**What would have changed my mind, and why it no longer does.** I said an external OIDC issuer as a
decoupled signer would reverse this, because agents would hold their own key rather than the
project's. `spike-jwt` ran that follow-up (commit `f5cc811`) and the answer is no.

The reason is that the exposure does not come from *which key signed the token*. It comes from
PostgREST's role-claim mechanism plus a grant that already exists. Supabase's Postgres Roles doc
describes `authenticator` as the role *"used to validate a JWT and then 'change into' another role
determined by the JWT verification"*, and `service_role` as the one *"used by the API (PostgREST) to
bypass Row Level Security"*. The `authenticator → service_role` grant is therefore present by
default on every Supabase project — it is what makes the platform's own service-role key work at
all. It is not a safeguard someone forgot to enable.

Third-party auth uses that identical mechanism. A third-party JWT with no `role` claim gets `anon`;
you configure the provider to emit `role: 'authenticated'` to get anything more. Nothing structurally
stops whoever controls that issuer's signing key from emitting `role: 'service_role'` instead. So
`role` is free-form there too, and a TrainOS-run issuer would buy something real — a compromise could
no longer forge tokens GoTrue itself trusts for human sessions — without touching the RLS-bypass
exposure at all.

**There is now no known architectural change that makes agent-side minting safe.** The property we
need is "never trust a `role` claim arriving from an agent-facing path", and that is a discipline of
whatever mints the token, not something the choice of signer can buy. Which is the argument for
having no minting path in the trust chain at all, which is the design.

The standby-key question is moot for the same reason: a standby key that verifies can still sign
`role: service_role`.

**Consequence for token lifetime.** Agent tokens now live 1800 seconds like everyone else's, not
15 minutes. Compensating controls: the orchestrator signs out at run end, so the practical lifetime
is a run; `agent_api_keys` revocation stops the *next* run immediately; and the §3.3 kill switch is
enforced in RLS rather than in the token, so flipping it stops a live agent mid-run without waiting
for any expiry. That last one is why the kill switch belongs in a policy and not in the gate.

One provisioning detail from the spike, which matters because the failure is silent: agent flags go
in `app_metadata`, **never `user_metadata`**, which is user-editable. Nothing in this design reads
either — the hook reads `memberships` — but a future shortcut that trusts `user_metadata.actor_kind`
would let any user declare themselves an agent.

```sql
create or replace function app.is_agent()
returns boolean language sql stable set search_path = ''
as $$ select coalesce(app.jwt() ->> 'actor_kind', 'HUMAN') = 'AGENT' $$;

create or replace function app.agent_id()
returns text language sql stable set search_path = ''
as $$ select nullif(app.jwt() ->> 'agent_id','') $$;
```

### 3.2 Scopes per action type

§10 gives each agent `scopes: ["proposals","quotations"]` and an `autonomy[]` array of
`{ actionType, level, paused, ceiling }`. Two different things, and RLS uses only the first.

`agents.scopes` is a coarse **table-family** grant. I define the vocabulary so `sb-erd` and
`sb-actions` use the same strings:

| Scope | Table families it unlocks |
|---|---|
| `enquiries` | `enquiries`, `enquiry_extractions`, `follow_ups` |
| `organisations` | `organisations`, `contacts`, `opportunities`, `suggestions` |
| `tna` | `tnas`, `tna_gaps`, `tna_recommendations` |
| `programmes` | `programmes` (read only for every agent) |
| `proposals` | `proposals`, `proposal_sections` |
| `quotations` | `quotations`, `quotation_lines` |
| `engagements` | `engagements`, `sessions`, `participants`, `checklists` |
| `attendance` | `attendance_days`, `attendance_entries` |
| `hrdc` | `hrdc_packets`, `hrdc_documents` |
| `finance` | `invoices`, `invoice_lines`, `payments`, `collections` |
| `compliance` | `compliance_rules`, `rule_changes`, `compliance_checks` |
| `knowledge` | `knowledge_sources`, `knowledge_chunks` |
| `comms` | draft rows for `FOLLOWUP_SEND`, `REMINDER_SEND`, `BROADCAST_SEND` |

```sql
create or replace function app.agent_in_scope(p_scope text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not app.is_agent()
      or exists (
        select 1 from core.agents a
        where a.tenant_id = app.current_tenant_id()
          and a.id        = app.agent_id()
          and p_scope     = any (a.scopes)
      );
$$;
revoke execute on function app.agent_in_scope(text) from public, anon;
grant  execute on function app.agent_in_scope(text) to authenticated;
```

The `not app.is_agent() or …` prefix is the pattern for every agent helper: humans pass through
untouched, so one policy serves both principal kinds and there is no second policy to forget.

### 3.3 The kill switch and its effect on RLS

§10 gives two levers — `agents.killSwitch` (whole agent) and `agent_autonomy.paused` (one action
type), plus `agents.status ∈ ACTIVE | PAUSED | RETIRED`. §17 adds a third, budget-driven one: a
tripped cap yields `409 AGENT_PAUSED` with `details.reason: "BUDGET_CAP"`.

**RLS enforces the blunt ones. The policy gate enforces the graded ones.**

```sql
create or replace function app.agent_writes_enabled()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not app.is_agent()
      or exists (
        select 1 from core.agents a
        where a.tenant_id    = app.current_tenant_id()
          and a.id           = app.agent_id()
          and a.status       = 'ACTIVE'
          and a.kill_switch is not true
      );
$$;
revoke execute on function app.agent_writes_enabled() from public, anon;
grant  execute on function app.agent_writes_enabled() to authenticated;
```

It is applied once, as a RESTRICTIVE policy, on every tenant-scoped table — not repeated in each
permissive policy, which is how a table gets missed:

```sql
create policy kill_switch_blocks_agent_writes on core.proposals
  as restrictive for all to authenticated
  using (true)
  with check ((select app.agent_writes_enabled()));
```

RESTRICTIVE with `using (true)` leaves reads alone. A killed agent can still read its own trail —
which it should, because `GET /v1/runs/{id}` has to render what it did before it was stopped — but
it cannot write a row anywhere. The switch is therefore effective in the same transaction it is
flipped in, with no token refresh and no deploy. That is the property the MD is actually buying.

What RLS deliberately does **not** check:

- The autonomy level for an action type. `SUGGEST` versus `ACT_WITH_APPROVAL` versus `AUTONOMOUS` is
  `sb-actions`' decision at `POST /v1/actions`, made against the whole envelope — payload value,
  context flags, confidence, requester role. RLS sees a single row and cannot see any of that.
- `agent_autonomy.paused` per action type, for the same reason.
- Budget-cap pauses, which are a routing concern.

### 3.4 The boundary with `sb-actions`, stated once

RLS answers **"may this principal touch this row at all?"** — tenant, scope, kill switch, table
family. The policy gate answers **"should this change happen, now, without a human?"** — autonomy
level, thresholds, confidence, approver role, SLA. An agent that clears RLS has not been authorised
to act; it has been authorised to have its proposal considered. Both must pass. Neither reimplements
the other.

Concretely: `agent_proposal` writing a `proposals` row is RLS-allowed (scope `proposals`, switch
off). `agent_proposal` flipping `proposals.status` from `DRAFT` to `SENT` is RLS-allowed too — and
must never happen, because `PROPOSAL_SEND` is `ACT_WITH_APPROVAL` and the only code path that writes
that transition is the approval effect applier. I recommend `sb-erd` and `sb-actions` close that gap
with a trigger rather than a policy (`sb-actions` owns it): a `BEFORE UPDATE` on state columns that
raises unless `current_setting('app.effect_applier', true) = 'on'`. Noted here so it is not assumed
to be RLS's job.

### 3.5 Audit attribution

Every tenant-scoped table carries the §1 envelope. The trigger that fills it is `sb-events`' to
write; the values it must use are mine:

| Envelope field | Source |
|---|---|
| `created_by.id` | `app.agent_id()` when `app.is_agent()`, else `auth.uid()::text` |
| `created_by.kind` | `app.actor_kind()` — `HUMAN` / `AGENT` / `SYSTEM` / `CLIENT` |
| `created_by.name` | `agents.name` or `user_profiles.display_name`; `'Email ingest'` etc. for SYSTEM |
| `tenant_id` | `app.current_tenant_id()`, defaulted, and never accepted from the client (§4.2) |
| `run_id` | `current_setting('app.run_id', true)` — set by the orchestrator per run |

Portal writes are the exception: they arrive as `anon` through a `SECURITY DEFINER` RPC, so the RPC
sets `app.actor_kind = 'CLIENT'` and the acceptance name explicitly (§5.3).

**Defence in depth: `pgaudit` on the agent principal.** The research doc (§2) points out that
`pgaudit` is officially documented and scopes per Postgres role, with Supabase's own example
auditing a `zapier` role. Agents all connect as `authenticated`, so a role-scoped rule would catch
every human too. The practical version is a dedicated Postgres role for the agent connection pool —
`create role trainos_agent; grant authenticated to trainos_agent;
alter role trainos_agent set pgaudit.log = 'write';` — with the minting function setting
`role = 'trainos_agent'` in the JWT instead of `'authenticated'`. Every policy above already names
`TO authenticated`, which `trainos_agent` inherits, so no policy changes. This is optional at launch
and worth doing before the first autonomous money-adjacent action type is promoted.

---

## 4 · RLS policy catalogue

### 4.1 The baseline every tenant table gets

```sql
-- 1. Schema baseline, per security-privileges. SEE THE WARNING BELOW: line 3 is
--    documentation of intent, not a working guard.
revoke all on schema public from public;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public revoke all on tables from public;   -- vacuous, see below

-- 2. Per table (<s> is `core` for the domain, `public` for the five identity tables):
alter table <s>.<t> enable row level security;
alter table <s>.<t> force  row level security;   -- the owner role loses its exemption too

-- 3. tenant_id is never supplied by the client.
alter table <s>.<t>
  alter column tenant_id set default (select app.current_tenant_id()),
  alter column tenant_id set not null;

-- 4. Indexes. Every column a policy reads.
create index <t>_tenant_id_idx on <s>.<t> (tenant_id);
create index <t>_tenant_owner_idx on <s>.<t> (tenant_id, owner_id);   -- where owner_id exists
```

> **`FORCE` and `SECURITY DEFINER` interact, and I had not said so. Settle it before applying.**
> Migration 002 enables RLS on the five identity tables but does not force it, and I do not think
> that is simply an omission — there is a real question underneath that my §4.1 glossed.
>
> `app.custom_access_token_hook` is `SECURITY DEFINER`, so it executes as its owner. If that owner
> also owns `public.memberships` and the table is `FORCE`d, the owner's exemption is gone and the
> hook's `select` is subject to policy. No policy admits that role — they are written
> `TO authenticated` and `TO supabase_auth_admin` — so the hook would return zero rows, issue a
> tokenless-tenant claim for everyone, and **break every login**, while looking like a permissions
> bug. The one thing that saves it is if the owning role carries `BYPASSRLS`, which beats `FORCE`.
>
> **I do not know whether Supabase's `postgres` role has `BYPASSRLS`, and I am not going to assert
> it.** The test that settles it, on a branch, before this reaches anything hosted:
>
> ```sql
> select rolname, rolsuper, rolbypassrls from pg_roles
>  where rolname in ('postgres','supabase_auth_admin','authenticator','service_role');
> alter table public.memberships force row level security;
> -- then sign in as a real user and assert the token carries a tenant_id
> ```
>
> If `postgres` has `BYPASSRLS`, force everything as §8.7 requires and nothing changes. If it does
> not, there are two clean resolutions and the second is better: either add a policy admitting the
> hook's owner, or make the hook `SECURITY INVOKER` so it genuinely runs as `supabase_auth_admin` —
> at which point the `SELECT` grant and the `supabase_auth_admin` policy that 002 already creates
> become load-bearing rather than belt-and-braces, and `FORCE` is irrelevant to it. Today 002 has
> both the definer mode *and* those grants, which means one of the two is dead code and nobody knows
> which.
>
> The same question applies to `app.my_team_user_ids()` over `team_members` and to every portal RPC
> in §5. They are all `SECURITY DEFINER` over forced tables by design.

> **Correction, found by executing rather than reading.** The migrations author ran this baseline on
> PostgreSQL 17.11 and measured that `alter default privileges … revoke all on tables from public`
> **does not do what my draft claimed**. For tables it is vacuous, because `PUBLIC` holds no default
> table privilege to revoke in the first place. For functions the equivalent line is not vacuous and
> still does not take: it records no row in `pg_default_acl`, and a function created afterwards is
> still executable by `PUBLIC` and by `anon`. The same statement in `GRANT` form records correctly,
> so the mechanism is live and it is the revoke-from-`PUBLIC` direction that fails.
>
> I had presented those lines as the guard. They are not, and a reader of the earlier draft would
> have believed a new table or function was protected by default when it was not — the most
> dangerous kind of wrong, because it is wrong in the safe-looking direction. The lines stay as a
> statement of intent. **The actual guard is a per-object `REVOKE` at creation in every migration,
> plus the schema-wide sweep in §8.7.** Recorded so nobody deletes the per-object revokes on the
> grounds that the schema default already covers it.

`force row level security` matters and is often skipped. It removes the *table owner's* exemption,
so a function running as `postgres` no longer silently sees everything. It does **not** affect
`service_role`, which holds the `BYPASSRLS` attribute — roles with `BYPASSRLS` bypass regardless.
That is the intended behaviour and is covered in §4.9.

Two index details the research doc (§1) flags that are easy to get wrong:

- **A composite primary key `(tenant_id, id)` does not give you a usable standalone index on
  `tenant_id`** unless `tenant_id` is the leading key. Ours is, so the PK covers it — but any table
  `sb-erd` keys as `(id, tenant_id)` needs the explicit index above. The §8.7 regression guard
  asserts this across the whole schema rather than trusting anyone to remember.
- **`TO authenticated` on every policy is a performance feature, not only a safety one.** Postgres
  skips policy evaluation entirely for a role that matches no policy, so an `anon` request pays
  nothing to be denied.

The claim readers, all `STABLE`, all reading nothing but the request GUC, none of them
`SECURITY DEFINER` because there is nothing to define away:

```sql
create or replace function app.jwt() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function app.current_tenant_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(app.jwt() ->> 'tenant_id', '')::uuid
$$;

create or replace function app.role() returns app.app_role
language sql stable set search_path = '' as $$
  select nullif(app.jwt() ->> 'app_role', '')::app.app_role
$$;

create or replace function app.actor_kind() returns app.actor_kind
language sql stable set search_path = '' as $$
  select coalesce(nullif(app.jwt() ->> 'actor_kind',''), 'HUMAN')::app.actor_kind
$$;

create or replace function app.client_scope() returns app.data_scope
language sql stable set search_path = '' as $$
  select coalesce(nullif(app.jwt() ->> 'client_scope',''), 'MY_ACCOUNTS')::app.data_scope
$$;

create or replace function app.team_scope() returns app.data_scope
language sql stable set search_path = '' as $$
  select coalesce(nullif(app.jwt() ->> 'team_scope',''), 'MY_TEAM')::app.data_scope
$$;

create or replace function app.aal() returns text
language sql stable set search_path = '' as $$
  select coalesce(app.jwt() ->> 'aal', 'aal1')
$$;

create or replace function app.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.role_permissions rp
    where rp.role = app.role() and rp.permission = p_permission
  );
$$;
revoke execute on function app.has_permission(text) from public, anon;
grant  execute on function app.has_permission(text) to authenticated;

create or replace function app.can_see_owner(p_owner uuid) returns boolean
language sql stable set search_path = '' as $$
  select case app.client_scope()
           when 'ALL'      then true
           when 'MY_TEAM'  then p_owner = any ((select app.my_team_user_ids()))
           else                 p_owner = (select auth.uid())
         end;
$$;
```

Three more exist for the sibling lanes rather than for my own policies. `sb-actions` and `sb-events`
converged independently on `app.current_tenant_id()`, so that spelling won and mine was renamed to
match; `app.tenant_id()` does not exist.

```sql
-- For gate functions, where an absent tenant should be an exception rather than a denial.
-- Policies must NOT call this: a predicate that raises turns an empty result into a 500.
create or replace function app.require_tenant_id() returns uuid
language plpgsql stable set search_path = '' as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null then
    raise exception 'NO_TENANT' using errcode = 'insufficient_privilege';
  end if;
  return t;
end $$;

create or replace function app.has_role(p_role text) returns boolean
language sql stable set search_path = '' as $$
  select app.role() = p_role::app.app_role
$$;

-- sb-actions' actor record. actor_kind has FOUR values: portal RPCs write CLIENT.
create or replace function app.current_actor()
returns table (actor_id text, actor_kind text, role text)
language sql stable set search_path = '' as $$
  select
    case when app.is_agent() then app.agent_id() else (select auth.uid())::text end,
    app.actor_kind()::text,
    app.role()::text
$$;
```

`app.has_role()` exists because `sb-actions` asked for it, but prefer `app.has_permission()` wherever
a permission string fits. The role-to-permission matrix is data (§1.4), so an MD can move
`discount:approve` between roles without a migration; a role check hard-codes today's matrix into
the caller.

`app.has_permission()` is `SECURITY DEFINER` purely so no login role needs `SELECT` on
`app.role_permissions`. It takes no identity argument and reads only the caller's own claim, so
there is no privilege to escalate — the self-check the skill requires is structural here rather than
written out.

### 4.2 The policy templates

Four shapes cover nearly everything. Every helper is wrapped in `(select …)` so the planner hoists
it to an InitPlan and evaluates it once per statement, per `security-rls-performance`. Every policy
names `TO authenticated`; none is left at the implicit `public`, which would also match `anon`.

**Template A — tenant-scoped, permission-gated, no ownership** (reference and config data):

```sql
create policy programmes_select on core.programmes
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('programme:read'))
    and (select app.agent_in_scope('programmes'))
  );

create policy programmes_write on core.programmes
  for all to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('programme:write'))
  )
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('programme:write'))
  );
```

`USING` and `WITH CHECK` are both present and identical on the write policy. `USING` alone would let
an `UPDATE` move a row *out* of the tenant.

**Template B — tenant-scoped with owner-based data scope** (root records):

```sql
create policy opportunities_select on core.opportunities
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('opportunity:read'))
    and (select app.can_see_owner(owner_id))
    and (select app.agent_in_scope('organisations'))
  );

create policy opportunities_insert on core.opportunities
  for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('opportunity:write'))
    and (owner_id = (select auth.uid()) or (select app.client_scope()) <> 'MY_ACCOUNTS')
    and (select app.agent_in_scope('organisations'))
  );

create policy opportunities_update on core.opportunities
  for update to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('opportunity:write'))
    and (select app.can_see_owner(owner_id))
  )
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.can_see_owner(owner_id))
  );
```

The `WITH CHECK` on update repeats `can_see_owner` so a consultant cannot reassign a record to
someone outside their scope and lose sight of it — a real self-inflicted data loss, not a theoretical
one.

**Template C — child rows inheriting through a parent**:

```sql
create policy proposal_sections_select on core.proposal_sections
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and exists (
      select 1 from core.proposals p
      where p.id = proposal_sections.proposal_id
        and p.tenant_id = (select app.current_tenant_id())
    )
    and (select app.has_permission('proposal:read'))
  );
```

The `exists` subquery re-enters `proposals`, which has its own RLS, so the parent's scope applies
automatically and the child policy stays short. That costs one index probe on
`proposals (id, tenant_id)` — which `sb-erd` gets from the primary key plus the tenant index — and
is cheaper than duplicating `can_see_owner` into every child.

The research doc (§1) warns against joins inside policy expressions and prescribes the flat
`tenant_id in (select … where user_id = (select auth.uid()))` rewrite. This `exists` is a
single-table correlated lookup on a primary key, not a join, so it does not hit that case. The one
place I *would* have written a join — resolving team membership — is already flattened into
`app.my_team_user_ids()`, which returns an array the policy tests with `= any(…)` (§2.4). That is
the same rewrite the research recommends, done once instead of per policy.

**Template D — append-only** (audit, run steps, events, submission logs):

```sql
create policy run_steps_select on core.run_steps
  for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_permission('run:read')));

-- No insert/update/delete policy for authenticated at all.
-- Writes arrive from the run engine through service_role (§4.9).
```

Absence of a policy is the denial. No `for delete` policy anywhere except where the table below
explicitly names one.

**Template E — platform-global reference data with tenant overrides.** The one place `tenant_id` is
nullable. `sb-money` is modelling the HRD Corp rule set this way — `tenant_id is null` means
national, plus optional tenant-scoped override rows — and they are right. HRD Corp rules *are*
national, and copying them per tenant means a circular correction must be applied N times, with the
Nth being the one that gets missed. It also breaks the `supersedesId` / `supersededById` lineage in
§17 across tenant boundaries.

```sql
create policy compliance_rule_select on core.compliance_rule
  for select to authenticated
  using (
    (tenant_id is null or tenant_id = (select app.current_tenant_id()))
    and (select app.has_permission('compliance:rule:read'))
  );

create policy compliance_rule_tenant_override on core.compliance_rule
  for all to authenticated
  using (
    tenant_id = (select app.current_tenant_id())          -- never null: no tenant edits a global row
    and (select app.has_permission('compliance:rule:write'))
  )
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('compliance:rule:write'))
    and (select app.aal()) = 'aal2'
  );
```

**There is no platform-admin role and I recommend against adding one.** `ADMIN` is tenant-scoped, so
a tenant's administrator must not be able to edit a national rule — that would let one training
provider change compliance for every other provider on the platform. Writes to `tenant_id is null`
rows are a `service_role` provisioning operation (§4.9), which makes them a reviewed deploy-time act
rather than a button.

Index these as two partial indexes, because the `or` predicate does not use a single plain index
well:

```sql
create index compliance_rule_global_idx on core.compliance_rule (scheme, effective_from)
  where tenant_id is null;
create index compliance_rule_tenant_idx on core.compliance_rule (tenant_id, scheme, effective_from)
  where tenant_id is not null;
```

Tables on this template are the documented exception to the §8.7 guard, and are allowlisted there by
name rather than left to fail CI — otherwise someone "fixes" the nullable column in six months
because the test told them to.

### 4.3 Platform and identity tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `tenants` | own row only | none | `ADMIN`, own row | none |
| `teams` | tenant | `ADMIN` | `ADMIN` | `ADMIN` |
| `team_members` | tenant | `ADMIN` | `ADMIN` | `ADMIN` |
| `memberships` | own row + `ADMIN` | `ADMIN` | `ADMIN` | none — set `status='REMOVED'` |
| `user_profiles` | tenant | `ADMIN` | own row + `ADMIN` | none |

```sql
create policy tenants_select on public.tenants
  for select to authenticated
  using (id = (select app.current_tenant_id()));

create policy tenants_update_admin on public.tenants
  for update to authenticated
  using (id = (select app.current_tenant_id()) and (select app.role()) = 'ADMIN')
  with check (id = (select app.current_tenant_id()));

create policy memberships_select_self on public.memberships
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (user_id = (select auth.uid()) or (select app.role()) in ('ADMIN','MD'))
  );

create policy memberships_write_admin on public.memberships
  for all to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.role()) = 'ADMIN')
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.role()) = 'ADMIN'
    and (select app.aal()) = 'aal2'
  );
```

Privilege escalation is the thing to stop here. `memberships_write_admin` requires AAL2 on the write
side, and one more RESTRICTIVE policy stops an admin editing their own row into something else:

```sql
create policy memberships_no_self_edit on public.memberships
  as restrictive for update to authenticated
  using (user_id <> (select auth.uid()));
```

Bootstrapping the first `ADMIN` of a tenant is therefore a `service_role` operation, which is
correct: it is a provisioning act, not a product feature.

### 4.4 Config and reference tables

`templates`, `policies`, `pipelines`, `saved_views`, `rate_cards` *(sb-money)*, `compliance_rules`,
`knowledge_sources`.

All Template A on a `:read` / `:write` permission pair. Two need a word.

**`saved_views`** is the one §16 Q9 asks about ("shared or personal?"). The §2 response shows
`count: 48` and `isDefault: true` with no owner field, which reads as team-shared. My
recommendation, and what the policy below implements: **both, with an explicit `visibility` column**,
because the demo needs shared counts and a consultant obviously wants a private filter too.

```sql
-- [assumed] sb-erd adds: visibility text check (visibility in ('PRIVATE','TEAM','TENANT'))
create policy saved_views_select on core.saved_views
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('view:read'))
    and (
      owner_id = (select auth.uid())
      or visibility = 'TENANT'
      or (visibility = 'TEAM' and owner_id = any ((select app.my_team_user_ids())))
    )
  );

create policy saved_views_insert on core.saved_views
  for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id())
    and owner_id = (select auth.uid())
    and (select app.has_permission('view:write'))
    and (visibility = 'PRIVATE' or (select app.has_permission('view:share')))
  );

create policy saved_views_modify on core.saved_views
  for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and owner_id = (select auth.uid()))
  with check (tenant_id = (select app.current_tenant_id()) and owner_id = (select auth.uid()));

create policy saved_views_delete on core.saved_views
  for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and owner_id = (select auth.uid()));
```

**`policies`** (the APV-01 / FIN-01 rows) is read by everyone who can see a gated button, because
`FORBIDDEN.details.requiredRole` and the M07-S02 policy strip both render from it, and written by
`ADMIN` under AAL2. It is the table that defines what needs approval, so editing it is an escalation
path:

```sql
create policy action_policies_write on core.action_policies
  for all to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_permission('policy:write')))
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('policy:write'))
    and (select app.aal()) = 'aal2'
  );
```

### 4.5 Pipeline, design and quote tables

| Table | Template | Permission | Agent scope | Notes |
|---|---|---|---|---|
| `enquiries` | B | `enquiry:read` / `enquiry:*` | `enquiries` | owner column is `assigned_to`; `or assigned_to is null` on SELECT for the unassigned inbox |
| `enquiry_extractions` | C via `enquiries` | `enquiry:edit_extraction` | `enquiries` | UPDATE only; no DELETE |
| `follow_ups` | C via `opportunities` | `followup:read` | `enquiries` | |
| `organisations` | B | `organisation:read` / `:write` | `organisations` | root of `client_scope` |
| `contacts` | C via `organisations` | `contact:read` / `:write` | `organisations` | |
| `contact_consents` | C via `contacts` | `contact:consent:read` | `comms` | INSERT only; consent is append-only, withdrawal is a new row |
| `opportunities` | B | `opportunity:read` / `:write` | `organisations` | |
| `suggestions` | C via `organisations` | `organisation:suggestions:read` | `knowledge` | agent-written, human-dismissed |
| `tnas` | C via `opportunities` | `tna:read` / `:write` | `tna` | |
| `tna_gaps`, `tna_recommendations` | C via `tnas` | `tna:read` | `tna` | |
| `programmes`, `programme_modules`, `pricing_tiers` | A | `programme:read` / `:write` | `programmes` | `programme:write` is ADMIN only per §6 |
| `trainers`, `trainer_pool` | A | `trainer:read` / `:write` | `programmes` | |
| `proposals` | B | `proposal:read` / `:write` | `proposals` | |
| `proposal_sections` | C via `proposals` | `proposal:read` / `:write` | `proposals` | |
| `quotations` | C via `proposals` | `quotation:read` / `:write` | `quotations` | margin and floor live here — see below |
| `quotation_lines` | C via `quotations` | `quotation:read` / `:write` | `quotations` | |

Worked example for the unassigned-enquiry case, which is the only place a null owner is visible:

```sql
create policy enquiries_select on core.enquiries
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('enquiry:read'))
    and (select app.agent_in_scope('enquiries'))
    and ( assigned_to is null                      -- the shared inbox, §4's assignedTo: null
       or (select app.can_see_owner(assigned_to)) )
  );
create index enquiries_tenant_assigned_idx on core.enquiries (tenant_id, assigned_to);
```

**`quotations` carries commercially sensitive columns** — `direct_cost`, `margin_rate`, `floor_price`,
`commission_rate`. §11 is explicit that the client projection contains *"no margin, no cost lines"*.
That is handled by the portal RPC returning a projection rather than by column privileges, because
the portal never reaches these tables at all (§5). Internally `quotation:read` is withheld from
`OPS` and `TRAINER` in §2.3, which is the whole control.

**Resolving the OPS margin conflict, raised by `sb-money`.** API_CONTRACT §8 documents
`GET /v1/engagements/{id}` for `OPS`, `FINANCE` and `MD`, and its payload carries
`finance.realisedMarginRate: 0.41` and `finance.trainerPayable`. That contradicts withholding
`quotation:read` from `OPS` directly: either Ops sees realised margin on the delivery screen or the
contract's role list is wrong.

**Decision: keep the control, drop the `finance` block from the OPS projection.** Margin on a
delivery screen is precisely the leak the permission exists to prevent, and `OPS` needs the rest of
that payload — lifecycle, sessions, checklist, attendance counts — to do the job the screen is for.
`sb-money` recommended the same and it is my call to make, so it is made.

**The mechanism matters and is not obvious: RLS cannot hide a column.** A policy filters rows. If
`realised_margin_rate` and `trainer_payable` are columns on `core.engagements`, no policy I can write
keeps them from `OPS` while still letting `OPS` read the row. Column-level `GRANT` does not help
either, because grants are per Postgres role and every one of our nine application roles is the same
`authenticated`.

**Ruled by the team lead: the API owns the projection.** I had proposed moving the finance block to a
one-to-one child table so RLS could gate it as a row. The ruling is that role-specific projections
are the API layer's job, and it is recorded as a contract deviation in §10 for the contract author.
That is the decision and it is implemented as such.

The residual risk, stated once and not relitigated: this control now lives in a handler rather than
in the database, so it is the one place in this document where a coding mistake leaks data that RLS
would otherwise have caught. Two consequences the API author should carry:

- The projection must be applied at **every** endpoint that reads `core.engagements`, not only
  `GET /v1/engagements/{id}`. A second reader — a report, an export, a `select=*` from the ⌘K search
  — reintroduces the leak silently.
- It needs its own test, because §8.7's schema sweep cannot see it. Assert that an `OPS` principal's
  response body carries no `finance` key.

If a second endpoint over that table ever appears, revisit the child table. For reference, the shape
that would make the control structural rather than procedural:

```sql
-- NOT the chosen design. Kept as the fallback if the API-side control proves fragile.
create policy engagement_finance_select on core.engagement_finance
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('quotation:read'))
    and exists (select 1 from core.engagements e
                where e.id = engagement_finance.engagement_id
                  and e.tenant_id = (select app.current_tenant_id()))
  );
```

### 4.6 Approvals

`approval_requests`, `approval_decisions`. `sb-actions` owns their columns; I own who sees them.

**These must be in `public`, not `app`.** `sb-actions` was drafting them as `app.approval_requests`.
The `app` schema is deliberately outside PostgREST's exposed schemas and has no grants to any login
role, so `GET /v1/approvals` could not read them and M02-S01 would have no data source. The research
doc's §3 recommendation to keep the gate in a non-exposed schema is about the **RPC**, not the
tables. Policies below assume `public`.

```sql
create policy approval_requests_select on core.approval_requests
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('approval:read'))
    and (
      -- the approver queue
      approver_role = (select app.role())
      or assigned_to = (select auth.uid())
      -- the requester can always watch their own
      or requested_by_user_id = (select auth.uid())
      -- escalation target, §2's escalateToRole
      or escalate_to_role = (select app.role())
      or (select app.role()) in ('MD','ADMIN')
    )
  );
create index approval_requests_queue_idx
  on core.approval_requests (tenant_id, approver_role, status, sla_due_at);
create index approval_requests_assigned_idx
  on core.approval_requests (tenant_id, assigned_to) where status = 'PENDING';

create policy approval_requests_insert on core.approval_requests
  for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));   -- created by the action envelope, any principal

create policy approval_decisions_insert on core.approval_decisions
  for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('approval:decide'))
    and decided_by = (select auth.uid())
    and exists (
      select 1 from core.approval_requests r
      where r.id = approval_decisions.request_id
        and r.tenant_id = (select app.current_tenant_id())
        and r.requested_by_user_id is distinct from (select auth.uid())   -- §3 rule 5
        and (r.approver_role = (select app.role()) or r.escalate_to_role = (select app.role()))
    )
  );
```

That last `exists` puts §3's fifth policy-evaluation input — *"a user cannot approve their own
request"* — into the database rather than leaving it only in the gate. It is cheap, it is the one
rule where a bug is a fraud, and belt-and-braces is proportionate.

`approval_decisions` has SELECT (same audience as the request) and INSERT only. No UPDATE, no
DELETE: a decision is a fact.

### 4.7 Delivery, compliance and finance

| Table | Template | Permission | Agent scope | Special |
|---|---|---|---|---|
| `engagements` | B + trainer branch | `engagement:read` / `:write` | `engagements` | see below |
| `sessions` | C via `engagements` | `engagement:read` | `engagements` | |
| `participants` | C via `engagements` | `participant:read` / `:write` | `engagements` | PDPA: personal data, `TRAINER` sees only their engagement's |
| `attendance_days` | C via `engagements` | `attendance:read` | `attendance` | immutability below |
| `attendance_entries` | C via `attendance_days` | `attendance:read` / `:capture` | `attendance` | immutability below |
| `signatures` | C via `attendance_days` | `attendance:read` | `attendance` | INSERT only |
| `checklists`, `evaluations`, `certificates` | C via `engagements` | `engagement:read` / `:write` | `engagements` | |
| `hrdc_packets` | C via `engagements` | `hrdc:read` | `hrdc` | |
| `hrdc_documents` | C via `hrdc_packets` | `hrdc:document:write` | `hrdc` | |
| `hrdc_grants`, `hrdc_submission_log` | D append-only | `hrdc:read` | `hrdc` | |
| `compliance_rules` | A | `compliance:rule:read` / `:write` | `compliance` | activation AAL2 |
| `rule_changes` | A | `compliance:rule:read` | `compliance` | agent-written |
| `compliance_checks` | D | `compliance:check:read` | `compliance` | engine-written via service_role |
| `invoices`, `invoice_lines` | C via `engagements` | `invoice:read` | `finance` | writes via action envelope only |
| `payments` | C via `invoices` | `payment:record` | `finance` | INSERT only |
| `collections`, `receivables` | C via `invoices` | `collection:read` | `finance` | |

The engagement policy carries the trainer branch, and it is the one place two scope systems meet:

```sql
create policy engagements_select on core.engagements
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('engagement:read'))
    and (select app.agent_in_scope('engagements'))
    and (
      case (select app.role())
        when 'TRAINER' then (select app.trainer_on_engagement(id))
        else (select app.can_see_owner(owner_id))
      end
    )
  );
create index engagements_tenant_owner_idx on core.engagements (tenant_id, owner_id);
create index engagement_trainers_lookup_idx
  on core.engagement_trainers (tenant_id, trainer_id, engagement_id);
```

**Attendance immutability.** §8 says the lock is one-way and `409 ATTENDANCE_LOCKED` is the
contract. That is an application error code carrying `unlockPath`, so the *gate* has to produce it —
but the database must not be the weak link. A RESTRICTIVE policy makes locked rows unwritable
regardless of who asks:

```sql
create policy attendance_entries_locked_immutable on core.attendance_entries
  as restrictive for all to authenticated
  using (true)
  with check (
    not exists (
      select 1 from core.attendance_days d
      where d.id = attendance_entries.attendance_day_id
        and d.status = 'LOCKED'
    )
  );
```

`ATTENDANCE_UNLOCK` flips `attendance_days.status` back to `OPEN` first (permission
`attendance:unlock`, FINANCE/MD/ADMIN only, AAL2, always audited per §8), after which the entries
become writable again. The unlock itself is the audited event; the void of the claim packet is
`sb-events`' cascade.

**Invoices and money-moving writes.** `invoice:create`, `invoice:push`, `payment:record`,
`hrdc:mark_submitted`, `discount:approve`, `attendance:unlock` and `ai:budget:raise` all require
AAL2, via one RESTRICTIVE policy per table rather than a clause inside each permissive one:

```sql
create policy invoices_require_aal2 on core.invoices
  as restrictive for all to authenticated
  using (true)
  with check ((select app.aal()) = 'aal2' or (select app.is_agent()));
```

The `or is_agent()` branch is there because an agent has no second factor and `INVOICE_CREATE` is
`ACT_WITH_APPROVAL` at launch (DECISIONS.md §1) — so an agent-authored invoice row only becomes real
when a human with AAL2 approves it. Without that branch the agent could not even draft.

### 4.8 Agent and AI-operations tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `agents` | `agent:read` | `ADMIN` | `agent:pause` for `status`/`kill_switch`; `ADMIN` otherwise | none |
| `agent_autonomy` | `agent:read` | `ADMIN` | `agent:autonomy` (MD) + AAL2 | none |
| `runs`, `run_steps`, `run_nodes`, `run_events` | `run:read` | service_role only | none | none |
| `evals` | `eval:read` | service_role | none | none |
| `ai_tiers`, `ai_routing` | `ai:tier:read` / `ai:routing:read` | `ADMIN` | `ADMIN` + AAL2 | `ADMIN` |
| `ai_usage` | `ai:usage:read` | service_role | none | none |
| `ai_budgets` | `ai:budget:read` | `ADMIN` | `ADMIN`; raising a cap needs `ai:budget:raise` | none |
| `ai_provider` *(sb-money)* | `ai:provider:read` | RPC only | RPC only | RPC only |
| `agent_api_keys` | metadata only, `ADMIN` | RPC only | revoke only, `ADMIN` | none |

`agent_api_keys` never exposes `key_hash`, and no principal may read it as an agent:

```sql
create policy agent_api_keys_select on public.agent_api_keys
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.role()) = 'ADMIN'
    and not (select app.is_agent())
  );

create policy agent_api_keys_revoke on public.agent_api_keys
  for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.role()) = 'ADMIN')
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.aal()) = 'aal2'
    and not (select app.is_agent())
  );
```

Minting is an `sb_secret_…` path in the exchange Edge Function (§3.1), not a policy. `key_hash` is
in the table but outside every grant: like §6, the migrations author moves it to
`app.agent_api_key_hashes` if PostgREST's `select=*` would otherwise reach it.

An agent can read its **own** registry row and runs and nothing else about its siblings, which is
what makes a compromised agent credential a small problem:

```sql
create policy agents_select on core.agents
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.has_permission('agent:read'))
      or (select app.agent_id()) = id            -- an agent sees itself
    )
  );

create policy agent_autonomy_update on core.agent_autonomy
  for update to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('agent:autonomy'))
  )
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('agent:autonomy'))
    and (select app.aal()) = 'aal2'
    and not (select app.is_agent())              -- no agent raises its own autonomy, ever
  );

create policy runs_select on core.runs
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.has_permission('run:read'))
      or (select app.agent_id()) = agent_id
    )
  );
create index runs_tenant_agent_started_idx on core.runs (tenant_id, agent_id, started_at desc);
```

`not (select app.is_agent())` on `agent_autonomy` is the single most important line in this
document. The autonomy matrix is what constrains agents; an agent that can edit it is unconstrained.
The §10 ceiling check (`MONEY_MOVING_CEILING` → `422`) is `sb-actions`' job on top of this.

### 4.9 What `service_role` bypasses, and the discipline around it

`service_role` holds `BYPASSRLS`. Every policy above is invisible to it. `FORCE ROW LEVEL SECURITY`
does not change that — force removes only the *owner's* exemption.

Build against the **2026 key model** from day one (research §13): `sb_publishable_…` replaces the
`anon` JWT and `sb_secret_…` replaces the `service_role` JWT. They are opaque strings validated at
the gateway, not parseable JWTs, and secret keys reject browser use by User-Agent sniffing with a
`401` — a guardrail the old `service_role` JWT never had. Mint **one secret key per backend
component** so a leak rotates one thing: webhook ingestion, run engine, outbox drain, provisioning.
Two consequences to design for:

- Platform-level `verify_jwt` no longer authenticates API-key-only requests to Edge Functions.
  Every function authorises the key in its own handler. The portal functions in §5 are the
  exception: they are deliberately reachable by `anon` and carry their own token check.
- If a request carries **both** a user access token and a secret key, RLS still applies under the
  user's session. A secret key does not silently escalate an already-authenticated request.

Four call sites legitimately need it, all server-side, none reachable from a browser:

| Call site | Why | Required discipline |
|---|---|---|
| Inbound webhooks (§11: email, WhatsApp, proposal-accepted, accounting) | No user session exists | Resolve `tenant_id` from the provider mapping, then call a `SECURITY DEFINER` RPC that takes `p_tenant_id` and validates it. Never a bare `insert`. |
| Run engine writing `runs`/`run_steps`/`run_events`/`ai_usage` | High volume, no per-row user | Same: one RPC per writer, `p_tenant_id` explicit. |
| Outbox drain and realtime fan-out (`sb-events`) | Cross-tenant by nature | Reads only; must filter per subscriber before emitting. §11 says SSE is *"per-user filtered"* — that filter is this code's responsibility, not RLS's. |
| Tenant provisioning and the first `ADMIN` membership | Chicken-and-egg with §4.3 | A single provisioning function, audited. |

Two hard rules for the migrations author and for `sb-events`:

1. The `service_role` key never leaves the server. No Edge Function forwards it, no client receives
   it, no environment variable ships to the browser bundle.
2. Every `service_role` write path goes through a named function whose first statement validates the
   tenant argument against `public.tenants`. Tenant isolation on those paths is a code invariant, so
   it gets a code review and a test, not a policy.

### 4.10 Realtime: `sb-events` owns the policy

§11 specifies SSE. The research doc (§4) recommends Realtime **Broadcast** instead, because Postgres
Changes does not scale past roughly 3,000 concurrent subscribers. If Broadcast wins, authorisation
is an RLS policy on `realtime.messages`, which by schema is my lane and by content is theirs.

**It is theirs.** `sb-events`' channel set is richer than the one I had drafted, and splitting a
single policy across two documents is how it ends up written twice and differently. Recorded here so
the policy sweep in §8.7 knows to expect it in `docs/architecture/05-events-outbox-realtime-audit.md`
rather than flag it missing. Their naming:
`tenant:{tenant_id}:{badges|approvals|enquiries|invoices}`, `run:{run_id}`, `user:{user_id}:*`.

Three points I owe them, one of which corrects something I told them earlier:

1. **Per-user fan-out *is* expressible in RLS — I said otherwise and was wrong.** §11 requires the
   SSE feed to be *"per-user filtered"*, and the badge payload `{ approvals: 7, hrdcDeadlines: 3 }`
   is a different number per user. I had concluded a channel-name policy could not express that and
   the filter had to live in fan-out code. Their `user:{user_id}:*` naming solves it directly:
   `split_part(realtime.topic(),':',2) = (select auth.uid())::text`. User ids are globally unique, so
   the absent tenant segment is not a hole.
2. **`run:{run_id}` has no tenant segment**, so it needs a lookup rather than string parsing:
   `exists (select 1 from core.runs r where r.id = split_part(realtime.topic(),':',2)::uuid and
   r.tenant_id = (select app.current_tenant_id()))`. The index in §4.8 covers it. Renaming the
   channel `tenant:{tenant_id}:run:{run_id}` keeps it pure string parsing and consistent with the
   other four.
3. **A restrictive INSERT policy denying client broadcasts** (`with check (false)`) so only
   `service_role` publishes. Without it, an authenticated user can publish onto any channel they can
   read, and the approvals badge becomes spoofable.

---

## 5 · Client portal

### 5.1 Token table

§11 covers proposals; §14 also shows `POST /public/tnas/{token}/submit`. One table, two subjects.

```sql
create type app.share_subject as enum ('PROPOSAL','TNA');

create table public.public_share_tokens (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  subject_type   app.share_subject not null,
  subject_id     uuid not null,
  token_hash     bytea not null unique,          -- sha256(raw token); the raw is never stored
  token_prefix   text  not null,                 -- first 8 chars, for support lookup only
  mode           text  not null default 'READ_WRITE'
                   check (mode in ('READ_WRITE','READ_ONLY')),
  issued_by      uuid  not null references auth.users(id),
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '30 days'),
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users(id),
  accepted_at    timestamptz,
  last_seen_at   timestamptz,
  use_count      integer not null default 0
);
create index public_share_tokens_tenant_idx on public.public_share_tokens (tenant_id);
create index public_share_tokens_subject_idx
  on public.public_share_tokens (tenant_id, subject_type, subject_id);
create unique index public_share_tokens_one_live_per_subject
  on public.public_share_tokens (subject_type, subject_id)
  where revoked_at is null;
```

The raw token is 32 bytes from `gen_random_bytes(32)`, base64url-encoded, returned exactly once by
the issuing RPC. Only its SHA-256 is stored, so a database dump does not hand over live client
links. `token_prefix` exists so support can answer "which link did Nurul click" without the link.

### 5.2 Access is by RPC, never by policy

There is **no `anon` policy on any base table**, including this one. `anon` sees nothing anywhere.
The portal reaches data through three `SECURITY DEFINER` functions:

```sql
create or replace function public.portal_get_proposal(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tok record;
  out jsonb;
begin
  select * into tok
  from public.public_share_tokens t
  where t.token_hash   = extensions.digest(p_token, 'sha256')
    and t.subject_type = 'PROPOSAL'
    and t.revoked_at is null
    and t.expires_at  > now();

  if tok is null then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  -- Client-safe projection only, per §11: no margin, no cost lines, no internal provenance.
  select jsonb_build_object(
    'ref',              p.ref,
    'organisationName', o.name,
    'issuedAt',         p.issued_at::date,
    'sections',         (select jsonb_agg(jsonb_build_object('n', s.n, 'title', s.title, 'body', s.body)
                                          order by s.n)
                         from core.proposal_sections s where s.proposal_id = p.id),
    'investment',       p.client_investment,     -- [assumed] sb-money's client-safe rollup
    'status',           p.status,
    'acceptance',       p.acceptance,
    'comments',         (select jsonb_agg(jsonb_build_object(
                                  'author', c.author_name, 'authorKind', 'CLIENT',
                                  'at', c.created_at, 'body', c.body) order by c.created_at)
                         from public.portal_comments c where c.share_token_id = tok.id)
  ) into out
  from core.proposals p
  join core.organisations o on o.id = p.organisation_id
  where p.id = tok.subject_id and p.tenant_id = tok.tenant_id;

  return out;
end;
$$;
revoke execute on function public.portal_get_proposal(text) from public;
grant  execute on function public.portal_get_proposal(text) to anon, authenticated;
```

The projection is the security boundary. `SECURITY DEFINER` means RLS on `proposals` and
`quotations` never runs, so nothing about margin can leak by accident: the function simply does not
select it. That is a stronger guarantee than a policy plus a column list, because a future column
added to `proposals` is invisible here by default rather than visible by default.

`portal_post_comment(p_token, p_author, p_body)` and `portal_accept(p_token, p_name, p_role)` follow
the same shape and additionally require `mode = 'READ_WRITE'`. `portal_accept` is idempotent by
token per §11 — a second accept returns the original acceptance — and stamps `actor_kind = 'CLIENT'`
with the self-declared name so `sb-events` attributes `ProposalAccepted` correctly.

Rate limiting: each RPC increments `use_count` and sets `last_seen_at`. A token exceeding a
configurable ceiling (default 500 reads/day) returns `NOT_FOUND` and raises an operational alert.
Enumeration is not a concern at 256 bits of entropy; automated scraping of a leaked link is.

### 5.3 Lifetime and revocation — §16 Q6 answered

**Recommendation: 30 days from issue, extended to acceptance + 90 days on acceptance, downgraded to
`READ_ONLY` at that moment, revocable at any time by the issuer or a `SALES_MANAGER`.**

The question as posed — revoke on acceptance, or keep it live — is a false choice. Revoking on
acceptance breaks the client's own record of what they agreed to, which they will want when the
invoice arrives in November for something accepted in September. Leaving it fully live lets a
second person accept again or comment into a closed deal. Downgrading gives the client their
document and closes the write path.

```sql
create policy public_share_tokens_select on public.public_share_tokens
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('proposal:read'))
  );

create policy public_share_tokens_insert on public.public_share_tokens
  for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('portal:token:issue'))
    and issued_by = (select auth.uid())
  );

create policy public_share_tokens_revoke on public.public_share_tokens
  for update to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('portal:token:revoke'))
  )
  with check (tenant_id = (select app.current_tenant_id()));
```

An expired or revoked token and a nonexistent one return the same `NOT_FOUND`, so the page cannot be
used to confirm that a proposal ever existed.

---

## 6 · BYOK provider keys

### 6.1 Vault, not an encrypted column

Supabase Vault (`supabase_vault`, backed by `pgsodium`) stores the secret with authenticated
encryption at rest — the encrypted payload survives into backups and replicas, and the decrypted
form exists only through the `vault.decrypted_secrets` view, which decrypts on the fly and never
persists plaintext. An encrypted column would mean managing a key ourselves, in the same database,
which is a key wrapped in the thing it protects.

The research doc (§8) reaches the same conclusion and adds the argument I had not made: Edge
Function and project secrets (`supabase secrets set`) are **one static value shared by every
invocation and every tenant**, so they structurally cannot hold per-tenant runtime rows. It also
makes a distinction worth stating plainly, because getting it backwards is a whole-feature mistake:

> A hash-based API-key pattern is one-way and **wrong for BYOK**. You must send the tenant's actual
> provider key onward to Anthropic or Google, so you need reversible, audited decryption, not a
> hash.

That is why `agent_api_keys.key_hash` (§3.1) and `public_share_tokens.token_hash` (§5.1) are hashes
— we only ever *verify* those — while the BYOK secret is in Vault. `key_fingerprint` below is a
hash *in addition to* the Vault secret, used only to detect "this key was already added", never to
authenticate.

`anon` and `authenticated` are granted nothing on `vault.decrypted_secrets`, ever.

**The metadata table is `sb-money`'s, not mine.** I had defined an `ai_provider_keys` table here with
the same columns they were writing on `ai_provider`; that is duplication, and duplication is the
defect. Their table wins. I own the secret material, the RLS on their table, and the reveal path.

```sql
-- sb-money owns this shape. Reproduced only for the columns my policies and RPCs depend on.
-- core.ai_provider (
--   id text primary key,                -- 'prv_anthropic', §17
--   tenant_id uuid not null,
--   provider text, label text,
--   masked_key text not null,           -- 'sk-ant-••••••••••••9a41'
--   key_fingerprint bytea,              -- sha256, comparison only, never authentication
--   key_ref text,                       -- the Vault secret id. Opaque to every reader.
--   status, scope_tiers, spend, cap, rotation_date, billing_owner, region,
--   last_tested_at, invalid_since, active_fallback_tier, added_by, added_at )
create index ai_provider_tenant_idx on core.ai_provider (tenant_id);
```

`key_ref` sits on the public row and that is safe. I had planned a separate private table holding
the locator, on the theory that a Vault secret id should not be servable by PostgREST. That was
over-careful: **a Vault secret uuid is not itself a capability.** Decrypting requires `SELECT` on
`vault.decrypted_secrets`, which no login role has and never will get. Conceding it removes a table
and keeps `select *` safe, since no column here holds key material.

Two requirements on `sb-money`'s columns that the design depends on:

- `masked_key` is computed **in the database** at write time — `left(key,7) || repeat('•',12) ||
  right(key,4)` — never by the caller, or the mask can be faked.
- `key_fingerprint` is a hash used only for "this key was already added" detection. Per §6.1 it is
  never the thing that authenticates, because BYOK needs reversible decryption.

### 6.2 Write-only semantics

```sql
create policy ai_provider_select on core.ai_provider
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.has_permission('ai:provider:read'))
  );

-- No INSERT / UPDATE / DELETE policy for authenticated. All writes go through RPCs.
```

Four RPCs, each `SECURITY DEFINER`, each asserting `ADMIN` plus AAL2 in its first lines:

| RPC | §17 endpoint | Behaviour |
|---|---|---|
| `ai_provider_key_set(provider, label, key, scope_tiers, region, billing_owner)` | `POST /ai/providers` | Creates the vault secret, writes masked + fingerprint, returns the masked record. The raw key is never returned, never logged, and appears in no `RETURNING`. |
| `ai_provider_key_test(id)` | `POST /ai/providers/{id}/test` | Reads the secret inside the function, probes the provider through an Edge Function, updates `last_tested_at` / `status`. |
| `ai_provider_key_rotate(id, new_key)` | `POST /ai/providers/{id}/rotate` | New vault secret first, row updated, old secret deleted in the same transaction — §17's *"old key invalidated immediately"*. |
| `ai_provider_key_delete(id)` | `DELETE /ai/providers/{id}` | Raises `409` if any tier in `scope_tiers` would be left with no `VALID` key, per §17. |

Masking is computed in the database, not by the caller, so the mask cannot be faked:
`left(key, 7) || repeat('•', 12) || right(key, 4)`.

### 6.3 Reveal is an audited RPC

```sql
create or replace function public.ai_provider_key_reveal(p_id text, p_reason text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if not (select app.has_permission('ai:provider:reveal')) then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;
  if (select app.aal()) <> 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;

  select vs.decrypted_secret into v_secret
  from core.ai_provider k
  join vault.decrypted_secrets vs on vs.id = k.key_ref::uuid
  where k.id = p_id and k.tenant_id = (select app.current_tenant_id());

  if v_secret is null then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  -- sb-events owns the audit table and the outbox row. This is the event name it must emit.
  perform events.record(                                -- [assumed] sb-events' writer
    p_tenant_id => (select app.current_tenant_id()),
    p_event     => 'ProviderKeyRevealed',
    p_subject   => p_id,
    p_payload   => jsonb_build_object('providerId', p_id, 'reason', p_reason,
                                      'at', now(), 'aal', (select app.aal()))
  );

  return v_secret;
end;
$$;
revoke execute on function public.ai_provider_key_reveal(text, text) from public, anon;
grant  execute on function public.ai_provider_key_reveal(text, text) to authenticated;
```

**Event name for `sb-events`: `ProviderKeyRevealed`**, payload `{ providerId, actor, at }` per §17's
table, which I extend with `reason` and `aal`. The audit write happens before the return, in the
same transaction, so a rolled-back read leaves no key exposure and a successful one always leaves a
record.

§17 Q4 asks whether reveal should exist at all. **Recommendation: keep it, behind the three gates
above plus a rate limit of one reveal per key per 24 hours.** Rotate-only is cleaner in theory and
fails in practice the first time a client needs to paste the same key into their own billing
console and has no other copy. The mitigations make the audit trail unambiguous, which is what the
control is actually for.

The research doc (§8) makes the same audit-atomicity point and names the table
`key_access_audit (tenant_id, secret_id, actor, edge_function_name, decrypted_at, request_id)`. It
also insists — correctly — that **every LLM-call path goes through this one decrypt-and-audit RPC**,
never an ad-hoc query against `vault.decrypted_secrets`. So the reveal RPC above is one of two
callers, not a special case: the run engine's per-call decrypt is the other, writing the same audit
row with a different actor kind. `sb-events` owns that table; I am naming its columns only so the
event and the row agree.

### 6.4 Two rotations, and the one that will bite

The research doc (§8) surfaces a verified operational trap that belongs in the runbook, not a
footnote. Two things are called "key rotation" and conflating them loses every tenant's BYOK key:

| | Per-secret rotation | Root encryption key rotation |
|---|---|---|
| What | A tenant replaces their own Anthropic key | The project-wide `pgsodium`/Vault root key |
| How | `ai_provider_key_rotate()` (§6.2): new `vault.create_secret()`, old deleted | **Management API `/pgsodium` endpoint only — never SQL** |
| Frequency | Routine, per §17's `rotationDate` | Rare, security-incident driven |
| Aftermath | Nothing else changes | **Every existing Vault secret encrypted under the old root key becomes unreadable and must be manually re-created.** No automated re-encryption tooling exists in the docs or changelog. |

A naive root rotation silently breaks BYOK for every tenant at once, and the failure surfaces as
`ProviderKeyInvalid` on the next probe rather than as a rotation error. The runbook step is:
snapshot every provider key's plaintext through the audited RPC first, rotate, re-create, verify
with `ai_provider_key_test()` per tenant, then discard the snapshot.

---

## 7 · MFA, sessions and JWT settings

### 7.1 Who must enrol

`MD` and `ADMIN`: `memberships.mfa_required = true`, set by a trigger on role assignment so it
cannot be forgotten. Everyone else optional, encouraged for `FINANCE`.

### 7.2 Step-up enforcement

Supabase puts the assurance level in the JWT as `aal` (`aal1` = password only, `aal2` = a verified
second factor this session). The enforcement is one RESTRICTIVE policy, applied to the tables in the
table below, rather than an `and app.aal() = 'aal2'` sprinkled through permissive policies where one
omission is invisible:

```sql
create policy require_aal2_for_privileged_roles on public.<t>
  as restrictive for all to authenticated
  using (true)
  with check (
    (select app.aal()) = 'aal2'
    or (select app.role()) not in ('MD','ADMIN')
  );
```

| Surface | Step-up required for |
|---|---|
| `memberships`, `teams`, `team_members` | every write, every role |
| `policies`, `compliance_rules` (activation) | every write, every role |
| `agents`, `agent_autonomy`, `ai_tiers`, `ai_routing`, `ai_budgets` | every write, every role |
| `ai_provider` RPCs incl. reveal | every call |
| `invoices`, `payments`, `hrdc_packets` (mark-submitted), `quotations` (discount below floor) | humans; agents exempt (§4.7) |
| everything else | `MD` and `ADMIN` writes only |

Reads are never step-up gated. An MD who has not enrolled can still see the dashboard; they cannot
change the autonomy matrix.

The research doc (§10) reaches the same RESTRICTIVE-policy conclusion for the same reason —
permissive policies OR together, so a permissive MFA policy would not block anything. **Its example
snippet contains a bug that must not be copied.** It reads:

```sql
using ((select auth.jwt()->>'role') not in ('MD','ADMIN') or (select auth.jwt()->>'aal') = 'aal2')
```

`role` in a Supabase JWT is the **Postgres** role — `authenticated` — not the application role. That
predicate is true for every user, so the policy never fires. Our application role is `app_role`, and
the correct test is `(select app.role()) not in ('MD','ADMIN')`, which is what the template above
uses. Flagged to the migrations author because the wrong version looks right and fails open.

Note also that Supabase's **org-level MFA enforcement** (Pro/Team/Enterprise) governs access to the
Supabase dashboard, not our end users. It is not a substitute for anything in this section.

### 7.2a What the `aal` claim is worth, honestly

`aal` is a claim in a token. Anyone holding the project's JWT signing key can sign a token asserting
`aal: aal2` without ever enrolling a factor — the `spike-jwt` spike established this while answering
a different question (§3.1a). So the policies above are a control against **users**, not against a
compromised signing key. Against that attacker they are worth nothing, but neither is anything else
here: the same key signs `role: service_role` and bypasses RLS entirely, so `aal` is not the weak
link, it is merely not the strong one.

For the two gates where the consequence is worst — revealing a provider key, and raising an agent's
autonomy — ground the assertion in a row GoTrue wrote rather than in a claim the caller presents:

```sql
create or replace function app.aal2_verified() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s
    where s.id      = nullif(app.jwt() ->> 'session_id','')::uuid
      and s.user_id = (select auth.uid())
      and s.aal     = 'aal2'          -- [assumed] column name; verify against auth schema
  );
$$;
revoke execute on function app.aal2_verified() from public, anon;
grant  execute on function app.aal2_verified() to authenticated;
```

A self-minted or forged token can claim any `session_id` it likes, but it cannot conjure a matching
`auth.sessions` row at `aal2` for that user. Use `app.aal2_verified()` in
`ai_provider_key_reveal()` and on `agent_autonomy`; keep the cheap `app.aal()` claim check
everywhere else, because the extra lookup on every privileged write is not worth it when the
attacker who defeats it has already defeated everything.

Two caveats the migrations author must resolve before relying on this: the `auth.sessions` column
may be named `aal` or `aal_level` depending on the Supabase version, and `session_id` is present on
GoTrue-issued tokens but absent from any token minted outside GoTrue — which is the point, but it
means the function returns false for a legitimate agent too. Agents are exempt from step-up anyway
(§4.7), so that is correct rather than a bug, but it should be asserted in a test rather than
discovered.

### 7.3 Session and JWT settings

| Setting | Value | Reason |
|---|---|---|
| Access token (JWT) expiry | **1800 s** | Halves the §1.4 staleness window for `app_role` at a modest refresh cost |
| Refresh token rotation | **on** | Supabase default; keep it |
| Refresh reuse interval | **10 s** | Tolerates a double-fire on a flaky mobile network without opening a replay window |
| Session timebox | **12 h** | A working day plus slack; forces a real sign-in daily |
| Inactivity timeout | **2 h** | The demo environment is a shared laptop in a training room |
| Single session per user | **off** | Consultants use a phone for attendance and a laptop for proposals |
| JWT signing | **asymmetric ES256 from day one** | Local JWKS verification with no Auth round trip; instant key revocation by key-state transition; the legacy HS256 shared secret is the deprecated path (research §13) |
| Password minimum | 12 chars, leaked-password protection **on** | |
| Agent sessions | GoTrue sign-in at run start, sign-out at run end (§3.1) | Practical lifetime is a run. Not a 15-minute minted token — see §3.1a |

`GET /v1/me` returns `role` and `permissions[]` straight from the claim plus the
`app.role_permissions` lookup, so the UI and the database never disagree about what is allowed.

**Client-side reads of identity (Vite SPA, no SSR).** PKCE is the default flow and needs no extra
configuration. The rule the frontend must follow, from supabase-js's own guidance via the research
doc (§10): **never trust `getSession()`'s embedded user object for an authorization decision.** Use
`getUser()` where authority matters — it calls the Auth server and notices a ban, a deletion or a
sign-out immediately — and `getClaims()` for fast local verification against the cached JWKS, which
only actually avoids the round trip once the project is on asymmetric signing keys. The spike adds a
boundary on that last one: `getClaims()` is documented for GoTrue-issued tokens only and verification
*"may fail"* on anything minted outside it. Every token in this design is GoTrue-issued after §3.1a,
so it holds — but if the OIDC follow-up in §3.1a ever lands, agent tokens must be verified with a
standard JWT library against the JWKS instead. With no server
to hold an httpOnly cookie, tokens live in `localStorage`; the 12-hour timebox and 2-hour inactivity
timeout above are what bound that exposure.

### 7.4 Revocation

A role change, a membership suspension or an agent retirement must invalidate live tokens, since the
role rides in the claim. Three mechanisms, in the order they should be reached for:

1. **Client-side, immediate, for the affected user's own session:** call `refreshSession()` right
   after the privilege change. The research doc (§1) names this as the documented remedy for the
   claims-staleness caveat, and it covers the common case — an MD promotes someone who is on the
   phone with them.
2. **Server-side, for someone else's session:** an `AFTER UPDATE` trigger on `memberships` enqueues
   `auth.admin.signOut(user_id, scope: 'global')` through the outbox, which `sb-events` treats as
   high priority. Until it drains, exposure is bounded by the 1800-second access-token expiry.
3. **Estate-wide, for a compromised signing key:** asymmetric signing keys move through
   standby → current → previously-used → revoked, which rotates without forcing a global sign-out.
   Before rotating, confirm nothing verifies JWTs directly against a legacy shared secret — the
   check is that no code path uses `jose` or `jsonwebtoken` against it instead of `getClaims()`.
   Our §3.1 minting function signs with the project key, so it is in scope for that check.

Agent revocation is separate and simpler: set `agent_api_keys.revoked_at`, and the next exchange
fails. No session to kill, because there is no refresh token.

---

## 8 · Test plan

pgTAP, one file per table family. The migrations author implements these; the shapes below are the
contract. Four cases per family, plus the agent and portal cases that have no human analogue.

### 8.1 Harness

```sql
create schema if not exists tests;

create or replace function tests.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

create or replace function tests.as_user(
  p_user uuid, p_tenant uuid, p_role text,
  p_client_scope text default 'ALL', p_team_scope text default 'ALL',
  p_aal text default 'aal1', p_extra jsonb default '{}'::jsonb
) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    (jsonb_build_object(
       'sub', p_user, 'role', 'authenticated', 'aal', p_aal,
       'tenant_id', p_tenant, 'app_role', p_role,
       'actor_kind', 'HUMAN', 'client_scope', p_client_scope, 'team_scope', p_team_scope
     ) || p_extra)::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function tests.as_agent(
  p_user uuid, p_tenant uuid, p_agent text
) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated',
                       'tenant_id', p_tenant, 'app_role', 'AGENT',
                       'actor_kind', 'AGENT', 'agent_id', p_agent,
                       'client_scope', 'ALL', 'team_scope', 'ALL')::text, true);
  execute 'set local role authenticated';
end $$;
```

Fixtures: two tenants `T1` (Akademi Perdana) and `T2` (a decoy with one row in every table), users
`u_amirah` (SALES, `MY_ACCOUNTS`, owns ORG-0114), `u_kelvin` (SALES_MANAGER, `MY_TEAM`), `u_siti`
(OPS), `u_jason` (FINANCE), `u_md` (MD, AAL2), `u_khairul` (ADMIN, AAL2), `t_farah` (TRAINER on
ENG-0231), `u_rival` (SALES in T1, owns nothing of Amirah's), and agents `agent_proposal`
(scopes `proposals,quotations`) and `agent_lead` (scope `enquiries`).

### 8.2 The four-way matrix, per table family

For each family `F` with representative row `R` in tenant `T1`:

```sql
-- 1. Signed out
select tests.as_anon();
select is_empty($$ select 1 from public.<F> $$,             'anon sees no <F>');
select throws_ok($$ insert into public.<F> … $$, '42501',    'anon cannot insert <F>');

-- 2. Signed in, wrong tenant
select tests.as_user('u_t2_admin', 'T2', 'ADMIN', 'ALL','ALL','aal2');
select is_empty($$ select 1 from public.<F> where id = 'R' $$,
                'T2 admin cannot see T1 <F>');
select throws_ok($$ update public.<F> set … where id = 'R' $$, null,
                'T2 admin cannot update T1 <F>');   -- 0 rows, not an error: assert row unchanged
select results_eq($$ select updated_at from public.<F> where id='R' $$, …,
                '<F> row untouched by cross-tenant update');

-- 3. Signed in, right tenant, wrong role
select tests.as_user('t_farah', 'T1', 'TRAINER');
select is_empty($$ select 1 from public.<F> where id = 'R' $$,
                'TRAINER cannot see <F>');
select throws_ok($$ insert into public.<F> … $$, '42501',
                'TRAINER cannot insert <F>');

-- 4. Signed in, right tenant, right role
select tests.as_user('u_jason', 'T1', 'FINANCE', 'ALL','ALL','aal2');
select isnt_empty($$ select 1 from public.<F> where id = 'R' $$,
                'FINANCE sees <F>');
select lives_ok($$ update public.<F> set … where id = 'R' $$,
                'FINANCE updates <F>');
```

Case 2 is the one that needs care. A cross-tenant `UPDATE` does not error; it affects zero rows.
Asserting "no exception" would pass on a broken policy, so the assertion has to be on the row's
unchanged state, or on `get diagnostics row_count = 0`.

Run the matrix against these families: `tenants`, `memberships`, `teams`, `saved_views`,
`templates`, `policies`, `enquiries`, `organisations`, `contacts`, `opportunities`, `tnas`,
`programmes`, `proposals`, `proposal_sections`, `quotations`, `approval_requests`,
`approval_decisions`, `engagements`, `participants`, `attendance_days`, `attendance_entries`,
`hrdc_packets`, `invoices`, `payments`, `collections`, `agents`, `agent_autonomy`, `runs`,
`ai_tiers`, `ai_routing`, `ai_budgets`, `ai_provider`, `compliance_rules`,
`knowledge_sources`, `public_share_tokens`, `agent_api_keys`. Thirty-six families × four cases.

### 8.3 Scope tests

```sql
select tests.as_user('u_amirah','T1','SALES','MY_ACCOUNTS','MY_TEAM');
select is_empty($$ select 1 from core.opportunities where owner_id = 'u_rival' $$,
                'MY_ACCOUNTS hides a peer''s opportunity');
select isnt_empty($$ select 1 from core.opportunities where owner_id = 'u_amirah' $$,
                'MY_ACCOUNTS shows own opportunity');

select tests.as_user('u_kelvin','T1','SALES_MANAGER','MY_TEAM','MY_TEAM');
select isnt_empty($$ select 1 from core.opportunities where owner_id = 'u_amirah' $$,
                'MY_TEAM shows a team member''s opportunity');
select is_empty($$ select 1 from core.opportunities where owner_id = 'u_other_team' $$,
                'MY_TEAM hides another team');

-- unassigned inbox
select tests.as_user('u_amirah','T1','SALES','MY_ACCOUNTS','MY_TEAM');
select isnt_empty($$ select 1 from core.enquiries where assigned_to is null $$,
                'unassigned enquiries are visible to SALES');

-- trainer
select tests.as_user('t_farah','T1','TRAINER', 'MY_ACCOUNTS','MY_TEAM','aal1',
                     '{"trainer_id":"TRN-0007"}');
select isnt_empty($$ select 1 from core.engagements where ref = 'ENG-0231' $$,
                'trainer sees their engagement');
select is_empty($$ select 1 from core.engagements where ref <> 'ENG-0231' $$,
                'trainer sees no other engagement');
select is_empty($$ select 1 from core.quotations $$,
                'trainer never sees margin');
```

### 8.4 Agent tests

```sql
select tests.as_agent('u_agent_proposal','T1','agent_proposal');
select lives_ok($$ insert into core.proposals … $$,        'in-scope agent drafts a proposal');
select throws_ok($$ insert into core.enquiries … $$, '42501',
                'out-of-scope agent cannot write enquiries');
select throws_ok($$ update core.agent_autonomy set level='AUTONOMOUS' … $$, '42501',
                'agent cannot raise its own autonomy');
select is_empty($$ select 1 from core.agents where id <> 'agent_proposal' $$,
                'agent sees only itself in the registry');

-- kill switch, same transaction
set local role postgres;
update core.agents set kill_switch = true where id = 'agent_proposal';
select tests.as_agent('u_agent_proposal','T1','agent_proposal');
select throws_ok($$ insert into core.proposals … $$, '42501',
                'kill switch blocks writes immediately');
select isnt_empty($$ select 1 from core.runs where agent_id = 'agent_proposal' $$,
                'killed agent can still read its own runs');

-- credentials
select is_empty($$ select 1 from public.agent_api_keys $$,
                'agent cannot read any api key row, including its own');
select throws_ok($$ update public.agent_api_keys set revoked_at = null $$, '42501',
                'agent cannot un-revoke a key');
select tests.as_user('u_khairul','T1','ADMIN','ALL','ALL','aal2');
select isnt_empty($$ select 1 from public.agent_api_keys where agent_id='agent_proposal' $$,
                'admin at aal2 sees key metadata');
select tests.as_user('u_khairul','T1','ADMIN','ALL','ALL','aal1');
select throws_ok($$ update public.agent_api_keys set revoked_at = now() … $$, '42501',
                'admin at aal1 cannot revoke a key');
```

The exchange Edge Function itself is not pgTAP-testable. It needs its own integration test asserting
four things: a revoked key is rejected, an expired key is rejected, a key belonging to a
`kill_switch = true` agent is rejected, and the issued token's claims match what
`app.custom_access_token_hook` produces for that principal. That last one is now cheap to satisfy,
because after §3.1a the hook is the only thing constructing claims.

### 8.5 Portal tests

```sql
select tests.as_anon();
select is_empty($$ select 1 from public.public_share_tokens $$, 'anon sees no tokens');
select is_empty($$ select 1 from core.proposals $$,           'anon sees no proposals');

select lives_ok($$ select public.portal_get_proposal('<valid raw token>') $$,
                'valid token reads the proposal');
select throws_ok($$ select public.portal_get_proposal('<expired raw token>') $$, 'P0002',
                'expired token is NOT_FOUND');
select throws_ok($$ select public.portal_get_proposal('<revoked raw token>') $$, 'P0002',
                'revoked token is NOT_FOUND');
select throws_ok($$ select public.portal_get_proposal('not-a-token') $$, 'P0002',
                'garbage token is NOT_FOUND, same code as expired');
select ok(
  (public.portal_get_proposal('<valid raw token>') ? 'marginRate') is false,
  'client projection carries no margin');
select ok(
  (public.portal_get_proposal('<valid raw token>') ? 'provenance') is false,
  'client projection carries no internal provenance');
select throws_ok($$ select public.portal_accept('<read-only token>','N','HR') $$, '22023',
                'accepted token is read-only');
```

### 8.6 Step-up and privilege-escalation tests

```sql
select tests.as_user('u_md','T1','MD','ALL','ALL','aal1');
select throws_ok($$ update core.agent_autonomy set level='AUTONOMOUS' … $$, '42501',
                'MD at aal1 cannot change autonomy');
select tests.as_user('u_md','T1','MD','ALL','ALL','aal2');
select lives_ok($$ update core.agent_autonomy set level='SUGGEST' … $$,
                'MD at aal2 can change autonomy');

-- §7.2a: a forged aal claim does not satisfy the session-grounded check.
select tests.as_user('u_md','T1','MD','ALL','ALL','aal2');   -- claim says aal2, no session row
select ok(app.aal2_verified() is false,
          'aal2 claim without a matching auth.sessions row does not verify');
select tests.as_agent('u_agent_proposal','T1','agent_proposal');
select ok(app.aal2_verified() is false,
          'an agent never verifies as aal2, and is exempt from step-up instead');

select tests.as_user('u_khairul','T1','ADMIN','ALL','ALL','aal2');
select throws_ok($$ update public.memberships set role='MD' where user_id='u_khairul' $$,
                '42501', 'admin cannot promote self');
select lives_ok($$ update public.memberships set role='OPS' where user_id='u_siti' $$,
                'admin can change another user''s role');
select throws_ok($$ select public.ai_provider_key_reveal('prv_anthropic','x') $$, '23514',
                'reveal demands a reason of substance');

select tests.as_user('u_kelvin','T1','SALES_MANAGER','MY_TEAM','MY_TEAM','aal1');
select throws_ok($$ insert into core.approval_decisions (request_id, decided_by, decision)
                    values ('<kelvin''s own request>','u_kelvin','APPROVE') $$, '42501',
                'nobody approves their own request');
```

### 8.7 Regression guards the suite must also carry

```sql
-- Every table in public has RLS enabled and forced.
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (not c.relrowsecurity or not c.relforcerowsecurity)
$$, 'every public table has RLS enabled and forced');

-- No policy is left at the implicit public role.
select is_empty($$
  select polname from pg_policy where 0 = any (polroles)
$$, 'no policy applies to PUBLIC');

-- Every tenant_id column is indexed as the leading column of something.
select is_empty($$
  select c.relname from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind = 'r'
    and not exists (select 1 from pg_index i
                    where i.indrelid = c.oid and a.attnum = i.indkey[0])
$$, 'every tenant_id is the leading column of some index');

-- Every tenant_id is NOT NULL, except the Template E global-reference tables.
select is_empty($$
  select c.relname from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind = 'r' and not a.attnotnull
    and c.relname not in ('rule_set','compliance_rule','rule_change_set',
                          'rule_change','knowledge_source')                -- Template E, §4.2
$$, 'tenant_id is not null outside the documented global-reference tables');
```

`sb-money` supplied those five names; a sixth table, `provenance_subject`, has no `tenant_id` column
at all, so the guard must tolerate its absence rather than assume every table has one.

That last allowlist is the whole point of writing it as an allowlist rather than dropping the check.
`sb-money`'s nullable `tenant_id` on the HRD Corp rule set is deliberate and correct; without the
named exception, the test says it is a defect and someone eventually "fixes" it.

Those three catch the failure mode that matters most: a table added six months from now that nobody
remembers to protect.

Two more the research doc (§12, and the "Observability" default) argues for, which I agree belong in
CI rather than in a human's checklist:

- **Run the Supabase security advisor after every schema or RLS change** (`get_advisors`) and treat
  RLS findings as blocking. The advisors catch exactly the initplan and unprotected-table mistakes
  this document is built to avoid, and they catch them on tables nobody wrote a test for.
- **Regenerate types on every migration-touching PR** and fail on a diff, rather than relying on a
  nightly job — otherwise the permission strings in `app.role_permissions` and the ones the frontend
  checks can drift for a whole release cycle.

pgTAP itself runs in CI against a preview branch per the research doc's §7 workflow, alongside a
hand-written compensating migration for every forward one. Migrations are not auto-reversible in
production, and an RLS migration that half-applies is the worst kind.

---

## 9 · Open questions

Mapped to §16 where a number exists; new ones prefixed `OQ-T`.

| # | Question | My default | Who decides |
|---|---|---|---|
| §16 Q6 | Client portal token lifetime; revoke on acceptance or keep live | 30 days from issue; on acceptance extend to +90 days and downgrade to `READ_ONLY`; revocable always (§5.3) | MD / Sales |
| §16 Q7 | Agent service principals: one per agent, or one per agent per tenant | **Per agent per tenant**, as a hashed API key exchanged for a GoTrue session (§3.1, §3.1a) | Engineering — decided here, flag if rejected |
| §16 Q9 | Saved views shared or personal | Both, via a `visibility` column; sharing needs `view:share` (§4.4) | Sales Manager |
| §16 Q1 | Does an approval expire | Affects `approval_requests` SELECT if expired rows leave the queue. No RLS change either way; noting the dependency | `sb-actions` |
| §16 Q3 | Who owns `firstProposalToOrg` | If denormalised onto `organisations`, that column is written by the effect applier under `service_role` and needs no policy of its own | `sb-actions` |
| OQ-T1 | Is `CLIENT` ever a login? | No at launch: actor kind only (§2.1). If the client portal grows a dashboard, `CLIENT` becomes a real membership with `client_scope = 'MY_ORG'`, a fourth scope value | Product |
| OQ-T2 | MFA enrolment grace period for MD/ADMIN | 7 days from first sign-in, during which reads work and privileged writes do not | MD |
| OQ-T3 | Do any humans need two tenants? | No at launch (§1.5). Changes the audit story if yes | Product |
| OQ-T4 | Trainer identity: does a trainer always have an auth user? | §8 shows `approvedBy.kind: "HUMAN"` for Farah Aziz on attendance, so yes for anyone who approves attendance. Contract trainers who never sign in need `memberships.status = 'SUSPENDED'` and a `trainers` row with no `user_id` | Ops |
| OQ-T5 | Is `OPS` allowed to see `quotations`? | No in §2.3. Ops schedules; margin is a sales and finance fact. Confirm with the MD — it is the matrix cell most likely to be wrong | MD |
| OQ-T6 | Where does `SYSTEM` (email ingest, §1's `createdBy.kind: "SYSTEM"`) authenticate? | `service_role` through the webhook RPCs (§4.9); it is never an auth user | Engineering |
| OQ-T7 | Does the `AGENT` principal need read access to `contacts` PII? | `agent_lead` matches an organisation from a sender domain, so yes to email domains; the PDPA question is whether it may read `contacts.phone`. Default: column-level revoke on `phone` for the agent path | Compliance |

---

## 10 · Deviations

`docs/research/08-supabase-agentic-best-practices.md` arrived and has been read in full. It agrees
with this design on the load-bearing choices: shared schema with `tenant_id`, the custom access
token hook over a profile lookup, `(select …)` initplan wrappers, `TO authenticated` on every
policy, indexed policy columns, `SECURITY DEFINER` helpers in a non-exposed schema, Vault for BYOK,
and a RESTRICTIVE `aal2` policy for MD and ADMIN. Where I moved, and where I did not:

**Changed in response to the research.**

1. **The agent credential.** I had proposed a password-based `auth.users` login per agent per
   tenant. The research's §2 API-key-plus-minted-JWT design is better on revocation and I adopted
   it (§3.1). Disabling an agent row stops its key validating at once; a password needs rotating and
   live sessions need waiting out.
2. **ES256 asymmetric signing keys and `sb_publishable_` / `sb_secret_` keys from day one** (§4.9,
   §7.3), rather than the legacy HS256 and `service_role` JWT model I had implicitly assumed.
3. **The Vault root-key rotation trap** (§6.4) was not in my design at all and is the kind of
   omission that loses every tenant's BYOK key in one command.
4. **Realtime Broadcast policy on `realtime.messages`** (§4.10), which I had not considered because
   §11 of the contract specifies SSE.

### Disagreement with the research — for the critic to adjudicate

The `spike-jwt` spike (`docs/architecture/spikes/2026-09-12-agent-jwt-minting.md`, commit `c090de2`)
settled one of these and created the other. Both stated as comparisons so they can be judged rather
than taken on trust.

| | Research doc §2 | This document, final | My Phase 1 header |
|---|---|---|---|
| Credential | Hashed, revocable API key | **Same** | Password on an auth user |
| Token | Self-minted short-lived JWT | **GoTrue session, hook-injected claims** | GoTrue session |
| `sub` claim | An `agents` row id; no `auth.users` row | **A pre-provisioned `auth.users` row** | Same |
| Revocation | Disable the agent row | **Same** | Rotate password, wait out sessions |
| Blast radius of the held secret | Every principal and every Postgres role | **One agent** | One agent |

**Disagreement 1 — the `sub` claim. Settled in my favour by first-party docs; no longer open.** The
research said model each agent as an `agents` row *rather than* an `auth.users` row. I argued for a
real `auth.users` row because otherwise every `references auth.users(id)` column breaks estate-wide,
`auth.uid()` returns null so every ownership branch needs an agent-shaped special case, and
Supabase's own audit tooling stops recognising the principal. The spike quotes Supabase's own
documentation — *"`sub` is an optional UUID that uniquely identifies a user you want to impersonate
in `auth.users`"* — and its step 1 is "pre-provision one `auth.users` row per AGENT principal". The
documented path requires the row. Nothing left to adjudicate.

**Disagreement 2 — self-minting, which is new and is the one worth the critic's time.** The research
recommends minting our own short-lived JWTs. The spike confirms that is supported and documented, so
this is not a feasibility objection. It is a blast-radius objection, argued in full at §3.1a, and it
rests on one sentence of Supabase's own docs that the research doc did not surface: the `role` claim
*"must be set to an existing Postgres role in your database, such as `anon`, `authenticated`, or
`service_role`."*

One project-wide signing key signs both human sessions and anything we mint with it. A holder of
that key signs `role: service_role`, gets `BYPASSRLS`, and every policy in this document is void —
tenant isolation included. They can equally sign `sub: <the MD's id>`. The gain being bought is a
15-minute expiry instead of 1800 seconds and one saved round trip per run. I do not think that is
close, but the counter-argument is real and a critic should weigh it: a single well-guarded mint
service is a normal piece of infrastructure, and I am rejecting a pattern Supabase documents.

My position in one line: this document's entire claim is that isolation is a property of the
database rather than of any handler's correctness, and a key that mints arbitrary `role` claims puts
it back in a handler. Rejecting `service_role` for agents in §3.1 and then holding a key that mints
`service_role` would be incoherent.

**Nothing now flips it, and that is a finding rather than an assertion.** I named the external OIDC
issuer as the thing that would reverse me. `spike-jwt` ran it (commit `f5cc811`): third-party auth
uses the same PostgREST role-claim mechanism, `role` is free-form there too, and the
`authenticator → service_role` grant is present by default on every project because it is what makes
the platform's own service-role key work. A decoupled signer narrows the blast radius — a compromise
could not forge tokens GoTrue trusts for human sessions — but leaves the RLS bypass untouched, since
that comes from the grant and the claim, not from the signature. Detail in §3.1a.

So the position is no longer "sign-in beats minting on balance". It is that no signer arrangement
currently known makes agent-side minting safe, because the property required — never trust a `role`
claim from an agent-facing path — is a discipline of the minting code, not a property the
architecture can supply. A critic who wants to overturn this needs to produce that missing
mechanism, not a better-guarded mint service.

**The one remaining lead, unverified:** whether `revoke service_role from authenticator` is possible
and supported on hosted Supabase once the project is fully on `sb_secret_…` keys. If it is, it is
real defence in depth and worth having regardless of this decision, because it would blunt the
consequence of *any* signing-key compromise, not only an agent's. Carried in §11.

**Kept against, or added to, the research.**

5. **The agent's `sub` points at a real, inert `auth.users` row** — the disagreement above.
6. **Permissions are not JWT claims.** Not a deviation after all: the research quotes the Supabase
   Custom Claims & RBAC guide, whose canonical shape is a role claim plus a `role_permissions` table
   plus an `authorize()` helper. That is §1.4 with our names.
7. **The research's MFA policy snippet is wrong and is not copied.** It tests
   `auth.jwt()->>'role'`, which is the Postgres role `authenticated`, so the policy never fires
   (§7.2). Our test is `app.role()`.
8. **`CLIENT` is not a Postgres-visible principal.** A literal reading of §1's role list would give
   it a membership; §11's "unauthenticated signed link" wins. The research does not address this.
9. **The kill switch is RLS-enforced, not gate-enforced.** §10 of the contract presents `killSwitch`
   as a registry field a reader could implement purely in the orchestrator. A RESTRICTIVE policy
   (§3.3) also stops an agent that has bypassed the envelope.
10. **`ADMIN` is denied every commercial approval.** Nothing in the contract or the research says
    so; §2.3 argues it.

### Contract deviations — for the contract author

Two places where this design does not match API_CONTRACT as written. Both are decided; both need the
contract amending rather than the design changing.

**CD-1 · §8 · `GET /v1/engagements/{id}` needs a role-dependent projection.** The contract documents
the endpoint for `OPS`, `FINANCE` and `MD`, and its payload carries
`finance.realisedMarginRate: 0.41` and `finance.trainerPayable`. `OPS` does not hold `quotation:read`
(§2.3), because margin on a delivery screen is the leak that permission exists to prevent. Ruled by
the team lead: keep the control, and the API omits the `finance` block for `OPS`. The contract should
say so against that payload, since a reader of §8 today would build the leak. See §4.5 for the
residual risk and the two tests it needs.

**CD-2 · §6 · the endpoint is `/v1/costings`, the table is `quotations`.** The team lead ruled the
entity is a Quotation (ref prefix `QUO-`, §18, and both sibling designs already used it), so the
table, the policies and the permission strings are all `quotation:*`. The contract's §6 path
`GET /v1/costings/{id}` now names something no longer in the schema. Either §6 follows §18 or the
mismatch is documented deliberately; not my call, but it should be a decision rather than a
leftover.

**Noted, not adopted, because it is another lane's call.** The research's §3 hybrid for the action
envelope — Edge Function for orchestration, one `SECURITY DEFINER` RPC in a non-exposed schema for
the atomic decision-and-write, called with a secret key — is `sb-actions`'. It matters to me only in
that a policy-gate RPC called with a secret key bypasses RLS, so that RPC must take `p_tenant_id`
explicitly and validate it, exactly as §4.9 requires of every other `service_role` path.

---

## 11 · What I could NOT verify

- **Column names marked [assumed]** — `engagement_trainers`, `saved_views.visibility`,
  `proposals.client_investment`, `memberships.trainer_id`'s target, `agents.scopes`,
  `agents.kill_switch`, `agent_autonomy.paused`, `events.record()` — are mine, not `sb-erd`'s or
  `sb-events`'. If their names differ, the policy bodies change and the shapes do not.
  `agents.principal_user_id` (§3.1) is a column I need that the contract's §10 shape does not show.
- **Whether Supabase's Postgres version in the target project ships `pgsodium`/Vault by default.**
  §6 assumes it. If the project is on a version where Vault is opt-in, the migration must
  `create extension if not exists supabase_vault with schema vault;` first, and the fallback is
  `pgcrypto` with a key in the Edge Function environment, which is materially weaker.
- **Whether `supabase_auth_admin` needs `select` on `app.role_permissions`.** It does not in the
  design above, because permissions are not claims. If a later decision reverses §1.4, that grant and
  a policy on that table both become necessary, and the hook's cost grows with the matrix.
- ~~Whether self-minting a JWT with the project's ES256 signing key is supported outside GoTrue.~~
  **Resolved** by `docs/architecture/spikes/2026-09-12-agent-jwt-minting.md` (commit `c090de2`).
  Verdict: **SUPPORTED WITH CAVEATS** — generate an ES256 key with `supabase gen signing-key`, import
  it as a standby key, rotate it in, and sign short-lived tokens with `jose` inside an Edge Function.
  The caveat is that the key is **project-wide and shared with GoTrue's human sessions**, so a leak
  impersonates any user, and — the part that decided it — the `role` claim accepts `service_role`,
  which holds `BYPASSRLS` and voids this entire document. Rejected in §3.1a for that reason.

  **The spike's Vault-grade key-handling requirement is recorded and currently does not bind**,
  because after §3.1a we hold no signing-key material at all: tokens are GoTrue-issued and Supabase
  keeps the key. It becomes live again the moment anyone adopts self-minting or the external-OIDC
  route, and in that case the requirement is: private key in Supabase Vault or an Edge Function
  secret, never bundled client-side, held by one small dedicated mint service rather than
  distributed to every function, and **never** mintable with `role` set to anything but
  `authenticated`. Written here rather than dropped, so that a future reversal inherits the
  condition instead of rediscovering it.
- **Whether `auth.sessions` names its assurance column `aal` or `aal_level`** in the target
  Supabase version. `app.aal2_verified()` in §7.2a depends on it and is marked [assumed]. Check the
  `auth` schema before writing that function; a wrong column name makes it raise rather than fail
  open, which is the safe direction but is still a broken deploy.
- ~~Whether an external OIDC issuer can act as a decoupled signer for agent tokens.~~ **Resolved**
  by `spike-jwt`'s follow-up (commit `f5cc811`): it can, but it does not reverse §3.1a. Third-party
  auth uses the same PostgREST role-claim mechanism, `role` is free-form there too, and the
  `authenticator → service_role` grant ships on every project by default. A decoupled signer narrows
  the blast radius without touching the RLS bypass.
- **Whether Supabase's `postgres` role carries `BYPASSRLS`.** §4.1's warning box turns on it: if it
  does not, forcing RLS on `public.memberships` breaks the `SECURITY DEFINER` access-token hook and
  therefore every login. Migration 002 enables RLS without forcing it, so the question is live right
  now rather than theoretical. One query settles it; it is written out in §4.1. **This is the single
  highest-priority verification in my lane** — it gates whether §8.7's force-everything guard can
  ship at all.
- **Whether `revoke service_role from authenticator` is possible and supported on hosted Supabase**
  once the project is fully on `sb_secret_…` keys. Flagged by `spike-jwt` and not chased. This is
  the one open item in my lane that would materially improve the security posture regardless of any
  other decision here, because it blunts the consequence of *any* signing-key compromise rather than
  only an agent's. Worth a spike. **Do not assume it works**: the platform's own service-role key
  depends on that grant, so revoking it may break Supabase-managed functionality in ways that only
  surface later.
- **The exact Realtime `realtime.topic()` helper name and signature** in §4.10. The research notes
  the Realtime schema has been locked against direct DDL since July 2026, so the policy must be
  written against whatever the current helper is, not against an older tutorial's
  `realtime.channel_name()`.
- ~~`app.principal_claims()` keeping the hook and the minting function in sync.~~ **Gone.** §3.1a
  removed the second claim-construction site, so the hook is the only implementation and the drift
  risk it was papering over no longer exists.
- **Real query plans.** Every `(select …)` wrapper is applied per `security-rls-performance`, but I
  have no database to `explain (analyze, buffers)` against. The child-table `exists` re-entry in
  Template C is the pattern most likely to need a second look under load, particularly
  `attendance_entries` at 30 participants × 2 sessions × N engagements.
- **The §2 `GET /me` `dataScope` semantics.** I read `clients` and `teams` as two independent scope
  axes. The contract shows one example and does not define the axes, so `sb-actions` and the
  frontend should confirm before the matrix in §2.3 is treated as final.
