-- ═══════════════════════════════════════════════════════════════════════════
-- PIN 024 · training delivery — engagements, participants, attendance,
-- the programme catalogue write
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001–024. Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_024_training_delivery.sql
--
-- IMPERSONATION IS REAL, same rig as test_021: `request.jwt.claims` is set,
-- then `SET LOCAL ROLE authenticated` for the call, then `RESET ROLE` before
-- any assertion — assertions never run under an impersonated role.
--
-- T1  ADMIN reads `list_engagements`/`get_engagement` and gets the contract's
--     keys back, `finance` included (ADMIN holds `quotation:read`).
-- T2  OPS reads the same engagement WITHOUT `finance` (R7: dropped, not
--     zeroed) — OPS does not hold `quotation:read` (002 §11).
-- T3  CLIENT (a tenant claim, no staff permission) is FORBIDDEN on all seven,
--     with `requiredPermission`/`requiredRole`, before any id is looked at:
--     a real id and an invented one answer identically.
-- T4  `anon` cannot execute any of the seven — 42501 from the grant itself,
--     not from a body check (proves the REVOKE, not a runtime branch).
-- T5  Cross-tenant: an ADMIN of tenant B reads tenant A's engagement ref and
--     gets NOT_FOUND, not the row (non-enumerable, matches 018/021's rule).
-- T6  Attendance walk: OPEN day accepts a present mark and an absent mark
--     (defaulted reason `OTHER` when the caller sends none); a LOCKED day
--     refuses capture with the contract's `AttendanceLockedDetails` shape,
--     not the trigger's generic text.
-- T7  `put_programme`: ADMIN's write lands and is read back through
--     `core.get_programme`; OPS is FORBIDDEN with `requiredRole: 'ADMIN'`.
-- T8  `export_attendance`: TRAINER (holding the review-mandated
--     `attendance:export` grant) succeeds on an engagement they can see; the
--     response carries `status` (the latest attendance day's status) and
--     `snapshotAt`.
-- T9  `capture_attendance` is scope-narrowed for TRAINER: one assigned to the
--     engagement (via `core.engagement_trainers`) succeeds; one not assigned
--     is FORBIDDEN, non-enumerable — the same response for a real engagement
--     id (not theirs) and a fabricated one, mirroring T3's non-enumerability
--     pattern.
-- T10 Teeth check for T3: `core.get_engagement`'s gate, no other function's,
--     is proven load-bearing by disabling only its own `has_permission` call
--     — the live body captured with `pg_get_functiondef` and surgically cut
--     with `regexp_replace`, never a hand-copied duplicate of the function —
--     and observing the same CLIENT principal read data it was refused a
--     moment before, then restoring the original body byte-for-byte (from
--     the SAME captured text) before a fresh CLIENT call proves the gate is
--     back.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

-- ── Helpers, copied from test_021 (same shape, so the two pins read alike) ──

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text,
                               p_kind text DEFAULT 'HUMAN')
RETURNS text
LANGUAGE sql AS $fn$
  SELECT (pg_catalog.jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', p_kind, 'aal', 'aal1'))::text;
$fn$;

-- Same as `pg_temp.claims`, TRAINER-shaped: carries `trainer_id`, the claim
-- `app.trainer_id()` (002:388) reads — nothing else in this file's fixtures
-- needs it, so it is a separate helper rather than an optional param bolted
-- onto every other call site.
CREATE FUNCTION pg_temp.trainer_claims(p_user uuid, p_tenant uuid, p_trainer uuid)
RETURNS text
LANGUAGE sql AS $fn$
  SELECT (pg_catalog.jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', 'TRAINER', 'actor_kind', 'HUMAN', 'aal', 'aal1',
    'trainer_id', p_trainer))::text;
$fn$;

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; v_detail text;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'value', v);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE,
    'message', SQLERRM, 'detail', v_detail);
END;
$fn$;

CREATE FUNCTION pg_temp.code(p jsonb) RETURNS text
LANGUAGE sql AS $fn$
  SELECT CASE WHEN p -> 'ok' = 'true'::jsonb THEN p #>> '{value,error,code}'
              WHEN p ->> 'sqlstate' = 'TRNOS' THEN (p ->> 'detail')::jsonb ->> 'code'
              ELSE 'SQLSTATE ' || (p ->> 'sqlstate') END;
$fn$;

-- GOV-07 fixture helper, copied from test_008: 011 attaches
-- `app.enforce_state_transition` to every gated column, so a direct UPDATE
-- into a gated edge (here, `attendance_days.status` OPEN -> LOCKED) is refused
-- unless it runs as the effect applier of an EXECUTING action request of a
-- gating type, against that row.
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

CREATE FUNCTION pg_temp.ungate() RETURNS void LANGUAGE plpgsql AS $ungate$
BEGIN
  PERFORM set_config('app.effect_applier', '', true);
END $ungate$;

SET LOCAL plpgsql.check_asserts = on;
DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_024 SETUP FAILURE: check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF pg_catalog.to_regprocedure('core.list_engagements(jsonb,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'test_024 SETUP FAILURE: 024 is missing or partial.';
  END IF;
END;
$setup$;

-- ── Fixtures: tenant A (the one under test) ──────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('a0240000-0000-4000-8000-0000000000a1','t024-admin@example.invalid'),
  ('a0240000-0000-4000-8000-0000000000a2','t024-ops@example.invalid'),
  ('a0240000-0000-4000-8000-0000000000a3','t024-client@example.invalid');

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a0240000-1111-4000-8000-000000000001','t024-alpha','Alpha 024');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0240000-1111-4000-8000-000000000001','a0240000-0000-4000-8000-0000000000a1','ADMIN','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0240000-1111-4000-8000-000000000001','a0240000-0000-4000-8000-0000000000a2','OPS','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0240000-1111-4000-8000-000000000001','a0240000-0000-4000-8000-0000000000a3','CLIENT','CLIENT','ALL','ALL',false,'ACTIVE',true);

INSERT INTO core.organisations (id, tenant_id, name, owner_id)
VALUES ('a0240000-2222-4000-8000-000000000001','a0240000-1111-4000-8000-000000000001',
        'Aurora Manufacturing Sdn Bhd','a0240000-0000-4000-8000-0000000000a1');

INSERT INTO core.programmes (id, tenant_id, name, category, days, list_price_sen,
                             list_price_pax, floor_price_sen, floor_margin_rate, status)
VALUES ('a0240000-3333-4000-8000-000000000001','a0240000-1111-4000-8000-000000000001',
        'Leading Through Change','LEADERSHIP',2,1850000,30,1390000,0.3500,'ACTIVE');

INSERT INTO core.pipelines (id, tenant_id, object, name, is_default, status)
VALUES ('a0240000-4444-4000-8000-000000000001','a0240000-1111-4000-8000-000000000001',
        'ENGAGEMENT','Standard delivery', false,'ACTIVE');
INSERT INTO core.pipeline_steps (id, tenant_id, pipeline_id, step_key, label, position, terminal)
VALUES
  ('a0240000-4444-4000-8000-00000000e001','a0240000-1111-4000-8000-000000000001',
   'a0240000-4444-4000-8000-000000000001','SCHEDULED','Scheduled',1,false),
  ('a0240000-4444-4000-8000-00000000e002','a0240000-1111-4000-8000-000000000001',
   'a0240000-4444-4000-8000-000000000001','DELIVERED','Delivered',2,true);

INSERT INTO core.trainers (id, tenant_id, name, ttt_certified, ttt_ref)
VALUES ('a0240000-5555-4000-8000-000000000001','a0240000-1111-4000-8000-000000000001',
        'Farah Aziz', true,'TTT-2019-4471');

INSERT INTO core.engagements (id, tenant_id, organisation_id, programme_id, owner_id,
                              pipeline_id, title, starts_on, ends_on, value_sen)
VALUES ('a0240000-6666-4000-8000-000000000001','a0240000-1111-4000-8000-000000000001',
        'a0240000-2222-4000-8000-000000000001','a0240000-3333-4000-8000-000000000001',
        'a0240000-0000-4000-8000-0000000000a1','a0240000-4444-4000-8000-000000000001',
        'Leading Through Change','2026-11-12','2026-11-13',1850000);
-- PROPOSED -> CONFIRMED -> SCHEDULED, both ungated (011's state_transitions).
UPDATE core.engagements SET status = 'CONFIRMED' WHERE id = 'a0240000-6666-4000-8000-000000000001';
UPDATE core.engagements SET status = 'SCHEDULED' WHERE id = 'a0240000-6666-4000-8000-000000000001';

INSERT INTO core.engagement_step_states (tenant_id, engagement_id, pipeline_step_id, state, at)
VALUES ('a0240000-1111-4000-8000-000000000001','a0240000-6666-4000-8000-000000000001',
        'a0240000-4444-4000-8000-00000000e001','CURRENT', pg_catalog.now());

INSERT INTO core.sessions (id, tenant_id, engagement_id, trainer_id, day, on_date, title)
VALUES ('a0240000-7777-4000-8000-000000000001','a0240000-1111-4000-8000-000000000001',
        'a0240000-6666-4000-8000-000000000001','a0240000-5555-4000-8000-000000000001',
        1,'2026-11-12','Day 1');

INSERT INTO core.participants (id, tenant_id, engagement_id, name, department)
VALUES
  ('a0240000-8888-4000-8000-000000000001','a0240000-1111-4000-8000-000000000001',
   'a0240000-6666-4000-8000-000000000001','Ahmad Firdaus','Production'),
  ('a0240000-8888-4000-8000-000000000002','a0240000-1111-4000-8000-000000000001',
   'a0240000-6666-4000-8000-000000000001','Nur Aisyah','Logistics');

INSERT INTO core.attendance_days (id, tenant_id, engagement_id, day, on_date)
VALUES ('a0240000-9999-4000-8000-000000000001','a0240000-1111-4000-8000-000000000001',
        'a0240000-6666-4000-8000-000000000001', 1, '2026-11-12');

-- Day 2, kept OPEN throughout this pin (T6 locks day 1, not day 2) so T8/T9's
-- TRAINER capture probes — which run after T6 — have a day that still
-- accepts a write, and so `export_attendance`'s "latest day" status (T8) has
-- a deterministic OPEN answer regardless of where T8 runs relative to T6.
INSERT INTO core.attendance_days (id, tenant_id, engagement_id, day, on_date)
VALUES ('a0240000-9999-4000-8000-000000000002','a0240000-1111-4000-8000-000000000001',
        'a0240000-6666-4000-8000-000000000001', 2, '2026-11-13');

-- ── Fixtures: a second TRAINER, NOT assigned to the tenant-A engagement,
--    for T9's non-enumerability probe. `Farah Aziz` (already a core.trainers
--    row, above) is assigned via session 1's `trainer_id` (the trigger
--    mirrors it into `core.engagement_trainers`, 008:608-611); this one
--    is not.
INSERT INTO core.trainers (id, tenant_id, name, ttt_certified, ttt_ref)
VALUES ('a0240000-5555-4000-8000-000000000002','a0240000-1111-4000-8000-000000000001',
        'Zul Hakim', true,'TTT-2021-5582');

-- Staff logins for both trainers (T8/T9 impersonate these, not the
-- `core.trainers` rows themselves — `app.trainer_id()` reads the JWT claim,
-- so the login and the `core.trainers` row are linked only by that claim,
-- same as `user_id` links them for real, here set for realism).
INSERT INTO auth.users (id, email) VALUES
  ('a0240000-0000-4000-8000-0000000000a4','t024-trainer-farah@example.invalid'),
  ('a0240000-0000-4000-8000-0000000000a5','t024-trainer-zul@example.invalid');
UPDATE core.trainers SET user_id = 'a0240000-0000-4000-8000-0000000000a4'
 WHERE id = 'a0240000-5555-4000-8000-000000000001';
UPDATE core.trainers SET user_id = 'a0240000-0000-4000-8000-0000000000a5'
 WHERE id = 'a0240000-5555-4000-8000-000000000002';
INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,trainer_id,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0240000-1111-4000-8000-000000000001','a0240000-0000-4000-8000-0000000000a4','TRAINER','HUMAN',
   'a0240000-5555-4000-8000-000000000001','ALL','ALL',false,'ACTIVE',true),
  ('a0240000-1111-4000-8000-000000000001','a0240000-0000-4000-8000-0000000000a5','TRAINER','HUMAN',
   'a0240000-5555-4000-8000-000000000002','ALL','ALL',false,'ACTIVE',true);

-- ── Fixtures: tenant B, ADMIN only, for T5 (cross-tenant) ────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('b0240000-0000-4000-8000-0000000000b1','t024-b-admin@example.invalid');
INSERT INTO public.tenants (id, slug, name) VALUES
  ('b0240000-1111-4000-8000-000000000001','t024-beta','Beta 024');
INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('b0240000-1111-4000-8000-000000000001','b0240000-0000-4000-8000-0000000000b1','ADMIN','HUMAN','ALL','ALL',false,'ACTIVE',true);

-- ════════ T1 · ADMIN reads real data, finance included ════════════════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0240000-0000-4000-8000-0000000000a1','a0240000-1111-4000-8000-000000000001','ADMIN'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.admin_list', pg_temp.try($$SELECT core.list_engagements()$$)::text, true);
SELECT pg_catalog.set_config('t024.admin_get', pg_temp.try($$SELECT core.get_engagement('a0240000-6666-4000-8000-000000000001')$$)::text, true);
SELECT pg_catalog.set_config('t024.admin_parts', pg_temp.try($$SELECT core.get_engagement_participants('a0240000-6666-4000-8000-000000000001')$$)::text, true);
RESET ROLE;

DO $t1$
DECLARE
  v_list  jsonb := pg_catalog.current_setting('t024.admin_list')::jsonb;
  v_get   jsonb := pg_catalog.current_setting('t024.admin_get')::jsonb;
  v_parts jsonb := pg_catalog.current_setting('t024.admin_parts')::jsonb;
  v_eng   jsonb;
BEGIN
  IF NOT (v_list ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'T1a FAIL: ADMIN list_engagements did not succeed: %', v_list;
  END IF;
  IF pg_catalog.jsonb_array_length(v_list #> '{value,data,data}') < 1 THEN
    RAISE EXCEPTION 'T1b FAIL: ADMIN sees no engagements: %', v_list;
  END IF;

  v_eng := v_get #> '{value,data}';
  IF v_eng IS NULL OR v_eng ->> 'ref' IS NULL THEN
    RAISE EXCEPTION 'T1c FAIL: get_engagement did not return a record: %', v_get;
  END IF;
  IF v_eng ->> 'title' IS DISTINCT FROM 'Leading Through Change'
     OR v_eng ->> 'status' IS DISTINCT FROM 'SCHEDULED'
     OR (v_eng -> 'metrics' ->> 'participants')::int <> 2 THEN
    RAISE EXCEPTION 'T1d FAIL: get_engagement shape wrong: %', v_eng;
  END IF;
  IF NOT (v_eng ? 'finance') THEN
    RAISE EXCEPTION 'T1e FAIL: ADMIN (holds quotation:read) should see finance: %', v_eng;
  END IF;
  IF pg_catalog.jsonb_array_length(v_eng -> 'lifecycle') <> 2
     OR v_eng -> 'lifecycle' -> 0 ->> 'key' IS DISTINCT FROM 'SCHEDULED'
     OR v_eng -> 'lifecycle' -> 0 ->> 'state' IS DISTINCT FROM 'CURRENT' THEN
    RAISE EXCEPTION 'T1f FAIL: lifecycle not rendered from pipeline_steps in position order: %', v_eng -> 'lifecycle';
  END IF;

  IF NOT (v_parts ->> 'ok')::boolean OR pg_catalog.jsonb_array_length(v_parts #> '{value,data,data}') <> 2 THEN
    RAISE EXCEPTION 'T1g FAIL: get_engagement_participants did not return both participants: %', v_parts;
  END IF;
END
$t1$;

-- ════════ T2 · OPS reads the same engagement WITHOUT finance (R7) ══════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0240000-0000-4000-8000-0000000000a2','a0240000-1111-4000-8000-000000000001','OPS'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.ops_get', pg_temp.try($$SELECT core.get_engagement('a0240000-6666-4000-8000-000000000001')$$)::text, true);
RESET ROLE;

DO $t2$
DECLARE v jsonb := pg_catalog.current_setting('t024.ops_get')::jsonb;
BEGIN
  IF NOT (v ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'T2a FAIL: OPS get_engagement did not succeed: %', v;
  END IF;
  IF (v #> '{value,data}') ? 'finance' THEN
    RAISE EXCEPTION 'T2b FAIL: OPS (no quotation:read) must not see finance, dropped not zeroed: %', v;
  END IF;
END
$t2$;

-- ════════ T3 · CLIENT is FORBIDDEN on all seven, real id and fake alike ═════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0240000-0000-4000-8000-0000000000a3','a0240000-1111-4000-8000-000000000001','CLIENT','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.c1', pg_temp.try($$SELECT core.list_engagements()$$)::text, true);
SELECT pg_catalog.set_config('t024.c2', pg_temp.try($$SELECT core.get_engagement('a0240000-6666-4000-8000-000000000001')$$)::text, true);
SELECT pg_catalog.set_config('t024.c2f', pg_temp.try($$SELECT core.get_engagement('ENG-9999-9999')$$)::text, true);
SELECT pg_catalog.set_config('t024.c3', pg_temp.try($$SELECT core.get_engagement_participants('a0240000-6666-4000-8000-000000000001')$$)::text, true);
SELECT pg_catalog.set_config('t024.c4', pg_temp.try($$SELECT core.get_attendance('a0240000-6666-4000-8000-000000000001', 1)$$)::text, true);
SELECT pg_catalog.set_config('t024.c5', pg_temp.try($$SELECT core.capture_attendance('a0240000-6666-4000-8000-000000000001', 1, '{"participantRef":"x","session":"AM","present":true,"method":"MANUAL"}'::jsonb)$$)::text, true);
SELECT pg_catalog.set_config('t024.c6', pg_temp.try($$SELECT core.export_attendance('a0240000-6666-4000-8000-000000000001')$$)::text, true);
SELECT pg_catalog.set_config('t024.c7', pg_temp.try($$SELECT core.put_programme('a0240000-3333-4000-8000-000000000001', '{"name":"x"}'::jsonb)$$)::text, true);
RESET ROLE;

DO $t3$
DECLARE
  v_name text; v_code text; v_real jsonb; v_fake jsonb;
BEGIN
  FOR v_name IN SELECT unnest(ARRAY['c1','c2','c3','c4','c5','c6','c7']) LOOP
    v_real := pg_catalog.current_setting('t024.' || v_name)::jsonb;
    v_code := pg_temp.code(v_real);
    IF v_code <> 'FORBIDDEN' THEN
      RAISE EXCEPTION 'T3 FAIL: % should be FORBIDDEN for CLIENT, got %: %', v_name, v_code, v_real;
    END IF;
  END LOOP;

  -- Same refusal for a real id and an invented one — decided before any read.
  v_real := pg_catalog.current_setting('t024.c2')::jsonb;
  v_fake := pg_catalog.current_setting('t024.c2f')::jsonb;
  IF pg_temp.code(v_real) IS DISTINCT FROM pg_temp.code(v_fake) THEN
    RAISE EXCEPTION 'T3b FAIL: get_engagement answers a real id and a fake one differently for CLIENT: % vs %', v_real, v_fake;
  END IF;
END
$t3$;

-- ════════ T4 · anon cannot execute any of the seven (42501, from the grant) ═

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('t024.anon1', pg_temp.try($$SELECT core.list_engagements()$$)::text, true);
SELECT pg_catalog.set_config('t024.anon2', pg_temp.try($$SELECT core.put_programme('x','{}'::jsonb)$$)::text, true);
RESET ROLE;

DO $t4$
DECLARE v1 jsonb := pg_catalog.current_setting('t024.anon1')::jsonb;
        v2 jsonb := pg_catalog.current_setting('t024.anon2')::jsonb;
BEGIN
  IF (v1 ->> 'ok')::boolean OR v1 ->> 'sqlstate' <> '42501' THEN
    RAISE EXCEPTION 'T4a FAIL: anon should be refused 42501 on list_engagements: %', v1;
  END IF;
  IF (v2 ->> 'ok')::boolean OR v2 ->> 'sqlstate' <> '42501' THEN
    RAISE EXCEPTION 'T4b FAIL: anon should be refused 42501 on put_programme: %', v2;
  END IF;
END
$t4$;

-- ════════ T5 · cross-tenant: tenant B's ADMIN cannot see tenant A's row ═════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('b0240000-0000-4000-8000-0000000000b1','b0240000-1111-4000-8000-000000000001','ADMIN'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.cross', pg_temp.try($$SELECT core.get_engagement('a0240000-6666-4000-8000-000000000001')$$)::text, true);
RESET ROLE;

DO $t5$
DECLARE v jsonb := pg_catalog.current_setting('t024.cross')::jsonb;
BEGIN
  IF pg_temp.code(v) <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T5 FAIL: tenant B ADMIN reading tenant A''s engagement ref should be NOT_FOUND, non-enumerable: %', v;
  END IF;
END
$t5$;

-- ════════ T6 · attendance: capture on OPEN, then refuse on LOCKED ══════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0240000-0000-4000-8000-0000000000a1','a0240000-1111-4000-8000-000000000001','ADMIN'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.cap_present', pg_temp.try(
  $$SELECT core.capture_attendance('a0240000-6666-4000-8000-000000000001', 1,
      '{"participantRef":"a0240000-8888-4000-8000-000000000001","session":"AM","present":true,"method":"QR"}'::jsonb)$$)::text, true);
SELECT pg_catalog.set_config('t024.cap_absent', pg_temp.try(
  $$SELECT core.capture_attendance('a0240000-6666-4000-8000-000000000001', 1,
      '{"participantRef":"a0240000-8888-4000-8000-000000000002","session":"AM","present":false,"method":"MANUAL"}'::jsonb)$$)::text, true);
RESET ROLE;

DO $t6a$
DECLARE
  v_present jsonb := pg_catalog.current_setting('t024.cap_present')::jsonb;
  v_absent  jsonb := pg_catalog.current_setting('t024.cap_absent')::jsonb;
  v_sheet   jsonb;
BEGIN
  IF NOT (v_present ->> 'ok')::boolean OR NOT (v_absent ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'T6a FAIL: capture on an OPEN day should succeed: % / %', v_present, v_absent;
  END IF;
  v_sheet := v_absent #> '{value,data}';
  IF (v_sheet -> 'summary' ->> 'presentAm')::int <> 1 THEN
    RAISE EXCEPTION 'T6b FAIL: exactly one AM present after both marks: %', v_sheet -> 'summary';
  END IF;
  IF (v_sheet -> 'rows' -> 1 -> 'am' ->> 'reason') IS DISTINCT FROM 'OTHER' THEN
    RAISE EXCEPTION 'T6c FAIL: an absence with no caller-supplied reason defaults to OTHER (008''s CHECK, not the fixture''s laxer rule): %', v_sheet -> 'rows';
  END IF;
END
$t6a$;

-- Lock the day as 011's ATTENDANCE_APPROVE effect applier would (GOV-07 gates
-- the edge; a plain UPDATE from outside an EXECUTING action of that type is
-- refused, same as test_008's T6).
SELECT pg_temp.gate('a0240000-1111-4000-8000-000000000001','ATTENDANCE_APPROVE',
                    'a0240000-9999-4000-8000-000000000001');
UPDATE core.attendance_days
   SET status = 'LOCKED', approved_by_kind = 'HUMAN', approved_by_id = 'a0240000-0000-4000-8000-0000000000a1'
 WHERE id = 'a0240000-9999-4000-8000-000000000001';
SELECT pg_temp.ungate();

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0240000-0000-4000-8000-0000000000a1','a0240000-1111-4000-8000-000000000001','ADMIN'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.cap_locked', pg_temp.try(
  $$SELECT core.capture_attendance('a0240000-6666-4000-8000-000000000001', 1,
      '{"participantRef":"a0240000-8888-4000-8000-000000000001","session":"PM","present":true,"method":"QR"}'::jsonb)$$)::text, true);
RESET ROLE;

DO $t6b$
DECLARE v jsonb := pg_catalog.current_setting('t024.cap_locked')::jsonb;
BEGIN
  IF v ->> 'sqlstate' <> 'TRNOS' OR pg_temp.code(v) <> 'ATTENDANCE_LOCKED' THEN
    RAISE EXCEPTION 'T6d FAIL: capture on a LOCKED day should raise TRNOS ATTENDANCE_LOCKED: %', v;
  END IF;
  IF NOT ((v ->> 'detail')::jsonb ? 'unlockActionType') THEN
    RAISE EXCEPTION 'T6e FAIL: ATTENDANCE_LOCKED detail is missing the contract''s AttendanceLockedDetails shape: %', v;
  END IF;
END
$t6b$;

-- ════════ T7 · put_programme: ADMIN writes, OPS is FORBIDDEN with the role ═

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0240000-0000-4000-8000-0000000000a1','a0240000-1111-4000-8000-000000000001','ADMIN'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.put_ok', pg_temp.try(
  $$SELECT core.put_programme('a0240000-3333-4000-8000-000000000001', '{"name":"Leading Through Change (revised)","floorMarginRate":0.4}'::jsonb)$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0240000-0000-4000-8000-0000000000a2','a0240000-1111-4000-8000-000000000001','OPS'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.put_forbidden', pg_temp.try(
  $$SELECT core.put_programme('a0240000-3333-4000-8000-000000000001', '{"name":"nope"}'::jsonb)$$)::text, true);
RESET ROLE;

DO $t7$
DECLARE
  v_ok  jsonb := pg_catalog.current_setting('t024.put_ok')::jsonb;
  v_bad jsonb := pg_catalog.current_setting('t024.put_forbidden')::jsonb;
BEGIN
  IF NOT (v_ok ->> 'ok')::boolean OR (v_ok #> '{value,data,name}') <> '"Leading Through Change (revised)"'::jsonb THEN
    RAISE EXCEPTION 'T7a FAIL: ADMIN put_programme should land and read back: %', v_ok;
  END IF;
  IF (v_ok #>> '{value,data,floorMarginRate}')::numeric <> 0.4 THEN
    RAISE EXCEPTION 'T7b FAIL: floorMarginRate did not update: %', v_ok;
  END IF;
  IF v_bad ->> 'sqlstate' <> 'TRNOS' OR pg_temp.code(v_bad) <> 'FORBIDDEN'
     OR ((v_bad ->> 'detail')::jsonb ->> 'requiredRole') <> 'ADMIN' THEN
    RAISE EXCEPTION 'T7c FAIL: OPS put_programme should be FORBIDDEN with requiredRole ADMIN: %', v_bad;
  END IF;
END
$t7$;

-- ════════ T8 · export_attendance: TRAINER succeeds, status + snapshotAt ════
--
-- Farah holds TRAINER's new `attendance:export` grant (024 §0) and can see
-- this engagement (export itself is not scope-narrowed by assignment, only
-- `capture_attendance` is per the review — T9 below). Day 2 is the engagement's
-- latest attendance day and stays OPEN throughout this pin, so `status` here
-- is deterministic regardless of T6's day-1 lock.

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.trainer_claims('a0240000-0000-4000-8000-0000000000a4','a0240000-1111-4000-8000-000000000001',
                         'a0240000-5555-4000-8000-000000000001'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.trainer_export', pg_temp.try(
  $$SELECT core.export_attendance('a0240000-6666-4000-8000-000000000001')$$)::text, true);
RESET ROLE;

DO $t8$
DECLARE
  v      jsonb := pg_catalog.current_setting('t024.trainer_export')::jsonb;
  v_data jsonb;
BEGIN
  IF NOT (v ->> 'ok')::boolean OR NOT (v -> 'value' ->> 'success')::boolean THEN
    RAISE EXCEPTION 'T8a FAIL: TRAINER (holding the new attendance:export grant) should succeed: %', v;
  END IF;
  v_data := v -> 'value' -> 'data';
  IF v_data ->> 'status' IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'T8b FAIL: status should be day 2''s (the latest attendance day) OPEN status: %', v_data;
  END IF;
  IF v_data ->> 'snapshotAt' IS NULL THEN
    RAISE EXCEPTION 'T8c FAIL: snapshotAt missing from the export response: %', v_data;
  END IF;
END
$t8$;

-- ════════ T9 · capture_attendance is scope-narrowed for TRAINER ════════════
--
-- Farah is assigned to this engagement (session 1's trainer_id mirrors into
-- core.engagement_trainers). Zul is not assigned to anything. Day 2 (OPEN,
-- untouched by T6's day-1 lock) is used so this section's outcome does not
-- depend on running before or after T6.

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.trainer_claims('a0240000-0000-4000-8000-0000000000a4','a0240000-1111-4000-8000-000000000001',
                         'a0240000-5555-4000-8000-000000000001'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.trainer_ok', pg_temp.try(
  $$SELECT core.capture_attendance('a0240000-6666-4000-8000-000000000001', 2,
      '{"participantRef":"a0240000-8888-4000-8000-000000000001","session":"AM","present":true,"method":"QR"}'::jsonb)$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.trainer_claims('a0240000-0000-4000-8000-0000000000a5','a0240000-1111-4000-8000-000000000001',
                         'a0240000-5555-4000-8000-000000000002'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.trainer_real', pg_temp.try(
  $$SELECT core.capture_attendance('a0240000-6666-4000-8000-000000000001', 2,
      '{"participantRef":"a0240000-8888-4000-8000-000000000001","session":"PM","present":true,"method":"QR"}'::jsonb)$$)::text, true);
SELECT pg_catalog.set_config('t024.trainer_fake', pg_temp.try(
  $$SELECT core.capture_attendance('a0240000-6666-4000-8000-00000000ffff', 2,
      '{"participantRef":"a0240000-8888-4000-8000-000000000001","session":"PM","present":true,"method":"QR"}'::jsonb)$$)::text, true);
RESET ROLE;

DO $t9$
DECLARE
  v_ok   jsonb := pg_catalog.current_setting('t024.trainer_ok')::jsonb;
  v_real jsonb := pg_catalog.current_setting('t024.trainer_real')::jsonb;
  v_fake jsonb := pg_catalog.current_setting('t024.trainer_fake')::jsonb;
BEGIN
  IF NOT (v_ok ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'T9a FAIL: Farah (assigned via engagement_trainers) should be able to capture: %', v_ok;
  END IF;

  IF v_real ->> 'sqlstate' <> 'TRNOS' OR pg_temp.code(v_real) <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T9b FAIL: Zul (not assigned) should be FORBIDDEN on a real engagement: %', v_real;
  END IF;
  IF v_fake ->> 'sqlstate' <> 'TRNOS' OR pg_temp.code(v_fake) <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T9c FAIL: Zul should be FORBIDDEN on a fabricated engagement id too: %', v_fake;
  END IF;
  -- Non-enumerable: a real engagement (not Zul's) and a fabricated one must
  -- answer with the exact same shape, same as T3's real-vs-fake check.
  IF v_real ->> 'detail' IS DISTINCT FROM v_fake ->> 'detail' THEN
    RAISE EXCEPTION 'T9d FAIL: real (not Zul''s) vs fabricated engagement id answered differently for Zul: % vs %', v_real, v_fake;
  END IF;
END
$t9$;

-- ════════ T10 · teeth-check: core.get_engagement's gate is load-bearing ════
--
-- Disables ONLY core.get_engagement's own has_permission('engagement:read')
-- gate — the CURRENT body captured live via pg_get_functiondef and cut with
-- regexp_replace, never a hand-copied duplicate of the ~170-line function,
-- which would drift and silently stop testing anything the moment the real
-- body changes — calls it as the SAME CLIENT principal T3 refused, and
-- confirms CLIENT now reads data: the refusal in T3 came from THIS gate, not
-- some other check. The original body (captured before any change) is
-- restored byte-for-byte, and a fresh CLIENT call afterward proves the gate
-- is back before any later statement in this file relies on it.

DROP TABLE IF EXISTS pg_temp.t10_orig;
CREATE TEMP TABLE t10_orig (body text) ON COMMIT DROP;

DO $t10_disable$
DECLARE
  v_orig     text;
  v_disabled text;
BEGIN
  v_orig := pg_catalog.pg_get_functiondef('core.get_engagement(text)'::regprocedure);
  IF pg_catalog.strpos(v_orig, $q$has_permission('engagement:read')$q$) = 0 THEN
    RAISE EXCEPTION 'T10 SETUP FAILURE: expected engagement:read gate text not found in core.get_engagement''s current body — the teeth-check would silently no-op';
  END IF;

  v_disabled := pg_catalog.regexp_replace(v_orig,
    $q$IF NOT app\.has_permission\('engagement:read'\) THEN.*?END IF;$q$,
    '', 's');
  IF v_disabled = v_orig THEN
    RAISE EXCEPTION 'T10 SETUP FAILURE: the gate-removal regex matched nothing — refusing to run a teeth-check that changed nothing';
  END IF;

  INSERT INTO t10_orig (body) VALUES (v_orig);
  EXECUTE v_disabled;
END;
$t10_disable$;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0240000-0000-4000-8000-0000000000a3','a0240000-1111-4000-8000-000000000001','CLIENT','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.t10_disabled', pg_temp.try(
  $$SELECT core.get_engagement('a0240000-6666-4000-8000-000000000001')$$)::text, true);
RESET ROLE;

DO $t10_restore$
DECLARE v_orig text;
BEGIN
  SELECT body INTO v_orig FROM t10_orig;
  IF v_orig IS NULL THEN
    RAISE EXCEPTION 'T10 SETUP FAILURE: no captured original body to restore from — refusing to leave the gate disabled';
  END IF;
  EXECUTE v_orig;
END;
$t10_restore$;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0240000-0000-4000-8000-0000000000a3','a0240000-1111-4000-8000-000000000001','CLIENT','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t024.t10_restored', pg_temp.try(
  $$SELECT core.get_engagement('a0240000-6666-4000-8000-000000000001')$$)::text, true);
RESET ROLE;

DO $t10$
DECLARE
  v_disabled jsonb := pg_catalog.current_setting('t024.t10_disabled')::jsonb;
  v_restored jsonb := pg_catalog.current_setting('t024.t10_restored')::jsonb;
BEGIN
  IF NOT (v_disabled ->> 'ok')::boolean OR NOT (v_disabled -> 'value' ->> 'success')::boolean THEN
    RAISE EXCEPTION 'T10a FAIL: CLIENT should read data once the gate is disabled — the refusal in T3 is not proven load-bearing: %', v_disabled;
  END IF;
  IF pg_temp.code(v_restored) <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T10b FAIL: CLIENT should be refused again once the original body is restored: %', v_restored;
  END IF;
END;
$t10$;

ROLLBACK;
