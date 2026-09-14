-- ═══════════════════════════════════════════════════════════════════════════
-- 023 ROLLBACK · The sales directory
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores the database to exactly what 021 left. Every object 023 created is
-- a NEW function — none replaced an existing one — so the rollback is five
-- plain drops. No table, view, type, policy or grant outside these five
-- functions was touched by the forward file, and none is touched here.
--
-- ORDER: the reverse of the forward file's §1-§5.
--
-- WHAT A ROLLBACK BRINGS BACK, said out loud: `searchOrganisations`,
-- `listOpportunities`, `getOrganisationSuggestions`, `listTnas` and
-- `reopenTna` go back to NOT_DEPLOYED on the web client — the five screens
-- this migration served (`/sales/organisations`, `/sales/leads`,
-- `/sales/pipeline`, the org column on `/sales/proposals`,
-- `/relationships/renewals|cross-sell`, `/sales/tna` and TNA reopen) degrade
-- to their pre-023 empty/ref-only state. No data is touched: `core.tnas`,
-- `core.opportunities`, `core.organisations` and `core.organisation_
-- suggestions` are untouched tables, not created here.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS core.reopen_tna(text);
DROP FUNCTION IF EXISTS core.list_tnas(jsonb, text, jsonb, text);
DROP FUNCTION IF EXISTS core.get_organisation_suggestions(text);
DROP FUNCTION IF EXISTS core.list_opportunities(jsonb, text, jsonb, text);
DROP FUNCTION IF EXISTS core.search_organisations(text);

-- ═══ Verify ═══════════════════════════════════════════════════════════════

DO $verify_023_rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
     WHERE p.pronamespace = 'core'::regnamespace
       AND p.proname IN ('search_organisations','list_opportunities',
         'get_organisation_suggestions','list_tnas','reopen_tna')) THEN
    RAISE EXCEPTION '023 rollback verify: a 023 function is still present';
  END IF;

  -- 021's objects are untouched: same overload count as before 023 ran.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.pronamespace = 'core'::regnamespace
         AND p.proname IN ('get_organisation','get_opportunity','get_tna',
           'list_proposals')) <> 4 THEN
    RAISE EXCEPTION '023 rollback verify: a 021 function this file depended on was disturbed';
  END IF;
END
$verify_023_rollback$;

COMMIT;
