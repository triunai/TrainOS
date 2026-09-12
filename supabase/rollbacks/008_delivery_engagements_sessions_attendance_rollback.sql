-- ============================================================================
-- ROLLBACK 008 · delivery_engagements_sessions_attendance
-- ============================================================================
--
-- Forward file: migrations/008_delivery_engagements_sessions_attendance.sql
--
-- PRIOR STATE THIS RESTORES. After 007 and before 008: `core` holds shell, sales, catalogue and money tables, and no delivery table. `core.trainer_bookings.engagement_id` and `core.portal_acceptances.engagement_id` are columns with NO foreign key, which is how 006 and 007 left them.
-- Every object below was created from nothing by 008, so there is no prior
-- definition to reproduce.
--
-- ⚠ READ FIRST: THIS DESTROYS LOCKED ATTENDANCE AND ISSUED CERTIFICATES.
--
-- Locked attendance is the evidence an HRD Corp claim rests on. The whole point
-- of 008 is that it cannot be modified; dropping the table is the one way around
-- that, which is exactly why this rollback refuses while any locked day exists.
--
-- `core.participants` holds a hash of each participant's national identity
-- number and its last four digits. Dropping it destroys the ability to match a
-- participant against the employer's own record for a claim already filed.
--
-- ⚠ THIS ALSO REOPENS TWO FOREIGN KEYS ON OTHER MIGRATIONS' TABLES -
-- `tb_engagement_fk` and `pa_engagement_fk` - returning those columns to the
-- unconstrained state 006 and 007 left them in. Correct, and not damage.
--
-- BEFORE RUNNING THIS, EXPORT:
--     COPY (SELECT * FROM core.engagements) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.sessions) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.participants) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.attendance_days) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.attendance_entries) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.certificates) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.outbound_messages) TO STDOUT WITH CSV HEADER;
--
-- ⛔ PRE-FLIGHT GUARDS, none with an override. G0 short-circuits when 008 is
-- already rolled back, so this file is safe to re-run.
--
-- DROP ORDER: children before parents, views before the tables they read,
-- functions last.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
DECLARE v_n bigint; v_extra text;
BEGIN
  IF to_regclass('core.engagements') IS NULL THEN
    RAISE NOTICE 'rollback 008: nothing to do - 008 is already rolled back.';
    RETURN;
  END IF;

  -- Any table that references one of 008's tables and is not itself 008's
  -- belongs to a later migration. Named here rather than discovered as a
  -- cascade failure halfway through the drops.
  SELECT string_agg(DISTINCT format('%I.%I', n.nspname, c.relname), ', ') INTO v_extra
  FROM pg_catalog.pg_constraint k
  JOIN pg_catalog.pg_class c     ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_class pc    ON pc.oid = k.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE k.contype = 'f'
    AND pn.nspname = 'core' AND pc.relname IN ('outbound_messages', 'message_rates', 'evaluation_responses', 'certificates', 'attendance_entries', 'attendance_days', 'participants', 'engagement_trainers', 'sessions', 'engagement_checklist_items', 'engagement_step_states', 'engagements')
    AND NOT (n.nspname = 'core' AND c.relname IN ('outbound_messages', 'message_rates', 'evaluation_responses', 'certificates', 'attendance_entries', 'attendance_days', 'participants', 'engagement_trainers', 'sessions', 'engagement_checklist_items', 'engagement_step_states', 'engagements'))
    AND k.conname NOT IN ('tb_engagement_fk', 'pa_engagement_fk');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 008 ABORTED: table(s) outside 008 still reference its tables: %. '
      'Roll those migrations back first.', v_extra
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.attendance_days WHERE status = 'LOCKED') INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 008 ABORTED: core.attendance_days holds LOCKED attendance. Locked attendance is the evidence behind an HRD Corp claim, it is immutable by rule, and dropping the table is the one way to modify it. Export it and be certain (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.certificates) INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 008 ABORTED: core.certificates records certificates issued to named participants, with their serials. A reissued certificate with a different serial is not the same certificate (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.outbound_messages WHERE status = 'SENT') INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 008 ABORTED: core.outbound_messages holds messages already sent to real people, each citing the consent row it relied on. That link is the PDPA answer to which permission a message went out under (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 008 pre-flight: clear.';
END;
$preflight$;

ALTER TABLE core.trainer_bookings   DROP CONSTRAINT IF EXISTS tb_engagement_fk;
ALTER TABLE core.portal_acceptances DROP CONSTRAINT IF EXISTS pa_engagement_fk;



DROP TABLE IF EXISTS core.outbound_messages CASCADE;
DROP TABLE IF EXISTS core.message_rates CASCADE;
DROP TABLE IF EXISTS core.evaluation_responses CASCADE;
DROP TABLE IF EXISTS core.certificates CASCADE;
DROP TABLE IF EXISTS core.attendance_entries CASCADE;
DROP TABLE IF EXISTS core.attendance_days CASCADE;
DROP TABLE IF EXISTS core.participants CASCADE;
DROP TABLE IF EXISTS core.engagement_trainers CASCADE;
DROP TABLE IF EXISTS core.sessions CASCADE;
DROP TABLE IF EXISTS core.engagement_checklist_items CASCADE;
DROP TABLE IF EXISTS core.engagement_step_states CASCADE;
DROP TABLE IF EXISTS core.engagements CASCADE;

DROP FUNCTION IF EXISTS core.enforce_attendance_entry_lock();
DROP FUNCTION IF EXISTS core.enforce_attendance_day_lock();
DROP FUNCTION IF EXISTS core.sync_engagement_trainers();
DROP FUNCTION IF EXISTS core.sync_programme_deliveries();

DO $verify$
DECLARE v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relname IN ('outbound_messages', 'message_rates', 'evaluation_responses', 'certificates', 'attendance_entries', 'attendance_days', 'participants', 'engagement_trainers', 'sessions', 'engagement_checklist_items', 'engagement_step_states', 'engagements');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 008: table(s) survived: %', v_left;
  END IF;

  -- The layers below must be intact. A rollback that quietly took one with it
  -- leaves a state no migration describes.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                 JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'app' AND p.proname = 'finalise_table') THEN
    RAISE EXCEPTION 'rollback 008: 004''s finaliser is gone - the layer below was damaged';
  END IF;

  RAISE NOTICE 'rollback 008: complete - layers below intact.';
END;
$verify$;

COMMIT;
