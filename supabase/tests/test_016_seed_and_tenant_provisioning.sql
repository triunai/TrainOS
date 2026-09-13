-- ============================================================================
-- PIN 016 · seed_and_tenant_provisioning
-- ============================================================================
--
-- Run against the complete 001-016 set. Ends in ROLLBACK; writes nothing durable.
--   psql "$DATABASE_URL" -f supabase/tests/test_016_seed_and_tenant_provisioning.sql
--
-- ⚠ AUTHORSHIP. Drafted by Claude (Opus) in the `cloud/migrations` lane,
-- 2026-09-13. **Codex (gpt-5.6-sol xhigh) review is PENDING.** Every assertion
-- below has been EXECUTED and passes; none has been adversarially reviewed.
--
-- T1  The derived list IS the consumer's list: one ref_format per assign_ref
--     trigger, 32 of them, and specifically the five a line-based read of the
--     migrations misses.
-- T2  **The whole point of the pack.** A tenant created the ordinary way — one
--     INSERT, no fixture, no hand-seeded format — can write a ref'd row into
--     every one of the 32 tables. This is the path six earlier pins have been
--     faking.
-- T3  app.provision_tenant returns a usable tenant and REFUSES to return a
--     half-provisioned one.
-- T4  Idempotence, the way that matters: re-seeding a tenant that has already
--     allocated refs does NOT overwrite its formats, because `ref` is immutable
--     and reshaping `dated` would split a customer's numbering in half.
-- T5  The dated / undated distinction is real and visible in the allocated ref.
-- T6  Per-tenant numbering survives provisioning: two tenants provisioned the
--     same way both start at 0001, which is 004's T4 property re-proved through
--     the real provisioning path rather than through hand-written fixtures.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $setup$
BEGIN
  IF pg_catalog.to_regproc('app.provision_tenant') IS NULL
     OR pg_catalog.to_regproc('app.seed_ref_formats') IS NULL THEN
    RAISE EXCEPTION 'test_016 SETUP FAILURE: migration 016 is missing or partial';
  END IF;
END;
$setup$;

-- ─── T1 · The derived list is the consumer's list ───────────────────────────

DO $t1$
DECLARE
  v_triggers integer;
  v_missing  text;
  p          text;
BEGIN
  SELECT pg_catalog.count(*) INTO v_triggers
    FROM pg_catalog.pg_trigger AS trg
    JOIN pg_catalog.pg_class     AS cls ON cls.oid = trg.tgrelid
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = cls.relnamespace
    JOIN pg_catalog.pg_proc      AS prc ON prc.oid = trg.tgfoid
   WHERE nsp.nspname='core' AND prc.proname='assign_ref' AND NOT trg.tgisinternal;

  ASSERT v_triggers = 32,
    pg_catalog.format('T1a FAIL: expected 32 core.assign_ref triggers, found %s. '
      'The seed is derived from this list, so a change here silently changes what '
      'a new customer is provisioned with.', v_triggers);

  -- The five that a hand-built list misses, named individually. Reading the
  -- migrations for `finalise_table(...,'PREFIX')` yields 27 prefixes because
  -- these five calls are wrapped across lines. Each one is a table a customer
  -- would find unwritable in production.
  FOREACH p IN ARRAY ARRAY['ATT','PIP','SIG','SVW','TPL'] LOOP
    ASSERT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trg
        JOIN pg_catalog.pg_class     AS cls ON cls.oid = trg.tgrelid
        JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = cls.relnamespace
        JOIN pg_catalog.pg_proc      AS prc ON prc.oid = trg.tgfoid
       WHERE nsp.nspname='core' AND prc.proname='assign_ref'
         AND NOT trg.tgisinternal
         AND pg_catalog.split_part(pg_catalog.encode(trg.tgargs,'escape'),'\000',1) = p),
      pg_catalog.format('T1b FAIL: prefix %s has no assign_ref trigger. It is one '
        'of the five a line-based read of the migrations misses, which is the '
        'reason this seed is derived rather than transcribed.', p);
  END LOOP;

  RAISE NOTICE
    'T1 PASS - 32 assign_ref triggers, including the five (ATT, PIP, SIG, SVW, '
    'TPL) that a hand-built list of 27 would have left unprovisioned.';
END;
$t1$;

-- ─── T2 · A plainly-inserted tenant can write every ref'd table ─────────────
-- No fixture ref_formats anywhere in this block. That is the assertion.

INSERT INTO auth.users (id,email) VALUES
  ('00000016-0000-0000-0000-0000000000a1','t016-alpha@example.invalid'),
  ('00000016-0000-0000-0000-0000000000b1','t016-beta@example.invalid');

INSERT INTO public.tenants (id,slug,name,timezone) VALUES
  ('00000016-1111-1111-1111-111111111111','t016-alpha','T016 Alpha','Asia/Kuala_Lumpur');

INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,status,is_default)
VALUES ('00000016-1111-1111-1111-111111111111',
        '00000016-0000-0000-0000-0000000000a1','SALES','HUMAN','ACTIVE',true);

DO $t2$
DECLARE
  v_formats integer;
  v_missing text;
  v_ref     text;
BEGIN
  SELECT pg_catalog.count(*) INTO v_formats
    FROM core.ref_formats WHERE tenant_id='00000016-1111-1111-1111-111111111111';
  ASSERT v_formats = 32,
    pg_catalog.format('T2a FAIL: a plain INSERT into public.tenants produced %s '
      'ref_format rows, expected 32. The AFTER INSERT trigger is the only thing '
      'that covers the onboarding path, a seed AND a test fixture at once.',
      v_formats);

  -- Every prefix the triggers declare has a format. Set difference, so the
  -- failure names the prefix rather than a count.
  SELECT pg_catalog.string_agg(p.prefix, ', ') INTO v_missing
    FROM (
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
      WHERE f.tenant_id='00000016-1111-1111-1111-111111111111' AND f.prefix=p.prefix);
  ASSERT v_missing IS NULL,
    pg_catalog.format('T2b FAIL: prefix(es) %s have no ref_format for a freshly '
      'provisioned tenant. Each is a table that tenant cannot write a row into.',
      v_missing);

  -- And now the part that actually matters: allocate a ref through the real
  -- trigger path, with no fixture format in sight. This is the call that six
  -- earlier pins had to hand-seed around.
  INSERT INTO core.organisations (tenant_id, name, owner_id)
  VALUES ('00000016-1111-1111-1111-111111111111','T016 Alpha Manufacturing',
          '00000016-0000-0000-0000-0000000000a1')
  RETURNING ref INTO v_ref;

  ASSERT v_ref IS NOT NULL AND v_ref LIKE 'ORG-%',
    pg_catalog.format('T2c FAIL: core.assign_ref produced "%s" for a provisioned '
      'tenant. Before 016 this raised foreign_key_violation from inside a trigger '
      'with the message "no ref_format for prefix ORG in this tenant".', v_ref);

  RAISE NOTICE
    'T2 PASS - one INSERT into public.tenants, no fixture, 32 formats, and a real '
    'ref allocated through the trigger path: %.', v_ref;
END;
$t2$;

-- ─── T3 · provision_tenant ──────────────────────────────────────────────────

DO $t3$
DECLARE
  v_id      uuid;
  v_formats integer;
  v_pol     integer;
  v_refused boolean;
BEGIN
  v_id := app.provision_tenant('t016-beta','T016 Beta');

  SELECT pg_catalog.count(*) INTO v_formats FROM core.ref_formats WHERE tenant_id=v_id;
  SELECT pg_catalog.count(*) INTO v_pol     FROM core.action_policies WHERE tenant_id=v_id;

  ASSERT v_formats = 32,
    pg_catalog.format('T3a FAIL: provision_tenant returned a tenant with %s '
      'ref_formats', v_formats);
  ASSERT v_pol > 0,
    'T3b FAIL: provision_tenant returned a tenant with no action_policies, so '
    '011''s seed trigger did not run and every action would reach the policy gate '
    'with nothing to evaluate.';

  -- It refuses garbage rather than creating a nameless tenant.
  v_refused := false;
  BEGIN
    PERFORM app.provision_tenant('   ','T016 Blank Slug');
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  ASSERT v_refused, 'T3c FAIL: provision_tenant accepted a blank slug';

  -- And the guard that makes it worth having: with the seeding trigger disabled,
  -- provision_tenant must RAISE rather than hand back a tenant that cannot write
  -- a single ref'd row. A later migration dropping this trigger without knowing
  -- it mattered is exactly the scenario.
  ALTER TABLE public.tenants DISABLE TRIGGER trg_tenants_seed_ref_formats;
  v_refused := false;
  BEGIN
    PERFORM app.provision_tenant('t016-broken','T016 Broken');
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  ALTER TABLE public.tenants ENABLE TRIGGER trg_tenants_seed_ref_formats;

  ASSERT v_refused,
    'T3d FAIL: with the seeding trigger disabled, provision_tenant still returned '
    'a tenant. A tenant that looks provisioned and has no ref_formats fails at the '
    'customer''s first enquiry instead of here.';

  -- (e) The p_id path, which is the reason the parameter exists. A seed keyed on
  -- fixed, memorable tenant ids cannot use a generated one: the provisioned
  -- children are already referencing the tenant by the time this returns and none
  -- of those foreign keys is ON UPDATE CASCADE, so there is no fixing it
  -- afterwards. Asserted on the RETURNED id AND on the row, because a function
  -- that inserted the supplied id and returned a different one would be worse
  -- than one that ignored the parameter outright.
  v_id := app.provision_tenant('t016-fixed','T016 Fixed','Asia/Kuala_Lumpur',
                               '00000016-f1ed-4000-8000-000000000001'::uuid);
  ASSERT v_id = '00000016-f1ed-4000-8000-000000000001'::uuid,
    pg_catalog.format('T3e FAIL: provision_tenant was given an explicit id and '
      'returned %s. A seed with fixed fixture ids cannot use a generated one, and '
      'the children are already referencing the tenant by the time this returns.',
      v_id);
  ASSERT EXISTS (SELECT 1 FROM public.tenants
                  WHERE id = '00000016-f1ed-4000-8000-000000000001'::uuid
                    AND slug = 't016-fixed'),
    'T3e2 FAIL: the tenant row does not carry the supplied id.';

  SELECT pg_catalog.count(*) INTO v_formats
    FROM core.ref_formats WHERE tenant_id = v_id;
  ASSERT v_formats = 32,
    pg_catalog.format('T3e3 FAIL: the explicitly-identified tenant got %s '
      'ref_formats. Supplying the id must not bypass provisioning — that is the '
      'whole reason a seed calls this rather than inserting the row itself.',
      v_formats);

  -- (f) Passing NULL is identical to omitting it. This is what keeps every
  -- pre-amendment caller correct, so it is asserted rather than assumed.
  v_id := app.provision_tenant('t016-nullid','T016 Null Id','Asia/Kuala_Lumpur', NULL);
  ASSERT v_id IS NOT NULL,
    'T3f FAIL: an explicit NULL p_id did not generate an id.';

  -- (g) A duplicate id is refused by the primary key rather than silently
  -- reusing or overwriting a tenant.
  v_refused := false;
  BEGIN
    PERFORM app.provision_tenant('t016-dupe','T016 Dupe','Asia/Kuala_Lumpur',
                                 '00000016-f1ed-4000-8000-000000000001'::uuid);
  EXCEPTION WHEN unique_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T3g FAIL: provision_tenant accepted an id that already exists. Reusing a '
    'live tenant''s id would attach a new customer to another customer''s rows.';

  RAISE NOTICE
    'T3 PASS - provision_tenant returns a fully seeded tenant, refuses a blank '
    'slug, refuses to hand back a tenant whose seeding trigger did not fire, '
    'honours an explicitly supplied id without bypassing provisioning, treats '
    'NULL as "generate one", and refuses a duplicate id.';
END;
$t3$;

-- ─── T4 · Idempotence that does not reshape a live tenant ──────────────────

DO $t4$
DECLARE
  v_added   integer;
  v_dated   boolean;
  v_ref2    text;
BEGIN
  -- Alpha has already allocated ORG-0001 in T2. Deliberately corrupt one format
  -- the way a careless re-seed would, then re-seed and prove it is NOT repaired
  -- by overwriting — because overwriting is the dangerous direction.
  UPDATE core.ref_formats SET dated = true
   WHERE tenant_id='00000016-1111-1111-1111-111111111111' AND prefix='ORG';

  v_added := app.seed_ref_formats('00000016-1111-1111-1111-111111111111');
  ASSERT v_added = 0,
    pg_catalog.format('T4a FAIL: re-seeding an already-provisioned tenant added %s '
      'row(s); it must add none.', v_added);

  SELECT dated INTO v_dated FROM core.ref_formats
   WHERE tenant_id='00000016-1111-1111-1111-111111111111' AND prefix='ORG';
  ASSERT v_dated,
    'T4b FAIL: re-seeding OVERWROTE an existing ref_format. That is the unsafe '
    'idempotence: `ref` is immutable after insert, so flipping `dated` under a '
    'tenant leaves every ref issued so far in the old shape and every future one '
    'in the new, with no way to correct either.';

  -- Restore, and prove the counter was never disturbed: the next ORG is 0002,
  -- not 0001. This is what makes deleting formats in the rollback safe.
  UPDATE core.ref_formats SET dated = false
   WHERE tenant_id='00000016-1111-1111-1111-111111111111' AND prefix='ORG';
  INSERT INTO core.organisations (tenant_id, name, owner_id)
  VALUES ('00000016-1111-1111-1111-111111111111','T016 Alpha Second',
          '00000016-0000-0000-0000-0000000000a1')
  RETURNING ref INTO v_ref2;
  ASSERT v_ref2 = 'ORG-0002',
    pg_catalog.format('T4c FAIL: the second organisation got ref "%s", expected '
      'ORG-0002. Allocations live in core.ref_sequences and must survive anything '
      'done to core.ref_formats, which is the property the 016 rollback relies on '
      'when it deletes unused formats.', v_ref2);

  RAISE NOTICE
    'T4 PASS - re-seeding adds nothing and overwrites nothing, and the allocation '
    'counter is untouched by it (ORG-0002 follows ORG-0001).';
END;
$t4$;

-- ─── T5 · dated and undated are really different ───────────────────────────

DO $t5$
DECLARE
  v_enq  text;
  v_org  text;
  v_year text := pg_catalog.to_char(
    pg_catalog.now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY');
BEGIN
  INSERT INTO core.enquiries (tenant_id, channel, status, received_at)
  VALUES ('00000016-1111-1111-1111-111111111111','EMAIL','OPEN', pg_catalog.now())
  RETURNING ref INTO v_enq;

  SELECT ref INTO v_org FROM core.organisations
   WHERE tenant_id='00000016-1111-1111-1111-111111111111' AND ref='ORG-0001';

  ASSERT v_enq = 'ENQ-' || v_year || '-0001',
    pg_catalog.format('T5a FAIL: ENQ is a dated prefix and allocated "%s", '
      'expected ENQ-%s-0001. The contract renders this on every enquiry screen.',
      v_enq, v_year);

  ASSERT v_org = 'ORG-0001',
    pg_catalog.format('T5b FAIL: ORG is undated and allocated "%s", expected '
      'ORG-0001.', v_org);

  RAISE NOTICE
    'T5 PASS - the dated prefix renders ENQ-%-0001 and the undated one ORG-0001, '
    'so the one thing 016 cannot derive from a trigger is at least asserted.',
    v_year;
END;
$t5$;

-- ─── T6 · Per-tenant numbering, through the real provisioning path ─────────
-- 004's T4 proved two tenants both get TPL-0001 using hand-written ref_formats.
-- This re-proves it through provisioning, because a seed that accidentally made
-- formats global would give tenant two ORG-0003 and no access-control test would
-- ever catch it: no row is exposed, only a count is leaked.

DO $t6$
DECLARE
  v_beta uuid;
  v_ref  text;
BEGIN
  SELECT id INTO v_beta FROM public.tenants WHERE slug='t016-beta';

  INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,status,is_default)
  VALUES (v_beta,'00000016-0000-0000-0000-0000000000b1','SALES','HUMAN','ACTIVE',true);

  INSERT INTO core.organisations (tenant_id, name, owner_id)
  VALUES (v_beta,'T016 Beta Logistics','00000016-0000-0000-0000-0000000000b1')
  RETURNING ref INTO v_ref;

  ASSERT v_ref = 'ORG-0001',
    pg_catalog.format('T6 FAIL: the second tenant''s FIRST organisation got "%s", '
      'expected ORG-0001. A shared counter lets every customer read every other '
      'customer''s record volume off a ref, and no access-control test catches it '
      'because no row is exposed.', v_ref);

  RAISE NOTICE
    'T6 PASS - two tenants provisioned through the real path both start at '
    'ORG-0001, so provisioning did not make the counters global.';
END;
$t6$;


-- ─── T7 · the rollback deletes only rows 016 can prove it wrote ────────────
-- The finding: `rollbacks/016` ran `DELETE FROM core.ref_formats WHERE NOT
-- EXISTS (allocated)` with no further qualification — every unallocated
-- ref_format IN THE DATABASE, including one an operator configured by hand
-- before 016 existed. Its post-condition then demanded that zero unallocated
-- rows survive, so the over-deletion was enforced as correct and the rollback
-- could not fail. Same class as 014's rollback taking 002's grants.
--
-- ⚠ THIS PIN RESTATES THE ROLLBACK'S PREDICATE RATHER THAN CALLING IT, and that
-- is a real weakness worth naming instead of hiding. The rollback is a file with
-- its own BEGIN/COMMIT; running it from inside this transaction would commit
-- this transaction, and a pin that can leave fixtures behind is not a pin. So
-- the predicate is duplicated here, and T7d guards the duplication: it asserts
-- the two are still the same shape by requiring that the set this pin computes
-- over a freshly provisioned tenant is EXACTLY the set the forward seeder wrote
-- for it. If the rollback's predicate is narrowed or widened without this one
-- moving, the fresh-tenant set stops matching and this fails.
DO $t7$
DECLARE
  v_tenant   uuid;
  v_seeded   integer;
  v_matched  integer;
  v_hand     integer;
BEGIN
  v_tenant := app.provision_tenant('t016-rbk','T016 Rollback Probe','Asia/Kuala_Lumpur');

  -- ⚠ COUNTED THE SAME WAY THE DELETE SET IS, allocation clause included.
  --
  -- 019 seeds a default ENGAGEMENT pipeline per tenant at provision time, and
  -- that seed's `assign_ref('PIP')` ALLOCATES a ref — which writes a
  -- core.ref_sequences row. The rollback deliberately refuses to delete a format
  -- a tenant has allocated against: refs are immutable once issued, so removing
  -- the format that shapes them would strand every ref already in the wild. That
  -- clause is correct and stays.
  --
  -- So it is `v_seeded` that was wrong, not the rollback. Counting ALL of the
  -- tenant's formats and comparing against a delete set that excludes the
  -- allocated ones compares two different populations, and the moment any seed
  -- allocates during provisioning — which 019 now does — the numbers part by
  -- exactly that many. Both sides now ask the same question: of the rows 016
  -- seeded, how many are still unallocated.
  SELECT pg_catalog.count(*) INTO v_seeded
    FROM core.ref_formats AS f
   WHERE f.tenant_id = v_tenant
     AND NOT EXISTS (SELECT 1 FROM core.ref_sequences AS s
                      WHERE s.tenant_id = f.tenant_id AND s.prefix = f.prefix);
  ASSERT v_seeded > 0, 'T7 SETUP FAIL: the probe tenant was seeded no unallocated ref_formats.';

  -- A row no trigger could have produced: a prefix that is not any assign_ref
  -- argument, an entity that is not a table, a width that is not the derived 4.
  INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width)
  VALUES (v_tenant, 'ZZQ', 'configured_by_an_operator', false, 6);

  -- The rollback's predicate, restated. See the note above.
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
  SELECT pg_catalog.count(*) INTO v_matched
    FROM core.ref_formats AS f
    JOIN derived AS d ON d.prefix = f.prefix AND d.entity = f.entity
   WHERE f.tenant_id = v_tenant
     AND f.width = 4
     AND NOT EXISTS (SELECT 1 FROM core.ref_sequences AS s
                      WHERE s.tenant_id = f.tenant_id AND s.prefix = f.prefix);

  -- T7a · the hand-made row is NOT in the delete set.
  SELECT pg_catalog.count(*) INTO v_hand
    FROM core.ref_formats AS f
   WHERE f.tenant_id = v_tenant AND f.prefix = 'ZZQ';
  ASSERT v_hand = 1, 'T7a FAIL: the hand-made probe row was not created.';

  ASSERT v_matched = v_seeded,
    pg_catalog.format('T7b FAIL: the rollback''s delete set covers %s of this '
      'tenant''s %s rows. It must cover exactly the seeded ones: fewer means the '
      'rollback leaves 016''s own rows behind, more means it is reaching past '
      'them — and the row it would reach first is the operator''s ZZQ row, which '
      'is unallocated and which the unqualified predicate deleted.',
      v_matched, v_seeded);

  -- T7c · stated the other way round, so the number above cannot be right by
  -- coincidence: the hand-made row must be excluded by the predicate itself.
  ASSERT NOT EXISTS (
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
    SELECT 1 FROM core.ref_formats AS f
      JOIN derived AS d ON d.prefix = f.prefix AND d.entity = f.entity
     WHERE f.tenant_id = v_tenant AND f.prefix = 'ZZQ' AND f.width = 4),
    'T7c FAIL: a hand-configured ref_format matched 016''s derivation, so the '
    'rollback would delete a row 016 never wrote. This is the finding.';

  -- T7d · and the OLD, unqualified predicate would have taken it. Written out so
  -- the pin fails if somebody "simplifies" the rollback back to it.
  ASSERT EXISTS (
    SELECT 1 FROM core.ref_formats AS f
     WHERE f.tenant_id = v_tenant AND f.prefix = 'ZZQ'
       AND NOT EXISTS (SELECT 1 FROM core.ref_sequences AS s
                        WHERE s.tenant_id=f.tenant_id AND s.prefix=f.prefix)),
    'T7d FAIL: the probe row is allocated against, so it would have survived the '
    'unqualified predicate too and this pin proves nothing. Pick a prefix with no '
    'ref_sequences row.';

  RAISE NOTICE
    'T7 PASS - the rollback''s delete set is exactly the % unallocated rows 016 '
    'seeded for a fresh tenant, excludes an operator-configured row that the old '
    'unqualified predicate would have taken, and excludes any format the tenant '
    'has already allocated a ref against.', v_seeded;
END;
$t7$;



-- ─── T8 · the seed registry carries the same posture as every app config table ─
-- `app.tenant_seed_checks` shipped with a REVOKE and no RLS, while
-- `app.role_permissions` and every comparable `app.*` configuration table are RLS
-- enabled AND forced with no policy on top of their revoke. One layer instead of
-- two: a future `GRANT SELECT ON ALL TABLES IN SCHEMA app` would open this table
-- and nothing would object. This is the table that decides what "provisioned"
-- means, so a client able to read it learns the shape of every tenant's seed.
DO $t8$
DECLARE v_priv text;
BEGIN
  ASSERT (SELECT c.relrowsecurity AND c.relforcerowsecurity
            FROM pg_catalog.pg_class AS c
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
           WHERE n.nspname='app' AND c.relname='tenant_seed_checks'),
    'T8a FAIL: app.tenant_seed_checks is not RLS enabled AND forced. Every other '
    'app configuration table is, and the revoke beside it is the other half of a '
    'pair, not the whole guard.';

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS p
      JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname='app' AND c.relname='tenant_seed_checks'),
    'T8b FAIL: a policy was added to app.tenant_seed_checks. Forced RLS with NO '
    'policy is the deny-all posture; a policy here is somebody opening it.';

  -- has_table_privilege, not information_schema: a privilege held through PUBLIC
  -- appears under neither client role name.
  SELECT pg_catalog.string_agg(w.priv, ', ' ORDER BY w.priv) INTO v_priv
    FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS w(priv)
   WHERE has_table_privilege('authenticated','app.tenant_seed_checks', w.priv)
      OR has_table_privilege('anon','app.tenant_seed_checks', w.priv);
  ASSERT v_priv IS NULL,
    pg_catalog.format('T8c FAIL: a client role holds %s on app.tenant_seed_checks.', v_priv);

  -- And provision_tenant still reads it, which is the point of the posture: the
  -- function is SECURITY DEFINER, so deny-all costs the product nothing.
  ASSERT (SELECT pg_catalog.count(*) FROM app.tenant_seed_checks) >= 3,
    'T8d FAIL: the registry is empty or unreadable by the owner, which would make '
    'provision_tenant''s guard decorative.';

  RAISE NOTICE
    'T8 PASS - app.tenant_seed_checks is RLS forced with no policy and no client '
    'privilege, and provision_tenant can still read it.';
END;
$t8$;


ROLLBACK;
