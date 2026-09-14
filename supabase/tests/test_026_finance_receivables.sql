-- ═══════════════════════════════════════════════════════════════════════════
-- test_026 · finance_receivables
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001–026. Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_026_finance_receivables.sql
--
-- IMPERSONATION IS REAL. Every RPC probe runs as `authenticated` (`SET LOCAL
-- ROLE`) with a JWT claim set for a real `auth.users` row, one statement, its
-- result parked in a transaction-local GUC, assertions after `RESET ROLE` —
-- the same discipline test_020/test_021 use.
--
-- T1  The aging ladder and buckets 026 seeds exist for this tenant (4 buckets,
--     5 stages) — the gap 026's header documents, closed.
-- T2  `list_invoices`/`get_invoice` as FINANCE: exact contract keys, the
--     money fields reconcile to the fixture, `NOT_FOUND` for a made-up id.
-- T3  `get_receivables_aging`: the overdue invoice's outstanding balance lands
--     in the correct bucket, `dsoDays` is a plain number.
-- T4  `get_collections_queue`: the seeded case, `daysOverdue` matches the due
--     date, `aging` matches T3.
-- T5  `get_collection_draft`: LIVE while the rate is fresh; a teeth-check
--     expires the rate (`stale_after` moved into the past) and the SAME call
--     answers CACHED, never a stale number silently kept as LIVE; a
--     withdrawn consent reads `granted: false`.
-- T6  `list_commissions`: the QUOTATION-basis row's rate, amount and status
--     (ACCRUED — invoiced, not yet collected) match the fixture by hand.
-- T6b `list_commissions` with 3 commission-eligible deals and a size-2 page:
--     `p_sort` (`amount`/`-amount`) is honoured both directions, and
--     `page.total` is the unbounded count of all 3, not just the page.
-- T7  Authorization: OPS (holds none of invoice:read/receivable:read/
--     collection:read/quotation:read, 002 §11) is FORBIDDEN on all six with
--     `requiredPermission` naming the right key; anon gets 42501 on the RPC
--     call.
-- T8  Tenant isolation: another tenant's MD sees zero invoices/commissions
--     and NOT_FOUND on this tenant's invoice ref.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_026 SETUP FAILURE: check_asserts is OFF, every ASSERT below is a no-op.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

-- ── Helpers ────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal1')::text;
$fn$;

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'value', v);
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'message', SQLERRM);
END;
$fn$;

CREATE FUNCTION pg_temp.got(p_key text) RETURNS jsonb
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('t26.' || p_key)::jsonb; $fn$;

-- 011's write-path gate (test_010's own helper, reused verbatim): the effect
-- applier a real INVOICE_CREATE/PAYMENT_RECORD would use, so fixture writes
-- cross a gated edge the way the product does rather than going around it.
CREATE FUNCTION pg_temp.gate(p_tenant uuid, p_type text, p_target uuid) RETURNS void
LANGUAGE plpgsql AS $gate$
DECLARE v_id uuid;
BEGIN
  INSERT INTO core.action_requests
    (tenant_id, action_type, target_id, status, requested_by_kind, requested_by_id)
  VALUES (p_tenant, p_type, p_target, 'EXECUTING', 'SYSTEM', 'pin-fixture')
  RETURNING id INTO v_id;
  PERFORM pg_catalog.set_config('app.effect_applier', v_id::text, true);
END $gate$;

CREATE FUNCTION pg_temp.ungate() RETURNS void
LANGUAGE plpgsql AS $ungate$
BEGIN PERFORM pg_catalog.set_config('app.effect_applier', '', true); END $ungate$;

DO $setup$
BEGIN
  IF to_regprocedure('core.list_invoices(jsonb,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'test_026 SETUP FAILURE: 026 is missing or partial.';
  END IF;
END;
$setup$;

-- ── Fixtures ───────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('00000026-0000-4000-8000-0000000000a1','fin@t26.test'),
  ('00000026-0000-4000-8000-0000000000a2','sales@t26.test'),
  ('00000026-0000-4000-8000-0000000000a3','ops@t26.test'),
  ('00000026-0000-4000-8000-0000000000b1','md@t26b.test');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('00000026-1111-4000-8000-000000000001','t26-akademi','Akademi Perdana T26','ACTIVE','Asia/Kuala_Lumpur','en-MY'),
  ('00000026-1111-4000-8000-000000000002','t26-other','Other Tenant T26','ACTIVE','Asia/Kuala_Lumpur','en-MY');

-- 026's aging/collection ladder seed (§1 of the forward migration) is a
-- BACKFILL for the tenants that existed when 026 was applied — it is not a
-- trigger on `public.tenants`, so a tenant created afterwards (this pin's
-- fixture tenant included) needs its own copy, exactly as it needs its own
-- config rows for everything else 016 would otherwise provision. Same values
-- 026 itself inserts, scoped to this one tenant.
INSERT INTO core.aging_buckets (tenant_id, code, label, days, sort) VALUES
  ('00000026-1111-4000-8000-000000000001','current',  'Current',    int4range(NULL, 1), 1),
  ('00000026-1111-4000-8000-000000000001','d1_30',    '1-30 days',  int4range(1, 31),    2),
  ('00000026-1111-4000-8000-000000000001','d31_60',   '31-60 days', int4range(31, 61),   3),
  ('00000026-1111-4000-8000-000000000001','d60_plus', '60+ days',   int4range(61, NULL), 4);

INSERT INTO core.collection_rules (tenant_id, stage, trigger_days_overdue, channel, requires_role, autonomy) VALUES
  ('00000026-1111-4000-8000-000000000001','REMINDER_1',   7,  'WHATSAPP', NULL,      'ACT_WITH_APPROVAL'),
  ('00000026-1111-4000-8000-000000000001','REMINDER_2',   30, 'EMAIL',    NULL,      'ACT_WITH_APPROVAL'),
  ('00000026-1111-4000-8000-000000000001','REMINDER_3',   45, 'EMAIL',    'MD',      'ACT_WITH_APPROVAL'),
  ('00000026-1111-4000-8000-000000000001','HUMAN_CALL',   60, 'PHONE',    'FINANCE', 'SUGGEST'),
  ('00000026-1111-4000-8000-000000000001','TRADING_HOLD', 75, 'PHONE',    'MD',      'SUGGEST');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('00000026-1111-4000-8000-000000000001','00000026-0000-4000-8000-0000000000a1','FINANCE','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('00000026-1111-4000-8000-000000000001','00000026-0000-4000-8000-0000000000a2','SALES','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('00000026-1111-4000-8000-000000000001','00000026-0000-4000-8000-0000000000a3','OPS','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('00000026-1111-4000-8000-000000000002','00000026-0000-4000-8000-0000000000b1','MD','HUMAN','ALL','ALL',false,'ACTIVE',true);

INSERT INTO core.organisations (id, tenant_id, name, owner_id,
                                tax_identifier_kind, tax_identifier, tin,
                                address_line1, city, state_code, postcode)
VALUES ('00000026-2222-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
        'Chrome T26 Sdn Bhd','00000026-0000-4000-8000-0000000000a2',
        'BRN','202601234567','C26345678901','Lot 26, Jalan Perusahaan','Shah Alam','10','40150');

INSERT INTO core.contacts (id, tenant_id, organisation_id, name, email)
VALUES ('00000026-2299-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
        '00000026-2222-4000-8000-000000000001','Chrome AP','ap@chrome-t26.test');

INSERT INTO core.contact_consents (tenant_id, contact_id, channel, granted, recorded_at)
VALUES ('00000026-1111-4000-8000-000000000001','00000026-2299-4000-8000-000000000001',
        'WHATSAPP', true, now() - interval '10 days');

-- `stage` is gated (011's `app.enforce_state_transition`); the commissions
-- read below only needs the opportunity to exist as the proposal's parent,
-- not to carry any particular stage, so it is left at its born default.
INSERT INTO core.opportunities
  (id,tenant_id,ref,organisation_id,owner_id,value_sen,currency,probability,created_by_kind,created_by_id)
VALUES ('00000026-3333-4000-8000-000000000001','00000026-1111-4000-8000-000000000001','OPP-T26-0001',
        '00000026-2222-4000-8000-000000000001','00000026-0000-4000-8000-0000000000a2',1200000,'MYR',1.000,
        'HUMAN','00000026-0000-4000-8000-0000000000a2');

INSERT INTO core.templates (id,tenant_id,template_type,version,label,merge_fields,status,created_by_kind,created_by_id)
VALUES ('00000026-4444-4000-8000-000000000001','00000026-1111-4000-8000-000000000001','PROPOSAL',1,'Standard T26',
        ARRAY['organisation.name'],'ACTIVE','HUMAN','00000026-0000-4000-8000-0000000000a2');

INSERT INTO core.programmes (id,tenant_id,name,category,days,version,status,hrdc_scheme,hrdc_claimable,
  list_price_sen,list_price_pax,floor_price_sen,floor_margin_rate,currency,outcomes,created_by_kind,created_by_id)
VALUES ('00000026-5555-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
        'Leading Teams T26','LEADERSHIP',2,1,'ACTIVE','SBL_KHAS',true,
        1200000,25,900000,0.3000,'MYR',ARRAY['Delegate'],'HUMAN','00000026-0000-4000-8000-0000000000a2');

-- `status` is gated too; the commissions read only needs the proposal to
-- exist as the quotation's parent, so it is left at its born default.
INSERT INTO core.proposals (id, tenant_id, ref, opportunity_id, organisation_id, template_id, programme_id,
                            value_sen, margin_rate)
VALUES ('00000026-6666-4000-8000-000000000001','00000026-1111-4000-8000-000000000001','PRO-T26-0001',
        '00000026-3333-4000-8000-000000000001','00000026-2222-4000-8000-000000000001',
        '00000026-4444-4000-8000-000000000001','00000026-5555-4000-8000-000000000001',
        1200000,0.4000);

INSERT INTO core.rate_cards (id, tenant_id, version, status, effective_from)
VALUES ('00000026-7777-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
        'v1-2026','ACTIVE','2026-01-01');

-- `status` is gated: NULL -> DRAFT is ungated (011:1080), DRAFT -> APPLIED
-- needs QUOTATION_APPLY (011:1081).
INSERT INTO core.quotations (id, tenant_id, ref, proposal_id, rate_card_id, pax,
                             sell_price_sen, direct_cost_sen, programme_floor_price_sen, floor_margin_rate,
                             commission_rate, commission_payable_on)
VALUES ('00000026-8888-4000-8000-000000000001','00000026-1111-4000-8000-000000000001','QUO-T26-0001',
        '00000026-6666-4000-8000-000000000001','00000026-7777-4000-8000-000000000001',25,
        1200000, 700000, 900000, 0.3000, 0.0800, 'COLLECTION');
SELECT pg_temp.gate('00000026-1111-4000-8000-000000000001','QUOTATION_APPLY','00000026-8888-4000-8000-000000000001');
UPDATE core.quotations SET status = 'APPLIED' WHERE id = '00000026-8888-4000-8000-000000000001';
SELECT pg_temp.ungate();

INSERT INTO core.engagements (id, tenant_id, organisation_id, opportunity_id, proposal_id, programme_id,
                              owner_id, pipeline_id, title, value_sen, currency, starts_on, ends_on,
                              created_by_kind, created_by_id)
SELECT '00000026-9999-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
       '00000026-2222-4000-8000-000000000001','00000026-3333-4000-8000-000000000001',
       '00000026-6666-4000-8000-000000000001','00000026-5555-4000-8000-000000000001',
       '00000026-0000-4000-8000-0000000000a2', pipeline.id, 'Leading Teams for Chrome T26',
       1200000,'MYR','2026-06-01','2026-06-02','HUMAN','00000026-0000-4000-8000-0000000000a2'
  FROM core.pipelines AS pipeline
 WHERE pipeline.tenant_id = '00000026-1111-4000-8000-000000000001'
   AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default;

-- An invoice 34 days overdue: DRAFT -> SENT -> PARTIALLY_PAID, walked through
-- the same gate a real INVOICE_CREATE/INVOICE_PUSH/PAYMENT_RECORD applier uses
-- (test_010's own pattern). Outstanding after the payment: 550000 sen.
SELECT pg_temp.gate('00000026-1111-4000-8000-000000000001','INVOICE_CREATE','00000026-aaaa-4000-8000-000000000001');
INSERT INTO core.invoices (id, tenant_id, organisation_id, engagement_id, status, issued_at, due_at,
                           sst_rate, sst_reason)
VALUES ('00000026-aaaa-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
        '00000026-2222-4000-8000-000000000001','00000026-9999-4000-8000-000000000001',
        'DRAFT', now() - interval '40 days', current_date - 34, 0, 'TRAINING_EXEMPT');
SELECT pg_temp.ungate();

INSERT INTO core.invoice_lines (tenant_id, invoice_id, n, description, qty, unit_price_sen)
VALUES ('00000026-1111-4000-8000-000000000001','00000026-aaaa-4000-8000-000000000001',
        1,'Leading Teams for Chrome T26',1,1200000);

SELECT pg_temp.gate('00000026-1111-4000-8000-000000000001','INVOICE_PUSH','00000026-aaaa-4000-8000-000000000001');
UPDATE core.invoices SET status = 'SENT', sync_state = 'SENT', sync_provider = 'ACCOUNTING'
 WHERE id = '00000026-aaaa-4000-8000-000000000001';
SELECT pg_temp.ungate();

SELECT pg_temp.gate('00000026-1111-4000-8000-000000000001','PAYMENT_RECORD','00000026-aaaa-4000-8000-000000000001');
INSERT INTO core.payments (id, tenant_id, invoice_id, amount_sen, method, recorded_by_user_id)
VALUES ('00000026-bbbb-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
        '00000026-aaaa-4000-8000-000000000001', 650000, 'BANK_TRANSFER',
        '00000026-0000-4000-8000-0000000000a1');
SELECT pg_temp.ungate();

-- Not gated: `stage`/`next_action_*` are not in 011's gated-column list.
-- `stage` is gated too: NULL -> REMINDER_1 is the ungated birth default
-- (011:1144); REMINDER_1 -> REMINDER_2 needs REMINDER_SEND.
INSERT INTO core.collections_cases (id, tenant_id, invoice_id, organisation_id,
                                    next_action_at, next_action_type, next_action_status, autonomy)
VALUES ('00000026-cccc-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
        '00000026-aaaa-4000-8000-000000000001','00000026-2222-4000-8000-000000000001',
        now() + interval '1 day', 'REMINDER_SEND', 'DRAFT_READY', 'ACT_WITH_APPROVAL');
SELECT pg_temp.gate('00000026-1111-4000-8000-000000000001','REMINDER_SEND','00000026-cccc-4000-8000-000000000001');
UPDATE core.collections_cases SET stage = 'REMINDER_2', stage_entered_at = now() - interval '4 days'
 WHERE id = '00000026-cccc-4000-8000-000000000001';
SELECT pg_temp.ungate();

INSERT INTO core.message_rates (id, tenant_id, channel, category, rate_exact, effective_from,
                                fetched_at, source, stale_after)
VALUES ('00000026-dddd-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
        'WHATSAPP','UTILITY',0.056400,'2026-01-01', now(), 'BSP_API', now() + interval '1 day');

INSERT INTO core.outbound_messages (id, tenant_id, purpose, channel, template_id, category,
                                    contact_id, to_address, invoice_id, body, status,
                                    rate_per_message_sen, rate_per_message_exact, estimated_cost_sen,
                                    currency, message_rate_id)
VALUES ('00000026-eeee-4000-8000-000000000001','00000026-1111-4000-8000-000000000001',
        'REMINDER','WHATSAPP',NULL,'UTILITY',
        '00000026-2299-4000-8000-000000000001','+60123456789','00000026-aaaa-4000-8000-000000000001',
        'Hi Chrome, invoice QUO-T26-0001 is overdue. Please settle at your earliest.','DRAFT',
        6,0.056400,6,'MYR','00000026-dddd-4000-8000-000000000001');

-- ════════ T1 · the ladder and buckets are well-formed ════════
--
-- 026's own §1 backfill runs at MIGRATION APPLY TIME over `public.tenants` as
-- it stood then, not on a trigger — this pin's fixture tenant is created
-- AFTER 026 has already applied, so it carries none of 026's rows and the
-- fixture block above seeds it by hand with 026's own values (the same gap a
-- tenant provisioned tomorrow would have). That the backfill itself covers
-- every tenant THAT EXISTS WHEN 026 RUNS is asserted structurally inside the
-- migration ($verify$ V4) and re-checked here for shape, not re-derived.
DO $t1$
DECLARE v_buckets integer; v_stages integer; v_gaps integer;
BEGIN
  SELECT count(*) INTO v_buckets FROM core.aging_buckets WHERE tenant_id = '00000026-1111-4000-8000-000000000001';
  SELECT count(*) INTO v_stages  FROM core.collection_rules WHERE tenant_id = '00000026-1111-4000-8000-000000000001';
  ASSERT v_buckets = 4, format('T1a FAIL: %s aging buckets, expected 4', v_buckets);
  ASSERT v_stages  = 5, format('T1b FAIL: %s collection rules, expected 5', v_stages);

  -- The four buckets cover every non-negative day-count with no gap and no
  -- overlap (the GiST exclusion already refuses an overlap; this checks the
  -- other failure mode, a hole between two buckets).
  SELECT count(*) INTO v_gaps FROM generate_series(0, 200) AS d
   WHERE NOT EXISTS (
     SELECT 1 FROM core.aging_buckets b
      WHERE b.tenant_id = '00000026-1111-4000-8000-000000000001' AND b.days @> d);
  ASSERT v_gaps = 0, format('T1c FAIL: %s day-counts in 0..200 fall in no bucket', v_gaps);
  RAISE NOTICE 'T1 PASS - 4 aging buckets with no gap, 5 collection rules, matching 026''s own seed.';
END;
$t1$;

-- ════════ T2 · list_invoices / get_invoice as FINANCE ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000026-0000-4000-8000-0000000000a1','00000026-1111-4000-8000-000000000001','FINANCE'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t26.list_inv', pg_temp.try($$SELECT core.list_invoices()$$)::text, true);
SELECT pg_catalog.set_config('t26.get_inv',  pg_temp.try($$SELECT core.get_invoice('INV-2026-0001')$$)::text, true);
SELECT pg_catalog.set_config('t26.get_inv_404', pg_temp.try($$SELECT core.get_invoice('NOPE')$$)::text, true);
RESET ROLE;

DO $t2$
DECLARE v_list jsonb; v_get jsonb; v_404 jsonb; v_row jsonb;
BEGIN
  v_list := pg_temp.got('list_inv');
  v_get  := pg_temp.got('get_inv');
  v_404  := pg_temp.got('get_inv_404');
  ASSERT (v_list -> 'value' ->> 'success')::boolean, format('T2a FAIL: list_invoices refused: %s', v_list);
  ASSERT pg_catalog.jsonb_array_length(v_list -> 'value' -> 'data' -> 'data') = 1,
    format('T2b FAIL: expected 1 invoice, got %s', v_list -> 'value' -> 'data');
  v_row := (v_list -> 'value' -> 'data' -> 'data') -> 0;
  ASSERT v_row ->> 'status' = 'PARTIALLY_PAID', format('T2c FAIL: status %s', v_row ->> 'status');
  ASSERT (v_row -> 'outstanding' ->> 'amount')::bigint = 550000,
    format('T2d FAIL: outstanding %s, expected 550000', v_row -> 'outstanding');
  ASSERT (v_row -> 'total' ->> 'amount')::bigint = 1200000, 'T2e FAIL: total should be the one line, untaxed';
  ASSERT pg_catalog.jsonb_array_length(v_row -> 'payments') = 1, 'T2f FAIL: expected one payment in the array';
  ASSERT v_row ->> 'engagementRef' IS NOT NULL, 'T2g FAIL: engagementRef missing on a seeded invoice';

  ASSERT (v_get -> 'value' ->> 'success')::boolean, format('T2h FAIL: get_invoice by ref refused: %s', v_get);
  ASSERT (v_get -> 'value' -> 'data' ->> 'ref') = 'INV-2026-0001', 'T2i FAIL: get_invoice returned the wrong row';

  ASSERT (v_404 -> 'value' ->> 'success') = 'false', 'T2j FAIL: a made-up id should be refused';
  ASSERT (v_404 -> 'value' -> 'error' ->> 'code') = 'NOT_FOUND', format('T2k FAIL: code %s', v_404 -> 'value' -> 'error');
  RAISE NOTICE 'T2 PASS - list_invoices/get_invoice match the fixture, NOT_FOUND for a made-up id.';
END;
$t2$;

-- ════════ T3 · get_receivables_aging ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000026-0000-4000-8000-0000000000a1','00000026-1111-4000-8000-000000000001','FINANCE'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t26.aging', pg_temp.try($$SELECT core.get_receivables_aging()$$)::text, true);
RESET ROLE;

DO $t3$
DECLARE v jsonb; v_data jsonb;
BEGIN
  v := pg_temp.got('aging');
  ASSERT (v -> 'value' ->> 'success')::boolean, format('T3a FAIL: refused: %s', v);
  v_data := v -> 'value' -> 'data';
  -- 34 days overdue lands in d31_60 (the [31,61) bucket), not d1_30 or d60_plus.
  ASSERT (v_data -> 'd31_60' ->> 'amount')::bigint = 550000,
    format('T3b FAIL: d31_60 is %s, expected 550000', v_data -> 'd31_60');
  ASSERT (v_data -> 'current' ->> 'amount')::bigint = 0, 'T3c FAIL: current bucket should be empty';
  ASSERT pg_catalog.jsonb_typeof(v_data -> 'dsoDays') = 'number', 'T3d FAIL: dsoDays is not a number';
  RAISE NOTICE 'T3 PASS - the overdue balance lands in d31_60, dsoDays is numeric.';
END;
$t3$;

-- ════════ T4 · get_collections_queue ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000026-0000-4000-8000-0000000000a1','00000026-1111-4000-8000-000000000001','FINANCE'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t26.queue', pg_temp.try($$SELECT core.get_collections_queue()$$)::text, true);
RESET ROLE;

DO $t4$
DECLARE v jsonb; v_row jsonb;
BEGIN
  v := pg_temp.got('queue');
  ASSERT (v -> 'value' ->> 'success')::boolean, format('T4a FAIL: refused: %s', v);
  ASSERT pg_catalog.jsonb_array_length(v -> 'value' -> 'data' -> 'data') = 1, 'T4b FAIL: expected one case';
  v_row := (v -> 'value' -> 'data' -> 'data') -> 0;
  ASSERT (v_row ->> 'daysOverdue')::int = 34, format('T4c FAIL: daysOverdue %s, expected 34', v_row ->> 'daysOverdue');
  ASSERT v_row ->> 'stage' = 'REMINDER_2', 'T4d FAIL: stage mismatch';
  ASSERT (v_row -> 'nextAction' ->> 'status') = 'DRAFT_READY', 'T4e FAIL: nextAction.status mismatch';
  ASSERT ((v -> 'value' -> 'data' -> 'aging' -> 'd31_60') ->> 'amount')::bigint = 550000,
    'T4f FAIL: the embedded aging strip disagrees with T3';
  RAISE NOTICE 'T4 PASS - the queue carries the seeded case and an aging strip matching T3.';
END;
$t4$;

-- ════════ T5 · get_collection_draft, LIVE then CACHED (teeth-check) ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000026-0000-4000-8000-0000000000a1','00000026-1111-4000-8000-000000000001','FINANCE'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t26.draft_live', pg_temp.try($$SELECT core.get_collection_draft('INV-2026-0001')$$)::text, true);
RESET ROLE;

DO $t5a$
DECLARE v jsonb; v_data jsonb;
BEGIN
  v := pg_temp.got('draft_live');
  ASSERT (v -> 'value' ->> 'success')::boolean, format('T5a FAIL: refused: %s', v);
  v_data := v -> 'value' -> 'data';
  ASSERT v_data ->> 'rateSource' = 'LIVE', format('T5b FAIL: rateSource %s, expected LIVE', v_data ->> 'rateSource');
  ASSERT (v_data -> 'ratePerMessage' ->> 'amount')::bigint = 6, 'T5c FAIL: ratePerMessage should be 6 sen';
  ASSERT (v_data -> 'consent' ->> 'granted')::boolean, 'T5d FAIL: consent should read granted';
  RAISE NOTICE 'T5a-d PASS - LIVE with the seeded rate, consent reads granted.';
END;
$t5a$;

-- TEETH-CHECK: expire the rate. The SAME probe must now answer CACHED, not a
-- silently-still-LIVE stale number.
UPDATE core.message_rates SET stale_after = now() - interval '1 hour'
 WHERE id = '00000026-dddd-4000-8000-000000000001';

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000026-0000-4000-8000-0000000000a1','00000026-1111-4000-8000-000000000001','FINANCE'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t26.draft_cached', pg_temp.try($$SELECT core.get_collection_draft('INV-2026-0001')$$)::text, true);
RESET ROLE;

DO $t5b$
DECLARE v_data jsonb;
BEGIN
  v_data := pg_temp.got('draft_cached') -> 'value' -> 'data';
  ASSERT v_data ->> 'rateSource' = 'CACHED',
    format('T5e FAIL: rateSource %s after stale_after moved to the past, expected CACHED', v_data ->> 'rateSource');
  ASSERT v_data ? 'rateFetchedAt', 'T5f FAIL: rateFetchedAt missing on a CACHED draft';
  RAISE NOTICE 'T5e-f PASS - an expired rate answers CACHED with rateFetchedAt, not a silent LIVE.';
END;
$t5b$;
UPDATE core.message_rates SET stale_after = now() + interval '1 day'
 WHERE id = '00000026-dddd-4000-8000-000000000001';

-- ════════ T6 · list_commissions ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000026-0000-4000-8000-0000000000a1','00000026-1111-4000-8000-000000000001','FINANCE'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t26.commissions', pg_temp.try($$SELECT core.list_commissions()$$)::text, true);
RESET ROLE;

DO $t6$
DECLARE v jsonb; v_row jsonb;
BEGIN
  v := pg_temp.got('commissions');
  ASSERT (v -> 'value' ->> 'success')::boolean, format('T6a FAIL: refused: %s', v);
  ASSERT pg_catalog.jsonb_array_length(v -> 'value' -> 'data' -> 'data') = 1, 'T6b FAIL: expected one commission row';
  v_row := (v -> 'value' -> 'data' -> 'data') -> 0;
  ASSERT v_row ->> 'rateBasis' = 'QUOTATION', 'T6c FAIL: the quotation carries its own commission_rate';
  ASSERT (v_row ->> 'rate')::numeric = 0.0800, format('T6d FAIL: rate %s, expected 0.0800', v_row ->> 'rate');
  -- dealValue 1,200,000 sen x 0.08 = 96,000 sen.
  ASSERT (v_row -> 'amount' ->> 'amount')::bigint = 96000,
    format('T6e FAIL: amount %s, expected 96000', v_row -> 'amount');
  -- Invoiced (SENT/PARTIALLY_PAID), not yet collected, no trading hold: ACCRUED.
  ASSERT v_row ->> 'status' = 'ACCRUED', format('T6f FAIL: status %s, expected ACCRUED', v_row ->> 'status');
  ASSERT v_row ->> 'invoiceRef' = 'INV-2026-0001', 'T6g FAIL: invoiceRef mismatch';
  RAISE NOTICE 'T6 PASS - one QUOTATION-basis commission at 96000 sen, ACCRUED.';
END;
$t6$;

-- ── T6 sort/total fixtures: two more commission-eligible deals on the same
-- organisation, each with its own QUOTATION-basis rate so the three
-- commission amounts (50000 / 96000 / 100000 sen) are distinct and their
-- order is known ahead of the probe below. Added AFTER T6's own assertion
-- (which expects exactly one row) runs, so T6 is unaffected.
INSERT INTO core.proposals (id, tenant_id, ref, opportunity_id, organisation_id, template_id, programme_id,
                            value_sen, margin_rate)
VALUES
  ('00000026-6666-4000-8000-000000000002','00000026-1111-4000-8000-000000000001','PRO-T26-0002',
   '00000026-3333-4000-8000-000000000001','00000026-2222-4000-8000-000000000001',
   '00000026-4444-4000-8000-000000000001','00000026-5555-4000-8000-000000000001',2000000,0.4000),
  ('00000026-6666-4000-8000-000000000003','00000026-1111-4000-8000-000000000001','PRO-T26-0003',
   '00000026-3333-4000-8000-000000000001','00000026-2222-4000-8000-000000000001',
   '00000026-4444-4000-8000-000000000001','00000026-5555-4000-8000-000000000001',500000,0.4000);

-- Deal 2: 2,000,000 sen x 0.0500 = 100,000 sen commission (the highest).
INSERT INTO core.quotations (id, tenant_id, ref, proposal_id, rate_card_id, pax,
                             sell_price_sen, direct_cost_sen, programme_floor_price_sen, floor_margin_rate,
                             commission_rate, commission_payable_on)
VALUES ('00000026-8888-4000-8000-000000000002','00000026-1111-4000-8000-000000000001','QUO-T26-0002',
        '00000026-6666-4000-8000-000000000002','00000026-7777-4000-8000-000000000001',20,
        2000000, 1200000, 900000, 0.3000, 0.0500, 'COLLECTION');
SELECT pg_temp.gate('00000026-1111-4000-8000-000000000001','QUOTATION_APPLY','00000026-8888-4000-8000-000000000002');
UPDATE core.quotations SET status = 'APPLIED' WHERE id = '00000026-8888-4000-8000-000000000002';
SELECT pg_temp.ungate();

-- Deal 3: 500,000 sen x 0.1000 = 50,000 sen commission (the lowest).
INSERT INTO core.quotations (id, tenant_id, ref, proposal_id, rate_card_id, pax,
                             sell_price_sen, direct_cost_sen, programme_floor_price_sen, floor_margin_rate,
                             commission_rate, commission_payable_on)
VALUES ('00000026-8888-4000-8000-000000000003','00000026-1111-4000-8000-000000000001','QUO-T26-0003',
        '00000026-6666-4000-8000-000000000003','00000026-7777-4000-8000-000000000001',10,
        500000, 300000, 900000, 0.3000, 0.1000, 'COLLECTION');
SELECT pg_temp.gate('00000026-1111-4000-8000-000000000001','QUOTATION_APPLY','00000026-8888-4000-8000-000000000003');
UPDATE core.quotations SET status = 'APPLIED' WHERE id = '00000026-8888-4000-8000-000000000003';
SELECT pg_temp.ungate();

INSERT INTO core.engagements (id, tenant_id, organisation_id, opportunity_id, proposal_id, programme_id,
                              owner_id, pipeline_id, title, value_sen, currency, starts_on, ends_on,
                              created_by_kind, created_by_id)
SELECT '00000026-9999-4000-8000-000000000002','00000026-1111-4000-8000-000000000001',
       '00000026-2222-4000-8000-000000000001','00000026-3333-4000-8000-000000000001',
       '00000026-6666-4000-8000-000000000002','00000026-5555-4000-8000-000000000001',
       '00000026-0000-4000-8000-0000000000a2', pipeline.id, 'Deal Two for Chrome T26',
       2000000,'MYR','2026-07-01','2026-07-02','HUMAN','00000026-0000-4000-8000-0000000000a2'
  FROM core.pipelines AS pipeline
 WHERE pipeline.tenant_id = '00000026-1111-4000-8000-000000000001'
   AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default;

INSERT INTO core.engagements (id, tenant_id, organisation_id, opportunity_id, proposal_id, programme_id,
                              owner_id, pipeline_id, title, value_sen, currency, starts_on, ends_on,
                              created_by_kind, created_by_id)
SELECT '00000026-9999-4000-8000-000000000003','00000026-1111-4000-8000-000000000001',
       '00000026-2222-4000-8000-000000000001','00000026-3333-4000-8000-000000000001',
       '00000026-6666-4000-8000-000000000003','00000026-5555-4000-8000-000000000001',
       '00000026-0000-4000-8000-0000000000a2', pipeline.id, 'Deal Three for Chrome T26',
       500000,'MYR','2026-08-01','2026-08-02','HUMAN','00000026-0000-4000-8000-0000000000a2'
  FROM core.pipelines AS pipeline
 WHERE pipeline.tenant_id = '00000026-1111-4000-8000-000000000001'
   AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default;

-- ════════ T6b · list_commissions honours p_sort, page.total is unbounded ═════
--
-- Three commission-eligible deals now exist: 50000 / 96000 / 100000 sen.
-- p_page.size := 2 with p_sort := 'amount' must return the two SMALLEST
-- (ascending) with page.total counting all 3, not just the 2 returned; with
-- p_sort := '-amount' the two LARGEST (descending), same total.

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000026-0000-4000-8000-0000000000a1','00000026-1111-4000-8000-000000000001','FINANCE'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t26.comm_asc',
  pg_temp.try($$SELECT core.list_commissions('[]'::jsonb, 'amount', '{"size":2}'::jsonb)$$)::text, true);
SELECT pg_catalog.set_config('t26.comm_desc',
  pg_temp.try($$SELECT core.list_commissions('[]'::jsonb, '-amount', '{"size":2}'::jsonb)$$)::text, true);
RESET ROLE;

DO $t6b$
DECLARE v_asc jsonb; v_desc jsonb; v_rows jsonb;
BEGIN
  v_asc := pg_temp.got('comm_asc');
  ASSERT (v_asc -> 'value' ->> 'success')::boolean, format('T6b-asc FAIL: refused: %s', v_asc);
  v_rows := v_asc -> 'value' -> 'data' -> 'data';
  ASSERT pg_catalog.jsonb_array_length(v_rows) = 2,
    format('T6b-asc FAIL: expected 2 rows on a size-2 page, got %s', v_rows);
  ASSERT (v_rows -> 0 -> 'amount' ->> 'amount')::bigint = 50000
     AND (v_rows -> 1 -> 'amount' ->> 'amount')::bigint = 96000,
    format('T6b-asc FAIL: expected [50000, 96000] ascending, got %s', v_rows);
  ASSERT (v_asc -> 'value' -> 'data' -> 'page' ->> 'total')::integer = 3,
    format('T6b-asc FAIL: page.total should be the unbounded count 3, got %s',
      v_asc -> 'value' -> 'data' -> 'page');

  v_desc := pg_temp.got('comm_desc');
  ASSERT (v_desc -> 'value' ->> 'success')::boolean, format('T6b-desc FAIL: refused: %s', v_desc);
  v_rows := v_desc -> 'value' -> 'data' -> 'data';
  ASSERT pg_catalog.jsonb_array_length(v_rows) = 2,
    format('T6b-desc FAIL: expected 2 rows on a size-2 page, got %s', v_rows);
  ASSERT (v_rows -> 0 -> 'amount' ->> 'amount')::bigint = 100000
     AND (v_rows -> 1 -> 'amount' ->> 'amount')::bigint = 96000,
    format('T6b-desc FAIL: expected [100000, 96000] descending, got %s', v_rows);
  ASSERT (v_desc -> 'value' -> 'data' -> 'page' ->> 'total')::integer = 3,
    format('T6b-desc FAIL: page.total should be the unbounded count 3, got %s',
      v_desc -> 'value' -> 'data' -> 'page');
  RAISE NOTICE 'T6b PASS - p_sort is honoured both directions, page.total is the unbounded count of 3.';
END;
$t6b$;

-- ════════ T7 · authorization ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000026-0000-4000-8000-0000000000a3','00000026-1111-4000-8000-000000000001','OPS'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t26.tr_inv',   pg_temp.try($$SELECT core.list_invoices()$$)::text, true);
SELECT pg_catalog.set_config('t26.tr_get',   pg_temp.try($$SELECT core.get_invoice('INV-2026-0001')$$)::text, true);
SELECT pg_catalog.set_config('t26.tr_aging', pg_temp.try($$SELECT core.get_receivables_aging()$$)::text, true);
SELECT pg_catalog.set_config('t26.tr_queue', pg_temp.try($$SELECT core.get_collections_queue()$$)::text, true);
SELECT pg_catalog.set_config('t26.tr_draft', pg_temp.try($$SELECT core.get_collection_draft('INV-2026-0001')$$)::text, true);
SELECT pg_catalog.set_config('t26.tr_comm',  pg_temp.try($$SELECT core.list_commissions()$$)::text, true);
RESET ROLE;

DO $t7$
DECLARE v jsonb;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    pg_temp.got('tr_inv'), pg_temp.got('tr_get'), pg_temp.got('tr_aging'),
    pg_temp.got('tr_queue'), pg_temp.got('tr_draft'), pg_temp.got('tr_comm')]
  LOOP
    ASSERT (v -> 'value' ->> 'success') = 'false', format('T7a FAIL: OPS was not refused: %s', v);
    ASSERT (v -> 'value' -> 'error' ->> 'code') = 'FORBIDDEN', format('T7b FAIL: wrong code: %s', v -> 'value' -> 'error');
    ASSERT (v -> 'value' -> 'error' -> 'details' ? 'requiredPermission'),
      format('T7c FAIL: no requiredPermission on the refusal: %s', v);
  END LOOP;
  RAISE NOTICE 'T7a-c PASS - OPS is FORBIDDEN on all six, each naming its requiredPermission.';
END;
$t7$;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('t26.anon', pg_temp.try($$SELECT core.list_invoices()$$)::text, true);
RESET ROLE;

DO $t7d$
DECLARE v jsonb;
BEGIN
  v := pg_temp.got('anon');
  ASSERT NOT (v -> 'value' ->> 'ok')::boolean IS TRUE, 'T7d FAIL: anon should not reach a value at all';
  ASSERT (v ->> 'ok') = 'false' AND (v ->> 'sqlstate') = '42501',
    format('T7d FAIL: expected 42501 for anon, got %s', v);
  RAISE NOTICE 'T7d PASS - anon is refused 42501 on the RPC call itself.';
END;
$t7d$;

-- ════════ T8 · tenant isolation ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000026-0000-4000-8000-0000000000b1','00000026-1111-4000-8000-000000000002','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t26.b_inv',  pg_temp.try($$SELECT core.list_invoices()$$)::text, true);
SELECT pg_catalog.set_config('t26.b_get',  pg_temp.try($$SELECT core.get_invoice('INV-2026-0001')$$)::text, true);
SELECT pg_catalog.set_config('t26.b_comm', pg_temp.try($$SELECT core.list_commissions()$$)::text, true);
RESET ROLE;

DO $t8$
DECLARE v_inv jsonb; v_get jsonb; v_comm jsonb;
BEGIN
  v_inv  := pg_temp.got('b_inv');
  v_get  := pg_temp.got('b_get');
  v_comm := pg_temp.got('b_comm');
  ASSERT (v_inv -> 'value' ->> 'success')::boolean
     AND pg_catalog.jsonb_array_length(v_inv -> 'value' -> 'data' -> 'data') = 0,
    format('T8a FAIL: another tenant''s MD sees invoices: %s', v_inv);
  ASSERT (v_get -> 'value' ->> 'success') = 'false'
     AND (v_get -> 'value' -> 'error' ->> 'code') = 'NOT_FOUND',
    format('T8b FAIL: cross-tenant get_invoice should be NOT_FOUND, not an existence leak: %s', v_get);
  ASSERT (v_comm -> 'value' ->> 'success')::boolean
     AND pg_catalog.jsonb_array_length(v_comm -> 'value' -> 'data' -> 'data') = 0,
    format('T8c FAIL: another tenant''s MD sees commissions: %s', v_comm);
  RAISE NOTICE 'T8 PASS - another tenant sees zero rows and NOT_FOUND, never a cross-tenant leak.';
END;
$t8$;

ROLLBACK;
