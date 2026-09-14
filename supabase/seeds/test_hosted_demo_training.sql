-- Pin for hosted_demo_training.sql and hosted_demo_training_wipe.sql. Ends in ROLLBACK.
--
-- Run against a database where tenant `akademi-perdana` is provisioned, all three MD
-- users are members, and hosted_demo_akademi_perdana.sql has already been applied
-- (this seed depends on its organisations and programmes):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/test_hosted_demo_training.sql
--
-- T1  seed: exact row counts for the ten tables it writes; a second run inside this
--     same pin changes nothing
-- T2  legal states only — every engagement status and trainer_bookings state this
--     seed reaches is a real value, no gated edge was skipped by writing the column
--     directly; the one LOCKED attendance day carries an approver and its two
--     capture-mode / immutable columns agree, same as 008's own CHECKs would enforce
-- T3  every owner/trainer reference is one of the three real MD ids or NULL
-- T4  024's RPCs return this seed's rows for an MD, as `authenticated` with hook claims
-- T5  wipe: zero seed rows in any of the ten tables; programmes/organisations from the
--     sales seed are untouched (row count and updated_at unchanged)

\set ON_ERROR_STOP on
BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'akademi-perdana') THEN
    RAISE EXCEPTION 'test_hosted_demo_training SETUP FAILURE: akademi-perdana is not provisioned';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.programmes p JOIN public.tenants t ON t.id = p.tenant_id
                  WHERE t.slug = 'akademi-perdana' AND p.name = 'Leading Through Change') THEN
    RAISE EXCEPTION 'test_hosted_demo_training SETUP FAILURE: run hosted_demo_akademi_perdana.sql first';
  END IF;
END
$preflight$;

\ir hosted_demo_training.sql

DO $t1$
DECLARE v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
BEGIN
  IF (SELECT count(*) FROM core.trainers WHERE tenant_id = v_t) <> 5 THEN
    RAISE EXCEPTION 'T1a FAIL: expected 5 trainers, got %', (SELECT count(*) FROM core.trainers WHERE tenant_id = v_t);
  END IF;
  IF (SELECT count(*) FROM core.engagements WHERE tenant_id = v_t) <> 6 THEN
    RAISE EXCEPTION 'T1b FAIL: expected 6 engagements, got %', (SELECT count(*) FROM core.engagements WHERE tenant_id = v_t);
  END IF;
  IF (SELECT count(*) FROM core.sessions WHERE tenant_id = v_t) <> 5 THEN
    RAISE EXCEPTION 'T1c FAIL: expected 5 sessions';
  END IF;
  IF (SELECT count(*) FROM core.participants WHERE tenant_id = v_t) <> 34 THEN
    RAISE EXCEPTION 'T1d FAIL: expected 34 participants, got %', (SELECT count(*) FROM core.participants WHERE tenant_id = v_t);
  END IF;
  IF (SELECT count(*) FROM core.attendance_days WHERE tenant_id = v_t) <> 3 THEN
    RAISE EXCEPTION 'T1e FAIL: expected 3 attendance days';
  END IF;
  IF (SELECT count(*) FROM core.attendance_entries ae JOIN core.attendance_days ad ON ad.id = ae.attendance_day_id
       WHERE ad.tenant_id = v_t) <> 38 THEN
    RAISE EXCEPTION 'T1f FAIL: expected 38 attendance entries';
  END IF;
  IF (SELECT count(*) FROM core.certificates WHERE tenant_id = v_t) <> 3 THEN
    RAISE EXCEPTION 'T1g FAIL: expected 3 certificates';
  END IF;
  IF (SELECT count(*) FROM core.trainer_bookings WHERE tenant_id = v_t) <> 2 THEN
    RAISE EXCEPTION 'T1h FAIL: expected 2 trainer bookings';
  END IF;
END
$t1$;

-- Re-run inside this same pin: idempotent, writes nothing.
CREATE TEMP TABLE t1_counts_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM core.trainers) AS trainers, (SELECT count(*) FROM core.engagements) AS engagements,
       (SELECT count(*) FROM core.participants) AS participants, (SELECT count(*) FROM core.attendance_entries) AS entries;

\ir hosted_demo_training.sql

DO $t1_idempotent$
DECLARE b RECORD;
BEGIN
  SELECT * INTO b FROM t1_counts_before;
  IF b.trainers <> (SELECT count(*) FROM core.trainers)
     OR b.engagements <> (SELECT count(*) FROM core.engagements)
     OR b.participants <> (SELECT count(*) FROM core.participants)
     OR b.entries <> (SELECT count(*) FROM core.attendance_entries) THEN
    RAISE EXCEPTION 'T1i FAIL: a second run of the seed changed a row count';
  END IF;
END
$t1_idempotent$;

DO $t2$
DECLARE v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana'); v_bad text[];
BEGIN
  SELECT array_agg(status::text) INTO v_bad FROM core.engagements
   WHERE tenant_id = v_t AND status NOT IN ('PROPOSED','CONFIRMED','SCHEDULED','IN_DELIVERY','DELIVERED','CANCELLED');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T2a FAIL: unexpected engagement status(es): %', v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM core.trainer_bookings WHERE tenant_id = v_t AND state <> 'CONFIRMED') THEN
    RAISE EXCEPTION 'T2b FAIL: expected all seeded bookings CONFIRMED';
  END IF;
  IF (SELECT count(*) FROM core.attendance_days WHERE tenant_id = v_t AND status = 'LOCKED') <> 1 THEN
    RAISE EXCEPTION 'T2c FAIL: expected exactly one LOCKED attendance day';
  END IF;
  IF EXISTS (SELECT 1 FROM core.attendance_days
              WHERE tenant_id = v_t AND status = 'LOCKED'
                AND (approved_by_id IS NULL OR NOT immutable
                     OR capture_qr OR capture_signature OR capture_manual)) THEN
    RAISE EXCEPTION 'T2d FAIL: the locked day is missing an approver or capture is not fully disabled';
  END IF;
END
$t2$;

DO $t3$
DECLARE v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana'); v_mds uuid[] :=
  ARRAY['d1449fad-b732-4ee2-93c9-37f338e01358','ad615910-2d87-42a4-9855-58f52409ec6d','415dad6e-c53f-4a84-ab50-bf8e9e65223f']::uuid[];
BEGIN
  IF EXISTS (SELECT 1 FROM core.engagements WHERE tenant_id = v_t AND owner_id <> ALL (v_mds)) THEN
    RAISE EXCEPTION 'T3 FAIL: an engagement owner is not one of the three real MDs';
  END IF;
END
$t3$;

-- T4: as an MD, through 024's RPCs.
CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid) RETURNS text
LANGUAGE sql AS $fn$
  SELECT (jsonb_build_object('sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
                             'app_role', 'MD', 'actor_kind', 'HUMAN', 'aal', 'aal1'))::text;
$fn$;

SELECT set_config('request.jwt.claims',
  pg_temp.claims('d1449fad-b732-4ee2-93c9-37f338e01358', (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana')), true);
SET LOCAL ROLE authenticated;
SELECT set_config('t.list', (SELECT core.list_engagements())::text, true);
RESET ROLE;

DO $t4$
DECLARE v jsonb := current_setting('t.list')::jsonb;
BEGIN
  IF v -> 'success' <> 'true'::jsonb THEN
    RAISE EXCEPTION 'T4a FAIL: list_engagements did not succeed for an MD: %', v;
  END IF;
  IF jsonb_array_length(v #> '{data,data}') <> 6 THEN
    RAISE EXCEPTION 'T4b FAIL: MD should see all 6 seeded engagements, got %', jsonb_array_length(v #> '{data,data}');
  END IF;
END
$t4$;

\ir hosted_demo_training_wipe.sql

DO $t5$
DECLARE v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
BEGIN
  IF (SELECT count(*) FROM core.trainers WHERE tenant_id = v_t) <> 0
     OR (SELECT count(*) FROM core.engagements WHERE tenant_id = v_t) <> 0
     OR (SELECT count(*) FROM core.participants WHERE tenant_id = v_t) <> 0
     OR (SELECT count(*) FROM core.attendance_days WHERE tenant_id = v_t) <> 0
     OR (SELECT count(*) FROM core.certificates WHERE tenant_id = v_t) <> 0 THEN
    RAISE EXCEPTION 'T5a FAIL: a training-seed row survived the wipe';
  END IF;
  IF (SELECT count(*) FROM core.programmes WHERE tenant_id = v_t) <> 5
     OR (SELECT count(*) FROM core.organisations WHERE tenant_id = v_t) <> 6 THEN
    RAISE EXCEPTION 'T5b FAIL: the wipe touched a row it does not own (sales seed programmes/organisations)';
  END IF;
END
$t5$;

ROLLBACK;
