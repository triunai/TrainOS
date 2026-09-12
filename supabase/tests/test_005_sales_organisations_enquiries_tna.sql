-- ============================================================================
-- PIN 005 · sales_organisations_enquiries_tna
-- ============================================================================
--
-- Run only AFTER 005. Ends in ROLLBACK.
--   psql "$DATABASE_URL" -f supabase/tests/test_005_sales_organisations_enquiries_tna.sql
--
-- WHAT THIS PIN IS FOR. Fourteen tables of columns prove nothing by existing.
-- What is worth asserting is the handful of constraints that encode a RULE, and
-- the one structural guarantee this model buys at the storage layer:
--
--   T2  A cross-tenant foreign key is UNREPRESENTABLE. Not "denied by policy" —
--       rejected by the storage engine, with RLS switched off entirely. RLS can
--       be misconfigured in a migration nobody reviews; a composite FK cannot.
--   T3  A low-confidence enquiry cannot be archived. The contract says items
--       below the threshold "are never auto-archived", which is a sentence
--       about a background job. The constraint makes it true of the data
--       regardless of what tries.
--   T5  One enquiry converts exactly once. A double-clicked Convert button
--       otherwise creates two opportunities and the pipeline total is wrong by
--       the value of the deal — the number the managing director reads first.
--   T7  Consent is an append-only ledger and the current-state view agrees with
--       it. PDPA asks what was true on a date, not what is true now.
--
-- RUNNABILITY NOTES
-- 1. RLS is FORCED with no policies on every table here (004's finaliser), so
--    this pin runs as the migration role throughout and does NOT attempt a
--    four-way matrix. That matrix belongs in test_014, against the policies.
--    T2 is stronger than a policy test anyway: it holds with RLS irrelevant.
-- 2. Real `auth.users` and `public.tenants` rows; `core.ref_formats` rows for
--    every prefix the fixtures allocate.
-- 3. Fixture ids namespaced `00000005-`.
-- 4. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_005 SETUP FAILURE: check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF to_regclass('core.tna_recommendations') IS NULL THEN
    RAISE EXCEPTION 'test_005 SETUP FAILURE: 005 is missing or partial.';
  END IF;
END;
$setup$;

INSERT INTO auth.users (id, email) VALUES
  ('00000005-0000-0000-0000-0000000000a1','t005-amirah@example.invalid'),
  ('00000005-0000-0000-0000-0000000000b1','t005-beta@example.invalid');

INSERT INTO public.tenants (id, slug, name) VALUES
  ('00000005-1111-1111-1111-111111111111','t005-alpha','Alpha'),
  ('00000005-2222-2222-2222-222222222222','t005-beta','Beta');

INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width)
SELECT t.id, p.prefix, p.entity, p.dated, 4
FROM (VALUES ('ORG','organisations',false),('CON','contacts',false),
             ('ENQ','enquiries',true),('OPP','opportunities',false),
             ('TNA','tnas',false),('FUP','follow_ups',false)) AS p(prefix,entity,dated)
CROSS JOIN public.tenants t
WHERE t.slug IN ('t005-alpha','t005-beta');

INSERT INTO core.organisations (id, tenant_id, name, owner_id, hrdc_registered, hrdc_employer_code)
VALUES ('00000005-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000005-1111-1111-1111-111111111111',
        'Aurora Manufacturing Sdn Bhd','00000005-0000-0000-0000-0000000000a1',true,'HRDC-2201-8834'),
       ('00000005-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000005-2222-2222-2222-222222222222',
        'Beta Industries','00000005-0000-0000-0000-0000000000b1',false,NULL);

INSERT INTO core.contacts (id, tenant_id, organisation_id, name, email, is_primary)
VALUES ('00000005-cccc-cccc-cccc-ccccccccccc1','00000005-1111-1111-1111-111111111111',
        '00000005-aaaa-aaaa-aaaa-aaaaaaaaaaa1','Nurul Hassan','nurul.hassan@auroramfg.com.my',true);

-- === T1 · refs allocate in the contract's shapes ============================
DO $t1$
DECLARE v_org text; v_con text;
BEGIN
  SELECT ref INTO v_org FROM core.organisations WHERE id = '00000005-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  SELECT ref INTO v_con FROM core.contacts      WHERE id = '00000005-cccc-cccc-cccc-ccccccccccc1';
  ASSERT v_org = 'ORG-0001', format('T1a FAIL: organisation ref is %s', v_org);
  ASSERT v_con = 'CON-0001', format('T1b FAIL: contact ref is %s', v_con);
  RAISE NOTICE 'T1 PASS - % / % allocated.', v_org, v_con;
END;
$t1$;

-- === T2 · a cross-tenant FK is UNREPRESENTABLE, with RLS irrelevant =========
DO $t2$
BEGIN
  BEGIN
    INSERT INTO core.contacts (tenant_id, organisation_id, name, email)
    VALUES ('00000005-2222-2222-2222-222222222222',       -- Beta's tenant
            '00000005-aaaa-aaaa-aaaa-aaaaaaaaaaa1',       -- Alpha's organisation
            'Smuggled','smuggled@example.invalid');
    RAISE EXCEPTION
      'T2a FAIL: a contact in tenant Beta was attached to an organisation in tenant '
      'Alpha. The composite FK is not composite, and cross-tenant references are '
      'representable again.';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO core.opportunities (tenant_id, organisation_id, owner_id)
    VALUES ('00000005-2222-2222-2222-222222222222',
            '00000005-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
            '00000005-0000-0000-0000-0000000000b1');
    RAISE EXCEPTION 'T2b FAIL: cross-tenant opportunity accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'T2 PASS - cross-tenant references rejected by the storage engine, not by RLS.';
END;
$t2$;

-- === T3 · a low-confidence enquiry can never be archived ====================
DO $t3$
DECLARE v_id uuid;
BEGIN
  INSERT INTO core.enquiries (tenant_id, channel, received_at, subject,
                              classification_confidence, needs_human_review)
  VALUES ('00000005-1111-1111-1111-111111111111','WHATSAPP', now(),
          'unclear request', 0.410, true)
  RETURNING id INTO v_id;

  BEGIN
    UPDATE core.enquiries SET status = 'ARCHIVED' WHERE id = v_id;
    RAISE EXCEPTION
      'T3 FAIL: an enquiry flagged needs_human_review was archived. The contract''s '
      '"never auto-archived" is now only a property of a background job.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- clearing the flag is the legitimate path
  UPDATE core.enquiries SET needs_human_review = false, status = 'ARCHIVED' WHERE id = v_id;
  ASSERT (SELECT status FROM core.enquiries WHERE id = v_id) = 'ARCHIVED',
    'T3b FAIL: a reviewed enquiry could not be archived either';
  RAISE NOTICE 'T3 PASS - archived only after review; the flag is the gate.';
END;
$t3$;

-- === T4 · a match with no reason is refused =================================
DO $t4$
BEGIN
  BEGIN
    INSERT INTO core.enquiries (tenant_id, channel, received_at, matched_organisation_id)
    VALUES ('00000005-1111-1111-1111-111111111111','EMAIL', now(),
            '00000005-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
    RAISE EXCEPTION 'T4 FAIL: an organisation match was recorded with no match_reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T4 PASS - an unauditable match is refused.';
END;
$t4$;

-- === T5 · one enquiry converts exactly once =================================
DO $t5$
DECLARE v_enq uuid;
BEGIN
  INSERT INTO core.enquiries (tenant_id, channel, received_at, subject)
  VALUES ('00000005-1111-1111-1111-111111111111','EMAIL', now(),'Leadership training')
  RETURNING id INTO v_enq;

  INSERT INTO core.opportunities (tenant_id, organisation_id, owner_id, source_enquiry_id, value_sen)
  VALUES ('00000005-1111-1111-1111-111111111111','00000005-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
          '00000005-0000-0000-0000-0000000000a1', v_enq, 1850000);

  BEGIN
    INSERT INTO core.opportunities (tenant_id, organisation_id, owner_id, source_enquiry_id)
    VALUES ('00000005-1111-1111-1111-111111111111','00000005-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
            '00000005-0000-0000-0000-0000000000a1', v_enq);
    RAISE EXCEPTION
      'T5 FAIL: one enquiry produced two opportunities. A double-clicked Convert '
      'button now overstates the pipeline by the value of the deal.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'T5 PASS - one enquiry, one opportunity.';
END;
$t5$;

-- === T6 · a lost deal must say why; a follow-up may chase only one thing ====
DO $t6$
DECLARE v_opp uuid;
BEGIN
  SELECT id INTO v_opp FROM core.opportunities
  WHERE tenant_id = '00000005-1111-1111-1111-111111111111' LIMIT 1;

  BEGIN
    UPDATE core.opportunities SET stage = 'LOST' WHERE id = v_opp;
    RAISE EXCEPTION 'T6a FAIL: a deal was marked LOST with no reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO core.follow_ups (tenant_id, organisation_id, contact_id, reason, due_date,
                                 owner_id, proposal_id, invoice_id)
    VALUES ('00000005-1111-1111-1111-111111111111','00000005-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
            '00000005-cccc-cccc-cccc-ccccccccccc1','chase', current_date,
            '00000005-0000-0000-0000-0000000000a1',
            gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'T6b FAIL: a follow-up chased a proposal AND an invoice at once';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T6 PASS - LOST needs a reason; a follow-up has at most one target.';
END;
$t6$;

-- === T7 · consent is an append-only ledger and the view agrees with it ======
DO $t7$
DECLARE v_eff boolean; v_n int;
BEGIN
  INSERT INTO core.contact_consents (tenant_id, contact_id, channel, granted, recorded_at)
  VALUES ('00000005-1111-1111-1111-111111111111','00000005-cccc-cccc-cccc-ccccccccccc1',
          'WHATSAPP', true, '2024-03-04T10:12:00+08:00');
  INSERT INTO core.contact_consents (tenant_id, contact_id, channel, granted, recorded_at)
  VALUES ('00000005-1111-1111-1111-111111111111','00000005-cccc-cccc-cccc-ccccccccccc1',
          'WHATSAPP', false, '2026-01-05T09:00:00+08:00');

  SELECT effective_granted INTO v_eff
  FROM core.v_contact_consent_current
  WHERE contact_id = '00000005-cccc-cccc-cccc-ccccccccccc1' AND channel = 'WHATSAPP';
  ASSERT v_eff = false, 'T7a FAIL: the current-consent view did not follow the newest record';

  SELECT count(*) INTO v_n FROM core.contact_consents
  WHERE contact_id = '00000005-cccc-cccc-cccc-ccccccccccc1';
  ASSERT v_n = 2,
    format('T7b FAIL: the ledger holds %s rows; withdrawal overwrote the history PDPA requires', v_n);

  -- the historical fact itself must be immutable
  BEGIN
    UPDATE core.contact_consents SET granted = false
    WHERE contact_id = '00000005-cccc-cccc-cccc-ccccccccccc1' AND recorded_at = '2024-03-04T10:12:00+08:00';
    RAISE EXCEPTION 'T7c FAIL: a recorded consent was rewritten';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
  RAISE NOTICE 'T7 PASS - consent history survives withdrawal and cannot be rewritten.';
END;
$t7$;

-- === T8 · the deferred forward references exist as columns ==================
--     Their FK constraints are added by 006, 007 and 010. The gap is real while
--     it lasts, so it is tracked here and closed in test_014.
DO $t8$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(x.rel || '.' || x.col, ', ') INTO v_missing
  FROM (VALUES ('core.organisation_suggestions','programme_id'),
               ('core.follow_ups','proposal_id'),
               ('core.follow_ups','invoice_id'),
               ('core.tna_recommendations','programme_id')) AS x(rel,col)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = x.rel::regclass AND attname = x.col AND attnum > 0 AND NOT attisdropped);
  ASSERT v_missing IS NULL, format('T8 FAIL: deferred column(s) missing: %s', v_missing);
  RAISE NOTICE 'T8 PASS - four deferred forward-reference columns present; FKs land in 006/007/010.';
END;
$t8$;

DO $done$
BEGIN
  RAISE NOTICE 'test_005 ALL PASS (T1-T8, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
