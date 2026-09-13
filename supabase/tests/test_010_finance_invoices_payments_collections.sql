-- ============================================================================
-- PIN 010 · finance_invoices_payments_collections
-- ============================================================================
--
-- Run only AFTER 010. Ends in ROLLBACK.
--   psql "$DATABASE_URL" -f supabase/tests/test_010_finance_invoices_payments_collections.sql
--
-- WHAT THIS PIN IS FOR. This migration is where an arithmetic mistake becomes a
-- filed tax document, so nothing here asserts the DDL back at itself. Every test
-- writes rows and reads what the database did with them.
--
--   T2  TOTAL-FROM-LINES with SST on the summed net, using figures where
--       per-line SST and summed-net SST give DIFFERENT answers. Three lines at
--       RM 333.33 with 8% SST: per line that is 26.6664 -> 26.67 each -> 80.01
--       sen of SST; on the summed net (99,999 sen) it is 7,999.92 -> 8,000. One
--       sen apart, and the one-sen difference is the whole reason doc 04 §1.6
--       says SST is computed on the summed net.
--   T3  The reconciliation trigger REFUSES a header that disagrees with its
--       lines, and the refusal arrives at COMMIT because the trigger is
--       DEFERRABLE — forced with SET CONSTRAINTS ... IMMEDIATE inside a
--       savepoint, the way test_007 T5 does it.
--   T4  outstanding_sen and status track payments, including the case that
--       matters: a REVERSAL puts the money back. A system that lets a
--       correction be entered as an ordinary payment loses it into the total.
--   T5  A payment cannot be UPDATEd or DELETEd. Append-only, enforced.
--   T6  A downstream-VALIDATED invoice is frozen against edits to the figures.
--   T7  THE 72-HOUR WINDOW. Cancel at 71 hours: allowed. Cancel at 73: refused.
--       This is a statutory deadline, so it is proved at both sides of the
--       boundary rather than asserted once in the middle.
--   T8  The cancellation deadline CANNOT be extended by supplying a value. This
--       is the test that earns back what was lost when PostgreSQL refused the
--       generated column (timestamptz + interval is STABLE, not IMMUTABLE).
--   T9  Overlapping aging buckets are unrepresentable — doc 04 §7's [25,40).
--   T10 The ladder resolves 34 days -> REMINDER_2 (the contract's INV-2026-0288
--       fixture) and 80 -> TRADING_HOLD, against real rows rather than prose.
--   T11 REMINDER_3 cannot be AUTONOMOUS and a TRADING_HOLD needs MD.
--   T12 A credit note cannot exceed the invoice it credits.
--   T13 e-invoice mirror integrity: VALID without identifiers is refused,
--       INVALID without structured errors is refused, and a validation-errors
--       blob with no `errors` key is refused (ruling R-JSONB).
--
-- RUNNABILITY NOTES
-- 1. Runs as the migration role. RLS is forced with no policies until 014, so a
--    role-swapped SELECT would fail with "permission denied" and the assertion
--    would never reach its subject. No role swapping here.
-- 2. auth.users rows are inserted for real: owner_id and recorded_by_user_id are
--    foreign keys to it, and an RPC writing auth.uid() fails on the FK without a
--    real row.
-- 3. Fixture ids namespaced `00000010-`.
-- 4. It ends in ROLLBACK. No fixture survives.
-- ============================================================================

BEGIN;

-- ── GOV-07 fixture helper (added 2026-09-13, when 011 landed) ───────────────
-- Migration 011 attaches app.enforce_state_transition to every gated column in
-- doc 01 §5.3. A gated edge may be crossed only by the effect applier of an
-- action of a gating type, running against THAT row: 011 closed critic finding
-- H-07 by checking the request's status, its target_id and its tenant, so a
-- fixture that sets only the GUC is still refused, and correctly.
--
-- This helper does what the product's executor does — it creates the action
-- request and publishes it as the applier — so the fixture crosses the edge the
-- way a real caller does instead of going around the control it is sitting
-- next to. It lives in pg_temp and the pin's closing ROLLBACK removes it.
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

-- Clear the applier. Every gated write is bracketed, so a later assertion that
-- a gated edge is REFUSED cannot pass by accident on a stale applier.
CREATE FUNCTION pg_temp.ungate() RETURNS void LANGUAGE plpgsql AS $ungate$
BEGIN
  PERFORM set_config('app.effect_applier', '', true);
END $ungate$;


SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_010 SETUP FAILURE: check_asserts is OFF, so every ASSERT '
                    'below is a no-op and this pin proves nothing.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF to_regclass('core.invoices') IS NULL OR to_regclass('core.collections_cases') IS NULL THEN
    RAISE EXCEPTION 'test_010 SETUP FAILURE: 010 is missing or partial.';
  END IF;
END;
$setup$;

-- ─── Fixtures ───────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('00000010-0000-0000-0000-0000000000a1','t010-finance@example.invalid');
INSERT INTO public.tenants (id, slug, name) VALUES
  ('00000010-1111-1111-1111-111111111111','t010-alpha','Alpha');
INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width) VALUES
  ('00000010-1111-1111-1111-111111111111','ORG','organisations',false,4),
  ('00000010-1111-1111-1111-111111111111','INV','invoices',true,4),
  ('00000010-1111-1111-1111-111111111111','PAY','payments',true,4),
  ('00000010-1111-1111-1111-111111111111','CRN','credit_notes',true,4),
  ('00000010-1111-1111-1111-111111111111','COL','collections_cases',false,4),
  ('00000010-1111-1111-1111-111111111111','ACT','action_requests',false,4);
-- ACT is the action-envelope ref prefix. 011 gives core.action_requests a
-- ref through app.finalise_table, so any fixture that crosses a GATED edge
-- must be able to allocate one. In the product these rows come from 016's
-- tenant provisioning; no migration seeds them.

INSERT INTO core.organisations (id, tenant_id, name, owner_id,
                                tax_identifier_kind, tax_identifier, tin,
                                address_line1, city, state_code, postcode)
VALUES ('00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000010-1111-1111-1111-111111111111',
        'Aurora Manufacturing Sdn Bhd','00000010-0000-0000-0000-0000000000a1',
        'BRN','201901234567','C12345678901',
        'Lot 5, Jalan Perusahaan','Shah Alam','10','40150');

INSERT INTO core.tenant_tax_profiles
  (tenant_id, legal_name, tin, registration_no, sst_registration_no, msic_code,
   address_line1, city, state_code, postcode)
VALUES ('00000010-1111-1111-1111-111111111111','TrainOS Sdn Bhd','C98765432101',
        '202001234567','W10-1808-31000123','85499',
        'Level 8, Menara Satu','Kuala Lumpur','14','50450');

-- === T1 · the supplier and buyer identities C-11 said had nowhere to live ====
DO $t1$
DECLARE v_tin text; v_kind core.tax_identifier_kind;
BEGIN
  SELECT tin INTO v_tin FROM core.tenant_tax_profiles
   WHERE tenant_id = '00000010-1111-1111-1111-111111111111';
  ASSERT v_tin = 'C98765432101', 'T1a FAIL: supplier TIN did not store';

  SELECT tax_identifier_kind INTO v_kind FROM core.organisations
   WHERE id = '00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  ASSERT v_kind = 'BRN',
    'T1b FAIL: buyer identifier KIND did not store - the same digits mean '
    'different things under BRN and NRIC, so the kind is not optional';

  -- The pairing is constrained. An identifier with no kind is unusable.
  BEGIN
    UPDATE core.organisations SET tax_identifier_kind = NULL
     WHERE id = '00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
    ASSERT false, 'T1c FAIL: a tax identifier with no kind was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T1 PASS - supplier and buyer fiscal identity stored and paired.';
END;
$t1$;

-- === T2 · SST on the SUMMED NET, where per-line would give a different answer =
--     Three lines at RM 333.33. Per line: 33333 x 0.08 = 2666.64 -> 2667 each,
--     x3 = 8001. On the summed net: 99999 x 0.08 = 7999.92 -> 8000. One sen.
-- (new) -> DRAFT on core.invoices is gated by INVOICE_CREATE, and DRAFT -> SENT
-- by INVOICE_PUSH (doc 01 §5.3, seeded by 011). An invoice is therefore not
-- insertable at all without an action behind it, which is the design: the ref
-- prefix INV is the one finance was consulted about, and a burnt number with no
-- action to explain it is the gap H-24 is about. app.resolve_action_target_id
-- reads INVOICE_CREATE's target from the PAYLOAD for exactly this reason -- the
-- caller pre-generates the id -- so these fixtures do the same.
SELECT pg_temp.gate('00000010-1111-1111-1111-111111111111','INVOICE_CREATE','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
INSERT INTO core.invoices (id, tenant_id, organisation_id, status, issued_at, due_at,
                           sst_rate, sst_reason)
VALUES ('00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000010-1111-1111-1111-111111111111',
        '00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1','DRAFT', now(), current_date + 30,
        0.0800,'STANDARD_RATED');
SELECT pg_temp.ungate();

INSERT INTO core.invoice_lines (tenant_id, invoice_id, n, description, qty, unit_price_sen)
VALUES ('00000010-1111-1111-1111-111111111111','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
        1,'Facilitation day 1',1,33333),
       ('00000010-1111-1111-1111-111111111111','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
        2,'Facilitation day 2',1,33333),
       ('00000010-1111-1111-1111-111111111111','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
        3,'Materials',1,33333);

DO $t2$
DECLARE v record;
BEGIN
  SELECT subtotal_sen, sst_sen, total_sen, outstanding_sen INTO v
    FROM core.invoices WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1';

  ASSERT v.subtotal_sen = 99999,
    format('T2a FAIL: subtotal is %s, expected 99999 (three rounded lines)', v.subtotal_sen);
  ASSERT v.sst_sen = 8000,
    format('T2b FAIL: SST is %s, expected 8000. 8001 means SST was computed PER '
           'LINE and summed, which doc 04 §1.6 rules out - the summed net is the '
           'base, and the two answers differ by exactly one sen here', v.sst_sen);
  ASSERT v.total_sen = 107999,
    format('T2c FAIL: total is %s, expected 107999', v.total_sen);
  RAISE NOTICE 'T2 PASS - subtotal 99999, SST 8000 on the summed net, total 107999.';
END;
$t2$;

-- === T3 · a header that disagrees with its lines cannot COMMIT ===============
DO $t3$
DECLARE v_raised boolean := false;
BEGIN
  BEGIN
    -- The trigger is DEFERRABLE INITIALLY DEFERRED, so a deliberate mismatch
    -- raises at COMMIT. Forced IMMEDIATE inside a savepoint, because catching it
    -- at the end of the whole pin would abort every later test.
    UPDATE core.invoices SET subtotal_sen = 1
     WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
    SET CONSTRAINTS core.trg_invoice_reconciled IMMEDIATE;
    ASSERT false, 'T3 FAIL: a header of 1 sen against lines of 99999 was accepted';
  EXCEPTION
    WHEN integrity_constraint_violation THEN v_raised := true;
  END;
  ASSERT v_raised, 'T3 FAIL: no TOTAL_NOT_RECONCILED was raised';
  RAISE NOTICE 'T3 PASS - TOTAL_NOT_RECONCILED refuses a header that disagrees with its lines.';
END;
$t3$;

-- The savepoint-less EXCEPTION above rolled the UPDATE back; re-assert the row.
DO $t3b$
DECLARE v_sub bigint;
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  SELECT subtotal_sen INTO v_sub FROM core.invoices
   WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  ASSERT v_sub = 99999,
    format('T3b FAIL: after the refused write the header reads %s, not 99999', v_sub);
  RAISE NOTICE 'T3b PASS - the refused write left the header intact.';
END;
$t3b$;

-- === T4 · payments, and the reversal that puts the money back ================
SELECT pg_temp.gate('00000010-1111-1111-1111-111111111111','INVOICE_PUSH','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
UPDATE core.invoices SET status = 'SENT'        -- DRAFT -> SENT
 WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
SELECT pg_temp.ungate();

-- Recording a payment moves the INVOICE's status through core.payment_apply,
-- and SENT -> PARTIALLY_PAID is gated by PAYMENT_RECORD. The gate therefore
-- applies to the payment INSERT even though the payment table is not itself
-- gated, which is right: the money is what moves the invoice.
SELECT pg_temp.gate('00000010-1111-1111-1111-111111111111','PAYMENT_RECORD','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
INSERT INTO core.payments (id, tenant_id, invoice_id, amount_sen, method,
                           recorded_by_user_id)
VALUES ('00000010-cccc-cccc-cccc-ccccccccccc1','00000010-1111-1111-1111-111111111111',
        '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 50000,'BANK_TRANSFER',
        '00000010-0000-0000-0000-0000000000a1');
SELECT pg_temp.ungate();

DO $t4a$
DECLARE v record;
BEGIN
  SELECT outstanding_sen, status INTO v FROM core.invoices
   WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  ASSERT v.outstanding_sen = 57999,
    format('T4a FAIL: outstanding is %s, expected 57999', v.outstanding_sen);
  ASSERT v.status = 'PARTIALLY_PAID',
    format('T4a FAIL: status is %s, expected PARTIALLY_PAID', v.status);
  RAISE NOTICE 'T4a PASS - a part payment moves outstanding and status together.';
END;
$t4a$;

SELECT pg_temp.gate('00000010-1111-1111-1111-111111111111','PAYMENT_RECORD','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
INSERT INTO core.payments (tenant_id, invoice_id, amount_sen, method,
                           recorded_by_user_id, is_reversal, reverses_payment_id,
                           reversal_reason)
VALUES ('00000010-1111-1111-1111-111111111111','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
        50000,'BANK_TRANSFER','00000010-0000-0000-0000-0000000000a1',
        true,'00000010-cccc-cccc-cccc-ccccccccccc1','Cheque returned unpaid');
SELECT pg_temp.ungate();

DO $t4b$
DECLARE v record;
BEGIN
  SELECT outstanding_sen, status INTO v FROM core.invoices
   WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  ASSERT v.outstanding_sen = 107999,
    format('T4b FAIL: after a full reversal outstanding is %s, expected 107999. A '
           'reversal that does not put the money back is money the business '
           'thinks it has', v.outstanding_sen);
  RAISE NOTICE 'T4b PASS - a reversal restores the outstanding balance in full.';
END;
$t4b$;

-- === T5 · payments are append-only ==========================================
DO $t5$
DECLARE v_up boolean := false; v_del boolean := false;
BEGIN
  BEGIN
    UPDATE core.payments SET amount_sen = 1
     WHERE id = '00000010-cccc-cccc-cccc-ccccccccccc1';
  EXCEPTION WHEN integrity_constraint_violation THEN v_up := true;
  END;
  ASSERT v_up, 'T5a FAIL: a payment was UPDATEd; corrections must be reversal rows';

  BEGIN
    DELETE FROM core.payments WHERE id = '00000010-cccc-cccc-cccc-ccccccccccc1';
  EXCEPTION WHEN integrity_constraint_violation THEN v_del := true;
  END;
  ASSERT v_del, 'T5b FAIL: a payment was DELETEd';
  RAISE NOTICE 'T5 PASS - payments refuse UPDATE and DELETE.';
END;
$t5$;

-- === T6/T7/T8 · the validated invoice, and the 72-hour window ================
SELECT pg_temp.gate('00000010-1111-1111-1111-111111111111','INVOICE_CREATE','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb2');
INSERT INTO core.invoices (id, tenant_id, organisation_id, status, issued_at, due_at,
                           einvoice_status, einvoice_uuid, einvoice_long_id,
                           einvoice_validated_at)
VALUES ('00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb2','00000010-1111-1111-1111-111111111111',
        '00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1','DRAFT', now(), current_date + 30,
        'VALID','F9D3-UUID-0001','LONGID0001', now() - interval '71 hours');

DO $t6$
DECLARE v_frozen boolean := false;
BEGIN
  BEGIN
    UPDATE core.invoices SET terms_days = 60
     WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  EXCEPTION WHEN integrity_constraint_violation THEN v_frozen := true;
  END;
  ASSERT v_frozen,
    'T6 FAIL: a downstream-VALIDATED invoice accepted an edit to its figures. A '
    'validated tax invoice is a filed document; editing one produces a second '
    'document that disagrees with the filed one';
  RAISE NOTICE 'T6 PASS - a validated invoice is frozen against figure edits.';
END;
$t6$;

-- T8 first, because it reads the row T7 is about to cancel.
DO $t8$
DECLARE v_deadline timestamptz; v_validated timestamptz;
BEGIN
  -- Try to buy another week. The trigger overwrites it unconditionally.
  UPDATE core.invoices
     SET einvoice_cancel_deadline_at = now() + interval '7 days'
   WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

  SELECT einvoice_cancel_deadline_at, einvoice_validated_at
    INTO v_deadline, v_validated
    FROM core.invoices WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

  ASSERT v_deadline = v_validated + interval '72 hours',
    format('T8 FAIL: the cancellation deadline was extended to %s. It must be '
           'validated_at + 72h (%s) whatever the caller supplied - this is the '
           'guarantee that was lost when PostgreSQL refused the generated column, '
           'and it is bought back by the trigger', v_deadline,
           v_validated + interval '72 hours');
  RAISE NOTICE 'T8 PASS - the 72-hour deadline cannot be extended by writing to it.';
END;
$t8$;

DO $t7a$
BEGIN
  -- 71 hours in: inside the window, so a cancellation with a reason is allowed.
  UPDATE core.invoices
     SET einvoice_status = 'CANCELLED', void_reason = 'Wrong buyer TIN'
   WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  RAISE NOTICE 'T7a PASS - cancellation at 71 hours is allowed.';
END;
$t7a$;

SELECT pg_temp.gate('00000010-1111-1111-1111-111111111111','INVOICE_CREATE','00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb3');
INSERT INTO core.invoices (id, tenant_id, organisation_id, status, issued_at, due_at,
                           einvoice_status, einvoice_uuid, einvoice_long_id,
                           einvoice_validated_at)
VALUES ('00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb3','00000010-1111-1111-1111-111111111111',
        '00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1','DRAFT', now(), current_date + 30,
        'VALID','F9D3-UUID-0002','LONGID0002', now() - interval '73 hours');

DO $t7b$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    UPDATE core.invoices
       SET einvoice_status = 'CANCELLED', void_reason = 'Too late'
     WHERE id = '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  EXCEPTION WHEN integrity_constraint_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T7b FAIL: a cancellation 73 hours after validation was accepted. The window '
    'is statutory; past it the exit is a credit note, which leaves the filed '
    'document standing';
  RAISE NOTICE 'T7b PASS - cancellation at 73 hours is refused.';
END;
$t7b$;

-- === T9 · overlapping aging buckets are unrepresentable ======================
INSERT INTO core.aging_buckets (tenant_id, code, label, days, sort) VALUES
  ('00000010-1111-1111-1111-111111111111','current','Current','(,1)',1),
  ('00000010-1111-1111-1111-111111111111','d1_30','1-30 days','[1,31)',2),
  ('00000010-1111-1111-1111-111111111111','d31_60','31-60 days','[31,61)',3),
  ('00000010-1111-1111-1111-111111111111','d60_plus','60+ days','[61,)',4);

DO $t9$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO core.aging_buckets (tenant_id, code, label, days, sort)
    VALUES ('00000010-1111-1111-1111-111111111111','sneaky','25-40','[25,40)',5);
  EXCEPTION WHEN exclusion_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T9 FAIL: an overlapping bucket [25,40) was accepted. Overlapping buckets '
    'double-count an invoice, and nothing downstream would report a total that '
    'was too high as an error';
  RAISE NOTICE 'T9 PASS - overlapping aging buckets are refused by the GiST exclusion.';
END;
$t9$;

-- === T10/T11 · the ladder =====================================================
INSERT INTO core.collection_rules (tenant_id, stage, trigger_days_overdue, channel, autonomy, requires_role) VALUES
  ('00000010-1111-1111-1111-111111111111','REMINDER_1',  7,'EMAIL',   'SUGGEST',           NULL),
  ('00000010-1111-1111-1111-111111111111','REMINDER_2', 30,'EMAIL',   'ACT_WITH_APPROVAL', NULL),
  ('00000010-1111-1111-1111-111111111111','REMINDER_3', 45,'WHATSAPP','ACT_WITH_APPROVAL', NULL),
  ('00000010-1111-1111-1111-111111111111','HUMAN_CALL', 60,'PHONE',   'OBSERVE',           'FINANCE'),
  ('00000010-1111-1111-1111-111111111111','TRADING_HOLD',75,'EMAIL',  'ACT_WITH_APPROVAL', 'MD');

DO $t10$
DECLARE v core.collection_stage;
BEGIN
  -- Each probe is ONE STATEMENT. core.collection_stage_for is STABLE, and a
  -- batched matrix of identical-argument calls can be folded by the planner.
  SELECT core.collection_stage_for('00000010-1111-1111-1111-111111111111', 34) INTO v;
  ASSERT v = 'REMINDER_2',
    format('T10a FAIL: 34 days overdue resolved %s, expected REMINDER_2 (the '
           'contract''s INV-2026-0288 fixture)', v);

  SELECT core.collection_stage_for('00000010-1111-1111-1111-111111111111', 80) INTO v;
  ASSERT v = 'TRADING_HOLD',
    format('T10b FAIL: 80 days overdue resolved %s, expected TRADING_HOLD', v);

  SELECT core.collection_stage_for('00000010-1111-1111-1111-111111111111', 3) INTO v;
  ASSERT v IS NULL,
    format('T10c FAIL: 3 days overdue resolved %s; the ladder starts at 7 and '
           'before that there is no stage, not a default one', v);
  RAISE NOTICE 'T10 PASS - 34 -> REMINDER_2, 80 -> TRADING_HOLD, 3 -> no stage.';
END;
$t10$;

DO $t11$
DECLARE v_a boolean := false; v_b boolean := false;
BEGIN
  BEGIN
    UPDATE core.collection_rules SET autonomy = 'AUTONOMOUS'
     WHERE tenant_id = '00000010-1111-1111-1111-111111111111' AND stage = 'REMINDER_3';
  EXCEPTION WHEN check_violation THEN v_a := true;
  END;
  ASSERT v_a,
    'T11a FAIL: REMINDER_3 was promoted to AUTONOMOUS. DECISIONS §1 fixes '
    '"reminder 3 is always human", and a constraint makes it unrepresentable '
    'rather than merely policed';

  BEGIN
    UPDATE core.collection_rules SET requires_role = 'FINANCE'
     WHERE tenant_id = '00000010-1111-1111-1111-111111111111' AND stage = 'TRADING_HOLD';
  EXCEPTION WHEN check_violation THEN v_b := true;
  END;
  ASSERT v_b, 'T11b FAIL: a trading hold was allowed to require anything but MD';
  RAISE NOTICE 'T11 PASS - the two autonomy ceilings are unrepresentable, not policed.';
END;
$t11$;

-- === T12 · a credit note cannot exceed what it credits =======================
INSERT INTO core.credit_notes (id, tenant_id, invoice_id, organisation_id, reason)
VALUES ('00000010-dddd-dddd-dddd-ddddddddddd1','00000010-1111-1111-1111-111111111111',
        '00000010-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        'Duplicate materials line');

DO $t12$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO core.credit_note_lines (tenant_id, credit_note_id, n, description,
                                        qty, unit_price_sen)
    VALUES ('00000010-1111-1111-1111-111111111111',
            '00000010-dddd-dddd-dddd-ddddddddddd1',1,'Over-credit',1, 500000);
    SET CONSTRAINTS core.trg_credit_note_within_invoice IMMEDIATE;
  EXCEPTION WHEN integrity_constraint_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T12 FAIL: a credit note of RM 5,000 against an invoice of RM 1,079.99 was '
    'accepted. A credit note that exceeds its invoice is a refund the business '
    'never agreed to';
  RAISE NOTICE 'T12 PASS - CREDIT_EXCEEDS_INVOICE refuses an over-credit.';
END;
$t12$;

-- === T13 · the e-invoice mirror refuses an incoherent state ==================
DO $t13$
DECLARE
  v_a boolean := false; v_b boolean := false; v_c boolean := false;
  v_id uuid;
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  -- (new) -> DRAFT is gated by INVOICE_CREATE, and the gate matches the action
  -- request's target_id against the row being written, so the id is generated
  -- here rather than defaulted. That is exactly what the product does:
  -- app.resolve_action_target_id reads INVOICE_CREATE's target out of the
  -- PAYLOAD, because the row does not exist yet when the action is raised.
  BEGIN
    v_id := gen_random_uuid();
    PERFORM pg_temp.gate('00000010-1111-1111-1111-111111111111','INVOICE_CREATE',v_id);
    INSERT INTO core.invoices (id, tenant_id, organisation_id, einvoice_status)
    VALUES (v_id,'00000010-1111-1111-1111-111111111111',
            '00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1','VALID');
  EXCEPTION WHEN check_violation THEN v_a := true;
  END;
  ASSERT v_a,
    'T13a FAIL: einvoice_status VALID was accepted with no uuid, no long id and '
    'no validated_at. A mirrored status claiming validation must carry the '
    'evidence of it, or the QR code renders from nothing';

  BEGIN
    v_id := gen_random_uuid();
    PERFORM pg_temp.gate('00000010-1111-1111-1111-111111111111','INVOICE_CREATE',v_id);
    INSERT INTO core.invoices (id, tenant_id, organisation_id, einvoice_status)
    VALUES (v_id,'00000010-1111-1111-1111-111111111111',
            '00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1','INVALID');
  EXCEPTION WHEN check_violation THEN v_b := true;
  END;
  ASSERT v_b,
    'T13b FAIL: einvoice_status INVALID was accepted with no validation errors. '
    '"It failed" is not something finance can act on';

  -- Ruling R-JSONB. The naive constraint a reviewer writes is
  -- `errors->>'code' IS NOT NULL`, which evaluates to NULL and PASSES on an
  -- object with no `errors` key at all. This is that payload.
  BEGIN
    v_id := gen_random_uuid();
    PERFORM pg_temp.gate('00000010-1111-1111-1111-111111111111','INVOICE_CREATE',v_id);
    INSERT INTO core.invoices (id, tenant_id, organisation_id,
                               einvoice_validation_errors)
    VALUES (v_id,'00000010-1111-1111-1111-111111111111',
            '00000010-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
            '{"message":"something went wrong"}'::jsonb);
  EXCEPTION WHEN check_violation THEN v_c := true;
  END;
  PERFORM pg_temp.ungate();
  ASSERT v_c,
    'T13c FAIL: a validation-errors blob with no `errors` key was accepted. Key '
    'presence is asserted with `?`, not with a comparison that returns NULL and '
    'therefore passes';
  RAISE NOTICE 'T13 PASS - the mirror refuses VALID without evidence, INVALID '
               'without errors, and a shapeless error blob.';
END;
$t13$;

-- === T14 · receivables_aging resolves from the bucket table ==================
DO $t14$
DECLARE v_total bigint; v_rows int;
BEGIN
  SELECT count(*), COALESCE(sum(outstanding_sen),0) INTO v_rows, v_total
    FROM core.receivables_aging('00000010-1111-1111-1111-111111111111', current_date);
  ASSERT v_rows = 4,
    format('T14a FAIL: aging returned %s buckets, expected the 4 seeded rows', v_rows);
  -- Invoice 1 is due in 30 days, so it is CURRENT, not overdue. The figure being
  -- non-zero at all is what proves the join reached the invoices.
  ASSERT v_total = 107999,
    format('T14b FAIL: aging totals %s across all buckets, expected 107999 - the '
           'one open invoice', v_total);
  RAISE NOTICE 'T14 PASS - aging resolves boundaries from core.aging_buckets only.';
END;
$t14$;

-- === T15 · nothing here is reachable by a client role ========================
DO $t15$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(DISTINCT c.relname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN unnest(ARRAY['anon','authenticated']) AS r(role_name)
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND c.relname IN ('tenant_tax_profiles','invoices','invoice_lines',
                      'invoice_sync_entries','payments','credit_notes',
                      'credit_note_lines','aging_buckets','collection_rules',
                      'collections_cases')
    AND has_table_privilege(r.role_name, c.oid, 'SELECT');
  ASSERT v_bad IS NULL,
    format('T15a FAIL: client role(s) hold SELECT on %s before 014 writes any '
           'policy - that is a cross-tenant read with no policy to stop it', v_bad);

  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN unnest(ARRAY['anon','authenticated']) AS r(role_name)
  WHERE n.nspname = 'core'
    AND p.proname IN ('receivables_aging','collection_stage_for')
    AND has_function_privilege(r.role_name, p.oid, 'EXECUTE');
  ASSERT v_bad IS NULL,
    format('T15b FAIL: client role(s) hold EXECUTE on %s. The tenant is an '
           'ARGUMENT to both, so granting before 014 publishes a cross-tenant '
           'reader', v_bad);
  RAISE NOTICE 'T15 PASS - deny-all holds; no client role can reach 010.';
END;
$t15$;

ROLLBACK;
