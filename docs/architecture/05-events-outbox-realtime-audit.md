# 05 · Domain events, outbox, realtime, audit and agent run traces

Lane owner: `sb-events`. Scope: how every state change becomes a durable event, how
edge-function workers execute side effects and report back, how the UI gets realtime
badges, and how the audit drawer and run trace viewer are fed.

Sources: `API_CONTRACT.md` §2, §3, §10, §11, §12, §14, §16, §17, §18 and `DECISIONS.md`.
Neighbouring lanes: `sb-erd` (domain model), `sb-tenancy` (tenant + RLS),
`sb-actions` (action envelope, approvals, effects), `sb-money` (rules, provenance).

Non-goals: migrations, RLS beyond `realtime.messages`, policy evaluation, prompt
design, frontend.

---

## Phase 1 · Decisions

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Event log shape | One append-only `core.events` table, plus `core.event_subjects` link rows | Per-aggregate event tables | One catalogue (§14), one audit query, one retention policy. Link rows let an event appear in more than one record's drawer without an `OR` that defeats the index. |
| D2 | Partitioning | **None at launch.** Documented trigger to partition `events` by month | Monthly range partitioning from day one | The skill's threshold is >100M rows; realistic TrainOS volume is ~10⁵–10⁶ events/yr. Partitioning also forbids a global unique index, which is exactly what the idempotency key needs. See [Deviations](#deviations). |
| D3 | Queue transport | **Own `app.outbox` table**, claimed with `FOR UPDATE … SKIP LOCKED` | `pgmq` / Supabase Queues, as recommended by research doc §4 | The job ledger is a UI-visible entity here (dead letters, agent-failure badge, retry-from-checkpoint). `pgmq` queue tables are not tenant-indexed and expose no typed state, so every UI query becomes a jsonb expression scan across N queue tables. See [§2.1](#21-pgmq-vs-a-job-table). |
| D4 | Enqueue mechanism | Same transaction as the state change, inside `app.emit_event()` | Separate outbox relay process | Both the event and the job are rows in the same database; a relay would only add a failure mode. This is the transactional outbox with the transport collapsed. |
| D5 | Worker trigger | `pg_cron` tick every 10s → `pg_net` → `job-worker` edge function, plus an optional per-row `pg_net` nudge for `priority = 1` jobs | Trigger-per-job only; long-lived polling worker | The cron tick is the reliability floor and cannot be starved. The nudge is a latency optimisation and is never the delivery guarantee. `pg_net` requests do not start until the transaction commits, so a nudge can never fire for a rolled-back job. |
| D6 | Realtime mechanism | **Broadcast from database triggers** (`realtime.send`) on private channels | `postgres_changes` | §11 payloads are reshaped (`urgencyGroup`, `slaBreached`, `syncState`), which `postgres_changes` cannot produce. Broadcast also scales per-topic instead of replaying RLS per subscriber per row change. |
| D7 | Realtime durability | Realtime is a hint, never a source of truth. Clients refetch on subscribe and on reconnect | Treating broadcast as delivery | `realtime.messages` is partitioned daily and retained 3 days, and a disconnected client misses messages entirely. |
| D8 | Audit trail | **Derived view over `events`**, with a human-readable `summary` written at emit time | Separate `audit_log` table; computing summaries in a view | A second table doubles every write and drifts. A `CASE` over 27 event types in a view is unmaintainable; the emitter already knows the sentence. |
| D9 | Sandbox replay (§16 Q8) | **Snapshot pinned to the run.** Every tool read is captured in `run_snapshots`; replay serves reads from the snapshot, refuses writes, and hard-errors on a miss | Live reads during replay | Live reads make replay non-deterministic, which destroys its only purpose. A miss must fail loudly rather than silently diverge. |
| D10 | Run PII | Redact in the worker **before** storage; full prompt/completion in `run_node_io` for 30 days, then the row is deleted; metadata (tokens, cost, tier, status) kept indefinitely | Storing raw and redacting later; deleting whole runs | The database should never hold the raw text. Keeping the row and nulling the columns bloats the hot trace table; deleting the side table is instant. |
| D11 | Enum storage | `text` + `check` constraint | Postgres `enum` types | Job types, event types and run event types all grow. `ALTER TYPE … ADD VALUE` is awkward inside a migration transaction; a `check` constraint is a one-line change. |
| D12 | Idempotency | Unique partial index on `core.events (tenant_id, idempotency_key)` and on `app.outbox (tenant_id, idempotency_key)`; a richer `app.webhook_deliveries` ledger for inbound sources | A single global key table | Inbound webhook keys need the raw body and signature verdict for debugging; action keys need 24h TTL per §1. Different lifetimes, different tables. |
| D13 | Long-running work | A handler **yields**: run to ~300s, checkpoint, re-enqueue | A long lease plus `EdgeRuntime.waitUntil` | Background tasks share the request's wall clock (400s paid) and do not get a longer budget. There is no fifteen-minute job on this runtime, so the checkpoint machinery is what makes agent runs possible at all. **The six-minute lease cap and the 300s yield are binding on the agent runtime**, per the team lead. See §2.6. |
| D14 | Badge channel | **Per user**, `tenant:{t}:user:{u}:badges`, authorised by RLS | Flat `badges` channel (§11); per-role channel (my first draft) | The badge number differs per user, and §11 already calls the stream "per-user filtered". A per-role channel leaks one role's queue depth to every other role. See §3.4, §7.4. |
| D15 | Client broadcast | A **restrictive** `INSERT` deny on `realtime.messages` | Relying on the absence of an `INSERT` policy | Absence is undone by the first permissive policy anyone adds; a restrictive policy `AND`s with all of them. Without it the approvals badge is spoofable from a browser console. |
| D16 | Schema placement | `core` for what the API reads, `app` for what only workers touch | One schema for the lane | Ruling R-C2. `core.events`, `core.event_subjects`, `core.runs`, `core.run_nodes`, `core.run_node_io`, `core.run_events`, `core.run_state_cards`, `core.run_checkpoints`, `core.run_snapshots`, `core.evals` feed the audit drawer and the run trace over PostgREST. `app.outbox`, `app.dead_letters`, `app.event_subscriptions`, `app.webhook_deliveries`, `app.webhook_routes`, `app.key_access_audit` are never read by a client and stay in the unexposed schema. |

---

## 1 · Domain events

### 1.1 `core.events`

Append-only. Never updated, never deleted by application code.

```sql
create table core.events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,

  -- classification
  type            text not null,            -- §14 catalogue name, e.g. 'ProposalSent'
  aggregate_type  text not null,            -- 'PROPOSAL' | 'ENGAGEMENT' | 'RUN' | …
  aggregate_id    uuid not null,
  aggregate_ref   text,                     -- 'PRO-2026-0184', for the drawer without a join

  -- content
  payload         jsonb not null default '{}'::jsonb,
  summary         text not null,            -- the audit drawer sentence, written at emit time
  actor           jsonb not null,           -- { kind, id, name }; kind ∈ HUMAN|AGENT|SYSTEM|CLIENT

  -- lineage
  correlation_id  uuid not null,            -- the originating action_request id, constant down the chain
  causation_id    uuid,                     -- the immediately preceding event
  run_id          uuid references core.runs(id) on delete set null,

  -- delivery
  idempotency_key text,
  occurred_at     timestamptz not null default now(),
  seq             bigint generated always as identity
);

-- append-only enforcement
create or replace function app.reject_mutation() returns trigger
language plpgsql as $$ begin
  raise exception 'events is append-only (attempted %)', tg_op using errcode = '0A000';
end $$;

create trigger events_append_only
  before update or delete on core.events
  for each row execute function app.reject_mutation();

revoke update, delete on core.events from authenticated, anon, service_role;
```

`actor.kind` uses the §12 `ActorKind` enum and all four values occur: portal RPCs write
`CLIENT`, the agent principal writes `AGENT`. `actor` stays jsonb rather than three
columns because the contract renders it as one object everywhere (`createdBy`, audit
`actor`) and because a `CLIENT` actor has no row in any user table.

Per `sb-tenancy` §3.1, the agent credential is issued **per agent per tenant**, so
`tenant_id` comes from `app.current_tenant_id()` for agent-authored events exactly as it
does for human ones. There is no branch. `actor.id` is the agent id string
(`agent_proposal`), not a `uuid`, which is why `actor` is jsonb and not a foreign key.

**`tenant_id` is `not null` with no exception on this table.** `sb-money` models HRD Corp
rules with `tenant_id` null meaning platform-global, and that exception does **not**
extend here: an event about a global rule change carries the tenant whose engagements are
affected, never null. A null-tenant event cannot appear in any audit drawer, which is the
one place a rule change most needs to be visible. One global rule change affecting four
tenants emits four events.

**Indexes.**

```sql
-- audit drawer and record timelines (the hot path)
create index events_subject_idx
  on core.event_subjects (tenant_id, subject_type, subject_id, event_id);

-- tenant-wide feeds, keyset paginated
create index events_tenant_time_idx
  on core.events (tenant_id, occurred_at desc, id desc);

-- catalogue filters (e.g. every ApprovalRequested this month)
create index events_tenant_type_time_idx
  on core.events (tenant_id, type, occurred_at desc);

-- dedupe; partial so the index holds only keyed events
create unique index events_idempotency_idx
  on core.events (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- run trace back-reference
create index events_run_idx on core.events (run_id) where run_id is not null;

-- payload containment, only if catalogue-wide payload search is actually needed
-- create index events_payload_gin on core.events using gin (payload jsonb_path_ops);
```

The GIN index is commented out deliberately. Nothing in the twenty screens queries an
event by payload contents; adding it costs write throughput for a query that does not
exist yet.

### 1.2 `core.event_subjects` — the audit drawer's index

`GET /v1/{resourceType}/{id}/audit` must show events where the record is *involved*, not
only where it is the aggregate. `ApprovalDecided` has aggregate `APPROVAL` but belongs in
the proposal's drawer too. An `OR` across two columns will not use an index, so
involvement is normalised.

```sql
create table core.event_subjects (
  event_id     uuid not null references core.events(id) on delete cascade,
  tenant_id    uuid not null,
  subject_type text not null,       -- 'PROPOSAL' | 'ORGANISATION' | 'ENGAGEMENT' | …
  subject_id   uuid not null,
  role         text not null default 'SUBJECT'
                 check (role in ('SUBJECT','RELATED')),
  primary key (event_id, subject_type, subject_id)
);
create index event_subjects_lookup_idx
  on core.event_subjects (tenant_id, subject_type, subject_id, event_id);
```

`app.emit_event()` always writes the aggregate as a `SUBJECT` row and any
`p_related` entries as `RELATED`.

### 1.3 `app.emit_event()` — the only write path

Every state change calls this in its own transaction. Nothing else inserts into
`core.events`.

```sql
create or replace function app.emit_event(
  p_tenant_id       uuid,
  p_type            text,
  p_aggregate_type  text,
  p_aggregate_id    uuid,
  p_aggregate_ref   text,
  p_payload         jsonb,
  p_summary         text,
  p_actor           jsonb,
  p_correlation_id  uuid    default null,
  p_causation_id    uuid    default null,
  p_run_id          uuid    default null,
  p_idempotency_key text    default null,
  p_related         jsonb   default '[]'::jsonb   -- [{ "type": "ORGANISATION", "id": "…" }]
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_corr     uuid;
begin
  v_corr := coalesce(p_correlation_id, gen_random_uuid());

  insert into core.events (
    tenant_id, type, aggregate_type, aggregate_id, aggregate_ref,
    payload, summary, actor, correlation_id, causation_id, run_id, idempotency_key
  ) values (
    p_tenant_id, p_type, p_aggregate_type, p_aggregate_id, p_aggregate_ref,
    coalesce(p_payload, '{}'::jsonb), p_summary, p_actor,
    v_corr, p_causation_id, p_run_id, p_idempotency_key
  )
  on conflict (tenant_id, idempotency_key) where idempotency_key is not null
  do nothing
  returning id into v_event_id;

  -- replay of a seen key: return the original id, enqueue nothing
  if v_event_id is null then
    select id into v_event_id
      from core.events
     where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
    return v_event_id;
  end if;

  insert into core.event_subjects (event_id, tenant_id, subject_type, subject_id, role)
  values (v_event_id, p_tenant_id, p_aggregate_type, p_aggregate_id, 'SUBJECT')
  on conflict do nothing;

  insert into core.event_subjects (event_id, tenant_id, subject_type, subject_id, role)
  select v_event_id, p_tenant_id, r->>'type', (r->>'id')::uuid, 'RELATED'
    from jsonb_array_elements(p_related) r
  on conflict do nothing;

  -- transactional outbox: subscriptions become jobs in this same transaction
  insert into app.outbox (
    tenant_id, job_type, priority, payload,
    event_id, run_id, correlation_id, job_key, run_after
  )
  select p_tenant_id, s.job_type, s.priority,
         coalesce(p_payload, '{}'::jsonb)
           || jsonb_build_object('eventType', p_type,
                                 'aggregateRef', p_aggregate_ref,
                                 'aggregateId', p_aggregate_id),
         v_event_id, p_run_id, v_corr,
         'event:' || v_event_id::text || ':' || s.job_type,
         now() + coalesce(s.delay, interval '0')
    from app.event_subscriptions s
   where s.event_type = p_type
     and s.enabled
     and (s.tenant_id is null or s.tenant_id = p_tenant_id)
  on conflict (tenant_id, job_key) where job_key is not null do nothing;

  return v_event_id;
end $$;

revoke execute on function app.emit_event from public, anon, authenticated;
```

The `on conflict … do nothing` plus the follow-up select is what makes replay of an
`Idempotency-Key` return the original event and enqueue **no** duplicate jobs. That is the
single most important line in this document.

#### The three-argument overload

`03-action-envelope-and-policy-gate.md` calls `app.emit_event(tenant_id, event_name,
action_request_id)` from `app.apply_effects` and `app.decide_approval`. That is a better
call site than making the action envelope assemble twelve arguments it would only be
re-deriving from a row it already holds, so it is supported as an overload rather than
corrected. Postgres resolves the two by arity.

```sql
create or replace function app.emit_event(
  p_tenant_id         uuid,
  p_type              text,
  p_action_request_id uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r core.action_requests%rowtype;
begin
  select * into r from core.action_requests where id = p_action_request_id;
  if not found then
    raise exception 'action request % not found', p_action_request_id
      using errcode = 'P0002';
  end if;

  return app.emit_event(
    p_tenant_id       => p_tenant_id,
    p_type            => p_type,
    p_aggregate_type  => app.aggregate_type_for(r.action_type),
    p_aggregate_id    => r.target_id,
    p_aggregate_ref   => r.target_ref,
    p_payload         => app.event_payload_for(r),
    p_summary         => app.event_summary_for(r, p_type),
    p_actor           => jsonb_build_object('kind', r.requested_by_kind,
                                            'id',   r.requested_by_id,
                                            'name', r.requested_by_name),
    p_correlation_id  => r.id,                    -- the action request IS the correlation
    p_run_id          => r.agent_run_id,
    p_idempotency_key => 'action:' || r.id::text || ':' || p_type
  );
end $$;
```

Three consequences worth stating, because they are load-bearing for the seam:

- **`correlation_id` is `action_requests.id`**, set here rather than passed. Every event
  descending from one action therefore shares it without any caller having to remember to.
- **The idempotency key is derived**, `action:<id>:<EventName>`. Re-running
  `apply_effects` after a crash emits no second event, which is the same guarantee their
  `on conflict (tenant_id, job_key) do nothing` gives the outbox insert.
- **`app.event_payload_for` and `app.event_summary_for` are mine to write**, one branch per
  event type, and they are where the §14 payload shapes are actually enforced. They pair
  with `app.event_name_for(action_type)`, which `sb-actions` already has.

### 1.4 `app.event_subscriptions` — event → job routing

```sql
create table app.event_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null,
  job_type    text not null,
  tenant_id   uuid,                         -- null = every tenant
  priority    smallint not null default 5,
  delay       interval not null default interval '0',
  enabled     boolean not null default true,
  note        text,
  unique (event_type, job_type, tenant_id)
);
```

Routing is data, not code, so adding a side effect to an event is an insert rather than a
deploy. `delay` is what schedules an SLA escalation: the `ApprovalRequested` →
`APPROVAL_SLA_ESCALATE` subscription carries the policy's `escalateAfterMinutes`.

### 1.5 Delivery guarantee

**At-least-once, consumers must be idempotent.** There is no exactly-once mode and none is
offered.

- The event row and its jobs commit together. If the business transaction rolls back,
  neither exists. There is no window where a side effect is enqueued for a change that
  did not happen.
- A job can be delivered to a worker more than once: the lease can expire while the
  worker is still alive but slow, and the cron tick will re-queue it.
- Therefore every handler must be idempotent on `job.id` **and** on its own external
  effect. `SEND_EMAIL` writes the provider message id back before acknowledging;
  `PUSH_INVOICE` passes `job.id` as the accounting package's idempotency key.
- Ordering is **per correlation, not global**. Two jobs from the same event may complete
  out of order. Where order matters (invoice push before payment record), it is expressed
  as a chain — the second job is enqueued by the first job's completion event, never
  scheduled alongside it.
- `events.seq` gives a total order for reading. It is not a delivery guarantee.

### 1.6 The §14 catalogue

All events carry the envelope `{ eventId, occurredAt, tenantId, actor, correlationId,
causationId }` in addition to the payload below. `Agg` is `aggregate_type`.

| Event | Agg | Emitted by | Payload | Jobs enqueued |
|---|---|---|---|---|
| `EnquiryReceived` | ENQUIRY | `webhook-email`, `webhook-whatsapp` | `{ enquiryRef, channel, from, receivedAt }` | `ENQUIRY_CLASSIFY` |
| `EnquiryClassified` | ENQUIRY | run finaliser | `{ enquiryRef, label, confidence, agentId, runId }` | — (broadcast only) |
| `OpportunityCreated` | OPPORTUNITY | `POST /actions` `OPPORTUNITY_CONVERT` | `{ opportunityRef, organisationRef, value, sourceEnquiryRef }` | — |
| `TNACompleted` | TNA | `POST /public/tnas/{token}/submit` | `{ tnaRef, opportunityRef, completedBy, completedAt }` | `LLM_RUN` (recommendations) |
| `ProposalDrafted` | PROPOSAL | `POST /proposals`, section regenerate | `{ proposalRef, templateId, agentId, runId, value }` | `PROPOSAL_PDF_RENDER` |
| `ApprovalRequested` | APPROVAL | `POST /actions` when policy routes | `{ approvalRef, policyId, actionType, targetRef, value, approverRole, slaDueAt }` | `APPROVAL_SLA_ESCALATE` (delayed) |
| `ApprovalDecided` | APPROVAL | `POST /approvals/{id}/decide` | `{ approvalRef, decision, decidedBy, decidedAt, effects[] }` | — (sampling is a cron sweep, not a subscription — see §9) |
| `ProposalSent` | PROPOSAL | approval effect / direct execute | `{ proposalRef, channel, to, sentAt }` | `SEND_EMAIL` \| `SEND_WHATSAPP` |
| `ProposalAccepted` | PROPOSAL | `POST /public/proposals/{token}/accept` | `{ proposalRef, acceptedBy, acceptedAt, engagementRef }` | `SEND_EMAIL` (internal notify) |
| `EngagementCreated` | ENGAGEMENT | proposal acceptance | `{ engagementRef, organisationRef, programmeRef, dates }` | `COMPLIANCE_CHECK_EVALUATE` |
| `AttendanceLocked` | ENGAGEMENT | `POST /actions` `ATTENDANCE_APPROVE` | `{ engagementRef, day, approvedBy, approvedAt, present, total }` | `HRDC_PACKET_ASSEMBLE` |
| `HRDCPacketReady` | HRDC_PACKET | completeness hits 1.0 | `{ engagementRef, scheme, claimValue, deadlineAt }` | — (badge + broadcast) |
| `HRDCPacketSubmitted` | HRDC_PACKET | `POST /actions` `HRDC_PACKET_MARK_SUBMITTED` | `{ engagementRef, reference, submittedBy, submittedAt }` | `COMPLIANCE_CHECK_EVALUATE` |
| `InvoicePushed` | INVOICE | `POST /actions` `INVOICE_CREATE` / `INVOICE_PUSH` | `{ invoiceRef, provider, documentId, at }` | `PUSH_INVOICE` |
| `InvoiceValidated` | INVOICE | `POST /webhooks/accounting` | `{ invoiceRef, uin, at }` | — (broadcast only) |
| `ReminderDrafted` | INVOICE | run finaliser | `{ invoiceRef, stage, channel, estimatedCost, agentId, runId }` | — |
| `AgentRunCompleted` | RUN | run finaliser | `{ runId, agentId, status, durationMs, cost, outcome }` | `USAGE_ROLLUP` |
| `AgentRunFailed` | RUN | run finaliser | `{ runId, agentId, failureCode, attempts, deadLettered }` | — (badge + broadcast) |
| `TierDegraded` / `TierRecovered` | AI_TIER | provider health monitor | `{ tier, reason, activeFallback, at }` | — |
| `BudgetCapTripped` | AI_BUDGET | usage accounting | `{ scope, key, cap, spend, pausedActionTypes[] }` | — |
| `ProviderKeyInvalid` | AI_PROVIDER | key probe | `{ providerId, since, affectedTiers[], activeFallback }` | — |
| `ProviderKeyRevealed` | AI_PROVIDER | reveal endpoint | `{ providerId, actor, at }` | — (audit only) |
| `SourceChanged` | KNOWLEDGE_SOURCE | corpus monitor | `{ sourceId, oldHash, newHash, detectedAt }` | `RULE_CHANGE_EXTRACT` |
| `RuleChangeProposed` | RULE_CHANGE | ingestion | `{ documentId, changeCount, extractedBy, affectedEngagementCount }` | — |
| `RuleChangeApproved` | COMPLIANCE_RULE | `RULE_CHANGE_APPROVE` | `{ ruleId, op, effectiveFrom, approvedBy }` | `COMPLIANCE_CHECK_EVALUATE` (affected engagements) |
| `ComplianceCheckFailed` | ENGAGEMENT | check evaluation | `{ engagementRef, checkKey, ruleId, computed }` | — (sets `HRDC_CLAIM` step to BLOCKED) |
| `AgentEscalated` | RUN | run engine | `{ runId, node, fromTier, toTier, confidence }` | — |
| `JuryDisagreed` | RUN | run engine, or `JURY_SAMPLE` job | `{ runId, quorum, of, dissenters[] }` | `EVAL_RUN` (drift) |

### 1.7 Catalogue gaps — proposed additions

§3 defines 19 action types and §17 adds two more. Most execute without emitting anything
in the §14 catalogue, so the audit drawer has no row for them and the outbox has nothing
to subscribe to. These are **proposed additions**, not silent implementations; they need
contract sign-off.

`sb-actions` independently proposed a near-identical list from the action side and holds
`app.event_name_for(action_type)`. The table below is the **merged** list — theirs plus
three they did not have (`ActionRequested`, `ApprovalExpired`, `AgentResumed`) — and it
should be the one list both lanes implement. Where we differed, theirs is taken:

- **`InvoicePushed` splits.** §14 has one event for both `INVOICE_CREATE` and
  `INVOICE_PUSH`. `sb-actions` emits `InvoiceCreated` for the first and keeps
  `InvoicePushed` for the second. Correct: creating a draft invoice and pushing it to the
  accounting package are different facts with different reversibility, and the collections
  screen needs to tell them apart.
- **`HRDCPacketVoided` is a separate event**, not a `claimVoided: true` flag on
  `AttendanceUnlocked` as I had it. Better: voiding a submitted claim is its own fact with
  its own audit row, and burying it in a boolean on another event is how it goes unnoticed.
- **`BudgetCapRaised`** for `BUDGET_CAP_RAISE`, which I had missed entirely. §17 has
  `BudgetCapTripped` for the automatic trip but nothing for the approved raise.

| Proposed event | Agg | Emitted by | Payload |
|---|---|---|---|
| `ActionRequested` | ACTION | `POST /actions` (§3 names it but §14 omits it) | `{ actionRef, type, targetRef, requestedBy, confidence, status }` |
| `InvoiceCreated` | INVOICE | `INVOICE_CREATE` (split from `InvoicePushed`) | `{ invoiceRef, total, lines, rateCardVersion, createdBy }` |
| `HRDCPacketVoided` | HRDC_PACKET | `ATTENDANCE_UNLOCK` on a submitted packet | `{ engagementRef, packetRef, claimReference, reason, voidedBy }` |
| `BudgetCapRaised` | AI_BUDGET | `BUDGET_CAP_RAISE` | `{ scope, key, from, to, approvedBy, effectiveFrom }` |
| `EnquiryArchived` | ENQUIRY | `ENQUIRY_ARCHIVE` | `{ enquiryRef, reason, archivedBy }` |
| `TNARecommendationAccepted` | TNA | `TNA_RECOMMENDATION_ACCEPT` | `{ tnaRef, programmeRef, acceptedBy, confidence }` |
| `QuotationApplied` | QUOTATION | `QUOTATION_APPLY` | `{ quotationRef, proposalRef, total, rateCardVersion }` |
| `DiscountApproved` | QUOTATION | `DISCOUNT_APPROVE` | `{ quotationRef, pct, resultingMargin, floorPrice, approvedBy }` |
| `TrainerBooked` | ENGAGEMENT | `TRAINER_BOOK` | `{ engagementRef, trainerRef, dates, dayRate }` |
| `EngagementClosedOut` | ENGAGEMENT | `ENGAGEMENT_CLOSE_OUT` | `{ engagementRef, closedBy, closedAt }` |
| `AttendanceUnlocked` | ENGAGEMENT | `ATTENDANCE_UNLOCK` | `{ engagementRef, day, reason, unlockedBy }` |
| `PaymentRecorded` | INVOICE | `PAYMENT_RECORD` | `{ invoiceRef, amount, method, receivedAt, balance }` |
| `ReminderSent` | INVOICE | `REMINDER_SEND` | `{ invoiceRef, stage, channel, sentAt, cost }` |
| `FollowUpSent` | OPPORTUNITY | `FOLLOWUP_SEND` | `{ followUpRef, contactRef, channel, sentAt }` |
| `BroadcastSent` | BROADCAST | `BROADCAST_SEND` | `{ broadcastRef, audienceSize, channel, templateId, cost }` |
| `AgentAutonomyChanged` | AGENT | `AGENT_AUTONOMY_CHANGE` | `{ agentId, actionType, from, to, changedBy, ceilingReason }` |
| `AgentPaused` / `AgentResumed` | AGENT | `AGENT_PAUSE` | `{ agentId, actionType, reason, pausedBy, resumeCondition }` |
| `ApprovalExpired` | APPROVAL | expiry job, **only if §16 Q1 resolves to expire** | `{ approvalRef, policyId, expiredAt, originalSlaDueAt }` |

`HRDCPacketVoided` exists because §16 Q5 asks whether unlock should be refused once a
claim reference exists. Whichever way that question resolves, voiding a submitted claim
needs its own event carrying the claim reference: it is the single most consequential
reversible action in the system, and it must be legible in the drawer without reading a
flag on a different event about a different aggregate.

---

## 2 · Outbox and jobs

### 2.1 pgmq vs a job table

`docs/research/08-supabase-agentic-best-practices.md` §4 recommends `pgmq` as the durable
internal outbox, enqueued in the same transaction as the domain write and drained by a
worker. This section **agrees with everything in that recommendation except the storage
engine**, and says why.

**Where we agree, and it is most of it.**

| Research §4 | This document | Where |
|---|---|---|
| Enqueue inside the same transaction as the domain write; no dual write | Same, in `app.emit_event` and `app.apply_effects` | §1.3, §2.7 |
| At-least-once, consumers idempotent by event id, regardless of which Supabase page is authoritative on "exactly-once" | Stated as the guarantee, with no exactly-once mode offered | §1.5 |
| Broadcast, not Postgres Changes | Same | §3.1 |
| `pg_net` is an async HTTP primitive, not a queue: unlogged response table, ~6h retention, ~200 req/s, no retry | Same, and it is why the nudge is an optimisation and the cron tick is the guarantee | §2.6 |
| Database Webhooks are fire-and-forget with no delivery guarantee, wrong for outbox semantics | Not used anywhere in this design | §2.6 |
| Realtime Authorization: `private: true` plus RLS on `realtime.messages`, channels named by tenant | Same | §3.4 |
| `pgmq.pop()` is effectively at-most-once — avoid it | Not used | — |

The research doc's own layering makes the remaining disagreement narrow. It says to fan
out "via `pg_net`/HTTP with your own retry/dead-letter logic built on pgmq's
re-`send`-on-failure". The retry ledger, the dead-letter store and the attempt counter are
therefore a table we write either way. The only question is whether that table sits
*beside* the queue or *is* the queue.

**Why the ledger should be the queue.** In TrainOS the job list is not infrastructure, it
is a screen. `GET /badges` counts `agentFailures`; `POST /runs/{id}/dead-letter` takes a
human-supplied reason and actor; `POST /runs/{id}/retry?from=checkpoint` re-enqueues with
a modified payload and a lineage link. Those are tenant-scoped queries and writes against
job state. Splitting them across `pgmq.q_*` for transport and a second table for state
means two rows per job that can disagree, and a disagreement there is an approval that the
UI shows as sent and the queue still holds.

The five specifics, against `pgmq` as it is documented:

1. **No tenant column.** `pgmq.q_<name>` is `(msg_id, read_ct, enqueued_at, vt, message
   jsonb)`. Every badge count becomes a jsonb expression scan, repeated across one queue
   table per job type.
2. **No dead-letter primitive.** A DLQ is a second queue plus a move when `read_ct > n`,
   and it cannot carry `reason`, `dead_lettered_by` or `replayed_job_id`.
3. **Backoff is read-coupled.** `pgmq.set_vt()` adjusts visibility only after a read, so a
   job that fails fast burns attempts at read cadence. An explicit `run_after` is
   inspectable and testable.
4. **Scheduled work is invisible.** `pgmq.send(delay)` can hide an SLA escalation until
   `slaDueAt`, but the queue cannot then answer "which escalations are pending for this
   tenant", which M02-S01 asks.
5. **`read_ct` is a read count, not an attempt count.** A worker that dies before reporting
   and one that reported a failure are indistinguishable.

**What we keep from pgmq's design.** The mechanism this document implements is the same
mechanism: a visibility timeout (`visible_after`), a reaper that returns expired leases,
and `FOR UPDATE … SKIP LOCKED` for the claim. `pgmq` implements that correctly inside
`pgmq.read`; §2.5 implements it in about sixty lines. That is the honest size of what is
being rewritten, and §2.1's switch condition says when to stop rewriting it.

**When to switch.** If sustained enqueue exceeds roughly a few thousand jobs per minute,
or if nobody wants to own the reaper, move transport to `pgmq` and keep `app.outbox` as a
projection written by the handler. Below that, one table is less machinery, not more.

This is a **documented disagreement with the research doc**, not an oversight. If the
research doc is treated as binding, the change is mechanical: `claim_jobs` becomes
`pgmq.read`, `fail_job` becomes `pgmq.set_vt` plus a move to a `dead` queue, and
`app.outbox` keeps every column in §2.2 as the projection.

Two operational notes if `pgmq` is adopted: its tables have no RLS by default, and the
`pgmq_public` wrapper schema exists only to expose queue operations to browser clients
over PostgREST. TrainOS workers hold the service role, so that schema should stay
unexposed.

### 2.2 `app.outbox`

```sql
create table app.outbox (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,

  job_type           text not null,
  state              text not null default 'QUEUED'
                       check (state in ('QUEUED','CLAIMED','SUCCEEDED','FAILED','DEAD','CANCELLED')),
  priority           smallint not null default 5 check (priority between 1 and 9),
  payload            jsonb not null default '{}'::jsonb,

  -- provenance
  event_id           uuid references core.events(id) on delete set null,
  run_id             uuid references core.runs(id) on delete set null,
  action_request_id  uuid,                    -- seam to sb-actions, see §2.7
  correlation_id     uuid not null,
  idempotency_key    text,                    -- effects: '<action_request_id>:<seq>'

  -- scheduling and lease
  run_after          timestamptz not null default now(),
  claimed_at         timestamptz,
  claimed_by         text,                    -- worker instance id
  visible_after      timestamptz,             -- lease expiry
  attempts           int not null default 0,
  max_attempts       int not null default 5,

  -- outcome
  result             jsonb,
  last_error         jsonb,                   -- { code, message, retryable, at }

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  finished_at        timestamptz
);
```

`priority` is a band, not a number a caller tunes: `1` interactive (the user is watching),
`5` normal, `9` batch (off-peak tiers, §17 `allowedHours`).

**Indexes.** Every one of these is partial, because a healthy queue is nearly empty and a
full index on a table whose rows are 99% `SUCCEEDED` is wasted write amplification.

```sql
-- the claim (the only index on the hot path)
create index outbox_claim_idx on app.outbox (priority, run_after, id)
  where state = 'QUEUED';

-- the lease reaper
create index outbox_lease_idx on app.outbox (visible_after)
  where state = 'CLAIMED';

-- badge counts and the failure list
create index outbox_failed_idx on app.outbox (tenant_id, finished_at desc)
  where state in ('FAILED','DEAD');

-- dedupe
create unique index outbox_idempotency_idx on app.outbox (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- foreign keys (Postgres does not index these for you)
create index outbox_run_idx on app.outbox (run_id) where run_id is not null;
create index outbox_event_idx on app.outbox (event_id) where event_id is not null;
create index outbox_action_idx on app.outbox (action_request_id) where action_request_id is not null;
```

**RLS.** Workers hold the service role and bypass RLS, but the table is still locked down,
three ways:

```sql
alter table app.outbox enable row level security;
alter table app.outbox force  row level security;   -- removes the owner's exemption
-- and no policies at all
```

Zero policies denies `authenticated` as well as `anon`, not just `anon` — so a leaked
publishable key **and** a logged-in user both read nothing. `force row level security`
additionally removes the table owner's exemption, so a `security definer` function running
as `postgres` cannot read it either. `service_role` still bypasses, which is the intent.
Schema `app` also stays out of the PostgREST exposed-schema list.

**Every service-role write goes through a named function that takes `p_tenant_id`
explicitly and validates it.** On the worker path, tenant isolation is a code invariant
rather than a policy — nothing stops a handler from writing the wrong tenant's row — so it
needs a named choke point and a test. `app.claim_jobs`, `app.complete_job`,
`app.fail_job`, `app.heartbeat_job` and `app.reap_jobs` are that set, and handlers call
nothing else. This is `sb-tenancy`'s requirement and §8.7 tests it.

**Expect a Security Advisor finding here.** Supabase's advisor flags "RLS enabled with no
policies" as locking out access entirely. On `app.outbox`, `app.dead_letters`,
`app.webhook_deliveries` and `app.webhook_routes` that is the intended posture, not a
defect. Record these four as accepted findings so nobody closes the advisor by adding a
permissive policy.

### 2.3 Job types

| Job type | Triggered by | Priority | Max attempts | Notes |
|---|---|---|---|---|
| `ENQUIRY_CLASSIFY` | `EnquiryReceived` | 1 | 5 | Wraps an `LLM_RUN`; emits `EnquiryClassified` |
| `LLM_RUN` | several events; also direct | 1–5 | 3 | Yields at ~300s via a checkpoint and re-enqueues; never holds a lease past the 400s worker lifetime (§2.6) |
| `SEND_EMAIL` | `ProposalSent`, `FollowUpSent`, `ReminderSent` | 1 | 5 | Provider message id written back before ack |
| `SEND_WHATSAPP` | same, channel `WHATSAPP` | 1 | 5 | Template + `MessageCategory`; cost metered |
| `PROPOSAL_PDF_RENDER` | `ProposalDrafted` | 5 | 3 | Writes to Storage, returns a signed path |
| `PUSH_INVOICE` | `InvoicePushed` | 1 | 5 | Accounting package / MyInvois; `job.id` is the provider idempotency key |
| `HRDC_PACKET_ASSEMBLE` | `AttendanceLocked`, document upload | 5 | 3 | Emits `HRDCPacketReady` at completeness 1.0 |
| `COMPLIANCE_CHECK_EVALUATE` | `EngagementCreated`, every stage transition, `RuleChangeApproved` | 5 | 3 | Produces `versionDrift` per §18 |
| `APPROVAL_SLA_ESCALATE` | `ApprovalRequested`, delayed to `escalateAfterMinutes` | 5 | 2 | No-op if already decided |
| `JURY_SAMPLE` | `app.enqueue_jury_samples()` cron, 5-minutely, 5% of decided (§18 SAMPLE mode) | 9 | 2 | Asynchronous, never blocks; may emit `JuryDisagreed` |
| `EVAL_RUN` | promotion request (§18 GATE mode), `JuryDisagreed` | 9 | 2 | Golden set, 50–100 items |
| `RULE_CHANGE_EXTRACT` | `SourceChanged` | 9 | 3 | Emits `RuleChangeProposed`; withholds changes below 0.80 confidence |
| `KNOWLEDGE_REINGEST` | `POST /knowledge/sources/{id}/reingest` | 9 | 3 | Chunk + embed |
| `SOURCE_MONITOR_CHECK` | cron, daily | 9 | 2 | Content hash diff; emits `SourceChanged` |
| `HRDC_DEADLINE_SCAN` | cron, hourly | 9 | 2 | Broadcasts `hrdc.deadline.warning`, updates badges |
| `USAGE_ROLLUP` | `AgentRunCompleted`; cron hourly backstop | 9 | 3 | Feeds `/ai/usage`; may emit `BudgetCapTripped` |
| `RETENTION_REDACT` | cron, daily 03:00 MYT | 9 | 2 | §6.6 |
| `WHATSAPP_RATE_REFRESH` | cron, per §16 Q4 TTL | 9 | 2 | Cached BSP rate card |
| `JURY_EVALUATE` | `app.apply_effects`, topic `jury.evaluate` (§18 `ESCALATE` mode) | 1 | 2 | Blocking jury; the action waits on it |
| `AUTH_SIGN_OUT` | membership or role change (`sb-tenancy` §7.4) | 1 | 5 | Calls `auth.admin.signOut` for the affected user. The application role rides in the JWT claim, so a revoked membership is not revoked until the token is. Priority 1 is a security property, not a nicety. |

### 2.4 State machine

```
                        ┌────────────── run_after reached ──────────────┐
                        │                                               │
  emit_event ──► QUEUED ─── claim_jobs ──► CLAIMED ──► complete_job ──► SUCCEEDED
                    ▲                         │
                    │                         ├── fail_job, attempts < max ──► FAILED
                    │                         │        (run_after = backoff)
                    └─────────────────────────┘
                    │                         │
                    │                         └── fail_job, attempts >= max ──► DEAD
                    │                                     + app.dead_letters row
                    │                                     + AgentRunFailed / job.dead event
                    │
                    └──── reap_leases: visible_after < now() ────┘
```

`FAILED` is a transient, retryable state that returns to `QUEUED` when `run_after`
arrives; `DEAD` is terminal and requires a human or a replay. `CANCELLED` exists for
`POST /agents/{id}/pause`, which must stop queued work for that agent without dead-lettering
it.

**Backoff.** Exponential with full jitter, capped at one hour:

```sql
run_after := now()
  + least(interval '1 hour',
          (interval '10 seconds' * power(2, least(attempts, 8)))
          * (0.5 + random() * 0.5));
```

Jitter matters because a provider outage fails every in-flight `SEND_EMAIL` at once, and
without it they all retry in the same second.

### 2.5 Claim, heartbeat, complete, fail, reap

```sql
-- claim a batch, atomically, without workers blocking each other
create or replace function app.claim_jobs(
  p_worker text,
  p_types  text[] default null,
  p_limit  int    default 10,
  p_lease  interval default interval '5 minutes'
) returns setof app.outbox
language sql
security definer
set search_path = ''
as $$
  update app.outbox j
     set state         = 'CLAIMED',
         claimed_at    = now(),
         claimed_by    = p_worker,
         visible_after = now() + p_lease,
         attempts      = j.attempts + 1,
         updated_at    = now()
   where j.id in (
     select id
       from app.outbox
      where state = 'QUEUED'
        and run_after <= now()
        and (p_types is null or job_type = any(p_types))
      order by priority, run_after
      limit p_limit
      for update skip locked
   )
  returning j.*;
$$;
```

`FOR UPDATE SKIP LOCKED` is the whole trick: two workers claiming simultaneously take
disjoint batches instead of serialising. `attempts` increments at claim time, not at
failure time, so a worker that dies without reporting still burns an attempt and cannot
loop forever.

```sql
-- a long job extends its own lease rather than being reaped mid-flight
create or replace function app.heartbeat_job(p_job_id uuid, p_extend interval default interval '5 minutes')
returns void language sql security definer set search_path = '' as $$
  update app.outbox set visible_after = now() + p_extend, updated_at = now()
   where id = p_job_id and state = 'CLAIMED';
$$;
```

```sql
-- success: mark done, append the result event, and tell sb-actions
create or replace function app.complete_job(
  p_job_id  uuid,
  p_result  jsonb default '{}'::jsonb,
  p_event   jsonb default null   -- { type, aggregateType, aggregateId, aggregateRef, payload, summary, actor }
) returns void
language plpgsql security definer set search_path = ''
as $$
declare j app.outbox;
begin
  update app.outbox
     set state = 'SUCCEEDED', result = p_result,
         finished_at = now(), updated_at = now(), last_error = null
   where id = p_job_id and state = 'CLAIMED'
  returning * into j;

  if not found then
    raise exception 'job % is not claimed', p_job_id using errcode = '55000';
  end if;

  if p_event is not null then
    perform app.emit_event(
      j.tenant_id,
      p_event->>'type',
      p_event->>'aggregateType',
      (p_event->>'aggregateId')::uuid,
      p_event->>'aggregateRef',
      coalesce(p_event->'payload', '{}'::jsonb),
      p_event->>'summary',
      coalesce(p_event->'actor', jsonb_build_object('kind','SYSTEM','id','worker','name','Worker')),
      j.correlation_id,
      j.event_id,
      j.run_id,
      'job:' || j.id::text            -- completion is idempotent on the job id
    );
  end if;

  if j.idempotency_key is not null and j.action_request_id is not null then
    -- owned by sb-actions (§2.7); workers never write core tables directly
    perform app.settle_effect(j.idempotency_key, 'SETTLED', p_result, null);
  end if;
end $$;
```

```sql
-- failure: retry with backoff, or dead-letter
create or replace function app.fail_job(p_job_id uuid, p_error jsonb, p_retryable boolean default true)
returns text
language plpgsql security definer set search_path = ''
as $$
declare j app.outbox; v_state text;
begin
  select * into j from app.outbox where id = p_job_id for update;

  if j.attempts >= j.max_attempts or not p_retryable then
    v_state := 'DEAD';
    update app.outbox
       set state = 'DEAD', last_error = p_error, finished_at = now(), updated_at = now()
     where id = p_job_id;

    insert into app.dead_letters (
      tenant_id, origin, origin_id, job_type, reason, payload, last_error, attempts, dead_lettered_by
    ) values (
      j.tenant_id, 'JOB', j.id, j.job_type,
      coalesce(p_error->>'code', 'RETRIES_EXHAUSTED'),
      j.payload, p_error, j.attempts,
      jsonb_build_object('kind','SYSTEM','id','worker','name','Worker')
    );

    -- an action's external effect must not sit at DISPATCHED forever (§2.7)
    if j.idempotency_key is not null and j.action_request_id is not null then
      perform app.settle_effect(j.idempotency_key, 'DEAD_LETTERED', null, p_error);
    end if;
  else
    v_state := 'FAILED';
    update app.outbox
       set state = 'FAILED', last_error = p_error, updated_at = now(),
           run_after = now() + least(
             interval '1 hour',
             (interval '10 seconds' * power(2, least(j.attempts, 8))) * (0.5 + random() * 0.5))
     where id = p_job_id;
  end if;

  return v_state;
end $$;
```

`FAILED` rows return to the claim index because `outbox_claim_idx` covers `state = 'QUEUED'`
only — so the reaper is what moves them back:

```sql
-- every minute: expired leases and elapsed backoff both return to QUEUED
create or replace function app.reap_jobs() returns int
language sql security definer set search_path = '' as $$
  with reaped as (
    update app.outbox
       set state = 'QUEUED', claimed_by = null, claimed_at = null,
           visible_after = null, updated_at = now()
     where (state = 'CLAIMED' and visible_after < now())
        or (state = 'FAILED'  and run_after   <= now())
    returning 1
  ) select count(*)::int from reaped;
$$;
```

### 2.6 The worker

One edge function, `job-worker`, with a handler registry keyed by `job_type`. One function
rather than one per type, because the claim, lease, heartbeat, backoff and error mapping
are identical for all of them and duplicating them across fifteen functions is how they
drift.

```ts
// supabase/functions/job-worker/index.ts  (shape only — implementation is out of lane)
const HANDLERS: Record<string, (job: Job) => Promise<Result>> = {
  SEND_EMAIL: sendEmail,
  SEND_WHATSAPP: sendWhatsapp,
  PUSH_INVOICE: pushInvoice,
  LLM_RUN: llmRun,
  // …
};

Deno.serve(async (req) => {
  const { types, limit = 10 } = await req.json();
  const { data: jobs } = await db.rpc("claim_jobs", {
    p_worker: WORKER_ID, p_types: types, p_limit: limit,
    p_lease: "6 minutes",          // > the 400s worker lifetime, never more
  });

  // return immediately; keep processing after the response
  EdgeRuntime.waitUntil(Promise.all(jobs.map(runOne)));
  return Response.json({ claimed: jobs.length });
});

async function runOne(job: Job) {
  const beat = setInterval(() => db.rpc("heartbeat_job", { p_job_id: job.id }), 60_000);
  try {
    const result = await HANDLERS[job.job_type](job);
    await db.rpc("complete_job", { p_job_id: job.id, p_result: result, p_event: result.event });
  } catch (e) {
    await db.rpc("fail_job", {
      p_job_id: job.id,
      p_error: { code: e.code ?? "HANDLER_ERROR", message: String(e.message), at: new Date() },
      p_retryable: e.retryable !== false,
    });
  } finally {
    clearInterval(beat);
  }
}
```

**No handler may run longer than the worker lives.** Research doc §4 and §9 correct an
assumption I had made and it is worth stating plainly, because getting it wrong produces a
queue that looks healthy and silently redelivers forever:

| Edge Function limit | Value |
|---|---|
| Wall-clock worker lifetime | 150s free, **400s paid** |
| CPU time per request | 2s, excluding async I/O wait |
| Memory | 256 MB |

`EdgeRuntime.waitUntil` does **not** buy a longer budget. Background tasks share the same
wall clock as the request that started them, and the worker is killed when any limit is
hit. So there is no such thing as a fifteen-minute job.

Three constraints follow:

- **The lease is bounded by the worker lifetime, not by the handler's ambition.** Six
  minutes, slightly above the 400s ceiling, so a worker killed at the wall clock has its
  job reaped shortly after rather than immediately re-claimed while it is still finishing.
  The heartbeat extends within that window; it cannot extend past death.
- **A long handler yields instead of holding.** `LLM_RUN` runs to roughly 300s, writes a
  checkpoint (§6.5), re-enqueues itself with `run_after = now()` and returns. The next
  tick resumes from the checkpoint. This is the same machinery as
  `POST /runs/{id}/retry?from=checkpoint`, which is why that machinery is not optional
  extra credit — it is what makes agent runs possible on this runtime at all. A run that
  cannot checkpoint cannot exceed 400s, full stop.
- **Handlers are idempotent.** `complete_job` passes `'job:' || job.id` as the event
  idempotency key, so a re-delivered job that already finished writes no second event.
  External effects need the same discipline: pass `job.id` to the provider as its
  idempotency key.
- **The worker runs as the service role and must scope every query by `job.tenant_id`
  explicitly.** RLS is not protecting it (§2.2).

Two deployment details that are easy to miss and expensive to debug:

- **Pin the worker to the database region.** Functions run by default in the region
  nearest the caller; a worker makes many round trips per job (claim, heartbeat, complete,
  emit). Pin with `FunctionRegion` or the `x-region` header and verify with the
  `x-sb-edge-region` response header. This trades multi-region failover for latency, which
  is the right trade for a worker and the wrong one for a user-facing function.
- **Locally, `supabase/config.toml` needs `policy = "per_worker"`** or background tasks are
  killed the moment the response returns, and every job appears to succeed and do nothing.

**Scheduling.**

```sql
-- reliability floor: a tick every 10 seconds
select cron.schedule('jobs-tick-interactive', '10 seconds', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/job-worker',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body    := jsonb_build_object('limit', 25),
    timeout_milliseconds := 5000
  );
$$);

select cron.schedule('jobs-reap', '* * * * *', $$ select app.reap_jobs(); $$);
```

The service role key lives in Supabase Vault, never inline in the cron command —
`cron.job` is readable by anyone who can read the catalog.

**Stampede control.** The dispatcher takes a transaction-scoped advisory lock so an
overlapping tick becomes a no-op instead of a second claim wave:

```sql
if not pg_try_advisory_xact_lock(hashtext('jobs-tick')) then return; end if;
```

**Optional nudge.** For `priority = 1` only, an `AFTER INSERT` statement-level trigger on
`app.outbox` calls the same endpoint through `pg_net`. This is safe because `pg_net` does
not start the request until the transaction commits, so a rolled-back job never nudges.
It is an optimisation: if `pg_net` is saturated or the request is dropped, the 10-second
tick still picks the job up. `pg_net` is rated for about 200 requests/second and its
response table is unlogged, so it must never carry the guarantee.

### 2.7 The `sb-actions` seam

**Settled, per ruling R-WB.** One function each way, and the addressing question that took
three rounds is closed.

```
core.action_requests ──► app.emit_event(tenant, event_name, action_request_id)   [mine]
                    └──► insert into app.outbox …                          [sb-actions]
                                                     │
                                               job-worker
                                                     │
                         app.settle_effect(job_key, status, result, error)  [theirs]
                                                     └──► app.action_effects
```

**Addressing: `job_key`, not `effect_id`.** I proposed an `action_request_id`-addressed
write-back; `sb-actions` rightly objected that one action has N external effects that
succeed and fail independently, so a `PROPOSAL_SEND`'s PDF render and email send need
separate outcomes. I then proposed `effect_id`. The ruling settles on `job_key`, and it is
the better answer to their own objection: `job_key = '<action_request_id>:<seq>'` already
names exactly one effect, so it is as precise as `effect_id` while carrying the action and
the sequence in a value both lanes already construct. `effect_id` is withdrawn and is no
longer a column on `app.outbox`.

**Column names, and why there are two for one string.** `sb-actions` writes:

```sql
insert into app.outbox (tenant_id, job_type, idempotency_key, payload,
                        run_after, correlation_id, action_request_id)
...
on conflict (tenant_id, idempotency_key) do nothing;
```

The same string is `app.action_effects.job_key` on their table and
`app.outbox.idempotency_key` on mine — each lane naming the column it owns in its own
vocabulary, and `app.settle_effect`'s parameter named after the caller's. That is a
deliberate, documented equivalence rather than a drift, but it is still two names for one
value, so it is recorded as a deviation. If the critic wants one name, `job_key` is the
one to keep: on my table it is not a caller-supplied `Idempotency-Key` header, which is
what `core.events.idempotency_key` means, and reusing the word across those two meanings is
the more expensive confusion.

**Yes, both columns exist**, answering `sb-actions`' direct question: `correlation_id uuid
not null` and `action_request_id uuid` are in the §2.2 column list. `correlation_id` is
`not null` for every row on every path. `action_request_id` is nullable on the table because
event fan-out jobs have no action, and `not null` on the effect path by construction —
enforced by a check rather than by the column type:

```sql
alter table app.outbox add constraint outbox_effect_path_complete
  check (action_request_id is null or idempotency_key is not null);
```

Three enqueue paths, one table, one uniqueness rule:

| Path | Who enqueues | `idempotency_key` |
|---|---|---|
| External effect of an action | `app.apply_effects` | `<action_request_id>:<seq>` |
| Jury evaluation | `app.apply_effects` (an effect row of kind `EXTERNAL`) | `<action_request_id>:<seq>` |
| Fan-out from a domain event | `app.emit_event` via `app.event_subscriptions` | `event:<event_id>:<job_type>` |

`unique (tenant_id, idempotency_key)` is `sb-actions`' one hard requirement and it is on the
table in §2.2. It is the entire retry-safety story for external effects: a redelivered job
cannot send a second proposal email or push a second invoice.

**`app.job_type_for(action_type, entity)` is mine and does not exist yet.** `sb-actions`
flagged that without it they would have mapped their `topic` onto `job_type` mechanically
and shipped `'effect.proposal_send'` into a column the worker dispatches on. That would not
have failed loudly — it would have produced jobs no handler claims, which sit at `QUEUED`
until someone notices the badge. It is listed among the seven unwritten helpers.

**Status vocabulary, aligned to theirs.** `app.settle_effect` is called with `SETTLED` on
success and `DEAD_LETTERED` on terminal failure; their effect enum dropped `CONFIRMED` and
`FAILED` to match. `app.complete_job` and the dead-letter branch of `app.fail_job` are the
only two callers. A transient failure that will retry calls nothing — the effect stays
`DISPATCHED`, because it has not settled.

**The lifecycle hole is closed, and it was mine to notice and theirs to fix.** I had said
the write-back should advance `action_requests.status`; they correctly objected that
rolling a proposal back from `SENT` on a lost delivery acknowledgement would tell the sales
team it was never sent while the client is reading it. Their resolution (ruling R-STATUS)
is better than either of our first answers: the row gains `EXECUTING` and
`PARTIALLY_FAILED`, an action with an external effect commits as `EXECUTING`, and
`settle_effect` moves it to `EXECUTED` when the last effect settles clean or
`PARTIALLY_FAILED` when any dead-letters, stamping `completed_at` only then. An action with
no external effect — most of the 21 types — goes straight to `EXECUTED`. The `partial_failure`
boolean is gone.

Consequence worth carrying here: §12's `ActionStatus` has four values and none is
`EXECUTING`, so the row status and the response variant are now different things.
`POST /v1/actions` still returns `202 EXECUTED` at decision time and a fold function maps
the three execution states onto the three contract variants. Record screens render the row,
not the response. That is a contract deviation and `sb-actions` has recorded it; it matters
to me only because the audit drawer renders row states and must not be "corrected" to the
response vocabulary.

**Idempotency keys: reference the rule, not the table.** The raw key is
`app.idempotency_keys.key` with the 24h rule on `expires_at`, and
`core.action_requests.idempotency_key_id` is the foreign key. That table is in `app`, which
`config.toml` keeps out of PostgREST's exposed schemas, so `app.webhook_deliveries` cannot
read it over the Data API and does not try. It keeps its own row under the same 24h rule,
and 30 days for raw bodies (§5.5). Two tables, one rule, stated in both places.

Ownership, restated:

- `sb-actions` calls `app.emit_event` and writes its own `app.outbox` rows.
- **Workers never write `core` tables directly.** Every write-back goes through
  `app.settle_effect`, which runs a per-type confirm handler on success only — the sole
  place a worker's data reaches `core`. A worker holds the service role and bypasses RLS,
  so the set of tables it may touch has to be small and named.
- `core.action_requests.id` is the `correlation_id` for every event and job descending from
  that action, `ApprovalRequested` and `ApprovalDecided` included. `causation_id` is mine
  to derive.

### 2.8 Dead letters

```sql
create table app.dead_letters (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  origin            text not null check (origin in ('JOB','RUN','WEBHOOK')),
  origin_id         uuid not null,
  job_type          text,
  event_type        text,
  reason            text not null,
  payload           jsonb not null,
  last_error        jsonb,
  attempts          int not null default 0,
  dead_lettered_at  timestamptz not null default now(),
  dead_lettered_by  jsonb not null,          -- SYSTEM, or the human who called the endpoint
  replayed_at       timestamptz,
  replayed_job_id   uuid references app.outbox(id)
);
create index dead_letters_tenant_idx on app.dead_letters (tenant_id, dead_lettered_at desc)
  where replayed_at is null;
```

`POST /v1/runs/{id}/dead-letter { reason }` writes an `origin = 'RUN'` row with the
caller as `dead_lettered_by`. That is why the actor is a column rather than an assumed
`SYSTEM`: the contract lets a human dead-letter a run deliberately, and the audit trail
must show who.

Replay creates a **new** job carrying `replayed_from`, and stamps `replayed_at` on the
dead letter. Nothing is ever re-run in place, so the original failure stays inspectable.

---

## 3 · Realtime

### 3.1 Broadcast, not `postgres_changes`

`realtime.send(payload jsonb, event text, topic text, private boolean)` inserts into
`realtime.messages`; Realtime reads that table's WAL and pushes to subscribers. Triggers
call it. Three reasons this beats `postgres_changes` here:

1. **The payloads are projections, not rows.** `approvals` carries `urgencyGroup` and
   `slaBreached`; `invoices` carries `syncState` and `providerCode`. `postgres_changes`
   can only ship the row as written.
2. **Cost, and Supabase says so.** `postgres_changes` performs one RLS check per
   subscriber per change and processes changes on a single thread to preserve order, so it
   does not scale with subscriber count regardless of compute size. Supabase explicitly
   recommends Broadcast beyond roughly 3,000 concurrent subscribers on a change stream,
   because Broadcast sends each change once and fans it out. Research doc §4 cites the
   Postgres Changes, Realtime Architecture and Broadcast guides for this.
3. **Fan-out shape.** Badges are an aggregate that no single row change represents.
4. **It is the maintained path.** Broadcast gained binary payloads in June 2026, and the
   `realtime` schema was locked against modification in July 2026 while RLS on
   `realtime.messages` continues to work — consistent with Broadcast plus RLS being the
   forward direction (research doc §4).

`realtime.broadcast_changes()` is the row-shaped convenience wrapper over the same
mechanism. It is not used here for reason 1.

### 3.2 Channels

Topics are private (`private: true` on both the `realtime.send` call and the client
channel config — they must match or nothing is delivered).

| Topic | Event names | Payload | Source | Screens |
|---|---|---|---|---|
| `tenant:{tenantId}:user:{userId}:badges` | `badges` | `{ approvals: {count, severity}, hrdcDeadlines: {count, severity}, agentFailures: {count, severity} }` | trigger on `approval_requests`, `app.outbox`, `hrdc_packets`, `runs` | sidebar, every screen |
| `tenant:{tenantId}:approvals` | `approval.created`, `approval.decided` | `{ event: "CREATED"\|"DECIDED", approvalRef, urgencyGroup, slaBreached, actionType, value }` | trigger on `approval_requests` | M02-S01, M01-S01 |
| `tenant:{tenantId}:enquiries` | `enquiry.received`, `enquiry.classified` | `{ event: "RECEIVED"\|"CLASSIFIED", enquiryRef, channel, confidence }` | trigger on `core.events` for those two types | M03-S01 |
| `tenant:{tenantId}:invoices` | `invoice.sync.changed` | `{ invoiceRef, syncState, providerCode?, uin? }` | trigger on `invoices.sync_state` | M13-S02, M13-S05 |
| `tenant:{tenantId}:operations` | `attendance.locked`, `hrdc.deadline.warning`, `run.completed`, `run.failed` | see below | trigger on `core.events` | M09-S02, M10-S06, M12-S02, M18-S01 |
| `tenant:{tenantId}:run:{runId}` | `run.node`, `run.event` | `{ seq, nodeKey, kind, name, tool?, status, durationMs, tier?, cost? }` | trigger on `run_nodes`, `run_events` | M18-S04 |

`tenant:{tenantId}:operations` is an **addition to §11**, which defines no channel for
attendance locks, HRDC deadline warnings, or tenant-level run outcomes. One channel rather
than three keeps the subscription list short and matches the project's consolidation rule.
It needs contract sign-off.

Payloads for the added events:

```jsonc
// attendance.locked
{ "engagementRef": "ENG-0231", "day": 1, "present": 28, "total": 30,
  "approvedBy": { "id": "u_faridah", "name": "Faridah Omar" }, "lifecycleStep": "ATTENDANCE" }

// hrdc.deadline.warning
{ "engagementRef": "ENG-0231", "packetRef": "HRDC-0231", "scheme": "SBL_KHAS",
  "deadlineAt": "2026-12-12T23:59:59+08:00", "daysRemaining": 2, "severity": "ALERT",
  "missing": ["EVALUATION_SUMMARY","TRAINING_SCHEDULE"] }

// run.completed / run.failed
{ "runId": "run_4821", "ref": "#4821", "agentId": "agent_proposal",
  "status": "FAILED", "outcome": null, "durationMs": 14200,
  "failure": { "code": "WA_TEMPLATE_REJECTED", "attempts": 3, "retryable": true, "deadLettered": false } }
```

**Everything else polls on navigation**, per §11: dashboards, lists, saved views,
compliance checks, `/ai/usage`, `/ai/tiers`, the rules registry, knowledge sources. A tier
degrading is a settings-screen concern and does not deserve a socket.

### 3.3 Broadcast triggers

```sql
create or replace function app.broadcast_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'event',        case when tg_op = 'INSERT' then 'CREATED' else 'DECIDED' end,
      'approvalRef',  new.ref,
      'actionType',   new.action_type,
      'urgencyGroup', app.urgency_group(new.sla_due_at),
      'slaBreached',  new.sla_due_at < now() and new.status = 'PENDING',
      'value',        new.value
    ),
    case when tg_op = 'INSERT' then 'approval.created' else 'approval.decided' end,
    'tenant:' || new.tenant_id::text || ':approvals',
    true                                        -- private channel
  );
  perform app.broadcast_badges(new.tenant_id,
           app.role_holders(new.tenant_id, array[new.approver_role, 'MD']));
  return null;
end $$;

create trigger approval_requests_broadcast
  after insert or update of status on core.approval_requests
  for each row execute function app.broadcast_approval();
```

`app.urgency_group` maps an SLA due time onto the §12 `UrgencyGroup` enum in one place, so
the sidebar, the approval inbox and the broadcast cannot disagree about what "breaching"
means:

```sql
create or replace function app.urgency_group(p_due timestamptz)
returns text language sql stable set search_path = '' as $$
  select case
    when p_due is null                                    then 'LATER'
    when p_due <  now()                                   then 'BREACHING'
    when p_due <  date_trunc('day', now()) + interval '1 day' then 'TODAY'
    when p_due <  date_trunc('day', now()) + interval '7 days' then 'THIS_WEEK'
    else 'LATER'
  end;
$$;
```

`stable`, not `immutable`, because it calls `now()`. An `immutable` marking would let the
planner constant-fold it and an approval would stop breaching.

Two things to be careful about:

- **Broadcast after commit, not instead of it.** `realtime.send` inserts a row, so it is
  transactional: a rolled-back approval broadcasts nothing. That is correct, and it is the
  opposite of firing an HTTP call from the trigger.
- **Do not let a broadcast failure fail the write.** The trigger body is wrapped so that
  an exception from `realtime.send` is logged and swallowed. A user's approval must not
  fail because the realtime schema is briefly unavailable.

Run progress is the one high-frequency channel:

```sql
create trigger run_nodes_broadcast
  after insert or update of status on core.run_nodes
  for each row execute function app.broadcast_run_node();
```

It fires only while a run is in flight, and a trace viewer is open for perhaps one run at
a time. If node updates ever become chatty, the fix is to broadcast on
`status` transitions only, not on every token-count update.

### 3.4 Authorisation — RLS on `realtime.messages`

This is the one RLS policy in this lane. Clients subscribe; the database sends. There is
deliberately **no** `INSERT` policy, so no client can broadcast on any topic.

Every topic now begins `tenant:{tenant_id}:`, including the run trace and the per-user
badge channel. That is deliberate and is `sb-tenancy`'s correction to my first draft: it
makes the whole policy pure string parsing with **no table lookup at all**, where
`run:{run_id}` would have forced an `exists (select 1 from core.runs …)` on every
authorisation.

```sql
-- receive: one policy, all six topic shapes
create policy "members receive their own tenant's broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and split_part(realtime.topic(), ':', 1) = 'tenant'
  and split_part(realtime.topic(), ':', 2) = (select app.current_tenant_id())::text
  and case split_part(realtime.topic(), ':', 3)
        -- per-user badges: the user segment must be the caller
        when 'user' then split_part(realtime.topic(), ':', 4) = (select auth.uid())::text
        -- run traces are ADMIN per §10; the tenant is already proven above
        when 'run'  then (select app.role()) = 'ADMIN'
        -- approvals, enquiries, invoices, operations: tenant membership is enough
        else true
      end
);

-- send: nobody. Restrictive, so a permissive policy added later cannot re-open it.
create policy "clients never broadcast"
on realtime.messages
as restrictive
for insert
to authenticated, anon
with check (false);
```

Four things about this policy are load-bearing:

- **The `restrictive` insert deny is not redundant.** With RLS on and no `INSERT` policy,
  writes are already denied — but the first permissive `INSERT` policy anyone adds opens
  it. A `restrictive` policy `AND`s with every permissive one, so the deny survives.
  Without it an authenticated user can publish onto any channel they can read, and the
  approvals badge becomes spoofable by anyone with a browser console. This is
  `sb-tenancy`'s catch and it is the sharpest correction in this pass.
- **`app.current_tenant_id()` and `auth.uid()` are wrapped in `(select …)`** so each is
  evaluated once per query rather than once per row. The Supabase performance advisor
  flags the unwrapped form specifically.
- **Per-user badges are authorised by RLS, not filtered in fan-out code.** §11 says the
  SSE stream is "per-user filtered" and the badge payload is a different number per user.
  Because user ids are globally unique, the `user` segment can be compared directly to
  `auth.uid()` and the correct number can ride a per-user channel safely. My first draft
  used a per-role channel and leaked one role's queue depth to every other role in the
  tenant; this replaces it.
- **Realtime connects as an admin role and enforces access purely through these policies.**
  There is no second gate behind them.

A user in tenant B who subscribes to `tenant:A:approvals` connects and then receives
nothing. That is the intended failure: Realtime authorises silently, so the test for this
(§8) asserts on message count, not on an error.

**Policies are cached per connection.** A permission change — a revoked membership, a role
change — does not take effect on an open socket. It needs a new JWT and a reconnect. That
is why a membership change enqueues a priority-1 `AUTH_SIGN_OUT` job (§2.3): signing the
user out is what forces the reconnect that re-evaluates this policy.

### 3.5 Durability — realtime is a hint

`realtime.messages` is partitioned by day and partitions are retained for three days.
Messages are not replayed to a client that was disconnected. Therefore:

- On subscribe and on every reconnect, the client **refetches** the resource the channel
  covers. The broadcast tells it *when*, never *what is true*.
- Badge counts arrive as absolute values, not deltas, so a missed message self-corrects on
  the next one.
- Nothing in the system reads `realtime.messages` as a record of anything. The record is
  `core.events`.

---

## 4 · Inbound webhooks

Four edge functions, one per source. All four share the same five steps in the same order,
because getting the order wrong is how webhook endpoints become forgeable or lossy.

```
1. read the RAW body as text          ← before any JSON parsing
2. verify the signature over that raw text, constant-time
3. resolve the tenant from a routing table
4. open a transaction:
     insert the delivery row (unique on source+key)   ← the idempotency gate
     if zero rows inserted → 200 IGNORED_DUPLICATE, rollback, done
     emit_event(...)                                   ← jobs enqueue here
   commit
5. 200
```

**Step 1 before step 2 is not negotiable.** `JSON.parse` then `JSON.stringify` does not
round-trip byte-for-byte (key order, unicode escapes, number formatting), and an HMAC over
a re-serialised body fails or, worse, is computed over something the sender never signed.

**Step 4 is one transaction on purpose.** Inserting the delivery row first and processing
afterwards burns the idempotency key on a failure, so a legitimate provider retry gets
`IGNORED_DUPLICATE` and the enquiry is lost forever. Committing the ledger row and the
event together means a failure rolls back both and the retry succeeds.

### 4.1 Endpoints

| Endpoint | Source | Signature | Idempotency key | Emits |
|---|---|---|---|---|
| `POST /functions/v1/webhook-email` | mail provider | Provider HMAC-SHA256 over raw body | `Message-ID` header | `EnquiryReceived` |
| `POST /functions/v1/webhook-whatsapp` | WhatsApp BSP | `X-Hub-Signature-256`, HMAC-SHA256 over raw body with the app secret | `messages[0].id`, or `statuses[0].id` for status callbacks | `EnquiryReceived`, or a delivery-status update |
| `POST /functions/v1/webhook-proposal-accepted` | portal (internal) | Supabase JWT or a shared secret header | `token + acceptedAt` | `ProposalAccepted` |
| `POST /functions/v1/webhook-accounting` | accounting package / MyInvois | Provider HMAC, or mTLS where the provider supports it | `provider + documentId + state` | `InvoicePushed` / `InvoiceValidated` |

Verification uses `crypto.subtle.verify('HMAC', key, sigBytes, bodyBytes)`, which is
constant-time. A hand-rolled `===` on hex strings leaks timing and must not be used.

Where the provider sends a timestamp (WhatsApp does), reject anything older than five
minutes. That bounds replay to a window rather than forever, on top of the idempotency
ledger.

A failed signature returns `401` and still writes a delivery row with
`signature_valid = false` and no event. Silent drops make a misconfigured provider
indistinguishable from an attacker.

### 4.2 `app.webhook_deliveries`

```sql
create table app.webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  source           text not null check (source in ('EMAIL','WHATSAPP','PORTAL','ACCOUNTING')),
  idempotency_key  text not null,
  tenant_id        uuid,                       -- null until routing resolves it
  signature_valid  boolean not null,
  http_status      int not null,
  headers          jsonb not null default '{}'::jsonb,
  raw_body         text,                       -- nulled after 30 days
  event_id         uuid references core.events(id) on delete set null,
  error            jsonb,
  received_at      timestamptz not null default now(),
  unique (source, idempotency_key)
);
create index webhook_deliveries_tenant_idx
  on app.webhook_deliveries (tenant_id, received_at desc);
create index webhook_deliveries_unrouted_idx
  on app.webhook_deliveries (source, received_at desc)
  where tenant_id is null;
```

Replay of a seen key returns `200 { "status": "IGNORED_DUPLICATE" }` per §11.

### 4.3 Tenant routing

An inbound webhook arrives with no JWT, so the tenant cannot come from auth. It is
resolved from the provider's own discriminator:

```sql
create table app.webhook_routes (
  source      text not null check (source in ('EMAIL','WHATSAPP','PORTAL','ACCOUNTING')),
  external_id text not null,      -- inbound address, BSP phone_number_id, provider account id
  tenant_id   uuid not null,
  active      boolean not null default true,
  primary key (source, external_id)
);
```

An unknown `external_id` writes a delivery row with `tenant_id = null` and returns `202`.
It is never guessed at and never routed to a default tenant. The unrouted partial index
above is what an operator queries to find misconfigurations.

The portal webhook is the exception: its token already identifies the proposal, and
therefore the tenant.

---

## 5 · Audit trail

### 5.1 Derived, not duplicated

The audit drawer reads `core.events` through a view. There is no second table.

```sql
create or replace view core.audit_entries as
select
  e.id,
  e.tenant_id,
  s.subject_type,
  s.subject_id,
  e.occurred_at as at,
  e.actor,
  e.type       as event,
  e.summary,
  e.run_id,
  e.correlation_id
from core.event_subjects s
join core.events e on e.id = s.event_id;
```

`summary` is written by the emitter, not computed here. A view with a `CASE` over 27 event
types would need editing every time an event is added, and would render stale phrasing for
historical rows. Writing the sentence once, at emit time, means the drawer shows what was
true when it happened.

### 5.2 The drawer query

`GET /v1/{resourceType}/{id}/audit`, keyset paginated on `(occurred_at, id)` per the
§1 cursor convention:

```sql
select at, actor, event, summary, run_id
  from core.audit_entries
 where tenant_id    = (select app.current_tenant_id())
   and subject_type = $1                      -- 'PROPOSAL'
   and subject_id   = $2
   and ($3::timestamptz is null or (at, id) < ($3, $4))   -- cursor
 order by at desc, id desc
 limit $5;
```

This is an index-only scan on `event_subjects_lookup_idx` followed by a primary-key
fetch per row. `OFFSET` is not used: on a long-lived organisation the drawer's later pages
would degrade linearly, and rows inserted during paging would shift the window.

### 5.3 Agent actions in the drawer

Agent-authored events are ordinary events. `actor.kind = 'AGENT'` and `run_id` is set, so
the drawer row links straight to `GET /runs/{id}` — which is exactly the demo fixture's
`"event": "ProposalDrafted", "runId": "run_4821"`. No separate agent log, no join.

The AI badge in the drawer is driven by `actor.kind`, not by a flag, so it can never
disagree with who actually did the thing.

### 5.4 `app.key_access_audit` — every BYOK decrypt

Vault has no built-in audit log, so provider-key decryption gets its own append-only
table. `sb-tenancy` §6.3 references this as mine and does not define it; research doc §8
names the columns.

```sql
create table app.key_access_audit (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  secret_id           uuid not null,           -- vault secret id
  provider_id         text not null,           -- 'prv_anthropic', for the UI
  actor               jsonb not null,          -- { kind, id, name }; kind ∈ HUMAN|AGENT|SYSTEM
  purpose             text not null check (purpose in ('REVEAL','RUN_CALL','PROBE','ROTATE')),
  edge_function_name  text not null,
  request_id          text,                    -- W3C trace id, ties to the Edge log
  run_id              uuid references core.runs(id) on delete set null,
  aal                 text,                    -- assurance level at reveal time
  decrypted_at        timestamptz not null default now()
);
create index key_access_audit_tenant_idx
  on app.key_access_audit (tenant_id, decrypted_at desc);
create index key_access_audit_secret_idx
  on app.key_access_audit (secret_id, decrypted_at desc);
```

Three rules, and the third is the one that gets broken:

1. **The audit row is written in the same transaction as the decrypt**, inside the single
   `security definer` function that reads `vault.decrypted_secrets`. "Decrypt" and "log"
   are one operation or the log is fiction.
2. **`purpose` distinguishes the two callers.** `POST /ai/providers/{id}/reveal` writes
   `REVEAL` with `actor.kind = 'HUMAN'` and the `aal` from the session; the run engine's
   per-call decrypt writes `RUN_CALL` with `actor.kind = 'AGENT'` and a `run_id`. They are
   the same table because they are the same risk, and separating them is how one of them
   ends up unaudited.
3. **Nothing queries `vault.decrypted_secrets` ad hoc.** Not the reveal endpoint, not the
   run engine, not a migration. `anon` and `authenticated` are never granted access to
   that view.

Only `REVEAL` emits a domain event (`ProviderKeyRevealed`, §14, payload
`{ providerId, actor, at, reason, aal }`) and therefore only `REVEAL` appears in the audit
drawer. `RUN_CALL` happens on every agent turn and would drown it; those rows are read
from this table on the provider detail screen instead.

This table is **not** covered by the 30-day run redaction in §6.7. It holds no key
material and no prompt text, and it is the record of who saw a credential.

### 5.5 Retention

| Data | Retention | Mechanism |
|---|---|---|
| `core.events` rows and payloads | Indefinite | None. This is the business record. |
| `event_subjects` | Follows events | `on delete cascade` |
| `app.webhook_deliveries.raw_body` | 30 days | Daily `RETENTION_REDACT` job nulls the column |
| `app.webhook_deliveries` rows | 1 year | Daily job deletes |
| `app.outbox` `SUCCEEDED` rows | 90 days | Daily job deletes; `DEAD` rows are kept |
| `app.dead_letters` | Indefinite until replayed, then 1 year | Daily job |
| `run_node_io` (prompts, completions) | 30 days | §6.6 |
| `runs`, `run_nodes` metadata | Indefinite | None |
| `app.key_access_audit` | Indefinite | None. It is the record of who saw a credential (§5.4). |
| `cron.job_run_details` | 7 days | Daily job — Postgres does **not** clean this up and it grows without bound |

Events are kept indefinitely deliberately. The HRD Corp claim window runs to six months
after training completion, Malaysian record-keeping obligations run to seven years, and an
attendance lock is the evidentiary basis for a grant claim. Deleting the event log is
therefore a compliance decision, not an ops one, and is not taken here.

Events do not need redaction because `events.payload` carries refs and scalars per §14,
not free text. Email bodies live on the enquiry record (`sb-erd`'s lane), not in the event
payload. If a future event type carries free text, it must be redacted at emit time under
the same rule as run I/O.

---

## 6 · Agent runs

### 6.1 `core.runs`

```sql
create table core.runs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  ref               text not null,                    -- '#4821'
  agent_id          text not null,
  orchestrator      text,                             -- 'proposal_orchestrator'

  trigger           jsonb not null,                   -- { type: 'TNA_SIGNED_OFF', ref: 'TNA-0042' }
  mode              text not null default 'LIVE' check (mode in ('LIVE','SANDBOX')),

  status            text not null check (status in ('RUNNING','SUCCEEDED','FAILED','HALTED')),
  outcome           text,                             -- 'QUEUED_FOR_APPROVAL'
  failure           jsonb,                            -- { code, message, attempts, retryable, deadLettered }
  halted_by         jsonb,                            -- { policyId, approvalRequestRef, reason }

  model             text,
  tiers_used        text[],
  cache_hit_rate    numeric(4,3),
  tokens_in         bigint not null default 0,
  tokens_out        bigint not null default 0,
  cost_minor        bigint not null default 0,
  currency          text not null default 'MYR',
  guardrails        text[],

  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  duration_ms       int,

  -- lineage
  parent_run_id     uuid references core.runs(id) on delete set null,  -- retry / handoff
  replay_of_run_id  uuid references core.runs(id) on delete set null,  -- sandbox replay
  correlation_id    uuid not null,
  action_request_id uuid,

  acknowledged_at   timestamptz,
  acknowledged_by   uuid,
  redacted_at       timestamptz,

  unique (tenant_id, ref)
);
create index runs_tenant_started_idx on core.runs (tenant_id, started_at desc);
create index runs_agent_idx on core.runs (tenant_id, agent_id, started_at desc);
create index runs_failed_idx on core.runs (tenant_id, finished_at desc)
  where status = 'FAILED' and acknowledged_at is null;
```

`acknowledged_at` is **not in the contract** and is required by it: `GET /badges` returns
`agentFailures`, and without an acknowledgement the count can only ever grow. It is
proposed as an addition.

`cost_minor` is integer minor units per §1. `duration_ms` is stored rather than generated
because `finished_at` is null while the run is in flight and the trace viewer shows
elapsed time from the client.

### 6.2 `core.run_nodes` — the execution tree

§17's node tree: orchestrator → sub-agents (Reader / Matcher / Drafter / Verifier) →
tools.

```sql
create table core.run_nodes (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references core.runs(id) on delete cascade,
  tenant_id       uuid not null,

  node_key        text not null,                   -- 'n0', 'n3' — stable across retries
  parent_node_id  uuid references core.run_nodes(id) on delete cascade,
  seq             int not null,
  kind            text not null check (kind in ('ORCHESTRATOR','SUB_AGENT','TOOL')),
  name            text not null,                   -- 'Orchestrator' | 'Drafter' | 'send_proposal'

  tier            text,                            -- §17 TierKey
  model           text,
  provider        text,
  tokens_in       int,
  tokens_out      int,
  cache_hit_rate  numeric(4,3),
  cost_minor      bigint not null default 0,

  status          text not null check (status in ('RUNNING','OK','RETRIED','FAILED','HALTED')),
  retries         int not null default 0,
  duration_ms     int,

  args            jsonb,                           -- tool args, redactable
  result          jsonb,                           -- tool result, redactable
  error           jsonb,                           -- { attempt, code }
  halted_by       jsonb,

  started_at      timestamptz not null default now(),
  finished_at     timestamptz,

  unique (run_id, node_key)
);
create index run_nodes_tree_idx on core.run_nodes (run_id, seq);
create index run_nodes_parent_idx on core.run_nodes (parent_node_id)
  where parent_node_id is not null;
```

`haltedBy` is first-class on the node, exactly as §10 requires — it is how the trace proves
the agent never sent anything. A halted node has `duration_ms = 0` and no result.

The tree is read in one query with a recursive CTE, or simply ordered by `seq` and
assembled client-side from `parent_node_id`; at 10–30 nodes per run the flat read is
cheaper than the CTE.

### 6.3 `core.run_node_io` — prompts and completions

Separated from `run_nodes` so the 30-day deletion is a `DELETE` of a side table rather than
an `UPDATE` that bloats the table the trace viewer reads.

```sql
create table core.run_node_io (
  run_node_id  uuid primary key references core.run_nodes(id) on delete cascade,
  tenant_id    uuid not null,
  prompt       text,
  completion   text,
  redaction    jsonb not null default '{}'::jsonb,   -- { emails: 2, phones: 1, nric: 0 }
  created_at   timestamptz not null default now()
);
create index run_node_io_age_idx on core.run_node_io (created_at);
```

### 6.4 `core.run_events` — what happened to the run

```sql
create table core.run_events (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references core.runs(id) on delete cascade,
  tenant_id  uuid not null,
  seq        int not null,
  type       text not null check (type in
               ('ESCALATION','JURY','TRUNCATION','HANDOFF','CHECKPOINT','POLICY_HALT','CACHE_HIT','BUDGET_EXCEEDED')),
  node_key   text,
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now(),
  unique (run_id, seq)
);
```

`detail` shapes, matching §17 exactly:

```jsonc
ESCALATION      { "from": "FAST", "to": "MID", "confidence": 0.62, "threshold": 0.75, "node": "n2" }
JURY            { "mode": "ESCALATE", "quorum": 2, "of": 3,
                  "votes": [ { "tier": "STRONG_1", "model": "Claude Sonnet 5", "agrees": true },
                             { "tier": "STRONG_3", "model": "GPT-5.6 Terra", "agrees": false,
                               "dissent": "Prefers waiting for Daniel Wong in December" } ] }
TRUNCATION      { "tool": "fetch_rate_card", "storedTokens": 3400, "fetchMoreAvailable": true }
HANDOFF         { "atContextPct": 0.60, "restartedNodes": ["n3"], "checkpointStep": 4 }
CHECKPOINT      { "step": 4, "replayable": true, "stateCardVersion": 4 }
POLICY_HALT     { "policyId": "APV-01", "approvalRequestRef": "APV-2026-0771" }
CACHE_HIT       { "node": "n1", "tier": "MID", "savedTokens": 4200 }
BUDGET_EXCEEDED { "scope": "RUN", "limit": 60000, "used": 61204, "action": "HALT" }
```

`HANDOFF` at 60% context is a checkpoint plus a restart: the engine writes a
`CHECKPOINT` run event, a new `run_state_cards` version, and then restarts the named nodes
in a child run linked by `parent_run_id`. The trace viewer stitches the two by following
that link, so the user sees one continuous run and one budget bar.

`JURY` in `SAMPLE` mode is written **after** the human decided, by the `JURY_SAMPLE` job,
and must never change `runs.outcome`. §18 is explicit that sampling never touches the
decision.

### 6.5 State cards and checkpoints

The state card is versioned, because retry-from-checkpoint needs the card as it was at
that checkpoint, not as it ended up.

```sql
create table core.run_state_cards (
  run_id           uuid not null references core.runs(id) on delete cascade,
  version          int not null,
  tenant_id        uuid not null,
  goal             text not null,
  plan             jsonb not null default '[]'::jsonb,   -- [{ n, label, status }]
  decisions        text[] not null default '{}',
  constraints      text[] not null default '{}',
  record_pointers  text[] not null default '{}',
  open_questions   text[] not null default '{}',
  budgets          jsonb not null default '{}'::jsonb,   -- { tokens: {used,limit}, cost: {used,limit} }
  created_at       timestamptz not null default now(),
  primary key (run_id, version)
);

create table core.run_checkpoints (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references core.runs(id) on delete cascade,
  tenant_id           uuid not null,
  step                int not null,
  node_key            text,
  state_card_version  int not null,
  cursor              jsonb not null,       -- engine resume position
  replayable          boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (run_id, step),
  foreign key (run_id, state_card_version) references core.run_state_cards (run_id, version)
);
```

`POST /v1/runs/{id}/retry?from=checkpoint` reads the latest `replayable` checkpoint,
creates a new run with `parent_run_id` set and the same `correlation_id`, seeds it with
that checkpoint's state card version and cursor, and enqueues an `LLM_RUN` job. The
original run is never mutated.

`budgets` on the card is what M18-S04's budget bars render. A `BUDGET_EXCEEDED` run event
fires when `used` crosses `limit`, and the run halts rather than silently continuing —
consistent with §17's `409 AGENT_PAUSED` / `details.reason: "BUDGET_CAP"` behaviour at the
tier level.

### 6.6 Sandbox replay — the answer to §16 Q8

**Recommendation: a snapshot pinned to the original run.** Live reads make a replay
non-deterministic, which removes the only reason to run one.

Every tool **read** during a `LIVE` run is captured:

```sql
create table core.run_snapshots (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references core.runs(id) on delete cascade,
  tenant_id   uuid not null,
  tool_name   text not null,
  args_hash   text not null,        -- sha256 of canonicalised args (sorted keys)
  args        jsonb not null,
  response    jsonb not null,
  captured_at timestamptz not null default now(),
  unique (run_id, tool_name, args_hash)
);
```

`POST /v1/runs/{id}/replay?mode=SANDBOX` creates a run with `mode = 'SANDBOX'` and
`replay_of_run_id` set, and the tool layer changes behaviour in three ways:

1. **Reads resolve from `run_snapshots`** of the parent run, matched on
   `(tool_name, args_hash)`.
2. **A miss is a hard error**, `SANDBOX_SNAPSHOT_MISS`, not a live read. A replay whose
   plan diverges enough to call a tool with different arguments has stopped being a replay,
   and the operator needs to know that rather than get a plausible-looking trace.
3. **Every write tool is refused** with `SANDBOX_WRITE_REFUSED`. Sandbox runs emit no
   domain events and enqueue no jobs; `app.emit_event` is never called with a sandbox run's
   context.

Snapshots follow run retention and are deleted with the run's `run_node_io` at 30 days,
which bounds how far back a replay is possible. That is a stated limit rather than an
accident: replay is a debugging tool for recent failures, not an archive.

### 6.7 PII redaction

Two passes, in this order.

**Before storage, in the worker.** Prompt and completion text is masked before it is sent
to the database, so the database never holds the raw value:

| Pattern | Masked as |
|---|---|
| Email addresses | `«email:1»`, numbered per document so co-reference survives |
| Malaysian mobile `+60…` / `01x-…` | `«phone:1»` |
| NRIC `YYMMDD-PB-###G` | `«nric:1»` |
| Passport numbers | `«passport:1»` |
| Bank account numbers | `«acct:1»` |

The count of each is recorded in `run_node_io.redaction` so an operator can see that
masking ran and what it caught, without seeing what it caught.

**After 30 days, in the database.** A daily `RETENTION_REDACT` job:

```sql
create or replace function app.redact_run_io() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with gone as (
    delete from core.run_node_io
     where created_at < now() - interval '30 days'
    returning run_node_id
  ) select count(*) into n from gone;

  delete from core.run_snapshots where captured_at < now() - interval '30 days';

  update core.run_nodes rn
     set args = null, result = null
   where rn.finished_at < now() - interval '30 days'
     and (rn.args is not null or rn.result is not null);

  update core.runs
     set redacted_at = now()
   where finished_at < now() - interval '30 days' and redacted_at is null;

  return n;
end $$;

select cron.schedule('retention-redact', '0 19 * * *',   -- 03:00 MYT
  $$ select app.redact_run_io(); $$);
```

What survives indefinitely: run status, outcome, tier, model, provider, token counts,
cache hit rate, cost, durations, retries, `halted_by`, run events, state cards and
checkpoints. That is enough to answer "what did the agents cost and how often did they
halt" a year later without keeping a word of anyone's correspondence.

State cards are kept because `goal`, `decisions` and `constraints` are authored summaries,
not transcripts. If a state card is ever found to carry client text verbatim, it moves
under the same 30-day rule.

### 6.8 `core.evals`

```sql
create table core.evals (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  agent_id           text not null,
  action_type        text,
  kind               text not null check (kind in ('GOLDEN_SET','LIVE_SAMPLE','JURY_GATE','HUMAN_LABEL')),
  golden_set_version text,
  run_id             uuid references core.runs(id) on delete set null,
  score              numeric(4,3),
  passed             boolean,
  detail             jsonb not null default '{}'::jsonb,
  evaluated_at       timestamptz not null default now()
);
create index evals_agent_idx on core.evals (tenant_id, agent_id, evaluated_at desc);
```

`GET /v1/agents`'s `evalScore` is the rolling median of the last N `GOLDEN_SET` and
`JURY_GATE` scores for that agent; `medianEval` in the summary is the median across agents.
The `resumeCondition` on a paused agent (`{ metric: "evalScore", op: "gte", value: 0.85 }`)
is evaluated against that same rolling figure by the `EVAL_RUN` job, which emits the
resume event when it clears.

`JURY_GATE` rows come from §18's `GATE` mode at promotion time; `LIVE_SAMPLE` rows come
from the 5% `JURY_SAMPLE` job. Keeping both in one table is what makes drift visible: the
gate score and the live sample score for the same action type are directly comparable.

---

## 7 · Badge counts

### 7.1 Where the endpoint actually lives

`GET /badges` does not exist in the contract. The counts are served in two places: §2
`GET /v1/navigation` embeds `badge: { count, severity }` per nav node, and §11 broadcasts
`{ approvals, hrdcDeadlines, agentFailures }` on the `badges` channel. Both are fed by one
function so they cannot disagree.

§11's payload is bare integers while §2's badge carries `severity`. That is a contract
inconsistency: the sidebar would have to refetch `/navigation` to colour a badge it just
received a count for. **Proposed:** the realtime payload carries the same
`{ count, severity }` shape as §2.

### 7.2 The function

```sql
create or replace function app.badge_counts(p_tenant uuid, p_user uuid, p_role text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
with approvals as (
  select
    count(*)                                               as n,
    count(*) filter (where ar.sla_due_at < now())          as breached
  from core.approval_requests ar
  where ar.tenant_id = p_tenant
    and ar.status = 'PENDING'
    and ar.approver_role = p_role
    and (ar.assigned_to is null or ar.assigned_to = p_user)
),
hrdc as (
  select
    count(*)                                                                  as n,
    count(*) filter (where p.deadline_at < now() + interval '3 days')          as urgent
  from core.hrdc_packets p
  where p.tenant_id = p_tenant
    and p.status in ('DRAFT','READY')
    and p.deadline_at < now() + interval '14 days'
),
failures as (
  select
    (select count(*) from core.runs r
      where r.tenant_id = p_tenant and r.status = 'FAILED' and r.acknowledged_at is null)
  + (select count(*) from app.dead_letters d
      where d.tenant_id = p_tenant and d.replayed_at is null)                 as n,
    (select count(*) from app.dead_letters d
      where d.tenant_id = p_tenant and d.replayed_at is null)                 as dead
)
select jsonb_build_object(
  'approvals', jsonb_build_object(
      'count', a.n,
      'severity', case when a.breached > 0 then 'ALERT' else 'DEFAULT' end),
  'hrdcDeadlines', jsonb_build_object(
      'count', h.n,
      'severity', case when h.urgent > 0 then 'ALERT' else 'DEFAULT' end),
  'agentFailures', jsonb_build_object(
      'count', f.n,
      'severity', case when f.dead > 0 then 'ALERT' else 'DEFAULT' end)
)
from approvals a, hrdc h, failures f;
$$;
```

Supporting partial indexes, owned by the lane that owns each table:

```sql
-- sb-actions
create index approval_requests_pending_idx
  on core.approval_requests (tenant_id, approver_role, sla_due_at)
  where status = 'PENDING';

-- sb-money / sb-erd
create index hrdc_packets_open_deadline_idx
  on public.hrdc_packet (tenant_id, deadline_at)
  where status in ('DRAFT','READY');
```

Each of these is a partial index over the small, hot subset — pending approvals and open
packets — rather than a full index over every approval ever decided. The counts are three
index-only scans.

`approval_requests`, `hrdc_packets` and their column names are **assumed**; they belong to
`sb-actions` and `sb-money`.

### 7.3 Severity rules

| Badge | `ALERT` when |
|---|---|
| `approvals` | any pending approval has `sla_due_at < now()` — the §1 `SLA_BREACHED` flag, which never blocks |
| `hrdcDeadlines` | any open packet's deadline is within 3 days |
| `agentFailures` | any unreplayed dead letter exists; a retryable failure alone stays `DEFAULT` |

The distinction on `agentFailures` matters: a run that will retry on its own is not an
alert, and colouring it red teaches people to ignore the badge.

### 7.4 Broadcast

Badges are **per user**, not per tenant and not per role. `app.badge_counts` filters
approvals by `approver_role` and narrows again by `assigned_to`, so §11's single flat
`badges` channel cannot carry a correct number for anybody. Calling the function with a
null role returns zero approvals and silently blanks the sidebar.

My first draft fanned out per role, which fixed the null but leaked one role's queue depth
to every other role in the tenant. `sb-tenancy` pointed out that a per-user topic can be
authorised by RLS directly (§3.4), so the correct number can be pushed to exactly the
person it belongs to. That is what this does.

```sql
create or replace function app.broadcast_badges(p_tenant uuid, p_users uuid[] default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare u record;
begin
  for u in
    select m.user_id, m.app_role
      from public.memberships m
     where m.tenant_id = p_tenant
       and (p_users is null or m.user_id = any(p_users))
  loop
    begin
      perform realtime.send(
        app.badge_counts(p_tenant, u.user_id, u.app_role),
        'badges',
        'tenant:' || p_tenant::text || ':user:' || u.user_id::text || ':badges',
        true);
    exception when others then
      raise warning 'badge broadcast failed for user %: %', u.user_id, sqlerrm;
    end;
  end loop;
end $$;
```

Callers pass the users actually affected, so a new approval routed to one manager
broadcasts once rather than to the whole tenant:

```sql
-- on an approval insert or decision
perform app.broadcast_badges(
  new.tenant_id,
  app.role_holders(new.tenant_id, array[new.approver_role, 'MD'])
);
```

`MD` is included because §1's policies escalate to it. `app.role_holders(tenant, roles[])`
returns the user ids holding any of those roles and is mine to write; it is the same
lookup `sb-actions`' `app.pick_role_holder` already does, and the two should share one
implementation rather than diverge.

The exception handler is **inside** the loop, not around it. A single user whose broadcast
fails must not stop the remaining users from getting theirs, and no broadcast failure may
ever fail the approval write that triggered it.

Two bounds worth stating, because per-user fan-out is the expensive shape:

- Fan-out is bounded by the number of *eligible approvers*, typically one to three, not by
  tenant headcount. The `null` case — a dead-lettered job or a failed run, which affects
  every user's `agentFailures` — is the one that fans out tenant-wide, and it is rare by
  construction.
- `realtime.messages` is partitioned daily and retained three days, so this write is cheap
  and self-cleaning. It is still a write, so the trigger is statement-level.

This is a deviation from §11's flat `badges` channel and needs sign-off. It is a deviation
in the client's favour: §11 already specifies the SSE stream as "per-user filtered", so a
per-user topic is closer to the contract's intent than the flat channel name suggests.

---

## 8 · Test plan

pgTAP for the database, Deno tests for the edge functions. Every test below asserts on
state, not on logs.

### 8.1 At-least-once delivery

- **Enqueue is transactional.** Begin, call `app.emit_event`, roll back; assert zero rows
  in `events`, `event_subjects` and `jobs`. Repeat with commit; assert one event and
  exactly one job per enabled subscription.
- **A committed job is always eventually claimed.** Insert 100 jobs, run `claim_jobs` in a
  loop with `p_limit = 7`; assert every job reaches `CLAIMED` and no id is returned twice.
- **Concurrent claims are disjoint.** Two sessions call `claim_jobs` simultaneously;
  assert the union is every job and the intersection is empty. This is the `SKIP LOCKED`
  regression test and it is the one that catches a future `for update` without it.
- **Lease expiry redelivers.** Claim a job with `p_lease = '1 second'`, wait, run
  `app.reap_jobs()`; assert `state = 'QUEUED'` and `attempts = 1`. Claim again; assert
  `attempts = 2`.

### 8.2 Duplicate consumer

- **Replayed idempotency key writes one event and no second job.** Call `app.emit_event`
  twice with the same `p_idempotency_key`; assert one row in `events`, the same id
  returned both times, and one job.
- **`complete_job` is idempotent on the job id.** Complete a job twice; assert the second
  call raises `55000` (not claimed) and that only one completion event exists, keyed
  `job:<id>`.
- **A handler that runs twice produces one external effect.** Mock the provider; deliver
  the same `SEND_EMAIL` job twice; assert the provider saw the same idempotency key twice
  and one message was created.
- **Webhook duplicate.** POST the same signed body twice; assert `200` both times, the
  second with `{"status":"IGNORED_DUPLICATE"}`, one `webhook_deliveries` row, one event.
- **Webhook failure does not burn the key.** Force `emit_event` to raise inside the
  handler transaction; assert the delivery row is absent (rolled back) and that a
  subsequent identical POST succeeds and creates the event.

### 8.3 Retry exhaustion → dead letter

- Set `max_attempts = 3`; fail the job three times through `app.fail_job`. Assert:
  attempts 1 and 2 land in `FAILED` with a strictly increasing `run_after`; attempt 3
  lands in `DEAD`; exactly one `app.dead_letters` row exists with
  `reason = 'RETRIES_EXHAUSTED'` and `attempts = 3`; no fourth claim is possible.
- **Non-retryable fails fast.** `fail_job(..., p_retryable => false)` on attempt 1 goes
  straight to `DEAD`.
- **Backoff is bounded and jittered.** Assert `run_after - now()` never exceeds one hour
  and that two jobs failing in the same statement get different `run_after` values.
- **Human dead-letter.** `POST /runs/{id}/dead-letter` writes `origin = 'RUN'` with
  `dead_lettered_by.kind = 'HUMAN'` and the caller's id.
- **Replay creates a new job.** Assert `replayed_job_id` is set, `replayed_at` is stamped,
  and the original job row is unchanged.

### 8.4 Realtime authorisation

- **Wrong tenant gets nothing.** Sign a JWT for tenant B, subscribe to
  `tenant:A:approvals`, broadcast on it, wait past a timeout; assert zero messages
  received. Assert the subscription itself succeeded — Realtime authorises silently, so a
  test that asserts on an error will pass for the wrong reason.
- **Right tenant receives.** Same broadcast, tenant A subscriber, assert the payload
  matches the trigger's `jsonb_build_object` exactly, field for field.
- **Non-admin cannot watch a run.** A `SALES` user in the correct tenant subscribes to
  `tenant:{own}:run:{id}`; assert zero messages. An `ADMIN` in the same tenant receives
  them. This is the `case … when 'run'` branch and it is the only branch that reads a role.
- **One user cannot read another's badges.** User A subscribes to
  `tenant:{own}:user:{B}:badges` — same tenant, different user; assert zero messages.
  This is the leak my per-role draft had, so it is a regression test, not a formality.
- **Clients cannot send, even on a channel they can read.** An authenticated client calls
  `channel.send()` on `tenant:{own}:user:{own}:badges`; assert rejected. Then add a
  permissive `INSERT` policy in the test transaction and assert it is **still** rejected —
  that is what proves the deny is `restrictive` rather than merely absent, and it is the
  only test that catches someone "fixing" the advisor finding later.
- **Policy unit test without a socket.** In SQL: `set local role authenticated`,
  `set local request.jwt.claims = '…'`, `set local realtime.topic = 'tenant:B:user:…:badges'`,
  then evaluate the policy's `using` expression; assert false. (Confirm that
  `realtime.topic()` reads that GUC against the deployed `realtime` schema before relying
  on this form.)
- **No lookup in the receive path.** `explain` the policy expression and assert no scan of
  `core.runs` appears. Every topic is tenant-prefixed precisely so authorisation is string
  parsing; a future edit that reintroduces a subquery should fail here.
- **Rollback broadcasts nothing.** Begin, insert an approval, roll back; assert no row in
  `realtime.messages`.

### 8.5 Worker lifetime and tenant isolation

- **A handler that outlives the worker is redelivered, not lost.** Simulate a worker killed
  at the 400s wall clock mid-`LLM_RUN`: assert the lease expires, `reap_jobs` returns the
  job to `QUEUED`, `attempts` incremented once, and the next claim resumes from the last
  checkpoint rather than from the start. Assert no duplicate external effect was produced.
- **A long run yields rather than holding.** Assert `LLM_RUN` writes a checkpoint and
  re-enqueues before 400s, and that the re-enqueued job carries the same `run_id` and
  `correlation_id` and a new `job_key`.
- **The lease never exceeds the worker lifetime.** A static assertion over the claim call
  sites: no `p_lease` above six minutes. Cheap, and it is the constraint most likely to be
  loosened by someone debugging a slow handler.
- **Service-role writes are scoped.** `app.outbox` has RLS enabled **and** forced, and zero
  policies: assert `authenticated` and `anon` both read zero rows, and that a
  `security definer` function owned by `postgres` also reads zero. Assert `service_role`
  reads them. Assert every handler write goes through one of the five named functions —
  `sb-tenancy` §8.7's schema-wide guard sweeps this, and it is the only check standing
  between a buggy handler and a cross-tenant write.
- **`tenant_id` leads an index on every table in this lane.** Covered by `sb-tenancy`'s
  schema-wide pgTAP guard; listed here so it is not assumed to be someone else's problem.

### 8.6 Retention and cron

- **Run I/O is deleted at 30 days, metadata is not.** Insert a run finished 31 days ago
  with I/O and snapshots; run `app.redact_run_io()`; assert `run_node_io` and
  `run_snapshots` rows are gone, `run_nodes.args`/`result` are null, `runs.redacted_at` is
  set, and `tokens_in`, `cost_minor`, `status`, `tier` are unchanged.
- **29 days is untouched.** The same fixture at 29 days survives entirely. This is the
  off-by-one that silently destroys evidence.
- **The job is idempotent.** Run it twice; assert the second run deletes zero rows and
  does not re-stamp `redacted_at`.
- **Webhook bodies are nulled, rows are kept.** Assert `raw_body is null` and
  `signature_valid` still readable at 31 days.
- **Events are never deleted.** Assert an event from 400 days ago is still present and its
  payload intact after the retention job runs.
- **Cron history is pruned.** Assert `cron.job_run_details` holds nothing older than seven
  days.
- **Pre-storage redaction.** Unit-test the worker's masker against an email address, a
  `+60` mobile, an NRIC and a passport number; assert none of the originals appear in the
  stored text and that `redaction` counts them correctly.

### 8.7 Correlation and audit

- **The chain holds.** Drive the fixture end to end: `POST /actions PROPOSAL_SEND` →
  `ActionRequested` → `ApprovalRequested` → `ApprovalDecided` → `ProposalSent` →
  `SEND_EMAIL`. Assert all five events share one `correlation_id`, that each
  `causation_id` points at its predecessor, and that the job carries the same correlation.
- **The drawer is ordered and complete.** `GET /proposals/{id}/audit` returns all five in
  `occurred_at desc`, including `ApprovalDecided` (whose aggregate is the approval, not the
  proposal) via its `RELATED` subject row.
- **Keyset paging does not skip or repeat.** Page through 200 events with `page[size]=25`
  while inserting new ones; assert no id appears twice and none of the original 200 is
  missed.
- **Append-only is enforced.** `update core.events set summary = 'x'` raises `0A000`.

---

## 9 · Open questions, mapped to §16 and §17

| Ref | Question | Impact on this lane | Position |
|---|---|---|---|
| §16 Q1 | Does an approval expire? | Determines whether `ApprovalExpired` exists and whether an expiry job is scheduled. | **Resolved, and we agree independently.** `sb-actions` implements `app.expire_approvals(500)` on a 5-minute cron, expiring at 24h. `ApprovalExpired` is therefore a real event and is listed in §1.7. Their cron owns the sweep; I own the event and the badge clearing. |
| §16 Q5 | Should unlock be refused once a claim reference exists? | Decides whether `HRDCPacketVoided` is ever emitted, or whether the API refuses outright and the event is dead code. | Still open, and owned by `sb-money`. Either way the event exists and carries the claim reference: if unlock is permitted it records the void, and if it is refused the event is simply never emitted. `sb-actions` proposed the separate event and I adopted it over my earlier flag on `AttendanceUnlocked` (§1.7). |
| §16 Q7 | One agent credential, or one per agent per tenant? | If the `AGENT` principal were global, `events.tenant_id` for agent-authored events could not come from the JWT. | **Resolved by `sb-tenancy`: per agent per tenant**, a hashed revocable API key exchanged for a 15-minute ES256 JWT. `events.actor` therefore takes `app.actor_kind()` and `app.agent_id()` from the token, and no special case is needed. |
| §16 Q8 | Sandbox replay: live or snapshot? | Entire design of `run_snapshots` and replay semantics. | **Answered here: snapshot pinned to the run** (§6.6). This is the one §16 question this lane resolves rather than escalates. |
| §16 Q4 | WhatsApp rate TTL | Drives `WHATSAPP_RATE_REFRESH` job cadence and what the composer shows on a stale cache. | Proposed 6h TTL with last-known-good served and flagged stale. Owned by `sb-money`. |
| §16 Q6 | Portal token lifetime | Whether a `TOKEN_REVOKE` job is scheduled on acceptance. | No position; the job is trivial either way. |
| §17 Q3 | Batch windows: queue or escalate outside `allowedHours`? | Directly a scheduling question. A batch-eligible tier sets `run_after` to the next window's start; a non-eligible one escalates immediately. | **Queue for batch-eligible tiers, escalate otherwise**, as the UI already implies. `jobs.run_after` implements the queue side with no new machinery. |
| §17 Q2 | Jury cost | Resolved by §18 and `DECISIONS.md` §2: `GATE` at promotion, `SAMPLE` at 5% async, `ESCALATE` on trigger. | Implemented as `EVAL_RUN` and `JURY_SAMPLE` job types. No open question remains. |
| New | `GET /badges` does not exist | §7.1. | Counts come from `/navigation` and the `badges` channel, both fed by `app.badge_counts`. |
| New | §11 badge payload has no `severity`, §2's does | §7.1. | Propose `{ count, severity }` on both. |
| New | Per-user badges on a per-tenant topic | §7.4. | Propose per-role topics `tenant:{t}:role:{r}:badges`. |
| New | 13 action types emit no catalogued event | §1.7. | Proposed additions listed; needs contract sign-off. `sb-actions` has `app.event_name_for(action_type)` and notes the names there are "a proposal, not a decision" — the two lists must be reconciled into one before either is implemented. |
| New | Jury sampling is enqueued twice | `sb-actions` runs `app.enqueue_jury_samples()` on a 5-minute cron; I subscribe `JURY_SAMPLE` to `ApprovalDecided`. | **Theirs wins, mine is removed.** A cron sweep over decided approvals samples exactly 5% of the population; an event subscription samples 5% per event and drifts. The `ApprovalDecided → JURY_SAMPLE` subscription row should not be inserted. |
| New | Which schema holds the eventing tables | I had them in `public`. | **Resolved against migration 001: `core`.** The domain is `core`, `app` is the gate and internals, `public` is identity and tenancy only. `core.events`, `core.runs` and the rest moved; `app.outbox`, `app.dead_letters`, `app.webhook_deliveries`, `app.webhook_routes` and `app.event_subscriptions` stay in `app` and out of PostgREST. |
| New | `pg_cron` and `pg_net` are not enabled | Migration 001 enables `pgcrypto`, `citext`, `btree_gist` and `pg_trgm` only. Every scheduled sweep here, the worker tick in §2.6, and `sb-actions`' six scheduled jobs all need both. | **Ruled to `sb-migrations`.** Until it lands, nothing in §2.6 runs and the queue has no scheduler at all — this is the single largest blocker on this design. `config.toml` must also expose `core` to PostgREST or the audit drawer returns nothing. |
| New | Table naming: singular or plural | Doc 01's prose uses singular (`hrdc_packet`); doc 03 and migration 001 use plural (`core.hrdc_packets`). | **Resolved: plural**, per migration 001's conflict note C1 (doc 03 outranks doc 02, and the migration follows it). This file uses plural throughout. |
| New | `runs.acknowledged_at` | §6.1. | Required for `agentFailures` to ever decrease. Proposed addition. |

---

## Phase 3

### Deviations

1. **SSE is replaced by Supabase Realtime.** §11 specifies `SSE at GET /v1/events?channels=…`.
   Supabase Realtime is WebSocket, not SSE, and putting an SSE shim in front of it would
   mean a stateful process holding a socket per user in front of a service that already
   does exactly that. **Recommendation:** drop the SSE endpoint; the client subscribes
   with `supabase-js` and the `channels=` list becomes the set of topics it joins. The
   payloads in §11 are preserved unchanged. This changes the client, so it needs sign-off.

2. **No partitioning at launch**, against the skill's partitioning guidance being
   applied preemptively. The skill's own threshold is >100M rows and TrainOS is two to
   three orders of magnitude below it. Partitioning `events` would also forbid the global
   unique index on `(tenant_id, idempotency_key)` — a partitioned table's unique index must
   include the partition key — and that index is load-bearing for replay. **Trigger to
   revisit:** `events` exceeding ~50M rows, or `events_subject_idx` exceeding available
   cache. At that point partition by month on `occurred_at` and move idempotency to a
   separate unpartitioned ledger.

3. **`pgmq` rejected in favour of a hand-written queue** — an explicit disagreement with
   `docs/research/08-supabase-agentic-best-practices.md` §4, which recommends `pgmq` as the
   durable internal outbox. §2.1 states where we agree (which is everything except the
   storage engine), the five specifics behind the disagreement, and the switch condition.
   **Ruled by the team lead: `app.outbox` stands, research §4 is advisory rather than
   binding, and the switch condition is recorded as written.** It stays listed as a
   deviation because it remains the decision here most likely to be wrong, and the cheapest
   to reverse: `app.outbox` keeps every column as a projection and `claim_jobs` becomes
   `pgmq.read`.

4. **`text` + `check` instead of Postgres enum types** for `job_type`, `state`, event
   `type` and run event `type`, against the §12 enum catalogue reading like enum types.
   `ALTER TYPE … ADD VALUE` interacts badly with migration transactions and cannot remove a
   value; these lists will change. The §12 catalogue is still the source of truth for the
   allowed values.

5. **A per-user badge topic instead of §11's flat `badges` channel** (§7.4, D14). The flat
   channel cannot carry a correct count for anybody, and my own first draft's per-role
   channel leaked one role's queue depth to every other role in the tenant.

6. **A sixth realtime channel, `tenant:{t}:operations`** (§3.2), for attendance locks,
   HRDC deadline warnings and tenant-level run outcomes, which §11 defines no channel for.

7. **Events are retained indefinitely**, where the task framing suggested a retention
   policy on the audit trail. The attendance lock is the evidentiary basis for an HRD Corp
   grant claim and the claim window alone runs six months past completion. Only run I/O,
   snapshots and webhook bodies are aged out.

8. **Two names for one string across the `sb-actions` seam** (§2.7). The effect key is
   `app.action_effects.job_key` on their table and `app.outbox.idempotency_key` on mine,
   and `app.settle_effect`'s parameter is `job_key`. Each lane names the column it owns,
   which is coherent but is still a divergence, and the project's standing rules call
   divergence a defect. Recorded rather than hidden. If it is collapsed to one name,
   `job_key` should win on my table: this column is a derived key, whereas
   `core.events.idempotency_key` is the caller-supplied `Idempotency-Key` header from §1,
   and using one word for both meanings is the more expensive confusion.

### What I could NOT verify

- **Research doc §4 recommends `pgmq` and this document does not use it.** That is a
  deliberate, argued disagreement (§2.1, Deviation 3), not an oversight, and it is the one
  decision here most worth a second opinion. Everything else in research doc §4 is adopted.

- **The `sb-actions` seam is settled in both directions and nothing is outstanding.**
  `app.emit_event`'s three-argument overload is mine; `sb-actions` writes its own
  `app.outbox` rows; `app.settle_effect(job_key, status, result, error)` is theirs, per
  ruling R-WB. The addressing changed twice before settling — `action_request_id`, then
  `effect_id`, then `job_key` — and the record of that is in §2.7 rather than erased,
  because the reason it moved is the design constraint (one action, N independently
  failing effects) and a future reader will otherwise re-litigate it. I have not compiled
  either function against their schema.

- **Seven helper functions are named but not written**, and they are the largest piece of
  unwritten work this document implies: `app.aggregate_type_for`, `app.event_payload_for`,
  `app.event_summary_for`, `app.event_name_for` (shared with `sb-actions`),
  `app.job_type_for`, `app.job_priority_for` and `app.role_holders`. They are mechanical,
  but `app.event_payload_for` and `app.event_summary_for` are where the §14 payload shapes
  are actually enforced, so "mechanical" does not mean "trivial". `app.role_holders`
  overlaps `sb-actions`' `app.pick_role_holder` and the two should be one function.

- **`public.memberships` and its `app_role` column are assumed** by the badge fan-out in
  §7.4. `sb-tenancy` lists `memberships` among its four tables but I have not verified the
  column name.

- **`core.hrdc_packets` and `core.invoices` columns are assumed.** The badge SQL in §7.2
  and the invoice channel in §3.2 name `deadline_at`, `status` and `sync_state`, owned by
  `sb-erd` and `sb-money`. The table names and the `core` schema are taken from migration
  001; the column names are not.

- **`pg_cron` and `pg_net` are assumed available and are not yet enabled.** Migration 001
  enables `pgcrypto`, `citext`, `btree_gist` and `pg_trgm` only. Every cron sweep in this
  document and the worker tick in §2.6 depend on both, and `core` must also be added to
  PostgREST's exposed schemas or the audit drawer returns nothing. Neither is verified
  against a running project.

- **`realtime.topic()` reading a `realtime.topic` GUC is believed but unverified.** The
  SQL-only policy test in §8.4 depends on it. Confirm against the deployed `realtime`
  schema before relying on that test form; the WebSocket-level test in the same section
  does not depend on it and is the one that must pass.

- **No SQL in this document has been executed.** There is no Supabase project attached to
  this repo; migration 001 exists on disk but has not been applied from here.
  Every statement here is written from the Postgres and Supabase documentation and has not
  been run, planned or `EXPLAIN`ed. In particular the `app.emit_event` `on conflict … where`
  clause form, the composite foreign key from `run_checkpoints` to `run_state_cards`, and
  the partial-index usage by `claim_jobs` should each be verified against a real database
  before a migration is written.

- **Volume estimates behind D2 are my own**, derived from the demo fixtures (one training
  company, twenty screens, engagement-scale records), not from the client. If TrainOS is
  multi-tenant at hundreds of tenants, the partitioning decision should be revisited before
  launch rather than after.
