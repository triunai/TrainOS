-- ═══════════════════════════════════════════════════════════════════════════
-- test_035 · core.get_follow_up_draft: the non-null exact-rate path
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001-035 (or later). Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_035_follow_up_draft_trim_fix.sql
--
-- T1  a follow-up draft whose message rate has a real, non-null rate_exact
--     (via core.message_rates, since the draft's own rate_per_message_exact
--     is left NULL to exercise the COALESCE fallback too) succeeds and
--     returns a ratePerMessageExact string — the exact path 021's
--     pg_catalog.trim(text) call raised `function ... does not exist` on
--     every time it was reached. Against 021's original body (or this
--     migration rolled back) this ERRORs instead of returning; against 035
--     it returns `{"success":true,...,"ratePerMessageExact":"0.346700"}`.
-- T2  regression guard: a draft with NO rate at all (rateSource UNAVAILABLE)
--     still succeeds and carries no ratePerMessageExact key — the trim call
--     is inside the `v_source <> 'UNAVAILABLE'` branch and was never the
--     bug for this path; unchanged by 035.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal1')::text;
$fn$;

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond THEN RAISE NOTICE 'PASS %', p_label;
  ELSE RAISE EXCEPTION 'FAIL %', p_label;
  END IF;
END;
$fn$;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('core.get_follow_up_draft(text,text)') IS NULL THEN
    RAISE EXCEPTION '035 preflight: core.get_follow_up_draft(text,text) is absent; 021 has not been applied';
  END IF;
END;
$preflight$;

-- ── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (id,email) VALUES
  ('a0350000-0000-4000-8000-000000000001','md@a35.test');

INSERT INTO public.tenants (id,slug,name,timezone) VALUES
  ('a0350000-1111-4000-8000-000000000001','a35-alpha','A35 Alpha','Asia/Kuala_Lumpur');

INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,status,is_default) VALUES
  ('a0350000-1111-4000-8000-000000000001','a0350000-0000-4000-8000-000000000001','MD','HUMAN','ACTIVE',true);

INSERT INTO core.organisations (id,tenant_id,ref,name,owner_id) VALUES
  ('a0350000-bbbb-4000-8000-000000000001','a0350000-1111-4000-8000-000000000001','ORG-A35','A35 Org','a0350000-0000-4000-8000-000000000001');

INSERT INTO core.contacts (id,tenant_id,ref,organisation_id,name,email) VALUES
  ('a0350000-8888-4000-8000-000000000001','a0350000-1111-4000-8000-000000000001','CON-A35','a0350000-bbbb-4000-8000-000000000001','A35 Contact','contact@a35.test');

INSERT INTO core.follow_ups (id,tenant_id,ref,organisation_id,contact_id,reason,due_date,owner_id) VALUES
  ('a0350000-ffff-4000-8000-000000000001','a0350000-1111-4000-8000-000000000001','FU-A35-1','a0350000-bbbb-4000-8000-000000000001','a0350000-8888-4000-8000-000000000001','Chase proposal',current_date,'a0350000-0000-4000-8000-000000000001'),
  ('a0350000-ffff-4000-8000-000000000002','a0350000-1111-4000-8000-000000000001','FU-A35-2','a0350000-bbbb-4000-8000-000000000001','a0350000-8888-4000-8000-000000000001','Chase invoice',current_date,'a0350000-0000-4000-8000-000000000001');

-- A real message rate, non-null rate_exact — the value the buggy trim() call
-- reads (via the draft's COALESCE fallback, since the draft's own
-- rate_per_message_exact is left NULL below).
INSERT INTO core.message_rates (id,tenant_id,channel,category,rate_exact,effective_from,stale_after,source) VALUES
  ('a0350000-eeee-4000-8000-000000000001','a0350000-1111-4000-8000-000000000001','EMAIL','UTILITY',0.346700,
   pg_catalog.now() - interval '1 day', pg_catalog.now() + interval '1 day','MANUAL');

-- T1's draft: HAS a rate (rate_per_message_sen set, message_rate_id set,
-- own rate_per_message_exact left NULL so the COALESCE falls back to
-- v_rate.rate_exact above).
INSERT INTO core.outbound_messages
  (id,tenant_id,purpose,channel,contact_id,to_address,follow_up_id,body,status,
   rate_per_message_sen,message_rate_id,currency)
VALUES
  ('a0350000-dddd-4000-8000-000000000001','a0350000-1111-4000-8000-000000000001','FOLLOWUP','EMAIL',
   'a0350000-8888-4000-8000-000000000001','contact@a35.test','a0350000-ffff-4000-8000-000000000001',
   'Draft body T1','DRAFT',35,'a0350000-eeee-4000-8000-000000000001','MYR');

-- T2's draft: NO rate at all (rate_per_message_sen NULL, message_rate_id
-- NULL) — rateSource UNAVAILABLE, the trim() branch never runs.
INSERT INTO core.outbound_messages
  (id,tenant_id,purpose,channel,contact_id,to_address,follow_up_id,body,status,currency)
VALUES
  ('a0350000-dddd-4000-8000-000000000002','a0350000-1111-4000-8000-000000000001','FOLLOWUP','EMAIL',
   'a0350000-8888-4000-8000-000000000001','contact@a35.test','a0350000-ffff-4000-8000-000000000002',
   'Draft body T2','DRAFT','MYR');

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0350000-0000-4000-8000-000000000001','a0350000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;

-- ════════ T1 · the exact-rate path succeeds and returns the exact string ═

DO $t1$
DECLARE v_result jsonb;
BEGIN
  v_result := core.get_follow_up_draft('FU-A35-1','EMAIL');
  PERFORM pg_temp.assert((v_result ->> 'success')::boolean,
    pg_catalog.format('T1a get_follow_up_draft succeeds on a draft with a real exact rate, got %s', v_result));
  PERFORM pg_temp.assert(v_result -> 'data' ->> 'rateSource' = 'LIVE',
    pg_catalog.format('T1b rateSource is LIVE, got %s', v_result -> 'data' ->> 'rateSource'));
  PERFORM pg_temp.assert(v_result -> 'data' ->> 'ratePerMessageExact' = '0.346700',
    pg_catalog.format('T1c ratePerMessageExact is the untruncated btrim''d string, got %s', v_result -> 'data' ->> 'ratePerMessageExact'));
END;
$t1$;

-- ════════ T2 · UNAVAILABLE rate: no exact field, unaffected by 035 ═══════

DO $t2$
DECLARE v_result jsonb;
BEGIN
  v_result := core.get_follow_up_draft('FU-A35-2','EMAIL');
  PERFORM pg_temp.assert((v_result ->> 'success')::boolean,
    pg_catalog.format('T2a get_follow_up_draft succeeds on a draft with no rate, got %s', v_result));
  PERFORM pg_temp.assert(v_result -> 'data' ->> 'rateSource' = 'UNAVAILABLE',
    pg_catalog.format('T2b rateSource is UNAVAILABLE, got %s', v_result -> 'data' ->> 'rateSource'));
  PERFORM pg_temp.assert(NOT (v_result -> 'data' ? 'ratePerMessageExact'),
    'T2c no ratePerMessageExact key when the rate is unavailable');
END;
$t2$;

RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'test_035 ALL PASS'; END $$;

ROLLBACK;
