-- ============================================================================
-- PIN · fixture_world
-- ============================================================================
--
-- Targets migrations 001-017 (and 018 when it merges). T10 needs 014's policies
-- and the seed provisions through 016's seeders, so neither runs at 013.
--
-- Run only AFTER the four fixture_world parts have been applied AND COMMITTED,
-- and re-apply them ahead of this file in the SAME transaction:
--
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 \
--     -f supabase/seeds/fixture_world_01_tenant_and_parties.sql \
--     -f supabase/seeds/fixture_world_02_sales_and_money.sql \
--     -f supabase/seeds/fixture_world_03_delivery_compliance_finance.sql \
--     -f supabase/seeds/fixture_world_04_ai_ops_and_agents.sql \
--     -f supabase/seeds/test_fixture_world.sql
--
-- That shape is deliberate and T0 depends on it. The seed's whole idempotence
-- claim is "a second run changes nothing", and the only way to measure a second
-- run is to be inside it: `pg_stat_xact_all_tables` reports rows inserted,
-- updated and deleted BY THE CURRENT TRANSACTION, synchronously, unlike the
-- collector's delayed view. So the pin re-runs the seed and then asks the
-- server how many rows moved. Zero, or the claim is false.
--
-- It ends in ROLLBACK. Nothing durable is written — including the second
-- application, which by construction writes nothing anyway.
--
-- WHAT THIS PIN IS FOR. A seed is a claim about a world. Seven of those claims
-- are load-bearing for the tests, the screens and the review that read it, and
-- every one of them is the kind that looks true while being false:
--
--   T0  A second run changes ZERO rows. An `ON CONFLICT DO UPDATE` without the
--       `IS DISTINCT FROM` guard re-runs "successfully" while touching every
--       row, which bumps updated_at through app.set_updated_at() and makes
--       every timestamp in the fixture world a function of how many times
--       somebody ran the seed.
--   T3  136 participants. The roster is the fixture world's largest derived
--       set and the one a transcription would quietly truncate.
--   T4  78 certificates, and every one belongs to somebody the attendance
--       sheet says was present. Issuing a certificate to an absentee is the
--       failure an HRD Corp auditor looks for.
--   T5  The below-floor margin is NOT representable, and this pin FAILS when
--       that stops being true. See T5's own note.
--   T6  ORG-0114's in-flight deal, end to end, because it is the row a
--       reviewer opens first.
--   T8  Every gate the seed suspended was restored. A seed that leaves a state
--       transition gate disabled hands back a database where the product's
--       central control is off, and nothing else would notice.
--   T10 The world reads back THROUGH 014's policies as Alex Selvarajah, and is
--       invisible to another tenant's member. Every other assertion here runs
--       as the loader, which sees past RLS; this is the only one that measures
--       what the product will actually be served.
--
-- RUNNABILITY NOTES
-- 1. Runs as the migration role. RLS is enabled and FORCED on every table in
--    core, app and public; a role without BYPASSRLS sees nothing, which is why
--    T10 impersonates rather than assuming.
-- 2. No psql meta-commands: `npm run lint:sql` parses this file through the
--    real Postgres grammar, and that gate is why there is no \i runner.
-- 3. `BEGIN;` below warns "there is already a transaction in progress" under the
--    run command above, because -1 has already opened one. That is expected and
--    is the price of the file also being runnable on its own.
-- 4. Counts are written as literals, not derived from the fixtures. That is
--    the point of a pin: it is an independent statement of the world, so a
--    fixture change that moves a number has to be acknowledged here.
-- ============================================================================

BEGIN;

-- ── T0 · the second run changed nothing ─────────────────────────────────────
-- Captured FIRST, before this file reads anything, so the numbers describe the
-- seed's own activity in this transaction and not the pin's.
CREATE TEMP TABLE pin_xact AS
SELECT
  coalesce(sum(n_tup_ins), 0) AS ins,
  coalesce(sum(n_tup_upd), 0) AS upd,
  coalesce(sum(n_tup_del), 0) AS del,
  count(*) FILTER (
    WHERE coalesce(seq_scan, 0) + coalesce(idx_scan, 0) > 0
  ) AS tables_touched
FROM pg_stat_xact_all_tables
WHERE schemaname IN ('core', 'app', 'public', 'auth');

DO $t0$
DECLARE
  v pin_xact%ROWTYPE;
BEGIN
  SELECT * INTO v FROM pin_xact;

  -- The seed reads every table it writes, because ON CONFLICT arbitrates
  -- against a unique index. A pin run on its own leaves that footprint empty,
  -- and its idempotence assertion would then pass by measuring nothing.
  IF v.tables_touched < 40 THEN
    RAISE EXCEPTION
      'T0 SETUP FAILURE: only % tables were touched in this transaction. '
      'The four fixture_world parts must be re-applied ahead of this file, in '
      'the same transaction — see this file''s header.', v.tables_touched;
  END IF;

  IF v.ins <> 0 OR v.upd <> 0 OR v.del <> 0 THEN
    RAISE EXCEPTION
      'T0 FAIL: the second run was not a no-op — % inserted, % updated, % deleted. '
      'An upsert is missing its IS DISTINCT FROM guard, or a value in the seed '
      'disagrees with what is already stored.', v.ins, v.upd, v.del;
  END IF;

  RAISE NOTICE
    'T0 PASS - re-applying the seed over % tables changed 0 rows.', v.tables_touched;
END;
$t0$;

-- ── T1 · the tenant and its principals ──────────────────────────────────────
DO $t1$
DECLARE
  v_tenant  uuid := 'acade111-0000-4000-8000-000000000001';
  v_count   bigint;
  v_name    text;
BEGIN
  SELECT count(*) INTO v_count FROM public.tenants WHERE id = v_tenant AND slug = 'akademi-perdana';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'T1a FAIL: expected the akademi-perdana tenant at its anchor id, found %', v_count;
  END IF;

  -- Seven humans and one service principal per agent. core.agents.principal_user_id
  -- is NOT NULL and unique per agent, so the eight are not decoration.
  SELECT count(*) INTO v_count FROM auth.users;
  IF v_count <> 15 THEN
    RAISE EXCEPTION 'T1b FAIL: expected 15 auth users (7 humans + 8 agent principals), found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.memberships WHERE tenant_id = v_tenant;
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'T1c FAIL: expected 7 memberships, found %', v_count;
  END IF;

  -- Alex Selvarajah is `/me`. Every screenshot, every persona review and the
  -- approvals inbox are written from this principal's seat.
  SELECT p.display_name INTO v_name
    FROM public.user_profiles p
    JOIN public.memberships m ON m.tenant_id = p.tenant_id AND m.user_id = p.user_id
   WHERE p.tenant_id = v_tenant AND m.role = 'MD';
  IF v_name IS DISTINCT FROM 'Alex Selvarajah' THEN
    RAISE EXCEPTION 'T1d FAIL: the MD is %, expected Alex Selvarajah', coalesce(v_name, '<nobody>');
  END IF;

  RAISE NOTICE 'T1 PASS - one tenant, 15 principals, 7 memberships, Alex Selvarajah is MD.';
END;
$t1$;

-- ── T2 · parties, catalogue and pipeline configuration ──────────────────────
DO $t2$
DECLARE
  v_tenant uuid := 'acade111-0000-4000-8000-000000000001';
  v_count  bigint;
BEGIN
  SELECT count(*) INTO v_count FROM core.organisations WHERE tenant_id = v_tenant;
  IF v_count <> 6 THEN RAISE EXCEPTION 'T2a FAIL: expected 6 organisations, found %', v_count; END IF;

  SELECT count(*) INTO v_count FROM core.contacts WHERE tenant_id = v_tenant;
  IF v_count <> 6 THEN RAISE EXCEPTION 'T2b FAIL: expected 6 contacts, found %', v_count; END IF;

  SELECT count(*) INTO v_count FROM core.programmes WHERE tenant_id = v_tenant;
  IF v_count <> 5 THEN RAISE EXCEPTION 'T2c FAIL: expected 5 programmes, found %', v_count; END IF;

  SELECT count(*) INTO v_count FROM core.trainers WHERE tenant_id = v_tenant;
  IF v_count <> 4 THEN RAISE EXCEPTION 'T2d FAIL: expected 4 trainers, found %', v_count; END IF;

  -- Stage names and order are configuration. A hardcoded stage list anywhere is
  -- a defect, so the rows the UI renders from have to exist.
  SELECT count(*) INTO v_count
    FROM core.pipeline_steps s
    JOIN core.pipelines p ON p.id = s.pipeline_id
   WHERE p.tenant_id = v_tenant AND p.object = 'ENGAGEMENT';
  IF v_count <> 9 THEN
    RAISE EXCEPTION 'T2e FAIL: the ENGAGEMENT pipeline has % steps, expected 9 (WON..PAID)', v_count;
  END IF;

  -- Every prefix core.assign_ref can be handed. A missing one raises
  -- foreign_key_violation on the first insert that does not name its own ref.
  -- These rows are 016's, not the seed's: app.seed_ref_formats() derives one per
  -- trigger. The count is asserted here because the seed depends on provisioning
  -- having run, not because the seed wrote them.
  SELECT count(*) INTO v_count FROM core.ref_formats WHERE tenant_id = v_tenant;
  IF v_count <> 32 THEN RAISE EXCEPTION 'T2f FAIL: expected 32 ref formats, found %', v_count; END IF;

  -- The seed writes every ref explicitly, so it must burn no sequence numbers.
  -- A row here means something inserted without naming its ref, and the seed is
  -- then no longer reproducible: the same file would produce different refs.
  SELECT count(*) INTO v_count FROM core.ref_sequences WHERE tenant_id = v_tenant;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'T2g FAIL: the seed allocated % ref sequence(s); every ref must be explicit', v_count;
  END IF;

  -- A convention pinned on purpose. 017 requires an expiry wherever hrd_tdf is
  -- true; the fixture world states the accreditation and no date for it, so the
  -- seed reuses the trainer's TTT expiry and says so. Three of four are
  -- accredited, none has lapsed at the fixture clock, and every TDF expiry still
  -- equals the TTT one -- the last of which fails the moment somebody gives the
  -- fixture real TDF dates, which is the point.
  SELECT count(*) INTO v_count
    FROM core.trainers WHERE tenant_id = v_tenant AND hrd_tdf;
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'T2h FAIL: % trainer(s) carry HRD Corp TDF accreditation, expected 3', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM core.trainers
   WHERE tenant_id = v_tenant AND hrd_tdf
     AND (hrd_tdf_valid_to IS NULL OR hrd_tdf_valid_to <= DATE '2026-11-14');
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'T2i FAIL: % accredited trainer(s) have no TDF expiry or a lapsed one at the '
      'fixture clock. 017 exists to stop a lapsed trainer being scheduled.', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM core.trainers
   WHERE tenant_id = v_tenant AND hrd_tdf
     AND hrd_tdf_valid_to IS DISTINCT FROM ttt_valid_to;
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'T2j FAIL (good news): % trainer(s) now carry a TDF expiry of their own. The '
      'seed has been reusing the TTT date as a convention; if the fixture world now '
      'states real TDF dates, drop the convention and this assertion with it.', v_count;
  END IF;

  RAISE NOTICE 'T2 PASS - 6 organisations, 6 contacts, 5 programmes, 4 trainers, 9 pipeline steps, 0 refs burned, 3 unlapsed TDF accreditations.';
END;
$t2$;

-- ── T3 · the cohorts ────────────────────────────────────────────────────────
DO $t3$
DECLARE
  v_tenant      uuid := 'acade111-0000-4000-8000-000000000001';
  v_engagements bigint;
  v_participants bigint;
  v_rostered    bigint;
  v_entries     bigint;
BEGIN
  SELECT count(*) INTO v_engagements FROM core.engagements WHERE tenant_id = v_tenant;
  IF v_engagements <> 10 THEN
    RAISE EXCEPTION 'T3a FAIL: expected 10 engagements, found %', v_engagements;
  END IF;

  SELECT count(*) INTO v_participants FROM core.participants WHERE tenant_id = v_tenant;
  IF v_participants <> 136 THEN
    RAISE EXCEPTION 'T3b FAIL: expected 136 participants, found %', v_participants;
  END IF;

  -- Ten engagements, five rosters. Two cohorts sit in 2027 and two deals were
  -- cancelled; nobody has attended a course that has not happened, and ENG-0259
  -- has not been won yet. A pin that demanded ten rosters would be demanding
  -- four fabrications.
  SELECT count(DISTINCT engagement_id) INTO v_rostered FROM core.participants WHERE tenant_id = v_tenant;
  IF v_rostered <> 5 THEN
    RAISE EXCEPTION 'T3c FAIL: expected 5 engagements to carry a roster, found %', v_rostered;
  END IF;

  SELECT count(*) INTO v_entries FROM core.attendance_entries WHERE tenant_id = v_tenant;
  IF v_entries <> 544 THEN
    RAISE EXCEPTION 'T3d FAIL: expected 544 attendance entries, found %', v_entries;
  END IF;

  RAISE NOTICE
    'T3 PASS - 136 participants over 5 rostered cohorts of 10 engagements, 544 attendance entries.';
END;
$t3$;

-- ── T4 · certificates certify attendance ────────────────────────────────────
DO $t4$
DECLARE
  v_tenant uuid := 'acade111-0000-4000-8000-000000000001';
  v_count  bigint;
  v_dupes  bigint;
BEGIN
  SELECT count(*) INTO v_count FROM core.certificates WHERE tenant_id = v_tenant;
  IF v_count <> 78 THEN
    RAISE EXCEPTION 'T4a FAIL: expected 78 certificates, found %', v_count;
  END IF;

  -- A serial identifies a certificate. Two rows sharing one is the defect that
  -- makes a claim packet unauditable.
  SELECT count(*) INTO v_dupes
    FROM (SELECT serial FROM core.certificates WHERE tenant_id = v_tenant
           GROUP BY serial HAVING count(*) > 1) d;
  IF v_dupes <> 0 THEN
    RAISE EXCEPTION 'T4b FAIL: % certificate serial(s) are issued more than once', v_dupes;
  END IF;

  -- Every certificate belongs to a participant of the engagement it names.
  SELECT count(*) INTO v_count
    FROM core.certificates c
    JOIN core.participants p ON p.tenant_id = c.tenant_id AND p.id = c.participant_id
   WHERE c.tenant_id = v_tenant AND p.engagement_id IS DISTINCT FROM c.engagement_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'T4c FAIL: % certificate(s) name an engagement their holder did not attend', v_count;
  END IF;

  RAISE NOTICE 'T4 PASS - 78 certificates, serials unique, each held by a participant of its own cohort.';
END;
$t4$;

-- ── T5 · the below-floor margin, and the column it has no home in ───────────
--
-- The fixture world's one unhappy profitability case is ENG-0198, Safety
-- Leadership Essentials: a realised margin of 29% against a 35% floor. Both
-- halves of that sentence should be in the database and only one is. The
-- programme's floor is a column; the engagement's REALISED margin is not — no
-- table in 001-013 has a realised-margin or trainer-payable column, and
-- ENG-0198 was never quoted (its commission is RATE_CARD with no quotation), so
-- core.quotations cannot carry it either.
--
-- This pin therefore asserts the floor that IS storable, and asserts that the
-- column is still missing. The second half is the useful half: when the
-- migrations lane adds core.engagements.realised_margin_rate, T5b FAILS, and
-- the failure is the reminder that the seed now has somewhere to put 0.29.
DO $t5$
DECLARE
  v_tenant uuid := 'acade111-0000-4000-8000-000000000001';
  v_floor  numeric;
  v_status text;
  v_col    text;
BEGIN
  SELECT p.floor_margin_rate, e.status INTO v_floor, v_status
    FROM core.engagements e
    JOIN core.programmes p ON p.tenant_id = e.tenant_id AND p.id = e.programme_id
   WHERE e.tenant_id = v_tenant AND e.ref = 'ENG-0198';

  IF v_floor IS DISTINCT FROM 0.3500 OR v_status IS DISTINCT FROM 'DELIVERED' THEN
    RAISE EXCEPTION
      'T5a FAIL: ENG-0198 is % against a floor of %, expected DELIVERED against 0.3500',
      coalesce(v_status, '<missing>'), coalesce(v_floor::text, '<missing>');
  END IF;

  SELECT a.attname INTO v_col
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core' AND c.relname = 'engagements' AND a.attnum > 0
     AND NOT a.attisdropped
     AND (a.attname LIKE '%margin%' OR a.attname LIKE '%payable%')
   LIMIT 1;

  IF v_col IS NOT NULL THEN
    RAISE EXCEPTION
      'T5b FAIL (good news): core.engagements.% now exists. The schema can hold a '
      'realised margin, so the seed must land ENG-0198''s 0.29 and this assertion '
      'must be replaced by one that checks it.', v_col;
  END IF;

  RAISE NOTICE
    'T5 PASS - ENG-0198 is DELIVERED against a 0.3500 floor; the realised 0.29 still has no column.';
END;
$t5$;

-- ── T6 · ORG-0114's in-flight deal ──────────────────────────────────────────
DO $t6$
DECLARE
  v_tenant uuid := 'acade111-0000-4000-8000-000000000001';
  v_status text;
  v_org    text;
  v_count  bigint;
BEGIN
  -- The engagement, at its anchor id.
  SELECT e.status, o.ref INTO v_status, v_org
    FROM core.engagements e
    JOIN core.organisations o ON o.tenant_id = e.tenant_id AND o.id = e.organisation_id
   WHERE e.id = 'acade111-0005-4000-8000-000000000259';

  IF v_org IS DISTINCT FROM 'ORG-0114' OR v_status IS DISTINCT FROM 'PROPOSED' THEN
    RAISE EXCEPTION
      'T6a FAIL: the ENG-0259 anchor holds % for %, expected PROPOSED for ORG-0114',
      coalesce(v_status, '<missing>'), coalesce(v_org, '<missing>');
  END IF;

  -- The pending approval the deal is waiting on. In the fixture world this is
  -- the deal chain's APPROVAL stage; in the schema it is an approval request
  -- and the queued action behind it, because core.pipelines.object has no
  -- DEAL_CHAIN member to render that strip from (see the PR's schema gaps).
  SELECT count(*) INTO v_count
    FROM core.approval_requests a
    JOIN core.proposals p ON p.tenant_id = a.tenant_id AND p.ref = a.target_ref
    JOIN core.organisations o ON o.tenant_id = p.tenant_id AND o.id = p.organisation_id
   WHERE a.tenant_id = v_tenant
     AND a.status = 'PENDING'
     AND a.action_type = 'PROPOSAL_SEND'
     AND o.ref = 'ORG-0114';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'T6b FAIL: ORG-0114 has % pending PROPOSAL_SEND approvals, expected exactly 1', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM core.action_requests
   WHERE tenant_id = v_tenant
     AND target_ref = 'PRO-2026-0184'
     AND status = 'QUEUED_FOR_APPROVAL';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'T6c FAIL: PRO-2026-0184 has % queued action requests, expected exactly 1', v_count;
  END IF;

  RAISE NOTICE
    'T6 PASS - ENG-0259 is PROPOSED for ORG-0114, whose proposal waits on one pending approval.';
END;
$t6$;

-- ── T7 · the money reconciles ───────────────────────────────────────────────
-- Total-from-lines is enforced by deferred constraint triggers that the seed
-- deliberately does NOT suspend, so these assertions are a second opinion on a
-- check that already ran. They are here because a seed that quietly disabled
-- them would otherwise look identical to one that satisfied them.
DO $t7$
DECLARE
  v_tenant uuid := 'acade111-0000-4000-8000-000000000001';
  v_bad    bigint;
  v_row    record;
BEGIN
  SELECT count(*) INTO v_bad
    FROM core.invoices i
   WHERE i.tenant_id = v_tenant
     AND i.subtotal_sen IS DISTINCT FROM (
       SELECT coalesce(sum(l.amount_sen), 0) FROM core.invoice_lines l WHERE l.invoice_id = i.id);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'T7a FAIL: % invoice header(s) do not equal the sum of their lines', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM core.quotations WHERE tenant_id = v_tenant AND below_floor;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'T7b FAIL: % quotation(s) sit below their floor', v_bad;
  END IF;

  -- The receivables ladder, against the fixture clock. These four figures are
  -- published by the fixture world's own aging report, so they check the bucket
  -- boundaries rather than merely restating whatever the function returned.
  FOR v_row IN
    SELECT code, outstanding_sen FROM core.receivables_aging(v_tenant, DATE '2026-11-14')
  LOOP
    IF (v_row.code = 'current'  AND v_row.outstanding_sen <> 6130000)
    OR (v_row.code = 'd1_30'    AND v_row.outstanding_sen <> 2270000)
    OR (v_row.code = 'd31_60'   AND v_row.outstanding_sen <> 3510000)
    OR (v_row.code = 'd60_plus' AND v_row.outstanding_sen <>  940000) THEN
      RAISE EXCEPTION 'T7c FAIL: aging bucket % is % sen, which is not what the fixture publishes',
        v_row.code, v_row.outstanding_sen;
    END IF;
  END LOOP;

  RAISE NOTICE
    'T7 PASS - every invoice equals its lines, no quotation is below floor, aging matches the fixture.';
END;
$t7$;

-- ── T8 · every gate the seed suspended was restored ─────────────────────────
DO $t8$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname || ':' || t.tgname, ', ' ORDER BY t.tgname)
    INTO v_left
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal
     AND n.nspname IN ('core', 'app', 'public')
     AND t.tgenabled <> 'O';

  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION
      'T8 FAIL: the seed left these triggers disabled: %. A database handed back '
      'with a state gate switched off has the product''s central control off, and '
      'nothing else would notice.', v_left;
  END IF;

  RAISE NOTICE 'T8 PASS - every trigger in core, app and public is enabled.';
END;
$t8$;

-- ── T9 · one tenant, and only one ───────────────────────────────────────────
-- A cross-tenant row in a fixture is how a cross-tenant read gets believed. The
-- seed writes one tenant; if a second appears, every RLS test built on this
-- data is measuring something other than what it claims.
DO $t9$
DECLARE
  v_tenant  uuid := 'acade111-0000-4000-8000-000000000001';
  v_tenants bigint;
  v_strays  bigint;
  v_table   text;
BEGIN
  SELECT count(*) INTO v_tenants FROM public.tenants;
  IF v_tenants <> 1 THEN
    RAISE EXCEPTION 'T9a FAIL: % tenants exist; the fixture world is one tenant', v_tenants;
  END IF;

  FOR v_table IN
    SELECT n.nspname || '.' || c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relkind = 'r' AND n.nspname IN ('core', 'app', 'public')
     ORDER BY 1
  LOOP
    -- Two things are not strays. A NULL tenant_id means the row is deliberately
    -- tenant-less: 009 models an HRD Corp rule as national by default, with
    -- optional tenant overrides. The all-zeros uuid is 011's sentinel for the
    -- global transition registry, which every tenant shares. The defect this
    -- looks for is a row belonging to a DIFFERENT REAL tenant.
    EXECUTE format(
      'SELECT count(*) FROM %s WHERE tenant_id IS NOT NULL '
      'AND tenant_id <> $1 AND tenant_id <> ''00000000-0000-0000-0000-000000000000''', v_table)
      INTO v_strays USING v_tenant;
    IF v_strays <> 0 THEN
      RAISE EXCEPTION 'T9b FAIL: % holds % row(s) outside the fixture tenant', v_table, v_strays;
    END IF;
  END LOOP;

  RAISE NOTICE 'T9 PASS - one tenant; no row in core, app or public belongs to another.';
END;
$t9$;

-- ── T10 · the seed is visible THROUGH the policies, not only to the loader ──
--
-- Everything above this point reads as the migration role, which on the shim is
-- a superuser and therefore sees past RLS. That proves rows exist. It does not
-- prove the product can read them, and after 014 those are different claims:
-- RLS is enabled and FORCED on all 137 tables, every policy resolves the
-- caller's tenant through app.current_tenant_id(), and a seed that wrote rows
-- no policy admits would look perfect here and serve an empty app.
--
-- So this becomes `authenticated` — the role itself, not the loader wearing its
-- claims — with Alex Selvarajah's JWT, and counts the same landmarks back. The
-- idiom is test_014's: probe outside a DO block, stash the verdicts in
-- transaction-local settings, RESET ROLE, and assert afterwards, so a failing
-- assertion cannot leave the session wearing a role it should not have.

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"acade111-0001-4000-8000-000000000001","role":"authenticated",'
  '"tenant_id":"acade111-0000-4000-8000-000000000001","app_role":"MD",'
  '"actor_kind":"HUMAN","aal":"aal1"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('pin.md_tenant',
  COALESCE(app.current_tenant_id()::text, ''), true);
SELECT pg_catalog.set_config('pin.md_counts', pg_catalog.jsonb_build_object(
  'organisations',     (SELECT count(*) FROM core.organisations),
  'engagements',       (SELECT count(*) FROM core.engagements),
  'participants',      (SELECT count(*) FROM core.participants),
  'certificates',      (SELECT count(*) FROM core.certificates),
  'invoices',          (SELECT count(*) FROM core.invoices),
  'approval_requests', (SELECT count(*) FROM core.approval_requests),
  'pipeline_steps',    (SELECT count(*) FROM core.pipeline_steps)
)::text, true);
RESET ROLE;

-- The same query, a member of a different tenant. A fixture world that is
-- readable cross-tenant is worse than one that is not readable at all, because
-- every RLS test built on it would pass while measuring nothing.
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated",'
  '"tenant_id":"00000000-0000-4000-8000-0000000000ff","app_role":"SALES",'
  '"actor_kind":"HUMAN","aal":"aal1"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('pin.other_counts', pg_catalog.jsonb_build_object(
  'organisations', (SELECT count(*) FROM core.organisations),
  'participants',  (SELECT count(*) FROM core.participants)
)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims', '', true);

DO $t10$
DECLARE
  v_tenant text  := pg_catalog.current_setting('pin.md_tenant', true);
  v_md     jsonb := pg_catalog.current_setting('pin.md_counts', true)::jsonb;
  v_other  jsonb := pg_catalog.current_setting('pin.other_counts', true)::jsonb;
  v_want   jsonb := '{"organisations":6,"engagements":10,"participants":136,'
                    '"certificates":78,"invoices":10,"approval_requests":7,'
                    '"pipeline_steps":16}'::jsonb;
BEGIN
  IF v_tenant IS DISTINCT FROM 'acade111-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION
      'T10a FAIL: app.current_tenant_id() resolved to % for the MD''s claims. '
      'Every policy predicate is built on it, so nothing below this means '
      'anything until it is right.', COALESCE(NULLIF(v_tenant, ''), '<null>');
  END IF;

  IF v_md IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION
      'T10b FAIL: through the 014 policies the MD sees %, expected %. The rows '
      'exist -- T1 to T7 read them as the loader -- so a difference here is a '
      'policy that does not admit them, and the app would render empty.',
      v_md::text, v_want::text;
  END IF;

  IF (v_other->>'organisations')::bigint <> 0 OR (v_other->>'participants')::bigint <> 0 THEN
    RAISE EXCEPTION
      'T10c FAIL: a member of another tenant read % organisation(s) and % '
      'participant(s) of this fixture world. A cross-tenant read is a '
      'product-ending defect, not a bug.',
      v_other->>'organisations', v_other->>'participants';
  END IF;

  RAISE NOTICE
    'T10 PASS - the whole fixture world reads back through the 014 policies as '
    'Alex Selvarajah, and is invisible to another tenant''s member.';
END;
$t10$;

DO $done$
BEGIN
  RAISE NOTICE 'test_fixture_world ALL PASS (T0-T10, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
