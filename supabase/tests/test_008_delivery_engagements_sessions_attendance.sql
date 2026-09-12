-- ============================================================================
-- PIN 008 · delivery_engagements_sessions_attendance
-- ============================================================================
--
-- Run only AFTER 008. Ends in ROLLBACK.
--   psql "$DATABASE_URL" -f supabase/tests/test_008_delivery_engagements_sessions_attendance.sql
--
-- WHAT THIS PIN IS FOR. The attendance lock, exercised from every direction a
-- real caller could come at it. T3 is the one that matters most and is the one
-- a parent-only implementation fails: MARKS on a locked day must be
-- unwriteable, not just the day's own approval columns. A lock that protects
-- the header and leaves the rows editable looks correct in every diff and
-- protects nothing HRD Corp cares about.
--
-- T6 is the second: unlocking must be impossible without a reason, must
-- increment a counter the CALLER cannot set, and must reopen capture. A day
-- that has been unlocked is not the same as a day never locked, and that
-- counter is how a compliance review tells them apart.
--
-- RUNNABILITY NOTES
-- 1. Runs as the migration role; RLS is forced with no policies until 014.
-- 2. Fixtures build a whole engagement, because attendance cannot exist without
--    one and a shortcut fixture would test a shape the product never produces.
-- 3. Fixture ids namespaced `00000008-`.
-- 4. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_008 SETUP FAILURE: check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF to_regclass('core.attendance_entries') IS NULL THEN
    RAISE EXCEPTION 'test_008 SETUP FAILURE: 008 is missing or partial.';
  END IF;
END;
$setup$;

INSERT INTO auth.users (id, email) VALUES
  ('00000008-0000-0000-0000-0000000000a1','t008-siti@example.invalid');
INSERT INTO public.tenants (id, slug, name) VALUES
  ('00000008-1111-1111-1111-111111111111','t008-alpha','Alpha');
INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width)
SELECT '00000008-1111-1111-1111-111111111111', p, e, false, 4
FROM (VALUES ('ORG','organisations'),('PRG','programmes'),('PIP','pipelines'),
             ('ENG','engagements'),('SES','sessions'),('PAR','participants'),
             ('TRN','trainers'),('CRT','certificates'),('MSG','outbound_messages')) AS x(p,e);

INSERT INTO core.organisations (id, tenant_id, name, owner_id)
VALUES ('00000008-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000008-1111-1111-1111-111111111111',
        'Aurora Manufacturing Sdn Bhd','00000008-0000-0000-0000-0000000000a1');
INSERT INTO core.programmes (id, tenant_id, name, category, days, list_price_sen,
                             list_price_pax, floor_price_sen, floor_margin_rate, status)
VALUES ('00000008-0ddd-0ddd-0ddd-0ddddddddde1','00000008-1111-1111-1111-111111111111',
        'Leading Through Change','LEADERSHIP',2,1850000,30,1390000,0.3500,'ACTIVE');
INSERT INTO core.pipelines (id, tenant_id, object, name, is_default, status)
VALUES ('00000008-0eee-0eee-0eee-0eeeeeeeeee1','00000008-1111-1111-1111-111111111111',
        'ENGAGEMENT','Standard delivery', true,'ACTIVE');
INSERT INTO core.trainers (id, tenant_id, name, ttt_certified, ttt_ref)
VALUES ('00000008-7a11-7a11-7a11-7a1100000001','00000008-1111-1111-1111-111111111111',
        'Farah Aziz', true,'TTT-2019-4471');

INSERT INTO core.engagements (id, tenant_id, organisation_id, programme_id, owner_id,
                              pipeline_id, title, status, starts_on, ends_on, value_sen)
VALUES ('00000008-0fff-0fff-0fff-0fffffffffe1','00000008-1111-1111-1111-111111111111',
        '00000008-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000008-0ddd-0ddd-0ddd-0ddddddddde1',
        '00000008-0000-0000-0000-0000000000a1','00000008-0eee-0eee-0eee-0eeeeeeeeee1',
        'Leading Through Change','SCHEDULED','2026-11-12','2026-11-13',1850000);

INSERT INTO core.participants (id, tenant_id, engagement_id, name, department)
VALUES ('00000008-9a71-9a71-9a71-9a7100000001','00000008-1111-1111-1111-111111111111',
        '00000008-0fff-0fff-0fff-0fffffffffe1','Ahmad Firdaus','Production'),
       ('00000008-9a71-9a71-9a71-9a7100000002','00000008-1111-1111-1111-111111111111',
        '00000008-0fff-0fff-0fff-0fffffffffe1','Nur Aisyah','Logistics');

INSERT INTO core.attendance_days (id, tenant_id, engagement_id, day, on_date)
VALUES ('00000008-ad00-ad00-ad00-ad0000000001','00000008-1111-1111-1111-111111111111',
        '00000008-0fff-0fff-0fff-0fffffffffe1', 1, '2026-11-12');

-- === T1 · an absence needs a reason; a presence needs a method ==============
DO $t1$
BEGIN
  BEGIN
    INSERT INTO core.attendance_entries (tenant_id, attendance_day_id, participant_id, half, present)
    VALUES ('00000008-1111-1111-1111-111111111111','00000008-ad00-ad00-ad00-ad0000000001',
            '00000008-9a71-9a71-9a71-9a7100000002','AM', false);
    RAISE EXCEPTION
      'T1a FAIL: an absence with no reason was accepted. That is the row HRD Corp '
      'asks about.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO core.attendance_entries (tenant_id, attendance_day_id, participant_id, half, present)
    VALUES ('00000008-1111-1111-1111-111111111111','00000008-ad00-ad00-ad00-ad0000000001',
            '00000008-9a71-9a71-9a71-9a7100000001','AM', true);
    RAISE EXCEPTION 'T1b FAIL: a presence with no capture method or timestamp was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T1 PASS - presence needs a method, absence needs a reason.';
END;
$t1$;

-- valid marks
INSERT INTO core.attendance_entries (tenant_id, attendance_day_id, participant_id, half,
                                     present, marked_at, method) VALUES
  ('00000008-1111-1111-1111-111111111111','00000008-ad00-ad00-ad00-ad0000000001',
   '00000008-9a71-9a71-9a71-9a7100000001','AM', true,'2026-11-12T09:02:00+08:00','QR'),
  ('00000008-1111-1111-1111-111111111111','00000008-ad00-ad00-ad00-ad0000000001',
   '00000008-9a71-9a71-9a71-9a7100000001','PM', true,'2026-11-12T14:05:00+08:00','QR');
INSERT INTO core.attendance_entries (tenant_id, attendance_day_id, participant_id, half,
                                     present, absence_reason) VALUES
  ('00000008-1111-1111-1111-111111111111','00000008-ad00-ad00-ad00-ad0000000001',
   '00000008-9a71-9a71-9a71-9a7100000002','AM', false,'MEDICAL_LEAVE');

-- === T2 · locking closes capture and sets immutable, without being asked ====
DO $t2$
DECLARE r record;
BEGIN
  UPDATE core.attendance_days
     SET status = 'LOCKED', approved_by_kind = 'HUMAN', approved_by_id = 't_farah',
         approved_by_name = 'Farah Aziz'
   WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';

  SELECT * INTO r FROM core.attendance_days WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';
  ASSERT r.immutable, 'T2a FAIL: immutable did not follow status';
  ASSERT r.approved_at IS NOT NULL, 'T2b FAIL: approved_at was not stamped';
  ASSERT NOT r.capture_qr AND NOT r.capture_signature AND NOT r.capture_manual,
    'T2c FAIL: capture modes are still true on a locked day. The contract says all '
    'three are false while locked, and the UI disables from the response.';
  RAISE NOTICE 'T2 PASS - locking stamps the approval and closes all three capture modes.';
END;
$t2$;

-- === T3 · THE ONE A PARENT-ONLY LOCK FAILS =================================
--     Marks on a locked day must be unwriteable. Insert, update AND delete.
DO $t3$
BEGIN
  BEGIN
    UPDATE core.attendance_entries SET present = false, absence_reason = 'NO_SHOW'
     WHERE attendance_day_id = '00000008-ad00-ad00-ad00-ad0000000001'
       AND participant_id = '00000008-9a71-9a71-9a71-9a7100000001' AND half = 'AM';
    RAISE EXCEPTION
      'T3a FAIL: a mark on a LOCKED day was rewritten. The lock protects the header '
      'and leaves every row editable - which looks correct in a diff and protects '
      'nothing HRD Corp cares about.';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO core.attendance_entries (tenant_id, attendance_day_id, participant_id, half,
                                         present, marked_at, method)
    VALUES ('00000008-1111-1111-1111-111111111111','00000008-ad00-ad00-ad00-ad0000000001',
            '00000008-9a71-9a71-9a71-9a7100000002','PM', true, now(),'MANUAL');
    RAISE EXCEPTION 'T3b FAIL: a new mark was added to a LOCKED day';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM core.attendance_entries
     WHERE attendance_day_id = '00000008-ad00-ad00-ad00-ad0000000001'
       AND participant_id = '00000008-9a71-9a71-9a71-9a7100000002';
    RAISE EXCEPTION 'T3c FAIL: a mark was DELETED from a LOCKED day';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
  RAISE NOTICE 'T3 PASS - no insert, update or delete of a mark on a locked day.';
END;
$t3$;

-- === T4 · the locked day's own columns freeze too ===========================
DO $t4$
BEGIN
  BEGIN
    UPDATE core.attendance_days SET approved_by_name = 'Somebody Else'
     WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';
    RAISE EXCEPTION 'T4a FAIL: the approver on a locked day was rewritten';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;

  BEGIN
    UPDATE core.attendance_days SET capture_manual = true
     WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';
    RAISE EXCEPTION 'T4b FAIL: capture was re-enabled on a locked day without unlocking';
  EXCEPTION WHEN integrity_constraint_violation OR check_violation THEN NULL;
  END;
  RAISE NOTICE 'T4 PASS - a locked day''s own columns are frozen.';
END;
$t4$;

-- === T5 · a lock with no approver is refused ================================
DO $t5$
DECLARE v_day uuid;
BEGIN
  INSERT INTO core.attendance_days (tenant_id, engagement_id, day, on_date)
  VALUES ('00000008-1111-1111-1111-111111111111','00000008-0fff-0fff-0fff-0fffffffffe1',
          2,'2026-11-13')
  RETURNING id INTO v_day;

  BEGIN
    UPDATE core.attendance_days SET status = 'LOCKED' WHERE id = v_day;
    RAISE EXCEPTION
      'T5 FAIL: a day was locked with no approver. Nobody is accountable for the '
      'attendance HRD Corp is being asked to accept.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T5 PASS - locking requires a named approver.';
END;
$t5$;

-- === T6 · unlocking needs a reason, counts itself, and reopens capture ======
DO $t6$
DECLARE r record;
BEGIN
  BEGIN
    UPDATE core.attendance_days SET status = 'OPEN'
     WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';
    RAISE EXCEPTION
      'T6a FAIL: attendance was unlocked with no reason. Unlocking voids the HRD '
      'Corp claim packet and must say why.';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;

  UPDATE core.attendance_days
     SET status = 'OPEN', unlock_reason = 'Participant added after approval'
   WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';

  SELECT * INTO r FROM core.attendance_days WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';
  ASSERT r.unlock_count = 1,
    format('T6b FAIL: unlock_count is %s, expected 1', r.unlock_count);
  ASSERT r.unlocked_at IS NOT NULL, 'T6c FAIL: unlocked_at was not stamped';
  ASSERT NOT r.immutable, 'T6d FAIL: the day is still immutable after unlocking';
  ASSERT r.capture_qr AND r.capture_signature AND r.capture_manual,
    'T6e FAIL: capture did not reopen with the day';
  ASSERT r.approved_at IS NULL AND r.approved_by_id IS NULL,
    'T6f FAIL: the old approval survived the unlock, so the day still looks approved';

  -- and marks are writeable again
  UPDATE core.attendance_entries SET present = false, marked_at = NULL, method = NULL,
                                     absence_reason = 'WORK_CONFLICT'
   WHERE attendance_day_id = '00000008-ad00-ad00-ad00-ad0000000001'
     AND participant_id = '00000008-9a71-9a71-9a71-9a7100000001' AND half = 'AM';

  -- the CALLER cannot set the count: re-lock and unlock again, it must reach 2
  UPDATE core.attendance_days
     SET status = 'LOCKED', approved_by_kind = 'HUMAN', approved_by_id = 't_farah',
         approved_by_name = 'Farah Aziz'
   WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';
  UPDATE core.attendance_days
     SET status = 'OPEN', unlock_reason = 'again', unlock_count = 0
   WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';

  SELECT unlock_count INTO r FROM core.attendance_days
  WHERE id = '00000008-ad00-ad00-ad00-ad0000000001';
  ASSERT r.unlock_count = 2,
    format('T6g FAIL: the caller reset unlock_count to %s. The one hand that unlocks '
           'can now erase the evidence that it did.', r.unlock_count);
  RAISE NOTICE 'T6 PASS - unlock needs a reason, counts itself, reopens capture, clears approval.';
END;
$t6$;

-- === T7 · engagement_trainers is a projection with one writer ===============
DO $t7$
DECLARE v_n int; v_s uuid;
BEGIN
  INSERT INTO core.sessions (id, tenant_id, engagement_id, trainer_id, day, on_date, title)
  VALUES (gen_random_uuid(),'00000008-1111-1111-1111-111111111111',
          '00000008-0fff-0fff-0fff-0fffffffffe1','00000008-7a11-7a11-7a11-7a1100000001',
          1,'2026-11-12','Escalation & conflict')
  RETURNING id INTO v_s;

  SELECT count(*) INTO v_n FROM core.engagement_trainers
  WHERE engagement_id = '00000008-0fff-0fff-0fff-0fffffffffe1'
    AND trainer_id = '00000008-7a11-7a11-7a11-7a1100000001';
  ASSERT v_n = 1,
    'T7a FAIL: scheduling a session did not assign the trainer to the engagement. '
    'The trainer-scoped policy will not show them their own delivery.';

  DELETE FROM core.sessions WHERE id = v_s;
  SELECT count(*) INTO v_n FROM core.engagement_trainers
  WHERE engagement_id = '00000008-0fff-0fff-0fff-0fffffffffe1'
    AND trainer_id = '00000008-7a11-7a11-7a11-7a1100000001';
  ASSERT v_n = 0,
    'T7b FAIL: removing the trainer''s LAST session left them assigned. The policy '
    'keeps showing them an engagement they are no longer on.';
  RAISE NOTICE 'T7 PASS - the trainer projection follows sessions in both directions.';
END;
$t7$;

-- === T8 · a sent message must cite the consent it relied on =================
DO $t8$
BEGIN
  BEGIN
    INSERT INTO core.outbound_messages (tenant_id, purpose, channel, to_address, body,
                                        status, sent_at)
    VALUES ('00000008-1111-1111-1111-111111111111','FOLLOWUP','WHATSAPP',
            '+60123456789','Hi Puan Nurul...','SENT', now());
    RAISE EXCEPTION
      'T8 FAIL: a message was marked SENT with no consent row behind it. PDPA asks '
      'which permission it went out under, and there is now no answer that cannot be '
      'reconstructed favourably.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T8 PASS - a sent message cites the consent row by id.';
END;
$t8$;

-- === T9 · the delivery count follows the engagement ========================
DO $t9$
DECLARE v_n int;
BEGIN
  UPDATE core.engagements SET status = 'DELIVERED'
   WHERE id = '00000008-0fff-0fff-0fff-0fffffffffe1';
  SELECT deliveries_count INTO v_n FROM core.programmes
  WHERE id = '00000008-0ddd-0ddd-0ddd-0ddddddddde1';
  ASSERT v_n = 1, format('T9a FAIL: deliveries_count is %s, expected 1', v_n);

  UPDATE core.engagements SET status = 'CANCELLED'
   WHERE id = '00000008-0fff-0fff-0fff-0fffffffffe1';
  SELECT deliveries_count INTO v_n FROM core.programmes
  WHERE id = '00000008-0ddd-0ddd-0ddd-0ddddddddde1';
  ASSERT v_n = 0, format('T9b FAIL: deliveries_count is %s after cancellation, expected 0', v_n);
  RAISE NOTICE 'T9 PASS - the delivery count moves both ways.';
END;
$t9$;

DO $done$
BEGIN
  RAISE NOTICE 'test_008 ALL PASS (T1-T9, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
