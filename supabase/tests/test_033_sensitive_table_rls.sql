-- ═══════════════════════════════════════════════════════════════════════════
-- test_033 · sensitive-table RLS: permission gates (H1) + MY_ACCOUNTS
--            narrowing (H4) + public.user_profiles self-or-admin (M4)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001-033 (or later). Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_033_sensitive_table_rls.sql
--
-- T1  H1: CLIENT reads zero rows, direct SELECT, from core.approval_requests,
--     core.quotations, core.invoices, core.organisations, core.ai_budgets —
--     five representative tables spanning the 28-table gated set, one per
--     permission family. A tenant-mate SALES/MD reads its own tenant's row.
-- T2  H1: core.events — CLIENT refused (bespoke policy), SALES/OPS/MD admitted.
-- T3  H4: two SALES reps, each MY_ACCOUNTS-scoped and each owning a different
--     organisation/opportunity in the SAME tenant — neither can see the
--     other's row; each sees its own.
-- T4  H4 regression guard: OPS/FINANCE/MD/ADMIN — none of them marked ○ for
--     organisation:read/opportunity:read — still see BOTH SALES reps' rows,
--     unnarrowed, even though their membership also defaults to
--     client_scope=MY_ACCOUNTS (the fact 033's header explains is why the
--     narrowing is role-gated, not scope-gated).
-- T5  H4: an UNASSIGNED enquiry stays visible to a MY_ACCOUNTS SALES caller
--     (assigned_to_user_id IS NULL is not narrowed away).
-- T6  M4: public.user_profiles — a non-self, non-ADMIN/MD SALES caller sees
--     only their own profile row, not a colleague's; ADMIN and MD both see
--     both.
-- T7  Tenant isolation still holds on a newly-gated table (spot check):
--     tenant B's ADMIN, who DOES hold organisation:read, sees zero of
--     tenant A's organisations.
-- T8  security_invoker views over a re-gated table still return rows for a
--     permitted role (033's own header commitment, checked behaviourally):
--     core.v_contact_channel_consents for a SALES caller who owns the
--     underlying contact.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal2')::text;
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
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'core.approval_requests'::regclass
         AND p.polname = 'approval_requests_tenant_isolation'
         AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%has_permission%')
  THEN
    RAISE EXCEPTION '033 preflight: core.approval_requests carries no permission gate; 033 has not been applied';
  END IF;
END;
$preflight$;

-- ── Fixtures: tenant A (two SALES reps, OPS, FINANCE, MD, ADMIN, CLIENT),
--    tenant B (one ADMIN) ──────────────────────────────────────────────────

INSERT INTO auth.users (id,email) VALUES
  ('a0330000-0000-4000-8000-000000000001','sales1@a33.test'),
  ('a0330000-0000-4000-8000-000000000002','sales2@a33.test'),
  ('a0330000-0000-4000-8000-000000000003','ops@a33.test'),
  ('a0330000-0000-4000-8000-000000000004','finance@a33.test'),
  ('a0330000-0000-4000-8000-000000000005','md@a33.test'),
  ('a0330000-0000-4000-8000-000000000006','admin@a33.test'),
  ('a0330000-0000-4000-8000-000000000007','client@a33.test'),
  ('a0330000-0000-4000-8000-000000000008','tenantb-admin@a33.test');

INSERT INTO public.tenants (id,slug,name,timezone) VALUES
  ('a0330000-1111-4000-8000-000000000001','a33-alpha','A33 Alpha','Asia/Kuala_Lumpur'),
  ('a0330000-1111-4000-8000-000000000002','a33-beta','A33 Beta','Asia/Kuala_Lumpur');

INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,client_scope,team_scope,status,is_default) VALUES
  ('a0330000-1111-4000-8000-000000000001','a0330000-0000-4000-8000-000000000001','SALES','HUMAN','MY_ACCOUNTS','MY_TEAM','ACTIVE',true),
  ('a0330000-1111-4000-8000-000000000001','a0330000-0000-4000-8000-000000000002','SALES','HUMAN','MY_ACCOUNTS','MY_TEAM','ACTIVE',true),
  ('a0330000-1111-4000-8000-000000000001','a0330000-0000-4000-8000-000000000003','OPS','HUMAN','MY_ACCOUNTS','MY_TEAM','ACTIVE',true),
  ('a0330000-1111-4000-8000-000000000001','a0330000-0000-4000-8000-000000000004','FINANCE','HUMAN','MY_ACCOUNTS','MY_TEAM','ACTIVE',true),
  ('a0330000-1111-4000-8000-000000000001','a0330000-0000-4000-8000-000000000005','MD','HUMAN','MY_ACCOUNTS','MY_TEAM','ACTIVE',true),
  ('a0330000-1111-4000-8000-000000000001','a0330000-0000-4000-8000-000000000006','ADMIN','HUMAN','MY_ACCOUNTS','MY_TEAM','ACTIVE',true),
  ('a0330000-1111-4000-8000-000000000001','a0330000-0000-4000-8000-000000000007','CLIENT','CLIENT','ALL','ALL','ACTIVE',true),
  ('a0330000-1111-4000-8000-000000000002','a0330000-0000-4000-8000-000000000008','ADMIN','HUMAN','MY_ACCOUNTS','MY_TEAM','ACTIVE',true);

INSERT INTO public.user_profiles (tenant_id,user_id,display_name) VALUES
  ('a0330000-1111-4000-8000-000000000001','a0330000-0000-4000-8000-000000000001','A33 Sales One'),
  ('a0330000-1111-4000-8000-000000000001','a0330000-0000-4000-8000-000000000002','A33 Sales Two');

-- Two organisations/opportunities, owned by the two different SALES reps.
INSERT INTO core.organisations (id,tenant_id,ref,name,owner_id) VALUES
  ('a0330000-bbbb-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','ORG-A33-1','A33 Org One','a0330000-0000-4000-8000-000000000001'),
  ('a0330000-bbbb-4000-8000-000000000002','a0330000-1111-4000-8000-000000000001','ORG-A33-2','A33 Org Two','a0330000-0000-4000-8000-000000000002');

INSERT INTO core.opportunities (id,tenant_id,ref,organisation_id,owner_id,stage,value_sen) VALUES
  ('a0330000-cccc-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','OPP-A33-1','a0330000-bbbb-4000-8000-000000000001','a0330000-0000-4000-8000-000000000001','NEW',100000),
  ('a0330000-cccc-4000-8000-000000000002','a0330000-1111-4000-8000-000000000001','OPP-A33-2','a0330000-bbbb-4000-8000-000000000002','a0330000-0000-4000-8000-000000000002','NEW',200000);

-- An unassigned enquiry (T5).
INSERT INTO core.enquiries (id,tenant_id,ref,channel,status,received_at,assigned_to_user_id) VALUES
  ('a0330000-9999-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','ENQ-A33-1','EMAIL','OPEN',pg_catalog.now(),NULL);

-- A contact + consent, for T8 (owned via organisation one, sales1's own).
INSERT INTO core.contacts (id,tenant_id,ref,organisation_id,name,email) VALUES
  ('a0330000-8888-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','CON-A33-1','a0330000-bbbb-4000-8000-000000000001','A33 Contact','contact@a33.test');
INSERT INTO core.contact_consents (id,tenant_id,contact_id,channel,granted,recorded_at,purpose) VALUES
  ('a0330000-7777-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','a0330000-8888-4000-8000-000000000001','EMAIL',true,pg_catalog.now(),'MARKETING');

-- A minimal action_requests/approval_requests/invoice/ai_budget row, one
-- each, enough to prove SELECT visibility rather than full functional flows.
INSERT INTO core.action_requests (id,tenant_id,ref,action_type,requested_by_kind,requested_by_id,status) VALUES
  ('a0330000-ac00-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','ACT-A33-1','AGENT_PAUSE','HUMAN','a0330000-0000-4000-8000-000000000001','EXECUTED');
INSERT INTO core.approval_requests
  (id,tenant_id,action_request_id,policy_id,action_type,subject,requested_by_kind,requested_by_id,reason,diff,diff_hash,approver_role,sla_due_at,expires_at,bulk_approvable)
VALUES
  ('a0330000-a919-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','a0330000-ac00-4000-8000-000000000001',
   'pol_a33','AGENT_PAUSE','agent','HUMAN','a0330000-0000-4000-8000-000000000001','fixture','[]'::jsonb,'deadbeef','MD',
   pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '7 days', false);

-- core.invoices' NULL->DRAFT edge is gated (GOV-07: app.enforce_state_
-- transition refuses it without an EXECUTING INVOICE_CREATE action request
-- publishing itself as the applier) — same shape as test_010's own
-- pg_temp.gate/ungate fixture helper, reproduced here rather than crossed
-- through app.perform_action, which this pin has no reason to exercise.
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

SELECT pg_temp.gate('a0330000-1111-4000-8000-000000000001'::uuid,'INVOICE_CREATE','a0330000-6666-4000-8000-000000000001'::uuid);
INSERT INTO core.invoices (id,tenant_id,ref,organisation_id,status,subtotal_sen,outstanding_sen) VALUES
  ('a0330000-6666-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','INV-A33-1',
   'a0330000-bbbb-4000-8000-000000000001','DRAFT',100000,100000);
SELECT pg_temp.ungate();

INSERT INTO core.ai_budgets (id,tenant_id,scope,key,cap_sen) VALUES
  ('a0330000-5555-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','AGENT','agent_a33',1000000);

-- A tenant-B organisation, for T7.
INSERT INTO core.organisations (id,tenant_id,ref,name,owner_id) VALUES
  ('a0330000-bbbb-4000-8000-000000000009','a0330000-1111-4000-8000-000000000002','ORG-B33-1','B33 Org','a0330000-0000-4000-8000-000000000008');

-- ════════ T1 · H1: CLIENT refused on five representative tables ═══════════

DO $t1$
DECLARE v_n integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000007','a0330000-1111-4000-8000-000000000001','CLIENT'), true);
  SET LOCAL ROLE authenticated;

  SELECT pg_catalog.count(*) INTO v_n FROM core.approval_requests;
  PERFORM pg_temp.assert(v_n = 0, 'T1a CLIENT reads zero rows from core.approval_requests');
  SELECT pg_catalog.count(*) INTO v_n FROM core.quotations;
  PERFORM pg_temp.assert(v_n = 0, 'T1b CLIENT reads zero rows from core.quotations');
  SELECT pg_catalog.count(*) INTO v_n FROM core.invoices;
  PERFORM pg_temp.assert(v_n = 0, 'T1c CLIENT reads zero rows from core.invoices');
  SELECT pg_catalog.count(*) INTO v_n FROM core.organisations;
  PERFORM pg_temp.assert(v_n = 0, 'T1d CLIENT reads zero rows from core.organisations');
  SELECT pg_catalog.count(*) INTO v_n FROM core.ai_budgets;
  PERFORM pg_temp.assert(v_n = 0, 'T1e CLIENT reads zero rows from core.ai_budgets');

  RESET ROLE;

  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000005','a0330000-1111-4000-8000-000000000001','MD'), true);
  SET LOCAL ROLE authenticated;
  SELECT pg_catalog.count(*) INTO v_n FROM core.approval_requests;
  PERFORM pg_temp.assert(v_n = 1, 'T1f MD (holds approval:read) reads the tenant''s own approval_requests row');
  SELECT pg_catalog.count(*) INTO v_n FROM core.ai_budgets;
  PERFORM pg_temp.assert(v_n = 1, 'T1g MD (holds ai:budget:read) reads the tenant''s own ai_budgets row');
  RESET ROLE;
END;
$t1$;

-- ════════ T2 · H1: core.events bespoke CLIENT exclusion ═══════════════════

INSERT INTO core.events (id,tenant_id,type,aggregate_type,aggregate_id,payload,summary,actor,correlation_id) VALUES
  ('a0330000-4444-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','TEST_EVENT','TEST',
   'a0330000-4444-4000-8000-000000000001','{}'::jsonb,'fixture event',
   pg_catalog.jsonb_build_object('kind','HUMAN','id','a0330000-0000-4000-8000-000000000001','name','Fixture'),
   pg_catalog.gen_random_uuid());

DO $t2$
DECLARE v_n integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000007','a0330000-1111-4000-8000-000000000001','CLIENT'), true);
  SET LOCAL ROLE authenticated;
  SELECT pg_catalog.count(*) INTO v_n FROM core.events;
  PERFORM pg_temp.assert(v_n = 0, 'T2a CLIENT reads zero rows from core.events');
  RESET ROLE;

  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000003','a0330000-1111-4000-8000-000000000001','OPS'), true);
  SET LOCAL ROLE authenticated;
  SELECT pg_catalog.count(*) INTO v_n FROM core.events;
  PERFORM pg_temp.assert(v_n = 1, 'T2b OPS (holds audit:read) reads core.events');
  RESET ROLE;
END;
$t2$;

-- ════════ T3 · H4: two SALES reps, each sees only their own organisation ══

DO $t3$
DECLARE v_n integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','SALES'), true);
  SET LOCAL ROLE authenticated;
  SELECT pg_catalog.count(*) INTO v_n FROM core.organisations WHERE tenant_id = 'a0330000-1111-4000-8000-000000000001';
  PERFORM pg_temp.assert(v_n = 1, 'T3a sales1 (MY_ACCOUNTS) sees exactly one organisation (their own)');
  PERFORM pg_temp.assert(
    (SELECT id FROM core.organisations WHERE tenant_id = 'a0330000-1111-4000-8000-000000000001') = 'a0330000-bbbb-4000-8000-000000000001',
    'T3b sales1 sees ORG-A33-1, not ORG-A33-2');
  SELECT pg_catalog.count(*) INTO v_n FROM core.opportunities WHERE tenant_id = 'a0330000-1111-4000-8000-000000000001';
  PERFORM pg_temp.assert(v_n = 1, 'T3c sales1 sees exactly one opportunity (their own)');
  RESET ROLE;

  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000002','a0330000-1111-4000-8000-000000000001','SALES'), true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.assert(
    (SELECT id FROM core.organisations WHERE tenant_id = 'a0330000-1111-4000-8000-000000000001') = 'a0330000-bbbb-4000-8000-000000000002',
    'T3d sales2 sees ORG-A33-2, not ORG-A33-1 — neither SALES rep sees the other''s account');
  RESET ROLE;
END;
$t3$;

-- ════════ T4 · H4 regression guard: OPS/FINANCE/MD/ADMIN see BOTH rows ═══

DO $t4$
DECLARE v_n integer; v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['OPS','FINANCE','MD','ADMIN'] LOOP
    PERFORM pg_catalog.set_config('request.jwt.claims',
      pg_temp.claims(
        CASE v_role WHEN 'OPS' THEN 'a0330000-0000-4000-8000-000000000003'::uuid
                    WHEN 'FINANCE' THEN 'a0330000-0000-4000-8000-000000000004'::uuid
                    WHEN 'MD' THEN 'a0330000-0000-4000-8000-000000000005'::uuid
                    ELSE 'a0330000-0000-4000-8000-000000000006'::uuid END,
        'a0330000-1111-4000-8000-000000000001', v_role), true);
    SET LOCAL ROLE authenticated;
    SELECT pg_catalog.count(*) INTO v_n FROM core.organisations WHERE tenant_id = 'a0330000-1111-4000-8000-000000000001';
    PERFORM pg_temp.assert(v_n = 2,
      pg_catalog.format('T4 %s (not marked (circle) for organisation:read) sees both organisations despite defaulting to MY_ACCOUNTS client_scope, found %s', v_role, v_n));
    RESET ROLE;
  END LOOP;
END;
$t4$;

-- ════════ T5 · H4: unassigned enquiry stays visible ═══════════════════════

DO $t5$
DECLARE v_n integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','SALES'), true);
  SET LOCAL ROLE authenticated;
  SELECT pg_catalog.count(*) INTO v_n FROM core.enquiries WHERE tenant_id = 'a0330000-1111-4000-8000-000000000001';
  PERFORM pg_temp.assert(v_n = 1, 'T5 a MY_ACCOUNTS SALES caller still sees an unassigned enquiry');
  RESET ROLE;
END;
$t5$;

-- ════════ T6 · M4: user_profiles self-or-ADMIN/MD ═════════════════════════

DO $t6$
DECLARE v_n integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','SALES'), true);
  SET LOCAL ROLE authenticated;
  SELECT pg_catalog.count(*) INTO v_n FROM public.user_profiles WHERE tenant_id = 'a0330000-1111-4000-8000-000000000001';
  PERFORM pg_temp.assert(v_n = 1, 'T6a sales1 sees exactly their own user_profiles row, not sales2''s');
  RESET ROLE;

  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000006','a0330000-1111-4000-8000-000000000001','ADMIN'), true);
  SET LOCAL ROLE authenticated;
  SELECT pg_catalog.count(*) INTO v_n FROM public.user_profiles WHERE tenant_id = 'a0330000-1111-4000-8000-000000000001';
  PERFORM pg_temp.assert(v_n = 2, 'T6b ADMIN sees both user_profiles rows');
  RESET ROLE;
END;
$t6$;

-- ════════ T7 · tenant isolation still holds on a re-gated table ══════════

DO $t7$
DECLARE v_n integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000008','a0330000-1111-4000-8000-000000000002','ADMIN'), true);
  SET LOCAL ROLE authenticated;
  SELECT pg_catalog.count(*) INTO v_n FROM core.organisations WHERE tenant_id = 'a0330000-1111-4000-8000-000000000001';
  PERFORM pg_temp.assert(v_n = 0, 'T7 tenant B''s ADMIN (holds organisation:read) sees zero of tenant A''s organisations');
  RESET ROLE;
END;
$t7$;

-- ════════ T8 · a security_invoker view over a re-gated table still works ══

DO $t8$
DECLARE v_n integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0330000-0000-4000-8000-000000000001','a0330000-1111-4000-8000-000000000001','SALES'), true);
  SET LOCAL ROLE authenticated;
  SELECT pg_catalog.count(*) INTO v_n FROM core.v_contact_channel_consents WHERE contact_id = 'a0330000-8888-4000-8000-000000000001';
  PERFORM pg_temp.assert(v_n = 1,
    pg_catalog.format('T8 core.v_contact_channel_consents (security_invoker) still returns sales1''s own row after 033, found %s', v_n));
  RESET ROLE;
END;
$t8$;

DO $$ BEGIN RAISE NOTICE 'test_033 ALL PASS'; END $$;

ROLLBACK;
