-- Removes exactly the rows supabase/seeds/hosted_demo_training.sql added to tenant
-- `akademi-perdana`, and nothing else.
--
-- Run:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_training_wipe.sql
--
-- Seed rows share hosted_demo_akademi_perdana.sql's id range (de30da7a-5eed-4xxx-…) but
-- this wipe is scoped to the SEVEN TABLES ONLY that seed writes to (trainers, programme_trainers,
-- engagements, sessions, trainer_bookings, participants, attendance_days, attendance_entries,
-- certificates, engagement_checklist_items) — none of which hosted_demo_akademi_perdana.sql or
-- its own wipe touches, and nothing outside this seed references a row this seed writes (no
-- other pack's FK points at core.trainers, core.engagements, core.participants, etc. from a
-- table this wipe does not already own). Deletes run children before parents.
--
-- Not reverted, by design: core.ref_sequences. Allocated refs are never reused (004), so
-- after a wipe the next engagement/session/participant/trainer/certificate is numbered after
-- the demo ones rather than colliding with anything already shown or shared.

DROP TABLE IF EXISTS pg_temp.demo_wipe_ctx;
CREATE TEMP TABLE demo_wipe_ctx ON COMMIT DROP AS
SELECT tenant.id AS t, 'de30da7a-5eed-4%'::text AS marker
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM demo_wipe_ctx) <> 1 THEN
    RAISE EXCEPTION 'hosted training wipe: tenant akademi-perdana not found';
  END IF;
END
$guard$;

-- GOV-07: the seed's one LOCKED day must be unlocked (ATTENDANCE_UNLOCK, with a
-- reason — the lock is one-way, contract §8) before its entries can be deleted;
-- 008's `trg_attendance_entries_lock` refuses a delete on a locked day same as
-- a write. Same gate rig the seed itself uses.
CREATE OR REPLACE FUNCTION pg_temp.gate(p_tenant uuid, p_type text, p_target uuid)
RETURNS void LANGUAGE plpgsql AS $gate$
DECLARE v_id uuid;
BEGIN
  INSERT INTO core.action_requests
    (tenant_id, action_type, target_id, status, requested_by_kind, requested_by_id)
  VALUES (p_tenant, p_type, p_target, 'EXECUTING', 'SYSTEM', 'hosted-demo-training-wipe')
  RETURNING id INTO v_id;
  PERFORM set_config('app.effect_applier', v_id::text, true);
END $gate$;

CREATE OR REPLACE FUNCTION pg_temp.ungate() RETURNS void LANGUAGE plpgsql AS $ungate$
BEGIN
  PERFORM set_config('app.effect_applier', '', true);
END $ungate$;

DO $unlock$
DECLARE v_t uuid := (SELECT t FROM demo_wipe_ctx); v_day uuid;
BEGIN
  FOR v_day IN
    SELECT id FROM core.attendance_days
     WHERE tenant_id = v_t AND id::text LIKE (SELECT marker FROM demo_wipe_ctx) AND status = 'LOCKED'
  LOOP
    PERFORM pg_temp.gate(v_t, 'ATTENDANCE_UNLOCK', v_day);
    UPDATE core.attendance_days
       SET status = 'OPEN', unlock_reason = 'hosted demo wipe: removing seed data'
     WHERE id = v_day;
    PERFORM pg_temp.ungate();
  END LOOP;
END
$unlock$;

DELETE FROM core.engagement_checklist_items
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
DELETE FROM core.certificates
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
DELETE FROM core.attendance_entries
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
DELETE FROM core.attendance_days
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
DELETE FROM core.participants
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
DELETE FROM core.trainer_bookings
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
DELETE FROM core.trainer_availability
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx)
   AND trainer_id IN (SELECT id FROM core.trainers WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx));
DELETE FROM core.sessions
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
DELETE FROM core.engagement_step_states
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx)
   AND engagement_id IN (SELECT id FROM core.engagements WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx));
DELETE FROM core.engagements
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
DELETE FROM core.programme_trainers
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
DELETE FROM core.trainers
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);

DO $verify$
DECLARE v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM core.trainers
   WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id::text LIKE (SELECT marker FROM demo_wipe_ctx);
  IF v_left > 0 THEN
    RAISE EXCEPTION 'hosted training wipe: % trainer row(s) survived — a later pack may reference them', v_left;
  END IF;
END
$verify$;
