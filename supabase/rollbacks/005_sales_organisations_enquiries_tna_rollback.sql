-- ============================================================================
-- ROLLBACK 005 · sales_organisations_enquiries_tna
-- ============================================================================
--
-- Forward file: migrations/005_sales_organisations_enquiries_tna.sql
--
-- PRIOR STATE THIS RESTORES. After 004 and before 005: `core` holds the 14 shell tables and 69 enum types, and no sales table.
-- Every object below was created from nothing by 005, so there is no prior
-- definition to reproduce.
--
-- ⚠ READ FIRST: THIS DESTROYS CUSTOMER RECORDS AND CONSENT HISTORY.
--
-- `core.contact_consents` is an append-only PDPA ledger and is the only record
-- of what a person agreed to and when. `core.organisations` and `core.contacts`
-- are the customer list. `core.enquiries` holds the original inbound message
-- bodies, which exist nowhere else once the mailbox has been pruned.
--
-- BEFORE RUNNING THIS, EXPORT:
--     COPY (SELECT * FROM core.organisations) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.contacts) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.contact_consents) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.enquiries) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.opportunities) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.tnas) TO STDOUT WITH CSV HEADER;
--
-- ⛔ PRE-FLIGHT GUARDS, none with an override. G0 short-circuits when 005 is
-- already rolled back, so this file is safe to re-run.
--
-- DROP ORDER: children before parents, views before the tables they read,
-- functions last.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
DECLARE v_n bigint; v_extra text;
BEGIN
  IF to_regclass('core.organisations') IS NULL THEN
    RAISE NOTICE 'rollback 005: nothing to do - 005 is already rolled back.';
    RETURN;
  END IF;

  -- Any table that references one of 005's tables and is not itself 005's
  -- belongs to a later migration. Named here rather than discovered as a
  -- cascade failure halfway through the drops.
  SELECT string_agg(DISTINCT format('%I.%I', n.nspname, c.relname), ', ') INTO v_extra
  FROM pg_catalog.pg_constraint k
  JOIN pg_catalog.pg_class c     ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_class pc    ON pc.oid = k.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE k.contype = 'f'
    AND pn.nspname = 'core' AND pc.relname IN ('tna_recommendations', 'tna_evidence', 'tna_gaps', 'tna_constraints', 'tnas', 'follow_ups', 'organisation_suggestions', 'opportunities', 'enquiry_extraction_fields', 'enquiries', 'contact_consents', 'contacts', 'organisation_health_snapshots', 'organisations')
    AND NOT (n.nspname = 'core' AND c.relname IN ('tna_recommendations', 'tna_evidence', 'tna_gaps', 'tna_constraints', 'tnas', 'follow_ups', 'organisation_suggestions', 'opportunities', 'enquiry_extraction_fields', 'enquiries', 'contact_consents', 'contacts', 'organisation_health_snapshots', 'organisations'));
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 005 ABORTED: table(s) outside 005 still reference its tables: %. '
      'Roll those migrations back first.', v_extra
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.contact_consents) INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 005 ABORTED: core.contact_consents holds consent history. PDPA requires it: "did this person consent on 4 March 2024" must stay answerable, and this table is the only place that answer lives. Export it, then truncate deliberately if that is genuinely the intent (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.organisations WHERE archived_at IS NULL) INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 005 ABORTED: core.organisations holds live customer records. Every enquiry, opportunity, engagement and invoice in the product hangs off them (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 005 pre-flight: clear.';
END;
$preflight$;

DROP VIEW IF EXISTS core.v_contact_consent_current CASCADE;

DROP TABLE IF EXISTS core.tna_recommendations CASCADE;
DROP TABLE IF EXISTS core.tna_evidence CASCADE;
DROP TABLE IF EXISTS core.tna_gaps CASCADE;
DROP TABLE IF EXISTS core.tna_constraints CASCADE;
DROP TABLE IF EXISTS core.tnas CASCADE;
DROP TABLE IF EXISTS core.follow_ups CASCADE;
DROP TABLE IF EXISTS core.organisation_suggestions CASCADE;
DROP TABLE IF EXISTS core.opportunities CASCADE;
DROP TABLE IF EXISTS core.enquiry_extraction_fields CASCADE;
DROP TABLE IF EXISTS core.enquiries CASCADE;
DROP TABLE IF EXISTS core.contact_consents CASCADE;
DROP TABLE IF EXISTS core.contacts CASCADE;
DROP TABLE IF EXISTS core.organisation_health_snapshots CASCADE;
DROP TABLE IF EXISTS core.organisations CASCADE;



DO $verify$
DECLARE v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relname IN ('tna_recommendations', 'tna_evidence', 'tna_gaps', 'tna_constraints', 'tnas', 'follow_ups', 'organisation_suggestions', 'opportunities', 'enquiry_extraction_fields', 'enquiries', 'contact_consents', 'contacts', 'organisation_health_snapshots', 'organisations');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 005: table(s) survived: %', v_left;
  END IF;

  -- The layers below must be intact. A rollback that quietly took one with it
  -- leaves a state no migration describes.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                 JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'app' AND p.proname = 'finalise_table') THEN
    RAISE EXCEPTION 'rollback 005: 004''s finaliser is gone - the layer below was damaged';
  END IF;

  RAISE NOTICE 'rollback 005: complete - layers below intact.';
END;
$verify$;

COMMIT;
