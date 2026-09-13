-- ============================================================================
-- Migration 012: domain events, the transactional outbox, the job lifecycle,
-- dead letters, inbound webhooks, the audit drawer and the retention reapers.
-- ============================================================================
--
-- FEATURE. This is the OTHER SIDE of 011's seam. 011 evaluates an action, writes
-- its effects, and leaves every EXTERNAL effect as a typed `DISPATCHED` row in
-- `app.action_effects`. 012 is the migration that turns those rows into jobs, runs
-- the job lifecycle a worker drives, reports the outcome back through 011's
-- `app.report_effect_result`, and records every state change as a durable event
-- the audit drawer renders.
--
-- OBJECTS. Ten tables, one security-invoker view, thirty functions (thirty-one
-- pg_proc rows - app.emit_event has two overloads), the 18-row
-- `app.job_type_map` seed, and one RLS policy (the global catalogue's
-- definer-read, justified at its DDL). No new type: the effect seam REUSES
-- 011's app.effect_status, and $verify$ asserts that by pg_type oid.
--
--   core.events              §1.1  append-only, by trigger AND by revoke
--   core.event_subjects      §1.2  the audit drawer's index, with H-26's
--                                  denormalised occurred_at
--   app.event_redactions     C-09  the audit of the one narrow erasure exemption
--   app.event_subscriptions  §1.4  event -> job routing, as data
--   app.outbox               §2.2  the job ledger
--   app.job_type_map         §2.3a action type -> handler, as data
--   app.dead_letters         §2.8
--   app.submission_counters  M-20  the per-subject submission-attempt counter
--   app.webhook_deliveries   §4.2
--   app.webhook_routes       §4.3
--   core.audit_entries       §5.1  the drawer view, security_invoker = true
--
-- ── FINDINGS CLOSED HERE, WITH THEIR MECHANICAL EVIDENCE ──────────────────
--
--   C-07  Five reapers, not a table of promises: app.reap_webhook_bodies (30d),
--         app.reap_webhook_deliveries (1y), app.reap_outbox (90d SUCCEEDED),
--         app.reap_dead_letters (replayed + 1y) and app.reap_cron_history (7d).
--         Every one is batched, takes a LIMIT, uses FOR UPDATE SKIP LOCKED, and
--         RETURNS the number of rows it touched so 015 can alarm on a reaper
--         that silently stops. The SCHEDULES are 015's; the FUNCTIONS are here.
--         app.reap_cron_history guards on to_regclass and returns 0 rather than
--         raising where pg_cron is absent, because a retention sweep must not be
--         the thing that fails a cron tick.
--
--   C-08  Poison-pill retry is closed on BOTH halves, because either alone
--         leaves the loop open. app.claim_jobs carries
--         `AND j.attempts < j.max_attempts` in its candidate predicate, so a job
--         at its ceiling is not claimable. app.reap_jobs routes an expired lease
--         whose attempts have reached the ceiling to DEAD plus a dead letter
--         plus a FAILED effect report, instead of returning it to QUEUED. The
--         same branch exists on the FAILED->QUEUED lane, because a job can reach
--         the ceiling through fail_job as well as through a dead isolate.
--
--   C-09  PDPA erasure. TAKEN: the narrow audited exemption, not the template
--         rewrite. WHY: `summary` is written at emit time precisely so the
--         drawer shows what was true when it happened (D8); turning it into a
--         template key plus arguments moves the sentence into a renderer that
--         must then be versioned forever, and it does not help `actor.name`,
--         which is the column an erasure request is actually about. So
--         app.redact_event_actor(tenant, event, actor, summary, redacted_by) is
--         the one path that can change a committed event. It is narrow (it can
--         change `actor` and `summary` and nothing else - the append-only
--         trigger re-derives that from the row itself, not from the function's
--         promise), audited (it writes an app.event_redactions row carrying the
--         before image, the after image, the caller and the reason, in the same
--         transaction), and callable by nobody: EXECUTE is revoked from PUBLIC,
--         anon and authenticated, and it is deliberately NOT granted to
--         service_role. Until a policy says otherwise, only the migration role
--         can erase, which is a decision a human makes rather than a request an
--         endpoint serves. A narrow audited exemption is defensible; no path at
--         all is not.
--
--   H-08  Every table 012 creates - in `core` and in `app` - is RLS-enabled AND
--         FORCED before this migration commits. The nine tenant-scoped ones go
--         through app.finalise_table, which enables and forces with zero
--         policies. The one global catalogue, app.job_type_map, gets the posture
--         004 measured for app.action_types: enabled, forced, and ONE
--         `FOR SELECT USING (true)` definer-read policy. See the note at that
--         DDL for why H-08's literal "zero policies" is not followed there.
--
--   H-12  app.fail_job's SELECT ... FOR UPDATE carries
--         `AND tenant_id = p_tenant_id AND state = 'CLAIMED'
--          AND claimed_by = p_worker`, and RAISES when not found. That is
--         app.complete_job's shape copied, not a second one invented.
--
--   H-15  All five worker functions take `p_tenant_id` explicitly. The three
--         that ADDRESS a row - complete_job, fail_job, heartbeat_job - require
--         it and RAISE when it does not match the row, so a handler holding the
--         service role cannot complete another tenant's job even with its id.
--         claim_jobs and reap_jobs take it as an optional narrowing filter,
--         because the design's worker is one global tick (D5) and a NULL there
--         means "every tenant". SAID PLAINLY, because the standing claim was
--         false and replacing it with a softer false one would be worse: on the
--         CLAIM path there is no tenant assertion to make - the claim is what
--         decides which tenant's work runs next - so isolation on that path
--         rests on the per-job validation in the other three plus the lease,
--         not on the claim itself. §8.7's test is now testable for the three
--         that can be tested, and the residue is named rather than claimed away.
--
--   H-16  Per-tenant fairness in app.claim_jobs. MECHANISM: the candidate set is
--         ranked with `row_number() OVER (PARTITION BY tenant_id ORDER BY
--         priority, run_after, id)` and the batch is taken in `(rank, priority,
--         run_after, id)` order, so every tenant's best job is taken before any
--         tenant's second. COST, stated rather than hidden: the claim is no
--         longer a pure index range-scan of `outbox_claim_idx` that stops at
--         p_limit. It scans up to `p_scan` QUEUED rows (default 20 x p_limit,
--         itself an argument), sorts them, then locks. Under a healthy queue
--         that is a handful of rows; under a 10,000-job flood from one tenant it
--         is a bounded 200-row scan and sort per tick, which is the price of the
--         starvation it prevents. p_scan is an argument so an operator can trade
--         fairness back for latency without a migration.
--
--   H-17  `outbox_health_idx ON app.outbox (tenant_id, state)` makes the
--         question askable, and app.jobs_health is the function 015 schedules as
--         `jobs-health`. It emits a `JobStalled` event per tenant that has work
--         due and whose most recent claim is older than the threshold - and,
--         deliberately, also for a tenant that has due work and has NEVER been
--         claimed, because a queue that never started looks identical to a queue
--         that stopped and is the failure mode a fresh deploy produces.
--
--   H-18  `outbox_retry_idx ON app.outbox (run_after) WHERE state = 'FAILED'`
--         exists, the OR is SPLIT into four separate statements (expired lease
--         under the ceiling, expired lease at the ceiling, elapsed backoff under
--         the ceiling, elapsed backoff at the ceiling), and every one carries
--         its own LIMIT. A provider outage that fails 50,000 jobs makes each
--         cron tick a p_limit-row update, not a 50,000-row one.
--
--   N-02  Every jsonb column 012 creates carries a CHECK that asserts KEY
--         PRESENCE with `?` and TYPE with jsonb_typeof, following doc 04's
--         pattern. core.events.actor, app.outbox.last_error and
--         app.dead_letters.dead_lettered_by included. The verify block
--         re-derives this from pg_attribute rather than trusting the DDL above:
--         a jsonb column added later with no constraint fails the migration.
--         The actor columns share ONE validator, app.is_valid_actor, and the
--         verify block asserts that validator's vocabulary equals
--         enum_range(app.actor_kind) exactly - which is N-09 closed once rather
--         than four comments that disagree.
--
--   M-07  app.outbox_payload_allowlist is applied at BOTH enqueue boundaries -
--         the event fan-out in app.emit_event and the effect path in
--         app.enqueue_effect_jobs. `core.events.payload` keeps the whole
--         payload, because the event log is the business record; the outbox copy
--         is what drains to a third party's webhook body, and it carries only
--         allowlisted keys. `body` - 011's free-text payload key - is
--         deliberately NOT on the list, and the pin asserts it is dropped.
--
--   M-09  Both app.emit_event overloads are revoked BY FULL SIGNATURE. Doc 05's
--         `revoke execute on function app.emit_event` omits the argument list
--         and errors with "function name is not unique", which would leave both
--         PUBLIC-executable - and PUBLIC does hold EXECUTE on a new function by
--         default, measured at 001. $verify$ asserts neither overload is
--         PUBLIC-, anon- or authenticated-executable.
--
--   M-14  app.heartbeat_job requires `claimed_by = p_worker` and the tenant, and
--         raises when it matches nothing. It additionally refuses an extension
--         longer than six minutes, which is §8.5's "the lease never exceeds the
--         worker lifetime" turned from a static code review into a runtime
--         refusal. app.claim_jobs refuses the same on p_lease.
--
--   M-15  `outbox_claim_typed_idx ON app.outbox (job_type, priority, run_after,
--         id) WHERE state = 'QUEUED'`.
--
--   M-16  `events_correlation_idx` on core.events (tenant_id, correlation_id),
--         `dead_letters_replayed_job_idx` and `webhook_deliveries_event_idx`.
--         Each is the composite the FK actually needs, not the single column the
--         finding names, because every FK in this pack is composite.
--
--   M-17  ONE index, not two. `events_subject_idx` and
--         `event_subjects_lookup_idx` were the same table and the same column
--         list under two names. `event_subjects_lookup_idx` survives and carries
--         H-26's ordering; `events_subject_idx` is not created.
--
--   M-20  The provider idempotency key is NOT derived from the job row. It is
--         `<subject>#<submission_attempt>`, where the subject is the effect's
--         (entity, ref) pair and the attempt is allocated once per logical
--         submission from app.submission_counters. app.replay_dead_letter COPIES
--         the original job's subject AND attempt onto the replacement job, so
--         the replacement presents the SAME key to the accounting package and
--         the provider dedupes it - which is the whole point. A genuinely new
--         submission allocates a new attempt. The pin asserts a new job id, a
--         new job_key and an UNCHANGED provider key across a replay.
--
--   M-24  CANCELLED is WRITTEN, by app.cancel_jobs, which is the agent-pause
--         path: it cancels QUEUED and FAILED jobs whose originating action
--         request was made by that agent, and never touches a CLAIMED one,
--         because cancelling a job a worker is running does not stop the worker.
--         Declared-and-never-written was the finding; it is now written and
--         pinned.
--
--   M-26  Webhook paths follow the CONTRACT: `/v1/webhooks/*`, from
--         packages/contract/src/domain/client-portal.ts INBOUND_WEBHOOKS[].path,
--         stored in app.webhook_routes.route_path with a CHECK. Doc 05 §4.1
--         routes the same four to `/functions/v1/webhook-*`. Recorded, not
--         edited: the contract is not this migration's to change, and the
--         disagreement is real until somebody rules on it. See CONTRADICTIONS.
--
--   N-09  Four actor kinds - HUMAN, AGENT, SYSTEM, CLIENT - enforced ONCE, by
--         app.is_valid_actor, on every actor jsonb column 012 creates. The
--         verify block asserts that function's vocabulary against the
--         app.actor_kind enum 003 already owns, so the two cannot drift.
--
--   H-26  core.event_subjects carries a denormalised `occurred_at`, and
--         `event_subjects_lookup_idx` is
--         (tenant_id, subject_type, subject_id, occurred_at DESC, event_id DESC)
--         - the drawer's own ordering. occurred_at is frozen by the immutability
--         trigger, so the denormalisation cannot drift from its event.
--
-- ── EXECUTABLE-SCHEMA RULINGS (R13: the migration is fact; prose is a claim) ──
--
--   * `core.runs` DOES NOT EXIST. Doc 05 declares
--     `run_id uuid references core.runs(id)` on core.events and app.outbox; 013
--     owns that table. Neither FK is created. Worse, the column's TYPE is wrong:
--     011's `core.action_requests.agent_run_id` is `text` and the demo fixture's
--     run id is the string `run_4821`, which is not a uuid. `run_id` is
--     therefore `text` on both tables. 013 must reconcile - either core.runs.id
--     is text, or it adds the mapping - and it must not silently retype this
--     column, because every event already written would lose its trace.
--
--   * `app.enqueue_effect_jobs` was described in doc 05 §2.7 as LIVE and as
--     already called by the gate "in 85cb624". It is not: no such function
--     exists in 001-011 and 011's app.apply_effects calls nothing. 012 creates
--     it. 011 is NOT edited to call it - a fix made silently in another
--     migration's file is a fix nobody can find - so the wiring is a one-line
--     call that belongs in the migration that owns the gate. Until then the
--     worker path invokes it explicitly, which is also what the pin does.
--
--   * `app.event_name_for(action_type)` is described as something sb-actions
--     "already has". It does not exist. 012 does not create it: the 3-argument
--     emit_event overload takes the event name explicitly, so the missing
--     function is not on any path here, and inventing it would put the §1.7
--     proposed-event names into the database before the contract has signed
--     them off.
--
--   * `app.job_type_map`'s `entity` values are the ones 011 ACTUALLY WRITES -
--     `Email`, `Notification`, `EvaluationLink`, `AccountingPackage`, `Message`,
--     `ComplianceRecheck` - not doc 05's `EMAIL` / `WHATSAPP` / `PDF` / `JURY`.
--     011's app.plan_effects is the only producer of effect entities and those
--     six strings are its complete EXTERNAL vocabulary. A map keyed on the
--     doc's spellings would match nothing, job_type_for would raise on every
--     real effect, and the failure would look like a correct fail-closed guard.
--
--   * `app.aggregate_type_for` derives the aggregate from
--     `app.action_types.target_entity` upper-cased, and raises on an unknown
--     action type. Doc 05 hardcodes a different mapping in places - it gives
--     AttendanceLocked the aggregate ENGAGEMENT while 004's catalogue says the
--     target entity is `attendance_day`. The catalogue wins: a hardcoded second
--     list is the divergence the project rule forbids, and the stage-name rule
--     is the same rule.
--
--   * Doc 05's `app.key_access_audit` (§5.4), realtime (§3), agent runs (§6) and
--     badge counts (§7) are NOT built here. They are 013 and 015.
--
--   * Doc 05's CANCELLED justification points at `POST /agents/{id}/pause`;
--     `core.agents` does not exist (013). app.cancel_jobs therefore identifies
--     an agent's work through `core.action_requests.requested_by_kind = 'AGENT'`
--     and `requested_by_id`, which are real columns 011 created.
--
-- ── THE RLS/DEFINER RESIDUE, CARRIED NOT CLOSED ───────────────────────────
--
-- Every table here is FORCE ROW LEVEL SECURITY with zero policies (the one
-- catalogue excepted). FORCE removes the owner's exemption, so on a platform
-- whose migration owner lacks BYPASSRLS, a SECURITY DEFINER function of 012's
-- reads ZERO ROWS from its own tables - silently. 002 measured that mechanism
-- (its four-row A/B/C/D probe) and 004 closed it for the two GLOBAL catalogues
-- by adding a `USING (true)` definer-read policy, which is safe there because
-- those tables hold nothing tenant-scoped to leak. It is NOT safe here: a
-- `USING (true)` policy on app.outbox or core.events is a cross-tenant read
-- policy, and policies land with their grants in 014. So 012 does what 011 did -
-- zero policies on the tenant-scoped tables - and this paragraph is the handover
-- note, not a claim that the problem is solved. 014 must add an owner-admitting
-- policy to each of the nine, or the worker path degrades to reading nothing.
-- This is verifiable today only where the cluster's owner is not a superuser,
-- which the local harness's is; it is therefore recorded, not measured here.
--
-- ── AUTHORIZATION ────────────────────────────────────────────────────────
--   Nothing is granted to anon or authenticated - no table, view, sequence or
--   function. C-04 residue, carried from 010 and 011. Policies and client grants
--   land together in 014.
--   service_role receives EXECUTE on exactly the worker surface: claim_jobs,
--   heartbeat_job, complete_job, fail_job, reap_jobs, enqueue_effect_jobs,
--   cancel_jobs, replay_dead_letter and record_webhook_delivery. It receives
--   nothing else - not emit_event (the worker reaches it through complete_job),
--   not any reaper (015's cron runs as the scheduler role), and not
--   redact_event_actor (C-09).
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope: no client-callable RPC is added. Every function here is either
--      a worker entry point held by service_role or an internal callee. Nothing
--      returns an envelope, so app.ok/app.err are not involved.
--   2. Unwrap: app.record_webhook_delivery returns a bare jsonb status object
--      to an Edge Function, not to a browser, and does not cross the RPC
--      boundary the 037 mechanism describes.
--   3. RpcMap: no entries. The four `/v1/webhooks/*` rows already exist in
--      packages/contract; 012 adds no callable path.
--   4. Call sites: app.report_effect_result (011) is called by complete_job,
--      fail_job and reap_jobs. app.finalise_table (004) is called ten times.
--      app.emit_event is called by complete_job, record_webhook_delivery and
--      jobs_health.
--   5. Casts: `app.effect_status_for_job_state` is the ONLY place a job outcome
--      becomes an app.effect_status, and it raises on anything that is not a
--      terminal reportable job state. R14 in its prescribed shape.
--   6. Reload/restore: no client-visible behaviour.
--   7. Public routes: none. anon receives nothing.
--
-- SPINE: untouched. 011's envelope, gate and effect ledger are read and written
-- through 011's own named functions; no branch is added to app.perform_action,
-- and no trigger of 011's is altered. Pipeline configuration is not touched.
--
-- Rollback: rollbacks/012_events_outbox_and_jobs_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ 1 · Shared validators ══════════════════════════════════════════════════

-- N-09 and N-02, closed in one place. Every actor jsonb column in this pack
-- points its CHECK at this function, so there is one vocabulary rather than four
-- comments that disagree. The four kinds are doc 02 §0's cross-lane convention
-- and 003's app.actor_kind enum; $verify$ asserts this list equals that enum's
-- members exactly, so the two cannot drift without failing the migration.
--
-- IMMUTABLE because a CHECK constraint requires it. That is also why the four
-- kinds are written here rather than read from pg_enum: reading the catalogue
-- would make the function STABLE and unusable in a constraint. The assertion in
-- $verify$ is what keeps the copy honest.
CREATE OR REPLACE FUNCTION app.is_valid_actor(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'object'
     AND p_value ? 'kind'
     AND p_value ? 'id'
     AND p_value ? 'name'
     AND pg_catalog.jsonb_typeof(p_value -> 'kind') = 'string'
     AND pg_catalog.jsonb_typeof(p_value -> 'id') = 'string'
     AND pg_catalog.jsonb_typeof(p_value -> 'name') IN ('string', 'null')
     AND p_value ->> 'kind' IN ('HUMAN', 'AGENT', 'SYSTEM', 'CLIENT');
$fn$;

COMMENT ON FUNCTION app.is_valid_actor(jsonb) IS
  'The ONE actor-shape rule (N-02, N-09): an object carrying kind, id and name, '
  'with kind one of the four app.actor_kind members. Every actor jsonb CHECK in '
  '012 calls this. A name may be JSON null - a CLIENT actor has no row in any '
  'user table - but the KEY must be present, because absent and null are '
  'different bugs and only one of them is a shape error.';

-- The append-only trigger's exemption test, C-09. It re-derives what changed
-- from the ROW rather than trusting app.redact_event_actor to have kept its own
-- promise: an update that touches anything but `actor` and `summary` is refused
-- even when it arrives through the exempted path.
CREATE OR REPLACE FUNCTION app.event_row_is_redaction_only(p_old jsonb, p_new jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT (p_old - 'actor' - 'summary' - 'updated_at')
       = (p_new - 'actor' - 'summary' - 'updated_at');
$fn$;

-- §1.1's append-only enforcement, with C-09's one exemption wired through a
-- transaction-local GUC that app.redact_event_actor sets and clears. Three
-- things must all hold or the mutation is refused: the GUC names THIS event id,
-- the operation is an UPDATE, and nothing outside actor/summary moved. A DELETE
-- is refused unconditionally - erasure is a redaction, never a removal, because
-- a missing row in an append-only log is indistinguishable from one that was
-- never written.
CREATE OR REPLACE FUNCTION app.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(pg_catalog.current_setting('app.event_redaction', true), '')
         = NEW.id::text
     AND app.event_row_is_redaction_only(pg_catalog.to_jsonb(OLD),
                                         pg_catalog.to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    '%.% is append-only (attempted %)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = '0A000',
          DETAIL  = pg_catalog.jsonb_build_object(
                      'code', 'APPEND_ONLY_VIOLATION')::text;
END;
$fn$;

COMMENT ON FUNCTION app.reject_mutation() IS
  'BEFORE UPDATE OR DELETE on core.events. Raises 0A000. The ONE exemption is '
  'C-09''s audited redaction: the app.event_redaction GUC must name this exact '
  'row AND the update must move nothing but actor and summary, which is checked '
  'against the row rather than assumed from the caller.';

-- R14, in the shape root CLAUDE.md prescribes. This is the ONLY place a job
-- outcome becomes a value in 011's vocabulary. A two-branch CASE here is what
-- recorded every delivered email as dead-lettered; an unrecognised job state
-- raises instead, and the argument is text precisely so a job state that is not
-- reportable at all (QUEUED, CLAIMED, FAILED, CANCELLED) reaches the raise
-- rather than being silently unrepresentable.
CREATE OR REPLACE FUNCTION app.effect_status_for_job_state(p_state text)
RETURNS app.effect_status
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
BEGIN
  IF p_state IS NULL THEN
    RAISE EXCEPTION 'job state NULL is not reportable to app.report_effect_result'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  CASE p_state
    WHEN 'SUCCEEDED' THEN RETURN 'SUCCEEDED'::app.effect_status;
    WHEN 'DEAD'      THEN RETURN 'FAILED'::app.effect_status;
    ELSE
      RAISE EXCEPTION
        'job state ''%'' is not a terminal reportable outcome; only SUCCEEDED and '
        'DEAD cross the sb-actions seam', p_state
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$fn$;

COMMENT ON FUNCTION app.effect_status_for_job_state(text) IS
  'The 011/012 seam, one direction. Job outcomes are mine; effect states are '
  'theirs (doc 05 s2.7). SUCCEEDED -> SUCCEEDED and DEAD -> FAILED are the only '
  'two crossings; a transient failure calls nothing at all, so every failure '
  'that reaches app.report_effect_result is terminal by construction. Anything '
  'else RAISES. Its return type IS app.effect_status - 011''s enum, not a copy - '
  'and $verify$ asserts that by pg_type oid.';

-- M-07. The outbox copy of a payload is what drains into a third party's webhook
-- body, and both app.outbox and core.events are append-only forever. The event
-- keeps the whole payload because it is the business record; the JOB carries
-- only these keys.
--
-- The list is 011's own core.action_requests payload vocabulary plus the six
-- envelope keys app.emit_event and app.enqueue_effect_jobs add, MINUS `body`.
-- `body` is 011's free-text key (PROPOSAL_SEND, BROADCAST_SEND) and is exactly
-- the thing that must not leave the database in a job payload. Adding a key here
-- is a deliberate act with a reviewer; the default is that a new key does not
-- travel.
CREATE OR REPLACE FUNCTION app.outbox_payload_allowlist(p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT COALESCE(
    (SELECT pg_catalog.jsonb_object_agg(entry.key, entry.value)
       FROM pg_catalog.jsonb_each(COALESCE(p_payload, '{}'::jsonb)) AS entry
      WHERE entry.key = ANY (ARRAY[
        -- 011's action payload vocabulary, minus `body`
        'reason','channel','amount','stage','agentId','actionType','level',
        'requestedCap','claimReference','id','organisationId','engagementId',
        'category','runId','status','sellPriceSen','discountAuthorityExceeded',
        'resultingMarginRate','method','externalReference','contactId',
        'approverRole','valueThresholdSen','minConfidence',
        -- the envelope 012 adds at the boundary
        'eventType','aggregateRef','aggregateId','effectId','seq','entity',
        'op','subject','submissionAttempt','providerIdempotencyKey',
        'replayedFrom'])),
    '{}'::jsonb);
$fn$;

COMMENT ON FUNCTION app.outbox_payload_allowlist(jsonb) IS
  'M-07. Drops every key not on the list, rather than redacting named ones: a '
  'denylist fails open on the next key somebody adds. `body` is deliberately '
  'absent - it is 011''s free-text payload key and the reason this function '
  'exists.';

-- ═══ 2 · core.events and core.event_subjects ════════════════════════════════

CREATE TABLE core.events (
  id              uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,

  -- classification
  type            text        NOT NULL CHECK (NULLIF(pg_catalog.btrim(type), '') IS NOT NULL),
  aggregate_type  text        NOT NULL CHECK (aggregate_type ~ '^[A-Z][A-Z0-9_]*$'),
  aggregate_id    uuid        NOT NULL,
  aggregate_ref   text,

  -- content
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  summary         text        NOT NULL,
  actor           jsonb       NOT NULL,

  -- lineage. `run_id` is TEXT, not uuid, and has no FK: see the ruling in the
  -- header. 011's core.action_requests.agent_run_id is text and the demo run id
  -- is `run_4821`.
  correlation_id  uuid        NOT NULL,
  causation_id    uuid,
  run_id          text,

  -- delivery
  idempotency_key text,
  occurred_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  seq             bigint      GENERATED ALWAYS AS IDENTITY,

  -- mechanical, required by app.finalise_table
  created_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT events_payload_shape CHECK (
    pg_catalog.jsonb_typeof(payload) = 'object'),
  CONSTRAINT events_actor_shape CHECK (app.is_valid_actor(actor))
);

COMMENT ON TABLE core.events IS
  'The domain event log (doc 05 s1.1). Append-only by trigger AND by revoke, and '
  'retained indefinitely - the HRD Corp claim window runs to six months after '
  'delivery and Malaysian record-keeping to seven years, so deleting this table '
  'is a compliance decision and not an ops one. tenant_id is NOT NULL with no '
  'exception: a global rule change affecting four tenants emits four events, '
  'because a null-tenant event appears in no audit drawer. The ONE path that can '
  'change a committed row is app.redact_event_actor (C-09).';

COMMENT ON COLUMN core.events.run_id IS
  'TEXT, not uuid, and no FK. Doc 05 writes `uuid references core.runs(id)`; '
  'core.runs is 013''s and does not exist, and 011''s agent_run_id is text '
  '(`run_4821`). 013 must reconcile rather than retype - every event already '
  'written would lose its trace.';

SELECT app.finalise_table('core','events',false,NULL,
  ARRAY['type','aggregate_type','aggregate_id','aggregate_ref','payload',
        'correlation_id','causation_id','run_id','idempotency_key','occurred_at']);

-- Append-only, both halves. The trigger is the enforcement; the revoke is the
-- belt. service_role is named explicitly because finalise_table revokes from
-- PUBLIC, anon and authenticated only, and service_role is the role a worker
-- actually holds.
CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON core.events
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- ⚠ MEASURED, NOT REASONED. A FOR EACH ROW trigger does not fire for TRUNCATE -
-- TRUNCATE is not a DELETE - so the row trigger above leaves the whole log
-- removable in one statement by anyone who can truncate it. Found by executing
-- the rollback, not by reading the DDL: the pre-flight guard's first draft told
-- an operator to clear the table and the only spelling that actually worked was
-- the one that defeats the guarantee. A STATEMENT-level trigger is the half that
-- closes it. DROP TABLE is still possible and is deliberately left so, because
-- the rollback needs it and dropping a table is not a silent act.
CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON core.events
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON core.events FROM service_role;

-- Tenant-wide feeds, keyset paginated (doc 05 s1.1).
CREATE INDEX events_tenant_time_idx
  ON core.events (tenant_id, occurred_at DESC, id DESC);

-- Catalogue filters: every ApprovalRequested this month.
CREATE INDEX events_tenant_type_time_idx
  ON core.events (tenant_id, type, occurred_at DESC);

-- Dedupe. Partial, so the index holds only keyed events - and it is the
-- ON CONFLICT target app.emit_event names, which is what makes an
-- Idempotency-Key replay return the original event and enqueue no second job.
CREATE UNIQUE INDEX events_idempotency_idx
  ON core.events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- M-16. correlation_id is NOT NULL, is the basis of every run trace, and is
-- what doc 05 s8.7 tests. Composite because every lookup is already inside one
-- tenant and the tenant column is free at the front of the key.
CREATE INDEX events_correlation_idx
  ON core.events (tenant_id, correlation_id, occurred_at);

CREATE INDEX events_run_idx ON core.events (tenant_id, run_id)
  WHERE run_id IS NOT NULL;

-- The GIN index over payload is deliberately NOT created. Nothing in the twenty
-- screens queries an event by payload contents; it would cost write throughput
-- for a query that does not exist. Doc 05 s1.1 leaves it commented out for the
-- same reason, and this line is here so the omission reads as a decision.

CREATE TABLE core.event_subjects (
  -- `id` is mechanical: app.finalise_table needs (tenant_id, id) to exist so
  -- that every FK into this table can be composite. Doc 05's natural key
  -- (event_id, subject_type, subject_id) survives as the UNIQUE below, which is
  -- what app.emit_event's ON CONFLICT DO NOTHING resolves against.
  id           uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  event_id     uuid        NOT NULL,
  subject_type text        NOT NULL CHECK (subject_type ~ '^[A-Z][A-Z0-9_]*$'),
  subject_id   uuid        NOT NULL,
  role         text        NOT NULL DEFAULT 'SUBJECT'
                           CHECK (role IN ('SUBJECT','RELATED')),
  -- H-26. Denormalised from the event so the drawer's keyset ordering has an
  -- index to walk. Frozen by the immutability trigger below, so it cannot drift.
  occurred_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT event_subjects_natural_key UNIQUE (event_id, subject_type, subject_id),
  CONSTRAINT event_subjects_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES core.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.event_subjects IS
  'The audit drawer''s index (doc 05 s1.2). Involvement is normalised because '
  'an OR across aggregate_id and a second column cannot use an index: '
  'ApprovalDecided has aggregate APPROVAL and belongs in the proposal''s drawer '
  'too. app.emit_event writes the aggregate as SUBJECT and every p_related entry '
  'as RELATED.';

SELECT app.finalise_table('core','event_subjects',false,NULL,
  ARRAY['event_id','subject_type','subject_id','role','occurred_at']);

-- M-17 + H-26. ONE index, carrying the drawer's own ordering. doc 05 declared
-- this same table and column list twice, as `events_subject_idx` (s1.1) and
-- `event_subjects_lookup_idx` (s1.2); only this one is created, and it keys on
-- occurred_at rather than on a random uuid, so `order by at desc, id desc` is a
-- walk rather than a sort of the record's entire history.
CREATE INDEX event_subjects_lookup_idx
  ON core.event_subjects (tenant_id, subject_type, subject_id,
                          occurred_at DESC, event_id DESC);

-- Serves the composite FK and the ON DELETE CASCADE.
CREATE INDEX event_subjects_event_idx
  ON core.event_subjects (tenant_id, event_id);

-- ═══ 3 · C-09 · the one audited erasure path ════════════════════════════════

CREATE TABLE app.event_redactions (
  id            uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  event_id      uuid        NOT NULL,
  before_actor  jsonb       NOT NULL,
  before_summary text       NOT NULL,
  after_actor   jsonb       NOT NULL,
  after_summary text        NOT NULL,
  reason        text        NOT NULL CHECK (NULLIF(pg_catalog.btrim(reason), '') IS NOT NULL),
  redacted_by   jsonb       NOT NULL,
  redacted_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_at    timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at    timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT event_redactions_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES core.events (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT event_redactions_before_actor_shape CHECK (app.is_valid_actor(before_actor)),
  CONSTRAINT event_redactions_after_actor_shape  CHECK (app.is_valid_actor(after_actor)),
  CONSTRAINT event_redactions_redacted_by_shape  CHECK (app.is_valid_actor(redacted_by))
);

COMMENT ON TABLE app.event_redactions IS
  'C-09. The audit of the ONE exemption to core.events being append-only. It '
  'carries the before image as well as the after, because an erasure that leaves '
  'no record of what was erased is indistinguishable from tampering. In `app`, '
  'not `core`: the drawer must not render it.';

SELECT app.finalise_table('app','event_redactions',false,NULL,
  ARRAY['event_id','before_actor','before_summary','after_actor','after_summary',
        'reason','redacted_by','redacted_at']);

CREATE INDEX event_redactions_event_idx
  ON app.event_redactions (tenant_id, event_id);

-- ═══ 4 · app.event_subscriptions · event -> job routing ═════════════════════

CREATE TABLE app.event_subscriptions (
  id          uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  event_type  text        NOT NULL,
  job_type    text        NOT NULL,
  -- NULL = every tenant. finalise_table only requires the column to exist.
  tenant_id   uuid        REFERENCES public.tenants(id) ON DELETE CASCADE,
  priority    smallint    NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 9),
  delay       interval    NOT NULL DEFAULT interval '0' CHECK (delay >= interval '0'),
  enabled     boolean     NOT NULL DEFAULT true,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT event_subscriptions_key UNIQUE NULLS NOT DISTINCT
    (event_type, job_type, tenant_id)
);

COMMENT ON TABLE app.event_subscriptions IS
  'Routing is data, not code (doc 05 s1.4), so adding a side effect to an event '
  'is an insert rather than a deploy. `delay` is what schedules an SLA '
  'escalation. UNIQUE NULLS NOT DISTINCT because doc 05''s plain UNIQUE does not '
  'constrain the global (tenant_id NULL) rows at all - two identical '
  'every-tenant subscriptions would both be accepted and every event would '
  'enqueue the job twice. NO ROWS ARE SEEDED: the s1.7 catalogue additions need '
  'contract sign-off, and seeding a routing table before the events it routes '
  'are agreed is how a job type nobody implemented starts being enqueued.';

SELECT app.finalise_table('app','event_subscriptions',false,NULL,
  ARRAY['event_type','job_type']);

CREATE INDEX event_subscriptions_lookup
  ON app.event_subscriptions (event_type, tenant_id) WHERE enabled;

-- ═══ 5 · app.outbox · the job ledger ════════════════════════════════════════

CREATE TABLE app.outbox (
  id                 uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,

  job_type           text        NOT NULL,
  state              text        NOT NULL DEFAULT 'QUEUED'
                       CHECK (state IN ('QUEUED','CLAIMED','SUCCEEDED','FAILED','DEAD','CANCELLED')),
  priority           smallint    NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 9),
  payload            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- provenance
  event_id           uuid,
  run_id             text,
  action_request_id  uuid,
  correlation_id     uuid        NOT NULL,
  effect_id          bigint,
  job_key            text,

  -- M-20. The provider idempotency key is `<subject>#<submission_attempt>` and
  -- is NEVER derived from `id`: a replay is a new row with a new id and must
  -- present the SAME key to the provider or the invoice is pushed twice.
  idempotency_subject text,
  submission_attempt  integer    CHECK (submission_attempt IS NULL OR submission_attempt >= 1),

  -- scheduling and lease
  run_after          timestamptz NOT NULL DEFAULT pg_catalog.now(),
  claimed_at         timestamptz,
  claimed_by         text,
  visible_after      timestamptz,
  attempts           int         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts       int         NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),

  -- outcome
  result             jsonb,
  last_error         jsonb,

  created_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  finished_at        timestamptz,

  CONSTRAINT outbox_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES core.events (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT outbox_action_fk FOREIGN KEY (tenant_id, action_request_id)
    REFERENCES core.action_requests (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT outbox_effect_fk FOREIGN KEY (tenant_id, effect_id)
    REFERENCES app.action_effects (tenant_id, id) ON DELETE RESTRICT,

  -- doc 05 s2.7. An action-derived job ALWAYS has an effect to report against,
  -- which is what makes `if effect_id is not null` in complete_job safe, and an
  -- event-derived job never calls into sb-actions at all.
  CONSTRAINT outbox_effect_path_complete CHECK (
    action_request_id IS NULL OR (job_key IS NOT NULL AND effect_id IS NOT NULL)),
  -- M-20's two columns travel together or not at all.
  CONSTRAINT outbox_submission_pair CHECK (
    (idempotency_subject IS NULL) = (submission_attempt IS NULL)),
  -- A lease is claimed_at + claimed_by + visible_after, or none of the three.
  CONSTRAINT outbox_lease_complete CHECK (
    (state <> 'CLAIMED')
    OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL AND visible_after IS NOT NULL)),
  CONSTRAINT outbox_terminal_finished CHECK (
    (state IN ('SUCCEEDED','DEAD','CANCELLED')) = (finished_at IS NOT NULL)),
  CONSTRAINT outbox_payload_shape CHECK (
    pg_catalog.jsonb_typeof(payload) = 'object'),
  CONSTRAINT outbox_result_shape CHECK (
    result IS NULL OR pg_catalog.jsonb_typeof(result) = 'object'),
  -- N-02. The shape 011's app.report_effect_result requires of a terminal
  -- failure, asserted at the column rather than discovered at the seam. The
  -- typeof on `retryable` is the half doc 04 s735's legacy-jury case teaches:
  -- {"code":"X","message":"Y","retryable":"maybe"} satisfies key presence and
  -- still explodes at `(p_error->>'retryable')::boolean`.
  CONSTRAINT outbox_last_error_shape CHECK (
    last_error IS NULL OR (
      pg_catalog.jsonb_typeof(last_error) = 'object'
      AND last_error ? 'code' AND last_error ? 'message' AND last_error ? 'retryable'
      AND pg_catalog.jsonb_typeof(last_error -> 'code') = 'string'
      AND pg_catalog.jsonb_typeof(last_error -> 'message') = 'string'
      AND pg_catalog.jsonb_typeof(last_error -> 'retryable') = 'boolean'))
);

COMMENT ON TABLE app.outbox IS
  'The job ledger (doc 05 s2.2, D3). Not pgmq: the ledger is a UI-visible entity '
  'here - dead letters, the agent-failure badge, retry-from-checkpoint - and a '
  'pgmq queue table is neither tenant-indexed nor typed, so every UI query would '
  'become a jsonb expression scan across N queue tables. RLS is enabled AND '
  'FORCED with zero policies: zero policies denies authenticated as well as '
  'anon, FORCE removes the owner''s exemption, and service_role still bypasses, '
  'which is the intent. Schema `app` also stays out of the PostgREST exposed '
  'list. ACCEPTED SECURITY-ADVISOR FINDING: "RLS enabled with no policies" is '
  'the posture, not a defect - nobody closes it by adding a permissive policy.';

COMMENT ON COLUMN app.outbox.idempotency_subject IS
  'M-20. The logical thing being submitted (`Invoice:<uuid>`), not the job. With '
  'submission_attempt it forms the provider idempotency key, so a replayed '
  'dead letter presents the same key and the provider dedupes it.';

SELECT app.finalise_table('app','outbox',false,NULL,
  ARRAY['job_type','correlation_id','action_request_id','effect_id','job_key',
        'idempotency_subject','submission_attempt','max_attempts']);

-- The claim (doc 05 s2.2). Partial, because a healthy queue is nearly empty.
CREATE INDEX outbox_claim_idx ON app.outbox (priority, run_after, id)
  WHERE state = 'QUEUED';

-- M-15. A worker asking for a rare type otherwise scans the whole QUEUED index.
CREATE INDEX outbox_claim_typed_idx
  ON app.outbox (job_type, priority, run_after, id)
  WHERE state = 'QUEUED';

-- The lease reaper.
CREATE INDEX outbox_lease_idx ON app.outbox (visible_after)
  WHERE state = 'CLAIMED';

-- H-18. The second predicate of doc 05's ORed reaper had nothing to serve it:
-- outbox_failed_idx is keyed on finished_at desc and a FAILED row's finished_at
-- is NULL. This is that index.
CREATE INDEX outbox_retry_idx ON app.outbox (run_after)
  WHERE state = 'FAILED';

-- Badge counts and the failure list.
CREATE INDEX outbox_failed_idx ON app.outbox (tenant_id, finished_at DESC)
  WHERE state IN ('FAILED','DEAD');

-- H-17. Makes "has this tenant's queue stopped?" an askable question.
CREATE INDEX outbox_health_idx ON app.outbox (tenant_id, state);

-- Dedupe. sb-actions' one hard requirement, and the entire retry-safety story:
-- a redelivered job cannot send a second proposal email or push a second
-- invoice.
CREATE UNIQUE INDEX outbox_job_key_idx ON app.outbox (tenant_id, job_key)
  WHERE job_key IS NOT NULL;

-- Foreign keys. Composite and partial: composite because every FK in this model
-- is (tenant_id, parent_id), partial because event fan-out jobs have no action
-- and action jobs have no event.
CREATE INDEX outbox_event_idx ON app.outbox (tenant_id, event_id)
  WHERE event_id IS NOT NULL;
CREATE INDEX outbox_action_idx ON app.outbox (tenant_id, action_request_id)
  WHERE action_request_id IS NOT NULL;
CREATE INDEX outbox_effect_idx ON app.outbox (tenant_id, effect_id)
  WHERE effect_id IS NOT NULL;
CREATE INDEX outbox_run_idx ON app.outbox (tenant_id, run_id)
  WHERE run_id IS NOT NULL;

-- M-20's counter lookup, and the reaper's SUCCEEDED sweep.
CREATE INDEX outbox_subject_idx ON app.outbox (tenant_id, idempotency_subject)
  WHERE idempotency_subject IS NOT NULL;
CREATE INDEX outbox_succeeded_idx ON app.outbox (finished_at)
  WHERE state = 'SUCCEEDED';

-- ═══ 6 · app.job_type_map · action type -> handler, as data ═════════════════

CREATE TABLE app.job_type_map (
  action_type text     NOT NULL REFERENCES app.action_types(key) ON DELETE RESTRICT,
  entity      text     NOT NULL DEFAULT '*',
  job_type    text     NOT NULL,
  priority    smallint NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 9),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (action_type, entity)
);

COMMENT ON TABLE app.job_type_map IS
  'Action type + effect entity -> handler key (doc 05 s2.3a). GLOBAL, not '
  'tenant-scoped, for the same reason app.action_types is: this is the product''s '
  'wiring, not a per-customer setting. A CASE would return NULL for an unmapped '
  'action type and enqueue a job no worker ever claims, which sits at QUEUED '
  'until somebody notices the badge; a table plus a raising lookup fails closed '
  'at enqueue time instead. The FK onto app.action_types is what stops a typo in '
  'the action half. ENTITY VALUES ARE 011''S, NOT DOC 05''S: app.plan_effects '
  'writes Email, Notification, EvaluationLink, AccountingPackage, Message and '
  'ComplianceRecheck, and a map keyed on the doc''s EMAIL/WHATSAPP/PDF would '
  'match nothing while looking correct.';

-- H-08 says "zero policies" for a table that is not tenant-scoped. This ONE
-- table does not follow that, and the reason is measured rather than preferred.
-- app.job_type_for is SECURITY DEFINER and reads this table; FORCE removes the
-- owner's exemption, so with no policy the read returns zero rows on any
-- platform whose migration owner lacks BYPASSRLS, job_type_for raises for every
-- action, and every external effect in the product stops being enqueued - while
-- looking exactly like a correct fail-closed guard. 002 measured that mechanism
-- (A/B/C/D at its principal_claims note) and 004 took the same decision for
-- app.action_types, which this table is the sibling of. The guard is the GRANT
-- layer: no client role holds SELECT, `app` is not a PostgREST-exposed schema,
-- and there is nothing tenant-scoped here to leak - the catalogue is identical
-- for every tenant. CLAUDE.md security rule 2 prescribes exactly this shape and
-- requires the file to say so at the DDL, which is what this paragraph is.
ALTER TABLE app.job_type_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.job_type_map FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.job_type_map FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS job_type_map_definer_read ON app.job_type_map;
CREATE POLICY job_type_map_definer_read ON app.job_type_map
  FOR SELECT USING (true);

-- The seed. Eighteen rows: twelve '*' rows, four channel rows for the four
-- action types doc 05 splits by channel, and two entity overrides where 011's
-- real external effect is not the thing the '*' row dispatches.
--
-- PROPOSAL_SEND, FOLLOWUP_SEND, REMINDER_SEND and BROADCAST_SEND deliberately
-- have NO '*' row. Doc 05 splits them by channel and gives them no fallback, and
-- that is right: an unrecognised channel on a send must raise, not silently
-- become email.
INSERT INTO app.job_type_map (action_type, entity, job_type, priority, note) VALUES
  ('PROPOSAL_SEND','Email','SEND_EMAIL',1,
   '011 plan_effects emits entity Email for the send effect. No * row: an '
   'unrecognised channel must raise rather than default to email.'),
  ('FOLLOWUP_SEND','Message','SEND_EMAIL',1,
   '011 emits entity Message; the channel lives in the payload, not the entity.'),
  ('REMINDER_SEND','Message','SEND_EMAIL',1,'Collections stages 1-3.'),
  ('BROADCAST_SEND','Message','SEND_EMAIL',9,
   'Batch: many recipients, nobody waiting.'),
  ('ENGAGEMENT_CLOSE_OUT','EvaluationLink','SEND_EMAIL',5,
   'ENTITY OVERRIDE. The * row re-evaluates compliance; the EXTERNAL effect 011 '
   'actually writes is "Send evaluation links", which is an email.'),
  ('ATTENDANCE_UNLOCK','Notification','NOTIFY_OWNER',1,
   'ENTITY OVERRIDE. The * row re-assembles the packet; the EXTERNAL effect 011 '
   'writes is "Notify operations and finance".'),
  ('INVOICE_CREATE','*','PUSH_INVOICE',1,
   'Creates the draft in the accounting package.'),
  ('INVOICE_PUSH','*','PUSH_INVOICE',1,
   'Same handler, different action; the payload carries which.'),
  ('PAYMENT_RECORD','*','PUSH_INVOICE',1,
   'Payment application is a push to the same provider.'),
  ('HRDC_PACKET_MARK_SUBMITTED','*','HRDC_PACKET_ASSEMBLE',5,
   'Re-assembles and exports the packet.'),
  ('ATTENDANCE_APPROVE','*','HRDC_PACKET_ASSEMBLE',5,
   'Locking attendance completes a packet document.'),
  ('ENGAGEMENT_CLOSE_OUT','*','COMPLIANCE_CHECK_EVALUATE',5,
   'Final stage transition re-evaluates.'),
  ('ATTENDANCE_UNLOCK','*','HRDC_PACKET_ASSEMBLE',1,
   'Voids and re-assembles; priority 1 because a claim is at stake.'),
  ('TRAINER_BOOK','*','SEND_EMAIL',1,
   'The trainer confirmation is the external effect.'),
  ('RULE_CHANGE_APPROVE','*','COMPLIANCE_CHECK_EVALUATE',5,
   'Re-evaluates every affected engagement.'),
  ('BUDGET_CAP_RAISE','*','USAGE_ROLLUP',9,
   'Recomputes budget state after the cap moves.'),
  ('AGENT_PAUSE','*','USAGE_ROLLUP',9,NULL),
  ('ACCOUNT_TRADING_HOLD','*','NOTIFY_OWNER',1,
   'MD-gated (FIN-05). The account flag is in-database; the notification is the '
   'external effect. Telling the CLIENT is a commercial decision, not a '
   'mechanical consequence, and is deliberately not mapped.');

-- The lookup. Raises; job_priority_for does not. The asymmetry is deliberate: a
-- missing handler is unrecoverable because the job would never run, so it must
-- stop the transaction. A missing priority is a scheduling preference, and
-- refusing to enqueue a real effect over it would be worse than running it at
-- normal priority.
CREATE OR REPLACE FUNCTION app.job_type_for(p_action_type text, p_entity text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_job_type text;
BEGIN
  -- Exact entity first, then the '*' fallback. Two statements rather than one
  -- ORDER BY, so the precedence is legible instead of implied by a sort key.
  SELECT entry.job_type INTO v_job_type
    FROM app.job_type_map AS entry
   WHERE entry.action_type = p_action_type
     AND entry.entity = COALESCE(p_entity, '*');

  IF v_job_type IS NULL THEN
    SELECT entry.job_type INTO v_job_type
      FROM app.job_type_map AS entry
     WHERE entry.action_type = p_action_type
       AND entry.entity = '*';
  END IF;

  IF v_job_type IS NULL THEN
    RAISE EXCEPTION
      'no job_type mapped for action_type=% entity=%; add a row to app.job_type_map',
      p_action_type, COALESCE(p_entity, '*')
      USING ERRCODE = 'no_data_found',
            HINT = 'An action type with an external effect must have a handler.';
  END IF;

  RETURN v_job_type;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.job_priority_for(p_action_type text, p_entity text DEFAULT NULL)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(
    (SELECT entry.priority FROM app.job_type_map AS entry
      WHERE entry.action_type = p_action_type
        AND entry.entity = COALESCE(p_entity, '*')),
    (SELECT entry.priority FROM app.job_type_map AS entry
      WHERE entry.action_type = p_action_type AND entry.entity = '*'),
    5::smallint);
$fn$;

-- The aggregate for an action-derived event. DATA-DRIVEN, from 004's catalogue,
-- because a second hardcoded list is the divergence the project rule forbids -
-- the same rule that keeps stage names in pipeline configuration. Doc 05 maps
-- some of these differently in prose (it gives AttendanceLocked the aggregate
-- ENGAGEMENT while the catalogue's target entity is attendance_day); the
-- catalogue wins.
CREATE OR REPLACE FUNCTION app.aggregate_type_for(p_action_type text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_entity text;
BEGIN
  SELECT catalogue.target_entity INTO v_entity
    FROM app.action_types AS catalogue
   WHERE catalogue.key = p_action_type;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'unknown action type ''%''; no aggregate type can be derived',
      p_action_type
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN pg_catalog.upper(v_entity);
END;
$fn$;

-- ═══ 7 · app.dead_letters and the M-20 submission counter ═══════════════════

CREATE TABLE app.dead_letters (
  id                uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  origin            text        NOT NULL CHECK (origin IN ('JOB','RUN','WEBHOOK')),
  origin_id         uuid        NOT NULL,
  job_type          text,
  event_type        text,
  reason            text        NOT NULL
                    CHECK (NULLIF(pg_catalog.btrim(reason), '') IS NOT NULL),
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_error        jsonb,
  attempts          int         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- M-20. Carried forward so a replay can present the SAME provider key.
  idempotency_subject text,
  submission_attempt  integer   CHECK (submission_attempt IS NULL OR submission_attempt >= 1),
  dead_lettered_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  dead_lettered_by  jsonb       NOT NULL,
  replayed_at       timestamptz,
  replayed_job_id   uuid,
  created_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT dead_letters_replay_fk FOREIGN KEY (tenant_id, replayed_job_id)
    REFERENCES app.outbox (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT dead_letters_replay_pair CHECK (
    (replayed_at IS NULL) = (replayed_job_id IS NULL)),
  CONSTRAINT dead_letters_payload_shape CHECK (
    pg_catalog.jsonb_typeof(payload) = 'object'),
  CONSTRAINT dead_letters_last_error_shape CHECK (
    last_error IS NULL OR (
      pg_catalog.jsonb_typeof(last_error) = 'object'
      AND last_error ? 'code' AND last_error ? 'message' AND last_error ? 'retryable'
      AND pg_catalog.jsonb_typeof(last_error -> 'code') = 'string'
      AND pg_catalog.jsonb_typeof(last_error -> 'message') = 'string'
      AND pg_catalog.jsonb_typeof(last_error -> 'retryable') = 'boolean')),
  -- N-02. The actor is a COLUMN and not an assumed SYSTEM because the contract
  -- lets a human dead-letter a run deliberately
  -- (POST /v1/runs/{id}/dead-letter), and the audit trail must show who.
  CONSTRAINT dead_letters_actor_shape CHECK (app.is_valid_actor(dead_lettered_by))
);

COMMENT ON TABLE app.dead_letters IS
  'Terminal failures (doc 05 s2.8). Replay creates a NEW job carrying '
  'replayedFrom and stamps replayed_at here; nothing is ever re-run in place, so '
  'the original failure stays inspectable. Retained indefinitely until replayed, '
  'then one year - app.reap_dead_letters is that year.';

SELECT app.finalise_table('app','dead_letters',false,NULL,
  ARRAY['origin','origin_id','job_type','event_type','reason','payload',
        'attempts','idempotency_subject','submission_attempt','dead_lettered_at',
        'dead_lettered_by']);

CREATE INDEX dead_letters_tenant_idx
  ON app.dead_letters (tenant_id, dead_lettered_at DESC)
  WHERE replayed_at IS NULL;

-- M-16. Composite, because the FK is.
CREATE INDEX dead_letters_replayed_job_idx
  ON app.dead_letters (tenant_id, replayed_job_id)
  WHERE replayed_job_id IS NOT NULL;

-- The retention reaper's sweep key.
CREATE INDEX dead_letters_replayed_at_idx
  ON app.dead_letters (replayed_at) WHERE replayed_at IS NOT NULL;

CREATE TABLE app.submission_counters (
  id           uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject      text        NOT NULL
               CHECK (NULLIF(pg_catalog.btrim(subject), '') IS NOT NULL),
  next_attempt integer     NOT NULL DEFAULT 1 CHECK (next_attempt >= 1),
  created_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT submission_counters_key UNIQUE (tenant_id, subject)
);

COMMENT ON TABLE app.submission_counters IS
  'M-20. One counter per (tenant, submission subject). The provider idempotency '
  'key is <subject>#<attempt> and is allocated ONCE per logical submission; a '
  'replayed dead letter copies the attempt rather than allocating a new one, so '
  'the provider sees the same key and dedupes. Deriving the key from job.id - '
  'which doc 05 s2.3 does - means every replay is a fresh key and the invoice '
  'goes in twice.';

SELECT app.finalise_table('app','submission_counters',false,NULL,ARRAY['subject']);

-- Allocation is one statement and one row lock, held for microseconds. Same
-- shape as 004's core.next_ref, deliberately, rather than a second idiom.
CREATE OR REPLACE FUNCTION app.next_submission_attempt(p_tenant_id uuid, p_subject text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_tenant_id IS NULL OR NULLIF(pg_catalog.btrim(COALESCE(p_subject,'')), '') IS NULL THEN
    RAISE EXCEPTION 'next_submission_attempt needs a tenant and a subject'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO app.submission_counters (tenant_id, subject, next_attempt)
  VALUES (p_tenant_id, p_subject, 2)
  ON CONFLICT (tenant_id, subject)
  DO UPDATE SET next_attempt = app.submission_counters.next_attempt + 1,
                updated_at = pg_catalog.now()
  RETURNING CASE WHEN app.submission_counters.next_attempt = 2 THEN 1
                 ELSE app.submission_counters.next_attempt - 1 END
  INTO v_n;

  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.provider_idempotency_key(
  p_subject text,
  p_attempt integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p_subject IS NULL OR p_attempt IS NULL THEN NULL
    ELSE p_subject || '#' || p_attempt::text
  END;
$fn$;

COMMENT ON FUNCTION app.provider_idempotency_key(text, integer) IS
  'M-20. The key a handler presents to the accounting package or the mail '
  'provider. Derived from the SUBJECT and the stored attempt, never from the job '
  'row, so a replay of a dead letter presents the same key and the provider '
  'refuses the duplicate.';

-- ═══ 8 · app.emit_event · the ONLY write path into core.events ══════════════

-- Doc 05 s1.3. Every state change calls this in its own transaction; nothing
-- else inserts into core.events. The ON CONFLICT ... DO NOTHING plus the
-- follow-up SELECT is what makes replay of an Idempotency-Key return the
-- ORIGINAL event and enqueue NO duplicate jobs - the single most important
-- behaviour in this file, and the one s8.2 pins.
CREATE OR REPLACE FUNCTION app.emit_event(
  p_tenant_id       uuid,
  p_type            text,
  p_aggregate_type  text,
  p_aggregate_id    uuid,
  p_aggregate_ref   text,
  p_payload         jsonb,
  p_summary         text,
  p_actor           jsonb,
  p_correlation_id  uuid  DEFAULT NULL,
  p_causation_id    uuid  DEFAULT NULL,
  p_run_id          text  DEFAULT NULL,
  p_idempotency_key text  DEFAULT NULL,
  p_related         jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_event_id    uuid;
  v_correlation uuid;
  v_occurred_at timestamptz;
  v_payload     jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'emit_event: tenant_id is NOT NULL with no exception on '
      'core.events; a null-tenant event appears in no audit drawer'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NULLIF(pg_catalog.btrim(COALESCE(p_type, '')), '') IS NULL THEN
    RAISE EXCEPTION 'emit_event: an event needs a type'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NULLIF(pg_catalog.btrim(COALESCE(p_summary, '')), '') IS NULL THEN
    RAISE EXCEPTION 'emit_event: ''%'' has no summary; the drawer sentence is '
      'written at emit time, not computed in a view (D8)', p_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- N-09, at the write path as well as at the column, so the error names the
  -- caller rather than a constraint.
  IF NOT app.is_valid_actor(p_actor) THEN
    RAISE EXCEPTION 'emit_event: actor must be {kind,id,name} with kind one of '
      'HUMAN, AGENT, SYSTEM, CLIENT; got %', COALESCE(p_actor::text, 'NULL')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF pg_catalog.jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'emit_event: payload must be a json object'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_related IS NOT NULL AND pg_catalog.jsonb_typeof(p_related) <> 'array' THEN
    RAISE EXCEPTION 'emit_event: p_related must be an array of {type,id}'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_correlation := COALESCE(p_correlation_id, pg_catalog.gen_random_uuid());

  INSERT INTO core.events (
    tenant_id, type, aggregate_type, aggregate_id, aggregate_ref,
    payload, summary, actor, correlation_id, causation_id, run_id, idempotency_key
  ) VALUES (
    p_tenant_id, p_type, p_aggregate_type, p_aggregate_id, p_aggregate_ref,
    v_payload, p_summary, p_actor,
    v_correlation, p_causation_id, p_run_id, p_idempotency_key
  )
  ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id, occurred_at INTO v_event_id, v_occurred_at;

  -- Replay of a seen key: return the original id, enqueue NOTHING.
  IF v_event_id IS NULL THEN
    SELECT existing.id INTO v_event_id
      FROM core.events AS existing
     WHERE existing.tenant_id = p_tenant_id
       AND existing.idempotency_key = p_idempotency_key;
    IF v_event_id IS NULL THEN
      -- Unreachable by construction (the only conflict target is the keyed
      -- index), and a raise rather than a silent NULL return because a caller
      -- that gets NULL here would write a job with a null event_id.
      RAISE EXCEPTION 'emit_event: insert wrote nothing and no prior event '
        'carries key ''%'' in this tenant', p_idempotency_key
        USING ERRCODE = 'internal_error';
    END IF;
    RETURN v_event_id;
  END IF;

  -- H-26: occurred_at is denormalised onto every subject row at write time and
  -- frozen there, so the drawer's keyset ordering has an index to walk.
  INSERT INTO core.event_subjects
    (event_id, tenant_id, subject_type, subject_id, role, occurred_at)
  VALUES
    (v_event_id, p_tenant_id, p_aggregate_type, p_aggregate_id, 'SUBJECT', v_occurred_at)
  ON CONFLICT DO NOTHING;

  INSERT INTO core.event_subjects
    (event_id, tenant_id, subject_type, subject_id, role, occurred_at)
  SELECT v_event_id, p_tenant_id,
         related.value ->> 'type', (related.value ->> 'id')::uuid,
         'RELATED', v_occurred_at
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_related, '[]'::jsonb)) AS related(value)
   WHERE related.value ? 'type' AND related.value ? 'id'
  ON CONFLICT DO NOTHING;

  -- The transactional outbox: subscriptions become jobs in THIS transaction. If
  -- the business transaction rolls back, neither the event nor its jobs exist,
  -- so there is no window where a side effect is enqueued for a change that did
  -- not happen (D4, s1.5).
  --
  -- M-07: the JOB payload is allowlisted. The EVENT above keeps the whole
  -- payload, because it is the business record; this copy is what drains into a
  -- third party's webhook body.
  INSERT INTO app.outbox (
    tenant_id, job_type, priority, payload,
    event_id, run_id, correlation_id, job_key, run_after
  )
  SELECT p_tenant_id, subscription.job_type, subscription.priority,
         app.outbox_payload_allowlist(
           v_payload || pg_catalog.jsonb_build_object(
             'eventType',    p_type,
             'aggregateRef', p_aggregate_ref,
             'aggregateId',  p_aggregate_id)),
         v_event_id, p_run_id, v_correlation,
         'event:' || v_event_id::text || ':' || subscription.job_type,
         pg_catalog.now() + subscription.delay
    FROM app.event_subscriptions AS subscription
   WHERE subscription.event_type = p_type
     AND subscription.enabled
     AND (subscription.tenant_id IS NULL OR subscription.tenant_id = p_tenant_id)
  ON CONFLICT (tenant_id, job_key) WHERE job_key IS NOT NULL DO NOTHING;

  RETURN v_event_id;
END;
$fn$;

COMMENT ON FUNCTION app.emit_event(uuid,text,text,uuid,text,jsonb,text,jsonb,uuid,uuid,text,text,jsonb) IS
  'The only write path into core.events (doc 05 s1.3). Writes the event, its '
  'SUBJECT and RELATED index rows, and one job per enabled subscription, all in '
  'the caller''s transaction. A replayed idempotency key returns the original id '
  'and enqueues nothing.';

-- The three-argument overload doc 05 s1.3 adds for sb-actions, resolved by
-- arity. It exists so the action envelope does not have to assemble twelve
-- arguments it would only be re-deriving from a row it already holds.
--
-- Two things are NOT as doc 05 writes them, and both are the schema winning:
--   * `p_run_id => r.agent_run_id` is a text column, not a uuid. core.events
--     .run_id is text for exactly this reason.
--   * app.event_payload_for and app.event_summary_for are named there as
--     separate functions. They are inlined here: their only caller is this
--     overload, and a second name for one sentence is the divergence the
--     project's consolidation rule forbids. The per-event-type payload shapes
--     they were meant to enforce are s1.7 PROPOSED events awaiting contract
--     sign-off, so encoding them now would put unratified names in the database.
CREATE OR REPLACE FUNCTION app.emit_event(
  p_tenant_id         uuid,
  p_type              text,
  p_action_request_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_request core.action_requests%ROWTYPE;
  v_label   text;
  v_actor   jsonb;
BEGIN
  SELECT request.* INTO v_request
    FROM core.action_requests AS request
   WHERE request.id = p_action_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'action request % not found', p_action_request_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_request.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'action request % belongs to another tenant', p_action_request_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT catalogue.label INTO v_label
    FROM app.action_types AS catalogue
   WHERE catalogue.key = v_request.action_type;

  -- requested_by_name does not exist on core.action_requests (it is on
  -- core.approval_requests). The actor name is resolved from the profile where
  -- the requester is a real user, and is JSON null otherwise - an agent or a
  -- system principal has no row in any user table, which is why actor is jsonb
  -- and not a foreign key.
  v_actor := pg_catalog.jsonb_build_object(
    'kind', v_request.requested_by_kind,
    'id',   v_request.requested_by_id,
    'name', (SELECT pg_catalog.to_jsonb(profile.display_name)
               FROM public.user_profiles AS profile
              WHERE profile.tenant_id = v_request.tenant_id
                AND profile.user_id::text = v_request.requested_by_id));
  IF v_actor -> 'name' IS NULL THEN
    v_actor := v_actor || pg_catalog.jsonb_build_object('name', NULL);
  END IF;

  RETURN app.emit_event(
    p_tenant_id       => p_tenant_id,
    p_type            => p_type,
    p_aggregate_type  => app.aggregate_type_for(v_request.action_type),
    p_aggregate_id    => COALESCE(v_request.target_id, v_request.id),
    p_aggregate_ref   => COALESCE(v_request.target_ref, v_request.ref),
    p_payload         => app.outbox_payload_allowlist(v_request.payload)
                         || pg_catalog.jsonb_build_object(
                              'actionType', v_request.action_type,
                              'status',     v_request.status),
    p_summary         => COALESCE(v_label, v_request.action_type)
                         || ' · ' || COALESCE(v_request.target_ref, v_request.ref,
                                              v_request.id::text),
    p_actor           => v_actor,
    -- correlation_id IS the action request id, set here rather than passed, so
    -- every event descending from one action shares it without any caller
    -- having to remember to.
    p_correlation_id  => v_request.id,
    p_causation_id    => NULL,
    p_run_id          => v_request.agent_run_id,
    -- Derived, so re-running apply_effects after a crash emits no second event.
    p_idempotency_key => 'action:' || v_request.id::text || ':' || p_type,
    p_related         => '[]'::jsonb);
END;
$fn$;

-- ═══ 9 · C-09 · app.redact_event_actor ══════════════════════════════════════

-- The ONE path that can change a committed event. See the header for why this
-- option was taken over rewriting `summary` as a template key.
--
-- It is callable by nobody: EXECUTE is revoked from PUBLIC, anon and
-- authenticated below, and it is deliberately NOT granted to service_role, so
-- until a policy says otherwise erasure is an act the migration role performs,
-- not a request an endpoint serves.
CREATE OR REPLACE FUNCTION app.redact_event_actor(
  p_tenant_id   uuid,
  p_event_id    uuid,
  p_actor       jsonb,
  p_summary     text,
  p_reason      text,
  p_redacted_by jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_event core.events%ROWTYPE;
BEGIN
  IF NOT app.is_valid_actor(p_actor) THEN
    RAISE EXCEPTION 'redact_event_actor: the replacement actor must still be a '
      'valid {kind,id,name}; erasure replaces the personal data, it does not '
      'remove the shape'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT app.is_valid_actor(p_redacted_by) THEN
    RAISE EXCEPTION 'redact_event_actor: redacted_by must be a valid actor - an '
      'erasure with no recorded author is not an audited erasure'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'redact_event_actor: a reason is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NULLIF(pg_catalog.btrim(COALESCE(p_summary, '')), '') IS NULL THEN
    RAISE EXCEPTION 'redact_event_actor: the replacement summary cannot be empty '
      '- core.events.summary is NOT NULL and the drawer renders it'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT event.* INTO v_event
    FROM core.events AS event
   WHERE event.id = p_event_id AND event.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'redact_event_actor: no event % in tenant %',
      p_event_id, p_tenant_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- The audit row is written in the SAME transaction as the redaction, and it
  -- carries the BEFORE image. An erasure that leaves no record of what was
  -- erased is indistinguishable from tampering.
  INSERT INTO app.event_redactions
    (tenant_id, event_id, before_actor, before_summary,
     after_actor, after_summary, reason, redacted_by)
  VALUES
    (p_tenant_id, p_event_id, v_event.actor, v_event.summary,
     p_actor, p_summary, p_reason, p_redacted_by);

  -- The exemption is scoped to this row and released immediately. `true` makes
  -- it transaction-local, so a rolled-back redaction also rolls back the licence.
  PERFORM pg_catalog.set_config('app.event_redaction', p_event_id::text, true);
  BEGIN
    UPDATE core.events
       SET actor = p_actor, summary = p_summary
     WHERE id = p_event_id AND tenant_id = p_tenant_id;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('app.event_redaction', '', true);
    RAISE;
  END;
  PERFORM pg_catalog.set_config('app.event_redaction', '', true);
END;
$fn$;

COMMENT ON FUNCTION app.redact_event_actor(uuid,uuid,jsonb,text,text,jsonb) IS
  'C-09. The single narrow audited exemption to core.events being append-only. '
  'It can change actor and summary and nothing else - app.reject_mutation '
  're-derives that from the row rather than trusting this function - it writes '
  'its own app.event_redactions row carrying the before image, and it is granted '
  'to no role at all.';

-- ═══ 10 · The sb-actions seam · effects become jobs ═════════════════════════

-- Doc 05 s2.7 describes this as live and already called by the gate. It is not:
-- no such function exists in 001-011 and 011's app.apply_effects calls nothing.
-- 012 creates it here; 011 is deliberately NOT edited to call it. The gate's
-- one-line call belongs in the migration that owns the gate, and a fix made
-- silently in another migration's file is a fix nobody can find.
CREATE OR REPLACE FUNCTION app.enqueue_effect_jobs(
  p_action_request_id uuid,
  p_tenant_id         uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_effect  app.action_effects%ROWTYPE;
  v_subject text;
  v_attempt integer;
  v_job_id  uuid;
  v_count   integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_effect_jobs requires an explicit p_tenant_id'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_effect IN
    SELECT effect.*
      FROM app.action_effects AS effect
     WHERE effect.action_request_id = p_action_request_id
       AND effect.tenant_id = p_tenant_id
       AND effect.kind = 'EXTERNAL'
       AND effect.status = 'DISPATCHED'
     ORDER BY effect.seq
  LOOP
    -- M-20. The subject is the thing being submitted, not the job. Allocated
    -- ONCE here; a replay copies it rather than allocating again.
    v_subject := v_effect.entity || ':' ||
                 COALESCE(v_effect.ref, p_action_request_id::text);
    v_attempt := app.next_submission_attempt(p_tenant_id, v_subject);

    INSERT INTO app.outbox (
      tenant_id, job_type, priority, payload,
      action_request_id, effect_id, job_key, correlation_id,
      idempotency_subject, submission_attempt,
      max_attempts, run_after)
    SELECT
      p_tenant_id,
      app.job_type_for(request.action_type, v_effect.entity),
      app.job_priority_for(request.action_type, v_effect.entity),
      -- M-07 at the effect boundary as well as the event one.
      app.outbox_payload_allowlist(
        request.payload || pg_catalog.jsonb_build_object(
          'actionType',             request.action_type,
          'entity',                 v_effect.entity,
          'op',                     v_effect.op,
          'seq',                    v_effect.seq,
          'effectId',               v_effect.id,
          'subject',                v_subject,
          'submissionAttempt',      v_attempt,
          'providerIdempotencyKey', app.provider_idempotency_key(v_subject, v_attempt))),
      request.id,
      v_effect.id,
      -- 011 already derived this as '<action_request_id>:<seq>'. Reused rather
      -- than rebuilt, so there is one thing that can get the shape wrong.
      COALESCE(v_effect.job_key, request.id::text || ':' || v_effect.seq::text),
      request.id,
      v_subject,
      v_attempt,
      COALESCE(catalogue.max_effect_attempts, 5),
      pg_catalog.now()
      FROM core.action_requests AS request
      LEFT JOIN app.action_types AS catalogue ON catalogue.key = request.action_type
     WHERE request.id = p_action_request_id
       AND request.tenant_id = p_tenant_id
    ON CONFLICT (tenant_id, job_key) WHERE job_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_job_id;

    IF v_job_id IS NOT NULL THEN
      v_count := v_count + 1;
      UPDATE app.action_effects
         SET job_id = v_job_id
       WHERE id = v_effect.id;
    ELSE
      -- The job already existed, so the attempt just allocated is not used.
      -- Recorded rather than silently burnt: the counter is not gapless and the
      -- provider key stays stable because it lives on the EXISTING row.
      NULL;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION app.enqueue_effect_jobs(uuid, uuid) IS
  'Turns 011''s typed DISPATCHED external effects into jobs (doc 05 s2.7). The '
  'job_key shape is built in ONE place - 011''s own effect row - so there is one '
  'thing that can get it wrong rather than two. ON CONFLICT DO NOTHING on '
  '(tenant_id, job_key) is the entire retry-safety story: a redelivered enqueue '
  'cannot send a second proposal email or push a second invoice.';

-- ═══ 11 · Claim, heartbeat, complete, fail, reap ════════════════════════════

-- Internal. Leading underscore: only other functions call it, and EXECUTE is
-- revoked from every client role below.
CREATE OR REPLACE FUNCTION app._dead_letter_job(
  p_job    app.outbox,
  p_error  jsonb,
  p_reason text,
  p_by     jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  INSERT INTO app.dead_letters (
    tenant_id, origin, origin_id, job_type, reason, payload, last_error,
    attempts, idempotency_subject, submission_attempt, dead_lettered_by)
  VALUES (
    p_job.tenant_id, 'JOB', p_job.id, p_job.job_type,
    COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_error ->> 'code', '')), ''),
             p_reason),
    p_job.payload, p_error, p_job.attempts,
    p_job.idempotency_subject, p_job.submission_attempt, p_by);

  -- An action's external effect must not sit at DISPATCHED forever (s2.7). The
  -- status crosses the seam through app.effect_status_for_job_state, which
  -- raises on anything that is not a terminal reportable job state - R14, in
  -- the shape root CLAUDE.md prescribes.
  IF p_job.effect_id IS NOT NULL THEN
    PERFORM app.report_effect_result(
      p_job.effect_id,
      app.effect_status_for_job_state('DEAD'),
      NULL,
      p_error);
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.claim_jobs(
  p_worker    text,
  p_tenant_id uuid     DEFAULT NULL,
  p_types     text[]   DEFAULT NULL,
  p_limit     integer  DEFAULT 10,
  p_lease     interval DEFAULT interval '5 minutes',
  p_scan      integer  DEFAULT NULL
)
RETURNS SETOF app.outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_scan integer;
BEGIN
  IF NULLIF(pg_catalog.btrim(COALESCE(p_worker, '')), '') IS NULL THEN
    RAISE EXCEPTION 'claim_jobs: a worker instance id is required; it is what '
      'complete_job, fail_job and heartbeat_job check ownership against'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'claim_jobs: p_limit must be between 1 and 1000, got %', p_limit
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- s8.5: the lease never exceeds the worker lifetime. Doc 05 proposes a static
  -- review of call sites; a runtime refusal is the version that cannot be
  -- forgotten by someone debugging a slow handler.
  IF p_lease IS NULL OR p_lease <= interval '0' OR p_lease > interval '6 minutes' THEN
    RAISE EXCEPTION 'claim_jobs: p_lease must be > 0 and <= 6 minutes (the edge '
      'runtime''s wall clock), got %', p_lease
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_scan := GREATEST(COALESCE(p_scan, p_limit * 20), p_limit);

  RETURN QUERY
  WITH ranked AS (
    -- H-16. Rank within each tenant, so the batch can take every tenant's best
    -- job before any tenant's second. The bounded scan is the cost, and p_scan
    -- is an argument so it can be traded without a migration.
    SELECT candidate.id,
           pg_catalog.row_number() OVER (
             PARTITION BY candidate.tenant_id
             ORDER BY candidate.priority, candidate.run_after, candidate.id
           ) AS fair_rank,
           candidate.priority AS priority,
           candidate.run_after AS run_after
      FROM app.outbox AS candidate
     WHERE candidate.state = 'QUEUED'
       AND candidate.run_after <= pg_catalog.now()
       -- C-08. A job at its ceiling is NOT claimable. Without this the claim
       -- re-serves a poison pill forever and the doc's "cannot loop forever" is
       -- simply untrue.
       AND candidate.attempts < candidate.max_attempts
       AND (p_types IS NULL OR candidate.job_type = ANY (p_types))
       AND (p_tenant_id IS NULL OR candidate.tenant_id = p_tenant_id)
     ORDER BY candidate.priority, candidate.run_after, candidate.id
     LIMIT v_scan
  ),
  fair AS (
    SELECT ranked.id
      FROM ranked
     ORDER BY ranked.fair_rank, ranked.priority, ranked.run_after, ranked.id
     LIMIT p_limit
  ),
  claimed AS (
    UPDATE app.outbox AS job
       SET state         = 'CLAIMED',
           claimed_at    = pg_catalog.now(),
           claimed_by    = p_worker,
           visible_after = pg_catalog.now() + p_lease,
           -- attempts increments at CLAIM time, not at failure time, so a
           -- worker that dies without reporting still burns an attempt.
           attempts      = job.attempts + 1,
           updated_at    = pg_catalog.now()
     WHERE job.id IN (
       -- FOR UPDATE SKIP LOCKED is the whole trick: two workers claiming
       -- simultaneously take disjoint batches instead of serialising.
       SELECT locked.id
         FROM app.outbox AS locked
        WHERE locked.id IN (SELECT fair.id FROM fair)
          AND locked.state = 'QUEUED'
        FOR UPDATE SKIP LOCKED)
    RETURNING job.*)
  SELECT claimed.* FROM claimed;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.heartbeat_job(
  p_job_id    uuid,
  p_tenant_id uuid,
  p_worker    text,
  p_extend    interval DEFAULT interval '5 minutes'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_found uuid;
BEGIN
  IF p_tenant_id IS NULL OR NULLIF(pg_catalog.btrim(COALESCE(p_worker,'')),'') IS NULL THEN
    RAISE EXCEPTION 'heartbeat_job requires an explicit tenant and worker'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_extend IS NULL OR p_extend <= interval '0' OR p_extend > interval '6 minutes' THEN
    RAISE EXCEPTION 'heartbeat_job: p_extend must be > 0 and <= 6 minutes, got %',
      p_extend USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- M-14. Without claimed_by, any worker can extend any other worker's lease
  -- indefinitely and defeat the reaper - and the setInterval that sends the
  -- heartbeat is cleared only in `finally`, which never runs if the isolate is
  -- hard-killed. H-15: the tenant is validated here too.
  UPDATE app.outbox AS job
     SET visible_after = pg_catalog.now() + p_extend,
         updated_at    = pg_catalog.now()
   WHERE job.id = p_job_id
     AND job.tenant_id = p_tenant_id
     AND job.state = 'CLAIMED'
     AND job.claimed_by = p_worker
  RETURNING job.id INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'job % is not claimed by worker % in tenant %',
      p_job_id, p_worker, p_tenant_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.complete_job(
  p_job_id    uuid,
  p_tenant_id uuid,
  p_worker    text,
  p_result    jsonb DEFAULT '{}'::jsonb,
  p_event     jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_job app.outbox%ROWTYPE;
BEGIN
  IF p_tenant_id IS NULL OR NULLIF(pg_catalog.btrim(COALESCE(p_worker,'')),'') IS NULL THEN
    RAISE EXCEPTION 'complete_job requires an explicit tenant and worker'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_result IS NOT NULL AND pg_catalog.jsonb_typeof(p_result) <> 'object' THEN
    RAISE EXCEPTION 'complete_job: p_result must be a json object'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE app.outbox AS job
     SET state = 'SUCCEEDED', result = COALESCE(p_result, '{}'::jsonb),
         finished_at = pg_catalog.now(), updated_at = pg_catalog.now(),
         last_error = NULL, visible_after = NULL
   WHERE job.id = p_job_id
     AND job.tenant_id = p_tenant_id
     AND job.state = 'CLAIMED'
     AND job.claimed_by = p_worker
  RETURNING job.* INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job % is not claimed by worker % in tenant %',
      p_job_id, p_worker, p_tenant_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF p_event IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_event) <> 'object'
       OR NOT (p_event ? 'type' AND p_event ? 'aggregateType' AND p_event ? 'aggregateId'
               AND p_event ? 'summary') THEN
      RAISE EXCEPTION 'complete_job: p_event needs type, aggregateType, '
        'aggregateId and summary'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    PERFORM app.emit_event(
      p_tenant_id       => v_job.tenant_id,
      p_type            => p_event ->> 'type',
      p_aggregate_type  => p_event ->> 'aggregateType',
      p_aggregate_id    => (p_event ->> 'aggregateId')::uuid,
      p_aggregate_ref   => p_event ->> 'aggregateRef',
      p_payload         => COALESCE(p_event -> 'payload', '{}'::jsonb),
      p_summary         => p_event ->> 'summary',
      p_actor           => COALESCE(p_event -> 'actor',
                             pg_catalog.jsonb_build_object(
                               'kind','SYSTEM','id','worker','name','Worker')),
      p_correlation_id  => v_job.correlation_id,
      p_causation_id    => v_job.event_id,
      p_run_id          => v_job.run_id,
      -- Completion is idempotent on the job id, so a redelivered completion
      -- event does not appear twice in the drawer.
      p_idempotency_key => 'job:' || v_job.id::text,
      p_related         => COALESCE(p_event -> 'related', '[]'::jsonb));
  END IF;

  -- Workers never write core tables directly; every write-back goes through
  -- 011's app.report_effect_result. outbox_effect_path_complete is what makes
  -- this guard safe: an action-derived job always has an effect to report.
  IF v_job.effect_id IS NOT NULL THEN
    PERFORM app.report_effect_result(
      v_job.effect_id,
      app.effect_status_for_job_state('SUCCEEDED'),
      COALESCE(p_result, '{}'::jsonb),
      NULL);
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.fail_job(
  p_job_id    uuid,
  p_tenant_id uuid,
  p_worker    text,
  p_error     jsonb,
  p_retryable boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_job   app.outbox%ROWTYPE;
  v_state text;
BEGIN
  IF p_tenant_id IS NULL OR NULLIF(pg_catalog.btrim(COALESCE(p_worker,'')),'') IS NULL THEN
    RAISE EXCEPTION 'fail_job requires an explicit tenant and worker'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The shape 011's report_effect_result demands of a terminal failure, checked
  -- HERE so the seam cannot be reached with something it will reject halfway
  -- through a dead-lettering.
  IF p_error IS NULL OR pg_catalog.jsonb_typeof(p_error) <> 'object'
     OR NOT (p_error ? 'code' AND p_error ? 'message' AND p_error ? 'retryable')
     OR pg_catalog.jsonb_typeof(p_error -> 'retryable') <> 'boolean' THEN
    RAISE EXCEPTION 'fail_job: p_error must be an object carrying code, message '
      'and a BOOLEAN retryable'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- H-12. Doc 05's `select * into j from app.outbox where id = p_job_id for
  -- update` has no state check and no owner check, so worker A - whose lease
  -- expired, whose job the reaper requeued, and which worker B is now running -
  -- could flip the row to DEAD and report the effect FAILED while B was about to
  -- succeed. This is app.complete_job's predicate copied, not a second shape.
  SELECT job.* INTO v_job
    FROM app.outbox AS job
   WHERE job.id = p_job_id
     AND job.tenant_id = p_tenant_id
     AND job.state = 'CLAIMED'
     AND job.claimed_by = p_worker
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job % is not claimed by worker % in tenant %',
      p_job_id, p_worker, p_tenant_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF v_job.attempts >= v_job.max_attempts OR NOT p_retryable THEN
    v_state := 'DEAD';
    UPDATE app.outbox
       SET state = 'DEAD', last_error = p_error, finished_at = pg_catalog.now(),
           updated_at = pg_catalog.now(), visible_after = NULL
     WHERE id = p_job_id;
    v_job.state := 'DEAD';
    v_job.last_error := p_error;

    PERFORM app._dead_letter_job(
      v_job, p_error,
      CASE WHEN p_retryable THEN 'RETRIES_EXHAUSTED' ELSE 'NOT_RETRYABLE' END,
      pg_catalog.jsonb_build_object('kind','SYSTEM','id','worker','name','Worker'));
  ELSE
    v_state := 'FAILED';
    -- Exponential backoff with FULL jitter, capped at one hour. Jitter matters
    -- because a provider outage fails every in-flight SEND_EMAIL at once and
    -- without it they all retry in the same second. LEAST and GREATEST are
    -- written bare: they are parser constructs, not pg_catalog functions.
    UPDATE app.outbox
       SET state = 'FAILED', last_error = p_error, updated_at = pg_catalog.now(),
           claimed_at = NULL, claimed_by = NULL, visible_after = NULL,
           run_after = pg_catalog.now() + LEAST(
             interval '1 hour',
             (interval '10 seconds' * pg_catalog.power(2, LEAST(v_job.attempts, 8)))
             * (0.5 + pg_catalog.random() * 0.5))
     WHERE id = p_job_id;
  END IF;

  RETURN v_state;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.reap_jobs(
  p_tenant_id uuid    DEFAULT NULL,
  p_limit     integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_job   app.outbox%ROWTYPE;
  v_count integer := 0;
  v_n     integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'reap_jobs: p_limit must be >= 1' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- H-18. Doc 05 ORs two predicates in one unbounded UPDATE. Nothing served the
  -- second (outbox_failed_idx is keyed on finished_at and a FAILED row's is
  -- NULL) and a provider outage that fails 50,000 jobs made one cron tick a
  -- 50,000-row UPDATE. Four separate statements, each with its own index and its
  -- own LIMIT.

  -- (1) Expired lease, attempts still under the ceiling -> back to QUEUED.
  WITH due AS (
    SELECT job.id FROM app.outbox AS job
     WHERE job.state = 'CLAIMED'
       AND job.visible_after < pg_catalog.now()
       AND job.attempts < job.max_attempts
       AND (p_tenant_id IS NULL OR job.tenant_id = p_tenant_id)
     ORDER BY job.visible_after
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED)
  UPDATE app.outbox AS target
     SET state = 'QUEUED', claimed_by = NULL, claimed_at = NULL,
         visible_after = NULL, updated_at = pg_catalog.now()
   WHERE target.id IN (SELECT due.id FROM due)
     AND target.state = 'CLAIMED';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_count := v_count + v_n;

  -- (3) Elapsed backoff, attempts still under the ceiling -> back to QUEUED.
  -- FAILED rows are not in outbox_claim_idx, so the reaper is what moves them.
  WITH due AS (
    SELECT job.id FROM app.outbox AS job
     WHERE job.state = 'FAILED'
       AND job.run_after <= pg_catalog.now()
       AND job.attempts < job.max_attempts
       AND (p_tenant_id IS NULL OR job.tenant_id = p_tenant_id)
     ORDER BY job.run_after
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED)
  UPDATE app.outbox AS target
     SET state = 'QUEUED', claimed_by = NULL, claimed_at = NULL,
         visible_after = NULL, updated_at = pg_catalog.now()
   WHERE target.id IN (SELECT due.id FROM due)
     AND target.state = 'FAILED';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_count := v_count + v_n;

  -- (2) and (4). C-08's other half. A job whose attempts have reached the
  -- ceiling is NOT returned to QUEUED - doc 05's reaper does exactly that, and
  -- combined with a handler that OOMs the isolate before it can call fail_job,
  -- that is the loop that pushes the same invoice to the accounting package
  -- forever. It is dead-lettered instead, with its effect reported FAILED so the
  -- action does not sit at EXECUTING. Row by row because each one writes a dead
  -- letter and crosses the sb-actions seam.
  FOR v_job IN
    SELECT job.* FROM app.outbox AS job
     WHERE ((job.state = 'CLAIMED' AND job.visible_after < pg_catalog.now())
            OR (job.state = 'FAILED' AND job.run_after <= pg_catalog.now()))
       AND job.attempts >= job.max_attempts
       AND (p_tenant_id IS NULL OR job.tenant_id = p_tenant_id)
     ORDER BY job.updated_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE app.outbox
       SET state = 'DEAD', finished_at = pg_catalog.now(),
           updated_at = pg_catalog.now(), claimed_by = NULL, claimed_at = NULL,
           visible_after = NULL,
           last_error = COALESCE(v_job.last_error, pg_catalog.jsonb_build_object(
             'code','LEASE_EXPIRED_AT_MAX_ATTEMPTS',
             'message','the lease expired with no report and no attempts remain',
             'retryable', false))
     WHERE id = v_job.id;

    v_job.last_error := COALESCE(v_job.last_error, pg_catalog.jsonb_build_object(
      'code','LEASE_EXPIRED_AT_MAX_ATTEMPTS',
      'message','the lease expired with no report and no attempts remain',
      'retryable', false));
    v_job.state := 'DEAD';

    PERFORM app._dead_letter_job(
      v_job, v_job.last_error, 'RETRIES_EXHAUSTED',
      pg_catalog.jsonb_build_object('kind','SYSTEM','id','reaper','name','Job reaper'));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION app.reap_jobs(uuid, integer) IS
  'Every minute (015 schedules it). Expired leases and elapsed backoff return to '
  'QUEUED; anything at max_attempts is DEAD-lettered instead of re-served, which '
  'is the half of C-08 the claim predicate cannot close on its own. Four bounded '
  'statements, never one ORed unbounded UPDATE (H-18).';

-- M-24. CANCELLED was declared in the check constraint and the state machine and
-- written by nothing. This writes it. A CLAIMED job is deliberately untouched:
-- cancelling a row does not stop the worker already running it, and pretending
-- otherwise is worse than leaving it to finish and report.
CREATE OR REPLACE FUNCTION app.cancel_jobs(
  p_tenant_id uuid,
  p_agent_id  text,
  p_limit     integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_tenant_id IS NULL
     OR NULLIF(pg_catalog.btrim(COALESCE(p_agent_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'cancel_jobs requires an explicit tenant and agent id'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH doomed AS (
    SELECT job.id
      FROM app.outbox AS job
      JOIN core.action_requests AS request
        ON request.tenant_id = job.tenant_id
       AND request.id = job.action_request_id
     WHERE job.tenant_id = p_tenant_id
       AND job.state IN ('QUEUED','FAILED')
       AND request.requested_by_kind = 'AGENT'
       AND request.requested_by_id = p_agent_id
     ORDER BY job.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED)
  UPDATE app.outbox AS target
     SET state = 'CANCELLED', finished_at = pg_catalog.now(),
         updated_at = pg_catalog.now(), claimed_by = NULL, claimed_at = NULL,
         visible_after = NULL
   WHERE target.id IN (SELECT doomed.id FROM doomed)
     AND target.state IN ('QUEUED','FAILED');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION app.cancel_jobs(uuid, text, integer) IS
  'M-24. The agent-pause path: stops that agent''s queued work without '
  'dead-lettering it. An agent''s jobs are identified through '
  'core.action_requests.requested_by_kind/requested_by_id, which are real 011 '
  'columns - core.agents is 013''s and does not exist. CLAIMED jobs are left '
  'alone on purpose.';

-- s8.3's replay, and M-20's fix. A new job, never a re-run in place, so the
-- original failure stays inspectable - and the SAME provider idempotency key,
-- so the accounting package refuses the duplicate.
CREATE OR REPLACE FUNCTION app.replay_dead_letter(
  p_dead_letter_id uuid,
  p_tenant_id      uuid,
  p_actor          jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_letter app.dead_letters%ROWTYPE;
  v_job    app.outbox%ROWTYPE;
  v_new_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'replay_dead_letter requires an explicit p_tenant_id'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT app.is_valid_actor(p_actor) THEN
    RAISE EXCEPTION 'replay_dead_letter: a replay has an author'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT letter.* INTO v_letter
    FROM app.dead_letters AS letter
   WHERE letter.id = p_dead_letter_id AND letter.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no dead letter % in tenant %', p_dead_letter_id, p_tenant_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_letter.replayed_at IS NOT NULL THEN
    RAISE EXCEPTION 'dead letter % was already replayed as job %',
      p_dead_letter_id, v_letter.replayed_job_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_letter.origin <> 'JOB' THEN
    RAISE EXCEPTION 'only a JOB dead letter can be replayed onto the outbox; '
      'this one is ''%''', v_letter.origin
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  SELECT job.* INTO v_job
    FROM app.outbox AS job
   WHERE job.id = v_letter.origin_id AND job.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the original job % is gone; a replay needs the row it '
      'replays', v_letter.origin_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ⚠ REOPEN THE EFFECT BEFORE QUEUEING THE REPLAY.
  --
  -- Dead-lettering already moved this job's effect to DEAD_LETTERED, and
  -- `app.report_effect_result` (011) returns early — silently — on an effect that
  -- is already SETTLED or DEAD_LETTERED. So when the replay SUCCEEDED and
  -- `complete_job` reported it, the report was a no-op: an invoice that really
  -- was pushed stayed recorded as permanently failed in the effect ledger. And
  -- nothing could correct it later, because the PARTIALLY_FAILED reconciliation
  -- is guarded `AND status = 'EXECUTING'`, which the action had already left.
  --
  -- The replacement job carries the SAME effect_id on purpose — that is what
  -- makes the replay a second attempt at one effect rather than a second effect —
  -- so the effect has to be put back in a state a worker report can move. DISPATCHED
  -- is where `apply_effects` leaves an effect it has handed to the queue, which is
  -- exactly what this row now is again.
  UPDATE app.action_effects
     SET status     = 'DISPATCHED',
         last_error = NULL,
         updated_at = pg_catalog.now()
   WHERE id = v_job.effect_id
     AND status = 'DEAD_LETTERED';

  INSERT INTO app.outbox (
    tenant_id, job_type, priority, payload,
    event_id, run_id, action_request_id, correlation_id, effect_id,
    -- A NEW job_key: the original still occupies the old one, and the dedupe
    -- key and the provider key are different jobs (doc 05 s2.7).
    job_key,
    -- M-20: the SAME subject and the SAME attempt, so
    -- app.provider_idempotency_key returns the identical string and the
    -- provider dedupes what the accounting package already saw.
    idempotency_subject, submission_attempt,
    max_attempts, run_after)
  VALUES (
    v_job.tenant_id, v_job.job_type, v_job.priority,
    app.outbox_payload_allowlist(
      v_job.payload || pg_catalog.jsonb_build_object('replayedFrom', v_job.id)),
    v_job.event_id, v_job.run_id, v_job.action_request_id, v_job.correlation_id,
    v_job.effect_id,
    CASE WHEN v_job.job_key IS NULL THEN NULL
         ELSE v_job.job_key || ':replay:' || p_dead_letter_id::text END,
    v_job.idempotency_subject, v_job.submission_attempt,
    v_job.max_attempts, pg_catalog.now())
  RETURNING id INTO v_new_id;

  UPDATE app.dead_letters
     SET replayed_at = pg_catalog.now(), replayed_job_id = v_new_id,
         updated_at = pg_catalog.now()
   WHERE id = p_dead_letter_id;

  RETURN v_new_id;
END;
$fn$;

-- H-17. Nothing noticed when a job stopped: the worker tick is a fire-and-forget
-- net.http_post whose response lands in pg_net's unlogged table that nobody
-- queries, and nothing reads cron.job_run_details. 015 schedules this as
-- `jobs-health`; outbox_health_idx is what makes the question cheap.
CREATE OR REPLACE FUNCTION app.jobs_health(
  p_tenant_id uuid     DEFAULT NULL,
  p_threshold interval DEFAULT interval '15 minutes',
  p_limit     integer  DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row    record;
  v_count  integer := 0;
BEGIN
  IF p_threshold IS NULL OR p_threshold <= interval '0' THEN
    RAISE EXCEPTION 'jobs_health: p_threshold must be > 0'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_row IN
    SELECT job.tenant_id,
           pg_catalog.count(*) AS due_jobs,
           pg_catalog.max(job.claimed_at) AS last_claim
      FROM app.outbox AS job
     WHERE job.state = 'QUEUED'
       AND job.run_after <= pg_catalog.now()
       AND job.attempts < job.max_attempts
       AND (p_tenant_id IS NULL OR job.tenant_id = p_tenant_id)
     GROUP BY job.tenant_id
    HAVING pg_catalog.max(job.claimed_at) IS NULL
        OR pg_catalog.max(job.claimed_at) < pg_catalog.now() - p_threshold
     ORDER BY job.tenant_id
     LIMIT p_limit
  LOOP
    -- The idempotency key buckets to the threshold window, so a stalled queue
    -- raises one event per window rather than one per tick. The event is the
    -- alarm; 015 owns the schedule.
    PERFORM app.emit_event(
      p_tenant_id       => v_row.tenant_id,
      p_type            => 'JobStalled',
      p_aggregate_type  => 'OUTBOX',
      p_aggregate_id    => v_row.tenant_id,
      p_aggregate_ref   => NULL,
      p_payload         => pg_catalog.jsonb_build_object(
                             'status', 'STALLED'),
      p_summary         => pg_catalog.format(
                             '%s job(s) are due and the queue has not been '
                             'claimed since %s',
                             v_row.due_jobs,
                             COALESCE(v_row.last_claim::text, 'never')),
      p_actor           => pg_catalog.jsonb_build_object(
                             'kind','SYSTEM','id','jobs-health','name','Jobs health'),
      p_correlation_id  => NULL,
      p_causation_id    => NULL,
      p_run_id          => NULL,
      -- pg_catalog.date_part, not EXTRACT: `EXTRACT(epoch FROM x)` is a
      -- grammar production tied to the unqualified keyword and cannot be
      -- schema-qualified, so under search_path = '' it is a SYNTAX error rather
      -- than a missing function. Same class as POSITION(x IN y).
      p_idempotency_key => 'jobs-health:' || v_row.tenant_id::text || ':' ||
                           pg_catalog.floor(
                             pg_catalog.date_part('epoch', pg_catalog.now())
                             / GREATEST(pg_catalog.date_part('epoch', p_threshold), 1)
                           )::text,
      p_related         => '[]'::jsonb);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION app.jobs_health(uuid, interval, integer) IS
  'H-17. Raises a JobStalled event per tenant whose due work has not been '
  'claimed inside the threshold - INCLUDING a tenant whose queue has never been '
  'claimed at all, because a queue that never started and a queue that stopped '
  'look identical from the outside and the first is what a fresh deploy '
  'produces. `JobStalled` is NOT in packages/contract DOMAIN_EVENT_TYPES: doc 05 '
  'names it `job.stalled`, which is neither the contract''s vocabulary nor its '
  'PascalCase convention. Recorded as a proposed addition, like s1.7''s.';

-- ═══ 12 · Inbound webhooks ══════════════════════════════════════════════════

-- M-26. The path is the CONTRACT's, in ONE place, so no second list can drift
-- from packages/contract/src/domain/client-portal.ts INBOUND_WEBHOOKS[].path.
-- Doc 05 s4.1 routes the same four sources to `/functions/v1/webhook-*`. That
-- disagreement is real and is NOT resolved here - the contract is not this
-- migration's to change and an Edge Function router is somebody's decision.
-- Recorded in the header; the database follows the contract.
CREATE OR REPLACE FUNCTION app.webhook_path_for(p_source text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
BEGIN
  CASE p_source
    WHEN 'EMAIL'      THEN RETURN '/v1/webhooks/email';
    WHEN 'WHATSAPP'   THEN RETURN '/v1/webhooks/whatsapp';
    WHEN 'PORTAL'     THEN RETURN '/v1/webhooks/proposal-accepted';
    WHEN 'ACCOUNTING' THEN RETURN '/v1/webhooks/accounting';
    ELSE
      RAISE EXCEPTION 'unknown inbound webhook source ''%''', p_source
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$fn$;

CREATE TABLE app.webhook_deliveries (
  id               uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  source           text        NOT NULL
                   CHECK (source IN ('EMAIL','WHATSAPP','PORTAL','ACCOUNTING')),
  idempotency_key  text        NOT NULL,
  external_id      text,
  -- NULL until routing resolves it. An unknown external_id writes the row with
  -- a null tenant and returns 202; it is never guessed at and never routed to a
  -- default tenant.
  tenant_id        uuid        REFERENCES public.tenants(id) ON DELETE RESTRICT,
  signature_valid  boolean     NOT NULL,
  http_status      int         NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  headers          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  raw_body         text,
  raw_body_redacted_at timestamptz,
  event_id         uuid,
  error            jsonb,
  received_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_at       timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at       timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT webhook_deliveries_key UNIQUE (source, idempotency_key),
  CONSTRAINT webhook_deliveries_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES core.events (tenant_id, id) ON DELETE SET NULL,
  -- A failed signature writes a row with signature_valid = false and NO event.
  -- Silent drops make a misconfigured provider indistinguishable from an
  -- attacker, and an event from an unverified body is the attack.
  CONSTRAINT webhook_deliveries_unsigned_emits_nothing CHECK (
    signature_valid OR event_id IS NULL),
  CONSTRAINT webhook_deliveries_headers_shape CHECK (
    pg_catalog.jsonb_typeof(headers) = 'object'),
  CONSTRAINT webhook_deliveries_error_shape CHECK (
    error IS NULL OR (
      pg_catalog.jsonb_typeof(error) = 'object'
      AND error ? 'code' AND error ? 'message'
      AND pg_catalog.jsonb_typeof(error -> 'code') = 'string'
      AND pg_catalog.jsonb_typeof(error -> 'message') = 'string'))
);

COMMENT ON TABLE app.webhook_deliveries IS
  'The inbound idempotency ledger (doc 05 s4.2). The delivery row and the event '
  'commit TOGETHER: inserting the row first and processing afterwards burns the '
  'idempotency key on a failure, so a legitimate provider retry gets '
  'IGNORED_DUPLICATE and the enquiry is lost forever. raw_body is nulled at 30 '
  'days and the row is deleted at one year - app.reap_webhook_bodies and '
  'app.reap_webhook_deliveries, which C-07 found did not exist.';

SELECT app.finalise_table('app','webhook_deliveries',false,NULL,
  ARRAY['source','idempotency_key','external_id','signature_valid','http_status',
        'received_at']);

CREATE INDEX webhook_deliveries_tenant_idx
  ON app.webhook_deliveries (tenant_id, received_at DESC);

-- What an operator queries to find a misconfigured route.
CREATE INDEX webhook_deliveries_unrouted_idx
  ON app.webhook_deliveries (source, received_at DESC)
  WHERE tenant_id IS NULL;

-- M-16. Composite, because the FK is.
CREATE INDEX webhook_deliveries_event_idx
  ON app.webhook_deliveries (tenant_id, event_id) WHERE event_id IS NOT NULL;

-- The two retention sweeps' keys.
CREATE INDEX webhook_deliveries_body_idx
  ON app.webhook_deliveries (received_at) WHERE raw_body IS NOT NULL;
CREATE INDEX webhook_deliveries_age_idx
  ON app.webhook_deliveries (received_at);

CREATE TABLE app.webhook_routes (
  id          uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  source      text        NOT NULL
              CHECK (source IN ('EMAIL','WHATSAPP','PORTAL','ACCOUNTING')),
  external_id text        NOT NULL,
  route_path  text        NOT NULL,
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT webhook_routes_key UNIQUE (source, external_id),
  CONSTRAINT webhook_routes_contract_path CHECK (
    route_path = app.webhook_path_for(source))
);

COMMENT ON TABLE app.webhook_routes IS
  'Tenant routing for inbound webhooks (doc 05 s4.3). An inbound request has no '
  'JWT, so the tenant comes from the provider''s own discriminator - inbound '
  'address, BSP phone_number_id, provider account id. route_path is constrained '
  'to the CONTRACT''s path (M-26), which disagrees with doc 05 s4.1.';

SELECT app.finalise_table('app','webhook_routes',false,NULL,
  ARRAY['source','external_id','route_path']);

CREATE OR REPLACE FUNCTION app.resolve_webhook_tenant(p_source text, p_external_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT route.tenant_id
    FROM app.webhook_routes AS route
   WHERE route.source = p_source
     AND route.external_id = p_external_id
     AND route.active;
$fn$;

COMMENT ON FUNCTION app.resolve_webhook_tenant(text, text) IS
  'Returns NULL rather than raising for an unknown external_id: doc 05 s4.3 '
  'requires the delivery row to be written with a null tenant and a 202 so an '
  'operator can find the misconfiguration, which a raise would prevent.';

-- Doc 05 s4 step 4, as one transaction, so the ledger row and the event commit
-- together. The Edge Function does steps 1-3 (raw body, constant-time signature
-- verification, tenant resolution) because they are not SQL; this is the part
-- that must be atomic.
CREATE OR REPLACE FUNCTION app.record_webhook_delivery(
  p_source          text,
  p_idempotency_key text,
  p_external_id     text,
  p_signature_valid boolean,
  p_http_status     integer,
  p_headers         jsonb   DEFAULT '{}'::jsonb,
  p_raw_body        text    DEFAULT NULL,
  p_event           jsonb   DEFAULT NULL,
  p_error           jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant_id   uuid;
  v_delivery_id uuid;
  v_event_id    uuid;
BEGIN
  IF NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'record_webhook_delivery: an idempotency key is required; it '
      'is the only thing standing between a provider retry and a duplicate enquiry'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM app.webhook_path_for(p_source);   -- raises on an unknown source

  v_tenant_id := app.resolve_webhook_tenant(p_source, p_external_id);

  INSERT INTO app.webhook_deliveries (
    source, idempotency_key, external_id, tenant_id, signature_valid,
    http_status, headers, raw_body, error)
  VALUES (
    p_source, p_idempotency_key, p_external_id, v_tenant_id, p_signature_valid,
    p_http_status, COALESCE(p_headers, '{}'::jsonb), p_raw_body, p_error)
  ON CONFLICT (source, idempotency_key) DO NOTHING
  RETURNING id INTO v_delivery_id;

  IF v_delivery_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'IGNORED_DUPLICATE');
  END IF;

  -- No event from an unverified body, no event without a tenant, no event
  -- without one to emit.
  IF p_event IS NOT NULL AND p_signature_valid AND v_tenant_id IS NOT NULL THEN
    v_event_id := app.emit_event(
      p_tenant_id       => v_tenant_id,
      p_type            => p_event ->> 'type',
      p_aggregate_type  => p_event ->> 'aggregateType',
      p_aggregate_id    => (p_event ->> 'aggregateId')::uuid,
      p_aggregate_ref   => p_event ->> 'aggregateRef',
      p_payload         => COALESCE(p_event -> 'payload', '{}'::jsonb),
      p_summary         => p_event ->> 'summary',
      p_actor           => COALESCE(p_event -> 'actor',
                             pg_catalog.jsonb_build_object(
                               'kind','SYSTEM','id',p_source,'name',p_source)),
      p_correlation_id  => NULL,
      p_causation_id    => NULL,
      p_run_id          => NULL,
      p_idempotency_key => 'webhook:' || p_source || ':' || p_idempotency_key,
      p_related         => COALESCE(p_event -> 'related', '[]'::jsonb));

    UPDATE app.webhook_deliveries
       SET event_id = v_event_id, updated_at = pg_catalog.now()
     WHERE id = v_delivery_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status',      CASE WHEN v_tenant_id IS NULL THEN 'UNROUTED' ELSE 'ACCEPTED' END,
    'deliveryId',  v_delivery_id,
    'tenantId',    v_tenant_id,
    'eventId',     v_event_id);
END;
$fn$;

-- ═══ 13 · C-07 · the retention reapers ══════════════════════════════════════
--
-- Doc 05 s5.5 tabulated six retention mechanisms and five of them did not
-- exist. These are those five. Every one is BATCHED, takes a LIMIT, locks with
-- FOR UPDATE SKIP LOCKED so a reaper tick never blocks the worker, and RETURNS
-- the number of rows it touched - which is what lets 015 alarm on a reaper that
-- has silently stopped doing anything. The SCHEDULES are 015's.
--
-- core.events and its subjects are deliberately absent: indefinite retention is
-- a compliance position (six-month HRD Corp claim window, seven-year Malaysian
-- record keeping, attendance locks as evidence), not an oversight.

CREATE OR REPLACE FUNCTION app.reap_webhook_bodies(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  WITH due AS (
    SELECT delivery.id FROM app.webhook_deliveries AS delivery
     WHERE delivery.raw_body IS NOT NULL
       AND delivery.received_at < pg_catalog.now() - interval '30 days'
     ORDER BY delivery.received_at
     LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
     FOR UPDATE SKIP LOCKED)
  UPDATE app.webhook_deliveries AS target
     SET raw_body = NULL, raw_body_redacted_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   WHERE target.id IN (SELECT due.id FROM due)
     AND target.raw_body IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION app.reap_webhook_bodies(integer) IS
  'C-07. Nulls raw_body at 30 days and KEEPS the row: signature_valid, the '
  'status and the idempotency key stay readable, which is what a provider '
  'dispute needs. Raw provider bodies retained indefinitely are a PDPA '
  'liability, not just a disk one.';

CREATE OR REPLACE FUNCTION app.reap_webhook_deliveries(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  WITH due AS (
    SELECT delivery.id FROM app.webhook_deliveries AS delivery
     WHERE delivery.received_at < pg_catalog.now() - interval '1 year'
     ORDER BY delivery.received_at
     LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
     FOR UPDATE SKIP LOCKED)
  DELETE FROM app.webhook_deliveries AS target
   WHERE target.id IN (SELECT due.id FROM due);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.reap_outbox(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  WITH due AS (
    SELECT job.id FROM app.outbox AS job
     WHERE job.state = 'SUCCEEDED'
       AND job.finished_at < pg_catalog.now() - interval '90 days'
     ORDER BY job.finished_at
     LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
     FOR UPDATE SKIP LOCKED)
  DELETE FROM app.outbox AS target
   WHERE target.id IN (SELECT due.id FROM due)
     AND target.state = 'SUCCEEDED';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION app.reap_outbox(integer) IS
  'C-07. SUCCEEDED rows only, at 90 days. DEAD rows are KEPT - they are the '
  'failure record and the badge count - which is why the state predicate is '
  'repeated on the outer DELETE as well as in the locking sub-select.';

CREATE OR REPLACE FUNCTION app.reap_dead_letters(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  -- "Indefinite until replayed, then 1 year" (s5.5). An unreplayed dead letter
  -- is an open incident and is never deleted by this.
  WITH due AS (
    SELECT letter.id FROM app.dead_letters AS letter
     WHERE letter.replayed_at IS NOT NULL
       AND letter.replayed_at < pg_catalog.now() - interval '1 year'
     ORDER BY letter.replayed_at
     LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
     FOR UPDATE SKIP LOCKED)
  DELETE FROM app.dead_letters AS target
   WHERE target.id IN (SELECT due.id FROM due)
     AND target.replayed_at IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.reap_cron_history(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  -- Postgres does NOT clean cron.job_run_details up and it grows without bound;
  -- doc 05 s5.5 says so itself. The to_regclass guard returns 0 rather than
  -- raising where pg_cron is absent: a retention sweep must never be the thing
  -- that fails a cron tick, and 001's verify already asserts the extension.
  IF pg_catalog.to_regclass('cron.job_run_details') IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE $sql$
    WITH due AS (
      SELECT history.runid FROM cron.job_run_details AS history
       WHERE COALESCE(history.end_time, history.start_time)
             < pg_catalog.now() - interval '7 days'
       ORDER BY history.runid
       LIMIT $1
       FOR UPDATE SKIP LOCKED)
    DELETE FROM cron.job_run_details AS target
     WHERE target.runid IN (SELECT due.runid FROM due)
  $sql$ USING GREATEST(COALESCE(p_limit, 5000), 1);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- ═══ 14 · core.audit_entries · the drawer ═══════════════════════════════════

-- M-02: security_invoker = true at creation, not bolted on. The view is in
-- `core` because PostgREST exposes it and the drawer reads it; it adds no
-- privilege of its own, and until 014 grants SELECT nobody can read it at all.
--
-- `summary` is written by the emitter, never computed here. A CASE over thirty
-- event types in a view needs editing every time an event is added and renders
-- today's phrasing for a row from two years ago; writing the sentence once, at
-- emit time, means the drawer shows what was true when it happened (D8).
CREATE VIEW core.audit_entries WITH (security_invoker = true) AS
SELECT
  event.id,
  event.tenant_id,
  subject.subject_type,
  subject.subject_id,
  subject.role           AS subject_role,
  -- H-26: `at` comes from the SUBJECT row's denormalised copy, which is what
  -- event_subjects_lookup_idx is keyed on, so `order by at desc, id desc` walks
  -- the index instead of sorting the record's whole history.
  subject.occurred_at    AS at,
  event.actor,
  event.type             AS event,
  event.summary,
  event.run_id,
  event.correlation_id,
  event.causation_id,
  event.aggregate_type,
  event.aggregate_ref
FROM core.event_subjects AS subject
JOIN core.events AS event
  ON event.tenant_id = subject.tenant_id
 AND event.id = subject.event_id;

COMMENT ON VIEW core.audit_entries IS
  'The audit drawer (doc 05 s5.1). Derived from core.events, never duplicated: a '
  'second audit table doubles every write and drifts. Keyset paginated on '
  '(at, id) - OFFSET is not used, because on a long-lived organisation the later '
  'pages degrade linearly and rows inserted during paging shift the window.';

REVOKE ALL ON TABLE core.audit_entries FROM PUBLIC, anon, authenticated;

-- ═══ 15 · Privilege boundary ════════════════════════════════════════════════
--
-- Functions default to PUBLIC EXECUTE - 001 measured that ALTER DEFAULT
-- PRIVILEGES ... REVOKE does NOT take for functions, so the default is live and
-- this loop is the guard, not a formality. It names the 012 set exactly; no
-- blanket schema revoke, which would damage 002's caller-context RLS helpers
-- (M-04).
--
-- M-09 is closed here. Doc 05's `revoke execute on function app.emit_event`
-- omits the argument list and errors with "function name is not unique", so both
-- overloads would have stayed PUBLIC-executable. This loop iterates
-- `oid::regprocedure`, which is the FULL signature, so both are revoked and
-- neither can be missed.
DO $revoke$
DECLARE v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT procedure.oid::regprocedure
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'app'
       AND procedure.proname = ANY (ARRAY[
         'is_valid_actor','event_row_is_redaction_only','reject_mutation',
         'effect_status_for_job_state','outbox_payload_allowlist',
         'aggregate_type_for','job_type_for','job_priority_for',
         'next_submission_attempt','provider_idempotency_key',
         'emit_event','redact_event_actor','enqueue_effect_jobs',
         '_dead_letter_job','claim_jobs','heartbeat_job','complete_job',
         'fail_job','reap_jobs','cancel_jobs','replay_dead_letter','jobs_health',
         'webhook_path_for','resolve_webhook_tenant','record_webhook_delivery',
         'reap_webhook_bodies','reap_webhook_deliveries','reap_outbox',
         'reap_dead_letters','reap_cron_history'])
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function);
  END LOOP;
END;
$revoke$;

-- The worker surface, and nothing else. A handler holds the service role and
-- calls exactly these; every other function here is internal or is 015's cron.
--
-- app.emit_event is deliberately NOT granted: the worker reaches it through
-- complete_job, which is the choke point that validates the tenant and the
-- lease first. app.redact_event_actor is deliberately NOT granted: C-09.
-- The five reapers are deliberately NOT granted: 015's scheduler runs them.
GRANT EXECUTE ON FUNCTION app.claim_jobs(text,uuid,text[],integer,interval,integer) TO service_role;
GRANT EXECUTE ON FUNCTION app.heartbeat_job(uuid,uuid,text,interval)                TO service_role;
GRANT EXECUTE ON FUNCTION app.complete_job(uuid,uuid,text,jsonb,jsonb)              TO service_role;
GRANT EXECUTE ON FUNCTION app.fail_job(uuid,uuid,text,jsonb,boolean)                TO service_role;
GRANT EXECUTE ON FUNCTION app.reap_jobs(uuid,integer)                               TO service_role;
GRANT EXECUTE ON FUNCTION app.enqueue_effect_jobs(uuid,uuid)                        TO service_role;
GRANT EXECUTE ON FUNCTION app.cancel_jobs(uuid,text,integer)                        TO service_role;
GRANT EXECUTE ON FUNCTION app.replay_dead_letter(uuid,uuid,jsonb)                   TO service_role;
GRANT EXECUTE ON FUNCTION app.record_webhook_delivery(
  text,text,text,boolean,integer,jsonb,text,jsonb,jsonb)                            TO service_role;

-- ═══ 16 · Structural verification ═══════════════════════════════════════════
--
-- Off the catalogues, not a re-reading of the DDL above. If any of this is false
-- the transaction never commits. Nothing here is a text search of a function
-- body: 011 learned that a pg_get_functiondef tripwire fails on its own
-- whitespace and gets deleted by the next author. The BEHAVIOUR is proved by
-- test_012.

DO $verify$
DECLARE
  v_count      integer;
  v_role       text;
  v_relation   regclass;
  v_function   regprocedure;
  v_offender   text;
  v_kinds      text[];
BEGIN
  -- ── Inventory ───────────────────────────────────────────────────────────
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM (VALUES
      ('core.events'),('core.event_subjects'),('app.event_redactions'),
      ('app.event_subscriptions'),('app.outbox'),('app.job_type_map'),
      ('app.dead_letters'),('app.submission_counters'),
      ('app.webhook_deliveries'),('app.webhook_routes')
    ) AS expected(name)
   WHERE pg_catalog.to_regclass(expected.name) IS NOT NULL;
  IF v_count <> 10 THEN
    RAISE EXCEPTION '012 verify: expected 10 tables, found %', v_count;
  END IF;

  -- H-08. Enabled AND forced, on every one, before this migration commits.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE (namespace.nspname, class.relname) IN (
     ('core','events'),('core','event_subjects'),('app','event_redactions'),
     ('app','event_subscriptions'),('app','outbox'),('app','job_type_map'),
     ('app','dead_letters'),('app','submission_counters'),
     ('app','webhook_deliveries'),('app','webhook_routes'))
     AND class.relrowsecurity AND class.relforcerowsecurity;
  IF v_count <> 10 THEN
    RAISE EXCEPTION
      '012 verify: only % of 10 tables have RLS enabled AND forced', v_count;
  END IF;

  -- Exactly one policy, and it is the global catalogue's definer read. A
  -- permissive policy appearing on a TENANT-SCOPED table here would be a
  -- cross-tenant read grant, which is 014's decision and not this file's.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid IN (
     'core.events'::regclass,'core.event_subjects'::regclass,
     'app.event_redactions'::regclass,'app.event_subscriptions'::regclass,
     'app.outbox'::regclass,'app.job_type_map'::regclass,
     'app.dead_letters'::regclass,'app.submission_counters'::regclass,
     'app.webhook_deliveries'::regclass,'app.webhook_routes'::regclass);
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      '012 verify: expected exactly 1 policy (job_type_map definer read), found %',
      v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'app.job_type_map'::regclass
       AND policy.polname = 'job_type_map_definer_read'
       AND policy.polpermissive AND policy.polcmd = 'r') THEN
    RAISE EXCEPTION '012 verify: the job_type_map definer-read policy is missing '
      'or changed; app.job_type_for would read zero rows on a platform whose '
      'owner lacks BYPASSRLS and every external effect would stop enqueueing';
  END IF;

  -- ── search_path, on every function, as the exact stored string ──────────
  -- Not `proconfig IS NOT NULL`: that passes the broken single-quoted-comma
  -- spelling too. test_001 T3 asserts the same string across the whole applied
  -- set, so a function of mine failing this fails 001's pin, not only this one.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'app'
     AND procedure.proname = ANY (ARRAY[
       'is_valid_actor','event_row_is_redaction_only','reject_mutation',
       'effect_status_for_job_state','outbox_payload_allowlist',
       'aggregate_type_for','job_type_for','job_priority_for',
       'next_submission_attempt','provider_idempotency_key',
       'emit_event','redact_event_actor','enqueue_effect_jobs',
       '_dead_letter_job','claim_jobs','heartbeat_job','complete_job',
       'fail_job','reap_jobs','cancel_jobs','replay_dead_letter','jobs_health',
       'webhook_path_for','resolve_webhook_tenant','record_webhook_delivery',
       'reap_webhook_bodies','reap_webhook_deliveries','reap_outbox',
       'reap_dead_letters','reap_cron_history'])
     AND 'search_path=""' = ANY (procedure.proconfig);
  IF v_count <> 31 THEN
    RAISE EXCEPTION
      '012 verify: expected 31 functions (30 names, emit_event twice) at '
      'search_path="", found %', v_count;
  END IF;

  -- ── The append-only trigger, and its exemption helper ───────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'core.events'::regclass
       AND NOT trigger.tgisinternal
       AND trigger.tgname = 'events_append_only'
       AND trigger.tgfoid = 'app.reject_mutation()'::regprocedure
       -- BEFORE (1<<1 = 2 is ROW; TRIGGER_TYPE_BEFORE is 1<<1? use the bits the
       -- catalogue documents: 1 = ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE,
       -- 16 = UPDATE.
       AND (trigger.tgtype & 1) = 1      -- FOR EACH ROW
       AND (trigger.tgtype & 2) = 2      -- BEFORE
       AND (trigger.tgtype & 8) = 8      -- DELETE
       AND (trigger.tgtype & 16) = 16    -- UPDATE
       AND (trigger.tgtype & 4) = 0) THEN -- and NOT on INSERT
    RAISE EXCEPTION
      '012 verify: core.events is missing its BEFORE UPDATE OR DELETE FOR EACH '
      'ROW append-only trigger, or it has grown an INSERT branch';
  END IF;
  -- The TRUNCATE half. A row trigger does not fire for TRUNCATE, so without this
  -- the entire log is removable in one statement.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'core.events'::regclass
       AND NOT trigger.tgisinternal
       AND trigger.tgname = 'events_no_truncate'
       AND trigger.tgfoid = 'app.reject_mutation()'::regprocedure
       AND (trigger.tgtype & 32) = 32     -- TRUNCATE
       AND (trigger.tgtype & 1) = 0) THEN -- FOR EACH STATEMENT
    RAISE EXCEPTION
      '012 verify: core.events is missing its BEFORE TRUNCATE FOR EACH STATEMENT '
      'guard; a row trigger does not fire for TRUNCATE and the whole append-only '
      'log would be removable in one statement';
  END IF;

  -- ── N-09 · the actor vocabulary matches 003's enum, exactly ─────────────
  -- app.is_valid_actor enumerates four kinds because a CHECK needs an IMMUTABLE
  -- function and reading pg_enum would make it STABLE. This is what keeps the
  -- copy honest. enumlabel is `name`, not `text`, so it is cast - comparing a
  -- name[] to a text[] raises "operator does not exist".
  SELECT pg_catalog.array_agg(enum.enumlabel::text ORDER BY enum.enumsortorder)
    INTO v_kinds
    FROM pg_catalog.pg_enum AS enum
   WHERE enum.enumtypid = 'app.actor_kind'::regtype;
  IF v_kinds <> ARRAY['HUMAN','AGENT','SYSTEM','CLIENT'] THEN
    RAISE EXCEPTION
      '012 verify: app.actor_kind is now %, but app.is_valid_actor still '
      'enumerates HUMAN, AGENT, SYSTEM, CLIENT. One of them has to move.',
      pg_catalog.array_to_string(v_kinds, ', ');
  END IF;
  FOREACH v_offender IN ARRAY v_kinds LOOP
    IF NOT app.is_valid_actor(
         pg_catalog.jsonb_build_object('kind', v_offender, 'id', 'x', 'name', 'y')) THEN
      RAISE EXCEPTION '012 verify: app.is_valid_actor rejects the enum member %',
        v_offender;
    END IF;
  END LOOP;
  IF app.is_valid_actor('{"kind":"ROBOT","id":"x","name":"y"}'::jsonb)
     OR app.is_valid_actor('{"kind":"HUMAN","id":"x"}'::jsonb)
     OR app.is_valid_actor('{"kind":"HUMAN","id":1,"name":"y"}'::jsonb) THEN
    RAISE EXCEPTION
      '012 verify: app.is_valid_actor accepts a wrong SHAPE, not just a '
      'non-object - which is the half of R-JSONB that N-02 says gets skipped';
  END IF;

  -- ── R14 · the enum is 011''s, by pg_type oid, not by spelling ───────────
  IF (SELECT procedure.prorettype
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app'
         AND procedure.proname = 'effect_status_for_job_state')
     IS DISTINCT FROM
     (SELECT attribute.atttypid
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'app.action_effects'::regclass
         AND attribute.attname = 'status') THEN
    RAISE EXCEPTION
      '012 verify: the outbox seam does not resolve to app.action_effects.status''s '
      'own type. 012 must REUSE 011''s enum, never declare a second one.';
  END IF;
  IF (SELECT procedure.proargtypes[1]
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app' AND procedure.proname = 'report_effect_result')
     IS DISTINCT FROM 'app.effect_status'::regtype THEN
    RAISE EXCEPTION
      '012 verify: app.report_effect_result no longer takes app.effect_status; '
      'the 011/012 seam has moved and 012''s callers are writing into the dark';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_type AS type
       WHERE type.typname = 'effect_status') <> 1 THEN
    RAISE EXCEPTION '012 verify: effect_status was duplicated';
  END IF;
  -- It maps the two crossings and raises on everything else. Behavioural, not a
  -- text search of the body.
  IF app.effect_status_for_job_state('SUCCEEDED') <> 'SUCCEEDED'::app.effect_status
     OR app.effect_status_for_job_state('DEAD') <> 'FAILED'::app.effect_status THEN
    RAISE EXCEPTION '012 verify: the seam mapping is wrong';
  END IF;
  BEGIN
    PERFORM app.effect_status_for_job_state('CANCELLED');
    RAISE EXCEPTION
      '012 verify: effect_status_for_job_state accepted a non-terminal job '
      'state. An ELSE branch over another lane''s vocabulary is exactly what '
      'R14 exists to stop.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- ── N-02 · every jsonb column 012 created carries a CHECK naming it ─────
  -- Re-derived from pg_attribute, so a jsonb column added to one of these
  -- tables later with no constraint fails the migration rather than the review.
  SELECT pg_catalog.string_agg(
           attribute.attrelid::regclass::text || '.' || attribute.attname, ', ')
    INTO v_offender
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid IN (
           'core.events'::regclass,'core.event_subjects'::regclass,
           'app.event_redactions'::regclass,'app.event_subscriptions'::regclass,
           'app.outbox'::regclass,'app.job_type_map'::regclass,
           'app.dead_letters'::regclass,'app.submission_counters'::regclass,
           'app.webhook_deliveries'::regclass,'app.webhook_routes'::regclass)
     AND attribute.attnum > 0 AND NOT attribute.attisdropped
     AND attribute.atttypid = 'jsonb'::regtype
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS constraint_
        WHERE constraint_.conrelid = attribute.attrelid
          AND constraint_.contype = 'c'
          AND attribute.attnum = ANY (constraint_.conkey));
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '012 verify: jsonb column(s) with no CHECK naming them (ruling R-JSONB, '
      'N-02): %', v_offender;
  END IF;

  -- ── Index presence, by name ────────────────────────────────────────────
  SELECT pg_catalog.string_agg(wanted.name, ', ') INTO v_offender
    FROM (VALUES
      ('events_tenant_time_idx'),('events_tenant_type_time_idx'),
      ('events_idempotency_idx'),('events_correlation_idx'),('events_run_idx'),
      ('event_subjects_lookup_idx'),('event_subjects_event_idx'),
      ('outbox_claim_idx'),('outbox_claim_typed_idx'),('outbox_lease_idx'),
      ('outbox_retry_idx'),('outbox_failed_idx'),('outbox_health_idx'),
      ('outbox_job_key_idx'),('outbox_event_idx'),('outbox_action_idx'),
      ('outbox_effect_idx'),('outbox_subject_idx'),('outbox_succeeded_idx'),
      ('dead_letters_tenant_idx'),('dead_letters_replayed_job_idx'),
      ('webhook_deliveries_tenant_idx'),('webhook_deliveries_unrouted_idx'),
      ('webhook_deliveries_event_idx'),('event_redactions_event_idx')
    ) AS wanted(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_class AS class
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
      WHERE class.relkind = 'i' AND class.relname = wanted.name
        AND namespace.nspname IN ('app','core'));
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION '012 verify: missing index(es): %', v_offender;
  END IF;

  -- M-17. The duplicate must NOT exist: doc 05 declared the same table and
  -- column list twice, and creating both is double write amplification plus a
  -- direct hit on the project's own consolidation rule.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.relkind = 'i' AND class.relname = 'events_subject_idx') THEN
    RAISE EXCEPTION
      '012 verify: events_subject_idx exists. It and event_subjects_lookup_idx '
      'are the same index under two names (M-17); only one is created.';
  END IF;

  -- ── M-02 · the drawer view is invoker-rights ───────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'core.audit_entries'::regclass
       AND class.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION '012 verify: core.audit_entries is not security_invoker';
  END IF;

  -- ── s2.3a coverage · mapped plus deliberately-absent is the whole 22 ────
  -- This is the check that fails when somebody adds action type 23, which is the
  -- entire point of a mapping table.
  SELECT pg_catalog.string_agg(catalogue.key, ', ') INTO v_offender
    FROM app.action_types AS catalogue
   WHERE NOT EXISTS (SELECT 1 FROM app.job_type_map AS entry
                      WHERE entry.action_type = catalogue.key)
     AND catalogue.key NOT IN (
       -- Absent BY DESIGN: every effect of these six is in-database, so
       -- app.enqueue_effect_jobs never reaches the lookup for them. If one grows
       -- an external effect the lookup raises and the fix is an INSERT. That is
       -- the intended behaviour, not a bug to route around.
       'ENQUIRY_ARCHIVE','OPPORTUNITY_CONVERT','TNA_RECOMMENDATION_ACCEPT',
       'QUOTATION_APPLY','DISCOUNT_APPROVE','AGENT_AUTONOMY_CHANGE');
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '012 verify: action type(s) neither mapped in app.job_type_map nor on the '
      'deliberately-absent list: %', v_offender;
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT entry.action_type) FROM app.job_type_map AS entry) <> 16
     OR (SELECT pg_catalog.count(*) FROM app.job_type_map) <> 18 THEN
    RAISE EXCEPTION
      '012 verify: expected 18 job_type_map rows over 16 action types (16 mapped '
      '+ 6 absent by design = the 22 in app.action_types)';
  END IF;
  -- Entity precedence, and fail-closed, behaviourally.
  IF app.job_type_for('ENGAGEMENT_CLOSE_OUT','EvaluationLink') <> 'SEND_EMAIL'
     OR app.job_type_for('ENGAGEMENT_CLOSE_OUT') <> 'COMPLIANCE_CHECK_EVALUATE'
     OR app.job_type_for('INVOICE_PUSH','Anything') <> 'PUSH_INVOICE' THEN
    RAISE EXCEPTION '012 verify: job_type_for precedence or fallback is wrong';
  END IF;
  BEGIN
    PERFORM app.job_type_for('ENQUIRY_ARCHIVE');
    RAISE EXCEPTION '012 verify: job_type_for returned for an unmapped action '
      'type instead of raising. A NULL here enqueues a job no worker claims.';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  IF app.job_priority_for('ENQUIRY_ARCHIVE') <> 5 THEN
    RAISE EXCEPTION '012 verify: job_priority_for must NOT fail closed - '
      'refusing to enqueue a real effect over a scheduling preference is worse '
      'than running it at normal priority';
  END IF;

  -- ── M-26 · the four paths are the CONTRACT's ───────────────────────────
  IF app.webhook_path_for('EMAIL')      <> '/v1/webhooks/email'
     OR app.webhook_path_for('WHATSAPP')   <> '/v1/webhooks/whatsapp'
     OR app.webhook_path_for('PORTAL')     <> '/v1/webhooks/proposal-accepted'
     OR app.webhook_path_for('ACCOUNTING') <> '/v1/webhooks/accounting' THEN
    RAISE EXCEPTION
      '012 verify: a webhook path drifted from packages/contract '
      'INBOUND_WEBHOOKS[].path';
  END IF;

  -- ── M-07 · the allowlist drops, and keeps ──────────────────────────────
  IF app.outbox_payload_allowlist(
       '{"channel":"EMAIL","body":"free text","participantNric":"900101-14-5555"}'::jsonb)
     <> '{"channel":"EMAIL"}'::jsonb THEN
    RAISE EXCEPTION
      '012 verify: the outbox payload allowlist is not dropping unlisted keys';
  END IF;

  -- ── C-04 residue · zero client privilege on anything 012 created ───────
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR v_relation IN
      SELECT pg_catalog.to_regclass(name) FROM (VALUES
        ('core.events'),('core.event_subjects'),('app.event_redactions'),
        ('app.event_subscriptions'),('app.outbox'),('app.job_type_map'),
        ('app.dead_letters'),('app.submission_counters'),
        ('app.webhook_deliveries'),('app.webhook_routes'),('core.audit_entries')
      ) AS relation(name)
    LOOP
      IF pg_catalog.has_table_privilege(v_role, v_relation, 'SELECT')
         OR pg_catalog.has_table_privilege(v_role, v_relation, 'INSERT')
         OR pg_catalog.has_table_privilege(v_role, v_relation, 'UPDATE')
         OR pg_catalog.has_table_privilege(v_role, v_relation, 'DELETE') THEN
        RAISE EXCEPTION '012 verify: % holds a privilege on %', v_role, v_relation;
      END IF;
    END LOOP;
  END LOOP;

  -- M-09, both overloads, and PUBLIC as well as the two client roles.
  FOREACH v_role IN ARRAY ARRAY['public','anon','authenticated'] LOOP
    FOR v_function IN
      SELECT procedure.oid::regprocedure
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app'
         AND procedure.proname = ANY (ARRAY[
           'is_valid_actor','event_row_is_redaction_only','reject_mutation',
           'effect_status_for_job_state','outbox_payload_allowlist',
           'aggregate_type_for','job_type_for','job_priority_for',
           'next_submission_attempt','provider_idempotency_key',
           'emit_event','redact_event_actor','enqueue_effect_jobs',
           '_dead_letter_job','claim_jobs','heartbeat_job','complete_job',
           'fail_job','reap_jobs','cancel_jobs','replay_dead_letter','jobs_health',
           'webhook_path_for','resolve_webhook_tenant','record_webhook_delivery',
           'reap_webhook_bodies','reap_webhook_deliveries','reap_outbox',
           'reap_dead_letters','reap_cron_history'])
    LOOP
      IF pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') THEN
        RAISE EXCEPTION '012 verify: % holds EXECUTE on %', v_role, v_function;
      END IF;
    END LOOP;
  END LOOP;

  -- C-09: the erasure path is granted to NOBODY, service_role included.
  IF pg_catalog.has_function_privilege(
       'service_role',
       'app.redact_event_actor(uuid,uuid,jsonb,text,text,jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION
      '012 verify: service_role can call app.redact_event_actor. The C-09 '
      'exemption is defensible only while erasure is an act the migration role '
      'performs, not a request an endpoint serves.';
  END IF;

  RAISE NOTICE
    '012 verify: OK - 10 tables RLS-forced, 1 policy, 31 functions at '
    'search_path="", append-only trigger live, 18 job_type_map rows covering all '
    '22 action types, the seam resolves to 011''s own enum, zero client '
    'privileges.';
END;
$verify$;

COMMIT;
