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
END;
$preflight$;

-- ── 1 · The trigger ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_tenants_seed_ref_formats ON public.tenants;

-- ── 2 · The functions ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS app.provision_tenant(text,text,text);
DROP FUNCTION IF EXISTS app.seed_ref_formats_on_tenant();
DROP FUNCTION IF EXISTS app.seed_ref_formats(uuid);

-- ── 3 · The seeded rows, except any prefix already allocated against ────────
DO $rows$
DECLARE v_deleted integer; v_kept integer;
BEGIN
  DELETE FROM core.ref_formats AS f
   WHERE NOT EXISTS (
     SELECT 1 FROM core.ref_sequences AS s
      WHERE s.tenant_id = f.tenant_id AND s.prefix = f.prefix);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT pg_catalog.count(*) INTO v_kept FROM core.ref_formats;
  RAISE NOTICE
    'ROLLBACK 016: deleted % unused ref_format row(s); kept % that a tenant has '
    'already allocated against', v_deleted, v_kept;
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
  SELECT pg_catalog.string_agg(pg_catalog.format('%s/%s', f.tenant_id, f.prefix), ', ')
    INTO v_bad
    FROM core.ref_formats AS f
   WHERE NOT EXISTS (SELECT 1 FROM core.ref_sequences AS s
                      WHERE s.tenant_id=f.tenant_id AND s.prefix=f.prefix);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 016 incomplete: unused ref_format row(s) survive: %', v_bad;
  END IF;

  RAISE NOTICE 'ROLLBACK 016: OK - provisioning removed, allocated formats preserved';
END;
$verify$;

COMMIT;
