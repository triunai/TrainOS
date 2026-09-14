-- ═══════════════════════════════════════════════════════════════════════════
-- 028 ROLLBACK · The client portal
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores exactly what 021 left. 028 replaced nothing: it created eight
-- functions and granted two things, so the rollback drops the eight and takes
-- the two grants back.
--
-- ORDER, the reverse of the forward file:
--   1. §6: revoke anon's USAGE on `core` — 014:941's end state, restored first
--      so the public surface closes before anything else moves
--   2. §5: drop the three RPCs (their EXECUTE grants go with them)
--   3. §4–§1: drop app._portal_text, app._portal_proposal,
--      app._resolve_portal_token, app.issue_portal_token, app.portal_token_hash
--   4. verify
--
-- DATA IS KEPT. Rows the portal wrote live in 004/007/008/012 tables that
-- predate 028 — public_share_tokens, portal_comments, portal_acceptances,
-- signatures, engagements, events — and are business records: an acceptance
-- is a signed commitment. Without 028's functions no link resolves, so kept
-- tokens are inert. Remove demo rows with seeds/hosted_demo_portal_wipe.sql
-- BEFORE this rollback if that is the intent.
--
-- One transaction.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ═══ 1 · anon out of `core` ═════════════════════════════════════════════════

REVOKE USAGE ON SCHEMA core FROM anon;

-- ═══ 2 · The three RPCs ═════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS core.accept_portal_proposal(text, jsonb);
DROP FUNCTION IF EXISTS core.add_portal_comment(text, jsonb);
DROP FUNCTION IF EXISTS core.get_portal_proposal(text);

-- ═══ 3 · The internals ══════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS app._portal_text(jsonb, text, integer, boolean);
DROP FUNCTION IF EXISTS app._portal_proposal(uuid, uuid);
DROP FUNCTION IF EXISTS app._resolve_portal_token(text);
DROP FUNCTION IF EXISTS app.issue_portal_token(uuid, uuid, interval);
DROP FUNCTION IF EXISTS app.portal_token_hash(text);

-- ═══ 4 · Verify ═════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_bad text;
BEGIN
  SELECT pg_catalog.string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('core','app')
     AND p.proname IN ('get_portal_proposal','add_portal_comment','accept_portal_proposal',
                       '_portal_text','_portal_proposal','_resolve_portal_token',
                       'issue_portal_token','portal_token_hash');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '028 rollback: functions survived: %', v_bad;
  END IF;

  IF pg_catalog.has_schema_privilege('anon', 'core', 'USAGE') THEN
    RAISE EXCEPTION '028 rollback: anon still holds USAGE on core (014:941 revoked it)';
  END IF;

  SELECT pg_catalog.string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('core','app','public')
     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '028 rollback: anon can still EXECUTE %', v_bad;
  END IF;

  RAISE NOTICE '028 rollback: OK - portal functions dropped, anon holds no USAGE on core and no EXECUTE anywhere.';
END;
$verify$;

COMMIT;
