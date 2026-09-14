-- ============================================================================
-- PIN 004 · shell_config_and_ref_allocation
-- ============================================================================
--
-- Run only AFTER 004. Ends in ROLLBACK; writes nothing durable.
--   psql "$DATABASE_URL" -f supabase/tests/test_004_shell_config_and_ref_allocation.sql
--
-- WHAT THIS PIN IS FOR. `app.finalise_table` is a new spine object: every table
-- migration from 005 onward goes through it, so a defect here is a defect in
-- eighty tables at once and it will not look like one. The pin therefore tests
-- the FINALISER, not the fourteen tables it happened to be applied to — T5
-- builds a throwaway table, finalises it, and checks that every one of the
-- eight properties actually landed.
--
-- The other assertion that earns its place is T4: refs must be allocated per
-- tenant. Two tenants creating their first template must BOTH get `TPL-0001`.
-- A global counter would be a cross-tenant information leak — the customer can
-- see roughly how many records every other customer has created — and it is the
-- kind of leak that survives every access-control test because no row is ever
-- exposed.
--
-- RUNNABILITY NOTES
-- 1. Fixtures create real `public.tenants` and `core.ref_formats` rows; the ref
--    allocator resolves the format and the tenant's timezone from them.
-- 2. Runs as the migration role throughout: RLS is FORCED on every core table
--    and there are no policies yet, so an impersonated read would see nothing
--    and prove nothing. The four-way matrix for these tables arrives with the
--    policies, in test_014.
-- 3. Fixture ids namespaced `00000004-`.
-- 4. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_004 SETUP FAILURE: check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF to_regclass('core.pipeline_steps') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'app' AND p.proname = 'finalise_table') THEN
    RAISE EXCEPTION 'test_004 SETUP FAILURE: 004 is missing or partial.';
  END IF;
END;
$setup$;

INSERT INTO public.tenants (id, slug, name, timezone) VALUES
  ('00000004-1111-1111-1111-111111111111', 't004-alpha', 'Alpha', 'Asia/Kuala_Lumpur'),
  ('00000004-2222-2222-2222-222222222222', 't004-beta',  'Beta',  'Asia/Kuala_Lumpur');

INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width) VALUES
  ('00000004-1111-1111-1111-111111111111','TPL','templates',false,4),
  ('00000004-1111-1111-1111-111111111111','ENQ','enquiries',true, 4),
  ('00000004-2222-2222-2222-222222222222','TPL','templates',false,4)
  -- ⚠ 016 now provisions every tenant's ref_formats from an AFTER INSERT trigger
  -- on public.tenants, so this fixture collides with the real thing. The pin's
  -- own shape wins: it is a fixture inside a transaction that rolls back, and
  -- the assertions below were written against these exact values.
  ON CONFLICT (tenant_id, prefix)
    DO UPDATE SET entity = EXCLUDED.entity,
                  dated  = EXCLUDED.dated,
                  width  = EXCLUDED.width;

-- === T1 · every core table is RLS forced with zero policies (deny-all) =======
DO $t1$
DECLARE v_bad text; v_n int;
BEGIN
  SELECT string_agg(c.relname, ', '), count(*) INTO v_bad, v_n
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  ASSERT v_bad IS NULL, format('T1a FAIL: core table(s) not RLS forced: %s', v_bad);

  -- T1b. NARROWED 2026-09-13, when 011 landed and this assertion failed.
  -- It used to read "no core table carries any policy". That was too broad, not
  -- wrong in spirit: what it defends is that nothing is READABLE before 014,
  -- and a PERMISSIVE policy is the only kind that can grant a read. 011 lands
  -- exactly one RESTRICTIVE policy on purpose --
  -- `autonomy_grants_agents_cannot_write`, carrying `NOT app.is_agent()` in both
  -- USING and WITH CHECK -- because critic finding H-02 is that an agent can
  -- otherwise raise its own autonomy to AUTONOMOUS, and leaving that open from
  -- 011 until 014 is the exposure the finding names. A restrictive policy can
  -- only ever subtract, so it cannot be the thing that opens a table early.
  --
  -- The exception is pinned by NAME and by TABLE, as exact values rather than as
  -- a count, because a second restrictive policy appearing quietly is precisely
  -- what this check exists to catch.
  -- ⚠ AMENDED BY 014 (2026-09-13). This check used to assert that NO core table
  -- carried a permissive policy at all, on the ground that "a permissive policy
  -- grants a read and belongs in 014". 014 has now landed and that is exactly
  -- where those policies came from, so the original form asserts a state the
  -- database is no longer required to be in.
  --
  -- The property worth keeping is not "none" — it is that every permissive policy
  -- in `core` is one 014 put there, under the name 014 gives it. A permissive
  -- policy appearing under any OTHER name is still the thing this check exists to
  -- catch: it grants a read, it was not stamped by app.apply_tenant_policies, and
  -- nobody reviewed its predicate. So the check is inverted rather than deleted,
  -- and it is still by NAME rather than by count.
  SELECT string_agg(c.relname || '.' || pol.polname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_policy pol ON pol.polrelid = c.oid
  WHERE n.nspname = 'core' AND c.relkind = 'r' AND pol.polpermissive
    AND pol.polname <> c.relname || '_tenant_select'
    AND pol.polname <> 'provenance_subjects_read';
  ASSERT v_bad IS NULL,
    format('T1b FAIL: core table(s) carry a PERMISSIVE policy that 014 did not '
           'create: %s. Every permissive policy in core must be the '
           '<table>_tenant_select stamped by app.apply_tenant_policies, or the '
           'one named exception on the tenant-less lookup table. Anything else '
           'grants a read whose predicate nobody reviewed.', v_bad);

  SELECT coalesce(string_agg(c.relname || '.' || pol.polname, ', '
                             ORDER BY c.relname, pol.polname), '(none)')
    INTO v_bad
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_policy pol ON pol.polrelid = c.oid
  -- ⚠ AMENDED BY 014 (2026-09-13). Was: the restrictive set must be exactly
  -- H-02's one policy, because 011 landing a single restrictive guard early was
  -- the whole point of the check. 014 now stamps a <table>_tenant_isolation
  -- RESTRICTIVE policy on every tenant-scoped core table, so an exact-set match
  -- is no longer the right shape. H-02's guard is still asserted by name, and the
  -- new question — is there a restrictive policy nobody stamped? — is asked
  -- alongside it.
  -- ⚠ AMENDED BY 033 (2026-09-14). 033 (H4 + the core.events bespoke fix — see
  -- its migration header for why apply_tenant_policies could not gate
  -- core.events on a permission) adds four more named, deliberate RESTRICTIVE
  -- policies beside H-02's kill switch: MY_ACCOUNTS owner-narrowing on
  -- core.organisations/opportunities/enquiries, and CLIENT-exclusion on
  -- core.events. Same shape as 014's own amendment above — asserted by NAME,
  -- not by count, so a fifth policy appearing under any OTHER name is still
  -- caught.
  WHERE n.nspname = 'core' AND c.relkind = 'r' AND NOT pol.polpermissive
    AND pol.polname <> c.relname || '_tenant_isolation';
  ASSERT v_bad = 'autonomy_grants.autonomy_grants_agents_cannot_write, '
                 'enquiries.enquiries_my_accounts_narrow_033, '
                 'events.events_no_client_033, '
                 'opportunities.opportunities_my_accounts_narrow_033, '
                 'organisations.organisations_my_accounts_narrow_033',
    format('T1c FAIL: setting aside 014''s <table>_tenant_isolation policies, the '
           'restrictive set is %s, expected exactly H-02''s kill switch plus '
           '033''s four named policies. A restrictive policy under any other '
           'name is still the thing this check exists to catch.',
           v_bad);
  RAISE NOTICE 'T1 PASS - every core table is RLS-forced, every permissive and '
               'restrictive policy in core is one 014 stamped, and the H-02 '
               'restrictive guard still stands alone beside them.';
END;
$t1$;

-- === T2 · undated and dated ref formats produce the contract's shapes ========
DO $t2$
DECLARE v_a text; v_b text; v_c text;
BEGIN
  INSERT INTO core.templates (tenant_id, template_type, label)
  VALUES ('00000004-1111-1111-1111-111111111111','PROPOSAL','Standard') RETURNING ref INTO v_a;
  INSERT INTO core.templates (tenant_id, template_type, label)
  VALUES ('00000004-1111-1111-1111-111111111111','EMAIL','Covering') RETURNING ref INTO v_b;
  v_c := core.next_ref('00000004-1111-1111-1111-111111111111','ENQ');

  ASSERT v_a = 'TPL-0001', format('T2a FAIL: first undated ref is %s, expected TPL-0001', v_a);
  ASSERT v_b = 'TPL-0002', format('T2b FAIL: second undated ref is %s, expected TPL-0002', v_b);
  ASSERT v_c ~ '^ENQ-\d{4}-0001$',
    format('T2c FAIL: dated ref %s does not match PREFIX-YYYY-NNNN', v_c);
  RAISE NOTICE 'T2 PASS - % / % / % match the contract formats.', v_a, v_b, v_c;
END;
$t2$;

-- === T3 · an explicitly supplied ref is honoured, then frozen ================
--     Seeds must be able to write ENQ-2026-0912 verbatim; nothing may move it
--     afterwards.
DO $t3$
DECLARE v_id uuid;
BEGIN
  INSERT INTO core.templates (tenant_id, ref, template_type, label)
  VALUES ('00000004-1111-1111-1111-111111111111','tpl_proposal_std_v7','CERTIFICATE','Cert')
  RETURNING id INTO v_id;
  ASSERT (SELECT ref FROM core.templates WHERE id = v_id) = 'tpl_proposal_std_v7',
    'T3a FAIL: an explicit ref was overwritten by the allocator';

  BEGIN
    UPDATE core.templates SET ref = 'tpl_something_else' WHERE id = v_id;
    RAISE EXCEPTION 'T3b FAIL: a ref was changed after insert';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;

  BEGIN
    UPDATE core.templates
       SET tenant_id = '00000004-2222-2222-2222-222222222222' WHERE id = v_id;
    RAISE EXCEPTION 'T3c FAIL: a row was transplanted into another tenant';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
  RAISE NOTICE 'T3 PASS - explicit refs honoured; ref and tenant_id frozen after insert.';
END;
$t3$;

-- === T4 · ref counters are PER TENANT ======================================
--     A global counter leaks each customer's record volume to every other
--     customer, and no access-control test would ever catch it because no row
--     is exposed.
DO $t4$
DECLARE v_beta text;
BEGIN
  INSERT INTO core.templates (tenant_id, template_type, label)
  VALUES ('00000004-2222-2222-2222-222222222222','PROPOSAL','Beta standard')
  RETURNING ref INTO v_beta;
  ASSERT v_beta = 'TPL-0001',
    format('T4 FAIL: tenant Beta''s FIRST template got %s. The counter is global, '
           'so every tenant can read every other tenant''s record volume off its refs.',
           v_beta);
  RAISE NOTICE 'T4 PASS - each tenant starts at TPL-0001.';
END;
$t4$;

-- === T5 · the FINALISER itself, on a throwaway table ========================
--     This is the assertion that matters: every later migration depends on all
--     eight properties landing, and testing the fourteen tables 004 happened to
--     finalise would not prove the function still does it for the fifteenth.
CREATE TABLE core.t004_probe (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  ref       text,
  payload   text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width)
VALUES ('00000004-1111-1111-1111-111111111111','PRB','t004_probe',false,4)
  -- ⚠ 016 now provisions every tenant's ref_formats from an AFTER INSERT trigger
  -- on public.tenants, so this fixture collides with the real thing. The pin's
  -- own shape wins: it is a fixture inside a transaction that rolls back, and
  -- the assertions below were written against these exact values.
  ON CONFLICT (tenant_id, prefix)
    DO UPDATE SET entity = EXCLUDED.entity,
                  dated  = EXCLUDED.dated,
                  width  = EXCLUDED.width;

SELECT app.finalise_table('core','t004_probe',true,'PRB',ARRAY['payload']);

DO $t5$
DECLARE
  v_rel regclass := 'core.t004_probe'::regclass;
  v_id  uuid;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = v_rel AND conname = 't004_probe_tenant_id_key'),
    'T5a FAIL: no (tenant_id, id) unique - composite FKs in later migrations cannot point here';
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = v_rel AND conname = 't004_probe_tenant_ref_key'),
    'T5b FAIL: no (tenant_id, ref) unique';
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                 WHERE relname = 't004_probe_tenant_id_idx'),
    'T5c FAIL: no tenant index - every policy predicate reads tenant_id';
  ASSERT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = v_rel),
    'T5d FAIL: RLS not enabled AND forced';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = v_rel),
    'T5e FAIL: the finaliser created a policy; it must leave the table deny-all';
  ASSERT NOT has_table_privilege('authenticated', v_rel, 'SELECT'),
    'T5f FAIL: authenticated can read a freshly finalised table';

  -- behaviour, not catalogue: ref allocation, updated_at, and the extra frozen column
  INSERT INTO core.t004_probe (tenant_id, payload)
  VALUES ('00000004-1111-1111-1111-111111111111','one') RETURNING id INTO v_id;
  ASSERT (SELECT ref FROM core.t004_probe WHERE id = v_id) = 'PRB-0001',
    'T5g FAIL: the ref trigger did not allocate';

  UPDATE core.t004_probe SET updated_at = now() - interval '1 day' WHERE id = v_id;
  ASSERT (SELECT updated_at FROM core.t004_probe WHERE id = v_id) > now() - interval '1 minute',
    'T5h FAIL: set_updated_at did not override a stale updated_at';

  BEGIN
    UPDATE core.t004_probe SET payload = 'two' WHERE id = v_id;
    RAISE EXCEPTION 'T5i FAIL: the extra p_immutable column was not frozen';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
  RAISE NOTICE 'T5 PASS - the finaliser lands all eight properties on a new table.';
END;
$t5$;

-- === T6 · the finaliser REFUSES a table that is not tenant-scoped ===========
--     A table that reaches 014 without tenant_id gets no tenant predicate, and a
--     policy that cannot filter by tenant does not isolate.
CREATE TABLE core.t004_notenant (id uuid PRIMARY KEY, updated_at timestamptz NOT NULL DEFAULT now());
DO $t6$
BEGIN
  BEGIN
    PERFORM app.finalise_table('core','t004_notenant',false);
    RAISE EXCEPTION 'T6 FAIL: a table with no tenant_id was finalised';
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    PERFORM app.finalise_table('core','t004_does_not_exist',false);
    RAISE EXCEPTION 'T6b FAIL: a non-existent table was finalised';
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
  RAISE NOTICE 'T6 PASS - the finaliser refuses an untenanted or missing table.';
END;
$t6$;

-- === T7 · no client role may execute the finaliser =========================
--     It runs EXECUTE format(...) on its arguments. Identifier quoting alone is
--     not enough; nobody outside the migration role may call it at all.
DO $t7$
BEGIN
  ASSERT NOT has_function_privilege('authenticated',
    'app.finalise_table(text,text,boolean,text,text[])', 'EXECUTE'),
    'T7a FAIL: authenticated can execute finalise_table - that is arbitrary DDL';
  ASSERT NOT has_function_privilege('anon',
    'app.finalise_table(text,text,boolean,text,text[])', 'EXECUTE'),
    'T7b FAIL: anon can execute finalise_table';
  ASSERT NOT has_function_privilege('authenticated', 'core.next_ref(uuid,text)', 'EXECUTE'),
    'T7c FAIL: authenticated can execute next_ref and burn another tenant''s sequence';
  RAISE NOTICE 'T7 PASS - finalise_table and next_ref are migration-role only.';
END;
$t7$;

-- === T8 · the modelling constraints that encode a business rule =============
DO $t8$
BEGIN
  -- a non-WhatsApp template may not carry a per-message rate
  BEGIN
    INSERT INTO core.templates (tenant_id, template_type, label, rate_per_message_sen)
    VALUES ('00000004-1111-1111-1111-111111111111','PROPOSAL','Bad', 6);
    RAISE EXCEPTION 'T8a FAIL: a PROPOSAL template accepted a per-message rate';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- a MEASURED hours-saved basis needs a sign-off (DECISIONS §4)
  BEGIN
    INSERT INTO core.hours_saved_baseline_tables (tenant_id, version, basis, effective_from)
    VALUES ('00000004-1111-1111-1111-111111111111','v1','MEASURED', current_date);
    RAISE EXCEPTION
      'T8b FAIL: a MEASURED baseline was accepted with no sign-off - an illustrative '
      'number can now be published as an ROI claim';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ILLUSTRATIVE needs none
  INSERT INTO core.hours_saved_baseline_tables (tenant_id, version, basis, effective_from)
  VALUES ('00000004-1111-1111-1111-111111111111','v0','ILLUSTRATIVE', current_date);
  RAISE NOTICE 'T8 PASS - WhatsApp-only fields and the MEASURED sign-off rule hold.';
END;
$t8$;

DO $done$
BEGIN
  RAISE NOTICE 'test_004 ALL PASS (T1-T8, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
