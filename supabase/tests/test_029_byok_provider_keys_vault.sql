-- ═══════════════════════════════════════════════════════════════════════════
-- test_029 · BYOK provider keys through SQL RPCs and Supabase Vault
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001–027 + 029 (030–035 may be present), on a database that has
-- supabase_vault and pg_net (029 §0 refuses to apply otherwise). Ends in
-- ROLLBACK. The MIGRATION needs only 001–021; this PIN also needs 027, because
-- T2i and T10f read 027's core.list_providers back against 029's records.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_029_byok_provider_keys_vault.sql
--
-- HARNESS NOTE, stated so nobody reads more into a PASS than it proves. The
-- local shim is vanilla PostgreSQL: its `vault` schema is a stand-in with
-- supabase_vault 0.3.x's exact SQL surface and grants but a pgcrypto cipher,
-- and its pg_net has no background worker. So nothing here reaches a provider.
-- The response-recording step is proved with SYNTHETIC `net._http_response`
-- rows written under the request id the probe actually queued, which is
-- exactly the row the pg_net worker writes.
--
-- Every RPC probe runs as `authenticated` (SET LOCAL ROLE) with claims built
-- by app.custom_access_token_hook run as supabase_auth_admin, plus `sub`,
-- `role`, `aal` and `session_id`. ONE statement per probe, result parked in a
-- transaction-local GUC, assertions after RESET ROLE.
--
-- T1  grants: authenticated EXECUTEs exactly the six core RPCs; anon none;
--     the key-carrying five store both timeouts (R7);
--     service_role only the accessor; 013's five public.ai_provider_key_* are
--     executable by nobody; no client role can read vault or 029's tables.
-- T2  create as ADMIN: contract ProviderKey keys, masked key, NOT_SET, addedBy;
--     row holds a Vault id that decrypts to the key; probe queued and audited;
--     each created record is IDENTICAL to 027's core.list_providers row for it,
--     spendMonth included (seeded TIER rollup, so a hard-coded 0 cannot pass).
-- T3  THE GREP: the raw key (text and hex) appears in NO text/varchar/bytea/
--     json/jsonb/array column of any table in core, app or public, nor in
--     vault.secrets.secret. It IS in net.http_request_queue.headers until the
--     worker takes it (029 header L3) — asserted, not hidden.
-- T4  refusals carry no key fragment: short, whitespace, wrong prefix,
--     duplicate, unsupported provider, and a forced internal error (sanitized).
-- T5  FORBIDDEN for MD, SALES and an AGENT on every write; anon 42501.
-- T6  tenant B's ADMIN gets NOT_FOUND for tenant A's key on every RPC.
-- T7  reveal: aal1 and forged-aal2 refused AAL2_REQUIRED; aal2 ADMIN gets the
--     key with an audit row and event; per-key and per-actor limits trip; 013's
--     REVEAL_AUDIT_REQUIRED trigger still refuses a bare bump.
-- T8  test: in-flight probe reused; synthetic 200/401/429/timeout/Google-400/
--     no-response-after-60s classify to VALID/INVALID/unchanged; response rows
--     deleted.
-- T9  rotate: aal1 refused; new material, old Vault secret gone, ROTATE audit
--     carries the old key_ref, duplicate refused.
-- T10 delete: AGENT_PAUSED with blockers; tombstone when audited; hard delete
--     when not; a deleted key is NOT_FOUND everywhere, and absent from 027's
--     core.list_providers (the retired: filter).
-- T11 accessor: refused to authenticated; service_role gets runtime ids and the
--     decrypted key, never INVALID or tombstoned keys; one RUN_CALL audit per row.
-- T12 the T3 sweep again after every path, including the rotated key.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

-- ── Helpers ────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; v_detail text;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'value', v);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE,
    'message', SQLERRM, 'detail', v_detail);
END;
$fn$;

CREATE FUNCTION pg_temp.got(p_key text) RETURNS jsonb
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('t29.' || p_key)::jsonb; $fn$;

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF COALESCE(p_cond, false) THEN RAISE NOTICE 'PASS %', p_label;
  ELSE RAISE EXCEPTION 'FAIL %', p_label;
  END IF;
END;
$fn$;

-- The refusal's contract code, read the way rpcClient.ts classify() reads it.
CREATE FUNCTION pg_temp.code(p jsonb) RETURNS text
LANGUAGE sql AS $fn$
  SELECT CASE WHEN (p ->> 'ok')::boolean THEN 'OK'
              WHEN p ->> 'sqlstate' = 'TRNOS' THEN (p ->> 'detail')::jsonb ->> 'code'
              ELSE p ->> 'sqlstate' END;
$fn$;
CREATE FUNCTION pg_temp.detail(p jsonb) RETURNS jsonb
LANGUAGE sql AS $fn$ SELECT (p ->> 'detail')::jsonb; $fn$;
CREATE FUNCTION pg_temp.data(p jsonb) RETURNS jsonb
LANGUAGE sql AS $fn$ SELECT p #> '{value,data}'; $fn$;

-- Does any 6-character window of p_key appear in p_text?
CREATE FUNCTION pg_temp.leaks(p_text text, p_key text) RETURNS boolean
LANGUAGE sql AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.generate_series(1, pg_catalog.length(p_key) - 5) AS i
     WHERE pg_catalog.strpos(COALESCE(p_text, ''), pg_catalog.substr(p_key, i, 6)) > 0);
$fn$;

-- Claims from the real hook, as GoTrue builds them.
CREATE FUNCTION pg_temp.hook(p_user uuid) RETURNS jsonb
LANGUAGE sql AS $fn$
  SELECT app.custom_access_token_hook(pg_catalog.jsonb_build_object(
    'user_id', p_user, 'claims', pg_catalog.jsonb_build_object('sub', p_user))) -> 'claims';
$fn$;

CREATE FUNCTION pg_temp.as_user(p_name text, p_aal text DEFAULT 'aal1', p_session uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    (pg_catalog.current_setting('t29.hook_' || p_name)::jsonb
      || pg_catalog.jsonb_build_object('role', 'authenticated', 'aal', p_aal)
      || CASE WHEN p_session IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('session_id', p_session) END)::text,
    true);
END;
$fn$;

-- ── Fixtures ───────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('a0290000-0000-4000-8000-0000000000a1','admin@a29.test'),
  ('a0290000-0000-4000-8000-0000000000a2','md@a29.test'),
  ('a0290000-0000-4000-8000-0000000000a3','sales@a29.test'),
  ('a0290000-0000-4000-8000-0000000000a9','agent@a29.test'),
  ('a0290000-0000-4000-8000-0000000000b1','admin@b29.test');

INSERT INTO auth.sessions (id, user_id, aal) VALUES
  ('a0290000-5555-4000-8000-000000000001','a0290000-0000-4000-8000-0000000000a1','aal1'),
  ('a0290000-5555-4000-8000-000000000002','a0290000-0000-4000-8000-0000000000a1','aal2');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('a0290000-1111-4000-8000-000000000001','a29-tenant-a','BYOK Tenant A','ACTIVE','Asia/Kuala_Lumpur','en-MY'),
  ('a0290000-1111-4000-8000-000000000002','a29-tenant-b','BYOK Tenant B','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,agent_id,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0290000-1111-4000-8000-000000000001','a0290000-0000-4000-8000-0000000000a1','ADMIN','HUMAN',NULL,'ALL','ALL',false,'ACTIVE',true),
  ('a0290000-1111-4000-8000-000000000001','a0290000-0000-4000-8000-0000000000a2','MD','HUMAN',NULL,'ALL','ALL',false,'ACTIVE',true),
  ('a0290000-1111-4000-8000-000000000001','a0290000-0000-4000-8000-0000000000a3','SALES','HUMAN',NULL,'MY_ACCOUNTS','MY_TEAM',false,'ACTIVE',true),
  ('a0290000-1111-4000-8000-000000000001','a0290000-0000-4000-8000-0000000000a9','AGENT','AGENT','agent_a29','ALL','ALL',false,'ACTIVE',true),
  ('a0290000-1111-4000-8000-000000000002','a0290000-0000-4000-8000-0000000000b1','ADMIN','HUMAN',NULL,'ALL','ALL',false,'ACTIVE',true);

INSERT INTO public.user_profiles (tenant_id,user_id,display_name,email) VALUES
  ('a0290000-1111-4000-8000-000000000001','a0290000-0000-4000-8000-0000000000a1','Admin A29','admin@a29.test');

-- This period's TIER spend for two tiers tenant A's keys scope, so spendMonth
-- on a created record is a real sum (027's derivation), not a constant 0.
INSERT INTO app.usage_rollup (tenant_id, period, scope, key, spend_sen) VALUES
  ('a0290000-1111-4000-8000-000000000001', to_char(now(),'YYYY-MM'), 'TIER', 'STRONG_1', 4242),
  ('a0290000-1111-4000-8000-000000000001', to_char(now(),'YYYY-MM'), 'TIER', 'MID', 100);

-- The keys. Each carries a marker that occurs nowhere else in the database.
SELECT set_config('t29.k1', 'sk-ant-api03-T29K1SECRETabcdefghijklmnopqrstuvwxyz0123', true),
       set_config('t29.k2', 'sk-proj-T29K2SECRETabcdefghijklmnopqrstuvwxyz0123', true),
       set_config('t29.k3', 'sk-T29K3SECRETdsqzabcdefghijklmnopqrs', true),
       set_config('t29.k4', 'AIzaSyT29K4SECRETgglqzabcdefghijklmnop', true),
       set_config('t29.k1b', 'sk-ant-api03-T29K1BROTATEDabcdefghijklmnopqrstuvwxyz', true),
       set_config('t29.kb', 'sk-ant-api03-T29KBTENANTBabcdefghijklmnopqrstuvwxyz', true),
       set_config('t29.k5', 'sk-or-v1-T29K5SECRETrtrqzabcdefghijklmnopqrstu', true),
       set_config('t29.k6', 'gsk_T29K6SECRETothrqzabcdefghijklmnopqrstu', true);

SET LOCAL ROLE supabase_auth_admin;
SELECT set_config('t29.hook_admin', pg_temp.hook('a0290000-0000-4000-8000-0000000000a1')::text, true),
       set_config('t29.hook_md',    pg_temp.hook('a0290000-0000-4000-8000-0000000000a2')::text, true),
       set_config('t29.hook_sales', pg_temp.hook('a0290000-0000-4000-8000-0000000000a3')::text, true),
       set_config('t29.hook_agent', pg_temp.hook('a0290000-0000-4000-8000-0000000000a9')::text, true),
       set_config('t29.hook_adminb',pg_temp.hook('a0290000-0000-4000-8000-0000000000b1')::text, true);
RESET ROLE;

SELECT pg_temp.assert(
  pg_temp.got('hook_admin') ->> 'app_role' = 'ADMIN'
  AND pg_temp.got('hook_admin') ->> 'tenant_id' = 'a0290000-1111-4000-8000-000000000001'
  AND pg_temp.got('hook_adminb') ->> 'tenant_id' = 'a0290000-1111-4000-8000-000000000002',
  'T0 the access-token hook resolves ADMIN claims for both tenants');

-- ═══ T1 · grants ═══════════════════════════════════════════════════════════
DO $t1$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s:%s', r.rolname, p.oid::regprocedure), ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) r(rolname)
   WHERE ((n.nspname = 'core' AND p.proname IN ('create_provider','test_provider','get_provider_test_result',
                                                'rotate_provider','reveal_provider','delete_provider'))
       OR (n.nspname = 'app' AND p.proname LIKE 'provider\_key\_%')
       OR (n.nspname = 'public' AND p.proname LIKE 'ai\_provider\_key\_%'))
     AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
       <> ((r.rolname = 'authenticated' AND n.nspname = 'core')
           OR (r.rolname = 'service_role' AND p.proname = 'provider_key_for_tenant'));
  PERFORM pg_temp.assert(v_bad IS NULL, 'T1a EXECUTE matrix: authenticated=6 core RPCs, service_role=accessor, anon=none, 013 public.* =none ' || COALESCE(v_bad, ''));
  PERFORM pg_temp.assert(
    NOT has_table_privilege('authenticated','vault.decrypted_secrets','SELECT')
    AND NOT has_table_privilege('anon','vault.decrypted_secrets','SELECT')
    AND NOT has_table_privilege('authenticated','vault.secrets','SELECT')
    AND NOT has_table_privilege('service_role','vault.decrypted_secrets','SELECT')
    AND NOT has_table_privilege('authenticated','app.provider_key_salts','SELECT')
    AND NOT has_table_privilege('authenticated','app.provider_key_probes','SELECT'),
    'T1b no client role and not service_role can read Vault or 029 tables directly');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'core' AND p.proname IN ('create_provider','test_provider','get_provider_test_result',
                                                 'rotate_provider','reveal_provider','delete_provider')
        AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) = 6,
    'T1c six core RPCs are SECURITY DEFINER at search_path="" exactly');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ((n.nspname = 'core' AND p.proname IN ('create_provider','test_provider','rotate_provider','reveal_provider'))
          OR (n.nspname = 'app' AND p.proname = 'provider_key_for_tenant'))
        AND p.proconfig @> ARRAY['statement_timeout=5s','lock_timeout=2s']) = 5,
    'T1d the five key-carrying functions store statement_timeout=5s and lock_timeout=2s (029 R7)');
END
$t1$;

-- ═══ T2 · create as ADMIN ══════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin');
SELECT set_config('t29.c1', pg_temp.try(format(
  $$SELECT core.create_provider('ANTHROPIC','Anthropic direct',%L,'["STRONG_1"]'::jsonb,
      'CLIENT_ACCOUNT','US','{"amount":500000,"currency":"MYR"}'::jsonb,'2027-01-31')$$,
  current_setting('t29.k1')))::text, true);
SELECT set_config('t29.c2', pg_temp.try(format(
  $$SELECT core.create_provider('OPENAI','OpenAI',%L,'["MID","STRONG_2"]'::jsonb,'PASS_THROUGH','US')$$,
  current_setting('t29.k2')))::text, true);
SELECT set_config('t29.c3', pg_temp.try(format(
  $$SELECT core.create_provider('DEEPSEEK','DeepSeek',%L,'["CHEAP"]'::jsonb,'CLIENT_ACCOUNT','CN')$$,
  current_setting('t29.k3')))::text, true);
SELECT set_config('t29.c4', pg_temp.try(format(
  $$SELECT core.create_provider('GOOGLE','Gemini',%L,'["FAST"]'::jsonb,'CLIENT_ACCOUNT','SG')$$,
  current_setting('t29.k4')))::text, true);
SELECT set_config('t29.list_after_create', pg_temp.try($$SELECT core.list_providers()$$)::text, true);
SELECT pg_temp.as_user('adminb');
SELECT set_config('t29.cb', pg_temp.try(format(
  $$SELECT core.create_provider('ANTHROPIC','Tenant B key',%L,'["STRONG_1"]'::jsonb,'CLIENT_ACCOUNT','US')$$,
  current_setting('t29.kb')))::text, true);
RESET ROLE;

DO $t2$
DECLARE
  v    jsonb := pg_temp.data(pg_temp.got('c1'));
  v_k1 text := current_setting('t29.k1');
  r    core.ai_provider_keys;
  v_plain text;
BEGIN
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('c1')) = 'OK'
    AND pg_temp.code(pg_temp.got('c2')) = 'OK' AND pg_temp.code(pg_temp.got('c3')) = 'OK'
    AND pg_temp.code(pg_temp.got('c4')) = 'OK' AND pg_temp.code(pg_temp.got('cb')) = 'OK',
    'T2a ADMIN creates Anthropic, OpenAI, DeepSeek, Google keys; tenant B ADMIN creates one ' || pg_temp.got('c1')::text);
  PERFORM pg_temp.assert(
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k)
      = ARRAY['addedBy','billingOwner','cap','id','label','lastTestedAt','maskedKey','provider',
              'region','rotationDate','scopeTiers','spendMonth','status'],
    'T2b response keys are exactly the contract ProviderKey keys for a capped, dated key: ' || v::text);
  PERFORM pg_temp.assert(
    v ->> 'maskedKey' = app.mask_key(v_k1) AND NOT pg_temp.leaks(v::text, substr(v_k1, 8, length(v_k1) - 11)),
    'T2c maskedKey is app.mask_key(key) and the body carries no 6-char window of the unmasked middle');
  PERFORM pg_temp.assert(
    v ->> 'status' = 'NOT_SET' AND v ->> 'lastTestedAt' IS NULL
    AND v #>> '{addedBy,id}' = 'a0290000-0000-4000-8000-0000000000a1'
    AND v #>> '{addedBy,name}' = 'Admin A29' AND v #>> '{cap,amount}' = '500000'
    AND v ->> 'rotationDate' = '2027-01-31' AND v -> 'scopeTiers' = '["STRONG_1"]'::jsonb
    AND v ->> 'id' ~ '^prv_anthropic_[0-9a-f]{12}$',
    'T2d NOT_SET until probed, addedBy {id,name,at}, cap, rotationDate, tiers, prv_ ref');

  SELECT * INTO r FROM core.ai_provider_keys WHERE provider_ref = v ->> 'id';
  SELECT decrypted_secret INTO v_plain FROM vault.decrypted_secrets WHERE id = r.key_ref::uuid;
  PERFORM pg_temp.assert(v_plain = v_k1
    AND (SELECT name FROM vault.secrets WHERE id = r.key_ref::uuid)
        = format('trainos/byok/%s/%s', r.tenant_id, r.id)
    AND NOT pg_temp.leaks((SELECT description FROM vault.secrets WHERE id = r.key_ref::uuid), v_k1),
    'T2e key_ref is the Vault id; it decrypts to the key; name is trainos/byok/<tenant>/<row>; description has no key');
  PERFORM pg_temp.assert(
    r.key_fingerprint = extensions.hmac(convert_to(v_k1,'UTF8'),
      (SELECT salt FROM app.provider_key_salts WHERE tenant_id = r.tenant_id), 'sha256')
    AND r.key_fingerprint <> sha256(convert_to(v_k1,'UTF8')),
    'T2f fingerprint is HMAC-SHA256 under the tenant salt, not a bare sha256');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM app.provider_key_probes p WHERE p.provider_key_id = r.id AND p.outcome = 'PENDING') = 1
    AND (SELECT count(*) FROM app.key_access_audit a WHERE a.provider_key_id = r.id AND a.purpose = 'PROBE'
           AND a.request_id = (SELECT net_request_id::text FROM app.provider_key_probes p WHERE p.provider_key_id = r.id)) = 1
    AND (SELECT count(*) FROM core.events e WHERE e.aggregate_id = r.id AND e.type = 'ProviderKeyAdded') = 1,
    'T2g create queued one probe, audited it as PROBE with the net request id, emitted ProviderKeyAdded');
  PERFORM pg_temp.assert(
    (SELECT q.url FROM net.http_request_queue q
      WHERE q.id = (SELECT net_request_id FROM app.provider_key_probes p WHERE p.provider_key_id = r.id))
      = 'https://api.anthropic.com/v1/models',
    'T2h the probe targets the constant Anthropic models URL');
  -- 027 owns listProviders; 029's records must be indistinguishable from it.
  PERFORM pg_temp.assert(
    pg_temp.got('list_after_create') #>> '{value,success}' = 'true'
    AND (SELECT pg_catalog.jsonb_agg(created.rec ORDER BY created.rec ->> 'id')
           FROM (SELECT pg_temp.data(pg_temp.got(c)) AS rec
                   FROM unnest(ARRAY['c1','c2','c3','c4']) AS c) AS created)
      = (SELECT pg_catalog.jsonb_agg(listed.rec ORDER BY listed.rec ->> 'id')
           FROM jsonb_array_elements(pg_temp.data(pg_temp.got('list_after_create')) -> 'data') AS listed(rec)
          WHERE listed.rec ->> 'id' IN (SELECT pg_temp.data(pg_temp.got(c)) ->> 'id'
                                          FROM unnest(ARRAY['c1','c2','c3','c4']) AS c))
    AND pg_temp.data(pg_temp.got('c1')) #>> '{spendMonth,amount}' = '4242'
    AND pg_temp.data(pg_temp.got('c2')) #>> '{spendMonth,amount}' = '100'
    AND pg_temp.data(pg_temp.got('c3')) #>> '{spendMonth,amount}' = '0',
    'T2i each created ProviderKey equals 027 core.list_providers row for it, spendMonth summed from the TIER rollup '
      || COALESCE(pg_temp.got('list_after_create')::text, ''));
END
$t2$;

-- ═══ T3 · THE GREP ═════════════════════════════════════════════════════════
-- Every text-like column (text, varchar, char, bytea, json, jsonb, citext,
-- any array, any domain) of every table in core, app and public, searched for
-- each key as text and as the hex of its bytes. Returns "<columns>|<hits>|<where>".
CREATE FUNCTION pg_temp.key_sweep(p_keys text[]) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE c record; v_key text; v_hits bigint; v_total bigint := 0; v_cols integer := 0; v_where text := '';
BEGIN
  FOR c IN
    SELECT n.nspname, cl.relname, a.attname
      FROM pg_attribute a
      JOIN pg_class cl ON cl.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE n.nspname IN ('core','app','public')
       AND cl.relkind IN ('r','p')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.atttypid IN (SELECT t.oid FROM pg_type t
                            WHERE t.typname IN ('text','varchar','bpchar','bytea','json','jsonb','citext'))
            OR a.atttypid IN (SELECT t.oid FROM pg_type t WHERE t.typcategory = 'A')
            OR a.atttypid IN (SELECT t.oid FROM pg_type t WHERE t.typtype = 'd'))
  LOOP
    v_cols := v_cols + 1;
    FOREACH v_key IN ARRAY p_keys LOOP
      EXECUTE format(
        'SELECT count(*) FROM %I.%I WHERE strpos(%I::text, %L) > 0 OR strpos(%I::text, %L) > 0',
        c.nspname, c.relname, c.attname, v_key, c.attname,
        encode(convert_to(v_key, 'UTF8'), 'hex'))
        INTO v_hits;
      IF v_hits > 0 THEN v_where := v_where || format(' %s.%s.%s', c.nspname, c.relname, c.attname); END IF;
      v_total := v_total + v_hits;
    END LOOP;
  END LOOP;
  RETURN format('%s|%s|%s', v_cols, v_total, v_where);
END;
$fn$;

DO $t3$
DECLARE
  v_keys text[] := ARRAY[current_setting('t29.k1'), current_setting('t29.k2'), current_setting('t29.k3'),
                         current_setting('t29.k4'), current_setting('t29.kb')];
  v_sweep text[] := string_to_array(pg_temp.key_sweep(v_keys), '|');
BEGIN
  PERFORM pg_temp.assert(v_sweep[1]::integer > 300 AND v_sweep[2] = '0',
    format('T3a raw keys (text and hex) found in 0 of %s text-like columns across core/app/public%s', v_sweep[1], v_sweep[3]));
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM vault.secrets s, unnest(v_keys) k WHERE strpos(s.secret, k) > 0),
    'T3b vault.secrets.secret holds ciphertext, not the key');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM net.http_request_queue q, unnest(v_keys) k WHERE strpos(q.headers::text, k) > 0) = 5,
    'T3c DOCUMENTED EXPOSURE (029 L3): the five queued probes carry their key in net.http_request_queue.headers until the pg_net worker takes them');
END
$t3$;

-- ═══ T4 · refusals carry no key fragment ═══════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin');
SELECT set_config('t29.v_short', pg_temp.try(
  $$SELECT core.create_provider('ANTHROPIC','x','sk-ant-SHORTQ7','["FAST"]','CLIENT_ACCOUNT','US')$$)::text, true);
SELECT set_config('t29.v_space', pg_temp.try(
  $$SELECT core.create_provider('ANTHROPIC','x','sk-ant-api03 WHITESPACEQ7abcdefghijkl','["FAST"]','CLIENT_ACCOUNT','US')$$)::text, true);
SELECT set_config('t29.v_prefix', pg_temp.try(
  $$SELECT core.create_provider('ANTHROPIC','x','xx-BADSTARTQ7abcdefghijklmnop','["FAST"]','CLIENT_ACCOUNT','US')$$)::text, true);
SELECT set_config('t29.v_dup', pg_temp.try(format(
  $$SELECT core.create_provider('ANTHROPIC','again',%L,'["FAST"]','CLIENT_ACCOUNT','US')$$,
  current_setting('t29.k1')))::text, true);
SELECT set_config('t29.v_router', pg_temp.try(
  $$SELECT core.create_provider('OPENROUTER','Router','sk-xx-v1-ROUTERQ7abcdefghijklmnop','["FAST"]','CLIENT_ACCOUNT','Routed')$$)::text, true);
SELECT set_config('t29.v_other_nourl', pg_temp.try(
  $$SELECT core.create_provider('OTHER','Groq','sk-OTHERNOURLQ7abcdefghijklmnop','["FAST"]','CLIENT_ACCOUNT','Unknown')$$)::text, true);
SELECT set_config('t29.v_other_ip', pg_temp.try(
  $$SELECT core.create_provider('OTHER','Inward','sk-OTHERIPQ7abcdefghijklmnopqr','["FAST"]','CLIENT_ACCOUNT','Unknown',NULL,NULL,'https://169.254.169.254/v1')$$)::text, true);
SELECT set_config('t29.v_other_local', pg_temp.try(
  $$SELECT core.create_provider('OTHER','Local','sk-OTHERLOCALQ7abcdefghijklmnop','["FAST"]','CLIENT_ACCOUNT','Unknown',NULL,NULL,'https://db.internal/v1')$$)::text, true);
SELECT set_config('t29.v_other_http', pg_temp.try(
  $$SELECT core.create_provider('OTHER','Plain','sk-OTHERHTTPQ7abcdefghijklmnop','["FAST"]','CLIENT_ACCOUNT','Unknown',NULL,NULL,'http://llm.example.com/v1')$$)::text, true);
SELECT set_config('t29.v_named_url', pg_temp.try(
  $$SELECT core.create_provider('ANTHROPIC','Proxy','sk-ant-api03-NAMEDURLQ7abcdefghijklmnop','["FAST"]','CLIENT_ACCOUNT','US',NULL,NULL,'https://proxy.example.com')$$)::text, true);
-- The two providers 029 adds, for real: OpenRouter, and an OTHER endpoint.
SELECT set_config('t29.c5', pg_temp.try(format(
  $$SELECT core.create_provider('OPENROUTER','OpenRouter',%L,'["SPECIAL"]','PASS_THROUGH','Routed')$$,
  current_setting('t29.k5')))::text, true);
SELECT set_config('t29.c6', pg_temp.try(format(
  $$SELECT core.create_provider('OTHER','Groq',%L,'["DEEP_THINK"]','CLIENT_ACCOUNT','Unknown',NULL,NULL,'https://api.groq.example.com/openai/v1/')$$,
  current_setting('t29.k6')))::text, true);
SELECT set_config('t29.v_fields', pg_temp.try(
  $$SELECT core.create_provider('ANTHROPIC','','sk-ant-api03-FIELDSQ7abcdefghijklmnop','["NOPE"]','SOMEONE','',
      '{"amount":-1,"currency":"XXX"}','2026-02-30')$$)::text, true);
RESET ROLE;
-- A forced internal failure inside the key-holding block: a CHECK the table
-- owner adds for this test only, so the INSERT dies with a PostgreSQL message.
ALTER TABLE core.ai_provider_keys ADD CONSTRAINT t29_boom CHECK (label <> 'T29 boom');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin');
SELECT set_config('t29.v_boom', pg_temp.try(
  $$SELECT core.create_provider('ANTHROPIC','T29 boom','sk-ant-api03-BOOMQ7abcdefghijklmnopqrstu','["FAST"]','CLIENT_ACCOUNT','US')$$)::text, true);
RESET ROLE;
ALTER TABLE core.ai_provider_keys DROP CONSTRAINT t29_boom;

DO $t4$
DECLARE
  v_short jsonb := pg_temp.got('v_short'); v_space jsonb := pg_temp.got('v_space');
  v_prefix jsonb := pg_temp.got('v_prefix'); v_dup jsonb := pg_temp.got('v_dup');
  v_router jsonb := pg_temp.got('v_router'); v_fields jsonb := pg_temp.got('v_fields');
  v_boom jsonb := pg_temp.got('v_boom');
BEGIN
  PERFORM pg_temp.assert(pg_temp.code(v_short) = 'VALIDATION_FAILED'
    AND pg_temp.detail(v_short) -> 'fields' @> '[{"field":"key","reason":"TOO_SHORT"}]'
    AND NOT pg_temp.leaks(v_short::text, 'sk-ant-SHORTQ7'),
    'T4a short key: VALIDATION_FAILED key/TOO_SHORT, no fragment');
  PERFORM pg_temp.assert(pg_temp.code(v_space) = 'VALIDATION_FAILED'
    AND pg_temp.detail(v_space) -> 'fields' @> '[{"field":"key","reason":"INVALID_CHARACTERS"}]'
    AND NOT pg_temp.leaks(v_space::text, 'sk-ant-api03 WHITESPACEQ7abcdefghijkl'),
    'T4b whitespace key: INVALID_CHARACTERS, no fragment');
  PERFORM pg_temp.assert(pg_temp.code(v_prefix) = 'VALIDATION_FAILED'
    AND pg_temp.detail(v_prefix) -> 'fields' @> '[{"field":"key","reason":"WRONG_PREFIX"}]'
    AND NOT pg_temp.leaks(v_prefix::text, 'xx-BADSTARTQ7abcdefghijklmnop'),
    'T4c wrong prefix: WRONG_PREFIX, no fragment');
  PERFORM pg_temp.assert(pg_temp.code(v_dup) = 'VALIDATION_FAILED'
    AND pg_temp.detail(v_dup) -> 'fields' @> '[{"field":"key","reason":"DUPLICATE","code":"KEY_ALREADY_ADDED"}]'
    AND pg_temp.detail(v_dup) ->> 'existingId' = pg_temp.data(pg_temp.got('c1')) ->> 'id'
    AND NOT pg_temp.leaks(v_dup::text, current_setting('t29.k1')),
    'T4d duplicate key: KEY_ALREADY_ADDED with existingId, no fragment');
  PERFORM pg_temp.assert(pg_temp.code(v_router) = 'VALIDATION_FAILED'
    AND pg_temp.detail(v_router) -> 'fields' @> '[{"field":"key","reason":"WRONG_PREFIX"}]'
    AND NOT pg_temp.leaks(v_router::text, 'sk-xx-v1-ROUTERQ7abcdefghijklmnop'),
    'T4e OPENROUTER key without sk-or-: WRONG_PREFIX, no fragment');
  PERFORM pg_temp.assert(
    pg_temp.detail(pg_temp.got('v_other_nourl')) -> 'fields' @> '[{"field":"baseUrl","reason":"BASE_URL_REQUIRED"}]'
    AND pg_temp.detail(pg_temp.got('v_other_ip')) -> 'fields' @> '[{"field":"baseUrl","reason":"BASE_URL_NOT_ALLOWED"}]'
    AND pg_temp.detail(pg_temp.got('v_other_local')) -> 'fields' @> '[{"field":"baseUrl","reason":"BASE_URL_NOT_ALLOWED"}]'
    AND pg_temp.detail(pg_temp.got('v_other_http')) -> 'fields' @> '[{"field":"baseUrl","reason":"BASE_URL_NOT_ALLOWED"}]'
    AND pg_temp.detail(pg_temp.got('v_named_url')) -> 'fields' @> '[{"field":"baseUrl","reason":"BASE_URL_NOT_SUPPORTED"}]',
    'T4h OTHER needs an https DNS base URL (no IP literal, no .internal, no http); a named provider takes none');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('c5')) = 'OK' AND pg_temp.code(pg_temp.got('c6')) = 'OK'
    AND (SELECT q.url FROM net.http_request_queue q JOIN app.provider_key_probes p ON p.net_request_id = q.id
           JOIN core.ai_provider_keys k ON k.id = p.provider_key_id
          WHERE k.provider_ref = pg_temp.data(pg_temp.got('c5')) ->> 'id') = 'https://openrouter.ai/api/v1/key'
    AND (SELECT q.url FROM net.http_request_queue q JOIN app.provider_key_probes p ON p.net_request_id = q.id
           JOIN core.ai_provider_keys k ON k.id = p.provider_key_id
          WHERE k.provider_ref = pg_temp.data(pg_temp.got('c6')) ->> 'id') = 'https://api.groq.example.com/openai/v1/models'
    AND pg_temp.data(pg_temp.got('c6')) ->> 'id' ~ '^prv_other_'
    AND NOT pg_temp.data(pg_temp.got('c6')) ? 'baseUrl',
    'T4i OPENROUTER probes /api/v1/key; OTHER probes <base_url>/models; the record keeps contract keys only');
  PERFORM pg_temp.assert(pg_temp.code(v_fields) = 'VALIDATION_FAILED'
    AND (SELECT array_agg(f ->> 'field' ORDER BY f ->> 'field')
           FROM jsonb_array_elements(pg_temp.detail(v_fields) -> 'fields') f)
        = ARRAY['billingOwner','cap','label','region','rotationDate','scopeTiers'],
    'T4f every bad field reported at once: ' || pg_temp.detail(v_fields)::text);
  PERFORM pg_temp.assert(NOT (v_boom ->> 'ok')::boolean AND v_boom ->> 'sqlstate' = '23514'
    AND COALESCE(v_boom ->> 'detail', '') = '' AND v_boom ->> 'message' LIKE 'create_provider failed (SQLSTATE 23514)%'
    AND NOT pg_temp.leaks(v_boom::text, 'sk-ant-api03-BOOMQ7abcdefghijklmnopqrstu')
    AND NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name IS NULL OR s.description LIKE '%T29 boom%'),
    'T4g an internal error inside the key block is re-raised opaque: SQLSTATE kept, no DETAIL, no fragment: ' || v_boom::text);
END
$t4$;

-- ═══ T5 · FORBIDDEN by role; anon 42501 ════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('md');
SELECT set_config('t29.f_md_create', pg_temp.try(
  $$SELECT core.create_provider('ANTHROPIC','md','sk-ant-api03-MDQ7abcdefghijklmnopqrstu','["FAST"]','CLIENT_ACCOUNT','US')$$)::text, true);
SELECT set_config('t29.f_md_test', pg_temp.try(format($$SELECT core.test_provider(%L)$$,
  pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.f_md_reveal', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$,
  pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT pg_temp.as_user('sales');
SELECT set_config('t29.f_sales_test', pg_temp.try(format($$SELECT core.test_provider(%L)$$,
  pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.f_sales_rotate', pg_temp.try(format($$SELECT core.rotate_provider(%L,'sk-ant-api03-SALESQ7abcdefghijklmnop')$$,
  pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.f_sales_delete', pg_temp.try(format($$SELECT core.delete_provider(%L)$$,
  pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT pg_temp.as_user('agent');
SELECT set_config('t29.f_agent_reveal', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$,
  pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.f_agent_result', pg_temp.try(format($$SELECT core.get_provider_test_result(%L)$$,
  pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT set_config('t29.anon_create', pg_temp.try(
  $$SELECT core.create_provider('ANTHROPIC','x','sk-ant-api03-ANONQ7abcdefghijklmnop','["FAST"]','CLIENT_ACCOUNT','US')$$)::text, true);
SELECT set_config('t29.anon_test', pg_temp.try($$SELECT core.test_provider('prv_x')$$)::text, true);
SELECT set_config('t29.anon_result', pg_temp.try($$SELECT core.get_provider_test_result('prv_x')$$)::text, true);
SELECT set_config('t29.anon_rotate', pg_temp.try($$SELECT core.rotate_provider('prv_x','k')$$)::text, true);
SELECT set_config('t29.anon_reveal', pg_temp.try($$SELECT core.reveal_provider('prv_x')$$)::text, true);
SELECT set_config('t29.anon_delete', pg_temp.try($$SELECT core.delete_provider('prv_x')$$)::text, true);
SELECT set_config('t29.anon_accessor', pg_temp.try($$SELECT count(*) FROM app.provider_key_for_tenant('a0290000-1111-4000-8000-000000000001', NULL)$$)::text, true);
RESET ROLE;

DO $t5$
BEGIN
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('f_md_create')) = 'FORBIDDEN'
    AND pg_temp.detail(pg_temp.got('f_md_create')) ->> 'requiredPermission' = 'ai:provider:write'
    AND pg_temp.code(pg_temp.got('f_md_test')) = 'FORBIDDEN'
    AND pg_temp.code(pg_temp.got('f_md_reveal')) = 'FORBIDDEN'
    AND pg_temp.detail(pg_temp.got('f_md_reveal')) ->> 'requiredPermission' = 'ai:provider:reveal',
    'T5a MD (no ai:provider:* in 002) is FORBIDDEN to create, test and reveal');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('f_sales_test')) = 'FORBIDDEN'
    AND pg_temp.code(pg_temp.got('f_sales_rotate')) = 'FORBIDDEN'
    AND pg_temp.code(pg_temp.got('f_sales_delete')) = 'FORBIDDEN'
    AND NOT pg_temp.leaks(pg_temp.got('f_sales_rotate')::text, 'sk-ant-api03-SALESQ7abcdefghijklmnop'),
    'T5b SALES is FORBIDDEN to test, rotate and delete');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('f_agent_reveal')) = 'FORBIDDEN'
    AND pg_temp.code(pg_temp.got('f_agent_result')) = 'FORBIDDEN',
    'T5c an AGENT principal is FORBIDDEN');
  PERFORM pg_temp.assert(
    pg_temp.got('anon_create') ->> 'sqlstate' = '42501' AND pg_temp.got('anon_test') ->> 'sqlstate' = '42501'
    AND pg_temp.got('anon_result') ->> 'sqlstate' = '42501' AND pg_temp.got('anon_rotate') ->> 'sqlstate' = '42501'
    AND pg_temp.got('anon_reveal') ->> 'sqlstate' = '42501' AND pg_temp.got('anon_delete') ->> 'sqlstate' = '42501'
    AND pg_temp.got('anon_accessor') ->> 'sqlstate' = '42501',
    'T5d anon is refused 42501 on all six RPCs and the accessor');
END
$t5$;

-- ═══ T6 · cross-tenant ═════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('adminb', 'aal2', 'a0290000-5555-4000-8000-000000000002');
SELECT set_config('t29.x_test', pg_temp.try(format($$SELECT core.test_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.x_result', pg_temp.try(format($$SELECT core.get_provider_test_result(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.x_reveal', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.x_rotate', pg_temp.try(format($$SELECT core.rotate_provider(%L,'sk-ant-api03-CROSSQ7abcdefghijklmnop')$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.x_delete', pg_temp.try(format($$SELECT core.delete_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.x_missing', pg_temp.try($$SELECT core.test_provider('prv_anthropic_000000000000')$$)::text, true);
RESET ROLE;

DO $t6$
BEGIN
  -- reveal as tenant B fails AAL2 before lookup (B's user has no aal2 session
  -- row), so it is checked for NOT leaking the key rather than for NOT_FOUND.
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('x_test')) = 'NOT_FOUND'
    AND pg_temp.code(pg_temp.got('x_result')) = 'NOT_FOUND'
    AND pg_temp.code(pg_temp.got('x_rotate')) = 'NOT_FOUND'
    AND pg_temp.code(pg_temp.got('x_delete')) = 'NOT_FOUND'
    AND pg_temp.code(pg_temp.got('x_reveal')) IN ('NOT_FOUND', 'FORBIDDEN')
    AND NOT pg_temp.leaks(pg_temp.got('x_reveal')::text, current_setting('t29.k1'))
    AND pg_temp.detail(pg_temp.got('x_test')) - 'id' = pg_temp.detail(pg_temp.got('x_missing')) - 'id',
    'T6a tenant B ADMIN: A''s key is NOT_FOUND on test/result/rotate/delete, byte-identical to a missing ref; reveal returns no key');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM app.key_access_audit WHERE tenant_id = 'a0290000-1111-4000-8000-000000000001'
       AND actor ->> 'id' = 'a0290000-0000-4000-8000-0000000000b1') = 0,
    'T6b no audit row in tenant A names tenant B''s user');
END
$t6$;

-- Tenant B reveal with a real aal2 session, to prove NOT_FOUND on reveal too.
INSERT INTO auth.sessions (id, user_id, aal) VALUES
  ('a0290000-5555-4000-8000-0000000000b2','a0290000-0000-4000-8000-0000000000b1','aal2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('adminb', 'aal2', 'a0290000-5555-4000-8000-0000000000b2');
SELECT set_config('t29.x_reveal2', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
RESET ROLE;
SELECT pg_temp.assert(pg_temp.code(pg_temp.got('x_reveal2')) = 'NOT_FOUND',
  'T6c tenant B ADMIN at verified aal2: reveal of A''s key is NOT_FOUND');

-- ═══ T7 · reveal ═══════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin', 'aal1', 'a0290000-5555-4000-8000-000000000001');
SELECT set_config('t29.r_aal1', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
-- Forged: the token CLAIMS aal2 but names the aal1 session row.
SELECT pg_temp.as_user('admin', 'aal2', 'a0290000-5555-4000-8000-000000000001');
SELECT set_config('t29.r_forged', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT pg_temp.as_user('admin', 'aal2', 'a0290000-5555-4000-8000-000000000002');
SELECT set_config('t29.r_ok', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.r_again', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.r_k2', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$, pg_temp.data(pg_temp.got('c2')) ->> 'id'))::text, true);
SELECT set_config('t29.r_k3', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$, pg_temp.data(pg_temp.got('c3')) ->> 'id'))::text, true);
SELECT set_config('t29.r_k4', pg_temp.try(format($$SELECT core.reveal_provider(%L)$$, pg_temp.data(pg_temp.got('c4')) ->> 'id'))::text, true);
RESET ROLE;

DO $t7$
DECLARE
  v_ok jsonb := pg_temp.got('r_ok');
  v_id uuid := (SELECT id FROM core.ai_provider_keys WHERE provider_ref = pg_temp.data(pg_temp.got('c1')) ->> 'id');
BEGIN
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('r_aal1')) = 'FORBIDDEN'
    AND pg_temp.detail(pg_temp.got('r_aal1')) ->> 'reason' = 'AAL2_REQUIRED'
    AND pg_temp.code(pg_temp.got('r_forged')) = 'FORBIDDEN'
    AND pg_temp.detail(pg_temp.got('r_forged')) ->> 'reason' = 'AAL2_REQUIRED',
    'T7a ADMIN at aal1, and with a forged aal2 claim over an aal1 session, is FORBIDDEN AAL2_REQUIRED');
  PERFORM pg_temp.assert(pg_temp.code(v_ok) = 'OK'
    AND pg_temp.data(v_ok) ->> 'key' = current_setting('t29.k1')
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.data(v_ok)) k) = ARRAY['key','revealedAt'],
    'T7b ADMIN at verified aal2 gets exactly {key, revealedAt} with the real key');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM app.key_access_audit a WHERE a.provider_key_id = v_id AND a.purpose = 'REVEAL'
        AND a.actor ->> 'id' = 'a0290000-0000-4000-8000-0000000000a1' AND a.aal = 'aal2'
        AND a.reason IS NOT NULL) = 1
    AND (SELECT count(*) FROM core.events e WHERE e.aggregate_id = v_id AND e.type = 'ProviderKeyRevealed') = 1
    AND (SELECT reveal_count FROM core.ai_provider_keys WHERE id = v_id) = 1
    AND NOT pg_temp.leaks((SELECT payload::text FROM core.events e WHERE e.aggregate_id = v_id AND e.type = 'ProviderKeyRevealed'),
                          current_setting('t29.k1')),
    'T7c the reveal wrote one REVEAL audit row (aal2, reason) and one ProviderKeyRevealed event without the key');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('r_again')) = 'FORBIDDEN'
    AND pg_temp.detail(pg_temp.got('r_again')) ->> 'reason' = 'REVEAL_RATE_LIMITED'
    AND pg_temp.detail(pg_temp.got('r_again')) ->> 'window' = 'PT24H',
    'T7d a second reveal of the same key is REVEAL_RATE_LIMITED (per key, 24h)');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('r_k2')) = 'OK' AND pg_temp.code(pg_temp.got('r_k3')) = 'OK'
    AND pg_temp.code(pg_temp.got('r_k4')) = 'FORBIDDEN'
    AND pg_temp.detail(pg_temp.got('r_k4')) ->> 'window' = 'PT1H'
    AND NOT pg_temp.leaks(pg_temp.got('r_k4')::text, current_setting('t29.k4')),
    'T7e the actor''s fourth reveal inside an hour is REVEAL_RATE_LIMITED (per actor, 3/h) and carries no key');
END
$t7$;

-- 013's guard is still the control: a bare bump without the audit GUC.
SELECT set_config('t29.bare_bump', pg_temp.try(format(
  $$WITH u AS (UPDATE core.ai_provider_keys SET last_revealed_at = now() WHERE provider_ref = %L RETURNING 1)
    SELECT to_jsonb(count(*)) FROM u$$, pg_temp.data(pg_temp.got('c4')) ->> 'id'))::text, true);
SELECT pg_temp.assert(pg_temp.code(pg_temp.got('bare_bump')) = 'REVEAL_AUDIT_REQUIRED',
  'T7f 013 app.require_reveal_audit still refuses a last_revealed_at bump with no audit row (TRNOS REVEAL_AUDIT_REQUIRED)');

-- ═══ T8 · test and result recording ════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin');
SELECT set_config('t29.t_reuse', pg_temp.try(format($$SELECT core.test_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.t_pending', pg_temp.try(format($$SELECT core.get_provider_test_result(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
RESET ROLE;

SELECT pg_temp.assert(pg_temp.code(pg_temp.got('t_reuse')) = 'OK'
  AND pg_temp.data(pg_temp.got('t_reuse')) ->> 'state' = 'PENDING'
  AND (SELECT count(*) FROM app.provider_key_probes p JOIN core.ai_provider_keys k ON k.id = p.provider_key_id
        WHERE k.provider_ref = pg_temp.data(pg_temp.got('c1')) ->> 'id') = 1
  AND pg_temp.data(pg_temp.got('t_pending')) ->> 'state' = 'PENDING',
  'T8a a test inside 30s of the create reuses the in-flight probe (no second request); result is PENDING with no response');

-- The pg_net worker's side, synthetically: take the queued request, write the
-- response under its id.
CREATE FUNCTION pg_temp.respond(p_ref text, p_status integer, p_timed_out boolean DEFAULT false)
RETURNS void LANGUAGE sql AS $fn$
  WITH probe AS (
    SELECT p.net_request_id FROM app.provider_key_probes p JOIN core.ai_provider_keys k ON k.id = p.provider_key_id
     WHERE k.provider_ref = p_ref ORDER BY p.net_request_id DESC LIMIT 1),
  taken AS (DELETE FROM net.http_request_queue q USING probe WHERE q.id = probe.net_request_id RETURNING q.id)
  INSERT INTO net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
  SELECT probe.net_request_id, CASE WHEN p_timed_out THEN NULL ELSE p_status END, 'application/json',
         '{"x-request-id":"t29"}'::jsonb, '{"error":{"message":"T29 provider body"}}', p_timed_out,
         CASE WHEN p_timed_out THEN 'Timeout was reached' END
    FROM probe;
$fn$;

SELECT pg_temp.respond(pg_temp.data(pg_temp.got('c1')) ->> 'id', 200),
       pg_temp.respond(pg_temp.data(pg_temp.got('c2')) ->> 'id', 401),
       pg_temp.respond(pg_temp.data(pg_temp.got('c3')) ->> 'id', 429),
       pg_temp.respond(pg_temp.data(pg_temp.got('c4')) ->> 'id', 400);

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin');
SELECT set_config('t29.t1', pg_temp.try(format($$SELECT core.get_provider_test_result(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.t2', pg_temp.try(format($$SELECT core.get_provider_test_result(%L)$$, pg_temp.data(pg_temp.got('c2')) ->> 'id'))::text, true);
SELECT set_config('t29.t3', pg_temp.try(format($$SELECT core.get_provider_test_result(%L)$$, pg_temp.data(pg_temp.got('c3')) ->> 'id'))::text, true);
SELECT set_config('t29.t4', pg_temp.try(format($$SELECT core.get_provider_test_result(%L)$$, pg_temp.data(pg_temp.got('c4')) ->> 'id'))::text, true);
-- A fresh test on a key whose last probe is DONE queues a new one.
SELECT set_config('t29.t3_again', pg_temp.try(format($$SELECT core.test_provider(%L)$$, pg_temp.data(pg_temp.got('c3')) ->> 'id'))::text, true);
RESET ROLE;

DO $t8$
DECLARE
  t1 jsonb := pg_temp.data(pg_temp.got('t1')); t2 jsonb := pg_temp.data(pg_temp.got('t2'));
  t3 jsonb := pg_temp.data(pg_temp.got('t3')); t4 jsonb := pg_temp.data(pg_temp.got('t4'));
BEGIN
  PERFORM pg_temp.assert(t1 ->> 'state' = 'DONE' AND t1 ->> 'outcome' = 'OK' AND t1 ->> 'status' = 'VALID'
    AND t1 ->> 'lastTestedAt' IS NOT NULL AND NOT t1 ? 'message'
    AND (SELECT status::text || coalesce(invalid_since::text,'-') FROM core.ai_provider_keys WHERE provider_ref = pg_temp.data(pg_temp.got('c1')) ->> 'id') = 'VALID-',
    'T8b HTTP 200 -> OK, key VALID, last_tested_at stamped');
  PERFORM pg_temp.assert(t2 ->> 'outcome' = 'INVALID_KEY' AND t2 ->> 'status' = 'INVALID'
    AND t2 ->> 'message' = 'The key was rejected by OPENAI.'
    AND (SELECT invalid_since IS NOT NULL FROM core.ai_provider_keys WHERE provider_ref = pg_temp.data(pg_temp.got('c2')) ->> 'id'),
    'T8c HTTP 401 -> INVALID_KEY, key INVALID with invalid_since');
  PERFORM pg_temp.assert(t3 ->> 'outcome' = 'RATE_LIMITED' AND t3 ->> 'status' = 'NOT_SET'
    AND (SELECT last_tested_at IS NOT NULL FROM core.ai_provider_keys WHERE provider_ref = pg_temp.data(pg_temp.got('c3')) ->> 'id'),
    'T8d HTTP 429 -> RATE_LIMITED, status unchanged, last_tested_at still stamped');
  PERFORM pg_temp.assert(t4 ->> 'outcome' = 'INVALID_KEY' AND t4 ->> 'status' = 'INVALID',
    'T8e Google HTTP 400 (API_KEY_INVALID) -> INVALID_KEY');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM net._http_response WHERE content LIKE '%T29 provider body%')
    AND NOT EXISTS (SELECT 1 FROM app.provider_key_probes WHERE outcome <> 'PENDING' AND completed_at IS NULL),
    'T8f every classified response row was deleted from net._http_response');
  PERFORM pg_temp.assert(pg_temp.data(pg_temp.got('t3_again')) ->> 'state' = 'PENDING'
    AND (SELECT count(*) FROM app.provider_key_probes p JOIN core.ai_provider_keys k ON k.id = p.provider_key_id
          WHERE k.provider_ref = pg_temp.data(pg_temp.got('c3')) ->> 'id') = 2,
    'T8g a test after a completed probe queues a new probe');
END
$t8$;

-- Timeout, and no response after 60 seconds (requested_at is frozen by
-- finalise_table, so the fixture ages it with the immutability trigger off).
SELECT pg_temp.respond(pg_temp.data(pg_temp.got('c3')) ->> 'id', NULL, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin');
SELECT set_config('t29.t_timeout', pg_temp.try(format($$SELECT core.get_provider_test_result(%L)$$, pg_temp.data(pg_temp.got('c3')) ->> 'id'))::text, true);
SELECT set_config('t29.t_b', pg_temp.try(format($$SELECT core.test_provider(%L)$$, pg_temp.data(pg_temp.got('c2')) ->> 'id'))::text, true);
RESET ROLE;
DO $age$
DECLARE v_trigger text;
BEGIN
  FOR v_trigger IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'app.provider_key_probes'::regclass AND NOT tgisinternal LOOP
    EXECUTE format('ALTER TABLE app.provider_key_probes DISABLE TRIGGER %I', v_trigger);
  END LOOP;
  UPDATE app.provider_key_probes p SET requested_at = now() - interval '2 minutes'
    FROM core.ai_provider_keys k
   WHERE k.id = p.provider_key_id AND k.provider_ref = pg_temp.data(pg_temp.got('c2')) ->> 'id' AND p.outcome = 'PENDING';
  FOR v_trigger IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'app.provider_key_probes'::regclass AND NOT tgisinternal LOOP
    EXECUTE format('ALTER TABLE app.provider_key_probes ENABLE TRIGGER %I', v_trigger);
  END LOOP;
END
$age$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin');
SELECT set_config('t29.t_lost', pg_temp.try(format($$SELECT core.get_provider_test_result(%L)$$, pg_temp.data(pg_temp.got('c2')) ->> 'id'))::text, true);
RESET ROLE;
SELECT pg_temp.assert(
  pg_temp.data(pg_temp.got('t_timeout')) ->> 'outcome' = 'NETWORK_ERROR'
  AND pg_temp.data(pg_temp.got('t_timeout')) ->> 'status' = 'NOT_SET'
  AND pg_temp.data(pg_temp.got('t_b')) ->> 'state' = 'PENDING'
  AND pg_temp.data(pg_temp.got('t_lost')) ->> 'outcome' = 'NETWORK_ERROR'
  AND pg_temp.data(pg_temp.got('t_lost')) ->> 'status' = 'INVALID',
  'T8h timed_out -> NETWORK_ERROR status unchanged; no response 60s after the request -> NETWORK_ERROR status unchanged ' || pg_temp.got('t_timeout')::text || pg_temp.got('t_b')::text || pg_temp.got('t_lost')::text);

-- ═══ T9 · rotate ═══════════════════════════════════════════════════════════
SELECT set_config('t29.old_ref', (SELECT key_ref FROM core.ai_provider_keys WHERE provider_ref = pg_temp.data(pg_temp.got('c1')) ->> 'id'), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin', 'aal1');
SELECT set_config('t29.rot_aal1', pg_temp.try(format($$SELECT core.rotate_provider(%L,%L)$$,
  pg_temp.data(pg_temp.got('c1')) ->> 'id', current_setting('t29.k1b')))::text, true);
SELECT pg_temp.as_user('admin', 'aal2', 'a0290000-5555-4000-8000-000000000002');
-- c2 is OpenAI; k3 has a valid `sk-` shape for it and is c3's key.
SELECT set_config('t29.rot_dup', pg_temp.try(format($$SELECT core.rotate_provider(%L,%L)$$,
  pg_temp.data(pg_temp.got('c2')) ->> 'id', current_setting('t29.k3')))::text, true);
SELECT set_config('t29.rot_ok', pg_temp.try(format($$SELECT core.rotate_provider(%L,%L)$$,
  pg_temp.data(pg_temp.got('c1')) ->> 'id', current_setting('t29.k1b')))::text, true);
RESET ROLE;

DO $t9$
DECLARE
  v jsonb := pg_temp.data(pg_temp.got('rot_ok'));
  r core.ai_provider_keys;
BEGIN
  SELECT * INTO r FROM core.ai_provider_keys WHERE provider_ref = pg_temp.data(pg_temp.got('c1')) ->> 'id';
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('rot_aal1')) = 'FORBIDDEN'
    AND pg_temp.detail(pg_temp.got('rot_aal1')) ->> 'reason' = 'AAL2_REQUIRED'
    AND NOT pg_temp.leaks(pg_temp.got('rot_aal1')::text, current_setting('t29.k1b')),
    'T9a rotate at aal1 is FORBIDDEN AAL2_REQUIRED');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('rot_dup')) = 'VALIDATION_FAILED'
    AND pg_temp.detail(pg_temp.got('rot_dup')) -> 'fields' @> '[{"reason":"DUPLICATE"}]'
    AND pg_temp.detail(pg_temp.got('rot_dup')) ->> 'existingId' = pg_temp.data(pg_temp.got('c3')) ->> 'id'
    AND NOT pg_temp.leaks(pg_temp.got('rot_dup')::text, current_setting('t29.k3')),
    'T9b rotating onto another row''s key is KEY_ALREADY_ADDED, no fragment ' || pg_temp.got('rot_dup')::text);
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('rot_ok')) = 'OK'
    AND v ->> 'maskedKey' = app.mask_key(current_setting('t29.k1b')) AND v ->> 'status' = 'NOT_SET'
    AND r.key_ref <> current_setting('t29.old_ref') AND r.last_revealed_at IS NULL
    AND (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = r.key_ref::uuid) = current_setting('t29.k1b')
    AND NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = current_setting('t29.old_ref')::uuid),
    'T9c rotate after a reveal: new masked key, NOT_SET, new Vault secret holds the new key, OLD secret deleted, reveal ceiling cleared');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM app.key_access_audit a WHERE a.provider_key_id = r.id AND a.purpose = 'ROTATE'
        AND a.key_ref = current_setting('t29.old_ref')) = 1
    AND (SELECT count(*) FROM app.provider_key_probes p WHERE p.provider_key_id = r.id AND p.outcome = 'PENDING') = 1,
    'T9d ROTATE audit row records the OLD key_ref; the new material was probed');
END
$t9$;

-- ═══ T10 · delete ══════════════════════════════════════════════════════════
-- A key with no access history, written as the migration role would, for the
-- hard-delete branch.
DO $manual$
DECLARE v_secret uuid := vault.create_secret('sk-ant-api03-T29MANUALabcdefghijklmnopq', 'trainos/byok/t29-manual');
BEGIN
  INSERT INTO core.ai_provider_keys (tenant_id, provider_ref, provider, label, status, masked_key,
    key_fingerprint, key_ref, scope_tiers, region, added_by)
  VALUES ('a0290000-1111-4000-8000-000000000001', 'prv_anthropic_manual', 'ANTHROPIC', 'Manual', 'VALID',
    app.mask_key('sk-ant-api03-T29MANUALabcdefghijklmnopq'), sha256('t29-manual'), v_secret::text,
    ARRAY['STRONG_1'], 'US', '{"kind":"SYSTEM","id":"t29","name":null}');
END
$manual$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin', 'aal2', 'a0290000-5555-4000-8000-000000000002');
-- c4 (Google) is the only key scoping FAST.
SELECT set_config('t29.d_blocked', pg_temp.try(format($$SELECT core.delete_provider(%L)$$, pg_temp.data(pg_temp.got('c4')) ->> 'id'))::text, true);
-- c1 scopes STRONG_1, which the manual key also scopes: deletable, and audited.
SELECT set_config('t29.d_tomb', pg_temp.try(format($$SELECT core.delete_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.d_after_test', pg_temp.try(format($$SELECT core.test_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
SELECT set_config('t29.d_after_del', pg_temp.try(format($$SELECT core.delete_provider(%L)$$, pg_temp.data(pg_temp.got('c1')) ->> 'id'))::text, true);
-- Now the manual key is the only STRONG_1 key left.
SELECT set_config('t29.d_manual_blocked', pg_temp.try($$SELECT core.delete_provider('prv_anthropic_manual')$$)::text, true);
RESET ROLE;
UPDATE core.ai_provider_keys SET scope_tiers = ARRAY[]::text[] WHERE provider_ref = 'prv_anthropic_manual';
SELECT set_config('t29.manual_ref', (SELECT key_ref FROM core.ai_provider_keys WHERE provider_ref = 'prv_anthropic_manual'), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin', 'aal2', 'a0290000-5555-4000-8000-000000000002');
SELECT set_config('t29.d_hard', pg_temp.try($$SELECT core.delete_provider('prv_anthropic_manual')$$)::text, true);
SELECT set_config('t29.list_after_delete', pg_temp.try($$SELECT core.list_providers()$$)::text, true);
RESET ROLE;

DO $t10$
DECLARE r core.ai_provider_keys;
BEGIN
  SELECT * INTO r FROM core.ai_provider_keys WHERE provider_ref = pg_temp.data(pg_temp.got('c1')) ->> 'id';
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('d_blocked')) = 'AGENT_PAUSED'
    AND pg_temp.detail(pg_temp.got('d_blocked')) -> 'blockers' = '["FAST"]'::jsonb,
    'T10a deleting the only FAST key is AGENT_PAUSED {blockers:[FAST]}');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('d_tomb')) = 'OK'
    AND r.key_ref = 'retired:' || r.id AND r.status = 'INVALID' AND r.scope_tiers = ARRAY[]::text[]
    AND NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = format('trainos/byok/%s/%s', r.tenant_id, r.id))
    AND (SELECT count(*) FROM app.key_access_audit WHERE provider_key_id = r.id) >= 3
    AND (SELECT count(*) FROM core.events WHERE aggregate_id = r.id AND type = 'ProviderKeyDeleted') = 1,
    'T10b an audited key is tombstoned (013 RESTRICT keeps the audit trail), its Vault secret destroyed');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('d_after_test')) = 'NOT_FOUND'
    AND pg_temp.code(pg_temp.got('d_after_del')) = 'NOT_FOUND',
    'T10c a deleted key is NOT_FOUND to test and delete');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('d_manual_blocked')) = 'AGENT_PAUSED'
    AND pg_temp.detail(pg_temp.got('d_manual_blocked')) -> 'blockers' = '["STRONG_1"]'::jsonb,
    'T10d a tombstone does not count as a surviving key for the tier check');
  PERFORM pg_temp.assert(pg_temp.code(pg_temp.got('d_hard')) = 'OK'
    AND NOT EXISTS (SELECT 1 FROM core.ai_provider_keys WHERE provider_ref = 'prv_anthropic_manual')
    AND NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = current_setting('t29.manual_ref')::uuid),
    'T10e an unaudited key is hard-deleted with its Vault secret');
  PERFORM pg_temp.assert(pg_temp.got('list_after_delete') #>> '{value,success}' = 'true'
    AND jsonb_array_length(pg_temp.data(pg_temp.got('list_after_delete')) -> 'data') > 0
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.data(pg_temp.got('list_after_delete')) -> 'data') AS listed(rec)
                     WHERE listed.rec ->> 'id' IN (r.provider_ref, 'prv_anthropic_manual')),
    'T10f 027 core.list_providers omits the tombstoned key (retired: filter) and the hard-deleted one');
END
$t10$;

-- ═══ T11 · the worker accessor ═════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('admin', 'aal2', 'a0290000-5555-4000-8000-000000000002');
SELECT set_config('t29.w_auth', pg_temp.try(
  $$SELECT to_jsonb(count(*)) FROM app.provider_key_for_tenant('a0290000-1111-4000-8000-000000000001', NULL)$$)::text, true);
RESET ROLE;
SELECT set_config('t29.w_audit_before', (SELECT count(*) FROM app.key_access_audit WHERE purpose = 'RUN_CALL')::text, true);
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('t29.w_all', (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.provider)
  FROM app.provider_key_for_tenant('a0290000-1111-4000-8000-000000000001', NULL) k)::text, true);
SELECT set_config('t29.w_one', (SELECT jsonb_agg(to_jsonb(k))
  FROM app.provider_key_for_tenant('a0290000-1111-4000-8000-000000000001', 'deepseek') k)::text, true);
SELECT set_config('t29.w_b', (SELECT to_jsonb(count(*))
  FROM app.provider_key_for_tenant('a0290000-1111-4000-8000-000000000002', 'ANTHROPIC') k)::text, true);
RESET ROLE;

DO $t11$
DECLARE v jsonb := pg_temp.got('w_all');
BEGIN
  PERFORM pg_temp.assert(pg_temp.got('w_auth') ->> 'sqlstate' = '42501',
    'T11a authenticated (even ADMIN at aal2) cannot execute app.provider_key_for_tenant');
  -- Tenant A live keys now: c1 tombstoned, c2 INVALID, c3 NOT_SET (deepseek),
  -- c4 INVALID, c5 openrouter, c6 OTHER. Ordered by provider.
  PERFORM pg_temp.assert(jsonb_array_length(v) = 3
    AND v -> 0 ->> 'provider' = 'deepseek' AND v -> 0 ->> 'api_key' = current_setting('t29.k3')
    AND v -> 1 ->> 'provider' = 'openai-compatible' AND v -> 1 ->> 'api_key' = current_setting('t29.k6')
    AND v -> 1 ->> 'base_url' = 'https://api.groq.example.com/openai/v1/'
    AND v -> 2 ->> 'provider' = 'openrouter' AND v -> 2 ->> 'api_key' = current_setting('t29.k5')
    AND (v -> 0) ? 'base_url' AND (v -> 0) ? 'label',
    'T11b service_role gets (provider, api_key, base_url, label): only the live non-INVALID key, by runtime id');
  PERFORM pg_temp.assert(jsonb_array_length(pg_temp.got('w_one')) = 1
    AND pg_temp.got('w_b')::text = '1',
    'T11c a provider filter by runtime id works; tenant B''s ANTHROPIC key is returned for tenant B only');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM app.key_access_audit WHERE purpose = 'RUN_CALL')
      = current_setting('t29.w_audit_before')::integer + 5,
    'T11d one RUN_CALL audit row per key returned (3 + 1 + 1)');
END
$t11$;

-- ═══ T12 · the grep again, after every path has run ════════════════════════
DO $t12$
DECLARE
  v_sweep text[] := string_to_array(pg_temp.key_sweep(ARRAY[
    current_setting('t29.k1'), current_setting('t29.k1b'), current_setting('t29.k2'),
    current_setting('t29.k3'), current_setting('t29.k4'), current_setting('t29.kb'),
    current_setting('t29.k5'), current_setting('t29.k6'),
    'sk-ant-api03-T29MANUALabcdefghijklmnopq']), '|');
BEGIN
  PERFORM pg_temp.assert(v_sweep[2] = '0',
    format('T12 after create, test, reveal, rotate, delete and the accessor: raw keys in 0 of %s columns%s',
           v_sweep[1], v_sweep[3]));
END
$t12$;

ROLLBACK;
