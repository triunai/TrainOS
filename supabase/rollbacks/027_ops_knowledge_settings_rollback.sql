-- ═══════════════════════════════════════════════════════════════════════════
-- 027 ROLLBACK · Automation, knowledge and AI-settings read/write surface
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 027 is purely additive over 001-021 (no existing object was replaced), so
-- the rollback is a straight teardown: drop the sixteen new functions and
-- their two private helpers, drop core.library_assets, and delete the two new
-- app.role_permissions rows. Refuses if core.library_assets holds rows (data
-- loss the operator should decide on, not a migration).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DO $refuse$
DECLARE v_rows integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_rows FROM core.library_assets;
  IF v_rows > 0 THEN
    RAISE EXCEPTION '027 rollback refused: core.library_assets holds % row(s). '
      'Nothing was changed. Decide what happens to that data before dropping the table.', v_rows
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END
$refuse$;

DROP FUNCTION IF EXISTS core.list_agents();
DROP FUNCTION IF EXISTS core.pause_agent(text, jsonb);
DROP FUNCTION IF EXISTS core.list_runs(jsonb);
DROP FUNCTION IF EXISTS core.get_run(text);
DROP FUNCTION IF EXISTS core.retry_run(text, text);
DROP FUNCTION IF EXISTS core.dead_letter_run(text, jsonb);
DROP FUNCTION IF EXISTS core.create_knowledge_source(jsonb);
DROP FUNCTION IF EXISTS core.check_knowledge_source(text);
DROP FUNCTION IF EXISTS core.reingest_knowledge_source(text);
DROP FUNCTION IF EXISTS core.list_library_assets(jsonb);
DROP FUNCTION IF EXISTS core.get_ai_routing();
DROP FUNCTION IF EXISTS core.put_ai_routing(jsonb);
DROP FUNCTION IF EXISTS core.list_providers();
DROP FUNCTION IF EXISTS core.get_usage(text, text);
DROP FUNCTION IF EXISTS core.put_budget(text, text, jsonb);
DROP FUNCTION IF EXISTS core.get_tenant();
DROP FUNCTION IF EXISTS app._run_row(core.runs);
DROP FUNCTION IF EXISTS app._knowledge_source_row(core.knowledge_sources);

DROP TABLE IF EXISTS core.library_assets;

DELETE FROM app.role_permissions WHERE permission IN ('library:read', 'tenant:read');

COMMIT;
