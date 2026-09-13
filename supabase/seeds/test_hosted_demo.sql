-- Pin for hosted_demo_akademi_perdana.sql and hosted_demo_wipe.sql. Ends in ROLLBACK.
--
-- Run from the repo root against a database where tenant `akademi-perdana` is
-- provisioned and both MD users are members (the hosted post-provision state):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/test_hosted_demo.sql
--
-- Counts are split into seed rows (id in the de30da7a-5eed-4… range) and every
-- other row, so the pin gives the same verdict on a fresh tenant and on one the
-- demo seed has already been applied to.
--
-- T0  preconditions, and a snapshot of every tenant-scoped table (seed / other rows)
-- T1  seed: exact seed-row counts per table; no other row count moved
-- T2  seed: legal states only, refs allocated, every user reference is a real MD
-- T3  the 018 read RPCs return rows for each MD, as `authenticated` with hook claims
-- T4  second seed run changes nothing (counts, row versions, ref counters)
-- T5  wipe: zero seed rows anywhere; every other row count as at T0 (ref counters excepted)

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE pin_counts (phase text, tbl text, seed bigint, other bigint, PRIMARY KEY (phase, tbl)) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.pin_snapshot(p_phase text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  r   record;
  v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
  v_seed bigint;
  v_all  bigint;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname,
           EXISTS (SELECT 1 FROM pg_catalog.pg_attribute i
                    WHERE i.attrelid = c.oid AND i.attname = 'id' AND i.atttypid = 'uuid'::regtype AND NOT i.attisdropped) AS has_id
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relkind IN ('r','p') AND n.nspname IN ('core','app','public')
  LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE %s) FROM %I.%I WHERE tenant_id = $1',
                   CASE WHEN r.has_id THEN 'id::text LIKE ''de30da7a-5eed-4%''' ELSE 'false' END,
                   r.nspname, r.relname)
       INTO v_all, v_seed USING v_t;
    INSERT INTO pin_counts VALUES (p_phase, r.nspname || '.' || r.relname, v_seed, v_all - v_seed);
  END LOOP;
END;
$fn$;

DO $t0$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'akademi-perdana') THEN
    RAISE EXCEPTION 'T0 SETUP FAILURE: tenant akademi-perdana is not provisioned';
  END IF;
  PERFORM pg_temp.pin_snapshot('before');
  RAISE NOTICE 'T0 PASS: tenant present, % tenant-scoped tables snapshotted',
    (SELECT count(*) FROM pin_counts WHERE phase = 'before');
END
$t0$;

\ir hosted_demo_akademi_perdana.sql

DO $t1$
DECLARE
  r record;
  v_bad text[] := ARRAY[]::text[];
BEGIN
  PERFORM pg_temp.pin_snapshot('seeded');
  FOR r IN
    SELECT s.tbl, COALESCE(e.n, 0) AS expected, s.seed, s.other - b.other AS other_moved
      FROM pin_counts s
      JOIN pin_counts b ON b.phase = 'before' AND b.tbl = s.tbl
      LEFT JOIN (VALUES
        ('core.templates', 4), ('core.programmes', 5), ('core.programme_pricing_tiers', 11),
        ('core.rate_cards', 1), ('core.rate_card_trainer_days', 3), ('core.rate_card_materials', 4),
        ('core.rate_card_venues', 3), ('core.rate_card_travel', 3), ('core.rate_card_margin_floors', 4),
        ('core.rate_card_discount_authorities', 3), ('core.organisations', 6), ('core.contacts', 6),
        ('core.contact_consents', 8), ('core.enquiries', 14), ('core.enquiry_extraction_fields', 40),
        ('core.opportunities', 5), ('core.tnas', 3), ('core.tna_gaps', 4), ('core.tna_constraints', 5),
        ('core.tna_evidence', 4), ('core.tna_recommendations', 4), ('core.proposals', 3),
        ('core.proposal_sections', 11), ('core.quotations', 3), ('core.quotation_lines', 15),
        ('core.follow_ups', 8), ('core.outbound_messages', 9), ('core.action_requests', 4),
        ('core.approval_requests', 4)
      ) AS e(tbl, n) ON e.tbl = s.tbl
     WHERE s.phase = 'seeded'
  LOOP
    IF r.seed <> r.expected THEN
      v_bad := v_bad || format('%s has %s seed rows, expected %s', r.tbl, r.seed, r.expected);
    END IF;
    IF r.other_moved <> 0 AND r.tbl <> 'core.ref_sequences' THEN
      v_bad := v_bad || format('%s: non-seed row count moved by %s', r.tbl, r.other_moved);
    END IF;
  END LOOP;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'T1 FAIL: %', array_to_string(v_bad, '; ');
  END IF;
  RAISE NOTICE 'T1 PASS: 29 tables hold exactly the seed rows; no non-seed row count moved except core.ref_sequences';
END
$t1$;

DO $t2$
DECLARE
  v_t  uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
  v_md uuid[] := ARRAY['d1449fad-b732-4ee2-93c9-37f338e01358','ad615910-2d87-42a4-9855-58f52409ec6d']::uuid[];
  v_n  bigint;
BEGIN
  SELECT count(*) INTO v_n FROM core.enquiries WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%'
     AND (ref IS NULL OR status NOT IN ('OPEN','ASSIGNED') OR (assigned_to_user_id IS NOT NULL AND assigned_to_user_id <> ALL (v_md)));
  IF v_n > 0 THEN RAISE EXCEPTION 'T2 FAIL: % enquiries without ref, in a gated state, or assigned to a non-MD', v_n; END IF;

  SELECT count(*) INTO v_n FROM core.enquiries WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%'
     AND ((status = 'ASSIGNED') <> (assigned_to_user_id IS NOT NULL));
  IF v_n > 0 THEN RAISE EXCEPTION 'T2 FAIL: % enquiries whose ASSIGNED status disagrees with assigned_to_user_id', v_n; END IF;

  IF (SELECT string_agg(stage::text, ',' ORDER BY stage::text) FROM core.opportunities
       WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%') <> 'LOST,QUALIFYING,QUALIFYING,TNA_SENT,TNA_SENT' THEN
    RAISE EXCEPTION 'T2 FAIL: opportunity stages %', (SELECT array_agg(stage) FROM core.opportunities WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%');
  END IF;
  IF EXISTS (SELECT 1 FROM core.opportunities WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%' AND owner_id <> ALL (v_md))
  OR EXISTS (SELECT 1 FROM core.organisations WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%' AND owner_id <> ALL (v_md))
  OR EXISTS (SELECT 1 FROM core.follow_ups    WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%' AND owner_id <> ALL (v_md)) THEN
    RAISE EXCEPTION 'T2 FAIL: an owner_id is not one of the two MD users';
  END IF;
  IF (SELECT string_agg(status::text, ',' ORDER BY status::text) FROM core.tnas
       WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%') <> 'COMPLETE,COMPLETE,SENT' THEN
    RAISE EXCEPTION 'T2 FAIL: TNA statuses';
  END IF;
  IF EXISTS (SELECT 1 FROM core.proposals  WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%' AND (status <> 'DRAFT' OR ref IS NULL))
  OR EXISTS (SELECT 1 FROM core.quotations WHERE tenant_id = v_t AND id::text LIKE 'de30da7a-5eed-4%' AND (status <> 'DRAFT' OR ref IS NULL OR below_floor)) THEN
    RAISE EXCEPTION 'T2 FAIL: a proposal or quotation is not an allocated, in-floor DRAFT';
  END IF;
  SELECT count(*) INTO v_n FROM core.approval_requests a
    JOIN core.action_requests r ON r.id = a.action_request_id AND r.approval_request_id = a.id AND r.status = 'QUEUED_FOR_APPROVAL'
   WHERE a.tenant_id = v_t AND a.id::text LIKE 'de30da7a-5eed-4%' AND a.status = 'PENDING'
     AND a.assigned_to_id::uuid = ANY (v_md) AND a.target_ref IS NOT NULL
     AND EXISTS (SELECT 1 FROM core.action_policies p WHERE p.tenant_id = v_t AND p.id = a.policy_id AND p.action_type = a.action_type);
  IF v_n <> 4 THEN RAISE EXCEPTION 'T2 FAIL: % of 4 approvals are linked, PENDING, MD-assigned and policy-consistent', v_n; END IF;
  RAISE NOTICE 'T2 PASS: legal states only, refs allocated, owners and assignees are the two MDs, 4 linked pending approvals';
END
$t2$;

DO $t3$
DECLARE
  v_uid   uuid;
  v_claims text;
  v_refs  record;
  v       jsonb;
  v_rows  int;
  v_bad   text[] := ARRAY[]::text[];
  v_line  text;
  c       record;
BEGIN
  SELECT (SELECT ref FROM core.enquiries      WHERE id::text LIKE 'de30da7a-5eed-4%' ORDER BY ref LIMIT 1) AS enq,
         (SELECT ref FROM core.follow_ups     WHERE id::text LIKE 'de30da7a-5eed-4%' AND status IN ('DUE','OVERDUE') ORDER BY ref LIMIT 1) AS fup,
         (SELECT ref FROM core.tnas           WHERE id::text LIKE 'de30da7a-5eed-4%' AND status = 'COMPLETE' ORDER BY ref LIMIT 1) AS tna,
         (SELECT ref FROM core.proposals      WHERE id::text LIKE 'de30da7a-5eed-4%' ORDER BY ref LIMIT 1) AS pro,
         (SELECT ref FROM core.quotations     WHERE id::text LIKE 'de30da7a-5eed-4%' ORDER BY ref LIMIT 1) AS quo,
         (SELECT ref FROM core.approval_requests WHERE id::text LIKE 'de30da7a-5eed-4%' ORDER BY ref LIMIT 1) AS apv,
         (SELECT ref FROM core.organisations  WHERE id::text LIKE 'de30da7a-5eed-4%' ORDER BY ref LIMIT 1) AS org,
         (SELECT ref FROM core.opportunities  WHERE id::text LIKE 'de30da7a-5eed-4%' ORDER BY ref LIMIT 1) AS opp
    INTO v_refs;

  FOREACH v_uid IN ARRAY ARRAY['d1449fad-b732-4ee2-93c9-37f338e01358','ad615910-2d87-42a4-9855-58f52409ec6d']::uuid[] LOOP
    v_claims := (app.custom_access_token_hook(jsonb_build_object('user_id', v_uid,
                  'claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated'))) -> 'claims')::text;
    PERFORM set_config('request.jwt.claims', v_claims, true);
    SET LOCAL ROLE authenticated;
    v_line := '';
    FOR c IN SELECT * FROM (VALUES
        ('me', 0), ('badge_counts', 0), ('list_enquiries', 14), ('get_enquiry', 0), ('list_follow_ups', 8),
        ('get_follow_up_draft', 0), ('get_organisation', 0), ('get_opportunity', 0), ('get_tna', 0),
        ('get_tna_recommendations', 1), ('list_proposals', 3), ('get_proposal', 0), ('list_quotations', 3),
        ('get_quotation', 0), ('get_rate_card', 0), ('list_approvals', 4), ('get_approval', 0)) AS t(fn, min_rows)
    LOOP
      v := CASE c.fn
             WHEN 'me'                      THEN core.me()
             WHEN 'badge_counts'            THEN core.badge_counts()
             WHEN 'list_enquiries'          THEN core.list_enquiries()
             WHEN 'get_enquiry'             THEN core.get_enquiry(v_refs.enq)
             WHEN 'list_follow_ups'         THEN core.list_follow_ups()
             WHEN 'get_follow_up_draft'     THEN core.get_follow_up_draft(v_refs.fup, 'EMAIL')
             WHEN 'get_organisation'        THEN core.get_organisation(v_refs.org)
             WHEN 'get_opportunity'         THEN core.get_opportunity(v_refs.opp)
             WHEN 'get_tna'                 THEN core.get_tna(v_refs.tna)
             WHEN 'get_tna_recommendations' THEN core.get_tna_recommendations(v_refs.tna)
             WHEN 'list_proposals'          THEN core.list_proposals()
             WHEN 'get_proposal'            THEN core.get_proposal(v_refs.pro)
             WHEN 'list_quotations'         THEN core.list_quotations()
             WHEN 'get_quotation'           THEN core.get_quotation(v_refs.quo)
             WHEN 'get_rate_card'           THEN core.get_rate_card()
             WHEN 'list_approvals'          THEN core.list_approvals()
             WHEN 'get_approval'            THEN core.get_approval(v_refs.apv)
           END;
      v_rows := CASE WHEN jsonb_typeof(v -> 'data' -> 'data') = 'array' THEN jsonb_array_length(v -> 'data' -> 'data') END;
      IF (v ->> 'success') IS DISTINCT FROM 'true' OR COALESCE(v_rows, 0) < c.min_rows THEN
        v_bad := v_bad || format('%s as %s: %s', c.fn, v_uid, left(v::text, 200));
      END IF;
      v_line := v_line || format('%s=%s ', c.fn, COALESCE(v_rows::text, 'ok'));
    END LOOP;
    v := core.badge_counts();
    IF (v -> 'data' ->> 'approvals')::int <> 2 THEN
      v_bad := v_bad || format('badge_counts.approvals as %s = %s, expected 2', v_uid, v -> 'data' ->> 'approvals');
    END IF;
    IF core.me() -> 'data' ->> 'role' <> 'MD' THEN
      v_bad := v_bad || format('me.role as %s is not MD', v_uid);
    END IF;
    RESET ROLE;
    RAISE NOTICE 'T3 % : % badge.approvals=%', v_uid, v_line, v -> 'data' ->> 'approvals';
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
  IF cardinality(v_bad) > 0 THEN RAISE EXCEPTION 'T3 FAIL: %', array_to_string(v_bad, ' | '); END IF;
  RAISE NOTICE 'T3 PASS: 17 read RPCs succeed with rows for both MDs as authenticated; 2 approvals badged each';
END
$t3$;

CREATE TEMP TABLE pin_fingerprint ON COMMIT DROP AS
SELECT 'first'::text AS run,
       (SELECT md5(string_agg(format('%s|%s|%s', s.prefix, s.period, s.next_value), ',' ORDER BY s.prefix, s.period))
          FROM core.ref_sequences s JOIN public.tenants t ON t.id = s.tenant_id AND t.slug = 'akademi-perdana') AS refseq,
       (SELECT md5(string_agg(format('%s|%s|%s', x.id, x.updated_at, x.status), ',' ORDER BY x.id))
          FROM (SELECT id, updated_at, status::text FROM core.enquiries   WHERE id::text LIKE 'de30da7a-5eed-4%'
                UNION ALL SELECT id, updated_at, stage::text FROM core.opportunities WHERE id::text LIKE 'de30da7a-5eed-4%'
                UNION ALL SELECT id, updated_at, status::text FROM core.tnas WHERE id::text LIKE 'de30da7a-5eed-4%'
                UNION ALL SELECT id, updated_at, status FROM core.quotations WHERE id::text LIKE 'de30da7a-5eed-4%'
                UNION ALL SELECT id, updated_at, approval_request_id::text FROM core.action_requests WHERE id::text LIKE 'de30da7a-5eed-4%') AS x) AS rows;

\ir hosted_demo_akademi_perdana.sql

DO $t4$
DECLARE
  v_first  record;
  v_second record;
  v_diff   bigint;
BEGIN
  PERFORM pg_temp.pin_snapshot('reseeded');
  SELECT count(*) INTO v_diff FROM pin_counts a JOIN pin_counts b ON b.tbl = a.tbl AND b.phase = 'reseeded'
   WHERE a.phase = 'seeded' AND (a.seed, a.other) IS DISTINCT FROM (b.seed, b.other);
  SELECT * INTO v_first FROM pin_fingerprint WHERE run = 'first';
  SELECT (SELECT md5(string_agg(format('%s|%s|%s', s.prefix, s.period, s.next_value), ',' ORDER BY s.prefix, s.period))
            FROM core.ref_sequences s JOIN public.tenants t ON t.id = s.tenant_id AND t.slug = 'akademi-perdana') AS refseq,
         (SELECT md5(string_agg(format('%s|%s|%s', x.id, x.updated_at, x.status), ',' ORDER BY x.id))
            FROM (SELECT id, updated_at, status::text FROM core.enquiries   WHERE id::text LIKE 'de30da7a-5eed-4%'
                  UNION ALL SELECT id, updated_at, stage::text FROM core.opportunities WHERE id::text LIKE 'de30da7a-5eed-4%'
                  UNION ALL SELECT id, updated_at, status::text FROM core.tnas WHERE id::text LIKE 'de30da7a-5eed-4%'
                  UNION ALL SELECT id, updated_at, status FROM core.quotations WHERE id::text LIKE 'de30da7a-5eed-4%'
                  UNION ALL SELECT id, updated_at, approval_request_id::text FROM core.action_requests WHERE id::text LIKE 'de30da7a-5eed-4%') AS x) AS rows
    INTO v_second;
  IF v_diff <> 0 OR v_first.refseq IS DISTINCT FROM v_second.refseq OR v_first.rows IS DISTINCT FROM v_second.rows THEN
    RAISE EXCEPTION 'T4 FAIL: second run changed % table count(s); ref counters same=%; walked rows same=%',
      v_diff, v_first.refseq = v_second.refseq, v_first.rows = v_second.rows;
  END IF;
  RAISE NOTICE 'T4 PASS: second run inserted nothing, walked nothing, burned no refs';
END
$t4$;

\ir hosted_demo_wipe.sql

DO $t5$
DECLARE
  v_bad text;
BEGIN
  PERFORM pg_temp.pin_snapshot('wiped');
  SELECT string_agg(format('%s seed=%s other before=%s after=%s', b.tbl, w.seed, b.other, w.other), '; ') INTO v_bad
    FROM pin_counts b JOIN pin_counts w ON w.tbl = b.tbl AND w.phase = 'wiped'
   WHERE b.phase = 'before'
     AND (w.seed <> 0 OR (b.other <> w.other AND b.tbl <> 'core.ref_sequences'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'T5 FAIL: %', v_bad; END IF;
  RAISE NOTICE 'T5 PASS: wipe removed every seed row and left every other row count as it was (ref counters kept by design)';
END
$t5$;

DO $done$ BEGIN RAISE NOTICE 'test_hosted_demo: ALL PASS'; END $done$;
ROLLBACK;
