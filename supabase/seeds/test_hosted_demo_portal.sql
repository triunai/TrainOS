-- Pin for hosted_demo_portal.sql and hosted_demo_portal_wipe.sql. Ends in ROLLBACK.
--
-- Run from the repo root against a database with migrations through 028 where
-- tenant `akademi-perdana` is provisioned and hosted_demo_akademi_perdana.sql has
-- already run (the seed's own precondition refuses otherwise):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/test_hosted_demo_portal.sql
--
-- T0  preconditions; a row-count snapshot of every tenant-scoped table
-- T1  seed: exact portal-demo rows; the proposal reached SENT through a real
--     PROPOSAL_SEND requested by codeshern (ADMIN on hosted) and APPROVED by
--     MD khumeren; one live link,
--     stored only as its SHA-256; no table outside the envelope's moved
-- T2  the printed link opens the proposal for `anon`, client-safe keys only;
--     no member's sign-in email (user_profiles or auth.users) anywhere in it,
--     and vendorContact.email is the tenant's supplier contact or null
-- T3  a second run writes nothing and prints no link
-- T4  the link accepts: a PROPOSED engagement on the owner, proposal ACCEPTED
-- T5  wipe: no portal-demo row, envelope row or link left; every other count as
--     at T0 except the append-only event log
-- T6  hosted_demo_wipe.sql then completes (the documented wipe order)
--
-- \ir is needed: the pin runs the seed, its wipe and the demo wipe inside its own
-- transaction, which is the only way to prove them and still ROLLBACK.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE pin_portal_counts (phase text, tbl text, n bigint, PRIMARY KEY (phase, tbl)) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.pin_portal_snapshot(p_phase text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  r   record;
  v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
  v_n bigint;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relkind IN ('r','p') AND n.nspname IN ('core','app','public')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE tenant_id = $1', r.nspname, r.relname) INTO v_n USING v_t;
    INSERT INTO pin_portal_counts VALUES (p_phase, r.nspname || '.' || r.relname, v_n);
  END LOOP;
END;
$fn$;

-- Tables whose count differs between two phases, as 'table:from->to'.
CREATE OR REPLACE FUNCTION pg_temp.pin_portal_moved(p_from text, p_to text)
RETURNS text[]
LANGUAGE sql
AS $fn$
  SELECT COALESCE(array_agg(a.tbl || ':' || a.n || '->' || b.n ORDER BY a.tbl), ARRAY[]::text[])
    FROM pin_portal_counts a JOIN pin_portal_counts b ON b.tbl = a.tbl AND b.phase = p_to
   WHERE a.phase = p_from AND a.n <> b.n;
$fn$;

DO $t0$
BEGIN
  IF to_regprocedure('core.get_portal_proposal(text)') IS NULL THEN
    RAISE EXCEPTION 'T0 SETUP FAILURE: migration 028 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM core.proposals WHERE id::text LIKE 'd0280a11-5eed-4%') THEN
    RAISE EXCEPTION 'T0 SETUP FAILURE: the portal demo is already seeded here; run the wipe first so T1 counts are exact';
  END IF;
  PERFORM pg_temp.pin_portal_snapshot('before');
  RAISE NOTICE 'T0 PASS: preconditions hold, % tenant-scoped tables snapshotted',
    (SELECT count(*) FROM pin_portal_counts WHERE phase = 'before');
END
$t0$;

\ir hosted_demo_portal.sql

SELECT set_config('pin.link', (SELECT portal_link FROM pg_temp.portal_link), true);

DO $t1$
DECLARE
  v_t      uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
  v_pro    core.proposals%ROWTYPE;
  v_link   text := current_setting('pin.link', true);
  v_token  text;
  v_action core.action_requests%ROWTYPE;
  v_apv    core.approval_requests%ROWTYPE;
  v_moved  text[];
  v_n      bigint;
  v_allowed text[] := ARRAY['app.action_effects','app.idempotency_keys','app.outbox','app.submission_counters',
    'core.action_requests','core.approval_decisions','core.approval_requests',
    'core.contact_consents','core.contacts','core.opportunities','core.proposal_sections',
    'core.proposals','core.public_share_tokens','core.quotation_lines','core.quotations',
    'core.ref_sequences','core.events','core.event_subjects'];
  r record;
BEGIN
  PERFORM pg_temp.pin_portal_snapshot('seeded');

  FOR r IN SELECT * FROM (VALUES
      ('core.contacts', 1), ('core.contact_consents', 1), ('core.opportunities', 1), ('core.proposals', 1),
      ('core.proposal_sections', 4), ('core.quotations', 1), ('core.quotation_lines', 5)) AS x(tbl, want)
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE tenant_id = $1 AND id::text LIKE ''d0280a11-5eed-4%%''', r.tbl)
       INTO v_n USING v_t;
    IF v_n IS DISTINCT FROM r.want THEN
      RAISE EXCEPTION 'T1a: % portal-demo rows in %, expected %', v_n, r.tbl, r.want;
    END IF;
  END LOOP;

  SELECT * INTO v_pro FROM core.proposals WHERE tenant_id = v_t AND id::text LIKE 'd0280a11-5eed-4%';
  IF v_pro.status IS DISTINCT FROM 'SENT' OR v_pro.sent_at IS NULL OR v_pro.ref IS NULL THEN
    RAISE EXCEPTION 'T1b: proposal is % (sent_at %, ref %), expected SENT with a ref', v_pro.status, v_pro.sent_at, v_pro.ref;
  END IF;
  IF (SELECT stage FROM core.opportunities WHERE id = v_pro.opportunity_id) IS DISTINCT FROM 'QUALIFYING' THEN
    RAISE EXCEPTION 'T1c: the opportunity is not QUALIFYING';
  END IF;

  SELECT * INTO STRICT v_action FROM core.action_requests
   WHERE tenant_id = v_t AND action_type = 'PROPOSAL_SEND' AND target_id = v_pro.id;
  SELECT * INTO STRICT v_apv FROM core.approval_requests
   WHERE tenant_id = v_t AND action_request_id = v_action.id;
  IF v_action.requested_by_kind IS DISTINCT FROM 'HUMAN' OR v_action.requested_by_id IS DISTINCT FROM '415dad6e-c53f-4a84-ab50-bf8e9e65223f'
     OR v_action.status NOT IN ('EXECUTING','EXECUTED') OR v_apv.policy_id IS DISTINCT FROM 'APV-01' OR v_apv.status IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'T1d: send was % by %/% under %, approval %', v_action.status, v_action.requested_by_kind,
      v_action.requested_by_id, v_apv.policy_id, v_apv.status;
  END IF;
  IF (SELECT count(*) FROM core.approval_decisions d
       WHERE d.tenant_id = v_t AND d.approval_request_id = v_apv.id
         AND d.decision = 'APPROVE' AND d.decided_by_id = 'ad615910-2d87-42a4-9855-58f52409ec6d') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T1e: the approval was not decided APPROVE by MD khumeren';
  END IF;

  IF v_link IS NULL OR v_link !~ '^/p/tk_pt_[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'T1f: the seed printed %, not one /p/tk_pt_ link', COALESCE(v_link, 'nothing');
  END IF;
  v_token := substr(v_link, 4);
  IF (SELECT count(*) FROM core.public_share_tokens s
       WHERE s.tenant_id = v_t AND s.proposal_id = v_pro.id AND s.revoked_at IS NULL
         AND s.token_hash = sha256(convert_to(v_token, 'UTF8'))
         AND s.expires_at BETWEEN now() + interval '29 days' AND now() + interval '31 days') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T1g: no single live 30-day link stored as the SHA-256 of the printed token';
  END IF;
  IF EXISTS (SELECT 1 FROM core.public_share_tokens s WHERE position(convert_to(v_token, 'UTF8') IN s.token_hash) > 0) THEN
    RAISE EXCEPTION 'T1h: the raw token bytes are stored';
  END IF;

  v_moved := pg_temp.pin_portal_moved('before', 'seeded');
  IF EXISTS (SELECT 1 FROM unnest(v_moved) m WHERE split_part(m, ':', 1) <> ALL (v_allowed)) THEN
    RAISE EXCEPTION 'T1i: tables outside the seed and the envelope moved: %', v_moved;
  END IF;

  PERFORM set_config('pin.token', v_token, true);
  RAISE NOTICE 'T1 PASS: % SENT via PROPOSAL_SEND (codeshern) approved under APV-01 by MD khumeren; one live link stored as SHA-256; moved: %',
    v_pro.ref, v_moved;
END
$t1$;

-- T2 · the printed link, as the signed-out browser calls it.
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT set_config('pin.read', core.get_portal_proposal(current_setting('pin.token'))::text, true);
RESET ROLE;

DO $t2$
DECLARE
  v    jsonb := current_setting('pin.read')::jsonb;
  v_keys text;
BEGIN
  SELECT string_agg(k, ',' ORDER BY k) INTO v_keys FROM jsonb_object_keys(v -> 'data') AS k;
  IF v ->> 'success' IS DISTINCT FROM 'true'
     OR v_keys IS DISTINCT FROM 'acceptance,comments,investment,issuedAt,organisationName,ref,sections,status,title,vendorContact' THEN
    RAISE EXCEPTION 'T2a: anon read returned %', v;
  END IF;
  IF v #>> '{data,status}' IS DISTINCT FROM 'SENT' OR jsonb_array_length(v #> '{data,sections}') IS DISTINCT FROM 4
     OR v #>> '{data,organisationName}' IS DISTINCT FROM 'Aurora Precision Tooling Sdn Bhd'
     OR (v #>> '{data,investment,total,amount}')::bigint IS DISTINCT FROM 2640000 THEN
    RAISE EXCEPTION 'T2b: wrong projection %', v;
  END IF;
  -- Keys, not prose: a section body may say "on the floor".
  IF v::text ~* '"[a-z]*(margin|cost|floor|commission|quotation|provenance|needsreview|mergefields)[a-z]*":'
     OR v::text ~ '[^0-9](1048000|1716000|1612308|720000)[^0-9]' THEN
    RAISE EXCEPTION 'T2c: internal pricing reached the client: %', v;
  END IF;
  -- No staff sign-in address, from either source, anywhere in the response;
  -- the one email allowed is the tenant's own supplier contact (028).
  IF EXISTS (SELECT 1
               FROM (SELECT p.email::text AS e FROM public.user_profiles p
                      JOIN public.tenants t ON t.id = p.tenant_id AND t.slug = 'akademi-perdana'
                     UNION
                     SELECT u.email::text FROM auth.users u
                      JOIN public.memberships m ON m.user_id = u.id
                      JOIN public.tenants t ON t.id = m.tenant_id AND t.slug = 'akademi-perdana') AS staff
              WHERE staff.e IS NOT NULL AND staff.e <> ''
                AND strpos(lower(v::text), lower(staff.e)) > 0) THEN
    RAISE EXCEPTION 'T2d: a member''s sign-in email reached the anonymous portal response: %', v #> '{data,vendorContact}';
  END IF;
  IF (v #> '{data,vendorContact,email}') IS DISTINCT FROM 'null'::jsonb
     AND v #>> '{data,vendorContact,email}' IS DISTINCT FROM
         (SELECT btrim(x.contact_email) FROM core.tenant_tax_profiles x
            JOIN public.tenants t ON t.id = x.tenant_id AND t.slug = 'akademi-perdana') THEN
    RAISE EXCEPTION 'T2e: vendorContact.email is neither null nor the tenant supplier contact: %', v #> '{data,vendorContact}';
  END IF;
  RAISE NOTICE 'T2 PASS: anon opens the printed link; exact PortalProposal keys, no internal pricing, no member sign-in email (vendorContact.email %)',
    COALESCE(v #>> '{data,vendorContact,email}', 'null');
END
$t2$;

SELECT pg_temp.pin_portal_snapshot('read');

\ir hosted_demo_portal.sql

DO $t3$
DECLARE
  v_moved text[];
BEGIN
  PERFORM pg_temp.pin_portal_snapshot('reseeded');
  v_moved := pg_temp.pin_portal_moved('read', 'reseeded');
  IF cardinality(v_moved) > 0 THEN
    RAISE EXCEPTION 'T3a: a second seed run wrote rows: %', v_moved;
  END IF;
  IF (SELECT count(*) FROM pg_temp.portal_link) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'T3b: a second seed run printed a link';
  END IF;
  RAISE NOTICE 'T3 PASS: a second run writes nothing and prints no link';
END
$t3$;

-- T4 · the client accepts on the link.
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT set_config('pin.accept', core.accept_portal_proposal(current_setting('pin.token'),
  '{"name":"Hana Rahman","role":"Head of People"}'::jsonb)::text, true);
RESET ROLE;

DO $t4$
DECLARE
  v     jsonb := current_setting('pin.accept')::jsonb;
  v_eng core.engagements%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_eng FROM core.engagements WHERE ref = v #>> '{data,engagementRef}';
  IF v_eng.status IS DISTINCT FROM 'PROPOSED' OR v_eng.owner_id IS DISTINCT FROM '415dad6e-c53f-4a84-ab50-bf8e9e65223f'
     OR v_eng.value_sen IS DISTINCT FROM 2640000 OR v_eng.proposal_id::text NOT LIKE 'd0280a11-5eed-4%' THEN
    RAISE EXCEPTION 'T4a: engagement % is %, owner %, value %', v_eng.ref, v_eng.status, v_eng.owner_id, v_eng.value_sen;
  END IF;
  IF (SELECT status FROM core.proposals WHERE id = v_eng.proposal_id) IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'T4b: the proposal is not ACCEPTED';
  END IF;
  RAISE NOTICE 'T4 PASS: the link accepts: % PROPOSED on the account owner, proposal ACCEPTED', v_eng.ref;
END
$t4$;

\ir hosted_demo_portal_wipe.sql

DO $t5$
DECLARE
  v_t     uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
  v_moved text[];
BEGIN
  PERFORM pg_temp.pin_portal_snapshot('wiped');
  IF EXISTS (SELECT 1 FROM core.proposals WHERE tenant_id = v_t AND id::text LIKE 'd0280a11-5eed-4%')
     OR EXISTS (SELECT 1 FROM core.contacts WHERE tenant_id = v_t AND id::text LIKE 'd0280a11-5eed-4%')
     OR EXISTS (SELECT 1 FROM app.idempotency_keys WHERE tenant_id = v_t AND key LIKE 'hosted-demo-portal:%') THEN
    RAISE EXCEPTION 'T5a: portal-demo rows survived the wipe';
  END IF;
  v_moved := pg_temp.pin_portal_moved('before', 'wiped');
  IF EXISTS (SELECT 1 FROM unnest(v_moved) m
              WHERE split_part(m, ':', 1) <> ALL (ARRAY['core.events','core.event_subjects','core.ref_sequences'])) THEN
    RAISE EXCEPTION 'T5b: the wipe left counts different from T0: %', v_moved;
  END IF;
  RAISE NOTICE 'T5 PASS: wipe leaves every count as at T0 except the append-only event log and ref counters: %', v_moved;
END
$t5$;

-- T6 · the documented order holds: after this wipe, the demo seed's own wipe runs.
\ir hosted_demo_wipe.sql

DO $t6$
BEGIN
  IF EXISTS (SELECT 1 FROM core.proposals WHERE id::text LIKE 'de30da7a-5eed-4%' OR id::text LIKE 'd0280a11-5eed-4%') THEN
    RAISE EXCEPTION 'T6: demo proposals survived hosted_demo_wipe.sql';
  END IF;
  RAISE NOTICE 'T6 PASS: hosted_demo_wipe.sql completes after the portal wipe';
END
$t6$;

ROLLBACK;
