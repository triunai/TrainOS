-- ============================================================================
-- ROLLBACK 009 · compliance_rules_checks_hrdc
-- ============================================================================
--
-- Forward file: migrations/009_compliance_rules_checks_hrdc.sql
--
-- PRIOR STATE THIS RESTORES. After 008 and before 009: `core` holds shell, sales, catalogue, money and delivery tables, and no compliance table. `core.engagements.grant_rule_set_version_id` is a column with NO foreign key, which is how 008 left it.
-- Every object below was created from nothing by 009, so there is no prior
-- definition to reproduce.
--
-- ⚠ READ FIRST: THIS DESTROYS THE VERIFIED RULE REGISTRY AND THE ASSESSMENT
-- HISTORY BEHIND FILED CLAIMS.
--
-- Every ACTIVE rule was checked against a circular by a named person, and its
-- source excerpt is quoted verbatim as the evidence. Re-extracting the rules
-- from the circulars afterwards is not the same act and produces PROPOSED rows,
-- not verified ones.
--
-- `core.compliance_check_results` records which rule-set version each check
-- applied, and `core.compliance_version_drifts` records where the applicable
-- version moved between stages. That pair is the answer to "why was this claim
-- passed in October". Dropping them does not change an assessment; it deletes
-- the ability to explain one.
--
-- BEFORE RUNNING THIS, EXPORT:
--     COPY (SELECT * FROM core.rule_set_versions) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.compliance_rules) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.compliance_check_results) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.hrdc_packets) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.hrdc_packet_documents) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.knowledge_sources) TO STDOUT WITH CSV HEADER;
--
-- ⛔ PRE-FLIGHT GUARDS, none with an override. G0 short-circuits when 009 is
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
  IF to_regclass('core.knowledge_sources') IS NULL THEN
    RAISE NOTICE 'rollback 009: nothing to do - 009 is already rolled back.';
    RETURN;
  END IF;

  -- Any table that references one of 009's tables and is not itself 009's
  -- belongs to a later migration. Named here rather than discovered as a
  -- cascade failure halfway through the drops.
  SELECT string_agg(DISTINCT format('%I.%I', n.nspname, c.relname), ', ') INTO v_extra
  FROM pg_catalog.pg_constraint k
  JOIN pg_catalog.pg_class c     ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_class pc    ON pc.oid = k.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE k.contype = 'f'
    AND pn.nspname = 'core' AND pc.relname IN ('hrdc_levy_statements', 'hrdc_packet_documents', 'hrdc_packets', 'compliance_version_drifts', 'compliance_check_results', 'rule_change_affected_engagements', 'rule_changes', 'rule_change_sets', 'compliance_rules', 'rule_set_versions', 'knowledge_chunks', 'knowledge_sources')
    AND NOT (n.nspname = 'core' AND c.relname IN ('hrdc_levy_statements', 'hrdc_packet_documents', 'hrdc_packets', 'compliance_version_drifts', 'compliance_check_results', 'rule_change_affected_engagements', 'rule_changes', 'rule_change_sets', 'compliance_rules', 'rule_set_versions', 'knowledge_chunks', 'knowledge_sources'))
    AND k.conname NOT IN ('engagements_grant_version_fk', 'cr_knowledge_source_fk');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 009 ABORTED: table(s) outside 009 still reference its tables: %. '
      'Roll those migrations back first.', v_extra
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.hrdc_packets WHERE status IN ('SUBMITTED','PAID')) INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 009 ABORTED: core.hrdc_packets holds claims already filed with HRD Corp. The claim reference is what ties a filing on eTRIS back to an engagement, and there is no copy of that link (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.compliance_rules WHERE status = 'ACTIVE') INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 009 ABORTED: core.compliance_rules is the verified rule registry. Each ACTIVE row was checked against a circular by a named person, and the source excerpt is quoted verbatim as evidence. Re-extracting it from the circulars is not the same as restoring it (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.compliance_check_results) INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 009 ABORTED: core.compliance_check_results is the assessment history: which rule-set version each check applied and when. Dropping it does not change any assessment, it deletes the ability to explain one (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 009 pre-flight: clear.';
END;
$preflight$;

ALTER TABLE core.engagements DROP CONSTRAINT IF EXISTS engagements_grant_version_fk;



DROP TABLE IF EXISTS core.hrdc_levy_statements CASCADE;
DROP TABLE IF EXISTS core.hrdc_packet_documents CASCADE;
DROP TABLE IF EXISTS core.hrdc_packets CASCADE;
DROP TABLE IF EXISTS core.compliance_version_drifts CASCADE;
DROP TABLE IF EXISTS core.compliance_check_results CASCADE;
DROP TABLE IF EXISTS core.rule_change_affected_engagements CASCADE;
DROP TABLE IF EXISTS core.rule_changes CASCADE;
DROP TABLE IF EXISTS core.rule_change_sets CASCADE;
DROP TABLE IF EXISTS core.compliance_rules CASCADE;
DROP TABLE IF EXISTS core.rule_set_versions CASCADE;
DROP TABLE IF EXISTS core.knowledge_chunks CASCADE;
DROP TABLE IF EXISTS core.knowledge_sources CASCADE;

DROP FUNCTION IF EXISTS core.resolve_rules(uuid, timestamptz, date, core.rule_side, core.delivery_mode, core.hrdc_scheme);
DROP FUNCTION IF EXISTS core.apply_rule_offset(date, integer, core.rule_offset_unit);
DROP FUNCTION IF EXISTS core.sync_rule_scheme_key();

DROP TYPE IF EXISTS core.delivery_mode;
DROP TYPE IF EXISTS core.rule_offset_unit;
DROP TYPE IF EXISTS core.rule_reference_kind;
DROP TYPE IF EXISTS core.rule_op;
DROP TYPE IF EXISTS core.rule_kind;
DROP TYPE IF EXISTS core.rule_side;

DO $verify$
DECLARE v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relname IN ('hrdc_levy_statements', 'hrdc_packet_documents', 'hrdc_packets', 'compliance_version_drifts', 'compliance_check_results', 'rule_change_affected_engagements', 'rule_changes', 'rule_change_sets', 'compliance_rules', 'rule_set_versions', 'knowledge_chunks', 'knowledge_sources');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 009: table(s) survived: %', v_left;
  END IF;

  -- The layers below must be intact. A rollback that quietly took one with it
  -- leaves a state no migration describes.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                 JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'app' AND p.proname = 'finalise_table') THEN
    RAISE EXCEPTION 'rollback 009: 004''s finaliser is gone - the layer below was damaged';
  END IF;

  RAISE NOTICE 'rollback 009: complete - layers below intact.';
END;
$verify$;

COMMIT;
