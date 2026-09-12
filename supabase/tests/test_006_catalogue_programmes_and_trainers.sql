-- ============================================================================
-- PIN 006 · catalogue_programmes_and_trainers
-- ============================================================================
--
-- Run only AFTER 006. Ends in ROLLBACK.
--   psql "$DATABASE_URL" -f supabase/tests/test_006_catalogue_programmes_and_trainers.sql
--
-- WHAT THIS PIN IS FOR. Two behaviours, and they are the only two in this
-- migration that a reader could believe were true without being true:
--
--   T3  A TRAINER CANNOT BE DOUBLE-BOOKED. Every case is exercised —
--       fully-overlapping, partially-overlapping, adjacent-but-not-overlapping,
--       a different trainer, and a different tenant — because an EXCLUSION
--       constraint written with the wrong range bound is the difference between
--       "12–13 Nov and 13–14 Nov conflict" and "they do not", and both spellings
--       look right. Two SOFT_HOLDs must still be allowed to overlap: holding two
--       options for a client while they decide is the point of a soft hold, and a
--       constraint that forbade it would quietly break the sales motion.
--
--   T4  THE DECLARED CALENDAR CANNOT DISAGREE WITH THE BOOKINGS. Confirming
--       writes BOOKED days; MOVING a booking releases the days it no longer
--       covers. The release is the half that gets forgotten, and the symptom is
--       a trainer who looks busy on dates nobody booked, so the recommendation
--       engine stops offering them.
--
-- RUNNABILITY NOTES
-- 1. Runs as the migration role: RLS is forced with no policies until 014.
-- 2. Real tenants, ref_formats and auth.users rows.
-- 3. Fixture ids namespaced `00000006-`.
-- 4. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_006 SETUP FAILURE: check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF to_regclass('core.trainer_bookings') IS NULL THEN
    RAISE EXCEPTION 'test_006 SETUP FAILURE: 006 is missing or partial.';
  END IF;
END;
$setup$;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('00000006-1111-1111-1111-111111111111','t006-alpha','Alpha'),
  ('00000006-2222-2222-2222-222222222222','t006-beta','Beta');

INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width)
SELECT t.id, p.prefix, p.entity, false, 4
FROM (VALUES ('PRG','programmes'),('TRN','trainers'),('TBK','trainer_bookings')) AS p(prefix,entity)
CROSS JOIN public.tenants t WHERE t.slug IN ('t006-alpha','t006-beta');

INSERT INTO core.programmes (id, tenant_id, name, category, days, list_price_sen,
                             list_price_pax, floor_price_sen, floor_margin_rate,
                             hrdc_claimable, hrdc_scheme, status)
VALUES ('00000006-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000006-1111-1111-1111-111111111111',
        'Leading Through Change','LEADERSHIP',2, 1850000, 30, 1390000, 0.3500,
        true,'SBL_KHAS','ACTIVE');

INSERT INTO core.trainers (id, tenant_id, name, band, ttt_certified, ttt_ref, hrd_tdf)
VALUES ('00000006-7a11-7a11-7a11-7a1100000001','00000006-1111-1111-1111-111111111111',
        'Farah Aziz','A',true,'TTT-2019-4471',true),
       ('00000006-7a11-7a11-7a11-7a1100000002','00000006-1111-1111-1111-111111111111',
        'Daniel Wong','B',true,'TTT-2020-1102',true);
INSERT INTO core.trainers (id, tenant_id, name, ttt_certified)
VALUES ('00000006-7a11-7a11-7a11-7a1100000003','00000006-2222-2222-2222-222222222222',
        'Beta Trainer',false);

-- === T1 · a floor above the list price is refused ===========================
DO $t1$
BEGIN
  BEGIN
    INSERT INTO core.programmes (tenant_id, name, category, days, list_price_sen,
                                 list_price_pax, floor_price_sen, floor_margin_rate)
    VALUES ('00000006-1111-1111-1111-111111111111','Bad','X',1, 100000, 10, 200000, 0.35);
    RAISE EXCEPTION 'T1a FAIL: a floor above the list price was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- and a claimable programme with no scheme cannot be claimed against anything
  BEGIN
    INSERT INTO core.programmes (tenant_id, name, category, days, list_price_sen,
                                 list_price_pax, floor_price_sen, floor_margin_rate,
                                 hrdc_claimable)
    VALUES ('00000006-1111-1111-1111-111111111111','Bad2','X',1, 100000, 10, 90000, 0.35, true);
    RAISE EXCEPTION 'T1b FAIL: a claimable programme was accepted with no HRDC scheme';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T1 PASS - floor <= list, and claimable requires a scheme.';
END;
$t1$;

-- === T2 · a certified trainer must carry the certificate reference ==========
DO $t2$
BEGIN
  BEGIN
    INSERT INTO core.trainers (tenant_id, name, ttt_certified)
    VALUES ('00000006-1111-1111-1111-111111111111','No Cert Ref', true);
    RAISE EXCEPTION
      'T2 FAIL: a trainer was flagged TTT-certified with no reference. The HRD Corp '
      'packet asks for that reference and cannot be completed without it.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T2 PASS - certified implies a certificate reference.';
END;
$t2$;

-- === T3 · THE DOUBLE-BOOKING MATRIX ========================================
DO $t3$
DECLARE v_first uuid;
BEGIN
  -- baseline: Farah confirmed 12-13 Nov
  INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on)
  VALUES ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000001',
          'CONFIRMED','2026-11-12','2026-11-13')
  RETURNING id INTO v_first;

  -- (a) an identical span must be refused
  BEGIN
    INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on)
    VALUES ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000001',
            'CONFIRMED','2026-11-12','2026-11-13');
    RAISE EXCEPTION 'T3a FAIL: an identical confirmed booking was accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  -- (b) a PARTIAL overlap must be refused. This is the case a naive unique
  --     index on (trainer, starts_on) would let through.
  BEGIN
    INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on)
    VALUES ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000001',
            'CONFIRMED','2026-11-13','2026-11-14');
    RAISE EXCEPTION
      'T3b FAIL: a PARTIALLY overlapping booking was accepted. 13 Nov is now booked '
      'twice and the trainer is in two places.';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  -- (c) ADJACENT but not overlapping must be ALLOWED. An inclusive upper bound
  --     written as exclusive, or the reverse, breaks exactly this case.
  INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on)
  VALUES ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000001',
          'CONFIRMED','2026-11-14','2026-11-15');

  -- (d) a DIFFERENT trainer over the same dates must be allowed
  INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on)
  VALUES ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000002',
          'CONFIRMED','2026-11-12','2026-11-13');

  -- (e) two SOFT_HOLDs over the same dates must be allowed. Holding two options
  --     for a client while they decide is the entire point of a soft hold.
  INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on, hold_expires_at)
  VALUES ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000002',
          'SOFT_HOLD','2026-12-01','2026-12-02', now() + interval '72 hours'),
         ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000002',
          'SOFT_HOLD','2026-12-01','2026-12-02', now() + interval '72 hours');

  -- (f) a hold with no expiry is a confirmed booking nobody agreed to
  BEGIN
    INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on)
    VALUES ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000002',
            'SOFT_HOLD','2026-12-10','2026-12-11');
    RAISE EXCEPTION 'T3f FAIL: a soft hold with no expiry was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (g) reversed dates
  BEGIN
    INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on)
    VALUES ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000002',
            'CONFIRMED','2026-12-20','2026-12-19');
    RAISE EXCEPTION 'T3g FAIL: a booking that ends before it starts was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE
    'T3 PASS - identical and partial overlaps refused; adjacent, other-trainer and '
    'two soft holds allowed.';
END;
$t3$;

-- === T4 · the declared calendar follows the bookings, in BOTH directions =====
DO $t4$
DECLARE v_id uuid; v_n int;
BEGIN
  INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on)
  VALUES ('00000006-1111-1111-1111-111111111111','00000006-7a11-7a11-7a11-7a1100000001',
          'CONFIRMED','2027-03-01','2027-03-03')
  RETURNING id INTO v_id;

  SELECT count(*) INTO v_n FROM core.trainer_availability
  WHERE trainer_id = '00000006-7a11-7a11-7a11-7a1100000001'
    AND on_date BETWEEN '2027-03-01' AND '2027-03-03' AND state = 'BOOKED';
  ASSERT v_n = 3, format('T4a FAIL: confirming wrote %s BOOKED days, expected 3', v_n);

  -- MOVE the booking. The days it no longer covers must be released - this is
  -- the half that gets forgotten, and the symptom is a trainer who looks busy on
  -- dates nobody booked, so the recommender stops offering them.
  UPDATE core.trainer_bookings SET starts_on = '2027-03-05', ends_on = '2027-03-06'
   WHERE id = v_id;

  SELECT count(*) INTO v_n FROM core.trainer_availability
  WHERE trainer_id = '00000006-7a11-7a11-7a11-7a1100000001'
    AND on_date BETWEEN '2027-03-01' AND '2027-03-03' AND state = 'BOOKED';
  ASSERT v_n = 0,
    format('T4b FAIL: %s stale BOOKED day(s) survived the move. The trainer now looks '
           'busy on dates nobody booked.', v_n);

  SELECT count(*) INTO v_n FROM core.trainer_availability
  WHERE trainer_id = '00000006-7a11-7a11-7a11-7a1100000001'
    AND on_date BETWEEN '2027-03-05' AND '2027-03-06' AND state = 'BOOKED';
  ASSERT v_n = 2, format('T4c FAIL: the moved booking wrote %s BOOKED days, expected 2', v_n);

  DELETE FROM core.trainer_bookings WHERE id = v_id;
  SELECT count(*) INTO v_n FROM core.trainer_availability
  WHERE trainer_id = '00000006-7a11-7a11-7a11-7a1100000001'
    AND on_date BETWEEN '2027-03-05' AND '2027-03-06' AND state = 'BOOKED';
  ASSERT v_n = 0, format('T4d FAIL: %s BOOKED day(s) survived the cancellation', v_n);

  RAISE NOTICE 'T4 PASS - calendar follows confirm, move and cancel.';
END;
$t4$;

-- === T5 · the double-booking rule is tenant-scoped ==========================
--     Two tenants may each have a trainer with the same name over the same
--     dates. The constraint includes tenant_id for exactly this reason.
DO $t5$
BEGIN
  INSERT INTO core.trainer_bookings (tenant_id, trainer_id, state, starts_on, ends_on)
  VALUES ('00000006-2222-2222-2222-222222222222','00000006-7a11-7a11-7a11-7a1100000003',
          'CONFIRMED','2026-11-12','2026-11-13');
  RAISE NOTICE 'T5 PASS - another tenant books the same dates freely.';
END;
$t5$;

-- === T6 · the three deferred FKs from 002 and 005 are now closed ============
DO $t6$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(x.name, ', ') INTO v_missing
  FROM (VALUES ('os_programme_fk'),('tna_recs_programme_fk'),('memberships_trainer_fk')) AS x(name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = x.name);
  ASSERT v_missing IS NULL, format('T6 FAIL: deferred FK(s) still open: %s', v_missing);

  -- and a cross-tenant programme reference is now impossible
  BEGIN
    INSERT INTO core.organisation_suggestions (tenant_id, organisation_id, suggestion_type,
                                               programme_id, title, rationale)
    VALUES ('00000006-2222-2222-2222-222222222222', gen_random_uuid(),'CROSS_SELL',
            '00000006-aaaa-aaaa-aaaa-aaaaaaaaaaa1','x','y');
    RAISE EXCEPTION 'T6b FAIL: a cross-tenant programme suggestion was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'T6 PASS - the three deferred foreign keys are closed and composite.';
END;
$t6$;

DO $done$
BEGIN
  RAISE NOTICE 'test_006 ALL PASS (T1-T6, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
