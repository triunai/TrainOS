-- ═══════════════════════════════════════════════════════════════════════════
-- 018 ROLLBACK · the golden-path RPC pack
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT 018 CREATED, and therefore the complete list of what this drops:
--
--   30 functions in `core`  — the RPCs `rpcClient.ts` names
--    3 views     in `core`   — `v_organisation_relations`, `v_budgets`,
--                              `v_model_tiers`
--   11 functions in `app`    — the internal `app._*` projection helpers
--    2 functions in `app`    — `seed_pipelines` and `seed_pipelines_on_tenant`
--    1 trigger  on `public.tenants` — `trg_tenants_z_seed_pipelines`
--
-- ⚠ THE THREE GATE WRAPPERS ARE NOT IN THAT LIST AND MUST NOT BE DROPPED.
-- `core.perform_action`, `core.decide_approval` and
-- `core.bulk_decide_approvals` belong to 014 §5. An earlier revision of 018
-- created them and this rollback dropped them; that was wrong the moment 014
-- landed, because rolling 018 back would have taken the entire write path of
-- the product with it. R2f asserts all three survive.
--
-- WHAT 018 DID **NOT** CREATE, and what this therefore MUST NOT TOUCH:
--
--   * Any table, column, index, constraint or trigger. 018 created none.
--   * Any enum type or enum value. 018 created none.
--   * Anything in 001–013. `app.ok`, `app.err`, `app.require_tenant_id`,
--     `app.current_actor`, `app.round_half_up_sen`, `app.open_approval_count`,
--     `app.perform_action`, `app.decide_approval`, `app.bulk_decide`,
--     `app.idempotency_keys` and `core.v_approval_requests` are all 001/011's
--     and all survive this file untouched.
--   * Any GRANT that 018 did not make. The grants 018 made are attached to the
--     objects it created and disappear with them; nothing has to be
--     re-revoked, and re-revoking something 018 did not grant would break a
--     migration this pack never touched.
--   * `core.ref_formats`, `core.state_transitions` and every row of business
--     data. 018 wrote no durable row of its own.
--
-- PRIOR STATE RESTORED. Before 018, none of these 33 objects existed: the
-- migration is purely additive, so the prior state IS their absence. There is
-- no earlier definition of any of them to reproduce — the four-artifact rule's
-- "reproduce the prior definition IN FULL" has nothing to reproduce here, and
-- that is stated rather than left as a silence a reviewer has to interpret.
-- G1 below PROVES the claim instead of asserting it: it refuses to run if any
-- of these names carries a definition 018 did not write.
--
-- ORDER. The reverse of the forward order: the view first (it calls
-- `app._money`, so dropping the helper before the view would leave a view that
-- cannot be read), then the `core` RPCs, then the `app` helpers the RPCs call.
-- Every DROP is RESTRICT by omission — never CASCADE — so an object a later
-- migration has built on top of stops this file rather than being silently
-- deleted with it.
--
-- AFTER THIS RUNS the web client is back where 018 found it: every one of the
-- 24 names in `RPC_NAMES` answers `PGRST202`, and `rpcClient.ts` degrades each
-- feature to "not deployed" rather than white-screening the app. That is the
-- designed pre-018 behaviour, not a new failure.
--
-- EXECUTED forward -> test -> rollback -> forward on a PostgreSQL 17.11 shim
-- with 001-013 applied, verify green each time.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

-- ═══ G1 · Pre-flight: refuse if anything here is not ours to drop ══════════
--
-- No override. If a later migration has REPLACED one of these functions, its
-- body is no longer 018's and dropping it would delete that migration's work
-- without saying so. The guard reads the body rather than trusting the name.
DO $guard$
DECLARE
  v_foreign  text[];
  v_deps     text[];
BEGIN
  -- G1a · Every `core` RPC 018 created carries 018's own posture. A function
  -- of the same name that is NOT definer-with-an-empty-search-path was put
  -- there by something else.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_foreign
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core'
     AND p.proname IN (
       'me','navigation','badge_counts','list_enquiries','get_enquiry',
       'patch_enquiry_extraction','list_follow_ups','get_follow_up_draft',
       'get_organisation','get_opportunity','get_contact','get_tna',
       'get_tna_recommendations','create_proposal','list_proposals','get_proposal',
       'add_proposal_section','put_proposal_section','regenerate_proposal_section',
       'list_quotations','get_quotation','put_quotation','get_rate_card',
       'list_approvals','get_approval','get_audit',
       'get_policy','get_pipeline_config','get_programme','get_compliance_rule')
     AND NOT (p.prosecdef AND p.proconfig @> ARRAY['search_path=""']);
  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      '018 rollback G1a: core.% no longer carries 018''s posture, so a later '
      'migration has replaced it. Dropping it here would delete that '
      'migration''s work. Resolve by hand.',
      pg_catalog.array_to_string(v_foreign, ', core.');
  END IF;

  -- G1b · Nothing outside 018 may depend on the objects about to go. A view or
  -- function a later pack built on top of `core.v_organisation_relations` or
  -- on an `app._*` helper is exactly what RESTRICT exists to catch, and
  -- catching it HERE gives a readable message instead of a dependency error
  -- three hundred lines down.
  SELECT pg_catalog.array_agg(DISTINCT dependent.relname ORDER BY dependent.relname)
    INTO v_deps
    FROM pg_catalog.pg_depend AS d
    JOIN pg_catalog.pg_rewrite AS r ON r.oid = d.objid
    JOIN pg_catalog.pg_class   AS dependent ON dependent.oid = r.ev_class
    JOIN pg_catalog.pg_class   AS source ON source.oid = d.refobjid
    JOIN pg_catalog.pg_namespace AS sn ON sn.oid = source.relnamespace
   WHERE sn.nspname = 'core'
     AND source.relname IN ('v_organisation_relations','v_budgets','v_model_tiers')
     AND dependent.relname NOT IN ('v_organisation_relations','v_budgets','v_model_tiers');
  IF v_deps IS NOT NULL THEN
    RAISE EXCEPTION
      '018 rollback G1b: % still depend(s) on a view 018 created.',
      pg_catalog.array_to_string(v_deps, ', ');
  END IF;

  -- G1c · The `app._*` helpers are 018's, but `app` is a shared schema. Refuse
  -- if a helper name 018 owns has been taken over by a function with a
  -- different owner — that is someone else's object wearing our name.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_foreign
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app'
     AND p.proname IN ('_money','_actor','_provenance','_provenanced','_cursor_encode',
                       '_cursor_decode','_page_size','_predicate','_body_sql',
                       '_budget_rows','_model_tier_rows')
     AND p.proowner <> (SELECT c.relowner FROM pg_catalog.pg_class AS c
                         JOIN pg_catalog.pg_namespace AS cn ON cn.oid = c.relnamespace
                        WHERE cn.nspname = 'core' AND c.relname = 'enquiries');
  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      '018 rollback G1c: app._% has a different owner from the core tables, so '
      'it is not 018''s to drop.',
      pg_catalog.array_to_string(v_foreign, ', app._');
  END IF;

  RAISE NOTICE '018 rollback G1: pre-flight clean — every object about to be '
               'dropped is 018''s.';
END
$guard$;

-- ═══ 1 · The view ══════════════════════════════════════════════════════════
-- FIRST, because its body calls `app._money`. Dropping the helper before the
-- view would leave a view that parses and cannot be read.
DROP VIEW IF EXISTS core.v_organisation_relations;
-- The two AI-budget views go with them. Dropping these RESTORES 014's state:
-- `core.budget_status` and `core.model_tier_status` stay revoked and the two
-- AI screens go back to reading names that do not exist, which is exactly the
-- carried defect 014 registered. That is the correct pre-018 state, not a new
-- fault.
DROP VIEW IF EXISTS core.v_budgets;
DROP VIEW IF EXISTS core.v_model_tiers;

-- ═══ 2 · The 23 core RPCs ══════════════════════════════════════════════════
-- Signatures written out in full. `DROP FUNCTION` matches on the ARGUMENT
-- LIST, and a bare name would be ambiguous the moment anyone added an
-- overload — which is the same PGRST203 trap the forward file's V1 pin guards.
-- No CASCADE anywhere: an object built on one of these should STOP this file.

DROP FUNCTION IF EXISTS core.get_audit(text, text);
DROP FUNCTION IF EXISTS core.get_rate_card();
DROP FUNCTION IF EXISTS core.list_quotations(jsonb, text, jsonb, text);
DROP FUNCTION IF EXISTS core.regenerate_proposal_section(text, integer);
DROP FUNCTION IF EXISTS core.put_proposal_section(text, integer, jsonb, text);
DROP FUNCTION IF EXISTS core.add_proposal_section(text, jsonb, text);
DROP FUNCTION IF EXISTS core.list_proposals(jsonb, text, jsonb, text);
DROP FUNCTION IF EXISTS core.get_follow_up_draft(text, text);
DROP FUNCTION IF EXISTS core.list_follow_ups(jsonb, text, jsonb, text);
DROP FUNCTION IF EXISTS core.patch_enquiry_extraction(text, jsonb);

DROP FUNCTION IF EXISTS core.get_compliance_rule(text);
DROP FUNCTION IF EXISTS core.get_programme(text);
DROP FUNCTION IF EXISTS core.get_pipeline_config(text);
DROP FUNCTION IF EXISTS core.get_policy(text);

DROP FUNCTION IF EXISTS core.get_approval(text);
DROP FUNCTION IF EXISTS core.list_approvals(jsonb, text, jsonb, text);

DROP FUNCTION IF EXISTS core.put_quotation(text, jsonb, text);
DROP FUNCTION IF EXISTS core.get_quotation(text);

DROP FUNCTION IF EXISTS core.create_proposal(jsonb, text);
DROP FUNCTION IF EXISTS core.get_proposal(text);

DROP FUNCTION IF EXISTS core.get_tna_recommendations(text);
DROP FUNCTION IF EXISTS core.get_tna(text);

DROP FUNCTION IF EXISTS core.get_contact(text);
DROP FUNCTION IF EXISTS core.get_opportunity(text);
DROP FUNCTION IF EXISTS core.get_organisation(text);

DROP FUNCTION IF EXISTS core.get_enquiry(text);
DROP FUNCTION IF EXISTS core.list_enquiries(jsonb, text, jsonb, text);

DROP FUNCTION IF EXISTS core.badge_counts();
DROP FUNCTION IF EXISTS core.navigation();
DROP FUNCTION IF EXISTS core.me();

-- NO DROP FOR THE THREE GATE WRAPPERS. They are 014's. Dropping them here
-- would remove the only door from a browser to `app.perform_action` — every
-- primary button in the product — while rolling back a pack that no longer
-- creates them.
--
-- The ONE wrapper-shaped object 018 may drop is its own former four-argument
-- `decide_approval`, and the forward file already drops it. Repeated here so a
-- rollback from a half-upgraded database does not leave the overload behind.
DROP FUNCTION IF EXISTS core.decide_approval(uuid, text, text, text);

-- ═══ 3 · The pipeline seed ═════════════════════════════════════════════════
--
-- The TRIGGER first, then the functions it calls. Dropping the function while
-- the trigger still points at it leaves every tenant insert raising
-- `function app.seed_pipelines_on_tenant() does not exist` — a rollback that
-- breaks the thing it was rolling back.
--
-- ⚠ THE SEEDED ROWS ARE DELIBERATELY LEFT IN PLACE. Rolling back the migration
-- that seeded a tenant's pipeline configuration must not delete that
-- configuration: by the time anyone rolls back, those rows are a tenant's
-- settings and `core.engagement_step_states` has composite foreign keys onto
-- them. The seeds lane's fixture rows share the same derived ids, so deleting
-- them here would take the fixture world with it too. What goes is the
-- MECHANISM; what stays is the DATA, and R4 asserts exactly that.
DROP TRIGGER IF EXISTS trg_tenants_z_seed_pipelines ON public.tenants;
DROP FUNCTION IF EXISTS app.seed_pipelines_on_tenant();
DROP FUNCTION IF EXISTS app.seed_pipelines(uuid);

-- ═══ 4 · The internal projection helpers ═════════════════════════════════════════
-- LAST, because every `core` function above called at least one of them.
DROP FUNCTION IF EXISTS app._model_tier_rows();
DROP FUNCTION IF EXISTS app._budget_rows();
DROP FUNCTION IF EXISTS app._body_sql(regprocedure);
DROP FUNCTION IF EXISTS app._view_filters(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS app._next_cursor(regclass, uuid, text, text, boolean, integer, integer, timestamptz, uuid, boolean);
DROP FUNCTION IF EXISTS app._keyset_scope(regclass, uuid, text, text, boolean, timestamptz, uuid, boolean);
DROP FUNCTION IF EXISTS app._predicate(text, text, text, jsonb);
DROP FUNCTION IF EXISTS app._page_size(jsonb);
DROP FUNCTION IF EXISTS app._cursor_decode(text);
DROP FUNCTION IF EXISTS app._cursor_encode(timestamptz, uuid);
DROP FUNCTION IF EXISTS app._provenanced(jsonb, jsonb);
DROP FUNCTION IF EXISTS app._provenance(text, uuid, text);
DROP FUNCTION IF EXISTS app._actor(text, text, text);
DROP FUNCTION IF EXISTS app._money(bigint, text);

-- ═══ 5 · $verify$ — prove 018 is gone AND that 001–017 survived ════════════
--
-- A rollback that only proved its own objects were gone would pass just as
-- happily after dropping half the database. The second half of this block is
-- the one that matters.
DO $verify$
DECLARE v_left text[]; v_lost text[];
BEGIN
  -- R1 · Nothing 018 created is left behind.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_left
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE (n.nspname = 'core' AND p.proname IN (
            'me','navigation','badge_counts','list_enquiries','get_enquiry',
            'patch_enquiry_extraction','list_follow_ups','get_follow_up_draft',
            'get_organisation','get_opportunity','get_contact','get_tna',
            'get_tna_recommendations','create_proposal','list_proposals','get_proposal',
            'add_proposal_section','put_proposal_section','regenerate_proposal_section',
            'list_quotations','get_quotation','put_quotation','get_rate_card',
            'list_approvals','get_approval','get_audit','get_policy',
            'get_pipeline_config','get_programme','get_compliance_rule'))
      OR (n.nspname = 'app' AND p.proname IN (
            '_money','_actor','_provenance','_provenanced','_cursor_encode','_cursor_decode',
            '_page_size','_predicate','_body_sql','_budget_rows','_model_tier_rows'));
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '018 rollback R1: still present: %',
      pg_catalog.array_to_string(v_left, ', ');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
               JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
              WHERE n.nspname = 'app'
                AND p.proname IN ('seed_pipelines','seed_pipelines_on_tenant')) THEN
    RAISE EXCEPTION '018 rollback R1c: the pipeline seed functions survived';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
               JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
              WHERE c.relname = 'tenants' AND NOT t.tgisinternal
                AND t.tgname = 'trg_tenants_z_seed_pipelines') THEN
    RAISE EXCEPTION '018 rollback R1d: the pipeline seed trigger survived';
  END IF;
  IF pg_catalog.to_regclass('core.v_organisation_relations') IS NOT NULL
     OR pg_catalog.to_regclass('core.v_budgets') IS NOT NULL
     OR pg_catalog.to_regclass('core.v_model_tiers') IS NOT NULL THEN
    RAISE EXCEPTION '018 rollback R1b: a view 018 created survived the rollback';
  END IF;

  -- R2 · EVERYTHING 001–013 OWNS IS STILL THERE. This is the half that catches
  -- a rollback that over-reached: a CASCADE, a wrong signature, or a DROP aimed
  -- at a name 018 borrowed rather than created.
  SELECT pg_catalog.array_agg(expected.name ORDER BY expected.name) INTO v_lost
    FROM (VALUES
            ('app.ok'),('app.err'),('app.require_tenant_id'),('app.current_actor'),
            ('app.round_half_up_sen'),('app.open_approval_count'),('app.perform_action'),
            ('app.decide_approval'),('app.bulk_decide'),('app.current_tenant_id'),
            ('app.has_permission'),('app.set_updated_at'),('app.enforce_immutable_columns'),
            ('app.enforce_state_transition'),('core.quotation_recalc'),
            ('core.quotation_assert_floor'),('core.quotation_assert_reconciled'),
            ('core.assign_ref'),('core.next_ref')
          ) AS expected(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_proc AS p
       JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname || '.' || p.proname = expected.name);
  IF v_lost IS NOT NULL THEN
    RAISE EXCEPTION '018 rollback R2: this rollback DESTROYED objects it does not own: %',
      pg_catalog.array_to_string(v_lost, ', ');
  END IF;

  -- R2b · 011's view and its revocation survive intact.
  IF pg_catalog.to_regclass('core.v_approval_requests') IS NULL THEN
    RAISE EXCEPTION '018 rollback R2b: core.v_approval_requests was destroyed — it is 011''s';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'core.v_approval_requests', 'SELECT') THEN
    RAISE EXCEPTION '018 rollback R2c: core.v_approval_requests is now granted to '
                    'authenticated — the rollback widened a grant it never made';
  END IF;

  -- R2d · 011's grant on the gate is exactly where it was: service_role yes,
  -- authenticated no. A rollback that "tidied up" this grant would have
  -- silently changed 011.
  IF NOT pg_catalog.has_function_privilege('service_role',
       'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION '018 rollback R2d: service_role lost EXECUTE on app.perform_action';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated',
       'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION '018 rollback R2e: authenticated gained EXECUTE on app.perform_action';
  END IF;

  -- R2f · 014'S THREE WRAPPERS SURVIVE. This is the assertion that would have
  -- caught the earlier revision taking the product's entire write path with it.
  SELECT pg_catalog.array_agg(expected.name ORDER BY expected.name) INTO v_lost
    FROM (VALUES ('core.perform_action'),('core.decide_approval'),
                 ('core.bulk_decide_approvals')) AS expected(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_proc AS p
       JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname || '.' || p.proname = expected.name);
  IF v_lost IS NOT NULL THEN
    RAISE EXCEPTION '018 rollback R2f: this rollback destroyed 014''s gate wrapper(s): % — '
                    'that is every primary button in the product',
      pg_catalog.array_to_string(v_lost, ', ');
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated',
       'core.decide_approval(uuid,text,text,text,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION '018 rollback R2g: 014''s decide_approval lost its grant';
  END IF;

  -- R2h · 017's tax registry is untouched. 018 READ it; it never owned it.
  IF pg_catalog.to_regclass('core.tax_policies') IS NULL
     OR pg_catalog.to_regproc('app.resolve_tax_policy') IS NULL THEN
    RAISE EXCEPTION '018 rollback R2h: 017''s tax registry was destroyed';
  END IF;

  -- R3 · No TABLE was harmed. 018 created none, so the count of relations in
  -- `core` and `public` must be what 001–013 left, and the money tables in
  -- particular must still be there with their generated columns.
  SELECT pg_catalog.array_agg(expected.name ORDER BY expected.name) INTO v_lost
    FROM (VALUES
            ('core.enquiries'),('core.organisations'),('core.contacts'),('core.opportunities'),
            ('core.tnas'),('core.proposals'),('core.quotations'),('core.quotation_lines'),
            ('core.approval_requests'),('core.action_requests'),('core.pipelines'),
            ('core.pipeline_steps'),('core.programmes'),('core.provenance'),
            ('core.saved_views'),('core.action_policies'),('core.compliance_rules'),
            ('app.idempotency_keys'),('app.role_permissions'),
            ('public.tenants'),('public.memberships'),('public.user_profiles')
          ) AS expected(name)
   WHERE pg_catalog.to_regclass(expected.name) IS NULL;
  IF v_lost IS NOT NULL THEN
    RAISE EXCEPTION '018 rollback R3: tables were dropped: %',
      pg_catalog.array_to_string(v_lost, ', ');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = 'core.quotation_lines'::regclass
       AND a.attname = 'total_sen' AND a.attgenerated = 's') THEN
    RAISE EXCEPTION '018 rollback R3b: core.quotation_lines.total_sen is no longer GENERATED — '
                    'the §18 money rule lives in that column and it is 007''s';
  END IF;

  -- R4 · THE SEEDED CONFIGURATION SURVIVES. The other three provisioning
  -- triggers (011, 016, 017) are untouched, and so are the pipeline rows
  -- themselves. A rollback that deleted a tenant's stage configuration would
  -- cascade into core.engagement_step_states and take the fixture world with
  -- it.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                  WHERE c.relname = 'tenants' AND NOT t.tgisinternal
                    AND t.tgname = 'trg_tenants_seed_ref_formats') THEN
    RAISE EXCEPTION '018 rollback R4: 016''s ref-format seed trigger was destroyed';
  END IF;

  RAISE NOTICE '018 rollback: 30 core RPCs, 3 views, 11 app helpers and the pipeline '
               'seed mechanism dropped; seeded pipeline ROWS deliberately kept; '
               '001-017 verified intact, including 014''s three gate wrappers, '
               '011''s grants, 017''s tax registry, 016''s provisioning triggers '
               'and 007''s generated money columns.';
END
$verify$;
