-- ============================================================================
-- PIN 009 · compliance_rules_checks_hrdc
-- ============================================================================
--
-- Run only AFTER 009. Ends in ROLLBACK.
--   psql "$DATABASE_URL" -f supabase/tests/test_009_compliance_rules_checks_hrdc.sql
--
-- WHAT THIS PIN IS FOR. The registry is bitemporal, and the whole value of that
-- is a question with exactly one answer:
--
--   T3  "WHICH LEAD-TIME RULE APPLIED ON 12 NOVEMBER 2026, AS KNOWN ON 28
--       OCTOBER?" The fixture is DECISIONS §3's real situation: a 3-day public
--       lead time in force from 15 Jun 2026, superseded by a 14-day rule from
--       1 Jan 2027, where the SECOND rule was only KNOWN from 8 November. A
--       check run in October must still resolve the 3-day rule, and a check run
--       in December must resolve it too for a November training date. A registry
--       with only one time axis gets the October answer wrong and calls the
--       original assessment a mistake.
--   T4  The exclusion constraint refuses a genuinely ambiguous pair, and allows
--       the three pairs that are NOT ambiguous — different validity, different
--       known, different family. A constraint that refused those would make the
--       registry unusable, and it is the easier mistake to make.
--   T6  A packet cannot be marked SUBMITTED while incomplete. That is contract
--       §9's 422 expressed where an application cannot route around it.
--
-- RUNNABILITY NOTES
-- 1. Runs as the migration role; RLS forced, no policies until 014.
-- 2. `core.compliance_rules` and `core.rule_set_versions` have a NULLABLE
--    tenant_id (Template E), so they are NOT finalised and their RLS posture is
--    asserted separately in T1.
-- 3. Fixture ids namespaced `00000009-`.
-- 4. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

-- ── GOV-07 fixture helper (added 2026-09-13, when 011 landed) ───────────────
-- Migration 011 attaches app.enforce_state_transition to every gated column in
-- doc 01 §5.3. A gated edge may be crossed only by the effect applier of an
-- action of a gating type, running against THAT row: 011 closed critic finding
-- H-07 by checking the request's status, its target_id and its tenant, so a
-- fixture that sets only the GUC is still refused, and correctly.
--
-- This helper does what the product's executor does — it creates the action
-- request and publishes it as the applier — so the fixture crosses the edge the
-- way a real caller does instead of going around the control it is sitting
-- next to. It lives in pg_temp and the pin's closing ROLLBACK removes it.
CREATE FUNCTION pg_temp.gate(p_tenant uuid, p_type text, p_target uuid)
RETURNS void LANGUAGE plpgsql AS $gate$
DECLARE v_id uuid;
BEGIN
  INSERT INTO core.action_requests
    (tenant_id, action_type, target_id, status, requested_by_kind, requested_by_id)
  VALUES (p_tenant, p_type, p_target, 'EXECUTING', 'SYSTEM', 'pin-fixture')
  RETURNING id INTO v_id;
  PERFORM set_config('app.effect_applier', v_id::text, true);
END $gate$;

-- Clear the applier. Every gated write is bracketed, so a later assertion that
-- a gated edge is REFUSED cannot pass by accident on a stale applier.
CREATE FUNCTION pg_temp.ungate() RETURNS void LANGUAGE plpgsql AS $ungate$
BEGIN
  PERFORM set_config('app.effect_applier', '', true);
END $ungate$;

-- A compliance rule is not insertable ACTIVE. core.state_transitions allows
-- (new) -> PROPOSED, then PROPOSED -> ACTIVE gated by RULE_CHANGE_APPROVE, which
-- is doc 01 §5.3 and is the point: 009 already refuses to let a rule go ACTIVE
-- without a named verifier, and 011 adds that somebody must have RUN the action
-- that promoted it. This pin used to type ACTIVE into the INSERT.
--
-- Rules are NATIONAL by default (tenant_id NULL). core.action_requests.tenant_id
-- is NOT NULL, so the request is attributed to the fixture's tenant; 011's gate
-- skips the tenant equality for a national row precisely because the question
-- has no answer there. See the comment in app.enforce_state_transition.
--
-- Activation is PER RULE, not in bulk, because two of this pin's assertions are
-- about a rule that must FAIL to activate -- the unverified one (T2) and the
-- bitemporally ambiguous one (T4a). The GiST exclusion is `WHERE status IN
-- (ACTIVE, SUPERSEDED)`, so it no longer fires on the INSERT; it fires here, on
-- the edge that actually makes a second rule authoritative for the same family
-- over the same two time windows. That is a better place for it to fire.
CREATE FUNCTION pg_temp.activate_rule(p_tenant uuid, p_id uuid)
RETURNS void LANGUAGE plpgsql AS $act$
BEGIN
  PERFORM pg_temp.gate(p_tenant, 'RULE_CHANGE_APPROVE', p_id);
  UPDATE core.compliance_rules SET status = 'ACTIVE' WHERE id = p_id;
  PERFORM pg_temp.ungate();
END $act$;


SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_009 SETUP FAILURE: check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF to_regclass('core.compliance_rules') IS NULL THEN
    RAISE EXCEPTION 'test_009 SETUP FAILURE: 009 is missing or partial.';
  END IF;
END;
$setup$;

INSERT INTO auth.users (id, email) VALUES
  ('00000009-0000-0000-0000-0000000000a1','t009-jason@example.invalid');
INSERT INTO public.tenants (id, slug, name) VALUES
  ('00000009-1111-1111-1111-111111111111','t009-alpha','Alpha');

-- ACT is the action-envelope ref prefix. 011 gives core.action_requests a ref
-- through app.finalise_table, so any fixture that crosses a GATED edge must be
-- able to allocate one. It is seeded HERE rather than with the rest of the
-- formats further down, because the first gated write in this pin is T2's rule
-- activation and that runs long before T7's fixture block. In the product these
-- rows come from 016's tenant provisioning; no migration seeds them.
INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width) VALUES
  ('00000009-1111-1111-1111-111111111111','ACT','action_requests',false,4)
  -- ⚠ 016 now provisions every tenant's ref_formats from an AFTER INSERT trigger
  -- on public.tenants, so this fixture collides with the real thing. The pin's
  -- own shape wins: it is a fixture inside a transaction that rolls back, and
  -- the assertions below were written against these exact values.
  ON CONFLICT (tenant_id, prefix)
    DO UPDATE SET entity = EXCLUDED.entity,
                  dated  = EXCLUDED.dated,
                  width  = EXCLUDED.width;

INSERT INTO core.rule_set_versions (id, tenant_id, version_key, registry_asof) VALUES
  ('00000009-0aaa-0aaa-0aaa-0aaaaaaaaaa1', NULL,'rs_2026_06_15','2026-06-15T00:00:00+08:00'),
  ('00000009-0aaa-0aaa-0aaa-0aaaaaaaaaa2', NULL,'rs_2026_11_08','2026-11-08T00:00:00+08:00');

-- === T1 · the two nullable-tenant tables are still RLS-forced ===============
--     They skip finalise_table, which is exactly why they are checked by name.
DO $t1$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c
  WHERE c.oid IN ('core.compliance_rules'::regclass,'core.rule_set_versions'::regclass)
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  ASSERT v_bad IS NULL,
    format('T1a FAIL: nullable-tenant table(s) not RLS-forced: %s. These two skip '
           'finalise_table and are the ones most likely to be missed.', v_bad);
  -- ⚠ AMENDED BY 014 (2026-09-13). Was: authenticated must NOT hold SELECT
  -- "before 014 grants it". 014 has granted it, so the assertion is inverted to
  -- the property that actually protects the registry — the grant exists AND the
  -- policy admits the national row (tenant_id IS NULL) as well as the tenant's
  -- own. A grant with a tenant-only predicate would hide the entire national HRD
  -- Corp registry from every tenant while looking perfectly correct.
  ASSERT has_table_privilege('authenticated','core.compliance_rules','SELECT'),
    'T1b FAIL: authenticated cannot read compliance_rules. 014 grants it; without '
    'the grant every compliance screen in the product is empty.';
  ASSERT NOT has_table_privilege('authenticated','core.compliance_rules','UPDATE')
     AND NOT has_table_privilege('authenticated','core.compliance_rules','INSERT')
     AND NOT has_table_privilege('authenticated','core.compliance_rules','DELETE'),
    'T1b2 FAIL: authenticated holds a WRITE privilege on compliance_rules. A rule '
    'is changed through the action envelope and a review, never by a client.';
  ASSERT (SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
            FROM pg_catalog.pg_policy pol
           WHERE pol.polrelid = 'core.compliance_rules'::regclass
             AND pol.polname = 'compliance_rules_tenant_select') LIKE '%IS NULL%',
    'T1b3 FAIL: the compliance_rules read policy does not admit tenant_id IS NULL, '
    'so every national rule is invisible to every tenant — which is the whole '
    'registry, silently.';
  RAISE NOTICE 'T1 PASS - both nullable-tenant tables are RLS-forced and ungranted.';
END;
$t1$;

-- === T2 · a rule cannot go ACTIVE without a named verifier ==================
DO $t2$
BEGIN
  BEGIN
    INSERT INTO core.compliance_rules (id, rule_code, family_key, check_key, side, subject,
      subject_field, op, reference_kind, reference, effective_from, status)
    VALUES ('00000009-0bad-0bad-0bad-0badbadbad01',
            'HRD-BAD','LEAD_TIME_PUBLIC','CHK_LEAD_TIME','GRANT','Public lead time',
            'training_start','GTE','FIELD','grant_approval','2026-06-15','PROPOSED');
    PERFORM pg_temp.activate_rule('00000009-1111-1111-1111-111111111111','00000009-0bad-0bad-0bad-0badbadbad01');
    RAISE EXCEPTION
      'T2 FAIL: a rule went ACTIVE with no verifier. DECISIONS §3 loads every seeded '
      'rule as PROPOSED until Finance checks it against the circular - this is where '
      'a model-extracted rule silently becomes compliance policy.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T2 PASS - ACTIVE requires a named verifier and a timestamp.';
END;
$t2$;

-- === T3 · THE BITEMPORAL QUESTION ===========================================
--     DECISIONS §3's real situation, with the second rule known only from
--     8 November.
DO $t3$
DECLARE r record; v_n int;
BEGIN
  -- 3-day public lead time, in force 15 Jun 2026 -> 31 Dec 2026, known from 15 Jun.
  INSERT INTO core.compliance_rules (id, rule_code, family_key, check_key, side, scheme,
    delivery_mode, subject, subject_field, op, reference_kind, reference, offset_amount,
    effective_from, effective_to, registry_from, status, verified_by_user_id, verified_at)
  VALUES ('00000009-0bbb-0bbb-0bbb-0bbbbbbbbbb1','HRD-015','LEAD_TIME_PUBLIC','CHK_LEAD_TIME',
          'GRANT', NULL,'PUBLIC','Public lead time','training_start','GTE','FIELD',
          'grant_approval', 3,'2026-06-15','2027-01-01','2026-06-15T00:00:00+08:00',
          'PROPOSED','00000009-0000-0000-0000-0000000000a1','2026-06-20T00:00:00+08:00');
  PERFORM pg_temp.activate_rule('00000009-1111-1111-1111-111111111111','00000009-0bbb-0bbb-0bbb-0bbbbbbbbbb1');

  -- 14-day revision, in force from 1 Jan 2027 - but only KNOWN from 8 November,
  -- when Circular 09/2026 was ingested.
  INSERT INTO core.compliance_rules (id, rule_code, family_key, check_key, side, scheme,
    delivery_mode, subject, subject_field, op, reference_kind, reference, offset_amount,
    effective_from, registry_from, status, supersedes_rule_id,
    verified_by_user_id, verified_at)
  VALUES ('00000009-0bbb-0bbb-0bbb-0bbbbbbbbbb2','HRD-022','LEAD_TIME_PUBLIC','CHK_LEAD_TIME',
          'GRANT', NULL,'PUBLIC','Public lead time (revised)','training_start','GTE','FIELD',
          'grant_approval', 14,'2027-01-01','2026-11-08T00:00:00+08:00',
          'PROPOSED','00000009-0bbb-0bbb-0bbb-0bbbbbbbbbb1',
          '00000009-0000-0000-0000-0000000000a1','2026-11-10T00:00:00+08:00');
  PERFORM pg_temp.activate_rule('00000009-1111-1111-1111-111111111111','00000009-0bbb-0bbb-0bbb-0bbbbbbbbbb2');

  -- (a) a check run on 28 October, for a 12 November training date: the 14-day
  --     rule did not exist yet, so it must resolve the 3-day one.
  SELECT * INTO r FROM core.resolve_rules(
    '00000009-1111-1111-1111-111111111111',
    '2026-10-28T00:00:00+08:00'::timestamptz, '2026-11-12'::date,
    'GRANT','PUBLIC','SBL_KHAS');
  ASSERT r.rule_code = 'HRD-015',
    format('T3a FAIL: a check run on 28 October resolved %s. The 14-day rule was not '
           'known until 8 November; resolving it re-decides an October assessment '
           'against a November registry and calls the original wrong.', r.rule_code);
  ASSERT r.offset_amount = 3, format('T3a2 FAIL: offset is %s, expected 3', r.offset_amount);

  -- (b) the SAME training date, re-checked in December. The 14-day rule is now
  --     known, but it does not take effect until January, so 3 days still applies.
  SELECT * INTO r FROM core.resolve_rules(
    '00000009-1111-1111-1111-111111111111',
    '2026-12-01T00:00:00+08:00'::timestamptz, '2026-11-12'::date,
    'GRANT','PUBLIC','SBL_KHAS');
  ASSERT r.rule_code = 'HRD-015',
    format('T3b FAIL: a December re-check of a NOVEMBER training date resolved %s. '
           'Knowing about a January rule does not make it apply in November.', r.rule_code);

  -- (c) a January training date, checked in December: now the 14-day rule applies.
  SELECT * INTO r FROM core.resolve_rules(
    '00000009-1111-1111-1111-111111111111',
    '2026-12-01T00:00:00+08:00'::timestamptz, '2027-01-15'::date,
    'GRANT','PUBLIC','SBL_KHAS');
  ASSERT r.rule_code = 'HRD-022' AND r.offset_amount = 14,
    format('T3c FAIL: a January training date resolved %s / %s days, expected HRD-022 / 14',
           r.rule_code, r.offset_amount);

  -- (d) exactly one rule per family, always. Two would make the check ambiguous.
  SELECT count(*) INTO v_n FROM core.resolve_rules(
    '00000009-1111-1111-1111-111111111111',
    '2026-12-01T00:00:00+08:00'::timestamptz, '2026-11-12'::date,
    'GRANT','PUBLIC','SBL_KHAS');
  ASSERT v_n = 1, format('T3d FAIL: resolver returned %s rules for one family', v_n);

  RAISE NOTICE
    'T3 PASS - Oct check -> 3 days, Dec re-check of a Nov date -> 3 days, Jan date -> 14 days.';
END;
$t3$;

-- === T4 · the exclusion constraint refuses ambiguity and permits the rest ====
DO $t4$
DECLARE v_rule uuid;
BEGIN
  -- ambiguous: same family, mode, scheme, overlapping on BOTH axes
  BEGIN
    INSERT INTO core.compliance_rules (id, rule_code, family_key, check_key, side, scheme,
      delivery_mode, subject, subject_field, op, reference_kind, reference, offset_amount,
      effective_from, effective_to, registry_from, status, verified_by_user_id, verified_at)
    VALUES ('00000009-0d00-0d00-0d00-0d0dddddd001',
            'HRD-DUP','LEAD_TIME_PUBLIC','CHK_LEAD_TIME','GRANT', NULL,'PUBLIC',
            'Conflicting','training_start','GTE','FIELD','grant_approval', 7,
            '2026-08-01','2026-12-01','2026-08-01T00:00:00+08:00','PROPOSED',
            '00000009-0000-0000-0000-0000000000a1', now());
    PERFORM pg_temp.activate_rule('00000009-1111-1111-1111-111111111111','00000009-0d00-0d00-0d00-0d0dddddd001');
    RAISE EXCEPTION
      'T4a FAIL: two rules overlap on BOTH time axes for one family. "Which rule '
      'applied" now depends on which row the planner reads first.';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  -- NOT ambiguous: a different family
  INSERT INTO core.compliance_rules (rule_code, family_key, check_key, side, scheme,
    delivery_mode, subject, subject_field, op, reference_kind, reference, offset_amount,
    effective_from, registry_from, status, verified_by_user_id, verified_at)
  VALUES ('HRD-014','LEAD_TIME_INHOUSE','CHK_LEAD_TIME','GRANT', NULL,'IN_HOUSE',
          'In-house lead time','training_start','GTE','FIELD','grant_approval', 14,
          '2026-06-15','2026-06-15T00:00:00+08:00','PROPOSED',
          '00000009-0000-0000-0000-0000000000a1', now())
  RETURNING id INTO v_rule;
  PERFORM pg_temp.activate_rule('00000009-1111-1111-1111-111111111111', v_rule);

  -- NOT ambiguous: same family, non-overlapping validity
  INSERT INTO core.compliance_rules (rule_code, family_key, check_key, side, scheme,
    delivery_mode, subject, subject_field, op, reference_kind, reference, offset_amount,
    effective_from, effective_to, registry_from, status, verified_by_user_id, verified_at)
  VALUES ('HRD-009','LEAD_TIME_PUBLIC','CHK_LEAD_TIME','GRANT', NULL,'PUBLIC',
          'Older public lead time','training_start','GTE','FIELD','grant_approval', 2,
          '2025-01-01','2026-06-15','2025-01-01T00:00:00+08:00','PROPOSED',
          '00000009-0000-0000-0000-0000000000a1', now())
  RETURNING id INTO v_rule;
  PERFORM pg_temp.activate_rule('00000009-1111-1111-1111-111111111111', v_rule);

  -- NOT ambiguous: a TENANT OVERRIDE of a national family
  INSERT INTO core.compliance_rules (tenant_id, rule_code, family_key, check_key, side,
    scheme, delivery_mode, subject, subject_field, op, reference_kind, reference,
    offset_amount, effective_from, effective_to, registry_from, status,
    verified_by_user_id, verified_at)
  VALUES ('00000009-1111-1111-1111-111111111111','HRD-015-LOCAL','LEAD_TIME_PUBLIC',
          'CHK_LEAD_TIME','GRANT', NULL,'PUBLIC','Stricter local policy',
          'training_start','GTE','FIELD','grant_approval', 21,
          '2026-06-15','2027-01-01','2026-06-15T00:00:00+08:00','PROPOSED',
          '00000009-0000-0000-0000-0000000000a1', now())
  RETURNING id INTO v_rule;
  PERFORM pg_temp.activate_rule('00000009-1111-1111-1111-111111111111', v_rule);

  RAISE NOTICE
    'T4 PASS - ambiguity refused; different family, different validity and a tenant '
    'override all permitted.';
END;
$t4$;

-- === T5 · a tenant override BEATS the national rule =========================
DO $t5$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM core.resolve_rules(
    '00000009-1111-1111-1111-111111111111',
    '2026-10-28T00:00:00+08:00'::timestamptz, '2026-11-12'::date,
    'GRANT','PUBLIC','SBL_KHAS');
  ASSERT r.rule_code = 'HRD-015-LOCAL',
    format('T5a FAIL: the tenant''s own stricter rule did not win; got %s', r.rule_code);

  -- and another tenant still sees the national one
  SELECT * INTO r FROM core.resolve_rules(
    '00000009-2222-2222-2222-222222222222',
    '2026-10-28T00:00:00+08:00'::timestamptz, '2026-11-12'::date,
    'GRANT','PUBLIC','SBL_KHAS');
  ASSERT r.rule_code = 'HRD-015',
    format('T5b FAIL: another tenant resolved %s - a local override leaked across '
           'the estate', r.rule_code);
  RAISE NOTICE 'T5 PASS - a tenant override wins locally and nowhere else.';
END;
$t5$;

-- === T6 · a packet cannot be SUBMITTED while incomplete =====================
DO $t6$
DECLARE v_org uuid; v_eng uuid; v_pkt uuid;
BEGIN
  INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width)
  SELECT '00000009-1111-1111-1111-111111111111', p, e, false, 4
  FROM (VALUES ('ORG','organisations'),('PRG','programmes'),('PIP','pipelines'),
               ('ENG','engagements'),('HPK','hrdc_packets'),
               ('SRC','knowledge_sources')) AS x(p,e)
  ON CONFLICT DO NOTHING;
-- ACT is the action-envelope ref prefix. 011 gives core.action_requests a
-- ref through app.finalise_table, so any fixture that crosses a GATED edge
-- must be able to allocate one. In the product these rows come from 016's
-- tenant provisioning; no migration seeds them.

  INSERT INTO core.organisations (tenant_id, name, owner_id)
  VALUES ('00000009-1111-1111-1111-111111111111','Aurora','00000009-0000-0000-0000-0000000000a1')
  RETURNING id INTO v_org;
  INSERT INTO core.programmes (tenant_id, name, category, days, list_price_sen,
                               list_price_pax, floor_price_sen, floor_margin_rate)
  VALUES ('00000009-1111-1111-1111-111111111111','P','C',1,100000,10,90000,0.35);
  INSERT INTO core.pipelines (tenant_id, object, name, is_default)
  VALUES ('00000009-1111-1111-1111-111111111111','ENGAGEMENT','std', true);

  INSERT INTO core.engagements (tenant_id, organisation_id, programme_id, owner_id,
                                pipeline_id, title)
  SELECT '00000009-1111-1111-1111-111111111111', v_org, p.id,
         '00000009-0000-0000-0000-0000000000a1', pl.id, 'E'
  FROM core.programmes p, core.pipelines pl
  WHERE p.tenant_id = '00000009-1111-1111-1111-111111111111'
    AND pl.tenant_id = '00000009-1111-1111-1111-111111111111'
  RETURNING id INTO v_eng;

  INSERT INTO core.hrdc_packets (tenant_id, engagement_id, organisation_id, scheme,
                                 employer_code, claim_value_sen, completeness)
  VALUES ('00000009-1111-1111-1111-111111111111', v_eng, v_org,'SBL_KHAS',
          'HRDC-2201-8834', 1850000, 0.620)
  RETURNING id INTO v_pkt;

  -- A packet is INSERTed DRAFT and reaches SUBMITTED through READY; the last
  -- edge is gated by HRDC_PACKET_MARK_SUBMITTED. This pin used to jump straight
  -- from DRAFT, which 011's GOV-07 gate now refuses. T6a's subject is unchanged:
  -- an incomplete packet must still be refused, and it is refused on the edge
  -- that actually files the claim.
  UPDATE core.hrdc_packets SET status = 'READY' WHERE id = v_pkt;  -- DRAFT -> READY

  PERFORM pg_temp.gate('00000009-1111-1111-1111-111111111111','HRDC_PACKET_MARK_SUBMITTED', v_pkt);
  BEGIN
    UPDATE core.hrdc_packets
       SET status = 'SUBMITTED', claim_reference = 'CLM-2026-118834',
           claim_submitted_at = now()
     WHERE id = v_pkt;
    RAISE EXCEPTION
      'T6a FAIL: a packet at 62%% completeness was marked SUBMITTED. That is the '
      'contract''s 422 VALIDATION_FAILED, and it just got routed around.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- complete, with a reference: permitted
  UPDATE core.hrdc_packets
     SET completeness = 1, status = 'SUBMITTED', claim_reference = 'CLM-2026-118834',
         claim_submitted_at = now()
   WHERE id = v_pkt;
  PERFORM pg_temp.ungate();

  -- a document marked PRESENT with nothing behind it is how a packet reaches
  -- completeness 1.0 empty
  BEGIN
    INSERT INTO core.hrdc_document_types (tenant_id, document_type, label)
    VALUES ('00000009-1111-1111-1111-111111111111','TAX_INVOICE','Tax invoice');
    INSERT INTO core.hrdc_packet_documents (tenant_id, hrdc_packet_id, document_type, status)
    VALUES ('00000009-1111-1111-1111-111111111111', v_pkt,'TAX_INVOICE','PRESENT');
    RAISE EXCEPTION 'T6b FAIL: a document was marked PRESENT with nothing behind it';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T6 PASS - incomplete packets cannot be submitted; PRESENT needs evidence.';
END;
$t6$;

-- === T7 · a changed knowledge source is quarantined =========================
DO $t7$
BEGIN
  BEGIN
    INSERT INTO core.knowledge_sources (tenant_id, name, monitor_status, quarantined)
    VALUES ('00000009-1111-1111-1111-111111111111','Circular 09/2026',
            'CHANGED_REVIEW_PENDING', false);
    RAISE EXCEPTION
      'T7 FAIL: a CHANGED source was left unquarantined. Contract §17 quarantines it '
      'from rule extraction until reviewed, and quarantine is a column the retriever '
      'reads rather than a status string it has to interpret correctly.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T7 PASS - a changed source is quarantined by construction.';
END;
$t7$;

-- === T8 · a low-confidence rule change is withheld from the diff ============
DO $t8$
DECLARE v_set uuid;
BEGIN
  INSERT INTO core.rule_change_sets (tenant_id, document_id, title)
  VALUES ('00000009-1111-1111-1111-111111111111','DOC-0219','Circular 09/2026')
  RETURNING id INTO v_set;

  BEGIN
    INSERT INTO core.rule_changes (tenant_id, rule_change_set_id, change_key, op,
                                   confidence, withheld)
    VALUES ('00000009-1111-1111-1111-111111111111', v_set,'chg_1','MODIFY', 0.610, false);
    RAISE EXCEPTION
      'T8 FAIL: a 0.61-confidence change was shown in the diff. Contract §17 withholds '
      'anything under 0.80 and flags it for manual transcription.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO core.rule_changes (tenant_id, rule_change_set_id, change_key, op,
                                 confidence, withheld)
  VALUES ('00000009-1111-1111-1111-111111111111', v_set,'chg_2','SUPERSEDE', 0.940, false);
  RAISE NOTICE 'T8 PASS - below 0.80 is withheld; 0.94 is shown.';
END;
$t8$;

-- === T9 · drift must cite two DIFFERENT versions ============================
DO $t9$
DECLARE v_res uuid; v_eng uuid;
BEGIN
  SELECT id INTO v_eng FROM core.engagements
  WHERE tenant_id = '00000009-1111-1111-1111-111111111111' LIMIT 1;

  INSERT INTO core.compliance_check_results (tenant_id, engagement_id, check_key, state,
    label, rule_set_version_id, rule_side, rules_as_of, basis)
  VALUES ('00000009-1111-1111-1111-111111111111', v_eng,'CHK_LEAD_TIME','PASS',
          'Application lead time','00000009-0aaa-0aaa-0aaa-0aaaaaaaaaa1','GRANT',
          '2026-10-28','GRANT_SUBMITTED')
  RETURNING id INTO v_res;

  BEGIN
    INSERT INTO core.compliance_version_drifts (tenant_id, compliance_check_result_id,
      applied_version_id, current_version_id, message)
    VALUES ('00000009-1111-1111-1111-111111111111', v_res,
            '00000009-0aaa-0aaa-0aaa-0aaaaaaaaaa1','00000009-0aaa-0aaa-0aaa-0aaaaaaaaaa1',
            'same version twice');
    RAISE EXCEPTION 'T9 FAIL: a drift row cited the same version twice, which is not a drift';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO core.compliance_version_drifts (tenant_id, compliance_check_result_id,
    applied_version_id, current_version_id, severity, message)
  VALUES ('00000009-1111-1111-1111-111111111111', v_res,
          '00000009-0aaa-0aaa-0aaa-0aaaaaaaaaa1','00000009-0aaa-0aaa-0aaa-0aaaaaaaaaa2',
          'WARN','Applied 3-day public lead time in force at submission; 14 days applies from 1 Jan 2027.');
  RAISE NOTICE 'T9 PASS - a drift cites two different versions, per DECISIONS 6.';
END;
$t9$;

DO $done$
BEGIN
  RAISE NOTICE 'test_009 ALL PASS (T1-T9, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
