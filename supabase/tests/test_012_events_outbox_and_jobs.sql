-- ============================================================================
-- PIN 012 · events_outbox_and_jobs
-- ============================================================================
--
-- Run against the complete 001-012 set. Ends in ROLLBACK; writes nothing durable.
--   psql "$DATABASE_URL" -f supabase/tests/test_012_events_outbox_and_jobs.sql
--
-- T1  Exact object, policy, index, trigger, seam and search_path inventory,
--     plus the R-JSONB coverage sweep re-derived from pg_attribute (N-02).
-- T2  At-least-once delivery (s8.1): the enqueue is transactional, every job is
--     eventually claimed exactly once, and an expired lease is redelivered with
--     attempts incremented.
-- T3  The duplicate consumer (s8.2): a replayed idempotency key writes ONE
--     event, returns the SAME id and enqueues NO second job; complete_job twice
--     raises the second time; a replayed webhook returns IGNORED_DUPLICATE with
--     one delivery row and one event.
-- T4  Retry exhaustion (s8.3, C-08): a job at max_attempts is NOT returned by
--     claim_jobs and IS dead-lettered by reap_jobs; a non-retryable failure goes
--     straight to DEAD; backoff is bounded by an hour and jittered.
-- T5  H-12 and M-14: fail_job REFUSES a job it does not own - including the
--     exact race, where A's lease expires, the reaper requeues, B claims and A
--     then calls fail_job - and heartbeat_job refuses likewise.
-- T6  C-09: core.events refuses UPDATE, DELETE and TRUNCATE, and
--     app.redact_event_actor is the ONE path that can change a committed row -
--     narrowly, and with its own audit row carrying the before image.
-- T7  N-02: every jsonb CHECK rejects a PLAUSIBLE WRONG SHAPE, not merely a
--     non-object. Doc 04 s735's legacy-jury case is the model.
-- T8  M-09: neither app.emit_event overload is PUBLIC-executable.
-- T9  Correlation and audit (s8.7): the chain shares one correlation_id, each
--     causation_id points at its predecessor, the job carries the same
--     correlation, and the drawer returns them in occurred_at DESC including a
--     RELATED subject whose aggregate is a different record.
-- T10 Worker lifetime and tenant isolation (s8.5): the lease cannot exceed six
--     minutes, and complete_job, fail_job and heartbeat_job all refuse a job
--     addressed with the wrong tenant (H-15).
-- T11 Zero anon/authenticated SELECT and EXECUTE on everything 012 creates,
--     probed by impersonation as well as by catalogue (C-04 residue).
-- T12 THE SEAM (R14): 011's app.report_effect_result accepts what 012 sends -
--     end to end, from a DISPATCHED effect through enqueue, claim and
--     complete_job to a SETTLED effect and an EXECUTED action - and RAISES on a
--     value neither side declares.
-- T13 M-20: a replay is a NEW job with a NEW job_key and the SAME provider
--     idempotency key, and the original row is unchanged.
-- T14 M-07 allowlist, M-24 CANCELLED actually written, M-26 contract paths,
--     H-16 fairness, H-17 jobs_health, H-18/C-07 the five reapers each
--     returning a count.
--
-- ── TWO NOTES ON SHAPE, BOTH DELIBERATE ──────────────────────────────────
--
-- RPC PROBE SHAPE. Every 012 function has intentionally NO authenticated
-- EXECUTE before 014 (C-04 residue), so running the RPCs "under
-- SET LOCAL ROLE authenticated" would contradict the state this pack is
-- required to be in. This pin does what test_011 settled on: it uses the
-- production service_role entry privilege for the worker surface while keeping
-- the JWT identity real, and it runs the authenticated/anon probes as REFUSALS
-- rather than as calls. Each impersonation probe is ONE STATEMENT, its result is
-- parked in a transaction-local GUC, and the assertions run only after
-- RESET ROLE - because a direct read of a forced-RLS, REVOKE-ALL table would
-- fail at the grant layer before it ever reached its subject.
--
-- GOV-07. No fixture here writes a gated column. The fifteen columns 011 gates
-- are on core.enquiries, opportunities, tnas, proposals, quotations,
-- engagements, attendance_days, hrdc_packets, invoices (x2), collections_cases,
-- trainer_bookings, compliance_rules, rule_changes and outbound_messages;
-- core.action_requests.status and app.action_effects.status are NOT among them,
-- and those two are the only 011 tables this pin writes. The pg_temp.gate helper
-- six other pins carry is therefore not needed here, and is not copied in to
-- look thorough - checked against pg_trigger, not assumed.
-- ============================================================================

--
-- ⚠ WHICH DATABASE THIS RUNS AGAINST: 001-014, NOT 001-012.
-- Some assertions below require migration 014's client grants to be present —
-- T11c asserts that `app` holds no client privilege, which is a statement about grants 014 makes elsewhere — so running this pin against a 001-012-only database fails for a reason
-- that is about the harness, not about this pack. Confirmed by execution: run at
-- 001-012 alone it fails there; apply 014 and it passes. The catalog says the
-- same. This is a real ordering dependency of the PIN, not of the MIGRATION: 0012
-- itself applies and verifies cleanly with nothing after it.

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_012 SETUP FAILURE: plpgsql.check_asserts is off';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF pg_catalog.to_regclass('core.events') IS NULL
     OR pg_catalog.to_regclass('app.outbox') IS NULL
     OR pg_catalog.to_regclass('app.job_type_map') IS NULL
     OR pg_catalog.to_regproc('app.claim_jobs') IS NULL THEN
    RAISE EXCEPTION 'test_012 SETUP FAILURE: migration 012 is missing or partial';
  END IF;
  -- The premise the whole pack rests on, checked rather than assumed (R13).
  IF pg_catalog.to_regtype('app.effect_status') IS NULL
     OR pg_catalog.to_regproc('app.report_effect_result') IS NULL THEN
    RAISE EXCEPTION 'test_012 SETUP FAILURE: 011''s effect seam is absent';
  END IF;
END;
$setup$;

-- ─── Fixtures ──────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('00000012-0000-0000-0000-0000000000a1','t012-sales@example.invalid'),
  ('00000012-0000-0000-0000-0000000000a2','t012-finance@example.invalid'),
  ('00000012-0000-0000-0000-0000000000a3','t012-dpo@example.invalid');

INSERT INTO public.tenants (id, slug, name, timezone) VALUES
  ('00000012-1111-1111-1111-111111111111','t012-alpha','T012 Alpha','Asia/Kuala_Lumpur'),
  ('00000012-2222-2222-2222-222222222222','t012-beta','T012 Beta','Asia/Kuala_Lumpur');

INSERT INTO public.memberships
  (tenant_id, user_id, role, actor_kind, agent_id, status, is_default)
VALUES
  ('00000012-1111-1111-1111-111111111111','00000012-0000-0000-0000-0000000000a1',
   'SALES','HUMAN',NULL,'ACTIVE',true),
  ('00000012-1111-1111-1111-111111111111','00000012-0000-0000-0000-0000000000a2',
   'FINANCE','HUMAN',NULL,'ACTIVE',true),
  ('00000012-1111-1111-1111-111111111111','00000012-0000-0000-0000-0000000000a3',
   'ADMIN','HUMAN',NULL,'ACTIVE',true);

INSERT INTO public.user_profiles (tenant_id, user_id, display_name) VALUES
  ('00000012-1111-1111-1111-111111111111','00000012-0000-0000-0000-0000000000a1','Alex Selvarajah'),
  ('00000012-1111-1111-1111-111111111111','00000012-0000-0000-0000-0000000000a2','T012 Finance'),
  ('00000012-1111-1111-1111-111111111111','00000012-0000-0000-0000-0000000000a3','T012 DPO');

-- Routing, so a webhook can resolve a tenant. The path is the CONTRACT's and the
-- CHECK refuses anything else (M-26).
INSERT INTO app.webhook_routes (source, external_id, route_path, tenant_id) VALUES
  ('ACCOUNTING','acct-tenant-alpha','/v1/webhooks/accounting',
   '00000012-1111-1111-1111-111111111111');

-- Routing for the event fan-out. 012 seeds NO subscription rows on purpose, so
-- the pin supplies its own rather than depending on a seed that is deliberately
-- absent.
INSERT INTO app.event_subscriptions (event_type, job_type, tenant_id, priority) VALUES
  ('ProposalSent','SEND_EMAIL',NULL,1),
  ('InvoiceValidated','USAGE_ROLLUP',NULL,9);

-- 011's action ledger, written directly. core.action_requests is NOT a gated
-- table (see the GOV-07 note in the header), and `ref` is supplied explicitly so
-- the fixture needs no core.ref_formats row for ACT.
INSERT INTO core.action_requests
  (id, tenant_id, ref, action_type, target_ref, target_id, payload, status,
   requested_by_kind, requested_by_id)
VALUES
  ('00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000012-1111-1111-1111-111111111111',
   'ACT-T012-0001','INVOICE_PUSH','INV-T012-0001',
   '00000012-dddd-dddd-dddd-ddddddddddd1',
   '{"channel":"EMAIL","body":"free text that must not travel"}'::jsonb,
   'EXECUTING','HUMAN','00000012-0000-0000-0000-0000000000a1'),
  ('00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa2','00000012-1111-1111-1111-111111111111',
   'ACT-T012-0002','INVOICE_PUSH','INV-T012-0002',
   '00000012-dddd-dddd-dddd-ddddddddddd2','{}'::jsonb,
   'EXECUTING','HUMAN','00000012-0000-0000-0000-0000000000a1');

INSERT INTO app.action_effects
  (tenant_id, action_request_id, seq, op, entity, ref, description, kind, status, job_key)
VALUES
  ('00000012-1111-1111-1111-111111111111','00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   1,'ADD','AccountingPackage','INV-T012-0001','Push the invoice','EXTERNAL',
   'DISPATCHED','00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa1:1'),
  ('00000012-1111-1111-1111-111111111111','00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
   1,'ADD','AccountingPackage','INV-T012-0002','Push the invoice','EXTERNAL',
   'DISPATCHED','00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa2:1');

-- ─── Temporary impersonation adapters ──────────────────────────────────────
-- SECURITY INVOKER, so the probe genuinely runs as the impersonated role. Each
-- one catches and returns; the caller parks the result in a GUC and asserts
-- after RESET ROLE.

CREATE FUNCTION pg_temp.t012_probe_select(p_relation text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE v_n bigint;
BEGIN
  EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM %s', p_relation) INTO v_n;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'rows', v_n);
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE);
END;
$fn$;

CREATE FUNCTION pg_temp.t012_probe_call(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN pg_catalog.jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE);
END;
$fn$;

-- ─── T1 · inventory ────────────────────────────────────────────────────────

DO $t1$
DECLARE
  v_count    integer;
  v_offender text;
  v_seam     oid;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM (VALUES
      ('core.events'),('core.event_subjects'),('app.event_redactions'),
      ('app.event_subscriptions'),('app.outbox'),('app.job_type_map'),
      ('app.dead_letters'),('app.submission_counters'),
      ('app.webhook_deliveries'),('app.webhook_routes')
    ) AS expected(name)
   WHERE pg_catalog.to_regclass(expected.name) IS NOT NULL;
  ASSERT v_count = 10, pg_catalog.format('T1a FAIL: expected 10 tables, found %s', v_count);

  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE (namespace.nspname, class.relname) IN (
     ('core','events'),('core','event_subjects'),('app','event_redactions'),
     ('app','event_subscriptions'),('app','outbox'),('app','job_type_map'),
     ('app','dead_letters'),('app','submission_counters'),
     ('app','webhook_deliveries'),('app','webhook_routes'))
     AND class.relrowsecurity AND class.relforcerowsecurity;
  ASSERT v_count = 10,
    pg_catalog.format('T1b FAIL (H-08): only %s of 10 tables are RLS enabled AND forced', v_count);

  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'app'
     AND procedure.proname = ANY (ARRAY[
       'is_valid_actor','event_row_is_redaction_only','reject_mutation',
       'effect_status_for_job_state','outbox_payload_allowlist',
       'aggregate_type_for','job_type_for','job_priority_for',
       'next_submission_attempt','provider_idempotency_key','emit_event',
       'redact_event_actor','enqueue_effect_jobs','_dead_letter_job',
       'claim_jobs','heartbeat_job','complete_job','fail_job','reap_jobs',
       'cancel_jobs','replay_dead_letter','jobs_health','webhook_path_for',
       'resolve_webhook_tenant','record_webhook_delivery','reap_webhook_bodies',
       'reap_webhook_deliveries','reap_outbox','reap_dead_letters',
       'reap_cron_history'])
     AND 'search_path=""' = ANY (procedure.proconfig);
  ASSERT v_count = 31,
    pg_catalog.format('T1c FAIL: expected 31 functions at search_path="", found %s', v_count);

  -- Exactly one policy, and it is the global catalogue's. A permissive policy on
  -- a tenant-scoped table here would be a cross-tenant read grant.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid IN (
     'core.events'::regclass,'core.event_subjects'::regclass,
     'app.event_redactions'::regclass,'app.event_subscriptions'::regclass,
     'app.outbox'::regclass,'app.job_type_map'::regclass,
     'app.dead_letters'::regclass,'app.submission_counters'::regclass,
     'app.webhook_deliveries'::regclass,'app.webhook_routes'::regclass);
  -- ⚠ AMENDED BY 014 (2026-09-13). Was 1 — the global catalogue's — on the
  -- ground that "a permissive policy on a tenant-scoped table here would be a
  -- cross-tenant read grant". That was true while there were no grants. 014 adds
  -- its two-policy tenant posture to the two tenant-scoped core tables in this
  -- set (core.events, core.event_subjects), so the count is 1 + 2x2 = 5, and the
  -- cross-tenant read it warned about is what those policies now prevent. The
  -- eight app.* relations in the list still carry no 014 policy and no grant,
  -- which is asserted separately below rather than folded into a number.
  -- ⚠ AMENDED BY 033 (2026-09-14). +1: 033 adds a third, bespoke RESTRICTIVE
  -- policy on core.events, events_no_client_033, excluding CLIENT — see 033's
  -- migration header for why core.events could not use the permission-gate
  -- mechanism 033 uses everywhere else (audit:read is held by every
  -- non-CLIENT/AGENT role, so app.apply_tenant_policies correctly refuses to
  -- build a gate from it). core.event_subjects is untouched by 033. 5 + 1 = 6.
  ASSERT v_count = 6,
    pg_catalog.format('T1d FAIL: expected 6 policies (app.job_type_map''s global '
      'catalogue policy, 014''s select+isolation pair on each of core.events '
      'and core.event_subjects, plus 033''s events_no_client_033), found %s', v_count);
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid IN (
     'app.event_redactions'::regclass,'app.event_subscriptions'::regclass,
     'app.outbox'::regclass,'app.dead_letters'::regclass,
     'app.submission_counters'::regclass,'app.webhook_deliveries'::regclass,
     'app.webhook_routes'::regclass);
  ASSERT v_count = 0,
    pg_catalog.format('T1d2 FAIL: an app.* relation in the 012 set carries a '
      'policy. 014 policies core only; app is unexposed and ungranted, and a '
      'policy here would imply somebody intends to grant it. Found %s', v_count);
  ASSERT (SELECT policy.polrelid FROM pg_catalog.pg_policy AS policy
           WHERE policy.polname = 'job_type_map_definer_read')
         = 'app.job_type_map'::regclass,
    'T1e FAIL: the one pre-014 policy is not job_type_map''s definer read';

  -- M-17: one index, not two.
  ASSERT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS class
                      WHERE class.relkind = 'i' AND class.relname = 'events_subject_idx'),
    'T1f FAIL (M-17): events_subject_idx and event_subjects_lookup_idx are the '
    'same index under two names; only one may exist';

  -- H-26: the drawer index carries the drawer's own ordering, and occurred_at
  -- leads event_id. Asserted as the EXACT column list, not "contains".
  ASSERT (SELECT pg_catalog.pg_get_indexdef(class.oid)
            FROM pg_catalog.pg_class AS class
           WHERE class.relname = 'event_subjects_lookup_idx' AND class.relkind = 'i')
         = 'CREATE INDEX event_subjects_lookup_idx ON core.event_subjects '
           'USING btree (tenant_id, subject_type, subject_id, occurred_at DESC, event_id DESC)',
    pg_catalog.format('T1g FAIL (H-26): the drawer index is %s',
      (SELECT pg_catalog.pg_get_indexdef(class.oid) FROM pg_catalog.pg_class AS class
        WHERE class.relname = 'event_subjects_lookup_idx' AND class.relkind = 'i'));

  -- H-17, H-18, M-15, M-16: the indexes those findings name, by name.
  SELECT pg_catalog.string_agg(wanted.name, ', ') INTO v_offender
    FROM (VALUES ('outbox_health_idx'),('outbox_retry_idx'),
                 ('outbox_claim_typed_idx'),('events_correlation_idx'),
                 ('dead_letters_replayed_job_idx'),('webhook_deliveries_event_idx'))
      AS wanted(name)
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS class
                      WHERE class.relkind = 'i' AND class.relname = wanted.name);
  ASSERT v_offender IS NULL,
    pg_catalog.format('T1h FAIL: missing index(es) %s', v_offender);

  -- R14: the seam is 011's own type, by oid.
  SELECT attribute.atttypid INTO v_seam
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = 'app.action_effects'::regclass
     AND attribute.attname = 'status';
  ASSERT v_seam = (SELECT procedure.prorettype FROM pg_catalog.pg_proc AS procedure
                     JOIN pg_catalog.pg_namespace AS namespace
                       ON namespace.oid = procedure.pronamespace
                    WHERE namespace.nspname = 'app'
                      AND procedure.proname = 'effect_status_for_job_state'),
    'T1i FAIL (R14): the outbox seam is not app.action_effects.status''s own type';
  ASSERT v_seam = 'app.effect_status'::regtype,
    'T1j FAIL: app.action_effects.status is no longer app.effect_status';
  ASSERT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_type AS type
           WHERE type.typname = 'effect_status') = 1,
    'T1k FAIL: effect_status was duplicated';

  -- M-02.
  ASSERT (SELECT class.reloptions FROM pg_catalog.pg_class AS class
           WHERE class.oid = 'core.audit_entries'::regclass)
         @> ARRAY['security_invoker=true'],
    'T1l FAIL (M-02): core.audit_entries is not security_invoker';

  -- N-02 coverage, re-derived from the catalogue rather than from the DDL.
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
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS constraint_
                      WHERE constraint_.conrelid = attribute.attrelid
                        AND constraint_.contype = 'c'
                        AND attribute.attnum = ANY (constraint_.conkey));
  ASSERT v_offender IS NULL,
    pg_catalog.format('T1m FAIL (N-02): jsonb column(s) with no CHECK: %s', v_offender);

  -- s2.3a coverage: mapped plus deliberately-absent is exactly the 22.
  ASSERT (SELECT pg_catalog.count(*) FROM app.job_type_map) = 18,
    'T1n FAIL: expected 18 job_type_map rows';
  ASSERT (SELECT pg_catalog.count(DISTINCT entry.action_type) FROM app.job_type_map AS entry) = 16,
    'T1o FAIL: expected 16 mapped action types';
  -- ⚠ AMENDED BY 021: 22 -> 23. OPPORTUNITY_STAGE_CHANGE is in-database only, so
  -- it is one more deliberately-unmapped type and the 18/16 map counts hold.
  ASSERT (SELECT pg_catalog.count(*) FROM app.action_types) = 23,
    'T1p FAIL: app.action_types is no longer 23 rows; the coverage arithmetic moved';

  RAISE NOTICE 'T1 PASS - 10 RLS-forced tables, 1 policy, 31 functions at '
    'search_path="", one drawer index with H-26''s ordering, the seam at 011''s '
    'own oid, full R-JSONB coverage, 18/16/22 mapping arithmetic.';
END;
$t1$;

-- ─── T2 · at-least-once delivery (s8.1) ────────────────────────────────────

DO $t2$
DECLARE
  v_ids      uuid[];
  v_batch    uuid[];
  v_all      uuid[] := ARRAY[]::uuid[];
  v_attempts integer;
  v_state    text;
BEGIN
  -- 100 jobs, claimed in batches of 7 until the queue is empty. Every id must
  -- appear exactly once: that is what SKIP LOCKED plus the state predicate buy,
  -- and a future `FOR UPDATE` without SKIP LOCKED fails here.
  INSERT INTO app.outbox (tenant_id, job_type, correlation_id, max_attempts)
  SELECT '00000012-1111-1111-1111-111111111111','T012_BULK',
         pg_catalog.gen_random_uuid(), 5
    FROM pg_catalog.generate_series(1, 100);

  LOOP
    SELECT pg_catalog.array_agg(claimed.id) INTO v_batch
      FROM app.claim_jobs('t012-worker-a',
                          '00000012-1111-1111-1111-111111111111',
                          ARRAY['T012_BULK'], 7) AS claimed;
    EXIT WHEN v_batch IS NULL;
    v_all := v_all || v_batch;
  END LOOP;

  ASSERT pg_catalog.cardinality(v_all) = 100,
    pg_catalog.format('T2a FAIL: claimed %s of 100 jobs', pg_catalog.cardinality(v_all));
  ASSERT (SELECT pg_catalog.count(DISTINCT element) FROM pg_catalog.unnest(v_all) AS element) = 100,
    'T2b FAIL: an id was claimed twice - SKIP LOCKED or the state predicate is gone';
  ASSERT (SELECT pg_catalog.count(*) FROM app.outbox AS job
           WHERE job.job_type = 'T012_BULK' AND job.state = 'CLAIMED') = 100,
    'T2c FAIL: not every bulk job reached CLAIMED';
  ASSERT (SELECT pg_catalog.count(*) FROM app.outbox AS job
           WHERE job.job_type = 'T012_BULK' AND job.attempts <> 1) = 0,
    'T2d FAIL: attempts must increment exactly once at claim time';

  -- Lease expiry redelivers, and the redelivery burns another attempt.
  UPDATE app.outbox SET visible_after = pg_catalog.now() - interval '1 second'
   WHERE job_type = 'T012_BULK';
  PERFORM app.reap_jobs('00000012-1111-1111-1111-111111111111', 1000);

  SELECT job.state, job.attempts INTO v_state, v_attempts
    FROM app.outbox AS job WHERE job.id = v_all[1];
  ASSERT v_state = 'QUEUED' AND v_attempts = 1,
    pg_catalog.format('T2e FAIL: after reap the job is %s / attempts %s, '
      'expected QUEUED / 1', v_state, v_attempts);

  SELECT pg_catalog.array_agg(claimed.id) INTO v_ids
    FROM app.claim_jobs('t012-worker-a','00000012-1111-1111-1111-111111111111',
                        ARRAY['T012_BULK'], 1) AS claimed;
  SELECT job.attempts INTO v_attempts FROM app.outbox AS job WHERE job.id = v_ids[1];
  ASSERT v_attempts = 2,
    pg_catalog.format('T2f FAIL: a re-claim must burn a second attempt, got %s', v_attempts);

  RAISE NOTICE 'T2 PASS - 100 jobs claimed exactly once in batches of 7, one '
    'attempt each; an expired lease returns to QUEUED and the re-claim burns the '
    'second attempt.';
END;
$t2$;

-- ─── T3 · the duplicate consumer (s8.2) ────────────────────────────────────

DO $t3$
DECLARE
  v_first  uuid;
  v_second uuid;
  v_job    uuid;
  v_reply  jsonb;
  v_reply2 jsonb;
BEGIN
  v_first := app.emit_event(
    '00000012-1111-1111-1111-111111111111','ProposalSent','PROPOSAL',
    '00000012-eeee-eeee-eeee-eeeeeeeeeee1','PRO-T012-1',
    '{"channel":"EMAIL"}'::jsonb,'Proposal PRO-T012-1 sent',
    '{"kind":"HUMAN","id":"00000012-0000-0000-0000-0000000000a1","name":"Alex Selvarajah"}'::jsonb,
    NULL, NULL, NULL, 'idem-t012-1', '[]'::jsonb);

  v_second := app.emit_event(
    '00000012-1111-1111-1111-111111111111','ProposalSent','PROPOSAL',
    '00000012-eeee-eeee-eeee-eeeeeeeeeee1','PRO-T012-1',
    '{"channel":"EMAIL"}'::jsonb,'Proposal PRO-T012-1 sent',
    '{"kind":"HUMAN","id":"00000012-0000-0000-0000-0000000000a1","name":"Alex Selvarajah"}'::jsonb,
    NULL, NULL, NULL, 'idem-t012-1', '[]'::jsonb);

  ASSERT v_first = v_second,
    'T3a FAIL (s8.2): a replayed idempotency key must return the ORIGINAL event id';
  ASSERT (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.idempotency_key = 'idem-t012-1') = 1,
    'T3b FAIL: the replay wrote a second event';
  ASSERT (SELECT pg_catalog.count(*) FROM app.outbox AS job
           WHERE job.event_id = v_first) = 1,
    'T3c FAIL: the replay enqueued a second job - the whole transactional-outbox '
    'guarantee turns on this line';

  -- complete_job is idempotent on the job id: the second call raises.
  SELECT job.id INTO v_job FROM app.outbox AS job WHERE job.event_id = v_first;
  PERFORM app.claim_jobs('t012-worker-b','00000012-1111-1111-1111-111111111111',
                         ARRAY['SEND_EMAIL'], 10);
  PERFORM app.complete_job(v_job,'00000012-1111-1111-1111-111111111111',
                           't012-worker-b','{"messageId":"m-1"}'::jsonb, NULL);
  BEGIN
    PERFORM app.complete_job(v_job,'00000012-1111-1111-1111-111111111111',
                             't012-worker-b','{}'::jsonb, NULL);
    ASSERT false, 'T3d FAIL: a second complete_job must raise, not silently re-complete';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  -- The webhook duplicate, and the ledger row it must NOT duplicate.
  v_reply := app.record_webhook_delivery(
    'ACCOUNTING','msg-t012-1','acct-tenant-alpha', true, 200,
    '{"x-signature":"ok"}'::jsonb, '{"raw":true}',
    pg_catalog.jsonb_build_object(
      'type','InvoiceValidated','aggregateType','INVOICE',
      'aggregateId','00000012-dddd-dddd-dddd-ddddddddddd1',
      'aggregateRef','INV-T012-0001','summary','Invoice INV-T012-0001 validated'),
    NULL);
  v_reply2 := app.record_webhook_delivery(
    'ACCOUNTING','msg-t012-1','acct-tenant-alpha', true, 200,
    '{"x-signature":"ok"}'::jsonb, '{"raw":true}',
    pg_catalog.jsonb_build_object(
      'type','InvoiceValidated','aggregateType','INVOICE',
      'aggregateId','00000012-dddd-dddd-dddd-ddddddddddd1',
      'aggregateRef','INV-T012-0001','summary','Invoice INV-T012-0001 validated'),
    NULL);

  ASSERT v_reply ->> 'status' = 'ACCEPTED',
    pg_catalog.format('T3e FAIL: first delivery was %s', v_reply::text);
  ASSERT v_reply2 = '{"status": "IGNORED_DUPLICATE"}'::jsonb,
    pg_catalog.format('T3f FAIL: the replay must be exactly '
      '{"status":"IGNORED_DUPLICATE"}, got %s', v_reply2::text);
  ASSERT (SELECT pg_catalog.count(*) FROM app.webhook_deliveries AS delivery
           WHERE delivery.idempotency_key = 'msg-t012-1') = 1,
    'T3g FAIL: the replay wrote a second delivery row';
  ASSERT (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.type = 'InvoiceValidated') = 1,
    'T3h FAIL: the replay emitted a second event';

  -- An unrouted source writes the row, returns UNROUTED and emits nothing. It is
  -- never guessed at and never routed to a default tenant.
  v_reply := app.record_webhook_delivery(
    'EMAIL','msg-t012-unrouted','nobody@example.invalid', true, 202,
    '{}'::jsonb, 'body',
    pg_catalog.jsonb_build_object('type','EnquiryReceived','aggregateType','ENQUIRY',
      'aggregateId','00000012-ffff-ffff-ffff-fffffffffff1','summary','x'), NULL);
  ASSERT v_reply ->> 'status' = 'UNROUTED' AND v_reply ->> 'tenantId' IS NULL,
    pg_catalog.format('T3i FAIL: an unknown external_id must be UNROUTED, got %s',
      v_reply::text);
  ASSERT (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.type = 'EnquiryReceived') = 0,
    'T3j FAIL: an unrouted delivery emitted an event anyway';

  RAISE NOTICE 'T3 PASS - replayed key returns the original id with no second '
    'event and no second job; complete_job raises on the second call; a replayed '
    'webhook is IGNORED_DUPLICATE with one row and one event; an unknown '
    'external_id is UNROUTED and emits nothing.';
END;
$t3$;

-- ─── T4 · retry exhaustion -> dead letter (s8.3, C-08) ─────────────────────

DO $t4$
DECLARE
  v_a uuid := '00000012-3333-3333-3333-333333333301';
  v_b uuid := '00000012-3333-3333-3333-333333333302';
  v_c uuid := '00000012-3333-3333-3333-333333333303';
  v_state    text;
  v_after_1  timestamptz;
  v_after_2  timestamptz;
  v_claimed  integer;
BEGIN
  INSERT INTO app.outbox (id, tenant_id, job_type, correlation_id, max_attempts)
  VALUES
    (v_a,'00000012-1111-1111-1111-111111111111','T012_RETRY',pg_catalog.gen_random_uuid(),3),
    (v_b,'00000012-1111-1111-1111-111111111111','T012_RETRY',pg_catalog.gen_random_uuid(),3),
    (v_c,'00000012-1111-1111-1111-111111111111','T012_RETRY',pg_catalog.gen_random_uuid(),3);

  -- Attempts 1 and 2 land in FAILED with a strictly increasing run_after.
  PERFORM app.claim_jobs('t012-w','00000012-1111-1111-1111-111111111111',ARRAY['T012_RETRY'],3);
  v_state := app.fail_job(v_a,'00000012-1111-1111-1111-111111111111','t012-w',
                          '{"code":"PROVIDER_5XX","message":"upstream","retryable":true}'::jsonb);
  ASSERT v_state = 'FAILED', pg_catalog.format('T4a FAIL: attempt 1 gave %s', v_state);
  SELECT job.run_after INTO v_after_1 FROM app.outbox AS job WHERE job.id = v_a;

  -- Jitter and the bound, measured over a batch rather than over one pair. Doc 05
  -- s8.3 asks that "two jobs failing in the same statement get different
  -- run_after values"; asserted on ONE pair that is a coin flip which fails for
  -- a reason unrelated to its subject about once in every few billion runs, and
  -- a flaky assertion gets deleted by the next author along with its guard. Over
  -- twenty it is a fact. The BAND is the binding half: attempts = 1 at this
  -- point, so the delay is 10s x 2^1 x (0.5..1.0) = 10 to 20 seconds.
  INSERT INTO app.outbox (tenant_id, job_type, correlation_id, max_attempts)
  SELECT '00000012-1111-1111-1111-111111111111','T012_JITTER',
         pg_catalog.gen_random_uuid(), 5
    FROM pg_catalog.generate_series(1, 20);
  PERFORM app.claim_jobs('t012-w','00000012-1111-1111-1111-111111111111',
                         ARRAY['T012_JITTER'], 20);
  PERFORM app.fail_job(job.id,'00000012-1111-1111-1111-111111111111','t012-w',
            '{"code":"PROVIDER_5XX","message":"upstream","retryable":true}'::jsonb)
     FROM app.outbox AS job
    WHERE job.job_type = 'T012_JITTER' AND job.state = 'CLAIMED';

  ASSERT (SELECT pg_catalog.count(DISTINCT job.run_after) FROM app.outbox AS job
           WHERE job.job_type = 'T012_JITTER') > 1,
    'T4b FAIL: twenty jobs failing back to back all got the SAME run_after. '
    'Without jitter a provider outage retries every in-flight SEND_EMAIL in the '
    'same second and the outage repeats itself.';
  ASSERT (SELECT pg_catalog.count(*) FROM app.outbox AS job
           WHERE job.job_type = 'T012_JITTER'
             AND job.run_after NOT BETWEEN pg_catalog.now() + interval '10 seconds'
                                       AND pg_catalog.now() + interval '20 seconds') = 0,
    'T4c FAIL: the first backoff must be 10s x 2^1 x full jitter, i.e. 10-20 seconds';

  v_state := app.fail_job(v_b,'00000012-1111-1111-1111-111111111111','t012-w',
                          '{"code":"PROVIDER_5XX","message":"upstream","retryable":true}'::jsonb);
  ASSERT v_state = 'FAILED', pg_catalog.format('T4b2 FAIL: gave %s', v_state);

  UPDATE app.outbox SET run_after = pg_catalog.now() - interval '1 second' WHERE id = v_a;
  PERFORM app.reap_jobs('00000012-1111-1111-1111-111111111111', 100);
  PERFORM app.claim_jobs('t012-w','00000012-1111-1111-1111-111111111111',ARRAY['T012_RETRY'],3);
  v_state := app.fail_job(v_a,'00000012-1111-1111-1111-111111111111','t012-w',
                          '{"code":"PROVIDER_5XX","message":"upstream","retryable":true}'::jsonb);
  ASSERT v_state = 'FAILED', pg_catalog.format('T4d FAIL: attempt 2 gave %s', v_state);
  SELECT job.run_after INTO v_after_2 FROM app.outbox AS job WHERE job.id = v_a;
  ASSERT v_after_2 > v_after_1,
    'T4e FAIL: run_after must increase strictly between attempt 1 and attempt 2';
  ASSERT v_after_2 <= pg_catalog.now() + interval '1 hour',
    'T4f FAIL: backoff is not capped at one hour';

  -- Attempt 3 lands in DEAD with exactly one dead letter.
  UPDATE app.outbox SET run_after = pg_catalog.now() - interval '1 second' WHERE id = v_a;
  PERFORM app.reap_jobs('00000012-1111-1111-1111-111111111111', 100);
  PERFORM app.claim_jobs('t012-w','00000012-1111-1111-1111-111111111111',ARRAY['T012_RETRY'],3);
  v_state := app.fail_job(v_a,'00000012-1111-1111-1111-111111111111','t012-w',
                          '{"code":"PROVIDER_5XX","message":"upstream","retryable":true}'::jsonb);
  ASSERT v_state = 'DEAD', pg_catalog.format('T4g FAIL: attempt 3 gave %s', v_state);
  ASSERT (SELECT pg_catalog.count(*) FROM app.dead_letters AS letter
           WHERE letter.origin_id = v_a) = 1,
    'T4h FAIL: expected exactly one dead letter for the exhausted job';
  ASSERT (SELECT letter.attempts FROM app.dead_letters AS letter
           WHERE letter.origin_id = v_a) = 3,
    'T4i FAIL: the dead letter must carry attempts = 3';
  ASSERT (SELECT letter.reason FROM app.dead_letters AS letter
           WHERE letter.origin_id = v_a) = 'PROVIDER_5XX',
    'T4j FAIL: the dead letter reason must be the error code the handler reported';

  -- C-08, half one: a job AT its ceiling is not claimable. Doc 05 s2.4 claims a
  -- job "cannot loop forever" and nothing enforced it.
  UPDATE app.outbox
     SET state = 'QUEUED', attempts = 3, claimed_at = NULL, claimed_by = NULL,
         visible_after = NULL, finished_at = NULL,
         run_after = pg_catalog.now() - interval '1 minute'
   WHERE id = v_c;
  SELECT pg_catalog.count(*)::integer INTO v_claimed
    FROM app.claim_jobs('t012-w','00000012-1111-1111-1111-111111111111',
                        ARRAY['T012_RETRY'], 10) AS claimed;
  ASSERT v_claimed = 0,
    pg_catalog.format('T4k FAIL (C-08): a job at max_attempts was claimed (%s rows). '
      'That is the poison pill: a handler that OOMs the isolate re-pushes the '
      'same invoice to the accounting package forever.', v_claimed);

  -- C-08, half two: the reaper dead-letters it rather than returning the lease.
  UPDATE app.outbox
     SET state = 'CLAIMED', attempts = 3, claimed_by = 't012-dead-worker',
         claimed_at = pg_catalog.now() - interval '10 minutes',
         visible_after = pg_catalog.now() - interval '1 minute'
   WHERE id = v_c;
  PERFORM app.reap_jobs('00000012-1111-1111-1111-111111111111', 100);
  SELECT job.state INTO v_state FROM app.outbox AS job WHERE job.id = v_c;
  ASSERT v_state = 'DEAD',
    pg_catalog.format('T4l FAIL (C-08): the reaper returned an exhausted job to '
      '%s instead of DEAD', v_state);
  ASSERT (SELECT pg_catalog.count(*) FROM app.dead_letters AS letter
           WHERE letter.origin_id = v_c) = 1,
    'T4m FAIL (C-08): the reaper did not write a dead letter for the exhausted job';
  ASSERT (SELECT letter.reason FROM app.dead_letters AS letter
           WHERE letter.origin_id = v_c) = 'LEASE_EXPIRED_AT_MAX_ATTEMPTS',
    'T4n FAIL: a reaped exhausted job must carry the reaper''s own reason';

  -- A non-retryable failure goes straight to DEAD on attempt 1. A FRESH job, not
  -- v_b: v_b is sitting in FAILED with its backoff in the future, so re-claiming
  -- it would need the clock moved, and a test that has to move the clock to set
  -- up an unrelated assertion is a test that will be misread.
  INSERT INTO app.outbox (id, tenant_id, job_type, correlation_id, max_attempts)
  VALUES ('00000012-3333-3333-3333-333333333304',
          '00000012-1111-1111-1111-111111111111','T012_RETRY',
          pg_catalog.gen_random_uuid(), 5);
  PERFORM app.claim_jobs('t012-w','00000012-1111-1111-1111-111111111111',
                         ARRAY['T012_RETRY'], 10);
  v_state := app.fail_job('00000012-3333-3333-3333-333333333304',
                          '00000012-1111-1111-1111-111111111111','t012-w',
                          '{"code":"BAD_ADDRESS","message":"no such mailbox","retryable":false}'::jsonb,
                          false);
  ASSERT v_state = 'DEAD',
    pg_catalog.format('T4o FAIL: p_retryable=false on attempt 1 of 5 gave %s', v_state);
  ASSERT (SELECT letter.reason FROM app.dead_letters AS letter
           WHERE letter.origin_id = '00000012-3333-3333-3333-333333333304') = 'BAD_ADDRESS',
    'T4p FAIL: the non-retryable dead letter lost its code';

  -- The notice deliberately avoids the substring the harness greps for when it
  -- reports a failing pin. A pass line that looks like a failure is how a real
  -- failure gets scrolled past.
  RAISE NOTICE 'T4 PASS - attempts 1-2 retry with strictly increasing, jittered, '
    'hour-capped backoff; attempt 3 is DEAD with one dead letter at attempts=3; '
    'a job at max_attempts is NOT claimable and IS dead-lettered by the reaper '
    '(C-08, both halves); a non-retryable error dies on attempt 1.';
END;
$t4$;

-- ─── T5 · H-12 and M-14 · a worker cannot touch a job it does not own ──────

DO $t5$
DECLARE
  v_job uuid := '00000012-3333-3333-3333-333333333311';
  v_state text;
BEGIN
  INSERT INTO app.outbox (id, tenant_id, job_type, correlation_id, max_attempts)
  VALUES (v_job,'00000012-1111-1111-1111-111111111111','T012_RACE',
          pg_catalog.gen_random_uuid(), 5);

  -- Worker A claims.
  PERFORM app.claim_jobs('worker-A','00000012-1111-1111-1111-111111111111',
                         ARRAY['T012_RACE'], 1);

  -- THE RACE, exactly as H-12 describes it. A's lease expires; the reaper
  -- requeues; B claims and starts work.
  UPDATE app.outbox SET visible_after = pg_catalog.now() - interval '1 second'
   WHERE id = v_job;
  PERFORM app.reap_jobs('00000012-1111-1111-1111-111111111111', 10);
  PERFORM app.claim_jobs('worker-B','00000012-1111-1111-1111-111111111111',
                         ARRAY['T012_RACE'], 1);
  ASSERT (SELECT job.claimed_by FROM app.outbox AS job WHERE job.id = v_job) = 'worker-B',
    'T5a FAIL: the fixture did not reach the state H-12 describes';

  -- A finally errors and calls fail_job. It must be REFUSED. Under doc 05's
  -- shape it would flip the row to DEAD, write a dead letter, and report the
  -- effect FAILED for work B is about to complete successfully.
  BEGIN
    v_state := app.fail_job(v_job,'00000012-1111-1111-1111-111111111111','worker-A',
                            '{"code":"TIMEOUT","message":"slow","retryable":true}'::jsonb);
    ASSERT false,
      pg_catalog.format('T5b FAIL (H-12): worker A dead-lettered worker B''s '
        'running job and got %s', v_state);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  ASSERT (SELECT job.state FROM app.outbox AS job WHERE job.id = v_job) = 'CLAIMED',
    'T5c FAIL (H-12): the refused fail_job still changed the row';
  ASSERT (SELECT pg_catalog.count(*) FROM app.dead_letters AS letter
           WHERE letter.origin_id = v_job) = 0,
    'T5d FAIL (H-12): the refused fail_job still wrote a dead letter';

  -- M-14: nor can A extend B's lease and defeat the reaper.
  BEGIN
    PERFORM app.heartbeat_job(v_job,'00000012-1111-1111-1111-111111111111','worker-A');
    ASSERT false, 'T5e FAIL (M-14): worker A extended worker B''s lease';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  -- And B, who does own it, can do both.
  PERFORM app.heartbeat_job(v_job,'00000012-1111-1111-1111-111111111111','worker-B');
  PERFORM app.complete_job(v_job,'00000012-1111-1111-1111-111111111111','worker-B');
  ASSERT (SELECT job.state FROM app.outbox AS job WHERE job.id = v_job) = 'SUCCEEDED',
    'T5f FAIL: the owning worker could not complete its own job';

  RAISE NOTICE 'T5 PASS - after lease expiry, reap and re-claim, worker A''s '
    'fail_job and heartbeat_job are both REFUSED and change nothing; worker B, '
    'which owns the lease, completes normally.';
END;
$t5$;

-- ─── T6 · C-09 · append-only, and the one audited exemption ────────────────

DO $t6$
DECLARE
  v_event uuid;
  v_before jsonb;
BEGIN
  v_event := app.emit_event(
    '00000012-1111-1111-1111-111111111111','ProposalDrafted','PROPOSAL',
    '00000012-eeee-eeee-eeee-eeeeeeeeeee9','PRO-T012-9','{}'::jsonb,
    'Proposal PRO-T012-9 drafted for Nurul Hassan',
    '{"kind":"HUMAN","id":"00000012-0000-0000-0000-0000000000a1","name":"Nurul Hassan"}'::jsonb,
    NULL, NULL, NULL, NULL, '[]'::jsonb);
  SELECT event.actor INTO v_before FROM core.events AS event WHERE event.id = v_event;

  BEGIN
    UPDATE core.events SET summary = 'x' WHERE id = v_event;
    ASSERT false, 'T6a FAIL: core.events accepted an UPDATE';
  EXCEPTION WHEN sqlstate '0A000' THEN NULL;
  END;
  BEGIN
    DELETE FROM core.events WHERE id = v_event;
    ASSERT false, 'T6b FAIL: core.events accepted a DELETE';
  EXCEPTION WHEN sqlstate '0A000' THEN NULL;
  END;
  -- A row trigger does NOT fire for TRUNCATE. Without the statement-level guard
  -- the entire log is removable in one statement, which is the hole the append-
  -- only claim would otherwise have.
  BEGIN
    TRUNCATE core.events CASCADE;
    ASSERT false, 'T6c FAIL: core.events accepted a TRUNCATE';
  EXCEPTION WHEN sqlstate '0A000' THEN NULL;
  END;

  -- Setting the GUC by hand is not enough: the trigger re-derives what actually
  -- moved from the ROW, so a "redaction" that touches payload is still refused.
  PERFORM pg_catalog.set_config('app.event_redaction', v_event::text, true);
  BEGIN
    UPDATE core.events SET payload = '{"leaked":true}'::jsonb WHERE id = v_event;
    ASSERT false,
      'T6d FAIL (C-09): the exemption is not narrow - forging the GUC let an '
      'update reach a column outside actor and summary';
  EXCEPTION WHEN sqlstate '0A000' THEN NULL;
  END;
  PERFORM pg_catalog.set_config('app.event_redaction', '', true);

  -- The ONE path that works.
  PERFORM app.redact_event_actor(
    '00000012-1111-1111-1111-111111111111', v_event,
    '{"kind":"HUMAN","id":"00000012-0000-0000-0000-0000000000a1","name":null}'::jsonb,
    'Proposal PRO-T012-9 drafted',
    'PDPA s(7) erasure request 2026-09-13',
    '{"kind":"HUMAN","id":"00000012-0000-0000-0000-0000000000a3","name":"T012 DPO"}'::jsonb);

  ASSERT (SELECT event.actor -> 'name' FROM core.events AS event WHERE event.id = v_event)
         = 'null'::jsonb,
    'T6e FAIL (C-09): the actor name was not erased';
  ASSERT (SELECT event.summary FROM core.events AS event WHERE event.id = v_event)
         = 'Proposal PRO-T012-9 drafted',
    'T6f FAIL (C-09): the summary was not replaced';
  ASSERT (SELECT redaction.before_actor FROM app.event_redactions AS redaction
           WHERE redaction.event_id = v_event) = v_before,
    'T6g FAIL (C-09): the audit row does not carry the BEFORE image - an erasure '
    'with no record of what was erased is indistinguishable from tampering';
  ASSERT (SELECT redaction.reason FROM app.event_redactions AS redaction
           WHERE redaction.event_id = v_event) = 'PDPA s(7) erasure request 2026-09-13',
    'T6h FAIL (C-09): the audit row lost the reason';

  -- The licence is released, so the next plain update is refused again.
  BEGIN
    UPDATE core.events SET summary = 'y' WHERE id = v_event;
    ASSERT false, 'T6i FAIL (C-09): the exemption GUC outlived the redaction';
  EXCEPTION WHEN sqlstate '0A000' THEN NULL;
  END;

  -- A redaction that would leave no author, or an empty summary, is refused.
  BEGIN
    PERFORM app.redact_event_actor(
      '00000012-1111-1111-1111-111111111111', v_event,
      '{"kind":"HUMAN","id":"x","name":null}'::jsonb, 'ok', 'reason',
      '{"kind":"ROBOT","id":"x","name":"y"}'::jsonb);
    ASSERT false, 'T6j FAIL (C-09): an erasure with an invalid author was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE NOTICE 'T6 PASS - core.events refuses UPDATE, DELETE and TRUNCATE; a '
    'forged GUC cannot widen the exemption past actor and summary; '
    'app.redact_event_actor is the one path, writes its before image, and '
    'releases its licence.';
END;
$t6$;

-- ─── T7 · N-02 · every jsonb CHECK rejects a PLAUSIBLE wrong shape ─────────

DO $t7$
DECLARE v_tenant uuid := '00000012-1111-1111-1111-111111111111';
BEGIN
  -- core.events.actor. Not a non-object: an object with the right keys and a
  -- kind outside the four (N-09), and an object missing only `name`.
  BEGIN
    INSERT INTO core.events (tenant_id, type, aggregate_type, aggregate_id,
                             payload, summary, actor, correlation_id)
    VALUES (v_tenant,'X','ENQUIRY',pg_catalog.gen_random_uuid(),'{}'::jsonb,'s',
            '{"kind":"ROBOT","id":"r1","name":"Robot"}'::jsonb,
            pg_catalog.gen_random_uuid());
    ASSERT false, 'T7a FAIL: core.events.actor accepted a fifth actor kind';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO core.events (tenant_id, type, aggregate_type, aggregate_id,
                             payload, summary, actor, correlation_id)
    VALUES (v_tenant,'X','ENQUIRY',pg_catalog.gen_random_uuid(),'{}'::jsonb,'s',
            '{"kind":"HUMAN","id":"u1"}'::jsonb, pg_catalog.gen_random_uuid());
    ASSERT false,
      'T7b FAIL: core.events.actor accepted an actor with no `name` KEY. Absent '
      'and null are different bugs and only one of them is a shape error.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- app.outbox.last_error. The legacy-jury case from doc 04 s735: an object that
  -- satisfies key presence and still explodes at the cast.
  BEGIN
    INSERT INTO app.outbox (tenant_id, job_type, correlation_id, last_error)
    VALUES (v_tenant,'X',pg_catalog.gen_random_uuid(),
            '{"code":"E","message":"m","retryable":"maybe"}'::jsonb);
    ASSERT false,
      'T7c FAIL: app.outbox.last_error accepted a STRING `retryable`. Key '
      'presence alone passes it, and (p_error->>''retryable'')::boolean then '
      'raises inside the seam instead of at the insert.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO app.outbox (tenant_id, job_type, correlation_id, last_error)
    VALUES (v_tenant,'X',pg_catalog.gen_random_uuid(),
            '{"code":"E","message":"m"}'::jsonb);
    ASSERT false, 'T7d FAIL: app.outbox.last_error accepted a missing `retryable`';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- And it ACCEPTS the right shape, so the constraint is not merely refusing
  -- everything.
  INSERT INTO app.outbox (tenant_id, job_type, correlation_id, last_error)
  VALUES (v_tenant,'T012_SHAPE_OK',pg_catalog.gen_random_uuid(),
          '{"code":"E","message":"m","retryable":true}'::jsonb);

  -- app.dead_letters.dead_lettered_by.
  BEGIN
    INSERT INTO app.dead_letters (tenant_id, origin, origin_id, reason, payload,
                                  dead_lettered_by)
    VALUES (v_tenant,'RUN',pg_catalog.gen_random_uuid(),'r','{}'::jsonb,
            '{"kind":"OPERATOR","id":"o1","name":"Ops"}'::jsonb);
    ASSERT false,
      'T7e FAIL: app.dead_letters.dead_lettered_by accepted a kind outside the '
      'four. The contract lets a HUMAN dead-letter a run deliberately, so this '
      'column is the audit of who, and a fifth vocabulary here is N-09 reopening.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- app.webhook_deliveries.error.
  BEGIN
    INSERT INTO app.webhook_deliveries (source, idempotency_key, signature_valid,
                                        http_status, error)
    VALUES ('EMAIL','t012-bad-error',false,401,'{"code":"BAD_SIGNATURE"}'::jsonb);
    ASSERT false, 'T7f FAIL: webhook_deliveries.error accepted a missing `message`';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- app.event_redactions' three actor columns, one probe.
  BEGIN
    INSERT INTO app.event_redactions (tenant_id, event_id, before_actor,
                                      before_summary, after_actor, after_summary,
                                      reason, redacted_by)
    SELECT v_tenant, event.id,
           '{"kind":"HUMAN","id":"a","name":"A"}'::jsonb,'b',
           '{"kind":"HUMAN","id":"a","name":null}'::jsonb,'c','r',
           '{"kind":"MACHINE","id":"m","name":"M"}'::jsonb
      FROM core.events AS event LIMIT 1;
    ASSERT false, 'T7g FAIL: app.event_redactions.redacted_by accepted a fifth kind';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The structural half of the outbox's own shape rules, which are not jsonb but
  -- are the same class of "plausible and wrong".
  BEGIN
    INSERT INTO app.outbox (tenant_id, job_type, correlation_id, action_request_id)
    VALUES (v_tenant,'X',pg_catalog.gen_random_uuid(),
            '00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
    ASSERT false,
      'T7h FAIL: outbox_effect_path_complete accepted an action-derived job with '
      'no effect_id. That constraint is what makes complete_job''s '
      '`if effect_id is not null` guard safe.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'T7 PASS - every jsonb CHECK rejects a plausible wrong shape '
    '(fifth actor kind, missing key, string-where-boolean) and accepts the right '
    'one; the effect-path completeness constraint holds too.';
END;
$t7$;

-- ─── T8 · M-09 · neither emit_event overload is PUBLIC-executable ──────────

DO $t8$
DECLARE
  v_role     text;
  v_function regprocedure;
BEGIN
  ASSERT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS procedure
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = procedure.pronamespace
           WHERE namespace.nspname = 'app' AND procedure.proname = 'emit_event') = 2,
    'T8a FAIL: expected exactly two app.emit_event overloads';

  FOREACH v_role IN ARRAY ARRAY['public','anon','authenticated'] LOOP
    FOR v_function IN
      SELECT procedure.oid::regprocedure
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app' AND procedure.proname = 'emit_event'
    LOOP
      ASSERT NOT pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE'),
        pg_catalog.format('T8b FAIL (M-09): %s holds EXECUTE on %s. Doc 05''s '
          'revoke omits the argument list and errors "function name is not '
          'unique", and PUBLIC holds EXECUTE on a new function by default.',
          v_role, v_function);
    END LOOP;
  END LOOP;

  -- service_role gets the worker surface and NOT emit_event: the worker reaches
  -- the event log through complete_job, which validates the tenant and the lease
  -- first.
  ASSERT NOT pg_catalog.has_function_privilege('service_role',
    'app.emit_event(uuid,text,text,uuid,text,jsonb,text,jsonb,uuid,uuid,text,text,jsonb)'::regprocedure,
    'EXECUTE'),
    'T8c FAIL: service_role can call emit_event directly, bypassing the lease check';
  ASSERT pg_catalog.has_function_privilege('service_role',
    'app.complete_job(uuid,uuid,text,jsonb,jsonb)'::regprocedure, 'EXECUTE'),
    'T8d FAIL: service_role cannot call complete_job; the worker path is broken';
  -- C-09: erasure is granted to nobody at all.
  ASSERT NOT pg_catalog.has_function_privilege('service_role',
    'app.redact_event_actor(uuid,uuid,jsonb,text,text,jsonb)'::regprocedure, 'EXECUTE'),
    'T8e FAIL (C-09): service_role can erase from the audit trail';

  RAISE NOTICE 'T8 PASS - both emit_event overloads are closed to PUBLIC, anon, '
    'authenticated and service_role; the worker surface is granted and the '
    'erasure path is granted to nobody.';
END;
$t8$;

-- ─── T9 · correlation and audit (s8.7) ─────────────────────────────────────

DO $t9$
DECLARE
  v_corr    uuid := '00000012-cccc-cccc-cccc-ccccccccccc1';
  v_proposal uuid := '00000012-eeee-eeee-eeee-eeeeeeeeeee5';
  v_approval uuid := '00000012-bbbb-bbbb-bbbb-bbbbbbbbbbb5';
  v_e1 uuid; v_e2 uuid; v_e3 uuid;
  v_drawer text[];
  v_job    uuid;
BEGIN
  -- The chain: ActionRequested -> ApprovalRequested -> ApprovalDecided, sharing
  -- one correlation_id, each caused by its predecessor. ApprovalDecided's
  -- AGGREGATE is the approval, and it belongs in the PROPOSAL's drawer too -
  -- which is the whole reason core.event_subjects exists.
  -- ActionRequested's AGGREGATE is the action (doc 05 s1.7), not the proposal, so
  -- it reaches the proposal's drawer only through a RELATED subject row. That is
  -- the whole point of core.event_subjects and it is asserted below.
  v_e1 := app.emit_event(
    '00000012-1111-1111-1111-111111111111','ActionRequested','ACTION',
    '00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa5','ACT-T012-0005',
    '{"channel":"EMAIL"}'::jsonb,
    'Send proposal PRO-T012-5 requested',
    '{"kind":"HUMAN","id":"00000012-0000-0000-0000-0000000000a1","name":"Alex Selvarajah"}'::jsonb,
    v_corr, NULL, 'run_4821', NULL,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('type','PROPOSAL','id',v_proposal)));

  v_e2 := app.emit_event(
    '00000012-1111-1111-1111-111111111111','ApprovalRequested','APPROVAL',
    v_approval,'APV-T012-5','{}'::jsonb,'Approval APV-T012-5 requested',
    '{"kind":"SYSTEM","id":"gate","name":"Policy gate"}'::jsonb,
    v_corr, v_e1, 'run_4821', NULL,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('type','PROPOSAL','id',v_proposal)));

  v_e3 := app.emit_event(
    '00000012-1111-1111-1111-111111111111','ApprovalDecided','APPROVAL',
    v_approval,'APV-T012-5','{}'::jsonb,'Approval APV-T012-5 approved',
    '{"kind":"HUMAN","id":"00000012-0000-0000-0000-0000000000a2","name":"T012 Finance"}'::jsonb,
    v_corr, v_e2, 'run_4821', NULL,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('type','PROPOSAL','id',v_proposal)));

  ASSERT (SELECT pg_catalog.count(DISTINCT event.correlation_id) FROM core.events AS event
           WHERE event.id IN (v_e1, v_e2, v_e3)) = 1,
    'T9a FAIL: the three events do not share one correlation_id';
  ASSERT (SELECT event.causation_id FROM core.events AS event WHERE event.id = v_e2) = v_e1
     AND (SELECT event.causation_id FROM core.events AS event WHERE event.id = v_e3) = v_e2,
    'T9b FAIL: causation_id does not point at the predecessor';
  ASSERT (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.id IN (v_e1, v_e2, v_e3) AND event.run_id = 'run_4821') = 3,
    'T9c FAIL: the run id did not survive - it is TEXT here on purpose, because '
    '011''s agent_run_id is text and the demo fixture''s run id is `run_4821`, '
    'which is not a uuid';

  -- The job carries the same correlation (ProposalSent is subscribed).
  PERFORM app.emit_event(
    '00000012-1111-1111-1111-111111111111','ProposalSent','PROPOSAL',
    v_proposal,'PRO-T012-5','{"channel":"EMAIL"}'::jsonb,'Proposal sent',
    '{"kind":"SYSTEM","id":"gate","name":"Policy gate"}'::jsonb,
    v_corr, v_e3, 'run_4821', 'idem-t012-chain', '[]'::jsonb);
  SELECT job.id INTO v_job FROM app.outbox AS job
   WHERE job.correlation_id = v_corr AND job.job_type = 'SEND_EMAIL';
  ASSERT v_job IS NOT NULL,
    'T9d FAIL: the fan-out job did not carry the chain''s correlation_id';

  -- The drawer, ordered, and complete: ApprovalDecided appears in the PROPOSAL's
  -- drawer via its RELATED subject row even though its aggregate is the approval.
  SELECT pg_catalog.array_agg(entry.event ORDER BY entry.at DESC, entry.id DESC)
    INTO v_drawer
    FROM core.audit_entries AS entry
   WHERE entry.tenant_id = '00000012-1111-1111-1111-111111111111'
     AND entry.subject_type = 'PROPOSAL'
     AND entry.subject_id = v_proposal;
  ASSERT v_drawer @> ARRAY['ActionRequested','ApprovalRequested','ApprovalDecided','ProposalSent']
     AND pg_catalog.cardinality(v_drawer) = 4,
    pg_catalog.format('T9e FAIL: the proposal drawer is %s, expected exactly the '
      'four events of the chain including ApprovalDecided via its RELATED row',
      pg_catalog.array_to_string(v_drawer, ', '));
  ASSERT (SELECT entry.subject_role FROM core.audit_entries AS entry
           WHERE entry.subject_id = v_proposal AND entry.event = 'ApprovalDecided')
         = 'RELATED',
    'T9f FAIL: ApprovalDecided should reach the proposal drawer as RELATED, not '
    'as its SUBJECT';
  ASSERT (SELECT entry.subject_role FROM core.audit_entries AS entry
           WHERE entry.subject_id = v_proposal AND entry.event = 'ProposalSent')
         = 'SUBJECT',
    'T9g FAIL: an event whose aggregate IS the proposal should reach the drawer '
    'as SUBJECT, not as RELATED';
  ASSERT (SELECT entry.subject_type FROM core.audit_entries AS entry
           WHERE entry.event = 'ActionRequested' AND entry.subject_role = 'SUBJECT')
         = 'ACTION',
    'T9g2 FAIL: ActionRequested''s own aggregate row should be subject_type ACTION';

  -- H-26: the drawer's `at` is the denormalised copy on the subject row, and it
  -- equals its event's occurred_at. The denormalisation is what gives the keyset
  -- ordering an index; a drifted copy would silently reorder the drawer.
  ASSERT NOT EXISTS (
    SELECT 1 FROM core.event_subjects AS subject
      JOIN core.events AS event ON event.id = subject.event_id
     WHERE subject.occurred_at <> event.occurred_at),
    'T9h FAIL (H-26): a denormalised occurred_at has drifted from its event';

  RAISE NOTICE 'T9 PASS - one correlation across the chain, causation pointing at '
    'each predecessor, run_4821 surviving as text, the job carrying the same '
    'correlation, and the drawer returning all four in occurred_at DESC with '
    'ApprovalDecided arriving as RELATED.';
END;
$t9$;

-- ─── T10 · worker lifetime and tenant isolation (s8.5, H-15) ───────────────

DO $t10$
DECLARE
  v_job   uuid := '00000012-3333-3333-3333-333333333321';
  v_other uuid := '00000012-2222-2222-2222-222222222222';
BEGIN
  INSERT INTO app.outbox (id, tenant_id, job_type, correlation_id)
  VALUES (v_job,'00000012-1111-1111-1111-111111111111','T012_ISO',
          pg_catalog.gen_random_uuid());
  PERFORM app.claim_jobs('t012-iso','00000012-1111-1111-1111-111111111111',
                         ARRAY['T012_ISO'], 1);

  -- The lease can never exceed the worker's own wall clock. Doc 05 s8.5 proposes
  -- a static review of call sites; this is the runtime refusal, which cannot be
  -- forgotten by somebody debugging a slow handler.
  BEGIN
    PERFORM app.claim_jobs('t012-iso','00000012-1111-1111-1111-111111111111',
                           ARRAY['T012_ISO'], 1, interval '7 minutes');
    ASSERT false, 'T10a FAIL: claim_jobs accepted a lease longer than the worker lifetime';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM app.heartbeat_job(v_job,'00000012-1111-1111-1111-111111111111',
                              't012-iso', interval '30 minutes');
    ASSERT false, 'T10b FAIL: heartbeat_job accepted an extension past six minutes';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- H-15: the three row-addressing functions all refuse the WRONG tenant, even
  -- with the right job id and the right worker. A handler holding the service
  -- role bypasses RLS, so this is the only thing standing between a buggy
  -- handler and a cross-tenant write.
  BEGIN
    PERFORM app.complete_job(v_job, v_other, 't012-iso');
    ASSERT false, 'T10c FAIL (H-15): complete_job accepted the wrong tenant';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    PERFORM app.fail_job(v_job, v_other, 't012-iso',
                         '{"code":"E","message":"m","retryable":true}'::jsonb);
    ASSERT false, 'T10d FAIL (H-15): fail_job accepted the wrong tenant';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    PERFORM app.heartbeat_job(v_job, v_other, 't012-iso');
    ASSERT false, 'T10e FAIL (H-15): heartbeat_job accepted the wrong tenant';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  ASSERT (SELECT job.state FROM app.outbox AS job WHERE job.id = v_job) = 'CLAIMED',
    'T10f FAIL: a refused cross-tenant call still changed the row';

  -- A tenant-scoped claim never returns another tenant's work.
  INSERT INTO app.outbox (tenant_id, job_type, correlation_id)
  VALUES (v_other,'T012_ISO', pg_catalog.gen_random_uuid());
  ASSERT (SELECT pg_catalog.count(*) FROM app.claim_jobs(
            't012-iso', v_other, ARRAY['T012_ISO'], 10) AS claimed
           WHERE claimed.tenant_id <> v_other) = 0,
    'T10g FAIL: a tenant-scoped claim returned another tenant''s job';

  -- And the three worker functions all REQUIRE the tenant rather than defaulting
  -- it, which is the difference between H-15 closed and H-15 restated.
  BEGIN
    PERFORM app.complete_job(v_job, NULL, 't012-iso');
    ASSERT false, 'T10h FAIL (H-15): complete_job accepted a NULL tenant';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE NOTICE 'T10 PASS - the lease is capped at six minutes on both claim and '
    'heartbeat; complete_job, fail_job and heartbeat_job each refuse a wrong or '
    'NULL tenant and change nothing; a scoped claim stays inside its tenant.';
END;
$t10$;

-- ─── T11 · impersonation · zero client reach (C-04 residue) ────────────────
-- ONE STATEMENT EACH, parked in transaction-local GUCs, asserted after
-- RESET ROLE. A direct read here would fail at the grant layer before reaching
-- its subject, which is why the probe is a function and the assertion is not.

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t012.auth_outbox',
  pg_temp.t012_probe_select('app.outbox')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t012.auth_events',
  pg_temp.t012_probe_select('core.events')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t012.auth_drawer',
  pg_temp.t012_probe_select('core.audit_entries')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t012.auth_claim',
  pg_temp.t012_probe_call($$SELECT app.claim_jobs('probe', NULL, NULL, 1)$$)::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t012.auth_emit',
  pg_temp.t012_probe_call($$SELECT app.emit_event('00000012-1111-1111-1111-111111111111','X','ENQUIRY','00000012-ffff-ffff-ffff-fffffffffff1'::uuid,NULL,'{}'::jsonb,'s','{"kind":"HUMAN","id":"x","name":"y"}'::jsonb)$$)::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t012.auth_redact',
  pg_temp.t012_probe_call($$SELECT app.redact_event_actor('00000012-1111-1111-1111-111111111111','00000012-ffff-ffff-ffff-fffffffffff1'::uuid,'{"kind":"HUMAN","id":"x","name":null}'::jsonb,'s','r','{"kind":"HUMAN","id":"x","name":"y"}'::jsonb)$$)::text, true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('t012.anon_events',
  pg_temp.t012_probe_select('core.events')::text, true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('t012.anon_deliveries',
  pg_temp.t012_probe_select('app.webhook_deliveries')::text, true);
RESET ROLE;

DO $t11$
DECLARE
  v_probe    text;
  v_result   jsonb;
  v_role     text;
  v_relation regclass;
  v_function regprocedure;
BEGIN
  FOREACH v_probe IN ARRAY ARRAY[
    't012.auth_outbox','t012.auth_events','t012.auth_drawer','t012.auth_claim',
    't012.auth_emit','t012.auth_redact','t012.anon_events','t012.anon_deliveries']
  LOOP
    v_result := pg_catalog.current_setting(v_probe)::jsonb;
    ASSERT v_result ->> 'ok' = 'false',
      pg_catalog.format('T11a FAIL: probe %s SUCCEEDED as a client role: %s',
        v_probe, v_result::text);
    ASSERT v_result ->> 'sqlstate' = '42501',
      pg_catalog.format('T11b FAIL: probe %s failed with %s, expected 42501 '
        '(insufficient_privilege). A different code means it was refused for '
        'some other reason and the grant layer was never exercised.',
        v_probe, v_result ->> 'sqlstate');
  END LOOP;

  -- And the catalogue half, over every relation and every function 012 creates.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR v_relation IN
      SELECT pg_catalog.to_regclass(name) FROM (VALUES
        ('core.events'),('core.event_subjects'),('app.event_redactions'),
        ('app.event_subscriptions'),('app.outbox'),('app.job_type_map'),
        ('app.dead_letters'),('app.submission_counters'),
        ('app.webhook_deliveries'),('app.webhook_routes'),('core.audit_entries')
      ) AS relation(name)
    LOOP
      -- ⚠ AMENDED BY 014 (2026-09-13). Was: neither client role may hold SELECT
      -- on anything 012 created. 014 grants `authenticated` a tenant-scoped read
      -- on the two core relations and the audit view; `anon` still gets nothing,
      -- and the eight app.* relations are granted to nobody because `app` is
      -- neither exposed nor granted. The write half is absolute for both roles:
      -- core.events is append-only by revoke, by a row trigger AND by a
      -- statement-level BEFORE TRUNCATE trigger, and a client INSERT privilege
      -- would make the first of those three a lie.
      IF v_role = 'anon' OR v_relation::text LIKE 'app.%' THEN
        ASSERT NOT pg_catalog.has_table_privilege(v_role, v_relation, 'SELECT'),
          pg_catalog.format('T11c FAIL: %s has SELECT on %s', v_role, v_relation);
      END IF;
      ASSERT NOT pg_catalog.has_table_privilege(v_role, v_relation, 'INSERT')
         AND NOT pg_catalog.has_table_privilege(v_role, v_relation, 'UPDATE')
         AND NOT pg_catalog.has_table_privilege(v_role, v_relation, 'DELETE'),
        pg_catalog.format('T11c2 FAIL: %s can WRITE %s. The event log is the '
          'business record and is append-only by three independent mechanisms; a '
          'client write privilege defeats the first one.', v_role, v_relation);
      ASSERT NOT pg_catalog.has_table_privilege(v_role, v_relation, 'INSERT'),
        pg_catalog.format('T11d FAIL: %s has INSERT on %s', v_role, v_relation);
      ASSERT NOT pg_catalog.has_table_privilege(v_role, v_relation, 'UPDATE'),
        pg_catalog.format('T11e FAIL: %s has UPDATE on %s', v_role, v_relation);
      ASSERT NOT pg_catalog.has_table_privilege(v_role, v_relation, 'DELETE'),
        pg_catalog.format('T11f FAIL: %s has DELETE on %s', v_role, v_relation);
    END LOOP;
    FOR v_function IN
      SELECT procedure.oid::regprocedure
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app'
         AND procedure.proname = ANY (ARRAY[
           'is_valid_actor','event_row_is_redaction_only','reject_mutation',
           'effect_status_for_job_state','outbox_payload_allowlist',
           'aggregate_type_for','job_type_for','job_priority_for',
           'next_submission_attempt','provider_idempotency_key','emit_event',
           'redact_event_actor','enqueue_effect_jobs','_dead_letter_job',
           'claim_jobs','heartbeat_job','complete_job','fail_job','reap_jobs',
           'cancel_jobs','replay_dead_letter','jobs_health','webhook_path_for',
           'resolve_webhook_tenant','record_webhook_delivery',
           'reap_webhook_bodies','reap_webhook_deliveries','reap_outbox',
           'reap_dead_letters','reap_cron_history'])
    LOOP
      ASSERT NOT pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE'),
        pg_catalog.format('T11g FAIL: %s has EXECUTE on %s', v_role, v_function);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'T11 PASS - eight impersonation probes all refused 42501; zero '
    'anon/authenticated SELECT, INSERT, UPDATE, DELETE on 11 relations and zero '
    'EXECUTE on all 31 function signatures.';
END;
$t11$;

-- ─── T12 · THE SEAM (R14) ──────────────────────────────────────────────────
-- 011 leaves an EXTERNAL effect as a typed DISPATCHED row. 012 enqueues it,
-- claims it, completes it, and reports back through 011's own function. This is
-- the whole point of the pack, driven end to end rather than asserted about.

DO $t12$
DECLARE
  v_tenant  uuid := '00000012-1111-1111-1111-111111111111';
  v_request uuid := '00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_enqueued integer;
  v_job     uuid;
  v_effect  bigint;
  v_key     text;
BEGIN
  SELECT effect.id INTO v_effect FROM app.action_effects AS effect
   WHERE effect.action_request_id = v_request;
  ASSERT (SELECT effect.status FROM app.action_effects AS effect WHERE effect.id = v_effect)
         = 'DISPATCHED'::app.effect_status,
    'T12a FAIL: the fixture effect is not where 011 leaves it';

  v_enqueued := app.enqueue_effect_jobs(v_request, v_tenant);
  ASSERT v_enqueued = 1,
    pg_catalog.format('T12b FAIL: enqueue_effect_jobs wrote %s jobs, expected 1', v_enqueued);

  SELECT job.id, job.idempotency_subject INTO v_job, v_key
    FROM app.outbox AS job WHERE job.effect_id = v_effect;
  ASSERT v_job IS NOT NULL, 'T12c FAIL: no outbox row was created for the effect';
  ASSERT (SELECT job.job_type FROM app.outbox AS job WHERE job.id = v_job) = 'PUSH_INVOICE',
    'T12d FAIL: the handler was not resolved through app.job_type_map';
  ASSERT (SELECT job.job_key FROM app.outbox AS job WHERE job.id = v_job)
         = v_request::text || ':1',
    'T12e FAIL: the dedupe key is not 011''s own <action_request_id>:<seq>';
  ASSERT (SELECT effect.job_id FROM app.action_effects AS effect WHERE effect.id = v_effect)
         = v_job,
    'T12f FAIL: 011''s effect row was not linked back to its job';
  -- M-07 at the effect boundary: `body` came off the action payload and must not
  -- have travelled into the job.
  ASSERT NOT (SELECT job.payload FROM app.outbox AS job WHERE job.id = v_job) ? 'body',
    'T12g FAIL (M-07): the action''s free-text `body` was copied into the job '
    'payload, which drains verbatim to a third party''s webhook body';
  ASSERT (SELECT job.payload ->> 'providerIdempotencyKey' FROM app.outbox AS job
           WHERE job.id = v_job) = v_key || '#1',
    'T12h FAIL (M-20): the handler was not handed a subject-derived provider key';

  -- Re-enqueue is a no-op: the dedupe key is what stops a second invoice push.
  ASSERT app.enqueue_effect_jobs(v_request, v_tenant) = 0,
    'T12i FAIL: a second enqueue created a second job for the same effect';

  -- Claim, complete, and cross the seam.
  PERFORM app.claim_jobs('t012-pusher', v_tenant, ARRAY['PUSH_INVOICE'], 10);
  PERFORM app.complete_job(v_job, v_tenant, 't012-pusher',
                           '{"documentId":"ACC-991"}'::jsonb,
                           pg_catalog.jsonb_build_object(
                             'type','InvoicePushed','aggregateType','INVOICE',
                             'aggregateId','00000012-dddd-dddd-dddd-ddddddddddd1',
                             'aggregateRef','INV-T012-0001',
                             'summary','Invoice INV-T012-0001 pushed'));

  -- 011 stores SETTLED where 012 sends SUCCEEDED. The words differ on the two
  -- sides on purpose: mine are job outcomes, theirs are effect states.
  ASSERT (SELECT effect.status FROM app.action_effects AS effect WHERE effect.id = v_effect)
         = 'SETTLED'::app.effect_status,
    pg_catalog.format('T12j FAIL: 011 stored %s, expected SETTLED',
      (SELECT effect.status FROM app.action_effects AS effect WHERE effect.id = v_effect));
  ASSERT (SELECT request.status FROM core.action_requests AS request WHERE request.id = v_request)
         = 'EXECUTED',
    'T12k FAIL: the action did not advance to EXECUTED when its last effect settled';
  ASSERT (SELECT request.completed_at FROM core.action_requests AS request
           WHERE request.id = v_request) IS NOT DISTINCT FROM
         (SELECT request.completed_at FROM core.action_requests AS request
           WHERE request.id = v_request)
     AND (SELECT pg_catalog.count(*) FROM core.action_requests AS request
           WHERE request.id = v_request AND request.completed_at IS NOT NULL) = 1,
    'T12l FAIL: completed_at was not stamped';
  -- The completion event is keyed on the job id, so a redelivery cannot double
  -- the drawer row.
  ASSERT (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.idempotency_key = 'job:' || v_job::text) = 1,
    'T12m FAIL: the completion event is not keyed on the job id';

  -- R14, the refusal half. Every value that is neither SUCCEEDED nor FAILED
  -- raises at the boundary - including the ones that are IN the shared enum, and
  -- including the vocabulary 011 stores rather than receives.
  BEGIN
    PERFORM app.report_effect_result(
      (SELECT effect.id FROM app.action_effects AS effect
        WHERE effect.action_request_id = '00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
      'DISPATCHED'::app.effect_status, '{}'::jsonb, NULL);
    ASSERT false,
      'T12n FAIL (R14): app.report_effect_result accepted DISPATCHED. A '
      'two-branch CASE over another lane''s vocabulary is what recorded every '
      'delivered email as dead-lettered.';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE '%unrecognised worker effect status%',
      pg_catalog.format('T12o FAIL: the seam raised the wrong error: %s', SQLERRM);
  END;
  BEGIN
    PERFORM app.report_effect_result(
      (SELECT effect.id FROM app.action_effects AS effect
        WHERE effect.action_request_id = '00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
      'SETTLED'::app.effect_status, '{}'::jsonb, NULL);
    ASSERT false,
      'T12p FAIL (R14): the seam accepted SETTLED - the value 011 STORES, not '
      'the value it receives. Passing it would be the worker speaking the '
      'callee''s vocabulary back at it, and doc 05 s2.7 records that this '
      'flip-flopped three times before it settled.';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE '%unrecognised worker effect status%',
      pg_catalog.format('T12q FAIL: the seam raised the wrong error: %s', SQLERRM);
  END;

  -- And 012's own sending side refuses to MAKE a value neither side declares.
  BEGIN
    PERFORM app.effect_status_for_job_state('FAILED');
    ASSERT false,
      'T12r FAIL (R14): app.effect_status_for_job_state turned a TRANSIENT job '
      'failure into a terminal effect report. A retryable failure calls nothing '
      'at all, which is why every failure that reaches 011 is terminal by '
      'construction.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE NOTICE 'T12 PASS - DISPATCHED effect -> enqueue (deduped) -> claim -> '
    'complete_job -> 011 stores SETTLED and the action reaches EXECUTED; the '
    'seam RAISES on DISPATCHED, on SETTLED and on a transient retry outcome.';
END;
$t12$;

-- ─── T13 · M-20 · replay presents the SAME provider key ────────────────────

DO $t13$
DECLARE
  v_tenant   uuid := '00000012-1111-1111-1111-111111111111';
  v_request  uuid := '00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_job      uuid;
  v_new_job  uuid;
  v_letter   uuid;
  v_key_before text;
  v_key_after  text;
  v_state    text;
  v_before   app.outbox%ROWTYPE;
BEGIN
  PERFORM app.enqueue_effect_jobs(v_request, v_tenant);
  SELECT job.* INTO v_before FROM app.outbox AS job
   WHERE job.action_request_id = v_request;
  v_job := v_before.id;
  v_key_before := app.provider_idempotency_key(v_before.idempotency_subject,
                                               v_before.submission_attempt);
  ASSERT v_key_before = 'AccountingPackage:INV-T012-0002#1',
    pg_catalog.format('T13a FAIL: the provider key is %s; it must be derived '
      'from the SUBJECT and the stored attempt', v_key_before);

  -- Kill it non-retryably so it dead-letters on attempt 1.
  PERFORM app.claim_jobs('t012-pusher', v_tenant, ARRAY['PUSH_INVOICE'], 10);
  v_state := app.fail_job(v_job, v_tenant, 't012-pusher',
    '{"code":"PROVIDER_REJECTED","message":"bad account","retryable":false}'::jsonb,
    false);
  ASSERT v_state = 'DEAD', pg_catalog.format('T13b FAIL: expected DEAD, got %s', v_state);

  SELECT letter.id INTO v_letter FROM app.dead_letters AS letter
   WHERE letter.origin_id = v_job;
  ASSERT v_letter IS NOT NULL, 'T13c FAIL: no dead letter was written';
  ASSERT (SELECT letter.submission_attempt FROM app.dead_letters AS letter
           WHERE letter.id = v_letter) = 1,
    'T13d FAIL: the dead letter did not carry the submission attempt forward';

  v_new_job := app.replay_dead_letter(v_letter, v_tenant,
    '{"kind":"HUMAN","id":"00000012-0000-0000-0000-0000000000a2","name":"T012 Finance"}'::jsonb);

  ASSERT v_new_job <> v_job, 'T13e FAIL: the replay must be a NEW job row';
  ASSERT (SELECT job.job_key FROM app.outbox AS job WHERE job.id = v_new_job)
         <> v_before.job_key,
    'T13f FAIL: the replay must take a NEW dedupe key - the original still '
    'occupies the old one';
  SELECT app.provider_idempotency_key(job.idempotency_subject, job.submission_attempt)
    INTO v_key_after FROM app.outbox AS job WHERE job.id = v_new_job;
  ASSERT v_key_after = v_key_before,
    pg_catalog.format('T13g FAIL (M-20): the replay presents provider key %s, '
      'the original presented %s. Derived from job.id they would always differ '
      'and the same invoice would be submitted twice.', v_key_after, v_key_before);
  ASSERT (SELECT job.payload ->> 'replayedFrom' FROM app.outbox AS job
           WHERE job.id = v_new_job) = v_job::text,
    'T13h FAIL: the replacement job does not carry replayedFrom';

  -- The original row is UNCHANGED, so the failure stays inspectable.
  ASSERT (SELECT job.state FROM app.outbox AS job WHERE job.id = v_job) = 'DEAD'
     AND (SELECT job.last_error ->> 'code' FROM app.outbox AS job WHERE job.id = v_job)
         = 'PROVIDER_REJECTED',
    'T13i FAIL: the replay changed the original job; nothing is ever re-run in place';
  ASSERT (SELECT letter.replayed_job_id FROM app.dead_letters AS letter
           WHERE letter.id = v_letter) = v_new_job
     AND (SELECT letter.replayed_at FROM app.dead_letters AS letter
           WHERE letter.id = v_letter) IS NOT NULL,
    'T13j FAIL: the dead letter was not stamped with its replay';

  -- A second replay of the same letter is refused rather than silently making a
  -- third job.
  BEGIN
    PERFORM app.replay_dead_letter(v_letter, v_tenant,
      '{"kind":"HUMAN","id":"x","name":"X"}'::jsonb);
    ASSERT false, 'T13k FAIL: a dead letter was replayed twice';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  RAISE NOTICE 'T13 PASS - replay is a new job with a new dedupe key, the SAME '
    'subject-derived provider idempotency key, replayedFrom recorded, the '
    'original row untouched, and a second replay refused.';
END;
$t13$;

-- ─── T14 · the remaining findings, each with its own assertion ─────────────

DO $t14$
DECLARE
  v_alpha uuid := '00000012-1111-1111-1111-111111111111';
  v_beta  uuid := '00000012-2222-2222-2222-222222222222';
  v_counts jsonb;
  v_n     integer;
  v_agent_request uuid := '00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
BEGIN
  -- ── M-07 · the allowlist, exactly ─────────────────────────────────────
  ASSERT app.outbox_payload_allowlist(
    '{"channel":"EMAIL","body":"free text","participantNric":"900101-14-5555","amount":1000}'::jsonb)
    = '{"amount": 1000, "channel": "EMAIL"}'::jsonb,
    pg_catalog.format('T14a FAIL (M-07): the allowlist produced %s',
      app.outbox_payload_allowlist(
        '{"channel":"EMAIL","body":"free text","participantNric":"900101-14-5555","amount":1000}'::jsonb)::text);
  ASSERT app.outbox_payload_allowlist(NULL) = '{}'::jsonb,
    'T14b FAIL: the allowlist must return an object for a NULL payload; '
    'app.outbox.payload is NOT NULL';

  -- ── M-26 · the four paths are the CONTRACT's ──────────────────────────
  ASSERT ARRAY[app.webhook_path_for('EMAIL'), app.webhook_path_for('WHATSAPP'),
               app.webhook_path_for('PORTAL'), app.webhook_path_for('ACCOUNTING')]
         = ARRAY['/v1/webhooks/email','/v1/webhooks/whatsapp',
                 '/v1/webhooks/proposal-accepted','/v1/webhooks/accounting'],
    'T14c FAIL (M-26): a webhook path drifted from packages/contract '
    'INBOUND_WEBHOOKS[].path. Doc 05 s4.1 says /functions/v1/webhook-*; the '
    'contract wins and the disagreement is recorded, not silently resolved.';
  BEGIN
    INSERT INTO app.webhook_routes (source, external_id, route_path, tenant_id)
    VALUES ('EMAIL','x','/functions/v1/webhook-email', v_alpha);
    ASSERT false, 'T14d FAIL (M-26): the table accepted doc 05''s path';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.webhook_path_for('SMS');
    ASSERT false, 'T14e FAIL: an unknown webhook source did not raise';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- ── H-16 · per-tenant fairness ────────────────────────────────────────
  -- Alpha floods with fifty priority-1 jobs; beta has one. Doc 05's global
  -- `order by priority, run_after` gives beta nothing until alpha drains.
  INSERT INTO app.outbox (tenant_id, job_type, priority, correlation_id)
  SELECT v_alpha,'T012_FAIR',1,pg_catalog.gen_random_uuid()
    FROM pg_catalog.generate_series(1, 50);
  INSERT INTO app.outbox (tenant_id, job_type, priority, correlation_id)
  VALUES (v_beta,'T012_FAIR',1,pg_catalog.gen_random_uuid());

  SELECT pg_catalog.jsonb_object_agg(batch.tenant_id::text, batch.n) INTO v_counts
    FROM (SELECT claimed.tenant_id, pg_catalog.count(*) AS n
            FROM app.claim_jobs('t012-fair', NULL, ARRAY['T012_FAIR'], 4) AS claimed
           GROUP BY claimed.tenant_id) AS batch;
  ASSERT v_counts = pg_catalog.jsonb_build_object(v_alpha::text, 3, v_beta::text, 1),
    pg_catalog.format('T14f FAIL (H-16): a four-job batch split %s. With '
      'fairness beta''s single interactive job is taken before alpha''s second, '
      'so the split must be 3/1.', v_counts::text);

  -- ── H-17 · jobs_health notices a queue that has stopped ────────────────
  -- Beta now has due work and no claim newer than the threshold. A tenant that
  -- has NEVER been claimed counts too, because that is what a fresh deploy with
  -- a broken worker looks like.
  INSERT INTO app.outbox (tenant_id, job_type, priority, correlation_id, run_after)
  VALUES (v_beta,'T012_STALL',5,pg_catalog.gen_random_uuid(),
          pg_catalog.now() - interval '1 hour');
  UPDATE app.outbox SET claimed_at = pg_catalog.now() - interval '2 hours'
   WHERE tenant_id = v_beta AND claimed_at IS NOT NULL;

  v_n := app.jobs_health(v_beta, interval '15 minutes', 100);
  ASSERT v_n = 1,
    pg_catalog.format('T14g FAIL (H-17): jobs_health raised %s events for a '
      'stalled tenant, expected 1', v_n);
  ASSERT (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.tenant_id = v_beta AND event.type = 'JobStalled') = 1,
    'T14h FAIL (H-17): no JobStalled event reached the log';
  -- Idempotent within the window: a stalled queue raises once per window, not
  -- once per tick.
  ASSERT app.jobs_health(v_beta, interval '15 minutes', 100) = 1
     AND (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.tenant_id = v_beta AND event.type = 'JobStalled') = 1,
    'T14i FAIL (H-17): a second tick inside the same window wrote a second event';

  -- ── M-24 · CANCELLED is actually written ───────────────────────────────
  INSERT INTO core.action_requests
    (id, tenant_id, ref, action_type, target_ref, target_id, payload, status,
     requested_by_kind, requested_by_id)
  VALUES (v_agent_request, v_alpha,'ACT-T012-0007','PROPOSAL_SEND','PRO-T012-7',
          '00000012-eeee-eeee-eeee-eeeeeeeeeee7','{}'::jsonb,'EXECUTING',
          'AGENT','agent_proposal');
  INSERT INTO app.action_effects
    (tenant_id, action_request_id, seq, op, entity, ref, description, kind, status, job_key)
  VALUES (v_alpha, v_agent_request, 1,'ADD','Email','PRO-T012-7',
          'Send the proposal email','EXTERNAL','DISPATCHED',
          v_agent_request::text || ':1');
  PERFORM app.enqueue_effect_jobs(v_agent_request, v_alpha);

  ASSERT app.cancel_jobs(v_alpha, 'agent_proposal', 100) = 1,
    'T14j FAIL (M-24): cancel_jobs cancelled nothing for a paused agent';
  ASSERT (SELECT job.state FROM app.outbox AS job
           WHERE job.action_request_id = v_agent_request) = 'CANCELLED',
    'T14k FAIL (M-24): CANCELLED is still declared and never written';
  -- A CLAIMED job is deliberately untouched: cancelling the row does not stop
  -- the worker already running it.
  ASSERT app.cancel_jobs(v_alpha, 'agent_proposal', 100) = 0,
    'T14l FAIL: a second cancel touched an already-terminal job';
  ASSERT app.cancel_jobs(v_alpha, 'no_such_agent', 100) = 0,
    'T14m FAIL: cancel_jobs touched work that is not this agent''s';

  -- ── C-07 · the five reapers, each returning its count ──────────────────
  -- Aged fixtures are INSERTED with an old received_at rather than updated into
  -- one: app.finalise_table freezes received_at, which is the correct posture
  -- and is why this fixture is shaped this way.
  INSERT INTO app.webhook_deliveries
    (source, idempotency_key, signature_valid, http_status, raw_body, received_at)
  VALUES
    ('EMAIL','t012-old-body', true, 200, '{"raw":"31 days old"}',
     pg_catalog.now() - interval '31 days'),
    ('EMAIL','t012-fresh-body', true, 200, '{"raw":"29 days old"}',
     pg_catalog.now() - interval '29 days'),
    ('EMAIL','t012-ancient', true, 200, NULL,
     pg_catalog.now() - interval '400 days');

  ASSERT app.reap_webhook_bodies(100) = 1,
    'T14n FAIL (C-07): reap_webhook_bodies did not null exactly the 31-day body';
  ASSERT (SELECT delivery.raw_body FROM app.webhook_deliveries AS delivery
           WHERE delivery.idempotency_key = 't012-old-body') IS NULL
     AND (SELECT delivery.signature_valid FROM app.webhook_deliveries AS delivery
           WHERE delivery.idempotency_key = 't012-old-body') = true,
    'T14o FAIL (C-07): the body must be nulled and the row KEPT readable';
  ASSERT (SELECT delivery.raw_body FROM app.webhook_deliveries AS delivery
           WHERE delivery.idempotency_key = 't012-fresh-body') IS NOT NULL,
    'T14p FAIL (C-07): 29 days must survive entirely - this is the off-by-one '
    'that silently destroys evidence';

  ASSERT app.reap_webhook_deliveries(100) = 1,
    'T14q FAIL (C-07): reap_webhook_deliveries did not delete exactly the '
    '400-day row';
  ASSERT (SELECT pg_catalog.count(*) FROM app.webhook_deliveries AS delivery
           WHERE delivery.idempotency_key = 't012-ancient') = 0,
    'T14r FAIL (C-07): the one-year row survived';

  UPDATE app.outbox SET finished_at = pg_catalog.now() - interval '91 days'
   WHERE state = 'SUCCEEDED';
  v_n := app.reap_outbox(10000);
  ASSERT v_n > 0,
    'T14s FAIL (C-07): reap_outbox deleted nothing; the outbox never shrinks';
  ASSERT (SELECT pg_catalog.count(*) FROM app.outbox AS job
           WHERE job.state = 'DEAD') > 0,
    'T14t FAIL (C-07): DEAD rows must be KEPT - they are the failure record and '
    'the badge count';

  UPDATE app.dead_letters SET replayed_at = pg_catalog.now() - interval '400 days'
   WHERE replayed_at IS NOT NULL;
  ASSERT app.reap_dead_letters(100) >= 1,
    'T14u FAIL (C-07): reap_dead_letters deleted nothing';
  ASSERT (SELECT pg_catalog.count(*) FROM app.dead_letters AS letter
           WHERE letter.replayed_at IS NULL) > 0,
    'T14v FAIL (C-07): an UNREPLAYED dead letter is an open incident and must '
    'never be reaped';

  INSERT INTO cron.job_run_details
    (jobid, job_pid, database, username, command, status, start_time, end_time)
  VALUES (1, 1, 'trainos', 'postgres', 'select 1', 'succeeded',
          pg_catalog.now() - interval '10 days', pg_catalog.now() - interval '10 days');
  ASSERT app.reap_cron_history(100) = 1,
    'T14w FAIL (C-07): reap_cron_history deleted nothing. Postgres does NOT '
    'clean cron.job_run_details up and doc 05 s5.5 says so itself.';

  -- ── C-07 · events are NEVER deleted by any of them ─────────────────────
  ASSERT (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.tenant_id = v_alpha) > 0,
    'T14x FAIL: a retention sweep touched the event log, which is retained '
    'indefinitely by design';

  -- ── H-18 · the retry lane has an index and the reaper is bounded ───────
  ASSERT (SELECT pg_catalog.pg_get_indexdef(class.oid)
            FROM pg_catalog.pg_class AS class
           WHERE class.relname = 'outbox_retry_idx' AND class.relkind = 'i')
         = 'CREATE INDEX outbox_retry_idx ON app.outbox USING btree (run_after) '
           'WHERE (state = ''FAILED''::text)',
    pg_catalog.format('T14y FAIL (H-18): outbox_retry_idx is %s',
      (SELECT pg_catalog.pg_get_indexdef(class.oid) FROM pg_catalog.pg_class AS class
        WHERE class.relname = 'outbox_retry_idx' AND class.relkind = 'i'));
  ASSERT app.reap_jobs(v_alpha, 1) <= 3,
    'T14z FAIL (H-18): reap_jobs(p_limit => 1) moved more than one row per lane; '
    'a provider outage that fails 50,000 jobs must not make one cron tick a '
    '50,000-row UPDATE';

  RAISE NOTICE 'T14 PASS - allowlist exact; four contract paths enforced by '
    'CHECK; a 50/1 flood splits 3/1 (H-16); jobs_health raises once per window '
    '(H-17); CANCELLED written and scoped (M-24); five reapers each return a '
    'count with 29 days surviving, DEAD kept, unreplayed letters kept and the '
    'event log untouched (C-07); the retry index is exactly (run_after) partial '
    'on the retry state, and the reaper is bounded (H-18).';
END;
$t14$;


-- ─── T15 · CRIT · a replayed job can still settle its effect ───────────────
-- The finding: `app.replay_dead_letter` copies `effect_id` onto the replacement
-- job — deliberately, because a replay is a second attempt at ONE effect and not
-- a second effect. But dead-lettering had already moved that effect to
-- DEAD_LETTERED, and `app.report_effect_result` (011:3502) returns early and
-- SILENTLY on an effect that is already SETTLED or DEAD_LETTERED. So when the
-- replay SUCCEEDED and `complete_job` reported it, the report was a no-op: an
-- invoice that really was pushed stayed recorded as permanently failed in the
-- effect ledger. And nothing could correct it later, because the
-- PARTIALLY_FAILED reconciliation is guarded `AND status = 'EXECUTING'` and the
-- action had already left that state.
--
-- The replay now reopens the effect to DISPATCHED first. This pin walks the whole
-- round trip rather than asserting the UPDATE exists: fail a job to death, replay
-- it, complete the replacement, and require the effect to reach SETTLED.
DO $t15$
DECLARE
  v_effect  bigint;
  v_tenant  uuid;
  v_job     uuid;
  v_dl      uuid;
  v_new     uuid;
  v_status  text;
BEGIN
  -- Pick the JOB first, not the effect: this file's earlier checks already kill
  -- some of the fixture jobs, and selecting an effect that happens to have a DEAD
  -- job would make the setup below fail for a reason that has nothing to do with
  -- replays. A QUEUED job with an effect behind it is exactly the starting state
  -- this pin needs.
  SELECT o.id, o.effect_id, o.tenant_id INTO v_job, v_effect, v_tenant
    FROM app.outbox AS o
    JOIN app.action_effects AS e ON e.id = o.effect_id
   WHERE o.state = 'QUEUED'
     AND o.effect_id IS NOT NULL
     AND e.status = 'DISPATCHED'
     AND o.run_after <= pg_catalog.now()
   ORDER BY o.created_at
   LIMIT 1;

  ASSERT v_job IS NOT NULL,
    'T15 SETUP FAIL: no QUEUED job with a live external effect behind it. Since '
    '011 now calls app.enqueue_effect_jobs there should be one; if there is not, '
    'the seam regressed and test_011 T16 is the pin that says so.';

  -- Kill it, through the real lease path rather than by hand-editing state:
  -- app.outbox carries invariants tying state to claimed_at/finished_at, and a
  -- pin that sets columns directly is testing its own UPDATE, not the product's.
  PERFORM app.claim_jobs('t015-worker', v_tenant, NULL, 50, interval '60 seconds', 200);

  ASSERT (SELECT o.state FROM app.outbox AS o WHERE o.id = v_job) = 'CLAIMED',
    pg_catalog.format('T15 SETUP FAIL: the job is %s after claim_jobs, not '
      'CLAIMED (run_after=%s, visible_after=%s).',
      (SELECT o.state FROM app.outbox AS o WHERE o.id = v_job),
      (SELECT o.run_after FROM app.outbox AS o WHERE o.id = v_job),
      (SELECT o.visible_after FROM app.outbox AS o WHERE o.id = v_job));

  -- retryable = false is the immediate dead-letter path: no backoff, no second
  -- attempt, straight to app.dead_letters and the effect to DEAD_LETTERED.
  PERFORM app.fail_job(v_job, v_tenant, 't015-worker',
    pg_catalog.jsonb_build_object(
      'code','PROVIDER_DOWN','message','staged failure','retryable',false),
    false);

  SELECT e.status::text INTO v_status FROM app.action_effects AS e WHERE e.id = v_effect;
  ASSERT v_status = 'DEAD_LETTERED',
    pg_catalog.format('T15 SETUP FAIL: after a non-retryable failure the effect '
      'is %s, not DEAD_LETTERED, so the state this pin is about was never '
      'reached.', v_status);

  SELECT d.id INTO v_dl FROM app.dead_letters AS d WHERE d.origin_id = v_job LIMIT 1;
  ASSERT v_dl IS NOT NULL, 'T15 SETUP FAIL: no dead letter was written.';

  -- THE REPLAY.
  v_new := app.replay_dead_letter(v_dl, v_tenant,
    pg_catalog.jsonb_build_object('kind','SYSTEM','id','t015','name',NULL));
  ASSERT v_new IS NOT NULL, 'T15a FAIL: replay_dead_letter returned no job.';

  -- T15b · the effect is REOPENED. Against the pre-fix SQL it is still
  -- DEAD_LETTERED here, and everything below still "passes" — the completion
  -- reports into a silent early return and the ledger keeps the lie.
  SELECT e.status::text INTO v_status FROM app.action_effects AS e WHERE e.id = v_effect;
  ASSERT v_status = 'DISPATCHED',
    pg_catalog.format('T15b FAIL: after a replay the effect is %s. It has to be '
      'back in a state a worker report can move, or complete_job''s call to '
      'report_effect_result hits the SETTLED/DEAD_LETTERED early return and does '
      'nothing at all.', v_status);

  -- T15c · and the successful replay actually settles it. Claimed through the
  -- real path again, for the same reason.
  PERFORM app.claim_jobs('t015-worker', v_tenant, NULL, 50, interval '60 seconds', 200);
  ASSERT (SELECT o.state FROM app.outbox AS o WHERE o.id = v_new) = 'CLAIMED',
    'T15 SETUP FAIL: the replacement job was not claimable.';
  PERFORM app.complete_job(v_new, v_tenant, 't015-worker',
    pg_catalog.jsonb_build_object('ok',true), NULL);

  -- T15d · AND THE REQUEST AGREES WITH THE LEDGER. The effect reaching SETTLED is
  -- only half of "the replay worked": `core.action_requests` is what the product
  -- reads, and its reconciliation was guarded `AND status = 'EXECUTING'` — which
  -- the request had already left when dead-lettering moved it to
  -- PARTIALLY_FAILED. So the effect settled, the request stayed PARTIALLY_FAILED
  -- forever, and nothing could correct it. The first version of this pin asserted
  -- only the effect status and would have passed against exactly that.
  ASSERT (SELECT a.status FROM core.action_requests AS a
           WHERE a.id = (SELECT e.action_request_id FROM app.action_effects AS e
                          WHERE e.id = v_effect)) = 'EXECUTED',
    pg_catalog.format('T15d FAIL: the replay settled its effect but the action '
      'request is %s, not EXECUTED. The ledger and the request disagree, and the '
      'request is the one the product reads.',
      (SELECT a.status FROM core.action_requests AS a
        WHERE a.id = (SELECT e.action_request_id FROM app.action_effects AS e
                       WHERE e.id = v_effect)));

  SELECT e.status::text INTO v_status FROM app.action_effects AS e WHERE e.id = v_effect;
  ASSERT v_status = 'SETTLED',
    pg_catalog.format('T15c FAIL: the replay succeeded and the effect is %s, not '
      'SETTLED. An invoice that really was pushed is recorded as permanently '
      'failed, and nothing can correct it later — the PARTIALLY_FAILED '
      'reconciliation is guarded AND status = ''EXECUTING'' and the action has '
      'left that state.', v_status);

  RAISE NOTICE
    'T15 PASS - a dead-lettered effect is reopened to DISPATCHED by the replay, '
    'reaches SETTLED when the replacement job completes, and the action request '
    'moves off PARTIALLY_FAILED to EXECUTED — the ledger and the request agree.';
END;
$t15$;


ROLLBACK;
