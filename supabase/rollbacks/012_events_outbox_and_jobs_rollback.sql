-- ============================================================================
-- ROLLBACK 012 · events_outbox_and_jobs
-- ============================================================================
--
-- Forward file: migrations/012_events_outbox_and_jobs.sql
--
-- PRIOR STATE THIS RESTORES. The database as 011 left it: no event log, no
-- outbox, no job lifecycle, no dead letters, no webhook ledger, no audit view
-- and no retention reapers. `app.effect_status` and `app.report_effect_result`
-- SURVIVE - they are 011's and 012 only reused them.
--
-- THERE IS ONE PRIOR DEFINITION TO REPRODUCE, and it is reproduced IN FULL
-- below rather than referenced, because a rollback that says "see migration 011"
-- depends on another file being readable at the moment you need it, which is not
-- a rollback:
--
--   `app.action_effects.job_id uuid` is 011's column. 012 does not create it and
--   must not drop it; 012 WRITES it, in app.enqueue_effect_jobs. Rolling 012
--   back therefore clears the values 012 wrote and leaves the column standing.
--   Its prior definition, from 011 s2:
--
--     CREATE TABLE app.action_effects (
--       id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--       tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
--       action_request_id uuid        NOT NULL,
--       seq               integer     NOT NULL CHECK (seq > 0),
--       op                text        NOT NULL CHECK (op IN ('ADD','UPDATE','REMOVE')),
--       entity            text        NOT NULL,
--       ref               text,
--       description       text        NOT NULL,
--       kind              text        NOT NULL CHECK (kind IN ('IN_DATABASE','EXTERNAL')),
--       status            app.effect_status NOT NULL DEFAULT 'PLANNED',
--       job_id            uuid,
--       job_key           text,
--       attempts          integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
--       retryable         boolean     NOT NULL DEFAULT true,
--       last_error        jsonb,
--       applied_at        timestamptz,
--       created_at        timestamptz NOT NULL DEFAULT now(),
--       updated_at        timestamptz NOT NULL DEFAULT now(),
--       UNIQUE (action_request_id, seq),
--       UNIQUE (tenant_id, job_key),
--       CONSTRAINT action_effects_request_fk FOREIGN KEY (tenant_id, action_request_id)
--         REFERENCES core.action_requests (tenant_id, id) ON DELETE CASCADE,
--       CONSTRAINT action_effects_ledger_status_only CHECK (
--         status NOT IN ('SUCCEEDED','FAILED')),
--       CONSTRAINT action_effects_last_error_shape CHECK (
--         last_error IS NULL OR
--         (jsonb_typeof(last_error) = 'object'
--          AND last_error ? 'code' AND last_error ? 'message' AND last_error ? 'retryable'))
--     );
--
--   `job_id` carries no foreign key in 011 - it is a plain uuid - so there is no
--   constraint to drop and nothing in `app.outbox` that must be dropped first
--   for referential reasons. The UPDATE below is a DATA repair, not a schema
--   one: leaving a job id pointing at a table that no longer exists would make
--   the next reader believe a job row is findable.
--
-- ⛔ PRE-FLIGHT. Five guards, each refusing rather than cascading, and NONE of
-- them has an override. An override belongs to a gate a file OWNS and removes on
-- purpose, never to a later migration's dependency it would strip as a side
-- effect, and never to a business record.
--
--   G1  Any row in `core.events`. The event log is the business record. Doc 05
--       s5.5 retains it INDEFINITELY on purpose - the HRD Corp claim window runs
--       to six months after training completion, Malaysian record-keeping
--       obligations run to seven years, and an attendance lock is the
--       evidentiary basis for a grant claim. Dropping the table is a compliance
--       decision, not an ops one. The message says how to export first.
--   G2  Any row in `app.outbox` in a NON-TERMINAL state - QUEUED, CLAIMED or
--       FAILED. Every one of those is work the system still intends to do:
--       an unsent proposal email, an unpushed invoice, an unassembled HRD Corp
--       packet. Dropping the table completes none of them and reports nothing,
--       so the failure is silent and permanent. SUCCEEDED, DEAD and CANCELLED
--       rows do not block: they are history, and G3 covers the part of that
--       history somebody still has to act on.
--   G3  Any UNREPLAYED row in `app.dead_letters`. An unreplayed dead letter is
--       an open incident with a named cause; replayed ones are closed.
--   G4  Any row in `app.event_redactions`. A PDPA erasure that was performed and
--       then had its own audit trail dropped is worse than one that was never
--       performed, because the second is visible and the first is not.
--   G5  Any relation OUTSIDE 012's own set that depends on one of its tables or
--       on `core.audit_entries`. 013's agent tooling and 015's retention views
--       are the expected cases; a CASCADE would drop them silently.
--
-- WHY G1-G4 GUARD CONTENT AND NOT ONLY STRUCTURE. 001-009 guard structure - "has
-- a later migration put something here". 010 was the first to guard content,
-- because its tables hold money. 012's hold the record of what happened and the
-- work still outstanding, which is the same class of loss: a structurally clean
-- drop of a table holding three hundred queued jobs is a successful command and
-- a silent outage.
--
-- WHAT IS DELIBERATELY NOT GUARDED, and why: `app.webhook_deliveries`,
-- `app.event_subscriptions`, `app.webhook_routes`, `app.job_type_map` and
-- `app.submission_counters`. The first is an idempotency ledger whose only loss
-- is that a provider replay inside its retry window would be reprocessed; the
-- next three are configuration that a re-apply re-seeds or an operator re-enters;
-- the last is a counter whose loss re-starts submission attempts at 1, which is
-- correct once the jobs it numbered are gone with the outbox. Named here so the
-- absence reads as a decision rather than an omission.
--
-- DROP ORDER: the REVERSE of the forward order, children before parents.
--   view -> retention reapers -> webhook functions and tables -> job lifecycle
--   functions -> submission counter and dead letters -> emit_event and the
--   redaction path -> outbox -> job_type_map -> event_subscriptions ->
--   event_redactions -> event_subjects -> events -> the shared validators.
--
-- The two emit_event overloads are dropped BY FULL SIGNATURE. `DROP FUNCTION
-- app.emit_event` without an argument list errors with "function name is not
-- unique" - the same defect M-09 found in doc 05's REVOKE, and it would leave
-- the rollback half-applied at exactly the point where it is hardest to see.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

DO $preflight$
DECLARE
  v_n   bigint;
  v_dep text;
BEGIN
  -- ── G1 · no events ────────────────────────────────────────────────────────
  IF to_regclass('core.events') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM core.events' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 012 ABORTED: core.events holds % row(s). The event log is the '
        'business record and is retained indefinitely by design - the HRD Corp '
        'claim window is six months after delivery and Malaysian record-keeping '
        'runs to seven years. Export first: COPY (SELECT * FROM core.events) TO '
        '''/tmp/events.csv'' CSV HEADER; -- and note that the table CANNOT then '
        'be emptied casually: it is append-only by a row trigger AND by a '
        'statement-level TRUNCATE guard, so clearing it needs the owner to run '
        'ALTER TABLE core.events DISABLE TRIGGER events_append_only, DISABLE '
        'TRIGGER events_no_truncate first. That is deliberate. If you are doing '
        'that to get a rollback through, the rollback is not what you want.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G2 · no in-flight work ────────────────────────────────────────────────
  IF to_regclass('app.outbox') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM app.outbox
                WHERE state IN ('QUEUED','CLAIMED','FAILED')$q$ INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 012 ABORTED: app.outbox holds % row(s) in a non-terminal state '
        '(QUEUED, CLAIMED or FAILED). Each is a side effect the system still '
        'intends to perform - an unsent proposal email, an unpushed invoice - '
        'and dropping the table performs none of them and reports nothing. Drain '
        'the queue, or cancel the work deliberately with app.cancel_jobs, before '
        'rolling back.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G3 · no open incidents ────────────────────────────────────────────────
  IF to_regclass('app.dead_letters') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM app.dead_letters WHERE replayed_at IS NULL'
      INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 012 ABORTED: app.dead_letters holds % unreplayed row(s). Each '
        'is an open incident carrying the payload and the error that caused it. '
        'Replay or export them first.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G4 · no erasure audit to destroy ──────────────────────────────────────
  IF to_regclass('app.event_redactions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM app.event_redactions' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 012 ABORTED: app.event_redactions holds % row(s). That is the '
        'audit of every PDPA erasure performed against the event log (C-09). An '
        'erasure whose own record has been dropped is indistinguishable from '
        'tampering. Export it before rolling back.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G5 · nothing outside 012 depends on 012 ───────────────────────────────
  SELECT string_agg(DISTINCT dependent.relname, ', ') INTO v_dep
  FROM pg_catalog.pg_depend d
  JOIN pg_catalog.pg_rewrite rw ON rw.oid = d.objid
  JOIN pg_catalog.pg_class dependent ON dependent.oid = rw.ev_class
  JOIN pg_catalog.pg_class referenced ON referenced.oid = d.refobjid
  JOIN pg_catalog.pg_namespace rn ON rn.oid = referenced.relnamespace
  WHERE rn.nspname IN ('core','app')
    AND referenced.relname IN ('events','event_subjects','event_redactions',
                               'event_subscriptions','outbox','job_type_map',
                               'dead_letters','submission_counters',
                               'webhook_deliveries','webhook_routes',
                               'audit_entries')
    AND dependent.relname NOT IN ('events','event_subjects','event_redactions',
                                  'event_subscriptions','outbox','job_type_map',
                                  'dead_letters','submission_counters',
                                  'webhook_deliveries','webhook_routes',
                                  'audit_entries');
  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 012 ABORTED: relation(s) outside 012 depend on its tables: %. A '
      'later migration created them; roll that back first rather than letting a '
      'CASCADE remove them silently.', v_dep
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE
    'rollback 012 pre-flight: clear (no events, no in-flight jobs, no open dead '
    'letters, no erasure audit, no dependents).';
END;
$preflight$;

-- ─── Reverse of forward step 14 · the drawer view ───────────────────────────
DROP VIEW IF EXISTS core.audit_entries;

-- ─── Reverse of forward step 13 · the retention reapers ─────────────────────
DROP FUNCTION IF EXISTS app.reap_cron_history(integer);
DROP FUNCTION IF EXISTS app.reap_dead_letters(integer);
DROP FUNCTION IF EXISTS app.reap_outbox(integer);
DROP FUNCTION IF EXISTS app.reap_webhook_deliveries(integer);
DROP FUNCTION IF EXISTS app.reap_webhook_bodies(integer);

-- ─── Reverse of forward step 12 · inbound webhooks ──────────────────────────
-- Functions before tables: record_webhook_delivery reads webhook_routes, and
-- webhook_routes' CHECK depends on app.webhook_path_for, so the function must
-- outlive the table it constrains. Dropping it first would need a CASCADE that
-- silently removes that constraint from a table this file is about to drop
-- anyway - correct by accident, and wrong the moment somebody reorders it.
DROP FUNCTION IF EXISTS app.record_webhook_delivery(
  text, text, text, boolean, integer, jsonb, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS app.resolve_webhook_tenant(text, text);
DROP TABLE IF EXISTS app.webhook_routes CASCADE;
DROP TABLE IF EXISTS app.webhook_deliveries CASCADE;
DROP FUNCTION IF EXISTS app.webhook_path_for(text);

-- ─── Reverse of forward step 11 · the job lifecycle ─────────────────────────
DROP FUNCTION IF EXISTS app.jobs_health(uuid, interval, integer);
DROP FUNCTION IF EXISTS app.replay_dead_letter(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS app.cancel_jobs(uuid, text, integer);
DROP FUNCTION IF EXISTS app.reap_jobs(uuid, integer);
DROP FUNCTION IF EXISTS app.fail_job(uuid, uuid, text, jsonb, boolean);
DROP FUNCTION IF EXISTS app.complete_job(uuid, uuid, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS app.heartbeat_job(uuid, uuid, text, interval);
DROP FUNCTION IF EXISTS app.claim_jobs(text, uuid, text[], integer, interval, integer);
DROP FUNCTION IF EXISTS app._dead_letter_job(app.outbox, jsonb, text, jsonb);

-- ─── Reverse of forward step 10 · the sb-actions seam ───────────────────────
DROP FUNCTION IF EXISTS app.enqueue_effect_jobs(uuid, uuid);

-- 011's column, 012's values. The column SURVIVES; only what 012 wrote into it
-- is cleared, because a job id pointing at a table that no longer exists tells
-- the next reader the job is findable. The predicate is IS NOT NULL rather than
-- an unconditional UPDATE so the statement touches only rows 012 changed.
UPDATE app.action_effects SET job_id = NULL WHERE job_id IS NOT NULL;

-- ─── Reverse of forward steps 9 and 8 · redaction and emit_event ────────────
DROP FUNCTION IF EXISTS app.redact_event_actor(uuid, uuid, jsonb, text, text, jsonb);
-- BOTH overloads, by full signature. `DROP FUNCTION app.emit_event` with no
-- argument list errors "function name is not unique" (M-09's defect, in the
-- other direction) and leaves the rollback half-applied.
DROP FUNCTION IF EXISTS app.emit_event(uuid, text, uuid);
DROP FUNCTION IF EXISTS app.emit_event(
  uuid, text, text, uuid, text, jsonb, text, jsonb, uuid, uuid, text, text, jsonb);

-- ─── Reverse of forward step 7 · dead letters and the counter ───────────────
DROP FUNCTION IF EXISTS app.provider_idempotency_key(text, integer);
DROP FUNCTION IF EXISTS app.next_submission_attempt(uuid, text);
DROP TABLE IF EXISTS app.submission_counters CASCADE;
DROP TABLE IF EXISTS app.dead_letters CASCADE;

-- ─── Reverse of forward step 6 · the job type map ───────────────────────────
DROP FUNCTION IF EXISTS app.aggregate_type_for(text);
DROP FUNCTION IF EXISTS app.job_priority_for(text, text);
DROP FUNCTION IF EXISTS app.job_type_for(text, text);
-- The policy goes with the table; named explicitly so a reader of this file can
-- see that the one pre-014 policy 012 created is accounted for.
DROP POLICY IF EXISTS job_type_map_definer_read ON app.job_type_map;
DROP TABLE IF EXISTS app.job_type_map CASCADE;

-- ─── Reverse of forward step 5 · the outbox ─────────────────────────────────
DROP TABLE IF EXISTS app.outbox CASCADE;

-- ─── Reverse of forward step 4 · subscriptions ──────────────────────────────
DROP TABLE IF EXISTS app.event_subscriptions CASCADE;

-- ─── Reverse of forward step 3 · the erasure audit ──────────────────────────
DROP TABLE IF EXISTS app.event_redactions CASCADE;

-- ─── Reverse of forward step 2 · the event log ──────────────────────────────
-- The trigger goes with the table; dropped explicitly first so that a reader
-- comparing this file to the forward one line for line finds it, and so that a
-- future edit which keeps core.events cannot leave a trigger pointing at a
-- function this file is about to drop.
DROP TRIGGER IF EXISTS events_no_truncate ON core.events;
DROP TRIGGER IF EXISTS events_append_only ON core.events;
DROP TABLE IF EXISTS core.event_subjects CASCADE;
DROP TABLE IF EXISTS core.events CASCADE;

-- ─── Reverse of forward step 1 · the shared validators ──────────────────────
-- Last, because every CHECK constraint above depended on them. app.effect_status
-- and app.report_effect_result are NOT dropped: they are 011's, and 012 only
-- reused them.
DROP FUNCTION IF EXISTS app.outbox_payload_allowlist(jsonb);
DROP FUNCTION IF EXISTS app.effect_status_for_job_state(text);
DROP FUNCTION IF EXISTS app.reject_mutation();
DROP FUNCTION IF EXISTS app.event_row_is_redaction_only(jsonb, jsonb);
DROP FUNCTION IF EXISTS app.is_valid_actor(jsonb);

DO $verify$
DECLARE v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('app','core') AND c.relkind IN ('r','v')
    AND c.relname IN ('events','event_subjects','event_redactions',
                      'event_subscriptions','outbox','job_type_map',
                      'dead_letters','submission_counters','webhook_deliveries',
                      'webhook_routes','audit_entries');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 012: relation(s) survived the drop: %', v_left;
  END IF;

  SELECT string_agg(p.proname || '(' ||
                    pg_get_function_identity_arguments(p.oid) || ')', ', ')
    INTO v_left
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app'
    AND p.proname IN ('is_valid_actor','event_row_is_redaction_only',
                      'reject_mutation','effect_status_for_job_state',
                      'outbox_payload_allowlist','aggregate_type_for',
                      'job_type_for','job_priority_for','next_submission_attempt',
                      'provider_idempotency_key','emit_event',
                      'redact_event_actor','enqueue_effect_jobs',
                      '_dead_letter_job','claim_jobs','heartbeat_job',
                      'complete_job','fail_job','reap_jobs','cancel_jobs',
                      'replay_dead_letter','jobs_health','webhook_path_for',
                      'resolve_webhook_tenant','record_webhook_delivery',
                      'reap_webhook_bodies','reap_webhook_deliveries',
                      'reap_outbox','reap_dead_letters','reap_cron_history');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 012: function(s) survived the drop: %', v_left;
  END IF;

  -- 011 MUST survive. A rollback that removes a migration it does not own has
  -- destroyed work, not undone its own.
  IF to_regtype('app.effect_status') IS NULL THEN
    RAISE EXCEPTION
      'rollback 012: app.effect_status was dropped. It is 011''s enum; 012 only '
      'reused it, and a rollback that removes it has taken the action ledger''s '
      'status column with it';
  END IF;
  IF to_regproc('app.report_effect_result') IS NULL THEN
    RAISE EXCEPTION
      'rollback 012: app.report_effect_result was dropped. It is 011''s.';
  END IF;
  IF to_regclass('app.action_effects') IS NULL THEN
    RAISE EXCEPTION
      'rollback 012: app.action_effects was dropped. It is 011''s table; 012 only '
      'wrote its job_id column';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'app.action_effects'::regclass
       AND attname = 'job_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE EXCEPTION
      'rollback 012: app.action_effects.job_id was dropped. 012 wrote that '
      'column; 011 created it, and only its VALUES are 012''s to clear';
  END IF;
  IF EXISTS (SELECT 1 FROM app.action_effects WHERE job_id IS NOT NULL) THEN
    RAISE EXCEPTION
      'rollback 012: app.action_effects.job_id still points at outbox rows that '
      'no longer exist';
  END IF;

  -- 011's one pre-014 policy must still be the only one in the gate's set.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
     WHERE polname = 'autonomy_grants_agents_cannot_write') THEN
    RAISE EXCEPTION
      'rollback 012: 011''s H-02 restrictive policy is gone. 012 did not create '
      'it and this file must not have removed it';
  END IF;

  RAISE NOTICE
    'rollback 012: complete - 10 tables, 1 view, 30 function names (31 '
    'signatures) and 1 policy removed; 011''s effect_status, report_effect_result '
    'and action_effects (job_id cleared) left standing.';
END;
$verify$;

COMMIT;
