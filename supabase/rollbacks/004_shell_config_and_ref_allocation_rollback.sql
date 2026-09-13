-- ============================================================================
-- ROLLBACK 004 · shell_config_and_ref_allocation
-- ============================================================================
--
-- Forward file: migrations/004_shell_config_and_ref_allocation.sql
--
-- PRIOR STATE THIS RESTORES. After 003 and before 004: `core` holds 69 enum
-- types and no tables; `app` holds 001's five helpers and 002's eighteen. 004
-- created every object below from nothing, so there is no prior definition to
-- reproduce. 001-003 are untouched.
--
-- ⚠ READ FIRST: THIS DESTROYS CONFIGURATION THAT IS NOT DERIVABLE.
--
-- `pipelines` / `pipeline_steps` are the ONLY definition of what the stages are
-- called and what order they come in. `templates` / `template_sections` are the
-- only copy of a template a sent proposal still renders from — and templates
-- are versioned, never edited, precisely so a five-year-old proposal still
-- renders as it was sent. `metric_definitions` carries each dashboard cell's
-- formula and its drill route. None of it is reconstructible from the rows that
-- reference it.
--
-- BEFORE RUNNING THIS, EXPORT:
--     COPY (SELECT * FROM core.pipelines)          TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.pipeline_steps)     TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.templates)          TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.template_sections)  TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.metric_definitions) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.attachments)        TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.signatures)         TO STDOUT WITH CSV HEADER;
--
-- ⚠ `core.attachments` and `core.signatures` ARE NOT THE FILES. Dropping them
-- destroys the INDEX into object storage — bucket, path, checksum — while the
-- objects themselves survive, unreferenced and unfindable. A signature row is
-- worse: it carries the signer's name, the timestamp, the IP and the method,
-- and that IS the evidence. There is no copy in the bucket.
--
-- ⛔ PRE-FLIGHT GUARDS, none with an override:
--   G0  Already rolled back → say so and stop.
--   G1  Any `core` table 004 did not create. Those are 005-013's, and every one
--       of them was finalised by a function this file drops.
--   G2  Any row in `core.signatures` or `core.attachments`. Unlike config,
--       these are evidence, and a rollback is not entitled to destroy evidence
--       silently. Export them and truncate deliberately if that is really the
--       intent.
--   G3  Any row in `app.action_types`. 011 seeds nineteen of them and other
--       tables reference the catalogue by key.
--
-- DROP ORDER: reverse of forward — children before parents, tables before the
-- functions whose triggers reference them, `finalise_table` last because
-- dropping it first would leave no way to explain what the remaining triggers
-- were for.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Forward section 0 (the hosted remediation of 002's public-table ACLs and the
-- default-privilege revoke) is deliberately NOT reversed, for the reason 001's
-- rollback gives for its own 1c: the prior state was environment-specific, and
-- restoring it means handing anon ALL on tenants, memberships, teams,
-- team_members and user_profiles. 002's own rollback drops those tables.

DO $preflight$
DECLARE
  v_extra text;
  v_n     bigint;
BEGIN
  IF to_regclass('core.pipeline_steps') IS NULL THEN
    RAISE NOTICE 'rollback 004: nothing to do - 004 is already rolled back.';
    RETURN;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO v_extra
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND c.relname NOT IN ('ref_formats','ref_sequences','check_keys','hrdc_document_types',
                          'attachments','signatures','saved_views','templates',
                          'template_sections','pipelines','pipeline_steps',
                          'metric_definitions','hours_saved_baseline_tables',
                          'hours_saved_baselines');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 004 ABORTED: schema core holds table(s) 004 did not create: %. '
      'Every one of them was finalised by app.finalise_table, which this file '
      'drops. Roll those migrations back first.', v_extra
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT count(*) INTO v_n FROM core.signatures;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 004 ABORTED: core.signatures holds % row(s). A signature row IS '
      'the evidence - signer, timestamp, IP, method - and there is no copy in the '
      'storage bucket. Export it before deciding: '
      'COPY (SELECT * FROM core.signatures) TO STDOUT WITH CSV HEADER;', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT count(*) INTO v_n FROM core.attachments;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 004 ABORTED: core.attachments holds % row(s). Dropping the table '
      'destroys the index into object storage while the objects survive, '
      'unreferenced and unfindable. Export it first.', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT count(*) INTO v_n FROM app.action_types;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 004 ABORTED: app.action_types holds % row(s), seeded by 011. Roll '
      'back 011 first.', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 004 pre-flight: clear.';
END;
$preflight$;

-- ─── Tables, children before parents ────────────────────────────────────────
DROP TABLE IF EXISTS core.hours_saved_baselines        CASCADE;
DROP TABLE IF EXISTS core.hours_saved_baseline_tables  CASCADE;
DROP TABLE IF EXISTS core.metric_definitions           CASCADE;
DROP TABLE IF EXISTS core.pipeline_steps               CASCADE;
DROP TABLE IF EXISTS core.pipelines                    CASCADE;
DROP TABLE IF EXISTS core.template_sections            CASCADE;
DROP TABLE IF EXISTS core.templates                    CASCADE;
DROP TABLE IF EXISTS core.saved_views                  CASCADE;
DROP TABLE IF EXISTS core.signatures                   CASCADE;
DROP TABLE IF EXISTS core.attachments                  CASCADE;
DROP TABLE IF EXISTS core.hrdc_document_types          CASCADE;
DROP TABLE IF EXISTS core.check_keys                   CASCADE;
DROP TABLE IF EXISTS core.ref_sequences                CASCADE;
DROP TABLE IF EXISTS core.ref_formats                  CASCADE;
DROP TABLE IF EXISTS app.action_types                  CASCADE;
-- CASCADE is safe HERE and nowhere else in this set: the guards above have
-- already proved nothing outside 004 exists in `core`, so the only things
-- CASCADE can reach are 004's own triggers and constraints on 004's own tables.
-- It is not a licence to use CASCADE elsewhere; see rollback 003's header for
-- the case where it would have silently dropped a column.

-- ─── Functions, dependants first ────────────────────────────────────────────
DROP FUNCTION IF EXISTS core.assign_ref();
DROP FUNCTION IF EXISTS core.next_ref(uuid, text);
DROP FUNCTION IF EXISTS app.finalise_table(text, text, boolean, text, text[]);

DO $verify$
DECLARE v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 004: core table(s) survived: %', v_left;
  END IF;

  IF to_regclass('app.action_types') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 004: app.action_types survived';
  END IF;

  -- 003's types and 002's helpers must be untouched.
  IF (SELECT count(*) FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'core' AND t.typtype = 'e') <> 69 THEN
    RAISE EXCEPTION 'rollback 004: 003''s 69 enum types are no longer intact';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                 JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'app' AND p.proname = 'has_permission') THEN
    RAISE EXCEPTION 'rollback 004: 002''s helpers are no longer intact';
  END IF;

  RAISE NOTICE 'rollback 004: complete - shell removed; 001-003 intact.';
END;
$verify$;

COMMIT;
