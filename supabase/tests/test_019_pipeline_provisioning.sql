-- ═══════════════════════════════════════════════════════════════════════════
-- test_019 · Per-tenant pipeline provisioning
-- ═══════════════════════════════════════════════════════════════════════════
--
-- AN AUTHORED PIN THAT WAS NEVER RUN IS NOT A PIN. This file was executed
-- against a PostgreSQL 17.11 shim with 001-019 applied, and its output was read,
-- before it was committed. It ends in ROLLBACK and writes nothing durable.
--
-- HOW TO RUN IT:
--   psql "<shim>" -v ON_ERROR_STOP=1 -f supabase/tests/test_019_pipeline_provisioning.sql
--
-- WHAT IT PROVES: that a tenant insert provisions two pipelines and sixteen
-- steps with the derived ids the seeds lane shares, in the contract's order,
-- with three terminal stages; that re-seeding writes nothing; that the backfill
-- RAISES and NAMES every tenant it could not seed rather than warning; and that
-- the seed is REVERSIBLE — the ledger records exactly what was inserted,
-- `app.unseed_pipelines` deletes exactly that, refuses loudly with a count and
-- the blocking constraint names when live data references a seeded row, and
-- deletes nothing when it refuses.
--
-- WHAT IT DOES NOT PROVE: behaviour under 014's RLS from a client role, and
-- `app.provision_tenant` actually refusing a tenant whose registered seeds did
-- not land — the registry row is asserted to exist, not to be enforced.
--
-- FIXTURES. Minimal on purpose: this pack's subject is tenants and pipeline
-- rows, so the fixture is tenants. The referencing fixture in T3 needs an
-- organisation, a programme and an engagement, which are built here rather than
-- borrowed, so this pin does not depend on another pack's fixture surviving.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000019-0000-0000-0000-0000000000a1','t019-owner@example.invalid');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('00000019-1111-4111-8111-111111111111','t019','Provisioning Tenant','ACTIVE',
   'Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.user_profiles (tenant_id, user_id, display_name, email, locale, timezone, theme)
VALUES ('00000019-1111-4111-8111-111111111111','00000019-0000-0000-0000-0000000000a1',
        'T019 Owner','t019-owner@example.invalid','en-MY','Asia/Kuala_Lumpur','LIGHT');

DO $banner$ BEGIN RAISE NOTICE '════════ T1 · a tenant insert provisions a lifecycle ════════'; END $banner$;
DO $t1$
DECLARE
  v_tenant uuid := 'acade111-0000-4000-8000-000000000001';
  v_n integer; v_id uuid; v_labels text[]; v_pos smallint[];
BEGIN
  -- A BRAND NEW TENANT RENDERS A PIPELINE. That is the defect 016 deferred
  -- ("until then a new tenant renders no pipeline") and this is the assertion
  -- that it is closed. The tenant is inserted plainly: the seed has to ride the
  -- provisioning trigger, not a helper the caller has to remember.
  INSERT INTO public.tenants (id, slug, name, status, timezone, locale)
  VALUES (v_tenant,'akademi-perdana','Akademi Perdana','ACTIVE','Asia/Kuala_Lumpur','en-MY');

  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM core.pipelines WHERE tenant_id = v_tenant;
  IF v_n <> 2 THEN RAISE EXCEPTION 'T1a: expected 2 seeded pipelines, got %', v_n; END IF;

  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM core.pipeline_steps WHERE tenant_id = v_tenant;
  IF v_n <> 16 THEN RAISE EXCEPTION 'T1b: expected 16 seeded steps, got %', v_n; END IF;

  -- THE IDS ARE THE AGREED DERIVED EXPRESSION, not literals. A literal agrees
  -- with itself while disagreeing with the seeds lane; the expression is the
  -- thing both packs compute, so the assertion is made against the expression.
  -- `core.engagement_step_states` FKs `(tenant_id, pipeline_step_id)`, and PR
  -- #16 writes 90 of those rows — if the two packs derived different ids, one
  -- of the two loads would fail on that foreign key.
  SELECT id INTO v_id FROM core.pipelines
   WHERE tenant_id = v_tenant AND object = 'ENGAGEMENT';
  IF v_id <> pg_catalog.md5(v_tenant::text || 'pipeline:ENGAGEMENT')::uuid THEN
    RAISE EXCEPTION 'T1c: the ENGAGEMENT pipeline id is not the derived one';
  END IF;

  -- WON IS A STAGE OF BOTH PIPELINES, which is why the name carries the object.
  -- Without it both rows derive the SAME id and the second insert is a primary
  -- key violation. Asserting the two are different is asserting the fix.
  -- T1d USED TO COMPARE THE `id` OF TWO DISTINCT ROWS FOR EQUALITY. `id` is
  -- the primary key (004:639), so two rows that both exist can never share one
  -- and the assertion could not fail — as the comment above it already admitted,
  -- the real failure aborts at the seed with a PK violation before this line
  -- runs. What is actually worth pinning is that each id IS THE DERIVED ONE
  -- FOR ITS OWN OBJECT: `md5(tenant || 'pipeline:' || object || ':' || key)`.
  -- That is falsifiable — drop the object from the derivation and both sides
  -- become the same value and this fails, which is the defect the comment
  -- describes.
  IF (SELECT step.id FROM core.pipeline_steps AS step
        JOIN core.pipelines AS pipe ON pipe.tenant_id = step.tenant_id AND pipe.id = step.pipeline_id
       WHERE step.tenant_id = v_tenant AND step.step_key = 'WON' AND pipe.object = 'ENGAGEMENT')
     IS DISTINCT FROM pg_catalog.md5(v_tenant::text || 'pipeline:ENGAGEMENT:WON')::uuid
     OR (SELECT step.id FROM core.pipeline_steps AS step
           JOIN core.pipelines AS pipe ON pipe.tenant_id = step.tenant_id AND pipe.id = step.pipeline_id
          WHERE step.tenant_id = v_tenant AND step.step_key = 'WON' AND pipe.object = 'OPPORTUNITY')
     IS DISTINCT FROM pg_catalog.md5(v_tenant::text || 'pipeline:OPPORTUNITY:WON')::uuid THEN
    RAISE EXCEPTION 'T1d: a WON stage id is not derived from its own object — the pipeline '
                    'object is missing from the derivation';
  END IF;
  IF (SELECT id FROM core.pipeline_steps
       WHERE tenant_id = v_tenant AND step_key = 'WON' AND position = 1)
     <> pg_catalog.md5(v_tenant::text || 'pipeline:ENGAGEMENT:WON')::uuid THEN
    RAISE EXCEPTION 'T1e: ENGAGEMENT:WON is not the derived id';
  END IF;

  -- Order and labels come from the rows, and the positions are 1..N dense:
  -- core.pipeline_steps is UNIQUE on (tenant_id, pipeline_id, position) as well
  -- as on step_key, so the seeds lane and this pack have to agree on BOTH.
  SELECT pg_catalog.array_agg(step.step_key ORDER BY step.position),
         pg_catalog.array_agg(step.position ORDER BY step.position)
    INTO v_labels, v_pos
    FROM core.pipeline_steps AS step
    JOIN core.pipelines AS pipeline
      ON pipeline.tenant_id = step.tenant_id AND pipeline.id = step.pipeline_id
   WHERE step.tenant_id = v_tenant AND pipeline.object = 'ENGAGEMENT';
  IF v_labels <> ARRAY['WON','TRAINER_CONFIRMED','SCHEDULED','REGISTERED','DELIVERED',
                       'ATTENDANCE_LOCKED','HRDC_CLAIM','INVOICED','PAID'] THEN
    RAISE EXCEPTION 'T1f: the ENGAGEMENT lifecycle is not the contract order: %', v_labels;
  END IF;
  IF v_pos <> ARRAY[1,2,3,4,5,6,7,8,9]::smallint[] THEN
    RAISE EXCEPTION 'T1g: positions are not 1..9 dense: %', v_pos;
  END IF;

  -- Terminal is stored per ruling R16: PAID ends delivery, WON and LOST end a
  -- deal and sit beside each other.
  IF (SELECT pg_catalog.count(*) FROM core.pipeline_steps
       WHERE tenant_id = v_tenant AND terminal) <> 3 THEN
    RAISE EXCEPTION 'T1h: expected exactly three terminal stages';
  END IF;

  -- IDEMPOTENT. ON CONFLICT (id) DO NOTHING, so the fixture seed's own rows
  -- survive whichever of the two packs loads first.
  IF app.seed_pipelines(v_tenant) <> 0 THEN
    RAISE EXCEPTION 'T1i: re-seeding wrote rows; the fixture seed would be overwritten';
  END IF;

  -- DEAL_CHAIN IS NOT SEEDED AND CANNOT BE. 004's CHECK admits only
  -- ENGAGEMENT, OPPORTUNITY and PACKET. Pinned so the day 004 is reconciled
  -- with the contract, this says so.
  BEGIN
    INSERT INTO core.pipelines (tenant_id, object, name, is_default, status,
                                created_by_kind, created_by_id)
    VALUES (v_tenant,'DEAL_CHAIN','Deal chain',false,'ACTIVE','SYSTEM','test');
    RAISE EXCEPTION 'T1j: DEAL_CHAIN now inserts — 004 and the contract have been '
                    'reconciled; seed the six-step chain and drop this pin';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'T1 PASS: a new tenant is provisioned 2 pipelines and 16 steps with '
               'derived ids that match the seeds lane, positions 1..N dense, three '
               'terminal stages, idempotent re-seed, DEAL_CHAIN still unstorable.';
END
$t1$;

DO $banner$ BEGIN RAISE NOTICE '════════ T2 · THE BACKFILL FAILS LOUDLY, NOT INTO A WARNING ════════'; END $banner$;
DO $t2$
DECLARE
  v_tenant uuid := '00000019-1111-4111-8111-111111111111';
  v_naked  uuid := '77777777-7777-4777-8777-777777777777';
  v_total  integer;
  v_detail text;
  v_ok     boolean := false;
BEGIN
  -- A CLEAN RUN STILL RETURNS A COUNT. Every tenant here was provisioned by
  -- the trigger, so re-seeding writes nothing and the invariant already holds.
  v_total := app.seed_pipelines_all();
  IF v_total <> 0 THEN
    RAISE EXCEPTION 'T2a: re-seeding wrote % rows over already-seeded tenants', v_total;
  END IF;

  -- ── THE BLOCKER. A tenant with no PIP ref_format ─────────────────────────
  -- The backfill caught `foreign_key_violation` and turned it into
  -- `RAISE WARNING '... pipelines not seeded'`, then finished green. That
  -- tenant has no `core.pipeline_steps` rows, and `core.navigation` and
  -- `core.get_pipeline_config` render stages FROM those rows — so its shell
  -- opened on an empty stage list that looks like configuration rather than
  -- like a failed migration. A WARNING in a migration log is not a channel
  -- anyone reads afterwards.
  --
  -- 016 seeds ref formats from its own AFTER INSERT trigger, so a tenant in
  -- this state has to be constructed: insert one, then take its PIP format and
  -- its pipelines away, which is exactly the shape of a tenant that predates
  -- 016's backfill.
  --
  -- AGAINST THE PRE-FIX MIGRATION THIS ASSERTION FAILS WITH "function
  -- app.seed_pipelines_all() does not exist", and that is not an accident of
  -- the fix: the loop was INLINE IN A `DO` BLOCK, where nothing can call it and
  -- therefore nothing can assert it. Running that same inline block against
  -- this fixture is what shows the behaviour directly:
  --
  --   WARNING: 018 backfill: tenant 7777... has no PIP ref_format; not seeded.
  --   NOTICE:  018 backfill: 0 pipeline and step row(s) seeded
  --   018 completed; pipeline_steps for the unseeded tenant = 0
  --
  -- Green, with a tenant left with no pipeline configuration at all.
  INSERT INTO public.tenants (id, slug, name, status, timezone, locale)
  VALUES (v_naked, 'naked', 'Predates 016', 'ACTIVE', 'Asia/Kuala_Lumpur', 'en-MY');
  DELETE FROM core.pipeline_steps WHERE tenant_id = v_naked;
  DELETE FROM core.pipelines      WHERE tenant_id = v_naked;
  DELETE FROM core.ref_formats    WHERE tenant_id = v_naked AND prefix = 'PIP';

  BEGIN
    PERFORM app.seed_pipelines_all();
  EXCEPTION WHEN foreign_key_violation THEN
    v_ok := true;
    GET STACKED DIAGNOSTICS v_detail = MESSAGE_TEXT;
    -- The message NAMES THE TENANT. "Some tenant somewhere was skipped" is not
    -- actionable; the operator has to know which ref_formats to seed.
    IF pg_catalog.strpos(v_detail, v_naked::text) = 0 THEN
      RAISE EXCEPTION 'T2b: the refusal does not name the unseeded tenant: %', v_detail;
    END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'T2c: the backfill reported SUCCESS with a tenant left unseeded — '
                    'its navigation renders an empty stage list and nothing says so';
  END IF;

  -- GIVE IT BACK ITS REF FORMAT AND THE SAME CALL SUCCEEDS. The refusal is
  -- about the missing configuration, not about the tenant.
  INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width, gapless)
  SELECT v_naked, format.prefix, format.entity, format.dated, format.width, format.gapless
    FROM core.ref_formats AS format
   WHERE format.tenant_id = v_tenant AND format.prefix = 'PIP';

  v_total := app.seed_pipelines_all();
  IF v_total < 1 THEN
    RAISE EXCEPTION 'T2c2: the unseeded tenant was still not seeded after its ref '
                    'format came back';
  END IF;

  -- AND THE INVARIANT THE BACKFILL EXISTS FOR IS STATED AS ONE. Every tenant
  -- has both default pipelines and their steps.

  IF EXISTS (
    SELECT 1 FROM public.tenants AS t
     WHERE NOT EXISTS (SELECT 1 FROM core.pipelines AS p
                        WHERE p.tenant_id = t.id AND p.object = 'ENGAGEMENT')
        OR NOT EXISTS (SELECT 1 FROM core.pipeline_steps AS s
                        WHERE s.tenant_id = t.id)) THEN
    RAISE EXCEPTION 'T2d: a tenant has no pipeline configuration after the backfill';
  END IF;

  RAISE NOTICE 'T2 PASS: the backfill raises and names every tenant it could not seed, '
               'and every tenant ends the migration with a pipeline configuration.';
END
$t2$;

DO $banner$ BEGIN RAISE NOTICE '════════ T3 · THE SEED IS REVERSIBLE, EXACTLY ════════'; END $banner$;
DO $t3$
DECLARE
  v_tenant  uuid := '00000019-1111-4111-8111-111111111111';
  v_fresh   uuid := 'a9a9a9a9-9999-4999-8999-999999999999';
  v_pipes   integer;
  v_steps   integer;
  v_ledger  integer;
  v_hand    uuid;
  v_removed integer;
  v_detail  text;
  v_ok      boolean := false;
  v_prog    uuid;
  v_org     uuid;
BEGIN
  -- ── THE LEDGER RECORDS WHAT THE SEED ACTUALLY INSERTED ───────────────────
  -- Before `app.seeded_pipelines` existed, rolling the seed back dropped the
  -- mechanism and KEPT the rows, so `pipelines_one_default_uq` went on
  -- rejecting a default ENGAGEMENT pipeline for every tenant permanently and
  -- there was no supported way to undo the seed at all. The ledger is what
  -- makes "delete exactly what the seed wrote, and nothing else" expressible.
  INSERT INTO public.tenants (id, slug, name, status, timezone, locale)
  VALUES (v_fresh, 't39', 'Reversal', 'ACTIVE', 'Asia/Kuala_Lumpur', 'en-MY');

  SELECT pg_catalog.count(*) INTO v_pipes FROM core.pipelines WHERE tenant_id = v_fresh;
  SELECT pg_catalog.count(*) INTO v_steps FROM core.pipeline_steps WHERE tenant_id = v_fresh;
  IF v_pipes <> 2 OR v_steps <> 16 THEN
    RAISE EXCEPTION 'T3a: the trigger seeded %/% rather than 2/16', v_pipes, v_steps;
  END IF;

  SELECT pg_catalog.count(*) INTO v_ledger FROM app.seeded_pipelines WHERE tenant_id = v_fresh;
  IF v_ledger <> 18 THEN
    RAISE EXCEPTION 'T3b: the ledger holds % rows for a tenant the seed gave 18', v_ledger;
  END IF;
  -- AND IT RECORDS NOTHING ELSE. Every ledger row names a row that exists.
  IF EXISTS (
    SELECT 1 FROM app.seeded_pipelines AS ledger
     WHERE (ledger.row_kind = 'PIPELINE'
            AND NOT EXISTS (SELECT 1 FROM core.pipelines AS p
                             WHERE p.tenant_id = ledger.tenant_id AND p.id = ledger.row_id))
        OR (ledger.row_kind = 'STEP'
            AND NOT EXISTS (SELECT 1 FROM core.pipeline_steps AS st
                             WHERE st.tenant_id = ledger.tenant_id AND st.id = ledger.row_id))) THEN
    RAISE EXCEPTION 'T3c: the ledger names a row that does not exist';
  END IF;

  -- ── A ROW 018 DID NOT WRITE IS NOT 018'S TO DELETE ───────────────────────
  -- The seed is ON CONFLICT (id) DO NOTHING, so a row that already existed
  -- under the same derived id was never inserted and never recorded. This is
  -- the case the old keep-everything design was protecting; it is protected by
  -- construction now. A hand-made non-default pipeline stands for it.
  INSERT INTO core.pipelines (tenant_id, object, name, is_default, status,
                              created_by_kind, created_by_id)
  VALUES (v_fresh, 'OPPORTUNITY', 'A pipeline the tenant made', false, 'ACTIVE',
          'HUMAN', '00000019-0000-0000-0000-0000000000a1')
  RETURNING id INTO v_hand;
  IF EXISTS (SELECT 1 FROM app.seeded_pipelines WHERE row_id = v_hand) THEN
    RAISE EXCEPTION 'T3d: a hand-made pipeline was recorded as 019''s';
  END IF;

  -- ── THE REFUSAL PATH ─────────────────────────────────────────────────────
  -- `core.engagements` carries an ON DELETE RESTRICT composite key onto
  -- `core.pipelines` (008:108). Once live data points at a seeded row, the seed
  -- can no longer be reversed, and the honest answer is a refusal that says how
  -- many rows and which constraints — not a silent skip, and not a deletion.
  -- Built here rather than borrowed, so this pin does not depend on another
  -- pack's fixture surviving a reordering of the suite.
  INSERT INTO core.organisations
    (tenant_id, name, industry, location, owner_id, status, hrdc_registered, country_code)
  VALUES (v_tenant, 'Referencing Co', 'MANUFACTURING', 'Shah Alam',
          '00000019-0000-0000-0000-0000000000a1', 'ACTIVE_CLIENT', false, 'MYS')
  RETURNING id INTO v_org;
  INSERT INTO core.programmes
    (tenant_id, name, category, days, status, list_price_sen, list_price_pax,
     floor_price_sen, floor_margin_rate, created_by_kind, created_by_id)
  VALUES (v_tenant, 'Referencing Programme', 'LEADERSHIP', 2, 'ACTIVE',
          3600000, 20, 2800000, 0.3000, 'HUMAN', '00000019-0000-0000-0000-0000000000a1')
  RETURNING id INTO v_prog;
  INSERT INTO core.engagements (tenant_id, organisation_id, programme_id, owner_id,
                                pipeline_id, title, status, starts_on, ends_on, value_sen)
  VALUES (v_tenant, v_org, v_prog, '00000019-0000-0000-0000-0000000000a1',
          pg_catalog.md5(v_tenant::text || 'pipeline:ENGAGEMENT')::uuid,
          'Holds the seeded pipeline down', 'PROPOSED', '2026-11-12', '2026-11-13', 1850000);

  BEGIN
    PERFORM app.unseed_pipelines();
    RAISE EXCEPTION 'T3e: unseed_pipelines deleted a pipeline a live engagement '
                    'references, or reported success without deleting it';
  EXCEPTION WHEN foreign_key_violation THEN
    v_ok := true;
    GET STACKED DIAGNOSTICS v_detail = MESSAGE_TEXT;
    -- THE COUNT AND THE CONSTRAINT ARE IN THE MESSAGE. "Something references
    -- them" is not an instruction anybody can act on.
    IF pg_catalog.strpos(v_detail, 'engagements_pipeline_fk') = 0 THEN
      RAISE EXCEPTION 'T3f: the refusal does not name the blocking constraint: %', v_detail;
    END IF;
    IF v_detail !~ '[1-9][0-9]* row\(s\) are referenced' THEN
      RAISE EXCEPTION 'T3g: the refusal does not carry a referencing count: %', v_detail;
    END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'T3h: the refusal path did not fire';
  END IF;

  -- AND IT DELETED NOTHING. All-or-nothing is the property that makes the
  -- refusal safe to hit: a half-reversed seed is worse than an unreversed one.
  SELECT pg_catalog.count(*) INTO v_ledger FROM app.seeded_pipelines;
  IF v_ledger = 0 THEN
    RAISE EXCEPTION 'T3i: the ledger was emptied by a call that refused';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.pipeline_steps WHERE tenant_id = v_fresh) <> 16 THEN
    RAISE EXCEPTION 'T3j: a refused unseed still deleted steps';
  END IF;

  -- ── AND THE SUCCESS PATH, ONCE NOTHING REFERENCES THEM ───────────────────
  DELETE FROM core.engagements WHERE tenant_id = v_tenant
     AND pipeline_id = pg_catalog.md5(v_tenant::text || 'pipeline:ENGAGEMENT')::uuid;

  v_removed := app.unseed_pipelines();
  IF v_removed < 18 THEN
    RAISE EXCEPTION 'T3k: unseed removed only % rows', v_removed;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.pipelines WHERE tenant_id = v_fresh AND id <> v_hand) <> 0
     OR (SELECT pg_catalog.count(*) FROM core.pipeline_steps WHERE tenant_id = v_fresh) <> 0 THEN
    RAISE EXCEPTION 'T3l: seeded rows survived a successful unseed';
  END IF;
  -- THE HAND-MADE ROW IS STILL THERE. This is the assertion that separates
  -- "reverse the seed" from "empty the table".
  IF NOT EXISTS (SELECT 1 FROM core.pipelines WHERE id = v_hand) THEN
    RAISE EXCEPTION 'T3m: unseed deleted a pipeline 018 never wrote';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM app.seeded_pipelines) <> 0 THEN
    RAISE EXCEPTION 'T3n: the ledger was not cleared after a successful unseed';
  END IF;

  -- AND THE CONSTRAINT THAT WAS PERMANENTLY BLOCKED IS FREE AGAIN. This is
  -- B6's actual complaint, asserted rather than described: before the reversal
  -- existed, pipelines_one_default_uq rejected a default ENGAGEMENT pipeline
  -- for every tenant for ever after a rollback.
  INSERT INTO core.pipelines (tenant_id, object, name, is_default, status,
                              created_by_kind, created_by_id)
  VALUES (v_fresh, 'ENGAGEMENT', 'Made after the reversal', true, 'ACTIVE',
          'HUMAN', '00000019-0000-0000-0000-0000000000a1');

  -- ── AND THE SEED IS REGISTERED WITH 016'S COMPLETENESS GUARD ─────────────
  -- This is the FOURTH provisioning trigger on public.tenants, and
  -- app.provision_tenant refuses a tenant whose registered seeds did not all
  -- land. A trigger that is not registered is a trigger whose silent failure
  -- the guard exists to catch and does not. Guarded on the registry's
  -- existence, because it is not on every base this file has to run against —
  -- and the ELSE branch is an assertion too: it records the obligation rather
  -- than letting the check quietly evaporate.
  IF pg_catalog.to_regclass('app.tenant_seed_checks') IS NOT NULL THEN
    IF (SELECT pg_catalog.count(*) FROM app.tenant_seed_checks
         WHERE pack = '019'
           AND (schema_name, table_name) IN (('core','pipelines'),('core','pipeline_steps'))) <> 2 THEN
      RAISE EXCEPTION 'T3o: 019''s pipeline seed is not registered in '
                      'app.tenant_seed_checks, so provision_tenant would return a '
                      'tenant with no lifecycle and call it provisioned';
    END IF;
  ELSE
    RAISE NOTICE 'T3: app.tenant_seed_checks is absent on this base — the pipeline '
                 'seed registration is OWED when 016''s registry lands.';
  END IF;

  RAISE NOTICE 'T3 PASS: the ledger records exactly what the seed inserted, unseed '
               'refuses with a count and the constraint name while live data points at '
               'a seeded row and deletes nothing when it does, and on the clear path it '
               'removes the seed exactly and leaves a hand-made pipeline standing.';
END
$t3$;

DO $banner$ BEGIN RAISE NOTICE '════════ ALL ASSERTIONS EXECUTED — rolling back, nothing durable ════════'; END $banner$;
ROLLBACK;
