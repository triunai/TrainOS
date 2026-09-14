-- ═══════════════════════════════════════════════════════════════════════════
-- 027 · Automation, knowledge and AI-settings read/write surface
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Closes the (b2) NO-ADAPTER gap for three domains against hosted Supabase:
--
--   Automation   listAgents, pauseAgent, listRuns, getRun, retryRun, deadLetterRun
--   Knowledge    createKnowledgeSource, checkKnowledgeSource,
--                reingestKnowledgeSource, listLibraryAssets
--   Settings     getAiRouting, putAiRouting, listProviders, getUsage,
--                putBudget, getTenant
--
-- Depends ONLY on 001-021 (immutable, applied to hosted). No object here is
-- touched by any other 02x lane. `core.agents`, `core.runs` (+ run_nodes /
-- run_events / run_state_cards), `core.autonomy_grants`, `core.ai_budgets`,
-- `app.usage_rollup`, `core.routing_entries` / `core.model_tiers`,
-- `core.ai_provider_keys`, `core.knowledge_sources`, `public.tenants` and
-- `app.action_types` all already exist (013/009/011/002). This migration adds
-- no new pg TYPE, only one new TABLE (`core.library_assets` - the Library
-- corpus has no table anywhere in 001-021) and eighteen new FUNCTIONs.
--
-- ── NOT IN THIS MIGRATION: createProvider / testProvider / revealProvider ──
--
-- 013 already ships the client-facing SQL for all five BYOK writes
-- (`public.ai_provider_key_set/_test/_rotate/_delete/_reveal`, 013:2375-2758),
-- BY DESIGN NEVER TOUCHING THE RAW KEY: `_set`/`_rotate` take an
-- already-computed mask + fingerprint + vault locator, `_test` only records a
-- status an Edge Function already produced by probing the provider with the
-- decrypted key, and `_reveal` returns the opaque locator, never the key
-- (013:2634 comment). `supabase/functions/` in this repo holds nothing but a
-- README - there is no Edge Function anywhere to derive the mask/fingerprint,
-- run the probe, or perform the decrypt `_reveal` deliberately leaves to it.
-- Building one is a worker/edge change, which this lane's brief rules out
-- ("No worker changes (report worker gaps)"), and inventing a path that lets
-- the raw key transit Postgres would contradict 013's own stated design
-- rather than complete it. Escalated to the orchestrator before writing
-- anything here (NEEDS OPUS, sent before this file existed); `listProviders`
-- below is the read half and ships. See the PR body for the full evidence.
--
-- ── PERMISSION DECISIONS (002 §11 gaps, filled here as DATA) ────────────────
--
-- `library:read` and `tenant:read` do not exist in 002. Neither Library
-- (fixture-only corpus, `data/library.ts`) nor `getTenant` (fixture-only
-- `FixtureTenant`, `data/tenant.ts:53`) is a contract endpoint, so 002 never
-- had reason to seed a permission for them. Fixture's `listLibraryAssets` and
-- `getTenant` both call `#read` directly with NO `#requirePermission` guard -
-- i.e. any signed-in staff principal. Granted here to the six staff roles
-- (SALES, SALES_MANAGER, OPS, FINANCE, MD, ADMIN), matching every other
-- unrestricted `#read` (`listAgents`, `getNavigation`) once passed through
-- `app.has_permission`. Flagged in the PR as a decision to confirm.
--
-- `checkKnowledgeSource` has no dedicated 002 permission either (only
-- `knowledge:source:read`, `:write`, `:reingest` exist, all read/write/
-- reingest-scoped to FINANCE/MD read and ADMIN write+reingest). It mutates
-- `last_checked_at` / `monitor_status`, so gated on `knowledge:source:write`
-- (ADMIN) rather than invented as a fourth permission - flagged in the PR.
--
-- `putBudget`: 013's own comment on `core.ai_budgets` (013:1548) and the
-- contract both require a cap RAISE to use 011's `BUDGET_CAP_RAISE` action.
-- That path is money-moving (AAL2) and FIN-07 always queues a different MD's
-- approval. 021 is the effective definition of `app.execute_in_database_action`
-- and still carries 011's pre-013 NULL stub, so this migration replaces that
-- definition verbatim except for a real budget branch. Cap lowers remain a
-- direct `ai:budget:write` write. Neither path requires `ai:budget:read`.
--
-- ── pauseAgent AND THE 011/013 SEAM ─────────────────────────────────────────
--
-- 011's `AGENT_PAUSE` action type (011:916, permission `agent:pause`) predates
-- `core.agents` (013): its `execute_in_database_action` arm (011:1888) updates
-- `core.autonomy_grants` only - a per-action-type grant, not the whole-agent
-- `status`/`paused_at`/`kill_switch` columns 013 built for contract 10's
-- `Agent` (013:983 comment: "011 owns the GATE that reads it; this is where
-- the bit lives"). `core.perform_action('AGENT_PAUSE', ...)` therefore cannot
-- honestly serve `PUT /agents/{id}/pause`: it would touch grants but leave
-- `Agent.status` stale. `core.pause_agent` below writes `core.agents` (and,
-- for a whole-agent pause, cascades `paused=true` over its autonomy_grants)
-- directly, gated on the same `agent:pause` permission 011 already maps, and
-- emits its own event. Flagged in the PR: the pre-013 011/`AGENT_PAUSE` path
-- is left as-is and is now redundant with this one for the whole-agent case.
--
-- ── SCOPE LEFT OUT, ON PURPOSE ───────────────────────────────────────────────
--
-- `AutomationRun.nodes/events/stateCard/steps` are ALL optional in the
-- contract (agents.ts). `listRuns`/`getRun` below return every well-verified
-- `core.runs` column (status, cost, tokens, duration, failure, guardrails,
-- model, trigger, outcome) and omit nodes/events/stateCard rather than guess
-- at `TraceNode`/`RunEvent`/`RunStateCard`'s exact key shapes, which this pass
-- did not independently verify against their contract types. Follow-up, not a
-- silent gap: flagged in the PR.
--
-- `retryRun`/`deadLetterRun` are DIRECT SQL writes on `core.runs`, matching
-- fixture shape (a new run row / a failed+dead-lettered row), never invoking
-- any agent runtime - there is no SQL path to real agent execution, and this
-- lane may not touch the worker. `retryRun`'s new row is written SUCCEEDED
-- immediately (fixture parity for the hosted demo), not left RUNNING forever
-- with nothing to advance it. A source must be FAILED (including 013's
-- FAILED+`failure.deadLettered=true` representation of DEAD_LETTERED) before
-- retry, and only FAILED may be dead-lettered. Both operations lock the source
-- before reading that state and return the first result on a repeated call.
--
-- `reingestKnowledgeSource`: `apps/worker/src/handlers/index.ts` `JOB_TYPES`
-- has no reingest/embedding handler, and no `UNIMPLEMENTED_012_JOB_TYPES` row
-- names one either - this is not even a documented worker gap yet. No job is
-- enqueued; `embedding_status` is set to `PENDING` and the response's `runId`
-- is omitted, i.e. the contract's queued state, told honestly rather than
-- faked as `INDEXED`.
--
-- `getAiRouting`/`putAiRouting`: `RoutingEntry.staged` (Ruling R12) needs a
-- staged-but-unapplied edit ledger that does not exist in 001-021. Omitted;
-- `unsavedChanges` is always 0. Flagged in the PR as follow-up scope.
--
-- `AgentRegistrySummary` (`listAgents`) has three fields with no unambiguous
-- source in 001-021: `approvalsRaised`/`autoApproved` (which of 011's many
-- request/run rows count as "raised by an agent" is not settled by any table
-- or fixture I could find) and `incidents30d` (no incident table exists).
-- Computed as documented, best-effort, below each field; flagged in the PR.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

-- ═══ 1 · New permissions, as data ═══════════════════════════════════════════

INSERT INTO app.role_permissions (role, permission) VALUES
  ('SALES',          'library:read'),
  ('SALES_MANAGER',  'library:read'),
  ('OPS',            'library:read'),
  ('FINANCE',        'library:read'),
  ('MD',             'library:read'),
  ('ADMIN',          'library:read'),
  ('SALES',          'tenant:read'),
  ('SALES_MANAGER',  'tenant:read'),
  ('OPS',            'tenant:read'),
  ('FINANCE',        'tenant:read'),
  ('MD',             'tenant:read'),
  ('ADMIN',          'tenant:read')
ON CONFLICT (role, permission) DO NOTHING;

-- ═══ 2 · core.library_assets · the fixture-only content library ════════════
--
-- Contract has no `LibraryAsset` type (§1 covers `templates`, §17 covers
-- `knowledge sources` - the Library leaf is neither). Mirrors
-- `packages/fixtures/src/data/library.ts` `FixtureLibraryAsset` exactly:
-- kind/status/format are fixture-only vocabulary (no contract enum backs
-- them), so CHECK-constrained text rather than a new pg TYPE masquerading as
-- a generated contract enum.

CREATE TABLE core.library_assets (
  id               uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  title            text        NOT NULL
                               CHECK (NULLIF(pg_catalog.btrim(title), '') IS NOT NULL),
  kind             text        NOT NULL
                               CHECK (kind IN ('PROGRAMME_OUTLINE','CASE_STUDY','TRAINER_PROFILE',
                                               'PROPOSAL_SECTION','ONE_PAGER','EVALUATION_REPORT')),
  version          integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  owner_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_type     text        CHECK (subject_type IS NULL OR subject_type ~ '^[A-Z][A-Z0-9_]*$'),
  subject_id       uuid,
  retrieval_scopes core.retrieval_scope[] NOT NULL DEFAULT '{}',
  status           text        NOT NULL DEFAULT 'DRAFT'
                               CHECK (status IN ('PUBLISHED','DRAFT','NEEDS_REVIEW','ARCHIVED')),
  times_used       integer     NOT NULL DEFAULT 0 CHECK (times_used >= 0),
  last_used_at     timestamptz,
  format           text        NOT NULL CHECK (format IN ('PDF','DOCX','MD','PPTX')),
  size_bytes       bigint      NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  created_at       timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at       timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT library_assets_subject_pair CHECK (
    pg_catalog.num_nonnulls(subject_type, subject_id) <> 1)
);

COMMENT ON TABLE core.library_assets IS
  '027. The Knowledge > Library leaf (`FixtureLibraryAsset`, fixtures '
  'data/library.ts). Not a contract surface - the reusable sales/delivery '
  'content corpus, distinct from `core.knowledge_sources` (the monitored '
  'external corpus, 009). No FK to a specific subject table: subjectRef can '
  'point at a programme, a trainer or an organisation, and a validating FK '
  'per subject_type would need a lookup trigger against tables that are FORCE '
  'RLS with no policy for this owner outside 014''s grant, so the pair is '
  'stated (both-or-neither) and left referentially open, matching '
  'core.run_node_io''s subject columns (013).';

SELECT app.finalise_table('core','library_assets',false,NULL,
  ARRAY['title','kind','owner_id','status','format']);

CREATE INDEX library_assets_status_idx ON core.library_assets (tenant_id, status);
CREATE INDEX library_assets_subject_idx ON core.library_assets (tenant_id, subject_type, subject_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX library_assets_owner_idx ON core.library_assets (tenant_id, owner_id);
CREATE INDEX library_assets_updated_idx ON core.library_assets (tenant_id, updated_at DESC, id);

-- ═══ 3 · Automation · agents and runs ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION core.list_agents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant       uuid := app.require_tenant_id();
  v_data         jsonb;
  v_actions_mo   integer;
  v_cost_mo      bigint;
  v_budget       bigint;
  v_approvals    integer;
  v_auto         integer;
  v_median_eval  numeric;
  v_incidents    integer;
BEGIN
  IF NOT app.has_permission('agent:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission','agent:read'));
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(row ORDER BY row ->> 'name'), '[]'::jsonb)
    INTO v_data
    FROM (
      SELECT pg_catalog.jsonb_build_object(
               /* The stable slug (013:965 comment: "an agent is not a row in
                  auth.users"; the JWT and every FK elsewhere carry agent_id,
                  text), matching the fixture's Agent.id (e.g. "agent_collections")
                  and what pause_agent's own lookup already accepts. Not the
                  internal uuid PK. */
               'id',              agent.agent_id,
               'name',            agent.name,
               'status',          agent.status::text,
               'scopes',          pg_catalog.to_jsonb(agent.scopes),
               'autonomy',        COALESCE((
                 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                          'actionType',    autonomy_grant.action_type,
                          'level',         autonomy_grant.level,
                          'ceilingReason', action_type.ceiling_reason,
                          'paused',        autonomy_grant.paused,
                          'approverRole',  autonomy_grant.approver_role,
                          'minConfidence', autonomy_grant.min_confidence,
                          'valueThreshold', app._money(autonomy_grant.value_threshold_sen, autonomy_grant.currency))
                        ORDER BY autonomy_grant.action_type)
                   FROM core.autonomy_grants AS autonomy_grant
                   JOIN app.action_types AS action_type ON action_type.key = autonomy_grant.action_type
                  WHERE autonomy_grant.tenant_id = agent.tenant_id AND autonomy_grant.agent_id = agent.agent_id),
                 '[]'::jsonb),
               'costMonth',       app._money(COALESCE((
                 SELECT pg_catalog.sum(run.cost_sen) FROM core.runs AS run
                  WHERE run.tenant_id = agent.tenant_id AND run.agent_id = agent.agent_id
                    AND run.started_at >= pg_catalog.date_trunc('month', pg_catalog.now())), 0)::bigint, 'MYR'),
               'evalScore',       COALESCE((
                 SELECT pg_catalog.avg(eval.score) FROM core.evals AS eval
                  WHERE eval.tenant_id = agent.tenant_id AND eval.agent_id = agent.agent_id
                    AND eval.evaluated_at >= pg_catalog.now() - interval '30 days'), 0),
               'lastRunAt',       agent.last_run_at,
               'killSwitch',      agent.kill_switch)
             || CASE WHEN agent.paused_at IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('pausedAt', agent.paused_at) END
             || CASE WHEN agent.paused_reason IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('pausedReason', agent.paused_reason) END
             || CASE WHEN agent.resume_condition IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('resumeCondition', agent.resume_condition) END
             || CASE WHEN agent.default_tier IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('defaultTier', agent.default_tier) END
             || pg_catalog.jsonb_build_object('escalationLadder', pg_catalog.to_jsonb(agent.escalation_ladder))
             || CASE WHEN agent.jury IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('jury', agent.jury) END AS row
        FROM core.agents AS agent
       WHERE agent.tenant_id = v_tenant
    ) AS agents;

  -- Summary. actionsMonth/cost/budget are real joins; approvalsRaised,
  -- autoApproved and incidents30d have no unambiguous source table in
  -- 001-021 - see the migration header. medianEval uses percentile_cont.
  SELECT pg_catalog.count(*) INTO v_actions_mo FROM core.runs AS run
   WHERE run.tenant_id = v_tenant AND run.started_at >= pg_catalog.date_trunc('month', pg_catalog.now());

  SELECT COALESCE(pg_catalog.sum(run.cost_sen), 0) INTO v_cost_mo FROM core.runs AS run
   WHERE run.tenant_id = v_tenant AND run.started_at >= pg_catalog.date_trunc('month', pg_catalog.now());

  SELECT COALESCE(pg_catalog.sum(budget.cap_sen), 0) INTO v_budget FROM core.ai_budgets AS budget
   WHERE budget.tenant_id = v_tenant AND budget.scope = 'AGENT';

  -- approvalsRaised: approval_requests raised by an AGENT actor this month.
  SELECT pg_catalog.count(*) INTO v_approvals FROM core.approval_requests AS approval
   WHERE approval.tenant_id = v_tenant
     AND approval.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
     AND approval.requested_by_kind = 'AGENT';

  -- autoApproved: runs this month that completed with no approval_request at all.
  SELECT pg_catalog.count(*) INTO v_auto FROM core.runs AS run
   WHERE run.tenant_id = v_tenant AND run.status = 'SUCCEEDED'
     AND run.started_at >= pg_catalog.date_trunc('month', pg_catalog.now())
     AND run.action_request_id IS NULL;

  SELECT pg_catalog.percentile_cont(0.5) WITHIN GROUP (ORDER BY eval.score) INTO v_median_eval
    FROM core.evals AS eval
   WHERE eval.tenant_id = v_tenant AND eval.evaluated_at >= pg_catalog.now() - interval '30 days';

  SELECT pg_catalog.count(*) INTO v_incidents FROM core.runs AS run
   WHERE run.tenant_id = v_tenant AND run.status = 'FAILED'
     AND run.finished_at >= pg_catalog.now() - interval '30 days';

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_data,
    'summary', pg_catalog.jsonb_build_object(
      'actionsMonth',   v_actions_mo,
      'cost',           app._money(v_cost_mo, 'MYR'),
      'budget',         app._money(v_budget, 'MYR'),
      'approvalsRaised', v_approvals,
      'autoApproved',   v_auto,
      'medianEval',     COALESCE(v_median_eval, 0),
      'incidents30d',   v_incidents)));
END;
$fn$;

COMMENT ON FUNCTION core.list_agents() IS
  '027. GET /v1/agents (contract 10 AgentRegistryResponse). Summary fields '
  'without an unambiguous source table are computed best-effort - see the '
  'migration header.';

CREATE OR REPLACE FUNCTION core.pause_agent(p_id text, p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant     uuid := app.require_tenant_id();
  v_actor      jsonb;
  v_row        core.agents%ROWTYPE;
  v_action     text := NULLIF(p_body ->> 'actionType', '');
BEGIN
  IF NOT app.has_permission('agent:pause') THEN
    RAISE EXCEPTION 'requester lacks %', 'agent:pause'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','FORBIDDEN','requiredPermission','agent:pause')::text;
  END IF;

  v_actor := pg_catalog.jsonb_build_object(
    'kind', app.actor_kind()::text, 'id', COALESCE(app.jwt() ->> 'sub', 'unknown'), 'name', NULL);

  SELECT agent.* INTO v_row FROM core.agents AS agent
   WHERE agent.tenant_id = v_tenant AND (agent.id::text = p_id OR agent.agent_id = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such agent'
      USING ERRCODE = 'TRNOS', DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  IF v_action IS NULL THEN
    -- Whole-agent pause: contract 10 Agent.status/pausedAt/pausedReason, and
    -- every per-action-type grant is paused with it (fixture FC:1584).
    UPDATE core.agents
       SET status = 'PAUSED', paused_at = pg_catalog.now(), paused_reason = 'MANUAL_PAUSE',
           paused_by = v_actor, updated_at = pg_catalog.now()
     WHERE tenant_id = v_tenant AND id = v_row.id;
    UPDATE core.autonomy_grants
       SET paused = true, paused_at = pg_catalog.now(), paused_reason = 'MANUAL_PAUSE'
     WHERE tenant_id = v_tenant AND agent_id = v_row.agent_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM core.autonomy_grants AS autonomy_grant
       WHERE autonomy_grant.tenant_id = v_tenant AND autonomy_grant.agent_id = v_row.agent_id
         AND autonomy_grant.action_type = v_action) THEN
      RAISE EXCEPTION 'no such grant'
        USING ERRCODE = 'TRNOS', DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
    END IF;
    UPDATE core.autonomy_grants
       SET paused = true, paused_at = pg_catalog.now(), paused_reason = 'MANUAL_PAUSE'
     WHERE tenant_id = v_tenant AND agent_id = v_row.agent_id AND action_type = v_action;
  END IF;

  PERFORM app.emit_event(
    p_tenant_id => v_tenant, p_type => 'AgentPaused', p_aggregate_type => 'AGENT',
    p_aggregate_id => v_row.id, p_aggregate_ref => v_row.agent_id,
    p_payload => pg_catalog.jsonb_build_object('agentId', v_row.agent_id, 'actionType', v_action),
    p_summary => pg_catalog.format('%s paused', v_row.name), p_actor => v_actor);

  RETURN app.ok((SELECT row FROM core.list_agents() AS wrapper,
                 pg_catalog.jsonb_array_elements(wrapper -> 'data' -> 'data') AS row
           WHERE row ->> 'id' = v_row.agent_id));
END;
$fn$;

COMMENT ON FUNCTION core.pause_agent(text,jsonb) IS
  '027. PUT /v1/agents/{id}/pause. Writes core.agents directly rather than '
  'through 011''s pre-013 AGENT_PAUSE handler - see the migration header.';

CREATE OR REPLACE FUNCTION app._run_row(p_run core.runs)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  -- Core AutomationRun fields only (agents.ts). nodes/events/stateCard/steps
  -- are all optional and deliberately omitted here - see the migration header.
  SELECT pg_catalog.jsonb_build_object(
           'id',          p_run.id::text,
           'ref',         p_run.ref,
           'agentId',     p_run.agent_id,
           'trigger',     p_run.trigger,
           'startedAt',   p_run.started_at,
           'durationMs',  COALESCE(p_run.duration_ms, 0),
           'cost',        app._money(p_run.cost_sen, p_run.currency::text),
           'tokens',      pg_catalog.jsonb_build_object('in', p_run.tokens_in, 'out', p_run.tokens_out),
           'status',      p_run.status::text,
           'guardrails',  pg_catalog.to_jsonb(p_run.guardrails))
         || CASE WHEN p_run.model IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('model', p_run.model) END
         || CASE WHEN p_run.outcome IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('outcome', p_run.outcome) END
         || CASE WHEN p_run.failure IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('failure', p_run.failure) END
         || CASE WHEN p_run.orchestrator IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('orchestrator', p_run.orchestrator) END
         || CASE WHEN p_run.cache_hit_rate IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('cacheHitRate', p_run.cache_hit_rate) END
         || CASE WHEN pg_catalog.array_length(p_run.tiers_used,1) IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('tiersUsed', pg_catalog.to_jsonb(p_run.tiers_used)) END;
$fn$;

REVOKE ALL ON FUNCTION app._run_row(core.runs) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION core.list_runs(p_page jsonb DEFAULT '{"size":50}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_size    integer;
  v_cursor  text := NULLIF(p_page ->> 'cursor', '');
  v_cur_at  timestamptz;
  v_cur_id  uuid;
  v_data    jsonb;
  v_total   integer;
  v_next    text;
  v_last_at timestamptz;
  v_last_id uuid;
  v_count   integer;
BEGIN
  IF NOT app.has_permission('run:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission','run:read'));
  END IF;

  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','page.size','reason', SQLERRM))));
  END;

  IF v_cursor IS NOT NULL THEN
    BEGIN
      SELECT decoded.at, decoded.id INTO v_cur_at, v_cur_id FROM app._cursor_decode(v_cursor) AS decoded;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','page.cursor','reason','MALFORMED_CURSOR'))));
    END;
  END IF;

  SELECT pg_catalog.count(*) INTO v_total FROM core.runs AS run WHERE run.tenant_id = v_tenant;

  SELECT COALESCE(pg_catalog.jsonb_agg(app._run_row(page.run) ORDER BY page.started_at DESC, page.id DESC), '[]'::jsonb),
         pg_catalog.count(*), pg_catalog.max(page.started_at), NULL
    INTO v_data, v_count, v_last_at, v_last_id
    FROM (
      SELECT run AS run, run.started_at, run.id
        FROM core.runs AS run
       WHERE run.tenant_id = v_tenant
         AND (v_cur_at IS NULL OR (run.started_at, run.id) < (v_cur_at, v_cur_id))
       ORDER BY run.started_at DESC, run.id DESC
       LIMIT v_size
    ) AS page;

  SELECT page.started_at, page.id INTO v_last_at, v_last_id
    FROM (
      SELECT run.started_at, run.id FROM core.runs AS run
       WHERE run.tenant_id = v_tenant
         AND (v_cur_at IS NULL OR (run.started_at, run.id) < (v_cur_at, v_cur_id))
       ORDER BY run.started_at DESC, run.id DESC
       LIMIT v_size
    ) AS page
   ORDER BY page.started_at ASC, page.id ASC LIMIT 1;

  v_next := CASE WHEN v_count = v_size AND v_last_at IS NOT NULL
                  THEN app._cursor_encode(v_last_at, v_last_id) ELSE NULL END;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_data, 'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total)));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_run(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.runs%ROWTYPE;
BEGIN
  IF NOT app.has_permission('run:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission','run:read'));
  END IF;

  SELECT run.* INTO v_row FROM core.runs AS run
   WHERE run.tenant_id = v_tenant AND (run.id::text = p_id OR run.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(app._run_row(v_row));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.retry_run(p_id text, p_from text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_actor  jsonb;
  v_row    core.runs%ROWTYPE;
  v_new    core.runs%ROWTYPE;
BEGIN
  IF NOT app.has_permission('run:retry') THEN
    RAISE EXCEPTION 'requester lacks %', 'run:retry'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN','requiredPermission','run:retry')::text;
  END IF;
  IF p_from IS NOT NULL AND p_from <> 'checkpoint' THEN
    RAISE EXCEPTION 'invalid from'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','VALIDATION_FAILED',
                       'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                         'field','from','reason','must be omitted or "checkpoint"')))::text;
  END IF;

  SELECT run.* INTO v_row FROM core.runs AS run
   WHERE run.tenant_id = v_tenant AND (run.id::text = p_id OR run.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such run'
      USING ERRCODE = 'TRNOS', DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- core.run_status has no DEAD_LETTERED label: 013 represents that state as
  -- FAILED with failure.deadLettered=true. Both FAILED forms are retryable;
  -- SUCCEEDED, RUNNING and HALTED are not.
  IF v_row.status <> 'FAILED' THEN
    RAISE EXCEPTION 'run % cannot be retried from %', v_row.ref, v_row.status
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','ILLEGAL_STATE_TRANSITION','actualStatus',v_row.status::text,
              'allowedStatuses',pg_catalog.jsonb_build_array('FAILED','DEAD_LETTERED'))::text;
  END IF;

  -- No idempotency-key column exists on this endpoint. The first retry row is
  -- the durable claim: after the source lock, a repeated call returns it rather
  -- than starting or emitting a second retry.
  SELECT run.* INTO v_new FROM core.runs AS run
   WHERE run.tenant_id = v_tenant
     AND run.parent_run_id = v_row.id
     AND run.trigger ->> 'type' = 'RETRY'
   ORDER BY run.created_at, run.id
   LIMIT 1;
  IF FOUND THEN
    RETURN app.ok(app._run_row(v_new));
  END IF;

  v_actor := pg_catalog.jsonb_build_object(
    'kind', app.actor_kind()::text, 'id', COALESCE(app.jwt() ->> 'sub', 'unknown'), 'name', NULL);

  -- No agent runtime is invoked from SQL (worker change, out of lane scope).
  -- Written SUCCEEDED immediately, matching the fixture's simulated retry
  -- (FC:1620) rather than left RUNNING with nothing to advance it.
  INSERT INTO core.runs
    (tenant_id, agent_id, orchestrator, trigger, mode, status, outcome, model,
     tiers_used, tokens_in, tokens_out, cost_sen, currency, guardrails,
     started_at, finished_at, duration_ms, parent_run_id, correlation_id)
  VALUES
    (v_tenant, v_row.agent_id, v_row.orchestrator,
     pg_catalog.jsonb_build_object('type','RETRY','fromRunId',v_row.id::text,
                                    'from', COALESCE(p_from,'START')),
     'LIVE', 'SUCCEEDED',
     CASE WHEN p_from = 'checkpoint' THEN 'RESUMED_FROM_CHECKPOINT' ELSE 'RETRIED' END,
     v_row.model, v_row.tiers_used, 0, 0, 0, v_row.currency, v_row.guardrails,
     pg_catalog.now(), pg_catalog.now(), 0, v_row.id, v_row.correlation_id)
  RETURNING * INTO v_new;

  PERFORM app.emit_event(
    p_tenant_id => v_tenant, p_type => 'AgentRunCompleted', p_aggregate_type => 'RUN',
    p_aggregate_id => v_new.id, p_aggregate_ref => v_new.ref,
    p_payload => pg_catalog.jsonb_build_object('runId', v_new.id::text, 'agentId', v_new.agent_id,
                   'status', v_new.status, 'outcome', v_new.outcome),
    p_summary => pg_catalog.format('%s retried', v_row.ref), p_actor => v_actor,
    p_correlation_id => v_row.correlation_id);

  RETURN app.ok(app._run_row(v_new));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.dead_letter_run(p_id text, p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_actor  jsonb;
  v_row    core.runs%ROWTYPE;
  v_reason text := p_body ->> 'reason';
  v_failure jsonb;
BEGIN
  IF NOT app.has_permission('run:dead_letter') THEN
    RAISE EXCEPTION 'requester lacks %', 'run:dead_letter'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN','requiredPermission','run:dead_letter')::text;
  END IF;
  IF NULLIF(pg_catalog.btrim(COALESCE(v_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'reason required'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','VALIDATION_FAILED',
                       'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                         'field','reason','reason','required')))::text;
  END IF;

  SELECT run.* INTO v_row FROM core.runs AS run
   WHERE run.tenant_id = v_tenant AND (run.id::text = p_id OR run.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such run'
      USING ERRCODE = 'TRNOS', DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- Replaying an already-dead-lettered source is a stable success, not a
  -- second write/event and not an error.
  IF v_row.status = 'FAILED'
     AND COALESCE((v_row.failure ->> 'deadLettered')::boolean,false) THEN
    RETURN app.ok(app._run_row(v_row));
  END IF;
  IF v_row.status <> 'FAILED' THEN
    RAISE EXCEPTION 'run % cannot be dead-lettered from %', v_row.ref, v_row.status
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','ILLEGAL_STATE_TRANSITION','actualStatus',v_row.status::text,
              'allowedStatuses',pg_catalog.jsonb_build_array('FAILED'))::text;
  END IF;

  v_failure := pg_catalog.jsonb_build_object(
    'code', COALESCE(v_row.failure ->> 'code', 'MANUAL_DEAD_LETTER'),
    'message', v_reason,
    'attempts', COALESCE((v_row.failure ->> 'attempts')::int, 1),
    'retryable', false,
    'deadLettered', true);

  UPDATE core.runs
     SET status = 'FAILED', failure = v_failure, finished_at = COALESCE(finished_at, pg_catalog.now()),
         updated_at = pg_catalog.now()
   WHERE tenant_id = v_tenant AND id = v_row.id
  RETURNING * INTO v_row;

  v_actor := pg_catalog.jsonb_build_object(
    'kind', app.actor_kind()::text, 'id', COALESCE(app.jwt() ->> 'sub', 'unknown'), 'name', NULL);

  PERFORM app.emit_event(
    p_tenant_id => v_tenant, p_type => 'AgentRunFailed', p_aggregate_type => 'RUN',
    p_aggregate_id => v_row.id, p_aggregate_ref => v_row.ref,
    p_payload => pg_catalog.jsonb_build_object('runId', v_row.id::text, 'agentId', v_row.agent_id,
                   'failureCode', v_failure ->> 'code', 'deadLettered', true),
    p_summary => pg_catalog.format('%s dead-lettered', v_row.ref), p_actor => v_actor,
    p_correlation_id => v_row.correlation_id);

  RETURN app.ok(app._run_row(v_row));
END;
$fn$;

-- ═══ 4 · Knowledge ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app._knowledge_source_row(p_source core.knowledge_sources)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  -- Column mapping restated from core.v_knowledge_sources (020:1189) so the
  -- write endpoints below and the existing read view agree byte for byte.
  SELECT pg_catalog.jsonb_build_object(
    'id',              p_source.id::text,
    'name',            p_source.name,
    'type',            p_source.source_type::text,
    'version',         p_source.version,
    'ingestedAt',      p_source.ingested_at,
    'chunks',          p_source.chunk_count,
    'embeddingStatus', p_source.embedding_status::text,
    'lastCheckedAt',   p_source.last_checked_at,
    'monitorStatus',   p_source.monitor_status::text,
    'contentHash',     p_source.content_hash,
    'retrievalScopes', COALESCE(pg_catalog.to_jsonb(p_source.retrieval_scopes::text[]), '[]'::jsonb),
    'ruleChangeSetId', (SELECT change_set.id::text FROM core.rule_change_sets AS change_set
                          WHERE change_set.tenant_id = p_source.tenant_id
                            AND change_set.knowledge_source_id = p_source.id
                          ORDER BY change_set.ingested_at DESC, change_set.id DESC LIMIT 1));
$fn$;

REVOKE ALL ON FUNCTION app._knowledge_source_row(core.knowledge_sources) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION core.create_knowledge_source(p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.knowledge_sources%ROWTYPE;
  v_scopes core.retrieval_scope[];
BEGIN
  IF NOT app.has_permission('knowledge:source:write') THEN
    RAISE EXCEPTION 'requester lacks %', 'knowledge:source:write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN',
                       'requiredPermission','knowledge:source:write')::text;
  END IF;
  IF NULLIF(pg_catalog.btrim(COALESCE(p_body ->> 'name','')),'') IS NULL THEN
    RAISE EXCEPTION 'name required'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','VALIDATION_FAILED',
                       'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                         'field','name','reason','required')))::text;
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(value::core.retrieval_scope), ARRAY[]::core.retrieval_scope[])
    INTO v_scopes
    FROM pg_catalog.jsonb_array_elements_text(COALESCE(p_body -> 'retrievalScopes', '[]'::jsonb)) AS value;

  INSERT INTO core.knowledge_sources
    (tenant_id, name, source_type, uri, retrieval_scopes, embedding_status, monitor_status,
     created_by_kind, created_by_id)
  VALUES
    (v_tenant, p_body ->> 'name',
     COALESCE(NULLIF(p_body ->> 'type',''), 'HRDC_CIRCULAR')::core.knowledge_source_type,
     NULLIF(p_body ->> 'url',''), v_scopes, 'PENDING', 'WATCHING',
     app.actor_kind(), COALESCE(app.jwt() ->> 'sub', 'unknown'))
  RETURNING * INTO v_row;

  PERFORM app.emit_event(
    p_tenant_id => v_tenant, p_type => 'KnowledgeSourceCreated', p_aggregate_type => 'KNOWLEDGE_SOURCE',
    p_aggregate_id => v_row.id, p_aggregate_ref => v_row.ref,
    p_payload => pg_catalog.jsonb_build_object('sourceId', v_row.id::text, 'name', v_row.name),
    p_summary => pg_catalog.format('Knowledge source "%s" created', v_row.name),
    p_actor => pg_catalog.jsonb_build_object('kind', app.actor_kind()::text,
                 'id', COALESCE(app.jwt() ->> 'sub','unknown'), 'name', NULL));

  RETURN app.ok(app._knowledge_source_row(v_row));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.check_knowledge_source(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.knowledge_sources%ROWTYPE;
  v_prior_hash text;
  v_changed boolean;
BEGIN
  IF NOT app.has_permission('knowledge:source:write') THEN
    RAISE EXCEPTION 'requester lacks %', 'knowledge:source:write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN',
                       'requiredPermission','knowledge:source:write')::text;
  END IF;

  SELECT source.* INTO v_row FROM core.knowledge_sources AS source
   WHERE source.tenant_id = v_tenant AND (source.id::text = p_id OR source.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such source'
      USING ERRCODE = 'TRNOS', DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  v_prior_hash := v_row.content_hash;
  -- No live re-fetch happens from SQL (that is a worker/edge concern); this
  -- records that a check ran and reports whatever monitor_status already
  -- names, matching the fixture's `changed = monitorStatus ===
  -- CHANGED_REVIEW_PENDING` (FC:2147) rather than fabricating a new hash.
  v_changed := v_row.monitor_status = 'CHANGED_REVIEW_PENDING';

  UPDATE core.knowledge_sources
     SET last_checked_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE tenant_id = v_tenant AND id = v_row.id
  RETURNING * INTO v_row;

  IF v_changed THEN
    PERFORM app.emit_event(
      p_tenant_id => v_tenant, p_type => 'SourceChanged', p_aggregate_type => 'KNOWLEDGE_SOURCE',
      p_aggregate_id => v_row.id, p_aggregate_ref => v_row.ref,
      p_payload => pg_catalog.jsonb_build_object('sourceId', v_row.id::text,
                     'oldHash', v_prior_hash, 'newHash', v_row.content_hash),
      p_summary => pg_catalog.format('%s flagged changed', v_row.name),
      p_actor => pg_catalog.jsonb_build_object('kind','SYSTEM','id','sys_monitor','name','Corpus monitor'));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id', v_row.id::text, 'monitorStatus', v_row.monitor_status::text,
    'lastCheckedAt', v_row.last_checked_at, 'contentHash', v_row.content_hash,
    'changed', v_changed));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.reingest_knowledge_source(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.knowledge_sources%ROWTYPE;
BEGIN
  IF NOT app.has_permission('knowledge:source:reingest') THEN
    RAISE EXCEPTION 'requester lacks %', 'knowledge:source:reingest'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN',
                       'requiredPermission','knowledge:source:reingest')::text;
  END IF;

  SELECT source.* INTO v_row FROM core.knowledge_sources AS source
   WHERE source.tenant_id = v_tenant AND (source.id::text = p_id OR source.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such source'
      USING ERRCODE = 'TRNOS', DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- No embedding/reingest job type exists in apps/worker (checked: not even
  -- listed in UNIMPLEMENTED_012_JOB_TYPES). No job enqueued; the source is
  -- marked PENDING (queued, honestly) rather than faked INDEXED. See header.
  UPDATE core.knowledge_sources
     SET embedding_status = 'PENDING', updated_at = pg_catalog.now()
   WHERE tenant_id = v_tenant AND id = v_row.id
  RETURNING * INTO v_row;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id', v_row.id::text, 'embeddingStatus', v_row.embedding_status::text,
    'chunks', v_row.chunk_count));
END;
$fn$;

COMMENT ON FUNCTION core.reingest_knowledge_source(text) IS
  '027. POST /v1/knowledge/sources/{id}/reingest. Returns the QUEUED state '
  '(embeddingStatus=PENDING, no runId) - there is no worker handler to claim '
  'a reingest job, reported rather than faked. Worker gap, not SQL.';

CREATE OR REPLACE FUNCTION core.list_library_assets(p_page jsonb DEFAULT '{"size":50}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_size    integer;
  v_cursor  text := NULLIF(p_page ->> 'cursor', '');
  v_cur_at  timestamptz;
  v_cur_id  uuid;
  v_data    jsonb;
  v_total   integer;
  v_next    text;
  v_last_at timestamptz;
  v_last_id uuid;
  v_count   integer;
BEGIN
  IF NOT app.has_permission('library:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission','library:read'));
  END IF;

  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','page.size','reason', SQLERRM))));
  END;

  IF v_cursor IS NOT NULL THEN
    BEGIN
      SELECT decoded.at, decoded.id INTO v_cur_at, v_cur_id FROM app._cursor_decode(v_cursor) AS decoded;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','page.cursor','reason','MALFORMED_CURSOR'))));
    END;
  END IF;

  SELECT pg_catalog.count(*) INTO v_total FROM core.library_assets AS asset WHERE asset.tenant_id = v_tenant;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id',        page.id::text,
           'title',     page.title,
           'kind',      page.kind,
           'version',   page.version,
           'owner',     app._actor('HUMAN', page.owner_id::text, profile.display_name),
           'updatedAt', page.updated_at,
           'subjectRef', CASE WHEN page.subject_id IS NULL THEN NULL
                          ELSE pg_catalog.jsonb_build_object('type', page.subject_type, 'id', page.subject_id::text) END,
           'retrievalScopes', COALESCE(pg_catalog.to_jsonb(page.retrieval_scopes::text[]), '[]'::jsonb),
           'status',    page.status,
           'timesUsed', page.times_used,
           'lastUsedAt', page.last_used_at,
           'format',    page.format,
           'sizeBytes', page.size_bytes)
         ORDER BY page.updated_at DESC, page.id DESC), '[]'::jsonb),
         pg_catalog.count(*), pg_catalog.min(page.updated_at)
    INTO v_data, v_count, v_last_at
    FROM (
      SELECT asset.* FROM core.library_assets AS asset
       WHERE asset.tenant_id = v_tenant
         AND (v_cur_at IS NULL OR (asset.updated_at, asset.id) < (v_cur_at, v_cur_id))
       ORDER BY asset.updated_at DESC, asset.id DESC
       LIMIT v_size
    ) AS page
    LEFT JOIN public.user_profiles AS profile
      ON profile.tenant_id = v_tenant AND profile.user_id = page.owner_id;

  SELECT page.updated_at, page.id INTO v_last_at, v_last_id
    FROM (
      SELECT asset.updated_at, asset.id FROM core.library_assets AS asset
       WHERE asset.tenant_id = v_tenant
         AND (v_cur_at IS NULL OR (asset.updated_at, asset.id) < (v_cur_at, v_cur_id))
       ORDER BY asset.updated_at DESC, asset.id DESC
       LIMIT v_size
    ) AS page
   ORDER BY page.updated_at ASC, page.id ASC LIMIT 1;

  v_next := CASE WHEN v_count = v_size AND v_last_at IS NOT NULL
                  THEN app._cursor_encode(v_last_at, v_last_id) ELSE NULL END;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_data, 'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total)));
END;
$fn$;

COMMENT ON FUNCTION core.list_library_assets(jsonb) IS
  '027. GET (Knowledge > Library leaf). Not a contract endpoint - '
  'FixtureLibraryAsset (data/library.ts), gated on the new library:read '
  'permission (see migration header).';

-- ═══ 5 · Settings · AI routing, providers (read), usage, budgets, tenant ═══

CREATE OR REPLACE FUNCTION core.get_ai_routing()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_version uuid;
  v_data    jsonb;
BEGIN
  IF NOT app.has_permission('ai:routing:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission','ai:routing:read'));
  END IF;

  SELECT version.id INTO v_version FROM core.routing_matrix_versions AS version
   WHERE version.tenant_id = v_tenant AND version.applies @> pg_catalog.now()
   ORDER BY version.effective_from DESC LIMIT 1;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'actionType', entry.action_type,
           'tier', entry.tier_key,
           'escalationLadder', pg_catalog.to_jsonb(entry.escalation_ladder),
           'jury', entry.jury,
           'requiredForAutonomous', entry.required_for_autonomous)
         ORDER BY entry.action_type), '[]'::jsonb)
    INTO v_data
    FROM core.routing_entries AS entry
   WHERE entry.tenant_id = v_tenant AND entry.version_id = v_version;

  -- unsavedChanges: always 0 (no staged-edit ledger in 001-021 - see header).
  RETURN app.ok(pg_catalog.jsonb_build_object('data', v_data, 'unsavedChanges', 0));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.put_ai_routing(p_entries jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_version core.routing_matrix_versions%ROWTYPE;
  v_entry   jsonb;
  v_actor   jsonb;
BEGIN
  IF NOT app.has_permission('ai:routing:write') THEN
    RAISE EXCEPTION 'requester lacks %', 'ai:routing:write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN','requiredPermission','ai:routing:write')::text;
  END IF;
  IF pg_catalog.jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be an array'
      USING ERRCODE = 'TRNOS', DETAIL = pg_catalog.jsonb_build_object('code','VALIDATION_FAILED')::text;
  END IF;

  -- §17: applies to FUTURE runs only, never retroactive - a NEW matrix
  -- version, closing the current one, matching core.runs.routing_version_id
  -- (013) so a run's version is provable after the fact.
  UPDATE core.routing_matrix_versions
     SET effective_to = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE tenant_id = v_tenant AND effective_to IS NULL;

  INSERT INTO core.routing_matrix_versions (tenant_id, label, effective_from)
  VALUES (v_tenant, 'routing-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
          pg_catalog.now())
  RETURNING * INTO v_version;

  FOR v_entry IN SELECT * FROM pg_catalog.jsonb_array_elements(p_entries) LOOP
    INSERT INTO core.routing_entries
      (tenant_id, version_id, action_type, tier_key, escalation_ladder, jury, required_for_autonomous)
    VALUES
      (v_tenant, v_version.id, v_entry ->> 'actionType', v_entry ->> 'tier',
       COALESCE((SELECT pg_catalog.array_agg(value) FROM pg_catalog.jsonb_array_elements_text(
                   COALESCE(v_entry -> 'escalationLadder', '[]'::jsonb))), ARRAY[]::text[]),
       COALESCE(v_entry -> 'jury', '{"mode":"GATE","quorum":1,"of":1,"tiers":[]}'::jsonb),
       COALESCE((v_entry -> 'requiredForAutonomous')::boolean, false));
  END LOOP;

  v_actor := pg_catalog.jsonb_build_object('kind', app.actor_kind()::text,
    'id', COALESCE(app.jwt() ->> 'sub','unknown'), 'name', NULL);
  PERFORM app.emit_event(
    p_tenant_id => v_tenant, p_type => 'RoutingUpdated', p_aggregate_type => 'ROUTING_MATRIX_VERSION',
    p_aggregate_id => v_version.id, p_aggregate_ref => v_version.label,
    p_payload => pg_catalog.jsonb_build_object('versionId', v_version.id::text),
    p_summary => 'AI routing updated', p_actor => v_actor);

  RETURN core.get_ai_routing();
END;
$fn$;

CREATE OR REPLACE FUNCTION core.list_providers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_data   jsonb;
BEGIN
  IF NOT app.has_permission('ai:provider:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission','ai:provider:read'));
  END IF;

  -- MASKED ROWS ONLY. Never the key - core.ai_provider_keys never holds it
  -- (013). See migration header for createProvider/testProvider/revealProvider.
  --
  -- `key_ref LIKE 'retired:%'` is excluded: 029's delete tombstones a key
  -- that still has app.key_access_audit rows rather than deleting it (013's
  -- FK there is ON DELETE RESTRICT), so a "deleted" key would otherwise keep
  -- showing up here as INVALID. `addedBy` is projected into the contract's
  -- EditedBy shape {id, name, at} - core.ai_provider_keys.added_by is an
  -- actor jsonb {kind, id, name} with no timestamp of its own; `added_at` is
  -- the separate column that carries it.
  --
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', key.provider_ref, 'provider', key.provider::text, 'label', key.label,
           'status', key.status::text, 'maskedKey', key.masked_key,
           'scopeTiers', pg_catalog.to_jsonb(key.scope_tiers),
           'spendMonth', app._money(0, key.currency),
           'billingOwner', key.billing_owner::text, 'region', key.region,
           'lastTestedAt', key.last_tested_at,
           'addedBy', pg_catalog.jsonb_build_object(
                        'id', key.added_by ->> 'id',
                        'name', COALESCE(key.added_by ->> 'name', key.added_by ->> 'id'),
                        'at', key.added_at))
         || CASE WHEN key.cap_sen IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('cap', app._money(key.cap_sen, key.currency)) END
         || CASE WHEN key.rotation_date IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('rotationDate', key.rotation_date::text) END
         || CASE WHEN key.invalid_since IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('invalidSince', key.invalid_since) END
         || CASE WHEN key.active_fallback_tier IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('activeFallbackTier', key.active_fallback_tier) END
         ORDER BY key.provider_ref), '[]'::jsonb)
    INTO v_data
    FROM core.ai_provider_keys AS key
   WHERE key.tenant_id = v_tenant
     AND key.key_ref NOT LIKE 'retired:%';

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_data, 'page', pg_catalog.jsonb_build_object('next', NULL, 'total', pg_catalog.jsonb_array_length(v_data))));
END;
$fn$;

COMMENT ON FUNCTION core.list_providers() IS
  '027. GET /v1/ai/providers (read half only - see migration header for the '
  'BYOK write gap: createProvider/testProvider/revealProvider need an Edge '
  'Function this lane does not build). currency default MYR on core.ai_provider_keys.';

CREATE OR REPLACE FUNCTION core.get_usage(p_period text DEFAULT NULL, p_group_by text DEFAULT 'TIER')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_period  text := COALESCE(NULLIF(p_period,''), pg_catalog.to_char(pg_catalog.now(),'YYYY-MM'));
  v_totals  jsonb;
  v_breakdown jsonb;
  v_budgets jsonb;
  v_forecast bigint;
  v_cap      bigint;
BEGIN
  IF NOT app.has_permission('ai:usage:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission','ai:usage:read'));
  END IF;
  IF p_group_by NOT IN ('TIER','AGENT','ACTION_TYPE') THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','groupBy','reason','must be TIER, AGENT or ACTION_TYPE'))));
  END IF;

  SELECT pg_catalog.jsonb_build_object(
           'llm', app._money(COALESCE(pg_catalog.sum(rollup.spend_sen),0)::bigint,'MYR'),
           'whatsapp', app._money(0,'MYR'),
           'compute', app._money(0,'MYR'),
           'cacheHitRate', 0,
           'offPeakShare', 0,
           'estimatedCacheSaving', app._money(COALESCE(pg_catalog.sum(rollup.cache_saving_sen),0)::bigint,'MYR'))
    INTO v_totals
    FROM app.usage_rollup AS rollup
   WHERE rollup.tenant_id = v_tenant AND rollup.period = v_period AND rollup.scope::text = p_group_by;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'key', rollup.key, 'label', rollup.key,
           'spend', app._money(rollup.spend_sen,'MYR'),
           'drillTo', '/settings/ai/usage/' || rollup.key)
         ORDER BY rollup.spend_sen DESC), '[]'::jsonb)
    INTO v_breakdown
    FROM app.usage_rollup AS rollup
   WHERE rollup.tenant_id = v_tenant AND rollup.period = v_period AND rollup.scope::text = p_group_by;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'scope', budget.scope::text, 'key', budget.key,
           'cap', app._money(budget.cap_sen, budget.currency::text),
           'spend', app._money(COALESCE(rollup.spend_sen,0), budget.currency::text),
           'state', CASE WHEN COALESCE(rollup.spend_sen,0) >= budget.cap_sen THEN 'PAUSED'
                         WHEN budget.cap_sen > 0 AND COALESCE(rollup.spend_sen,0)::numeric / budget.cap_sen > budget.near_threshold
                           THEN 'NEAR' ELSE 'WITHIN' END)
         ORDER BY budget.scope, budget.key), '[]'::jsonb)
    INTO v_budgets
    FROM core.ai_budgets AS budget
    LEFT JOIN app.usage_rollup AS rollup
      ON rollup.tenant_id = budget.tenant_id AND rollup.period = v_period
     AND rollup.scope = budget.scope AND rollup.key = budget.key
   WHERE budget.tenant_id = v_tenant;

  SELECT COALESCE(pg_catalog.sum(budget.cap_sen),0) INTO v_cap FROM core.ai_budgets AS budget
   WHERE budget.tenant_id = v_tenant;

  -- forecast: no forecasting model in 001-021; linear day-of-month projection
  -- of the period's spend so far, flagged as an approximation in the PR.
  -- pg_catalog.date_part, not EXTRACT: under search_path = '' the EXTRACT
  -- grammar cannot be schema-qualified at all (013's own note, repeated).
  SELECT COALESCE(pg_catalog.round(pg_catalog.sum(rollup.spend_sen)
           * pg_catalog.date_part('day', (pg_catalog.date_trunc('month', pg_catalog.now())
             + interval '1 month' - interval '1 day'))
           / GREATEST(pg_catalog.date_part('day', pg_catalog.now()), 1)), 0)::bigint
    INTO v_forecast
    FROM app.usage_rollup AS rollup
   WHERE rollup.tenant_id = v_tenant AND rollup.period = v_period;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'period', v_period, 'totals', v_totals, 'forecast', app._money(v_forecast,'MYR'),
    'cap', app._money(v_cap,'MYR'), 'breakdown', v_breakdown, 'budgets', v_budgets));
END;
$fn$;

-- 021 is the effective executor when 027 applies. Keep its body intact and
-- replace only the pre-013 BUDGET_CAP_RAISE stub now that core.ai_budgets
-- exists. The row is locked and the queued request is revalidated at decision
-- time so an approval cannot write a missing budget, cross currencies, or turn
-- into a cap lower while it waits.
CREATE OR REPLACE FUNCTION app.execute_in_database_action(p_action_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_request core.action_requests%ROWTYPE;
BEGIN
  SELECT request.* INTO v_request
    FROM core.action_requests AS request
   WHERE request.id = p_action_request_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'action request % does not exist', p_action_request_id
      USING ERRCODE = 'no_data_found';
  END IF;

  CASE v_request.action_type
    WHEN 'ENQUIRY_ARCHIVE' THEN
      UPDATE core.enquiries SET status = COALESCE(v_request.payload ->> 'status','ARCHIVED')::core.enquiry_status
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'OPPORTUNITY_CONVERT' THEN
      UPDATE core.enquiries SET status = 'CONVERTED'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    -- 021 · R18. Locked, then re-checked: an approval decided later must still
    -- refuse a deal that moved while it waited.
    WHEN 'OPPORTUNITY_STAGE_CHANGE' THEN
      PERFORM 1 FROM core.opportunities
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id
       FOR UPDATE;
      PERFORM app.check_opportunity_stage_move(
        v_request.tenant_id, v_request.target_id, v_request.payload);
      UPDATE core.opportunities
         SET stage = (v_request.payload ->> 'stage')::core.opportunity_stage,
             stage_changed_at = pg_catalog.now(),
             -- 005's opportunities_lost_needs_reason names LOST; the reason
             -- lands in the column that CHECK reads, and nowhere else.
             lost_reason = CASE WHEN (v_request.payload ->> 'stage')::core.opportunity_stage = 'LOST'
                                THEN v_request.payload ->> 'reason' ELSE lost_reason END
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'TNA_RECOMMENDATION_ACCEPT' THEN
      UPDATE core.tnas SET status = 'COMPLETE', completed_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'PROPOSAL_SEND' THEN
      UPDATE core.proposals SET status = 'SENT', sent_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'QUOTATION_APPLY' THEN
      UPDATE core.quotations SET status = 'APPLIED'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'DISCOUNT_APPROVE' THEN
      UPDATE core.quotations
         SET sell_price_sen = COALESCE((v_request.payload ->> 'sellPriceSen')::bigint, sell_price_sen),
             discount_approval_id = v_request.id
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'TRAINER_BOOK' THEN
      UPDATE core.trainer_bookings SET state = 'CONFIRMED'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'ENGAGEMENT_CLOSE_OUT' THEN
      UPDATE core.engagements SET status = 'CLOSED', closed_out_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'ATTENDANCE_APPROVE' THEN
      UPDATE core.attendance_days
         SET status = 'LOCKED', approved_by_kind = v_request.requested_by_kind::app.actor_kind,
             approved_by_id = v_request.requested_by_id,
             approved_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'ATTENDANCE_UNLOCK' THEN
      UPDATE core.attendance_days
         SET status = 'OPEN', unlock_reason = v_request.payload ->> 'reason'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'HRDC_PACKET_MARK_SUBMITTED' THEN
      UPDATE core.hrdc_packets
         SET status = 'SUBMITTED',
             claim_reference = v_request.payload ->> 'claimReference',
             claim_submitted_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'INVOICE_CREATE' THEN
      INSERT INTO core.invoices
        (id,tenant_id,organisation_id,engagement_id,status,created_by_kind,created_by_id)
      VALUES
        (v_request.target_id,v_request.tenant_id,
         (v_request.payload ->> 'organisationId')::uuid,
         NULLIF(v_request.payload ->> 'engagementId','')::uuid,
         'DRAFT',v_request.requested_by_kind::app.actor_kind,v_request.requested_by_id);
    WHEN 'INVOICE_PUSH' THEN
      UPDATE core.invoices
         SET status = 'SENT', issued_at = COALESCE(issued_at,pg_catalog.now()),
             sync_state = 'SENT', sync_last_attempt_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'PAYMENT_RECORD' THEN
      INSERT INTO core.payments
        (tenant_id,invoice_id,amount_sen,currency,method,external_reference,
         created_by_kind,created_by_id)
      VALUES
        (v_request.tenant_id,v_request.target_id,
         (v_request.payload #>> '{amount,amount}')::bigint,
         COALESCE(v_request.payload #>> '{amount,currency}','MYR')::core.currency_code,
         COALESCE(v_request.payload ->> 'method','BANK_TRANSFER'),
         v_request.payload ->> 'externalReference',
         v_request.requested_by_kind::app.actor_kind,v_request.requested_by_id);
    WHEN 'REMINDER_SEND' THEN
      UPDATE core.collections_cases
         SET stage = (v_request.payload ->> 'stage')::core.collection_stage,
             stage_entered_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'FOLLOWUP_SEND' THEN
      UPDATE core.follow_ups SET status = 'SENT'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'BROADCAST_SEND' THEN
      NULL; -- fan-out is external and 012 owns its jobs
    WHEN 'AGENT_AUTONOMY_CHANGE' THEN
      INSERT INTO core.autonomy_grants
        (id,tenant_id,agent_id,action_type,level,approver_role,value_threshold_sen,
         min_confidence,granted_by)
      VALUES
        (v_request.target_id,v_request.tenant_id,v_request.payload ->> 'agentId',
         v_request.payload ->> 'actionType',v_request.payload ->> 'level',
         v_request.payload ->> 'approverRole',
         (v_request.payload ->> 'valueThresholdSen')::bigint,
         COALESCE((v_request.payload ->> 'minConfidence')::numeric,0.700),
         v_request.requested_by_id)
      ON CONFLICT (tenant_id,agent_id,action_type) DO UPDATE
        SET level = EXCLUDED.level,
            approver_role = EXCLUDED.approver_role,
            value_threshold_sen = EXCLUDED.value_threshold_sen,
            min_confidence = EXCLUDED.min_confidence,
            granted_by = EXCLUDED.granted_by,
            granted_at = pg_catalog.now();
    WHEN 'AGENT_PAUSE' THEN
      UPDATE core.autonomy_grants
         SET paused = true, paused_at = pg_catalog.now(),
             paused_reason = COALESCE(v_request.payload ->> 'reason','MANUAL')
       WHERE tenant_id = v_request.tenant_id
         AND agent_id = v_request.payload ->> 'agentId'
         AND (v_request.payload ->> 'actionType' IS NULL
              OR action_type = v_request.payload ->> 'actionType');
    WHEN 'BUDGET_CAP_RAISE' THEN
      DECLARE
        v_budget             core.ai_budgets%ROWTYPE;
        v_requested_cap      bigint;
        v_requested_currency text := v_request.payload #>> '{requestedCap,currency}';
      BEGIN
        BEGIN
          v_requested_cap := (v_request.payload #>> '{requestedCap,amount}')::bigint;
        EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'approved budget cap is invalid'
            USING ERRCODE = 'TRNOS',
                  DETAIL = pg_catalog.jsonb_build_object(
                    'code','VALIDATION_FAILED','reason','INVALID_CAP')::text;
        END;

        SELECT budget.* INTO v_budget
          FROM core.ai_budgets AS budget
         WHERE budget.tenant_id = v_request.tenant_id
           AND budget.id = NULLIF(v_request.payload ->> 'budgetId','')::uuid
           AND budget.scope::text = v_request.payload ->> 'scope'
           AND budget.key = v_request.payload ->> 'key'
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'approved budget no longer exists'
            USING ERRCODE = 'TRNOS',
                  DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
        END IF;
        IF v_requested_currency IS DISTINCT FROM v_budget.currency::text THEN
          RAISE EXCEPTION 'approved budget currency does not match'
            USING ERRCODE = 'TRNOS',
                  DETAIL = pg_catalog.jsonb_build_object(
                    'code','VALIDATION_FAILED','reason','CURRENCY_MISMATCH',
                    'expected',v_budget.currency::text)::text;
        END IF;
        IF v_requested_cap IS NULL OR v_requested_cap <= v_budget.cap_sen THEN
          RAISE EXCEPTION 'approved cap is no longer a raise'
            USING ERRCODE = 'TRNOS',
                  DETAIL = pg_catalog.jsonb_build_object(
                    'code','VALIDATION_FAILED','reason','CAP_NOT_RAISE',
                    'currentCapSen',v_budget.cap_sen)::text;
        END IF;

        UPDATE core.ai_budgets
           SET cap_sen = v_requested_cap, updated_at = pg_catalog.now()
         WHERE tenant_id = v_request.tenant_id AND id = v_budget.id;

        PERFORM app.emit_event(
          p_tenant_id => v_request.tenant_id,
          p_type => 'BudgetCapChanged',
          p_aggregate_type => 'AI_BUDGET',
          p_aggregate_id => v_budget.id,
          p_aggregate_ref => v_budget.scope::text || ':' || v_budget.key,
          p_payload => pg_catalog.jsonb_build_object(
            'scope',v_budget.scope::text,'key',v_budget.key,'capSen',v_requested_cap),
          p_summary => pg_catalog.format(
            '%s/%s cap set to %s sen',v_budget.scope,v_budget.key,v_requested_cap),
          p_actor => pg_catalog.jsonb_build_object(
            'kind',v_request.requested_by_kind::text,
            'id',v_request.requested_by_id,
            'name',NULL));
      END;
    WHEN 'RULE_CHANGE_APPROVE' THEN
      UPDATE core.rule_changes SET status = 'APPROVED'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'ACCOUNT_TRADING_HOLD' THEN
      UPDATE core.collections_cases
         SET stage = 'TRADING_HOLD', stage_entered_at = pg_catalog.now(),
             trading_hold_action_id = v_request.id
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    ELSE
      RAISE EXCEPTION 'unknown action type %L', v_request.action_type
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$fn$;

CREATE OR REPLACE FUNCTION core.put_budget(p_scope text, p_key text, p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_row     core.ai_budgets%ROWTYPE;
  v_new_cap bigint;
  v_actor   jsonb;
  v_spend   bigint;
BEGIN
  -- A raise is authorised inside app.perform_action by ai:budget:raise; a
  -- direct lower is authorised here by ai:budget:write. Refuse principals that
  -- hold neither before reading whether the target row exists.
  IF NOT app.has_permission('ai:budget:raise')
     AND NOT app.has_permission('ai:budget:write') THEN
    RAISE EXCEPTION 'requester lacks a budget write permission'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','requiredPermission','ai:budget:write')::text;
  END IF;

  BEGIN
    v_new_cap := (p_body #>> '{cap,amount}')::bigint;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'cap invalid'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object('field','cap.amount','reason','INVALID')))::text;
  END;

  SELECT budget.* INTO v_row FROM core.ai_budgets AS budget
   WHERE budget.tenant_id = v_tenant AND budget.scope = p_scope::core.budget_scope AND budget.key = p_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such budget'
      USING ERRCODE = 'TRNOS', DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;
  IF v_new_cap IS NULL OR v_new_cap < 0 THEN
    RAISE EXCEPTION 'cap invalid'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object('field','cap.amount','reason','INVALID')))::text;
  END IF;
  IF (p_body #>> '{cap,currency}') IS DISTINCT FROM v_row.currency::text THEN
    RAISE EXCEPTION 'budget currency does not match'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                  'field','cap.currency','reason','CURRENCY_MISMATCH',
                  'expected',v_row.currency::text)))::text;
  END IF;

  IF v_new_cap > v_row.cap_sen THEN
    RETURN core.perform_action(
      p_type => 'BUDGET_CAP_RAISE',
      p_target_ref => v_row.scope::text || ':' || v_row.key,
      p_payload => pg_catalog.jsonb_build_object(
        'budgetId',v_row.id::text,
        'scope',v_row.scope::text,
        'key',v_row.key,
        'requestedCap',pg_catalog.jsonb_build_object(
          'amount',v_new_cap,'currency',v_row.currency::text)));
  END IF;

  IF NOT app.has_permission('ai:budget:write') THEN
    RAISE EXCEPTION 'requester lacks %', 'ai:budget:write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN','requiredPermission','ai:budget:write')::text;
  END IF;

  UPDATE core.ai_budgets
     SET cap_sen = v_new_cap, updated_at = pg_catalog.now()
   WHERE tenant_id = v_tenant AND id = v_row.id
  RETURNING * INTO v_row;

  SELECT COALESCE(rollup.spend_sen, 0) INTO v_spend FROM app.usage_rollup AS rollup
   WHERE rollup.tenant_id = v_tenant AND rollup.scope = v_row.scope AND rollup.key = v_row.key
     AND rollup.period = pg_catalog.to_char(pg_catalog.now(),'YYYY-MM');

  v_actor := pg_catalog.jsonb_build_object('kind', app.actor_kind()::text,
    'id', COALESCE(app.jwt() ->> 'sub','unknown'), 'name', NULL);
  PERFORM app.emit_event(
    p_tenant_id => v_tenant, p_type => 'BudgetCapChanged', p_aggregate_type => 'AI_BUDGET',
    p_aggregate_id => v_row.id, p_aggregate_ref => v_row.scope::text || ':' || v_row.key,
    p_payload => pg_catalog.jsonb_build_object('scope', v_row.scope::text, 'key', v_row.key,
                   'capSen', v_row.cap_sen),
    p_summary => pg_catalog.format('%s/%s cap set to %s sen', v_row.scope, v_row.key, v_row.cap_sen),
    p_actor => v_actor);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'scope', v_row.scope::text, 'key', v_row.key,
    'cap', app._money(v_row.cap_sen, v_row.currency::text),
    'spend', app._money(v_spend, v_row.currency::text),
    'state', CASE WHEN v_spend >= v_row.cap_sen THEN 'PAUSED'
                  WHEN v_row.cap_sen > 0 AND v_spend::numeric / v_row.cap_sen > v_row.near_threshold THEN 'NEAR'
                  ELSE 'WITHIN' END));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_tenant()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    public.tenants%ROWTYPE;
BEGIN
  IF NOT app.has_permission('tenant:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission','tenant:read'));
  END IF;

  SELECT tenant.* INTO v_row FROM public.tenants AS tenant WHERE tenant.id = v_tenant;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', v_tenant::text));
  END IF;

  -- FixtureTenant has no `id` field (data/tenant.ts:53) - it stamps events
  -- with the tenant already implicit from auth (§1).
  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id', v_row.id::text, 'name', v_row.name, 'locale', v_row.locale,
    'timezone', v_row.timezone, 'currency', 'MYR'));
END;
$fn$;

-- ═══ 6 · Grants ══════════════════════════════════════════════════════════

DO $grants$
DECLARE v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_catalog.pg_proc AS p
     WHERE p.pronamespace = 'core'::regnamespace
       AND p.proname IN ('list_agents','pause_agent','list_runs','get_run','retry_run','dead_letter_run',
         'create_knowledge_source','check_knowledge_source','reingest_knowledge_source',
         'list_library_assets','get_ai_routing','put_ai_routing','list_providers','get_usage',
         'put_budget','get_tenant')
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
  END LOOP;
END
$grants$;

-- ═══ 7 · $verify$ ════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_bad  text[];
  v_gate record;
  v_body text;
  v_pos  integer;
  v_names text[] := ARRAY['list_agents','pause_agent','list_runs','get_run','retry_run','dead_letter_run',
         'create_knowledge_source','check_knowledge_source','reingest_knowledge_source',
         'list_library_assets','get_ai_routing','put_ai_routing','list_providers','get_usage',
         'put_budget','get_tenant'];
BEGIN
  -- V1 · one definition each, correct posture, correct grants.
  SELECT pg_catalog.array_agg(g.name ORDER BY g.name) INTO v_bad
    FROM pg_catalog.unnest(v_names) AS g(name)
   WHERE (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
           WHERE p.pronamespace = 'core'::regnamespace AND p.proname = g.name) <> 1
      OR NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_proc AS p
            WHERE p.pronamespace = 'core'::regnamespace AND p.proname = g.name
              AND p.prosecdef
              AND p.proconfig @> ARRAY['search_path=""']
              AND p.proconfig @> ARRAY['statement_timeout=10s']
              AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '027 verify V1: overload count or posture wrong on %', v_bad;
  END IF;

  -- V2 · every gate is the first permission-relevant statement: no `FROM
  -- core.`/`FROM app.` read precedes app.has_permission( in the body.
  FOR v_gate IN
    SELECT p.oid, p.proname FROM pg_catalog.pg_proc AS p
     WHERE p.pronamespace = 'core'::regnamespace AND p.proname = ANY (v_names)
  LOOP
    v_body := app._body_sql(v_gate.oid::regprocedure);
    v_pos  := pg_catalog.strpos(v_body, 'app.has_permission(');
    IF v_pos = 0
       OR (pg_catalog.strpos(v_body, 'FROM core.') > 0 AND pg_catalog.strpos(v_body, 'FROM core.') < v_pos)
       OR (pg_catalog.strpos(v_body, 'FROM app.') > 0 AND pg_catalog.strpos(v_body, 'FROM app.') < v_pos) THEN
      v_bad := pg_catalog.array_append(v_bad, v_gate.proname::text);
    END IF;
  END LOOP;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '027 verify V2: no permission gate, or a read before it, in %', v_bad;
  END IF;

  -- V3 · the new permissions exist and are granted to exactly the six staff roles.
  IF (SELECT pg_catalog.count(*) FROM app.role_permissions
       WHERE permission = 'library:read' AND role IN ('SALES','SALES_MANAGER','OPS','FINANCE','MD','ADMIN')) <> 6
     OR (SELECT pg_catalog.count(*) FROM app.role_permissions WHERE permission = 'library:read') <> 6
     OR (SELECT pg_catalog.count(*) FROM app.role_permissions
       WHERE permission = 'tenant:read' AND role IN ('SALES','SALES_MANAGER','OPS','FINANCE','MD','ADMIN')) <> 6
     OR (SELECT pg_catalog.count(*) FROM app.role_permissions WHERE permission = 'tenant:read') <> 6 THEN
    RAISE EXCEPTION '027 verify V3: library:read/tenant:read not granted to exactly the six staff roles';
  END IF;

  -- V4 · core.library_assets is finalised: RLS forced, zero policies (only a
  -- BYPASSRLS/NOSUPERUSER owner or 014's future grant can read it).
  IF NOT (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_catalog.pg_class AS c
           WHERE c.oid = 'core.library_assets'::regclass)
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
          WHERE schemaname = 'core' AND tablename = 'library_assets') <> 0 THEN
    RAISE EXCEPTION '027 verify V4: core.library_assets is not forced-RLS-zero-policy';
  END IF;

  -- V5 · run:retry / run:dead_letter stay ADMIN-only (002's own invariant,
  -- reasserted here because this migration is the first client-callable use
  -- of them since 002 seeded the matrix).
  IF EXISTS (SELECT 1 FROM app.role_permissions
              WHERE permission IN ('run:retry','run:dead_letter') AND role <> 'ADMIN') THEN
    RAISE EXCEPTION '027 verify V5: run:retry/run:dead_letter drifted off ADMIN-only';
  END IF;

  -- V6 · put_budget's raise path is unreachable without ai:budget:raise, held
  -- only by MD (mirrors 011:2073's own invariant for BUDGET_CAP_RAISE).
  IF EXISTS (SELECT 1 FROM app.role_permissions WHERE permission = 'ai:budget:raise' AND role <> 'MD') THEN
    RAISE EXCEPTION '027 verify V6: ai:budget:raise drifted off MD-only';
  END IF;
END
$verify$;

COMMIT;
