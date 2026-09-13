-- ═══════════════════════════════════════════════════════════════════════════
-- 019 · Per-tenant pipeline provisioning
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DEFECT. A tenant has no lifecycle. `core.pipelines` and `core.pipeline_steps`
-- exist from 004 and NOTHING IN 001-018 PUTS A ROW IN EITHER. 016 saw it and
-- named the owner rather than doing it in a file about ref formats:
--
--   "Seeding them here means writing fifteen stage names into a migration,
--    which is the exact defect the rule names, and doing it in a file about ref
--    formats. It belongs in a pack that can cite `docs/architecture/01` §5.3
--    per row. **Owner: 018 or a dedicated seed pack.**
--    ⚠ Until then a new tenant renders no pipeline."
--
-- 018 took it and should not have. A provisioning trigger plus a cross-tenant
-- backfill is a repo-wide semantic change, and shipping it as a subsection of a
-- file whose stated subject is read and write RPCs put its irreversibility in a
-- footnote instead of under review. The cost was measurable: a default
-- ENGAGEMENT pipeline per tenant collides with `pipelines_one_default_uq` in
-- four earlier packs' fixtures. This is the dedicated seed pack 016 asked for.
--
-- CHANGE. One table (`app.seeded_pipelines`), four functions
-- (`seed_pipelines`, `seed_pipelines_all`, `unseed_pipelines`,
-- `seed_pipelines_on_tenant`), one trigger on `public.tenants`, two rows in
-- 016's `app.tenant_seed_checks` registry, and a backfill across existing
-- tenants. No enum value. No existing function, view, policy or grant is
-- modified. EXISTING DATA IS MODIFIED, deliberately and reversibly — that is
-- the entire subject of this file.
--
-- THE RULE 016 IS PROTECTING IS NOT "NEVER WRITE A STAGE NAME IN SQL" — it is
-- "stage names and order RENDER from `pipeline_steps` rows", and something has
-- to put the rows there. `core.pipelines` / `core.pipeline_steps` IS the
-- configuration; this seeds a tenant's DEFAULT configuration once, and every
-- reader still renders from the rows. Every stage name below carries its
-- citation on its own line.
--
-- ── DEPLOY ORDER ───────────────────────────────────────────────────────────
--
-- AFTER 016, ALWAYS. `core.pipelines` carries `trg_pipelines_ref` ->
-- `core.assign_ref('PIP')`, which RAISES if the tenant has no `PIP` row in
-- `core.ref_formats`, and 016 seeds those from its own AFTER INSERT trigger on
-- `public.tenants`. Per-row AFTER INSERT triggers fire in ALPHABETICAL ORDER BY
-- TRIGGER NAME, so this pack's trigger is named `trg_tenants_z_seed_pipelines`
-- — the `z` is not decoration; the obvious name sorts BEFORE 016's ('p' < 'r')
-- and would have failed on the first tenant anyone created. Asserted in the
-- verify block, because a name-ordering dependency that is only a comment is a
-- dependency waiting to be renamed.
--
-- BEFORE OR AFTER 018, EITHER. 019 reads nothing 018 creates and 018 creates
-- nothing 019 needs. What DOES depend on this pack is 018's BEHAVIOUR:
-- `core.navigation` and `core.get_pipeline_config` render from
-- `core.pipeline_steps` and inline no stage list, so without 019 they return an
-- empty stage list for every tenant. `test_018` is therefore run against
-- 001-019.
--
-- ── REVERSIBILITY, WHICH IS WHY THE LEDGER EXISTS ──────────────────────────
--
-- A seed with no record of what it wrote cannot be undone. The first version of
-- this seed, inside 018, dropped the mechanism on rollback and KEPT the rows,
-- reasoning that a tenant's pipeline configuration is theirs by the time anyone
-- rolls back and that `core.engagement_step_states` carries composite foreign
-- keys onto those rows. Both halves are true and neither justified the outcome:
-- afterwards the mechanism was gone, so there was NO SUPPORTED WAY TO UNDO THE
-- SEED AT ALL, and `pipelines_one_default_uq` went on rejecting a default
-- ENGAGEMENT pipeline for every tenant permanently. A rollback that leaves a
-- repo-wide constraint change in place is not a rollback.
--
-- `app.seeded_pipelines` records every row the seed ACTUALLY INSERTED, and
-- `app.unseed_pipelines()` deletes exactly those, refusing loudly with a count
-- and the blocking constraint names when live data references any of them.
--
-- ── THE FIXTURES THIS PACK FORCES, AND WHY THEY ARE HERE ───────────────────
--
-- A default ENGAGEMENT pipeline per tenant is a repo-wide fact, so every
-- fixture that inserted its own default one now collides with
-- `pipelines_one_default_uq`. `test_008` and `test_009` are amended in this
-- pack's commit rather than 018's, because this pack is the cause. Each edit
-- says so at the line. ⚠ `test_016` and `test_017` on `cloud/migrations` need
-- the same amendment and their newer versions are not on this branch; the exact
-- edit is in this pack's catalog entry and in the PR body, owed at rebase.
--
-- EXECUTED forward -> test -> rollback -> forward on a PostgreSQL 17.11 shim,
-- verify green each time.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

-- ── THE SEED LEDGER, so the seed is reversible ──────────────────────────────
--
-- ⚠ THIS IS THE ONE TABLE THIS PACK CREATES. It exists because a seed with no record of what it wrote is
-- a seed that cannot be undone, and the rollback review (B6) was right that
-- "the mechanism goes, the data stays" left `pipelines_one_default_uq`
-- rejecting a default ENGAGEMENT pipeline for every tenant FOREVER after a
-- rollback, with no supported way to reverse it.
--
-- IT RECORDS ONLY ROWS THE SEED ACTUALLY INSERTED. The seed is
-- `ON CONFLICT (id) DO NOTHING`, so a row the seeds lane wrote first under the
-- same derived id is NOT this pack's and never enters this ledger — which is exactly
-- the case the old design was protecting, now protected by construction
-- instead of by refusing to delete anything.
--
-- NO FOREIGN KEY onto `core.pipelines` / `core.pipeline_steps`, deliberately.
-- A tenant that deletes a seeded pipeline itself should not be blocked by a
-- bookkeeping row, and `app.unseed_pipelines` tolerates a ledger entry whose
-- subject is already gone.
--
-- RLS ENABLED, NOT FORCED. `app` is not a PostgREST-exposed schema and no
-- client role holds a grant here, so the guard is the grant layer; FORCE would
-- remove the owner's exemption and `app.seed_pipelines` — a definer whose owner
-- may not carry BYPASSRLS — would silently record nothing. 012 measured that
-- exact mechanism on `app.job_type_map` and took the same decision.
CREATE TABLE IF NOT EXISTS app.seeded_pipelines (
  row_kind  text        NOT NULL CHECK (row_kind IN ('PIPELINE','STEP')),
  tenant_id uuid        NOT NULL,
  row_id    uuid        NOT NULL,
  seeded_by text        NOT NULL DEFAULT '019',
  seeded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (row_kind, row_id)
);

ALTER TABLE app.seeded_pipelines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.seeded_pipelines FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE app.seeded_pipelines IS
  'Every core.pipelines / core.pipeline_steps row 019''s seed actually inserted. '
  'Written by app.seed_pipelines, read by app.unseed_pipelines, dropped by the '
  'rollback after it has reversed the seed. Rows that already existed under the '
  'same derived id are NOT recorded, because ON CONFLICT DO NOTHING did not '
  'insert them and they are not 019''s to delete.';

CREATE OR REPLACE FUNCTION app.seed_pipelines(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_rows integer := 0; v_steps integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'seed_pipelines: p_tenant_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- `core.pipelines` carries `trg_pipelines_ref` -> `core.assign_ref('PIP')`,
  -- which RAISES if the tenant has no `PIP` row in `core.ref_formats`. 016
  -- seeds those from its own AFTER INSERT trigger, and per-row AFTER INSERT
  -- triggers fire in ALPHABETICAL ORDER BY TRIGGER NAME — so this pack's
  -- trigger is named to sort after `trg_tenants_seed_ref_formats`. Asserted
  -- here as well, because a name-ordering dependency that is only a comment is
  -- a dependency waiting to be renamed.
  IF NOT EXISTS (SELECT 1 FROM core.ref_formats AS format
                  WHERE format.tenant_id = p_tenant_id AND format.prefix = 'PIP') THEN
    RAISE EXCEPTION
      'seed_pipelines: tenant % has no PIP ref_format yet. 016 seeds it from '
      'trg_tenants_seed_ref_formats, and AFTER INSERT triggers fire in '
      'alphabetical order by name — this seed must sort after it.', p_tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- RECORDED AS IT IS INSERTED. `RETURNING` under `ON CONFLICT DO NOTHING`
  -- yields ONLY the rows this statement actually wrote, which is precisely the
  -- set the rollback is entitled to delete.
  WITH inserted AS (
  INSERT INTO core.pipelines
    (id, tenant_id, object, name, is_default, version, status,
     created_by_kind, created_by_id)
  SELECT pg_catalog.md5(p_tenant_id::text || 'pipeline:' || spec.object)::uuid,
         p_tenant_id, spec.object, spec.name, true, 1, 'ACTIVE', 'SYSTEM', 'migration:019'
    FROM (VALUES
            -- Doc 01 §3.6: two lifecycles, two rows. The nine-step delivery
            -- lifecycle is API_CONTRACT.md's `GET /v1/engagements/{id}`
            -- example and the contract's ENGAGEMENT_STAGE_KEYS.
            ('ENGAGEMENT',  'Delivery lifecycle'),
            -- The seven opportunity stages are doc 01 §5.3's own
            -- `opportunities.stage` edge set and the contract's
            -- OPPORTUNITY_STAGES, in that order.
            ('OPPORTUNITY', 'Deal board')
          ) AS spec(object, name)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
  ), recorded AS (
  INSERT INTO app.seeded_pipelines (row_kind, tenant_id, row_id)
  SELECT 'PIPELINE', p_tenant_id, inserted.id FROM inserted
  ON CONFLICT (row_kind, row_id) DO NOTHING
  RETURNING 1)
  -- COUNTED OFF `inserted`, NOT off ROW_COUNT. ROW_COUNT would now report the
  -- LEDGER's insert, and a stale ledger row from a pipeline deleted outside
  -- `app.unseed_pipelines` would make a real seed report zero — which is how
  -- `app.seed_pipelines_all()` would start believing it had nothing to do.
  SELECT pg_catalog.count(*)::integer INTO v_rows FROM inserted;

  WITH inserted AS (
  INSERT INTO core.pipeline_steps
    (id, tenant_id, pipeline_id, step_key, label, position, terminal, blocking_check_keys)
  SELECT pg_catalog.md5(p_tenant_id::text || 'pipeline:' || spec.object || ':' || spec.step_key)::uuid,
         p_tenant_id,
         pg_catalog.md5(p_tenant_id::text || 'pipeline:' || spec.object)::uuid,
         spec.step_key, spec.label, spec.position, spec.terminal,
         -- `blocking_check_keys` stays empty: §17 sets HRDC_CLAIM to BLOCKED
         -- from a FAILING CHECK RESULT, not from a named key list, and 017
         -- seeds the three check keys per tenant. Anything else here would be
         -- configuration with no citation behind it.
         ARRAY[]::text[]
    FROM (VALUES
            -- ENGAGEMENT — API_CONTRACT.md:549-553, contract ENGAGEMENT_STAGE_KEYS,
            -- doc 01 §5.3 per row (engagements.status, trainer_bookings.state,
            -- attendance_days.status, hrdc_packets.status, invoices.status).
            ('ENGAGEMENT','WON',              'Won',               1::smallint, false),
            ('ENGAGEMENT','TRAINER_CONFIRMED','Trainer confirmed', 2::smallint, false),
            ('ENGAGEMENT','SCHEDULED',        'Scheduled',         3::smallint, false),
            ('ENGAGEMENT','REGISTERED',       'Registered',        4::smallint, false),
            ('ENGAGEMENT','DELIVERED',        'Delivered',         5::smallint, false),
            ('ENGAGEMENT','ATTENDANCE_LOCKED','Attendance locked', 6::smallint, false),
            ('ENGAGEMENT','HRDC_CLAIM',       'HRDC claim',        7::smallint, false),
            ('ENGAGEMENT','INVOICED',         'Invoiced',          8::smallint, false),
            ('ENGAGEMENT','PAID',             'Paid',              9::smallint, true),
            -- OPPORTUNITY — doc 01 §5.3 `opportunities.stage`, contract
            -- OPPORTUNITY_STAGES. WON and LOST are terminal and sit BESIDE each
            -- other, which is ruling R16's whole point: a screen that inferred
            -- an ending from the highest position would put LOST after WON.
            ('OPPORTUNITY','NEW',           'New',           1::smallint, false),
            ('OPPORTUNITY','QUALIFYING',    'Qualifying',    2::smallint, false),
            ('OPPORTUNITY','TNA_SENT',      'TNA sent',      3::smallint, false),
            ('OPPORTUNITY','PROPOSAL_SENT', 'Proposal sent', 4::smallint, false),
            ('OPPORTUNITY','NEGOTIATION',   'Negotiation',   5::smallint, false),
            ('OPPORTUNITY','WON',           'Won',           6::smallint, true),
            ('OPPORTUNITY','LOST',          'Lost',          7::smallint, true)
          ) AS spec(object, step_key, label, position, terminal)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
  ), recorded AS (
  INSERT INTO app.seeded_pipelines (row_kind, tenant_id, row_id)
  SELECT 'STEP', p_tenant_id, inserted.id FROM inserted
  ON CONFLICT (row_kind, row_id) DO NOTHING
  RETURNING 1)
  SELECT pg_catalog.count(*)::integer INTO v_steps FROM inserted;

  RETURN v_rows + v_steps;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.unseed_pipelines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row      record;
  v_deleted  integer := 0;
  v_gone     integer;
  v_blocked  text[] := ARRAY[]::text[];
  v_extra    text[] := ARRAY[]::text[];
  v_err      text;
BEGIN
  -- REVERSES THE SEED, EXACTLY AND ONLY. Every row it deletes is one
  -- `app.seed_pipelines` recorded having inserted; a row that already existed
  -- under the same derived id was never recorded and is never touched.
  --
  -- STEPS BEFORE PIPELINES. `pipeline_steps_pipeline_fk` is ON DELETE CASCADE
  -- (004:652), so deleting a pipeline first would take its steps with it —
  -- INCLUDING steps a tenant added itself, which are not this pack's to delete. The
  -- guard below refuses a pipeline that still has an unrecorded step for the
  -- same reason, rather than relying on the ordering alone.
  FOR v_row IN
    SELECT ledger.row_kind, ledger.tenant_id, ledger.row_id
      FROM app.seeded_pipelines AS ledger
     ORDER BY CASE ledger.row_kind WHEN 'STEP' THEN 0 ELSE 1 END, ledger.row_id
  LOOP
    IF v_row.row_kind = 'PIPELINE'
       AND EXISTS (SELECT 1 FROM core.pipeline_steps AS step
                    WHERE step.tenant_id = v_row.tenant_id
                      AND step.pipeline_id = v_row.row_id
                      AND NOT EXISTS (SELECT 1 FROM app.seeded_pipelines AS known
                                       WHERE known.row_kind = 'STEP' AND known.row_id = step.id)) THEN
      v_extra := v_extra || v_row.row_id::text;
      CONTINUE;
    END IF;

    BEGIN
      IF v_row.row_kind = 'STEP' THEN
        DELETE FROM core.pipeline_steps AS step
         WHERE step.tenant_id = v_row.tenant_id AND step.id = v_row.row_id;
      ELSE
        DELETE FROM core.pipelines AS pipe
         WHERE pipe.tenant_id = v_row.tenant_id AND pipe.id = v_row.row_id;
      END IF;
      GET DIAGNOSTICS v_gone = ROW_COUNT;
      v_deleted := v_deleted + v_gone;
    EXCEPTION WHEN foreign_key_violation THEN
      -- SOMETHING REAL POINTS AT IT. `core.engagements` and
      -- `core.engagement_step_states` both carry ON DELETE RESTRICT composite
      -- keys onto these rows (008:108, 008:150). By the time a row is
      -- referenced it is a tenant's live configuration, not a seed.
      GET STACKED DIAGNOSTICS v_err = CONSTRAINT_NAME;
      v_blocked := v_blocked || (v_row.row_kind || ' ' || v_row.row_id::text
                                 || ' (' || COALESCE(v_err, 'unknown constraint') || ')');
    END;
  END LOOP;

  -- REFUSE LOUDLY, AND ALL OR NOTHING. The RAISE takes every delete above back
  -- with it, so the caller never gets a half-reversed seed. The count and the
  -- constraint names are in the message because "something references them" is
  -- not an instruction anybody can act on.
  IF pg_catalog.array_length(v_blocked, 1) IS NOT NULL
     OR pg_catalog.array_length(v_extra, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'unseed_pipelines: cannot reverse the 019 seed. % row(s) are referenced by '
      'live data [%]; % seeded pipeline(s) carry steps 019 did not seed and would '
      'be cascaded away [%]. Nothing was deleted. Remove or repoint the '
      'referencing rows first, or accept that 019 cannot be rolled back while '
      'this tenant configuration is in use.',
      COALESCE(pg_catalog.array_length(v_blocked, 1), 0),
      pg_catalog.array_to_string(v_blocked, '; '),
      COALESCE(pg_catalog.array_length(v_extra, 1), 0),
      pg_catalog.array_to_string(v_extra, '; ')
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM app.seeded_pipelines;
  RETURN v_deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION app.unseed_pipelines() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app.unseed_pipelines() IS
  'The other half of app.seed_pipelines, and the reason 019 is rollback-'
  'reversible at all. Deletes exactly the core.pipelines / core.pipeline_steps '
  'rows the seed recorded having inserted, refuses with a count and the '
  'constraint names when live data references any of them, and deletes nothing '
  'when it refuses. Called by the rollback; pinned by test_019 T4.';

CREATE OR REPLACE FUNCTION app.seed_pipelines_on_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM app.seed_pipelines(NEW.id);
  RETURN NEW;
END;
$fn$;

-- NAME IS LOAD-BEARING. Per-row AFTER INSERT triggers fire in ALPHABETICAL
-- ORDER BY TRIGGER NAME, and this one must run after 016's
-- `trg_tenants_seed_ref_formats` or `core.assign_ref('PIP')` raises on every
-- tenant insert. `trg_tenants_z_seed_pipelines` sorts after it; the obvious
-- name, `trg_tenants_seed_pipelines`, sorts BEFORE it ('p' < 'r') and would
-- have failed on the first tenant anyone created. The `z` is not decoration.
--
-- This is the FOURTH provisioning trigger on `public.tenants` — action policies
-- (011), ref formats (016), check keys (017) and now pipelines. 017's header
-- set the precedent explicitly: a later pack adds its own beside the others
-- rather than editing theirs.
DROP TRIGGER IF EXISTS trg_tenants_z_seed_pipelines ON public.tenants;
CREATE TRIGGER trg_tenants_z_seed_pipelines
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app.seed_pipelines_on_tenant();

REVOKE ALL ON FUNCTION app.seed_pipelines(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.seed_pipelines_on_tenant() FROM PUBLIC, anon, authenticated;

-- Backfill: every tenant that already exists gets the same defaults, in the
-- same shape 016 and 017 used for theirs. ON CONFLICT (id) DO NOTHING means a
-- tenant that already configured its own pipelines keeps them.
--
-- ⚠ IT USED TO SWALLOW A FOREIGN KEY VIOLATION INTO A `RAISE WARNING` AND
-- REPORT SUCCESS. A tenant predating 016's ref-format backfill was skipped and
-- the migration finished green. Because `core.navigation` and
-- `core.get_pipeline_config` render stages from `core.pipeline_steps`, that
-- tenant's navigation then came back with an EMPTY STAGE LIST — a silent,
-- correct-looking empty rather than an error — and a WARNING in a migration
-- log is not a channel anyone reads afterwards. The whole point of seeding
-- from a migration is that afterwards the invariant holds.
--
-- It now collects the skipped tenants and RAISES ONCE with the list, so the
-- operator fixes the ref formats and re-runs rather than discovering it from a
-- customer. The loop still visits every tenant first: failing on the first one
-- would hide the other nine.
--
-- The loop lives in a FUNCTION rather than inline in the `DO` block so that the
-- pin can call it. An assertion about a `DO` block's behaviour cannot be
-- written; an assertion about `app.seed_pipelines_all()` can, and T35 writes
-- it. Raised to NOTICE here rather than at the verify block, because the
-- backfill's own count is the thing an operator needs to see while applying.
-- SET LOCAL, not SET: a plain SET here leaked `notice` to whatever ran next on
-- a pooled connection. Scoped to this transaction (L1).
SET LOCAL client_min_messages = notice;

CREATE OR REPLACE FUNCTION app.seed_pipelines_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant  uuid;
  v_total   integer := 0;
  v_skipped uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR v_tenant IN SELECT tenant.id FROM public.tenants AS tenant ORDER BY tenant.created_at
  LOOP
    BEGIN
      v_total := v_total + app.seed_pipelines(v_tenant);
    EXCEPTION WHEN foreign_key_violation THEN
      -- CAUGHT ONLY TO KEEP COUNTING, never to continue as if nothing happened.
      v_skipped := v_skipped || v_tenant;
    END;
  END LOOP;

  IF pg_catalog.array_length(v_skipped, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'seed_pipelines_all: % tenant(s) have no PIP ref_format and were NOT seeded: %. '
      'Their navigation would render an empty stage list. Seed core.ref_formats '
      'for them (016) and re-run this migration.',
      pg_catalog.array_length(v_skipped, 1),
      pg_catalog.array_to_string(v_skipped, ', ')
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN v_total;
END;
$fn$;

REVOKE ALL ON FUNCTION app.seed_pipelines_all() FROM PUBLIC, anon, authenticated;

DO $backfill$
DECLARE v_total integer;
BEGIN
  v_total := app.seed_pipelines_all();
  RAISE NOTICE '019 backfill: % pipeline and step row(s) seeded across existing tenants.', v_total;
END
$backfill$;


-- ── REGISTER THE SEED WITH 016's COMPLETENESS GUARD ─────────────────────────
--
-- `origin/cloud/migrations`' 016 adds `app.tenant_seed_checks`, one row per
-- relation an AFTER INSERT trigger on `public.tenants` is expected to seed, and
-- `app.provision_tenant` refuses a tenant whose seeds did not all land. This is
-- the FOURTH such trigger — action policies (011), ref formats (016), check keys
-- (017) and now pipelines — and a provisioning trigger that is not registered is
-- a trigger whose silent failure the guard was built to catch and does not.
--
-- GUARDED ON THE TABLE'S EXISTENCE, because that 016 is not on this branch's
-- base yet and 019 has to apply correctly against both. When the table is
-- absent this is a no-op and the obligation is recorded in the PR body and the
-- catalog row instead of being silently skipped.
--
-- `note` is shown verbatim in the refusal, so it states the CONSEQUENCE: the
-- person reading it is mid-incident.
DO $seed_check$
BEGIN
  IF pg_catalog.to_regclass('app.tenant_seed_checks') IS NULL THEN
    RAISE NOTICE '019: app.tenant_seed_checks does not exist on this base, so the '
                 'pipeline seed is NOT registered with provision_tenant''s guard. '
                 'It must be registered when 016''s registry lands.';
    RETURN;
  END IF;
  INSERT INTO app.tenant_seed_checks (pack, label, schema_name, table_name, note)
  VALUES ('019','pipelines','core','pipelines',
          'The tenant has no lifecycle at all: core.navigation and '
          'core.get_pipeline_config render stages from core.pipeline_steps, so '
          'every board and every stage list comes back empty and reads as '
          'configuration rather than as a failed provision.'),
         ('019','pipeline steps','core','pipeline_steps',
          'The pipelines exist but have no stages, so a deal or an engagement '
          'cannot be moved anywhere and the stepper renders nothing.')
  ON CONFLICT (schema_name, table_name) DO UPDATE
    SET pack = EXCLUDED.pack, label = EXCLUDED.label, note = EXCLUDED.note;
END
$seed_check$;

-- ═══ 2 · $verify$ ═════════════════════════════════════════════════════════

SET LOCAL client_min_messages = notice;

DO $verify$
DECLARE
  v_tenants integer;
  v_missing uuid[];
BEGIN
  -- V1 · THE TRIGGER EXISTS AND SORTS AFTER 016'S. Per-row AFTER INSERT
  -- triggers fire in ALPHABETICAL ORDER BY TRIGGER NAME, and `core.pipelines`
  -- carries `trg_pipelines_ref` -> `core.assign_ref('PIP')`, which RAISES if
  -- the tenant has no PIP ref_format. A rename that loses the `z` breaks every
  -- tenant insert, and a comment does not prevent a rename.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
      JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'tenants'
       AND NOT t.tgisinternal AND t.tgname = 'trg_tenants_z_seed_pipelines') THEN
    RAISE EXCEPTION '019 verify V1: the pipeline seed trigger is missing from public.tenants';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
      JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'tenants' AND NOT t.tgisinternal
       AND t.tgname = 'trg_tenants_seed_ref_formats'
       AND t.tgname > 'trg_tenants_z_seed_pipelines') THEN
    RAISE EXCEPTION '019 verify V1b: the pipeline seed trigger sorts BEFORE 016''s '
                    'ref-format seed, so core.assign_ref(''PIP'') will raise on every '
                    'tenant insert';
  END IF;

  -- V2 · EVERY EXISTING TENANT HAS A LIFECYCLE. This is the invariant the whole
  -- pack exists for, asserted on the rows rather than inferred from the
  -- backfill's return value. `app.seed_pipelines_all()` already raises naming
  -- any tenant it could not seed; this catches the case where it returned
  -- cleanly and the rows still are not there.
  SELECT pg_catalog.array_agg(tenant.id ORDER BY tenant.id) INTO v_missing
    FROM public.tenants AS tenant
   WHERE NOT EXISTS (SELECT 1 FROM core.pipelines AS pipe
                      WHERE pipe.tenant_id = tenant.id AND pipe.object = 'ENGAGEMENT')
      OR NOT EXISTS (SELECT 1 FROM core.pipeline_steps AS step
                      WHERE step.tenant_id = tenant.id);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '019 verify V2: tenant(s) still have no pipeline configuration: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V3 · THE LEDGER IS HONEST. Every row it names exists. A ledger that names a
  -- row that is gone would have `app.unseed_pipelines` report a reversal it did
  -- not perform.
  IF EXISTS (
    SELECT 1 FROM app.seeded_pipelines AS ledger
     WHERE (ledger.row_kind = 'PIPELINE'
            AND NOT EXISTS (SELECT 1 FROM core.pipelines AS p
                             WHERE p.tenant_id = ledger.tenant_id AND p.id = ledger.row_id))
        OR (ledger.row_kind = 'STEP'
            AND NOT EXISTS (SELECT 1 FROM core.pipeline_steps AS st
                             WHERE st.tenant_id = ledger.tenant_id AND st.id = ledger.row_id))) THEN
    RAISE EXCEPTION '019 verify V3: app.seeded_pipelines names a row that does not exist';
  END IF;

  -- V4 · POSTURE. Four definer functions, empty stored search_path, and no
  -- client role can reach any of them or the ledger.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND p.proname IN ('seed_pipelines','seed_pipelines_all','unseed_pipelines',
                         'seed_pipelines_on_tenant')
       AND NOT (p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])) THEN
    RAISE EXCEPTION '019 verify V4: a seed function is not definer with search_path=""';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND p.proname IN ('seed_pipelines','seed_pipelines_all','unseed_pipelines',
                         'seed_pipelines_on_tenant')
       AND (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION '019 verify V4b: a seed function is executable by a client role';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'app.seeded_pipelines', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'app.seeded_pipelines', 'SELECT') THEN
    RAISE EXCEPTION '019 verify V4c: app.seeded_pipelines is readable by a client role';
  END IF;

  -- V5 · NO STAGE LIST IS INLINED IN A READER. 019 writes the rows; 018's
  -- `core.navigation` and `core.get_pipeline_config` must still render FROM
  -- them. Checked here as well as in 018 because this is the pack that could
  -- tempt someone to hardcode the list on the read side to "match the seed".
  IF pg_catalog.to_regprocedure('core.navigation()') IS NOT NULL THEN
    IF pg_catalog.strpos(
         (SELECT p.prosrc FROM pg_catalog.pg_proc AS p
            WHERE p.oid = 'core.navigation()'::regprocedure), 'core.pipeline_steps') = 0 THEN
      RAISE EXCEPTION '019 verify V5: core.navigation stopped reading core.pipeline_steps';
    END IF;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_tenants FROM public.tenants;
  RAISE NOTICE '019 verify: trigger present and correctly ordered, % tenant(s) each '
               'carrying a lifecycle, ledger consistent, four definer functions '
               'unreachable from a client role, and the readers still render from rows.',
               v_tenants;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
