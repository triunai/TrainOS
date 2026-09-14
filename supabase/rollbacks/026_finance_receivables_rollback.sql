-- ═══════════════════════════════════════════════════════════════════════════
-- 026 ROLLBACK · Finance receivables
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores the database to exactly what 021 left: no aging/collection seed
-- for any tenant, no `om_invoice_fk`, none of §4-§6's functions. No 001-021
-- object is touched, so nothing there needs restoring.
--
-- Wrapped in one transaction: a rollback that fails half way leaves a state
-- neither file describes.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

-- ═══ 1 · Drop the client RPCs and their internal helpers ═══════════════════

DROP FUNCTION IF EXISTS core.list_commissions(jsonb, text, jsonb);
DROP FUNCTION IF EXISTS core.get_collection_draft(text);
DROP FUNCTION IF EXISTS core.get_collections_queue(jsonb);
DROP FUNCTION IF EXISTS core.get_receivables_aging();
DROP FUNCTION IF EXISTS core.get_invoice(text);
DROP FUNCTION IF EXISTS core.list_invoices(jsonb, text, jsonb, text);
DROP FUNCTION IF EXISTS app._invoice_json(uuid, core.invoices);
DROP FUNCTION IF EXISTS app._receivables_aging_json(uuid, date);

-- ═══ 2 · Drop the FK 026 added ══════════════════════════════════════════════

ALTER TABLE core.outbound_messages DROP CONSTRAINT IF EXISTS om_invoice_fk;

-- ═══ 3 · Remove the ladder and the buckets 026 seeded ══════════════════════
--
-- Only the codes/stages 026 itself inserts. No 001-021 migration writes to
-- either table (026's header), so this is exactly 026's own insert, reversed.

DELETE FROM core.collection_rules
 WHERE stage IN ('REMINDER_1', 'REMINDER_2', 'REMINDER_3', 'HUMAN_CALL', 'TRADING_HOLD');
DELETE FROM core.aging_buckets
 WHERE code IN ('current', 'd1_30', 'd31_60', 'd60_plus');

-- ═══ 4 · Verify ═════════════════════════════════════════════════════════════

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('core', 'app')
      AND p.proname IN ('list_invoices', 'get_invoice', 'get_receivables_aging',
                        'get_collections_queue', 'get_collection_draft', 'list_commissions',
                        '_invoice_json', '_receivables_aging_json')) THEN
    RAISE EXCEPTION '026 rollback verify: a 026 function still exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conname = 'om_invoice_fk' AND conrelid = 'core.outbound_messages'::regclass) THEN
    RAISE EXCEPTION '026 rollback verify: om_invoice_fk still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM core.aging_buckets
              WHERE code IN ('current', 'd1_30', 'd31_60', 'd60_plus'))
     OR EXISTS (SELECT 1 FROM core.collection_rules
              WHERE stage IN ('REMINDER_1', 'REMINDER_2', 'REMINDER_3', 'HUMAN_CALL', 'TRADING_HOLD')) THEN
    RAISE EXCEPTION '026 rollback verify: the aging/collection seed is still present';
  END IF;
END
$verify$;

COMMIT;
