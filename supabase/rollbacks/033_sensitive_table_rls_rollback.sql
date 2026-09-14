-- ═══════════════════════════════════════════════════════════════════════════
-- 033 ROLLBACK · Sensitive-table RLS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Uses `app.ungate_tenant_policy` (014) — the documented, deliberate-act
-- escape hatch for exactly this — to remove the permission gate 033 put on
-- each of its 29 tables, restoring 014's original blanket tenant-only read.
-- Drops the three H4 narrowing policies and restores `public.user_profiles_
-- select` to 002's original tenant-blanket predicate. Reopens H1, H4 and M4
-- exactly as they were before 033.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DO $ungate$
DECLARE
  r pg_catalog.record;
BEGIN
  FOR r IN
    SELECT relname FROM (VALUES
      ('approval_requests'),('approval_decisions'),('action_requests'),
      ('quotations'),('quotation_lines'),('rate_cards'),
      ('rate_card_trainer_days'),('rate_card_materials'),('rate_card_venues'),
      ('rate_card_travel'),('rate_card_meals'),('rate_card_commissions'),
      ('rate_card_margin_floors'),('rate_card_discount_authorities'),
      ('invoices'),('payments'),('credit_notes'),('credit_note_lines'),
      ('collections_cases'),('contacts'),('contact_consents'),
      ('organisations'),('opportunities'),('enquiries'),('proposals'),
      ('proposal_sections'),('ai_budgets'),('model_tiers')
    ) AS g(relname)
  LOOP
    PERFORM app.ungate_tenant_policy('core', r.relname, '033');
  END LOOP;
END;
$ungate$;

DROP POLICY IF EXISTS organisations_my_accounts_narrow_033 ON core.organisations;
DROP POLICY IF EXISTS opportunities_my_accounts_narrow_033 ON core.opportunities;
DROP POLICY IF EXISTS enquiries_my_accounts_narrow_033 ON core.enquiries;
DROP POLICY IF EXISTS events_no_client_033 ON core.events;

DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
CREATE POLICY user_profiles_select ON public.user_profiles
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT app.current_tenant_id()));

COMMENT ON POLICY user_profiles_select ON public.user_profiles IS NULL;

DO $verify$
DECLARE
  v_bad text[];
BEGIN
  SELECT pg_catalog.array_agg(g.relname) INTO v_bad
    FROM (VALUES
      ('approval_requests'),('approval_decisions'),('action_requests'),
      ('quotations'),('quotation_lines'),('rate_cards'),
      ('rate_card_trainer_days'),('rate_card_materials'),('rate_card_venues'),
      ('rate_card_travel'),('rate_card_meals'),('rate_card_commissions'),
      ('rate_card_margin_floors'),('rate_card_discount_authorities'),
      ('invoices'),('payments'),('credit_notes'),('credit_note_lines'),
      ('collections_cases'),('contacts'),('contact_consents'),
      ('organisations'),('opportunities'),('enquiries'),('proposals'),
      ('proposal_sections'),('ai_budgets'),('model_tiers')
    ) AS g(relname)
   WHERE EXISTS (
     SELECT 1 FROM pg_catalog.pg_policy p
      WHERE p.polrelid = pg_catalog.to_regclass('core.' || g.relname)
        AND p.polname = g.relname || '_tenant_isolation'
        AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%has_permission%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '033 rollback verify: table(s) still carrying a has_permission gate: %', v_bad;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'core.organisations'::regclass
         AND p.polname = 'organisations_my_accounts_narrow_033')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'core.opportunities'::regclass
         AND p.polname = 'opportunities_my_accounts_narrow_033')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'core.enquiries'::regclass
         AND p.polname = 'enquiries_my_accounts_narrow_033')
  THEN
    RAISE EXCEPTION '033 rollback verify: a MY_ACCOUNTS narrowing policy still exists';
  END IF;
END
$verify$;

COMMIT;
