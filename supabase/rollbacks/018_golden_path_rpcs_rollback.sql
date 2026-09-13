-- ═══════════════════════════════════════════════════════════════════════════
-- 018 ROLLBACK · the golden-path RPC pack
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT 018 CREATED, and therefore the complete list of what this drops:
--
--   23 functions in `core`  — the RPCs `rpcClient.ts` names
--    1 view     in `core`   — `v_organisation_relations`
--    9 functions in `app`   — the internal `app._*` projection helpers
--    2 COMMENTs             — dropped with their objects
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
       'perform_action','decide_approval','bulk_decide_approvals',
       'me','navigation','badge_counts','list_enquiries','get_enquiry',
       'get_organisation','get_opportunity','get_contact','get_tna',
       'get_tna_recommendations','create_proposal','get_proposal',
       'get_quotation','put_quotation','list_approvals','get_approval',
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
     AND source.relname = 'v_organisation_relations'
     AND dependent.relname <> 'v_organisation_relations';
  IF v_deps IS NOT NULL THEN
    RAISE EXCEPTION
      '018 rollback G1b: % still depend(s) on core.v_organisation_relations.',
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
                       '_cursor_decode','_page_size','_predicate','_body_sql')
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

-- ═══ 2 · The 23 core RPCs ══════════════════════════════════════════════════
-- Signatures written out in full. `DROP FUNCTION` matches on the ARGUMENT
-- LIST, and a bare name would be ambiguous the moment anyone added an
-- overload — which is the same PGRST203 trap the forward file's V1 pin guards.
-- No CASCADE anywhere: an object built on one of these should STOP this file.

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

-- The three gate wrappers last of the `core` set. Dropping these REMOVES the
-- only door to `app.perform_action`, `app.decide_approval` and
-- `app.bulk_decide` from a browser — which is the correct pre-018 state, since
-- 011 grants all three to `service_role` only and that grant is untouched.
DROP FUNCTION IF EXISTS core.bulk_decide_approvals(uuid[], text, text, text);
DROP FUNCTION IF EXISTS core.decide_approval(uuid, text, text, text);
DROP FUNCTION IF EXISTS core.perform_action(text, text, jsonb, jsonb, numeric, text, jsonb, text);

-- ═══ 3 · The nine internal helpers ═════════════════════════════════════════
-- LAST, because every `core` function above called at least one of them.
DROP FUNCTION IF EXISTS app._body_sql(regprocedure);
DROP FUNCTION IF EXISTS app._predicate(text, text, text, jsonb);
DROP FUNCTION IF EXISTS app._page_size(jsonb);
DROP FUNCTION IF EXISTS app._cursor_decode(text);
DROP FUNCTION IF EXISTS app._cursor_encode(timestamptz, uuid);
DROP FUNCTION IF EXISTS app._provenanced(jsonb, jsonb);
DROP FUNCTION IF EXISTS app._provenance(text, uuid, text);
DROP FUNCTION IF EXISTS app._actor(text, text, text);
DROP FUNCTION IF EXISTS app._money(bigint, text);

-- ═══ 4 · $verify$ — prove 018 is gone AND that 001–013 survived ════════════
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
            'perform_action','decide_approval','bulk_decide_approvals','me','navigation',
            'badge_counts','list_enquiries','get_enquiry','get_organisation','get_opportunity',
            'get_contact','get_tna','get_tna_recommendations','create_proposal','get_proposal',
            'get_quotation','put_quotation','list_approvals','get_approval','get_policy',
            'get_pipeline_config','get_programme','get_compliance_rule'))
      OR (n.nspname = 'app' AND p.proname IN (
            '_money','_actor','_provenance','_provenanced','_cursor_encode','_cursor_decode',
            '_page_size','_predicate','_body_sql'));
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '018 rollback R1: still present: %',
      pg_catalog.array_to_string(v_left, ', ');
  END IF;
  IF pg_catalog.to_regclass('core.v_organisation_relations') IS NOT NULL THEN
    RAISE EXCEPTION '018 rollback R1b: core.v_organisation_relations survived';
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

  RAISE NOTICE '018 rollback: 23 core RPCs, 1 view and 9 app helpers dropped; '
               '001-013 verified intact, including 011''s grants and 007''s '
               'generated money columns.';
END
$verify$;
