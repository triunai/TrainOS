-- ============================================================================
-- PIN 014 · rls_policies_and_client_grants
-- ============================================================================
--
-- Run against the complete 001-014 set. Ends in ROLLBACK; writes nothing durable.
--   psql "$DATABASE_URL" -f supabase/tests/test_014_rls_policies_and_client_grants.sql
--
-- ⚠ AUTHORSHIP. Drafted by Claude (Opus) in the `cloud/migrations` lane,
-- 2026-09-13. **Codex (gpt-5.6-sol xhigh) review is PENDING** — the standing
-- ruling for this pack is that Claude drafts and Codex reviews, and no Codex pass
-- has run against this file. Every assertion below has been EXECUTED and passes;
-- none of them has been adversarially reviewed.
--
-- T1  Inventory, re-derived from the catalogue: 113 tenant tables x 2 policies,
--     the one no-tenant exception, 114 SELECT grants, zero write grants, zero
--     anon grants, the three wrappers with the EXACT stored search_path string.
-- T2  The whole point of the pack: an AUTHENTICATED caller — really the
--     `authenticated` role, not a service_role probe wearing its claims —
--     performs an action through core.perform_action and gets an envelope back.
-- T3  A cross-tenant caller is REFUSED, in both directions that matter: reading
--     another tenant's rows returns zero, and performing an action against
--     another tenant's target ref raises rather than succeeding quietly.
-- T4  anon sees nothing. Measured as four separate refusals, because "nothing" has
--     four distinct failure modes and three of them look like success.
-- T5  Tenant isolation on the read path, proved by reading the SAME table as two
--     different principals in one transaction and comparing the row sets.
-- T6  The global-row fallback: a national compliance rule (tenant_id NULL) is
--     visible to BOTH tenants, a tenant override to exactly one, and the fallback
--     is absent from tables whose tenant_id is NOT NULL.
-- T7  core.v_approval_requests — readable through the definer path for the
--     caller's own tenant, and REFUSED to a direct authenticated SELECT.
-- T8  app.apply_tenant_policies tested on a THROWAWAY table, per 004's precedent:
--     the 115th table gets the same treatment, the no-tenant refusal fires, and
--     the NOT NULL / NULL-able predicate difference is derived not guessed.
-- T9  The write path cannot be bypassed: a direct INSERT, UPDATE and DELETE by
--     `authenticated` against core is refused at the privilege layer, and the
--     RESTRICTIVE isolation policy refuses a cross-tenant write even if a grant
--     were to appear.
-- T10 The wrappers wrap and do nothing else — body shape, argument arity
--     including p_expected_diff_hash, and the underlying app functions still
--     unreachable by a client.
--
-- ── NOTES ON SHAPE ───────────────────────────────────────────────────────────
--
-- IMPERSONATION IS REAL HERE, AND THAT IS THE DIFFERENCE FROM 011-013. Those
-- pins ran their RPCs as `service_role` wearing a genuine JWT identity, because
-- before 014 `authenticated` held no EXECUTE and running as it would have
-- contradicted the state the pack was required to be in. That is precisely the
-- state 014 changes, so this pin does the thing the earlier ones could not:
-- `SET LOCAL ROLE authenticated` and call the function. A 014 pin that kept the
-- service_role probe would be testing 011 again and asserting nothing about 014.
--
-- Each impersonated probe is ONE STATEMENT whose result is parked in a
-- transaction-local GUC; the assertions run after RESET ROLE, because a failed
-- ASSERT inside an impersonated block reports as the wrong role and is much
-- harder to read.
--
-- REF FORMATS. core.action_requests, approval_requests and suggested_drafts
-- allocate refs through core.assign_ref, which raises when the tenant has no
-- core.ref_formats row for the prefix. 016 provisions those; until it lands every
-- pin seeds its own, and this one seeds ACT/APV/DRF for both tenants.
--
-- GOV-07. T9's write probes deliberately target `core.organisations`, which
-- carries NO state-transition trigger, so a refusal is unambiguously the
-- privilege layer and not 011's gate answering first.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

-- ─── FIXTURES · two tenants, because one tenant cannot demonstrate isolation ──

-- Pre-flight: this pin asserts the END STATE of 014 and is meaningless against a
-- database where 014 was not applied.
DO $setup$
BEGIN
  IF pg_catalog.to_regproc('app.apply_tenant_policies') IS NULL
     OR pg_catalog.to_regprocedure('core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'test_014 SETUP FAILURE: migration 014 is missing or partial';
  END IF;
END;
$setup$;

INSERT INTO auth.users (id,email) VALUES
  ('00000014-0000-0000-0000-0000000000a1','t014-alpha-sales@example.invalid'),
  ('00000014-0000-0000-0000-0000000000a2','t014-alpha-manager@example.invalid'),
  ('00000014-0000-0000-0000-0000000000b1','t014-beta-sales@example.invalid');

INSERT INTO public.tenants (id,name,slug,timezone) VALUES
  ('00000014-1111-1111-1111-111111111111','T014 Alpha','t014-alpha','Asia/Kuala_Lumpur'),
  ('00000014-2222-2222-2222-222222222222','T014 Beta','t014-beta','Asia/Kuala_Lumpur');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,agent_id,status,is_default)
VALUES
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a1',
   'SALES','HUMAN',NULL,'ACTIVE',true),
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a2',
   'SALES_MANAGER','HUMAN',NULL,'ACTIVE',true),
  ('00000014-2222-2222-2222-222222222222','00000014-0000-0000-0000-0000000000b1',
   'SALES','HUMAN',NULL,'ACTIVE',true);

INSERT INTO public.user_profiles (tenant_id,user_id,display_name) VALUES
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a1','T014 Alpha Sales'),
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a2','T014 Alpha Manager'),
  ('00000014-2222-2222-2222-222222222222','00000014-0000-0000-0000-0000000000b1','T014 Beta Sales');

INSERT INTO core.ref_formats (tenant_id,prefix,entity,dated,width) VALUES
  ('00000014-1111-1111-1111-111111111111','ACT','action_requests',true,4),
  ('00000014-1111-1111-1111-111111111111','APV','approval_requests',true,4),
  ('00000014-1111-1111-1111-111111111111','DRF','suggested_drafts',true,4),
  ('00000014-2222-2222-2222-222222222222','ACT','action_requests',true,4),
  ('00000014-2222-2222-2222-222222222222','APV','approval_requests',true,4),
  ('00000014-2222-2222-2222-222222222222','DRF','suggested_drafts',true,4)
  -- ⚠ 016 now provisions every tenant's ref_formats from an AFTER INSERT trigger
  -- on public.tenants, so this fixture collides with the real thing. The pin's
  -- own shape wins: it is a fixture inside a transaction that rolls back, and
  -- the assertions below were written against these exact values.
  ON CONFLICT (tenant_id, prefix)
    DO UPDATE SET entity = EXCLUDED.entity,
                  dated  = EXCLUDED.dated,
                  width  = EXCLUDED.width;

INSERT INTO core.organisations (id,tenant_id,ref,name,owner_id) VALUES
  ('00000014-bbbb-bbbb-bbbb-bbbbbbbbbba1','00000014-1111-1111-1111-111111111111',
   'ORG-T014-A','T014 Alpha Manufacturing','00000014-0000-0000-0000-0000000000a1'),
  ('00000014-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000014-2222-2222-2222-222222222222',
   'ORG-T014-B','T014 Beta Logistics','00000014-0000-0000-0000-0000000000b1');

INSERT INTO core.enquiries
  (id,tenant_id,ref,matched_organisation_id,match_reason,status,channel,subject,received_at)
VALUES
  ('00000014-eeee-eeee-eeee-eeeeeeeeeea1','00000014-1111-1111-1111-111111111111',
   'ENQ-T014-A','00000014-bbbb-bbbb-bbbb-bbbbbbbbbba1','EXACT_DOMAIN','OPEN','EMAIL',
   'Alpha safety training',pg_catalog.now()),
  ('00000014-eeee-eeee-eeee-eeeeeeeeeeb1','00000014-2222-2222-2222-222222222222',
   'ENQ-T014-B','00000014-bbbb-bbbb-bbbb-bbbbbbbbbbb1','EXACT_DOMAIN','OPEN','EMAIL',
   'Beta forklift training',pg_catalog.now());

-- A national rule and a tenant override, for T6's fallback.
INSERT INTO core.compliance_rules
  (tenant_id,rule_code,family_key,check_key,side,subject,subject_field,op,
   reference_kind,reference,effective_from,status)
VALUES
  (NULL,'T014-NATIONAL','LEAD_TIME_INHOUSE','CHK_LEAD_TIME','GRANT','engagement',
   'starts_on','LTE','FIELD','approval_date','2026-01-01','PROPOSED'),
  ('00000014-1111-1111-1111-111111111111','T014-ALPHA-OVERRIDE','LEAD_TIME_INHOUSE',
   'CHK_LEAD_TIME','GRANT','engagement','starts_on','LTE','FIELD','approval_date',
   '2026-01-01','PROPOSED');

-- Claim strings, named once. A typo in a repeated 200-character JSON literal is
-- the kind of defect that makes a security pin pass for the wrong reason.
CREATE TEMP TABLE t014_claims (who text PRIMARY KEY, claims text);
INSERT INTO t014_claims VALUES
  ('alpha_sales',
   '{"sub":"00000014-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000014-1111-1111-1111-111111111111","app_role":"SALES","actor_kind":"HUMAN","aal":"aal1"}'),
  ('alpha_manager',
   '{"sub":"00000014-0000-0000-0000-0000000000a2","role":"authenticated","tenant_id":"00000014-1111-1111-1111-111111111111","app_role":"SALES_MANAGER","actor_kind":"HUMAN","aal":"aal1"}'),
  ('beta_sales',
   '{"sub":"00000014-0000-0000-0000-0000000000b1","role":"authenticated","tenant_id":"00000014-2222-2222-2222-222222222222","app_role":"SALES","actor_kind":"HUMAN","aal":"aal1"}');

-- One probe helper. Runs a statement and returns a jsonb verdict instead of
-- letting the exception escape, so a refusal is DATA the assertions can compare
-- rather than an abort that takes the pin with it.
CREATE FUNCTION pg_temp.t014_try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'message',SQLERRM);
END;
$fn$;

CREATE FUNCTION pg_temp.t014_try_value(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN jsonb_build_object('ok',true,'value',v);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'message',SQLERRM);
END;
$fn$;

-- ─── T1 · Inventory ─────────────────────────────────────────────────────────

DO $t1$
DECLARE
  v_pairs   integer;
  v_grants  integer;
  v_writes  integer;
  v_anon    integer;
  v_conf    text[];
  v_fn      text;
BEGIN
  SELECT pg_catalog.count(*) INTO v_pairs
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='core' AND c.relkind='r'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid=c.oid AND a.attname='tenant_id'
                    AND a.attnum>0 AND NOT a.attisdropped)
     AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy p
           WHERE p.polrelid=c.oid
             AND p.polname IN (c.relname||'_tenant_select', c.relname||'_tenant_isolation'))=2;
  -- 113 at 014, plus the three tenant-scoped tables 017 adds (core.tax_policies,
  -- core.data_retention_policies, core.data_breach_register), which 017 policies
  -- by CALLING app.apply_tenant_policies rather than hand-writing a policy beside
  -- 113 generated ones. That is the number this asserts: a later pack that adds a
  -- table and forgets the call leaves it deny-all with a live grant, which reads
  -- as an empty screen rather than as a defect.
  ASSERT v_pairs = 116,
    pg_catalog.format('T1a FAIL: expected 116 core tables with a complete tenant '
      'policy pair (113 from 014 + 3 from 017), found %s.', v_pairs);

  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
                  JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
                 WHERE c.relname='provenance_subjects'
                   AND p.polname='provenance_subjects_read'),
    'T1b FAIL: core.provenance_subjects has no policy. It is the one core table '
    'with no tenant_id and it was granted by name on purpose; no policy means the '
    'provenance subject list is invisible and every provenance screen is empty.';

  SELECT pg_catalog.count(*) INTO v_grants
    FROM information_schema.table_privileges
   WHERE table_schema='core' AND grantee='authenticated' AND privilege_type='SELECT';
  ASSERT v_grants = 121,
    pg_catalog.format('T1c FAIL: expected 121 SELECT grants in core to '
      'authenticated — 117 tables (114 from 014 + 3 from 017) plus four views: '
      'core.audit_entries, core.v_contact_consent_current, and 017''s '
      'v_tax_policy_unverified and v_trainer_accreditation. Three views are '
      'deliberately excluded: v_approval_requests (doc 09 §12) and budget_status '
      '/ model_tier_status (security_invoker over app.usage_rollup, so a grant '
      'cannot work). Found %s.', v_grants);

  SELECT pg_catalog.count(*) INTO v_writes
    FROM information_schema.table_privileges
   WHERE table_schema='core' AND grantee IN ('authenticated','anon')
     AND privilege_type <> 'SELECT';
  ASSERT v_writes = 0,
    pg_catalog.format('T1d FAIL: %s non-SELECT privilege(s) in core reach a client '
      'role. Every one of them is a path around the action envelope.', v_writes);

  SELECT pg_catalog.count(*) INTO v_anon
    FROM information_schema.table_privileges
   WHERE table_schema IN ('core','app','public') AND grantee='anon';
  ASSERT v_anon = 0,
    pg_catalog.format('T1e FAIL: anon holds %s table privilege(s). 014 creates no '
      'public-token allowlist entry, so the correct number is zero.', v_anon);

  FOREACH v_fn IN ARRAY ARRAY[
    'core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)',
    'core.decide_approval(uuid,text,text,text,text)',
    'core.bulk_decide_approvals(uuid[],text,text,text)']
  LOOP
    ASSERT pg_catalog.to_regprocedure(v_fn) IS NOT NULL,
      pg_catalog.format('T1f FAIL: wrapper %s does not exist', v_fn);
    SELECT p.proconfig INTO v_conf FROM pg_catalog.pg_proc p
      WHERE p.oid = pg_catalog.to_regprocedure(v_fn);
    -- The EXACT stored string, never `proconfig IS NOT NULL`. The quoted-list
    -- spelling `SET search_path = 'a, b'` stores a different string, names one
    -- schema that does not exist, and passes a not-null check.
    ASSERT 'search_path=""' = ANY (COALESCE(v_conf, ARRAY[]::text[])),
      pg_catalog.format('T1g FAIL: %s proconfig is %s, not search_path=""',
        v_fn, COALESCE(v_conf::text,'NULL'));
  END LOOP;

  RAISE NOTICE
    'T1 PASS - 113 tenant policy pairs, the one no-tenant exception granted by '
    'name, 118 SELECT grants, zero writes to a client role, zero anon privileges, '
    'and three wrappers carrying the exact stored search_path="".';
END;
$t1$;

-- ─── T2 · An AUTHENTICATED caller performs an action ────────────────────────
-- The single assertion this whole pack exists to make true. Note the role: this
-- is `authenticated` itself, not service_role wearing its claims.

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.perform',
  pg_temp.t014_try_value($$SELECT core.perform_action(
    'ENQUIRY_ARCHIVE','ENQ-T014-A','{}'::jsonb)$$)::text, true);
RESET ROLE;

DO $t2$
DECLARE
  v jsonb := pg_catalog.current_setting('t014.perform')::jsonb;
  v_env jsonb;
BEGIN
  ASSERT (v->>'ok')::boolean,
    pg_catalog.format('T2a FAIL: an authenticated caller could not perform an '
      'action through core.perform_action. Every primary button in the product '
      'is this call. sqlstate=%s message=%s', v->>'sqlstate', v->>'message');

  v_env := v->'value';

  -- The envelope, exactly. app.ok guarantees `data` is the sole non-success key,
  -- and the client's auto-unwrap depends on that being true — a third top-level
  -- key flips every caller in the app from unwrap to pass-through at once.
  ASSERT (v_env->>'success')::boolean,
    pg_catalog.format('T2b FAIL: envelope has no success:true — %s', v_env::text);
  ASSERT v_env ? 'data',
    pg_catalog.format('T2c FAIL: envelope has no data key — %s', v_env::text);
  ASSERT (SELECT pg_catalog.count(*) FROM jsonb_object_keys(v_env)) = 2,
    pg_catalog.format('T2d FAIL: envelope has %s top-level keys, not exactly '
      '{success, data}. A third key silently disables the client auto-unwrap for '
      'every RPC in the app, not just this one: %s',
      (SELECT pg_catalog.count(*) FROM jsonb_object_keys(v_env)), v_env::text);

  ASSERT v_env->'data'->>'status' IN ('EXECUTED','QUEUED_FOR_APPROVAL','SUGGESTED'),
    pg_catalog.format('T2e FAIL: data.status is %s, not one of the three §3 '
      'outcomes', v_env->'data'->>'status');

  -- The action was really recorded, by the real principal, in the real tenant.
  ASSERT EXISTS (
    SELECT 1 FROM core.action_requests ar
     WHERE ar.tenant_id = '00000014-1111-1111-1111-111111111111'
       AND ar.action_type = 'ENQUIRY_ARCHIVE'),
    'T2f FAIL: core.perform_action returned an envelope but wrote no '
    'action_request. An envelope without a ledger row is the exact shape of a '
    'wrapper that swallowed the gate.';

  RAISE NOTICE
    'T2 PASS - the authenticated role itself performed an action through '
    'core.perform_action, got {success,data} and nothing else, landed on one of '
    'the three outcomes, and left an action_request behind. Status was %.',
    v_env->'data'->>'status';
END;
$t2$;

-- ─── T3 · A cross-tenant caller is refused ──────────────────────────────────
-- Two directions, because they fail differently and only one of them is loud.

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='beta_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.xtenant_action',
  pg_temp.t014_try_value($$SELECT core.perform_action(
    'ENQUIRY_ARCHIVE','ENQ-T014-A','{}'::jsonb)$$)::text, true);
SELECT pg_catalog.set_config('t014.xtenant_read',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*))
    FROM core.enquiries WHERE ref='ENQ-T014-A'$$)::text, true);
RESET ROLE;

DO $t3$
DECLARE
  v_act  jsonb := pg_catalog.current_setting('t014.xtenant_action')::jsonb;
  v_read jsonb := pg_catalog.current_setting('t014.xtenant_read')::jsonb;
BEGIN
  -- (a) The WRITE direction must raise. A cross-tenant action that "succeeded"
  --     on zero rows would return an envelope and the caller could not tell.
  ASSERT NOT (v_act->>'ok')::boolean,
    pg_catalog.format('T3a FAIL: a Beta principal performed an action against '
      'Alpha''s ENQ-T014-A and it SUCCEEDED. This is the product-ending defect: '
      '%s', v_act::text);

  -- (b) The READ direction must be empty rather than an error. This is the half
  --     that is easy to get backwards: an error here would leak existence — a
  --     caller who can distinguish "refused" from "not there" can enumerate
  --     another tenant's refs one request at a time.
  ASSERT (v_read->>'ok')::boolean,
    pg_catalog.format('T3b FAIL: a cross-tenant SELECT ERRORED instead of '
      'returning no rows, which tells the caller the row exists: %s', v_read::text);
  ASSERT (v_read->'value')::text = '0',
    pg_catalog.format('T3c FAIL: a Beta principal can SEE Alpha''s enquiry. '
      'count=%s', (v_read->'value')::text);

  RAISE NOTICE
    'T3 PASS - a cross-tenant action RAISES and a cross-tenant read returns zero '
    'rows rather than an error, so refusal does not leak existence.';
END;
$t3$;

-- ─── T4 · anon sees nothing ─────────────────────────────────────────────────
-- Four probes, because "nothing" has four failure modes and three of them look
-- like success from the outside.

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('t014.anon_read',
  pg_temp.t014_try($$SELECT 1 FROM core.organisations LIMIT 1$$)::text, true);
SELECT pg_catalog.set_config('t014.anon_rpc',
  pg_temp.t014_try($$SELECT core.perform_action('ENQUIRY_ARCHIVE','ENQ-T014-A')$$)::text, true);
SELECT pg_catalog.set_config('t014.anon_view',
  pg_temp.t014_try($$SELECT 1 FROM core.audit_entries LIMIT 1$$)::text, true);
SELECT pg_catalog.set_config('t014.anon_app',
  pg_temp.t014_try($$SELECT 1 FROM app.action_types LIMIT 1$$)::text, true);
RESET ROLE;

DO $t4$
DECLARE
  v_read jsonb := pg_catalog.current_setting('t014.anon_read')::jsonb;
  v_rpc  jsonb := pg_catalog.current_setting('t014.anon_rpc')::jsonb;
  v_view jsonb := pg_catalog.current_setting('t014.anon_view')::jsonb;
  v_app  jsonb := pg_catalog.current_setting('t014.anon_app')::jsonb;
BEGIN
  ASSERT NOT (v_read->>'ok')::boolean,
    pg_catalog.format('T4a FAIL: anon can read core.organisations: %s', v_read::text);
  ASSERT NOT (v_rpc->>'ok')::boolean,
    pg_catalog.format('T4b FAIL: anon can EXECUTE core.perform_action. anon is '
      'hostile by default and holds EXECUTE on the public-token allowlist only; '
      '014 creates no allowlist entry: %s', v_rpc::text);
  ASSERT NOT (v_view->>'ok')::boolean,
    pg_catalog.format('T4c FAIL: anon can read a core view. The four granted '
      'views are security_invoker and were granted to authenticated only: %s',
      v_view::text);
  ASSERT NOT (v_app->>'ok')::boolean,
    pg_catalog.format('T4d FAIL: anon can read an app table. app is neither '
      'exposed to PostgREST nor granted, and both halves must hold: %s', v_app::text);

  RAISE NOTICE
    'T4 PASS - anon is refused a core table, a core view, an app table and the '
    'action RPC. Four refusals, measured by impersonation, not read off relacl.';
END;
$t4$;

-- ─── T5 · Tenant isolation on the read path ─────────────────────────────────
-- The same table, two principals, one transaction. Comparing row SETS rather
-- than counts, because two tenants with one row each have the same count.

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.alpha_orgs',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.array_agg(ref ORDER BY ref))
    FROM core.organisations$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='beta_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.beta_orgs',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.array_agg(ref ORDER BY ref))
    FROM core.organisations$$)::text, true);
RESET ROLE;

DO $t5$
DECLARE
  v_a jsonb := (pg_catalog.current_setting('t014.alpha_orgs')::jsonb)->'value';
  v_b jsonb := (pg_catalog.current_setting('t014.beta_orgs')::jsonb)->'value';
BEGIN
  ASSERT v_a = '["ORG-T014-A"]'::jsonb,
    pg_catalog.format('T5a FAIL: Alpha sees %s, expected exactly ORG-T014-A', v_a::text);
  ASSERT v_b = '["ORG-T014-B"]'::jsonb,
    pg_catalog.format('T5b FAIL: Beta sees %s, expected exactly ORG-T014-B', v_b::text);
  ASSERT v_a <> v_b,
    'T5c FAIL: both tenants see an identical row set, which is what a policy '
    'that evaluates to true for everyone looks like when each tenant happens to '
    'own the same number of rows.';

  RAISE NOTICE
    'T5 PASS - two principals read the same table in one transaction and get '
    'disjoint row SETS, not merely equal counts.';
END;
$t5$;

-- ─── T6 · The global-row fallback, derived and not guessed ──────────────────
-- 009 makes compliance rules national by default (tenant_id NULL) with tenant
-- overrides. A predicate that only matched `tenant_id = <mine>` would hide the
-- ENTIRE national registry from every tenant while looking perfectly correct.

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.alpha_rules',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.array_agg(rule_code ORDER BY rule_code))
    FROM core.compliance_rules WHERE rule_code LIKE 'T014-%'$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='beta_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.beta_rules',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.array_agg(rule_code ORDER BY rule_code))
    FROM core.compliance_rules WHERE rule_code LIKE 'T014-%'$$)::text, true);
RESET ROLE;

DO $t6$
DECLARE
  v_a jsonb := (pg_catalog.current_setting('t014.alpha_rules')::jsonb)->'value';
  v_b jsonb := (pg_catalog.current_setting('t014.beta_rules')::jsonb)->'value';
  v_q text;
BEGIN
  ASSERT v_a = '["T014-ALPHA-OVERRIDE","T014-NATIONAL"]'::jsonb,
    pg_catalog.format('T6a FAIL: Alpha should see its own override AND the '
      'national rule, and sees %s', v_a::text);
  ASSERT v_b = '["T014-NATIONAL"]'::jsonb,
    pg_catalog.format('T6b FAIL: Beta should see the national rule and NOT '
      'Alpha''s override, and sees %s', v_b::text);

  -- And the fallback is ABSENT where tenant_id is NOT NULL — that is the half a
  -- hand-maintained list gets wrong, by pasting the permissive predicate
  -- everywhere. Read the predicate out of the catalogue rather than trusting the
  -- migration's intent.
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) INTO v_q
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
   WHERE c.relname='organisations' AND p.polname='organisations_tenant_select';
  ASSERT v_q NOT LIKE '%IS NULL%',
    pg_catalog.format('T6c FAIL: core.organisations.tenant_id is NOT NULL, so its '
      'policy must not admit a global row. Predicate is: %s', v_q);

  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) INTO v_q
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
   WHERE c.relname='compliance_rules' AND p.polname='compliance_rules_tenant_select';
  ASSERT v_q LIKE '%IS NULL%',
    pg_catalog.format('T6d FAIL: core.compliance_rules.tenant_id is NULLABLE and '
      'its policy must admit the national row. Predicate is: %s', v_q);

  RAISE NOTICE
    'T6 PASS - the national rule is visible to both tenants, the override to one, '
    'and the fallback appears in exactly the predicates whose column can be NULL.';
END;
$t6$;

-- ─── T7 · core.v_approval_requests ──────────────────────────────────────────
-- Readable through the definer path, refused to a direct SELECT. See the 014
-- header: the brief asked for "readable", doc 09 §12 forbids granting it, and
-- this is the pin that shows both are satisfied at once.

CREATE FUNCTION pg_temp.t014_read_approvals() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT to_jsonb(pg_catalog.count(*))
    FROM core.v_approval_requests
   WHERE tenant_id = (SELECT app.require_tenant_id());
$fn$;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_manager'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.view_definer',
  pg_temp.t014_try_value($$SELECT pg_temp.t014_read_approvals()$$)::text, true);
SELECT pg_catalog.set_config('t014.view_direct',
  pg_temp.t014_try($$SELECT 1 FROM core.v_approval_requests LIMIT 1$$)::text, true);
RESET ROLE;

DO $t7$
DECLARE
  v_def jsonb := pg_catalog.current_setting('t014.view_definer')::jsonb;
  v_dir jsonb := pg_catalog.current_setting('t014.view_direct')::jsonb;
BEGIN
  ASSERT (v_def->>'ok')::boolean,
    pg_catalog.format('T7a FAIL: the approval view is NOT readable through the '
      'definer path, so core.list_approvals cannot be built over it in 018: %s',
      v_def::text);

  ASSERT NOT (v_dir->>'ok')::boolean,
    pg_catalog.format('T7b FAIL: `authenticated` can SELECT core.v_approval_requests '
      'directly. Doc 09 §12 forbids the grant: the view is security_invoker, so '
      'granting it runs 011''s join path AS the browser. Result: %s', v_dir::text);

  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.table_privileges
     WHERE table_schema='core' AND table_name='v_approval_requests'
       AND grantee IN ('authenticated','anon')),
    'T7c FAIL: a grant on core.v_approval_requests reached a client role.';

  RAISE NOTICE
    'T7 PASS - the approval view is readable through a definer for the caller''s '
    'own tenant and refused to a direct authenticated SELECT. Both halves, which '
    'is what "readable" has to mean for a security_invoker view.';
END;
$t7$;

-- ─── T8 · app.apply_tenant_policies on a THROWAWAY table ────────────────────
-- 004's precedent, and its reason: testing the 114 tables the function happened
-- to be applied to does not prove the 115th gets the same treatment. This table
-- is created inside the pin and dies with the ROLLBACK.

CREATE TABLE core.t014_scratch (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  label     text
);
ALTER TABLE core.t014_scratch ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.t014_scratch FORCE  ROW LEVEL SECURITY;

CREATE TABLE core.t014_scratch_nullable (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  label     text
);
ALTER TABLE core.t014_scratch_nullable ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.t014_scratch_nullable FORCE  ROW LEVEL SECURITY;

CREATE TABLE core.t014_scratch_no_tenant (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text
);
ALTER TABLE core.t014_scratch_no_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.t014_scratch_no_tenant FORCE  ROW LEVEL SECURITY;

CREATE TABLE core.t014_scratch_unforced (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL
);

DO $t8$
DECLARE
  v_q       text;
  v_refused boolean;
BEGIN
  PERFORM app.apply_tenant_policies('core','t014_scratch');
  PERFORM app.apply_tenant_policies('core','t014_scratch_nullable');

  -- (a) The 115th table gets both policies.
  ASSERT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy p
           JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
          WHERE c.relname='t014_scratch') = 2,
    'T8a FAIL: a brand-new table did not receive both policies, so nothing about '
    'the 114 tables in §2 generalises.';

  -- (b) RESTRICTIVE, not permissive. A permissive isolation policy is ORed with
  --     every other permissive policy and can be widened by adding one beside it.
  ASSERT (SELECT NOT p.polpermissive FROM pg_catalog.pg_policy p
           JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
          WHERE c.relname='t014_scratch' AND p.polname='t014_scratch_tenant_isolation'),
    'T8b FAIL: the isolation policy is PERMISSIVE. It must be RESTRICTIVE or it '
    'is ORed with the select policy and guarantees nothing.';

  -- (c) FOR ALL, with a WITH CHECK. USING alone leaves writes unguarded.
  ASSERT (SELECT p.polcmd = '*' AND p.polwithcheck IS NOT NULL
            FROM pg_catalog.pg_policy p
            JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
           WHERE c.relname='t014_scratch' AND p.polname='t014_scratch_tenant_isolation'),
    'T8c FAIL: the isolation policy is not FOR ALL with a WITH CHECK, so a write '
    'grant arriving later would not be tenant-scoped.';

  -- (d) TO authenticated, never TO PUBLIC.
  ASSERT (SELECT 'authenticated'::regrole::oid = ANY (p.polroles)
            FROM pg_catalog.pg_policy p
            JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
           WHERE c.relname='t014_scratch' AND p.polname='t014_scratch_tenant_select'),
    'T8d FAIL: the select policy is not scoped TO authenticated.';

  -- (e) The NOT NULL / NULLABLE difference is DERIVED from the column.
  SELECT pg_catalog.pg_get_expr(p.polqual,p.polrelid) INTO v_q
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
   WHERE c.relname='t014_scratch' AND p.polname='t014_scratch_tenant_select';
  ASSERT v_q NOT LIKE '%IS NULL%',
    pg_catalog.format('T8e FAIL: NOT NULL tenant_id got the global fallback: %s', v_q);

  SELECT pg_catalog.pg_get_expr(p.polqual,p.polrelid) INTO v_q
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
   WHERE c.relname='t014_scratch_nullable' AND p.polname='t014_scratch_nullable_tenant_select';
  ASSERT v_q LIKE '%IS NULL%',
    pg_catalog.format('T8f FAIL: NULLABLE tenant_id did not get the global '
      'fallback, so a national row would be invisible: %s', v_q);

  -- (f) The no-tenant refusal fires. finalise_table''s contract, kept.
  v_refused := false;
  BEGIN
    PERFORM app.apply_tenant_policies('core','t014_scratch_no_tenant');
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T8g FAIL: a table with NO tenant_id was given a tenant policy. A policy that '
    'cannot filter by tenant does not isolate, and accepting one silently is how a '
    'table reaches production with a predicate that is true for everybody.';

  -- (g) The unforced refusal fires. FORCE removes the owner exemption; without it
  --     a definer function owned by the table owner reads every tenant.
  v_refused := false;
  BEGIN
    PERFORM app.apply_tenant_policies('core','t014_scratch_unforced');
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T8h FAIL: a table without RLS ENABLED AND FORCED was policied anyway. The '
    'function must refuse rather than quietly ALTER it, because a table that '
    'reached here unforced has a provenance problem an ALTER would erase.';

  -- (h) Idempotent, and idempotent in the way that matters: re-running REPLACES a
  --     wrong predicate rather than leaving it standing.
  EXECUTE $sql$DROP POLICY t014_scratch_tenant_select ON core.t014_scratch$sql$;
  EXECUTE $sql$CREATE POLICY t014_scratch_tenant_select ON core.t014_scratch
            AS PERMISSIVE FOR SELECT TO authenticated USING (true)$sql$;
  PERFORM app.apply_tenant_policies('core','t014_scratch');
  SELECT pg_catalog.pg_get_expr(p.polqual,p.polrelid) INTO v_q
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
   WHERE c.relname='t014_scratch' AND p.polname='t014_scratch_tenant_select';
  ASSERT v_q LIKE '%require_tenant_id%',
    pg_catalog.format('T8i FAIL: re-running the function left a USING (true) '
      'policy standing. An existence check would have done exactly this, which is '
      'why the function drops and recreates: %s', v_q);

  RAISE NOTICE
    'T8 PASS - the 115th table gets a RESTRICTIVE FOR ALL isolation policy with a '
    'WITH CHECK plus a TO-authenticated select policy, the global fallback is '
    'derived from the column, a no-tenant table and an unforced table are both '
    'REFUSED, and re-running replaces a wrong predicate instead of keeping it.';
END;
$t8$;

-- ─── T9 · The write path cannot be bypassed ─────────────────────────────────
-- core.organisations carries no state-transition trigger, so a refusal here is
-- unambiguously the privilege layer and not 011's gate answering first.

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.w_insert', pg_temp.t014_try($$
  INSERT INTO core.organisations (tenant_id,ref,name,owner_id)
  VALUES ('00000014-1111-1111-1111-111111111111','ORG-T014-X','Smuggled',
          '00000014-0000-0000-0000-0000000000a1')$$)::text, true);
SELECT pg_catalog.set_config('t014.w_update', pg_temp.t014_try($$
  UPDATE core.organisations SET name='Renamed' WHERE ref='ORG-T014-A'$$)::text, true);
SELECT pg_catalog.set_config('t014.w_delete', pg_temp.t014_try($$
  DELETE FROM core.organisations WHERE ref='ORG-T014-A'$$)::text, true);
RESET ROLE;

DO $t9$
DECLARE
  v_i jsonb := pg_catalog.current_setting('t014.w_insert')::jsonb;
  v_u jsonb := pg_catalog.current_setting('t014.w_update')::jsonb;
  v_d jsonb := pg_catalog.current_setting('t014.w_delete')::jsonb;
BEGIN
  ASSERT NOT (v_i->>'ok')::boolean,
    pg_catalog.format('T9a FAIL: authenticated INSERTed into core.organisations '
      'directly. That is a write with no action_request, no policy evaluation, no '
      'action_effect and no audit row — the one thing the envelope exists to make '
      'impossible: %s', v_i::text);
  ASSERT NOT (v_u->>'ok')::boolean,
    pg_catalog.format('T9b FAIL: authenticated UPDATEd core.organisations: %s', v_u::text);
  ASSERT NOT (v_d->>'ok')::boolean,
    pg_catalog.format('T9c FAIL: authenticated DELETEd from core.organisations: %s', v_d::text);

  -- All three must be the PRIVILEGE layer (42501), not a policy returning zero
  -- rows. A DELETE refused only by a policy reports success on zero rows, and the
  -- caller cannot tell it from a delete that found nothing.
  ASSERT v_i->>'sqlstate' = '42501',
    pg_catalog.format('T9d FAIL: the INSERT was refused with sqlstate %s, not '
      '42501. Refusal by policy alone is one GRANT away from being no refusal.',
      v_i->>'sqlstate');

  RAISE NOTICE
    'T9 PASS - INSERT, UPDATE and DELETE by authenticated are all refused at the '
    'privilege layer with 42501, not by a policy matching zero rows.';
END;
$t9$;

-- ─── T10 · The wrappers wrap, and do nothing else ───────────────────────────

DO $t10$
DECLARE
  v_def text;
  v_fn  text;
BEGIN
  -- Doc 09 §2's own assertion, verbatim in intent: whitespace-stripped body must
  -- contain the composition. A later edit that inlined a second policy
  -- evaluation would still return an envelope and would pass every other check
  -- in this file.
  v_def := pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(
      'core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure),
    '\s+','','g');
  ASSERT pg_catalog.strpos(v_def,'app.ok(app.perform_action(') > 0,
    'T10a FAIL: core.perform_action does not wrap app.perform_action in app.ok. '
    'Doc 09 §2.';

  v_def := pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef('core.decide_approval(uuid,text,text,text,text)'::regprocedure),
    '\s+','','g');
  ASSERT pg_catalog.strpos(v_def,'app.ok(app.decide_approval(') > 0,
    'T10b FAIL: core.decide_approval does not wrap app.decide_approval in app.ok.';

  -- All five arguments. Doc 09 §12: "a wrapper that drops the hash argument
  -- silently disables" the optimistic-concurrency check — the decision still
  -- succeeds, so nothing visible breaks and two approvers can overwrite each
  -- other's view of the diff.
  ASSERT (SELECT p.pronargs FROM pg_catalog.pg_proc p
           WHERE p.oid='core.decide_approval(uuid,text,text,text,text)'::regprocedure) = 5,
    'T10c FAIL: core.decide_approval does not take five arguments.';
  ASSERT pg_catalog.strpos(v_def,'p_expected_diff_hash') > 0,
    'T10d FAIL: core.decide_approval never mentions p_expected_diff_hash, so the '
    'optimistic-concurrency check is disabled with no visible symptom.';

  v_def := pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef('core.bulk_decide_approvals(uuid[],text,text,text)'::regprocedure),
    '\s+','','g');
  ASSERT pg_catalog.strpos(v_def,'app.ok(app.bulk_decide(') > 0,
    'T10e FAIL: core.bulk_decide_approvals does not wrap app.bulk_decide in app.ok.';

  -- And the underlying functions are STILL unreachable by a client. Doc 09 §1:
  -- "the underlying grant must not change."
  FOREACH v_fn IN ARRAY ARRAY[
    'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)',
    'app.decide_approval(uuid,text,text,text,text)',
    'app.bulk_decide(uuid[],text,text,text)']
  LOOP
    ASSERT NOT has_function_privilege('authenticated', pg_catalog.to_regprocedure(v_fn), 'EXECUTE'),
      pg_catalog.format('T10f FAIL: %s is reachable by authenticated. The wrapper '
        'exists so that it does not have to be; granting both means the envelope '
        'has two doors and only one of them is wrapped.', v_fn);
    ASSERT NOT has_function_privilege('anon', pg_catalog.to_regprocedure(v_fn), 'EXECUTE'),
      pg_catalog.format('T10g FAIL: %s is reachable by anon.', v_fn);
  END LOOP;

  -- app.ok stays revoked from authenticated. Doc 09 §0 rule 3 names this exact
  -- temptation; 014 grants app.require_tenant_id and NOTHING else, and this is
  -- the line that keeps that honest.
  ASSERT NOT has_function_privilege('authenticated','app.ok(jsonb)'::regprocedure,'EXECUTE'),
    'T10h FAIL: app.ok is granted to authenticated. 014 grants exactly one app '
    'function to a client role and app.ok is not it.';

  RAISE NOTICE
    'T10 PASS - all three wrappers compose app.ok over their 011 function and '
    'nothing else, decide_approval carries all five arguments including the diff '
    'hash, and the three app functions plus app.ok remain unreachable by a client.';
END;
$t10$;

ROLLBACK;
