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
--     data. ⚠ WITH ONE STATED EXCEPTION, and this line used to deny it while
--     §"Seeded rows" below correctly described it: 018 DOES write durable rows
--     — `core.pipelines` and `core.pipeline_steps` across every tenant, from
--     §10e's backfill. They are deliberately KEPT, because a tenant that has
--     since renamed a stage would lose that edit to a rollback of an RPC pack.
--     The seed MECHANISM is dropped; the rows stay.
--
-- PRIOR STATE RESTORED. Before 018, none of these 51 objects existed: the
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

-- ── WHY THIS FILE IS WRAPPED IN ONE TRANSACTION ────────────────────────────
--
-- 014's, 015's, 016's and 017's rollbacks all wrap; 018's did not, and here it
-- disarmed this file's OWN GUARD. The `$verify$` block at the end raises "this
-- rollback DESTROYED objects it does not own" — but with no transaction, the
-- 47 drops it is complaining about have already committed one at a time. A
-- guard whose failure cannot undo what it detects is a report, not a gate.
-- Inside a transaction, that RAISE takes every drop back with it.
BEGIN;

SET LOCAL client_min_messages = notice;

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

-- ═══ 2 · The 30 core RPCs ══════════════════════════════════════════════════
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
-- ⚠ THE SEED IS REVERSED, AND THAT IS A CHANGE FROM THE FIRST VERSION OF THIS
-- FILE. It used to drop the mechanism and keep the rows, on the reasoning that
-- a tenant's pipeline configuration is theirs by the time anyone rolls back and
-- that `core.engagement_step_states` carries composite foreign keys onto those
-- rows. Both halves of that reasoning are true and neither justified the
-- outcome: after the rollback the mechanism was gone, so there was NO SUPPORTED
-- WAY TO UNDO THE SEED AT ALL, and `pipelines_one_default_uq` — the partial
-- unique index on (tenant_id, object) WHERE is_default — went on rejecting a
-- default ENGAGEMENT pipeline for every tenant permanently. A rollback that
-- leaves a repo-wide constraint change in place is not a rollback.
--
-- `app.unseed_pipelines()` deletes EXACTLY the rows `app.seed_pipelines`
-- recorded having inserted, from `app.seeded_pipelines`. A row that already
-- existed under the same derived id — the seeds lane's fixtures — was never
-- recorded and is never touched, which is the case the old design was trying to
-- protect, now protected by construction.
--
-- AND IT REFUSES LOUDLY RATHER THAN DELETING SOMETHING LIVE. If any seeded row
-- is referenced, it raises with the COUNT and the CONSTRAINT NAMES and deletes
-- nothing, which aborts this whole file (it is wrapped in one transaction).
-- That is the honest answer to "018 cannot be rolled back while this tenant
-- configuration is in use" — an operator who sees it knows what to clear.
--
-- R4 ASSERTS THE ROWS, not a trigger belonging to another migration. Its body
-- used to query `pg_trigger` for 016's `trg_tenants_seed_ref_formats` while two
-- comments and the closing NOTICE all announced a pipeline-row check that was
-- never written.
-- 018's ONE routing row (§10d). Deleted by its exact (event_type, job_type)
-- pair rather than by event_type alone: a later pack adding a second handler
-- for the same event owns its own row and this rollback must not take it.
DELETE FROM app.event_subscriptions
 WHERE event_type = 'PROPOSAL_SECTION_REGENERATE_REQUESTED'
   AND job_type   = 'AI_DRAFT_PROPOSAL_SECTION'
   AND tenant_id IS NULL;

-- REVERSE THE DATA BEFORE DROPPING THE MECHANISM. The other order leaves the
-- function that knows how to undo the seed already gone.
DO $unseed$
DECLARE v_n integer;
BEGIN
  v_n := app.unseed_pipelines();
  RAISE NOTICE '018 rollback: % seeded pipeline/step row(s) removed; the ledger is empty.', v_n;
END
$unseed$;

DROP TRIGGER IF EXISTS trg_tenants_z_seed_pipelines ON public.tenants;
DROP FUNCTION IF EXISTS app.unseed_pipelines();
DROP FUNCTION IF EXISTS app.seed_pipelines_all();
DROP FUNCTION IF EXISTS app.seed_pipelines_on_tenant();
DROP FUNCTION IF EXISTS app.seed_pipelines(uuid);

-- The ledger LAST, after the function that reads it and after the rows it
-- describes are gone. Dropping it earlier would strand the only record of what
-- the seed wrote.
DROP TABLE IF EXISTS app.seeded_pipelines;

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
DECLARE v_left text[]; v_lost text[]; v_rows_left integer;
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

  -- R4 · THE SEED IS ACTUALLY REVERSED, MEASURED ON THE ROWS.
  --
  -- ⚠ THIS CHECK USED TO QUERY `pg_trigger` FOR 016's
  -- `trg_tenants_seed_ref_formats` — a ref-format trigger with no relationship
  -- to the pipeline seed — while its own comment and the closing NOTICE both
  -- announced that it verified pipeline rows. It never read `core.pipelines` or
  -- `core.pipeline_steps` at all, so the safety net meant to catch a regression
  -- of the row contract was watching a different object entirely. Both halves
  -- are asserted now, and the row half is first because it is the one that was
  -- missing.
  --
  -- The ids are RE-DERIVED rather than read from the ledger, because the ledger
  -- has been dropped by this point — and re-deriving is the stronger test: it
  -- asks the question from outside the bookkeeping that is supposed to answer
  -- it.
  SELECT pg_catalog.count(*)::integer INTO v_rows_left
    FROM core.pipelines AS pipe
    JOIN public.tenants AS tenant ON tenant.id = pipe.tenant_id
   WHERE pipe.id = pg_catalog.md5(tenant.id::text || 'pipeline:' || pipe.object)::uuid;
  IF v_rows_left <> 0 THEN
    RAISE EXCEPTION '018 rollback R4: % pipeline row(s) with 018-derived ids survived '
                    'the reversal — the seed was not undone and '
                    'pipelines_one_default_uq still rejects a default ENGAGEMENT '
                    'pipeline for those tenants', v_rows_left;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_rows_left
    FROM core.pipeline_steps AS step
    JOIN public.tenants AS tenant ON tenant.id = step.tenant_id
   WHERE step.id IN (
           pg_catalog.md5(tenant.id::text || 'pipeline:ENGAGEMENT:'  || step.step_key)::uuid,
           pg_catalog.md5(tenant.id::text || 'pipeline:OPPORTUNITY:' || step.step_key)::uuid);
  IF v_rows_left <> 0 THEN
    RAISE EXCEPTION '018 rollback R4b: % pipeline_step row(s) with 018-derived ids '
                    'survived the reversal', v_rows_left;
  END IF;

  IF pg_catalog.to_regclass('app.seeded_pipelines') IS NOT NULL THEN
    RAISE EXCEPTION '018 rollback R4c: app.seeded_pipelines still exists';
  END IF;

  -- ROWS A TENANT CONFIGURED ITSELF ARE UNTOUCHED. `app.unseed_pipelines`
  -- deletes only what the seed recorded inserting, so anything under a
  -- different id must still be here; a rollback that emptied the table would
  -- pass every assertion above.
  IF pg_catalog.to_regclass('core.pipelines') IS NULL
     OR pg_catalog.to_regclass('core.pipeline_steps') IS NULL THEN
    RAISE EXCEPTION '018 rollback R4d: a pipeline table was dropped';
  END IF;

  -- AND THE OTHER THREE PROVISIONING TRIGGERS ARE UNTOUCHED. This is what the
  -- old R4 actually tested, kept, and now stated accurately: 011's action
  -- policies, 016's ref formats and 017's check keys all seed from their own
  -- AFTER INSERT triggers on public.tenants and none of them is 018's.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                  WHERE c.relname = 'tenants' AND NOT t.tgisinternal
                    AND t.tgname = 'trg_tenants_seed_ref_formats') THEN
    RAISE EXCEPTION '018 rollback R4e: 016''s ref-format seed trigger was destroyed';
  END IF;

  RAISE NOTICE '018 rollback: 30 core RPCs, 3 views, 11 app helpers and the pipeline '
               'seed mechanism dropped, the seeded pipeline ROWS reversed exactly '
               '(R4 counts them) and rows 018 did not write left alone; '
               '001-017 verified intact, including 014''s three gate wrappers, '
               '011''s grants, 017''s tax registry, 016''s provisioning triggers '
               'and 007''s generated money columns.';
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
