-- TrainOS hosted demo data for automation/knowledge/AI-settings (027), over
-- the EXISTING tenant `akademi-perdana`.
--
-- Run AFTER supabase/seeds/hosted_demo_akademi_perdana.sql (one transaction,
-- stop on the first error; the file refuses to run otherwise):
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_ops.sql
--
-- Remove exactly what it added:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_ops_wipe.sql
--
-- Pin (ends in ROLLBACK): supabase/seeds/test_hosted_demo_ops.sql
--
-- Hosted-safe by construction, following hosted_demo_akademi_perdana.sql's
-- own conventions:
--   * takes the tenant by slug and never provisions one;
--   * every user reference on a table this seed writes (agent grants, knowledge
--     source `created_by`, library asset `owner_id`) is one of the three real
--     MD members, spread across them;
--   * legal states only: every run is inserted already terminal (SUCCEEDED,
--     FAILED, or FAILED+dead-lettered) rather than walked through a gate that
--     does not exist for runs; every knowledge source starts WATCHING/PENDING;
--   * leaves every `ref` NULL so core.assign_ref allocates it.
--
-- ⚠ ONE DELIBERATE EXCEPTION TO "never writes auth.users": core.agents.principal_user_id
-- is NOT NULL REFERENCES auth.users(id) (013's "one inert auth.users row per
-- agent per tenant, so sub points at something" — 013:983). These rows are not
-- simulated humans: they never log in, hold no membership, and 013 itself
-- designed them as pure plumbing so an agent's JWT `sub` resolves to something.
-- Four such rows are created below, one per seeded agent, each keyed off
-- pg_temp.demo_id so a second run finds them and writes nothing new. Flagged
-- for the orchestrator to confirm before hosted apply.
--
-- Idempotent: every id is pg_temp.demo_id(<stable key>), a uuid in the
-- de270272-5eed-4xxx-8xxx-xxxxxxxxxxxx range (027, "ops" — distinct from
-- hosted_demo_akademi_perdana.sql's de30da7a-5eed-4… range and from every
-- other domain seed's own range), and every INSERT is guarded by NOT EXISTS on
-- that id. A second run writes nothing.
--
-- Row counts: 3 tier_keys, 4 agents (+4 autonomy_grants, +4 principal
-- auth.users rows), 6 runs (3 SUCCEEDED, 2 FAILED, 1 FAILED+dead-lettered), 1
-- routing matrix version + 3 routing_entries, 1 ai_budget, usage_rollup for
-- the current period, 1 ai_provider_key (placeholder, no key material), 3
-- knowledge_sources, 4 library_assets.

CREATE OR REPLACE FUNCTION pg_temp.demo_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ('de270272-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo-ops:' || p_key) AS h) AS k;
$fn$;

DROP TABLE IF EXISTS pg_temp.demo_ops_ctx;
CREATE TEMP TABLE demo_ops_ctx ON COMMIT DROP AS
SELECT tenant.id                                    AS t,
       'd1449fad-b732-4ee2-93c9-37f338e01358'::uuid AS u1,
       'ad615910-2d87-42a4-9855-58f52409ec6d'::uuid AS u2,
       '415dad6e-c53f-4a84-ab50-bf8e9e65223f'::uuid AS u3,
       now()                                         AS at
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $pre$
DECLARE v_staff integer;
BEGIN
  IF (SELECT count(*) FROM demo_ops_ctx) <> 1 THEN
    RAISE EXCEPTION 'hosted demo ops seed: tenant akademi-perdana not found; this seed never provisions';
  END IF;
  -- Any active staff role, not specifically MD: nothing this seed writes is
  -- role-conditioned on u1/u2/u3 (they are only used as generic owner/creator
  -- references), so it must not assume hosted's MD/ADMIN split, which has
  -- changed at least once already (khucode/codeshern are ADMIN, khumeren is MD).
  SELECT count(*) INTO v_staff
    FROM public.memberships m, demo_ops_ctx c
   WHERE m.tenant_id = c.t AND m.user_id IN (c.u1, c.u2, c.u3)
     AND m.role IN ('SALES','SALES_MANAGER','OPS','FINANCE','MD','ADMIN')
     AND m.actor_kind = 'HUMAN' AND m.status = 'ACTIVE';
  IF v_staff <> 3 THEN
    RAISE EXCEPTION 'hosted demo ops seed: expected all three named users as ACTIVE staff members, found %', v_staff;
  END IF;
END
$pre$;

-- ── Tier keys ────────────────────────────────────────────────────────────────
-- 013's own comment claims "016 provisions them per tenant"; checked, 016
-- seeds none. Provisioned here since every table below has a composite FK to
-- this reference table.

INSERT INTO core.tier_keys (tenant_id, tier_key, label, position)
SELECT c.t, v.key, v.label, v.pos
  FROM demo_ops_ctx c, (VALUES
    ('FAST', 'Fast', 1::smallint), ('STANDARD', 'Standard', 2::smallint), ('DEEP', 'Deep', 3::smallint)
  ) AS v(key, label, pos)
 WHERE NOT EXISTS (SELECT 1 FROM core.tier_keys x WHERE x.tenant_id = c.t AND x.tier_key = v.key);

-- ── Agent principals (see the header exception) and the roster ─────────────

INSERT INTO auth.users (id, aud, role, email)
SELECT pg_temp.demo_id('agent-principal:' || v.slug), 'authenticated', 'authenticated',
       v.slug || '@agents.akademiperdana.my'
  FROM (VALUES ('agent_sales_copilot'), ('agent_ops_scheduler'), ('agent_compliance_watch'),
               ('agent_collections_copilot')) AS v(slug)
 WHERE NOT EXISTS (SELECT 1 FROM auth.users x WHERE x.id = pg_temp.demo_id('agent-principal:' || v.slug));

INSERT INTO core.agents (id, tenant_id, agent_id, name, status, principal_user_id, scopes, default_tier, last_run_at)
SELECT pg_temp.demo_id('agent:' || v.slug), c.t, v.slug, v.name, 'ACTIVE',
       pg_temp.demo_id('agent-principal:' || v.slug), v.scopes, v.tier, c.at - v.last_run_ago
  FROM demo_ops_ctx c, (VALUES
    ('agent_sales_copilot',      'Sales Copilot',       ARRAY['proposal:draft','followup:draft'], 'STANDARD', interval '3 hours'),
    ('agent_ops_scheduler',      'Ops Scheduler',       ARRAY['trainer:book','engagement:schedule'], 'FAST', interval '1 day'),
    ('agent_compliance_watch',   'Compliance Watch',    ARRAY['hrdc:monitor','knowledge:check'], 'STANDARD', interval '6 hours'),
    ('agent_collections_copilot','Collections Copilot', ARRAY['collections:draft'], 'FAST', interval '2 days')
  ) AS v(slug, name, scopes, tier, last_run_ago)
 WHERE NOT EXISTS (SELECT 1 FROM core.agents x WHERE x.tenant_id = c.t AND x.agent_id = v.slug);

INSERT INTO core.autonomy_grants (tenant_id, agent_id, action_type, level, approver_role, granted_by)
SELECT c.t, v.slug, v.action_type, v.level, v.approver, 'seed:hosted-demo-ops'
  FROM demo_ops_ctx c, (VALUES
    ('agent_sales_copilot',       'PROPOSAL_SEND',   'ACT_WITH_APPROVAL', 'SALES_MANAGER'),
    ('agent_ops_scheduler',       'TRAINER_BOOK',     'SUGGEST',          'OPS'),
    ('agent_compliance_watch',    'RULE_CHANGE_APPROVE','SUGGEST',        'OPS'),
    ('agent_collections_copilot', 'REMINDER_SEND',    'ACT_WITH_APPROVAL','FINANCE')
  ) AS v(slug, action_type, level, approver)
 WHERE NOT EXISTS (
   SELECT 1 FROM core.autonomy_grants x
    WHERE x.tenant_id = c.t AND x.agent_id = v.slug AND x.action_type = v.action_type);

-- ── Runs: 3 SUCCEEDED, 2 FAILED, 1 FAILED + dead-lettered ───────────────────

INSERT INTO core.runs (id, tenant_id, agent_id, trigger, status, outcome, failure, model, tokens_in, tokens_out,
                        cost_sen, currency, guardrails, started_at, finished_at, duration_ms)
SELECT pg_temp.demo_id('run:' || v.key), c.t, v.agent, v.trigger::jsonb, v.status::core.run_status, v.outcome, v.failure::jsonb,
       v.model, v.tin, v.tout, v.cost, 'MYR', v.guardrails, c.at - v.ago, c.at - v.ago + (v.dur_ms || ' ms')::interval, v.dur_ms
  FROM demo_ops_ctx c, (VALUES
    ('sales-1', 'agent_sales_copilot', '{"type":"ENQUIRY_RECEIVED","ref":"aurora-mfg"}', 'SUCCEEDED', 'PROPOSAL_DRAFTED', NULL,
      'claude-sonnet', 2100, 380, 1200, ARRAY['pdpa_redaction'], interval '2 days', 32000),
    ('ops-1',   'agent_ops_scheduler', '{"type":"SCHEDULE"}', 'SUCCEEDED', 'TRAINER_BOOKED', NULL,
      'claude-haiku', 900, 150, 300, ARRAY[]::text[], interval '1 days', 8000),
    ('cw-1',    'agent_compliance_watch', '{"type":"MONITOR_TICK"}', 'SUCCEEDED', 'NO_CHANGE', NULL,
      'claude-haiku', 400, 60, 120, ARRAY[]::text[], interval '5 hours', 4000),
    ('sales-2', 'agent_sales_copilot', '{"type":"ENQUIRY_RECEIVED","ref":"nusantara-eng"}', 'FAILED', NULL,
      '{"code":"PROVIDER_5XX","message":"Upstream model timeout after 3 attempts","attempts":3,"retryable":true,"deadLettered":false}',
      'claude-sonnet', 1800, 0, 900, ARRAY['pdpa_redaction'], interval '3 days', 41000),
    ('coll-1',  'agent_collections_copilot', '{"type":"RECEIVABLE_AGED","ref":"INV-2026-0279"}', 'FAILED', NULL,
      '{"code":"WA_TEMPLATE_REJECTED","message":"Template not approved for the UTILITY category","attempts":1,"retryable":false,"deadLettered":false}',
      'claude-haiku', 500, 20, 80, ARRAY[]::text[], interval '4 days', 5000),
    ('cw-2',    'agent_compliance_watch', '{"type":"MONITOR_TICK"}', 'FAILED', NULL,
      '{"code":"SOURCE_UNREACHABLE","message":"HRDC portal returned 503 three times","attempts":3,"retryable":false,"deadLettered":true}',
      'claude-haiku', 300, 0, 90, ARRAY[]::text[], interval '6 days', 3000)
  ) AS v(key, agent, trigger, status, outcome, failure, model, tin, tout, cost, guardrails, ago, dur_ms)
 WHERE NOT EXISTS (SELECT 1 FROM core.runs x WHERE x.id = pg_temp.demo_id('run:' || v.key));

-- ── AI routing ───────────────────────────────────────────────────────────────

INSERT INTO core.routing_matrix_versions (id, tenant_id, label, effective_from)
SELECT pg_temp.demo_id('routing-v1'), c.t, 'hosted-demo-v1', c.at - interval '30 days'
  FROM demo_ops_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.routing_matrix_versions x WHERE x.id = pg_temp.demo_id('routing-v1'));

INSERT INTO core.routing_entries (tenant_id, version_id, action_type, tier_key, jury, required_for_autonomous)
SELECT c.t, pg_temp.demo_id('routing-v1'), v.action_type, v.tier, v.jury::jsonb, v.raa
  FROM demo_ops_ctx c, (VALUES
    ('PROPOSAL_SEND',    'STANDARD', '{"mode":"GATE","quorum":1,"of":1,"tiers":["STANDARD"]}', false),
    ('TRAINER_BOOK',     'FAST',     '{"mode":"SAMPLE","quorum":1,"of":1,"tiers":["FAST"],"sampleRate":0.05}', false),
    ('REMINDER_SEND',    'FAST',     '{"mode":"GATE","quorum":1,"of":1,"tiers":["FAST"]}', false)
  ) AS v(action_type, tier, jury, raa)
 WHERE NOT EXISTS (
   SELECT 1 FROM core.routing_entries x
    WHERE x.tenant_id = c.t AND x.version_id = pg_temp.demo_id('routing-v1') AND x.action_type = v.action_type);

-- ── Usage and budget ─────────────────────────────────────────────────────────

INSERT INTO core.ai_budgets (tenant_id, scope, key, cap_sen)
SELECT c.t, 'TIER', 'STANDARD', 5000000
  FROM demo_ops_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.ai_budgets x WHERE x.tenant_id = c.t AND x.scope = 'TIER' AND x.key = 'STANDARD');

INSERT INTO app.usage_rollup (tenant_id, period, scope, key, spend_sen, tokens_in, tokens_out, runs, cache_saving_sen)
SELECT c.t, to_char(c.at, 'YYYY-MM'), 'TIER', 'STANDARD', 269000, 6000, 610, 6, 18000
  FROM demo_ops_ctx c
 WHERE NOT EXISTS (
   SELECT 1 FROM app.usage_rollup x
    WHERE x.tenant_id = c.t AND x.period = to_char(c.at, 'YYYY-MM') AND x.scope = 'TIER' AND x.key = 'STANDARD');

-- ── Provider key: PLACEHOLDER ONLY, NO KEY MATERIAL ─────────────────────────
-- masked_key/key_fingerprint/key_ref are all clearly-fake demo values; no real
-- secret is ever stored on this table regardless (013's design).

INSERT INTO core.ai_provider_keys (id, tenant_id, provider_ref, provider, label, status, masked_key,
                                    key_fingerprint, key_ref, scope_tiers, region, billing_owner, added_by)
SELECT pg_temp.demo_id('provider:anthropic-demo'), c.t, 'prv_anthropic_demo', 'ANTHROPIC',
       'Anthropic (demo placeholder)', 'VALID', 'sk-ant-••••••••••••demo',
       pg_catalog.sha256(pg_catalog.convert_to('hosted-demo-ops:not-a-real-key:' || c.t::text, 'UTF8')),
       'vault:hosted-demo-ops-placeholder-not-real',
       ARRAY['FAST','STANDARD'], 'US', 'CLIENT_ACCOUNT',
       jsonb_build_object('kind', 'HUMAN', 'id', c.u1::text, 'name', 'Seed')
  FROM demo_ops_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.ai_provider_keys x WHERE x.id = pg_temp.demo_id('provider:anthropic-demo'));

-- ── Knowledge sources ────────────────────────────────────────────────────────

INSERT INTO core.knowledge_sources (id, tenant_id, name, source_type, version, ingested_at, chunk_count,
                                     embedding_status, last_checked_at, monitor_status, quarantined, retrieval_scopes,
                                     created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('source:' || v.key), c.t, v.name, 'HRDC_CIRCULAR', v.ver, c.at - v.ago, v.chunks,
       v.estatus::core.embedding_status, c.at - v.checked_ago, v.mstatus::core.monitor_status, v.quarantined,
       v.scopes::core.retrieval_scope[], 'HUMAN', c.u3::text, NULL
  FROM demo_ops_ctx c, (VALUES
    ('hrdc-circular-2026', 'HRDC Corp Circular 3/2026 — Claimable Rates', 'v2', interval '20 days', 340,
      'INDEXED', interval '2 days', 'WATCHING', false, ARRAY['COMPLIANCE']),
    ('pdpa-guidance',      'PDPA Commissioner Guidance Note 2026', 'v1', interval '60 days', 180,
      'INDEXED', interval '10 days', 'CHANGED_REVIEW_PENDING', true, ARRAY['COMPLIANCE']),
    ('sst-service-tax',    'Royal Malaysian Customs SST Guide (Training Services)', 'v3', interval '90 days', 265,
      'INDEXED', interval '30 days', 'WATCHING', false, ARRAY['COMPLIANCE','CLIENT_FACING'])
  ) AS v(key, name, ver, ago, chunks, estatus, checked_ago, mstatus, quarantined, scopes)
 WHERE NOT EXISTS (SELECT 1 FROM core.knowledge_sources x WHERE x.id = pg_temp.demo_id('source:' || v.key));

-- ── Library assets ───────────────────────────────────────────────────────────

INSERT INTO core.library_assets (id, tenant_id, title, kind, version, owner_id, retrieval_scopes,
                                  status, times_used, last_used_at, format, size_bytes)
SELECT pg_temp.demo_id('asset:' || v.key), c.t, v.title, v.kind, v.ver,
       CASE v.owner WHEN 1 THEN c.u1 WHEN 2 THEN c.u2 ELSE c.u3 END,
       v.scopes::core.retrieval_scope[], v.status, v.used, c.at - v.used_ago, v.format, v.bytes
  FROM demo_ops_ctx c, (VALUES
    ('outline-leading-change', 'Leading Change Through Uncertainty — Programme Outline', 'PROGRAMME_OUTLINE', 3, 1,
      ARRAY['CLIENT_FACING'], 'PUBLISHED', 14, interval '5 days', 'PDF', 482000),
    ('case-aurora-safety',     'Aurora Manufacturing — Safety Culture Case Study', 'CASE_STUDY', 1, 2,
      ARRAY['CLIENT_FACING'], 'PUBLISHED', 6, interval '20 days', 'PDF', 310000),
    ('trainer-profile-farah',  'Farah Aziz — Trainer Profile', 'TRAINER_PROFILE', 2, 3,
      ARRAY['CLIENT_FACING'], 'NEEDS_REVIEW', 21, interval '2 days', 'DOCX', 96000),
    ('onepager-data-literacy', 'Data Literacy for Managers — One-Pager', 'ONE_PAGER', 1, 1,
      ARRAY['COMPLIANCE'], 'DRAFT', 0, NULL, 'MD', 12000)
  ) AS v(key, title, kind, ver, owner, scopes, status, used, used_ago, format, bytes)
 WHERE NOT EXISTS (SELECT 1 FROM core.library_assets x WHERE x.id = pg_temp.demo_id('asset:' || v.key));
