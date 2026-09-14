-- ═══════════════════════════════════════════════════════════════════════════
-- test_022 · The profile modal and the executive dashboard
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001-020 + 022 (021 is a sibling lane, not on this branch).
-- Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_022_profile_and_dashboard.sql
--
-- IMPERSONATION IS REAL, matching test_020's convention: every RPC probe runs
-- as `authenticated` (`SET LOCAL ROLE`) with a JWT claim set for a real
-- `auth.users` row, is ONE STATEMENT, and parks its result in a
-- transaction-local GUC. Assertions run after `RESET ROLE`.
--
-- T1  me_profile: MD gets exactly the 9 MeProfile keys (no `mobile`), the 5
--     unstorable fields are JSON null, `tenant.name` is real and `tenant.code`
--     is null, `moduleCount` is 13 - hand-computed from `app.role_permissions`
--     (MD holds 13 of the 14 nav permissions `core.navigation()` filters on;
--     it lacks the bare `compliance:read`, only the three scoped
--     `compliance:*` strings).
-- T2  me_profile: an AGENT principal is FORBIDDEN (no auth.users profile to
--     read). anon is refused 42501.
-- T3  get_executive_dashboard: MD's four real metrics equal hand-computed
--     sums/counts over the seed. approvalsPending carries the one PENDING
--     approval. agentActivity/autonomyMix/agentSpend equal the seeded
--     runs/evals/usage-rollup/budget rows.
-- T4  get_executive_dashboard: OPS (holds `dashboard:read`, not
--     `dashboard:executive:read`) is FORBIDDEN. anon is refused 42501.
-- T5  get_executive_dashboard: a bad `period` (malformed, and NULL) is
--     VALIDATION_FAILED.
-- T6  get_executive_dashboard: tenant B's MD sees zero pipeline, zero AR,
--     zero proposals, zero claims-at-risk, an empty approvals/agent list and
--     a zero agentSpend - none of tenant A's numbers leak across the tenant
--     boundary.
-- T7  get_proposals_vs_won: the current month and the month 4 months back
--     equal hand-computed sent/won counts; a bad `months` is
--     VALIDATION_FAILED; the default is 6.
-- T8  No `ADMIN_HOURS_SAVED` key anywhere in the metrics array, and
--     `core.get_hours_saved` does not exist.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

-- ── Helpers ────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal1')::text;
$fn$;

CREATE FUNCTION pg_temp.agent_claims(p_agent text, p_tenant uuid) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_agent, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', 'AGENT', 'actor_kind', 'AGENT', 'aal', 'aal1')::text;
$fn$;

-- Runs one SQL statement and returns its jsonb value, or the error it raised.
-- SECURITY INVOKER, so it runs as whoever calls it: `authenticated` below.
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
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('a22.' || p_key)::jsonb; $fn$;

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond THEN RAISE NOTICE 'PASS %', p_label;
  ELSE RAISE EXCEPTION 'FAIL %', p_label;
  END IF;
END;
$fn$;

-- 011's transition gate (`core.state_transitions`) requires every registered
-- edge, gated or not, to be walked explicitly - an opportunity may not be
-- BORN at a stage other than NEW. `QUALIFYING -> PROPOSAL_SENT` and
-- `NEGOTIATION -> PROPOSAL_SENT` are additionally gated behind
-- `PROPOSAL_SEND`, so this fixture crosses that edge the way a real caller
-- does (test_005's pattern), rather than going around the control.
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

-- ── Fixtures ───────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('a0220000-0000-4000-8000-0000000000a1','md@a22.test'),
  ('a0220000-0000-4000-8000-0000000000a2','sm@a22.test'),
  ('a0220000-0000-4000-8000-0000000000a3','ops@a22.test'),
  ('a0220000-0000-4000-8000-0000000000b1','md@b22.test'),
  -- 013's "one inert auth.users row per agent per tenant" (core.agents.principal_user_id).
  ('a0220000-0000-4000-8000-0000000000a9','agent1@a22.test');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('a0220000-1111-4000-8000-000000000001','a22-akademi','Akademi Perdana A22','ACTIVE','Asia/Kuala_Lumpur','en-MY'),
  ('a0220000-1111-4000-8000-000000000002','a22-other','Other Tenant A22','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,agent_id,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0220000-1111-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a1','MD','HUMAN',NULL,'ALL','ALL',false,'ACTIVE',true),
  ('a0220000-1111-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a2','SALES_MANAGER','HUMAN',NULL,'ALL','ALL',false,'ACTIVE',true),
  ('a0220000-1111-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a3','OPS','HUMAN',NULL,'ALL','ALL',false,'ACTIVE',true),
  ('a0220000-1111-4000-8000-000000000002','a0220000-0000-4000-8000-0000000000b1','MD','HUMAN',NULL,'ALL','ALL',false,'ACTIVE',true),
  ('a0220000-1111-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a9','AGENT','AGENT','agent_a22_1','ALL','ALL',false,'ACTIVE',true);

INSERT INTO public.user_profiles (tenant_id,user_id,display_name,email,locale,timezone,theme)
VALUES ('a0220000-1111-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a1','MD A22','md@a22.test','en-MY','Asia/Kuala_Lumpur','LIGHT');

INSERT INTO core.organisations
  (id,tenant_id,name,industry,location,owner_id,status,hrdc_registered,hrdc_employer_code,country_code)
VALUES
  ('a0220000-2222-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001','Chrome A22',
   'MANUFACTURING','Shah Alam','a0220000-0000-4000-8000-0000000000a1','ACTIVE_CLIENT',true,'E-A22','MYS');

-- ── §1 OPEN_PIPELINE: 3 in scope (QUALIFYING+PROPOSAL_SENT+NEGOTIATION =
--     1,000,000 + 2,000,000 + 500,000 = 3,500,000 sen), NEW and LOST excluded.
-- Every opportunity is BORN NEW (the only legal `stage IS NULL -> x` edge is
-- to NEW) and walked forward through registered `core.state_transitions`
-- edges; `QUALIFYING -> PROPOSAL_SENT` is gated behind `PROPOSAL_SEND`.
INSERT INTO core.opportunities
  (id,tenant_id,ref,organisation_id,owner_id,stage,value_sen,currency,created_by_kind,created_by_id)
VALUES
  ('a0220000-3333-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001','OPP-A22-0001',
   'a0220000-2222-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a1','NEW',1000000,'MYR','HUMAN','a0220000-0000-4000-8000-0000000000a1'),
  ('a0220000-3333-4000-8000-000000000002','a0220000-1111-4000-8000-000000000001','OPP-A22-0002',
   'a0220000-2222-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a1','NEW',2000000,'MYR','HUMAN','a0220000-0000-4000-8000-0000000000a1'),
  ('a0220000-3333-4000-8000-000000000003','a0220000-1111-4000-8000-000000000001','OPP-A22-0003',
   'a0220000-2222-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a1','NEW',500000,'MYR','HUMAN','a0220000-0000-4000-8000-0000000000a1'),
  ('a0220000-3333-4000-8000-000000000004','a0220000-1111-4000-8000-000000000001','OPP-A22-0004',
   'a0220000-2222-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a1','NEW',999999900,'MYR','HUMAN','a0220000-0000-4000-8000-0000000000a1'),
  ('a0220000-3333-4000-8000-000000000005','a0220000-1111-4000-8000-000000000001','OPP-A22-0005',
   'a0220000-2222-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a1','NEW',300000,'MYR','HUMAN','a0220000-0000-4000-8000-0000000000a1');

-- OPP1 -> QUALIFYING (NEW -> QUALIFYING is registered and ungated).
UPDATE core.opportunities SET stage = 'QUALIFYING' WHERE id = 'a0220000-3333-4000-8000-000000000001';

-- OPP2 -> QUALIFYING -> PROPOSAL_SENT (the second hop is PROPOSAL_SEND-gated).
UPDATE core.opportunities SET stage = 'QUALIFYING' WHERE id = 'a0220000-3333-4000-8000-000000000002';
SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','PROPOSAL_SEND','a0220000-3333-4000-8000-000000000002');
UPDATE core.opportunities SET stage = 'PROPOSAL_SENT' WHERE id = 'a0220000-3333-4000-8000-000000000002';
SELECT pg_temp.ungate();

-- OPP3 -> QUALIFYING -> PROPOSAL_SENT (gated) -> NEGOTIATION (ungated).
UPDATE core.opportunities SET stage = 'QUALIFYING' WHERE id = 'a0220000-3333-4000-8000-000000000003';
SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','PROPOSAL_SEND','a0220000-3333-4000-8000-000000000003');
UPDATE core.opportunities SET stage = 'PROPOSAL_SENT' WHERE id = 'a0220000-3333-4000-8000-000000000003';
SELECT pg_temp.ungate();
UPDATE core.opportunities SET stage = 'NEGOTIATION' WHERE id = 'a0220000-3333-4000-8000-000000000003';

-- OPP4 stays NEW (excluded from OPEN_PIPELINE).

-- OPP5 -> LOST (NEW -> LOST is registered and ungated).
UPDATE core.opportunities SET stage = 'LOST', lost_reason = 'Budget frozen'
 WHERE id = 'a0220000-3333-4000-8000-000000000005';

-- ── §2 AR_OVERDUE: 2 in scope (400,000 + 150,000 = 550,000 sen), PAID and a
--     voided OVERDUE excluded. `core.invoices.status` is gated: `NULL ->
--     DRAFT` needs INVOICE_CREATE, `DRAFT -> SENT` needs INVOICE_PUSH,
--     `SENT -> OVERDUE`/`SENT -> PAID` are ungated (the former is a cron
--     sweep, DECISIONS-wise; `PAID` still walks through PAYMENT_RECORD here
--     to prove the edge exists, since 'PAID' is excluded from the metric
--     either way).
SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','INVOICE_CREATE','a0220000-4444-4000-8000-000000000001');
INSERT INTO core.invoices (id,tenant_id,ref,organisation_id,outstanding_sen,created_by_kind,created_by_id)
VALUES ('a0220000-4444-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001','INV-A22-0001',
        'a0220000-2222-4000-8000-000000000001',400000,'HUMAN','a0220000-0000-4000-8000-0000000000a1');
SELECT pg_temp.ungate();
SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','INVOICE_CREATE','a0220000-4444-4000-8000-000000000002');
INSERT INTO core.invoices (id,tenant_id,ref,organisation_id,outstanding_sen,created_by_kind,created_by_id)
VALUES ('a0220000-4444-4000-8000-000000000002','a0220000-1111-4000-8000-000000000001','INV-A22-0002',
        'a0220000-2222-4000-8000-000000000001',150000,'HUMAN','a0220000-0000-4000-8000-0000000000a1');
SELECT pg_temp.ungate();
SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','INVOICE_CREATE','a0220000-4444-4000-8000-000000000003');
INSERT INTO core.invoices (id,tenant_id,ref,organisation_id,outstanding_sen,created_by_kind,created_by_id)
VALUES ('a0220000-4444-4000-8000-000000000003','a0220000-1111-4000-8000-000000000001','INV-A22-0003',
        'a0220000-2222-4000-8000-000000000001',0,'HUMAN','a0220000-0000-4000-8000-0000000000a1');
SELECT pg_temp.ungate();
SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','INVOICE_CREATE','a0220000-4444-4000-8000-000000000004');
INSERT INTO core.invoices (id,tenant_id,ref,organisation_id,outstanding_sen,created_by_kind,created_by_id)
VALUES ('a0220000-4444-4000-8000-000000000004','a0220000-1111-4000-8000-000000000001','INV-A22-0004',
        'a0220000-2222-4000-8000-000000000001',999999,'HUMAN','a0220000-0000-4000-8000-0000000000a1');
SELECT pg_temp.ungate();

SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','INVOICE_PUSH','a0220000-4444-4000-8000-000000000001');
UPDATE core.invoices SET status = 'SENT', issued_at = pg_catalog.now() WHERE id = 'a0220000-4444-4000-8000-000000000001';
SELECT pg_temp.ungate();
UPDATE core.invoices SET status = 'OVERDUE' WHERE id = 'a0220000-4444-4000-8000-000000000001';

SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','INVOICE_PUSH','a0220000-4444-4000-8000-000000000002');
UPDATE core.invoices SET status = 'SENT', issued_at = pg_catalog.now() WHERE id = 'a0220000-4444-4000-8000-000000000002';
SELECT pg_temp.ungate();
UPDATE core.invoices SET status = 'OVERDUE' WHERE id = 'a0220000-4444-4000-8000-000000000002';

SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','INVOICE_PUSH','a0220000-4444-4000-8000-000000000003');
UPDATE core.invoices SET status = 'SENT', issued_at = pg_catalog.now() WHERE id = 'a0220000-4444-4000-8000-000000000003';
SELECT pg_temp.ungate();
SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','PAYMENT_RECORD','a0220000-4444-4000-8000-000000000003');
UPDATE core.invoices SET status = 'PAID' WHERE id = 'a0220000-4444-4000-8000-000000000003';
SELECT pg_temp.ungate();

SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','INVOICE_PUSH','a0220000-4444-4000-8000-000000000004');
UPDATE core.invoices SET status = 'SENT', issued_at = pg_catalog.now() WHERE id = 'a0220000-4444-4000-8000-000000000004';
SELECT pg_temp.ungate();
UPDATE core.invoices SET status = 'OVERDUE' WHERE id = 'a0220000-4444-4000-8000-000000000004';
UPDATE core.invoices SET voided_at = pg_catalog.now(), void_reason = 'Cancelled'
 WHERE id = 'a0220000-4444-4000-8000-000000000004';

-- ── Programme + 4 engagements (hrdc_packets is UNIQUE per engagement) ───────
INSERT INTO core.programmes (id,tenant_id,name,category,days,version,status,hrdc_scheme,hrdc_claimable,
  list_price_sen,list_price_pax,floor_price_sen,floor_margin_rate,currency,outcomes,created_by_kind,created_by_id)
VALUES ('a0220000-8888-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001','Leading Teams A22','LEADERSHIP',
        2,1,'ACTIVE','SBL_KHAS',true,4000000,25,2800000,0.3000,'MYR',ARRAY['Delegate'],'HUMAN','a0220000-0000-4000-8000-0000000000a1');

INSERT INTO core.engagements (id,tenant_id,organisation_id,programme_id,owner_id,pipeline_id,title,value_sen,currency,starts_on,ends_on,created_by_kind,created_by_id)
SELECT gen, 'a0220000-1111-4000-8000-000000000001','a0220000-2222-4000-8000-000000000001',
       'a0220000-8888-4000-8000-000000000001','a0220000-0000-4000-8000-0000000000a1', pipeline.id,
       'Leading Teams for Chrome A22', 1850000,'MYR','2026-08-10','2026-08-11','HUMAN','a0220000-0000-4000-8000-0000000000a1'
  FROM core.pipelines AS pipeline,
       (VALUES ('a0220000-aaaa-4000-8000-000000000001'::uuid),
               ('a0220000-aaaa-4000-8000-000000000002'::uuid),
               ('a0220000-aaaa-4000-8000-000000000003'::uuid),
               ('a0220000-aaaa-4000-8000-000000000004'::uuid)) AS e(gen)
 WHERE pipeline.tenant_id = 'a0220000-1111-4000-8000-000000000001' AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default;

-- ── §3 CLAIM_VALUE_AT_RISK: 2 in scope (300,000 + 100,000 = 400,000 sen),
--     ON_TRACK and a voided DEADLINE_AT_RISK excluded.
INSERT INTO core.hrdc_packets
  (id,tenant_id,engagement_id,organisation_id,scheme,employer_code,claim_value_sen,panel_state,created_by_kind,created_by_id)
VALUES
  ('a0220000-5555-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001','a0220000-aaaa-4000-8000-000000000001',
   'a0220000-2222-4000-8000-000000000001','SBL_KHAS','E-A22',300000,'DEADLINE_AT_RISK','HUMAN','a0220000-0000-4000-8000-0000000000a1'),
  ('a0220000-5555-4000-8000-000000000002','a0220000-1111-4000-8000-000000000001','a0220000-aaaa-4000-8000-000000000002',
   'a0220000-2222-4000-8000-000000000001','SBL_KHAS','E-A22',100000,'BLOCKED','HUMAN','a0220000-0000-4000-8000-0000000000a1'),
  ('a0220000-5555-4000-8000-000000000003','a0220000-1111-4000-8000-000000000001','a0220000-aaaa-4000-8000-000000000003',
   'a0220000-2222-4000-8000-000000000001','SBL_KHAS','E-A22',999999,'ON_TRACK','HUMAN','a0220000-0000-4000-8000-0000000000a1'),
  ('a0220000-5555-4000-8000-000000000004','a0220000-1111-4000-8000-000000000001','a0220000-aaaa-4000-8000-000000000004',
   'a0220000-2222-4000-8000-000000000001','SBL_KHAS','E-A22',50000,'DEADLINE_AT_RISK','HUMAN','a0220000-0000-4000-8000-0000000000a1');
UPDATE core.hrdc_packets SET voided_at = pg_catalog.now(), void_reason = 'Cancelled'
 WHERE id = 'a0220000-5555-4000-8000-000000000004';

-- ── §4 PROPOSALS_SENT / proposals-vs-won ────────────────────────────────────
INSERT INTO core.templates
  (id,tenant_id,template_type,version,label,merge_fields,status,created_by_kind,created_by_id)
VALUES
  ('a0220000-6666-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001','PROPOSAL',1,'Standard A22',
   ARRAY['organisation.name'],'ACTIVE','HUMAN','a0220000-0000-4000-8000-0000000000a1');

-- P1: sent this month, still SENT. P2: sent this month, ACCEPTED this month
-- (so it counts once in `sent` and once in `won` for the SAME month). P3:
-- sent 4 months back - guaranteed outside the CURRENT quarter (a quarter is
-- only 3 months wide) but inside a trailing 6-month proposals-vs-won window.
-- `core.proposals.status` is gated: born DRAFT (ungated), `DRAFT -> SENT`
-- needs PROPOSAL_SEND, `SENT -> ACCEPTED` is ungated. `sent_at`/`accepted_at`
-- are set in the SAME statement as the status transition
-- (`proposals_sent_needs_timestamp`).
INSERT INTO core.proposals
  (id,tenant_id,ref,opportunity_id,organisation_id,template_id,value_sen)
VALUES
  ('a0220000-7777-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001','PRO-A22-0001',
   'a0220000-3333-4000-8000-000000000001','a0220000-2222-4000-8000-000000000001','a0220000-6666-4000-8000-000000000001',1850000),
  ('a0220000-7777-4000-8000-000000000002','a0220000-1111-4000-8000-000000000001','PRO-A22-0002',
   'a0220000-3333-4000-8000-000000000002','a0220000-2222-4000-8000-000000000001','a0220000-6666-4000-8000-000000000001',1850000),
  ('a0220000-7777-4000-8000-000000000003','a0220000-1111-4000-8000-000000000001','PRO-A22-0003',
   'a0220000-3333-4000-8000-000000000003','a0220000-2222-4000-8000-000000000001','a0220000-6666-4000-8000-000000000001',1850000);

SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','PROPOSAL_SEND','a0220000-7777-4000-8000-000000000001');
UPDATE core.proposals SET status = 'SENT', sent_at = pg_catalog.date_trunc('month', pg_catalog.now()) + interval '3 days'
 WHERE id = 'a0220000-7777-4000-8000-000000000001';
SELECT pg_temp.ungate();

SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','PROPOSAL_SEND','a0220000-7777-4000-8000-000000000002');
UPDATE core.proposals SET status = 'SENT', sent_at = pg_catalog.date_trunc('month', pg_catalog.now()) + interval '5 days'
 WHERE id = 'a0220000-7777-4000-8000-000000000002';
SELECT pg_temp.ungate();
UPDATE core.proposals SET status = 'ACCEPTED', accepted_at = pg_catalog.date_trunc('month', pg_catalog.now()) + interval '10 days'
 WHERE id = 'a0220000-7777-4000-8000-000000000002';

SELECT pg_temp.gate('a0220000-1111-4000-8000-000000000001','PROPOSAL_SEND','a0220000-7777-4000-8000-000000000003');
UPDATE core.proposals SET status = 'SENT', sent_at = pg_catalog.date_trunc('month', pg_catalog.now()) - interval '4 months'
 WHERE id = 'a0220000-7777-4000-8000-000000000003';
SELECT pg_temp.ungate();

-- ── §5 agentActivity / autonomyMix / agentSpend ─────────────────────────────
INSERT INTO core.agents (id,tenant_id,agent_id,name,status,principal_user_id)
VALUES ('a0220000-9999-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001',
        'agent_a22_1','Lead Agent A22','ACTIVE','a0220000-0000-4000-8000-0000000000a9');

-- Two governed action requests, both granted ACT_WITH_APPROVAL, so the mode
-- across today's 3 runs is ACT_WITH_APPROVAL (2 of 3) over the ungoverned
-- run's implicit OBSERVE (1 of 3): rates 0.667 / 0.333.
INSERT INTO core.action_requests
  (id,tenant_id,action_type,payload,requested_by_kind,requested_by_id,status,granted_level)
VALUES
  ('a0220000-aab0-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001','ENQUIRY_ARCHIVE','{}'::jsonb,
   'AGENT','agent_a22_1','EXECUTED','ACT_WITH_APPROVAL'),
  ('a0220000-aab0-4000-8000-000000000002','a0220000-1111-4000-8000-000000000001','ENQUIRY_ARCHIVE','{}'::jsonb,
   'AGENT','agent_a22_1','EXECUTED','ACT_WITH_APPROVAL'),
  ('a0220000-aab0-4000-8000-000000000003','a0220000-1111-4000-8000-000000000001','ENQUIRY_ARCHIVE','{}'::jsonb,
   'AGENT','agent_a22_1','EXECUTED','ACT_WITH_APPROVAL');

INSERT INTO core.runs (id,tenant_id,agent_id,trigger,started_at,cost_sen,action_request_id)
VALUES
  ('a0220000-bbb0-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001','agent_a22_1',
   '{"type":"SCHEDULED"}'::jsonb, pg_catalog.now(), 500, 'a0220000-aab0-4000-8000-000000000001'),
  ('a0220000-bbb0-4000-8000-000000000002','a0220000-1111-4000-8000-000000000001','agent_a22_1',
   '{"type":"SCHEDULED"}'::jsonb, pg_catalog.now(), 300, NULL),
  ('a0220000-bbb0-4000-8000-000000000003','a0220000-1111-4000-8000-000000000001','agent_a22_1',
   '{"type":"SCHEDULED"}'::jsonb, pg_catalog.now(), 200, 'a0220000-aab0-4000-8000-000000000002');
-- actionsToday = 3, costMonth = 500+300+200 = 1000 sen.

INSERT INTO core.evals (tenant_id,agent_id,kind,golden_set_version,score)
VALUES
  ('a0220000-1111-4000-8000-000000000001','agent_a22_1','GOLDEN_SET','v1',0.900),
  ('a0220000-1111-4000-8000-000000000001','agent_a22_1','JURY_GATE',NULL,0.800);
-- median(0.9,0.8) = 0.85.

INSERT INTO core.ai_budgets (tenant_id,scope,key,cap_sen)
VALUES ('a0220000-1111-4000-8000-000000000001','AGENT','agent_a22_1',100000);

INSERT INTO app.usage_rollup (tenant_id,period,scope,key,spend_sen)
VALUES ('a0220000-1111-4000-8000-000000000001', pg_catalog.to_char(pg_catalog.now(),'YYYY-MM'),
        'AGENT','agent_a22_1',1000);
-- agentSpend = {spent: 1000, budget: 100000}.

-- ── §6 approvalsPending: one PENDING row, direct insert (bypassing the
--     envelope - this pin is about the projection, not `perform_action`).
INSERT INTO core.action_requests
  (id,tenant_id,action_type,payload,requested_by_kind,requested_by_id,status)
VALUES ('a0220000-aab0-4000-8000-000000000009','a0220000-1111-4000-8000-000000000001',
        'ENQUIRY_ARCHIVE','{}'::jsonb,'AGENT','agent_a22_1','QUEUED_FOR_APPROVAL');

INSERT INTO core.approval_requests
  (id,tenant_id,action_request_id,policy_id,action_type,subject,requested_by_kind,reason,
   diff,diff_hash,approver_role,sla_due_at,expires_at,bulk_approvable)
VALUES ('a0220000-cccc-4000-8000-000000000001','a0220000-1111-4000-8000-000000000001',
        'a0220000-aab0-4000-8000-000000000009','TEST-POLICY','ENQUIRY_ARCHIVE','Archive a stale enquiry',
        'AGENT','Test fixture', '[]'::jsonb,'deadbeef','MD',
        pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '7 days', false);

-- ════════ T1 · me_profile: MD gets exactly the contract's 9 keys ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0220000-0000-4000-8000-0000000000a1','a0220000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a22.t1', pg_temp.try($$SELECT core.me_profile()$$)::text, true);
RESET ROLE;

SELECT pg_temp.assert((pg_temp.got('t1')->'value'->>'success')::boolean, 'T1a me_profile ok=true');
SELECT pg_temp.assert(
  (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(pg_temp.got('t1')->'value'->'data') AS k)
    = ARRAY['department','email','id','jobTitle','location','moduleCount','session','staffNumber','tenant'],
  'T1b exactly the 9 MeProfile keys, no mobile');
SELECT pg_temp.assert(pg_temp.got('t1')->'value'->'data'->>'email' = 'md@a22.test', 'T1c email real');
SELECT pg_temp.assert(pg_temp.got('t1')->'value'->'data'->'tenant'->>'name' = 'Akademi Perdana A22', 'T1d tenant.name real');
SELECT pg_temp.assert((pg_temp.got('t1')->'value'->'data'->'tenant'->'code') = 'null'::jsonb, 'T1e tenant.code null');
SELECT pg_temp.assert((pg_temp.got('t1')->'value'->'data'->'location') = 'null'::jsonb, 'T1f location null');
SELECT pg_temp.assert((pg_temp.got('t1')->'value'->'data'->'jobTitle') = 'null'::jsonb, 'T1g jobTitle null');
SELECT pg_temp.assert((pg_temp.got('t1')->'value'->'data'->'department') = 'null'::jsonb, 'T1h department null');
SELECT pg_temp.assert((pg_temp.got('t1')->'value'->'data'->'staffNumber') = 'null'::jsonb, 'T1i staffNumber null');
-- `session` answers `null` AS A WHOLE, matching the contract's own ruling
-- for `core.me_profile()` and the merged web reader
-- (`SidebarProfile.tsx`, gated on `details.session` before anything
-- inside it): `lastSignInAt` is a REQUIRED `ProfileSession` field, this
-- shim's `auth.users` has no `last_sign_in_at` column at all, and a
-- populated object with a null required field would violate the type this
-- pin exists to hold the RPC to. The real-derivation path (a full object
-- with `activeSessions`/`twoFactorEnabled` real and `browser`/`place`
-- null) was verified ad hoc against a locally-extended copy of this
-- schema, not checked in here, since adding hosted-only GoTrue
-- columns/tables to the shared shim is not this pin's fixture to make.
SELECT pg_temp.assert((pg_temp.got('t1')->'value'->'data'->'session') = 'null'::jsonb, 'T1j session null as a whole (no last_sign_in_at column in this shim)');
-- MD holds 13 of the 14 nav permissions (lacks the bare 'compliance:read').
SELECT pg_temp.assert((pg_temp.got('t1')->'value'->'data'->>'moduleCount')::int = 13, 'T1k moduleCount = 13');

-- ════════ T2 · me_profile: AGENT is FORBIDDEN, anon refused ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.agent_claims('agent_a22_1','a0220000-1111-4000-8000-000000000001'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a22.t2a', pg_temp.try($$SELECT core.me_profile()$$)::text, true);
RESET ROLE;
SELECT pg_temp.assert((pg_temp.got('t2a')->'value'->>'success')::boolean = false, 'T2a agent me_profile refused');
SELECT pg_temp.assert(pg_temp.got('t2a')->'value'->'error'->>'code' = 'FORBIDDEN', 'T2b agent me_profile FORBIDDEN');

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('a22.t2c', pg_temp.try($$SELECT core.me_profile()$$)::text, true);
RESET ROLE;
-- anon has no EXECUTE grant at all, so `try()` catches a real Postgres
-- exception, not an `app.err()` return - the try() envelope is `{ok,
-- sqlstate, message}` directly, with no `value` wrapper.
SELECT pg_temp.assert((pg_temp.got('t2c')->>'ok')::boolean = false, 'T2d anon me_profile raised');
SELECT pg_temp.assert(pg_temp.got('t2c')->>'sqlstate' = '42501', 'T2e anon me_profile 42501');

-- ════════ T3 · get_executive_dashboard: MD's real numbers ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0220000-0000-4000-8000-0000000000a1','a0220000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a22.t3',
  pg_temp.try(pg_catalog.format($$SELECT core.get_executive_dashboard(%L)$$,
    pg_catalog.to_char(pg_catalog.now(),'YYYY-MM')))::text, true);
RESET ROLE;

SELECT pg_temp.assert((pg_temp.got('t3')->'value'->>'success')::boolean, 'T3a dashboard ok=true');

WITH d AS (SELECT pg_temp.got('t3')->'value'->'data' AS data),
     m AS (SELECT elem FROM d, pg_catalog.jsonb_array_elements(data->'metrics') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->'value'->>'amount')::bigint FROM m WHERE elem->>'key' = 'OPEN_PIPELINE') = 3500000
  AND (SELECT elem->>'secondary' FROM m WHERE elem->>'key' = 'OPEN_PIPELINE') = '3 opportunities',
  'T3b OPEN_PIPELINE = 3,500,000 sen / 3 opportunities');

WITH d AS (SELECT pg_temp.got('t3')->'value'->'data' AS data),
     m AS (SELECT elem FROM d, pg_catalog.jsonb_array_elements(data->'metrics') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->'value'->>'amount')::bigint FROM m WHERE elem->>'key' = 'AR_OVERDUE') = 550000
  AND (SELECT elem->>'secondary' FROM m WHERE elem->>'key' = 'AR_OVERDUE') = '2 invoices',
  'T3c AR_OVERDUE = 550,000 sen / 2 invoices');

WITH d AS (SELECT pg_temp.got('t3')->'value'->'data' AS data),
     m AS (SELECT elem FROM d, pg_catalog.jsonb_array_elements(data->'metrics') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->>'value')::int FROM m WHERE elem->>'key' = 'PROPOSALS_SENT') = 2,
  'T3d PROPOSALS_SENT = 2 (this quarter; the 4-months-back one excluded)');

WITH d AS (SELECT pg_temp.got('t3')->'value'->'data' AS data),
     m AS (SELECT elem FROM d, pg_catalog.jsonb_array_elements(data->'metrics') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->'value'->>'amount')::bigint FROM m WHERE elem->>'key' = 'CLAIM_VALUE_AT_RISK') = 400000
  AND (SELECT elem->>'secondary' FROM m WHERE elem->>'key' = 'CLAIM_VALUE_AT_RISK') = '2 packets',
  'T3e CLAIM_VALUE_AT_RISK = 400,000 sen / 2 packets');

WITH d AS (SELECT pg_temp.got('t3')->'value'->'data' AS data)
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM d, pg_catalog.jsonb_array_elements(data->'metrics') AS elem
               WHERE elem->>'key' = 'ADMIN_HOURS_SAVED'),
  'T3f no ADMIN_HOURS_SAVED key');

SELECT pg_temp.assert(
  pg_catalog.jsonb_array_length((pg_temp.got('t3')->'value'->'data')->'approvalsPending') = 1,
  'T3g approvalsPending has exactly 1 row');
SELECT pg_temp.assert(
  (pg_temp.got('t3')->'value'->'data')->'approvalsPending'->0->>'subject' = 'Archive a stale enquiry',
  'T3h approvalsPending row is the seeded one');

WITH agents AS (SELECT elem FROM
  pg_catalog.jsonb_array_elements((pg_temp.got('t3')->'value'->'data')->'agentActivity') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->>'actionsToday')::int FROM agents WHERE elem->>'agentId' = 'agent_a22_1') = 3,
  'T3i agentActivity actionsToday = 3');
WITH agents AS (SELECT elem FROM
  pg_catalog.jsonb_array_elements((pg_temp.got('t3')->'value'->'data')->'agentActivity') AS elem)
SELECT pg_temp.assert(
  (SELECT elem->>'autonomy' FROM agents WHERE elem->>'agentId' = 'agent_a22_1') = 'ACT_WITH_APPROVAL',
  'T3j agentActivity autonomy mode = ACT_WITH_APPROVAL (2 of 3)');
WITH agents AS (SELECT elem FROM
  pg_catalog.jsonb_array_elements((pg_temp.got('t3')->'value'->'data')->'agentActivity') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->'costMonth'->>'amount')::bigint FROM agents WHERE elem->>'agentId' = 'agent_a22_1') = 1000,
  'T3k agentActivity costMonth = 1000 sen');
WITH agents AS (SELECT elem FROM
  pg_catalog.jsonb_array_elements((pg_temp.got('t3')->'value'->'data')->'agentActivity') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->>'evalScore')::numeric FROM agents WHERE elem->>'agentId' = 'agent_a22_1') = 0.850,
  'T3l agentActivity evalScore = median(0.9,0.8) = 0.85');

WITH mix AS (SELECT elem FROM
  pg_catalog.jsonb_array_elements((pg_temp.got('t3')->'value'->'data')->'autonomyMix') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->>'rate')::numeric FROM mix WHERE elem->>'level' = 'ACT_WITH_APPROVAL') = 0.667,
  'T3m autonomyMix ACT_WITH_APPROVAL rate = 0.667 (2 of 3)');
WITH mix AS (SELECT elem FROM
  pg_catalog.jsonb_array_elements((pg_temp.got('t3')->'value'->'data')->'autonomyMix') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->>'rate')::numeric FROM mix WHERE elem->>'level' = 'OBSERVE') = 0.333,
  'T3n autonomyMix OBSERVE rate = 0.333 (1 of 3)');

SELECT pg_temp.assert(
  ((pg_temp.got('t3')->'value'->'data')->'agentSpend'->'spent'->>'amount')::bigint = 1000,
  'T3o agentSpend.spent = 1000 sen');
SELECT pg_temp.assert(
  ((pg_temp.got('t3')->'value'->'data')->'agentSpend'->'budget'->>'amount')::bigint = 100000,
  'T3p agentSpend.budget = 100,000 sen');

-- ════════ T4 · get_executive_dashboard: OPS FORBIDDEN, anon refused ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0220000-0000-4000-8000-0000000000a3','a0220000-1111-4000-8000-000000000001','OPS'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a22.t4a',
  pg_temp.try($$SELECT core.get_executive_dashboard('2026-11')$$)::text, true);
RESET ROLE;
SELECT pg_temp.assert((pg_temp.got('t4a')->'value'->>'success')::boolean = false, 'T4a OPS refused');
SELECT pg_temp.assert(pg_temp.got('t4a')->'value'->'error'->>'code' = 'FORBIDDEN', 'T4b OPS FORBIDDEN');
SELECT pg_temp.assert(pg_temp.got('t4a')->'value'->'error'->'details'->>'permission' = 'dashboard:executive:read',
  'T4c OPS FORBIDDEN names the missing permission');

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('a22.t4d',
  pg_temp.try($$SELECT core.get_executive_dashboard('2026-11')$$)::text, true);
RESET ROLE;
SELECT pg_temp.assert((pg_temp.got('t4d')->>'ok')::boolean = false, 'T4d anon dashboard raised');
SELECT pg_temp.assert(pg_temp.got('t4d')->>'sqlstate' = '42501', 'T4e anon dashboard 42501');

-- ════════ T5 · get_executive_dashboard: bad period ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0220000-0000-4000-8000-0000000000a1','a0220000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a22.t5a',
  pg_temp.try($$SELECT core.get_executive_dashboard('not-a-period')$$)::text, true);
SELECT pg_catalog.set_config('a22.t5b',
  pg_temp.try($$SELECT core.get_executive_dashboard(NULL)$$)::text, true);
RESET ROLE;
SELECT pg_temp.assert(pg_temp.got('t5a')->'value'->'error'->>'code' = 'VALIDATION_FAILED', 'T5a malformed period VALIDATION_FAILED');
SELECT pg_temp.assert(pg_temp.got('t5b')->'value'->'error'->>'code' = 'VALIDATION_FAILED', 'T5b null period VALIDATION_FAILED');

-- ════════ T6 · get_executive_dashboard: tenant B sees none of A's numbers ════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0220000-0000-4000-8000-0000000000b1','a0220000-1111-4000-8000-000000000002','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a22.t6',
  pg_temp.try(pg_catalog.format($$SELECT core.get_executive_dashboard(%L)$$,
    pg_catalog.to_char(pg_catalog.now(),'YYYY-MM')))::text, true);
RESET ROLE;

WITH d AS (SELECT pg_temp.got('t6')->'value'->'data' AS data),
     m AS (SELECT elem FROM d, pg_catalog.jsonb_array_elements(data->'metrics') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->'value'->>'amount')::bigint FROM m WHERE elem->>'key' = 'OPEN_PIPELINE') = 0
  AND (SELECT (elem->'value'->>'amount')::bigint FROM m WHERE elem->>'key' = 'AR_OVERDUE') = 0
  AND (SELECT (elem->>'value')::int FROM m WHERE elem->>'key' = 'PROPOSALS_SENT') = 0
  AND (SELECT (elem->'value'->>'amount')::bigint FROM m WHERE elem->>'key' = 'CLAIM_VALUE_AT_RISK') = 0,
  'T6a tenant B sees zero on all four metrics');
SELECT pg_temp.assert(
  pg_catalog.jsonb_array_length((pg_temp.got('t6')->'value'->'data')->'approvalsPending') = 0,
  'T6b tenant B has no pending approvals');
SELECT pg_temp.assert(
  pg_catalog.jsonb_array_length((pg_temp.got('t6')->'value'->'data')->'agentActivity') = 0,
  'T6c tenant B has no agents');
SELECT pg_temp.assert(
  pg_catalog.jsonb_array_length((pg_temp.got('t6')->'value'->'data')->'autonomyMix') = 0,
  'T6d tenant B has no autonomy mix');
SELECT pg_temp.assert(
  ((pg_temp.got('t6')->'value'->'data')->'agentSpend'->'spent'->>'amount')::bigint = 0
  AND ((pg_temp.got('t6')->'value'->'data')->'agentSpend'->'budget'->>'amount')::bigint = 0,
  'T6e tenant B has zero agent spend');

-- ════════ T7 · get_proposals_vs_won ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0220000-0000-4000-8000-0000000000a1','a0220000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a22.t7a', pg_temp.try($$SELECT core.get_proposals_vs_won(6)$$)::text, true);
SELECT pg_catalog.set_config('a22.t7b', pg_temp.try($$SELECT core.get_proposals_vs_won(0)$$)::text, true);
SELECT pg_catalog.set_config('a22.t7c', pg_temp.try($$SELECT core.get_proposals_vs_won(NULL)$$)::text, true);
RESET ROLE;

SELECT pg_temp.assert((pg_temp.got('t7a')->'value'->>'success')::boolean, 'T7a proposals-vs-won ok=true');
WITH s AS (SELECT elem FROM
  pg_catalog.jsonb_array_elements((pg_temp.got('t7a')->'value'->'data')->'series') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->>'sent')::int FROM s WHERE elem->>'period' = pg_catalog.to_char(pg_catalog.now(),'YYYY-MM')) = 2
  AND (SELECT (elem->>'won')::int FROM s WHERE elem->>'period' = pg_catalog.to_char(pg_catalog.now(),'YYYY-MM')) = 1,
  'T7b this month: sent=2, won=1');
WITH s AS (SELECT elem FROM
  pg_catalog.jsonb_array_elements((pg_temp.got('t7a')->'value'->'data')->'series') AS elem)
SELECT pg_temp.assert(
  (SELECT (elem->>'sent')::int FROM s
     WHERE elem->>'period' = pg_catalog.to_char(pg_catalog.now() - interval '4 months', 'YYYY-MM')) = 1,
  'T7c 4 months back: sent=1');
SELECT pg_temp.assert(
  pg_catalog.jsonb_array_length((pg_temp.got('t7a')->'value'->'data')->'series') = 6,
  'T7d series has exactly 6 months');

SELECT pg_temp.assert(pg_temp.got('t7b')->'value'->'error'->>'code' = 'VALIDATION_FAILED', 'T7e months=0 VALIDATION_FAILED');
SELECT pg_temp.assert(pg_temp.got('t7c')->'value'->'error'->>'code' = 'VALIDATION_FAILED', 'T7f months=NULL VALIDATION_FAILED');

-- ════════ T8 · no fabricated hours-saved ════════

SELECT pg_temp.assert(pg_catalog.to_regprocedure('core.get_hours_saved()') IS NULL, 'T8a get_hours_saved does not exist');

ROLLBACK;
