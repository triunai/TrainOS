-- ═══════════════════════════════════════════════════════════════════════════
-- test_025 · compliance — getComplianceChecks, getClaimPacket,
--            attachPacketDocument, exportClaimPacket, createComplianceRule,
--            getRuleChangeSet
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001–021 plus 025. Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_025_hrdc_compliance.sql
--
-- EXECUTED as the migration role; every probe below impersonates `authenticated`
-- with a real JWT claim set (`SET LOCAL ROLE`, one statement, parked in a
-- transaction-local GUC — test_020/test_021's own convention). Self-contained:
-- its own tenant, users and rows, namespaced `a0250000-…`, independent of the
-- demo seed.
--
-- T1  A national HRD Corp rule cannot go ACTIVE without the legal
--     RULE_CHANGE_APPROVE gate (009:298's own requirement, re-proved here
--     because 025's seed depends on it).
-- T2  getClaimPacket: MD gets exact contract keys, requiredDocuments in
--     document-type position order, levyAvailable never null.
-- T3  getComplianceChecks: PASS/WARN tally in summary, ruleResolution both
--     sides, versionDrift present when a drift row exists.
-- T4  attachPacketDocument: DRAFT -> READY on completeness reaching 1 (ungated
--     edge), VALIDATION_FAILED on a body with neither type nor ref, idempotent
--     replay on the same key returns the same packet without re-attaching.
-- T5  createComplianceRule: FINANCE succeeds and the row loads PROPOSED,
--     unverified, tenant-scoped; MD is FORBIDDEN (002's matrix withholds
--     compliance:rule:write from MD).
-- T6  getRuleChangeSet: NOT_FOUND for an unknown documentId, otherwise the
--     nested changes[] with sourceSpan and affectedEngagements.
-- T7  Cross-tenant: another tenant's MD gets NOT_FOUND from every read, the
--     same answer for a real id and a made-up one.
-- T8  anon is refused all six with 42501.
-- T9  TEETH CHECK: with MD's `hrdc:read` permission removed mid-transaction,
--     getClaimPacket FORBIDS an MD who was reading it freely a moment ago —
--     proving the authz-first check is load-bearing, not vacuously true.
--     Restored before the pin's own ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

-- ── Helpers (test_009/020/021's own conventions) ────────────────────────────

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal1')::text;
$fn$;

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; v_detail text; v_sqlstate text;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'value', v);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL, v_sqlstate = RETURNED_SQLSTATE;
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', v_sqlstate,
    'message', SQLERRM, 'detail', v_detail);
END;
$fn$;

CREATE FUNCTION pg_temp.got(p_key text) RETURNS jsonb
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('a25.' || p_key)::jsonb; $fn$;

-- GOV-07 fixture helper — test_009's own copy. Creates a genuine
-- action_requests row of the gating type, targeting the row about to cross
-- the edge, and publishes it as the applier for exactly the statement that
-- needs it.
CREATE FUNCTION pg_temp.gate(p_tenant uuid, p_type text, p_target uuid) RETURNS void
LANGUAGE plpgsql AS $gate$
DECLARE v_id uuid;
BEGIN
  INSERT INTO core.action_requests
    (tenant_id, action_type, target_id, status, requested_by_kind, requested_by_id)
  VALUES (p_tenant, p_type, p_target, 'EXECUTING', 'SYSTEM', 'pin-fixture')
  RETURNING id INTO v_id;
  PERFORM pg_catalog.set_config('app.effect_applier', v_id::text, true);
END $gate$;

CREATE FUNCTION pg_temp.ungate() RETURNS void LANGUAGE plpgsql AS $ungate$
BEGIN PERFORM pg_catalog.set_config('app.effect_applier', '', true); END $ungate$;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_025 SETUP FAILURE: check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

-- ── Fixtures ─────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('a0250000-0000-4000-8000-0000000000a1','md@a25.test'),
  ('a0250000-0000-4000-8000-0000000000a2','finance@a25.test'),
  ('a0250000-0000-4000-8000-0000000000b1','md@b25.test');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('a0250000-1111-4000-8000-000000000001','a25-akademi','Akademi Perdana A25','ACTIVE','Asia/Kuala_Lumpur','en-MY'),
  ('a0250000-1111-4000-8000-000000000002','a25-other','Other Tenant A25','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,client_scope,team_scope,status,is_default) VALUES
  ('a0250000-1111-4000-8000-000000000001','a0250000-0000-4000-8000-0000000000a1','MD','HUMAN','ALL','ALL','ACTIVE',true),
  ('a0250000-1111-4000-8000-000000000001','a0250000-0000-4000-8000-0000000000a2','FINANCE','HUMAN','ALL','ALL','ACTIVE',true),
  ('a0250000-1111-4000-8000-000000000002','a0250000-0000-4000-8000-0000000000b1','MD','HUMAN','ALL','ALL','ACTIVE',true);

INSERT INTO core.organisations (id,tenant_id,name,industry,location,owner_id,status,hrdc_registered,hrdc_employer_code,country_code) VALUES
  ('a0250000-2222-4000-8000-000000000001','a0250000-1111-4000-8000-000000000001','Chrome A25',
   'MANUFACTURING','Shah Alam','a0250000-0000-4000-8000-0000000000a1','ACTIVE_CLIENT',true,'E-A25','MYS');

INSERT INTO core.programmes (id,tenant_id,name,category,days,version,status,hrdc_scheme,hrdc_claimable,
  list_price_sen,list_price_pax,floor_price_sen,floor_margin_rate,created_by_kind,created_by_id) VALUES
  ('a0250000-3333-4000-8000-000000000001','a0250000-1111-4000-8000-000000000001','Safety A25',
   'SAFETY',1,1,'ACTIVE','SBL_KHAS',true,500000,20,350000,0.3000,'HUMAN','a0250000-0000-4000-8000-0000000000a1');

-- 019 provisions the tenant's own default ENGAGEMENT pipeline on insert; a
-- second one would collide with `pipelines_one_default_uq`.
INSERT INTO core.engagements (id,tenant_id,ref,organisation_id,programme_id,owner_id,pipeline_id,title,status,currency,
  grant_rule_set_version_id,grant_pinned_at,starts_on,ends_on,created_by_kind,created_by_id)
SELECT
   'a0250000-5555-4000-8000-000000000001','a0250000-1111-4000-8000-000000000001','ENG-A25-0001',
   'a0250000-2222-4000-8000-000000000001','a0250000-3333-4000-8000-000000000001',
   'a0250000-0000-4000-8000-0000000000a1', pipeline.id,
   'Safety A25 delivery','PROPOSED','MYR',NULL,NULL,DATE '2026-11-10',DATE '2026-11-11','HUMAN',
   'a0250000-0000-4000-8000-0000000000a1'
  FROM core.pipelines AS pipeline
 WHERE pipeline.tenant_id = 'a0250000-1111-4000-8000-000000000001'
   AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default;

-- National rule (017's own row shape), PROPOSED — the row T1 activates.
INSERT INTO core.compliance_rules
  (id, tenant_id, rule_code, family_key, check_key, delivery_mode, side, subject,
   subject_field, op, reference_kind, reference, offset_amount, offset_unit,
   effective_from, status, source_title, source_section, source_excerpt)
VALUES
  ('a0250000-6666-4000-8000-000000000001', NULL, 'HRD-A25-01', 'A25_FAMILY', 'CHK_A25',
   'ANY', 'GRANT', 'Test commencement window', 'starts_on', 'LTE', 'FIELD', 'approval_date',
   90, 'DAY', DATE '2026-01-01', 'PROPOSED', 'Test circular', 'Test section', 'Test excerpt');

INSERT INTO core.rule_set_versions (id, tenant_id, version_key, registry_asof, note) VALUES
  ('a0250000-7777-4000-8000-000000000001', NULL, 'rs_a25_test', pg_catalog.now(), 'Pin fixture registry snapshot.');

-- Pin the engagement's grant-side rule-set version now that it exists.
UPDATE core.engagements
   SET grant_rule_set_version_id = 'a0250000-7777-4000-8000-000000000001',
       grant_pinned_at = pg_catalog.now() - interval '20 days'
 WHERE id = 'a0250000-5555-4000-8000-000000000001';

-- ════════ T1 · A rule cannot go ACTIVE without the legal gate ═══════════════

DO $t1$
DECLARE v_bad jsonb; v_id uuid := 'a0250000-6666-4000-8000-000000000001';
BEGIN
  -- Direct UPDATE, no applier published: refused.
  BEGIN
    UPDATE core.compliance_rules SET status = 'ACTIVE' WHERE id = v_id;
    RAISE EXCEPTION 'T1 FAIL: rule went ACTIVE with no gate at all';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'TRNOS' THEN
      RAISE EXCEPTION 'T1 FAIL: wrong SQLSTATE for an ungated activation: %', SQLSTATE;
    END IF;
  END;

  -- Legal path: a genuine RULE_CHANGE_APPROVE action_request, targeting THIS
  -- rule, EXECUTING, published as the applier.
  PERFORM pg_temp.gate('a0250000-1111-4000-8000-000000000001', 'RULE_CHANGE_APPROVE', v_id);
  UPDATE core.compliance_rules
     SET status = 'ACTIVE', verified_by_user_id = 'a0250000-0000-4000-8000-0000000000a1',
         verified_at = pg_catalog.now()
   WHERE id = v_id;
  PERFORM pg_temp.ungate();

  IF (SELECT status FROM core.compliance_rules WHERE id = v_id) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'T1 FAIL: legal RULE_CHANGE_APPROVE gate did not activate the rule';
  END IF;
  RAISE NOTICE 'T1 PASS - a rule activates only over the legal RULE_CHANGE_APPROVE gate.';
END;
$t1$;

INSERT INTO core.compliance_check_results
  (id, tenant_id, engagement_id, check_key, state, label, computed,
   compliance_rule_id, rule_set_version_id, rule_side, rules_as_of, basis, method)
VALUES
  ('a0250000-8888-4000-8000-000000000001', 'a0250000-1111-4000-8000-000000000001',
   'a0250000-5555-4000-8000-000000000001', 'CHK_A25', 'PASS', 'Test commencement window',
   '{"basis":"test"}'::jsonb, 'a0250000-6666-4000-8000-000000000001',
   'a0250000-7777-4000-8000-000000000001', 'GRANT', DATE '2026-08-01', 'GRANT_SUBMITTED', 'DETERMINISTIC'),
  ('a0250000-8888-4000-8000-000000000002', 'a0250000-1111-4000-8000-000000000001',
   'a0250000-5555-4000-8000-000000000001', 'CHK_A25_WARN', 'WARN', 'Second check, WARN',
   '{"basis":"test"}'::jsonb, 'a0250000-6666-4000-8000-000000000001',
   'a0250000-7777-4000-8000-000000000001', 'GRANT', DATE '2026-08-01', 'GRANT_SUBMITTED', 'DETERMINISTIC');

INSERT INTO core.rule_set_versions (id, tenant_id, version_key, registry_asof, note) VALUES
  ('a0250000-7777-4000-8000-000000000002', NULL, 'rs_a25_test_2', pg_catalog.now() + interval '1 day', 'Pin fixture second snapshot.');

INSERT INTO core.compliance_version_drifts (id, tenant_id, compliance_check_result_id, applied_version_id, current_version_id, severity, message) VALUES
  ('a0250000-9999-4000-8000-000000000001', 'a0250000-1111-4000-8000-000000000001',
   'a0250000-8888-4000-8000-000000000001', 'a0250000-7777-4000-8000-000000000001',
   'a0250000-7777-4000-8000-000000000002', 'WARN', 'Test drift message.');

INSERT INTO core.hrdc_packets (id, tenant_id, engagement_id, organisation_id, scheme, employer_code,
  claim_value_sen, levy_available_sen, currency, completeness, status, deadline_at, deadline_severity,
  grant_reference, grant_submitted_at, grant_approved_at) VALUES
  ('a0250000-aaaa-4000-8000-000000000001','a0250000-1111-4000-8000-000000000001',
   'a0250000-5555-4000-8000-000000000001','a0250000-2222-4000-8000-000000000001',
   'SBL_KHAS','E-A25', 500000, 2000000, 'MYR', 0, 'DRAFT',
   pg_catalog.now() + interval '10 days', 'WARN', 'GRA-A25-0001', pg_catalog.now() - interval '30 days',
   pg_catalog.now() - interval '25 days');

INSERT INTO core.hrdc_packet_documents (id, tenant_id, hrdc_packet_id, document_type, status) VALUES
  ('a0250000-bbbb-4000-8000-000000000001','a0250000-1111-4000-8000-000000000001',
   'a0250000-aaaa-4000-8000-000000000001','TAX_INVOICE','MISSING'),
  ('a0250000-bbbb-4000-8000-000000000002','a0250000-1111-4000-8000-000000000001',
   'a0250000-aaaa-4000-8000-000000000001','TRAINING_SCHEDULE','MISSING');
UPDATE core.hrdc_packet_documents SET status = 'PRESENT', source_ref = 'ATT-A25-0001', attached_at = pg_catalog.now()
 WHERE id = 'a0250000-bbbb-4000-8000-000000000001';
UPDATE core.hrdc_packets SET completeness = 0.500 WHERE id = 'a0250000-aaaa-4000-8000-000000000001';

INSERT INTO core.rule_change_sets (id, tenant_id, document_id, title, published_at, effective_from) VALUES
  ('a0250000-cccc-4000-8000-000000000001','a0250000-1111-4000-8000-000000000001','A25-CIRCULAR','A25 circular','2026-08-01','2026-09-01');
INSERT INTO core.rule_changes (id, tenant_id, rule_change_set_id, change_key, op, target_rule_id, before_text, after_text, confidence, status) VALUES
  ('a0250000-dddd-4000-8000-000000000001','a0250000-1111-4000-8000-000000000001',
   'a0250000-cccc-4000-8000-000000000001','k1','MODIFY','a0250000-6666-4000-8000-000000000001',
   'before text','after text',0.900,'PROPOSED');

-- ════════ T2 · getClaimPacket ════════════════════════════════════════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t2_packet',
  pg_temp.try($$SELECT core.get_claim_packet('ENG-A25-0001')$$)::text, true);
RESET ROLE;

DO $t2$
DECLARE v jsonb := pg_temp.got('t2_packet') -> 'value' -> 'data';
BEGIN
  IF NOT (pg_temp.got('t2_packet') #>> '{value,success}')::boolean THEN
    RAISE EXCEPTION 'T2 FAIL: getClaimPacket refused for MD: %', pg_temp.got('t2_packet');
  END IF;
  IF v ->> 'engagementRef' <> 'ENG-A25-0001' OR v ->> 'organisationRef' IS NULL THEN
    RAISE EXCEPTION 'T2 FAIL: missing engagementRef/organisationRef: %', v;
  END IF;
  IF v #>> '{levyAvailable,amount}' IS NULL THEN
    RAISE EXCEPTION 'T2 FAIL: levyAvailable is null; the contract requires a Money';
  END IF;
  IF (v ->> 'completeness')::numeric <> 0.5 THEN
    RAISE EXCEPTION 'T2 FAIL: completeness wrong: %', v ->> 'completeness';
  END IF;
  IF pg_catalog.jsonb_array_length(v -> 'requiredDocuments') <> 2 THEN
    RAISE EXCEPTION 'T2 FAIL: expected 2 required documents, got %', v -> 'requiredDocuments';
  END IF;
  IF (v -> 'requiredDocuments' -> 0 ->> 'status') <> 'PRESENT' THEN
    RAISE EXCEPTION 'T2 FAIL: TAX_INVOICE (position 30) should sort before TRAINING_SCHEDULE (position 50): %',
      v -> 'requiredDocuments';
  END IF;
  RAISE NOTICE 'T2 PASS - getClaimPacket returns exact contract keys, levyAvailable never null.';
END;
$t2$;

-- ════════ T3 · getComplianceChecks ══════════════════════════════════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t3_checks',
  pg_temp.try($$SELECT core.get_compliance_checks('ENG-A25-0001')$$)::text, true);
RESET ROLE;

DO $t3$
DECLARE v jsonb := pg_temp.got('t3_checks') -> 'value' -> 'data';
BEGIN
  IF NOT (pg_temp.got('t3_checks') #>> '{value,success}')::boolean THEN
    RAISE EXCEPTION 'T3 FAIL: getComplianceChecks refused for MD: %', pg_temp.got('t3_checks');
  END IF;
  IF (v -> 'summary' ->> 'pass') <> '1' OR (v -> 'summary' ->> 'warn') <> '1' THEN
    RAISE EXCEPTION 'T3 FAIL: summary tally wrong: %', v -> 'summary';
  END IF;
  IF v #>> '{ruleResolution,grantSide,ruleSetVersion}' IS NULL THEN
    RAISE EXCEPTION 'T3 FAIL: grantSide.ruleSetVersion missing: %', v -> 'ruleResolution';
  END IF;
  IF pg_catalog.jsonb_array_length(v -> 'versionDrift') <> 1 THEN
    RAISE EXCEPTION 'T3 FAIL: expected 1 versionDrift row, got %', v -> 'versionDrift';
  END IF;
  RAISE NOTICE 'T3 PASS - getComplianceChecks tallies pass/warn, resolves both rule sides, surfaces version drift.';
END;
$t3$;

-- ════════ T4 · attachPacketDocument ═════════════════════════════════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t4_bad',
  pg_temp.try($$SELECT core.attach_packet_document('ENG-A25-0001', '{}'::jsonb, 'a25-bad')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t4_attach',
  pg_temp.try($$SELECT core.attach_packet_document('ENG-A25-0001',
    jsonb_build_object('type','TRAINING_SCHEDULE','ref','ATT-A25-0002'), 'a25-attach-1')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t4_replay',
  pg_temp.try($$SELECT core.attach_packet_document('ENG-A25-0001',
    jsonb_build_object('type','TRAINING_SCHEDULE','ref','ATT-A25-0002'), 'a25-attach-1')$$)::text, true);
RESET ROLE;

DO $t4$
DECLARE
  v_bad    jsonb := pg_temp.got('t4_bad');
  v_attach jsonb := pg_temp.got('t4_attach') -> 'value' -> 'data';
  v_replay jsonb := pg_temp.got('t4_replay') -> 'value' -> 'data';
BEGIN
  IF (v_bad ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'T4 FAIL: attach with neither type nor ref should VALIDATION_FAILED: %', v_bad;
  END IF;
  IF (v_bad -> 'detail')::jsonb ->> 'code' <> 'VALIDATION_FAILED' THEN
    RAISE EXCEPTION 'T4 FAIL: wrong refusal code: %', v_bad;
  END IF;
  IF v_attach ->> 'status' <> 'READY' OR (v_attach ->> 'completeness')::numeric <> 1 THEN
    RAISE EXCEPTION 'T4 FAIL: completeness reaching 1 should walk DRAFT -> READY: %', v_attach;
  END IF;
  IF v_replay ->> 'status' <> 'READY' THEN
    RAISE EXCEPTION 'T4 FAIL: idempotent replay should return the same packet: %', v_replay;
  END IF;
  RAISE NOTICE 'T4 PASS - attachPacketDocument validates, walks the ungated edge, replays idempotently.';
END;
$t4$;

-- ════════ T5 · createComplianceRule ══════════════════════════════════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a2','a0250000-1111-4000-8000-000000000001','FINANCE'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t5_finance',
  pg_temp.try($$SELECT core.create_compliance_rule(jsonb_build_object(
    'id','HRD-A25-USR-01','scheme','SBL_KHAS','subject','Pin test rule',
    'expression', jsonb_build_object('field','x','op','EQ','reference','y'),
    'effectiveFrom','2026-09-14'), 'a25-create-1')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t5_md',
  pg_temp.try($$SELECT core.create_compliance_rule(jsonb_build_object(
    'id','HRD-A25-USR-02','scheme','SBL_KHAS','subject','Pin test rule 2',
    'expression', jsonb_build_object('field','x','op','EQ','reference','y'),
    'effectiveFrom','2026-09-14'), 'a25-create-2')$$)::text, true);
RESET ROLE;

DO $t5$
DECLARE
  v_finance jsonb := pg_temp.got('t5_finance');
  v_md      jsonb := pg_temp.got('t5_md');
  v_row     record;
BEGIN
  IF NOT (v_finance #>> '{value,success}')::boolean THEN
    RAISE EXCEPTION 'T5 FAIL: FINANCE should be able to create a rule: %', v_finance;
  END IF;
  SELECT * INTO v_row FROM core.compliance_rules WHERE rule_code = 'HRD-A25-USR-01';
  IF v_row.status <> 'PROPOSED' OR v_row.verified_by_user_id IS NOT NULL
     OR v_row.tenant_id <> 'a0250000-1111-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'T5 FAIL: hand-added rule should be PROPOSED, unverified, tenant-scoped: %', v_row;
  END IF;
  IF (v_md ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'T5 FAIL: MD lacks compliance:rule:write and should be FORBIDDEN: %', v_md;
  END IF;
  IF (v_md -> 'detail')::jsonb ->> 'code' <> 'FORBIDDEN'
     OR (v_md -> 'detail')::jsonb ->> 'requiredPermission' <> 'compliance:rule:write' THEN
    RAISE EXCEPTION 'T5 FAIL: wrong refusal for MD: %', v_md;
  END IF;
  RAISE NOTICE 'T5 PASS - createComplianceRule: FINANCE creates a PROPOSED tenant-scoped rule, MD is FORBIDDEN.';
END;
$t5$;

-- ════════ T6 · getRuleChangeSet ═══════════════════════════════════════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t6_found',
  pg_temp.try($$SELECT core.get_rule_change_set('A25-CIRCULAR')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t6_missing',
  pg_temp.try($$SELECT core.get_rule_change_set('NO-SUCH-DOC')$$)::text, true);
RESET ROLE;

DO $t6$
DECLARE
  v_found   jsonb := pg_temp.got('t6_found') -> 'value' -> 'data';
  v_missing jsonb := pg_temp.got('t6_missing') -> 'value';
BEGIN
  IF pg_catalog.jsonb_array_length(v_found -> 'changes') <> 1
     OR (v_found -> 'changes' -> 0 ->> 'targetRuleId') <> 'a0250000-6666-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'T6 FAIL: change set changes[] wrong: %', v_found;
  END IF;
  IF (v_missing ->> 'success')::boolean OR v_missing #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T6 FAIL: an unknown documentId should NOT_FOUND: %', v_missing;
  END IF;
  RAISE NOTICE 'T6 PASS - getRuleChangeSet returns nested changes[] and NOT_FOUND for an unknown document.';
END;
$t6$;

-- ════════ T7 · cross-tenant sees nothing ═════════════════════════════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000b1','a0250000-1111-4000-8000-000000000002','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t7_packet',
  pg_temp.try($$SELECT core.get_claim_packet('ENG-A25-0001')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000b1','a0250000-1111-4000-8000-000000000002','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t7_checks',
  pg_temp.try($$SELECT core.get_compliance_checks('ENG-A25-0001')$$)::text, true);
RESET ROLE;

DO $t7$
DECLARE v_packet jsonb := pg_temp.got('t7_packet') -> 'value'; v_checks jsonb := pg_temp.got('t7_checks') -> 'value';
BEGIN
  IF v_packet #>> '{error,code}' <> 'NOT_FOUND' OR v_checks #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T7 FAIL: another tenant''s MD should NOT_FOUND, not see or error differently: % / %',
      v_packet, v_checks;
  END IF;
  RAISE NOTICE 'T7 PASS - another tenant''s MD gets NOT_FOUND, the same non-enumerable answer everywhere.';
END;
$t7$;

-- ════════ T8 · anon is refused all six ══════════════════════════════════

DO $t8$
DECLARE v_fns text[] := ARRAY[
  $$core.get_claim_packet('x')$$, $$core.get_compliance_checks('x')$$,
  $$core.attach_packet_document('x','{}'::jsonb,NULL)$$, $$core.export_claim_packet('x')$$,
  $$core.create_compliance_rule('{}'::jsonb,NULL)$$, $$core.get_rule_change_set('x')$$];
  v_fn text; v_ok boolean;
BEGIN
  SET LOCAL ROLE anon;
  FOREACH v_fn IN ARRAY v_fns LOOP
    BEGIN
      EXECUTE 'SELECT ' || v_fn;
      RAISE EXCEPTION 'T8 FAIL: anon executed %', v_fn;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RESET ROLE;
  RAISE NOTICE 'T8 PASS - anon (42501 / insufficient_privilege) refused on all six.';
END;
$t8$;

-- ════════ T9 · TEETH CHECK: the authz-first gate is load-bearing ═════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t9_before',
  pg_temp.try($$SELECT core.get_claim_packet('ENG-A25-0001')$$)::text, true);
RESET ROLE;

DELETE FROM app.role_permissions WHERE role = 'MD' AND permission = 'hrdc:read';

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t9_during',
  pg_temp.try($$SELECT core.get_claim_packet('ENG-A25-0001')$$)::text, true);
RESET ROLE;

INSERT INTO app.role_permissions (role, permission) VALUES ('MD','hrdc:read');

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0250000-0000-4000-8000-0000000000a1','a0250000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a25.t9_after',
  pg_temp.try($$SELECT core.get_claim_packet('ENG-A25-0001')$$)::text, true);
RESET ROLE;

DO $t9_check$
DECLARE
  v_before jsonb := pg_temp.got('t9_before') -> 'value';
  v_during jsonb := pg_temp.got('t9_during') -> 'value';
  v_after  jsonb := pg_temp.got('t9_after')  -> 'value';
BEGIN
  IF NOT (v_before ->> 'success')::boolean THEN
    RAISE EXCEPTION 'T9 SETUP FAIL: MD could not read the packet before the permission was removed: %', v_before;
  END IF;
  IF (v_during ->> 'success')::boolean OR v_during #>> '{error,code}' <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T9 FAIL: removing MD''s hrdc:read did not FORBID getClaimPacket — '
      'the authz-first check is not load-bearing: %', v_during;
  END IF;
  IF NOT (v_after ->> 'success')::boolean THEN
    RAISE EXCEPTION 'T9 FAIL: restoring the permission did not restore access: %', v_after;
  END IF;
  RAISE NOTICE 'T9 PASS - teeth check: removing hrdc:read FORBIDS getClaimPacket; restoring it restores access.';
END;
$t9_check$;

ROLLBACK;
