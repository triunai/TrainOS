-- ═══════════════════════════════════════════════════════════════════════════
-- 024 ROLLBACK · training delivery
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 024 is purely additive: seven new `core` functions, no DDL, no function it
-- replaced. The rollback is therefore seven `DROP FUNCTION`, nothing to
-- restore. Run against a database with 024 applied and nothing later.
--
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/rollbacks/024_training_delivery_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS core.list_engagements(jsonb,text,jsonb,text);
DROP FUNCTION IF EXISTS core.get_engagement(text);
DROP FUNCTION IF EXISTS core.get_engagement_participants(text,jsonb);
DROP FUNCTION IF EXISTS core.get_attendance(text,integer);
DROP FUNCTION IF EXISTS core.capture_attendance(text,integer,jsonb);
DROP FUNCTION IF EXISTS core.export_attendance(text,text);
DROP FUNCTION IF EXISTS core.put_programme(text,jsonb);

DO $verify$
DECLARE v_left text[];
BEGIN
  SELECT pg_catalog.array_agg(name) INTO v_left
    FROM (VALUES ('core.list_engagements(jsonb,text,jsonb,text)'),
                 ('core.get_engagement(text)'),
                 ('core.get_engagement_participants(text,jsonb)'),
                 ('core.get_attendance(text,integer)'),
                 ('core.capture_attendance(text,integer,jsonb)'),
                 ('core.export_attendance(text,text)'),
                 ('core.put_programme(text,jsonb)')) AS f(name)
   WHERE pg_catalog.to_regprocedure(f.name) IS NOT NULL;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '024 rollback verify: function(s) still present: %', v_left;
  END IF;
END
$verify$;

COMMIT;
