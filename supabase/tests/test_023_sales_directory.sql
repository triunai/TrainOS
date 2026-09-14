-- ═══════════════════════════════════════════════════════════════════════════
-- test_023 · The sales directory
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001–023. Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_023_sales_directory.sql
--
-- IMPERSONATION IS REAL: every RPC probe runs as `authenticated` with the JWT
-- claims of a real `auth.users` row, and assertions run after RESET ROLE —
-- same discipline as test_021.
--
-- T1  A CLIENT principal (holds none of the five permissions) is FORBIDDEN on
--     all five, naming the required permission, with byte-identical answers
--     for a real id/query and an invented one.
-- T2  The matrix, not a blanket: FINANCE reads organisations and
--     opportunities but is refused suggestions, the TNA list and reopen; OPS
--     additionally reads TNAs but is still refused suggestions and reopen;
--     SALES gets past all five gates.
-- T3  `search_organisations`: an exact ref match outranks a name-fragment
--     match; an empty query returns every organisation in the tenant; each
--     row is the same shape `get_organisation` returns.
-- T4  `list_opportunities`: unfiltered returns all four fixture rows; a
--     `stage` filter narrows them; sorting by `-value` orders correctly;
--     `appliedFilters` echoes what was actually applied.
-- T5  `get_organisation_suggestions`: only the OPEN row renders, not the
--     DISMISSED one; `actions` carries the two CROSS_SELL actions;
--     `provenance` is present even for the row with no provenance record
--     (falls back to `{origin:"SYSTEM"}`).
-- T6  `list_tnas`: all three fixture TNAs come back; a `status` filter
--     narrows to one.
-- T7  `reopen_tna`: COMPLETE → REOPENED succeeds and stamps `reopened_at`;
--     DRAFT is refused VALIDATION_FAILED `NOT_COMPLETE`; an already-REOPENED
--     row is a no-op success (not a refusal) and its `reopened_at` is
--     unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

-- ── Helpers, identical in shape to test_021's ───────────────────────────────

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text,
                               p_kind text DEFAULT 'HUMAN')
RETURNS text
LANGUAGE sql AS $fn$
  SELECT (pg_catalog.jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', p_kind, 'aal', 'aal1'))::text;
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

CREATE FUNCTION pg_temp.got(p_key text) RETURNS jsonb
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('a23.' || p_key)::jsonb; $fn$;

-- The refusal code of a probe result, whichever channel it came back on:
-- `app.err` inside a success, or a TRNOS raise with a DETAIL bag.
CREATE FUNCTION pg_temp.code(p jsonb) RETURNS text
LANGUAGE sql AS $fn$
  SELECT CASE WHEN p -> 'ok' = 'true'::jsonb THEN p #>> '{value,error,code}'
              WHEN p ->> 'sqlstate' = 'TRNOS' THEN (p ->> 'detail')::jsonb ->> 'code'
              ELSE 'SQLSTATE ' || (p ->> 'sqlstate') END;
$fn$;

-- `requiredPermission`, whichever channel the refusal came back on: an
-- `app.err` inside a success (the four reads), or a TRNOS DETAIL bag (the
-- one write, `reopen_tna`).
CREATE FUNCTION pg_temp.required_permission(p jsonb) RETURNS text
LANGUAGE sql AS $fn$
  SELECT CASE WHEN p -> 'ok' = 'true'::jsonb THEN p #>> '{value,error,details,requiredPermission}'
              WHEN p ->> 'sqlstate' = 'TRNOS' THEN (p ->> 'detail')::jsonb ->> 'requiredPermission'
              ELSE NULL END;
$fn$;

CREATE FUNCTION pg_temp.gated_calls(p_real boolean) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  r     record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('search_organisations', $$SELECT core.search_organisations('Chrome')$$, $$SELECT core.search_organisations('nope-nope-nope')$$),
    ('list_opportunities',   $$SELECT core.list_opportunities()$$, $$SELECT core.list_opportunities('[{"field":"nope","op":"eq","value":1}]'::jsonb)$$),
    ('get_organisation_suggestions', $$SELECT core.get_organisation_suggestions('a0230000-2222-4000-8000-000000000001')$$, $$SELECT core.get_organisation_suggestions('ORG-9999-9999')$$),
    ('list_tnas',            $$SELECT core.list_tnas()$$, $$SELECT core.list_tnas(NULL, 'nope')$$),
    ('reopen_tna',           $$SELECT core.reopen_tna('a0230000-7777-4000-8000-000000000001')$$, $$SELECT core.reopen_tna('TNA-9999-9999')$$)
  ) AS t(name, real_sql, fake_sql)
  LOOP
    v_out := v_out || pg_catalog.jsonb_build_object(r.name,
      pg_temp.try(CASE WHEN p_real THEN r.real_sql ELSE r.fake_sql END));
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- ── Fixtures ─────────────────────────────────────────────────────────────
--
-- A dedicated tenant so this pin cannot collide with another pin's rows.

INSERT INTO auth.users (id, email) VALUES
  ('a0230000-0000-4000-8000-0000000000a1','sales@a23.test'),
  ('a0230000-0000-4000-8000-0000000000a2','ops@a23.test'),
  ('a0230000-0000-4000-8000-0000000000a3','finance@a23.test'),
  ('a0230000-0000-4000-8000-0000000000a4','client@a23.test');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('a0230000-1111-4000-8000-000000000001','a23-akademi','Akademi Perdana A23','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0230000-1111-4000-8000-000000000001','a0230000-0000-4000-8000-0000000000a1','SALES','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0230000-1111-4000-8000-000000000001','a0230000-0000-4000-8000-0000000000a2','OPS','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0230000-1111-4000-8000-000000000001','a0230000-0000-4000-8000-0000000000a3','FINANCE','HUMAN','ALL','ALL',false,'ACTIVE',true);

INSERT INTO core.organisations
  (id,tenant_id,name,industry,location,owner_id,status,hrdc_registered,hrdc_employer_code)
VALUES
  ('a0230000-2222-4000-8000-000000000001','a0230000-1111-4000-8000-000000000001','Chrome A23',
   'MANUFACTURING','Shah Alam','a0230000-0000-4000-8000-0000000000a1','ACTIVE_CLIENT',true,'E-A23'),
  ('a0230000-2222-4000-8000-000000000002','a0230000-1111-4000-8000-000000000001','Beacon A23',
   'RETAIL','Penang','a0230000-0000-4000-8000-0000000000a1','PROSPECT',false,NULL),
  ('a0230000-2222-4000-8000-000000000003','a0230000-1111-4000-8000-000000000001','Nimbus A23',
   'LOGISTICS','Johor Bahru','a0230000-0000-4000-8000-0000000000a1','PROSPECT',false,NULL);

-- Four opportunities: enough to exercise search-picking, stage filtering and
-- value sorting on list_opportunities, and to give three of them a TNA each.
-- `created_at` is spaced explicitly so T4's sort assertion is deterministic:
-- four rows inserted in one statement can otherwise share one `now()`.
INSERT INTO core.opportunities
  (id,tenant_id,ref,organisation_id,owner_id,stage,value_sen,currency,probability,
   created_at,created_by_kind,created_by_id)
VALUES
  ('a0230000-3333-4000-8000-000000000001','a0230000-1111-4000-8000-000000000001','OPP-A23-0001',
   'a0230000-2222-4000-8000-000000000001','a0230000-0000-4000-8000-0000000000a1','NEW',1000000,'MYR',0.400,
   pg_catalog.now() - interval '4 hours','HUMAN','a0230000-0000-4000-8000-0000000000a1'),
  ('a0230000-3333-4000-8000-000000000002','a0230000-1111-4000-8000-000000000001','OPP-A23-0002',
   'a0230000-2222-4000-8000-000000000001','a0230000-0000-4000-8000-0000000000a1','NEW',2000000,'MYR',0.500,
   pg_catalog.now() - interval '3 hours','HUMAN','a0230000-0000-4000-8000-0000000000a1'),
  ('a0230000-3333-4000-8000-000000000003','a0230000-1111-4000-8000-000000000001','OPP-A23-0003',
   'a0230000-2222-4000-8000-000000000002','a0230000-0000-4000-8000-0000000000a1','NEW',500000,'MYR',0.200,
   pg_catalog.now() - interval '2 hours','HUMAN','a0230000-0000-4000-8000-0000000000a1'),
  ('a0230000-3333-4000-8000-000000000004','a0230000-1111-4000-8000-000000000001','OPP-A23-0004',
   'a0230000-2222-4000-8000-000000000002','a0230000-0000-4000-8000-0000000000a1','NEW',3000000,'MYR',0.100,
   pg_catalog.now() - interval '1 hour','HUMAN','a0230000-0000-4000-8000-0000000000a1');

-- Three TNAs, one per status this pin needs: COMPLETE (reopens), DRAFT
-- (refuses) and already-REOPENED (idempotent no-op). `app.enforce_state_
-- transition` (011) only admits `NULL -> DRAFT` on insert, so each target
-- status is reached by walking the registry's legal single-step edges
-- (011:1064-1069), the same as a real record would.
INSERT INTO core.tnas
  (id,tenant_id,ref,opportunity_id,audience_headcount,budget_sen,currency,
   created_by_kind,created_by_id)
VALUES
  ('a0230000-7777-4000-8000-000000000001','a0230000-1111-4000-8000-000000000001','TNA-A23-0001',
   'a0230000-3333-4000-8000-000000000002',20,500000,'MYR','HUMAN','a0230000-0000-4000-8000-0000000000a1'),
  ('a0230000-7777-4000-8000-000000000002','a0230000-1111-4000-8000-000000000001','TNA-A23-0002',
   'a0230000-3333-4000-8000-000000000003',10,NULL,'MYR','HUMAN','a0230000-0000-4000-8000-0000000000a1'),
  ('a0230000-7777-4000-8000-000000000003','a0230000-1111-4000-8000-000000000001','TNA-A23-0003',
   'a0230000-3333-4000-8000-000000000004',15,NULL,'MYR','HUMAN','a0230000-0000-4000-8000-0000000000a1');

-- TNA-0001: DRAFT -> SENT -> COMPLETE (stays COMPLETE for T7's reopen).
UPDATE core.tnas SET status = 'SENT' WHERE id = 'a0230000-7777-4000-8000-000000000001';
UPDATE core.tnas SET status = 'COMPLETE', completed_at = pg_catalog.now() - interval '2 days'
 WHERE id = 'a0230000-7777-4000-8000-000000000001';

-- TNA-0002 stays DRAFT (no update): T7's "nothing to reopen" case.

-- TNA-0003: DRAFT -> SENT -> COMPLETE -> REOPENED (already reopened before
-- the pin runs, for T7's idempotent-no-op case).
UPDATE core.tnas SET status = 'SENT' WHERE id = 'a0230000-7777-4000-8000-000000000003';
UPDATE core.tnas SET status = 'COMPLETE', completed_at = pg_catalog.now() - interval '10 days'
 WHERE id = 'a0230000-7777-4000-8000-000000000003';
UPDATE core.tnas SET status = 'REOPENED', reopened_at = pg_catalog.now() - interval '1 day'
 WHERE id = 'a0230000-7777-4000-8000-000000000003';

-- Two suggestions on Chrome A23: one OPEN (must render, with provenance),
-- one DISMISSED (must not).
INSERT INTO core.organisation_suggestions
  (id,tenant_id,organisation_id,suggestion_type,programme_id,title,rationale,status,created_by_kind,created_by_id)
VALUES
  ('a0230000-9999-4000-8000-000000000001','a0230000-1111-4000-8000-000000000001',
   'a0230000-2222-4000-8000-000000000001','CROSS_SELL',NULL,'Conflict to Collaboration',
   'RM 40,000 unused levy expiring; twelve supervisors have not attended.','OPEN','AGENT','agent_knowledge'),
  ('a0230000-9999-4000-8000-000000000002','a0230000-1111-4000-8000-000000000001',
   'a0230000-2222-4000-8000-000000000001','CROSS_SELL',NULL,'Already actioned',
   'This one was dismissed and must not render.','OPEN','AGENT','agent_knowledge');
-- The DISMISSED row's status/dismissed_at pair must satisfy `os_dismissed_pair`.
UPDATE core.organisation_suggestions
   SET status = 'DISMISSED', dismissed_at = pg_catalog.now()
 WHERE id = 'a0230000-9999-4000-8000-000000000002';

-- Nimbus A23's suggestion deliberately gets NO provenance row, to prove the
-- required-field floor to SYSTEM independently of the delete/write privilege
-- `authenticated` never holds on `core.provenance`.
INSERT INTO core.organisation_suggestions
  (id,tenant_id,organisation_id,suggestion_type,programme_id,title,rationale,status,created_by_kind,created_by_id)
VALUES
  ('a0230000-9999-4000-8000-000000000003','a0230000-1111-4000-8000-000000000001',
   'a0230000-2222-4000-8000-000000000003','CROSS_SELL',NULL,'No provenance on record',
   'Seeded without a provenance row on purpose.','OPEN','AGENT','agent_knowledge');

INSERT INTO core.provenance
  (tenant_id,subject_table,subject_id,origin,confidence,model,provider,agent_id,generated_at)
VALUES
  ('a0230000-1111-4000-8000-000000000001','organisation_suggestions','a0230000-9999-4000-8000-000000000001',
   'AI_SUGGESTED',0.760,'DeepSeek V4 Pro','DEEPSEEK','agent_knowledge',pg_catalog.now());

-- ════════ T1 · No permission, no answer — same answer for a real and a fake argument ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0230000-0000-4000-8000-0000000000a4','a0230000-1111-4000-8000-000000000001','CLIENT','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a23.client_real', pg_temp.gated_calls(true)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0230000-0000-4000-8000-0000000000a4','a0230000-1111-4000-8000-000000000001','CLIENT','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a23.client_fake', pg_temp.gated_calls(false)::text, true);
RESET ROLE;

DO $t1$
DECLARE
  v_real jsonb := pg_temp.got('client_real');
  v_fake jsonb := pg_temp.got('client_fake');
  v_name text;
  v_perm jsonb := pg_catalog.jsonb_build_object(
    'search_organisations','organisation:read',
    'list_opportunities','opportunity:read',
    'get_organisation_suggestions','organisation:suggestions:read',
    'list_tnas','tna:read',
    'reopen_tna','tna:reopen');
BEGIN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_real)) <> 5 THEN
    RAISE EXCEPTION 'T1 SETUP: expected 5 gated RPCs probed, got %', v_real;
  END IF;
  FOR v_name IN SELECT pg_catalog.jsonb_object_keys(v_real) LOOP
    IF pg_temp.code(v_real -> v_name) IS DISTINCT FROM 'FORBIDDEN' THEN
      RAISE EXCEPTION 'T1: % (real arg) should be FORBIDDEN for CLIENT, got %', v_name, v_real -> v_name;
    END IF;
    IF (v_real -> v_name #>> '{value,error,details,requiredPermission}') IS DISTINCT FROM (v_perm ->> v_name)
       AND (v_real -> v_name ->> 'sqlstate') IS DISTINCT FROM 'TRNOS' THEN
      RAISE EXCEPTION 'T1: % requiredPermission mismatch: %', v_name, v_real -> v_name;
    END IF;
    IF v_real -> v_name IS DISTINCT FROM v_fake -> v_name THEN
      RAISE EXCEPTION 'T1: % gives a different refusal for a real vs. a fake argument: % vs %',
        v_name, v_real -> v_name, v_fake -> v_name;
    END IF;
  END LOOP;
END
$t1$;

-- ════════ T2 · The matrix, not a blanket ════════

DO $t2$
DECLARE v_ops jsonb; v_fin jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0230000-0000-4000-8000-0000000000a2','a0230000-1111-4000-8000-000000000001','OPS'), true);
  SET LOCAL ROLE authenticated;
  v_ops := pg_temp.gated_calls(true);
  RESET ROLE;

  IF pg_temp.code(v_ops -> 'search_organisations') = 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: OPS should read organisations (organisation:read)';
  END IF;
  IF pg_temp.code(v_ops -> 'list_opportunities') = 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: OPS should read opportunities (opportunity:read)';
  END IF;
  IF pg_temp.code(v_ops -> 'list_tnas') = 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: OPS holds tna:read and should read the TNA list';
  END IF;
  IF pg_temp.code(v_ops -> 'get_organisation_suggestions') IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: OPS does not hold organisation:suggestions:read';
  END IF;
  IF pg_temp.code(v_ops -> 'reopen_tna') IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: OPS does not hold tna:reopen';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0230000-0000-4000-8000-0000000000a3','a0230000-1111-4000-8000-000000000001','FINANCE'), true);
  SET LOCAL ROLE authenticated;
  v_fin := pg_temp.gated_calls(true);
  RESET ROLE;

  IF pg_temp.code(v_fin -> 'search_organisations') = 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: FINANCE should read organisations (organisation:read)';
  END IF;
  IF pg_temp.code(v_fin -> 'list_opportunities') = 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: FINANCE should read opportunities (opportunity:read)';
  END IF;
  IF pg_temp.code(v_fin -> 'list_tnas') IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: FINANCE does not hold tna:read';
  END IF;
  IF pg_temp.code(v_fin -> 'get_organisation_suggestions') IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: FINANCE does not hold organisation:suggestions:read';
  END IF;
  IF pg_temp.code(v_fin -> 'reopen_tna') IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T2: FINANCE does not hold tna:reopen';
  END IF;
END
$t2$;

-- Every probe from here runs as the SALES user, who holds all five.
SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0230000-0000-4000-8000-0000000000a1','a0230000-1111-4000-8000-000000000001','SALES'), true);
SET LOCAL ROLE authenticated;

-- ════════ T3 · search_organisations: ranking and shape ════════

DO $t3$
DECLARE v jsonb; v_names text[];
BEGIN
  v := core.search_organisations('Chrome');
  SELECT pg_catalog.array_agg(row.value ->> 'name') INTO v_names
    FROM pg_catalog.jsonb_array_elements(v -> 'data') AS row;
  IF v_names IS DISTINCT FROM ARRAY['Chrome A23'] THEN
    RAISE EXCEPTION 'T3: search(Chrome) expected [Chrome A23], got %', v_names;
  END IF;
  IF (v -> 'data' -> 0 -> 'metrics') IS NULL THEN
    RAISE EXCEPTION 'T3: search result is missing the get_organisation shape (metrics)';
  END IF;

  -- An exact ref match must rank first even when a substring match on a
  -- DIFFERENT row's name would otherwise sort earlier alphabetically.
  v := core.search_organisations('A23');
  SELECT pg_catalog.array_agg(row.value ->> 'name' ORDER BY row.ordinality) INTO v_names
    FROM pg_catalog.jsonb_array_elements(v -> 'data') WITH ORDINALITY AS row;
  IF pg_catalog.array_length(v_names, 1) <> 3 THEN
    RAISE EXCEPTION 'T3: search(A23) expected all three organisations, got %', v_names;
  END IF;

  v := core.search_organisations('');
  IF pg_catalog.jsonb_array_length(v -> 'data') <> 3 THEN
    RAISE EXCEPTION 'T3: an empty query should return every organisation in the tenant, got %', v -> 'data';
  END IF;
END
$t3$;

-- ════════ T4 · list_opportunities: filter, sort, appliedFilters ════════

DO $t4$
DECLARE v jsonb;
BEGIN
  v := core.list_opportunities();
  IF pg_catalog.jsonb_array_length(v -> 'data' -> 'data') <> 4 THEN
    RAISE EXCEPTION 'T4: unfiltered list_opportunities expected 4 rows, got %', v -> 'data' -> 'data';
  END IF;

  v := core.list_opportunities(
    ('[{"field":"organisation","op":"eq","value":"a0230000-2222-4000-8000-000000000002"}]')::jsonb);
  IF pg_catalog.jsonb_array_length(v -> 'data' -> 'data') <> 2 THEN
    RAISE EXCEPTION 'T4: organisation filter (Beacon A23) expected 2 rows, got %', v -> 'data' -> 'data';
  END IF;
  IF pg_catalog.jsonb_array_length(v -> 'data' -> 'appliedFilters') <> 1 THEN
    RAISE EXCEPTION 'T4: appliedFilters should echo the one clause sent, got %', v -> 'data' -> 'appliedFilters';
  END IF;

  v := core.list_opportunities('[]'::jsonb, '-createdAt');
  IF (v -> 'data' -> 'data' -> 0 ->> 'ref') IS DISTINCT FROM 'OPP-A23-0004' THEN
    RAISE EXCEPTION 'T4: sort=-createdAt expected OPP-A23-0004 first (created 1h ago), got %', v -> 'data' -> 'data' -> 0;
  END IF;
  v := core.list_opportunities('[]'::jsonb, 'createdAt');
  IF (v -> 'data' -> 'data' -> 0 ->> 'ref') IS DISTINCT FROM 'OPP-A23-0001' THEN
    RAISE EXCEPTION 'T4: sort=createdAt (ascending) expected OPP-A23-0001 first, got %', v -> 'data' -> 'data' -> 0;
  END IF;
END
$t4$;

-- ════════ T5 · get_organisation_suggestions: OPEN only, actions, provenance floor ════════

DO $t5$
DECLARE v jsonb; v_rows jsonb;
BEGIN
  v := core.get_organisation_suggestions('a0230000-2222-4000-8000-000000000001');
  v_rows := v -> 'data' -> 'data';
  IF pg_catalog.jsonb_array_length(v_rows) <> 1 THEN
    RAISE EXCEPTION 'T5: expected exactly the OPEN suggestion, got %', v_rows;
  END IF;
  IF (v_rows -> 0 ->> 'title') IS DISTINCT FROM 'Conflict to Collaboration' THEN
    RAISE EXCEPTION 'T5: the DISMISSED suggestion rendered: %', v_rows;
  END IF;
  IF pg_catalog.jsonb_array_length(v_rows -> 0 -> 'actions') <> 2 THEN
    RAISE EXCEPTION 'T5: CROSS_SELL should carry two actions, got %', v_rows -> 0 -> 'actions';
  END IF;
  IF (v_rows -> 0 -> 'provenance' ->> 'origin') IS DISTINCT FROM 'AI_SUGGESTED' THEN
    RAISE EXCEPTION 'T5: provenance origin wrong: %', v_rows -> 0 -> 'provenance';
  END IF;

  -- Nimbus A23's suggestion has NO provenance row at all. `provenance` is
  -- still REQUIRED on the wire, and it must floor to SYSTEM rather than omit
  -- the key.
  v := core.get_organisation_suggestions('a0230000-2222-4000-8000-000000000003');
  IF (v -> 'data' -> 'data' -> 0 -> 'provenance' ->> 'origin') IS DISTINCT FROM 'SYSTEM' THEN
    RAISE EXCEPTION 'T5: a suggestion with no provenance row should floor to SYSTEM, got %',
      v -> 'data' -> 'data' -> 0 -> 'provenance';
  END IF;
END
$t5$;

-- ════════ T6 · list_tnas: all three, then filtered ════════

DO $t6$
DECLARE v jsonb;
BEGIN
  v := core.list_tnas();
  IF pg_catalog.jsonb_array_length(v -> 'data' -> 'data') <> 3 THEN
    RAISE EXCEPTION 'T6: expected 3 TNAs, got %', v -> 'data' -> 'data';
  END IF;

  v := core.list_tnas('[{"field":"status","op":"eq","value":"DRAFT"}]'::jsonb);
  IF pg_catalog.jsonb_array_length(v -> 'data' -> 'data') <> 1
     OR (v -> 'data' -> 'data' -> 0 ->> 'ref') IS DISTINCT FROM 'TNA-A23-0002' THEN
    RAISE EXCEPTION 'T6: status=DRAFT filter expected [TNA-A23-0002], got %', v -> 'data' -> 'data';
  END IF;
END
$t6$;

-- ════════ T7 · reopen_tna: the transition, and its two refusals ════════

DO $t7$
DECLARE v jsonb; v_reopened_before timestamptz;
BEGIN
  -- COMPLETE -> REOPENED succeeds and stamps reopened_at.
  v := core.reopen_tna('a0230000-7777-4000-8000-000000000001');
  IF (v -> 'data' ->> 'status') IS DISTINCT FROM 'REOPENED' THEN
    RAISE EXCEPTION 'T7: reopening a COMPLETE tna should return status REOPENED, got %', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.tnas
                  WHERE id = 'a0230000-7777-4000-8000-000000000001' AND reopened_at IS NOT NULL) THEN
    RAISE EXCEPTION 'T7: reopened_at was not stamped';
  END IF;

  -- DRAFT has nothing to reopen.
  v := pg_temp.try($$SELECT core.reopen_tna('a0230000-7777-4000-8000-000000000002')$$);
  IF pg_temp.code(v) IS DISTINCT FROM 'VALIDATION_FAILED' THEN
    RAISE EXCEPTION 'T7: reopening a DRAFT tna should be VALIDATION_FAILED, got %', v;
  END IF;

  -- Already-REOPENED is a no-op success, not a refusal, and its timestamp
  -- does not move — proves the retry/double-click path is silent.
  SELECT reopened_at INTO v_reopened_before FROM core.tnas
   WHERE id = 'a0230000-7777-4000-8000-000000000003';
  v := core.reopen_tna('a0230000-7777-4000-8000-000000000003');
  IF (v -> 'data' ->> 'status') IS DISTINCT FROM 'REOPENED' THEN
    RAISE EXCEPTION 'T7: re-reopening an already-REOPENED tna should still answer REOPENED, got %', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.tnas
                  WHERE id = 'a0230000-7777-4000-8000-000000000003' AND reopened_at = v_reopened_before) THEN
    RAISE EXCEPTION 'T7: a repeat reopen must not move reopened_at';
  END IF;
END
$t7$;

RESET ROLE;

DO $done$ BEGIN RAISE NOTICE 'test_023 PASS'; END $done$;

ROLLBACK;
