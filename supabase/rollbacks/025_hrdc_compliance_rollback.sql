-- ═══════════════════════════════════════════════════════════════════════════
-- 025 ROLLBACK · compliance — the six HRD Corp / rules-registry RPCs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores the database to exactly what 021 left. 025 replaced nothing from
-- 001-021: every object here is new, so the rollback is a straight drop, in
-- the reverse dependency order of the forward file.
--
-- WHAT A ROLLBACK BRINGS BACK, said out loud: `getClaimPacket`,
-- `getComplianceChecks`, `attachPacketDocument`, `exportClaimPacket`,
-- `createComplianceRule` and `getRuleChangeSet` answer `NOT_DEPLOYED` again.
-- `core.hrdc_document_types` stops being provisioned for new tenants, and
-- rows this migration backfilled for EXISTING tenants are removed (a fresh
-- `app.provision_tenant` call after rollback would otherwise leave a tenant
-- whose 025-independent state looks provisioned when it never was). Any
-- `core.hrdc_packet_documents` row inserted by the compliance demo seed
-- references a now-deleted `document_type`; the demo seed's own wipe file
-- must run BEFORE this rollback, and V1 below refuses otherwise.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

-- ═══ 1 · Refuse if seed rows would be left dangling ════════════════════════

DO $refuse$
BEGIN
  IF EXISTS (
    SELECT 1 FROM core.hrdc_packet_documents doc
     WHERE doc.document_type IN
       ('ATTENDANCE_SHEET','TRAINER_TTT_CERT','TAX_INVOICE','EVALUATION_SUMMARY','TRAINING_SCHEDULE')) THEN
    RAISE EXCEPTION
      '025 rollback: core.hrdc_packet_documents has rows referencing a document_type '
      'this rollback is about to delete. Run supabase/seeds/hosted_demo_compliance_wipe.sql '
      '(and any other seed that attached HRD Corp documents) before rolling back 025.';
  END IF;
END
$refuse$;

-- ═══ 2 · Drop the six client-callable functions ════════════════════════════

DROP FUNCTION IF EXISTS core.get_claim_packet(text);
DROP FUNCTION IF EXISTS core.get_compliance_checks(text);
DROP FUNCTION IF EXISTS core.attach_packet_document(text, jsonb, text);
DROP FUNCTION IF EXISTS core.export_claim_packet(text);
DROP FUNCTION IF EXISTS core.create_compliance_rule(jsonb, text);
DROP FUNCTION IF EXISTS core.get_rule_change_set(text);

-- ═══ 3 · Un-provision core.hrdc_document_types ═════════════════════════════

DROP TRIGGER IF EXISTS trg_tenants_seed_hrdc_document_types ON public.tenants;
DROP FUNCTION IF EXISTS app.seed_hrdc_document_types_on_tenant();
DROP FUNCTION IF EXISTS app.seed_hrdc_document_types(uuid);

DELETE FROM app.tenant_seed_checks WHERE pack = '025' AND schema_name = 'core' AND table_name = 'hrdc_document_types';

DELETE FROM core.hrdc_document_types
 WHERE document_type IN
   ('ATTENDANCE_SHEET','TRAINER_TTT_CERT','TAX_INVOICE','EVALUATION_SUMMARY','TRAINING_SCHEDULE');

-- ═══ 4 · Verify ═════════════════════════════════════════════════════════════

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core'
       AND p.proname IN ('get_claim_packet','get_compliance_checks','attach_packet_document',
                          'export_claim_packet','create_compliance_rule','get_rule_change_set')) THEN
    RAISE EXCEPTION '025 rollback verify: a 025 function still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM core.hrdc_document_types) THEN
    RAISE EXCEPTION '025 rollback verify: core.hrdc_document_types is not empty';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'tenants' AND t.tgname = 'trg_tenants_seed_hrdc_document_types') THEN
    RAISE EXCEPTION '025 rollback verify: the seed trigger still exists on public.tenants';
  END IF;
  RAISE NOTICE '025 rollback verify: OK - six functions gone, hrdc_document_types un-provisioned and empty.';
END;
$verify$;

COMMIT;
