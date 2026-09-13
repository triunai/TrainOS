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

-- ─── Fixtures for T3b, T5b and T11 ─────────────────────────────────────────
-- T3b stores 0.867 into evaluation_responses.overall_score and T5b reads the
-- generated SST columns back off a quotation. Both were written as
-- `... FROM core.engagements LIMIT 1` / `SELECT id INTO v_qid FROM
-- core.quotations LIMIT 1` against tables with no rows, so the INSERT wrote
-- nothing, `IF FOUND` was false, and NEITHER ASSERTION EVER EXECUTED — while the
-- catalog claimed T3 "proves the conversion by storing 0.867 and reading it
-- back". Same false-catalog-claim mechanism that hid 014's defect.
--
-- Nine rows, each one a foreign key the two targets actually require:
-- engagements needs organisation + programme + owner + pipeline; quotations
-- needs a proposal (opportunity + organisation + template) and a rate card.
-- Shapes follow test_007's quotation chain and test_008's engagement chain.
-- Every ref prefix these tables need is already provisioned by 016's trigger on
-- the tenant INSERT above, so this block adds no core.ref_formats row.
--
-- ⚠ sst_rate / sst_reason are DELIBERATELY NOT SET. They no longer carry
-- defaults, and 017's BEFORE trigger resolves them from policy; setting them here
-- would pre-empt the path T11 exists to test.
INSERT INTO core.organisations (id, tenant_id, name, owner_id)
VALUES ('00000017-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000017-1111-1111-1111-111111111111',
        'Aurora Manufacturing Sdn Bhd','00000017-0000-0000-0000-0000000000a1');

INSERT INTO core.programmes (id, tenant_id, name, category, days, list_price_sen,
                             list_price_pax, floor_price_sen, floor_margin_rate, status)
VALUES ('00000017-0ddd-0ddd-0ddd-0ddddddddde1','00000017-1111-1111-1111-111111111111',
        'Leading Through Change','LEADERSHIP',2,1850000,30,1390000,0.3500,'ACTIVE');

-- ⚠ `is_default = false`. 019 seeds a default ENGAGEMENT pipeline for every
-- tenant at provision time, so a second default on the same object would collide
-- with it. Nothing here depends on this pipeline being the default — the
-- engagement below just needs a pipeline_id — so the fixture yields rather than
-- competing with the seeded one.
INSERT INTO core.pipelines (id, tenant_id, object, name, is_default, status)
VALUES ('00000017-0eee-0eee-0eee-0eeeeeeeeee1','00000017-1111-1111-1111-111111111111',
        'ENGAGEMENT','Standard delivery', false,'ACTIVE');

INSERT INTO core.opportunities (id, tenant_id, organisation_id, owner_id, value_sen)
VALUES ('00000017-0bbb-0bbb-0bbb-0bbbbbbbbbb1','00000017-1111-1111-1111-111111111111',
        '00000017-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000017-0000-0000-0000-0000000000a1',1850000);

INSERT INTO core.templates (id, tenant_id, template_type, label, status)
VALUES ('00000017-0ccc-0ccc-0ccc-0ccccccccce1','00000017-1111-1111-1111-111111111111',
        'PROPOSAL','Standard proposal','ACTIVE');

INSERT INTO core.rate_cards (id, tenant_id, version, status, effective_from)
VALUES ('00000017-0fff-0fff-0fff-0fffffffffe1','00000017-1111-1111-1111-111111111111',
        'v1-2026','DRAFT','2026-01-01');

INSERT INTO core.proposals (id, tenant_id, opportunity_id, organisation_id, template_id,
                            programme_id, value_sen, margin_rate)
VALUES ('00000017-0acc-0acc-0acc-0accccccccc1','00000017-1111-1111-1111-111111111111',
        '00000017-0bbb-0bbb-0bbb-0bbbbbbbbbb1','00000017-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        '00000017-0ccc-0ccc-0ccc-0ccccccccce1','00000017-0ddd-0ddd-0ddd-0ddddddddde1',
        1850000, 0.4100);

INSERT INTO core.engagements (id, tenant_id, organisation_id, programme_id, owner_id,
                             pipeline_id, proposal_id, title, starts_on, ends_on, value_sen)
VALUES ('00000017-0ee8-0ee8-0ee8-0ee888888881','00000017-1111-1111-1111-111111111111',
        '00000017-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000017-0ddd-0ddd-0ddd-0ddddddddde1',
        '00000017-0000-0000-0000-0000000000a1','00000017-0eee-0eee-0eee-0eeeeeeeeee1',
        '00000017-0acc-0acc-0acc-0accccccccc1',
        'Leading Through Change','2026-11-12','2026-11-13',1850000);

-- No quotation_lines: core.quotation_assert_reconciled and
-- core.quotation_assert_floor both return early when a quotation has no lines
-- ("a draft being started, not a breach"), so the header carries its own totals
-- and T5b still gets a non-zero net to compute SST on.
INSERT INTO core.quotations (id, tenant_id, proposal_id, rate_card_id, pax,
                             sell_price_sen, direct_cost_sen,
                             programme_floor_price_sen, floor_margin_rate)
VALUES ('00000017-0977-0977-0977-097777777771','00000017-1111-1111-1111-111111111111',
        '00000017-0acc-0acc-0acc-0accccccccc1','00000017-0fff-0fff-0fff-0fffffffffe1',
        30, 1850000, 1091500, 1390000, 0.3500);

CREATE FUNCTION pg_temp.t017_try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'message',SQLERRM);
END;
$fn$;

-- The same probe, but returning WHAT was read rather than only whether it raised.
-- "Did not error" and "read zero rows" are different facts and a cross-tenant
-- assertion needs the second one.
CREATE FUNCTION pg_temp.t017_try_value(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN jsonb_build_object('ok',true,'value',v);
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
  -- ⚠ NO `IF FOUND` AROUND THIS ANY MORE. It used to select its engagement with
  -- `FROM core.engagements LIMIT 1` against a table this pin never populated, so
  -- the INSERT affected zero rows, `IF FOUND` was false, and the assertion never
  -- ran — while the catalog claimed T3 "proves the conversion by storing 0.867
  -- and reading it back". The engagement is now a real fixture, named, and the
  -- assertions are unconditional: a missing fixture has to fail here, not pass
  -- quietly.
  INSERT INTO core.evaluation_responses
    (tenant_id, engagement_id, submitted_at, overall_score, answers)
  VALUES ('00000017-1111-1111-1111-111111111111',
          '00000017-0ee8-0ee8-0ee8-0ee888888881', pg_catalog.now(), 0.867, '{}'::jsonb);

  SELECT overall_score INTO v_score FROM core.evaluation_responses
   WHERE tenant_id='00000017-1111-1111-1111-111111111111'
     AND engagement_id='00000017-0ee8-0ee8-0ee8-0ee888888881';
  ASSERT v_score = 0.867,
    pg_catalog.format('T3b FAIL: stored 0.867 and read back %s. numeric(3,2) '
      'would have rounded it to 0.87.', v_score);

  -- T3d · and the 0..1 bound is enforced, not merely present. 008 defined this
  -- column on a five-point scale, so a stored 4.5 is the concrete thing the
  -- constraint exists to refuse and 017 now refuses to VALIDATE past.
  BEGIN
    INSERT INTO core.evaluation_responses
      (tenant_id, engagement_id, submitted_at, overall_score, answers)
    VALUES ('00000017-1111-1111-1111-111111111111',
            '00000017-0ee8-0ee8-0ee8-0ee888888881', pg_catalog.now(), 4.5, '{}'::jsonb);
    ASSERT false,
      'T3d FAIL: a five-point Likert score of 4.5 was accepted into a column 017 '
      'bounds to 0..1. Every average built on this column would be wrong by a '
      'factor nobody notices.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

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
  -- ⚠ UNCONDITIONAL, AND ON A NAMED FIXTURE. This used to be
  -- `SELECT id INTO v_qid FROM core.quotations LIMIT 1` against a table with no
  -- rows, so the whole block was skipped and T5b asserted nothing.
  v_qid := '00000017-0977-0977-0977-097777777771';
  UPDATE core.quotations SET sst_rate = 0.08000, sst_reason='STANDARD_RATED'
   WHERE id = v_qid;
  SELECT sst_sen, gross_price_sen INTO v_sst, v_gross
    FROM core.quotations WHERE id = v_qid;

  -- The arithmetic, not just non-nullity. 1,850,000 sen at 8% is 148,000 sen of
  -- SST and a gross of 1,998,000. A NULL check would pass against a column that
  -- generated zero.
  ASSERT v_sst = 148000,
    pg_catalog.format('T5b FAIL: sst_sen is %s, expected 148000 — 8%% of the '
      '1,850,000 sen net.', v_sst);
  ASSERT v_gross = 1998000,
    pg_catalog.format('T5b2 FAIL: gross_price_sen is %s, expected 1998000.', v_gross);

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


-- ─── T11 · CRIT · SST is resolved from policy, never stamped by a default ───
-- The finding: `sst_rate` and `sst_reason` were added `NOT NULL DEFAULT 0` and
-- `NOT NULL DEFAULT 'STANDARD_RATED'`, and nothing in 001-017 called
-- `app.resolve_tax_policy()` on a write. Ruling R-C says SST is resolved from
-- policy and "never a column default", and those two defaults were exactly that
-- — worse than a missing value, because the pair is internally consistent and
-- wrong: STANDARD_RATED at a rate of zero reads as a deliberate taxable, zero-tax
-- position. `sst_sen` and `gross_price_sen` are GENERATED from `sst_rate`, so the
-- gross equals the net, the invoice built field-for-field carries it forward, and
-- a taxable service is silently billed with no service tax.
DO $t11$
DECLARE
  v_rate   numeric;
  v_reason text;
  v_pol    uuid;
  v_sst    bigint;
  v_refused jsonb;
BEGIN
  -- T11a · the defaults are GONE. This is the half a behavioural test cannot
  -- reach: a default only shows itself when a column is omitted, and the trigger
  -- now fills that case, so the two would be indistinguishable from the outside
  -- until the day somebody drops the trigger.
  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='core' AND table_name='quotations'
       AND column_name IN ('sst_rate','sst_reason')
       AND column_default IS NOT NULL),
    'T11a FAIL: sst_rate or sst_reason still carries a column default. Ruling R-C '
    'says SST is resolved by app.resolve_tax_policy() and never defaulted, and a '
    'default of 0 / STANDARD_RATED is a taxable position billed at zero tax.';

  ASSERT (SELECT pg_catalog.count(*) FROM information_schema.columns
           WHERE table_schema='core' AND table_name='quotations'
             AND column_name IN ('sst_rate','sst_reason')
             AND is_nullable='NO') = 2,
    'T11a2 FAIL: sst_rate and sst_reason are not both NOT NULL. Without the '
    'default they must be NOT NULL, or an omitted column becomes a NULL rate and '
    'the generated sst_sen becomes NULL rather than wrong — quieter, still wrong.';

  -- T11b · the trigger exists, is BEFORE, and covers UPDATE as well as INSERT.
  ASSERT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
     WHERE t.tgrelid = 'core.quotations'::regclass
       AND t.tgname  = 'trg_quotations_resolve_sst'
       AND NOT t.tgisinternal
       AND (t.tgtype & 2) <> 0        -- BEFORE
       AND (t.tgtype & 4) <> 0        -- INSERT
       AND (t.tgtype & 16) <> 0),     -- UPDATE
    'T11b FAIL: no BEFORE INSERT OR UPDATE trigger resolving SST on '
    'core.quotations. Without it the columns are NOT NULL with no default and '
    'every insert that omits them fails, which is a different outage.';

  -- T11c · THE BEHAVIOUR. The fixture quotation was inserted without touching a
  -- single SST column, and must have come out carrying the policy's position.
  SELECT sst_rate, sst_reason, sst_policy_id, sst_sen
    INTO v_rate, v_reason, v_pol, v_sst
    FROM core.quotations WHERE id = '00000017-0977-0977-0977-097777777771';

  ASSERT v_reason = 'STANDARD_RATED',
    pg_catalog.format('T11c FAIL: sst_reason resolved to %s, expected '
      'STANDARD_RATED — corporate training is taxable under Group G.', v_reason);
  ASSERT v_rate = 0.08000,
    pg_catalog.format('T11c2 FAIL: sst_rate resolved to %s, expected 0.08000 from '
      'the seeded SST-G-TRAINING-8 policy. A rate of 0 beside STANDARD_RATED is '
      'the defect: it reads as a deliberate zero-tax position on a taxable '
      'service.', v_rate);
  ASSERT v_pol IS NOT NULL,
    'T11c3 FAIL: sst_policy_id is NULL, so the rate above is not traceable to the '
    'policy row it came from and nobody can answer "why this rate" in two years.';
  ASSERT v_pol = (SELECT id FROM core.tax_policies WHERE policy_code='SST-G-TRAINING-8'),
    'T11c4 FAIL: sst_policy_id does not point at the resolved policy.';

  -- T11d · an explicit resolution is left alone. 018's put_quotation resolves for
  -- itself; the trigger must not re-resolve over it on every later UPDATE.
  UPDATE core.quotations
     SET sst_rate = 0.06000, sst_reason = 'STANDARD_RATED'
   WHERE id = '00000017-0977-0977-0977-097777777771';
  SELECT sst_rate INTO v_rate FROM core.quotations
   WHERE id = '00000017-0977-0977-0977-097777777771';
  ASSERT v_rate = 0.06000,
    pg_catalog.format('T11d FAIL: an explicitly supplied rate of 0.06 was '
      'overwritten with %s. 018''s put_quotation resolves explicitly and the '
      'trigger must fill only what the caller left NULL.', v_rate);

  -- T11e · half a position is refused. A rate without its reason is a rate that
  -- does not match the reason beside it.
  v_refused := pg_temp.t017_try($$
    UPDATE core.quotations SET sst_rate = NULL
     WHERE id = '00000017-0977-0977-0977-097777777771'$$);
  ASSERT NOT (v_refused->>'ok')::boolean,
    pg_catalog.format('T11e FAIL: a quotation was allowed to carry a reason with '
      'no rate: %s', v_refused::text);

  -- T11f · and asking for a re-resolution works: both NULL means resolve.
  UPDATE core.quotations
     SET sst_rate = NULL, sst_reason = NULL
   WHERE id = '00000017-0977-0977-0977-097777777771';
  SELECT sst_rate, sst_reason INTO v_rate, v_reason FROM core.quotations
   WHERE id = '00000017-0977-0977-0977-097777777771';
  ASSERT v_rate = 0.08000 AND v_reason = 'STANDARD_RATED',
    pg_catalog.format('T11f FAIL: clearing both columns did not re-resolve from '
      'policy; got %s / %s.', v_rate, v_reason);

  RAISE NOTICE
    'T11 PASS - no column default on sst_rate/sst_reason, a BEFORE INSERT OR '
    'UPDATE trigger resolves them from app.resolve_tax_policy (8%% Group G, '
    'traceable to its policy row), an explicit resolution passes through '
    'untouched, half a position is refused, and clearing both re-resolves.';
END;
$t11$;

-- ─── T12 · the tenant-seed registry, and the guard it drives ────────────────
-- The finding: 017 added a THIRD tenant-provisioning trigger by copying 016's
-- pattern, and `app.provision_tenant`'s completeness guard — which exists
-- precisely to refuse a tenant that looks provisioned and is missing something a
-- later table needs — checked two relations by name and knew nothing about it.
-- 018 adds a fourth. The guard is now driven by `app.tenant_seed_checks`, so a
-- pack registers its seed beside its own trigger instead of remembering to widen
-- a guard in another file.
DO $t12$
DECLARE
  v_tenant  uuid;
  v_refused jsonb;
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM app.tenant_seed_checks
     WHERE schema_name='core' AND table_name='check_keys' AND pack='017'),
    'T12a FAIL: 017 does not register its compliance-check-key seed, so '
    'provision_tenant would hand back a tenant with no check keys and report it '
    'fully provisioned.';

  ASSERT (SELECT pg_catalog.count(*) FROM app.tenant_seed_checks) >= 3,
    'T12b FAIL: fewer than three registered seed checks. 011, 016 and 017 each '
    'seed a tenant and each must be registered.';

  -- THE BEHAVIOUR, staged: disable 017's trigger and confirm provision_tenant
  -- REFUSES rather than returning a half-provisioned tenant. Inside this
  -- transaction, so the trigger is back at ROLLBACK.
  ALTER TABLE public.tenants DISABLE TRIGGER trg_tenants_seed_check_keys;
  v_refused := pg_temp.t017_try(
    $$SELECT app.provision_tenant('t017-halfseed','T017 Half Seeded','Asia/Kuala_Lumpur')$$);
  ALTER TABLE public.tenants ENABLE TRIGGER trg_tenants_seed_check_keys;

  ASSERT NOT (v_refused->>'ok')::boolean,
    pg_catalog.format('T12c FAIL: provision_tenant returned a tenant whose '
      'check-key seed did not run. Every HRD Corp compliance rule for that tenant '
      'resolves to no check key, the compliance engine evaluates nothing, and a '
      'claim deadline passes with the packet looking healthy. Result: %s',
      v_refused::text);
  ASSERT v_refused->>'message' LIKE '%check_keys%',
    pg_catalog.format('T12c2 FAIL: provisioning was refused, but not by the '
      'check-keys registry entry: %s', v_refused->>'message');

  -- And it still works with the trigger enabled, or the guard is just an outage.
  v_tenant := app.provision_tenant('t017-fullseed','T017 Fully Seeded','Asia/Kuala_Lumpur');
  ASSERT v_tenant IS NOT NULL, 'T12d FAIL: provisioning failed with every trigger enabled.';
  ASSERT (SELECT pg_catalog.count(*) FROM core.check_keys WHERE tenant_id = v_tenant) > 0,
    'T12d2 FAIL: a fully provisioned tenant has no check keys.';

  RAISE NOTICE
    'T12 PASS - 017 registers its seed in app.tenant_seed_checks, provision_tenant '
    'refuses a tenant whose check-key trigger did not fire, and a fully seeded '
    'tenant still provisions.';
END;
$t12$;

-- ─── T13 · the three new tables are tenant-isolated, probed as a caller ─────
-- The finding: 017's three new tenant-scoped tables got ZERO RLS or grant
-- assertions in this pin. The only cross-tenant probe went through a
-- SECURITY DEFINER function as owner, which proves that function's own filter and
-- nothing about the policy underneath it. Probed here directly, as
-- `authenticated`, with the WRONG tenant's claims — one statement each, because a
-- batched probe matrix lets the planner fold repeated STABLE calls whose
-- role-swap side effects it cannot see, and returns a silently-wrong all-denied.

INSERT INTO core.data_breach_register (tenant_id, detected_at, nature, affected_count)
VALUES ('00000017-1111-1111-1111-111111111111', pg_catalog.now(),
        'Probe incident for the cross-tenant read test', 1);

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000017-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000017-2222-2222-2222-222222222222","app_role":"ADMIN","actor_kind":"HUMAN","aal":"aal2"}',
  true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t017.xt_breach',
  pg_temp.t017_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.data_breach_register
                      WHERE tenant_id = '00000017-1111-1111-1111-111111111111'$$)::text, true);
RESET ROLE;

DO $t13$
DECLARE v_xt jsonb := pg_catalog.current_setting('t017.xt_breach')::jsonb;
BEGIN
  -- `>= 1`, not `= 1`: T7 seeds its own breach rows for this tenant earlier in
  -- the file. The number does not matter; that the owner sees SOMETHING does,
  -- because otherwise the cross-tenant zero below would be a zero for the wrong
  -- reason — which is the exact defect this pin was added to close elsewhere.
  ASSERT (SELECT pg_catalog.count(*) FROM core.data_breach_register
           WHERE tenant_id='00000017-1111-1111-1111-111111111111') >= 1,
    'T13 SETUP FAIL: the owner cannot see any breach row for the alpha tenant, so '
    'the cross-tenant probe below would read zero for the wrong reason.';

  ASSERT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS c
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
           WHERE n.nspname='core'
             AND c.relname IN ('tax_policies','data_retention_policies','data_breach_register')
             AND c.relrowsecurity AND c.relforcerowsecurity) = 3,
    'T13a FAIL: one of 017''s three new tables is not RLS enabled AND FORCED. '
    '004''s finalise_table sets both and 014''s policy layer assumes both.';

  ASSERT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy AS p
            JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
           WHERE n.nspname='core'
             AND c.relname IN ('tax_policies','data_retention_policies','data_breach_register')
             AND p.polname IN (c.relname||'_tenant_select', c.relname||'_tenant_isolation')) = 6,
    'T13b FAIL: the three new tables do not all carry 014''s policy pair.';

  ASSERT (v_xt->>'ok')::boolean,
    pg_catalog.format('T13c FAIL: an authenticated caller got an ERROR rather '
      'than zero rows reading another tenant''s breach register. A RESTRICTIVE '
      'policy should return empty; an error means the grant is missing and the '
      'posture is different from the one being claimed. %s', v_xt::text);

  ASSERT (v_xt->'value')::text = '0',
    pg_catalog.format('T13d FAIL: an ADMIN of tenant Beta read %s of tenant '
      'Alpha''s breach-register rows. This is a statutory PDPA register and the '
      'only thing between it and the other tenant is 014''s policy pair, probed '
      'here directly rather than through a definer function that would have '
      'proved its own filter instead.', (v_xt->'value')::text);

  RAISE NOTICE
    'T13 PASS - 017''s three tables are RLS forced with 014''s policy pair, and an '
    'ADMIN of another tenant reading the breach register directly, as '
    'authenticated, sees nothing.';
END;
$t13$;


ROLLBACK;
