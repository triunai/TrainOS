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
2. **Tenant comes from a JWT claim written by a custom access token hook**, not from a per-request
   profile lookup. Identity claims only: `tenant_id`, `app_role`, `actor_kind`, `agent_id`,
   `team_id`, `client_scope`, `team_scope`.
3. **Permissions are NOT in the JWT.** They resolve from a small static table through
   `app.has_permission()`. Reason in §1.4: a revoked permission must bite immediately, not at the
   next token refresh, and a 90-entry array on every request is dead weight.
4. **Nine application roles live in data, not in `pg_roles`.** Postgres grants stay at
   `anon` / `authenticated` / `service_role`.
5. **`CLIENT` is an actor kind, not a login.** §11 says the portal is unauthenticated by token, so
   there are no client auth users at launch.
6. **An agent credential is a hashed, revocable API key per agent per tenant**, exchanged for a
   15-minute ES256 JWT (this answers §16 Q7 with *per tenant*). Revised from my Phase 1 header in
   response to the research doc; see §3.1 and §10.
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
  trainer_id    uuid,                    -- [assumed] fk to sb-erd's public.trainers(id)
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

**Proposals and costings (M07-S02, M07-S03)**

`proposal:read` · `proposal:write` · `proposal:regenerate` · `proposal:preview` ·
`proposal:send` · `proposal:share` · `costing:read` · `costing:write` · `costing:apply` ·
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
| `costing:read` | ○ | ○ | | ● | ● | ● | |
| `costing:write` `costing:apply` | ○ | ○ | | ● | ● | ● | |
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
proposals, costings, invoices seen by sales, follow-ups. Values `MY_ACCOUNTS | MY_TEAM | ALL`.

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
  where peer.tenant_id = app.tenant_id()
    and peer.team_id in (
      select mine.team_id
      from public.team_members mine
      where mine.user_id = (select auth.uid())
        and mine.tenant_id = app.tenant_id()
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
    from public.engagement_trainers et            -- [assumed] sb-erd join table
    where et.engagement_id = p_engagement_id
      and et.tenant_id     = app.tenant_id()
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
short-lived ES256 JWT carrying `tenant_id`, `agent_id` and `actor_kind = 'AGENT'`. The JWT's `sub`
is an inert `auth.users` row provisioned once per agent per tenant.** This answers **§16 Q7 with
*per tenant*.**

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

`public.agents` gains `principal_user_id uuid not null references auth.users(id)` — flagged to
`sb-erd` as a column I need that the contract's §10 shape does not show. The agent also keeps a
`memberships` row (`actor_kind = 'AGENT'`, `role = 'AGENT'`, `agent_id` set, `client_scope = 'ALL'`),
so that one table remains the single answer to "who is a principal in this tenant" for both humans
and agents, and so `app.principal_claims()` below has one source to read.

The exchange, in one Edge Function invoked with the agent's key:

1. `sha256` the presented key, look up `agent_api_keys` where `revoked_at is null` and
   `expires_at > now()`. No match, or the `agents` row is not `ACTIVE`, or `kill_switch` is true:
   `401`, nothing minted.
2. Read `tenant_id`, `agent_id`, `principal_user_id` from `agents`.
3. Sign an **ES256** JWT (research §13: asymmetric signing keys from day one; legacy HS256 shared
   secret is the deprecated path) with `sub = principal_user_id`, `role = 'authenticated'`,
   `actor_kind = 'AGENT'`, `app_role = 'AGENT'`, `tenant_id`, `agent_id`, `client_scope = 'ALL'`,
   `team_scope = 'ALL'`, `exp = now() + 15 minutes`.
4. Stamp `last_used_at`.

**The custom access token hook in §1.3 does not run for a self-minted token.** The minting function
is therefore the second place claims are constructed, and the two must not drift. Mitigation for
the migrations author: extract the claim-building into one SQL function,
`app.principal_claims(p_user_id uuid) returns jsonb`, called by both the hook and the minting
function. One body, two callers, one test.

Short expiry is the point. A leaked agent JWT is worth fifteen minutes; a leaked agent API key is
revocable in one `update`.

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
| `quotations` | `costings`, `costing_lines` |
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
        select 1 from public.agents a
        where a.tenant_id = app.tenant_id()
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
        select 1 from public.agents a
        where a.tenant_id    = app.tenant_id()
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
create policy kill_switch_blocks_agent_writes on public.proposals
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
| `tenant_id` | `app.tenant_id()`, defaulted, and never accepted from the client (§4.2) |
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
-- 1. Revoke the Postgres defaults, per security-privileges.
revoke all on schema public from public;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public revoke all on tables from public;

-- 2. Per table:
alter table public.<t> enable row level security;
alter table public.<t> force  row level security;   -- the owner role loses its exemption too

-- 3. tenant_id is never supplied by the client.
alter table public.<t>
  alter column tenant_id set default (select app.tenant_id()),
  alter column tenant_id set not null;

-- 4. Indexes. Every column a policy reads.
create index <t>_tenant_id_idx on public.<t> (tenant_id);
create index <t>_tenant_owner_idx on public.<t> (tenant_id, owner_id);   -- where owner_id exists
```

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

create or replace function app.tenant_id() returns uuid
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
create policy programmes_select on public.programmes
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('programme:read'))
    and (select app.agent_in_scope('programmes'))
  );

create policy programmes_write on public.programmes
  for all to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('programme:write'))
  )
  with check (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('programme:write'))
  );
```

`USING` and `WITH CHECK` are both present and identical on the write policy. `USING` alone would let
an `UPDATE` move a row *out* of the tenant.

**Template B — tenant-scoped with owner-based data scope** (root records):

```sql
create policy opportunities_select on public.opportunities
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('opportunity:read'))
    and (select app.can_see_owner(owner_id))
    and (select app.agent_in_scope('organisations'))
  );

create policy opportunities_insert on public.opportunities
  for insert to authenticated
  with check (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('opportunity:write'))
    and (owner_id = (select auth.uid()) or (select app.client_scope()) <> 'MY_ACCOUNTS')
    and (select app.agent_in_scope('organisations'))
  );

create policy opportunities_update on public.opportunities
  for update to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('opportunity:write'))
    and (select app.can_see_owner(owner_id))
  )
  with check (
    tenant_id = (select app.tenant_id())
    and (select app.can_see_owner(owner_id))
  );
```

The `WITH CHECK` on update repeats `can_see_owner` so a consultant cannot reassign a record to
someone outside their scope and lose sight of it — a real self-inflicted data loss, not a theoretical
one.

**Template C — child rows inheriting through a parent**:

```sql
create policy proposal_sections_select on public.proposal_sections
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and exists (
      select 1 from public.proposals p
      where p.id = proposal_sections.proposal_id
        and p.tenant_id = (select app.tenant_id())
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
create policy run_steps_select on public.run_steps
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_permission('run:read')));

-- No insert/update/delete policy for authenticated at all.
-- Writes arrive from the run engine through service_role (§4.9).
```

Absence of a policy is the denial. No `for delete` policy anywhere except where the table below
explicitly names one.

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
  using (id = (select app.tenant_id()));

create policy tenants_update_admin on public.tenants
  for update to authenticated
  using (id = (select app.tenant_id()) and (select app.role()) = 'ADMIN')
  with check (id = (select app.tenant_id()));

create policy memberships_select_self on public.memberships
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (user_id = (select auth.uid()) or (select app.role()) in ('ADMIN','MD'))
  );

create policy memberships_write_admin on public.memberships
  for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) = 'ADMIN')
  with check (
    tenant_id = (select app.tenant_id())
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
create policy saved_views_select on public.saved_views
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('view:read'))
    and (
      owner_id = (select auth.uid())
      or visibility = 'TENANT'
      or (visibility = 'TEAM' and owner_id = any ((select app.my_team_user_ids())))
    )
  );

create policy saved_views_insert on public.saved_views
  for insert to authenticated
  with check (
    tenant_id = (select app.tenant_id())
    and owner_id = (select auth.uid())
    and (select app.has_permission('view:write'))
    and (visibility = 'PRIVATE' or (select app.has_permission('view:share')))
  );

create policy saved_views_modify on public.saved_views
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()))
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()));

create policy saved_views_delete on public.saved_views
  for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()));
```

**`policies`** (the APV-01 / FIN-01 rows) is read by everyone who can see a gated button, because
`FORBIDDEN.details.requiredRole` and the M07-S02 policy strip both render from it, and written by
`ADMIN` under AAL2. It is the table that defines what needs approval, so editing it is an escalation
path:

```sql
create policy approval_policies_write on public.policies
  for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_permission('policy:write')))
  with check (
    tenant_id = (select app.tenant_id())
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
| `costings` | C via `proposals` | `costing:read` / `:write` | `quotations` | margin and floor live here — see below |
| `costing_lines` | C via `costings` | `costing:read` / `:write` | `quotations` | |

Worked example for the unassigned-enquiry case, which is the only place a null owner is visible:

```sql
create policy enquiries_select on public.enquiries
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('enquiry:read'))
    and (select app.agent_in_scope('enquiries'))
    and ( assigned_to is null                      -- the shared inbox, §4's assignedTo: null
       or (select app.can_see_owner(assigned_to)) )
  );
create index enquiries_tenant_assigned_idx on public.enquiries (tenant_id, assigned_to);
```

**`costings` carries commercially sensitive columns** — `direct_cost`, `margin_rate`, `floor_price`,
`commission_rate`. §11 is explicit that the client projection contains *"no margin, no cost lines"*.
That is handled by the portal RPC returning a projection rather than by column privileges, because
the portal never reaches these tables at all (§5). Internally `costing:read` is withheld from
`OPS` and `TRAINER` in §2.3, which is the whole control.

### 4.6 Approvals

`approval_requests`, `approval_decisions`. `sb-actions` owns their columns; I own who sees them.

```sql
create policy approval_requests_select on public.approval_requests
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
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
  on public.approval_requests (tenant_id, approver_role, status, sla_due_at);
create index approval_requests_assigned_idx
  on public.approval_requests (tenant_id, assigned_to) where status = 'PENDING';

create policy approval_requests_insert on public.approval_requests
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()));   -- created by the action envelope, any principal

create policy approval_decisions_insert on public.approval_decisions
  for insert to authenticated
  with check (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('approval:decide'))
    and decided_by = (select auth.uid())
    and exists (
      select 1 from public.approval_requests r
      where r.id = approval_decisions.request_id
        and r.tenant_id = (select app.tenant_id())
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
create policy engagements_select on public.engagements
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('engagement:read'))
    and (select app.agent_in_scope('engagements'))
    and (
      case (select app.role())
        when 'TRAINER' then (select app.trainer_on_engagement(id))
        else (select app.can_see_owner(owner_id))
      end
    )
  );
create index engagements_tenant_owner_idx on public.engagements (tenant_id, owner_id);
create index engagement_trainers_lookup_idx
  on public.engagement_trainers (tenant_id, trainer_id, engagement_id);
```

**Attendance immutability.** §8 says the lock is one-way and `409 ATTENDANCE_LOCKED` is the
contract. That is an application error code carrying `unlockPath`, so the *gate* has to produce it —
but the database must not be the weak link. A RESTRICTIVE policy makes locked rows unwritable
regardless of who asks:

```sql
create policy attendance_entries_locked_immutable on public.attendance_entries
  as restrictive for all to authenticated
  using (true)
  with check (
    not exists (
      select 1 from public.attendance_days d
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
create policy invoices_require_aal2 on public.invoices
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
| `ai_provider_keys` | `ai:provider:read` | RPC only | RPC only | RPC only |
| `app.ai_provider_key_secrets` | nobody | nobody | nobody | nobody |
| `agent_api_keys` | metadata only, `ADMIN` | RPC only | revoke only, `ADMIN` | none |

`agent_api_keys` never exposes `key_hash`, and no principal may read it as an agent:

```sql
create policy agent_api_keys_select on public.agent_api_keys
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.role()) = 'ADMIN'
    and not (select app.is_agent())
  );

create policy agent_api_keys_revoke on public.agent_api_keys
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) = 'ADMIN')
  with check (
    tenant_id = (select app.tenant_id())
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
create policy agents_select on public.agents
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (
      (select app.has_permission('agent:read'))
      or (select app.agent_id()) = id            -- an agent sees itself
    )
  );

create policy agent_autonomy_update on public.agent_autonomy
  for update to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('agent:autonomy'))
  )
  with check (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('agent:autonomy'))
    and (select app.aal()) = 'aal2'
    and not (select app.is_agent())              -- no agent raises its own autonomy, ever
  );

create policy runs_select on public.runs
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (
      (select app.has_permission('run:read'))
      or (select app.agent_id()) = agent_id
    )
  );
create index runs_tenant_agent_started_idx on public.runs (tenant_id, agent_id, started_at desc);
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

### 4.10 Realtime: the one policy that is mine, not `sb-events`'

§11 specifies SSE. The research doc (§4, and its "Client-facing events" default) recommends Realtime
**Broadcast** through `realtime.broadcast_changes()` / `realtime.send()` instead, because Postgres
Changes does not scale past roughly 3,000 concurrent subscribers, and it notes the Realtime schema
has been locked against direct DDL since July 2026. Whether TrainOS ships SSE or Broadcast is
`sb-events`' call.

If Broadcast wins, authorisation is an RLS policy on `realtime.messages` and therefore lands in my
lane. The channel name must carry the tenant so the policy can read it without a lookup:

```
tenant:{tenant_id}:badges
tenant:{tenant_id}:approvals
tenant:{tenant_id}:enquiries
tenant:{tenant_id}:invoices
tenant:{tenant_id}:runs:{run_id}
```

```sql
create policy realtime_tenant_scoped_read on realtime.messages
  for select to authenticated
  using (
    split_part(realtime.topic(), ':', 1) = 'tenant'
    and split_part(realtime.topic(), ':', 2) = (select app.tenant_id())::text
  );

create policy realtime_no_client_writes on realtime.messages
  as restrictive for insert to authenticated
  with check (false);      -- only service_role broadcasts
```

Tenant scoping is all RLS can do here. §11 also requires SSE to be *"per-user filtered"* — an
approver seeing only their queue's badge counts — and a channel name cannot express `can_see_owner`.
That filter stays in the fan-out code, which is `sb-events`'. Flagged to them explicitly: a
tenant-scoped channel is not a user-scoped channel, and the badge payload
`{ approvals: 7, hrdcDeadlines: 3 }` is a different number per user.

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
                         from public.proposal_sections s where s.proposal_id = p.id),
    'investment',       p.client_investment,     -- [assumed] sb-money's client-safe rollup
    'status',           p.status,
    'acceptance',       p.acceptance,
    'comments',         (select jsonb_agg(jsonb_build_object(
                                  'author', c.author_name, 'authorKind', 'CLIENT',
                                  'at', c.created_at, 'body', c.body) order by c.created_at)
                         from public.portal_comments c where c.share_token_id = tok.id)
  ) into out
  from public.proposals p
  join public.organisations o on o.id = p.organisation_id
  where p.id = tok.subject_id and p.tenant_id = tok.tenant_id;

  return out;
end;
$$;
revoke execute on function public.portal_get_proposal(text) from public;
grant  execute on function public.portal_get_proposal(text) to anon, authenticated;
```

The projection is the security boundary. `SECURITY DEFINER` means RLS on `proposals` and
`costings` never runs, so nothing about margin can leak by accident: the function simply does not
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
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('proposal:read'))
  );

create policy public_share_tokens_insert on public.public_share_tokens
  for insert to authenticated
  with check (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('portal:token:issue'))
    and issued_by = (select auth.uid())
  );

create policy public_share_tokens_revoke on public.public_share_tokens
  for update to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (select app.has_permission('portal:token:revoke'))
  )
  with check (tenant_id = (select app.tenant_id()));
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

The important structural choice is that **the secret's locator does not live on the public row**:

```sql
create table public.ai_provider_keys (
  id                   text primary key,              -- 'prv_anthropic', §17
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  provider             text not null,
  label                text not null,
  masked_key           text not null,                 -- 'sk-ant-••••••••••••9a41'
  key_fingerprint      bytea not null,                -- sha256, for "same key re-added" detection
  status               text not null default 'NOT_SET'
                         check (status in ('NOT_SET','VALID','INVALID','EXPIRING')),
  scope_tiers          text[] not null default '{}',
  region               text,
  billing_owner        text check (billing_owner in ('CLIENT_ACCOUNT','PASS_THROUGH')),
  rotation_date        date,
  last_tested_at       timestamptz,
  invalid_since        timestamptz,
  active_fallback_tier text,
  added_by             uuid references auth.users(id),
  added_at             timestamptz not null default now(),
  unique (tenant_id, provider, label)
);
create index ai_provider_keys_tenant_idx on public.ai_provider_keys (tenant_id);

-- The locator lives in the private schema with no grants to any login role.
create table app.ai_provider_key_secrets (
  provider_key_id text primary key references public.ai_provider_keys(id) on delete cascade,
  tenant_id       uuid not null,
  vault_secret_id uuid not null
);
```

Because `public.ai_provider_keys` contains no secret column, `select *` is safe and PostgREST needs
no column-level gymnastics. `app.ai_provider_key_secrets` has no `GRANT` to `anon`, `authenticated`
or `service_role`; only `SECURITY DEFINER` functions owned by `postgres` can read it.

### 6.2 Write-only semantics

```sql
create policy ai_provider_keys_select on public.ai_provider_keys
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
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
  from app.ai_provider_key_secrets s
  join vault.decrypted_secrets vs on vs.id = s.vault_secret_id
  where s.provider_key_id = p_id and s.tenant_id = (select app.tenant_id());

  if v_secret is null then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  -- sb-events owns the audit table and the outbox row. This is the event name it must emit.
  perform events.record(                                -- [assumed] sb-events' writer
    p_tenant_id => (select app.tenant_id()),
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
| `ai_provider_keys` RPCs incl. reveal | every call |
| `invoices`, `payments`, `hrdc_packets` (mark-submitted), `costings` (discount below floor) | humans; agents exempt (§4.7) |
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
| Agent sessions | 15-minute minted JWT per §3.1 | A leaked agent token is worth fifteen minutes |

`GET /v1/me` returns `role` and `permissions[]` straight from the claim plus the
`app.role_permissions` lookup, so the UI and the database never disagree about what is allowed.

**Client-side reads of identity (Vite SPA, no SSR).** PKCE is the default flow and needs no extra
configuration. The rule the frontend must follow, from supabase-js's own guidance via the research
doc (§10): **never trust `getSession()`'s embedded user object for an authorization decision.** Use
`getUser()` where authority matters — it calls the Auth server and notices a ban, a deletion or a
sign-out immediately — and `getClaims()` for fast local verification against the cached JWKS, which
only actually avoids the round trip once the project is on asymmetric signing keys. With no server
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
`programmes`, `proposals`, `proposal_sections`, `costings`, `approval_requests`,
`approval_decisions`, `engagements`, `participants`, `attendance_days`, `attendance_entries`,
`hrdc_packets`, `invoices`, `payments`, `collections`, `agents`, `agent_autonomy`, `runs`,
`ai_tiers`, `ai_routing`, `ai_budgets`, `ai_provider_keys`, `compliance_rules`,
`knowledge_sources`, `public_share_tokens`, `agent_api_keys`. Thirty-six families × four cases.

### 8.3 Scope tests

```sql
select tests.as_user('u_amirah','T1','SALES','MY_ACCOUNTS','MY_TEAM');
select is_empty($$ select 1 from public.opportunities where owner_id = 'u_rival' $$,
                'MY_ACCOUNTS hides a peer''s opportunity');
select isnt_empty($$ select 1 from public.opportunities where owner_id = 'u_amirah' $$,
                'MY_ACCOUNTS shows own opportunity');

select tests.as_user('u_kelvin','T1','SALES_MANAGER','MY_TEAM','MY_TEAM');
select isnt_empty($$ select 1 from public.opportunities where owner_id = 'u_amirah' $$,
                'MY_TEAM shows a team member''s opportunity');
select is_empty($$ select 1 from public.opportunities where owner_id = 'u_other_team' $$,
                'MY_TEAM hides another team');

-- unassigned inbox
select tests.as_user('u_amirah','T1','SALES','MY_ACCOUNTS','MY_TEAM');
select isnt_empty($$ select 1 from public.enquiries where assigned_to is null $$,
                'unassigned enquiries are visible to SALES');

-- trainer
select tests.as_user('t_farah','T1','TRAINER', 'MY_ACCOUNTS','MY_TEAM','aal1',
                     '{"trainer_id":"TRN-0007"}');
select isnt_empty($$ select 1 from public.engagements where ref = 'ENG-0231' $$,
                'trainer sees their engagement');
select is_empty($$ select 1 from public.engagements where ref <> 'ENG-0231' $$,
                'trainer sees no other engagement');
select is_empty($$ select 1 from public.costings $$,
                'trainer never sees margin');
```

### 8.4 Agent tests

```sql
select tests.as_agent('u_agent_proposal','T1','agent_proposal');
select lives_ok($$ insert into public.proposals … $$,        'in-scope agent drafts a proposal');
select throws_ok($$ insert into public.enquiries … $$, '42501',
                'out-of-scope agent cannot write enquiries');
select throws_ok($$ update public.agent_autonomy set level='AUTONOMOUS' … $$, '42501',
                'agent cannot raise its own autonomy');
select is_empty($$ select 1 from public.agents where id <> 'agent_proposal' $$,
                'agent sees only itself in the registry');

-- kill switch, same transaction
set local role postgres;
update public.agents set kill_switch = true where id = 'agent_proposal';
select tests.as_agent('u_agent_proposal','T1','agent_proposal');
select throws_ok($$ insert into public.proposals … $$, '42501',
                'kill switch blocks writes immediately');
select isnt_empty($$ select 1 from public.runs where agent_id = 'agent_proposal' $$,
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
`kill_switch = true` agent is rejected, and the minted token's claims are byte-identical to what
`app.custom_access_token_hook` would produce for the same principal — the §3.1 drift risk.

### 8.5 Portal tests

```sql
select tests.as_anon();
select is_empty($$ select 1 from public.public_share_tokens $$, 'anon sees no tokens');
select is_empty($$ select 1 from public.proposals $$,           'anon sees no proposals');

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
select throws_ok($$ update public.agent_autonomy set level='AUTONOMOUS' … $$, '42501',
                'MD at aal1 cannot change autonomy');
select tests.as_user('u_md','T1','MD','ALL','ALL','aal2');
select lives_ok($$ update public.agent_autonomy set level='SUGGEST' … $$,
                'MD at aal2 can change autonomy');

select tests.as_user('u_khairul','T1','ADMIN','ALL','ALL','aal2');
select throws_ok($$ update public.memberships set role='MD' where user_id='u_khairul' $$,
                '42501', 'admin cannot promote self');
select lives_ok($$ update public.memberships set role='OPS' where user_id='u_siti' $$,
                'admin can change another user''s role');
select throws_ok($$ select public.ai_provider_key_reveal('prv_anthropic','x') $$, '23514',
                'reveal demands a reason of substance');

select tests.as_user('u_kelvin','T1','SALES_MANAGER','MY_TEAM','MY_TEAM','aal1');
select throws_ok($$ insert into public.approval_decisions (request_id, decided_by, decision)
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

-- Every tenant_id column is indexed.
select is_empty($$
  select c.relname from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind = 'r'
    and not exists (select 1 from pg_index i
                    where i.indrelid = c.oid and a.attnum = i.indkey[0])
$$, 'every tenant_id is the leading column of some index');
```

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
| §16 Q7 | Agent service principals: one per agent, or one per agent per tenant | **Per agent per tenant**, as a hashed API key exchanged for a 15-minute JWT (§3.1) | Engineering — decided here, flag if rejected |
| §16 Q9 | Saved views shared or personal | Both, via a `visibility` column; sharing needs `view:share` (§4.4) | Sales Manager |
| §16 Q1 | Does an approval expire | Affects `approval_requests` SELECT if expired rows leave the queue. No RLS change either way; noting the dependency | `sb-actions` |
| §16 Q3 | Who owns `firstProposalToOrg` | If denormalised onto `organisations`, that column is written by the effect applier under `service_role` and needs no policy of its own | `sb-actions` |
| OQ-T1 | Is `CLIENT` ever a login? | No at launch: actor kind only (§2.1). If the client portal grows a dashboard, `CLIENT` becomes a real membership with `client_scope = 'MY_ORG'`, a fourth scope value | Product |
| OQ-T2 | MFA enrolment grace period for MD/ADMIN | 7 days from first sign-in, during which reads work and privileged writes do not | MD |
| OQ-T3 | Do any humans need two tenants? | No at launch (§1.5). Changes the audit story if yes | Product |
| OQ-T4 | Trainer identity: does a trainer always have an auth user? | §8 shows `approvedBy.kind: "HUMAN"` for Farah Aziz on attendance, so yes for anyone who approves attendance. Contract trainers who never sign in need `memberships.status = 'SUSPENDED'` and a `trainers` row with no `user_id` | Ops |
| OQ-T5 | Is `OPS` allowed to see `costings`? | No in §2.3. Ops schedules; margin is a sales and finance fact. Confirm with the MD — it is the matrix cell most likely to be wrong | MD |
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

**Kept against, or added to, the research.**

5. **The agent's `sub` points at a real, inert `auth.users` row.** The research says model the agent
   as an `agents` row *rather than* an `auth.users` row. Argued in §3.1: taken literally that breaks
   every `references auth.users(id)` column and makes `auth.uid()` null inside policies. The
   credential is still the API key — the auth row is a name, not a login.
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
- **Whether self-minting a JWT with the project's ES256 signing key is supported outside GoTrue.**
  §3.1 depends on it, and the research doc flags its own §2 agent design as original synthesis
  rather than documented Supabase guidance — the only first-party material is an unresolved Supabase
  GitHub discussion. The fallback if minting is not viable is `auth.admin.generateLink` plus a
  password grant against the inert agent user, which is my original Phase 1 design and is worse on
  revocation. **Verify against a real project before the migrations author commits to §3.1.**
- **The exact Realtime `realtime.topic()` helper name and signature** in §4.10. The research notes
  the Realtime schema has been locked against direct DDL since July 2026, so the policy must be
  written against whatever the current helper is, not against an older tutorial's
  `realtime.channel_name()`.
- **`app.principal_claims()` keeping the hook and the minting function in sync** (§3.1) is a design
  intention, not a verified pattern. Nothing in Postgres enforces that the two callers stay
  identical; only the test does.
- **Real query plans.** Every `(select …)` wrapper is applied per `security-rls-performance`, but I
  have no database to `explain (analyze, buffers)` against. The child-table `exists` re-entry in
  Template C is the pattern most likely to need a second look under load, particularly
  `attendance_entries` at 30 participants × 2 sessions × N engagements.
- **The §2 `GET /me` `dataScope` semantics.** I read `clients` and `teams` as two independent scope
  axes. The contract shows one example and does not define the axes, so `sb-actions` and the
  frontend should confirm before the matrix in §2.3 is treated as final.
