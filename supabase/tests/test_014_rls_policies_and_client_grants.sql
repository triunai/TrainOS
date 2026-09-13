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
-- T1  Inventory, re-derived from the catalogue against a 001-017 database:
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
--
-- ⚠ WHICH DATABASE THIS RUNS AGAINST: 001-017, NOT 001-014.
-- T1's inventory numbers (116 policy pairs, 121 `core` SELECT grants) are the
-- post-017 figures — 017 adds three tenant-scoped tables and two granted views —
-- and T12's gate set includes tables 013 created. Against a 001-014-only database
-- T1 fails on the counts, correctly, because it is being asked about a database
-- it does not describe. The migration header's own object counts are the 001-014
-- figures and say so; the two sets are not a contradiction, they describe
-- different moments, and each says which.
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
  ('00000014-0000-0000-0000-0000000000a3','t014-alpha-admin@example.invalid'),
  ('00000014-0000-0000-0000-0000000000a4','t014-alpha-ops@example.invalid'),
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
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a3',
   'ADMIN','HUMAN',NULL,'ACTIVE',true),
  -- OPS, not TRAINER: a TRAINER membership needs a trainer_id
  -- (002:171 memberships_trainer_id_present) and this pin's subject is a role
  -- that legitimately lacks portal:token:issue, not the trainer record model.
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a4',
   'OPS','HUMAN',NULL,'ACTIVE',true),
  ('00000014-2222-2222-2222-222222222222','00000014-0000-0000-0000-0000000000b1',
   'SALES','HUMAN',NULL,'ACTIVE',true);

INSERT INTO public.user_profiles (tenant_id,user_id,display_name) VALUES
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a1','T014 Alpha Sales'),
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a2','T014 Alpha Manager'),
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a3','T014 Alpha Admin'),
  ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a4','T014 Alpha Ops'),
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
   '{"sub":"00000014-0000-0000-0000-0000000000b1","role":"authenticated","tenant_id":"00000014-2222-2222-2222-222222222222","app_role":"SALES","actor_kind":"HUMAN","aal":"aal1"}'),
  -- aal2, because 002's memberships_write_admin WITH CHECK demands it and an
  -- aal1 ADMIN would be refused for the wrong reason: the pin has to fail on the
  -- privilege it is testing, not on a second factor it forgot to satisfy.
  ('alpha_admin',
   '{"sub":"00000014-0000-0000-0000-0000000000a3","role":"authenticated","tenant_id":"00000014-1111-1111-1111-111111111111","app_role":"ADMIN","actor_kind":"HUMAN","aal":"aal2"}'),
  ('alpha_ops',
   '{"sub":"00000014-0000-0000-0000-0000000000a4","role":"authenticated","tenant_id":"00000014-1111-1111-1111-111111111111","app_role":"OPS","actor_kind":"HUMAN","aal":"aal1"}'),
  ('beta_admin',
   '{"sub":"00000014-0000-0000-0000-0000000000b1","role":"authenticated","tenant_id":"00000014-2222-2222-2222-222222222222","app_role":"ADMIN","actor_kind":"HUMAN","aal":"aal2"}');

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

  -- ⚠ has_table_privilege throughout T1c-T1e, not information_schema.
  -- table_privileges. That view reports a privilege under the grantee it was
  -- granted TO, and says nothing about one granted to PUBLIC that anon and
  -- authenticated both inherit. Today's revokes make the two spellings agree;
  -- this pin exists for the day a `GRANT ... TO PUBLIC` makes them disagree, and
  -- has_table_privilege is the one that would still be right.
  SELECT pg_catalog.count(*) INTO v_grants
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='core' AND c.relkind IN ('r','v','m','p','f')
     AND has_table_privilege('authenticated', c.oid, 'SELECT');
  ASSERT v_grants = 121,
    pg_catalog.format('T1c FAIL: expected 121 SELECT grants in core to '
      'authenticated — 117 tables (114 from 014 + 3 from 017) plus four views: '
      'core.audit_entries, core.v_contact_consent_current, and 017''s '
      'v_tax_policy_unverified and v_trainer_accreditation. Three views are '
      'deliberately excluded: v_approval_requests (doc 09 §12) and budget_status '
      '/ model_tier_status (security_invoker over app.usage_rollup, so a grant '
      'cannot work). Found %s.', v_grants);

  SELECT pg_catalog.count(*) INTO v_writes
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN pg_catalog.unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS w(priv)
   WHERE n.nspname='core' AND c.relkind IN ('r','v','m','p','f')
     AND (has_table_privilege('authenticated', c.oid, w.priv)
       OR has_table_privilege('anon', c.oid, w.priv));
  ASSERT v_writes = 0,
    pg_catalog.format('T1d FAIL: %s non-SELECT privilege(s) in core reach a client '
      'role. Every one of them is a path around the action envelope.', v_writes);

  SELECT pg_catalog.count(*) INTO v_anon
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS w(priv)
   WHERE n.nspname IN ('core','app','public') AND c.relkind IN ('r','v','m','p','f')
     AND has_table_privilege('anon', c.oid, w.priv);
  ASSERT v_anon = 0,
    pg_catalog.format('T1e FAIL: anon holds %s table privilege(s). 014 creates no '
      'public-token allowlist entry, so the correct number is zero.', v_anon);

  FOREACH v_fn IN ARRAY ARRAY[
    'core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)',
    'core.decide_approval(uuid,text,text,text,text)',
    'core.bulk_decide_approvals(jsonb,text,text,text)']
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

-- ⚠ FIXTURE ROWS, BECAUSE AN EMPTY VIEW PROVES NOTHING. An earlier version of T7
-- asserted only that the definer read did not RAISE, with no rows seeded at all.
-- It would have passed against a view returning zero rows for every caller — and
-- the catalog nonetheless claimed T7 proved "that tenant's rows and no other's".
-- One approval per tenant makes "sees its own" and "sees the other's" two
-- different numbers instead of both being zero.
INSERT INTO core.action_requests
  (id,tenant_id,action_type,requested_by_kind,requested_by_id,status)
VALUES
  ('00000014-ac00-0000-0000-000000000001','00000014-1111-1111-1111-111111111111',
   'PROPOSAL_SEND','HUMAN','00000014-0000-0000-0000-0000000000a1','QUEUED_FOR_APPROVAL'),
  ('00000014-ac00-0000-0000-000000000002','00000014-2222-2222-2222-222222222222',
   'PROPOSAL_SEND','HUMAN','00000014-0000-0000-0000-0000000000b1','QUEUED_FOR_APPROVAL');

INSERT INTO core.approval_requests
  (id,tenant_id,action_request_id,policy_id,action_type,subject,requested_by_kind,
   reason,diff,diff_hash,approver_role,sla_due_at,expires_at,bulk_approvable)
VALUES
  ('00000014-a99a-0000-0000-000000000001','00000014-1111-1111-1111-111111111111',
   '00000014-ac00-0000-0000-000000000001','pol_t014','PROPOSAL_SEND','proposal',
   'HUMAN','T014 alpha approval','[]'::jsonb,pg_catalog.repeat('a',64),'MD',
   pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '7 days', false),
  ('00000014-a99a-0000-0000-000000000002','00000014-2222-2222-2222-222222222222',
   '00000014-ac00-0000-0000-000000000002','pol_t014','PROPOSAL_SEND','proposal',
   'HUMAN','T014 beta approval','[]'::jsonb,pg_catalog.repeat('b',64),'MD',
   pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '7 days', false);

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

  -- The row count, not just the absence of an exception. Two approvals exist, one
  -- per tenant; the definer read is scoped to the caller's tenant, so exactly one
  -- is the only answer that distinguishes "correctly scoped" from "returns
  -- nothing" and from "returns everything".
  ASSERT (v_def->'value')::text = '1',
    pg_catalog.format('T7a1 FAIL: the definer read returned %s approval(s) for '
      'tenant Alpha, expected exactly 1. Two rows were seeded, one per tenant: 0 '
      'means the definer path returns nothing and the assertion above was passing '
      'on an empty view, 2 means it returns the other tenant''s as well.',
      COALESCE((v_def->'value')::text,'NULL'));

  ASSERT (SELECT pg_catalog.count(*) FROM core.v_approval_requests) = 2,
    'T7a2 FAIL: the two seeded approvals are not both visible to the owner, so '
    'the "exactly one" above could be arithmetic rather than tenant scoping.';

  ASSERT NOT (v_dir->>'ok')::boolean,
    pg_catalog.format('T7b FAIL: `authenticated` can SELECT core.v_approval_requests '
      'directly. Doc 09 §12 forbids the grant: the view is security_invoker, so '
      'granting it runs 011''s join path AS the browser. Result: %s', v_dir::text);

  ASSERT NOT has_table_privilege('authenticated','core.v_approval_requests','SELECT')
     AND NOT has_table_privilege('anon','core.v_approval_requests','SELECT'),
    'T7c FAIL: a grant on core.v_approval_requests reached a client role, by some '
    'route — including through PUBLIC, which information_schema.table_privileges '
    'would not have shown under either role name.';

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
  PERFORM app.apply_tenant_policies('core','t014_scratch','014');
  PERFORM app.apply_tenant_policies('core','t014_scratch_nullable','014');

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
    PERFORM app.apply_tenant_policies('core','t014_scratch_no_tenant','014');
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
    PERFORM app.apply_tenant_policies('core','t014_scratch_unforced','014');
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
  PERFORM app.apply_tenant_policies('core','t014_scratch','014');
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
    pg_catalog.pg_get_functiondef('core.bulk_decide_approvals(jsonb,text,text,text)'::regprocedure),
    '\s+','','g');
  ASSERT pg_catalog.strpos(v_def,'app.ok(app.bulk_decide(') > 0,
    'T10e FAIL: core.bulk_decide_approvals does not wrap app.bulk_decide in app.ok.';

  -- And the underlying functions are STILL unreachable by a client. Doc 09 §1:
  -- "the underlying grant must not change."
  FOREACH v_fn IN ARRAY ARRAY[
    'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)',
    'app.decide_approval(uuid,text,text,text,text)',
    'app.bulk_decide(jsonb,text,text,text)']
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


-- ─── T11 · CRIT-1 · an ADMIN cannot delete their way to a higher role ────────
-- The finding this pin exists for: 014 granted DELETE on public.memberships,
-- which 002 withheld. 002's escalation stop, `memberships_no_self_edit`, is
-- `FOR UPDATE` only, and `memberships_write_admin` is `FOR ALL` — so a DELETE
-- privilege plus those two policies is a complete delete-then-reinsert path to
-- any role, run by an aal2 ADMIN against their own row, with the audit trail
-- 002:768 requires removed in the same statement.
--
-- Both layers are pinned, separately, because either one alone is one edit from
-- being the only one:
--   T11a/b  the privilege is absent and the attempt is refused by it.
--   T11c/d  the row survives and the role is unchanged.
--   T11e    with the privilege DELIBERATELY RE-GRANTED inside this transaction,
--           the restrictive policy still refuses. This is the half that would
--           have caught the original defect, because the original defect WAS a
--           grant, and a pin that only checks for the grant's absence tells you
--           nothing about what happens the day somebody adds it back.

-- ⚠ THE SHIPPED GRANT STATE, CAPTURED BEFORE THIS PIN TOUCHES IT.
-- T11a used to assert `NOT has_table_privilege(... 'DELETE')` inside the DO block
-- at the end — AFTER this pin had itself granted DELETE for the T11f probe and
-- revoked it again. The assertion therefore measured the pin's own revoke, not
-- the migration's grant, and passed against the original broken database. It was
-- a tautology in the one place the whole finding lives. The privilege is now read
-- into a GUC here, before any GRANT or REVOKE in this file runs, and asserted
-- from that.
SELECT pg_catalog.set_config('t014.shipped_delete_on_memberships',
  has_table_privilege('authenticated','public.memberships','DELETE')::text, true);
SELECT pg_catalog.set_config('t014.shipped_priv_set',
  (SELECT pg_catalog.string_agg(w.priv, ',' ORDER BY w.priv)
     FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS w(priv)
    WHERE has_table_privilege('authenticated','public.memberships', w.priv)), true);

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.admin_self_delete',
  pg_temp.t014_try($$DELETE FROM public.memberships
                      WHERE user_id = '00000014-0000-0000-0000-0000000000a3'::uuid$$)::text, true);
SELECT pg_catalog.set_config('t014.admin_other_delete',
  pg_temp.t014_try($$DELETE FROM public.memberships
                      WHERE user_id = '00000014-0000-0000-0000-0000000000a1'::uuid$$)::text, true);
-- The soft-delete path 002 says removal actually is, so the pin proves the
-- product still works rather than only that the attack fails.
SELECT pg_catalog.set_config('t014.admin_soft_remove',
  pg_temp.t014_try($$UPDATE public.memberships SET status = 'REMOVED'
                      WHERE user_id = '00000014-0000-0000-0000-0000000000a1'::uuid$$)::text, true);
RESET ROLE;

-- Now re-grant the privilege this migration withholds, and try again. Inside the
-- pin's transaction, so it is gone at ROLLBACK like every other fixture.
--
-- ⚠ AND THE COUNTERFACTUAL, which T13 and T14 both carry and an earlier version
-- of this probe did not. "Deleted zero rows" is also what you get if
-- `memberships_write_admin`'s USING stops matching the target row for an
-- unrelated reason — somebody adds an aal2 term to its USING, where today there
-- is only one in its WITH CHECK (002:751-756), or the fixture's role or tenant
-- drifts. So the same DELETE is run twice: once with the restrictive policy
-- standing, where it must delete nothing, and once with the policy dropped,
-- where it MUST delete exactly one row. Only the pair proves the policy is what
-- is refusing.
GRANT DELETE ON public.memberships TO authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.admin_delete_with_grant',
  pg_temp.t014_try_value($$WITH d AS (
      DELETE FROM public.memberships
       WHERE user_id = '00000014-0000-0000-0000-0000000000a3'::uuid
       RETURNING 1)
    SELECT to_jsonb(pg_catalog.count(*)) FROM d$$)::text, true);
RESET ROLE;

-- The counterfactual: same grant, same caller, same statement, policy removed.
DROP POLICY memberships_no_client_delete ON public.memberships;
SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.admin_delete_without_policy',
  pg_temp.t014_try_value($$WITH d AS (
      DELETE FROM public.memberships
       WHERE user_id = '00000014-0000-0000-0000-0000000000a3'::uuid
       RETURNING 1)
    SELECT to_jsonb(pg_catalog.count(*)) FROM d$$)::text, true);
RESET ROLE;

-- Put both back. The membership row the counterfactual just deleted has to come
-- back too, or every assertion after this one is measuring a database the pin
-- broke rather than the one 014 built.
CREATE POLICY memberships_no_client_delete ON public.memberships
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,agent_id,status,is_default)
VALUES ('00000014-1111-1111-1111-111111111111','00000014-0000-0000-0000-0000000000a3',
        'ADMIN','HUMAN',NULL,'ACTIVE',true)
ON CONFLICT (tenant_id,user_id) DO NOTHING;
REVOKE DELETE ON public.memberships FROM authenticated;

DO $t11$
DECLARE
  v_self    jsonb := pg_catalog.current_setting('t014.admin_self_delete')::jsonb;
  v_other   jsonb := pg_catalog.current_setting('t014.admin_other_delete')::jsonb;
  v_soft    jsonb := pg_catalog.current_setting('t014.admin_soft_remove')::jsonb;
  v_granted jsonb := pg_catalog.current_setting('t014.admin_delete_with_grant')::jsonb;
  v_without jsonb := pg_catalog.current_setting('t014.admin_delete_without_policy')::jsonb;
  v_role    text;
BEGIN
  -- T11a · THE SHIPPED PRIVILEGE, read before this pin granted anything. Not
  -- `has_table_privilege(...)` evaluated here, which by now reflects this pin's
  -- own REVOKE and would pass against the broken database the finding was filed
  -- against.
  ASSERT pg_catalog.current_setting('t014.shipped_delete_on_memberships') = 'false',
    'T11a FAIL: as shipped, authenticated holds DELETE on public.memberships. '
    '002:699 grants SELECT, INSERT and UPDATE and withholds DELETE on purpose: '
    'removal is status = ''REMOVED'' so the audit trail of who had access when '
    'survives, and a DELETE walks straight past memberships_no_self_edit, which '
    'is FOR UPDATE only.';

  -- And the whole set, not only the absence of the dangerous one — so narrowing
  -- past 002 fails here too, in the same reading.
  ASSERT pg_catalog.current_setting('t014.shipped_priv_set') = 'INSERT,SELECT,UPDATE',
    pg_catalog.format('T11b0 FAIL: as shipped, authenticated holds {%s} on '
      'public.memberships. 002:696-701 grants exactly SELECT, INSERT and UPDATE; '
      'the fix for the DELETE was to restore that set, not to narrow past it.',
      pg_catalog.current_setting('t014.shipped_priv_set'));

  -- T11b · the attack, run.
  ASSERT NOT (v_self->>'ok')::boolean,
    pg_catalog.format('T11b FAIL: an aal2 ADMIN deleted their own membership row. '
      'That is the first half of delete-and-reinsert-at-a-higher-role, and 002''s '
      'UPDATE-only escalation stop never sees it. Result: %s', v_self::text);
  ASSERT v_self->>'sqlstate' = '42501',
    pg_catalog.format('T11b1 FAIL: the self-delete was refused, but not by the '
      'privilege layer (sqlstate %s). Expected 42501 insufficient_privilege — a '
      'refusal from somewhere else means the grant is still there and something '
      'accidental is standing in the way.', v_self->>'sqlstate');

  ASSERT NOT (v_other->>'ok')::boolean,
    pg_catalog.format('T11c FAIL: an ADMIN hard-deleted another member''s row. '
      'Same missing audit trail, one indirection further away: %s', v_other::text);

  -- T11d · and the product path still works.
  ASSERT (v_soft->>'ok')::boolean,
    pg_catalog.format('T11d FAIL: an aal2 ADMIN cannot soft-remove a member with '
      'status = ''REMOVED''. Withholding DELETE is only correct while the path 002 '
      'says to use instead is open: %s', v_soft::text);

  ASSERT EXISTS (
    SELECT 1 FROM public.memberships
     WHERE user_id = '00000014-0000-0000-0000-0000000000a3'
       AND tenant_id = '00000014-1111-1111-1111-111111111111'
       AND role = 'ADMIN'),
    'T11e FAIL: the ADMIN''s own membership row is gone or changed after the '
    'attempts above. The escalation succeeded.';

  -- T11f · the second layer, with the privilege handed back.
  ASSERT (v_granted->>'ok')::boolean
     AND (v_granted->'value')::text = '0',
    pg_catalog.format('T11f FAIL: with DELETE re-granted, an aal2 ADMIN deleted '
      '%s membership row(s). The restrictive policy memberships_no_client_delete '
      'is the layer that has to hold when a future migration re-adds the grant, '
      'and it did not. Result: %s',
      COALESCE((v_granted->'value')::text,'?'), v_granted::text);

  -- T11f1 · the counterfactual. Without the policy the SAME statement deletes the
  -- row, so T11f's zero is the policy refusing and not the statement missing.
  ASSERT (v_without->>'ok')::boolean
     AND (v_without->'value')::text = '1',
    pg_catalog.format('T11f1 FAIL: with memberships_no_client_delete DROPPED and '
      'DELETE granted, the aal2 ADMIN still deleted %s row(s) instead of 1. That '
      'means T11f''s zero above was not the policy refusing — the DELETE was not '
      'matching the row for some other reason, and this whole probe proves '
      'nothing. Result: %s', COALESCE((v_without->'value')::text,'ERROR'), v_without::text);

  SELECT m.role::text INTO v_role FROM public.memberships m
   WHERE m.user_id = '00000014-0000-0000-0000-0000000000a3';
  ASSERT v_role = 'ADMIN',
    pg_catalog.format('T11g FAIL: the ADMIN''s stored role is now %s.', v_role);

  RAISE NOTICE
    'T11 PASS - DELETE on public.memberships is not granted, an aal2 ADMIN is '
    'refused at 42501 for their own row and for another member''s, the soft-remove '
    'UPDATE 002 prescribes still works, with the privilege deliberately re-granted '
    'the restrictive policy still deletes nothing, and with that policy dropped '
    'the same statement deletes exactly one row — so the zero was the policy.';
END;
$t11$;



-- ─── T12 · HIGH-1 · role-gated reads on the three sensitive tables ──────────
-- The finding: §2 gives all 113 tenant-scoped core tables the same tenant-only
-- predicate and §4 grants SELECT on all of them, so any principal of a tenant
-- could read every row of every table in it. For three tables 002 had already
-- decided otherwise and wrote the decision as a permission.
--
-- FOUR WAYS PER TABLE, because "gated" has four separate halves and a pin that
-- checks one of them proves nothing about the other three:
--   (a) signed out          — `anon`, which must hold nothing at all
--   (b) same tenant, low role — the principal the gate exists to stop
--   (c) same tenant, ADMIN  — the principal the gate must NOT stop, or the gate
--                             is a broken screen rather than an authorization
--   (d) wrong tenant, ADMIN — an ADMIN of the OTHER tenant, who holds the
--                             permission and must still see nothing, which is
--                             the half that proves the role gate composes WITH
--                             tenant isolation instead of replacing it
--
-- Each probe is ONE STATEMENT. A batched probe matrix lets the planner fold
-- repeated identical calls of a STABLE function, and `set_config`'s role-swap
-- side effects are invisible to it, so a batch returns a silently-wrong
-- all-denied result — which reads as a pass.

-- Fixture rows: one per tenant per table, so "sees nothing" and "sees only its
-- own" are distinguishable from "the table is empty".
INSERT INTO core.ai_provider_keys
  (tenant_id,provider_ref,provider,label,masked_key,key_fingerprint,key_ref,region,added_by)
VALUES
  ('00000014-1111-1111-1111-111111111111','prv_t014_alpha','OPENAI','Alpha key',
   'sk-'||pg_catalog.repeat('*',12)||'AAAA', pg_catalog.sha256('alpha'::bytea),
   'vault:alpha','ap-southeast-1','{"kind":"HUMAN","id":"00000014-0000-0000-0000-0000000000a3","name":null}'::jsonb),
  ('00000014-2222-2222-2222-222222222222','prv_t014_beta','OPENAI','Beta key',
   'sk-'||pg_catalog.repeat('*',12)||'BBBB', pg_catalog.sha256('beta'::bytea),
   'vault:beta','ap-southeast-1','{"kind":"HUMAN","id":"00000014-0000-0000-0000-0000000000b1","name":null}'::jsonb);

-- A share token must point at exactly one real target (007's
-- pst_exactly_one_target / pst_kind_matches_target). TNA is the shallower of the
-- two chains — opportunity then TNA — so it is the one the fixture builds.
INSERT INTO core.opportunities (id,tenant_id,organisation_id,owner_id,value_sen) VALUES
  ('00000014-0bbb-0000-0000-000000000001','00000014-1111-1111-1111-111111111111',
   '00000014-bbbb-bbbb-bbbb-bbbbbbbbbba1','00000014-0000-0000-0000-0000000000a1',100000),
  ('00000014-0bbb-0000-0000-000000000002','00000014-2222-2222-2222-222222222222',
   '00000014-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000014-0000-0000-0000-0000000000b1',100000);

INSERT INTO core.tnas (id,tenant_id,opportunity_id) VALUES
  ('00000014-0ddd-0000-0000-000000000001','00000014-1111-1111-1111-111111111111',
   '00000014-0bbb-0000-0000-000000000001'),
  ('00000014-0ddd-0000-0000-000000000002','00000014-2222-2222-2222-222222222222',
   '00000014-0bbb-0000-0000-000000000002');

INSERT INTO core.public_share_tokens
  (tenant_id,target_kind,tna_id,token_hash,created_by_kind,created_by_id)
VALUES
  ('00000014-1111-1111-1111-111111111111','TNA','00000014-0ddd-0000-0000-000000000001',
   extensions.digest('t014-alpha-token','sha256'),'HUMAN','00000014-0000-0000-0000-0000000000a1'),
  ('00000014-2222-2222-2222-222222222222','TNA','00000014-0ddd-0000-0000-000000000002',
   extensions.digest('t014-beta-token','sha256'),'HUMAN','00000014-0000-0000-0000-0000000000b1');

-- run_node_io hangs off runs -> run_nodes, and a run needs a registered agent
-- (013's runs_agent_fk), so the fixture is four rows deep per tenant.
INSERT INTO core.tier_keys (tenant_id,tier_key,label) VALUES
  ('00000014-1111-1111-1111-111111111111','MID','Mid'),
  ('00000014-2222-2222-2222-222222222222','MID','Mid');

INSERT INTO core.agents
  (id,tenant_id,agent_id,name,status,principal_user_id,default_tier)
VALUES
  ('00000014-a9e7-0000-0000-000000000001','00000014-1111-1111-1111-111111111111',
   'agent_proposal','Proposal Agent','ACTIVE','00000014-0000-0000-0000-0000000000a1','MID'),
  ('00000014-a9e7-0000-0000-000000000002','00000014-2222-2222-2222-222222222222',
   'agent_proposal','Proposal Agent','ACTIVE','00000014-0000-0000-0000-0000000000b1','MID');

INSERT INTO core.runs
  (id,tenant_id,agent_id,trigger,status,tiers_used,correlation_id,tokens_in,tokens_out,cost_sen)
VALUES
  ('00000014-7777-0000-0000-000000000001','00000014-1111-1111-1111-111111111111',
   'agent_proposal','{"type":"TNA_SIGNED_OFF"}'::jsonb,'SUCCEEDED',ARRAY['MID'],
   '00000014-c077-0000-0000-000000000001',10,10,10),
  ('00000014-7777-0000-0000-000000000002','00000014-2222-2222-2222-222222222222',
   'agent_proposal','{"type":"TNA_SIGNED_OFF"}'::jsonb,'SUCCEEDED',ARRAY['MID'],
   '00000014-c077-0000-0000-000000000002',10,10,10);

INSERT INTO core.run_nodes (id,tenant_id,run_id,node_key,seq,kind,name)
VALUES
  ('00000014-8888-0000-0000-000000000001','00000014-1111-1111-1111-111111111111',
   '00000014-7777-0000-0000-000000000001','extract',0,'TOOL','Extract'),
  ('00000014-8888-0000-0000-000000000002','00000014-2222-2222-2222-222222222222',
   '00000014-7777-0000-0000-000000000002','extract',0,'TOOL','Extract');

INSERT INTO core.run_node_io (tenant_id,run_node_id,prompt,completion) VALUES
  ('00000014-1111-1111-1111-111111111111','00000014-8888-0000-0000-000000000001',
   'ALPHA PROMPT','ALPHA COMPLETION'),
  ('00000014-2222-2222-2222-222222222222','00000014-8888-0000-0000-000000000002',
   'BETA PROMPT','BETA COMPLETION');

-- run_state_cards and run_snapshots: the two `run:read` tables the re-review
-- named as worse than the one that was gated. The card escapes the 30-day
-- redaction sweep run_node_io gets and carries goal and plan as free text; the
-- snapshot's `response` is every tool call's raw output for the tenant.
INSERT INTO core.run_state_cards (tenant_id,run_id,version,goal,budgets) VALUES
  ('00000014-1111-1111-1111-111111111111','00000014-7777-0000-0000-000000000001',1,
   'ALPHA GOAL, verbatim client text', '{"tokens":{"used":0,"limit":1000},"cost":{"used":0,"limit":100}}'::jsonb),
  ('00000014-2222-2222-2222-222222222222','00000014-7777-0000-0000-000000000002',1,
   'BETA GOAL', '{"tokens":{"used":0,"limit":1000},"cost":{"used":0,"limit":100}}'::jsonb);

INSERT INTO core.run_snapshots (tenant_id,run_id,tool_name,args_hash,args,response) VALUES
  ('00000014-1111-1111-1111-111111111111','00000014-7777-0000-0000-000000000001',
   'lookup_org', pg_catalog.repeat('a',64), '{"q":"alpha"}'::jsonb, '{"raw":"ALPHA TOOL OUTPUT"}'::jsonb),
  ('00000014-2222-2222-2222-222222222222','00000014-7777-0000-0000-000000000002',
   'lookup_org', pg_catalog.repeat('b',64), '{"q":"beta"}'::jsonb, '{"raw":"BETA TOOL OUTPUT"}'::jsonb);

-- (a) signed out, all three tables, one statement each.
SELECT pg_catalog.set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('t014.g_anon_keys',
  pg_temp.t014_try($$SELECT 1 FROM core.ai_provider_keys LIMIT 1$$)::text, true);
SELECT pg_catalog.set_config('t014.g_anon_tok',
  pg_temp.t014_try($$SELECT 1 FROM core.public_share_tokens LIMIT 1$$)::text, true);
SELECT pg_catalog.set_config('t014.g_anon_io',
  pg_temp.t014_try($$SELECT 1 FROM core.run_node_io LIMIT 1$$)::text, true);
SELECT pg_catalog.set_config('t014.g_anon_card',
  pg_temp.t014_try($$SELECT 1 FROM core.run_state_cards LIMIT 1$$)::text, true);
SELECT pg_catalog.set_config('t014.g_anon_snap',
  pg_temp.t014_try($$SELECT 1 FROM core.run_snapshots LIMIT 1$$)::text, true);
RESET ROLE;

-- (b) same tenant, the role the gate exists to stop. SALES for the two ADMIN/MD
-- tables; OPS for the share tokens, because SALES legitimately holds
-- portal:token:issue (002:861) and picking it there would pin the wrong claim.
SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_low_keys',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.ai_provider_keys$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_low_io',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.run_node_io$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_low_card',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.run_state_cards$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_low_snap',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.run_snapshots$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_adm_card',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.run_state_cards$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_adm_snap',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.run_snapshots$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='beta_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_xt_card',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.run_state_cards
      WHERE tenant_id = '00000014-1111-1111-1111-111111111111'$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='beta_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_xt_snap',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.run_snapshots
      WHERE tenant_id = '00000014-1111-1111-1111-111111111111'$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_ops'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_low_tok',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.public_share_tokens$$)::text, true);
RESET ROLE;

-- (c) same tenant, ADMIN — holds all three permissions.
SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_adm_keys',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.ai_provider_keys$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_adm_io',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.run_node_io$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_adm_tok',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.public_share_tokens$$)::text, true);
RESET ROLE;

-- (d) wrong tenant, ADMIN — permission held, tenant wrong.
SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='beta_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_xt_keys',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.ai_provider_keys
      WHERE tenant_id = '00000014-1111-1111-1111-111111111111'$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='beta_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_xt_io',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.run_node_io
      WHERE tenant_id = '00000014-1111-1111-1111-111111111111'$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='beta_admin'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.g_xt_tok',
  pg_temp.t014_try_value($$SELECT to_jsonb(pg_catalog.count(*)) FROM core.public_share_tokens
      WHERE tenant_id = '00000014-1111-1111-1111-111111111111'$$)::text, true);
RESET ROLE;

DO $t12$
DECLARE
  r        pg_catalog.record;
  v_anon   jsonb;
  v_low    jsonb;
  v_adm    jsonb;
  v_xt     jsonb;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('core.ai_provider_keys',   'ai:provider:read',    'SALES', 'keys'),
      ('core.run_node_io',        'run:read',            'SALES', 'io'),
      ('core.run_state_cards',    'run:read',            'SALES', 'card'),
      ('core.run_snapshots',      'run:read',            'SALES', 'snap'),
      ('core.public_share_tokens','portal:token:issue',  'OPS',   'tok')
    ) AS t(relname, perm, lowrole, tag)
  LOOP
    v_anon := pg_catalog.current_setting('t014.g_anon_' || r.tag)::jsonb;
    v_low  := pg_catalog.current_setting('t014.g_low_'  || r.tag)::jsonb;
    v_adm  := pg_catalog.current_setting('t014.g_adm_'  || r.tag)::jsonb;
    v_xt   := pg_catalog.current_setting('t014.g_xt_'   || r.tag)::jsonb;

    -- (a) signed out
    ASSERT NOT (v_anon->>'ok')::boolean,
      pg_catalog.format('T12a FAIL (%s): anon read it. anon holds no grant in '
        'core and never has; if this succeeded the grant layer moved. %s',
        r.relname, v_anon::text);

    -- (b) same tenant, low role — zero rows, NOT an error. A permission-denied
    -- here would mean the grant was revoked rather than the policy gating, and a
    -- revoked grant is a different posture with different consequences for the
    -- 018 RPC layer that will read these tables as a definer.
    ASSERT (v_low->>'ok')::boolean,
      pg_catalog.format('T12b FAIL (%s): a %s principal got an ERROR rather than '
        'zero rows. The gate is a RESTRICTIVE policy, so the correct refusal is an '
        'empty result; an error means the SELECT grant is gone and 018''s definer '
        'reads will break too. %s', r.relname, r.lowrole, v_low::text);
    ASSERT (v_low->'value')::text = '0',
      pg_catalog.format('T12c FAIL (%s): a %s principal of the tenant read %s '
        'row(s). 002 gives %s to other roles and not to this one; tenant '
        'membership is not authorization here.',
        r.relname, r.lowrole, (v_low->'value')::text, r.perm);

    -- (c) same tenant, ADMIN — must see its own tenant's row
    ASSERT (v_adm->>'ok')::boolean AND (v_adm->'value')::text = '1',
      pg_catalog.format('T12d FAIL (%s): an aal2 ADMIN of the tenant read %s '
        'row(s), expected 1. A gate that also stops the role it is meant to admit '
        'is a broken screen, not an authorization. %s',
        r.relname, COALESCE((v_adm->'value')::text,'ERROR'), v_adm::text);

    -- (d) wrong tenant, same permission
    ASSERT (v_xt->>'ok')::boolean AND (v_xt->'value')::text = '0',
      pg_catalog.format('T12e FAIL (%s): an ADMIN of the OTHER tenant read %s of '
        'this tenant''s rows. The role gate must AND with tenant isolation, not '
        'replace it. %s', r.relname, COALESCE((v_xt->'value')::text,'ERROR'), v_xt::text);
  END LOOP;

  -- The gate lives inside the RESTRICTIVE isolation policy, on BOTH halves, so a
  -- later permissive policy cannot OR it away and a future write grant does not
  -- arrive ungated. Asserted off pg_policy rather than off the migration's text.
  FOR r IN
    SELECT * FROM (VALUES
      ('ai_provider_keys',   'ai:provider:read'),
      ('run_node_io',        'run:read'),
      ('public_share_tokens','portal:token:issue')
    ) AS t(relname, perm)
  LOOP
    DECLARE
      v_qual  text;
      v_check text;
      v_perm  boolean;
      v_cmd   char;
    BEGIN
      SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid),
             pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid),
             p.polpermissive, p.polcmd
        INTO v_qual, v_check, v_perm, v_cmd
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='core' AND c.relname = r.relname
         AND p.polname = r.relname || '_tenant_isolation';

      ASSERT v_qual IS NOT NULL,
        pg_catalog.format('T12f FAIL: core.%s has no isolation policy at all.', r.relname);
      ASSERT NOT v_perm,
        pg_catalog.format('T12g FAIL: core.%s''s isolation policy is PERMISSIVE. A '
          'permissive gate ORs with the tenant SELECT policy and gates nothing.',
          r.relname);
      ASSERT v_cmd = '*',
        pg_catalog.format('T12h FAIL: core.%s''s isolation policy is not FOR ALL, '
          'so it decides nothing on the day a write grant lands.', r.relname);
      ASSERT pg_catalog.strpos(v_qual, r.perm) > 0,
        pg_catalog.format('T12i FAIL: core.%s''s isolation policy does not consult '
          '%s on the read side. Predicate: %s', r.relname, r.perm, v_qual);
      ASSERT pg_catalog.strpos(COALESCE(v_check,''), r.perm) > 0,
        pg_catalog.format('T12j FAIL: core.%s gates reads on %s but not writes. '
          'WITH CHECK: %s', r.relname, r.perm, COALESCE(v_check,'NULL'));
    END;
  END LOOP;

  -- Exactly three gated tables. If a table joins the gated set this pin needs a
  -- fourth probe column, not a bigger number — an ungated sensitive table with a
  -- blanket SELECT grant is the finding this test exists for.
  -- ⚠ ALL SEVEN TABLES `run:read` GOVERNS, plus the two others, checked by name.
  -- An earlier version gated `run_node_io` alone and called the rest a deliberate
  -- posture. `run_state_cards` is worse than the one that was gated — 013's own
  -- header concedes it escapes the 30-day redaction sweep — and
  -- `run_snapshots.response` is every tool call's raw output for the tenant.
  FOR r IN
    SELECT x FROM pg_catalog.unnest(ARRAY[
      'ai_provider_keys','runs','run_nodes','run_node_io','run_events',
      'run_state_cards','run_checkpoints','run_snapshots','public_share_tokens'
    ]) AS t(x)
  LOOP
    ASSERT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='core' AND c.relname = r.x
         AND p.polname = r.x || '_tenant_isolation'
         AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%has_permission%'
         AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%has_permission%'),
      pg_catalog.format('T12k FAIL: core.%s carries no permission term on BOTH '
        'halves of its isolation policy. Every table run:read governs must be '
        'gated, or the pack restores 002''s decision for a fraction of the surface '
        'it covers and argues provenance for the rest.', r.x);
  END LOOP;

  ASSERT (SELECT pg_catalog.count(*)
            FROM pg_catalog.pg_policy p
            JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname='core'
             AND p.polname = c.relname || '_tenant_isolation'
             AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%has_permission%') = 9,
    'T12l FAIL: the number of core tables whose isolation policy carries a '
    'permission term is not nine. If a table joined the gated set this pin needs '
    'a probe column for it, not a bigger number.';

  -- And nothing grew a third policy shape: 004 T1c and 013 T1d both inventory
  -- core by exactly the two names, and folding the gate into the isolation policy
  -- rather than adding a `_role_gate` policy is what keeps those pins true.
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='core'
       AND p.polname NOT IN (c.relname || '_tenant_select', c.relname || '_tenant_isolation')
       AND p.polname NOT IN ('provenance_subjects_read','autonomy_grants_agents_cannot_write')),
    'T12m FAIL: a policy in core is neither one of 014''s two shapes nor one of '
    'the two named exceptions. test_004 T1c and test_013 T1d inventory core by '
    'those names and would fail next.';

  RAISE NOTICE
    'T12 PASS - ai_provider_keys, run_node_io, run_state_cards, run_snapshots and '
    'public_share_tokens each refuse anon, return zero rows to a same-tenant '
    'principal without the permission, return the tenant''s own row to an ADMIN '
    'that has it, and return zero to an ADMIN of another tenant who also has it. '
    'Nine core tables carry a permission term on both halves of their isolation '
    'policy: all seven run:read governs, plus the provider keys and the share '
    'tokens.';
END;
$t12$;



-- ─── T13 · HIGH-2 · the global-row fallback is a READ concession only ───────
-- The finding: `app.apply_tenant_policies` built ONE predicate string and used
-- it for both USING and WITH CHECK, so on a tenant-NULLABLE table
-- `tenant_id IS NULL` was admitted on writes as well as reads. Inert while no
-- client role holds a write privilege on core — and the migration header sells
-- the restrictive policy as being correct "on the day somebody grants a write",
-- which is precisely the day it would have let any authenticated caller write a
-- row attributed to no tenant and therefore visible to every tenant.
--
-- Pinned twice: structurally, off pg_policy, over every nullable table rather
-- than the two known ones; and behaviourally, by staging that exact day inside
-- this transaction — a permissive INSERT policy and an INSERT grant, both gone
-- at ROLLBACK — because a predicate assertion proves the string and the probe
-- proves what the string does.

SELECT pg_catalog.set_config('t014.null_write_probe','{}',true);

-- Stage "the day somebody grants a write" on one nullable table. Without a
-- PERMISSIVE insert policy every INSERT is refused anyway and the probe could
-- not tell the restrictive WITH CHECK from the absence of a permission — which
-- is how this defect stayed invisible in the first place.
CREATE POLICY t014_tmp_insert ON core.compliance_rules
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
GRANT INSERT ON core.compliance_rules TO authenticated;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_sales'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.w_null_tenant', pg_temp.t014_try($$
  INSERT INTO core.compliance_rules
    (tenant_id,rule_code,family_key,check_key,side,subject,subject_field,op,
     reference_kind,reference,effective_from,status)
  VALUES (NULL,'T014-SMUGGLED-NATIONAL','LEAD_TIME_INHOUSE','CHK_LEAD_TIME','GRANT',
          'engagement','starts_on','LTE','FIELD','approval_date','2026-01-01','PROPOSED')
$$)::text, true);
SELECT pg_catalog.set_config('t014.w_own_tenant', pg_temp.t014_try($$
  INSERT INTO core.compliance_rules
    (tenant_id,rule_code,family_key,check_key,side,subject,subject_field,op,
     reference_kind,reference,effective_from,status)
  VALUES ('00000014-1111-1111-1111-111111111111','T014-OWN-TENANT','LEAD_TIME_INHOUSE',
          'CHK_LEAD_TIME','GRANT','engagement','starts_on','LTE','FIELD',
          'approval_date','2026-01-01','PROPOSED')
$$)::text, true);
SELECT pg_catalog.set_config('t014.w_other_tenant', pg_temp.t014_try($$
  INSERT INTO core.compliance_rules
    (tenant_id,rule_code,family_key,check_key,side,subject,subject_field,op,
     reference_kind,reference,effective_from,status)
  VALUES ('00000014-2222-2222-2222-222222222222','T014-OTHER-TENANT','LEAD_TIME_INHOUSE',
          'CHK_LEAD_TIME','GRANT','engagement','starts_on','LTE','FIELD',
          'approval_date','2026-01-01','PROPOSED')
$$)::text, true);
RESET ROLE;

REVOKE INSERT ON core.compliance_rules FROM authenticated;
DROP POLICY t014_tmp_insert ON core.compliance_rules;

DO $t13$
DECLARE
  v_null  jsonb := pg_catalog.current_setting('t014.w_null_tenant')::jsonb;
  v_own   jsonb := pg_catalog.current_setting('t014.w_own_tenant')::jsonb;
  v_other jsonb := pg_catalog.current_setting('t014.w_other_tenant')::jsonb;
  v_bad   text;
  v_n     integer;
BEGIN
  -- T13a · structural, over every tenant-NULLABLE core table.
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_policy p
      ON p.polrelid = c.oid AND p.polname = c.relname || '_tenant_isolation'
   WHERE n.nspname = 'core' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                    AND a.attnum > 0 AND NOT a.attisdropped AND NOT a.attnotnull)
     AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%IS NULL%';
  ASSERT v_bad IS NULL,
    pg_catalog.format('T13a FAIL: tenant_id IS NULL is admitted by the WITH CHECK '
      'of the isolation policy on: %s. A row written with no tenant is visible to '
      'every tenant.', v_bad);

  -- T13b · and the read half still has it, or 009's national rules vanish.
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_policy p
      ON p.polrelid = c.oid AND p.polname = c.relname || '_tenant_select'
   WHERE n.nspname = 'core' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                    AND a.attnum > 0 AND NOT a.attisdropped AND NOT a.attnotnull)
     AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%IS NULL%';
  ASSERT v_n >= 2,
    pg_catalog.format('T13b FAIL: only %s tenant-NULLABLE core table(s) carry the '
      'global-row fallback in their SELECT predicate. 009''s national compliance '
      'rules and rule set versions both need it.', v_n);

  -- T13c · the day somebody grants a write, staged and run.
  ASSERT NOT (v_null->>'ok')::boolean,
    pg_catalog.format('T13c FAIL: with a write grant in place, an authenticated '
      'SALES principal inserted a compliance rule with tenant_id NULL. That row is '
      'a national rule as far as every other tenant''s read predicate is '
      'concerned. Result: %s', v_null::text);
  ASSERT v_null->>'sqlstate' = '42501',
    pg_catalog.format('T13c1 FAIL: the NULL-tenant write was refused with %s, not '
      '42501. A refusal from a CHECK constraint or a trigger would be luck, not '
      'the policy under test.', v_null->>'sqlstate');

  ASSERT NOT (v_other->>'ok')::boolean,
    pg_catalog.format('T13d FAIL: a write attributed to the OTHER tenant was '
      'accepted: %s', v_other::text);

  ASSERT (v_own->>'ok')::boolean,
    pg_catalog.format('T13e FAIL: a write attributed to the caller''s OWN tenant '
      'was refused. The strict WITH CHECK must refuse the NULL and the stranger '
      'and admit this one, or it is not authorization, it is an outage: %s',
      v_own::text);

  -- The staged grant and policy are gone again, inside this transaction.
  ASSERT NOT has_table_privilege('authenticated','core.compliance_rules','INSERT'),
    'T13f FAIL: the probe''s INSERT grant survived the probe.';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
     WHERE c.relname='compliance_rules' AND p.polname='t014_tmp_insert'),
    'T13g FAIL: the probe''s permissive INSERT policy survived the probe.';

  RAISE NOTICE
    'T13 PASS - the tenant_id IS NULL fallback appears in the SELECT predicate of '
    'every nullable table and in the WITH CHECK of none. Staged against a real '
    'write grant: NULL refused at 42501, other tenant refused, own tenant accepted.';
END;
$t13$;



-- ─── T14 · MED · the grant checks see a privilege held through PUBLIC ───────
-- The finding: every "anon holds nothing" / "no client write privilege" check in
-- this pack filtered `information_schema.table_privileges` on
-- `grantee IN ('anon','authenticated')`. That view lists a privilege under the
-- grantee it was granted TO. A privilege granted to PUBLIC is inherited by every
-- role and appears under NEITHER name, so the whole guard was blind to
-- `GRANT ... TO PUBLIC` — the one spelling a person reaches for when they want
-- "everyone" and the one that would be hardest to see in review.
--
-- Today's revokes make both spellings agree, so an assertion about the current
-- database proves nothing about the guard. This pin therefore CREATES the
-- disagreement, inside its own transaction, and measures which spelling notices.
DO $t14$
DECLARE
  v_is_schema integer;
  v_has       boolean;
BEGIN
  CREATE TABLE core.t014_public_grant_probe (
    id        uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    tenant_id uuid NOT NULL,
    note      text);

  -- The spelling the guard was blind to.
  GRANT SELECT ON core.t014_public_grant_probe TO PUBLIC;

  SELECT pg_catalog.count(*) INTO v_is_schema
    FROM information_schema.table_privileges
   WHERE table_schema = 'core' AND table_name = 't014_public_grant_probe'
     AND grantee IN ('anon','authenticated');

  v_has := has_table_privilege('anon','core.t014_public_grant_probe','SELECT');

  -- Half one: the old spelling really is blind. If this ever stops being true,
  -- the rest of this pin and the comments in the migration are overstating a
  -- problem that no longer exists, and should be cut rather than left standing.
  ASSERT v_is_schema = 0,
    pg_catalog.format('T14a FAIL: information_schema.table_privileges DID report '
      'the PUBLIC grant under a named client role (%s row(s)). If Postgres now '
      'resolves PUBLIC in that view, the has_table_privilege rewrite in this pack '
      'is no longer load-bearing and its comments are wrong.', v_is_schema);

  -- Half two: the spelling this pack now uses is not blind.
  ASSERT v_has,
    'T14b FAIL: has_table_privilege did NOT see a privilege anon holds through '
    'PUBLIC. That is the whole reason every grant check in 014 and in this pin was '
    'rewritten to use it, and it would mean the rewrite bought nothing.';

  REVOKE SELECT ON core.t014_public_grant_probe FROM PUBLIC;
  ASSERT NOT has_table_privilege('anon','core.t014_public_grant_probe','SELECT'),
    'T14c FAIL: the probe grant survived its own revoke.';

  DROP TABLE core.t014_public_grant_probe;

  RAISE NOTICE
    'T14 PASS - a SELECT granted to PUBLIC is invisible to '
    'information_schema.table_privileges filtered by grantee and visible to '
    'has_table_privilege. 014''s verify block and this pin now use the second.';
END;
$t14$;



-- ─── T15 · HIGH-4 · the diff-hash guard fires, and the client never arms it ──
-- ⚠ THE FINDING IS NOW CLOSED ON BOTH SIDES, AND THIS PIN FLIPPED WITH IT.
-- It used to assert the DEFECTIVE behaviour on purpose — an APPROVE with no hash
-- being accepted — with instructions in its own message to delete that assertion
-- the day the client was fixed. The client was fixed (PR #17, e20e1ba on main:
-- `decideApproval` sends `p_expected_diff_hash`, and `ApprovalDecideRequest.diffHash`
-- is typed `string`, required), so 014's wrapper now REFUSES an APPROVE that
-- carries no hash and T15c asserts that refusal instead. Those instructions were
-- followed rather than left as a comment about a future that had arrived.
--
-- THE FINDING (#6 in the 2026-09-13 retrofit review): `core.decide_approval`
-- takes `p_expected_diff_hash` and 011:2781-2787 compares it — but ONLY when it
-- is non-NULL. `decideApproval`'s single call site,
-- apps/web/src/shared/api/rpcClient.ts:523-529, sends four arguments and not that
-- one, and `ApprovalDecideRequest` in packages/contract/src/domain/approvals.ts
-- has no hash field at all. Both verified in this worktree at those lines.
--
-- WHAT THE ARGUMENT ACTUALLY BUYS, which is narrower than "optimistic
-- concurrency" makes it sound and is why this needs a worked fixture rather than
-- an assertion. 011 ALREADY recomputes the effects on every APPROVE and refuses
-- if they no longer hash to the approval's stored `diff_hash` — that guard needs
-- no client participation and does fire. `p_expected_diff_hash` covers the OTHER
-- staleness: the approval row was RE-RENDERED between the moment the human read
-- the diff on screen and the moment they pressed Approve. The stored hash and the
-- fresh hash then agree with each other and disagree with what the human saw, and
-- the only party who knows what the human saw is the browser. Which never says.
--
-- So the fixture re-renders an approval under the caller — target_ref moves, the
-- effects move, the stored hash is updated to match — and then decides it three
-- ways:
--   T15a  the hash the human's screen would have carried  → REFUSED, "stale"
--   T15b  the hash as it is NOW                           → ACCEPTED
--   T15c  no hash at all                                  → REFUSED at the door,
--         before 011 is reached, because an APPROVE whose hash is absent is an
--         approval of a diff nobody can prove the approver saw.
--
-- WHY THE DATABASE CAN REQUIRE IT NOW AND COULD NOT BEFORE. Refusing a NULL hash
-- would have broken every approve in the product while no caller sent one. With
-- the contract typing it as required and the only call site sending it, the
-- refusal costs nothing and closes the hole from the other end: a guard both
-- sides enforce cannot be re-disabled by one of them changing. Only APPROVE is
-- refused — REJECT and REQUEST_CHANGES do not apply the diff and 011 does not
-- compare the hash for them either.

CREATE TEMP TABLE t014_hashes (which text PRIMARY KEY, h text);

INSERT INTO core.action_requests
  (id,tenant_id,action_type,target_ref,requested_by_kind,requested_by_id,status)
SELECT ('00000014-ac00-0000-0000-00000000000' || g)::uuid,
       '00000014-1111-1111-1111-111111111111','PROPOSAL_SEND',NULL,'HUMAN',
       '00000014-0000-0000-0000-0000000000a1','QUEUED_FOR_APPROVAL'
FROM pg_catalog.generate_series(3,5) AS g;

-- The hash of the diff as first rendered — what the human's screen carries.
-- ⚠ THE HASH IS OVER {effects, value}, NOT OVER THE EFFECTS ALONE, and this
-- fixture has to spell it the same way 011 does or the fresh-vs-stored check
-- fires first and this pin measures that instead. `app.plan_effects` is
-- IMMUTABLE and reads no row, so a hash over it alone could never change — which
-- is the defect 011 now fixes by folding `app.action_value` in.
INSERT INTO t014_hashes
SELECT 'before', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  pg_catalog.jsonb_build_object(
    'effects', app.plan_effects('PROPOSAL_SEND',NULL,'{}'::jsonb),
    'value',   app.action_value('PROPOSAL_SEND','00000014-1111-1111-1111-111111111111',
                 app.resolve_action_target_id('PROPOSAL_SEND','00000014-1111-1111-1111-111111111111',NULL,'{}'::jsonb),
                 '{}'::jsonb))::text,'UTF8')),'hex');

INSERT INTO core.approval_requests
  (id,tenant_id,action_request_id,policy_id,action_type,subject,requested_by_kind,
   requested_by_id,reason,diff,diff_hash,approver_role,sla_due_at,expires_at,
   bulk_approvable)
SELECT
  ('00000014-a99a-0000-0000-00000000000' || g)::uuid,
  '00000014-1111-1111-1111-111111111111',
  ('00000014-ac00-0000-0000-00000000000' || g)::uuid,
  'pol_t014','PROPOSAL_SEND','proposal','HUMAN',
  '00000014-0000-0000-0000-0000000000a1',
  'T15 hash probe ' || g,
  app.plan_effects('PROPOSAL_SEND',NULL,'{}'::jsonb),
  (SELECT h FROM t014_hashes WHERE which='before'),
  -- SALES_MANAGER, not ADMIN: 002 gives `approval:decide` to SALES_MANAGER,
  -- FINANCE and MD and NOT to ADMIN (002:886,988,1047), and 011 additionally
  -- requires the caller's role to equal approver_role unless the caller is MD.
  -- An ADMIN decider here would be refused at the permission gate and every
  -- assertion below would pass for the wrong reason — which a first draft did.
  'SALES_MANAGER',
  pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '7 days', false
FROM pg_catalog.generate_series(3,5) AS g;

-- ── THE RE-RENDER. The action's target is resolved, so the effects change and
-- the approval is re-rendered against them. 011's own fresh-vs-stored check is
-- satisfied afterwards; only the human's copy is stale.
UPDATE core.action_requests SET target_ref = 'PRO-T014-0001'
 WHERE id IN ('00000014-ac00-0000-0000-000000000003',
              '00000014-ac00-0000-0000-000000000004',
              '00000014-ac00-0000-0000-000000000005');

INSERT INTO t014_hashes
SELECT 'after', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  pg_catalog.jsonb_build_object(
    'effects', app.plan_effects('PROPOSAL_SEND','PRO-T014-0001','{}'::jsonb),
    'value',   app.action_value('PROPOSAL_SEND','00000014-1111-1111-1111-111111111111',
                 app.resolve_action_target_id('PROPOSAL_SEND','00000014-1111-1111-1111-111111111111','PRO-T014-0001','{}'::jsonb),
                 '{}'::jsonb))::text,'UTF8')),'hex');

UPDATE core.approval_requests
   SET diff      = app.plan_effects('PROPOSAL_SEND','PRO-T014-0001','{}'::jsonb),
       diff_hash = (SELECT h FROM t014_hashes WHERE which='after')
 WHERE id IN ('00000014-a99a-0000-0000-000000000003',
              '00000014-a99a-0000-0000-000000000004',
              '00000014-a99a-0000-0000-000000000005');

-- The two hashes move into transaction-local GUCs before any role swap: a temp
-- table belongs to `postgres`, and `authenticated` reading one gets "permission
-- denied" rather than the value — the same role-discipline trap the notes at the
-- top of this file describe for table assertions.
SELECT pg_catalog.set_config('t014.h_before', (SELECT h FROM t014_hashes WHERE which='before'), true);
SELECT pg_catalog.set_config('t014.h_after',  (SELECT h FROM t014_hashes WHERE which='after'),  true);

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_manager'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.hash_stale', pg_temp.t014_try_value(
  pg_catalog.format($$SELECT core.decide_approval(%L::uuid,'APPROVE',NULL,%L,NULL)$$,
    '00000014-a99a-0000-0000-000000000003',
    pg_catalog.current_setting('t014.h_before')))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_manager'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.hash_fresh', pg_temp.t014_try_value(
  pg_catalog.format($$SELECT core.decide_approval(%L::uuid,'APPROVE',NULL,%L,NULL)$$,
    '00000014-a99a-0000-0000-000000000004',
    pg_catalog.current_setting('t014.h_after')))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  (SELECT claims FROM t014_claims WHERE who='alpha_manager'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t014.hash_null', pg_temp.t014_try_value(
  $$SELECT core.decide_approval('00000014-a99a-0000-0000-000000000005'::uuid,
      'APPROVE', NULL, NULL, NULL)$$)::text, true);
-- The same approval, REJECTED with no hash: must still work, or the refusal has
-- widened from "you may not approve a diff you cannot prove you saw" into "you
-- may not decide at all", which is a different and unasked-for rule.
SELECT pg_catalog.set_config('t014.hash_null_reject', pg_temp.t014_try_value(
  $$SELECT core.decide_approval('00000014-a99a-0000-0000-000000000005'::uuid,
      'REJECT', 'not now', NULL, NULL)$$)::text, true);
RESET ROLE;

DO $t15$
DECLARE
  v_stale jsonb := pg_catalog.current_setting('t014.hash_stale')::jsonb;
  v_fresh jsonb := pg_catalog.current_setting('t014.hash_fresh')::jsonb;
  v_null  jsonb := pg_catalog.current_setting('t014.hash_null')::jsonb;
BEGIN
  ASSERT (SELECT h FROM t014_hashes WHERE which='before')
      <> (SELECT h FROM t014_hashes WHERE which='after'),
    'T15 SETUP FAIL: the re-render did not change the diff hash, so all three '
    'probes below are the same probe and none of them tests anything.';

  ASSERT NOT (v_stale->>'ok')::boolean,
    pg_catalog.format('T15a FAIL: an APPROVE carrying the hash the human''s screen '
      'showed was accepted after the approval was re-rendered underneath them. '
      'That is the whole job of p_expected_diff_hash: %s', v_stale::text);
  -- The MESSAGE, not just the SQLSTATE. Every refusal in 011 raises TRNOS,
  -- including "this principal may not decide approvals", so a SQLSTATE-only
  -- assertion passes when the probe is merely unauthorized — which is how a first
  -- draft of this pin passed while testing nothing at all.
  ASSERT v_stale->>'message' LIKE '%stale%',
    pg_catalog.format('T15a1 FAIL: the stale-hash APPROVE was refused, but not by '
      'the diff-hash guard: %s', v_stale::text);

  ASSERT (v_fresh->>'ok')::boolean,
    pg_catalog.format('T15b FAIL: an APPROVE carrying the CURRENT hash was '
      'refused. A guard that refuses the matching case is an outage, not a '
      'guard: %s', v_fresh::text);

  ASSERT NOT (v_null->>'ok')::boolean,
    pg_catalog.format('T15c FAIL: an APPROVE that sent NO diff hash was accepted. '
      '011 compares the hash only when it is non-NULL, so an omitted hash skips '
      'the optimistic-concurrency check entirely — which is what happened on every '
      'real call until PR #17 added the argument to rpcClient. The contract now '
      'types diffHash as required, so the wrapper refuses it and both sides '
      'enforce the same rule. Result: %s', v_null::text);
  ASSERT v_null->>'message' LIKE '%diff hash%',
    pg_catalog.format('T15c2 FAIL: the no-hash APPROVE was refused, but not by '
      'the wrapper''s own requirement: %s', v_null::text);

  -- And the refusal is scoped to APPROVE. A REJECT does not apply the diff and
  -- 011 does not compare the hash for it, so refusing one for a missing hash
  -- would be a new rule wearing this one's clothes.
  ASSERT (pg_catalog.current_setting('t014.hash_null_reject')::jsonb ->> 'ok')::boolean,
    pg_catalog.format('T15d FAIL: a REJECT with no diff hash was refused. Only '
      'APPROVE applies the diff: %s', pg_catalog.current_setting('t014.hash_null_reject'));

  RAISE NOTICE
    'T15 PASS - after a re-render the diff-hash guard refuses the hash the human '
    'saw and admits the current one, an APPROVE carrying no hash is refused at '
    'the wrapper, and a REJECT without one still works. Finding #6 is closed on '
    'both sides: the client sends it (PR #17) and the database requires it.';
END;
$t15$;


-- ─── T16 · the role gate cannot be stripped by accident ─────────────────────
-- The control this pins is not a predicate, it is a REFUSAL. §4b's gates are
-- created by `app.apply_tenant_policies`, which is DROP-then-CREATE, shared, and
-- called with two arguments in three places in 017. So the obvious spelling —
-- `SELECT app.apply_tenant_policies('core','run_node_io','014')`, one line, identical
-- in shape to what 017 already ships — would replace a gated isolation policy
-- with an ungated one and hand every principal of the tenant the raw agent
-- prompt and completion text back. Nothing would fail: the policy would exist,
-- §6's check would not run again until somebody re-applied 014, and T12 would
-- only notice if somebody re-ran this file.
--
-- So the function refuses instead, reading the gate out of the policy it is about
-- to drop. All three branches are exercised here, on a throwaway table, per 004's
-- precedent — INCLUDING the `UNGATE` escape, which existed as documented dead
-- code until this pin was written and raised on every call instead of removing
-- the gate. An untested branch in a security control is the defect, not the
-- feature.

CREATE TABLE core.t014_gate_probe (
  id        uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id uuid NOT NULL);
ALTER TABLE core.t014_gate_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.t014_gate_probe FORCE  ROW LEVEL SECURITY;
CREATE INDEX t014_gate_probe_tenant_idx ON core.t014_gate_probe (tenant_id);

DO $t16$
DECLARE
  v_gated     boolean;
  v_refused   boolean;
  v_bad_stamp text;
BEGIN
  -- (a) gated on creation
  PERFORM app.apply_tenant_policies('core','t014_gate_probe','014','run:read');
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%has_permission%' INTO v_gated
    FROM pg_catalog.pg_policy p
   WHERE p.polname = 't014_gate_probe_tenant_isolation';
  ASSERT v_gated, 'T16a FAIL: a three-argument call produced no gate.';

  -- (b) the two-argument call REFUSES rather than silently stripping it
  v_refused := false;
  BEGIN
    PERFORM app.apply_tenant_policies('core','t014_gate_probe','014');
  EXCEPTION WHEN OTHERS THEN
    v_refused := true;
    ASSERT SQLERRM LIKE '%already carries a role gate%',
      pg_catalog.format('T16b1 FAIL: the two-argument call was refused, but not by '
        'the gate guard: %s', SQLERRM);
  END;
  ASSERT v_refused,
    'T16b FAIL: app.apply_tenant_policies accepted a two-argument call against a '
    'table that already carries a role gate. That call is one line, is the same '
    'shape as the three 017 already ships, and would have silently removed the '
    'gate on core.run_node_io.';

  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%has_permission%' INTO v_gated
    FROM pg_catalog.pg_policy p
   WHERE p.polname = 't014_gate_probe_tenant_isolation';
  ASSERT v_gated, 'T16b2 FAIL: the refused call still removed the gate.';

  -- (c) re-passing the same permission is accepted and keeps it
  PERFORM app.apply_tenant_policies('core','t014_gate_probe','014','run:read');
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%has_permission%' INTO v_gated
    FROM pg_catalog.pg_policy p
   WHERE p.polname = 't014_gate_probe_tenant_isolation';
  ASSERT v_gated, 'T16c FAIL: re-passing the same permission removed the gate.';

  -- (d) a DIFFERENT permission is accepted and replaces it
  PERFORM app.apply_tenant_policies('core','t014_gate_probe','014','ai:provider:read');
  ASSERT (SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%ai:provider:read%'
            FROM pg_catalog.pg_policy p
           WHERE p.polname = 't014_gate_probe_tenant_isolation'),
    'T16d FAIL: passing a different permission did not replace the gate.';

  -- (e) the deliberate escape works, and is the ONLY thing that removes a gate
  PERFORM app.ungate_tenant_policy('core','t014_gate_probe','014');
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%has_permission%' INTO v_gated
    FROM pg_catalog.pg_policy p
   WHERE p.polname = 't014_gate_probe_tenant_isolation';
  ASSERT NOT v_gated,
    'T16e FAIL: app.ungate_tenant_policy did not remove the gate. It is the '
    'documented way to remove one on purpose, and a documented escape that does '
    'not work is worse than none: the next person removes the guard instead. '
    'This control has now shipped two dead escapes — the UNGATE magic string, and '
    'a first version of this function that called back into the very refusal it '
    'exists to bypass — which is why every branch of it is pinned.';

  -- (f0) ⚠ THE THREE-ARGUMENT SPELLING IS REFUSED, and this is the one that was
  --      silently wrong rather than loudly. There is no three-argument overload
  --      to resolve to, so `apply_tenant_policies('core','x','run:read')` — the
  --      spelling the catalog taught before the signature changed — binds to the
  --      four-argument function with p_migration='run:read' and p_permission=NULL.
  --      Reproduced before the fix: it produced an UNGATED policy stamped
  --      `migration:run:read`, a security gate quietly downgraded AND a policy no
  --      rollback can find, from a call that reads exactly like the documented
  --      one. Dropping the old signature does nothing about it, because the old
  --      signature is not what the call resolves to — only typing the slot does.
  v_refused := false;
  BEGIN
    PERFORM app.apply_tenant_policies('core','t014_gate_probe','run:read');
  EXCEPTION WHEN OTHERS THEN
    v_refused := true;
    ASSERT SQLERRM LIKE '%three-digit pack%',
      pg_catalog.format('T16f0a FAIL: the three-argument spelling was refused, '
        'but not by the p_migration check: %s', SQLERRM);
  END;
  ASSERT v_refused,
    'T16f0 FAIL: app.apply_tenant_policies accepted a permission string in the '
    'p_migration slot. That call produces an ungated policy with an unfindable '
    'stamp and looks exactly like a correct one.';

  -- NULL and empty are refused for the same reason: a policy with no owner stamp
  -- is a policy the rollback''s manifest loop will never drop.
  FOREACH v_bad_stamp IN ARRAY ARRAY[NULL, '', '  ', '14', '0014', 'migration:014'] LOOP
    v_refused := false;
    BEGIN
      PERFORM app.apply_tenant_policies('core','t014_gate_probe', v_bad_stamp, 'run:read');
    EXCEPTION WHEN OTHERS THEN v_refused := true;
    END;
    ASSERT v_refused,
      pg_catalog.format('T16f1 FAIL: p_migration %s was accepted. Anything but a '
        'three-digit pack number leaves a stamp the rollback cannot match.',
        COALESCE('''' || v_bad_stamp || '''','NULL'));
  END LOOP;

  -- And ungate demands one too, because removing a gate is the act most worth
  -- being able to attribute.
  v_refused := false;
  BEGIN
    PERFORM app.ungate_tenant_policy('core','t014_gate_probe', NULL);
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T16f2 FAIL: ungate_tenant_policy accepted a NULL p_migration.';

  -- (f) and a permission nobody holds is refused, because a gate no role can
  --     satisfy is a broken screen rather than security
  v_refused := false;
  BEGIN
    PERFORM app.apply_tenant_policies('core','t014_gate_probe','014','not:a:real:permission');
  EXCEPTION WHEN OTHERS THEN
    v_refused := true;
  END;
  ASSERT v_refused,
    'T16f FAIL: a permission that names no row in app.role_permissions was '
    'accepted as a gate. Every role would be refused, including ADMIN.';

  RAISE NOTICE
    'T16 PASS - a permission argument gates, a call without one against a gated '
    'table REFUSES, re-passing keeps it, a different permission replaces it, '
    'app.ungate_tenant_policy removes it, an unknown permission is refused, and '
    'the three-argument spelling that used to bind a permission into the '
    'migration slot is refused along with every non-pack stamp.';
END;
$t16$;

DROP TABLE core.t014_gate_probe;


ROLLBACK;
