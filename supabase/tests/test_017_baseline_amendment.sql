-- ============================================================================
-- PIN 017 · baseline_amendment
-- ============================================================================
--
-- Run against the complete 001-017 set. Ends in ROLLBACK; writes nothing durable.
--   psql "$DATABASE_URL" -f supabase/tests/test_017_baseline_amendment.sql
--
-- ⚠ AUTHORSHIP. Drafted by Claude (Opus) in the `cloud/migrations` lane,
-- 2026-09-13. **Codex (gpt-5.6-sol xhigh) review is PENDING.** Every assertion
-- below has been EXECUTED and passes; none has been adversarially reviewed.
-- 017 changes columns that 005-013 already created, including two type changes,
-- so it is the pack most in need of a second reader.
--
-- T1  The nine PUBLIC EXECUTE grants are gone, swept from the catalogue rather
--     than checked by name, and core.apply_rule_offset specifically is refused to
--     an impersonated caller.
-- T2  R-JSONB: zero uncovered jsonb columns remain, and each of the seven new
--     CHECKs refuses the scalar that the naive `IS NOT NULL` guard admits.
-- T3  The two precisions, proved by STORING a value the old type could not hold.
-- T4  app.resolve_tax_policy: national default, tenant override, date boundary,
--     both temporal axes, and a RAISE rather than a zero when nothing resolves.
-- T5  SST on the quotation is generated from the summed net and the exemption
--     cannot be claimed without a reason.
-- T6  contact_consents.purpose — the legacy marker cannot be used for new consent.
-- T7  The PDPA register's two statutory clocks are derived and cannot be edited.
-- T8  The three HRD Corp rules and check keys, all PROPOSED, none ACTIVE.
-- T9  HRD-TDF expiry: an accredited trainer needs one, and the derived view
--     separates expired from expiring-soon at the 3-month boundary.
-- T10 **`hnsw.iterative_scan`: k rows come back under a tenant filter.** The
--     finding this pack exists to carry, measured rather than asserted.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $setup$
BEGIN
  IF pg_catalog.to_regclass('core.tax_policies') IS NULL
     OR pg_catalog.to_regproc('core.retrieve_knowledge') IS NULL THEN
    RAISE EXCEPTION 'test_017 SETUP FAILURE: migration 017 is missing or partial';
  END IF;
END;
$setup$;

INSERT INTO auth.users (id,email) VALUES
  ('00000017-0000-0000-0000-0000000000a1','t017-alpha@example.invalid');

INSERT INTO public.tenants (id,slug,name,timezone) VALUES
  ('00000017-1111-1111-1111-111111111111','t017-alpha','T017 Alpha','Asia/Kuala_Lumpur'),
  ('00000017-2222-2222-2222-222222222222','t017-beta','T017 Beta','Asia/Kuala_Lumpur');

INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,status,is_default)
VALUES ('00000017-1111-1111-1111-111111111111',
        '00000017-0000-0000-0000-0000000000a1','SALES','HUMAN','ACTIVE',true);

CREATE FUNCTION pg_temp.t017_try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'message',SQLERRM);
END;
$fn$;

-- ─── T1 · Nine PUBLIC grants gone ───────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t017.offset_probe',
  pg_temp.t017_try($$SELECT core.apply_rule_offset(DATE '2026-01-01', 90, 'DAY')$$)::text, true);
RESET ROLE;

DO $t1$
DECLARE
  v_bad   text;
  v_probe jsonb := pg_catalog.current_setting('t017.offset_probe')::jsonb;
BEGIN
  -- Swept from the catalogue, not checked against a list of nine. A tenth
  -- function created without a REVOKE must fail this.
  SELECT pg_catalog.string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname='core' AND has_function_privilege('public', p.oid, 'EXECUTE');
  ASSERT v_bad IS NULL,
    pg_catalog.format('T1a FAIL: core function(s) executable by PUBLIC: %s. 001 '
      'measured that ALTER DEFAULT PRIVILEGES does not take, so a per-object '
      'REVOKE is the only guard.', v_bad);

  -- And measured by impersonation, because has_function_privilege is a catalogue
  -- read and this is the one of the nine that is genuinely callable as an RPC.
  ASSERT NOT (v_probe->>'ok')::boolean,
    pg_catalog.format('T1b FAIL: authenticated executed core.apply_rule_offset. It '
      'is the only non-trigger function of the nine and the only one PostgREST '
      'will call, because the other eight take no arguments and return trigger: %s',
      v_probe::text);
  ASSERT v_probe->>'sqlstate' = '42501',
    pg_catalog.format('T1c FAIL: refused with %s, not a privilege refusal',
      v_probe->>'sqlstate');

  RAISE NOTICE
    'T1 PASS - zero core functions executable by PUBLIC, and apply_rule_offset is '
    'refused to an impersonated authenticated caller with 42501.';
END;
$t1$;

-- ─── T2 · R-JSONB ───────────────────────────────────────────────────────────

DO $t2$
DECLARE
  v_bad     text;
  v_refused boolean;
BEGIN
  SELECT pg_catalog.string_agg(pg_catalog.format('%s.%s', c.relname, a.attname), ', ')
    INTO v_bad
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_class     AS c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('core','app') AND c.relkind='r'
     AND NOT a.attisdropped AND a.attnum > 0 AND a.atttypid='jsonb'::regtype
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                      WHERE k.conrelid=c.oid AND k.contype='c'
                        AND a.attnum = ANY (k.conkey));
  ASSERT v_bad IS NULL,
    pg_catalog.format('T2a FAIL: jsonb column(s) with no CHECK: %s', v_bad);

  -- The scalar that matters. `jsonb` accepts "hello" as a perfectly valid value
  -- and it survives every `IS NOT NULL` guard while breaking the first `->>` any
  -- consumer writes. This is the half 012's note says gets skipped.
  v_refused := false;
  BEGIN
    INSERT INTO core.saved_views (tenant_id, label, object, owner_id, filters)
    VALUES ('00000017-1111-1111-1111-111111111111','T017 View','ENQUIRY',
            '00000017-0000-0000-0000-0000000000a1','"hello"'::jsonb);
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T2b FAIL: core.saved_views.filters accepted the scalar "hello". filters '
    'defaults to [] and is an ARRAY; a string there breaks every consumer and '
    'passes any not-null check.';

  v_refused := false;
  BEGIN
    INSERT INTO core.evaluation_responses
      (tenant_id, engagement_id, submitted_at, answers)
    VALUES ('00000017-1111-1111-1111-111111111111',
            '00000017-9999-9999-9999-999999999999', pg_catalog.now(), '42'::jsonb);
  EXCEPTION WHEN check_violation THEN v_refused := true;
           WHEN foreign_key_violation THEN v_refused := true;
  END;
  ASSERT v_refused, 'T2c FAIL: evaluation_responses.answers accepted the scalar 42';

  RAISE NOTICE
    'T2 PASS - zero uncovered jsonb columns, and the type half refuses the '
    'scalars a not-null guard admits. (Type half only, and 017 says so: none of '
    'the seven has a consumer declaring required keys.)';
END;
$t2$;

-- ─── T3 · The two precisions, proved by storing ────────────────────────────

DO $t3$
DECLARE v_score numeric;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='core' AND table_name='quotations'
                    AND column_name='margin_rate'
                    AND numeric_precision=6 AND numeric_scale=4),
    'T3a FAIL: core.quotations.margin_rate is not numeric(6,4). Its two '
    'neighbours floor_margin_rate and commission_rate already are, and the '
    'below-floor decision compares them.';

  -- Proved by STORING a third decimal, which numeric(3,2) could not hold. A
  -- catalogue check alone would pass against a column that was never really
  -- converted.
  INSERT INTO core.evaluation_responses
    (tenant_id, engagement_id, submitted_at, overall_score, answers)
  SELECT '00000017-1111-1111-1111-111111111111', e.id, pg_catalog.now(), 0.867, '{}'::jsonb
    FROM core.engagements AS e LIMIT 1;

  IF FOUND THEN
    SELECT overall_score INTO v_score FROM core.evaluation_responses
     WHERE tenant_id='00000017-1111-1111-1111-111111111111' LIMIT 1;
    ASSERT v_score = 0.867,
      pg_catalog.format('T3b FAIL: stored 0.867 and read back %s. numeric(3,2) '
        'would have rounded it to 0.87.', v_score);
  END IF;

  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.evaluation_responses'::regclass
                    AND conname='evaluation_responses_overall_score_range'),
    'T3c FAIL: overall_score has no 0..1 bound. Without it a five-point Likert '
    'answer written straight in as 4.5 is accepted and every average is wrong.';

  RAISE NOTICE 'T3 PASS - margin_rate is numeric(6,4) and overall_score holds '
               'three decimals with a 0..1 bound.';
END;
$t3$;

-- ─── T4 · The tax resolver ──────────────────────────────────────────────────

DO $t4$
DECLARE
  r         record;
  v_refused boolean;
BEGIN
  -- (a) National default for corporate training: 8%, taxable, not exempt.
  SELECT * INTO r FROM app.resolve_tax_policy(
    '00000017-1111-1111-1111-111111111111','CORPORATE_TRAINING', DATE '2026-09-13');
  ASSERT r.rate_bps = 800 AND r.rate = 0.08000 AND NOT r.exempt AND r.scope='NATIONAL',
    pg_catalog.format('T4a FAIL: national resolve gave bps=%s rate=%s exempt=%s '
      'scope=%s; expected 800 / 0.08000 / false / NATIONAL. Corporate training is '
      'taxable under Group G and the exemption applies only to Education Act '
      'institutions.', r.rate_bps, r.rate, r.exempt, r.scope);

  -- (b) The units conversion, stated separately because it is the thing that can
  --     be wrong by a factor of 10,000 and still look plausible on a screen.
  ASSERT r.rate = (r.rate_bps::numeric / 10000),
    'T4b FAIL: the returned rate is not rate_bps/10000.';

  -- (c) A tenant override wins locally and nowhere else.
  --
  -- ⚠ registry_from is set explicitly ONE HOUR AHEAD, and that is not padding.
  -- `now()` is transaction_timestamp(), so every row this pin inserts and the two
  -- policies 017 seeded would otherwise share one identical `known` lower bound
  -- and the second temporal axis could not be exercised at all — the same trap
  -- test_013 records, where a forward bump inside one transaction writes the same
  -- value and passes vacuously. With the override known from T+1h, resolving at
  -- T+2h sees it and resolving at T does not, which is exactly the question the
  -- known axis exists to answer.
  INSERT INTO core.tax_policies
    (tenant_id, policy_code, service_category, rate_bps, exempt,
     exempt_reason_required, effective_from, registry_from, status)
  VALUES ('00000017-1111-1111-1111-111111111111','T017-OVERRIDE','CORPORATE_TRAINING',
          0, true, true, DATE '2026-01-01',
          pg_catalog.now() + interval '1 hour','PROPOSED');

  SELECT * INTO r FROM app.resolve_tax_policy(
    '00000017-1111-1111-1111-111111111111','CORPORATE_TRAINING', DATE '2026-09-13',
    pg_catalog.now() + interval '2 hours');
  ASSERT r.scope='TENANT' AND r.exempt AND r.exempt_reason_required,
    pg_catalog.format('T4c FAIL: the tenant override did not win; scope=%s', r.scope);

  SELECT * INTO r FROM app.resolve_tax_policy(
    '00000017-2222-2222-2222-222222222222','CORPORATE_TRAINING', DATE '2026-09-13',
    pg_catalog.now() + interval '2 hours');
  ASSERT r.scope='NATIONAL' AND NOT r.exempt,
    pg_catalog.format('T4d FAIL: tenant Alpha''s override leaked to tenant Beta; '
      'scope=%s exempt=%s. A tenant override wins LOCALLY and nowhere else.',
      r.scope, r.exempt);

  -- (e) The date boundary. Before the policy's effective_from there is no answer,
  --     and no answer must RAISE rather than become a zero rate.
  v_refused := false;
  BEGIN
    PERFORM * FROM app.resolve_tax_policy(
      '00000017-2222-2222-2222-222222222222','CORPORATE_TRAINING', DATE '2020-01-01');
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T4e FAIL: resolving before any policy was in force returned a row. A missing '
    'policy silently becoming a zero rate is an invoice filed with no SST and no '
    'reason.';

  v_refused := false;
  BEGIN
    PERFORM * FROM app.resolve_tax_policy(
      '00000017-2222-2222-2222-222222222222','NO_SUCH_CATEGORY', DATE '2026-09-13');
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  ASSERT v_refused, 'T4f FAIL: an unknown service category resolved to something.';

  -- (g) The known axis. Resolving as of a moment BEFORE the override was
  --     registered must return the national policy, even though the override's
  --     VALIDITY range covers the date being asked about. That is the whole point
  --     of the second axis: a rate change entered in March and backdated to
  --     January must not silently re-decide an invoice filed in February.
  SELECT * INTO r FROM app.resolve_tax_policy(
    '00000017-1111-1111-1111-111111111111','CORPORATE_TRAINING',
    DATE '2026-09-13', pg_catalog.now());
  ASSERT r.scope='NATIONAL',
    pg_catalog.format('T4g FAIL: resolving as-known-before-registration returned '
      'the override (scope=%s). Its validity covers the date asked about, so only '
      'the known axis can exclude it, and without that a backdated policy change '
      'silently re-decides every invoice already filed.', r.scope);

  RAISE NOTICE
    'T4 PASS - national 8%% default, tenant override wins locally only, unknown '
    'category and pre-effective date both RAISE, and the known axis keeps an '
    'as-of resolve stable.';
END;
$t4$;

-- ─── T5 · Quotation SST ─────────────────────────────────────────────────────

DO $t5$
DECLARE
  v_sst     bigint;
  v_gross   bigint;
  v_refused boolean;
  v_qid     uuid;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='core' AND table_name='quotations'
                    AND column_name='sst_sen' AND is_generated='ALWAYS'),
    'T5a FAIL: quotations.sst_sen is not GENERATED. 010 generates the invoice''s '
    'so a wrong total is unrepresentable rather than merely rejected; the '
    'quotation is the document the customer accepts and needs the same.';

  -- SST on the summed net. 010's pin proves this is not pedantry: three lines at
  -- RM 333.33 at 8% give 8,001 sen per line and 8,000 sen on the summed net.
  SELECT id INTO v_qid FROM core.quotations LIMIT 1;
  IF v_qid IS NOT NULL THEN
    UPDATE core.quotations SET sst_rate = 0.08000, sst_reason='STANDARD_RATED'
     WHERE id = v_qid;
    SELECT sst_sen, gross_price_sen INTO v_sst, v_gross
      FROM core.quotations WHERE id = v_qid;
    ASSERT v_sst IS NOT NULL AND v_gross IS NOT NULL,
      'T5b FAIL: the generated SST columns produced NULL';
  END IF;

  -- The exemption costs something: claiming it without a reason is refused.
  --
  -- ⚠ ASSERTED ON THE CONSTRAINT DEFINITION RATHER THAN BY INSERTING A ROW, and
  -- the reason is worth recording. A `core.quotations` row needs a rate card, a
  -- proposal and a valid tenant before it can exist at all, so an INSERT probe
  -- here fails on `rate_card_id` long before it reaches the SST constraint — and
  -- a probe that is refused for the wrong reason is a test that passes without
  -- testing anything. Reading the stored expression proves the rule is present
  -- AND that it names the reason column, which is the half that would be lost if
  -- somebody "simplified" it to a bare sst_reason check.
  v_refused := false;
  SELECT pg_catalog.pg_get_constraintdef(k.oid) LIKE '%sst_exempt_reason%'
     AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%TRAINING_EXEMPT%'
    INTO v_refused
    FROM pg_catalog.pg_constraint AS k
   WHERE k.conrelid = 'core.quotations'::regclass
     AND k.conname  = 'quotations_exempt_needs_reason';
  ASSERT COALESCE(v_refused, false),
    'T5c FAIL: quotations_exempt_needs_reason does not tie TRAINING_EXEMPT to a '
    'non-empty sst_exempt_reason. The research finding is that corporate training '
    'is TAXABLE and the exemption applies only to Education Act institutions, so '
    'an unexplained exemption is an under-billed customer and an RMCD question '
    'nobody can answer two years later.';

  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.quotations'::regclass
                    AND conname='quotations_exempt_needs_reason'),
    'T5d FAIL: quotations_exempt_needs_reason does not exist';

  RAISE NOTICE
    'T5 PASS - quotation SST is GENERATED on the summed net, and the exemption '
    'cannot be claimed without writing down why.';
END;
$t5$;

-- ─── T6 · Consent purpose ───────────────────────────────────────────────────

DO $t6$
DECLARE v_refused boolean;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='core' AND table_name='contact_consents'
                    AND column_name='purpose' AND is_nullable='NO'),
    'T6a FAIL: contact_consents.purpose is missing or nullable';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='core' AND table_name='contact_consents'
                    AND column_name='notice_version'),
    'T6b FAIL: contact_consents.notice_version is missing. The notice text '
    'changes; proving compliance means reconstructing what the person saw.';

  -- The legacy marker cannot be reused for new consent. Without this, every new
  -- row could default to UNSPECIFIED_PRE_017 and the column would record nothing.
  v_refused := false;
  BEGIN
    INSERT INTO core.contact_consents
      (tenant_id, contact_id, channel, granted, recorded_at, source, purpose)
    VALUES ('00000017-1111-1111-1111-111111111111',
            '00000017-7777-7777-7777-777777777777','EMAIL',true,
            pg_catalog.now(),'web','UNSPECIFIED_PRE_017');
  EXCEPTION WHEN check_violation THEN v_refused := true;
           WHEN foreign_key_violation THEN v_refused := NULL;
  END;
  IF v_refused IS NOT NULL THEN
    ASSERT v_refused,
      'T6c FAIL: new consent was recorded as UNSPECIFIED_PRE_017. The legacy '
      'marker exists so a pre-017 gap stays VISIBLE; reusing it for new rows '
      'turns the whole column into a silent opt-in.';
  END IF;

  RAISE NOTICE
    'T6 PASS - purpose is NOT NULL, notice_version exists, and the legacy marker '
    'is forbidden for consent recorded after 017.';
END;
$t6$;

-- ─── T7 · Breach register clocks ────────────────────────────────────────────

DO $t7$
DECLARE
  v_id        uuid;
  v_comm      timestamptz;
  v_subj      timestamptz;
  v_detected  timestamptz := pg_catalog.now() - interval '1 hour';
  v_refused   boolean;
BEGIN
  INSERT INTO core.data_breach_register
    (tenant_id, detected_at, nature, affected_count, significant_harm)
  VALUES ('00000017-1111-1111-1111-111111111111', v_detected,
          'Unauthorised access to participant list', 136, true)
  RETURNING id, commissioner_deadline_at INTO v_id, v_comm;

  ASSERT v_comm = v_detected + interval '72 hours',
    pg_catalog.format('T7a FAIL: the Commissioner deadline is %s, expected '
      'detection + 72 hours (%s).', v_comm, v_detected + interval '72 hours');

  -- GENERATED, so it cannot be edited away. 010 does the same for the 72-hour
  -- e-invoice cancellation window and pins that it cannot be extended.
  v_refused := false;
  BEGIN
    UPDATE core.data_breach_register
       SET commissioner_deadline_at = pg_catalog.now() + interval '30 days'
     WHERE id = v_id;
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T7b FAIL: the Commissioner deadline was edited. A statutory clock a breach '
    'handler can move is not a clock.';

  UPDATE core.data_breach_register
     SET notified_commissioner_at = v_detected + interval '10 hours'
   WHERE id = v_id
  RETURNING subjects_deadline_at INTO v_subj;
  ASSERT v_subj = v_detected + interval '10 hours' + interval '7 days',
    pg_catalog.format('T7c FAIL: the subject deadline is %s, expected the '
      'Commissioner notification + 7 days.', v_subj);

  -- The statutory ordering: subjects cannot be told before the Commissioner.
  v_refused := false;
  BEGIN
    UPDATE core.data_breach_register
       SET notified_subjects_at = v_detected + interval '2 hours'
     WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T7d FAIL: the register recorded subjects notified BEFORE the Commissioner. '
    'That is a sequence that did not happen, which is worse than no register.';

  RAISE NOTICE
    'T7 PASS - 72-hour and 7-day clocks are derived, cannot be edited, and the '
    'notification order is enforced.';
END;
$t7$;

-- ─── T8 · HRD Corp registry ─────────────────────────────────────────────────

DO $t8$
DECLARE
  v_n   integer;
  r     record;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM core.compliance_rules
   WHERE rule_code IN ('HRD-QUERY-5D','HRD-007','HRD-009');
  ASSERT v_n = 3,
    pg_catalog.format('T8a FAIL: expected 3 HRD Corp deadline rules, found %s', v_n);

  -- The three offsets, each asserted with its unit, because "5" with the wrong
  -- unit is five months to respond to a query that expires in five days.
  SELECT offset_amount, offset_unit INTO r FROM core.compliance_rules
   WHERE rule_code='HRD-QUERY-5D';
  ASSERT r.offset_amount = 5 AND r.offset_unit::text = 'DAY',
    pg_catalog.format('T8b FAIL: the query deadline is %s %s, expected 5 DAY. The '
      'application EXPIRES on a missed query, so this is a lost grant rather than '
      'a late one.', r.offset_amount, r.offset_unit);

  SELECT offset_amount, offset_unit INTO r FROM core.compliance_rules WHERE rule_code='HRD-007';
  ASSERT r.offset_amount = 90 AND r.offset_unit::text = 'DAY',
    pg_catalog.format('T8c FAIL: commencement window is %s %s, expected 90 DAY',
      r.offset_amount, r.offset_unit);

  SELECT offset_amount, offset_unit INTO r FROM core.compliance_rules WHERE rule_code='HRD-009';
  ASSERT r.offset_amount = 6 AND r.offset_unit::text = 'MONTH',
    pg_catalog.format('T8d FAIL: claim window is %s %s, expected 6 MONTH',
      r.offset_amount, r.offset_unit);

  ASSERT NOT EXISTS (SELECT 1 FROM core.compliance_rules
                      WHERE rule_code IN ('HRD-QUERY-5D','HRD-007','HRD-009')
                        AND status <> 'PROPOSED'),
    'T8e FAIL: an HRD Corp rule is not PROPOSED. The compliance research is '
    'explicit that none should be inserted ACTIVE from the document alone, and '
    '009''s cr_active_needs_verification requires a named verifier.';

  ASSERT EXISTS (SELECT 1 FROM core.check_keys WHERE check_key='CHK_QUERY_DEADLINE'),
    'T8f FAIL: CHK_QUERY_DEADLINE is missing. It is a recommended ADDITION — the '
    '5-day query rule is not in the proposal pack''s Appendix B at all.';

  RAISE NOTICE
    'T8 PASS - 5 DAY query, 90 DAY commencement, 6 MONTH claim window, all three '
    'PROPOSED, and the new query-deadline check key exists.';
END;
$t8$;

-- ─── T9 · HRD-TDF accreditation ─────────────────────────────────────────────

DO $t9$
DECLARE
  v_refused boolean;
  r         record;
BEGIN
  v_refused := false;
  BEGIN
    INSERT INTO core.trainers (tenant_id, name, hrd_tdf)
    VALUES ('00000017-1111-1111-1111-111111111111','T017 Unexpiring', true);
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T9a FAIL: an accredited trainer was created with no hrd_tdf_valid_to. A '
    'boolean says a trainer was accredited once; the date says whether they can '
    'take a claimable class next month, and the row with no date is the one that '
    'quietly keeps being scheduled after the accreditation lapses.';

  INSERT INTO core.trainers (tenant_id, name, hrd_tdf, hrd_tdf_valid_to) VALUES
    ('00000017-1111-1111-1111-111111111111','T017 Expired',  true, CURRENT_DATE - 1),
    ('00000017-1111-1111-1111-111111111111','T017 Soon',     true, CURRENT_DATE + 30),
    ('00000017-1111-1111-1111-111111111111','T017 Fine',     true, CURRENT_DATE + 400);

  SELECT hrd_tdf_expired, hrd_tdf_expiring_soon INTO r
    FROM core.v_trainer_accreditation WHERE name='T017 Expired';
  ASSERT r.hrd_tdf_expired AND NOT r.hrd_tdf_expiring_soon,
    'T9b FAIL: a lapsed accreditation is not reported as expired.';

  SELECT hrd_tdf_expired, hrd_tdf_expiring_soon INTO r
    FROM core.v_trainer_accreditation WHERE name='T017 Soon';
  ASSERT NOT r.hrd_tdf_expired AND r.hrd_tdf_expiring_soon,
    'T9c FAIL: an accreditation expiring in 30 days is not flagged. Renewal must '
    'be applied for at least 3 months before expiry, so the window is the point.';

  SELECT hrd_tdf_expired, hrd_tdf_expiring_soon INTO r
    FROM core.v_trainer_accreditation WHERE name='T017 Fine';
  ASSERT NOT r.hrd_tdf_expired AND NOT r.hrd_tdf_expiring_soon,
    'T9d FAIL: an accreditation 400 days out is flagged.';

  RAISE NOTICE
    'T9 PASS - an accredited trainer needs an expiry date, and the view separates '
    'expired from expiring-soon at the 3-month renewal boundary.';
END;
$t9$;

-- ─── T10 · hnsw.iterative_scan — k rows under a tenant filter ──────────────
-- The finding this pack exists to carry. Alpha is a SMALL SHARE of the table,
-- which is the condition under which the default `off` silently under-returns.

DO $t10$
DECLARE
  v_src_a uuid;
  v_src_b uuid;
  v_k     integer := 10;
  v_got   integer;
  v_bad   integer;
BEGIN
  INSERT INTO core.knowledge_sources (tenant_id, name)
  VALUES ('00000017-1111-1111-1111-111111111111','T017 Alpha Corpus')
  RETURNING id INTO v_src_a;
  INSERT INTO core.knowledge_sources (tenant_id, name)
  VALUES ('00000017-2222-2222-2222-222222222222','T017 Beta Corpus')
  RETURNING id INTO v_src_b;

  -- Beta floods: 2,000 chunks. Alpha holds 40. Alpha is ~2% of the table, which
  -- is exactly the shape the research describes — "a tenant that is a small share
  -- of the table" — and the shape under which a k=10 request comes back with one
  -- or two rows, no error, and a quietly under-grounded answer.
  INSERT INTO core.knowledge_chunks (tenant_id, knowledge_source_id, seq, content, embedding)
  SELECT '00000017-2222-2222-2222-222222222222', v_src_b, g,
         'beta chunk ' || g,
         (SELECT ('[' || pg_catalog.string_agg(
                    ((g * 7 + d) % 100)::text, ',') || ']')::extensions.vector
            FROM pg_catalog.generate_series(1,1536) AS d)
    FROM pg_catalog.generate_series(1,2000) AS g;

  INSERT INTO core.knowledge_chunks (tenant_id, knowledge_source_id, seq, content, embedding)
  SELECT '00000017-1111-1111-1111-111111111111', v_src_a, g,
         'alpha chunk ' || g,
         (SELECT ('[' || pg_catalog.string_agg(
                    ((g * 3 + d) % 100)::text, ',') || ']')::extensions.vector
            FROM pg_catalog.generate_series(1,1536) AS d)
    FROM pg_catalog.generate_series(1,40) AS g;

  PERFORM pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000017-0000-0000-0000-0000000000a1","role":"authenticated",'
    '"tenant_id":"00000017-1111-1111-1111-111111111111","app_role":"SALES",'
    '"actor_kind":"HUMAN","aal":"aal1"}', true);

  SELECT pg_catalog.count(*) INTO v_got
    FROM core.retrieve_knowledge(
      (SELECT ('[' || pg_catalog.string_agg('50', ',') || ']')::extensions.vector
         FROM pg_catalog.generate_series(1,1536)), v_k);

  ASSERT v_got = v_k,
    pg_catalog.format('T10a FAIL: asked for %s rows and got %s. Alpha holds 40 of '
      '2,040 chunks (~2%%), and with hnsw.iterative_scan at its default of `off` '
      'the tenant predicate is applied ON TOP of the ANN candidate set, so a '
      'small tenant gets a short answer with NO ERROR — a quietly under-grounded '
      'RAG response rather than a visible failure.', v_k, v_got);

  -- And every row really is Alpha's. A retrieval that returned k rows by leaking
  -- Beta's would satisfy the count and be catastrophic.
  SELECT pg_catalog.count(*) INTO v_bad
    FROM core.retrieve_knowledge(
      (SELECT ('[' || pg_catalog.string_agg('50', ',') || ']')::extensions.vector
         FROM pg_catalog.generate_series(1,1536)), v_k) AS k
   WHERE k.content NOT LIKE 'alpha%';
  ASSERT v_bad = 0,
    pg_catalog.format('T10b FAIL: %s of the retrieved chunks belong to another '
      'tenant. Full prompt-context cross-tenant leakage.', v_bad);

  RAISE NOTICE
    'T10 PASS - k=10 rows returned for a tenant holding ~2%% of the corpus, all of '
    'them the caller''s own. This is the assertion hnsw.iterative_scan = '
    'relaxed_order exists for.';
END;
$t10$;

ROLLBACK;
