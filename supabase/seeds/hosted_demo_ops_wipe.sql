-- Removes exactly the rows supabase/seeds/hosted_demo_ops.sql added to tenant
-- `akademi-perdana`, and nothing else.
--
-- Run:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_ops_wipe.sql
--
-- Seed rows are recognised by their id range (de270272-5eed-4xxx-8xxx-…, see
-- the seed's pg_temp.demo_id) inside this tenant. Deletes in dependency order;
-- the four agent-principal auth.users rows are removed last, after the
-- core.agents rows that reference them.
--
-- Not reverted, by design: core.ref_sequences (004: refs are not gapless).

DROP TABLE IF EXISTS pg_temp.demo_ops_wipe_ctx;
CREATE TEMP TABLE demo_ops_wipe_ctx ON COMMIT DROP AS
SELECT tenant.id AS t, 'de270272-5eed-4%'::text AS marker
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM demo_ops_wipe_ctx) <> 1 THEN
    RAISE EXCEPTION 'hosted demo ops wipe: tenant akademi-perdana not found';
  END IF;
END
$guard$;

DELETE FROM core.autonomy_grants ag USING demo_ops_wipe_ctx c, core.agents a
 WHERE ag.tenant_id = c.t AND ag.agent_id = a.agent_id AND a.id::text LIKE c.marker;

DELETE FROM core.runs x USING demo_ops_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.routing_entries x USING demo_ops_wipe_ctx c
 WHERE x.tenant_id = c.t AND x.version_id::text LIKE c.marker;
DELETE FROM core.routing_matrix_versions x USING demo_ops_wipe_ctx c
 WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM app.usage_rollup x USING demo_ops_wipe_ctx c
 WHERE x.tenant_id = c.t AND x.scope = 'TIER' AND x.key = 'STANDARD';
DELETE FROM core.ai_budgets x USING demo_ops_wipe_ctx c
 WHERE x.tenant_id = c.t AND x.scope = 'TIER' AND x.key = 'STANDARD';

DELETE FROM core.ai_provider_keys x USING demo_ops_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.library_assets x USING demo_ops_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.knowledge_sources x USING demo_ops_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.agents x USING demo_ops_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.tier_keys x USING demo_ops_wipe_ctx c
 WHERE x.tenant_id = c.t AND x.tier_key IN ('FAST','STANDARD','DEEP');

DELETE FROM auth.users x USING demo_ops_wipe_ctx c WHERE x.id::text LIKE c.marker;
