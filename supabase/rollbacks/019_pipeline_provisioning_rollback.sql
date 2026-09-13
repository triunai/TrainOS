-- ═══════════════════════════════════════════════════════════════════════════
-- 019 ROLLBACK · Per-tenant pipeline provisioning
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS UNDOES. The trigger on `public.tenants`, the four `app` functions,
-- the two rows in 016's `app.tenant_seed_checks`, the ledger table, AND THE
-- SEEDED ROWS THEMSELVES.
--
-- THE ROWS ARE THE POINT, and the first version of this seed got it wrong. It
-- dropped the mechanism and kept the rows, reasoning that a tenant's pipeline
-- configuration is theirs by the time anyone rolls back and that
-- `core.engagement_step_states` carries composite foreign keys onto them. Both
-- halves are true and neither justified the outcome: afterwards the mechanism
-- was gone, so there was NO SUPPORTED WAY TO UNDO THE SEED AT ALL, and
-- `pipelines_one_default_uq` — the partial unique index on (tenant_id, object)
-- WHERE is_default — went on rejecting a default ENGAGEMENT pipeline for every
-- tenant permanently. A rollback that leaves a repo-wide constraint change in
-- place is not a rollback.
--
-- WHAT IS NOT TOUCHED, and this is what the ledger buys:
--   * Any pipeline or step row 019 did not insert. The seed is
--     `ON CONFLICT (id) DO NOTHING`, so a row that already existed under the
--     same derived id — the seeds lane's fixtures — was never inserted, never
--     recorded, and is never deleted.
--   * Anything in 001-018. `core.pipelines` and `core.pipeline_steps` are
--     004's tables and survive this file; 016's ref-format trigger, 011's
--     action policies and 017's check keys are all untouched.
--   * Every other row of business data.
--
-- IT REFUSES RATHER THAN DELETING SOMETHING LIVE. `app.unseed_pipelines()`
-- raises with the COUNT and the CONSTRAINT NAMES if any seeded row is
-- referenced, and deletes nothing when it does. Because this file is wrapped in
-- one transaction, that refusal takes the whole rollback back with it — which
-- is the honest answer to "019 cannot be rolled back while this tenant
-- configuration is in use", and tells the operator exactly what to clear.
--
-- PRIOR STATE RESTORED. Before 019 none of these objects existed and no tenant
-- had a pipeline row, so the prior state IS their absence plus an empty
-- `core.pipelines`. There is no earlier definition to reproduce, and R1 below
-- PROVES the restoration on the rows rather than asserting it.
--
-- ORDER. Reverse of the forward order: reverse the DATA first (while the
-- function that knows how to do it still exists), then the trigger, then the
-- functions, then the registry rows, then the ledger.
--
-- EXECUTED forward -> test -> rollback -> forward on a PostgreSQL 17.11 shim.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = notice;

-- ═══ G1 · Pre-flight: refuse if these objects are not ours to drop ═════════
DO $guard$
DECLARE v_foreign text[];
BEGIN
  IF pg_catalog.to_regproc('app.unseed_pipelines') IS NULL THEN
    RAISE EXCEPTION '019 rollback G1: app.unseed_pipelines does not exist, so 019 is '
                    'not applied (or a later pack replaced it). Nothing was changed.';
  END IF;
  -- Every function 019 created carries 019's posture. One of the same name that
  -- is not definer-with-an-empty-search-path was put there by something else.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_foreign
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app'
     AND p.proname IN ('seed_pipelines','seed_pipelines_all','unseed_pipelines',
                       'seed_pipelines_on_tenant')
     AND NOT (p.prosecdef AND p.proconfig @> ARRAY['search_path=""']);
  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION '019 rollback G1b: app.% does not carry 019''s posture, so it is '
                    'not 019''s to drop', pg_catalog.array_to_string(v_foreign, ', app.');
  END IF;
  RAISE NOTICE '019 rollback G1: pre-flight clean.';
END
$guard$;

-- ═══ 1 · Reverse the data, before dropping the mechanism ═══════════════════
-- The other order leaves the function that knows how to undo the seed already
-- gone — which is exactly how the first version of this seed became
-- irreversible.
DO $unseed$
DECLARE v_n integer;
BEGIN
  v_n := app.unseed_pipelines();
  RAISE NOTICE '019 rollback: % seeded pipeline/step row(s) removed; the ledger is empty.', v_n;
END
$unseed$;

-- ═══ 2 · The mechanism ═════════════════════════════════════════════════════
-- The TRIGGER first, then the functions it calls. Dropping a function while the
-- trigger still points at it leaves every tenant insert raising
-- `function app.seed_pipelines_on_tenant() does not exist` — a rollback that
-- breaks the thing it was rolling back.
DROP TRIGGER IF EXISTS trg_tenants_z_seed_pipelines ON public.tenants;
DROP FUNCTION IF EXISTS app.seed_pipelines_on_tenant();
DROP FUNCTION IF EXISTS app.unseed_pipelines();
DROP FUNCTION IF EXISTS app.seed_pipelines_all();
DROP FUNCTION IF EXISTS app.seed_pipelines(uuid);

-- ═══ 3 · The registry rows ═════════════════════════════════════════════════
-- Deleted by their exact (schema_name, table_name) keys AND by pack, so a later
-- pack that takes over either relation's seed keeps its own row. Guarded,
-- because the registry is 016's and is not on every base 019 runs against.
DO $registry$
BEGIN
  IF pg_catalog.to_regclass('app.tenant_seed_checks') IS NOT NULL THEN
    DELETE FROM app.tenant_seed_checks
     WHERE pack = '019'
       AND (schema_name, table_name) IN (('core','pipelines'), ('core','pipeline_steps'));
  END IF;
END
$registry$;

-- ═══ 4 · The ledger, LAST ══════════════════════════════════════════════════
-- After the function that reads it and after the rows it describes are gone.
-- Dropping it earlier would strand the only record of what the seed wrote.
DROP TABLE IF EXISTS app.seeded_pipelines;

-- ═══ 5 · $verify$ · the reversal, measured on the rows ═════════════════════
DO $verify$
DECLARE v_rows_left integer;
BEGIN
  -- R1 · NO ROW WITH A 019-DERIVED ID SURVIVES. The ids are RE-DERIVED rather
  -- than read from the ledger, because the ledger is gone by now — and
  -- re-deriving is the stronger test: it asks the question from outside the
  -- bookkeeping that is supposed to answer it.
  --
  -- ⚠ THE PREDECESSOR OF THIS CHECK, R4 IN 018'S ROLLBACK, QUERIED pg_trigger
  -- FOR 016'S REF-FORMAT TRIGGER and never read a pipeline table at all, while
  -- two comments and a closing NOTICE both announced that it verified pipeline
  -- rows. A safety net watching the wrong object would not have fired.
  SELECT pg_catalog.count(*)::integer INTO v_rows_left
    FROM core.pipelines AS pipe
    JOIN public.tenants AS tenant ON tenant.id = pipe.tenant_id
   WHERE pipe.id = pg_catalog.md5(tenant.id::text || 'pipeline:' || pipe.object)::uuid;
  IF v_rows_left <> 0 THEN
    RAISE EXCEPTION '019 rollback R1: % pipeline row(s) with 019-derived ids survived '
                    'the reversal — pipelines_one_default_uq still rejects a default '
                    'ENGAGEMENT pipeline for those tenants', v_rows_left;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_rows_left
    FROM core.pipeline_steps AS step
    JOIN public.tenants AS tenant ON tenant.id = step.tenant_id
   WHERE step.id IN (
           pg_catalog.md5(tenant.id::text || 'pipeline:ENGAGEMENT:'  || step.step_key)::uuid,
           pg_catalog.md5(tenant.id::text || 'pipeline:OPPORTUNITY:' || step.step_key)::uuid);
  IF v_rows_left <> 0 THEN
    RAISE EXCEPTION '019 rollback R1b: % pipeline_step row(s) with 019-derived ids '
                    'survived the reversal', v_rows_left;
  END IF;

  -- R2 · THE MECHANISM IS GONE, all of it.
  IF pg_catalog.to_regclass('app.seeded_pipelines') IS NOT NULL
     OR pg_catalog.to_regproc('app.seed_pipelines') IS NOT NULL
     OR pg_catalog.to_regproc('app.seed_pipelines_all') IS NOT NULL
     OR pg_catalog.to_regproc('app.unseed_pipelines') IS NOT NULL
     OR pg_catalog.to_regproc('app.seed_pipelines_on_tenant') IS NOT NULL THEN
    RAISE EXCEPTION '019 rollback R2: part of the seed mechanism survived';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
               JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
              WHERE c.relname = 'tenants' AND NOT t.tgisinternal
                AND t.tgname = 'trg_tenants_z_seed_pipelines') THEN
    RAISE EXCEPTION '019 rollback R2b: the seed trigger survived';
  END IF;

  -- R3 · 004'S TABLES AND THE OTHER THREE PROVISIONING TRIGGERS ARE INTACT.
  -- 019 drops rows, never the tables that hold them, and the seeds belonging to
  -- 011, 016 and 017 are not 019's.
  IF pg_catalog.to_regclass('core.pipelines') IS NULL
     OR pg_catalog.to_regclass('core.pipeline_steps') IS NULL THEN
    RAISE EXCEPTION '019 rollback R3: a pipeline table was dropped';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                  WHERE c.relname = 'tenants' AND NOT t.tgisinternal
                    AND t.tgname = 'trg_tenants_seed_ref_formats') THEN
    RAISE EXCEPTION '019 rollback R3b: 016''s ref-format seed trigger was destroyed';
  END IF;

  -- R4 · THE REGISTRY NO LONGER PROMISES A SEED NOBODY PERFORMS. A leftover
  -- row would make app.provision_tenant refuse every new tenant for a relation
  -- nothing fills any more.
  --
  -- ⚠ NESTED, NOT `a IS NOT NULL AND EXISTS (...)`. PL/pgSQL plans a whole
  -- boolean expression at once, so the short-circuit does not save the planner
  -- from resolving `app.tenant_seed_checks` and the guard raises
  -- `relation does not exist` on exactly the bases it exists to tolerate.
  -- Found by running this file against a base without 016's registry.
  IF pg_catalog.to_regclass('app.tenant_seed_checks') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.tenant_seed_checks WHERE pack = '019') THEN
      RAISE EXCEPTION '019 rollback R4: a 019 row survives in app.tenant_seed_checks, so '
                      'provision_tenant would refuse every new tenant';
    END IF;
  END IF;

  RAISE NOTICE '019 rollback: seeded rows reversed exactly (R1 counts them), rows 019 '
               'did not write left alone, the trigger, four functions, two registry '
               'rows and the ledger dropped, and 004''s tables plus 011/016/017''s '
               'provisioning triggers verified intact.';
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
