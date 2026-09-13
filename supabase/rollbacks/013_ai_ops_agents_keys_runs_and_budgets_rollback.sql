-- ============================================================================
-- ROLLBACK 013 · ai_ops_agents_keys_runs_and_budgets
-- ============================================================================
--
-- Forward file: migrations/013_ai_ops_agents_keys_runs_and_budgets.sql
--
-- PRIOR STATE THIS RESTORES. The database as 012 left it: no agent roster, no
-- agent credential, no BYOK metadata, no model tiers, no routing matrix, no
-- budgets, no usage rollup, no credential audit, no run traces and no evals.
--
-- 012's app.is_valid_actor, app.reject_mutation and app.emit_event SURVIVE -
-- they are 012's and 013 only reused them. 011's app.aal2_verified, app.aal,
-- app.has_permission and core.autonomy_grants likewise. 003's fourteen AI enums
-- survive: 013 created no type at all, so there is none to drop, and dropping a
-- 003 enum here would take core.provenance.provider and core.suggested_drafts
-- with it.
--
-- ══ THE THREE PRIOR DEFINITIONS TO REPRODUCE ═══════════════════════════════
--
-- Reproduced IN FULL below rather than referenced, because a rollback that says
-- "see migration 007" depends on another file being readable at the moment you
-- need it, which is not a rollback.
--
-- 013 added ONE constraint to each of three tables it does not own. The tables
-- and their columns SURVIVE; only the constraint 013 added is dropped. Each was
-- left for 013 by name - 007 and 009 wrote the comment "FK added by 013" - so
-- dropping them returns those columns to being unconstrained uuids, exactly as
-- 007 and 009 created them.
--
--   1. core.provenance (007 s2), the run_id column and its index as created:
--
--        run_id         uuid,
--        ...
--        CONSTRAINT provenance_human_has_no_model
--          CHECK (origin <> 'HUMAN' OR (model IS NULL AND run_id IS NULL)),
--        ...
--        CREATE INDEX IF NOT EXISTS provenance_run_idx
--          ON core.provenance (tenant_id, run_id) WHERE run_id IS NOT NULL;
--
--      007 created that index. This file does NOT drop it - it is 007's, not
--      013's, and 013 only added the foreign key beside it.
--
--   2. core.proposals (007 s4), as created:
--
--        run_id          uuid,          -- FK added by 013, which creates core.runs
--
--      No index existed on it before 013. `proposals_run_idx` IS 013's and is
--      dropped here.
--
--   3. core.rule_change_sets (009 s5), as created:
--
--        run_id              uuid,          -- FK added by 013
--
--      No index existed on it before 013. `rule_change_sets_run_idx` IS 013's
--      and is dropped here.
--
-- Nothing else outside 013 was touched. No 011 or 012 function was edited, no
-- policy was added or removed, no enum was altered, and core.autonomy_grants
-- never received the agent_id foreign key it deliberately does not have.
--
-- ⛔ PRE-FLIGHT. Six guards, each refusing rather than cascading, and NONE of
-- them has an override. An override belongs to a gate a file OWNS and removes on
-- purpose, never to a business record and never to a later migration's
-- dependency it would strip as a side effect.
--
--   G1  Any row in core.ai_provider_keys. Dropping the table orphans live
--       secrets in the platform secret store with NOTHING LEFT TO NAME THEM:
--       `key_ref` is the only locator, it exists nowhere else, and a Vault
--       secret whose locator is gone is unreachable and undeletable through any
--       application path. The message says to delete the secrets first, through
--       the RPC, not to export the table.
--   G2  Any row in app.key_access_audit. It is the record of who saw a
--       credential, doc 05 s5.5 retains it INDEFINITELY, and doc 05 s5.4 puts it
--       outside the 30-day run redaction for that reason. An access record that
--       has been destroyed is indistinguishable from an access that was never
--       audited. The table is append-only by a row trigger AND a statement-level
--       TRUNCATE guard, so it cannot casually be emptied either - deliberately.
--   G3  Any row in public.agent_api_keys that is not revoked. A live agent
--       credential whose metadata row is dropped cannot be revoked afterwards,
--       because app.verify_agent_key is what revocation works through. Revoke
--       first; revoked rows do not block.
--   G4  Any row in core.runs. Runs are the trace an agent action is explained
--       by, and doc 05 s5.5 keeps run and node metadata indefinitely while only
--       the I/O expires at 30 days. A structurally clean drop of a table holding
--       four months of traces is a successful command and a silent loss of every
--       answer to "why did the agent do that".
--   G5  Any row in core.evals. An eval score is what gates an agent's autonomy
--       promotion and what a paused agent's resumeCondition is measured against;
--       dropping them silently re-opens a promotion somebody refused.
--   G6  Any relation OUTSIDE 013's own set that depends on one of its tables or
--       on either view. 014's policies and 015's retention views are the
--       expected cases; a CASCADE would drop them silently.
--
-- WHAT IS DELIBERATELY NOT GUARDED, and why, so the absence reads as a decision:
-- core.tier_keys, core.model_tiers, core.routing_matrix_versions,
-- core.routing_entries, core.ai_budgets, app.usage_rollup, core.agents,
-- app.agent_api_key_secrets and the six run child tables. The first six are
-- CONFIGURATION - an admin re-enters them, and 016 provisions the reference
-- rows. app.agent_api_key_secrets is guarded transitively by G3, since a secret
-- cannot exist without its metadata row. The run children all CASCADE from
-- core.runs, which G4 guards, so guarding them separately would refuse a
-- rollback twice for one reason. core.agents is guarded transitively by G3 and
-- G4 - an agent with no key and no runs is a name.
--
-- DROP ORDER: the REVERSE of the forward order, children before parents.
--   the three foreign keys 013 added to other migrations' tables and their
--   indexes -> the two views (model_tier_status before budget_status, because it
--   reads it) -> the retention and rollup functions -> the five provider-key
--   RPCs -> app.record_key_access -> app.key_access_audit and the reveal-audit
--   trigger -> evals -> run snapshots, checkpoints, state cards, events, node
--   I/O, nodes -> runs -> usage_rollup and budgets -> ai_provider_keys ->
--   routing entries, routing versions, model tiers -> the agent credential ->
--   agents -> tier_keys -> the validators, the PII pass and the mask.
--
-- The validators go LAST because every CHECK constraint above depended on them,
-- and app.mask_run_io and app.require_reveal_audit go with the tables whose
-- triggers referenced them.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

DO $preflight$
DECLARE
  v_n   bigint;
  v_dep text;
BEGIN
  -- ── G1 · no BYOK metadata, because key_ref is the only locator ───────────
  IF to_regclass('core.ai_provider_keys') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM core.ai_provider_keys' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 013 ABORTED: core.ai_provider_keys holds % row(s). Each one''s '
        '`key_ref` is the ONLY locator for a live secret in the platform secret '
        'store, and it exists nowhere else - dropping this table leaves those '
        'secrets orphaned, unreachable and undeletable through any application '
        'path. Delete the keys properly first, one at a time, through '
        'public.ai_provider_key_delete(provider_ref), which is also what refuses '
        'to leave a tier with no VALID key. Exporting the table is NOT enough: '
        'the secrets themselves have to go.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G2 · no credential-access record to destroy ──────────────────────────
  IF to_regclass('app.key_access_audit') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM app.key_access_audit' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 013 ABORTED: app.key_access_audit holds % row(s). That is the '
        'record of every BYOK decrypt - who saw a credential, when, for what '
        'purpose and at what assurance level (doc 05 s5.4). Doc 05 s5.5 retains '
        'it indefinitely and excludes it from the 30-day run redaction for '
        'exactly this reason. Export it first: COPY (SELECT * FROM '
        'app.key_access_audit) TO ''/tmp/key_access_audit.csv'' CSV HEADER; - and '
        'note the table CANNOT then be emptied casually, because it is '
        'append-only by a row trigger AND by a statement-level TRUNCATE guard. '
        'That is deliberate. If you are disabling those to get a rollback '
        'through, the rollback is not what you want.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G3 · no live agent credential ────────────────────────────────────────
  IF to_regclass('public.agent_api_keys') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.agent_api_keys WHERE revoked_at IS NULL'
      INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 013 ABORTED: public.agent_api_keys holds % unrevoked row(s). '
        'Revocation works by app.verify_agent_key finding the row and reading '
        'revoked_at; with the table gone there is no row to find and no way to '
        'stop a key that is already in an operator''s hands. Revoke them first '
        '(UPDATE public.agent_api_keys SET revoked_at = now() WHERE revoked_at '
        'IS NULL) - revoked rows do not block this rollback.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G4 · no run traces ───────────────────────────────────────────────────
  IF to_regclass('core.runs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM core.runs' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 013 ABORTED: core.runs holds % row(s), and every child table '
        '(nodes, node I/O, run events, state cards, checkpoints, snapshots) '
        'CASCADES from them. Doc 05 s5.5 retains run and node metadata '
        'INDEFINITELY - only the prompt and completion text expires, at 30 days - '
        'because the trace is how an agent action is explained after the fact. '
        'Export first: COPY (SELECT * FROM core.runs) TO ''/tmp/runs.csv'' CSV '
        'HEADER; and the six child tables with it.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G5 · no eval history ─────────────────────────────────────────────────
  IF to_regclass('core.evals') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM core.evals' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 013 ABORTED: core.evals holds % row(s). The rolling median of '
        'GOLDEN_SET and JURY_GATE scores is what gates an agent''s promotion to '
        'AUTONOMOUS and what a paused agent''s resumeCondition is measured '
        'against; dropping them silently re-opens a promotion somebody refused. '
        'Export first.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G6 · nothing outside 013 depends on 013 ──────────────────────────────
  SELECT string_agg(DISTINCT dependent.relname, ', ') INTO v_dep
  FROM pg_catalog.pg_depend d
  JOIN pg_catalog.pg_rewrite rw ON rw.oid = d.objid
  JOIN pg_catalog.pg_class dependent ON dependent.oid = rw.ev_class
  JOIN pg_catalog.pg_class referenced ON referenced.oid = d.refobjid
  JOIN pg_catalog.pg_namespace rn ON rn.oid = referenced.relnamespace
  WHERE rn.nspname IN ('core','app','public')
    AND referenced.relname IN (
      'tier_keys','agents','agent_api_keys','agent_api_key_secrets',
      'model_tiers','routing_matrix_versions','routing_entries',
      'ai_provider_keys','ai_budgets','usage_rollup','runs','run_nodes',
      'run_node_io','run_events','run_state_cards','run_checkpoints',
      'run_snapshots','evals','key_access_audit','budget_status',
      'model_tier_status')
    AND dependent.relname NOT IN (
      'tier_keys','agents','agent_api_keys','agent_api_key_secrets',
      'model_tiers','routing_matrix_versions','routing_entries',
      'ai_provider_keys','ai_budgets','usage_rollup','runs','run_nodes',
      'run_node_io','run_events','run_state_cards','run_checkpoints',
      'run_snapshots','evals','key_access_audit','budget_status',
      'model_tier_status');
  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 013 ABORTED: relation(s) outside 013 depend on its tables or '
      'views: %. A later migration created them; roll that back first rather '
      'than letting a CASCADE remove them silently.', v_dep
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE
    'rollback 013 pre-flight: clear (no provider keys, no credential audit, no '
    'live agent keys, no runs, no evals, no dependents).';
END;
$preflight$;

-- ─── Reverse of forward step 11 · the run_id reconciliation ─────────────────
-- FIRST, because these constraints point INTO core.runs from three tables this
-- file must leave standing. Dropping them by name rather than letting the
-- core.runs DROP ... CASCADE take them means a reader of this file can see
-- exactly what was removed from a table 013 does not own.
ALTER TABLE IF EXISTS core.rule_change_sets DROP CONSTRAINT IF EXISTS rule_change_sets_run_fk;
ALTER TABLE IF EXISTS core.provenance       DROP CONSTRAINT IF EXISTS provenance_run_fk;
ALTER TABLE IF EXISTS core.proposals        DROP CONSTRAINT IF EXISTS proposals_run_fk;

-- 013's indexes on 007's and 009's columns. `provenance_run_idx` is NOT dropped:
-- 007 created it.
DROP INDEX IF EXISTS core.rule_change_sets_run_idx;
DROP INDEX IF EXISTS core.proposals_run_idx;

-- ─── Reverse of forward step 10 · the derived-status views ──────────────────
-- model_tier_status first: it reads budget_status.
DROP VIEW IF EXISTS core.model_tier_status;
DROP VIEW IF EXISTS core.budget_status;

-- ─── Reverse of forward step 9 · retention and the rollup writer ────────────
DROP FUNCTION IF EXISTS app.roll_up_usage(uuid, text);
DROP FUNCTION IF EXISTS app.redact_run_io(integer);

-- ─── Reverse of forward step 8 · the RPCs and the credential audit ──────────
-- Functions before the tables they read, so that no DROP below needs a CASCADE
-- to remove a dependency this file is about to drop anyway - correct by
-- accident is wrong the moment somebody reorders it.
DROP FUNCTION IF EXISTS public.ai_provider_key_reveal(text, text, text);
DROP FUNCTION IF EXISTS public.ai_provider_key_delete(text);
DROP FUNCTION IF EXISTS public.ai_provider_key_rotate(text, text, bytea, text, text);
DROP FUNCTION IF EXISTS public.ai_provider_key_test(text, text, text, text);
DROP FUNCTION IF EXISTS public.ai_provider_key_set(
  text, text, text, text, bytea, text, text[], text, text, bigint, date);
DROP FUNCTION IF EXISTS app.record_key_access(
  uuid, text, text, jsonb, text, text, uuid, text, text);

-- The triggers go with their tables; named explicitly so a reader comparing
-- this file to the forward one line for line finds them, and so a future edit
-- that keeps a table cannot leave a trigger pointing at a dropped function.
DROP TRIGGER IF EXISTS key_access_audit_no_truncate ON app.key_access_audit;
DROP TRIGGER IF EXISTS key_access_audit_append_only ON app.key_access_audit;
DROP TABLE IF EXISTS app.key_access_audit CASCADE;

DROP TRIGGER IF EXISTS ai_provider_keys_reveal_audit ON core.ai_provider_keys;
DROP FUNCTION IF EXISTS app.require_reveal_audit();

-- The key-material pairing trigger (013:1463-1520). Left behind, the function
-- outlives its table and a full rollback aborts at 002, whose preflight refuses
-- an `app` schema holding functions neither 001 nor 002 created.
DROP TRIGGER IF EXISTS ai_provider_keys_material_pairing ON core.ai_provider_keys;
DROP FUNCTION IF EXISTS app.enforce_key_material_pairing();

-- ─── Reverse of forward step 7 · runs, in child-before-parent order ─────────
DROP TABLE IF EXISTS core.evals CASCADE;
DROP TABLE IF EXISTS core.run_snapshots CASCADE;
DROP TABLE IF EXISTS core.run_checkpoints CASCADE;
DROP TABLE IF EXISTS core.run_state_cards CASCADE;
DROP TABLE IF EXISTS core.run_events CASCADE;
DROP TRIGGER IF EXISTS run_node_io_mask ON core.run_node_io;
DROP TABLE IF EXISTS core.run_node_io CASCADE;
DROP TABLE IF EXISTS core.run_nodes CASCADE;
DROP TABLE IF EXISTS core.runs CASCADE;

-- ─── Reverse of forward step 6 · budgets and the usage rollup ───────────────
DROP TABLE IF EXISTS app.usage_rollup CASCADE;
DROP TABLE IF EXISTS core.ai_budgets CASCADE;

-- ─── Reverse of forward step 5 · BYOK metadata ──────────────────────────────
DROP TABLE IF EXISTS core.ai_provider_keys CASCADE;

-- ─── Reverse of forward step 4 · tiers and routing ──────────────────────────
DROP TABLE IF EXISTS core.routing_entries CASCADE;
DROP TABLE IF EXISTS core.routing_matrix_versions CASCADE;
DROP TABLE IF EXISTS core.model_tiers CASCADE;

-- ─── Reverse of forward step 3 · the roster and its credential ──────────────
DROP FUNCTION IF EXISTS app.verify_agent_key(text);
DROP FUNCTION IF EXISTS app.mint_agent_key(uuid, text, text, timestamptz);
DROP TABLE IF EXISTS app.agent_api_key_secrets CASCADE;
DROP TABLE IF EXISTS public.agent_api_keys CASCADE;
DROP TABLE IF EXISTS core.agents CASCADE;

-- ─── Reverse of forward step 2 · the tier-key reference table ───────────────
DROP TABLE IF EXISTS core.tier_keys CASCADE;

-- ─── Reverse of forward step 1 · validators, the PII pass, the mask ─────────
-- Last, because every CHECK constraint above depended on them. 012's
-- app.is_valid_actor and app.reject_mutation are NOT dropped: they are 012's,
-- and 013 only pointed constraints and triggers at them.
DROP FUNCTION IF EXISTS app.mask_run_io();
DROP FUNCTION IF EXISTS app.pii_counts(text);
DROP FUNCTION IF EXISTS app.placeholder_count(text, text);
DROP FUNCTION IF EXISTS app.redact_pii(text);
DROP FUNCTION IF EXISTS app.redact_pattern(text, text, text);
DROP FUNCTION IF EXISTS app.is_valid_redaction_counts(jsonb);
DROP FUNCTION IF EXISTS app.is_valid_run_event_detail(core.run_event_type, jsonb);
DROP FUNCTION IF EXISTS app.is_valid_metric_condition(jsonb);
DROP FUNCTION IF EXISTS app.is_valid_jury_policy(jsonb);
DROP FUNCTION IF EXISTS app.is_valid_checkpoint_cursor(jsonb);
DROP FUNCTION IF EXISTS app.is_valid_state_card_budgets(jsonb);
DROP FUNCTION IF EXISTS app.is_valid_plan(jsonb);
DROP FUNCTION IF EXISTS app.is_valid_run_failure(jsonb);
DROP FUNCTION IF EXISTS app.is_valid_halted_by(jsonb);
DROP FUNCTION IF EXISTS app.is_valid_run_trigger(jsonb);
DROP FUNCTION IF EXISTS app.agent_key_digest(text, bytea);
DROP FUNCTION IF EXISTS app.is_masked_key(text);
DROP FUNCTION IF EXISTS app.mask_key(text);

DO $verify$
DECLARE v_left text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('app','core','public') AND c.relkind IN ('r','v')
    AND c.relname IN (
      'tier_keys','agents','agent_api_keys','agent_api_key_secrets',
      'model_tiers','routing_matrix_versions','routing_entries',
      'ai_provider_keys','ai_budgets','usage_rollup','runs','run_nodes',
      'run_node_io','run_events','run_state_cards','run_checkpoints',
      'run_snapshots','evals','key_access_audit','budget_status',
      'model_tier_status');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 013: relation(s) survived the drop: %', v_left;
  END IF;

  SELECT string_agg(p.proname || '(' ||
                    pg_get_function_identity_arguments(p.oid) || ')', ', ')
    INTO v_left
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'app' AND p.proname IN (
           'mask_key','is_masked_key','agent_key_digest','is_valid_run_trigger',
           'is_valid_halted_by','is_valid_run_failure','is_valid_plan',
           'is_valid_state_card_budgets','is_valid_checkpoint_cursor',
           'is_valid_jury_policy','is_valid_metric_condition',
           'is_valid_run_event_detail','is_valid_redaction_counts',
           'redact_pattern','redact_pii','placeholder_count','pii_counts',
           'mask_run_io','require_reveal_audit','enforce_key_material_pairing',
           'record_key_access',
           'mint_agent_key','verify_agent_key','redact_run_io','roll_up_usage'))
     OR (n.nspname = 'public' AND p.proname IN (
           'ai_provider_key_set','ai_provider_key_test','ai_provider_key_rotate',
           'ai_provider_key_delete','ai_provider_key_reveal'));
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 013: function(s) survived the drop: %', v_left;
  END IF;

  -- ── What MUST survive. A rollback that removes a migration it does not own
  --    has destroyed work, not undone its own.
  IF to_regproc('app.is_valid_actor') IS NULL THEN
    RAISE EXCEPTION
      'rollback 013: app.is_valid_actor was dropped. It is 012''s; 013 only '
      'pointed app.key_access_audit.actor at it, and every actor CHECK in 012 '
      'depends on it';
  END IF;
  IF to_regproc('app.reject_mutation') IS NULL THEN
    RAISE EXCEPTION
      'rollback 013: app.reject_mutation was dropped. It is 012''s, and '
      'core.events'' append-only guarantee is built from it';
  END IF;
  -- ⚠ NOT to_regproc('app.emit_event'). MEASURED BY EXECUTION, not reasoned:
  -- to_regproc returns NULL when a name is AMBIGUOUS as well as when it is
  -- absent, and app.emit_event has two overloads (012, M-09). The first draft of
  -- this guard therefore reported 012's event path as dropped on a database
  -- where both overloads were present and the whole rollback aborted. It is the
  -- same defect M-09 found in doc 05's REVOKE, in a third spelling.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'emit_event') THEN
    RAISE EXCEPTION 'rollback 013: app.emit_event was dropped. It is 012''s.';
  END IF;
  IF to_regproc('app.aal2_verified') IS NULL THEN
    RAISE EXCEPTION 'rollback 013: app.aal2_verified was dropped. It is 011''s.';
  END IF;
  IF to_regclass('core.autonomy_grants') IS NULL THEN
    RAISE EXCEPTION 'rollback 013: core.autonomy_grants was dropped. It is 011''s.';
  END IF;

  -- 003's AI enums. 013 created no type, so none of these is 013's to remove,
  -- and dropping one would take columns in 007 and 011 with it.
  SELECT string_agg(missing.name, ', ') INTO v_left
    FROM (VALUES
      ('core.agent_status'),('core.ai_provider'),('core.budget_scope'),
      ('core.budget_state'),('core.cache_strategy'),('core.provider_key_status'),
      ('core.routing_strategy'),('core.run_event_type'),('core.run_status'),
      ('core.run_step_status'),('core.tier_status'),('core.trace_node_kind'),
      ('core.usage_group_by'),('core.billing_owner')
    ) AS missing(name)
   WHERE to_regtype(missing.name) IS NULL;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 013: 003 enum(s) % were dropped. 013 created no type at all, so '
      'none of them is its to remove.', v_left;
  END IF;

  -- The three columns 013 constrained must still exist, unconstrained, on the
  -- tables 007 and 009 own.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'core.proposals'::regclass AND attname = 'run_id'
       AND attnum > 0 AND NOT attisdropped)
     OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'core.provenance'::regclass AND attname = 'run_id'
       AND attnum > 0 AND NOT attisdropped)
     OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'core.rule_change_sets'::regclass AND attname = 'run_id'
       AND attnum > 0 AND NOT attisdropped) THEN
    RAISE EXCEPTION
      'rollback 013: a run_id column was dropped from core.proposals, '
      'core.provenance or core.rule_change_sets. Those columns are 007''s and '
      '009''s; only the foreign key 013 added is this file''s to remove.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conname IN ('proposals_run_fk','provenance_run_fk',
                       'rule_change_sets_run_fk')) THEN
    RAISE EXCEPTION
      'rollback 013: a reconciliation foreign key survived. core.runs is gone, '
      'so the constraint cannot be satisfiable.';
  END IF;
  -- 007's own index on core.provenance survives; 013's two do not.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class WHERE relname = 'provenance_run_idx') THEN
    RAISE EXCEPTION
      'rollback 013: provenance_run_idx was dropped. 007 created it; this file '
      'only removed the foreign key beside it.';
  END IF;

  -- 012's and 011's pre-014 policies must be untouched. 013 created none.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polname = 'job_type_map_definer_read')
     OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
     WHERE polname = 'autonomy_grants_agents_cannot_write') THEN
    RAISE EXCEPTION
      'rollback 013: a policy 011 or 012 created is gone. 013 created no policy '
      'and this file must not have removed one.';
  END IF;

  RAISE NOTICE
    'rollback 013: complete - 19 tables, 2 views, 29 functions, 4 triggers and 3 '
    'foreign keys removed; 011''s and 012''s functions, 003''s enums and 007''s '
    'and 009''s run_id columns left standing.';
END;
$verify$;

COMMIT;
