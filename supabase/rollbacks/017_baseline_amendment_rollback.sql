-- ============================================================================
-- ROLLBACK 017 · baseline_amendment
-- ============================================================================
--
-- Restores the state 016 left. This is the hardest rollback in the pack, because
-- 017 is the only migration that CHANGES columns 005-013 already created rather
-- than only adding to them.
--
-- DROP ORDER, reverse of forward:
--   1. the retrieval RPC and the two views      (readers first)
--   2. the HRD Corp registry rows and check keys
--   3. the trainer accreditation columns
--   4. the PDPA tables
--   5. contact_consents.purpose / notice_version
--   6. the quotation and invoice SST columns    (before the tax table they
--                                                reference, or the DROP TABLE
--                                                fails on the foreign key)
--   7. core.tax_policies and app.resolve_tax_policy
--   8. the two numeric precisions               (restored EXACTLY, see below)
--   9. the seven jsonb CHECKs and the rule_set_versions unique
--  10. the nine PUBLIC EXECUTE grants           (restored, see below)
--
-- ⚠ TWO PLACES WHERE "RESTORE THE PRIOR STATE" IS GENUINELY LOSSY, BOTH STATED
-- RATHER THAN QUIETLY ROUNDED:
--
--   **The numeric precisions.** Forward, `numeric(3,2)` → `numeric(4,3)` is
--   widening and every value maps exactly. BACKWARD it is narrowing, and a score
--   of 0.867 written after 017 becomes 0.87. This rollback therefore REFUSES if
--   any row holds a value that would lose precision, rather than rounding it
--   silently. The same guard applies to `quotations.margin_rate`, where a rounded
--   margin can cross the floor that decided whether the quotation needed an
--   approval. A rollback that changes a commercial decision is not a rollback.
--
--   **The nine PUBLIC EXECUTE grants.** Restoring them is restoring a defect.
--   They are restored anyway, because a rollback's job is to return the database
--   to the state the previous migration left and not to keep the improvements it
--   happens to agree with — a rollback that silently retains half of 017 makes
--   "we rolled back" false, and the next person to apply 017 gets a different
--   result from the first. The grants are restored with a NOTICE saying exactly
--   what has just been re-opened.
--
-- ⚠ AND THE PLACES WHERE DATA IS DELETED. An earlier version of this header said
-- "none is customer data". That was false, and it was false about the rows that
-- matter most, so it is corrected here in full rather than softened.
--
--   TRUE, and unchanged: the two national tax policies, the three HRD Corp rules
--   and the three check keys 017 seeded are reference rows 017 introduced, all
--   seeded `PROPOSED`, deleted by `policy_code` / `rule_code` / `check_key` and
--   never by a range, so a row somebody added beside them survives.
--
--   FALSE, and now guarded: this rollback also drops `core.data_breach_register`
--   — a statutory PDPA s.12B register — and `core.data_retention_policies`; drops
--   `purpose` and `notice_version` from `core.contact_consents`, which is the
--   evidence that a consent was informed; and drops the four SST columns from
--   `core.quotations`, which are the tax position on documents a customer may
--   already have accepted. Every one of those is customer data or the statutory
--   record of it, and `DROP TABLE`/`DROP COLUMN` is not recoverable from inside
--   this transaction.
--
-- So the rule the numeric-precision guard already followed is applied to all of
-- them: COUNT FIRST, AND REFUSE IF NON-EMPTY. A rollback that destroys a breach
-- register is not a rollback, it is an incident — and on an empty database, which
-- is where a rollback is actually exercised, the guard costs nothing.
--
-- There is no override flag. If you genuinely intend to lose these rows, export
-- them and empty the tables deliberately first; that is one command and it leaves
-- a trace, which is the difference between a decision and an accident.
--
-- Re-runnable throughout.
-- ============================================================================

BEGIN;

DO $preflight$
DECLARE v_bad integer;
BEGIN
  IF pg_catalog.to_regclass('core.quotations') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK 017 refused: core.quotations is absent; 007 is already gone.';
  END IF;

  -- The precision guard, BEFORE anything is dropped, so a refusal costs nothing.
  IF pg_catalog.to_regclass('core.evaluation_responses') IS NOT NULL THEN
    SELECT pg_catalog.count(*) INTO v_bad
      FROM core.evaluation_responses
     WHERE overall_score IS NOT NULL AND pg_catalog.scale(overall_score) > 2;
    IF v_bad > 0 THEN
      RAISE EXCEPTION
        'ROLLBACK 017 refused: % evaluation response(s) hold an overall_score with '
        'three decimal places. Narrowing back to numeric(3,2) would ROUND them, '
        'and a rollback that changes stored scores is data loss dressed as a '
        'restore. Resolve these rows deliberately first.', v_bad;
    END IF;
  END IF;

  SELECT pg_catalog.count(*) INTO v_bad
    FROM core.quotations
   WHERE margin_rate IS NOT NULL AND pg_catalog.scale(margin_rate) > 4;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK 017 refused: % quotation(s) would lose margin_rate precision', v_bad;
  END IF;
END;
$preflight$;

-- ── 1 · Readers ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS core.retrieve_knowledge(extensions.vector,integer,uuid);
DROP VIEW IF EXISTS core.v_trainer_accreditation;
DROP VIEW IF EXISTS core.v_tax_policy_unverified;

-- ── 2 · Seeded registry rows, by code ───────────────────────────────────────
DELETE FROM core.compliance_rules
 WHERE rule_code IN ('HRD-QUERY-5D','HRD-007','HRD-009');
-- The check keys are provisioned by a trigger (see the forward file's note), so
-- the trigger goes before the rows, or a tenant inserted between the two would be
-- re-seeded with keys this rollback has just deleted.
DROP TRIGGER IF EXISTS trg_tenants_seed_check_keys ON public.tenants;

-- The registry row 017 wrote. Deleted by its own key, never by a range: 016 and
-- 011 own the other rows and provision_tenant still has to check them.
DELETE FROM app.tenant_seed_checks WHERE schema_name = 'core' AND table_name = 'check_keys';
DROP FUNCTION IF EXISTS app.seed_check_keys_on_tenant();
DROP FUNCTION IF EXISTS app.seed_compliance_check_keys(uuid);
DELETE FROM core.check_keys
 WHERE check_key IN ('CHK_QUERY_DEADLINE','CHK_COMMENCEMENT_WINDOW','CHK_CLAIM_WINDOW');

-- ── 3 · Trainer accreditation ───────────────────────────────────────────────
ALTER TABLE core.trainers DROP CONSTRAINT IF EXISTS trainers_hrd_tdf_needs_expiry;
ALTER TABLE core.trainers DROP COLUMN IF EXISTS hrd_tdf_valid_to;
ALTER TABLE core.trainers DROP COLUMN IF EXISTS hrd_tdf_ref;

-- ── 4 · PDPA tables ─────────────────────────────────────────────────────────
-- ── THE PDPA / CUSTOMER-DATA GUARD ─────────────────────────────────────────
-- Counted before anything is dropped, and reported all at once: a rollback that
-- refuses on the first table leaves whoever is running it to discover the next
-- one on the next attempt.
DO $pdpa$
DECLARE
  r       pg_catalog.record;
  v_n     bigint;
  v_stop  text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('core','data_breach_register', NULL::text,
       'the statutory PDPA s.12B breach register'),
      ('core','data_retention_policies', NULL,
       'the approved retention windows four reapers are gated on'),
      ('core','contact_consents', 'purpose',
       'the evidence that a data subject''s consent was informed'),
      ('core','quotations', 'sst_reason',
       'the tax position on quotations a customer may already have accepted')
    ) AS t(sch, tbl, col, what)
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('%I.%I', r.sch, r.tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    IF r.col IS NULL THEN
      EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM %I.%I', r.sch, r.tbl)
        INTO v_n;
    ELSE
      -- A column drop only loses data where the column is populated.
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid = pg_catalog.format('%I.%I', r.sch, r.tbl)::regclass
                        AND a.attname = r.col AND a.attnum > 0 AND NOT a.attisdropped) THEN
        CONTINUE;
      END IF;
      EXECUTE pg_catalog.format(
        'SELECT pg_catalog.count(*) FROM %I.%I WHERE %I IS NOT NULL', r.sch, r.tbl, r.col)
        INTO v_n;
    END IF;

    IF v_n > 0 THEN
      v_stop := v_stop || pg_catalog.format('%s.%s%s: %s row(s) — %s',
        r.sch, r.tbl, COALESCE('.' || r.col, ''), v_n, r.what);
    END IF;
  END LOOP;

  IF pg_catalog.cardinality(v_stop) > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK 017 refused: it would destroy customer data. %  '
      'This rollback drops those tables and columns outright and cannot put them '
      'back. An earlier version of this file claimed "none is customer data", '
      'which was wrong about the breach register in particular. Export what you '
      'need and empty them deliberately, then re-run.',
      pg_catalog.array_to_string(v_stop, ' | ');
  END IF;

  RAISE NOTICE
    'ROLLBACK 017: PDPA guard OK — breach register, retention policies, consent '
    'purpose and quotation SST all empty, so dropping them loses nothing.';
END;
$pdpa$;

DROP TABLE IF EXISTS core.data_breach_register;
DROP TABLE IF EXISTS core.data_retention_policies;

-- ── 5 · Consent purpose ─────────────────────────────────────────────────────
ALTER TABLE core.contact_consents DROP CONSTRAINT IF EXISTS contact_consents_no_new_unspecified;
ALTER TABLE core.contact_consents DROP CONSTRAINT IF EXISTS contact_consents_purpose_check;
ALTER TABLE core.contact_consents DROP COLUMN IF EXISTS purpose;
ALTER TABLE core.contact_consents DROP COLUMN IF EXISTS notice_version;

-- ── 6 · SST columns, BEFORE the table they reference ────────────────────────
-- The resolver trigger first (017:725, 017:794-796). Left behind, it survives
-- the column drops and every quotation INSERT/UPDATE then fails with
-- `record "new" has no field "sst_reason"`.
DROP TRIGGER IF EXISTS trg_quotations_resolve_sst ON core.quotations;
DROP FUNCTION IF EXISTS core.resolve_quotation_sst();
ALTER TABLE core.quotations DROP CONSTRAINT IF EXISTS quotations_exempt_needs_reason;
ALTER TABLE core.quotations DROP CONSTRAINT IF EXISTS quotations_sst_exempt_has_no_rate;
ALTER TABLE core.quotations DROP CONSTRAINT IF EXISTS quotations_sst_reason_check;
ALTER TABLE core.quotations DROP COLUMN IF EXISTS gross_price_sen;
ALTER TABLE core.quotations DROP COLUMN IF EXISTS sst_sen;
ALTER TABLE core.quotations DROP COLUMN IF EXISTS sst_exempt_reason;
ALTER TABLE core.quotations DROP COLUMN IF EXISTS sst_reason;
ALTER TABLE core.quotations DROP COLUMN IF EXISTS sst_rate;
ALTER TABLE core.quotations DROP COLUMN IF EXISTS sst_policy_id;
ALTER TABLE core.invoices   DROP COLUMN IF EXISTS sst_policy_id;

-- ── 7 · The tax table and its resolver ──────────────────────────────────────
DROP FUNCTION IF EXISTS app.resolve_tax_policy(uuid,text,date,timestamptz);
DROP TABLE IF EXISTS core.tax_policies;

-- ── 8 · The two precisions, restored exactly ────────────────────────────────
ALTER TABLE core.evaluation_responses
  DROP CONSTRAINT IF EXISTS evaluation_responses_overall_score_range;
ALTER TABLE core.evaluation_responses
  ALTER COLUMN overall_score TYPE numeric(3,2);
ALTER TABLE core.quotations
  ALTER COLUMN margin_rate TYPE numeric;

-- ── 9 · jsonb CHECKs and the composite unique ───────────────────────────────
ALTER TABLE core.compliance_rules              DROP CONSTRAINT IF EXISTS compliance_rules_applies_when_is_object;
ALTER TABLE core.evaluation_responses          DROP CONSTRAINT IF EXISTS evaluation_responses_answers_is_object;
ALTER TABLE core.hrdc_packet_documents         DROP CONSTRAINT IF EXISTS hrdc_packet_documents_meta_is_object;
ALTER TABLE core.knowledge_chunks              DROP CONSTRAINT IF EXISTS knowledge_chunks_metadata_is_object;
ALTER TABLE core.organisation_health_snapshots DROP CONSTRAINT IF EXISTS organisation_health_snapshots_components_is_object;
ALTER TABLE core.saved_views                   DROP CONSTRAINT IF EXISTS saved_views_filters_is_array;
ALTER TABLE core.tna_recommendations           DROP CONSTRAINT IF EXISTS tna_recommendations_scoring_weights_is_object;
ALTER TABLE core.rule_set_versions             DROP CONSTRAINT IF EXISTS rule_set_versions_tenant_id_id_key;

-- ── 10 · The nine PUBLIC EXECUTE grants, restored ──────────────────────────
DO $regrant$
BEGIN
  GRANT EXECUTE ON FUNCTION core.apply_rule_offset(date, integer, core.rule_offset_unit) TO PUBLIC;
  GRANT EXECUTE ON FUNCTION core.enforce_attendance_day_lock()   TO PUBLIC;
  GRANT EXECUTE ON FUNCTION core.enforce_attendance_entry_lock() TO PUBLIC;
  GRANT EXECUTE ON FUNCTION core.freeze_applied_quotation()      TO PUBLIC;
  GRANT EXECUTE ON FUNCTION core.freeze_sent_proposal_sections() TO PUBLIC;
  GRANT EXECUTE ON FUNCTION core.quotation_assert_floor()        TO PUBLIC;
  GRANT EXECUTE ON FUNCTION core.quotation_assert_reconciled()   TO PUBLIC;
  GRANT EXECUTE ON FUNCTION core.quotation_block_placeholder()   TO PUBLIC;
  GRANT EXECUTE ON FUNCTION core.sync_rule_scheme_key()          TO PUBLIC;
  RAISE NOTICE
    'ROLLBACK 017: RE-OPENED nine PUBLIC EXECUTE grants on core functions, '
    'including core.apply_rule_offset, which is the one reachable as a PostgREST '
    'RPC. This restores a DEFECT, deliberately, because a rollback that keeps the '
    'improvements it agrees with makes "we rolled back" false.';
END;
$regrant$;

-- ── POST-CONDITIONS ─────────────────────────────────────────────────────────
DO $verify$
DECLARE v_n integer; v_expected integer;
BEGIN
  IF pg_catalog.to_regclass('core.tax_policies') IS NOT NULL
     OR pg_catalog.to_regclass('core.data_retention_policies') IS NOT NULL
     OR pg_catalog.to_regclass('core.data_breach_register') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 017 incomplete: a 017 table survives';
  END IF;

  IF pg_catalog.to_regproc('app.resolve_tax_policy') IS NOT NULL
     OR pg_catalog.to_regproc('core.retrieve_knowledge') IS NOT NULL
     OR pg_catalog.to_regproc('app.seed_compliance_check_keys') IS NOT NULL
     OR pg_catalog.to_regproc('core.resolve_quotation_sst') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 017 incomplete: a 017 function survives';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='core' AND table_name='quotations'
                AND column_name IN ('sst_rate','sst_sen','sst_policy_id')) THEN
    RAISE EXCEPTION 'ROLLBACK 017 incomplete: a quotation SST column survives';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='core' AND table_name='evaluation_responses'
                    AND column_name='overall_score'
                    AND numeric_precision=3 AND numeric_scale=2) THEN
    RAISE EXCEPTION 'ROLLBACK 017 incomplete: overall_score is not back to numeric(3,2)';
  END IF;

  -- 010's own SST columns on the INVOICE are 010's, not 017's, and must survive.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='core' AND table_name='invoices'
                    AND column_name='sst_rate') THEN
    RAISE EXCEPTION
      'ROLLBACK 017 DESTROYED core.invoices.sst_rate, which 010 created. 017 added '
      'only sst_policy_id to that table.';
  END IF;

  -- 014's policies on the pre-existing tables are 014's and must survive.
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname='core';
  -- ⚠ EXACT, NOT `< 220`. The earlier spelling tolerated the loss of one or two
  -- of 014's policies while claiming to check for exactly this. 014 leaves 228 on
  -- `core`; 017 adds three tenant-scoped tables, so six; rolling 017 back must
  -- leave 222 and any other number is a defect in one direction or the other.
  -- ⚠ EXACT AND DERIVED, NOT `< 220`, AND NOT 222 EITHER.
  --
  -- The earlier spelling tolerated the silent loss of one or two of 014's
  -- policies while claiming to check for exactly this, and its commentary said
  -- "228 minus six should leave 222". A review repeated that arithmetic and
  -- recommended `<> 222`. Both are wrong, and running the rollback is what showed
  -- it: 014 leaves 228 policies on `core`; 017 ADDS three tenant-scoped tables,
  -- taking it to 234; rolling 017 back drops those three tables and their six
  -- policies go with them, returning to 228. The subtraction was applied to the
  -- wrong end.
  --
  -- So it is derived rather than written down: two policies per tenant-scoped
  -- `core` table that still exists, plus 014's provenance_subjects_read, plus
  -- 011's H-02 kill switch. That moves correctly when a later pack adds a tenant
  -- table; a literal would not.
  SELECT pg_catalog.count(*) * 2 + 2 INTO v_expected
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'core' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                    AND a.attnum > 0 AND NOT a.attisdropped);

  IF v_n <> v_expected THEN
    RAISE EXCEPTION
      'ROLLBACK 017: core carries % policies and the catalogue says it should '
      'carry % (two per surviving tenant-scoped core table, plus 014''s '
      'provenance_subjects_read and 011''s H-02). Fewer means something took more '
      'than 017 created; more means 017''s own policies survived its rollback.',
      v_n, v_expected;
  END IF;

  RAISE NOTICE 'ROLLBACK 017: OK - baseline restored, 010 and 014 intact';
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
