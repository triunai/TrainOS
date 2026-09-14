-- ═══════════════════════════════════════════════════════════════════════════
-- 029 ROLLBACK · BYOK provider keys through SQL RPCs and Supabase Vault
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores the catalog to what 001–021 left. 029 created eighteen functions and
-- two app tables, and replaced nothing: 013's five public.ai_provider_key_*
-- functions were only re-revoked (they held no grant before 029 either, per
-- 013:3114), so there is nothing of theirs to restore.
--
-- DATA, STATED: core.ai_provider_keys rows written through 029 STAY, with their
-- Vault secrets. A rollback that deleted customer keys would be a destructive
-- data operation disguised as a schema one; an operator who wants the keys gone
-- deletes them deliberately. Tombstoned rows (key_ref `retired:%`) stay too,
-- because 013's app.key_access_audit rows reference them. core.events and
-- app.key_access_audit rows 029 wrote are append-only history and are not
-- touched. app.provider_key_probes and app.provider_key_salts are dropped; losing
-- the salts means fingerprints on existing rows can no longer be recomputed,
-- which matters only to a re-applied 029, where a re-added identical key would
-- not be detected as a duplicate.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS core.create_provider(text,text,text,jsonb,text,text,jsonb,text);
DROP FUNCTION IF EXISTS core.test_provider(text);
DROP FUNCTION IF EXISTS core.get_provider_test_result(text);
DROP FUNCTION IF EXISTS core.rotate_provider(text,text);
DROP FUNCTION IF EXISTS core.reveal_provider(text);
DROP FUNCTION IF EXISTS core.delete_provider(text);
DROP FUNCTION IF EXISTS app.provider_key_for_tenant(uuid,text);
DROP FUNCTION IF EXISTS app.provider_key_validate(uuid,text,text,text,jsonb,text,text,jsonb,text,boolean,uuid);
DROP FUNCTION IF EXISTS app.provider_key_fire_probe(core.ai_provider_keys,text,jsonb,text);
DROP FUNCTION IF EXISTS app.provider_key_probe_json(app.provider_key_probes,core.ai_provider_keys);
DROP FUNCTION IF EXISTS app.provider_key_probe_request(text,text);
DROP FUNCTION IF EXISTS app.provider_key_fingerprint(uuid,text);
DROP FUNCTION IF EXISTS app.provider_key_shape_reason(text,text);
DROP FUNCTION IF EXISTS app.provider_key_tier_is_known(text);
DROP FUNCTION IF EXISTS app.provider_key_json(core.ai_provider_keys);
DROP FUNCTION IF EXISTS app.provider_key_actor(uuid);
DROP FUNCTION IF EXISTS app.provider_key_destroy_secret(text);
DROP FUNCTION IF EXISTS app.provider_key_opaque_error(text,text);

DROP TABLE IF EXISTS app.provider_key_probes;
DROP TABLE IF EXISTS app.provider_key_salts;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE (namespace.nspname = 'core' AND procedure.proname IN (
              'create_provider','test_provider','get_provider_test_result',
              'rotate_provider','reveal_provider','delete_provider'))
        OR (namespace.nspname = 'app' AND procedure.proname LIKE 'provider\_key\_%')) THEN
    RAISE EXCEPTION '029 rollback verify: a 029 function is still in place';
  END IF;
  IF pg_catalog.to_regclass('app.provider_key_probes') IS NOT NULL
     OR pg_catalog.to_regclass('app.provider_key_salts') IS NOT NULL THEN
    RAISE EXCEPTION '029 rollback verify: a 029 table is still in place';
  END IF;
END
$verify$;

COMMIT;
