-- ═══════════════════════════════════════════════════════════════════════════
-- 033 · Sensitive-table RLS: permission gates (H1) + MY_ACCOUNTS narrowing
--       (H4) + public.user_profiles self-or-admin (M4) + ai:*:read (M5)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- H1. 014's `§4b` gate list (014:992-1090, the VALUES list at 014:791-793)
-- names exactly THREE `core` tables where tenant membership alone is not
-- enough: `ai_provider_keys`, the seven `run_*` tables, and
-- `public_share_tokens`. Every other `core` table got the blanket
-- `<table>_tenant_select`/`_tenant_isolation` pair with `p_permission = NULL`
-- — any authenticated member of the tenant reads every row. For 111 of 114
-- tables that is the product. For the tables 033 gates below it is a hole:
-- `core.approval_requests` carries approval diffs, evidence and margin, and
-- `get_approval` (018/021) already refuses a CLIENT with `FORBIDDEN` — RLS
-- did not refuse the same CLIENT reading the base table directly through
-- PostgREST, because 014 gave it nothing to refuse on.
--
-- THE MECHANISM, REUSED RATHER THAN REINVENTED. `app.apply_tenant_policies`
-- (014:348) already takes a fourth argument, `p_permission`, that ANDs
-- `(SELECT app.has_permission(p_permission))` into the table's RESTRICTIVE
-- isolation policy, already refuses a permission that names no
-- `app.role_permissions` row, already refuses a permission held by every
-- role ("decoration with the shape of security"), and — the property that
-- makes 033 possible without touching 014's own call — a NON-NULL
-- `p_permission` on a table that currently carries no gate is simply
-- accepted and applied; the function only refuses a NULL `p_permission` on a
-- table that ALREADY carries one (014:519-533), because that specific call
-- shape is the one that can silently strip a gate. 033 calls `app.
-- apply_tenant_policies('core', <table>, '033', <permission>)` for every
-- table below, stamped `033` in `pg_policy`'s comment (via the function's
-- existing `p_migration` parameter) so `033`, not `014`, is what a future
-- reader finds owning these policies.
--
-- THE MAPPING, table → permission, derived from `packages/contract/src/
-- endpoints.ts`'s GET roles and 002's `app.role_permissions` matrix (002
-- §11), written down once here rather than only in the loop's VALUES list:
--
--   core.approval_requests,          approval:read        (approval domain)
--   core.approval_decisions,         approval:read
--   core.action_requests,            approval:read
--   core.events,                     bespoke (CLIENT-only exclusion — see
--                                     the dedicated section below; audit:read
--                                     is held by every non-CLIENT/AGENT role
--                                     and apply_tenant_policies correctly
--                                     refuses to build a gate from it)
--   core.quotations,                 quotation:read
--   core.quotation_lines,            quotation:read
--   core.rate_cards,                 quotation:read         base pricing —
--   core.rate_card_trainer_days,     quotation:read         SALES needs these
--   core.rate_card_materials,        quotation:read         to build a quote
--   core.rate_card_venues,           quotation:read
--   core.rate_card_travel,           quotation:read
--   core.rate_card_meals,            quotation:read
--   core.rate_card_commissions,      discount:approve       margin/commission —
--   core.rate_card_margin_floors,    discount:approve       SALES_MANAGER/
--   core.rate_card_discount_authorities, discount:approve   FINANCE/MD/ADMIN
--                                                            only (no
--                                                            dedicated read
--                                                            permission
--                                                            exists for these
--                                                            three; gated on
--                                                            the write
--                                                            permission that
--                                                            already excludes
--                                                            SALES/OPS/
--                                                            TRAINER — an
--                                                            explicit choice,
--                                                            not a default)
--   core.invoices,                   invoice:read
--   core.payments,                   invoice:read           no payment:read
--   core.credit_notes,               invoice:read           permission exists
--   core.credit_note_lines,          invoice:read            anywhere in 002;
--                                                            gated on the
--                                                            same permission
--                                                            invoices use
--                                                            (same FINANCE-
--                                                            domain role set)
--                                                            rather than
--                                                            inventing one —
--                                                            an explicit
--                                                            choice, recorded
--                                                            as an open item
--                                                            below
--   core.collections_cases,          collection:read
--   core.contacts,                   contact:read
--   core.contact_consents,           contact:consent:read
--   core.organisations,              organisation:read
--   core.opportunities,              opportunity:read
--   core.enquiries,                  enquiry:read
--   core.proposals,                  proposal:read
--   core.proposal_sections,          proposal:read
--   core.ai_budgets,                 ai:budget:read          (M5)
--   core.model_tiers,                ai:tier:read            (M5)
--
-- Every permission above is held by SALES, SALES_MANAGER, OPS, FINANCE, MD
-- and ADMIN in SOME combination, per 002 §11 — never by CLIENT or AGENT (both
-- hold ZERO `app.role_permissions` rows, grepped), which is what closes H1's
-- worked example: a CLIENT reading `core.approval_requests` directly is now
-- refused by RLS the same way `get_approval` already refuses it at the RPC
-- layer.
--
-- WHAT 033 DOES NOT TOUCH. `core.ai_provider_keys`, the seven `run_*`
-- tables and `core.public_share_tokens` already carry a 014-stamped gate and
-- are untouched — re-gating them here would trip `apply_tenant_policies`'s
-- own "already gated, pass the same permission or call ungate_tenant_policy"
-- refusal, correctly. `core.provenance`, `core.provenance_subjects` and every
-- other `core` table not named above keep 014's blanket tenant-only read —
-- that is the product for 111 of 114 tables, not a gap.
--
-- H4. `app.can_see_owner(p_owner uuid)` (002:458) narrows to the caller's own
-- rows under `client_scope = MY_ACCOUNTS` (the membership default — SEEDED
-- FOR EVERY ROLE, not just SALES: grepped `client_scope` across
-- 016/019/seeds/hosted_demo and found it set NOWHERE, so every role's
-- membership row carries the column default unless a future screen changes
-- it). Doc 02 §2.3 marks `organisation:read`/`opportunity:read`/
-- `enquiry:read` "○" (scope-narrowed) for SALES and SALES_MANAGER ONLY — not
-- for OPS/FINANCE/MD/ADMIN, which hold the same permissions unmarked. BECAUSE
-- every role's `client_scope` defaults the same way, a narrowing predicate
-- keyed on `app.can_see_owner()` alone — without also checking the caller's
-- ROLE — would silently restrict OPS/FINANCE/MD/ADMIN too, none of which the
-- doc marks ○, and break their existing full-tenant screens. 033's narrowing
-- policies therefore gate on `(SELECT app.role()) IN ('SALES',
-- 'SALES_MANAGER')` FIRST and only THEN defer to `app.can_see_owner()` — a
-- role a doc mark does not name is passed through untouched, exactly as
-- today.
--
-- Applied to the three tables with a DIRECT, NOT-NULL owner column:
-- `core.organisations.owner_id`, `core.opportunities.owner_id`. `core.
-- enquiries.assigned_to_user_id` is nullable, and an unassigned enquiry is
-- made visible to every MY_ACCOUNTS-scoped SALES caller regardless of
-- `can_see_owner` (`assigned_to_user_id IS NULL OR app.can_see_owner(...)`)
-- rather than invisible to all of them — an inbox of unclaimed enquiries
-- that a MY_ACCOUNTS SALES rep cannot see to self-assign would be a
-- functional regression this migration has no product sign-off to make, and
-- a scope check that only ever WIDENS what a client_scope=ALL/MY_TEAM caller
-- already saw is the safe default in the absence of one.
--
-- NOT NARROWED in 033, an explicit open item: `core.quotations`, `core.
-- proposals`, `core.contacts`, `core.invoices`, `core.collections_cases` also
-- carry the ○ mark for SALES/SALES_MANAGER in 002 §11, but none has a direct
-- owner column — ownership is indirect (a quotation's proposal → opportunity
-- → owner_id, a contact's organisation → owner_id, and so on), and a
-- correlated-subquery predicate through that chain, guessed rather than
-- confirmed against how each screen actually expects unowned/cross-chain
-- rows to behave, risks EITHER silently failing to narrow (H4 half-fixed and
-- looking fixed) or hiding rows a screen needs (a live regression). Left at
-- 033's permission-level gate only (still real: H1 already closes CLIENT/
-- AGENT reading any of them), with the join-chain narrowing recorded here as
-- owed rather than guessed.
--
-- M4. `public.user_profiles_select` (002:772) is blanket tenant-membership,
-- no permission, no self/owner check — any tenant member reads every
-- colleague's profile row. Grepped `apps/web/src` for a cross-user
-- `user_profiles` read: NONE — every screen that shows another user's name
-- does so through a denormalised text column (`approval_decisions.
-- decided_by_name`, and similar) or a real join elsewhere, never through
-- `public.user_profiles` for a user other than the caller. The fix mirrors
-- `user_profiles_update_self_or_admin` (002:759), already self-or-ADMIN, for
-- SELECT instead of UPDATE: no screen needs anything wider, so nothing wider
-- is granted.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('app.apply_tenant_policies(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '033 preflight: app.apply_tenant_policies/4 is absent; 014 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('app.can_see_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION '033 preflight: app.can_see_owner(uuid) is absent; 002 has not been applied';
  END IF;
  IF pg_catalog.to_regclass('core.organisations') IS NULL
     OR pg_catalog.to_regclass('core.opportunities') IS NULL
     OR pg_catalog.to_regclass('core.enquiries') IS NULL
  THEN
    RAISE EXCEPTION '033 preflight: 005 has not been applied';
  END IF;
END;
$preflight$;

-- ═══ H1 + M5 · Permission gates, via the existing helper ═════════════════

DO $apply$
DECLARE
  r       pg_catalog.record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('approval_requests',              'approval:read'),
      ('approval_decisions',             'approval:read'),
      ('action_requests',                'approval:read'),
      ('quotations',                     'quotation:read'),
      ('quotation_lines',                'quotation:read'),
      ('rate_cards',                     'quotation:read'),
      ('rate_card_trainer_days',         'quotation:read'),
      ('rate_card_materials',            'quotation:read'),
      ('rate_card_venues',               'quotation:read'),
      ('rate_card_travel',               'quotation:read'),
      ('rate_card_meals',                'quotation:read'),
      ('rate_card_commissions',          'discount:approve'),
      ('rate_card_margin_floors',        'discount:approve'),
      ('rate_card_discount_authorities', 'discount:approve'),
      ('invoices',                       'invoice:read'),
      ('payments',                       'invoice:read'),
      ('credit_notes',                   'invoice:read'),
      ('credit_note_lines',              'invoice:read'),
      ('collections_cases',              'collection:read'),
      ('contacts',                       'contact:read'),
      ('contact_consents',               'contact:consent:read'),
      ('organisations',                  'organisation:read'),
      ('opportunities',                  'opportunity:read'),
      ('enquiries',                      'enquiry:read'),
      ('proposals',                      'proposal:read'),
      ('proposal_sections',              'proposal:read'),
      ('ai_budgets',                     'ai:budget:read'),
      ('model_tiers',                    'ai:tier:read')
    ) AS g(relname, perm)
  LOOP
    PERFORM app.apply_tenant_policies('core', r.relname, '033', r.perm);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '033: permission-gated tenant policies applied to % core tables', v_count;

  IF v_count <> 28 THEN
    RAISE EXCEPTION
      '033: expected to gate exactly 28 core tables, gated %. The VALUES list '
      'above is the only place this count is declared; if it changed on '
      'purpose, update this number with it.', v_count;
  END IF;
END;
$apply$;

-- ═══ core.events — NOT via apply_tenant_policies; see the header ══════════
--
-- Found by running this migration, not by reading it: `audit:read` is held
-- by every role that holds ANY app.role_permissions row (SALES, SALES_
-- MANAGER, OPS, FINANCE, MD, ADMIN, TRAINER — checked above), and `app.
-- apply_tenant_policies` correctly REFUSES to build a gate from it
-- ("decoration with the shape of security", 014:497-502) — choosing THIS
-- permission narrows nothing beyond what any other permission would already
-- guarantee for CLIENT/AGENT (who hold zero rows in app.role_permissions,
-- full stop). The domain event log is legitimately cross-domain and every
-- internal role has a reason to read some slice of it — there is no OTHER
-- permission in 002's matrix that narrows core.events without also hiding a
-- role's own-domain events from them, so this table gets a bespoke
-- role-name policy instead of the permission-gate mechanism: CLIENT
-- specifically excluded (the H1 shape this migration exists to close —
-- CLIENT could otherwise read core.events under 014's blanket tenant-select
-- exactly as it could core.approval_requests), AGENT untouched (AGENT
-- principals act through service_role/SECURITY DEFINER paths that bypass
-- RLS entirely — grepped, no PostgREST-reachable RPC or view puts an AGENT
-- JWT in a position to hit this policy today, so excluding AGENT here would
-- be speculative rather than closing a demonstrated hole).
DROP POLICY IF EXISTS events_no_client_033 ON core.events;
CREATE POLICY events_no_client_033 ON core.events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT app.role()) IS DISTINCT FROM 'CLIENT')
  WITH CHECK ((SELECT app.role()) IS DISTINCT FROM 'CLIENT');

COMMENT ON POLICY events_no_client_033 ON core.events IS
  '033 (H1, bespoke — see this migration''s header for why apply_tenant_'
  'policies refuses a permission-based gate here). RESTRICTIVE, ANDed with '
  'events_tenant_isolation (014, unchanged, still ungated on permission — '
  'only this policy narrows). Excludes CLIENT only.';

-- ═══ H4 · MY_ACCOUNTS narrowing, role-gated (see header) ══════════════════

DROP POLICY IF EXISTS organisations_my_accounts_narrow_033 ON core.organisations;
CREATE POLICY organisations_my_accounts_narrow_033 ON core.organisations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT app.role()) NOT IN ('SALES','SALES_MANAGER')
    OR (SELECT app.can_see_owner(owner_id))
  )
  WITH CHECK (
    (SELECT app.role()) NOT IN ('SALES','SALES_MANAGER')
    OR (SELECT app.can_see_owner(owner_id))
  );

COMMENT ON POLICY organisations_my_accounts_narrow_033 ON core.organisations IS
  '033 (H4). RESTRICTIVE, ANDed with organisations_tenant_isolation. Only '
  'SALES/SALES_MANAGER (002 §11''s ○ mark) are narrowed; every other role '
  'that holds organisation:read passes this policy unconditionally.';

DROP POLICY IF EXISTS opportunities_my_accounts_narrow_033 ON core.opportunities;
CREATE POLICY opportunities_my_accounts_narrow_033 ON core.opportunities
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT app.role()) NOT IN ('SALES','SALES_MANAGER')
    OR (SELECT app.can_see_owner(owner_id))
  )
  WITH CHECK (
    (SELECT app.role()) NOT IN ('SALES','SALES_MANAGER')
    OR (SELECT app.can_see_owner(owner_id))
  );

COMMENT ON POLICY opportunities_my_accounts_narrow_033 ON core.opportunities IS
  '033 (H4). Same shape as organisations_my_accounts_narrow_033, keyed on '
  'opportunities.owner_id.';

DROP POLICY IF EXISTS enquiries_my_accounts_narrow_033 ON core.enquiries;
CREATE POLICY enquiries_my_accounts_narrow_033 ON core.enquiries
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT app.role()) NOT IN ('SALES','SALES_MANAGER')
    OR assigned_to_user_id IS NULL
    OR (SELECT app.can_see_owner(assigned_to_user_id))
  )
  WITH CHECK (
    (SELECT app.role()) NOT IN ('SALES','SALES_MANAGER')
    OR assigned_to_user_id IS NULL
    OR (SELECT app.can_see_owner(assigned_to_user_id))
  );

COMMENT ON POLICY enquiries_my_accounts_narrow_033 ON core.enquiries IS
  '033 (H4). assigned_to_user_id is nullable: an unassigned enquiry stays '
  'visible to a MY_ACCOUNTS SALES/SALES_MANAGER caller (an unclaimed-enquiry '
  'inbox they could no longer see would be a functional regression, not a '
  'security fix) — narrowing only ever removes rows that ARE assigned to '
  'someone else.';

-- ═══ M4 · public.user_profiles, self-or-ADMIN/MD, not tenant-blanket ══════

DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
CREATE POLICY user_profiles_select ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    AND (user_id = (SELECT auth.uid()) OR (SELECT app.role()) IN ('ADMIN','MD'))
  );

COMMENT ON POLICY user_profiles_select ON public.user_profiles IS
  '002, narrowed by 033 (M4). Was blanket tenant-membership; grepped '
  'apps/web/src for a cross-user user_profiles read and found none — every '
  'screen that names another user does so through a denormalised text '
  'column or a different join, never this table. Shape now matches '
  'user_profiles_update_self_or_admin (002:759), which was already '
  'self-or-ADMIN. MD added alongside ADMIN (the update policy is ADMIN-only; '
  'a read-only widening to the other role that already sees every other '
  'sensitive table in 033 is lower-risk than leaving MD unable to see a '
  'colleague''s profile ADMIN can).';

-- ═══ Verify ═════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_bad       text[];
  v_predicate text;
BEGIN
  -- V1 · every table in the mapping now carries a has_permission gate in its
  -- tenant_isolation policy, stamped by app.apply_tenant_policies (which
  -- itself refuses to build one that does not narrow — see 014).
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
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_policy p
      WHERE p.polrelid = pg_catalog.to_regclass('core.' || g.relname)
        AND p.polname = g.relname || '_tenant_isolation'
        AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%has_permission%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '033 verify V1: table(s) without a has_permission gate: %', v_bad;
  END IF;

  -- V2 · CLIENT and AGENT hold none of the 28 permissions used above (so RLS
  -- refuses both on every one of these tables) — the H1 claim, checked
  -- rather than assumed.
  IF EXISTS (
    SELECT 1 FROM app.role_permissions rp
     WHERE rp.role IN ('CLIENT','AGENT')
       AND rp.permission IN ('approval:read','quotation:read',
         'discount:approve','invoice:read','collection:read','contact:read',
         'contact:consent:read','organisation:read','opportunity:read',
         'enquiry:read','proposal:read','ai:budget:read','ai:tier:read'))
  THEN
    RAISE EXCEPTION
      '033 verify V2: CLIENT or AGENT holds one of the 033 permissions — the '
      'gate would not refuse them and H1''s CLIENT example would still leak';
  END IF;

  -- V2b · core.events: CLIENT specifically refused by the bespoke policy
  -- (not via has_permission — see the header for why audit:read cannot gate
  -- this table).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'core.events'::regclass
         AND p.polname = 'events_no_client_033' AND NOT p.polpermissive)
  THEN
    RAISE EXCEPTION '033 verify V2b: events_no_client_033 is missing or not RESTRICTIVE';
  END IF;
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) INTO v_predicate
    FROM pg_catalog.pg_policy p
   WHERE p.polrelid = 'core.events'::regclass AND p.polname = 'events_no_client_033';
  IF pg_catalog.strpos(v_predicate, 'CLIENT') = 0 THEN
    RAISE EXCEPTION '033 verify V2b: events_no_client_033 predicate is missing CLIENT: %', v_predicate;
  END IF;

  -- V3 · the three narrowing policies exist, are RESTRICTIVE, and mention
  -- both the role check and can_see_owner.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'core.organisations'::regclass
         AND p.polname = 'organisations_my_accounts_narrow_033' AND NOT p.polpermissive)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'core.opportunities'::regclass
         AND p.polname = 'opportunities_my_accounts_narrow_033' AND NOT p.polpermissive)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'core.enquiries'::regclass
         AND p.polname = 'enquiries_my_accounts_narrow_033' AND NOT p.polpermissive)
  THEN
    RAISE EXCEPTION '033 verify V3: a MY_ACCOUNTS narrowing policy is missing or not RESTRICTIVE';
  END IF;

  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) INTO v_predicate
    FROM pg_catalog.pg_policy p
   WHERE p.polrelid = 'core.organisations'::regclass
     AND p.polname = 'organisations_my_accounts_narrow_033';
  IF pg_catalog.strpos(v_predicate, 'can_see_owner') = 0
     OR pg_catalog.strpos(v_predicate, 'SALES_MANAGER') = 0
  THEN
    RAISE EXCEPTION '033 verify V3b: organisations narrowing predicate is missing an expected term: %', v_predicate;
  END IF;

  -- V4 · public.user_profiles_select no longer admits every tenant member.
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) INTO v_predicate
    FROM pg_catalog.pg_policy p
   WHERE p.polrelid = 'public.user_profiles'::regclass AND p.polname = 'user_profiles_select';
  IF v_predicate IS NULL OR pg_catalog.strpos(v_predicate, 'auth.uid') = 0 THEN
    RAISE EXCEPTION '033 verify V4: user_profiles_select is still tenant-blanket: %', v_predicate;
  END IF;

  -- V5 · the security_invoker views over these tables did not lose their
  -- flag (belt under 014's own §2 check, re-run here since 033 is the
  -- migration that changes what those views' underlying RLS admits).
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relkind = 'v'
       AND NOT ('security_invoker=true' = ANY (COALESCE(c.reloptions, ARRAY[]::text[]))))
  THEN
    RAISE EXCEPTION '033 verify V5: a core view lost security_invoker=true';
  END IF;
END
$verify$;

COMMIT;
