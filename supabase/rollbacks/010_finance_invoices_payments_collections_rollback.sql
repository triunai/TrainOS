-- ============================================================================
-- ROLLBACK 010 · finance_invoices_payments_collections
-- ============================================================================
--
-- Forward file: migrations/010_finance_invoices_payments_collections.sql
--
-- PRIOR STATE THIS RESTORES. The database as 009 left it: no finance tables, no
-- finance functions, two fewer enum types, and `core.organisations` without its
-- ten buyer-identity columns or the constraint pairing two of them.
--
-- There is no prior definition of any object to reproduce here — 010 created all
-- of them from nothing — EXCEPT the shape of `core.organisations`, which 005
-- owns and 010 altered. That one is reproduced in full below rather than
-- referenced, because a rollback that says "see migration 005" depends on
-- another file being readable at the moment you need it, which is not a
-- rollback.
--
-- ⛔ PRE-FLIGHT. Five guards, each refusing rather than cascading.
--
--   G1  Any row in `core.payments`. Payments are money the business has
--       RECEIVED and they are append-only by trigger; dropping the table
--       destroys the record of it. There is no override, and the message says
--       how to export first.
--   G2  Any row in `core.invoices`. A filed tax document is not a schema object.
--   G3  Any row in `core.credit_notes`, for the same reason and separately,
--       because an invoice table someone has already cleared does not imply the
--       credit notes against it were dealt with.
--   G4  `app.action_requests` exists. That means 011 is applied, and 011 adds a
--       foreign key from `collections_cases.trading_hold_action_id` into it.
--       Dropping this table first would take that constraint's referent away.
--   G5  Any relation in `core` that 010 did not create but which depends on one
--       that it did. Later migrations add views over invoices (013's agent
--       tooling, 015's retention); a CASCADE would drop them silently.
--
-- None of these guards has an override. An override belongs to a gate a file
-- OWNS and removes on purpose, never to a later migration's dependency it would
-- strip as a side effect.
--
-- WHY THE GUARDS ARE ON ROWS AND NOT ONLY ON DEPENDENT OBJECTS. 001-009 guard
-- structure — "has a later migration put something here". 010 is the first
-- migration whose tables hold money, so it also guards CONTENT. A structurally
-- clean drop of a table holding six months of payments is a successful command
-- and a catastrophe.
--
-- DROP ORDER: the reverse of the forward order, children before parents —
-- collections, then credit notes, then payments, then sync entries, then lines,
-- then invoices, then the reference tables, then the ALTER on organisations,
-- then the functions, then the two enum types. Enums last because columns
-- typed with them must be gone first.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
DECLARE
  v_n      bigint;
  v_dep    text;
BEGIN
  -- ── G1 · no payment rows ──────────────────────────────────────────────────
  IF to_regclass('core.payments') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM core.payments' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 010 ABORTED: core.payments holds % row(s). These are payments '
        'the business has received and the table is append-only by design, so '
        'dropping it destroys the only record. Export first: COPY (SELECT * FROM '
        'core.payments) TO ''/tmp/payments.csv'' CSV HEADER;', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G2 · no invoices ──────────────────────────────────────────────────────
  IF to_regclass('core.invoices') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM core.invoices' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 010 ABORTED: core.invoices holds % row(s). A filed tax document '
        'is not a schema object. Export first.', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G3 · no credit notes ──────────────────────────────────────────────────
  IF to_regclass('core.credit_notes') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM core.credit_notes' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback 010 ABORTED: core.credit_notes holds % row(s).', v_n
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G4 · 011 is not applied on top ────────────────────────────────────────
  IF to_regclass('app.action_requests') IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 010 ABORTED: app.action_requests exists, so 011 is applied. 011 '
      'adds a foreign key from core.collections_cases.trading_hold_action_id into '
      'it. Roll back 011 first.'
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- ── G5 · nothing outside 010 depends on 010's tables ──────────────────────
  SELECT string_agg(DISTINCT dependent.relname, ', ') INTO v_dep
  FROM pg_catalog.pg_depend d
  JOIN pg_catalog.pg_rewrite rw ON rw.oid = d.objid
  JOIN pg_catalog.pg_class dependent ON dependent.oid = rw.ev_class
  JOIN pg_catalog.pg_class referenced ON referenced.oid = d.refobjid
  JOIN pg_catalog.pg_namespace rn ON rn.oid = referenced.relnamespace
  WHERE rn.nspname = 'core'
    AND referenced.relname IN ('tenant_tax_profiles','invoices','invoice_lines',
                               'invoice_sync_entries','payments','credit_notes',
                               'credit_note_lines','aging_buckets',
                               'collection_rules','collections_cases')
    AND dependent.relname NOT IN ('tenant_tax_profiles','invoices','invoice_lines',
                                  'invoice_sync_entries','payments','credit_notes',
                                  'credit_note_lines','aging_buckets',
                                  'collection_rules','collections_cases');
  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 010 ABORTED: relation(s) outside 010 depend on its tables: %. A '
      'later migration created them; roll that back first rather than letting a '
      'CASCADE remove them silently.', v_dep
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 010 pre-flight: clear (no money rows, 011 not applied, no dependents).';
END;
$preflight$;

-- ─── Reverse of forward step 10 · collections ───────────────────────────────
DROP TABLE IF EXISTS core.collections_cases CASCADE;
DROP TABLE IF EXISTS core.collection_rules  CASCADE;

-- ─── Reverse of forward step 9 · aging ──────────────────────────────────────
DROP TABLE IF EXISTS core.aging_buckets CASCADE;

-- ─── Reverse of forward step 8 · credit notes ───────────────────────────────
DROP TABLE IF EXISTS core.credit_note_lines CASCADE;
DROP TABLE IF EXISTS core.credit_notes      CASCADE;

-- ─── Reverse of forward step 7 · payments ───────────────────────────────────
DROP TABLE IF EXISTS core.payments CASCADE;

-- ─── Reverse of forward step 6 · sync entries ───────────────────────────────
DROP TABLE IF EXISTS core.invoice_sync_entries CASCADE;

-- ─── Reverse of forward steps 4, 3, 2 · invoices ────────────────────────────
DROP TABLE IF EXISTS core.invoice_lines CASCADE;
DROP TABLE IF EXISTS core.invoices      CASCADE;

-- ─── Reverse of forward step 1 · fiscal identity ────────────────────────────
DROP TABLE IF EXISTS core.tenant_tax_profiles CASCADE;

-- The ALTER on core.organisations, undone. `core.organisations` is 005's table
-- and SURVIVES; only the ten columns 010 added and the one constraint it added
-- are removed. Its prior shape, reproduced in full so this file does not depend
-- on 005 being readable:
--
--   id uuid PK, tenant_id uuid NOT NULL, ref text, name text NOT NULL,
--   industry text, location text, owner_id uuid NOT NULL,
--   status core.organisation_status NOT NULL, hrdc_registered boolean NOT NULL,
--   hrdc_employer_code text, proposal_count integer NOT NULL,
--   first_proposal_sent_at timestamptz, health_score smallint,
--   archived_at timestamptz, created_at timestamptz NOT NULL,
--   updated_at timestamptz NOT NULL, created_by_kind app.actor_kind NOT NULL,
--   created_by_id text NOT NULL, created_by_name text
--
-- The constraint is dropped BEFORE its columns: dropping a column would take the
-- constraint with it silently, and the explicit order is what makes the reversal
-- checkable against the forward file line for line.
ALTER TABLE core.organisations
  DROP CONSTRAINT IF EXISTS organisations_tax_identifier_paired;

ALTER TABLE core.organisations
  DROP COLUMN IF EXISTS tax_identifier_kind,
  DROP COLUMN IF EXISTS tax_identifier,
  DROP COLUMN IF EXISTS tin,
  DROP COLUMN IF EXISTS sst_registration_no,
  DROP COLUMN IF EXISTS address_line1,
  DROP COLUMN IF EXISTS address_line2,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS state_code,
  DROP COLUMN IF EXISTS postcode,
  DROP COLUMN IF EXISTS country_code;

-- ─── Functions ──────────────────────────────────────────────────────────────
-- Every signature 010 created. CASCADE on the tables above already removed the
-- triggers that bound them; these drop the bodies.
DROP FUNCTION IF EXISTS core.collection_stage_for(uuid, integer);
DROP FUNCTION IF EXISTS core.receivables_aging(uuid, date);
DROP FUNCTION IF EXISTS core.credit_note_assert_within_invoice();
DROP FUNCTION IF EXISTS core.credit_note_recalc();
DROP FUNCTION IF EXISTS core.payment_reject_mutation();
DROP FUNCTION IF EXISTS core.payment_apply();
DROP FUNCTION IF EXISTS core.invoice_guard_validated();
DROP FUNCTION IF EXISTS core.invoice_set_cancel_deadline();
DROP FUNCTION IF EXISTS core.invoice_assert_reconciled();
DROP FUNCTION IF EXISTS core.invoice_recalc();

-- ─── Types, last ────────────────────────────────────────────────────────────
-- RESTRICT (the default). Every column typed with these is gone above; if one is
-- not, Postgres refuses and names it, which is a better outcome than a CASCADE
-- that silently drops a column from a table this file does not own.
DROP TYPE IF EXISTS core.einvoice_status;
DROP TYPE IF EXISTS core.tax_identifier_kind;

DO $verify$
DECLARE v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND c.relname IN ('tenant_tax_profiles','invoices','invoice_lines',
                      'invoice_sync_entries','payments','credit_notes',
                      'credit_note_lines','aging_buckets','collection_rules',
                      'collections_cases');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 010: table(s) survived the drop: %', v_left;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_type t
             JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'core'
               AND t.typname IN ('einvoice_status','tax_identifier_kind')) THEN
    RAISE EXCEPTION 'rollback 010: an enum type survived the drop';
  END IF;

  -- core.organisations must SURVIVE, and must be back to its 005 shape.
  IF to_regclass('core.organisations') IS NULL THEN
    RAISE EXCEPTION
      'rollback 010: core.organisations was dropped. It is 005''s table; 010 only '
      'altered it, and a rollback that removes it has destroyed a migration it '
      'does not own';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid = 'core.organisations'::regclass
               AND attname IN ('tin','tax_identifier','tax_identifier_kind',
                               'address_line1','postcode','country_code')
               AND NOT attisdropped) THEN
    RAISE EXCEPTION
      'rollback 010: a buyer-identity column survived on core.organisations';
  END IF;

  RAISE NOTICE
    'rollback 010: complete - 10 tables, 10 functions and 2 enum types removed, '
    'core.organisations restored to its 005 shape.';
END;
$verify$;

COMMIT;
