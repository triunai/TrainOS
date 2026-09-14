-- ═══════════════════════════════════════════════════════════════════════════
-- test_028 · The client portal: token-authorised read, comment and accept
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001–021 + 028. Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_028_client_portal.sql
--
-- EXECUTED before commit on the PostgreSQL 17 shim with every migration and
-- this pin run as a NOSUPERUSER BYPASSRLS role (hosted `postgres`).
--
-- IMPERSONATION IS REAL. Portal probes run AS `anon` with PostgREST's anon
-- claims ({"role":"anon"}), or AS `authenticated` with a member's claims where
-- the point is that a JWT cannot steer the lookup. Assertions run after RESET
-- ROLE. Stateful probes (every write, and every read whose answer depends on a
-- write) are one statement each. The NOT_FOUND matrix calls many inputs in ONE
-- statement per principal, each in its own subtransaction (`pg_temp.try`), as
-- test_021 T1 does: no claim or role changes inside that statement.
--
-- Fixtures: tenants A, B and S (S is suspended after its link is minted), each
-- with two MDs. Proposals reach SENT only through core.perform_action
-- PROPOSAL_SEND queued under APV-01 and APPROVED by the OTHER MD.
--
-- T1  A valid link read by anon returns exactly the PortalProposal keys, the
--     client-safe section/investment/contact shapes, and no internal pricing:
--     not the quotation's cost, floor or margin, not needs_review or merge
--     fields.
-- T2  NOT_FOUND, byte-identical, for: a well-formed unknown token, malformed,
--     empty and NULL tokens, a proposal uuid and a proposal ref as the token,
--     a revoked link, an expired link, a link row to a DRAFT proposal, a link to
--     a LOST proposal, and a live link of a SUSPENDED tenant. Read: app.err
--     with no details. Both writes: TRNOS {"code":"NOT_FOUND"} with one message.
--     A bad body with a bad token is still NOT_FOUND (token checked first).
-- T3  The JWT cannot steer: tenant A's MD reading tenant B's link gets tenant
--     B's one proposal, byte-identical to anon's read; tenant B's MD holding
--     tenant A's revoked link gets NOT_FOUND. issue_portal_token refuses a DRAFT
--     and a proposal named under the wrong tenant.
-- T4  Comments: plain text round-trips literally (HTML kept, not escaped);
--     author >120, body >4000, a control character, a whitespace-only body and
--     a non-object body are VALIDATION_FAILED naming the fields; the 201st
--     comment is COMMENT_LIMIT_REACHED.
-- T5  Accept: signature + PROPOSED engagement on the opportunity owner +
--     acceptance + ACCEPTED + one ProposalAccepted event with a CLIENT actor;
--     a second accept with a different name returns the byte-identical original
--     and writes nothing; the read shows the acceptance; a missing role is
--     VALIDATION_FAILED.
-- T6  Accept after expiry and after revocation is NOT_FOUND and changes nothing.
-- T7  anon's reach: EXECUTE on exactly these three in core and nothing in app
--     or public; ten other core functions, three 028 internals and two core
--     tables each refuse anon with 42501. A CLIENT member is still FORBIDDEN
--     on core.perform_action (021 fail-closed untouched).
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

-- ── Helpers ────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ('a0280000-' || substr(h,1,4) || '-4' || substr(h,5,3) || '-8' || substr(h,8,3) || '-' || substr(h,11,12))::uuid
    FROM (SELECT md5('test_028:' || p_key) AS h) AS k;
$fn$;

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text, p_kind text DEFAULT 'HUMAN')
RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', p_kind, 'aal', 'aal1',
    'client_scope', 'ALL', 'team_scope', 'ALL')::text;
$fn$;

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
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('p28.' || p_key)::jsonb; $fn$;

CREATE FUNCTION pg_temp.tok(p_key text) RETURNS text
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('p28.tok_' || p_key); $fn$;

-- One tenant's world: two MDs, an organisation, an owner-owned opportunity, a
-- claimable programme, a proposal with two sections and a priced quotation.
CREATE FUNCTION pg_temp.world(p_key text, p_status text DEFAULT 'ACTIVE') RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE
  v_t   uuid := pg_temp.id(p_key || ':tenant');
  v_md1 uuid := pg_temp.id(p_key || ':md1');
  v_md2 uuid := pg_temp.id(p_key || ':md2');
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_md1, p_key || '-md1@t028.test'), (v_md2, p_key || '-md2@t028.test');
  INSERT INTO public.tenants (id, slug, name, status, timezone, locale)
  VALUES (v_t, 't028-' || lower(p_key), 'Provider ' || p_key, 'ACTIVE', 'Asia/Kuala_Lumpur', 'en-MY');
  INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
  VALUES (v_t, v_md1, 'MD','HUMAN','ALL','ALL',false,'ACTIVE',true),
         (v_t, v_md2, 'MD','HUMAN','ALL','ALL',false,'ACTIVE',true);
  INSERT INTO public.user_profiles (tenant_id, user_id, display_name, email)
  VALUES (v_t, v_md1, 'Owner ' || p_key, p_key || '-md1@t028.test'),
         (v_t, v_md2, 'Approver ' || p_key, p_key || '-md2@t028.test');
  INSERT INTO core.organisations (id,tenant_id,name,industry,location,owner_id,status,hrdc_registered,hrdc_employer_code,country_code)
  VALUES (pg_temp.id(p_key || ':org'), v_t, 'Client ' || p_key || ' Sdn Bhd', 'MANUFACTURING', 'Shah Alam', v_md1,
          'ACTIVE_CLIENT', true, 'E-' || p_key, 'MYS');
  INSERT INTO core.opportunities (id,tenant_id,organisation_id,owner_id,stage,value_sen,currency,probability,created_by_kind,created_by_id)
  VALUES (pg_temp.id(p_key || ':opp'), v_t, pg_temp.id(p_key || ':org'), v_md1, 'NEW', 2000000, 'MYR', 0.5, 'HUMAN', v_md1::text);
  INSERT INTO core.templates (id,tenant_id,template_type,version,label,merge_fields,status,created_by_kind,created_by_id)
  VALUES (pg_temp.id(p_key || ':tpl'), v_t, 'PROPOSAL', 1, 'Standard', ARRAY['organisation.name'], 'ACTIVE', 'HUMAN', v_md1::text);
  INSERT INTO core.programmes (id,tenant_id,name,category,days,version,status,hrdc_scheme,hrdc_claimable,
    list_price_sen,list_price_pax,floor_price_sen,floor_margin_rate,currency,created_by_kind,created_by_id)
  VALUES (pg_temp.id(p_key || ':prg'), v_t, 'Programme ' || p_key, 'LEADERSHIP', 2, 1, 'ACTIVE', 'SBL_KHAS', true,
          2000000, 25, 1300000, 0.3000, 'MYR', 'HUMAN', v_md1::text);
  INSERT INTO core.rate_cards (id,tenant_id,version,currency,status,effective_from,created_by_kind,created_by_id)
  VALUES (pg_temp.id(p_key || ':rc'), v_t, '2026.1', 'MYR', 'ACTIVE', '2026-01-01', 'HUMAN', v_md1::text);
  RETURN v_t;
END;
$fn$;

CREATE FUNCTION pg_temp.proposal(p_key text, p_n int) RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE
  v_t uuid := pg_temp.id(p_key || ':tenant');
  v_p uuid := pg_temp.id(p_key || ':pro' || p_n);
BEGIN
  INSERT INTO core.proposals (id,tenant_id,opportunity_id,organisation_id,template_id,programme_id,value_sen,margin_rate,status)
  VALUES (v_p, v_t, pg_temp.id(p_key || ':opp'), pg_temp.id(p_key || ':org'), pg_temp.id(p_key || ':tpl'),
          pg_temp.id(p_key || ':prg'), 2000000, 0.6150, 'DRAFT');
  INSERT INTO core.proposal_sections (tenant_id,proposal_id,n,title,body,merge_fields_used,needs_review)
  VALUES (v_t, v_p, 1, 'Understanding your needs', 'Your managers need the floor, not the report.', ARRAY['organisation.name'], true),
         (v_t, v_p, 2, 'Investment', NULL, NULL, false);
  INSERT INTO core.quotations (id,tenant_id,proposal_id,rate_card_id,pax,programme_floor_price_sen,floor_margin_rate,commission_rate,commission_payable_on,status,created_by_kind,created_by_id)
  VALUES (pg_temp.id(p_key || ':quo' || p_n), v_t, v_p, pg_temp.id(p_key || ':rc'), 25, 1300000, 0.3000, 0.0700, 'COLLECTION', 'DRAFT', 'HUMAN', 'pin');
  INSERT INTO core.quotation_lines (tenant_id,quotation_id,n,item,basis,qty,unit,unit_price_sen,is_cost)
  VALUES (v_t, pg_temp.id(p_key || ':quo' || p_n), 1, 'TRAINER_FEE', 'PER_DAY', 2, 'DAY', 386123, true),
         (v_t, pg_temp.id(p_key || ':quo' || p_n), 2, 'SELL_PRICE', 'PACKAGE', 1, NULL, 2000000, false);
  RETURN v_p;
END;
$fn$;

-- PROPOSAL_SEND by md1 through the envelope, APPROVED by md2.
CREATE FUNCTION pg_temp.send(p_key text, p_n int) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  v_t   uuid := pg_temp.id(p_key || ':tenant');
  v_p   uuid := pg_temp.id(p_key || ':pro' || p_n);
  v_ref text := (SELECT ref FROM core.proposals WHERE id = v_p);
  v_r   jsonb;
  v_apv core.approval_requests%ROWTYPE;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_temp.claims(pg_temp.id(p_key || ':md1'), v_t, 'MD'), true);
  v_r := core.perform_action('PROPOSAL_SEND', v_ref, '{"channel":"EMAIL"}'::jsonb, NULL, NULL, NULL, '[]'::jsonb, 't028-send-' || v_p);
  IF v_r #>> '{data,status}' <> 'QUEUED_FOR_APPROVAL' THEN
    RAISE EXCEPTION 'SETUP: PROPOSAL_SEND % did not queue: %', v_ref, v_r;
  END IF;
  SELECT a.* INTO STRICT v_apv FROM core.approval_requests a
   WHERE a.tenant_id = v_t AND a.id = (v_r #>> '{data,approvalRequest,id}')::uuid;
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_temp.claims(pg_temp.id(p_key || ':md2'), v_t, 'MD'), true);
  v_r := core.decide_approval(v_apv.id, 'APPROVE', 'ok', v_apv.diff_hash, 't028-decide-' || v_apv.id);
  PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
  IF (SELECT status FROM core.proposals WHERE id = v_p) <> 'SENT' THEN
    RAISE EXCEPTION 'SETUP: % is not SENT after approval: %', v_ref, v_r;
  END IF;
  RETURN v_ref;
END;
$fn$;

-- A link row whose token the pin chooses, stored exactly as 028 stores one.
CREATE FUNCTION pg_temp.link(p_key text, p_n int, p_name text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  v_token text := 'tk_pt_' || rpad(p_name, 43, 'x');
BEGIN
  INSERT INTO core.public_share_tokens (tenant_id, target_kind, proposal_id, token_hash)
  VALUES (pg_temp.id(p_key || ':tenant'), 'PROPOSAL', pg_temp.id(p_key || ':pro' || p_n), app.portal_token_hash(v_token));
  PERFORM pg_catalog.set_config('p28.tok_' || p_name, v_token, true);
  RETURN v_token;
END;
$fn$;

-- ── Fixtures ───────────────────────────────────────────────────────────────

SELECT pg_temp.world('A'), pg_temp.world('B'), pg_temp.world('S');
SELECT pg_temp.proposal('A', 1), pg_temp.proposal('A', 2), pg_temp.proposal('A', 3),
       pg_temp.proposal('B', 1), pg_temp.proposal('B', 2), pg_temp.proposal('S', 1);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.send('A', 1), pg_temp.send('A', 3), pg_temp.send('B', 1), pg_temp.send('B', 2), pg_temp.send('S', 1);

-- A1: the live link, minted by 028 itself.
SELECT pg_catalog.set_config('p28.tok_live',
  app.issue_portal_token(pg_temp.id('A:tenant'), pg_temp.id('A:pro1'), interval '30 days'), true);
-- A1 again: revoked and expired links to the SAME proposal.
SELECT pg_temp.link('A', 1, 'revoked'), pg_temp.link('A', 1, 'expired');
UPDATE core.public_share_tokens SET revoked_at = now()
 WHERE token_hash = app.portal_token_hash(pg_temp.tok('revoked'));
UPDATE core.public_share_tokens SET expires_at = now() - interval '1 second'
 WHERE token_hash = app.portal_token_hash(pg_temp.tok('expired'));
-- A2 stays DRAFT; a link row to it exists anyway (as if written by hand).
SELECT pg_temp.link('A', 2, 'draft');
-- A3 is sent, linked, then LOST.
SELECT pg_temp.link('A', 3, 'lost');
UPDATE core.proposals SET status = 'LOST', lost_at = now() WHERE id = pg_temp.id('A:pro3');
-- B1: a live link in tenant B. B2: a link that will expire before its accept.
SELECT pg_temp.link('B', 1, 'tenantb'), pg_temp.link('B', 2, 'bexpire');
-- S1: a live link, then the tenant is suspended.
SELECT pg_temp.link('S', 1, 'suspended');
UPDATE public.tenants SET status = 'SUSPENDED' WHERE id = pg_temp.id('S:tenant');

-- A CLIENT member of tenant A, for T7's fail-closed probe.
INSERT INTO auth.users (id, email) VALUES (pg_temp.id('A:client'), 'client@t028.test');
INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES (pg_temp.id('A:tenant'), pg_temp.id('A:client'), 'CLIENT','CLIENT','ALL','ALL',false,'ACTIVE',true);

-- ════════ T1 · A valid link, read by anon ════════

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.read_live', core.get_portal_proposal(pg_temp.tok('live'))::text, true);
RESET ROLE;

DO $t1$
DECLARE
  v    jsonb := pg_temp.got('read_live');
  d    jsonb := v -> 'data';
  keys text;
BEGIN
  IF (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(v) k) IS DISTINCT FROM 'data,success' OR v ->> 'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'T1a: envelope %', v;
  END IF;
  SELECT string_agg(k, ',' ORDER BY k) INTO keys FROM jsonb_object_keys(d) k;
  IF keys IS DISTINCT FROM 'acceptance,comments,investment,issuedAt,organisationName,ref,sections,status,title,vendorContact' THEN
    RAISE EXCEPTION 'T1b: PortalProposal keys are %', keys;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'sections') s
              WHERE (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(s) k) IS DISTINCT FROM 'body,n,title') THEN
    RAISE EXCEPTION 'T1c: a section carries more than n/title/body: %', d -> 'sections';
  END IF;
  IF (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(d -> 'investment') k) IS DISTINCT FROM 'hrdcClaimableUpTo,hrdcScheme,total'
     OR (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(d -> 'vendorContact') k) IS DISTINCT FROM 'email,name,phone,role' THEN
    RAISE EXCEPTION 'T1d: investment/vendorContact shape %', d;
  END IF;
  IF d ->> 'status' IS DISTINCT FROM 'SENT' OR d -> 'acceptance' IS DISTINCT FROM 'null'::jsonb OR d -> 'comments' IS DISTINCT FROM '[]'::jsonb
     OR d #>> '{sections,1,body}' IS DISTINCT FROM '' OR (d #>> '{investment,total,amount}')::bigint IS DISTINCT FROM 2000000
     OR d #>> '{investment,hrdcScheme}' IS DISTINCT FROM 'SBL_KHAS' OR (d #>> '{investment,hrdcClaimableUpTo}')::numeric IS DISTINCT FROM 1
     OR d ->> 'organisationName' IS DISTINCT FROM 'Client A Sdn Bhd' OR d ->> 'title' IS DISTINCT FROM 'Programme A — Client A Sdn Bhd'
     OR d ->> 'issuedAt' !~ '^\d{4}-\d{2}-\d{2}$'
     OR d #>> '{vendorContact,name}' IS DISTINCT FROM 'Owner A' OR d #>> '{vendorContact,role}' IS DISTINCT FROM 'Managing Director' THEN
    RAISE EXCEPTION 'T1e: projection values %', d;
  END IF;
  -- No internal pricing, by key or by value: the quotation's trainer line
  -- (772246 cost), its floor (1300000) and the proposal margin_rate (0.615).
  IF v::text ~* '"[a-z]*(margin|cost|floor|commission|quotation|provenance|needsreview|mergefields|runid)[a-z]*":'
     OR v::text ~ '(772246|386123|1300000|0\.615)' THEN
    RAISE EXCEPTION 'T1f: internal data reached the client: %', v;
  END IF;
  IF (SELECT access_count FROM core.public_share_tokens WHERE token_hash = app.portal_token_hash(pg_temp.tok('live'))) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T1g: the read did not record one access on the token';
  END IF;
  RAISE NOTICE 'T1 PASS: anon reads exactly the PortalProposal keys and client-safe shapes; no cost, floor, margin or review flag; access recorded';
END
$t1$;

-- ════════ T2 · NOT_FOUND, identically, for every invalid link ════════

CREATE FUNCTION pg_temp.bad_links() RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('unknown',   pg_catalog.quote_literal('tk_pt_' || repeat('Q', 43))),
    ('malformed', pg_catalog.quote_literal('tok_aurora_pro_0184')),
    ('empty',     pg_catalog.quote_literal('')),
    ('null',      'NULL'),
    ('uuid',      pg_catalog.quote_literal(pg_temp.id('A:pro1')::text)),
    ('ref',       pg_catalog.quote_literal(pg_temp.tok('ref'))),
    ('revoked',   pg_catalog.quote_literal(pg_temp.tok('revoked'))),
    ('expired',   pg_catalog.quote_literal(pg_temp.tok('expired'))),
    ('draft',     pg_catalog.quote_literal(pg_temp.tok('draft'))),
    ('lost',      pg_catalog.quote_literal(pg_temp.tok('lost'))),
    ('suspended', pg_catalog.quote_literal(pg_temp.tok('suspended')))) AS t(name, lit)
  LOOP
    v_out := v_out || pg_catalog.jsonb_build_object(r.name, pg_catalog.jsonb_build_object(
      'read',    pg_temp.try('SELECT core.get_portal_proposal(' || r.lit || '::text)'),
      'comment', pg_temp.try('SELECT core.add_portal_comment(' || r.lit || '::text, ''{"author":"x","body":"y"}''::jsonb)'),
      'badbody', pg_temp.try('SELECT core.add_portal_comment(' || r.lit || '::text, ''"nope"''::jsonb)'),
      'accept',  pg_temp.try('SELECT core.accept_portal_proposal(' || r.lit || '::text, ''{"name":"x","role":"y"}''::jsonb)')));
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- Read as the owner now: anon cannot read core.proposals to build the literal.
SELECT pg_catalog.set_config('p28.tok_ref', (SELECT ref FROM core.proposals WHERE id = pg_temp.id('A:pro1')), true);
SELECT pg_catalog.set_config('p28.tok_bref', (SELECT ref FROM core.proposals WHERE id = pg_temp.id('B:pro2')), true);

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.bad', pg_temp.bad_links()::text, true);
RESET ROLE;

DO $t2$
DECLARE
  v      jsonb := pg_temp.got('bad');
  v_name text;
  v_read  jsonb := '{"ok": true, "value": {"error": {"code": "NOT_FOUND"}, "success": false}}';
  v_write jsonb := '{"ok": false, "detail": "{\"code\": \"NOT_FOUND\"}", "message": "portal link not found", "sqlstate": "TRNOS"}';
BEGIN
  IF (SELECT count(*) FROM jsonb_object_keys(v)) IS DISTINCT FROM 11 THEN
    RAISE EXCEPTION 'T2 SETUP: expected 11 invalid links, got %', v;
  END IF;
  FOR v_name IN SELECT jsonb_object_keys(v) LOOP
    IF v #> ARRAY[v_name, 'read'] IS DISTINCT FROM v_read THEN
      RAISE EXCEPTION 'T2a: read of % link is not the bare NOT_FOUND: %', v_name, v #> ARRAY[v_name, 'read'];
    END IF;
    IF v #> ARRAY[v_name, 'comment'] IS DISTINCT FROM v_write OR v #> ARRAY[v_name, 'accept'] IS DISTINCT FROM v_write
       OR v #> ARRAY[v_name, 'badbody'] IS DISTINCT FROM v_write THEN
      RAISE EXCEPTION 'T2b: a write with the % link is not the identical NOT_FOUND: %', v_name, v -> v_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM core.portal_comments WHERE tenant_id IN (pg_temp.id('A:tenant'), pg_temp.id('S:tenant')))
     OR EXISTS (SELECT 1 FROM core.portal_acceptances WHERE tenant_id IN (pg_temp.id('A:tenant'), pg_temp.id('S:tenant'))) THEN
    RAISE EXCEPTION 'T2c: an invalid link wrote a row';
  END IF;
  RAISE NOTICE 'T2 PASS: 11 invalid links (unknown, malformed, empty, NULL, uuid, ref, revoked, expired, DRAFT, LOST, suspended tenant) x read/comment/accept give one byte-identical NOT_FOUND and write nothing';
END
$t2$;

-- ════════ T3 · The JWT cannot steer the lookup ════════

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.b_anon', core.get_portal_proposal(pg_temp.tok('tenantb'))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims', pg_temp.claims(pg_temp.id('A:md1'), pg_temp.id('A:tenant'), 'MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('p28.b_as_a', core.get_portal_proposal(pg_temp.tok('tenantb'))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims', pg_temp.claims(pg_temp.id('B:md1'), pg_temp.id('B:tenant'), 'MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('p28.revoked_as_b', core.get_portal_proposal(pg_temp.tok('revoked'))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('p28.issue_draft',
  pg_temp.try($$SELECT to_jsonb(app.issue_portal_token(pg_temp.id('A:tenant'), pg_temp.id('A:pro2')))$$)::text, true);
SELECT pg_catalog.set_config('p28.issue_cross',
  pg_temp.try($$SELECT to_jsonb(app.issue_portal_token(pg_temp.id('A:tenant'), pg_temp.id('B:pro1')))$$)::text, true);

DO $t3$
DECLARE
  v_anon jsonb := pg_temp.got('b_anon');
  v_as_a jsonb := pg_temp.got('b_as_a');
BEGIN
  IF v_anon #>> '{data,organisationName}' IS DISTINCT FROM 'Client B Sdn Bhd' OR v_as_a IS DISTINCT FROM v_anon THEN
    RAISE EXCEPTION 'T3a: tenant A''s MD reading tenant B''s link differs from anon: % vs %', v_as_a, v_anon;
  END IF;
  IF pg_temp.got('revoked_as_b') IS DISTINCT FROM '{"error": {"code": "NOT_FOUND"}, "success": false}'::jsonb THEN
    RAISE EXCEPTION 'T3b: a tenant-B member holding tenant A''s revoked link got %', pg_temp.got('revoked_as_b');
  END IF;
  IF pg_temp.got('issue_draft') ->> 'sqlstate' IS DISTINCT FROM 'TRNOS'
     OR (pg_temp.got('issue_draft') ->> 'detail')::jsonb ->> 'reason' IS DISTINCT FROM 'PROPOSAL_NOT_SENT'
     OR pg_temp.got('issue_cross') ->> 'sqlstate' IS DISTINCT FROM 'P0002' THEN
    RAISE EXCEPTION 'T3c: issue_portal_token accepted a DRAFT or a cross-tenant proposal: % / %',
      pg_temp.got('issue_draft'), pg_temp.got('issue_cross');
  END IF;
  RAISE NOTICE 'T3 PASS: a tenant-A JWT reads tenant B''s link exactly as anon does; a tenant-B JWT does not revive a revoked link; no link for a DRAFT or across tenants';
END
$t3$;

-- ════════ T4 · Comments ════════

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.c_ok', core.add_portal_comment(pg_temp.tok('live'),
  pg_catalog.jsonb_build_object('author', '  Nurul Hassan ', 'body', E'<script>alert(1)</script> & <b>dates</b>?\nThanks'))::text, true);
RESET ROLE;

CREATE FUNCTION pg_temp.bad_comments() RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('long_author', pg_catalog.jsonb_build_object('author', repeat('a', 121), 'body', 'ok')),
    ('long_body',   pg_catalog.jsonb_build_object('author', 'Nurul', 'body', repeat('b', 4001))),
    ('bell',        pg_catalog.jsonb_build_object('author', 'Nurul', 'body', 'ding' || chr(7))),
    ('nl_author',   pg_catalog.jsonb_build_object('author', E'Nu\nrul', 'body', 'ok')),
    ('blank',       pg_catalog.jsonb_build_object('author', 'Nurul', 'body', E'  \n ')),
    ('number',      pg_catalog.jsonb_build_object('author', 'Nurul', 'body', 42)),
    ('array',       '[]'::jsonb)) AS t(name, body)
  LOOP
    v_out := v_out || pg_catalog.jsonb_build_object(r.name,
      pg_temp.try(pg_catalog.format('SELECT core.add_portal_comment(%L, %L::jsonb)', pg_temp.tok('live'), r.body::text)));
  END LOOP;
  RETURN v_out;
END;
$fn$;

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.c_bad', pg_temp.bad_comments()::text, true);
RESET ROLE;

-- Fill to the cap as the owner, then the 200th and 201st through the RPC.
INSERT INTO core.portal_comments (tenant_id, proposal_id, author_name, author_kind, body)
SELECT pg_temp.id('B:tenant'), pg_temp.id('B:pro1'), 'Filler', 'CLIENT', 'filler ' || g
  FROM generate_series(1, 199) AS g;

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.c_200', pg_temp.try($$SELECT core.add_portal_comment(pg_temp.tok('tenantb'), '{"author":"B","body":"200th"}')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.c_201', pg_temp.try($$SELECT core.add_portal_comment(pg_temp.tok('tenantb'), '{"author":"B","body":"201st"}')$$)::text, true);
RESET ROLE;

DO $t4$
DECLARE
  v    jsonb := pg_temp.got('c_ok');
  bad  jsonb := pg_temp.got('c_bad');
  want jsonb := '{"long_author":["author"],"long_body":["body"],"bell":["body"],"nl_author":["author"],
                  "blank":["body"],"number":["body"],"array":["author","body"]}';
  k    text;
BEGIN
  IF v ->> 'success' IS DISTINCT FROM 'true' OR jsonb_array_length(v #> '{data,comments}') IS DISTINCT FROM 1
     OR v #>> '{data,comments,0,body}' IS DISTINCT FROM E'<script>alert(1)</script> & <b>dates</b>?\nThanks'
     OR v #>> '{data,comments,0,author}' IS DISTINCT FROM 'Nurul Hassan'
     OR v #>> '{data,comments,0,authorKind}' IS DISTINCT FROM 'CLIENT'
     OR (SELECT string_agg(x, ',' ORDER BY x) FROM jsonb_object_keys(v #> '{data,comments,0}') x) IS DISTINCT FROM 'at,author,authorKind,body' THEN
    RAISE EXCEPTION 'T4a: the comment did not round-trip as literal plain text: %', v;
  END IF;
  FOR k IN SELECT jsonb_object_keys(want) LOOP
    IF bad #>> ARRAY[k,'sqlstate'] IS DISTINCT FROM 'TRNOS'
       OR (bad #>> ARRAY[k,'detail'])::jsonb ->> 'code' IS DISTINCT FROM 'VALIDATION_FAILED'
       OR (SELECT jsonb_agg(f ->> 'field' ORDER BY f ->> 'field')
             FROM jsonb_array_elements((bad #>> ARRAY[k,'detail'])::jsonb -> 'fields') f) IS DISTINCT FROM want -> k THEN
      RAISE EXCEPTION 'T4b: % comment was not VALIDATION_FAILED on %: %', k, want -> k, bad -> k;
    END IF;
  END LOOP;
  IF pg_temp.got('c_200') -> 'ok' IS DISTINCT FROM 'true'::jsonb
     OR pg_temp.got('c_201') ->> 'sqlstate' IS DISTINCT FROM 'TRNOS'
     OR (pg_temp.got('c_201') ->> 'detail')::jsonb ->> 'reason' IS DISTINCT FROM 'COMMENT_LIMIT_REACHED'
     OR (SELECT count(*) FROM core.portal_comments WHERE proposal_id = pg_temp.id('B:pro1')) IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'T4c: the comment cap did not hold at 200: % / %', pg_temp.got('c_200') -> 'ok', pg_temp.got('c_201');
  END IF;
  RAISE NOTICE 'T4 PASS: HTML round-trips as literal text; 7 malformed bodies name their fields; the 201st comment is COMMENT_LIMIT_REACHED';
END
$t4$;

-- ════════ T5 · Accept, and accept again ════════

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.a_norole',
  pg_temp.try($$SELECT core.accept_portal_proposal(pg_temp.tok('live'), '{"name":"Nurul Hassan"}')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.a_first', core.accept_portal_proposal(pg_temp.tok('live'),
  '{"name":"Nurul Hassan","role":"HR Manager"}')::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('p28.a_counts', (SELECT pg_catalog.jsonb_build_object(
  'sig', (SELECT count(*) FROM core.signatures WHERE tenant_id = pg_temp.id('A:tenant')),
  'eng', (SELECT count(*) FROM core.engagements WHERE tenant_id = pg_temp.id('A:tenant')),
  'acc', (SELECT count(*) FROM core.portal_acceptances WHERE tenant_id = pg_temp.id('A:tenant')),
  'evt', (SELECT count(*) FROM core.events WHERE tenant_id = pg_temp.id('A:tenant') AND type = 'ProposalAccepted')))::text, true);

SELECT pg_catalog.set_config('request.jwt.claims', pg_temp.claims(pg_temp.id('B:md1'), pg_temp.id('B:tenant'), 'MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('p28.a_second', core.accept_portal_proposal(pg_temp.tok('live'),
  '{"name":"Somebody Else","role":"Intruder"}')::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.a_read', core.get_portal_proposal(pg_temp.tok('live'))::text, true);
RESET ROLE;

DO $t5$
DECLARE
  v1   jsonb := pg_temp.got('a_first');
  v2   jsonb := pg_temp.got('a_second');
  rd   jsonb := pg_temp.got('a_read');
  c0   jsonb := pg_temp.got('a_counts');
  v_eng core.engagements%ROWTYPE;
  v_sig core.signatures%ROWTYPE;
  v_evt core.events%ROWTYPE;
BEGIN
  IF pg_temp.got('a_norole') ->> 'sqlstate' IS DISTINCT FROM 'TRNOS'
     OR (pg_temp.got('a_norole') ->> 'detail')::jsonb IS DISTINCT FROM '{"code":"VALIDATION_FAILED","fields":[{"field":"role","reason":"INVALID"}]}'::jsonb THEN
    RAISE EXCEPTION 'T5a: accept without a role: %', pg_temp.got('a_norole');
  END IF;
  IF (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(v1 -> 'data') k) IS DISTINCT FROM 'acceptedAt,engagementRef,signatureRef' THEN
    RAISE EXCEPTION 'T5b: PortalAcceptResponse keys: %', v1;
  END IF;
  SELECT * INTO STRICT v_eng FROM core.engagements WHERE tenant_id = pg_temp.id('A:tenant') AND ref = v1 #>> '{data,engagementRef}';
  SELECT * INTO STRICT v_sig FROM core.signatures WHERE tenant_id = pg_temp.id('A:tenant') AND ref = v1 #>> '{data,signatureRef}';
  IF v_eng.status IS DISTINCT FROM 'PROPOSED' OR v_eng.proposal_id IS DISTINCT FROM pg_temp.id('A:pro1') OR v_eng.owner_id IS DISTINCT FROM pg_temp.id('A:md1')
     OR v_eng.programme_id IS DISTINCT FROM pg_temp.id('A:prg') OR v_eng.value_sen IS DISTINCT FROM 2000000 OR v_eng.created_by_kind IS DISTINCT FROM 'CLIENT'
     OR v_sig.method IS DISTINCT FROM 'CLICKWRAP' OR v_sig.signer_name IS DISTINCT FROM 'Nurul Hassan' OR v_sig.signer_role IS DISTINCT FROM 'HR Manager' THEN
    RAISE EXCEPTION 'T5c: engagement % / signature % are not what accept should write', row_to_json(v_eng), row_to_json(v_sig);
  END IF;
  IF (SELECT status FROM core.proposals WHERE id = pg_temp.id('A:pro1')) IS DISTINCT FROM 'ACCEPTED'
     OR (SELECT accepted_at FROM core.proposals WHERE id = pg_temp.id('A:pro1')) IS NULL THEN
    RAISE EXCEPTION 'T5d: the proposal is not ACCEPTED';
  END IF;
  SELECT * INTO STRICT v_evt FROM core.events WHERE tenant_id = pg_temp.id('A:tenant') AND type = 'ProposalAccepted';
  IF v_evt.actor ->> 'kind' IS DISTINCT FROM 'CLIENT' OR v_evt.actor ->> 'name' IS DISTINCT FROM 'Nurul Hassan'
     OR v_evt.payload ->> 'engagementRef' IS DISTINCT FROM v_eng.ref OR v_evt.aggregate_id IS DISTINCT FROM pg_temp.id('A:pro1') THEN
    RAISE EXCEPTION 'T5e: ProposalAccepted event %', row_to_json(v_evt);
  END IF;
  IF c0 IS DISTINCT FROM '{"sig":1,"eng":1,"acc":1,"evt":1}'::jsonb THEN
    RAISE EXCEPTION 'T5f: the first accept wrote %', c0;
  END IF;
  IF v2 IS DISTINCT FROM v1 THEN
    RAISE EXCEPTION 'T5g: a second accept is not the original: % vs %', v2, v1;
  END IF;
  IF (SELECT count(*) FROM core.signatures WHERE tenant_id = pg_temp.id('A:tenant')) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM core.engagements WHERE tenant_id = pg_temp.id('A:tenant')) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM core.events WHERE tenant_id = pg_temp.id('A:tenant') AND type = 'ProposalAccepted') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T5h: the second accept wrote rows';
  END IF;
  IF rd #>> '{data,status}' IS DISTINCT FROM 'ACCEPTED'
     OR rd #> '{data,acceptance}' IS DISTINCT FROM pg_catalog.jsonb_build_object('acceptedBy','Nurul Hassan','role','HR Manager',
          'acceptedAt', v1 #> '{data,acceptedAt}', 'signatureRef', v1 #> '{data,signatureRef}') THEN
    RAISE EXCEPTION 'T5i: the read after accept shows %', rd #> '{data}';
  END IF;
  RAISE NOTICE 'T5 PASS: accept writes one CLICKWRAP signature, one PROPOSED engagement on the owner, ACCEPTED and one CLIENT ProposalAccepted; a second accept (other name, other JWT) returns the original byte-for-byte and writes nothing';
END
$t5$;

-- ════════ T6 · Accept after expiry or revocation ════════

UPDATE core.public_share_tokens SET expires_at = now() - interval '1 second'
 WHERE token_hash = app.portal_token_hash(pg_temp.tok('bexpire'));

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.x_expired', pg_temp.try($$SELECT core.accept_portal_proposal(pg_temp.tok('bexpire'), '{"name":"B","role":"HR"}')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.x_revoked', pg_temp.try($$SELECT core.accept_portal_proposal(pg_temp.tok('revoked'), '{"name":"A","role":"HR"}')$$)::text, true);
RESET ROLE;

DO $t6$
BEGIN
  IF pg_temp.got('x_expired') ->> 'sqlstate' IS DISTINCT FROM 'TRNOS' OR (pg_temp.got('x_expired') ->> 'detail')::jsonb IS DISTINCT FROM '{"code":"NOT_FOUND"}'::jsonb
     OR pg_temp.got('x_revoked') IS DISTINCT FROM pg_temp.got('x_expired') THEN
    RAISE EXCEPTION 'T6a: accept after expiry/revocation: % / %', pg_temp.got('x_expired'), pg_temp.got('x_revoked');
  END IF;
  IF (SELECT status FROM core.proposals WHERE id = pg_temp.id('B:pro2')) IS DISTINCT FROM 'SENT'
     OR EXISTS (SELECT 1 FROM core.portal_acceptances WHERE proposal_id = pg_temp.id('B:pro2'))
     OR EXISTS (SELECT 1 FROM core.engagements WHERE tenant_id = pg_temp.id('B:tenant')) THEN
    RAISE EXCEPTION 'T6b: a refused accept changed something';
  END IF;
  RAISE NOTICE 'T6 PASS: accept on an expired or revoked link is NOT_FOUND and the proposal stays SENT';
END
$t6$;

-- ════════ T7 · anon's reach, and CLIENT still fail-closed ════════

CREATE FUNCTION pg_temp.anon_reach() RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('core.me',                 $$SELECT core.me()$$),
    ('core.navigation',         $$SELECT core.navigation()$$),
    ('core.badge_counts',       $$SELECT core.badge_counts()$$),
    ('core.list_enquiries',     $$SELECT core.list_enquiries()$$),
    ('core.get_proposal',       $$SELECT core.get_proposal('PRO-0001')$$),
    ('core.list_quotations',    $$SELECT core.list_quotations()$$),
    ('core.get_rate_card',      $$SELECT core.get_rate_card()$$),
    ('core.get_audit',          $$SELECT core.get_audit('PROPOSAL','PRO-0001')$$),
    ('core.perform_action',     $$SELECT core.perform_action('PROPOSAL_SEND','PRO-0001')$$),
    ('core.decide_approval',    $$SELECT core.decide_approval(gen_random_uuid(),'APPROVE',NULL,'x',NULL)$$),
    ('app.issue_portal_token',  $$SELECT to_jsonb(app.issue_portal_token(gen_random_uuid(), gen_random_uuid()))$$),
    ('app._resolve_portal_token', $$SELECT to_jsonb(count(*)) FROM app._resolve_portal_token('x')$$),
    ('app._portal_proposal',    $$SELECT app._portal_proposal(gen_random_uuid(), gen_random_uuid())$$),
    ('core.public_share_tokens', $$SELECT to_jsonb(count(*)) FROM core.public_share_tokens$$),
    ('core.proposals',          $$SELECT to_jsonb(count(*)) FROM core.proposals$$)) AS t(name, sql)
  LOOP
    v_out := v_out || pg_catalog.jsonb_build_object(r.name, pg_temp.try(r.sql));
  END LOOP;
  RETURN v_out;
END;
$fn$;

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('p28.reach', pg_temp.anon_reach()::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims', pg_temp.claims(pg_temp.id('A:client'), pg_temp.id('A:tenant'), 'CLIENT', 'CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('p28.client_send', pg_temp.try(pg_catalog.format(
  'SELECT core.perform_action(%L, %L, ''{"channel":"EMAIL"}''::jsonb)', 'PROPOSAL_SEND',
  pg_temp.tok('bref')))::text, true);
RESET ROLE;

DO $t7$
DECLARE
  v      jsonb := pg_temp.got('reach');
  v_name text;
  v_bad  text;
BEGIN
  IF (SELECT count(*) FROM jsonb_object_keys(v)) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'T7 SETUP: expected 15 probes, got %', v;
  END IF;
  FOR v_name IN SELECT jsonb_object_keys(v) LOOP
    IF v #>> ARRAY[v_name, 'sqlstate'] IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'T7a: anon was not refused 42501 on %: %', v_name, v -> v_name;
    END IF;
  END LOOP;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('core','app','public') AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_bad IS DISTINCT FROM 'core.accept_portal_proposal(text,jsonb), core.add_portal_comment(text,jsonb), core.get_portal_proposal(text)' THEN
    RAISE EXCEPTION 'T7b: anon can EXECUTE: %', v_bad;
  END IF;

  IF pg_temp.got('client_send') ->> 'sqlstate' IS DISTINCT FROM 'TRNOS'
     OR (pg_temp.got('client_send') ->> 'detail')::jsonb ->> 'code' IS DISTINCT FROM 'FORBIDDEN'
     OR EXISTS (SELECT 1 FROM app.role_permissions WHERE role = 'CLIENT') THEN
    RAISE EXCEPTION 'T7c: CLIENT is no longer fail-closed: %', pg_temp.got('client_send');
  END IF;
  RAISE NOTICE 'T7 PASS: anon executes exactly the 3 portal RPCs in app/core/public; 15 other functions and tables refuse it 42501; a CLIENT member is FORBIDDEN on perform_action and CLIENT holds no permission';
END
$t7$;

ROLLBACK;
