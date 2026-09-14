-- Removes exactly the rows supabase/seeds/hosted_demo_compliance.sql added to
-- tenant `akademi-perdana`, and nothing else.
--
-- Run:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_compliance_wipe.sql
--
-- Seed rows are recognised by their id range (c0341a4e-5eed-4xxx-8xxx-…, see
-- the seed's pg_temp.demo_id) inside this tenant. Deletes in dependency order,
-- children first, and refuses if any row outside that range now references
-- one of the seed's engagements or packets (the seed created engagements —
-- if a later lane's data references one of them, cascading here would take
-- that real row with it).
--
-- NOT REVERTED, BY DESIGN: the three national HRD Corp rules the seed
-- verified (HRD-QUERY-5D, HRD-007, HRD-009). `core.state_transitions` (011)
-- has no `ACTIVE -> PROPOSED` edge for `core.compliance_rules` — verification
-- is not meant to be casually undone, the same way it is not casually granted
-- — so there is no legal way to revert it, and bypassing the trigger to force
-- it would be dishonest about what the wipe actually does. The rules stay
-- ACTIVE and verified after this file runs, exactly like `core.ref_sequences`
-- staying advanced after the base demo wipe.

DROP TABLE IF EXISTS pg_temp.demo_wipe_ctx;
CREATE TEMP TABLE demo_wipe_ctx ON COMMIT DROP AS
SELECT tenant.id AS t, 'c0341a4e-5eed-4%'::text AS marker
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $guard$
DECLARE v_t uuid; v_marker text; v_blockers text[] := ARRAY[]::text[]; v_n bigint;
BEGIN
  IF (SELECT count(*) FROM demo_wipe_ctx) <> 1 THEN
    RAISE EXCEPTION 'compliance demo wipe: tenant akademi-perdana not found';
  END IF;
  SELECT t, marker INTO v_t, v_marker FROM demo_wipe_ctx;

  -- A row outside the seed's id range that still points at one of the seed's
  -- engagements or packets would be taken by CASCADE below.
  SELECT count(*) INTO v_n
    FROM core.hrdc_packets AS packet
   WHERE packet.tenant_id = v_t AND packet.engagement_id::text LIKE v_marker
     AND packet.id::text NOT LIKE v_marker;
  IF v_n > 0 THEN v_blockers := v_blockers || format('%s non-seed hrdc_packets row(s) reference a seed engagement', v_n); END IF;

  SELECT count(*) INTO v_n
    FROM core.compliance_check_results AS result
   WHERE result.tenant_id = v_t AND result.engagement_id::text LIKE v_marker
     AND result.id::text NOT LIKE v_marker;
  IF v_n > 0 THEN v_blockers := v_blockers || format('%s non-seed compliance_check_results row(s) reference a seed engagement', v_n); END IF;

  SELECT count(*) INTO v_n
    FROM core.rule_change_affected_engagements AS affected
   WHERE affected.tenant_id = v_t AND affected.engagement_id::text LIKE v_marker
     AND affected.id::text NOT LIKE v_marker;
  IF v_n > 0 THEN v_blockers := v_blockers || format('%s non-seed rule_change_affected_engagements row(s) reference a seed engagement', v_n); END IF;

  IF pg_catalog.array_length(v_blockers, 1) > 0 THEN
    RAISE EXCEPTION 'compliance demo wipe: refused — %', pg_catalog.array_to_string(v_blockers, '; ');
  END IF;
END
$guard$;

DELETE FROM core.rule_change_affected_engagements AS a
 USING demo_wipe_ctx AS c WHERE a.tenant_id = c.t AND a.id::text LIKE c.marker;
DELETE FROM core.rule_changes AS a
 USING demo_wipe_ctx AS c WHERE a.tenant_id = c.t AND a.id::text LIKE c.marker;
DELETE FROM core.rule_change_sets AS a
 USING demo_wipe_ctx AS c WHERE a.tenant_id = c.t AND a.id::text LIKE c.marker;
DELETE FROM core.compliance_version_drifts AS a
 USING demo_wipe_ctx AS c WHERE a.tenant_id = c.t AND a.id::text LIKE c.marker;
DELETE FROM core.compliance_check_results AS a
 USING demo_wipe_ctx AS c WHERE a.tenant_id = c.t AND a.id::text LIKE c.marker;
DELETE FROM core.hrdc_packet_documents AS a
 USING demo_wipe_ctx AS c WHERE a.tenant_id = c.t AND a.id::text LIKE c.marker;
DELETE FROM core.hrdc_packets AS a
 USING demo_wipe_ctx AS c WHERE a.tenant_id = c.t AND a.id::text LIKE c.marker;
DELETE FROM core.engagements AS a
 USING demo_wipe_ctx AS c WHERE a.tenant_id = c.t AND a.id::text LIKE c.marker;
DELETE FROM core.rule_set_versions AS a
 USING demo_wipe_ctx AS c WHERE a.id::text LIKE c.marker;

-- NOT REMOVED, BY DESIGN: the `core.action_requests` rows the seed's gate()
-- helper created to walk RULE_CHANGE_APPROVE / HRDC_PACKET_MARK_SUBMITTED
-- legally. `target_id` carries no foreign key (the action envelope's target
-- is generic by design), so an orphaned row here blocks nothing and re-seeding
-- creates fresh ones rather than colliding with old ones — the same posture
-- the base demo wipe takes with `core.ref_sequences`.

DROP TABLE pg_temp.demo_wipe_ctx;
