-- ═══════════════════════════════════════════════════════════════════════════
-- 029 · BYOK provider keys through SQL RPCs and Supabase Vault
-- ═══════════════════════════════════════════════════════════════════════════
--
-- FEATURE. AI Settings -> Providers (M20-S21) against the database for real:
-- createProvider, testProvider, rotateProvider, revealProvider and
-- deleteProvider, plus the one service-side accessor the worker needs to USE a
-- tenant's key. listProviders is 027's (`core.list_providers`) and is NOT
-- redefined here.
--
-- DEPENDS ON 001–021 ONLY, plus two platform extensions that hosted has and a
-- vanilla PostgreSQL does not: supabase_vault (0.3.1 on hosted) and pg_net
-- (0.20.4 on hosted). §0 refuses to apply without them rather than creating
-- functions that fail on first call.
--
-- ── USER RULING, 14 Sep 19:07 — WHY THIS SUPERSEDES 013's DESIGN ──────────
--
-- 013 designed the key path around an Edge Function that holds the raw key,
-- writes it to the secret store itself, and calls
-- `public.ai_provider_key_set/_test/_rotate/_delete/_reveal` with only a mask,
-- a fingerprint and a locator (013:150-210, 013:2375-2758). That Edge Function
-- never existed, and the ruling is that none will: no Supabase Edge Functions,
-- ever. The raw key now travels over TLS to a SQL RPC and is stored in Vault.
--
-- The five 013 `public.*` functions are LEFT IN PLACE AND UNREACHABLE. 013's
-- own §12 already revoked EXECUTE from PUBLIC, anon, authenticated AND
-- service_role (013:3114), and no later migration granted it back. §7 below
-- repeats that revoke idempotently and $verify$ asserts that no client role and
-- not service_role can execute any of them. They are not dropped because 013 is
-- immutable and its pin (test_013) calls them as the owner; dropping them is a
-- separate cleanup with its own pin amendment. Nothing in the web client names
-- them.
--
-- ═══ THE SECRET-HANDLING RULES, EACH WITH ITS MECHANISM AND ITS PROOF ═════
--
-- R1  THE RAW KEY IS WRITTEN ONLY TO vault.secrets.
--     `core.create_provider` and `core.rotate_provider` take `p_key text` and
--     pass it to `vault.create_secret` and nowhere else. core.ai_provider_keys
--     receives exactly three derived values, the same three 013 designed for:
--       key_ref          the Vault secret id (a uuid, as text). 013's comment on
--                        the table holds: a Vault id is not a capability,
--                        because decrypting needs SELECT on
--                        vault.decrypted_secrets and no client role has it.
--       masked_key       app.mask_key(key) — 013's ONE definition of the mask,
--                        now finally computed from the key IN THE DATABASE, which
--                        closes 013's M-10(1) residual (a caller could present a
--                        mask that did not match the key).
--       key_fingerprint  HMAC-SHA256(key, per-tenant 32-byte salt) via pgcrypto.
--                        The salt lives in app.provider_key_salts, which no
--                        client can read, so a fingerprint a client CAN read
--                        (014 grants ADMIN SELECT on core.ai_provider_keys) is
--                        not an offline guessing oracle, and the same key held
--                        by two tenants produces two unrelated fingerprints. It
--                        only ever detects "this key was already added" (UNIQUE
--                        (tenant_id, key_fingerprint), 013).
--     Vault secret NAME: `trainos/byok/<tenant_id>/<provider key row id>` —
--     deterministic per row, unguessable because the row id is a random uuid.
--     DESCRIPTION: provider and ref only, never key material.
--     PROOF: test_029 T3 greps every text, varchar, bytea, json and jsonb column
--     of every table in core, app and public (and the pg_net queue and response
--     tables after the probe is recorded) for the key string and its hex form:
--     zero hits.
--
-- R2  THE RAW KEY IS NEVER RETURNED, LOGGED OR PUT IN AN ERROR — EXCEPT BY
--     REVEAL. Every path that holds the key runs inside a block whose
--     EXCEPTION handler re-raises our own TRNOS refusals unchanged (they are
--     written here and carry no key) and replaces ANY other error with a fixed
--     message, the original SQLSTATE and no DETAIL, HINT or CONTEXT. That
--     matters because PostgreSQL's own messages can carry values: a NOT NULL or
--     CHECK violation's DETAIL is "Failing row contains (...)", and
--     vault.create_secret INSERTs the plaintext before it encrypts
--     (supabase_vault--0.3.0.sql). A caught error is not written to the server
--     log; only the sanitized re-raise is. Validation refusals name the field
--     and a reason code, never a fragment. No RAISE NOTICE anywhere in 029.
--     PROOF: T4 submits malformed and duplicate keys and asserts that no
--     refusal's message or detail contains any 6-character substring of the key.
--
-- R3  REVEAL — ADMIN, AAL2, AUDIT FIRST, RATE-LIMITED, DECRYPT IN ONE PLACE.
--     `core.reveal_provider` is the only client-callable function that reads
--     vault.decrypted_secrets. Order is the control, and it is 013's:
--       gate ai:provider:reveal (ADMIN only, 002:1136)
--       -> not an agent -> app.aal2_verified() (grounded in an auth.sessions
--          row, 011:283) else FORBIDDEN {reason: AAL2_REQUIRED}, 011:2368's shape
--       -> per-ACTOR ceiling: 3 reveals per rolling hour in the tenant, counted
--          from app.key_access_audit under a transaction advisory lock so two
--          concurrent reveals cannot both pass
--       -> per-KEY ceiling: 013's one reveal per key per 24 hours
--       -> app.record_key_access(REVEAL) writes the audit row
--       -> the id goes into `app.key_reveal_audit` and last_revealed_at is
--          bumped, which 013's app.require_reveal_audit trigger REFUSES
--          (REVEAL_AUDIT_REQUIRED / REVEAL_AUDIT_MISMATCH, TRNOS since 87ca109)
--          unless that audit row exists for this tenant, key and transaction
--       -> decrypt -> emit ProviderKeyRevealed -> return {key, revealedAt}.
--     The audit row and the returned key commit or roll back together: there is
--     no ordering in which a key leaves the function and its audit row does not.
--     The contract body carries no reason, and 013's audit table requires one
--     for REVEAL (key_access_audit_reveal_has_reason), so a fixed reason naming
--     the screen is written.
--
-- R4  TEST — pg_net, ASYNCHRONOUS, NO RESPONSE BODY KEPT.
--     A probe is `net.http_get` to the provider's cheapest authenticated
--     endpoint (the models list; the URL is a constant per provider, never
--     caller-supplied) with the key in the provider's auth header. pg_net
--     queues the request and its background worker sends it AFTER COMMIT, so
--     the verdict cannot be read in the same call. Two RPCs therefore:
--       core.test_provider(p_id)            fires, records app.provider_key_probes
--                                           (PENDING, request id), audits PROBE
--       core.get_provider_test_result(p_id) reads net._http_response for that
--                                           request id: status_code, timed_out
--                                           and error_msg ONLY, classifies it
--                                           OK | INVALID_KEY | RATE_LIMITED |
--                                           NETWORK_ERROR | PROVIDER_ERROR,
--                                           writes the verdict to the key row
--                                           with 013's _test semantics (status,
--                                           last_tested_at, invalid_since), and
--                                           DELETES the response row.
--     The contract's ProviderKeyTestResponse is synchronous and has no PENDING
--     status. The web adapter is the bridge: it calls the first RPC and polls
--     the second (bounded), then returns the contract shape. No contract change.
--     Only OK and INVALID_KEY move `status`; the other three outcomes are not a
--     verdict on the key and leave status alone while still stamping
--     last_tested_at ("updates lastTestedAt whatever the verdict", §17).
--     create and rotate fire a probe too, so a new key does not sit at NOT_SET —
--     which ProviderKeysScreen.tsx renders as an empty slot with no Test button.
--
-- R5  ROTATE AND DELETE.
--     rotate: new material through the same R1 path; the OLD Vault secret is
--     deleted in the same transaction, so the old key is unreadable the moment
--     the rotation commits (§17 "old key invalidated immediately"); the ROTATE
--     audit row is written before the row moves and records the OLD key_ref;
--     013's pairing trigger is satisfied because key_ref and key_fingerprint
--     change together, and its reveal trigger's narrow rotation exemption
--     (last_revealed_at cleared while the material changes) applies.
--     delete: §17 409 when a tier would be left without a key, as the fixture
--     does (AGENT_PAUSED {blockers}, FixtureClient.ts:1960). The Vault secret is
--     deleted. The row is hard-deleted when no app.key_access_audit row names it;
--     otherwise it CANNOT be — 013's key_access_audit_key_fk is ON DELETE
--     RESTRICT, deliberately, so the record of who read a key outlives the key —
--     and the row becomes a tombstone: key_ref `retired:<id>`, fingerprint
--     retired, status INVALID, no tiers. Every 029 path treats a `retired:` row
--     as absent. 027's core.list_providers must filter
--     `key_ref NOT LIKE 'retired:%'` or a deleted, previously-used key lists as
--     INVALID; that is a data convention, not a dependency on 029. CONFIRMED
--     against 027 as merged (027_ops_knowledge_settings.sql, list_providers
--     WHERE clause), and pinned by test_029 T10f.
--
-- R5b ACCESSOR FOR THE WORKER. `app.provider_key_for_tenant(uuid, text)` is the
--     exact signature apps/worker/src/keys.ts:19,50 already calls
--     (`SELECT provider, api_key, base_url, label FROM ...($1,$2)`). SECURITY
--     DEFINER, EXECUTE to service_role ONLY, one RUN_CALL audit row per key
--     returned. `provider` is the agent runtime's id (packages/agent-runtime
--     ProviderId), not the contract enum, because that is what the worker
--     compares against. Tombstoned and INVALID keys are never returned.
--
-- R5c OPENROUTER AND OTHER (main's ruling, "add enum"). 003:107 created
--     core.ai_provider with four labels; the contract (enums.ts:737) and the Add
--     Key drawer carry six. §1b adds OPENROUTER and OTHER with ALTER TYPE ... ADD
--     VALUE IF NOT EXISTS, and a nullable `base_url` column on
--     core.ai_provider_keys that OTHER REQUIRES (an "OpenAI-compatible endpoint"
--     has no URL of its own) and every other provider must leave NULL.
--     OpenRouter is probed at GET https://openrouter.ai/api/v1/key; OTHER at
--     GET <base_url>/models. base_url must be https to a DNS name — no IP
--     literal, no localhost, no .local/.internal — because the probe is a
--     request FROM THE DATABASE HOST carrying the key; the residue is a DNS name
--     that resolves inward, which a regex cannot see.
--     ⚠ THE CONTRACT HAS NO baseUrl FIELD (ProviderKeyCreateRequest,
--     ai-ops.ts:199). `core.create_provider` accepts `p_base_url`, but the web
--     adapter cannot send what the contract does not carry, so OTHER is
--     refused (BASE_URL_REQUIRED) from the screen until the contract grows it.
--     ⚠ ROLLBACK RESIDUE. PostgreSQL cannot drop an enum label without
--     rewriting the type, and deleting from pg_enum needs a superuser, so the
--     rollback leaves OPENROUTER and OTHER on core.ai_provider (and restores
--     003's type comment). A rollback catalog diff must exclude those two labels.
--     test_003 T3 is ⚠ AMENDED BY 029 to expect six labels.
--
-- R6  GRANTS, ASSERTED STRUCTURALLY IN $verify$ (not by reading this file):
--     authenticated EXECUTEs exactly the six core RPCs; anon nothing;
--     service_role exactly the accessor; no 029 app.* helper is executable by
--     any of the three; no client role can SELECT vault.secrets,
--     vault.decrypted_secrets, app.provider_key_salts or
--     app.provider_key_probes; every 029 function is SECURITY DEFINER or a
--     plain helper at `search_path=""` exactly, with one overload.
--
-- R7  NO KEY-CARRYING CALL MAY RUN LONG ENOUGH FOR auto_explain TO LOG IT.
--     Hosted loads auto_explain with log_min_duration = 10000 and
--     log_parameter_max_length = -1 (main, read-only check, 14 Sep), so a
--     statement that COMPLETES after 10 seconds is logged with its bind
--     parameters in full — the key, for create and rotate. The five functions
--     that receive or return key material (create, test, rotate, reveal, the
--     worker accessor) therefore carry `SET statement_timeout = '5s'` and
--     `SET lock_timeout = '2s'`, and $verify$ V8 asserts both exact strings.
--     ⚠ MEASURED, AND IT CHANGES WHICH OF THE TWO IS THE CONTROL: a function's
--     own `SET statement_timeout` does NOT cancel the statement that called it
--     — PostgreSQL arms that timer when the top-level statement starts, and a
--     function with `SET statement_timeout = '1s'` around `pg_sleep(2.5)`
--     returned after 2.5 s on the shim. `lock_timeout` IS read when each lock
--     is requested, so the same SET cancelled a blocked
--     `pg_advisory_xact_lock` after exactly 1 s. Every wait these functions can
--     hit is a lock wait (the key row's FOR UPDATE, the reveal advisory lock,
--     the fingerprint and Vault-name unique indexes), so lock_timeout is what
--     bounds them; a cancelled statement never reaches ExecutorEnd, so
--     auto_explain does not log it. statement_timeout stays declared because it
--     documents intent and binds any statement these bodies start themselves.
--     The top-level bound on hosted is PostgREST's per-role statement_timeout
--     (Supabase defaults `authenticated` to 8s); confirm with
--     `SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('authenticated','service_role')`.
--     The same measurement means the pack's `SET statement_timeout = '10s'` on
--     018–022's RPCs does not bound those calls either. Reported, not changed.
--
-- ═══ WHAT I CANNOT CLOSE FROM SQL, STATED RATHER THAN MINIMISED ════════════
--
-- L1  RPC ARGUMENTS IN LOGS. PostgREST sends an RPC's JSON body as a BIND
--     PARAMETER of a prepared statement; the key is never inlined into SQL text,
--     so pg_stat_activity.query and pg_stat_statements show `$1`, not the key.
--     It DOES reach a log line if any of these holds on the project:
--       * log_statement = 'all' or 'mod', or log_min_duration_statement is met:
--         the parameters are logged in full (log_parameter_max_length -1);
--       * log_parameter_max_length_on_error > 0 and the statement errors;
--       * pgaudit with parameter logging, or auto_explain with log_parameters.
--     Supabase's defaults are none of these as far as the published config
--     shows, but this lane had no hosted access to read `pg_settings`; the PR
--     lists the query that settles it. Supabase's API gateway logs (edge_logs)
--     record request metadata, not POST bodies, per the platform docs — also
--     unverified here. The body is POST, never a query string.
-- L2  VAULT WRITES PLAINTEXT FIRST. vault.create_secret (0.3.x) INSERTs
--     `new_secret` in the clear and then UPDATEs it to ciphertext in the same
--     function. The first tuple version is dead on commit and not visible to
--     any snapshot, but it is WAL-logged (vault.secrets is a logged table), so
--     the plaintext is in WAL and therefore in PITR/WAL archives until they
--     expire. That is Supabase Vault's behaviour for every caller, not
--     something 029 can avoid while using Vault.
-- L3  pg_net QUEUE AND RESPONSE TABLES. A probe's Authorization header — the key
--     — sits in `net.http_request_queue.headers` from commit until the pg_net
--     worker picks it up (normally well under a second). Upstream pg_net GRANTs
--     ALL on every table in schema `net` TO PUBLIC (pg_net.sql:357 and
--     pg_net--0.11.0--0.12.0.sql:18), so on a project where that grant stands,
--     ANY database role that can run SQL can read an in-flight key or rewrite a
--     queued URL. `net` is not a PostgREST-exposed schema, so no browser
--     principal reaches it through the Data API; the exposure is to SQL-level
--     roles. 029 cannot revoke it (the grantor is the extension owner, not the
--     migration role). The queue is UNLOGGED, so it is not in WAL. The response
--     row is deleted as soon as it is classified; its body is never read.
--     If this is unacceptable the alternative is a worker-side probe (the worker
--     already holds the accessor), which is a worker change and not this lane's.
--     MEASURED ON HOSTED by main (read-only, 14 Sep): anon AND authenticated
--     hold USAGE on `net` and SELECT on net.http_request_queue and
--     net._http_response; the tables are owned by supabase_admin, so postgres
--     cannot revoke; `net` is not in the Data API's exposed schemas and
--     pg_graphql is not installed. The exposure is SQL-only TODAY, and it stays
--     that way only while the next rule holds.
--
-- ⚠ `net` MUST NEVER BE ADDED TO THE DATA API'S EXPOSED SCHEMAS (nor pg_graphql
--     installed over it). Exposing it would let any signed-in browser — any
--     tenant — `GET /rest/v1/http_request_queue` and read another tenant's key
--     from a queued probe's headers. $verify$ V9 refuses to apply while a
--     readable `pgrst.db_schemas` setting (role or database level) names `net`;
--     where the platform keeps the list outside the catalog (the Supabase
--     dashboard), V9 cannot see it and the rule is this paragraph and the
--     catalog entry.
--
-- ═══ THE 7-POINT RPC CONTRACT CHECK ═══════════════════════════════════════
--  1 ENVELOPE. Every jsonb return is app.ok(...). Refusals RAISE TRNOS with a
--    `code` from the contract's ErrorCode set (FORBIDDEN, NOT_FOUND,
--    VALIDATION_FAILED, AGENT_PAUSED) — rpcClient.ts classify() reads DETAIL.
--  2 UNWRAP. `data` is the only sibling of `success`.
--  3 RpcMap. Argument names are the ones rpcClient.ts sends; one overload each.
--  4 CALL SITES. settings-ai/api.ts via apiClient.ts adapters.
--  5 CASTS. None.
--  6 RELOAD. Nothing here runs on page load.
--  7 PUBLIC ROUTES. Nothing is granted to anon.
--
-- search_path is `''`, the pack's one spelling (001:554, test_001 T3 sweeps
-- every function in app/core/public for exactly `search_path=""`). With the
-- empty path pg_temp would be searched first for RELATION and TYPE names, so
-- every relation here is schema-qualified; built-in type names resolve to
-- pg_catalog, and no client principal can create objects in pg_temp through
-- PostgREST.
--
-- Rollback: rollbacks/029_byok_provider_keys_vault_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL client_min_messages = warning;

-- ═══ 0 · Platform preconditions ════════════════════════════════════════════
--
-- Measured against the migration role, because every 029 definer runs as it.
-- Hosted `postgres` gets these from Supabase's supabase_vault after-create
-- script (SELECT, DELETE on vault.secrets and vault.decrypted_secrets; EXECUTE on
-- create_secret) and from pg_net's own grants.
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR pg_catalog.to_regclass('vault.secrets') IS NULL
     OR pg_catalog.to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION '029 precondition: supabase_vault is not installed '
      '(vault.create_secret / vault.secrets / vault.decrypted_secrets missing)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
           'vault.create_secret(text,text,text,uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_table_privilege('vault.decrypted_secrets', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('vault.secrets', 'DELETE') THEN
    RAISE EXCEPTION '029 precondition: % lacks EXECUTE on vault.create_secret, '
      'SELECT on vault.decrypted_secrets or DELETE on vault.secrets', current_user;
  END IF;
  IF pg_catalog.to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NULL
     OR pg_catalog.to_regclass('net._http_response') IS NULL THEN
    RAISE EXCEPTION '029 precondition: pg_net is not installed';
  END IF;
  IF NOT pg_catalog.has_function_privilege('net.http_get(text,jsonb,jsonb,integer)', 'EXECUTE')
     OR NOT pg_catalog.has_table_privilege('net._http_response', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('net._http_response', 'DELETE') THEN
    RAISE EXCEPTION '029 precondition: % lacks EXECUTE on net.http_get or '
      'SELECT/DELETE on net._http_response', current_user;
  END IF;
END
$pre$;

-- ═══ 1b · Provider vocabulary: OPENROUTER, OTHER, and base_url (R5c) ═════
--
-- ADD VALUE inside a transaction block is legal from PostgreSQL 12, but the new
-- labels cannot be USED before this transaction commits. Nothing below uses them
-- as enum literals: the CHECK compares provider::text, and every function body
-- resolves labels at call time.
ALTER TYPE core.ai_provider ADD VALUE IF NOT EXISTS 'OPENROUTER';
ALTER TYPE core.ai_provider ADD VALUE IF NOT EXISTS 'OTHER';

COMMENT ON TYPE core.ai_provider IS
  'Generated from packages/contract/src/enums.ts :: AI_PROVIDERS (6 values). '
  'OPENROUTER and OTHER added by 029; a rollback of 029 leaves them in place.';

ALTER TABLE core.ai_provider_keys
  ADD COLUMN base_url text,
  ADD CONSTRAINT ai_provider_keys_base_url_shape CHECK (
    base_url IS NULL
    OR (pg_catalog.length(base_url) <= 200
        AND base_url ~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$')),
  ADD CONSTRAINT ai_provider_keys_base_url_other CHECK (
    (provider::text = 'OTHER') = (base_url IS NOT NULL));

COMMENT ON COLUMN core.ai_provider_keys.base_url IS
  '029 R5c. The endpoint of an OTHER (OpenAI-compatible) key; NULL for every '
  'named provider. https to a DNS name only. Not key material.';

-- ═══ 1 · Tables ════════════════════════════════════════════════════════════

-- The per-tenant fingerprint salt. `app`, never exposed; RLS forced with no
-- policy through app.finalise_table, like every table in the pack.
CREATE TABLE app.provider_key_salts (
  id         uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  salt       bytea       NOT NULL CHECK (pg_catalog.octet_length(salt) = 32),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT provider_key_salts_tenant_key UNIQUE (tenant_id)
);

COMMENT ON TABLE app.provider_key_salts IS
  '029 R1. One 32-byte CSPRNG salt per tenant for the BYOK key fingerprint '
  '(HMAC-SHA256). Unreadable by every client role, so the fingerprint on '
  'core.ai_provider_keys is not an offline guessing oracle. Salt is frozen.';

SELECT app.finalise_table('app', 'provider_key_salts', false, NULL, ARRAY['salt']);

-- One row per probe fired. No response body, no headers, no key: the request id
-- pg_net returned and what the response MEANT.
CREATE TABLE app.provider_key_probes (
  id              uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  provider_key_id uuid        NOT NULL,
  net_request_id  bigint      NOT NULL,
  requested_by    jsonb       NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT pg_catalog.now(),
  outcome         text        NOT NULL DEFAULT 'PENDING'
                              CHECK (outcome IN ('PENDING','OK','INVALID_KEY','RATE_LIMITED',
                                                 'NETWORK_ERROR','PROVIDER_ERROR')),
  http_status     integer,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT provider_key_probes_requested_by_shape CHECK (app.is_valid_actor(requested_by)),
  CONSTRAINT provider_key_probes_completed CHECK (
    (outcome = 'PENDING') = (completed_at IS NULL)),
  -- Probes are operational state, not the audit record (that is 013's
  -- app.key_access_audit PROBE row), so they go with the key.
  CONSTRAINT provider_key_probes_key_fk FOREIGN KEY (tenant_id, provider_key_id)
    REFERENCES core.ai_provider_keys (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE app.provider_key_probes IS
  '029 R4. One row per pg_net provider probe: the net request id and the '
  'classified outcome. Holds no response body, header or key material.';

SELECT app.finalise_table('app', 'provider_key_probes', false, NULL,
  ARRAY['provider_key_id', 'net_request_id', 'requested_by', 'requested_at']);

-- Latest probe is by net_request_id (pg_net's bigserial), not requested_at:
-- two probes in one transaction share now(), and the ordering must not tie.
CREATE INDEX provider_key_probes_key_idx
  ON app.provider_key_probes (tenant_id, provider_key_id, net_request_id DESC);

-- ═══ 2 · Internal helpers (app, EXECUTE revoked from every client role) ════

-- The actor jsonb for the caller, with the display name the contract's
-- EditedBy needs.
CREATE OR REPLACE FUNCTION app.provider_key_actor(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'kind', app.actor_kind()::text,
    'id',   COALESCE(app.jwt() ->> 'sub', 'unknown'),
    'name', (SELECT profile.display_name
               FROM public.user_profiles AS profile
              WHERE profile.tenant_id = p_tenant_id
                AND profile.user_id::text = app.jwt() ->> 'sub'));
$fn$;

-- The contract's ProviderKey (ai-ops.ts:178). Same keys AND the same values as
-- 027's core.list_providers, so a created or rotated record and a listed one
-- cannot disagree. `spendMonth` is 027's derivation, repeated exactly: the sum
-- of this period's TIER-scope app.usage_rollup rows for the key's scope_tiers
-- (027 reads the same table; app.usage_rollup is 013's). test_029 T2i pins the
-- equality against core.list_providers row for row.
CREATE OR REPLACE FUNCTION app.provider_key_json(p_row core.ai_provider_keys)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
           'id',           p_row.provider_ref,
           'provider',     p_row.provider::text,
           'label',        p_row.label,
           'status',       p_row.status::text,
           'maskedKey',    p_row.masked_key,
           'scopeTiers',   pg_catalog.to_jsonb(p_row.scope_tiers),
           'spendMonth',   app._money(COALESCE((
                             SELECT pg_catalog.sum(rollup.spend_sen)
                               FROM app.usage_rollup AS rollup
                              WHERE rollup.tenant_id = p_row.tenant_id
                                AND rollup.period = pg_catalog.to_char(pg_catalog.now(), 'YYYY-MM')
                                AND rollup.scope = 'TIER'
                                AND rollup.key = ANY (p_row.scope_tiers)), 0)::bigint,
                           p_row.currency::text),
           'billingOwner', p_row.billing_owner::text,
           'region',       p_row.region,
           'lastTestedAt', p_row.last_tested_at,
           'addedBy',      pg_catalog.jsonb_build_object(
                             'id',   p_row.added_by ->> 'id',
                             'name', COALESCE(p_row.added_by ->> 'name', p_row.added_by ->> 'id'),
                             'at',   p_row.added_at))
      || CASE WHEN p_row.cap_sen IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('cap', app._money(p_row.cap_sen, p_row.currency::text)) END
      || CASE WHEN p_row.rotation_date IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('rotationDate', p_row.rotation_date::text) END
      || CASE WHEN p_row.invalid_since IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('invalidSince', p_row.invalid_since) END
      || CASE WHEN p_row.active_fallback_tier IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('activeFallbackTier', p_row.active_fallback_tier) END;
$fn$;

-- Shape refusal for a raw key. Returns a REASON CODE or NULL, never any part of
-- the key. Prefixes are the ones each provider documents and that every one of
-- their current keys carries; a length and printable-ASCII rule for all.
CREATE OR REPLACE FUNCTION app.provider_key_shape_reason(p_provider text, p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE
           WHEN p_key IS NULL OR pg_catalog.length(p_key) = 0 THEN 'REQUIRED'
           WHEN pg_catalog.length(p_key) < 20 THEN 'TOO_SHORT'
           WHEN pg_catalog.length(p_key) > 512 THEN 'TOO_LONG'
           WHEN p_key !~ '^[!-~]+$' THEN 'INVALID_CHARACTERS'
           WHEN p_provider = 'ANTHROPIC' AND pg_catalog."left"(p_key, 7) <> 'sk-ant-' THEN 'WRONG_PREFIX'
           WHEN p_provider IN ('OPENAI', 'DEEPSEEK') AND pg_catalog."left"(p_key, 3) <> 'sk-' THEN 'WRONG_PREFIX'
           WHEN p_provider = 'GOOGLE' AND pg_catalog."left"(p_key, 4) <> 'AIza' THEN 'WRONG_PREFIX'
           WHEN p_provider = 'OPENROUTER' AND pg_catalog."left"(p_key, 6) <> 'sk-or-' THEN 'WRONG_PREFIX'
           ELSE NULL
         END;
$fn$;

-- R1. HMAC-SHA256 under the tenant's salt, creating the salt on first use.
CREATE OR REPLACE FUNCTION app.provider_key_fingerprint(p_tenant_id uuid, p_key text)
RETURNS bytea
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_salt bytea;
BEGIN
  INSERT INTO app.provider_key_salts (tenant_id, salt)
  VALUES (p_tenant_id, extensions.gen_random_bytes(32))
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT salt.salt INTO v_salt
    FROM app.provider_key_salts AS salt
   WHERE salt.tenant_id = p_tenant_id;

  RETURN extensions.hmac(pg_catalog.convert_to(p_key, 'UTF8'), v_salt, 'sha256');
END;
$fn$;

-- R4. The probe request for one provider: a constant URL and the auth header.
-- The return value CONTAINS THE KEY and is only ever passed to net.http_get.
CREATE OR REPLACE FUNCTION app.provider_key_probe_request(p_provider text, p_key text, p_base_url text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE p_provider
           WHEN 'ANTHROPIC' THEN pg_catalog.jsonb_build_object(
             'url', 'https://api.anthropic.com/v1/models',
             'headers', pg_catalog.jsonb_build_object(
               'x-api-key', p_key, 'anthropic-version', '2023-06-01'))
           WHEN 'OPENAI' THEN pg_catalog.jsonb_build_object(
             'url', 'https://api.openai.com/v1/models',
             'headers', pg_catalog.jsonb_build_object('Authorization', 'Bearer ' || p_key))
           WHEN 'DEEPSEEK' THEN pg_catalog.jsonb_build_object(
             'url', 'https://api.deepseek.com/models',
             'headers', pg_catalog.jsonb_build_object('Authorization', 'Bearer ' || p_key))
           WHEN 'GOOGLE' THEN pg_catalog.jsonb_build_object(
             'url', 'https://generativelanguage.googleapis.com/v1beta/models',
             'headers', pg_catalog.jsonb_build_object('x-goog-api-key', p_key))
           -- OpenRouter's cheapest authenticated call: the key's own info.
           WHEN 'OPENROUTER' THEN pg_catalog.jsonb_build_object(
             'url', 'https://openrouter.ai/api/v1/key',
             'headers', pg_catalog.jsonb_build_object('Authorization', 'Bearer ' || p_key))
           -- The stored, shape-checked endpoint; never a caller string at probe time.
           WHEN 'OTHER' THEN pg_catalog.jsonb_build_object(
             'url', pg_catalog.rtrim(p_base_url, '/') || '/models',
             'headers', pg_catalog.jsonb_build_object('Authorization', 'Bearer ' || p_key))
         END;
$fn$;

-- R4. Queue a probe for a key already stored, and audit the use as PROBE.
CREATE OR REPLACE FUNCTION app.provider_key_fire_probe(
  p_row   core.ai_provider_keys,
  p_key   text,
  p_actor jsonb,
  p_via   text
)
RETURNS app.provider_key_probes
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_request jsonb := app.provider_key_probe_request(p_row.provider::text, p_key, p_row.base_url);
  v_net_id  bigint;
  v_probe   app.provider_key_probes;
BEGIN
  v_net_id := net.http_get(v_request ->> 'url', '{}'::jsonb, v_request -> 'headers', 5000);
  v_request := NULL;

  INSERT INTO app.provider_key_probes (tenant_id, provider_key_id, net_request_id, requested_by)
  VALUES (p_row.tenant_id, p_row.id, v_net_id, p_actor)
  RETURNING * INTO v_probe;

  PERFORM app.record_key_access(
    p_row.tenant_id, p_row.provider_ref, 'PROBE', p_actor, p_via,
    v_net_id::text, NULL, app.aal(), NULL);

  RETURN v_probe;
END;
$fn$;

-- R4. The probe's state as the adapter reads it.
CREATE OR REPLACE FUNCTION app.provider_key_probe_json(
  p_probe app.provider_key_probes,
  p_row   core.ai_provider_keys
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
           'state',        CASE WHEN p_probe.outcome = 'PENDING' THEN 'PENDING' ELSE 'DONE' END,
           'outcome',      p_probe.outcome,
           'status',       p_row.status::text,
           'lastTestedAt', COALESCE(p_row.last_tested_at, p_probe.requested_at),
           'requestedAt',  p_probe.requested_at)
      || CASE p_probe.outcome
           WHEN 'INVALID_KEY' THEN pg_catalog.jsonb_build_object('message',
             pg_catalog.format('The key was rejected by %s.', p_row.provider::text))
           WHEN 'RATE_LIMITED' THEN pg_catalog.jsonb_build_object('message',
             pg_catalog.format('%s rate-limited the test. The key status is unchanged; try again shortly.', p_row.provider::text))
           WHEN 'NETWORK_ERROR' THEN pg_catalog.jsonb_build_object('message',
             pg_catalog.format('%s could not be reached. The key status is unchanged.', p_row.provider::text))
           WHEN 'PROVIDER_ERROR' THEN pg_catalog.jsonb_build_object('message',
             pg_catalog.format('%s answered HTTP %s. The key status is unchanged.',
                               p_row.provider::text, p_probe.http_status))
           ELSE '{}'::jsonb
         END;
$fn$;

-- The tier-key vocabulary, written out from packages/contract/src/enums.ts:534
-- (TIER_KEYS). No 003 enum exists for it and core.tier_keys is not seeded.
CREATE OR REPLACE FUNCTION app.provider_key_tier_is_known(p_tier text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT p_tier IN ('FAST','FAST_UI','MID','CHEAP','STRONG_1','STRONG_2','STRONG_3',
                    'DEEP_THINK','SPECIAL');
$fn$;

-- Validation shared by create (full body) and rotate (key only). Raises a
-- VALIDATION_FAILED with every failing field, or returns nothing.
CREATE OR REPLACE FUNCTION app.provider_key_validate(
  p_tenant_id     uuid,
  p_provider      text,
  p_key           text,
  p_label         text    DEFAULT NULL,
  p_scope_tiers   jsonb   DEFAULT NULL,
  p_billing_owner text    DEFAULT NULL,
  p_region        text    DEFAULT NULL,
  p_cap           jsonb   DEFAULT NULL,
  p_rotation_date text    DEFAULT NULL,
  p_full          boolean DEFAULT true,
  p_except_id     uuid    DEFAULT NULL,
  p_base_url      text    DEFAULT NULL
)
RETURNS bytea
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_fields      jsonb := '[]'::jsonb;
  v_reason      text;
  v_fingerprint bytea;
  v_existing    text;
BEGIN
  IF p_full THEN
    IF p_provider IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_enum AS label
       WHERE label.enumtypid = 'core.ai_provider'::pg_catalog.regtype
         AND label.enumlabel = p_provider) THEN
      v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'provider', 'reason', 'INVALID'));
    END IF;

    -- R5c. OTHER needs an https endpoint on a DNS name; nothing else takes one.
    IF p_provider = 'OTHER' AND p_base_url IS NULL THEN
      v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'baseUrl', 'reason', 'BASE_URL_REQUIRED'));
    ELSIF p_provider = 'OTHER' AND NOT (
            pg_catalog.length(p_base_url) <= 200
            AND p_base_url ~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'
            AND pg_catalog.lower(pg_catalog.substring(p_base_url, '^https://([^/:]+)'))
                !~ '(^localhost$|^[0-9.]+$|\.local$|\.internal$|\.localhost$)') THEN
      v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'baseUrl', 'reason', 'BASE_URL_NOT_ALLOWED'));
    ELSIF p_provider IS DISTINCT FROM 'OTHER' AND p_base_url IS NOT NULL THEN
      v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'baseUrl', 'reason', 'BASE_URL_NOT_SUPPORTED'));
    END IF;

    IF NULLIF(pg_catalog.btrim(COALESCE(p_label, '')), '') IS NULL
       OR pg_catalog.length(p_label) > 120 THEN
      v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'label', 'reason', 'REQUIRED_MAX_120'));
    END IF;

    IF p_scope_tiers IS NULL OR pg_catalog.jsonb_typeof(p_scope_tiers) <> 'array'
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_array_elements(p_scope_tiers) AS tier(value)
          WHERE pg_catalog.jsonb_typeof(tier.value) <> 'string'
             OR NOT app.provider_key_tier_is_known(tier.value #>> '{}')) THEN
      v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'scopeTiers', 'reason', 'INVALID_TIER'));
    END IF;

    IF p_billing_owner IS NULL OR p_billing_owner NOT IN ('CLIENT_ACCOUNT', 'PASS_THROUGH') THEN
      v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'billingOwner', 'reason', 'INVALID'));
    END IF;

    IF NULLIF(pg_catalog.btrim(COALESCE(p_region, '')), '') IS NULL
       OR pg_catalog.length(p_region) > 64 THEN
      v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'region', 'reason', 'REQUIRED_MAX_64'));
    END IF;

    IF p_cap IS NOT NULL AND pg_catalog.jsonb_typeof(p_cap) <> 'null' AND NOT (
         pg_catalog.jsonb_typeof(p_cap) = 'object'
         AND pg_catalog.jsonb_typeof(p_cap -> 'amount') = 'number'
         AND (p_cap ->> 'amount') ~ '^[0-9]{1,15}$'
         -- core.currency_code is a char(3) domain CHECKed ^[A-Z]{3}$ (003).
         AND COALESCE(p_cap ->> 'currency', '') ~ '^[A-Z]{3}$') THEN
      v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'cap', 'reason', 'INVALID_MONEY'));
    END IF;

    IF p_rotation_date IS NOT NULL THEN
      BEGIN
        IF p_rotation_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           OR pg_catalog.to_char(p_rotation_date::date, 'YYYY-MM-DD') <> p_rotation_date THEN
          RAISE EXCEPTION USING ERRCODE = 'invalid_datetime_format';
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'field', 'rotationDate', 'reason', 'INVALID_DATE'));
      END;
    END IF;
  END IF;

  v_reason := app.provider_key_shape_reason(p_provider, p_key);
  IF v_reason IS NOT NULL THEN
    v_fields := v_fields || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'field', 'key', 'reason', v_reason));
  END IF;

  IF pg_catalog.jsonb_array_length(v_fields) > 0 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'VALIDATION_FAILED', 'fields', v_fields)::text;
  END IF;

  v_fingerprint := app.provider_key_fingerprint(p_tenant_id, p_key);

  SELECT existing.provider_ref INTO v_existing
    FROM core.ai_provider_keys AS existing
   WHERE existing.tenant_id = p_tenant_id
     AND existing.key_fingerprint = v_fingerprint
     AND existing.id IS DISTINCT FROM p_except_id;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'VALIDATION_FAILED',
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field', 'key', 'reason', 'DUPLICATE', 'code', 'KEY_ALREADY_ADDED')),
        'existingId', v_existing)::text;
  END IF;

  RETURN v_fingerprint;
END;
$fn$;

-- Destroy a Vault secret. Idempotent.
CREATE OR REPLACE FUNCTION app.provider_key_destroy_secret(p_key_ref text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF p_key_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    DELETE FROM vault.secrets AS secret WHERE secret.id = p_key_ref::uuid;
  END IF;
END;
$fn$;

-- The sanitized re-raise every key-holding path ends in. Never SQLERRM, never
-- DETAIL: see R2.
CREATE OR REPLACE FUNCTION app.provider_key_opaque_error(p_sqlstate text, p_operation text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION '% failed (SQLSTATE %); details withheld because the request carried key material',
    p_operation, p_sqlstate
    USING ERRCODE = p_sqlstate;
END;
$fn$;

-- ═══ 3 · The client RPCs ═══════════════════════════════════════════════════

-- §17 POST /v1/ai/providers. ADMIN (ai:provider:write, 002:1139).
CREATE OR REPLACE FUNCTION core.create_provider(
  p_provider      text,
  p_label         text,
  p_key           text,
  p_scope_tiers   jsonb,
  p_billing_owner text,
  p_region        text,
  p_cap           jsonb DEFAULT NULL,
  p_rotation_date text  DEFAULT NULL,
  p_base_url      text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
SET lock_timeout = '2s'
AS $fn$
DECLARE
  v_tenant      uuid := app.require_tenant_id();
  v_id          uuid := pg_catalog.gen_random_uuid();
  v_actor       jsonb;
  v_fingerprint bytea;
  v_secret      uuid;
  v_ref         text;
  v_row         core.ai_provider_keys;
BEGIN
  IF NOT app.has_permission('ai:provider:write') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'FORBIDDEN', 'requiredPermission', 'ai:provider:write')::text;
  END IF;
  IF app.is_agent() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'FORBIDDEN', 'reason', 'AGENT')::text;
  END IF;

  BEGIN
    v_fingerprint := app.provider_key_validate(
      v_tenant, p_provider, p_key, p_label, p_scope_tiers, p_billing_owner,
      p_region, p_cap, p_rotation_date, p_base_url => p_base_url);

    v_actor := app.provider_key_actor(v_tenant);
    v_ref := 'prv_' || pg_catalog.lower(p_provider) || '_'
          || pg_catalog."left"(pg_catalog.replace(v_id::text, '-', ''), 12);

    v_secret := vault.create_secret(
      p_key,
      pg_catalog.format('trainos/byok/%s/%s', v_tenant, v_id),
      pg_catalog.format('TrainOS BYOK %s provider key %s', p_provider, v_ref));

    INSERT INTO core.ai_provider_keys
      (id, tenant_id, provider_ref, provider, label, status, masked_key, key_fingerprint,
       key_ref, scope_tiers, cap_sen, currency, rotation_date, billing_owner, region, added_by,
       base_url)
    SELECT v_id, v_tenant, v_ref, p_provider::core.ai_provider, pg_catalog.btrim(p_label),
           'NOT_SET', app.mask_key(p_key), v_fingerprint, v_secret::text,
           ARRAY(SELECT tier.value FROM pg_catalog.jsonb_array_elements_text(p_scope_tiers) AS tier(value)),
           CASE WHEN pg_catalog.jsonb_typeof(p_cap) = 'object' THEN (p_cap ->> 'amount')::bigint END,
           COALESCE((CASE WHEN pg_catalog.jsonb_typeof(p_cap) = 'object' THEN p_cap ->> 'currency' END),
                    'MYR')::core.currency_code,
           p_rotation_date::date, p_billing_owner::core.billing_owner, pg_catalog.btrim(p_region),
           v_actor, p_base_url
    RETURNING * INTO v_row;

    PERFORM app.provider_key_fire_probe(v_row, p_key, v_actor, 'sql:core.create_provider');

    PERFORM app.emit_event(
      p_tenant_id      => v_tenant,
      p_type           => 'ProviderKeyAdded',
      p_aggregate_type => 'PROVIDER_KEY',
      p_aggregate_id   => v_row.id,
      p_aggregate_ref  => v_row.provider_ref,
      p_payload        => pg_catalog.jsonb_build_object(
                            'providerId', v_row.provider_ref, 'provider', v_row.provider::text),
      p_summary        => pg_catalog.format('%s provider key added', v_row.provider_ref),
      p_actor          => v_actor);
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE = 'TRNOS' THEN
        RAISE;
      ELSIF SQLSTATE = '23505' THEN
        -- A concurrent create of the same key lost the fingerprint race.
        RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'TRNOS',
          DETAIL = pg_catalog.jsonb_build_object(
            'code', 'VALIDATION_FAILED',
            'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'field', 'key', 'reason', 'DUPLICATE', 'code', 'KEY_ALREADY_ADDED')))::text;
      END IF;
      PERFORM app.provider_key_opaque_error(SQLSTATE, 'create_provider');
  END;

  RETURN app.ok(app.provider_key_json(v_row));
END;
$fn$;

COMMENT ON FUNCTION core.create_provider(text,text,text,jsonb,text,text,jsonb,text,text) IS
  '029. POST /v1/ai/providers. The raw key goes to vault.create_secret and nowhere '
  'else; the row gets the Vault id, app.mask_key and a salted HMAC fingerprint. '
  'Returns the masked ProviderKey and queues a probe (see get_provider_test_result).';

-- §17 POST /v1/ai/providers/{id}/test — fire. ADMIN (ai:provider:test, 002:1138).
CREATE OR REPLACE FUNCTION core.test_provider(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
SET lock_timeout = '2s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.ai_provider_keys;
  v_probe  app.provider_key_probes;
  v_key    text;
BEGIN
  IF NOT app.has_permission('ai:provider:test') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'FORBIDDEN', 'requiredPermission', 'ai:provider:test')::text;
  END IF;
  IF app.is_agent() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'FORBIDDEN', 'reason', 'AGENT')::text;
  END IF;

  SELECT * INTO v_row
    FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.provider_ref = p_id
     AND provider_key.key_ref NOT LIKE 'retired:%'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'NOT_FOUND', 'id', p_id)::text;
  END IF;

  -- One probe in flight per key. A second click inside 30 seconds reads the
  -- first rather than queueing another request to the provider.
  SELECT * INTO v_probe
    FROM app.provider_key_probes AS probe
   WHERE probe.tenant_id = v_tenant
     AND probe.provider_key_id = v_row.id
     AND probe.outcome = 'PENDING'
     AND probe.requested_at > pg_catalog.now() - interval '30 seconds'
   ORDER BY probe.net_request_id DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN app.ok(app.provider_key_probe_json(v_probe, v_row));
  END IF;

  BEGIN
    SELECT secret.decrypted_secret INTO v_key
      FROM vault.decrypted_secrets AS secret
     WHERE secret.id = v_row.key_ref::uuid;
    IF v_key IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'TRNOS',
        DETAIL = pg_catalog.jsonb_build_object(
          'code', 'NOT_FOUND', 'id', p_id, 'reason', 'KEY_MATERIAL_MISSING')::text;
    END IF;

    v_probe := app.provider_key_fire_probe(
      v_row, v_key, app.provider_key_actor(v_tenant), 'sql:core.test_provider');
    v_key := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE = 'TRNOS' THEN
        RAISE;
      END IF;
      PERFORM app.provider_key_opaque_error(SQLSTATE, 'test_provider');
  END;

  RETURN app.ok(app.provider_key_probe_json(v_probe, v_row));
END;
$fn$;

COMMENT ON FUNCTION core.test_provider(text) IS
  '029. POST /v1/ai/providers/{id}/test, first half: queues a pg_net GET to the '
  'provider''s models endpoint and returns {state: PENDING}. The adapter polls '
  'core.get_provider_test_result for the verdict.';

-- §17 POST /v1/ai/providers/{id}/test — collect.
CREATE OR REPLACE FUNCTION core.get_provider_test_result(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.ai_provider_keys;
  v_probe    app.provider_key_probes;
  v_status   integer;
  v_timedout boolean;
  v_error    text;
  v_found    boolean;
  v_outcome  text;
BEGIN
  IF NOT app.has_permission('ai:provider:test') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'FORBIDDEN', 'requiredPermission', 'ai:provider:test')::text;
  END IF;
  IF app.is_agent() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'FORBIDDEN', 'reason', 'AGENT')::text;
  END IF;

  SELECT * INTO v_row
    FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.provider_ref = p_id
     AND provider_key.key_ref NOT LIKE 'retired:%'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'NOT_FOUND', 'id', p_id)::text;
  END IF;

  SELECT * INTO v_probe
    FROM app.provider_key_probes AS probe
   WHERE probe.tenant_id = v_tenant
     AND probe.provider_key_id = v_row.id
   ORDER BY probe.net_request_id DESC
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'NOT_FOUND', 'id', p_id, 'reason', 'NO_PROBE')::text;
  END IF;

  IF v_probe.outcome <> 'PENDING' THEN
    RETURN app.ok(app.provider_key_probe_json(v_probe, v_row));
  END IF;

  -- status_code, timed_out and error_msg ONLY. `content` and `headers` are never
  -- selected: a provider's error body is not ours to keep.
  SELECT response.status_code, COALESCE(response.timed_out, false), response.error_msg, true
    INTO v_status, v_timedout, v_error, v_found
    FROM net._http_response AS response
   WHERE response.id = v_probe.net_request_id;

  IF NOT COALESCE(v_found, false) THEN
    IF v_probe.requested_at > pg_catalog.now() - interval '60 seconds' THEN
      RETURN app.ok(app.provider_key_probe_json(v_probe, v_row));
    END IF;
    v_outcome := 'NETWORK_ERROR';
  ELSIF v_timedout OR v_status IS NULL OR v_error IS NOT NULL THEN
    v_outcome := 'NETWORK_ERROR';
  ELSIF v_status BETWEEN 200 AND 299 THEN
    v_outcome := 'OK';
  ELSIF v_status IN (401, 403) OR (v_row.provider = 'GOOGLE' AND v_status = 400) THEN
    v_outcome := 'INVALID_KEY';
  ELSIF v_status = 429 THEN
    v_outcome := 'RATE_LIMITED';
  ELSE
    v_outcome := 'PROVIDER_ERROR';
  END IF;

  UPDATE app.provider_key_probes AS probe
     SET outcome = v_outcome, http_status = v_status, completed_at = pg_catalog.now()
   WHERE probe.id = v_probe.id
  RETURNING * INTO v_probe;

  -- 013's _test semantics (013:2436): status, last_tested_at, invalid_since.
  UPDATE core.ai_provider_keys AS provider_key
     SET status         = CASE v_outcome
                            WHEN 'OK' THEN 'VALID'::core.provider_key_status
                            WHEN 'INVALID_KEY' THEN 'INVALID'::core.provider_key_status
                            ELSE provider_key.status
                          END,
         last_tested_at = pg_catalog.now(),
         invalid_since  = CASE v_outcome
                            WHEN 'OK' THEN NULL
                            WHEN 'INVALID_KEY' THEN COALESCE(provider_key.invalid_since, pg_catalog.now())
                            ELSE provider_key.invalid_since
                          END
   WHERE provider_key.id = v_row.id
  RETURNING * INTO v_row;

  IF COALESCE(v_found, false) THEN
    DELETE FROM net._http_response AS response WHERE response.id = v_probe.net_request_id;
  END IF;

  RETURN app.ok(app.provider_key_probe_json(v_probe, v_row));
END;
$fn$;

COMMENT ON FUNCTION core.get_provider_test_result(text) IS
  '029. Second half of the provider test: classifies net._http_response by status '
  'code only, writes the verdict with 013 _test semantics, deletes the response row.';

-- §17 POST /v1/ai/providers/{id}/rotate. ADMIN (ai:provider:rotate) at aal2,
-- the claim check 013's _rotate used.
CREATE OR REPLACE FUNCTION core.rotate_provider(p_id text, p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
SET lock_timeout = '2s'
AS $fn$
DECLARE
  v_tenant      uuid := app.require_tenant_id();
  v_row         core.ai_provider_keys;
  v_old_ref     text;
  v_actor       jsonb;
  v_fingerprint bytea;
  v_secret      uuid;
BEGIN
  IF NOT app.has_permission('ai:provider:rotate') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'FORBIDDEN', 'requiredPermission', 'ai:provider:rotate')::text;
  END IF;
  IF app.is_agent() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'FORBIDDEN', 'reason', 'AGENT')::text;
  END IF;
  IF app.aal() <> 'aal2' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'FORBIDDEN', 'reason', 'AAL2_REQUIRED')::text;
  END IF;

  SELECT * INTO v_row
    FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.provider_ref = p_id
     AND provider_key.key_ref NOT LIKE 'retired:%'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'NOT_FOUND', 'id', p_id)::text;
  END IF;

  BEGIN
    v_fingerprint := app.provider_key_validate(
      v_tenant, v_row.provider::text, p_key, p_full => false, p_except_id => v_row.id);
    v_actor := app.provider_key_actor(v_tenant);
    v_old_ref := v_row.key_ref;

    PERFORM app.record_key_access(
      v_tenant, v_row.provider_ref, 'ROTATE', v_actor, 'sql:core.rotate_provider',
      NULL, NULL, app.aal(), NULL);

    -- Old material first, so the deterministic name is free and the old key is
    -- gone the moment this commits.
    PERFORM app.provider_key_destroy_secret(v_old_ref);
    v_secret := vault.create_secret(
      p_key,
      pg_catalog.format('trainos/byok/%s/%s', v_tenant, v_row.id),
      pg_catalog.format('TrainOS BYOK %s provider key %s', v_row.provider::text, v_row.provider_ref));

    UPDATE core.ai_provider_keys AS provider_key
       SET masked_key           = app.mask_key(p_key),
           key_fingerprint      = v_fingerprint,
           key_ref              = v_secret::text,
           status               = 'NOT_SET',
           last_tested_at       = NULL,
           invalid_since        = NULL,
           active_fallback_tier = NULL,
           last_revealed_at     = NULL
     WHERE provider_key.id = v_row.id
    RETURNING * INTO v_row;

    PERFORM app.provider_key_fire_probe(v_row, p_key, v_actor, 'sql:core.rotate_provider');

    PERFORM app.emit_event(
      p_tenant_id      => v_tenant,
      p_type           => 'ProviderKeyRotated',
      p_aggregate_type => 'PROVIDER_KEY',
      p_aggregate_id   => v_row.id,
      p_aggregate_ref  => v_row.provider_ref,
      p_payload        => pg_catalog.jsonb_build_object('providerId', v_row.provider_ref),
      p_summary        => pg_catalog.format('%s provider key rotated', v_row.provider_ref),
      p_actor          => v_actor);
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE = 'TRNOS' THEN
        RAISE;
      END IF;
      PERFORM app.provider_key_opaque_error(SQLSTATE, 'rotate_provider');
  END;

  RETURN app.ok(app.provider_key_json(v_row));
END;
$fn$;

COMMENT ON FUNCTION core.rotate_provider(text,text) IS
  '029. POST /v1/ai/providers/{id}/rotate. Old Vault secret deleted in the same '
  'transaction; ROTATE audited with the old key_ref before the row moves.';

-- §17 POST /v1/ai/providers/{id}/reveal. ADMIN (ai:provider:reveal) + AAL2
-- verified + audit first + rate limits. The only client path to plaintext.
CREATE OR REPLACE FUNCTION core.reveal_provider(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
SET lock_timeout = '2s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_row     core.ai_provider_keys;
  v_actor   jsonb;
  v_recent  integer;
  v_audit   uuid;
  v_bumped  uuid;
  v_key     text;
  v_at      timestamptz := pg_catalog.now();
BEGIN
  IF NOT app.has_permission('ai:provider:reveal') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'FORBIDDEN', 'requiredPermission', 'ai:provider:reveal')::text;
  END IF;
  IF app.is_agent() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'FORBIDDEN', 'reason', 'AGENT')::text;
  END IF;
  IF NOT app.aal2_verified() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'FORBIDDEN', 'reason', 'AAL2_REQUIRED')::text;
  END IF;

  SELECT * INTO v_row
    FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.provider_ref = p_id
     AND provider_key.key_ref NOT LIKE 'retired:%';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'NOT_FOUND', 'id', p_id)::text;
  END IF;

  v_actor := app.provider_key_actor(v_tenant);

  -- Per actor: 3 per rolling hour. Serialised per (tenant, actor) so the count
  -- and the audit insert below are one critical section.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'trainos:byok:reveal:' || v_tenant::text || ':' || (v_actor ->> 'id'), 0));
  SELECT pg_catalog.count(*)::integer INTO v_recent
    FROM app.key_access_audit AS audit
   WHERE audit.tenant_id = v_tenant
     AND audit.purpose = 'REVEAL'
     AND audit.actor ->> 'id' = v_actor ->> 'id'
     AND audit.decrypted_at > v_at - interval '1 hour';
  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'FORBIDDEN', 'reason', 'REVEAL_RATE_LIMITED',
        'limit', 3, 'window', 'PT1H')::text;
  END IF;

  -- Per key: 013's M-10(3) ceiling, read first for the right error and enforced
  -- again as the predicate of the bump.
  IF v_row.last_revealed_at IS NOT NULL
     AND v_row.last_revealed_at > v_at - interval '24 hours' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'FORBIDDEN', 'reason', 'REVEAL_RATE_LIMITED',
        'limit', 1, 'window', 'PT24H', 'lastRevealedAt', v_row.last_revealed_at)::text;
  END IF;

  v_audit := app.record_key_access(
    v_tenant, v_row.provider_ref, 'REVEAL', v_actor, 'sql:core.reveal_provider',
    NULL, NULL, 'aal2', 'Revealed once from Settings > AI > Providers (M20-S21)');

  PERFORM pg_catalog.set_config('app.key_reveal_audit', v_audit::text, true);

  UPDATE core.ai_provider_keys AS provider_key
     SET last_revealed_at = v_at,
         reveal_count     = provider_key.reveal_count + 1
   WHERE provider_key.id = v_row.id
     AND (provider_key.last_revealed_at IS NULL
          OR provider_key.last_revealed_at <= v_at - interval '24 hours')
  RETURNING provider_key.id INTO v_bumped;

  PERFORM pg_catalog.set_config('app.key_reveal_audit', '', true);

  IF v_bumped IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'FORBIDDEN', 'reason', 'REVEAL_RATE_LIMITED',
        'limit', 1, 'window', 'PT24H')::text;
  END IF;

  BEGIN
    SELECT secret.decrypted_secret INTO v_key
      FROM vault.decrypted_secrets AS secret
     WHERE secret.id = v_row.key_ref::uuid;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM app.provider_key_opaque_error(SQLSTATE, 'reveal_provider');
  END;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'NOT_FOUND', 'id', p_id, 'reason', 'KEY_MATERIAL_MISSING')::text;
  END IF;

  PERFORM app.emit_event(
    p_tenant_id      => v_tenant,
    p_type           => 'ProviderKeyRevealed',
    p_aggregate_type => 'PROVIDER_KEY',
    p_aggregate_id   => v_row.id,
    p_aggregate_ref  => v_row.provider_ref,
    p_payload        => pg_catalog.jsonb_build_object(
                          'providerId', v_row.provider_ref, 'auditId', v_audit, 'aal', 'aal2'),
    p_summary        => pg_catalog.format('%s provider key revealed', v_row.provider_ref),
    p_actor          => v_actor);

  RETURN app.ok(pg_catalog.jsonb_build_object('key', v_key, 'revealedAt', v_at));
END;
$fn$;

COMMENT ON FUNCTION core.reveal_provider(text) IS
  '029. POST /v1/ai/providers/{id}/reveal. ADMIN + app.aal2_verified(); REVEAL '
  'audit row before the 013 reveal trigger lets last_revealed_at move; 3 per actor '
  'per hour and 1 per key per 24h; the only client-callable reader of '
  'vault.decrypted_secrets.';

-- §17 DELETE /v1/ai/providers/{id}. ADMIN (ai:provider:delete) at aal2 claim.
CREATE OR REPLACE FUNCTION core.delete_provider(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant    uuid := app.require_tenant_id();
  v_row       core.ai_provider_keys;
  v_actor     jsonb;
  v_orphaned  text[];
  v_tombstone boolean;
BEGIN
  IF NOT app.has_permission('ai:provider:delete') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'FORBIDDEN', 'requiredPermission', 'ai:provider:delete')::text;
  END IF;
  IF app.is_agent() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'FORBIDDEN', 'reason', 'AGENT')::text;
  END IF;
  IF app.aal() <> 'aal2' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'FORBIDDEN', 'reason', 'AAL2_REQUIRED')::text;
  END IF;

  SELECT * INTO v_row
    FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.provider_ref = p_id
     AND provider_key.key_ref NOT LIKE 'retired:%'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code', 'NOT_FOUND', 'id', p_id)::text;
  END IF;

  -- §17 409, the fixture's rule (FixtureClient.ts:1952): a tier this key scopes
  -- that no OTHER live key scopes.
  SELECT pg_catalog.array_agg(tier.value ORDER BY tier.value) INTO v_orphaned
    FROM pg_catalog.unnest(v_row.scope_tiers) AS tier(value)
   WHERE NOT EXISTS (
     SELECT 1 FROM core.ai_provider_keys AS survivor
      WHERE survivor.tenant_id = v_tenant
        AND survivor.id <> v_row.id
        AND survivor.key_ref NOT LIKE 'retired:%'
        AND tier.value = ANY (survivor.scope_tiers));
  IF v_orphaned IS NOT NULL THEN
    RAISE EXCEPTION 'AGENT_PAUSED' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object(
        'code', 'AGENT_PAUSED', 'blockers', pg_catalog.to_jsonb(v_orphaned))::text;
  END IF;

  v_actor := app.provider_key_actor(v_tenant);
  PERFORM app.provider_key_destroy_secret(v_row.key_ref);

  v_tombstone := EXISTS (
    SELECT 1 FROM app.key_access_audit AS audit
     WHERE audit.tenant_id = v_tenant AND audit.provider_key_id = v_row.id);

  IF v_tombstone THEN
    UPDATE core.ai_provider_keys AS provider_key
       SET key_ref              = 'retired:' || provider_key.id::text,
           key_fingerprint      = pg_catalog.sha256(pg_catalog.convert_to(
                                    'retired:' || provider_key.id::text, 'UTF8')),
           status               = 'INVALID',
           invalid_since        = COALESCE(provider_key.invalid_since, pg_catalog.now()),
           scope_tiers          = ARRAY[]::text[],
           active_fallback_tier = NULL
     WHERE provider_key.id = v_row.id;
  ELSE
    DELETE FROM core.ai_provider_keys AS provider_key WHERE provider_key.id = v_row.id;
  END IF;

  PERFORM app.emit_event(
    p_tenant_id      => v_tenant,
    p_type           => 'ProviderKeyDeleted',
    p_aggregate_type => 'PROVIDER_KEY',
    p_aggregate_id   => v_row.id,
    p_aggregate_ref  => v_row.provider_ref,
    p_payload        => pg_catalog.jsonb_build_object(
                          'providerId', v_row.provider_ref, 'tombstoned', v_tombstone),
    p_summary        => pg_catalog.format('%s provider key deleted', v_row.provider_ref),
    p_actor          => v_actor);

  RETURN app.ok(pg_catalog.jsonb_build_object('id', v_row.provider_ref, 'deleted', true));
END;
$fn$;

COMMENT ON FUNCTION core.delete_provider(text) IS
  '029. DELETE /v1/ai/providers/{id}. AGENT_PAUSED {blockers} when a tier would be '
  'left keyless. Vault secret destroyed; row hard-deleted, or tombstoned '
  '(key_ref retired:<id>) when 013''s RESTRICT audit FK keeps it.';

-- ═══ 4 · The worker accessor (service_role only) ═══════════════════════════
--
-- apps/worker/src/keys.ts:19,50,80 — `SELECT provider, api_key, base_url, label
-- FROM app.provider_key_for_tenant($1, $2)`, NULL provider meaning every key.
CREATE OR REPLACE FUNCTION app.provider_key_for_tenant(p_tenant_id uuid, p_provider text)
RETURNS TABLE (provider text, api_key text, base_url text, label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
SET lock_timeout = '2s'
AS $fn$
DECLARE
  v_key record;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'provider_key_for_tenant: tenant is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_key IN
    SELECT DISTINCT ON (runtime.id)
           provider_key.provider_ref, provider_key.key_ref, provider_key.label,
           runtime.id AS runtime_id, runtime.base_url
      FROM core.ai_provider_keys AS provider_key
      CROSS JOIN LATERAL (
        SELECT CASE provider_key.provider::text
                 WHEN 'ANTHROPIC' THEN 'anthropic'
                 WHEN 'DEEPSEEK'  THEN 'deepseek'
                 WHEN 'OPENAI'    THEN 'openai-compatible'
                 WHEN 'GOOGLE'    THEN 'google'
                 WHEN 'OPENROUTER' THEN 'openrouter'
                 WHEN 'OTHER'     THEN 'openai-compatible'
               END AS id,
               CASE provider_key.provider::text
                 WHEN 'OPENAI' THEN 'https://api.openai.com/v1'
                 WHEN 'OTHER'  THEN provider_key.base_url
               END AS base_url) AS runtime
     WHERE provider_key.tenant_id = p_tenant_id
       AND provider_key.key_ref NOT LIKE 'retired:%'
       AND provider_key.status <> 'INVALID'
       AND (p_provider IS NULL
            OR pg_catalog.lower(p_provider) = runtime.id
            OR pg_catalog.upper(p_provider) = provider_key.provider::text)
     ORDER BY runtime.id,
              (provider_key.status = 'VALID') DESC,
              provider_key.added_at DESC
  LOOP
    BEGIN
      SELECT secret.decrypted_secret INTO api_key
        FROM vault.decrypted_secrets AS secret
       WHERE secret.id = v_key.key_ref::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        PERFORM app.provider_key_opaque_error(SQLSTATE, 'provider_key_for_tenant');
    END;
    CONTINUE WHEN api_key IS NULL;

    PERFORM app.record_key_access(
      p_tenant_id, v_key.provider_ref, 'RUN_CALL',
      pg_catalog.jsonb_build_object('kind', 'SYSTEM', 'id', 'worker', 'name', NULL),
      'sql:app.provider_key_for_tenant');

    provider := v_key.runtime_id;
    base_url := v_key.base_url;
    label    := v_key.label;
    RETURN NEXT;
  END LOOP;
  api_key := NULL;
END;
$fn$;

COMMENT ON FUNCTION app.provider_key_for_tenant(uuid, text) IS
  '029 R5b. The worker''s BYOK read (apps/worker/src/keys.ts). service_role ONLY. '
  'One live key per runtime provider (VALID first, newest), decrypted from Vault, '
  'one app.key_access_audit RUN_CALL row per key returned.';

-- ═══ 5 · Privilege boundary ════════════════════════════════════════════════
DO $revoke$
DECLARE v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT procedure.oid::regprocedure
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE
        -- 013's Edge-Function-era entry points, superseded (header). Already
        -- revoked by 013:3114; repeated so this file's $verify$ owns the fact.
        -- Dynamic because they are 013's signatures, not this file's.
        (namespace.nspname = 'public' AND procedure.proname = ANY (ARRAY[
             'ai_provider_key_set','ai_provider_key_test','ai_provider_key_rotate',
             'ai_provider_key_delete','ai_provider_key_reveal']))
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_function);
  END LOOP;
END
$revoke$;

-- Every function this file creates, revoked per function by literal signature
-- (scripts/check-grants.mjs rule M2 reads these statically; $verify$ V4 below
-- measures the resulting matrix at runtime).
REVOKE ALL ON FUNCTION core.create_provider(text,text,text,jsonb,text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION core.test_provider(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION core.get_provider_test_result(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION core.rotate_provider(text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION core.reveal_provider(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION core.delete_provider(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_actor(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_json(core.ai_provider_keys) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_shape_reason(text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_fingerprint(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_probe_request(text,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_fire_probe(core.ai_provider_keys,text,jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_probe_json(app.provider_key_probes,core.ai_provider_keys) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_tier_is_known(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_validate(uuid,text,text,text,jsonb,text,text,jsonb,text,boolean,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_destroy_secret(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_opaque_error(text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.provider_key_for_tenant(uuid,text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION core.create_provider(text,text,text,jsonb,text,text,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.test_provider(text)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_provider_test_result(text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION core.rotate_provider(text,text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION core.reveal_provider(text)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION core.delete_provider(text)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION app.provider_key_for_tenant(uuid,text)                       TO service_role;

REVOKE ALL ON TABLE app.provider_key_salts, app.provider_key_probes
  FROM PUBLIC, anon, authenticated, service_role;

-- ═══ 6 · Structural verification ═══════════════════════════════════════════
DO $verify$
DECLARE
  v_core     text[] := ARRAY['create_provider','test_provider','get_provider_test_result',
                             'rotate_provider','reveal_provider','delete_provider'];
  v_app      text[] := ARRAY['provider_key_actor','provider_key_json','provider_key_shape_reason',
                             'provider_key_fingerprint','provider_key_probe_request',
                             'provider_key_fire_probe','provider_key_probe_json',
                             'provider_key_tier_is_known','provider_key_validate',
                             'provider_key_destroy_secret','provider_key_opaque_error',
                             'provider_key_for_tenant'];
  v_public   text[] := ARRAY['ai_provider_key_set','ai_provider_key_test','ai_provider_key_rotate',
                             'ai_provider_key_delete','ai_provider_key_reveal'];
  v_count    integer;
  v_offender text;
BEGIN
  -- V1 inventory, one overload each.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE (namespace.nspname = 'core' AND procedure.proname = ANY (v_core))
      OR (namespace.nspname = 'app' AND procedure.proname = ANY (v_app));
  IF v_count <> 18 THEN
    RAISE EXCEPTION '029 verify V1: expected 18 functions (one overload each), found %', v_count;
  END IF;

  -- V2 search_path="" exactly, on all 18.
  SELECT pg_catalog.string_agg(procedure.oid::regprocedure::text, ', ') INTO v_offender
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE ((namespace.nspname = 'core' AND procedure.proname = ANY (v_core))
       OR (namespace.nspname = 'app' AND procedure.proname = ANY (v_app)))
     AND NOT ('search_path=""' = ANY (COALESCE(procedure.proconfig, ARRAY[]::text[])));
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION '029 verify V2: not pinned to search_path="": %', v_offender;
  END IF;

  -- V3 the seven entry points are SECURITY DEFINER; the eleven helpers are not.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE procedure.prosecdef
     AND ((namespace.nspname = 'core' AND procedure.proname = ANY (v_core))
       OR (namespace.nspname = 'app' AND procedure.proname = 'provider_key_for_tenant'));
  IF v_count <> 7 THEN
    RAISE EXCEPTION '029 verify V3: expected 7 SECURITY DEFINER entry points, found %', v_count;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE procedure.prosecdef AND namespace.nspname = 'app'
     AND procedure.proname = ANY (v_app) AND procedure.proname <> 'provider_key_for_tenant';
  IF v_count <> 0 THEN
    RAISE EXCEPTION '029 verify V3: % internal helper(s) are SECURITY DEFINER', v_count;
  END IF;

  -- V4 authenticated executes exactly the six core RPCs among everything 029
  -- and 013 name; anon nothing; service_role exactly the accessor.
  SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s', role.rolname, procedure.oid::regprocedure), ', ')
    INTO v_offender
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS role(rolname)
   WHERE ((namespace.nspname = 'core' AND procedure.proname = ANY (v_core))
       OR (namespace.nspname = 'app' AND procedure.proname = ANY (v_app))
       OR (namespace.nspname = 'public' AND procedure.proname = ANY (v_public)))
     AND pg_catalog.has_function_privilege(role.rolname, procedure.oid, 'EXECUTE')
       <> ((role.rolname = 'authenticated' AND namespace.nspname = 'core')
           OR (role.rolname = 'service_role' AND procedure.proname = 'provider_key_for_tenant'));
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION '029 verify V4: EXECUTE matrix wrong at %', v_offender;
  END IF;

  -- V5 no client role reads the secret store or 029's tables.
  SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s', role.rolname, rel.name), ', ')
    INTO v_offender
    FROM (VALUES ('vault.secrets'), ('vault.decrypted_secrets'),
                 ('app.provider_key_salts'), ('app.provider_key_probes')) AS rel(name)
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS role(rolname)
   WHERE pg_catalog.has_table_privilege(role.rolname, rel.name, 'SELECT')
      OR pg_catalog.has_table_privilege(role.rolname, rel.name, 'INSERT')
      OR pg_catalog.has_table_privilege(role.rolname, rel.name, 'UPDATE')
      OR pg_catalog.has_table_privilege(role.rolname, rel.name, 'DELETE');
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION '029 verify V5: client privilege on %', v_offender;
  END IF;

  -- V6 both new tables RLS enabled AND forced, zero policies.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_class AS rel
   WHERE rel.oid IN ('app.provider_key_salts'::pg_catalog.regclass,
                     'app.provider_key_probes'::pg_catalog.regclass)
     AND rel.relrowsecurity AND rel.relforcerowsecurity;
  IF v_count <> 2 THEN
    RAISE EXCEPTION '029 verify V6: expected 2 tables with RLS enabled and forced, found %', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS policy
              WHERE policy.polrelid IN ('app.provider_key_salts'::pg_catalog.regclass,
                                        'app.provider_key_probes'::pg_catalog.regclass)) THEN
    RAISE EXCEPTION '029 verify V6: a policy exists on a 029 table';
  END IF;

  -- V7 no column on a 029 table can hold key material: the column list is
  -- asserted by EQUALITY, so a new text column fails here.
  SELECT pg_catalog.string_agg(pg_catalog.format('%s.%s', attribute.attrelid::pg_catalog.regclass, attribute.attname), ','
             ORDER BY pg_catalog.format('%s.%s', attribute.attrelid::pg_catalog.regclass, attribute.attname))
    INTO v_offender
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid IN ('app.provider_key_salts'::pg_catalog.regclass,
                                'app.provider_key_probes'::pg_catalog.regclass)
     AND attribute.attnum > 0 AND NOT attribute.attisdropped
     AND attribute.atttypid IN ('text'::pg_catalog.regtype, 'jsonb'::pg_catalog.regtype,
                                'bytea'::pg_catalog.regtype, 'varchar'::pg_catalog.regtype);
  IF v_offender IS DISTINCT FROM
     'app.provider_key_probes.outcome,app.provider_key_probes.requested_by,app.provider_key_salts.salt' THEN
    RAISE EXCEPTION '029 verify V7: unexpected text/jsonb/bytea columns: %', v_offender;
  END IF;

  -- V8 R7: the five key-carrying functions carry both timeouts, exactly.
  SELECT pg_catalog.string_agg(procedure.oid::regprocedure::text, ', ') INTO v_offender
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE ((namespace.nspname = 'core'
           AND procedure.proname IN ('create_provider','test_provider','rotate_provider','reveal_provider'))
       OR (namespace.nspname = 'app' AND procedure.proname = 'provider_key_for_tenant'))
     AND NOT (procedure.proconfig @> ARRAY['statement_timeout=5s', 'lock_timeout=2s']);
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION '029 verify V8: missing statement_timeout=5s / lock_timeout=2s on %', v_offender;
  END IF;

  -- V9 `net` is not exposed through PostgREST, where the setting is readable.
  SELECT pg_catalog.string_agg(setting.value, '; ') INTO v_offender
    FROM pg_catalog.pg_db_role_setting AS role_setting
    CROSS JOIN LATERAL pg_catalog.unnest(role_setting.setconfig) AS setting(value)
   WHERE setting.value ~* '^pgrst\.db_schemas='
     AND 'net' = ANY (pg_catalog.string_to_array(
           pg_catalog.replace(pg_catalog.lower(pg_catalog.split_part(setting.value, '=', 2)), ' ', ''), ','));
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION '029 verify V9: the net schema is exposed to PostgREST (%). Queued pg_net '
      'probes carry provider keys in their headers; remove net from db_schemas first.', v_offender;
  END IF;
END
$verify$;

COMMIT;
