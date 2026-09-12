# Action envelope, policy gate, approvals and idempotency

Lane: `sb-actions`. Scope: how `POST /v1/actions` is implemented in Postgres so that
the UI never decides whether something executes.

Sources: `API_CONTRACT.md` §1 (idempotency, errors, provenance), §3 (the envelope,
the 19 action types, the 5 policy inputs, the 3 response variants), §7 (approvals),
§10 (autonomy, kill switch, `AGENT_PAUSED`), §16 (open questions), §17–§18 (jury as
an object, budget caps, rule changes), `DECISIONS.md` §1 (autonomy matrix) and §2
(jury economics).

Neighbouring lanes: `sb-erd` owns the `core` domain tables, `sb-tenancy` owns
`tenant_id` resolution and RLS, `sb-money` owns every currency arithmetic and the
rate card, `sb-events` owns the outbox, the job table and the audit trail. Names
borrowed from those lanes are marked where they appear.

---

## 0 · Conflicts resolved

Amendments after review by `sb-erd`, `sb-tenancy`, `sb-events` and the contract-types
lane. Each row is a name or a rule that two documents spelled differently.

| # | Conflict | Resolution | Whose call |
|---|---|---|---|
| C1 | Gate tables in `app`, which PostgREST does not expose | Read-path tables to the domain schema; only `action_effects`, `idempotency_keys` and `outbox` stay in `app` | `sb-tenancy` raised it, applied here |
| C2 | Domain schema is `core` or `public` | **`core`**. Closed: `sb-tenancy` retargeted and now writes RLS naming `core.approval_requests`; `sb-events` and migration 001 agree. `sb-erd` is the outlier | settled by weight of committed artefacts |
| C3 | `app.policies` collides with RLS "policies" | renamed `core.action_policies` | mine |
| C4 | Tenant helper `app.tenant_id()` or `app.current_tenant_id()` | `app.current_tenant_id()`; the gate calls the raising sibling `app.require_tenant_id()` | lead's ruling |
| C5 | Tenant claim under `app_metadata` or top level | **top level** on `auth.jwt()` | `sb-tenancy` |
| C6 | Outbox columns `topic`/`job_key`/`available_at` | `job_type`/`job_key`/`run_after`, plus `effect_id`, `correlation_id` and `action_request_id`. `sb-events` first asked for `idempotency_key`, then kept my `job_key` and reserved `idempotency_key` on `core.events` for the caller-supplied header from §1 | `sb-events` owns the table |
| C7 | `job_type` is a rename of `topic` | it is **not**: `topic` was `'effect.proposal_send'`, `job_type` is a handler key like `'SEND_EMAIL'`, mapped by `app.job_type_for` | `sb-events` |
| C8 | Worker write-back signature | `app.report_effect_result(effect_id, status, payload, error)`. We each conceded to the other's proposal and swapped; their argument for `effect_id` is the better one, so both lanes are now on it | settled on the merits |
| C9 | An action read `EXECUTED` while an effect was still outstanding | `EXECUTING` → `EXECUTED` or `PARTIALLY_FAILED`; `partial_failure` boolean removed | lead's ruling |
| C10 | `CREATE` vs `ADD` in the effect op union | one union `ADD·UPDATE·REMOVE`; `CREATE` normalises to `ADD` at plan time | ruling R1 |
| C11 | Two applier session variables: my `app.effect_applier`, `sb-erd`'s `trainos.unlock_action_id` | one, `app.effect_applier`, carrying the action request id | mine, see §2.9; `sb-tenancy` concurred |
| C14 | `approver_role` comparison or a permission check | keep the role comparison; it is a data match, not an authorisation decision | `sb-tenancy` ruled, §4.1 |
| C15 | `app.pick_role_holder` and `sb-events`' `app.role_holders` are the same lookup | one function, `app.role_holders(tenant, roles[])`, owned by `sb-tenancy` because it reads their membership tables; both lanes wrap it | proposed, see §2.5 |
| C16 | `ActionRequested` named in contract §3, absent from §14 | emitted by `perform_action` before dispatch; `sb-events` §1.7 is the merged event list both lanes implement | `sb-events` |
| C12 | Jury sampling by event subscription or by cron | cron, 5-minute sweep | `sb-events` conceded |
| C13 | `PROPOSAL_SEND` value read from the quotation or the proposal | `proposals.value_minor`, the one stable money column per gated target | `sb-erd` |

**C2 is not closed and this document may be wrong about it.** `01-domain-model.md` and
`02-tenancy-auth-rls.md` are committed on `public`. Migration 001 is committed on `core`,
adjudicates the same question in the opposite direction as its own "conflict C1", and
cites an earlier draft of *this* document as its reason. `05-events-outbox-realtime-audit.md`
follows `core`. So two design documents and two executable artefacts disagree, and a
schema name is not something two halves of one database can hold different views on.

I have followed `sb-erd` because the domain schema is theirs to name and they have named
it. `config.toml` exposes both, so nothing breaks either way at the API boundary, but
every cross-lane `FROM` clause is wrong in one of the two worlds. This needs one ruling
from the lead and then a sweep across four files.

---

## Phase 1 · The decisions this document makes

Eighteen choices the rest of the document then argues for. Read this section alone
if you only want to know what changed.

**The gate**

1. **One write path.** Every state change reachable from a primary button goes
   through `app.perform_action(...)`. There is no second door. Domain tables carry
   no direct `INSERT`/`UPDATE` grant for `authenticated`; only the `SECURITY DEFINER`
   functions in this document may write them.
2. **The monetary value of an action is read from the record, never from the request
   body.** An agent cannot understate a proposal to slip under the `APV-01`
   threshold. This is the single most important security property of the gate.
3. **Policy beats grant, always.** An agent holding `AUTONOMOUS` on an action type
   still queues for approval when a policy matches. The grant says what an agent is
   *allowed to try*; the policy says what the organisation *permits to happen*.
4. **Policy conditions live in `jsonb`, not columns.** `GET /v1/policies` already
   serialises them as `conditions[] + combinator`, arity varies per policy, and a new
   policy must be a row rather than a migration. The cost is no planner statistics on
   condition fields, paid back by evaluating against a pre-assembled in-memory
   document rather than against tables.
5. **Default deny.** An agent with no `autonomy_grants` row for an action type is
   `OBSERVE`, which is `403`. Absence of configuration never means permission.
6. **Never gate the stop.** `AGENT_PAUSE` is exempt from every policy, every
   threshold and every kill-switch check. It must always be possible to stop an
   agent, including a paused one.

**The five inputs**

7. `firstProposalToOrg` is **computed live** from a partial index, not denormalised.
   This answers §16 Q3.
8. Low confidence **downgrades, never upgrades**. Confidence below the agent minimum
   turns `AUTONOMOUS` into `ACT_WITH_APPROVAL` and raises the approval's `risk.level`;
   it never turns `ACT_WITH_APPROVAL` into a rejection.
9. **Self-approval is a per-user rule, not a per-role rule**, and it is enforced twice:
   once when assigning an approval, once when deciding one. A new
   `policies.self_authorise` flag (default `false`) decides whether a human holding
   the approver role may execute their own over-threshold action directly. The
   conservative default raises an approval assigned to a *different* holder.

**Approvals**

10. **Diff staleness is a hash check, not a lock.** `effects[]` and `diff[]` are the
    same stored `jsonb` column, so they are identical by construction. On decide, the
    plan is recomputed and hashed; a mismatch is `409` with the recomputed diff. This
    answers §16 Q2. A soft lock on the target was rejected because it would freeze a
    proposal for the four hours the approval sits in a queue.
11. **Approvals expire at 24 hours into `EXPIRED`.** Never auto-approve, never
    silently auto-reject the underlying work. This answers §16 Q1. Escalation to the
    MD at 6 hours already provides the second chance; nagging forever would poison
    `medianDecisionTime` and the breaching counts, which are the only signals that the
    queue is overloaded.
12. **`REQUEST_CHANGES` closes the approval** and hands the work back to the
    requester. Keeping it open would make the SLA clock meaningless.
13. **Bulk approvability is decided per request, not per action type.** §7 says
    `false` for any action *carrying a monetary value*; a `REMINDER_SEND` with no value
    and an `INVOICE_PUSH` with one are the same type in different circumstances.

**Jury**

14. **`ESCALATE` blocks autonomy, not the transaction.** SQL never waits on a model.
    When a trigger fires, the effective level is capped at `ACT_WITH_APPROVAL` and a
    jury job is enqueued whose verdict lands on the approval as advisory. `SAMPLE`
    runs after the human decides and never touches the decision. `GATE` runs only at
    promotion time against the golden set.

**Boundaries**

15. **No network I/O in SQL.** No `pg_net`, no `http` extension anywhere in the action
    path. An HTTP call inside a transaction holds row locks for a third party's
    latency, cannot be rolled back, and makes the gate's decision depend on somebody
    else's uptime.
16. **The whole gate is one transaction** and it writes no domain state on the
    `QUEUED_FOR_APPROVAL` or `SUGGESTED` paths. A failure anywhere rolls back the
    idempotency row too, so the client may safely retry with the same key.
17. **In-database effects are atomic; external effects are at-least-once and are
    never automatically compensated.** Rolling a proposal back from `SENT` to `DRAFT`
    after a lost delivery acknowledgement would lie about what the client saw.
18. **Compliance policies use the `CMP-` prefix.** `HRD-` is already taken by the
    compliance *rules* registry in §17 (`HRD-014`, `HRD-015`, `HRD-022`). Two
    registries sharing a prefix is a defect waiting to happen.

**Added after review by the tenancy, events and contract-types lanes**

19. **Read-path tables live in `core`, private ones in `app`.** `app` is absent from
    PostgREST's exposed schemas by design, so `approval_requests` could not live there
    and still feed `GET /v1/approvals`. The gate's functions stay in `app` and are called
    by an Edge Function holding the service role, which makes the contract's promise
    structural: the UI cannot reach the gate.
20. **Gated state transitions get three layers, not a trigger.** Column privileges stop
    the `UPDATE`, a trigger stops the `INSERT`, and the same trigger validates the edge
    against a reference table. The session variable that marks the applier is only a
    *reference*; the check reads the action request it names and confirms its type gates
    this specific edge. Registered as `GOV-07`. See §2.9.
21. **The gate writes `app.outbox` directly, and emits its event through
    `app.emit_event`.** `sb-events` owns both. An external effect is enumerated on the
    action request before any event exists, so routing it through a generic event
    subscription would lose the per-effect identity the approval screen renders. Both
    paths are idempotent, so an effect that is also subscribed to its event enqueues
    once.
22. **An action is not `EXECUTED` while an external effect is still outstanding.** The
    row holds `EXECUTING` until every effect settles, then `EXECUTED` or
    `PARTIALLY_FAILED`. See §7.3.

---

## 1 · Tables

**Which schema each table lives in.** `app` is absent from PostgREST's exposed schemas
in `config.toml`, because it holds the tenant resolver, the permission lookup and this
gate, "none of which a client may call directly". A table the Data API must read cannot
live there, or `GET /v1/approvals` has no data source.

The domain schema is **`core`**, and C2 in §0 is now closed. `sb-tenancy` has
retargeted its whole §4 catalogue to `core` per migration 001's conflict C1 and has
written RLS policies naming `core.approval_requests`, `core.approval_decisions` and
`core.action_policies` outright. Policies that name my tables are the strongest possible
statement of where those tables are, so this document follows them. `sb-events` is on
`core` and so is the executable migration. `sb-erd` is the remaining outlier and has
been told.

| Schema | Tables | Why |
|---|---|---|
| `core` | `action_types`, `action_policies`, `autonomy_grants`, `action_requests`, `approval_requests`, `approval_decisions`, `suggested_drafts`, `state_transitions`, `jury_configs`, `jury_verdicts` | rendered by §2, §3, §7, §10 and §17 endpoints |
| `app` | `action_effects`, `idempotency_keys`, `outbox` | never appear in a response: the execution ledger, the replay cache, and `sb-events`' queue |
| `app` | every function in this document | the gate is reached through an Edge Function, never the Data API |

`app.policies` was renamed `core.action_policies`: `policies` is an overloaded word in
a schema that also carries row-level security policies, and a table called `policies`
in a shared namespace invites exactly the confusion the project rules forbid.

Every table below carries `tenant_id uuid not null` and needs tenant-scoped RLS from
`sb-tenancy`; the RLS policies themselves are not written here. `sb-tenancy` §4.6
already carries policies for the approval tables.

Conventions follow the Supabase Postgres guidance: lowercase snake_case identifiers,
`text` over `varchar(n)`, `timestamptz` over `timestamp`, `bigint` for identity keys,
integer minor units for money, and `check` constraints in place of enum types so that
adding a value is a migration on one line rather than a type rewrite.

### 1.1 `core.action_types` — the catalogue

Global, not tenant-scoped: this is the product's vocabulary, seeded by migration.
Tenants customise *policies* and *grants*, never the catalogue.

```sql
create table core.action_types (
  key               text primary key,
  label             text not null,
  domain            text not null
                    check (domain in ('SALES','OPS','FINANCE','COMPLIANCE','GOVERNANCE')),

  -- the three flags that drive the ceiling, per DECISIONS.md §1 rule of thumb:
  -- "anything that moves money, makes a commitment to a client, or touches HRDC
  --  state never starts above Act-with-approval"
  money_moving      boolean not null default false,
  client_facing     boolean not null default false,
  hrdc_touching     boolean not null default false,
  reversible        boolean not null default false,

  ceiling_autonomy  text not null default 'ACT_WITH_APPROVAL'
                    check (ceiling_autonomy in ('OBSERVE','SUGGEST','ACT_WITH_APPROVAL','AUTONOMOUS')),
  ceiling_reason    text
                    check (ceiling_reason in ('MONEY_MOVING','CLIENT_COMMITMENT','HRDC_STATE','SAFETY','NONE')),

  target_entity     text not null,          -- 'proposal', 'invoice', 'attendance_day', …
  payload_schema    jsonb not null default '{}'::jsonb,   -- required keys + types, see §2.0d
  value_source      text                    -- how §2 step 2 derives the value; null = valueless
                    check (value_source in ('PROPOSAL','QUOTATION','INVOICE','HRDC_CLAIM',
                                            'PAYMENT','BUDGET_CAP','NONE')),
  max_effect_attempts int not null default 5,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),

  -- an action type may not be flagged money-moving and ceilinged at AUTONOMOUS
  constraint action_types_money_ceiling check (
    not money_moving or ceiling_autonomy <> 'AUTONOMOUS'
  ),
  constraint action_types_hrdc_ceiling check (
    not hrdc_touching or ceiling_autonomy <> 'AUTONOMOUS'
  )
);
```

The two table constraints are the schema-level half of the `422 MONEY_MOVING_CEILING`
answer in §10. The other half is a trigger on `autonomy_grants` (§1.2), because the
ceiling must also be enforced when a *grant* is raised rather than when the catalogue
is seeded.

Seed values for the 19 types are in §3, which doubles as the seed script.

### 1.2 `core.autonomy_grants` — agent × action type × level

```sql
create table core.autonomy_grants (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  agent_id          text not null,                        -- 'agent_proposal'
  action_type       text not null references core.action_types(key),

  level             text not null
                    check (level in ('OBSERVE','SUGGEST','ACT_WITH_APPROVAL','AUTONOMOUS')),
  approver_role     text                                   -- overrides the policy's role when set
                    check (approver_role in ('SALES_MANAGER','OPS','FINANCE','MD','ADMIN')),

  -- the "value < RM 15k AND repeat client" band from DECISIONS.md §1
  value_threshold_minor bigint,          -- AUTONOMOUS applies only below this; null = no band
  currency          char(3) not null default 'MYR',

  min_confidence    numeric(4,3) not null default 0.700
                    check (min_confidence >= 0 and min_confidence <= 1),

  paused            boolean not null default false,
  paused_at         timestamptz,
  paused_reason     text,                                  -- 'EVAL_REGRESSION', 'BUDGET_CAP', …
  resume_condition  jsonb,                                 -- {metric, op, value}

  -- promotion metadata (DECISIONS.md §1 "Promotion condition" column)
  promotion_condition       jsonb,       -- {windowDays, metric, op, value, extraConditions[]}
  promoted_from_level       text,
  promoted_at               timestamptz,
  promoted_by               text,
  promotion_jury_verdict_id uuid,        -- the GATE run against the golden set, §5
  promotion_blocked_reason  text,        -- 'NEVER' for the five types that may never promote

  granted_by        text not null,
  granted_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint autonomy_grants_threshold_needs_autonomous check (
    value_threshold_minor is null or level = 'AUTONOMOUS'
  )
);

-- covering index: the step-1 lookup reads only these columns, so it never
-- touches the heap
create unique index autonomy_grants_lookup
  on core.autonomy_grants (tenant_id, agent_id, action_type)
  include (level, min_confidence, value_threshold_minor, approver_role, paused);
```

The ceiling is enforced by trigger because it spans two tables:

```sql
create or replace function app.enforce_autonomy_ceiling()
returns trigger
language plpgsql
set search_path = pg_catalog, app, core, public, extensions, pg_temp
as $$
declare
  v_ceiling text;
  v_reason  text;
begin
  select ceiling_autonomy, ceiling_reason
    into v_ceiling, v_reason
  from core.action_types
  where key = new.action_type;

  if app.autonomy_rank(new.level) > app.autonomy_rank(v_ceiling) then
    raise exception using
      errcode = 'TRNOS',                                  -- mapped to 422 by the edge adapter
      message = format('%s may not exceed %s for %s', new.level, v_ceiling, new.action_type),
      detail  = jsonb_build_object(
        'code',   'VALIDATION_FAILED',
        'reason', v_reason || '_CEILING',                 -- 'MONEY_MOVING_CEILING'
        'ceiling', v_ceiling
      )::text;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger autonomy_grants_ceiling
  before insert or update on core.autonomy_grants
  for each row execute function app.enforce_autonomy_ceiling();

create or replace function app.autonomy_rank(p_level text)
returns int language sql immutable parallel safe as $$
  select case p_level
           when 'OBSERVE'           then 0
           when 'SUGGEST'           then 1
           when 'ACT_WITH_APPROVAL' then 2
           when 'AUTONOMOUS'        then 3
         end;
$$;
```

`PUT /v1/agents/{id}/autonomy` is an `AGENT_AUTONOMY_CHANGE` action, so the trigger
fires inside `perform_action` and the `422` reaches the client with
`details.reason: "MONEY_MOVING_CEILING"` exactly as §10 specifies.

### 1.3 `core.action_policies` — the rule rows

```sql
create table core.action_policies (
  tenant_id              uuid not null,
  id                     text not null,                    -- 'APV-01'
  action_type            text not null references core.action_types(key),
  description            text not null,

  conditions             jsonb not null default '[]'::jsonb,
  combinator             text not null default 'ANY' check (combinator in ('ANY','ALL')),

  approver_role          text not null
                         check (approver_role in ('SALES_MANAGER','OPS','FINANCE','MD','ADMIN')),
  self_authorise         boolean not null default false,   -- see Phase 1 decision 9
  sla_minutes            int not null default 240,
  escalate_to_role       text,
  escalate_after_minutes int default 360,                  -- DECISIONS: MD at 6h
  expire_after_minutes   int not null default 1440,        -- §16 Q1 answer: 24h

  priority               int not null default 100,         -- lowest number wins
  active                 boolean not null default true,
  effective_from         timestamptz not null default now(),
  effective_to           timestamptz,

  primary key (tenant_id, id),

  constraint policies_conditions_valid
    check (app.is_valid_condition_set(conditions)),
  constraint policies_escalation_pair check (
    (escalate_to_role is null) = (escalate_after_minutes is null)
  ),
  constraint policies_escalate_before_expiry check (
    escalate_after_minutes is null or escalate_after_minutes < expire_after_minutes
  )
);

-- the hot path: all active policies for one action type, in priority order
create index policies_by_action
  on core.action_policies (tenant_id, action_type, priority)
  where active;
```

A condition is `{"field": "<dotted path>", "op": "<operator>", "value": <json>}`.
`field` is a path into the evaluation document assembled in §2. Operators reuse the
list-filter vocabulary from §1 of the contract plus `exists`:
`eq · ne · in · gte · lte · gt · lt · contains · exists`.

`check` constraints may not contain subqueries, so the shape validator is an immutable
function:

```sql
create or replace function app.is_valid_condition_set(p jsonb)
returns boolean language sql immutable parallel safe as $$
  select jsonb_typeof(p) = 'array'
     and coalesce(bool_and(
           e ? 'field'
           and e ? 'op'
           and e->>'op' in ('eq','ne','in','gte','lte','gt','lt','contains','exists')
           and (e->>'op' = 'exists' or e ? 'value')
           and (e->>'op' not in ('in') or jsonb_typeof(e->'value') = 'array')
           and (e->>'op' not in ('gte','lte','gt','lt')
                or jsonb_typeof(e->'value') = 'number')
         ), true)
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e;
$$;
```

The numeric-operator clause matters: it is what stops a malformed policy row from
turning a `numeric` cast into a runtime error inside the gate.

### 1.4 `core.action_requests` — the envelope log

Every call, its evaluation trace, its result. This is the table the run trace in §10
joins to when it renders `haltedBy`.

```sql
create table core.action_requests (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  ref                text not null,                        -- 'ACT-2026-0912'
  action_type        text not null references core.action_types(key),

  target_ref         text,
  target_entity      text,
  target_id          uuid,
  payload            jsonb not null default '{}'::jsonb,

  -- derived server-side in step 2, never taken from payload
  value_minor        bigint,
  currency           char(3),

  requested_by_kind  text not null check (requested_by_kind in ('HUMAN','AGENT','SYSTEM','CLIENT')),
  requested_by_id    text not null,
  requested_by_role  text not null,
  agent_run_id       text,
  confidence         numeric(4,3),
  reasoning          text,
  evidence           jsonb not null default '[]'::jsonb,

  -- the evaluation trace: one entry per step, in the order §3 specifies
  context_flags      jsonb not null default '{}'::jsonb,
  autonomy_level     text,                                 -- effective level after steps 1–4
  granted_level      text,                                 -- level as granted, before downgrades
  matched_policy_id  text,
  evaluation_trace   jsonb not null default '[]'::jsonb,

  -- the result
  -- EXECUTING while any external effect is still outstanding; see §7.3
  status             text not null
                     check (status in ('EXECUTING','EXECUTED','PARTIALLY_FAILED',
                                       'QUEUED_FOR_APPROVAL','SUGGESTED','REJECTED','FAILED')),
  effects            jsonb not null default '[]'::jsonb,   -- the frozen plan; §7 diff[] reads this
  effects_hash       text,
  approval_request_id uuid,
  suggested_draft_id  uuid,
  error_code         text,
  error_details      jsonb,
  idempotency_key_id uuid,

  created_at         timestamptz not null default now(),
  completed_at       timestamptz,

  unique (tenant_id, ref)
);

create index action_requests_by_type
  on core.action_requests (tenant_id, action_type, created_at desc);
create index action_requests_by_target
  on core.action_requests (tenant_id, target_ref, created_at desc)
  where target_ref is not null;
create index action_requests_by_run
  on core.action_requests (tenant_id, agent_run_id)
  where agent_run_id is not null;
-- the firstProposalToOrg fallback probe and the "how many actions this month" tile
create index action_requests_executed
  on core.action_requests (tenant_id, action_type, completed_at)
  where status in ('EXECUTED','PARTIALLY_FAILED');
-- the operations view: actions still waiting on an external effect
create index action_requests_executing
  on core.action_requests (tenant_id, created_at)
  where status = 'EXECUTING';
```

At the volume §10 implies (1,284 actions a month) this table does not need
partitioning. Revisit at roughly 10 million rows, at which point monthly range
partitioning on `created_at` is the obvious move because every query above is already
prefixed by `tenant_id` and bounded by time.

`evaluation_trace` entries look like this, and they are what the M18-S04 run trace and
the approval's `reason` string are both rendered from:

```json
[
  {"step": 1, "input": "autonomy",  "granted": "ACT_WITH_APPROVAL", "ceiling": "ACT_WITH_APPROVAL", "effective": "ACT_WITH_APPROVAL"},
  {"step": 2, "input": "value",     "valueMinor": 1850000, "thresholdMinor": null, "outcome": "NO_BAND"},
  {"step": 3, "input": "context",   "flags": {"firstProposalToOrg": true, "belowFloorPrice": false}},
  {"step": 3, "input": "policy",    "matched": "APV-01", "matchedOn": ["payload.value.amount gte 1500000", "context.firstProposalToOrg eq true"]},
  {"step": 4, "input": "confidence","value": 0.82, "minimum": 0.70, "outcome": "PASS"},
  {"step": 5, "input": "approver",  "role": "SALES_MANAGER", "assignedTo": "u_kelvin", "selfApproval": false},
  {"step": 6, "input": "dispatch",  "outcome": "QUEUED_FOR_APPROVAL", "approvalRef": "APV-2026-0771"}
]
```

### 1.5 `app.action_effects` — the execution ledger

`action_requests.effects` is the frozen plan: byte-stable, hashable, and identical to
what the approval screen rendered. `action_effects` is the mutable execution state of
each individual effect. Both exist on purpose. One column cannot be simultaneously
frozen for hashing and updated as a WhatsApp send retries.

```sql
create table app.action_effects (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null,
  action_request_id uuid not null references core.action_requests(id) on delete cascade,
  seq               int not null,                          -- position in effects[]

  op                text not null check (op in ('ADD','UPDATE','REMOVE')),
  entity            text not null,                         -- 'Proposal', 'Email', 'Opportunity'
  ref               text,
  description       text not null,

  kind              text not null check (kind in ('IN_DATABASE','EXTERNAL')),
  status            text not null default 'PLANNED'
                    check (status in ('PLANNED','APPLIED','DISPATCHED','SETTLED','DEAD_LETTERED')),

  job_id            uuid,                                  -- sb-events owns app.outbox
  job_key           text,                                  -- deterministic: '<action_request_id>:<seq>'
                                                           -- written to app.outbox.job_key
  attempts          int not null default 0,
  retryable         boolean not null default true,
  last_error        jsonb,
  applied_at        timestamptz,

  unique (action_request_id, seq),
  unique (tenant_id, job_key)
);

create index action_effects_open
  on app.action_effects (tenant_id, status, id)
  where status in ('PLANNED','DISPATCHED');
```

`unique (tenant_id, job_key)` here and the matching constraint on `app.outbox` are the
whole retry-safety story for external effects: the worker cannot create a second send
for the same effect however many times the job is redelivered. `sb-events` kept this
spelling on their table too, and reserved `idempotency_key` on `core.events` for a
different thing — the caller-supplied `Idempotency-Key` header from §1. Two keys, two
names, no ambiguity.

**The `op` union, per the contract-types ruling.** `DiffLine.op` and `Effect.op` are one
union, `ADD | UPDATE | REMOVE`, and the `CREATE` in the §4 `OPPORTUNITY_CONVERT` example
normalises to `ADD`. The typed shapes are in `packages/contract/src/actions.ts` and the
enum in `enums.ts` as ruling R1. Nothing in this design needed to change: the `check`
constraint above already carries exactly those three values, and the planner in §2.6
emits `ADD` for a creation. The normalisation is the planner's job, not the reader's —
`CREATE` must never reach `action_effects`, or the stored diff and the returned effects
would differ by a string while describing the same thing, which is the one failure §7
forbids.

One asymmetry worth noting against that package: `DiffLine.description` is required and
`Effect.description` is optional. `action_effects.description` is `not null`, so the
gate always produces the stronger of the two. That is deliberate, because the same
column is read back as both.

### 1.6 `core.approval_requests` — the full §7 shape

```sql
create table core.approval_requests (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  ref                text not null,                        -- 'APV-2026-0771'
  action_request_id  uuid not null references core.action_requests(id),
  policy_id          text not null,
  action_type        text not null references core.action_types(key),

  subject            text not null,                        -- 'Send proposal · Aurora Manufacturing Sdn Bhd'
  target_ref         text,
  value_minor        bigint,
  currency           char(3),
  margin_rate        numeric(5,4),                         -- sb-money supplies; displayed only

  requested_by_kind  text not null,
  requested_by_id    text not null,
  requested_by_name  text,
  agent_run_id       text,
  confidence         numeric(4,3),
  autonomy           text,                                 -- the level in force when raised

  reason             text not null,                        -- rendered from evaluation_trace
  recommendation     jsonb,                                -- {verdict, rationale}
  evidence           jsonb not null default '[]'::jsonb,   -- [{n, type, ref, label}]
  deviations         jsonb not null default '[]'::jsonb,   -- ["Client requested November specifically.", …]
  risk               jsonb,                                -- {level, note}
  diff               jsonb not null,                       -- === action_requests.effects
  diff_hash          text not null,
  preview_url        text,

  approver_role      text not null,
  assigned_to_id     text,
  assigned_to_name   text,

  sla_due_at         timestamptz not null,
  escalate_at        timestamptz,
  escalated_at       timestamptz,
  escalated_to_role  text,
  expires_at         timestamptz not null,
  breach_notified_at timestamptz,                          -- when the SLA event was emitted, once
  bulk_approvable    boolean not null,                     -- decided per request, §7

  status             text not null default 'PENDING'
                     check (status in ('PENDING','APPROVED','CHANGES_REQUESTED','REJECTED','EXPIRED')),
  decision           text check (decision in ('APPROVE','REQUEST_CHANGES','REJECT')),
  decision_note      text,
  decided_by_id      text,
  decided_by_name    text,
  decided_at         timestamptz,

  created_at         timestamptz not null default now(),

  unique (tenant_id, ref),

  constraint approval_decided_fields check (
    (status = 'PENDING' and decision is null and decided_at is null)
    or (status in ('EXPIRED') and decision is null)
    or (status in ('APPROVED','CHANGES_REQUESTED','REJECTED')
        and decision is not null and decided_by_id is not null and decided_at is not null)
  ),
  constraint approval_note_required check (
    decision is null or decision = 'APPROVE' or nullif(btrim(decision_note), '') is not null
  )
);

-- the M02-S01 inbox, grouped by urgency: role queue ordered by due date
create index approval_requests_queue
  on core.approval_requests (tenant_id, approver_role, sla_due_at)
  where status = 'PENDING';

-- "assigned to me"
create index approval_requests_assigned
  on core.approval_requests (tenant_id, assigned_to_id, sla_due_at)
  where status = 'PENDING';

-- the cron sweeps: cross-tenant, ordered by the clock
create index approval_requests_due
  on core.approval_requests (sla_due_at)
  where status = 'PENDING';
create index approval_requests_escalation
  on core.approval_requests (escalate_at)
  where status = 'PENDING' and escalated_at is null;

-- an action may have at most one open approval, enforced not asserted
create unique index approval_requests_one_open_per_action
  on core.approval_requests (action_request_id)
  where status = 'PENDING';
```

Two fields in the §7 response are **not** stored, because they are functions of the
clock and storing them guarantees they will be wrong:

```sql
create or replace view core.v_approval_requests as
select a.*,
       (a.status = 'PENDING' and now() > a.sla_due_at)                        as sla_breached,
       greatest(0, floor(extract(epoch from (a.sla_due_at - now())) / 60))::int as sla_remaining_minutes,
       case
         when a.status <> 'PENDING'                     then null
         when now() > a.sla_due_at                      then 'BREACHING'
         when a.sla_due_at < date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur')
                             + interval '1 day'         then 'TODAY'
         when a.sla_due_at < now() + interval '7 days'  then 'THIS_WEEK'
         else 'LATER'
       end                                                                     as urgency_group
from core.approval_requests a;
```

`breach_notified_at` is a different thing from `sla_breached`: the column records that
the `ApprovalSLABreached` event has been emitted, so the badge fires exactly once. The
boolean the API returns is always computed.

### 1.6a `core.approval_decisions` — the decision ledger

`sb-tenancy` §4.6 already writes RLS for this table, and it is the right shape. Every
decision attempt appends a row; `approval_requests.status` and its `decided_*` columns
are the current-state projection the list endpoint reads without a join.

The duplication is deliberate and is the same trade the effects ledger makes in §1.5.
An append-only ledger is where a rule whose failure is fraud rather than a defect
belongs, because it can carry an `INSERT` policy. A projection is what M02-S01 needs so
that rendering seven queue rows is seven column reads rather than seven joins.

```sql
create table core.approval_decisions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  approval_request_id uuid not null references core.approval_requests(id),
  decision            text not null check (decision in ('APPROVE','REQUEST_CHANGES','REJECT')),
  note                text,
  decided_by_id       text not null,
  decided_by_name     text,
  decided_by_role     text not null,
  via_bulk            boolean not null default false,
  diff_hash_at_decision text not null,        -- what the decider was actually looking at
  decided_at          timestamptz not null default now(),

  constraint approval_decisions_note_required check (
    decision = 'APPROVE' or nullif(btrim(note), '') is not null
  )
);

create index approval_decisions_by_request
  on core.approval_decisions (approval_request_id, decided_at desc);
-- the M02-S01 "median decision time this week" figure §15 asks for
create index approval_decisions_recent
  on core.approval_decisions (tenant_id, decided_at desc);
```

`sb-tenancy` puts the self-approval prohibition into this table's `INSERT` policy as
well as leaving it in the gate. That is the right call and I am not arguing with it:
`GOV-03` is now enforced in three places — at assignment, at decision, and by RLS.
Three copies of a rule is normally a defect. For this one rule it is proportionate,
because the failure mode is a manager approving their own discount and the cost of
being wrong is not a bug report.

`diff_hash_at_decision` is what makes the ledger worth having after the fact. It
records which version of the effects the decider saw, so a dispute six months later is
answerable from the database rather than from someone's memory.

### 1.7 `app.idempotency_keys`

```sql
create table app.idempotency_keys (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  actor_id          text not null,                -- scoped per actor: one user's key
  endpoint          text not null,                -- cannot replay another's
  key               text not null,

  request_hash      text not null,                -- sha256 of the canonical request body
  state             text not null default 'IN_FLIGHT' check (state in ('IN_FLIGHT','COMPLETED')),
  status_code       int,
  response          jsonb,
  action_request_id uuid,

  locked_at         timestamptz not null default now(),
  completed_at      timestamptz,
  expires_at        timestamptz not null default now() + interval '24 hours',

  unique (tenant_id, actor_id, endpoint, key)
);

create index idempotency_keys_expiry on app.idempotency_keys (expires_at);
```

24-hour retention per §1 of the contract. `expires_at` is a stored default rather than
a computed expression so a future per-endpoint retention is one `update` away.

Because the whole gate runs in one transaction, an `IN_FLIGHT` row is only ever
visible to the transaction that wrote it: a crash rolls the row back along with
everything else. The state column is kept because it makes the intent explicit in the
table and because a future two-phase variant (claim, call a slow worker, complete)
needs it.

Cleanup is a `pg_cron` job, batched so it never takes a long lock (§4.4).

### 1.8 `core.suggested_drafts`

```sql
create table core.suggested_drafts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  ref               text not null,                         -- 'drf_88…'
  action_request_id uuid not null references core.action_requests(id),
  action_type       text not null references core.action_types(key),
  target_ref        text,

  body              text,                                  -- the rendered draft the UI shows
  payload           jsonb not null default '{}'::jsonb,    -- replayed verbatim on accept
  planned_effects   jsonb not null default '[]'::jsonb,    -- preview of what accepting would do
  provenance        jsonb not null,                        -- §1 provenance envelope, origin AI_SUGGESTED

  status            text not null default 'OPEN'
                    check (status in ('OPEN','ACCEPTED','DISMISSED','EXPIRED')),
  accepted_action_request_id uuid,                          -- the human's action that took it up
  dismissed_reason  text,

  expires_at        timestamptz not null default now() + interval '7 days',
  created_at        timestamptz not null default now(),

  unique (tenant_id, ref)
);

create index suggested_drafts_open
  on core.suggested_drafts (tenant_id, action_type, expires_at)
  where status = 'OPEN';
```

Seven days matches the contract's own example: created `2026-09-11`, `expiresAt
2026-09-18`. Accepting a draft is not a mutation of the draft. It is a **fresh**
`POST /v1/actions` from the human, carrying `payload.fromDraftId`, which runs the full
gate again with a `HUMAN` requester. That is the whole point of the `SUGGESTED`
variant: the agent's suggestion carries no authority of its own.

### 1.9 The policy catalogue

Four ids appear in the sources: `APV-01` (§1, §3, §7, §10, §13), `APV-02` (§1 error
table, §6 floor-price breach), `FIN-01` (§9 invoice creation) and `FIN-03`
(`API.md` collections send). The rest are derived from the gates the contract
describes but never names, and from the `DECISIONS.md` §1 matrix. Prefixes:
`APV` commercial commitments, `FIN` money, `CMP` compliance, `GOV` agent governance.

`CMP` rather than `HRD` because `HRD-014`, `HRD-015` and `HRD-022` are already
compliance **rule** ids in §17. Two registries on one prefix is a defect.

| Id | Action type | Condition | Approver | SLA | Escalate | Source |
|---|---|---|---|---|---|---|
| `APV-01` | `PROPOSAL_SEND` | value ≥ RM 15,000 **or** `firstProposalToOrg` | `SALES_MANAGER` | 240m | `MD` @360m | contract §1 |
| `APV-02` | `DISCOUNT_APPROVE` | `belowFloorPrice` | `SALES_MANAGER` | 240m | `MD` @360m | contract §6 |
| `APV-03` | `DISCOUNT_APPROVE` | resulting margin < 0.5 × floor margin | `MD` | 240m | — | derived, `priority 50` |
| `APV-04` | `QUOTATION_APPLY` | discount % above the requester's `discountAuthority.maxPct` | `SALES_MANAGER` | 240m | `MD` @360m | `DECISIONS` §5 |
| `APV-05` | `TRAINER_BOOK` | always | `OPS` | 480m | `MD` @720m | `DECISIONS` §1 |
| `APV-06` | `ENGAGEMENT_CLOSE_OUT` | `attendanceLocked` is false **or** packet incomplete | `OPS` | 480m | — | derived |
| `APV-07` | `BROADCAST_SEND` | always | `SALES_MANAGER` | 240m | `MD` @360m | derived |
| `APV-08` | `FOLLOWUP_SEND` | `payload.category = MARKETING` | `SALES_MANAGER` | 240m | — | `DECISIONS` §1 |
| `FIN-01` | `INVOICE_CREATE` | always | `FINANCE` | 240m | `MD` @360m | contract §9 |
| `FIN-02` | `INVOICE_PUSH` | always | `FINANCE` | 240m | `MD` @360m | derived |
| `FIN-03` | `REMINDER_SEND` | `payload.stage in (REMINDER_1, REMINDER_2)` | `FINANCE` | 240m | — | `API.md` |
| `FIN-04` | `REMINDER_SEND` | `payload.stage = REMINDER_3` | `FINANCE` | 240m | `MD` @360m | `DECISIONS` §1 ("always human") |
| `FIN-05` | `REMINDER_SEND` | `payload.stage = TRADING_HOLD` | `MD` | 480m | — | contract §9 ladder |
| `FIN-06` | `PAYMENT_RECORD` | recorded amount ≠ outstanding (write-off or overpayment) | `FINANCE` | 240m | — | derived |
| `FIN-07` | `BUDGET_CAP_RAISE` | always | `MD` | 480m | — | contract §17 |
| `CMP-01` | `ATTENDANCE_APPROVE` | always (lock is one-way) | `OPS` | 240m | — | `DECISIONS` §1 |
| `CMP-02` | `ATTENDANCE_UNLOCK` | always | `FINANCE` | 120m | `MD` @240m | contract §8 |
| `CMP-03` | `ATTENDANCE_UNLOCK` | `claimReferenceExists` | `MD` | 120m | — | §16 Q5, `priority 50` |
| `CMP-04` | `HRDC_PACKET_MARK_SUBMITTED` | always | `FINANCE` | 240m | — | `DECISIONS` §1 |
| `CMP-05` | `RULE_CHANGE_APPROVE` | always | `FINANCE` | 1440m | `ADMIN` @2880m | contract §17 |
| `GOV-01` | `AGENT_AUTONOMY_CHANGE` | always | `MD` | 1440m | — | contract §10 (MD-gated) |
| `GOV-02` | `AGENT_PAUSE` | **never gated** | — | — | — | Phase 1 decision 6 |
| `GOV-03` | *(cross-cutting)* | self-approval prohibition | — | — | — | contract §3 input 5 |
| `GOV-04` | *(cross-cutting)* | kill switch / paused agent | — | — | — | contract §10 |
| `GOV-05` | *(cross-cutting)* | confidence below the agent minimum | — | — | — | contract §3 input 4 |
| `GOV-06` | *(cross-cutting)* | jury `ESCALATE` trigger fired | — | — | — | contract §18 |

`GOV-03` through `GOV-06` are not rows in `core.action_policies`. They are hard rules inside
`perform_action` that no tenant may switch off. They carry ids anyway so that a `403`
or a downgraded autonomy level can cite one, and so the run trace can say *which* rule
halted the agent rather than only *that* one did.

`APV-03` and `CMP-03` carry `priority 50` so they win against the `priority 100` rule
on the same action type. That is the whole mechanism for "a deeper breach needs a more
senior approver": a second row, a lower number, a different `approver_role`.

`APV-01` as a row, matching the contract's own `GET /v1/policies` example byte for
byte:

```sql
insert into core.action_policies
  (tenant_id, id, action_type, description, conditions, combinator,
   approver_role, sla_minutes, escalate_to_role, escalate_after_minutes)
values
  (:tenant, 'APV-01', 'PROPOSAL_SEND',
   'Proposal send above RM 15,000 or first proposal to an organisation',
   '[{"field": "value.amount",               "op": "gte", "value": 1500000},
     {"field": "context.firstProposalToOrg", "op": "eq",  "value": true}]'::jsonb,
   'ANY', 'SALES_MANAGER', 240, 'MD', 360);
```

### 1.10 Jury tables

```sql
create table core.jury_configs (
  tenant_id               uuid not null,
  action_type             text not null references core.action_types(key),
  mode                    text not null check (mode in ('GATE','SAMPLE','ESCALATE')),
  quorum                  int  not null default 2,
  of                      int  not null default 3,
  tiers                   text[] not null default '{STRONG_1,STRONG_2,STRONG_3}',
  sample_rate             numeric(4,3) default 0.050,
  trigger_min_confidence  numeric(4,3),                     -- 0.70 per DECISIONS §2
  trigger_max_value_minor bigint,                           -- 5000000 = RM 50,000
  trigger_first_of_kind   boolean not null default false,
  active                  boolean not null default true,
  primary key (tenant_id, action_type),
  constraint jury_quorum_sane check (quorum >= 1 and quorum <= of and of <= 5),
  constraint jury_sample_rate_needs_sample check (mode <> 'SAMPLE' or sample_rate is not null)
);

create table core.jury_verdicts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  action_request_id   uuid references core.action_requests(id),
  approval_request_id uuid references core.approval_requests(id),
  autonomy_grant_id   uuid references core.autonomy_grants(id),   -- GATE runs at promotion

  mode                text not null check (mode in ('GATE','SAMPLE','ESCALATE')),
  trigger_reason      text check (trigger_reason in
                        ('LOW_CONFIDENCE','HIGH_VALUE','FIRST_OF_KIND','SAMPLED','PROMOTION')),
  quorum              int not null,
  "of"                int not null,
  tiers               text[] not null,
  golden_set_id       text,                                     -- GATE only

  opinions            jsonb not null default '[]'::jsonb,       -- [{tier, verdict, confidence, rationale}]
  verdict             text check (verdict in ('AGREE','DISAGREE','INCONCLUSIVE')),
  dissenters          jsonb not null default '[]'::jsonb,
  cost_minor          bigint,

  job_id              uuid,
  status              text not null default 'PENDING'
                      check (status in ('PENDING','COMPLETE','FAILED')),
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index jury_verdicts_pending
  on core.jury_verdicts (tenant_id, status, created_at)
  where status = 'PENDING';
```

`"of"` is quoted because `of` is a reserved word. That is the one identifier in this
document that needs quotes, and it is worth flagging to `sb-erd` that the contract's
field name forces it.

---

## 2 · `app.perform_action` — the evaluation algorithm

One function. `SECURITY DEFINER` so it can write domain tables the caller has no grant
on, with `search_path` pinned so a caller cannot shadow `core` with a schema of their
own. A `SECURITY DEFINER` function without a pinned `search_path` is a privilege
escalation, not a convenience.

```sql
create or replace function app.perform_action(
  p_type            text,
  p_target_ref      text    default null,
  p_payload         jsonb   default '{}'::jsonb,
  p_requested_by    jsonb   default null,        -- {kind, id}; null means "the caller"
  p_confidence      numeric default null,
  p_reasoning       text    default null,
  p_evidence        jsonb   default '[]'::jsonb,
  p_idempotency_key text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, core, public, extensions, pg_temp
set statement_timeout = '10s'
as $$
```

`statement_timeout` is set on the function rather than the role: the gate does index
probes and small writes, so ten seconds is already three orders of magnitude of
headroom, and a gate that hangs is worse than a gate that fails.

### 2.0 Guards, in order

The order is not stylistic. Each guard is cheaper than the one after it, and each one
would be wrong if it ran later.

```sql
declare
  v_tenant     uuid   := app.require_tenant_id();       -- sb-tenancy, see note below
  v_actor      record := app.current_actor();           -- sb-tenancy: (id, kind, role)
  v_actor_kind text;
  v_actor_id   text;
  v_type       core.action_types%rowtype;
  v_hash       text;
  v_idem       app.idempotency_keys%rowtype;
  v_grant      core.autonomy_grants%rowtype;
  v_policy     core.action_policies%rowtype;
  v_level      text;
  v_granted    text;
  v_value      jsonb;
  v_context    jsonb;
  v_doc        jsonb;
  v_effects    jsonb;
  v_trace      jsonb := '[]'::jsonb;
  v_req        core.action_requests%rowtype;
  v_result     jsonb;
begin
```

**Two corrections from `sb-tenancy`, applied.** Their `app.current_tenant_id()` returns
`null` rather than raising, because a policy predicate that raises turns a denied read
into a 500 instead of an empty set. That is correct for a policy and wrong for this
gate, where a missing tenant must be an error and never a silent no-match. So the gate
calls `app.require_tenant_id()`, the raising variant they are adding for exactly this.
And the tenant is a **top-level** JWT claim, not one under `app_metadata`: the custom
access token hook writes `tenant_id`, `app_role`, `actor_kind`, `agent_id` at the top
level. Reading the wrong path returns null silently and every check then denies
everything, which presents as a permissions bug rather than a claim bug.

**On role checks.** `sb-tenancy` prefers `app.has_permission('approval:decide')` over
`app.has_role('SALES_MANAGER')`, because the role-to-permission matrix is data and an MD
can move a permission between roles without a migration. They are right, and §4.1's
authorisation check should read `app.has_permission('approval:decide')`. One place
keeps a role comparison and must: `approval_requests.approver_role` is a *routing*
value that the policy row names and the §7 response returns, so the gate stores and
compares a role there. The permission check answers "may you decide at all"; the role
comparison answers "is this approval yours". Both are needed.

**(a) Resolve the actor.** A `HUMAN` may not impersonate. Only the service role, used
by the agent runtime, may pass `p_requested_by` with a different id, and only for
`kind = 'AGENT'` or `'SYSTEM'`.

```sql
  v_actor_kind := coalesce(p_requested_by->>'kind', v_actor.kind);
  v_actor_id   := coalesce(p_requested_by->>'id',   v_actor.id);

  if (v_actor_kind, v_actor_id) is distinct from (v_actor.kind, v_actor.id)
     and not app.is_service_role() then
    raise exception using errcode = 'TRNOS',
      message = 'requestedBy does not match the authenticated principal',
      detail  = jsonb_build_object('code','FORBIDDEN','requiredRole','AGENT')::text;
  end if;
```

**(b) Serialise on the idempotency key, then claim it.** The advisory lock comes
*before* the insert, which is what makes a double-click deterministic rather than a
race: the second call blocks on the lock, the first commits, the second then sees a
`COMPLETED` row and replays it.

```sql
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(
      hashtext(v_tenant::text || ':' || v_actor_id || ':' || p_idempotency_key)
    );

    v_hash := encode(sha256(convert_to(
      jsonb_build_object('type', p_type, 'targetRef', p_target_ref,
                         'payload', p_payload, 'requestedBy', p_requested_by)::text,
      'UTF8')), 'hex');

    insert into app.idempotency_keys
      (tenant_id, actor_id, endpoint, key, request_hash)
    values
      (v_tenant, v_actor_id, 'POST /v1/actions', p_idempotency_key, v_hash)
    on conflict (tenant_id, actor_id, endpoint, key) do nothing
    returning * into v_idem;

    if v_idem.id is null then                       -- a row already existed
      select * into v_idem from app.idempotency_keys
      where tenant_id = v_tenant and actor_id = v_actor_id
        and endpoint = 'POST /v1/actions' and key = p_idempotency_key;

      if v_idem.request_hash is distinct from v_hash then
        raise exception using errcode = 'TRNOS',
          message = 'Idempotency key reused with a different body',
          detail  = jsonb_build_object('code','IDEMPOTENT_REPLAY')::text;   -- 409
      end if;

      perform set_config('response.headers',
                         '[{"Idempotent-Replay": "true"}]', true);
      perform set_config('response.status', coalesce(v_idem.status_code, 200)::text, true);
      return v_idem.response;                        -- 200 + the original body
    end if;
  end if;
```

`sha256()` is built into Postgres 11 and later, so this needs no `pgcrypto`. The hash
covers the fields the contract calls "the body"; `confidence`, `reasoning` and
`evidence` are deliberately excluded, because an agent retrying the same action with a
slightly different rationale string must not be treated as a different request.

**(c) The action type must exist and be active.**

```sql
  select * into v_type from core.action_types where key = p_type and active;
  if not found then
    raise exception using errcode = 'TRNOS',
      message = format('Unknown action type %L', p_type),
      detail  = jsonb_build_object('code','VALIDATION_FAILED',
                  'fields', jsonb_build_array(
                    jsonb_build_object('field','type','reason','UNKNOWN_ACTION_TYPE')))::text;
  end if;
```

**(d) Payload validation** against `action_types.payload_schema`, producing the
`details.fields[]` array §1 promises:

```sql
  declare v_missing jsonb;
  begin
    select jsonb_agg(jsonb_build_object('field', k, 'reason', 'REQUIRED'))
      into v_missing
    from jsonb_array_elements_text(coalesce(v_type.payload_schema->'required','[]'::jsonb)) k
    where not (p_payload ? k) or p_payload->>k is null;

    if v_missing is not null then
      raise exception using errcode = 'TRNOS',
        message = 'Payload validation failed',
        detail  = jsonb_build_object('code','VALIDATION_FAILED','fields', v_missing)::text;
    end if;
  end;
```

**(e) Kill switch and pause — `GOV-04`.** Before any policy work, because a paused
agent's request must cost nothing. `AGENT_PAUSE` is exempt: stopping must always be
possible, including stopping an already-degraded agent.

```sql
  if v_actor_kind = 'AGENT' and p_type <> 'AGENT_PAUSE' then
    if app.tenant_kill_switch(v_tenant) then
      raise exception using errcode = 'TRNOS',
        message = 'All agent actions are suspended for this tenant',
        detail  = jsonb_build_object('code','AGENT_PAUSED','reason','TENANT_KILL_SWITCH')::text;
    end if;

    if exists (select 1 from core.agents a
               where a.tenant_id = v_tenant and a.id = v_actor_id
                 and (a.kill_switch or a.status = 'PAUSED')) then
      raise exception using errcode = 'TRNOS',
        message = 'Action routed to a paused agent',
        detail  = jsonb_build_object('code','AGENT_PAUSED','reason','AGENT_PAUSED',
                                     'agentId', v_actor_id)::text;
    end if;

    if app.budget_paused(v_tenant, p_type) then         -- §17: a tripped cap
      raise exception using errcode = 'TRNOS',
        message = 'Budget cap reached for this action type',
        detail  = jsonb_build_object('code','AGENT_PAUSED','reason','BUDGET_CAP')::text;
    end if;
  end if;
```

All three raise `409 AGENT_PAUSED` with a distinguishing `details.reason`, matching
§10 and §17. The per-action-type pause on `autonomy_grants.paused` is checked in step 1
where the grant is already in hand.

**A note on recording errors against the idempotency key.** Every raise above aborts
the transaction, which rolls back the idempotency row with it. So a client retrying
after a `409 AGENT_PAUSED` gets a fresh evaluation, which is correct: the agent may
have been resumed. Only *successful* responses, meaning the three variants, are stored
for replay. The one exception is `IDEMPOTENT_REPLAY` itself, which by definition never
stores anything.

### 2.1 Step 1 · autonomy lookup

> §3: `type` → the autonomy level granted to `requestedBy` for that action type.
> Human requesters skip to step 3.

```sql
  if v_actor_kind = 'AGENT' then
    select * into v_grant
    from core.autonomy_grants
    where tenant_id = v_tenant and agent_id = v_actor_id and action_type = p_type;

    if not found then
      v_granted := 'OBSERVE';                       -- default deny, Phase 1 decision 5
    else
      v_granted := v_grant.level;
    end if;

    if v_grant.paused then
      raise exception using errcode = 'TRNOS',
        message = format('%s is paused for %s', p_type, v_actor_id),
        detail  = jsonb_build_object('code','AGENT_PAUSED','reason','ACTION_TYPE_PAUSED',
                                     'actionType', p_type)::text;
    end if;

    -- the ceiling is re-applied here, not only on the grant: a catalogue change
    -- must take effect without rewriting every grant row
    v_level := case
                 when app.autonomy_rank(v_granted) > app.autonomy_rank(v_type.ceiling_autonomy)
                 then v_type.ceiling_autonomy
                 else v_granted
               end;

    if v_level = 'OBSERVE' then
      raise exception using errcode = 'TRNOS',
        message = format('%s is not permitted to perform %s', v_actor_id, p_type),
        detail  = jsonb_build_object('code','FORBIDDEN','requiredRole','AGENT',
                                     'grantedLevel','OBSERVE')::text;
    end if;
  else
    v_level   := null;              -- humans have no grant; policy alone decides
    v_granted := null;
  end if;

  v_trace := v_trace || jsonb_build_object(
    'step', 1, 'input', 'autonomy', 'granted', v_granted,
    'ceiling', v_type.ceiling_autonomy, 'effective', v_level);
```

Re-applying the ceiling at evaluation time rather than trusting the grant is the
belt-and-braces half of the `MONEY_MOVING_CEILING` rule. The trigger stops a bad grant
from being written; this stops a grant written before a catalogue change from
outliving it.

### 2.2 Step 2 · monetary value against thresholds

> §3: `payload` monetary value, compared against policy thresholds.

The value is read from the record. This is the design decision that makes the gate
trustworthy: an agent that wants to send a RM 18,500 proposal cannot claim it is worth
RM 14,000.

```sql
create or replace function app.action_value(
  p_type text, p_tenant uuid, p_target_id uuid, p_payload jsonb
) returns jsonb
language plpgsql stable
set search_path = pg_catalog, app, core, public, extensions, pg_temp
as $$
declare v_amount bigint; v_currency char(3) := 'MYR';
begin
  case (select value_source from core.action_types where key = p_type)

    when 'PROPOSAL' then
      -- sb-erd: one stable money column per gated target, frozen by an
      -- immutability rule at the point the gate reads it
      select p.value_minor, p.currency into v_amount, v_currency
      from core.proposals p
      where p.tenant_id = p_tenant and p.id = p_target_id;

    when 'QUOTATION' then
      -- sb-money persists these; the gate compares, it never computes
      select q.sell_price_minor, q.currency into v_amount, v_currency
      from core.quotations q
      where q.tenant_id = p_tenant and q.id = p_target_id;

    when 'INVOICE' then
      select i.total_minor, i.currency into v_amount, v_currency
      from core.invoices i
      where i.tenant_id = p_tenant and i.id = p_target_id;

    when 'HRDC_CLAIM' then
      select h.claim_value_minor, h.currency into v_amount, v_currency
      from core.hrdc_packets h
      where h.tenant_id = p_tenant and h.engagement_id = p_target_id;

    when 'PAYMENT' then
      -- the one case the payload legitimately supplies: the amount being recorded.
      -- It is still bounded below by the invoice in FIN-06.
      v_amount := (p_payload#>>'{amount,amount}')::bigint;
      v_currency := coalesce(p_payload#>>'{amount,currency}', 'MYR');

    when 'BUDGET_CAP' then
      v_amount := (p_payload#>>'{requestedCap,amount}')::bigint;

    else
      return null;                          -- valueless action type
  end case;

  if v_amount is null then return null; end if;
  return jsonb_build_object('amount', v_amount, 'currency', v_currency);
end;
$$;
```

Then the autonomous band from `DECISIONS.md` §1 ("value < RM 15k AND repeat client →
Autonomous for that band"):

```sql
  v_value := app.action_value(p_type, v_tenant, v_target_id, p_payload);

  if v_level = 'AUTONOMOUS'
     and v_grant.value_threshold_minor is not null
     and coalesce((v_value->>'amount')::bigint, 0) > v_grant.value_threshold_minor then
    v_level := 'ACT_WITH_APPROVAL';
    v_trace := v_trace || jsonb_build_object(
      'step', 2, 'input', 'value', 'valueMinor', (v_value->>'amount')::bigint,
      'thresholdMinor', v_grant.value_threshold_minor,
      'outcome', 'DOWNGRADED_THRESHOLD_EXCEEDED');
  else
    v_trace := v_trace || jsonb_build_object(
      'step', 2, 'input', 'value', 'valueMinor', (v_value->>'amount')::bigint,
      'thresholdMinor', v_grant.value_threshold_minor, 'outcome', 'WITHIN_BAND');
  end if;
```

### 2.3 Step 3 · context flags, computed server-side

> §3: `firstProposalToOrg`, `belowFloorPrice`, `overdueBalanceOnAccount`,
> `attendanceLocked`, `deadlineWithinDays`.

Each is one index probe. Column names in `core` belong to `sb-erd`; the index each
probe needs is named alongside it.

**`firstProposalToOrg`** — §16 Q3 answered: computed live, never denormalised.

```sql
select not exists (
  select 1
  from core.proposals p
  where p.tenant_id      = v_tenant
    and p.organisation_id = v_org_id
    and p.status in ('SENT','VIEWED','ACCEPTED','LOST')
    and p.id <> v_proposal_id
) into v_first_proposal;

-- needed from sb-erd:
create index proposals_org_sent on core.proposals (tenant_id, organisation_id)
  where status in ('SENT','VIEWED','ACCEPTED','LOST');
```

The partial index makes this an index-only existence probe that stops at the first
matching tuple. The alternative, a denormalised `has_had_proposal` flag on the
organisation, must be invalidated on every proposal status change, on every
organisation merge, and on every proposal deletion, and it goes stale silently when one
of those paths is missed. A flag that is wrong is worse than a probe that costs
microseconds.

**`belowFloorPrice`** — a comparison, not a calculation. `sb-money` resolved the §6
fixture into two independent floors, and `sb-erd` persists all of them on the quotation:
`absolute_floor_minor` from the pricing tier, `margin_floor_minor` computed from cost,
`binding_floor` naming which one binds, and `floor_price_minor` holding the binding
value. The gate reads only the last of those. Which floor binds is a pricing question
and it is not the gate's to answer.

```sql
select q.sell_price_minor < q.floor_price_minor
  into v_below_floor
from core.quotations q
where q.tenant_id = v_tenant and q.id = v_quotation_id;
```

**`overdueBalanceOnAccount`**

```sql
select exists (
  select 1
  from core.invoices i
  where i.tenant_id       = v_tenant
    and i.organisation_id = v_org_id
    and i.status in ('SENT','PARTIALLY_PAID','OVERDUE')
    and i.due_at < current_date
    and i.outstanding_minor > 0
) into v_overdue;

-- needed from sb-erd:
create index invoices_overdue on core.invoices (tenant_id, organisation_id, due_at)
  where outstanding_minor > 0 and status in ('SENT','PARTIALLY_PAID','OVERDUE');
```

**`attendanceLocked`**

```sql
select exists (
  select 1
  from core.attendance_days ad
  where ad.tenant_id     = v_tenant
    and ad.engagement_id  = v_engagement_id
    and (v_day is null or ad.day = v_day)
    and ad.status = 'LOCKED'
) into v_attendance_locked;
```

**`deadlineWithinDays`** — the nearest binding deadline on the target, in calendar
days, negative when already passed. `null` when the target has no deadline.

```sql
select min(d)::int into v_deadline_days
from (
  select (hp.deadline_at at time zone 'Asia/Kuala_Lumpur')::date - current_date as d
    from core.hrdc_packets hp
   where hp.tenant_id = v_tenant and hp.engagement_id = v_engagement_id
  union all
  select i.due_at - current_date
    from core.invoices i
   where i.tenant_id = v_tenant and i.id = v_invoice_id
  union all
  select e.starts_on - current_date
    from core.engagements e
   where e.tenant_id = v_tenant and e.id = v_engagement_id
) s(d)
where d is not null;
```

Calendar days, per `DECISIONS.md` §3, which corrects the demo's five-working-day
assumption. The timezone cast is not decoration: `deadlineAt` in §9 is
`2026-11-17T23:59:59+08:00`, and computing days against UTC would report the wrong
number for eight hours of every day.

**Four more flags the policy catalogue needs**, derived beyond the five the contract
names:

```sql
-- consentWithdrawn: FOLLOWUP_SEND, BROADCAST_SEND, REMINDER_SEND
select exists (select 1 from core.contact_consents c
               where c.tenant_id = v_tenant and c.contact_id = v_contact_id
                 and c.channel = p_payload->>'channel' and c.withdrawn_at is not null)
  into v_consent_withdrawn;

-- packetIncomplete: HRDC_PACKET_MARK_SUBMITTED is 422 while completeness < 1
select hp.completeness < 1.0 into v_packet_incomplete
from core.hrdc_packets hp
where hp.tenant_id = v_tenant and hp.engagement_id = v_engagement_id;

-- claimReferenceExists: ATTENDANCE_UNLOCK, §16 Q5
select hp.submission_reference is not null into v_claim_ref_exists
from core.hrdc_packets hp
where hp.tenant_id = v_tenant and hp.engagement_id = v_engagement_id;

-- firstOfKind: the jury trigger in §18 — new client, new programme, or new trainer
select not exists (select 1 from core.engagements e
                   where e.tenant_id = v_tenant and e.organisation_id = v_org_id
                     and e.status in ('DELIVERED','CLOSED'))
    or not exists (select 1 from core.engagements e
                   where e.tenant_id = v_tenant and e.programme_id = v_programme_id
                     and e.status in ('DELIVERED','CLOSED'))
  into v_first_of_kind;
```

**Assembling the evaluation document.** Policy conditions are evaluated against this,
never against tables, which is what makes a policy row cheap regardless of how many
conditions it carries:

```sql
  v_context := jsonb_strip_nulls(jsonb_build_object(
    'firstProposalToOrg',      v_first_proposal,
    'belowFloorPrice',         v_below_floor,
    'overdueBalanceOnAccount', v_overdue,
    'attendanceLocked',        v_attendance_locked,
    'deadlineWithinDays',      v_deadline_days,
    'consentWithdrawn',        v_consent_withdrawn,
    'packetIncomplete',        v_packet_incomplete,
    'claimReferenceExists',    v_claim_ref_exists,
    'firstOfKind',             v_first_of_kind
  ));

  v_doc := jsonb_build_object(
    'payload',    p_payload,
    'value',      v_value,
    'context',    v_context,
    'confidence', p_confidence,
    'requester',  jsonb_build_object('kind', v_actor_kind, 'id', v_actor_id,
                                     'role', v_actor.role),
    'target',     jsonb_build_object('ref', p_target_ref, 'entity', v_type.target_entity)
  );

  v_trace := v_trace || jsonb_build_object('step', 3, 'input', 'context', 'flags', v_context);
```

**Policy matching** happens here, at the end of step 3, because it is the first moment
both the value and the flags exist. Its result is consumed by step 5.

```sql
  select p.* into v_policy
  from core.action_policies p
  where p.tenant_id = v_tenant
    and p.action_type = p_type
    and p.active
    and p.effective_from <= now()
    and (p.effective_to is null or p.effective_to > now())
    and app.policy_matches(p.conditions, p.combinator, v_doc)
  order by p.priority, p.id
  limit 1;

  v_trace := v_trace || jsonb_build_object(
    'step', 3, 'input', 'policy', 'matched', v_policy.id);
```

The interpreter:

```sql
create or replace function app.policy_matches(
  p_conditions jsonb, p_combinator text, p_doc jsonb
) returns boolean
language sql immutable parallel safe
as $$
  with c as (
    select p_doc #> string_to_array(e->>'field', '.') as lhs,
           e->>'op'                                   as op,
           e->'value'                                 as rhs
    from jsonb_array_elements(p_conditions) e
  ), r as (
    select case op
             when 'eq'       then lhs = rhs
             when 'ne'       then lhs is distinct from rhs
             when 'in'       then rhs @> lhs
             when 'contains' then (lhs #>> '{}') ilike '%' || (rhs #>> '{}') || '%'
             when 'exists'   then (lhs is not null and lhs <> 'null'::jsonb) = (rhs = 'true'::jsonb)
             when 'gte'      then app.jnum(lhs) >= app.jnum(rhs)
             when 'lte'      then app.jnum(lhs) <= app.jnum(rhs)
             when 'gt'       then app.jnum(lhs) >  app.jnum(rhs)
             when 'lt'       then app.jnum(lhs) <  app.jnum(rhs)
             else false
           end as ok
    from c
  )
  select case when p_combinator = 'ALL'
              then coalesce(bool_and(coalesce(ok, false)), true)
              else coalesce(bool_or (coalesce(ok, false)), false)
         end
  from r;
$$;

-- a missing or non-numeric value is "no match", never an error
create or replace function app.jnum(p jsonb)
returns numeric language plpgsql immutable parallel safe as $$
begin
  return (p #>> '{}')::numeric;
exception when others then
  return null;
end;
$$;
```

`ANY` over an empty condition list is `false` and `ALL` over an empty list is `true`,
which is why the `APV-05`-style "always" policies in §1.9 are written with
`combinator = 'ALL'` and `conditions = '[]'`. That is a deliberate idiom, not an
accident, and it means an unconditional policy needs no sentinel condition.

### 2.4 Step 4 · confidence against the agent minimum — `GOV-05`

```sql
  if v_actor_kind = 'AGENT' then
    if coalesce(p_confidence, 0) < coalesce(v_grant.min_confidence, 0.700) then
      if v_level = 'AUTONOMOUS' then
        v_level := 'ACT_WITH_APPROVAL';             -- downgrade, never reject
      end if;
      v_low_confidence := true;
      v_trace := v_trace || jsonb_build_object(
        'step', 4, 'input', 'confidence', 'value', p_confidence,
        'minimum', v_grant.min_confidence, 'policyId', 'GOV-05',
        'outcome', 'DOWNGRADED');
    else
      v_trace := v_trace || jsonb_build_object(
        'step', 4, 'input', 'confidence', 'value', p_confidence,
        'minimum', v_grant.min_confidence, 'outcome', 'PASS');
    end if;
  end if;
```

Low confidence downgrades and never upgrades. An agent that is unsure should ask a
human, not stop: refusing outright would mean the work silently never happens, which
is the failure mode the approval queue exists to prevent. When the downgrade happens,
the approval it raises carries `risk.level = 'HIGH'` and a `reason` that names
`GOV-05`, so the manager sees *why* it landed in their queue.

**The jury trigger — `GOV-06`** is evaluated here, immediately after confidence,
because it consumes the same three numbers:

```sql
  select * into v_jury from core.jury_configs
  where tenant_id = v_tenant and action_type = p_type and active;

  if found and v_jury.mode = 'ESCALATE' and v_level = 'AUTONOMOUS' then
    if (v_jury.trigger_min_confidence is not null
        and coalesce(p_confidence, 0) < v_jury.trigger_min_confidence)
       or (v_jury.trigger_max_value_minor is not null
        and coalesce((v_value->>'amount')::bigint, 0) > v_jury.trigger_max_value_minor)
       or (v_jury.trigger_first_of_kind and v_first_of_kind) then
      v_level := 'ACT_WITH_APPROVAL';               -- blocks autonomy, not the transaction
      v_jury_triggered := true;
    end if;
  end if;
```

### 2.5 Step 5 · self-approval prohibition — `GOV-03`

> §3: Requester role against the policy's `approverRole` — a user cannot approve their
> own request.

```sql
  if v_policy.id is not null then
    -- a human holding the approver role: does the policy let them self-authorise?
    if v_actor_kind = 'HUMAN'
       and v_actor.role = v_policy.approver_role
       and v_policy.self_authorise then
      v_level := 'SELF_AUTHORISED';                 -- executes, audited as such
      v_trace := v_trace || jsonb_build_object(
        'step', 5, 'input', 'approver', 'role', v_policy.approver_role,
        'selfAuthorised', true, 'policyId', 'GOV-03');
    else
      -- pick an approver who is not the requester
      select u.id, u.name into v_assignee_id, v_assignee_name
      from app.role_holders(v_tenant, v_policy.approver_role) u
      where u.id is distinct from v_actor_id
      order by u.open_approval_count, u.id                 -- cheapest queue first
      limit 1;

      if v_assignee_id is null and v_policy.escalate_to_role is not null then
        select u.id, u.name into v_assignee_id, v_assignee_name
        from app.role_holders(v_tenant, v_policy.escalate_to_role) u
        where u.id is distinct from v_actor_id
        order by u.open_approval_count, u.id
        limit 1;
      end if;

      if v_assignee_id is null then
        raise exception using errcode = 'TRNOS',
          message = format('No eligible %s approver other than the requester',
                           v_policy.approver_role),
          detail  = jsonb_build_object('code','VALIDATION_FAILED',
                      'reason','NO_ELIGIBLE_APPROVER',
                      'requiredRole', v_policy.approver_role)::text;
      end if;

      v_trace := v_trace || jsonb_build_object(
        'step', 5, 'input', 'approver', 'role', v_policy.approver_role,
        'assignedTo', v_assignee_id, 'selfApproval', false);
    end if;
  end if;
```

`app.role_holders(tenant, roles[])` is a `stable` helper over `sb-tenancy`'s membership
tables, returning each holder with their open approval count so assignment is a crude
but honest round-robin rather than always landing on the same manager.

**One function, not two.** `sb-events` needs the same lookup for badge fan-out — the set
of users holding a role — where the gate needs one of them. They asked whose lane should
hold it. It should be **`sb-tenancy`'s**, because it reads their membership tables and
neither of us should be joining across into those directly. So: `app.role_holders`
returns the set and takes an array, `sb-events` calls it as-is, and the gate's
`app.pick_role_holder(tenant, role, exclude_actor)` becomes a thin wrapper that adds the
ordering and the exclusion. Two implementations of one membership query would drift the
first time a role gained a scope condition.

Self-approval is enforced **twice**: here, so it can never be assigned to the
requester, and again in `app.decide_approval`, so an assignment written before a role
change cannot become a self-approval afterwards. One check would be a bug waiting for
a reorganisation.

### 2.6 Dispatch

The matrix, complete. "Policy matched" means a row in `core.action_policies` matched at the end
of step 3.

| Requester | Effective level after steps 1–4 | Policy matched | Outcome | HTTP |
|---|---|---|---|---|
| `HUMAN` | not applicable | no | `EXECUTED` | 202 |
| `HUMAN` | not applicable | yes, `self_authorise` false | `QUEUED_FOR_APPROVAL` | 202 |
| `HUMAN` | not applicable | yes, `self_authorise` true and role matches | `EXECUTED` | 202 |
| `SYSTEM` | not applicable | ignored | `EXECUTED` | 202 |
| `AGENT` | `OBSERVE` | any | `403 FORBIDDEN` | 403 |
| `AGENT` | `SUGGEST` | any | `SUGGESTED` | 200 |
| `AGENT` | `ACT_WITH_APPROVAL` | any | `QUEUED_FOR_APPROVAL` | 202 |
| `AGENT` | `AUTONOMOUS` | no | `EXECUTED` | 202 |
| `AGENT` | `AUTONOMOUS` | yes | `QUEUED_FOR_APPROVAL` | 202 |

The last row is the invariant worth naming: **policy beats grant, always**. A grant
says what an agent is allowed to attempt. A policy says what the organisation permits
to happen. When they disagree, the organisation wins, and an `ACT_WITH_APPROVAL`
agent is never promoted by the absence of a matching policy either.

`SYSTEM` requesters, meaning webhook ingest and scheduled jobs, bypass policy because
they carry no discretion: a webhook recording an inbound payment is reporting a fact
that already happened. They are still logged in full, and any `SYSTEM` action whose
type is `money_moving` is a configuration error that the seed constraints reject.

```sql
  v_effects := app.plan_effects(p_type, v_tenant, v_target_id, p_payload, v_doc);
  v_effects_hash := encode(sha256(convert_to(v_effects::text, 'UTF8')), 'hex');
```

The plan is computed for **all three** variants from the same function. For
`EXECUTED` it is then applied; for `QUEUED_FOR_APPROVAL` it is frozen into
`approval_requests.diff`; for `SUGGESTED` it becomes the draft's preview. This is why
`effects[]` and `diff[]` cannot drift: they are not two computations that happen to
agree, they are one stored value read twice.

`jsonb` stores keys in a normalised order, so `v_effects::text` is deterministic for a
given value and the hash is stable across sessions, servers and Postgres restarts. No
separate canonicaliser is needed.

```sql
  insert into core.action_requests (
    tenant_id, ref, action_type, target_ref, target_entity, target_id, payload,
    value_minor, currency, requested_by_kind, requested_by_id, requested_by_role,
    agent_run_id, confidence, reasoning, evidence,
    context_flags, autonomy_level, granted_level, matched_policy_id, evaluation_trace,
    status, effects, effects_hash, idempotency_key_id
  ) values (
    v_tenant, app.next_ref(v_tenant, 'ACT'), p_type, p_target_ref, v_type.target_entity,
    v_target_id, p_payload,
    (v_value->>'amount')::bigint, v_value->>'currency',
    v_actor_kind, v_actor_id, v_actor.role,
    p_payload->>'runId', p_confidence, p_reasoning, p_evidence,
    v_context, v_level, v_granted, v_policy.id, v_trace,
    v_dispatch, v_effects, v_effects_hash, v_idem.id
  ) returning * into v_req;

  -- §3: "Emits: `ActionRequested`, then `ApprovalRequested` or the type's own event."
  -- It fires for all three variants, including SUGGESTED and a policy halt, because
  -- the fact being recorded is that somebody asked — which is exactly what the M18-S04
  -- trace needs in order to prove an agent asked and was refused. `sb-events` §1.7
  -- carries the merged event list; §14 of the contract omits this one.
  perform app.emit_event(v_tenant, 'ActionRequested', v_req.id);
```

Then one of three branches.

**`EXECUTED`**

```sql
    perform app.apply_effects(v_req.id);
    -- apply_effects settles the row itself: EXECUTED when there was no external
    -- effect to wait for, EXECUTING when there was. completed_at is stamped only
    -- when the last effect settles. See §7.3.
    perform set_config('response.status', '202', true);
    v_result := jsonb_build_object(
      'status', 'EXECUTED',
      'result', jsonb_build_object('effects', v_req.effects) || app.execution_result(v_req.id));
```

**`QUEUED_FOR_APPROVAL`**

```sql
    insert into core.approval_requests (
      tenant_id, ref, action_request_id, policy_id, action_type, subject, target_ref,
      value_minor, currency, margin_rate,
      requested_by_kind, requested_by_id, requested_by_name, agent_run_id, confidence, autonomy,
      reason, recommendation, evidence, deviations, risk, diff, diff_hash, preview_url,
      approver_role, assigned_to_id, assigned_to_name,
      sla_due_at, escalate_at, expires_at, bulk_approvable
    ) values (
      v_tenant, app.next_ref(v_tenant, 'APV'), v_req.id, v_policy.id, p_type,
      app.action_subject(p_type, v_target_id), p_target_ref,
      (v_value->>'amount')::bigint, v_value->>'currency', v_margin_rate,
      v_actor_kind, v_actor_id, app.actor_name(v_actor_id), p_payload->>'runId',
      p_confidence, v_level,
      app.render_reason(v_trace, v_policy),                 -- the §7 `reason` string
      app.render_recommendation(p_reasoning, p_confidence), -- {verdict, rationale}
      app.number_evidence(p_evidence),                      -- adds the `n` the UI renders
      app.render_deviations(v_doc),
      app.assess_risk(v_doc, v_low_confidence, v_jury_triggered),
      v_effects, v_effects_hash,
      app.preview_url(p_type, v_target_id),
      v_policy.approver_role, v_assignee_id, v_assignee_name,
      now() + make_interval(mins => v_policy.sla_minutes),
      case when v_policy.escalate_after_minutes is not null
           then now() + make_interval(mins => v_policy.escalate_after_minutes) end,
      now() + make_interval(mins => v_policy.expire_after_minutes),
      -- §7: false for any action carrying a monetary value, decided per request
      (v_value is null and not v_type.money_moving)
    ) returning * into v_approval;

    update core.action_requests
       set approval_request_id = v_approval.id, completed_at = now()
     where id = v_req.id;

    if v_jury_triggered then
      perform app.enqueue_jury(v_req.id, v_approval.id, 'ESCALATE', v_jury_trigger_reason);
    end if;

    perform set_config('response.status', '202', true);
    v_result := jsonb_build_object(
      'status', 'QUEUED_FOR_APPROVAL',
      'approvalRequest', jsonb_build_object(
        'id', v_approval.id, 'ref', v_approval.ref, 'policyId', v_approval.policy_id,
        'approverRole', v_approval.approver_role,
        'assignedTo', jsonb_build_object('id', v_approval.assigned_to_id,
                                         'name', v_approval.assigned_to_name),
        'slaDueAt', v_approval.sla_due_at, 'createdAt', v_approval.created_at));
```

No domain table is written on this path. That is the contract's central promise
implemented: an action that needs approval leaves the world exactly as it found it,
and the only trace is a row in the gate's own tables.

**`SUGGESTED`**

```sql
    insert into core.suggested_drafts (
      tenant_id, ref, action_request_id, action_type, target_ref,
      body, payload, planned_effects, provenance, expires_at
    ) values (
      v_tenant, 'drf_' || encode(gen_random_bytes(6), 'hex'), v_req.id, p_type, p_target_ref,
      p_payload->>'body', p_payload, v_effects,
      jsonb_build_object('origin','AI_SUGGESTED','confidence', p_confidence,
                         'agentId', v_actor_id, 'runId', p_payload->>'runId',
                         'sources', p_evidence, 'generatedAt', now()),
      now() + interval '7 days'
    ) returning * into v_draft;

    perform set_config('response.status', '200', true);
    v_result := jsonb_build_object(
      'status', 'SUGGESTED',
      'draft', jsonb_build_object('id', v_draft.ref, 'type', p_type,
                                  'body', v_draft.body, 'expiresAt', v_draft.expires_at));
```

**Finally, store the response for replay and return.**

```sql
  if v_idem.id is not null then
    update app.idempotency_keys
       set state = 'COMPLETED', response = v_result,
           status_code = current_setting('response.status', true)::int,
           action_request_id = v_req.id, completed_at = now()
     where id = v_idem.id;
  end if;

  return v_result;
end;
$$;
```

### 2.7 Transaction boundaries

The whole of §2 is **one transaction**, opened by the PostgREST call and committed
when the function returns. Three consequences worth stating plainly:

1. **Nothing partially happens.** A failure in effect application rolls back the
   action request, the approval request, the effects ledger and the idempotency row
   together. The client may retry with the same key and get a fresh, correct
   evaluation.
2. **No external call is inside it.** Every external effect is a row in the outbox,
   written in the same transaction and executed afterwards by a worker. A transaction
   that contains an HTTP call holds its row locks for a third party's latency and
   cannot be rolled back once the call lands.
3. **Locks are held for milliseconds.** The only exclusive locks taken are the advisory
   lock on the idempotency key and the row locks on whatever domain rows the effect
   executors touch. The advisory lock is transaction-scoped, so it releases on commit
   or rollback without a cleanup path.

`SECURITY DEFINER` with `set search_path = pg_catalog, app, core, public, extensions, pg_temp` on every function in
this document. `pg_temp` last is deliberate: putting it first would let a caller create
a temporary function that shadows one of ours and have the definer execute it.

Grants follow least privilege:

```sql
-- `app` is absent from PostgREST's exposed schemas (config.toml), so nothing in it
-- is reachable over the Data API at all. usage goes to service_role only.
revoke all on schema app from public;
grant  usage on schema app to service_role;

-- the read-path tables live in `core`, which IS exposed: select only, RLS on
revoke all on all tables in schema core from authenticated;
grant  select on core.v_approval_requests, core.action_types, core.action_policies,
                 core.autonomy_grants, core.action_requests, core.suggested_drafts,
                 core.jury_configs, core.jury_verdicts
  to authenticated;
grant  insert on core.approval_decisions to authenticated;   -- sb-tenancy's INSERT policy gates it

grant execute on function app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)
  to service_role;
grant execute on function app.decide_approval(uuid,text,text,text,text) to service_role;
grant execute on function app.bulk_decide(uuid[],text,text,text)        to service_role;
```

**How the gate is reached, given that `app` is unexposed.** The three entry points are
called by an Edge Function holding the service role, exactly as §6.3 describes. This is
not a workaround, it is the strongest form of the contract's own promise: the UI cannot
call the gate even if it wanted to, because the schema is not on the Data API. The
alternative considered and rejected was a thin `core.perform_action` wrapper exposed to
`authenticated`; it is simpler to deploy and it reopens a door `config.toml` closed on
purpose.

Reads stay under `sb-tenancy`'s RLS; no login role has `INSERT`, `UPDATE` or `DELETE` on
any gate table except the append-only `core.approval_decisions`, whose `INSERT` policy
carries the self-approval backstop. The `core` tables need RLS enabled regardless,
because a `SECURITY DEFINER` function bypasses RLS and the `select` grants above do not.

### 2.8 Kill switch and `AGENT_PAUSED`, restated

Three distinct conditions, all `409 AGENT_PAUSED`, distinguished by `details.reason`:

| Condition | `details.reason` | Checked in | Scope |
|---|---|---|---|
| Tenant-wide kill switch | `TENANT_KILL_SWITCH` | guard (e) | every agent, every type |
| Agent paused or killed | `AGENT_PAUSED` | guard (e) | one agent, every type |
| Action type paused | `ACTION_TYPE_PAUSED` | step 1 | one agent, one type |
| Budget cap tripped | `BUDGET_CAP` | guard (e) | every agent, the capped types |

None of them applies to `AGENT_PAUSE` itself, and none of them applies to a `HUMAN`
requester. A kill switch that also stops the humans is not a safety feature, it is an
outage. Pausing is immediate, audited and idempotent per §10: `AGENT_PAUSE` against an
already-paused agent succeeds and changes nothing.

---

### 2.9 Gated state transitions — closing the gap RLS cannot

`sb-tenancy` §3.4 names this and hands it to me, and the team lead has asked for it in
writing. The gap is real and it is the most dangerous one in the design.

RLS answers "may this principal touch this row". It sees one row and cannot tell a
draft from a send. So `agent_proposal` writing a `core.proposals` row is legitimately
RLS-allowed, and the *same* policy also lets it set `status = 'SENT'` in that write.
`PROPOSAL_SEND` is `ACT_WITH_APPROVAL`. An agent that could flip that column directly
would have routed around the entire gate, and nothing in §2 would ever run.

The fix is three layers, not one. A trigger alone is not enough, and column privileges
alone are not enough either.

**Layer 1 · column privileges stop the `UPDATE`.** This is the Postgres mechanism
actually designed for the job, and unlike a trigger it cannot be reached by anything a
client can set.

```sql
-- no blanket update grant on a table with a gated state column
revoke update on core.proposals from authenticated;

-- grant only the columns a human or agent may legitimately edit.
-- `status`, `sent_at` and `value_minor` are simply absent from the list.
grant update (title, sections, notes, contact_id, updated_at)
  on core.proposals to authenticated;
```

Applied to every gated column: `proposals.status`, `invoices.status` and `sync_state`,
`attendance_days.status`, `hrdc_packets.status` and `submission_reference`,
`quotations.status` and `sell_price_minor`, `engagements.status`,
`core.autonomy_grants.level`. The effect applier is `SECURITY DEFINER` and runs as the
owner, so column grants do not constrain it.

**Layer 2 · a trigger stops the `INSERT`.** Column privileges do not prevent inserting
a row that is *already* `SENT`, which is the same bypass by another door.

**Layer 3 · the same trigger validates the transition itself**, so that even the
applier cannot perform a transition nobody authorised. Legal transitions are data:

```sql
create table core.state_transitions (
  entity          text not null,          -- 'proposals'
  column_name     text not null default 'status',
  from_status     text,                   -- null = insert
  to_status       text not null,
  gated_by        text references core.action_types(key),  -- null = ungated
  primary key (entity, column_name, from_status, to_status)
);

insert into core.state_transitions (entity, from_status, to_status, gated_by) values
  ('proposals',       null,      'DRAFT',     null),                 -- drafting is free
  ('proposals',       'DRAFT',   'SENT',      'PROPOSAL_SEND'),
  ('proposals',       'SENT',    'VIEWED',    null),                 -- the client did this
  ('proposals',       'SENT',    'ACCEPTED',  null),
  ('attendance_days', 'OPEN',    'LOCKED',    'ATTENDANCE_APPROVE'),
  ('attendance_days', 'LOCKED',  'OPEN',      'ATTENDANCE_UNLOCK'),
  ('invoices',        null,      'DRAFT',     'INVOICE_CREATE'),
  ('hrdc_packets',    'READY',   'SUBMITTED', 'HRDC_PACKET_MARK_SUBMITTED');
  -- … one row per legal edge, per §12's status enums
```

Rendering the legal edges as rows rather than as `if` branches follows the same rule the
project applies to pipeline stages: the transitions are configuration, and a new one is
an insert rather than a migration to a trigger body.

```sql
create or replace function app.enforce_state_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, core, public, extensions, pg_temp
as $$
declare
  v_from     text;
  v_to       text;
  v_gated_by text;
  v_applier  uuid;
  v_req      core.action_requests%rowtype;
  v_col      text := coalesce(tg_argv[0], 'status');
begin
  execute format('select ($1).%I::text', v_col) into v_to using new;

  if tg_op = 'UPDATE' then
    execute format('select ($1).%I::text', v_col) into v_from using old;
    if v_from is not distinct from v_to then
      return new;                                   -- not a transition; nothing to check
    end if;
  end if;

  select st.gated_by into v_gated_by
  from core.state_transitions st
  where st.entity = tg_table_name and st.column_name = v_col
    and st.from_status is not distinct from v_from and st.to_status = v_to;

  if not found then
    raise exception using errcode = 'TRNOS',
      message = format('%s.%s: %s → %s is not a legal transition',
                       tg_table_name, v_col, coalesce(v_from, '(new)'), v_to),
      detail  = jsonb_build_object('code','ILLEGAL_STATE_TRANSITION')::text;
  end if;

  if v_gated_by is null then
    return new;                                     -- ungated edge, e.g. the client viewing
  end if;

  -- a gated edge may only be crossed by the effect applier, and only by an applier
  -- running the action type that gates it
  v_applier := nullif(current_setting('app.effect_applier', true), '')::uuid;

  if v_applier is null then
    raise exception using errcode = 'TRNOS',
      message = format('%s → %s requires the %s action', v_from, v_to, v_gated_by),
      detail  = jsonb_build_object('code','FORBIDDEN', 'policyId','GOV-07',
                  'requiredAction', v_gated_by)::text;
  end if;

  select * into v_req from core.action_requests where id = v_applier;

  if not found
     or v_req.action_type <> v_gated_by
     or v_req.tenant_id  <> new.tenant_id then
    raise exception using errcode = 'TRNOS',
      message = format('The running action does not authorise %s → %s', v_from, v_to),
      detail  = jsonb_build_object('code','FORBIDDEN', 'policyId','GOV-07',
                  'requiredAction', v_gated_by, 'runningAction', v_req.action_type)::text;
  end if;

  return new;
end;
$$;

create trigger proposals_state_gate
  before insert or update of status on core.proposals
  for each row execute function app.enforce_state_transition('status');
```

The GUC is set by the applier and by nothing else, scoped to the transaction so it
cannot leak across a pooled connection:

```sql
-- the first statement inside app.apply_effects
perform set_config('app.effect_applier', p_action_request_id::text, true);
```

**Why the GUC is not the weak link.** On its own, a session variable would be a poor
control: anything that can run SQL can set one. It is not the control here. The control
is that the trigger then goes and *reads the action request the GUC names* and checks
that its type is the one gating this specific edge, in this tenant. To forge a
`DRAFT → SENT` transition, an attacker would have to produce a `core.action_requests`
row whose `action_type` is `PROPOSAL_SEND` — and the only way to produce one is to go
through `app.perform_action`, which is where the policy gate lives. The GUC carries a
reference; the check is against durable state.

`sb-tenancy` puts the same move in one line, and it is worth both lanes using the same
words so the pattern is recognisable when it recurs: **ground a claim in a row somebody
else wrote, rather than trusting what the caller presents.** Their `app.aal2_verified()`
in §7.2a does it for a different reason. A boolean in a session variable is the caller's
assertion. An id resolved against a table the caller cannot write is evidence.

This is registered as `GOV-07` in the cross-cutting rules, alongside the other four that
no tenant may switch off.

**What this costs.** One extra index probe on `core.action_requests` per gated
transition, and a small reference table read that Postgres will keep in cache. Against
that, a category of bypass disappears: after this, an agent that clears RLS can write
its *proposal* and cannot send it, which is precisely the distinction `sb-tenancy` §3.4
asks the two lanes to preserve.

**What `sb-erd` needs to do.** Attach the trigger to each gated table and apply the
column-privilege grants. I own the trigger function and the transition table; the
attachments sit with whoever owns the table DDL.

**One signal, not two.** `sb-erd` proposed a separate transaction-scoped key,
`trainos.unlock_action_id`, for the attendance lock trigger specifically, on the grounds
that RLS cannot distinguish an approved `ATTENDANCE_UNLOCK` from an unauthorised write
because `service_role` bypasses RLS. That reasoning is right and the mechanism is
already here: `ATTENDANCE_UNLOCK` is two rows in `core.state_transitions`
(`OPEN → LOCKED` gated by `ATTENDANCE_APPROVE`, `LOCKED → OPEN` gated by
`ATTENDANCE_UNLOCK`) and the generic trigger reads `app.effect_applier`, loads that
action request, and refuses unless its type is the gating one. A second key for one
table would be a second vocabulary for a problem the first one solves, and the two would
drift the first time someone added a third gated table. So: **`app.effect_applier`,
carrying the action request id, for every gated transition including attendance.**

It is also strictly stronger than a bespoke key would be. `trainos.unlock_action_id`
holding an id proves only that *someone* set a variable. `app.effect_applier` is
resolved against `core.action_requests` and checked for the right `action_type` and
the right tenant, so setting it to an `ENQUIRY_ARCHIVE` id buys nothing.

---

## 3 · Effect executors — what executing means, per action type

Each action type has a **planner** `app.plan_<type>` (pure, read-only, returns the
effects array) and an **executor** `app.exec_<type>` (writes, called only from
`app.apply_effects`). Splitting them is what makes the diff honest: the same planner
runs at request time, at approval-render time and again at decide time, and it cannot
accidentally write anything.

`IN_DATABASE` effects apply in the gate's transaction. `EXTERNAL` effects become one
outbox row each. Event names in the last column are `sb-events`' to emit; names marked
*new* are not in the §14 catalogue and are proposed here.

| # | Action type | Money | Client | HRDC | Tables changed (`core`) | External effects | Event |
|---|---|:--:|:--:|:--:|---|---|---|
| 1 | `ENQUIRY_ARCHIVE` | | | | `enquiries.status → ARCHIVED\|NOT_AN_ENQUIRY`, `archived_reason` | — | `EnquiryArchived` *new* |
| 2 | `OPPORTUNITY_CONVERT` | | | | insert `opportunities`; upsert `organisations`, `contacts`; `enquiries.status → CONVERTED`; insert `tasks` | — | `OpportunityCreated` |
| 3 | `TNA_RECOMMENDATION_ACCEPT` | | | | `tna_recommendations.accepted_at`; `tnas.status → COMPLETE`; insert `opportunity_programmes` | — | `TNARecommendationAccepted` *new* |
| 4 | `PROPOSAL_SEND` | | ✓ | | `proposals.status DRAFT → SENT`, `sent_at`; `opportunities.stage → PROPOSAL_SENT`; insert `tasks` (follow-up); `quotations.draft_locked → false` | render PDF; send email with attachment | `ProposalSent` |
| 5 | `QUOTATION_APPLY` | ✓ | | | `quotations.status → APPLIED`, `rate_card_version` pinned; `proposals.value_minor` | — | `QuotationApplied` *new* |
| 6 | `DISCOUNT_APPROVE` | ✓ | | | `quotations.sell_price_minor`, `discount_pct`, `approved_below_floor`, `approval_ref` | — | `DiscountApproved` *new* |
| 7 | `TRAINER_BOOK` | ✓ | | | `trainer_assignments.status SOFT_HOLD → CONFIRMED`; `trainer_availability` blocked for the dates; `engagements.trainer_id` | notify the trainer | `TrainerBooked` *new* |
| 8 | `ENGAGEMENT_CLOSE_OUT` | | ✓ | ✓ | `engagements.status → CLOSED`, `closed_at`; `evaluations` dispatch rows | send evaluation links | `EngagementClosedOut` *new* |
| 9 | `ATTENDANCE_APPROVE` | | | ✓ | `attendance_days.status → LOCKED`, `immutable`, `approved_by`, `approved_at`; recompute `hrdc_packets.completeness` | — | `AttendanceLocked` |
| 10 | `ATTENDANCE_UNLOCK` | | | ✓ | `attendance_days.status → OPEN`; `hrdc_packets.status → DRAFT`, `submission_reference → null`, `void_reason` | notify OPS and FINANCE | `AttendanceUnlocked`, `HRDCPacketVoided` *both new* |
| 11 | `HRDC_PACKET_MARK_SUBMITTED` | | | ✓ | `hrdc_packets.status → SUBMITTED`, `submission_reference`, `submitted_at`, `claim_rule_set_version` pinned | — | `HRDCPacketSubmitted` |
| 12 | `INVOICE_CREATE` | ✓ | ✓ | | insert `invoices` + `invoice_lines` (`sb-money` builds the lines); `status DRAFT` | — | `InvoiceCreated` *new* |
| 13 | `INVOICE_PUSH` | ✓ | ✓ | | `invoices.sync_state → SENT`, `last_attempt_at`; insert `invoice_sync_log` | push to the accounting package | `InvoicePushed` |
| 14 | `PAYMENT_RECORD` | ✓ | | | insert `payments`; `invoices.outstanding_minor` and `status` recomputed by `sb-money`; close the `collections_queue` row | — | `PaymentRecorded` *new* |
| 15 | `REMINDER_SEND` | | ✓ | | `collections_queue.stage` advanced, `last_sent_at`; insert `messages` | send email or WhatsApp; record the BSP cost | `ReminderSent` *new* |
| 16 | `FOLLOWUP_SEND` | | ✓ | | `follow_ups.status → SENT`; insert `messages`; `contacts.last_contacted_at` | send on the chosen channel | `FollowUpSent` *new* |
| 17 | `BROADCAST_SEND` | | ✓ | | insert `broadcasts`; insert one `messages` row per recipient | fan out, one job per recipient | `BroadcastSent` *new* |
| 18 | `AGENT_AUTONOMY_CHANGE` | | | | `core.autonomy_grants.level` and the promotion metadata | — | `AgentAutonomyChanged` *new* |
| 19 | `AGENT_PAUSE` | | | | `core.autonomy_grants.paused` or `core.agents.status → PAUSED` | — | `AgentPaused` *new* |
| +1 | `BUDGET_CAP_RAISE` §17 | ✓ | | | `app.ai_budgets.cap_minor`; affected routing rows leave `PAUSED_BY_CAP` | — | `BudgetCapRaised` *new* |
| +2 | `RULE_CHANGE_APPROVE` §17 | | | ✓ | `core.compliance_rules` insert or supersede, dated from the **circular**, not the approval | re-evaluate affected engagements | `RuleChangeApproved` |

Twelve of the twenty-one need an event name that §14 does not define. That gap is
`sb-events`' to close; the names above are a proposal, not a decision.

The `ceiling_autonomy` column in `core.action_types` follows mechanically from the
three flags and `DECISIONS.md` §1. The five that may **never** promote, carrying
`promotion_blocked_reason = 'NEVER'`: `DISCOUNT_APPROVE`, `TRAINER_BOOK`,
`ATTENDANCE_APPROVE`, `HRDC_PACKET_MARK_SUBMITTED` and `RULE_CHANGE_APPROVE`. Invoice
create and push are "never at launch", which is a different thing: they carry a
`promotion_condition` of `null` and a ceiling of `ACT_WITH_APPROVAL`, revisitable
after Phase 2.

`apply_effects` is the only writer:

```sql
create or replace function app.apply_effects(p_action_request_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, core, public, extensions, pg_temp
as $$
declare
  r        core.action_requests%rowtype;
  e        jsonb;
  v_seq    int := 0;
  v_kind   text;
begin
  select * into r from core.action_requests where id = p_action_request_id for update;

  for e in select * from jsonb_array_elements(r.effects) loop
    v_seq  := v_seq + 1;
    v_kind := coalesce(e->>'kind', 'IN_DATABASE');

    insert into app.action_effects (
      tenant_id, action_request_id, seq, op, entity, ref, description, kind, job_key
    ) values (
      r.tenant_id, r.id, v_seq, e->>'op', e->>'entity', e->>'ref',
      e->>'description', v_kind, r.id::text || ':' || v_seq
    );
  end loop;

  -- in-database effects, all inside this transaction
  execute format('select app.exec_%s($1)', lower(r.action_type)) using r.id;

  update app.action_effects
     set status = 'APPLIED', applied_at = now()
   where action_request_id = r.id and kind = 'IN_DATABASE';

  -- the domain event, same transaction as the state change, per §14.
  -- sb-events' three-argument overload reads the action request and derives the
  -- aggregate, payload, summary and actor itself, sets correlation_id to the
  -- action request id, and derives its own idempotency key, so re-running
  -- apply_effects after a crash emits no second event.
  perform app.emit_event(r.tenant_id, app.event_name_for(r.action_type), r.id);

  -- external effects become outbox rows. sb-events owns app.outbox and its
  -- columns; the gate supplies the deterministic key that makes redelivery safe.
  insert into app.outbox (tenant_id, job_type, job_key, effect_id,
                          action_request_id, correlation_id, payload, run_after)
  select r.tenant_id,
         app.job_type_for(r.action_type, ae.entity),   -- 'SEND_EMAIL', sb-events owns it
         ae.job_key,                                   -- '<action_request_id>:<seq>'
         ae.id,                                        -- what report_effect_result keys on
         r.id,
         r.id,
         jsonb_build_object('actionRequestId', r.id, 'effectId', ae.id,
                            'seq', ae.seq, 'payload', r.payload),
         now()
  from app.action_effects ae
  where ae.action_request_id = r.id and ae.kind = 'EXTERNAL'
  on conflict (tenant_id, job_key) do nothing;

  update app.action_effects
     set status = 'DISPATCHED'
   where action_request_id = r.id and kind = 'EXTERNAL';
end;
$$;
```

`on conflict (tenant_id, job_key) do nothing` is what makes the re-execution of an
approved action safe even if `apply_effects` is somehow reached twice: the second pass
enqueues nothing.

---

## 4 · Approval decisions

### 4.1 `app.decide_approval` — approve, reject, request changes

```sql
create or replace function app.decide_approval(
  p_approval_id        uuid,
  p_decision           text,                    -- APPROVE | REQUEST_CHANGES | REJECT
  p_note               text default null,
  p_expected_diff_hash text default null,       -- the hash the client rendered
  p_idempotency_key    text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, core, public, extensions, pg_temp
set statement_timeout = '10s'
as $$
declare
  v_tenant uuid   := app.current_tenant_id();
  v_actor  record := app.current_actor();
  a        core.approval_requests%rowtype;
  v_fresh  jsonb;
  v_hash   text;
  v_result jsonb;
begin
  -- (1) serialise, then claim the idempotency key exactly as §2.0b does
  perform pg_advisory_xact_lock(hashtext(p_approval_id::text));
  -- … identical claim-or-replay block, endpoint 'POST /v1/approvals/{id}/decide' …

  -- (2) row lock: two managers clicking Approve at the same instant serialise here
  select * into a from core.approval_requests
  where id = p_approval_id and tenant_id = v_tenant
  for update;

  if not found then
    raise exception using errcode = 'TRNOS',
      message = 'Approval not found',
      detail  = jsonb_build_object('code','NOT_FOUND')::text;
  end if;

  -- (3) still open?
  if a.status <> 'PENDING' then
    raise exception using errcode = 'TRNOS',
      message = format('Approval %s was already %s', a.ref, a.status),
      detail  = jsonb_build_object('code','ALREADY_DECIDED', 'status', a.status,
                  'decidedBy', a.decided_by_id, 'decidedAt', a.decided_at)::text;  -- 409
  end if;

  -- (4) may this actor decide? Two different questions, and sb-tenancy ruled that
  --     they stay different. app.has_permission('approval:decide') is authorisation:
  --     may this principal decide approvals at all. The approver_role comparison is a
  --     data match: is THIS approval addressed to you. Making the second one
  --     permission-shaped would mean minting a permission per role, which is the
  --     permission matrix collapsing back into role checks under another name.
  if not app.has_permission('approval:decide') then
    raise exception using errcode = 'TRNOS',
      message = 'This principal may not decide approvals',
      detail  = jsonb_build_object('code','FORBIDDEN',
                  'requiredRole', a.approver_role)::text;
  end if;

  if not (v_actor.role = a.approver_role
          or (a.escalated_at is not null and v_actor.role = a.escalated_to_role)
          or v_actor.role in ('MD','ADMIN')) then
    raise exception using errcode = 'TRNOS',
      message = 'This approval belongs to a different role',
      detail  = jsonb_build_object('code','FORBIDDEN',
                  'requiredRole', a.approver_role)::text;
  end if;

  -- (5) self-approval, GOV-03, enforced a second time
  if a.requested_by_kind = 'HUMAN' and a.requested_by_id = v_actor.id then
    raise exception using errcode = 'TRNOS',
      message = 'A user may not decide their own request',
      detail  = jsonb_build_object('code','FORBIDDEN','policyId','GOV-03',
                  'requiredRole', a.approver_role)::text;
  end if;

  -- (6) note required for the two negative decisions
  if p_decision in ('REJECT','REQUEST_CHANGES')
     and nullif(btrim(coalesce(p_note,'')), '') is null then
    raise exception using errcode = 'TRNOS',
      message = 'A note is required to reject or request changes',
      detail  = jsonb_build_object('code','VALIDATION_FAILED',
                  'fields', jsonb_build_array(
                    jsonb_build_object('field','note','reason','REQUIRED')))::text;
  end if;
```

### 4.2 Diff staleness — the §16 Q2 answer

Recommendation: **a diff hash check returning `409` with the recomputed diff**, not a
soft lock on the target.

A soft lock would freeze the proposal, the costing and the opportunity for however long
the approval sits in the queue, which the contract's own SLA puts at four hours. It
would then need lock expiry, lock stealing, a UI for "locked by Amirah since 09:14",
and a story for what happens when the lock expires mid-edit. All of that to prevent a
condition that a single hash comparison detects reliably.

Two checks, both cheap. The first catches the world changing; the second catches the
client rendering an older version than the one on the server.

```sql
  if p_decision = 'APPROVE' then
    -- re-plan from current state and compare
    v_fresh := app.plan_effects_for(a.action_request_id);
    v_hash  := encode(sha256(convert_to(v_fresh::text, 'UTF8')), 'hex');

    if v_hash is distinct from a.diff_hash then
      update core.approval_requests
         set diff = v_fresh, diff_hash = v_hash
       where id = a.id;

      raise exception using errcode = 'TRNOS',
        message = 'The effects of this action changed since the diff was rendered',
        detail  = jsonb_build_object(
          'code','DIFF_CHANGED', 'diffChanged', true,
          'diff', v_fresh, 'diffHash', v_hash)::text;                    -- 409
    end if;

    if p_expected_diff_hash is not null
       and p_expected_diff_hash is distinct from a.diff_hash then
      raise exception using errcode = 'TRNOS',
        message = 'The diff you are approving is not the current one',
        detail  = jsonb_build_object(
          'code','DIFF_CHANGED', 'diffChanged', true,
          'diff', a.diff, 'diffHash', a.diff_hash)::text;                -- 409
    end if;
  end if;
```

Note the `update` before the `raise`: the raise aborts the transaction, so that write
is lost. That is intentional and it is why the client is handed the recomputed diff in
the error detail rather than being told to re-fetch. If the refreshed diff should
persist, the recompute must run in its own transaction — a helper
`app.refresh_approval_diff(id)` the edge adapter calls after catching a
`DIFF_CHANGED`. Named here so the omission is not mistaken for an oversight.

### 4.3 The three decisions

```sql
  case p_decision

    when 'APPROVE' then
      update core.approval_requests
         set status = 'APPROVED', decision = 'APPROVE', decision_note = p_note,
             decided_by_id = v_actor.id, decided_by_name = app.actor_name(v_actor.id),
             decided_at = now()
       where id = a.id;

      perform app.apply_effects(a.action_request_id);   -- sets EXECUTING or EXECUTED

      -- effects[] is read back from the frozen column the diff was rendered from,
      -- so the two are identical by construction, not by agreement
      select jsonb_build_object(
               'status', 'APPROVED',
               'decidedBy', jsonb_build_object('id', v_actor.id,
                                               'name', app.actor_name(v_actor.id)),
               'decidedAt', now(),
               'effects', ar.effects)
        into v_result
      from core.action_requests ar where ar.id = a.action_request_id;

    when 'REJECT' then
      update core.approval_requests
         set status = 'REJECTED', decision = 'REJECT', decision_note = p_note,
             decided_by_id = v_actor.id, decided_by_name = app.actor_name(v_actor.id),
             decided_at = now()
       where id = a.id;

      update core.action_requests
         set status = 'REJECTED', error_code = 'APPROVAL_REJECTED',
             error_details = jsonb_build_object('note', p_note), completed_at = now()
       where id = a.action_request_id;

      v_result := jsonb_build_object('status','REJECTED', 'effects', '[]'::jsonb,
                    'decidedBy', jsonb_build_object('id', v_actor.id,
                                                    'name', app.actor_name(v_actor.id)),
                    'decidedAt', now());

    when 'REQUEST_CHANGES' then
      update core.approval_requests
         set status = 'CHANGES_REQUESTED', decision = 'REQUEST_CHANGES',
             decision_note = p_note, decided_by_id = v_actor.id,
             decided_by_name = app.actor_name(v_actor.id), decided_at = now()
       where id = a.id;

      update core.action_requests
         set status = 'REJECTED', error_code = 'CHANGES_REQUESTED',
             error_details = jsonb_build_object('note', p_note), completed_at = now()
       where id = a.action_request_id;

      v_result := jsonb_build_object('status','CHANGES_REQUESTED', 'effects', '[]'::jsonb,
                    'note', p_note,
                    'decidedBy', jsonb_build_object('id', v_actor.id,
                                                    'name', app.actor_name(v_actor.id)),
                    'decidedAt', now());
  end case;

  perform app.emit_event(v_tenant, 'ApprovalDecided', a.id);
  -- … store v_result against the idempotency key, then …
  return v_result;
end;
$$;
```

**`REQUEST_CHANGES` closes the approval.** The action request is terminal, the target
record is untouched, and the requester must submit a fresh `POST /v1/actions` after
editing. Keeping the approval open would leave an SLA clock running on work nobody is
doing, which would corrupt every number on M02-S01. `ApprovalStatus` in §12 already
has `CHANGES_REQUESTED` as a terminal value alongside `APPROVED` and `REJECTED`, so
this reading matches the enum.

For an agent requester, a `REJECT` or `REQUEST_CHANGES` marks the run
`outcome = 'REJECTED'` with the note attached, which is what the M18-S04 trace renders
under the `haltedBy` step.

### 4.4 `app.bulk_decide`

```sql
create or replace function app.bulk_decide(
  p_ids uuid[], p_decision text, p_note text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, app, core, public, extensions, pg_temp
as $$
declare v_blocked jsonb; v_results jsonb := '[]'::jsonb; v_id uuid;
begin
  -- pre-flight: §7 says 409 if ANY id has bulkApprovable false
  select jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'reason',
                     case when value_minor is not null then 'MONETARY_VALUE'
                          else 'MONEY_MOVING_TYPE' end))
    into v_blocked
  from core.approval_requests
  where id = any(p_ids) and tenant_id = app.current_tenant_id()
    and not bulk_approvable;

  if v_blocked is not null then
    raise exception using errcode = 'TRNOS',
      message = 'One or more approvals may not be decided in bulk',
      detail  = jsonb_build_object('code','BULK_NOT_PERMITTED',
                  'notBulkApprovable', v_blocked)::text;                 -- 409
  end if;

  -- also refuse the whole batch if any id is missing, already decided,
  -- or belongs to a role this actor does not hold: partial bulk is worse than none
  foreach v_id in array p_ids loop
    v_results := v_results || app.decide_approval(v_id, p_decision, p_note, null, null);
  end loop;

  return jsonb_build_object('data', v_results, 'count', jsonb_array_length(v_results));
end;
$$;
```

One transaction, all or nothing. A bulk approve that succeeds for four of seven and
leaves the manager to work out which three failed is worse than one that does nothing
and says why.

Each inner `decide_approval` re-runs the diff hash check, so a stale item in a batch
aborts the batch with the same `409 DIFF_CHANGED` a single decide would produce.

### 4.5 Scheduled jobs — SLA, escalation, expiry, cleanup

```sql
-- every minute: escalate at 6h to the MD
select cron.schedule('approvals-escalate', '* * * * *', $job$
  with due as (
    select a.id, a.tenant_id, p.escalate_to_role
    from core.approval_requests a
    join core.action_policies p on p.tenant_id = a.tenant_id and p.id = a.policy_id
    where a.status = 'PENDING'
      and a.escalated_at is null
      and a.escalate_at is not null
      and a.escalate_at <= now()
    order by a.escalate_at
    limit 500
    for update of a skip locked
  )
  update core.approval_requests a
     set escalated_at = now(),
         escalated_to_role = due.escalate_to_role,
         assigned_to_id = app.pick_role_holder(a.tenant_id, due.escalate_to_role,
                                               a.requested_by_id)
  from due
  where a.id = due.id;
$job$);

-- every minute: emit the SLA breach event exactly once
select cron.schedule('approvals-breach', '* * * * *', $job$
  update core.approval_requests a
     set breach_notified_at = now()
   where a.status = 'PENDING'
     and a.breach_notified_at is null
     and now() > a.sla_due_at
     and a.id in (select id from core.approval_requests
                  where status = 'PENDING' and breach_notified_at is null
                    and now() > sla_due_at
                  order by sla_due_at limit 500 for update skip locked);
$job$);

-- every 5 minutes: expire at 24h — the §16 Q1 answer
select cron.schedule('approvals-expire', '*/5 * * * *', $job$
  select app.expire_approvals(500);
$job$);

-- hourly: idempotency key retention, 24h per §1 of the contract
select cron.schedule('idempotency-cleanup', '17 * * * *', $job$
  delete from app.idempotency_keys
  where ctid in (select ctid from app.idempotency_keys
                 where expires_at < now() limit 10000);
$job$);

-- hourly: suggested draft expiry
select cron.schedule('drafts-expire', '23 * * * *', $job$
  update core.suggested_drafts set status = 'EXPIRED'
  where status = 'OPEN' and expires_at < now();
$job$);

-- every 5 minutes: enqueue the 5% async jury sample
select cron.schedule('jury-sample', '*/5 * * * *', $job$
  select app.enqueue_jury_samples();
$job$);
```

`for update ... skip locked` on every sweep so two cron workers, or a cron worker and a
manual re-run, never block each other. `limit` on every sweep so a backlog cannot turn
one tick into a long transaction that blocks the approval queue.

Expiry itself:

```sql
create or replace function app.expire_approvals(p_limit int default 500)
returns int
language plpgsql security definer
set search_path = pg_catalog, app, core, public, extensions, pg_temp
as $$
declare v_count int;
begin
  with due as (
    select id, action_request_id, tenant_id
    from core.approval_requests
    where status = 'PENDING' and now() > expires_at
    order by expires_at
    limit p_limit
    for update skip locked
  ), closed as (
    update core.approval_requests a
       set status = 'EXPIRED'
    from due where a.id = due.id
    returning a.id, a.action_request_id, a.tenant_id
  )
  update core.action_requests ar
     set status = 'REJECTED', error_code = 'APPROVAL_EXPIRED', completed_at = now()
  from closed
  where ar.id = closed.action_request_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
```

**§16 Q1 answered: expire at 24 hours into `EXPIRED`.** Never auto-approve, which would
make the whole gate a delay rather than a control. Never silently auto-reject the
underlying work either: the target record is untouched, the requester is notified, and
for an agent requester the run is marked `FAILED` with `APPROVAL_EXPIRED` and
`retryable: true`, so `POST /v1/runs/{id}/retry` is the recovery path §10 already
defines. Nagging forever was rejected because a queue that only grows destroys
`medianDecisionTime` and the breaching counts, which are the only signals that
approval capacity is short. Escalation to the MD at 6 hours already gives the second
chance before the 24-hour clock runs out.

**Who may decide**: `approver_role`, never `requested_by`. `assigned_to` is a routing
hint for the inbox, not an authorisation: any holder of the role may pick up any
approval in their queue, which is what keeps the queue drainable when someone is on
leave. The `MD` and `ADMIN` override exists because §7 lists both roles on
`GET /v1/approvals` and because someone must be able to clear a queue whose role has
no available holder.

---

## 5 · Jury — gate, sample, escalate

`DECISIONS.md` §2 settles the economics: the jury is a gate, not a per-action step.
Three uses in cost order, and only one of them touches a live decision.

| Mode | When it runs | Blocks? | Cost | Consulted by |
|---|---|---|---|---|
| `GATE` | promotion time, 3 `STRONG` models against a 50–100 item golden set | no live action | USD 2–5 per promotion | `AGENT_AUTONOMY_CHANGE` |
| `SAMPLE` | 5% of gated actions, **after** the human decides | never | marginal | a cron job, never `perform_action` |
| `ESCALATE` | confidence < 0.70, **or** value > RM 50,000, **or** first-of-kind | yes, see below | a handful a month | `perform_action` step 4 |

**`ESCALATE` blocks autonomy, not the transaction.** This is the design decision the
rest of the jury depends on, and it is a deliberate reading of §18's "`ESCALATE` blocks
only when a trigger fires". Calling three models from inside `perform_action` would
mean an HTTP call in a transaction holding row locks, a gate whose latency is a
provider's latency, and a gate that fails closed when a provider is `DEGRADED`. None
of that is acceptable in the one code path every primary button goes through.

So what `ESCALATE` actually does, as written in §2.4: when a trigger fires, the
effective autonomy level is capped at `ACT_WITH_APPROVAL` regardless of the grant, and
a jury job is enqueued. The action does not execute. A human sees it. The jury's
verdict arrives later and is attached to the approval as advisory input, rendering
under `recommendation` on M02-S02 with its own provenance. If the jury is still
`PENDING` when the manager decides, the manager decides without it, which is correct:
a human's judgement does not wait on three models.

The trigger values come straight from §18 and reconcile with `DECISIONS.md` §2:
`minConfidence 0.70`, `maxValue { amount: 5000000 }` which is RM 50,000 in sen, and
`firstOfKind true`.

```sql
create or replace function app.enqueue_jury(
  p_action_request_id uuid, p_approval_id uuid, p_mode text, p_reason text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, app, core, public, extensions, pg_temp
as $$
declare v_id uuid; v_cfg core.jury_configs%rowtype; v_tenant uuid;
begin
  select tenant_id into v_tenant from core.action_requests where id = p_action_request_id;
  select * into v_cfg from core.jury_configs
  where tenant_id = v_tenant
    and action_type = (select action_type from core.action_requests
                       where id = p_action_request_id);

  insert into core.jury_verdicts (tenant_id, action_request_id, approval_request_id,
                                 mode, trigger_reason, quorum, "of", tiers)
  values (v_tenant, p_action_request_id, p_approval_id, p_mode, p_reason,
          v_cfg.quorum, v_cfg."of", v_cfg.tiers)
  returning id into v_id;

  -- the LLM calls happen in a worker, never here. sb-events owns the enqueue.
  perform app.enqueue_job(
    p_tenant   => v_tenant,
    p_job_type => 'jury.evaluate',
    p_job_key  => 'jury:' || v_id::text,
    p_payload  => jsonb_build_object('juryVerdictId', v_id, 'mode', p_mode));

  return v_id;
end;
$$;
```

**`SAMPLE`** is a cron job, run five minutes after decisions land so it can never race
them:

```sql
create or replace function app.enqueue_jury_samples()
returns int
language plpgsql security definer
set search_path = pg_catalog, app, core, public, extensions, pg_temp
as $$
declare v_count int;
begin
  with candidates as (
    select a.id as approval_id, a.action_request_id, a.tenant_id, c.quorum, c."of", c.tiers
    from core.approval_requests a
    join core.jury_configs c
      on c.tenant_id = a.tenant_id and c.action_type = a.action_type
    where a.status in ('APPROVED','REJECTED')
      and a.decided_at between now() - interval '1 hour' and now() - interval '5 minutes'
      and c.mode = 'SAMPLE' and c.active
      and not exists (select 1 from core.jury_verdicts j where j.approval_request_id = a.id)
      -- deterministic 5%: hash the ref rather than calling random(), so a re-run
      -- of the job picks the same rows and cannot double-sample
      and (hashtext(a.ref) & 2147483647) % 1000 < (c.sample_rate * 1000)::int
    limit 200
  )
  insert into core.jury_verdicts (tenant_id, action_request_id, approval_request_id,
                                 mode, trigger_reason, quorum, "of", tiers)
  select tenant_id, action_request_id, approval_id, 'SAMPLE', 'SAMPLED', quorum, "of", tiers
  from candidates;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
```

Sampling with `hashtext` rather than `random()` matters: the job is idempotent, a
re-run after a failure samples exactly the same rows, and the `not exists` guard then
makes the insert a no-op. A `random()` sample would drift the rate every time the job
was retried.

A `SAMPLE` verdict of `DISAGREE` emits `JuryDisagreed` per §18 and touches nothing
else. It is drift monitoring, and it is the input to the promotion decision.

**`GATE`** runs against the golden set when an `AGENT_AUTONOMY_CHANGE` proposes a
promotion. The `AGENT_AUTONOMY_CHANGE` approval is `MD`-gated by `GOV-01`, and the
approval cannot be approved while its `GATE` verdict is `PENDING` — the one place a
jury genuinely blocks a decision. That is affordable precisely because it happens once
per promotion rather than once per action, which is the whole argument in
`DECISIONS.md` §2.

```sql
-- in decide_approval, before the APPROVE branch
if a.action_type = 'AGENT_AUTONOMY_CHANGE' and p_decision = 'APPROVE' then
  if exists (select 1 from core.jury_verdicts j
             where j.approval_request_id = a.id and j.mode = 'GATE'
               and j.status <> 'COMPLETE') then
    raise exception using errcode = 'TRNOS',
      message = 'The promotion jury has not returned a verdict',
      detail  = jsonb_build_object('code','JURY_PENDING')::text;         -- 409
  end if;
end if;
```

---

## 6 · The Edge Function boundary

### 6.1 What cannot be in SQL

| Capability | Why not | Where it goes |
|---|---|---|
| LLM calls: drafting, classification, jury opinions, rule extraction | network I/O, seconds of latency, non-deterministic | worker |
| Email, WhatsApp, BSP sends | network I/O, third-party rate limits, cost accounting | worker |
| Accounting package push, MyInvois validation | network I/O, provider error codes that need mapping | worker |
| PDF rendering, file storage | CPU and object storage, not relational work | worker |
| eTRIS submission | HRD Corp has no API at all, per §9 — a human files it | human, then `HRDC_PACKET_MARK_SUBMITTED` records the reference |
| Outbound webhooks | network I/O, retries, signing | worker |

The rule behind the table: **no network I/O in the action path, ever.** No `pg_net`,
no `http` extension, not even for something that "usually returns in 50ms". Three
reasons, in order of how badly each one bites. A call inside a transaction holds every
row lock it has acquired for the duration of a stranger's latency. A call that has
already landed cannot be rolled back when the transaction aborts, so the database and
the world disagree permanently. And a gate that calls out is a gate that fails when
the callee is down, which converts a provider outage into an inability to approve
anything.

### 6.2 The pattern

**SQL decides and writes a row. A worker executes and reports back.**

```
POST /v1/actions
  → Edge Function (thin adapter, no branching on policy)
      → app.perform_action(...)            one transaction
          decides → writes action_request, effects ledger,
                    approval_request or draft, and outbox rows
        commit
  ← 202 { status, … }

  later, independently:
      worker claims a job from the outbox
        → performs the external call
        → app.report_effect_result(effect_id, status, payload, error)
```

### 6.2a The seam with `sb-events`, agreed

`sb-events` owns `events`, `jobs`, `dead_letters`, `runs` and the realtime triggers.
The gate owns `action_requests`, `approval_requests`, `action_effects` and policy
evaluation. Four points settle the boundary.

**The gate writes `app.outbox` directly and emits through `app.emit_event`.** Both are
`sb-events`'. Their first proposal was that the gate only emit, and let event
subscriptions fan out to jobs; they then withdrew it, and they were right to. An
external effect is enumerated on the action request *before* the event exists, so
routing it through a generic subscription would lose the per-effect identity that §7
renders and that `report_effect_result` addresses. Both paths write the same table and both are
idempotent, so an effect that is also subscribed to its own event enqueues once.

**The write-back is `app.report_effect_result`, keyed on the effect id.** This one took
three rounds and is worth recording, because both lanes conceded and we briefly swapped
positions. `sb-events` first proposed `app.record_effect(action_request_id, effect)`. I
objected that the action id cannot address the write-back, since one action has N
external effects that succeed and fail independently. They proposed
`settle_effect(job_key, ...)`, which fixes that because `job_key` names exactly one
effect, and I adopted it. They then adopted *my* original instead, on the better
argument: `effect_id` is the primary key, so there is no lookup and no composite string
to parse. That argument wins, so both lanes are now on:

```sql
app.report_effect_result(
  p_effect_id bigint,     -- app.action_effects.id, carried in app.outbox.effect_id
  p_status    text,       -- SETTLED | FAILED
  p_payload   jsonb,      -- provider ids, message ids, uin, cost
  p_error     jsonb       -- {code, message, retryable}
) returns void
```

`p_status` takes `SETTLED` or `FAILED` from the worker; the stored effect status is
`SETTLED` or `DEAD_LETTERED`, because `app.fail_job` calls this only on *terminal*
failure and a retryable attempt never reaches the gate at all.

`app.complete_job` calls it on success and the dead-letter branch of `app.fail_job` calls
it on terminal failure. **The failure path is the one that matters**, and `sb-events` is
right to say so: without it, an action whose effect exhausts its retries would show
`DISPATCHED` forever while the action itself read `EXECUTED`. That is the exact
inconsistency §7.3 now forbids.

**The outbox must carry the gate's key.** The one hard requirement on `app.outbox` is a
unique constraint on `(tenant_id, idempotency_key)`, with the gate supplying
`'<action_request_id>:<seq>'`. That constraint is the whole retry-safety story for
external effects: a redelivered job can never produce a second email or a second invoice
push. Everything else about the table is theirs.

**Correlation confirmed.** `action_requests.id` is available at emit time and is passed
as `correlation_id` on every event descending from one action, `ApprovalRequested` and
`ApprovalDecided` included. `causation_id` is `sb-events`' to derive.

**The idempotency key** lives in `app.idempotency_keys.key`, with the 24-hour rule in
`expires_at` on the same row; `action_requests.idempotency_key_id` is the foreign key.
`sb-events` should reference `expires_at` for the shared retention rule rather than
invent a second one, but the table is in the unexposed `app` schema, so their webhook
ledger cannot read it over the Data API and will need its own row with the same rule.

The worker never writes domain tables. It reports through one narrow, validating
function, which is also the only place the action's own lifecycle advances:

```sql
create or replace function app.report_effect_result(
  p_effect_id bigint,
  p_status    text,                      -- SETTLED | FAILED
  p_payload   jsonb default '{}'::jsonb,
  p_error     jsonb default null
) returns void
language plpgsql security definer
set search_path = pg_catalog, app, core, public, extensions, pg_temp
as $$
declare
  e         app.action_effects%rowtype;
  v_open    int;
  v_failed  int;
begin
  select * into e from app.action_effects where id = p_effect_id for update;

  if not found then
    raise exception 'no effect %', p_effect_id;
  end if;
  if e.kind <> 'EXTERNAL' then
    raise exception 'effect % is not external', p_effect_id;
  end if;
  if e.status in ('SETTLED','DEAD_LETTERED') then
    return;                                        -- late duplicate report, ignore
  end if;

  update app.action_effects
     set status     = case when p_status = 'SETTLED' then 'SETTLED' else 'DEAD_LETTERED' end,
         attempts   = attempts + 1,
         last_error = p_error,
         retryable  = coalesce((p_error->>'retryable')::boolean, true),
         applied_at = case when p_status = 'SETTLED' then now() else applied_at end
   where id = e.id;

  -- the provider's own facts land on the domain row through the type's handler,
  -- the only place a worker's data reaches the domain schema
  if p_status = 'SETTLED' then
    execute format('select app.confirm_%s($1, $2)',
                   lower(app.effect_action_type(e.id)))
      using e.id, p_payload;
  end if;

  -- advance the action when the last external effect settles
  select count(*) filter (where status not in ('SETTLED','DEAD_LETTERED','APPLIED')),
         count(*) filter (where status = 'DEAD_LETTERED')
    into v_open, v_failed
  from app.action_effects
  where action_request_id = e.action_request_id;

  if v_open = 0 then
    update core.action_requests
       set status = case when v_failed > 0 then 'PARTIALLY_FAILED' else 'EXECUTED' end,
           completed_at = now()
     where id = e.action_request_id
       and status = 'EXECUTING';
  end if;
end;
$$;
```

The `INVOICE_PUSH` confirm handler is the worked example, and the contract already
models its output: `sync.state`, `sync.uin`, `sync.lastAttemptAt` and the `syncLog[]`
array in §9 are exactly what `app.confirm_invoice_push` writes.

### 6.3 What the Edge Function for `POST /v1/actions` may do

Parse the body. Read the `Idempotency-Key` header and pass it through. Call the RPC.
Map `errcode` to an HTTP status. Set the `Idempotent-Replay` header when the function
asks for it. Return.

It may **not** branch on policy, compute a threshold, decide whether something needs
approval, or shape a different response for a different role. Any of those would
recreate in TypeScript the decision the contract puts in one place, and the two copies
would diverge in a fortnight.

The error mapping, which is the whole adapter:

| `details.code` | HTTP |
|---|---|
| `VALIDATION_FAILED` | 422 |
| `NOT_FOUND` | 404 |
| `FORBIDDEN` | 403 |
| `ATTENDANCE_LOCKED` | 409 |
| `FLOOR_PRICE_BREACH` | 422 |
| `AGENT_PAUSED` | 409 |
| `IDEMPOTENT_REPLAY` | 409 |
| `ALREADY_DECIDED` | 409 |
| `DIFF_CHANGED` | 409 |
| `BULK_NOT_PERMITTED` | 409 |
| `JURY_PENDING` | 409 |
| `SYNC_FAILED` | 502 |

All raised with `errcode = 'TRNOS'` and a `detail` carrying the JSON, so the adapter is
one `switch` over `details.code` and never parses a message string.

---

## 7 · Failure and retry semantics

### 7.1 In-database effects

Atomic. All the `IN_DATABASE` effects of one action commit together or none of them do.
There is no partial in-database state to reason about, which is the main reason the
planner and the executor are separate: the planner can fail while reading without
having written anything.

If an executor raises during `decide_approval`, the whole decision rolls back and the
approval stays `PENDING`. The manager sees an error and can retry. There is no such
thing as a half-decided approval.

### 7.2 External effects

At-least-once, per effect, independently.

| Property | Value |
|---|---|
| Job key | `<action_request_id>:<seq>`, unique per tenant |
| Backoff | exponential, 1m · 5m · 25m · 2h · 10h |
| Max attempts | `action_types.max_effect_attempts`, default 5 |
| Terminal states | `SETTLED` or `DEAD_LETTERED` |
| Non-retryable | `retryable: false` from the provider skips straight to `DEAD_LETTERED` |

The non-retryable codes the contract already names: `WA_TEMPLATE_REJECTED` in §10 and
`CUSTOMER_NOT_MAPPED` in §1's `SYNC_FAILED` example. Retrying either one produces the
same rejection five times and buries the real signal, which is that a human needs to
fix a template or map a customer.

### 7.3 Partial failure policy

**An action is not `EXECUTED` while an external effect is still outstanding, and an
external effect that later fails does not reverse the in-database ones.**

Those are two rules, and the first is new. `sb-events` found the hole: without it, an
effect that exhausts its retries sits at `DEAD_LETTERED` forever while the action reads
`EXECUTED`, and the database asserts something finished that did not.

**The lifecycle.**

| `action_requests.status` | Meaning | Set by |
|---|---|---|
| `EXECUTING` | in-database effects committed; at least one external effect outstanding | `app.apply_effects` |
| `EXECUTED` | every effect settled successfully | `app.report_effect_result`, on the last one |
| `PARTIALLY_FAILED` | every effect settled, at least one dead-lettered | `app.report_effect_result`, on the last one |

An action with no external effects goes straight to `EXECUTED` inside the gate's own
transaction and never passes through `EXECUTING`. That is most of the twenty-one types:
only the seven with a send, a push or a render ever wait.

**What the API returns, and why it still says `EXECUTED`.** §12's `ActionStatus` has four
values and none of them is `EXECUTING`, so the response variant and the row status are
now different things. `POST /v1/actions` returns `202 { "status": "EXECUTED" }` the
moment the gate decides and commits, because 202 Accepted means exactly that: accepted
for processing. The row meanwhile says `EXECUTING` until the email actually goes. The
mapping is one function, `app.response_status(row)`, which folds `EXECUTING`,
`EXECUTED` and `PARTIALLY_FAILED` to `EXECUTED` for the §3 response.

**What the screens show.** The record screens render the row status, not the response
variant, because that is where the difference matters. On M02-S02 an approved action
shows its effects list with a per-effect delivery state: `SETTLED` ticks, one
`DEAD_LETTERED` row rendered as a failed chip with the provider code and a retry
affordance. `PARTIALLY_FAILED` is what the operations queue filters on, and it is the
difference between "this did not happen" and "this happened and one of its consequences
did not". `EXECUTING` is a transient the UI may show as a pending state on the effect
row, never on the record's own lifecycle stepper, because the record genuinely did
change.

**And the second rule: no automatic compensation.**

The temptation is to compensate: the email bounced, so put the proposal back to
`DRAFT`. That is wrong, and dangerously so. A delivery failure is often a lost
acknowledgement rather than a lost message, so the compensation would tell the sales
team the proposal was never sent while the client is reading it. Worse, `sentAt` is in
the audit trail and in an emitted event that downstream consumers have already acted
on.

So instead: the in-database state is the truth about what TrainOS decided, and each
external effect carries its own visible delivery state.

| Action | External effect fails | What the user sees |
|---|---|---|
| `PROPOSAL_SEND` | email send | proposal stays `SENT` with `deliveryState: FAILED`; the follow-up task is **not** created; the proposal record shows a retry affordance |
| `INVOICE_PUSH` | accounting push | `sync.state: ERROR` with `providerCode`, a new `syncLog[]` row, retry from M13-S02 — exactly the shape §9 already renders |
| `REMINDER_SEND` | WhatsApp send | the collections stage does **not** advance; the queue row returns to `DRAFT_READY` |
| `BROADCAST_SEND` | one recipient | that recipient's `messages` row is `FAILED`; the other recipients are unaffected |
| `TRAINER_BOOK` | trainer notification | booking stands, notification retries, OPS is alerted at dead-letter |

Two of those rows are compensating in-database writes: `REMINDER_SEND` rolls the stage
back and `PROPOSAL_SEND` withholds the task. Both are safe because neither has been
observed by anyone outside the system. The rule is not "never compensate", it is
**never compensate a fact a third party may already have seen.**

The `partial_failure` boolean the first draft carried is gone: `status` now says the
same thing with more precision and one fewer column to keep in step. Two spellings of
one fact is the divergence the project rules call a defect.

### 7.4 Retry of a whole action

`POST /v1/runs/{id}/retry` re-runs the agent, which submits a **new**
`POST /v1/actions` with a **new** idempotency key. It does not re-execute the old
action request. Re-executing a stored plan would apply a diff computed against a world
that has since moved, which is the same staleness problem §4.2 solves for approvals,
and here there is no human to show the recomputed diff to.

---

## 8 · Test plan

pgTAP, run against a branch database. Fixtures are the contract's own: Aurora
Manufacturing (`ORG-0114`), `PRO-2026-0184` at RM 18,500, `APV-2026-0771`, `ENG-0231`,
`run_4821`, `agent_proposal`, `u_amirah` as `SALES`, `u_kelvin` as `SALES_MANAGER`.

### 8.1 One scenario per response variant per requester kind

| # | Requester | Setup | Expect |
|---|---|---|---|
| 1 | `HUMAN` `SALES` | `ENQUIRY_ARCHIVE`, no policy matches | `EXECUTED`, 202, `enquiries.status = ARCHIVED`, one `EnquiryArchived` in the outbox |
| 2 | `HUMAN` `SALES` | `PROPOSAL_SEND` on `PRO-2026-0184`, RM 18,500 → `APV-01` matches | `QUEUED_FOR_APPROVAL`, 202, `proposals.status` still `DRAFT`, approval assigned to `u_kelvin` |
| 3 | `HUMAN` `SALES` | any type, humans never receive drafts | `SUGGESTED` is **unreachable**; assert the dispatch matrix has no human/`SUGGESTED` cell |
| 4 | `AGENT` `AUTONOMOUS` | `agent_lead` + `ENQUIRY_ARCHIVE`, grant `AUTONOMOUS`, no policy | `EXECUTED`, 202, `createdBy.kind = AGENT`, provenance `origin = AI_EXECUTED` |
| 5 | `AGENT` `ACT_WITH_APPROVAL` | `agent_proposal` + `PROPOSAL_SEND`, confidence 0.82 | `QUEUED_FOR_APPROVAL`, 202, `APV-2026-xxxx`, `slaDueAt = created + 240m`, nothing in `core` changed |
| 6 | `AGENT` `SUGGEST` | `agent_lead` + `FOLLOWUP_SEND`, grant `SUGGEST` | `SUGGESTED`, **200** not 202, a `suggested_drafts` row expiring in 7 days, no `messages` row |
| 7 | `SYSTEM` | webhook ingest records a payment | `EXECUTED`, 202, policy skipped, `requested_by_kind = SYSTEM` in the log |
| 8 | `AGENT` `OBSERVE` | no grant row at all | `403 FORBIDDEN`, `details.grantedLevel = OBSERVE`, default-deny proven |

### 8.2 The named tests

**Double-click idempotency.** Two concurrent `perform_action` calls, same
`Idempotency-Key`, same body, from two sessions.

```sql
-- session A and session B start together
select app.perform_action('PROPOSAL_SEND', 'PRO-2026-0184',
         '{"channel":"EMAIL"}'::jsonb, null, null, null, '[]'::jsonb, 'k-double-1');
```

Assert: exactly **one** row in `action_requests`; exactly one `approval_requests` row;
the second call returns the identical body with `Idempotent-Replay: true` and status
200; no duplicate outbox job. Then a third call with the same key and a **different**
payload returns `409 IDEMPOTENT_REPLAY`. Then a fourth call 25 hours later, after the
cleanup job, creates a new action request, proving the 24-hour retention.

**Self-approval.** `u_kelvin` (`SALES_MANAGER`) submits a `PROPOSAL_SEND` that matches
`APV-01`, then attempts to decide it.

Assert: the approval is **not** assigned to `u_kelvin`; `decide_approval` by
`u_kelvin` returns `403 FORBIDDEN` with `details.policyId = 'GOV-03'`; the same
decision by a different `SALES_MANAGER` succeeds. Then the variant: set
`self_authorise = true` on `APV-01`, re-submit, assert `EXECUTED` with the trace
carrying `selfAuthorised: true`. Then the edge case: `u_kelvin` is the **only**
`SALES_MANAGER` and `self_authorise` is false — assert
`422 VALIDATION_FAILED` with `reason = NO_ELIGIBLE_APPROVER`, not a silent
self-assignment.

**Money-autonomous 422.** `PUT /v1/agents/agent_proposal/autonomy` with
`{ actionType: 'PROPOSAL_SEND', level: 'AUTONOMOUS' }`.

Assert: `422 VALIDATION_FAILED` with `details.reason = 'MONEY_MOVING_CEILING'`; no row
in `autonomy_grants` changed. Then the second path: `update core.autonomy_grants set
level = 'AUTONOMOUS'` directly in SQL, asserting the **trigger** raises too, so the
ceiling holds even against a migration or a console edit. Then the third: lower
`action_types.ceiling_autonomy` after a grant exists, and assert `perform_action`
re-applies the new ceiling at evaluation time rather than honouring the stale grant.

**Bulk-approve 409.** Seven approvals in the `SALES_MANAGER` queue, one of them
`PROPOSAL_SEND` at RM 18,500.

Assert: `bulk_decide` over all seven returns `409` with
`details.notBulkApprovable[]` naming exactly the one; **none** of the other six is
decided; their `status` is still `PENDING`. Then bulk-approve the other six and assert
all six execute in one transaction.

**Diff staleness 409.** Raise `APV-2026-0771`. Then change the world: update the
quotation's sell price so the planned effects differ. Then approve.

Assert: `409` with `details.diffChanged = true` and a `details.diff` that differs from
the original; the approval is still `PENDING`; nothing executed. Then call
`app.refresh_approval_diff`, re-render, approve, and assert `effects[]` in the response
is **element-for-element identical** to the refreshed `diff[]`.

### 8.3 The rest

| Test | Assert |
|---|---|
| Value read from the record | agent sends `payload.value.amount = 1400000` on an RM 18,500 proposal → `APV-01` still matches; `action_requests.value_minor = 1850000` |
| Policy beats grant | agent at `AUTONOMOUS` on a type where a policy matches → `QUEUED_FOR_APPROVAL`, never `EXECUTED` |
| Confidence downgrade | `agent_proposal` at `AUTONOMOUS`, confidence 0.55, minimum 0.70 → `QUEUED_FOR_APPROVAL` with `risk.level = HIGH` and `GOV-05` in the trace |
| Kill switch | `core.agents.kill_switch = true` → `409 AGENT_PAUSED`, `reason = AGENT_PAUSED`; `AGENT_PAUSE` on the same agent still succeeds |
| Budget cap | tier `PAUSED_BY_CAP` → `409 AGENT_PAUSED`, `reason = BUDGET_CAP` |
| Attendance lock one-way | `ATTENDANCE_APPROVE` then a capture → `409 ATTENDANCE_LOCKED` with `unlockActionType` in the details |
| Unlock voids the claim | `ATTENDANCE_UNLOCK` effects[] explicitly contains the packet void; `CMP-03` routes to `MD` when a claim reference exists |
| Packet incomplete | `HRDC_PACKET_MARK_SUBMITTED` at completeness 0.62 → `422`, per §9 |
| SLA escalation | advance the clock 6h → `escalated_at` set, `assigned_to` is an `MD`, one escalation event |
| Expiry | advance 24h → approval `EXPIRED`, action `REJECTED` with `APPROVAL_EXPIRED`, target record byte-identical to before |
| Jury escalate | value RM 60,000 with `AUTONOMOUS` grant → level capped at `ACT_WITH_APPROVAL`, a `jury_verdicts` row `PENDING`, and the **transaction time under 50ms** |
| Jury sample determinism | run `enqueue_jury_samples` twice → the same rows, no duplicates |
| Tenant isolation | tenant B cannot read, decide, or replay tenant A's approval or idempotency key (`sb-tenancy` owns the RLS; this asserts it) |
| Concurrent decide | two `SALES_MANAGER` sessions approve the same id simultaneously → one `APPROVED`, one `409 ALREADY_DECIDED`, effects applied exactly once |
| `GOV-07` direct flip | as `agent_proposal` over the Data API, `update core.proposals set status = 'SENT'` → permission denied on the column, before any trigger runs |
| `GOV-07` insert bypass | as `agent_proposal`, `insert into core.proposals (…, status) values (…, 'SENT')` → `ILLEGAL_STATE_TRANSITION`, since no edge has `from_status` null and `to_status` `SENT` |
| `GOV-07` forged applier | `set_config('app.effect_applier', <a real ENQUIRY_ARCHIVE action id>)` then flip a proposal to `SENT` → `FORBIDDEN`, because the running action's type is not `PROPOSAL_SEND` |
| `GOV-07` happy path | approve `APV-2026-0771` → the applier crosses `DRAFT → SENT` and no other path can |
| Ungated edge | the client portal marks a proposal `SENT → VIEWED` with no applier set → succeeds, since that edge has `gated_by` null |
| Schema posture | `authenticated` has no `insert`/`update`/`delete` on any gate table except `approval_decisions`; `app` is not in PostgREST's exposed schemas |
| `EXECUTING` lifecycle | `PROPOSAL_SEND` executes → row is `EXECUTING`, response says `EXECUTED`, `completed_at` is null; the email effect settles → row is `EXECUTED` and `completed_at` is stamped |
| Dead-lettered effect | the email effect exhausts its retries → row is `PARTIALLY_FAILED`, never `EXECUTED`; the proposal is still `SENT` |
| No external effect | `ENQUIRY_ARCHIVE` executes → `EXECUTED` directly, never passes through `EXECUTING` |
| `report_effect_result` idempotence | call it twice for the same effect → the second returns without changing attempts or re-running the confirm handler |
| Outbox key collision | run `apply_effects` twice for one action → one outbox row per effect, `on conflict` absorbs the second |

That last one is the row-lock test and it is the one most worth writing first: it is
the failure that would send a proposal twice.

---

## 9 · Open questions, mapped to §16

**Answered in this document.**

| §16 | Question | Answer | Where |
|---|---|---|---|
| Q1 | Does an approval expire? | Yes. `EXPIRED` at 24h, MD escalation at 6h, never auto-approve, never nag forever. Agent runs get `APPROVAL_EXPIRED` and are retryable. | §4.5 |
| Q2 | Diff staleness | Hash check → `409` with the recomputed diff. A soft lock on the target was considered and rejected. | §4.2 |
| Q3 | Who owns `firstProposalToOrg`? | Computed live from a partial index on `core.proposals`. Not denormalised: a flag has too many invalidation paths and fails silently. | §2.3 |
| Q7 | Agent service principals | One per agent **per tenant**. `autonomy_grants` is keyed `(tenant_id, agent_id, action_type)` and every check is tenant-scoped. | §1.2 |

**Answered with a recommendation that needs a human decision.**

| §16 | Question | Recommendation | Owner |
|---|---|---|---|
| Q5 | Should unlock be refused once a claim reference exists? | **No, escalate instead.** `CMP-02` routes `ATTENDANCE_UNLOCK` to `FINANCE`; when `claimReferenceExists` the higher-priority `CMP-03` routes it to the `MD`, and `effects[]` must state the void in words. Refusing outright leaves no path when the attendance was genuinely wrong, and the wrong data would then be what HRD Corp holds. | Finance / Compliance, with `sb-erd` |
| — | Approver role for `TRAINER_BOOK` and `ENGAGEMENT_CLOSE_OUT` | `OPS`, escalating to `MD` at 12h. Nothing in the contract names a role for either; this is a placeholder that needs the MD's sign-off alongside the autonomy matrix. | MD |
| — | Should a human holding the approver role self-authorise? | Default **no** (`policies.self_authorise = false`), per policy so the MD can relax specific ones. §3 input 5 forbids deciding your own request but is silent on executing it. | MD |

**Not in this lane.** Q4 WhatsApp rate TTL and Q10 money rounding are `sb-money`'s;
Q6 client portal token lifetime and Q9 saved views are `sb-tenancy`'s; Q8 sandbox
replay determinism belongs with whoever owns the agent runtime. §17's five open
questions are likewise out of scope here, except Q2 (jury cost), which
`DECISIONS.md` §2 has already settled as gate-plus-sample-plus-escalate and which §5
implements.

---

## Phase 3 · Deviations

Twelve places where this design departs from a literal reading of the sources, or
resolves something the sources leave ambiguous. Each is a decision someone can
overturn.

1. **`CMP-` instead of `HRD-` for compliance policy ids.** `HRD-014`, `HRD-015` and
   `HRD-022` are already compliance **rule** ids in §17. Two registries sharing a
   prefix would collide the first time someone greps for one.
2. **Twenty-one action types, not nineteen.** §3 enumerates 19. §17 then introduces
   `BUDGET_CAP_RAISE` and `RULE_CHANGE_APPROVE`, both routed through
   `POST /v1/actions`. §12's enum catalogue was never updated. The catalogue in §3 of
   this document carries all 21, with the extras marked.
3. **`InvoicePushed` split.** §14 lists one event emitted by both `INVOICE_CREATE` and
   `INVOICE_PUSH`. Creating a draft invoice and pushing it to the accounting package
   are different facts with different consumers, so `INVOICE_CREATE` emits
   `InvoiceCreated` and only the push emits `InvoicePushed`.
4. **Twelve action types need a new event name.** §14 defines events for nine of the
   twenty-one. The names proposed in §3 are `sb-events`' to accept or replace.
5. **`ESCALATE` caps autonomy rather than blocking on a model.** §18 says "`ESCALATE`
   blocks only when a trigger fires", which a literal reading makes a synchronous jury
   call. That would put an HTTP call inside the gate's transaction. The action is
   blocked; the transaction is not.
6. **`REQUEST_CHANGES` closes the approval** rather than returning it to `PENDING`.
   §7 does not say. §12's `ApprovalStatus` lists `CHANGES_REQUESTED` alongside the
   other terminal values, which supports this reading.
7. **`policies.self_authorise` is invented.** The contract forbids deciding your own
   request and says nothing about executing one. The flag makes the question explicit
   rather than settling it silently, and defaults to the conservative answer.
8. **`bulk_approvable` is computed per request, not per type.** §7 says "`false` for
   any action carrying a monetary value". A `REMINDER_SEND` may or may not carry one.
   `action_types.money_moving` is a separate, stricter condition, and both are applied.
9. **The value is read from the record, not the payload.** §3 says "`payload` monetary
   value". Trusting the payload would let an agent choose its own threshold. `payload`
   supplies the value only for `PAYMENT_RECORD` and `BUDGET_CAP_RAISE`, where the
   amount is genuinely the request.
10. **`SYSTEM` requesters bypass policy.** §3 describes humans and agents. A webhook
    recording an inbound payment is reporting something that already happened, so
    there is nothing to approve. They remain fully logged, and a `money_moving`
    `SYSTEM` action is rejected by seed constraints.
11. **The `ANY`-over-empty idiom.** An unconditional policy is written
    `combinator: 'ALL'` with `conditions: []`, which evaluates true. The contract only
    ever shows a populated condition list.
12. **HTTP status codes are set inside SQL** via `set_config('response.status', …)`
    rather than being derived by the adapter. §3 assigns 200 to `SUGGESTED` and 202 to
    the other two, which is not a distinction an adapter can make without re-reading
    the response.

13. **My tables split across two schemas, against my own first draft.** The first
    version of this document put everything in `app`, and migration 001 quotes that
    line when it creates the schema. `sb-tenancy` then pointed out that `app` is absent
    from PostgREST's exposed schemas, so `GET /v1/approvals` would have had no data
    source. The read-path tables are now in `core` and only the execution ledger and the
    replay cache remain in `app`. Migration 001's comment on the `app` schema needs the
    same correction.
14. **`app.policies` renamed `core.action_policies`.** A table called `policies` sitting
    in a schema that also carries row-level security policies is an invitation to
    misread one for the other.
15. **`core.approval_decisions` adopted from `sb-tenancy`.** My first draft kept the
    decision on `approval_requests` alone. Their append-only table is better, because a
    rule whose failure is fraud rather than a defect can then carry an `INSERT` policy.
    The denormalised columns stay as the projection the list endpoint reads.
16. **`GOV-07` added** for gated state transitions. It is not in any source document,
    because the bypass it closes only becomes visible once RLS and the policy gate are
    designed side by side.

17. **`ActionStatus` gains two values the contract does not have.** §12 lists
    `EXECUTED · QUEUED_FOR_APPROVAL · SUGGESTED · REJECTED`. The stored row also uses
    `EXECUTING` and `PARTIALLY_FAILED`, because an action waiting on an email has not
    finished and the database should not claim it has. The §3 response still returns
    `EXECUTED` for all three, mapped by `app.response_status`. The response variant and
    the row lifecycle are now different things, which is a real divergence from a
    contract that uses one enum for both.
18. **`ActionRequested` fires for all three variants**, including `SUGGESTED` and a
    policy halt. §3 names the event and §14 omits it. Firing it only on execution would
    lose the case the M18-S04 trace most needs: an agent asked and was refused.

**One thing that reconciles rather than deviates.** `DECISIONS.md` §2 sets the jury
escalation value trigger at RM 50,000 and §18 writes it as
`{ "amount": 5000000, "currency": "MYR" }`. In integer sen those are the same number.
No conflict.

## Phase 3 · What I could NOT verify

1. **No SQL in this document has been executed.** There is no database, no Supabase
   project and no migration in this repository. Every statement here is a sketch that
   compiles in my head and nowhere else. Column types, `plpgsql` control flow, the
   `record` declarations and the `execute format(...)` dispatch all need a real
   `create extension`, a real branch and a real `pgTAP` run before anyone trusts them.
2. **Domain column names are confirmed for the five context flags and unverified
   elsewhere.** `sb-erd` has confirmed `proposals.organisation_id`, the
   `proposals_org_sent` and `invoices_overdue` partial indexes verbatim,
   `quotations.floor_price_minor`, `attendance_days`, `engagements.starts_on`,
   `hrdc_packets.deadline_at` and `invoices.due_at`, and the four stable money columns.
   `core.contact_consents`, `core.messages`, `core.payments` and
   `core.compliance_rules`, which appear in §3's effect table, are still my guesses.
3. **`sb-tenancy`'s helpers are now confirmed**, with two corrections applied:
   `app.require_tenant_id()` rather than the nullable `app.current_tenant_id()` inside
   the gate, and `actor_kind` carries four values because portal RPCs produce `CLIENT`.
   `app.is_service_role()` and `app.role_holders()` are still mine to propose and have
   not been acknowledged.
4. **The `sb-events` seam is now agreed on both sides** and reflected in §6.2a: the
   gate writes `app.outbox` directly with their column names, emits through their
   three-argument `app.emit_event` overload, and the worker reports through their
   `app.report_effect_result(effect_id, …)`. What is unverified is that the two
   documents' SQL actually compiles against each other, since neither has been run.
   `app.job_type_for(action_type, entity)` is theirs to write and does not exist yet.
5. **`sb-money` must persist `floor_price_minor` on the quotation.** The
   `belowFloorPrice` flag is a comparison of two stored columns. If the floor is
   computed on read instead of stored, the gate would have to call into money
   arithmetic, which this lane is explicitly not allowed to do.
6. **`docs/research/08-supabase-agentic-best-practices.md` does not exist.** Only
   `07-agent-tooling.md` is in the repository, and it covers Claude Code configuration
   rather than policy gates or idempotency. Nothing from it informed this design.
7. **`pg_cron` is not provisioned and this design needs it.** Migration 001 installs
   `pgcrypto`, `citext`, `btree_gist` and `pg_trgm` into the `extensions` schema and
   nothing else. The six scheduled jobs in §4.5 — escalation, breach notification,
   expiry, idempotency cleanup, draft expiry and jury sampling — have no scheduler.
   This is the one gap in this document that blocks working software rather than
   describing a choice, and it belongs to whoever owns the migrations. The design
   deliberately avoids `pgcrypto` by using the built-in `sha256()`, and deliberately
   avoids `pg_net` and `http` entirely.
11. **The trigger attachments in §2.9 are not written.** I own
    `app.enforce_state_transition()` and `core.state_transitions`; attaching the trigger
    to each gated table and applying the column-privilege grants sits with whoever owns
    that table's DDL. Until both halves land, the bypass `sb-tenancy` §3.4 describes is
    still open.
12. **`core.state_transitions` is seeded with eight example edges, not the full set.**
    The complete set is one row per legal edge across every status enum in §12, which is
    roughly sixty rows. Deriving them is mechanical but it has not been done, and a
    missing edge fails closed — a legitimate transition would raise
    `ILLEGAL_STATE_TRANSITION` in production.
8. **The policy catalogue in §1.9 is 4 sourced ids and 22 derived ones.** Only
   `APV-01`, `APV-02`, `FIN-01` and `FIN-03` appear in the sources. Every threshold,
   SLA and approver role on the other twenty-two rows is inferred from
   `DECISIONS.md` §1 and needs the MD's sign-off in the same session that signs off
   the autonomy matrix. `APV-01`'s own conditions are the only ones quoted verbatim
   from the contract.
9. **Approval assignment fairness is untested.** `app.role_holders` orders by open
   approval count, which is a plausible round-robin and not a measured one. Whether it
   distributes sensibly under a real queue is something only production data answers.
10. **No performance measurement.** The claims that the context-flag probes are
    "one index probe" and that the `ESCALATE` path stays "under 50ms" are reasoning
    about the plans these queries should get, not `EXPLAIN ANALYZE` output. The test
    plan asserts the 50ms figure; nobody has run it.
