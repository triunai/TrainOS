-- ============================================================================
-- Migration 016: tenant provisioning — the `core.ref_formats` rows every pin in
-- the pack has been faking, seeded from the triggers that consume them.
-- ============================================================================
--
-- FEATURE. There is a hole in the middle of this database and every test file
-- since 011 has been quietly stepping around it.
--
-- `core.next_ref()` raises `no ref_format for prefix % in this tenant` when the
-- tenant has no `core.ref_formats` row for the prefix being allocated. Thirty-two
-- `core` tables carry a `core.assign_ref` trigger, so thirty-two tables are
-- unwritable for a tenant that has no formats. **No migration seeds them.** The
-- consequence is recorded in 013's own catalog entry as a standing condition —
-- "`core.runs` is unwritable per tenant until 016 seeds the `RUN` row in
-- `core.ref_formats`, which is the standing condition of every ref'd table since
-- 004" — and test_013's header says the same thing out loud: "016 provisions
-- those, so this pin seeds its own AGT and RUN rows".
--
-- Six pins seed their own. test_011 seeds ACT/APV/DRF, test_013 seeds AGT/RUN,
-- test_014 seeds ACT/APV/DRF for two tenants. Every one of those is a fixture
-- standing in for a provisioning step that does not exist, which means **no pin
-- in this pack has ever exercised the real path a new customer takes.** 016 is
-- that path.
--
-- OBJECTS. Two functions and one trigger. No table, no view, no type, no policy,
-- no new column.
--
-- ── THE ROWS ARE DERIVED FROM THE TRIGGERS, NOT TRANSCRIBED ─────────────────
--
-- The obvious 016 is thirty-two `INSERT … VALUES ('ACT','action_requests',…)`
-- lines. It is also wrong, and the reason is measurable rather than stylistic.
--
-- Building that list by hand from the migrations — `grep` for `finalise_table`
-- with a prefix argument — yields **twenty-seven** prefixes. The real number is
-- **thirty-two**. The five that a reading misses are `ATT`, `PIP`, `SIG`, `SVW`
-- and `TPL`, and they are missed because their `finalise_table` calls are wrapped
-- across lines and the regex stops at the newline. A hand-built list would have
-- shipped, looked complete, and left attachments, pipelines, signatures, saved
-- views and templates unwritable for every customer — discovered the first time
-- somebody saved a view, in production, as a raw `foreign_key_violation` from
-- inside a trigger.
--
-- So the seed is driven from `pg_trigger`: every trigger whose function is
-- `core.assign_ref` declares its prefix as `TG_ARGV[0]`, and that argument is the
-- same string `next_ref` will be handed at run time. The list and its consumer are
-- then the same list BY CONSTRUCTION rather than by review — 003's argument for
-- generating sixty-nine enum types from the contract package, applied to
-- provisioning. A thirty-third ref'd table added by 017 or 018 is provisioned by
-- this function on the day its trigger is created, with no edit here and no
-- chance of the two drifting.
--
-- ⚠ The one thing this cannot derive is `dated` and `width`. Both take
-- `core.ref_formats`'s own column defaults (`dated = false`, `width = 4`) except
-- for the prefixes the contract shows dated, which are listed explicitly in §1
-- with the contract reference, because `ENQ-2026-0912` versus `ENQ-0912` is a
-- visible difference on every screen and a silent one in the catalogue.
--
-- ── PROVISIONING IS A TRIGGER, MATCHING 011 ─────────────────────────────────
--
-- 011 already established the shape: `trg_tenants_seed_action_policies` fires
-- `AFTER INSERT ON public.tenants` and calls `app.seed_action_policies(NEW.id)`,
-- so a tenant cannot exist without its 22-row policy catalogue. 016 adds the
-- second half of the same idea rather than inventing a different one — a tenant
-- cannot exist without its ref formats either.
--
-- A trigger rather than a provisioning SCRIPT for one reason: a script is
-- something a human remembers to run. `public.tenants` is written by the
-- onboarding path, by a seed, by a test fixture and by whatever lands next, and
-- every one of those paths needs formats. The trigger is the only place that
-- covers all four.
--
-- `app.provision_tenant()` exists beside it for the explicit case — creating a
-- tenant from SQL and getting its id back — and does not duplicate the seeding
-- logic; it inserts the tenant and lets the trigger do the work, so there is one
-- implementation and no second path to drift.
--
-- ── WHAT 016 DOES NOT SEED, AND WHY NOT ─────────────────────────────────────
--
--   pipelines / pipeline_steps   The second spine. "Stage names and order render
--                                from `pipeline_steps` rows" and a hardcoded stage
--                                list anywhere in SQL is a defect — root
--                                `CLAUDE.md` and `supabase/CLAUDE.md` both say so.
--                                The contract shows TWO lifecycles for the same
--                                object (six steps on the relations panel, nine on
--                                the engagement detail), and 004's entry says those
--                                are two `pipelines` rows. Seeding them here means
--                                writing fifteen stage names into a migration,
--                                which is the exact defect the rule names, and
--                                doing it in a file about ref formats. It belongs
--                                in a pack that can cite `docs/architecture/01`
--                                §5.3 per row. **Owner: 018 or a dedicated seed
--                                pack.** ⚠ Until then a new tenant renders no
--                                pipeline.
--   compliance rule registry     `docs/research/2026-09-13-hrdcorp-compliance-refresh.md`
--                                supplies ten rows (HRD-007, HRD-009, HRD-014,
--                                HRD-015, HRD-018, HRD-020, HRD-022, HRD-023 and
--                                two recommended additions). They are national
--                                (`tenant_id NULL`), not per-tenant, so they are
--                                not provisioning. They also carry an explicit
--                                instruction from the research: "All rows load
--                                `status = 'PROPOSED'`… until a named Finance
--                                verifier confirms each against the circular text
--                                — none should be inserted `ACTIVE` from this
--                                document alone." 017 owns the registry rows; 016
--                                owns provisioning, and mixing them would put a
--                                regulatory seed inside a function that runs on
--                                every tenant insert.
--   rate cards, templates        Customer data. A tenant's first rate card is an
--                                onboarding conversation, not a migration.
--
-- ── SPINE ───────────────────────────────────────────────────────────────────
--
-- Spine untouched: no action type, no handler, no branch in the envelope. The
-- pipeline spine is deliberately NOT touched either, which is the stronger
-- statement — see above.
-- ============================================================================

BEGIN;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('core.ref_formats') IS NULL THEN
    RAISE EXCEPTION '016 preflight: core.ref_formats is absent; 004 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('core.assign_ref()') IS NULL THEN
    RAISE EXCEPTION '016 preflight: core.assign_ref() is absent; 004 has not been applied';
  END IF;
  IF pg_catalog.to_regproc('app.seed_action_policies') IS NULL THEN
    RAISE EXCEPTION
      '016 preflight: app.seed_action_policies is absent; 011 has not been applied. '
      '016 deliberately mirrors its trigger shape and should not be the first to '
      'establish it.';
  END IF;
END;
$preflight$;

-- ============================================================================
-- §1 · app.seed_ref_formats(tenant) — derived from pg_trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION app.seed_ref_formats(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_dated text[] := ARRAY[
    -- The prefixes the contract renders with a year segment: `ENQ-2026-0912`.
    -- Everything else takes core.ref_formats' own default of `dated = false`.
    -- These are the record types a customer cites by year in correspondence and
    -- the ones whose volume must not be readable off a running total.
    'ENQ','OPP','PRO','QUO','ENG','INV','CRN','PAY','HPK','ACT','APV','DRF',
    'RUN','MSG','COL','FUP','SES','TBK'];
  v_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'seed_ref_formats: p_tenant_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- One row per assign_ref trigger in `core`. TG_ARGV[0] is stored in
  -- pg_trigger.tgargs as a NUL-terminated byte string; the split takes the first
  -- element, which is the prefix `next_ref` will be handed at run time.
  INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width)
  SELECT p_tenant_id,
         src.prefix,
         src.entity,
         src.prefix = ANY (v_dated),
         4
    FROM (
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
    ) AS src
   WHERE src.prefix <> ''
     -- Idempotent, and idempotent the safe way: an existing row is LEFT ALONE
     -- rather than overwritten. A customer who has already allocated
     -- `ENQ-2026-0912` must not have `dated` flipped under them — every ref
     -- issued so far would keep its shape while new ones changed, and `ref` is
     -- immutable after insert so there is no correcting it.
     AND NOT EXISTS (
       SELECT 1 FROM core.ref_formats AS existing
        WHERE existing.tenant_id = p_tenant_id
          AND existing.prefix    = src.prefix);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION app.seed_ref_formats(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app.seed_ref_formats(uuid) IS
  'Seeds one core.ref_formats row per core.assign_ref trigger, so the prefix list '
  'and the prefixes next_ref is actually handed are the same list by construction. '
  'Hand-transcribing it from the migrations yields 27 of the 32 (ATT, PIP, SIG, '
  'SVW and TPL are missed by a line-based read). Idempotent: an existing row is '
  'left alone, never overwritten, because ref is immutable after insert and '
  'flipping `dated` would reshape new refs while old ones kept their form. 016.';

-- ── The trigger, mirroring 011's ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.seed_ref_formats_on_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM app.seed_ref_formats(NEW.id);
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION app.seed_ref_formats_on_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tenants_seed_ref_formats ON public.tenants;
CREATE TRIGGER trg_tenants_seed_ref_formats
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app.seed_ref_formats_on_tenant();

COMMENT ON TRIGGER trg_tenants_seed_ref_formats ON public.tenants IS
  'A tenant cannot exist without its ref formats. Same shape and same reason as '
  '011''s trg_tenants_seed_action_policies: public.tenants is written by the '
  'onboarding path, by seeds and by test fixtures, and a provisioning SCRIPT only '
  'covers the path somebody remembered to run it on. 016.';

-- ============================================================================
-- §2 · app.provision_tenant() — the explicit path, over the same mechanism
-- ============================================================================
-- Creates a tenant and returns its id. It does NOT seed anything itself: the two
-- AFTER INSERT triggers do the work, so there is exactly one implementation of
-- "what a new tenant gets" and no second copy to drift from the first.

-- ⚠ THE DROP IS MANDATORY AND IS NOT TIDINESS. `p_id` was added after the seeds
-- lane found it needed one (see below), and a bare CREATE OR REPLACE does NOT
-- replace a function when the parameter LIST changes — it creates an OVERLOAD
-- beside it. Both would then carry defaults covering a two- and three-argument
-- call, and every existing caller, this pack's own T3 included, would fail with
-- `function app.provision_tenant(unknown, unknown) is not unique`. Measured on
-- the shim before writing this line, not assumed.
DROP FUNCTION IF EXISTS app.provision_tenant(text,text,text);

CREATE OR REPLACE FUNCTION app.provision_tenant(
  p_slug     text,
  p_name     text,
  p_timezone text DEFAULT 'Asia/Kuala_Lumpur',
  -- ⚠ `p_id` EXISTS BECAUSE A CONSUMER COULD NOT USE THE FUNCTION WITHOUT IT, and
  -- the alternative was worse in a way worth recording. The seed lane's fixture
  -- world is keyed on fixed, memorable tenant ids — `supabase/seeds/README.md`
  -- requires them, and the RPC tests and screenshots quote them literally — so
  -- ~5,000 seeded rows carry `tenant_id` as a constant. A generated id cannot be
  -- retrofitted: `core.ref_formats`, `core.action_policies` and `core.check_keys`
  -- already reference the tenant by the time this function returns, and none of
  -- those foreign keys is `ON UPDATE CASCADE`, so updating the id afterwards
  -- fails. Deleting the provisioned children, changing the id and re-seeding
  -- works and re-implements half of provisioning inside a seed, which rots the
  -- day 018 provisions a fourth table.
  --
  -- Defaulting to NULL keeps every existing caller byte-identical, and the
  -- parameter is independently right for a restore or a tenant migration, where
  -- the id is given rather than chosen. A supplied id that already exists fails
  -- on the primary key, which is the correct refusal and needs no check here.
  p_id       uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;
  v_formats  integer;
  v_policies integer;
BEGIN
  IF p_slug IS NULL OR pg_catalog.btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'provision_tenant: p_slug is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_name IS NULL OR pg_catalog.btrim(p_name) = '' THEN
    RAISE EXCEPTION 'provision_tenant: p_name is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.tenants (id, slug, name, timezone)
  VALUES (COALESCE(p_id, gen_random_uuid()), p_slug, p_name, p_timezone)
  RETURNING id INTO v_id;

  -- Both seeds are triggers, so by here they have run. Verifying that they DID is
  -- the point: a disabled trigger, or a trigger dropped by a later migration that
  -- did not know it mattered, would otherwise produce a tenant that looks
  -- provisioned and cannot write a single ref'd row. Failing here costs one
  -- transaction; failing later costs a customer's first enquiry.
  SELECT pg_catalog.count(*) INTO v_formats
    FROM core.ref_formats WHERE tenant_id = v_id;
  IF v_formats = 0 THEN
    RAISE EXCEPTION
      'provision_tenant: tenant % was created with no ref_formats. The AFTER '
      'INSERT trigger on public.tenants did not run, so every ref''d table is '
      'unwritable for this tenant.', v_id;
  END IF;

  SELECT pg_catalog.count(*) INTO v_policies
    FROM core.action_policies WHERE tenant_id = v_id;
  IF v_policies = 0 THEN
    RAISE EXCEPTION
      'provision_tenant: tenant % was created with no action_policies (011). '
      'Every action would fall through the policy gate with nothing to evaluate.',
      v_id;
  END IF;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION app.provision_tenant(text,text,text,uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app.provision_tenant(text,text,text,uuid) IS
  'Creates a tenant and returns its id, letting the AFTER INSERT triggers seed it '
  'so there is one implementation of what a new tenant gets. Refuses to return a '
  'tenant that has no ref_formats or no action_policies, because a tenant that '
  'looks provisioned and cannot write a ref''d row fails at the customer''s first '
  'enquiry rather than here. p_id lets a caller supply the tenant id instead of '
  'generating one, which a seed with fixed fixture ids and a restore both need; '
  'NULL keeps every other caller unchanged. Not granted to any client role: '
  'provisioning is an operator act. 016.';

-- ============================================================================
-- §3 · Backfill any tenant that already exists
-- ============================================================================
-- A trigger only fires on rows inserted after it exists. On the shim this loop
-- does nothing (no tenant is committed); on a database that already carries
-- tenants it is the difference between 016 provisioning everybody and 016
-- provisioning only the next customer.

DO $backfill$
DECLARE
  r       pg_catalog.record;
  v_n     integer;
  v_total integer := 0;
  v_seen  integer := 0;
BEGIN
  FOR r IN SELECT id, slug FROM public.tenants ORDER BY id LOOP
    v_seen := v_seen + 1;
    v_n := app.seed_ref_formats(r.id);
    v_total := v_total + v_n;
    IF v_n > 0 THEN
      RAISE NOTICE '016: backfilled % ref_format row(s) for tenant %', v_n, r.slug;
    END IF;
  END LOOP;
  RAISE NOTICE '016: % existing tenant(s) inspected, % ref_format row(s) added',
    v_seen, v_total;
END;
$backfill$;

-- ============================================================================
-- §4 · Verify
-- ============================================================================

DO $verify$
DECLARE
  v_triggers integer;
  v_bad      text;
BEGIN
  SELECT pg_catalog.count(*) INTO v_triggers
    FROM pg_catalog.pg_trigger AS trg
    JOIN pg_catalog.pg_class     AS cls ON cls.oid = trg.tgrelid
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = cls.relnamespace
    JOIN pg_catalog.pg_proc      AS prc ON prc.oid = trg.tgfoid
   WHERE nsp.nspname='core' AND prc.proname='assign_ref' AND NOT trg.tgisinternal;

  IF v_triggers < 30 THEN
    RAISE EXCEPTION
      '016 verify: only % core.assign_ref trigger(s) found; 001-015 create 32, and '
      'a number this low means the seed would provision an incomplete tenant',
      v_triggers;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid='public.tenants'::regclass
                    AND tgname='trg_tenants_seed_ref_formats') THEN
    RAISE EXCEPTION '016 verify: the provisioning trigger was not created';
  END IF;

  -- Every existing tenant has a row for every prefix. Expressed as a set
  -- difference rather than a count, so the failure names the missing prefix.
  SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s/%s', t.slug, p.prefix), ', ')
    INTO v_bad
    FROM public.tenants AS t
   CROSS JOIN (
     SELECT DISTINCT pg_catalog.split_part(
              pg_catalog.encode(trg.tgargs,'escape'),'\000',1) AS prefix
       FROM pg_catalog.pg_trigger AS trg
       JOIN pg_catalog.pg_class     AS cls ON cls.oid = trg.tgrelid
       JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = cls.relnamespace
       JOIN pg_catalog.pg_proc      AS prc ON prc.oid = trg.tgfoid
      WHERE nsp.nspname='core' AND prc.proname='assign_ref' AND NOT trg.tgisinternal
   ) AS p
   WHERE NOT EXISTS (
     SELECT 1 FROM core.ref_formats AS f
      WHERE f.tenant_id = t.id AND f.prefix = p.prefix);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '016 verify: tenant/prefix pair(s) with no ref_format: %. Each one is a '
      'table that tenant cannot write a row into.', v_bad;
  END IF;

  RAISE NOTICE '016 verify: OK - % assign_ref triggers, all provisioned', v_triggers;
END;
$verify$;

COMMIT;
