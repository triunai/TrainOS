-- ============================================================================
-- ROLLBACK 016 · seed_and_tenant_provisioning
-- ============================================================================
--
-- Restores the state 015 left: no provisioning trigger, no provisioning
-- functions, and `core.ref_formats` back to being a table no migration fills.
--
-- DROP ORDER, reverse of forward:
--   1. the trigger        (before its function, or the drop fails on the
--                          dependency and reports as a broken rollback rather
--                          than as the ordering mistake it is)
--   2. the three functions
--   3. the seeded rows — see the decision below
--
-- ⚠ THE SEEDED `core.ref_formats` ROWS ARE DELETED, AND THIS IS THE ONLY PLACE IN
-- THE PACK WHERE A ROLLBACK DELETES BUSINESS-SHAPED DATA. The reasoning, because
-- it deserves to be arguable rather than assumed:
--
--   A rollback must restore the prior state, and the prior state is a tenant with
--   no formats. Leaving them behind would mean `roundtrip.sh`'s "before=0 after=0"
--   is satisfied while `core.ref_formats` silently accumulates 32 rows per tenant
--   on every cycle.
--
--   The rows carry no history and cost nothing to lose. A `ref_formats` row is a
--   FORMAT — prefix, entity, dated, width — not an allocation. The allocations
--   live in `core.ref_sequences`, which 016 never touches and this rollback never
--   deletes, so re-applying 016 hands every prefix back its existing counter and
--   **no ref is ever reissued.** That is the property that makes deleting the
--   formats safe, and it is asserted below rather than asserted here.
--
--   ⚠ THE EXCEPTION, ENFORCED: a format that a tenant has already ALLOCATED
--   against is NOT deleted. If `core.ref_sequences` has a row for that
--   (tenant, prefix), the format stays, because deleting it would leave a live
--   counter with no format to describe it and the next `next_ref` call would
--   raise on a prefix the customer is visibly already using. A rollback that
--   breaks a working tenant is not a rollback.
--
-- Re-runnable throughout.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('core.ref_formats') IS NULL THEN
    RAISE EXCEPTION
      'ROLLBACK 016 refused: core.ref_formats is absent, so 004 is already gone '
      'and there is nothing beneath this migration to roll back to.';
  END IF;

  -- ⚠ REFUSE WHILE 017 IS STILL APPLIED.
  --
  -- 017 adds a THIRD tenant-provisioning trigger on public.tenants
  -- (app.seed_compliance_check_keys), beside 016's ref-format seed and 011's
  -- action-policy seed. Dropping 016's trigger underneath it leaves a database
  -- where a new tenant is given check keys and action policies but NO REF
  -- FORMATS — and nothing raises, because each trigger only knows about itself.
  -- The first symptom is a customer's first enquiry failing on core.next_ref,
  -- long after whoever ran this rollback has stopped watching.
  --
  -- Same shape as 014's rollback refusing while 017 is applied, and for the same
  -- reason: reverse order is the only order that leaves the provisioning set
  -- coherent at every step.
  IF pg_catalog.to_regproc('app.seed_compliance_check_keys') IS NOT NULL THEN
    RAISE EXCEPTION
      'ROLLBACK 016 refused: migration 017 is still applied '
      '(app.seed_compliance_check_keys exists). 017 adds a third '
      'tenant-provisioning trigger beside 016''s; dropping 016''s first would '
      'leave new tenants with check keys and action policies but no ref formats, '
      'and nothing would raise until a customer''s first enquiry. Roll back in '
      'reverse order: 017, then 016.';
  END IF;
END;
$preflight$;

-- ── 1 · The trigger ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_tenants_seed_ref_formats ON public.tenants;

-- ── 2 · The functions ───────────────────────────────────────────────────────
-- Both signatures. The three-argument form is the pre-amendment one; a database
-- that was rolled back and forward around the amendment could carry either, and
-- dropping only the current spelling would strand the other.
DROP FUNCTION IF EXISTS app.provision_tenant(text,text,text,uuid);
DROP FUNCTION IF EXISTS app.provision_tenant(text,text,text);
DROP FUNCTION IF EXISTS app.seed_ref_formats_on_tenant();
DROP FUNCTION IF EXISTS app.seed_ref_formats(uuid);

-- The seed registry. Dropped last of 016's objects because provision_tenant reads
-- it and is dropped above; dropping it first would leave a moment in which the
-- function exists and its guard cannot run. 017 registers a row in it and 017's
-- own rollback deletes that row, so by here the table holds only 016's and 011's.
DROP TABLE IF EXISTS app.tenant_seed_checks;

-- ── 3 · The seeded rows, except any prefix already allocated against ────────
-- ⚠ SCOPED TO ROWS 016 CAN PROVE IT WROTE. An earlier version ran
-- `DELETE FROM core.ref_formats WHERE NOT EXISTS (allocated)` with no further
-- qualification, which is every unallocated ref_format IN THE DATABASE — including
-- any an operator configured by hand before 016 existed, and any a future pack
-- adds. The header claimed only "the seeded rows"; the post-condition below then
-- required zero unallocated rows to survive, so the over-deletion was enforced as
-- correct and could not fail. Same class of defect as 014's rollback taking 002's
-- grants, one table over.
--
-- 016 has no ownership column to check, so ownership is proven to the precision
-- actually available: a row is 016's only if ALL of
--   * it is unallocated (no core.ref_sequences row), AND
--   * its prefix is one the forward migration would derive — an `assign_ref`
--     trigger in `core` carries it as TG_ARGV[0], the same query §2 uses, not a
--     list, AND
--   * its `entity` and `width` are EXACTLY what that derivation produces.
--
-- ⚠ `dated` IS DELIBERATELY NOT ONE OF THEM, and the text above used to claim it
-- was while the predicate below never tested it — a disclosed criterion that did
-- not exist. It is left out rather than added because `dated` is the one derived
-- attribute an OPERATOR LEGITIMATELY CHANGES: 016 derives it from a hardcoded
-- list for the prefixes it cannot infer, that list is itself a known open finding
-- against the domain model, and refs are immutable once allocated. A tenant whose
-- operator corrected a wrong `dated` flag before allocating against it would, if
-- `dated` were in the predicate, have that row treated as foreign and LEFT BEHIND
-- by this rollback — stranding a corrected format that 016 would then re-create
-- wrongly on the next apply. Matching on entity and width keeps such a row in
-- 016's own set, which is where it belongs.
--
-- A hand-made row differs in at least one of the two that ARE tested: a different
-- width, or an entity name that is not the triggered table.
-- One that matches the derivation in every column is genuinely indistinguishable
-- from a seeded row, and is deleted. That residue is stated rather than papered
-- over, and it is bounded: such a row is byte-identical to what re-applying 016
-- would recreate.
DO $rows$
DECLARE v_deleted integer; v_kept integer; v_foreign integer;
BEGIN
  WITH derived AS (
    SELECT pg_catalog.split_part(
             pg_catalog.encode(trg.tgargs,'escape'), '\000', 1) AS prefix,
           cls.relname AS entity
      FROM pg_catalog.pg_trigger AS trg
      JOIN pg_catalog.pg_class     AS cls ON cls.oid = trg.tgrelid
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = cls.relnamespace
      JOIN pg_catalog.pg_proc      AS prc ON prc.oid = trg.tgfoid
     WHERE nsp.nspname = 'core'
       AND prc.proname = 'assign_ref'
       AND NOT trg.tgisinternal
  )
  DELETE FROM core.ref_formats AS f
   USING derived AS d
   WHERE f.prefix = d.prefix
     AND f.entity = d.entity
     AND f.width  = 4
     AND NOT EXISTS (
       SELECT 1 FROM core.ref_sequences AS s
        WHERE s.tenant_id = f.tenant_id AND s.prefix = f.prefix);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT pg_catalog.count(*) INTO v_kept FROM core.ref_formats;

  SELECT pg_catalog.count(*) INTO v_foreign
    FROM core.ref_formats AS f
   WHERE NOT EXISTS (
     SELECT 1 FROM core.ref_sequences AS s
      WHERE s.tenant_id = f.tenant_id AND s.prefix = f.prefix);

  RAISE NOTICE
    'ROLLBACK 016: deleted % ref_format row(s) matching 016''s own derivation and '
    'unallocated; kept % row(s) in total, of which % are unallocated rows 016 '
    'cannot prove it wrote and therefore leaves alone',
    v_deleted, v_kept, v_foreign;
END;
$rows$;

-- ── POST-CONDITIONS ─────────────────────────────────────────────────────────
DO $verify$
DECLARE v_bad text;
BEGIN
  IF pg_catalog.to_regproc('app.seed_ref_formats') IS NOT NULL
     OR pg_catalog.to_regproc('app.seed_ref_formats_on_tenant') IS NOT NULL
     OR pg_catalog.to_regproc('app.provision_tenant') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 016 incomplete: a 016 function survives';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid='public.tenants'::regclass
                AND tgname='trg_tenants_seed_ref_formats') THEN
    RAISE EXCEPTION 'ROLLBACK 016 incomplete: the provisioning trigger survives';
  END IF;

  -- 011's seed trigger is NOT 016's to remove. 016 mirrored its shape; it did not
  -- adopt it.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid='public.tenants'::regclass
                    AND tgname='trg_tenants_seed_action_policies') THEN
    RAISE EXCEPTION
      'ROLLBACK 016 DESTROYED 011''s action-policy seed trigger. 016 added a '
      'trigger beside it and owns only its own.';
  END IF;

  -- Any format left standing must have a live counter behind it, or the
  -- exception above has been applied backwards and a working tenant is broken.
  -- ⚠ NOT "no unallocated row survives". That was the absolutist post-condition
  -- that made the over-deletion above unfailable: it demanded the very state the
  -- unqualified DELETE produced, so a rollback that destroyed an operator's
  -- hand-configured formats reported success. What 016 actually owes is narrower
  -- and checkable: nothing matching 016's OWN derivation, unallocated, survives.
  -- A row that does not match it is not 016's to have deleted and its survival is
  -- the correct outcome, not an incomplete rollback.
  WITH derived AS (
    SELECT pg_catalog.split_part(
             pg_catalog.encode(trg.tgargs,'escape'), '\000', 1) AS prefix,
           cls.relname AS entity
      FROM pg_catalog.pg_trigger AS trg
      JOIN pg_catalog.pg_class     AS cls ON cls.oid = trg.tgrelid
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = cls.relnamespace
      JOIN pg_catalog.pg_proc      AS prc ON prc.oid = trg.tgfoid
     WHERE nsp.nspname = 'core'
       AND prc.proname = 'assign_ref'
       AND NOT trg.tgisinternal
  )
  SELECT pg_catalog.string_agg(pg_catalog.format('%s/%s', f.tenant_id, f.prefix), ', ')
    INTO v_bad
    FROM core.ref_formats AS f
    JOIN derived AS d ON d.prefix = f.prefix AND d.entity = f.entity
   WHERE f.width = 4
     AND NOT EXISTS (SELECT 1 FROM core.ref_sequences AS s
                      WHERE s.tenant_id=f.tenant_id AND s.prefix=f.prefix);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'ROLLBACK 016 incomplete: unallocated ref_format row(s) matching 016''s own '
      'derivation survive: %', v_bad;
  END IF;

  RAISE NOTICE 'ROLLBACK 016: OK - provisioning removed, allocated formats preserved';
END;
$verify$;

COMMIT;
