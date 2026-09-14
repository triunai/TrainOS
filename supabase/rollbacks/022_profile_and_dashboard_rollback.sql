-- ═══════════════════════════════════════════════════════════════════════════
-- 022 ROLLBACK · The profile modal and the executive dashboard
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores the database to exactly what 020 left (021 is a sibling lane).
-- 022 created three NEW functions and replaced nothing, so the rollback is a
-- straight DROP of all three, then a verify that nothing 022-shaped remains.
-- No data is touched: all three are reads.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS core.me_profile();
DROP FUNCTION IF EXISTS core.get_executive_dashboard(text);
DROP FUNCTION IF EXISTS core.get_proposals_vs_won(integer);

DO $verify$
BEGIN
  IF pg_catalog.to_regprocedure('core.me_profile()') IS NOT NULL
     OR pg_catalog.to_regprocedure('core.get_executive_dashboard(text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('core.get_proposals_vs_won(integer)') IS NOT NULL THEN
    RAISE EXCEPTION '022 rollback verify: a 022 function is still in place';
  END IF;
END
$verify$;

COMMIT;
