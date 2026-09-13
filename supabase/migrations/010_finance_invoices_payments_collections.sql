-- ============================================================================
-- Migration 010: finance — invoices, lines, payments, credit notes, the
-- e-invoice mirror, receivables aging and the collections ladder.
-- ============================================================================
--
-- FEATURE. Everything downstream of an accepted quotation. 007 priced the work;
-- 010 bills for it, records what came back, and drives the chase when it does
-- not. Nineteen objects: eight tables, two functions, and the ALTERs that give
-- an organisation a tax identity.
--
-- WHAT IS HERE, AND WHY EACH ONE
--
--   core.tenant_tax_profiles   The SUPPLIER's fiscal identity. One row per
--                              tenant: TIN, BRN, SST registration, MSIC code and
--                              a structured address.
--   core.invoices              The tax invoice, with the e-invoice mirror.
--   core.invoice_lines         Total-from-lines, the 007 way: amount is GENERATED.
--   core.invoice_sync_entries  Append-only log of every push to the accounting
--                              package and every validation result that came back.
--   core.payments              Money received. Never updated, never deleted.
--   core.credit_notes          The legal exit from a mistake on a frozen invoice.
--   core.credit_note_lines
--   core.aging_buckets         Receivables buckets as DATA, with a GiST exclusion.
--   core.collection_rules      The 7/30/45/60/75 ladder as DATA.
--   core.collections_cases     One open case per overdue invoice.
--   core.receivables_aging()   Aging by bucket, resolved from aging_buckets.
--   core.collection_stage_for() Stage from days overdue, resolved from the ladder.
--
-- ── THE CRITIC'S C-11, ANSWERED RATHER THAN DEFERRED ──────────────────────
--
-- C-11 says the invoice model "has nowhere to put a MyInvois document", and it
-- is right. Doc 01 §3.4 carries six `sync_*` columns and asserts the way out:
-- "TrainOS does not e-invoice; MyInvois validation is mirrored in, never
-- originated (§9)." That holds ONLY IF another system genuinely round-trips
-- every field. Mirroring a document you cannot represent is not mirroring it —
-- it is dropping it and calling the remainder a mirror.
--
-- So this migration keeps doc 01's position (TrainOS never submits; every
-- e-invoice column is written from a downstream response and never read as an
-- instruction) and gives the mirror somewhere to land:
--
--   * `einvoice_uuid` is DISTINCT from `einvoice_submission_uid`. They are
--     different identifiers for different things — the document and the batch it
--     arrived in — and collapsing them is the specific error C-11 names first.
--   * `einvoice_long_id` is the QR token. Without it a validated invoice cannot
--     render the QR code a buyer is entitled to.
--   * `einvoice_status` carries a vocabulary that includes
--     SUBMITTED_PENDING_VALIDATION, CANCELLED and REJECTED. Doc 01's four-value
--     `sync_state` cannot express "submitted, not yet valid", which is the state
--     an invoice is actually in for most of its first hour.
--   * `einvoice_validation_errors` is structured per field, with a key-presence
--     CHECK (ruling R-JSONB), because "it failed" is not a thing finance can act
--     on and a text blob is what forces someone to open a different system.
--   * The 72-HOUR CANCELLATION WINDOW is a stored deadline, not a rule in
--     somebody's head. `einvoice_cancel_deadline_at` is GENERATED from
--     `einvoice_validated_at`, so it cannot be set to a convenient value, and a
--     cancellation after it is refused by trigger. 015 sweeps for invoices
--     approaching it.
--   * `void_reason` exists. `hrdc_packets` has one; invoices did not, which
--     meant the one document with a statutory cancellation reason requirement
--     was the one that could be voided silently.
--   * Per line: `classification_code` and `uom_code`. `tax_code` was
--     unconstrained free text that nothing read.
--   * `is_self_billed` and `is_consolidated` are columns, not a second table.
--     Trainer payables (`rate_card_trainer_days` exists in 007) are self-billed
--     invoices and had no representation at all.
--   * `exchange_rate`, with a CHECK tying it to `currency`.
--
-- SUPPLIER AND BUYER IDENTITY. `public.tenants` is `id, slug, name, status,
-- timezone, locale, created_at, updated_at` and that is the whole table — C-11
-- counted it. The supplier's TIN/MSIC/SST number does not go there: 002 owns
-- `public.tenants`, `public` is identity and tenancy only, and fiscal identity is
-- domain data that belongs in `core` where the API can read it. Hence
-- `core.tenant_tax_profiles`. The BUYER's identifiers go onto
-- `core.organisations` as an ALTER, because they are attributes of the
-- organisation and a side table would make every invoice render a second join
-- for four fields that are never absent.
--
-- ⚠ WHAT THIS MIGRATION DOES **NOT** CLAIM. It does not make TrainOS an
-- e-invoicing system and it does not close C-11 on its own. C-11's first
-- sentence asks for "written confirmation that the accounting package is the
-- submitter of record and round-trips these fields". That is a client answer,
-- not a schema change, and it is still open (register D-45). What the schema can
-- do — stop being the reason a field is lost — is done here.
--
-- ── TOTAL-FROM-LINES, AND WHY THIS FILE IS SHORTER THAN 007's ─────────────
--
-- 007 established the pattern and this file reuses it rather than inventing a
-- second one: the line total is GENERATED from unit price and quantity, an AFTER
-- trigger recomputes the header from the lines, and a DEFERRABLE constraint
-- trigger asserts at COMMIT that the header still equals its lines. The project
-- rule is that a pattern appearing on a third surface is standardised before it
-- is used again, so `core.invoice_assert_reconciled` is deliberately the same
-- shape as `core.quotation_assert_reconciled`, including the re-read of the row
-- inside the deferred trigger — 007 found by execution that a deferred
-- trigger's NEW is the tuple as it stood at the TRIGGERING statement, not at
-- COMMIT, and trusting it compares the lines against a stale header.
--
-- Two things are DERIVED here that doc 01 has as checked columns, and the
-- change is deliberate:
--   * `sst_sen` is GENERATED from `subtotal_sen * sst_rate`. Doc 04 §1.6 says it
--     must be trigger-maintained "because SST is computed on the summed net" —
--     true, and the summed net is `subtotal_sen`, which is on the row. A
--     generated column expresses "computed on the summed net" exactly, and
--     cannot be left stale by a trigger that did not fire.
--   * `total_sen` is GENERATED. Doc 01 has `CHECK (total_sen = subtotal_sen +
--     sst_sen)`; a CHECK rejects a wrong total, a generated column makes a wrong
--     total unrepresentable. PostgreSQL forbids one generated column referencing
--     another, so the SST term is recomputed rather than referenced — the
--     duplication is the language's, not a second definition of the rule.
--   * `outstanding_sen` is NOT generated: it depends on rows in another table,
--     which a generated column may not. It is trigger-maintained from
--     `core.payments` and asserted by the same deferred mechanism.
--
-- ── SPINE ─────────────────────────────────────────────────────────────────
-- SPINE UNTOUCHED. `app.perform_action` does not exist yet (011). Every action
-- type this migration's tables are the target of — INVOICE_CREATE, INVOICE_PUSH,
-- PAYMENT_RECORD, CREDIT_NOTE_ISSUE, ACCOUNT_TRADING_HOLD — is registered as
-- DATA in 011's `app.action_types` seed, never as a branch here. The only thing
-- 010 does for the spine is leave `collections_cases.trading_hold_action_id`
-- nullable with its FK deferred to 011, so the gate can stamp it.
--
-- ⚠ SEQUENCING NOTE FOR 011, carried from the critic's C-04 residue rather than
-- re-derived: doc 03 §1812-1816's `grant select … to authenticated` must NOT
-- land before the gate tables have policies. Nothing in 010 grants anything to
-- any client role; every table here is deny-all until 014.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   No RPCs are exposed. `core.receivables_aging` and `core.collection_stage_for`
--   are SECURITY DEFINER readers and are REVOKEd from every client role: 014
--   grants EXECUTE on them to `authenticated` once the tables they read have
--   policies. Granting now would publish a cross-tenant reader.
--   Every table goes through `app.finalise_table`, so all of them are RLS
--   enabled AND FORCED with zero policies — deny-all until 014.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope: no client-callable RPC added. The two functions return a SETOF
--      and a scalar and are internal; when 014 exposes a finance RPC it returns
--      through app.ok/app.err like every other.
--   2. Unwrap: not applicable — nothing added returns the envelope. No top-level
--      sibling key is introduced anywhere, so the 037 mechanism cannot fire.
--   3. RpcMap: no entries. No client-callable surface is added by this file.
--   4. Call sites: `grep -rn "receivables_aging\|collection_stage_for"` over
--      apps/ and packages/ returns ZERO today. Expected, and stated rather than
--      left to look like a dead-RPC finding: the finance screens read tables
--      through PostgREST, and these two exist for 013's agent tooling and the
--      collections queue, both of which arrive later. If they still have zero
--      call sites after 016, that IS a finding.
--   5. Casts: none. No `as unknown as` anywhere near this surface.
--   6. Reload/restore: no client-visible behaviour yet.
--   7. Public routes: none. The portal's public surface is 007's share tokens and
--      is untouched; nothing here is reachable by `anon`.
--   Then: the RPC-contract check script does not exist in this repo yet (see the
--   catalog note); the equivalent invariants are asserted by test_010.
--
-- Rollback: rollbacks/010_finance_invoices_payments_collections_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ 1 · Fiscal identity ════════════════════════════════════════════════════

DO $$ BEGIN CREATE TYPE core.tax_identifier_kind AS ENUM
  ('TIN','BRN','NRIC','PASSPORT','ARMY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TYPE core.tax_identifier_kind IS
  'Declared by 010, NOT generated from packages/contract/src/enums.ts. The kind of '
  'identifier a buyer is registered under. A Malaysian e-invoice requires the TYPE '
  'as well as the value - the same digits mean different things under BRN and NRIC - '
  'so storing the number without the kind loses information that cannot be recovered.';

DO $$ BEGIN CREATE TYPE core.einvoice_status AS ENUM
  ('NOT_SUBMITTED','SUBMITTED_PENDING_VALIDATION','VALID','INVALID','CANCELLED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TYPE core.einvoice_status IS
  'Declared by 010. The MIRRORED status of the e-invoice document downstream, which '
  'is not the same thing as core.sync_state (did WE manage to push it). '
  'SUBMITTED_PENDING_VALIDATION is the state an invoice is in for most of its first '
  'hour and doc 01''s four-value sync_state cannot express it; CANCELLED and REJECTED '
  'are outcomes it cannot express at all (critic C-11).';

CREATE TABLE IF NOT EXISTS core.tenant_tax_profiles (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  legal_name           text        NOT NULL,
  tin                  text        NOT NULL,
  registration_no      text        NOT NULL,
  sst_registration_no  text,
  msic_code            text        CHECK (msic_code IS NULL OR msic_code ~ '^[0-9]{5}$'),
  business_activity    text,
  address_line1        text        NOT NULL,
  address_line2        text,
  city                 text        NOT NULL,
  state_code           text        NOT NULL,
  postcode             text        NOT NULL,
  country_code         char(3)     NOT NULL DEFAULT 'MYS',
  contact_email        text,
  contact_phone        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- One supplier identity per tenant. Two would mean an invoice could be issued
  -- under either and nothing would say which.
  UNIQUE (tenant_id)
);

COMMENT ON TABLE core.tenant_tax_profiles IS
  'The SUPPLIER''s fiscal identity, one row per tenant. Deliberately NOT columns on '
  'public.tenants: 002 owns that table, `public` is identity and tenancy only, and '
  'these are domain attributes the API must read. Critic C-11 counted public.tenants '
  'at eight columns and observed there was nowhere to put a TIN. This is where.';

SELECT app.finalise_table('core','tenant_tax_profiles',false,NULL,ARRAY[]::text[]);

-- The BUYER's identifiers, on the organisation that has them.
ALTER TABLE core.organisations
  ADD COLUMN IF NOT EXISTS tax_identifier_kind core.tax_identifier_kind,
  ADD COLUMN IF NOT EXISTS tax_identifier      text,
  ADD COLUMN IF NOT EXISTS tin                 text,
  ADD COLUMN IF NOT EXISTS sst_registration_no text,
  ADD COLUMN IF NOT EXISTS address_line1       text,
  ADD COLUMN IF NOT EXISTS address_line2       text,
  ADD COLUMN IF NOT EXISTS city                text,
  ADD COLUMN IF NOT EXISTS state_code          text,
  ADD COLUMN IF NOT EXISTS postcode            text,
  ADD COLUMN IF NOT EXISTS country_code        char(3) NOT NULL DEFAULT 'MYS';

-- The pairing is constrained, not merely stored. An identifier with no kind is
-- a number nobody can use, and a kind with no identifier is a form half filled.
DO $$ BEGIN
  ALTER TABLE core.organisations
    ADD CONSTRAINT organisations_tax_identifier_paired
    CHECK ((tax_identifier_kind IS NULL) = (tax_identifier IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN core.organisations.tin IS
  'Buyer TIN, mirrored. `location` (free text) stays for display and search; the '
  'structured address columns beside it exist because an e-invoice needs the parts '
  'separately and free text cannot be split back apart reliably (critic C-11).';

-- ═══ 2 · Invoices ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.invoices (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                  text,
  organisation_id      uuid        NOT NULL,
  engagement_id        uuid,
  status               core.invoice_status NOT NULL DEFAULT 'DRAFT',
  issued_at            timestamptz,
  due_at               date,
  terms_days           smallint    NOT NULL DEFAULT 30 CHECK (terms_days >= 0),

  -- ── Money. subtotal is maintained from the lines; the other two are derived.
  subtotal_sen         bigint      NOT NULL DEFAULT 0 CHECK (subtotal_sen >= 0),
  sst_rate             core.rate   NOT NULL DEFAULT 0,
  sst_reason           text        NOT NULL DEFAULT 'TRAINING_EXEMPT'
                       CHECK (sst_reason IN ('TRAINING_EXEMPT','STANDARD_RATED','ZERO_RATED','OUT_OF_SCOPE')),
  sst_sen              bigint      GENERATED ALWAYS AS
                         (app.round_half_up_sen(subtotal_sen::numeric * sst_rate)) STORED,
  total_sen            bigint      GENERATED ALWAYS AS
                         (subtotal_sen + app.round_half_up_sen(subtotal_sen::numeric * sst_rate)) STORED,
  outstanding_sen      bigint      NOT NULL DEFAULT 0 CHECK (outstanding_sen >= 0),
  currency             core.currency_code NOT NULL DEFAULT 'MYR',
  exchange_rate        numeric(12,6) CHECK (exchange_rate IS NULL OR exchange_rate > 0),

  -- ── Push state: did WE manage to hand it to the accounting package.
  sync_state           core.sync_state NOT NULL DEFAULT 'NOT_SENT',
  sync_provider        text,
  sync_uin             text,
  sync_document_id     text,
  sync_last_attempt_at timestamptz,

  -- ── Mirror state: what the tax authority said about it downstream.
  einvoice_type_code   text        NOT NULL DEFAULT '01'
                       CHECK (einvoice_type_code IN ('01','02','03','04','11','12','13','14')),
  einvoice_status      core.einvoice_status NOT NULL DEFAULT 'NOT_SUBMITTED',
  einvoice_uuid        text,
  einvoice_submission_uid text,
  einvoice_long_id     text,
  einvoice_validated_at timestamptz,
  -- ⚠ DERIVED BY TRIGGER, NOT GENERATED, AND THAT IS NOT A PREFERENCE. This was
  -- written `GENERATED ALWAYS AS (einvoice_validated_at + interval '72 hours')
  -- STORED` and PostgreSQL refused it outright: "generation expression is not
  -- immutable". `timestamptz + interval` is STABLE, not IMMUTABLE, because
  -- interval arithmetic depends on the session TimeZone — the months-and-days
  -- parts of an interval mean different amounts of absolute time in different
  -- zones, and the planner will not freeze that into stored data. Found by
  -- running it, not by reading about it.
  --
  -- The guarantee is kept by other means rather than abandoned:
  -- core.invoice_set_cancel_deadline() is a BEFORE INSERT/UPDATE trigger that
  -- OVERWRITES whatever the caller supplied. The column is therefore still
  -- underivable by a caller, still indexable for 015's sweep, and the one thing
  -- lost is that the guarantee now lives in a trigger a later migration could
  -- drop — so test_010 asserts it by writing a deliberately wrong deadline and
  -- checking the row afterwards.
  einvoice_cancel_deadline_at timestamptz,
  einvoice_validation_errors jsonb,
  is_self_billed       boolean     NOT NULL DEFAULT false,
  is_consolidated      boolean     NOT NULL DEFAULT false,

  voided_at            timestamptz,
  void_reason          text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by_kind      app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id        text        NOT NULL DEFAULT 'system',
  created_by_name      text,

  CONSTRAINT invoices_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT invoices_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE RESTRICT,

  -- Doc 01 §3.4 and doc 04 §1.6.
  CONSTRAINT invoices_sent_has_issued_at
    CHECK (status <> 'SENT' OR issued_at IS NOT NULL),
  CONSTRAINT invoices_sst_exempt_has_no_rate
    CHECK (sst_reason <> 'TRAINING_EXEMPT' OR sst_rate = 0),
  -- The `_sen` reservation doc 01 raised, made enforceable (R-PROV, C-6 in 04).
  -- A `_sen` column holding cents is wrong under any suffix. This fails at the
  -- point of change and forces the rename to be part of whatever introduces a
  -- second currency, rather than a silent reinterpretation of every stored row.
  CONSTRAINT invoices_currency_is_myr CHECK (currency = 'MYR'),
  CONSTRAINT invoices_exchange_rate_only_foreign
    CHECK (currency = 'MYR' OR exchange_rate IS NOT NULL),
  -- A void with no reason is the one thing a cancelled tax document may not be.
  --
  -- ⚠ THIS CONSTRAINT WAS WRONG THE FIRST TIME AND test_010 T7a CAUGHT IT. It
  -- read `(voided_at IS NULL) = (void_reason IS NULL)`, which conflates two
  -- different events that both need a reason and are not the same event:
  --   * `voided_at` is TrainOS voiding its own invoice.
  --   * `einvoice_status = 'CANCELLED'` is the DOCUMENT being cancelled
  --     downstream inside the 72-hour window.
  -- The first version made the second unrepresentable: cancelling the e-invoice
  -- sets `void_reason` without setting `voided_at`, and the CHECK refused it —
  -- so the statutory cancellation path the migration exists to support could not
  -- be walked at all. Worth stating plainly rather than quietly corrected: the
  -- constraint looked careful and was the more restrictive of the two options,
  -- which is exactly how a wrong constraint survives review.
  CONSTRAINT invoices_void_needs_reason
    CHECK ((voided_at IS NOT NULL OR einvoice_status = 'CANCELLED')
           = (void_reason IS NOT NULL)),
  -- Ruling R-JSONB: key presence asserted, not hoped for. A validation failure
  -- that finance cannot act on is the same as no record of it.
  CONSTRAINT invoices_validation_errors_shape
    CHECK (einvoice_validation_errors IS NULL
           OR (einvoice_validation_errors ? 'errors'
               AND jsonb_typeof(einvoice_validation_errors -> 'errors') = 'array')),
  -- A mirrored status that claims validation must carry the evidence of it.
  CONSTRAINT invoices_valid_has_identifiers
    CHECK (einvoice_status <> 'VALID'
           OR (einvoice_uuid IS NOT NULL AND einvoice_long_id IS NOT NULL
               AND einvoice_validated_at IS NOT NULL)),
  CONSTRAINT invoices_invalid_has_errors
    CHECK (einvoice_status NOT IN ('INVALID','REJECTED')
           OR einvoice_validation_errors IS NOT NULL),
  -- 11-14 are the self-billed type codes. A self-billed flag that disagrees with
  -- the type code would put two different answers on one document.
  CONSTRAINT invoices_self_billed_type_code
    CHECK (is_self_billed = (einvoice_type_code IN ('11','12','13','14')))
);

COMMENT ON TABLE core.invoices IS
  'The tax invoice. TrainOS does NOT e-invoice: every einvoice_* column is written '
  'from a downstream response and is never read as an instruction to submit (doc 01 '
  '§3.4). The columns exist because mirroring a document you cannot represent is '
  'dropping it and calling the remainder a mirror (critic C-11).';

COMMENT ON COLUMN core.invoices.einvoice_uuid IS
  'The DOCUMENT''s identifier, distinct from einvoice_submission_uid which '
  'identifies the batch it arrived in. Collapsing the two is the first error '
  'critic C-11 names; they are not interchangeable and only one of them appears '
  'on a QR code.';

COMMENT ON COLUMN core.invoices.einvoice_cancel_deadline_at IS
  'validated_at + 72 hours, overwritten on every write by core.invoice_set_cancel_'
  'deadline() so a caller cannot extend the statutory window by supplying a '
  'convenient value. Stored rather than computed at read time so it is indexable '
  'and so 015 can sweep for invoices approaching it. NOT a generated column: '
  'timestamptz + interval is STABLE, not IMMUTABLE, and PostgreSQL refuses it in a '
  'generation expression.';

COMMENT ON COLUMN core.invoices.outstanding_sen IS
  'total_sen minus the signed sum of payments. NOT generated - a generated column '
  'may not read another table - so it is trigger-maintained from core.payments and '
  'asserted at COMMIT by the same deferred mechanism that guards the header totals.';

SELECT app.finalise_table('core','invoices',true,'INV',
  ARRAY['organisation_id','engagement_id','currency']);

CREATE INDEX IF NOT EXISTS invoices_status_due_idx
  ON core.invoices (tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS invoices_organisation_idx
  ON core.invoices (tenant_id, organisation_id);
CREATE INDEX IF NOT EXISTS invoices_engagement_idx
  ON core.invoices (tenant_id, engagement_id);
CREATE INDEX IF NOT EXISTS invoices_sync_error_idx
  ON core.invoices (tenant_id, sync_state) WHERE sync_state = 'ERROR';
-- The policy gate's index. app.action_value and the ACCOUNT_TRADING_HOLD
-- precondition both ask "does this organisation have anything overdue", and a
-- partial index is the difference between that question costing nothing and it
-- scanning every invoice the tenant has ever issued.
CREATE INDEX IF NOT EXISTS invoices_overdue_idx
  ON core.invoices (tenant_id, organisation_id, due_at)
  WHERE outstanding_sen > 0 AND status IN ('SENT','PARTIALLY_PAID','OVERDUE');
-- Sweeping for invoices approaching the statutory cancellation window (015).
CREATE INDEX IF NOT EXISTS invoices_cancel_deadline_idx
  ON core.invoices (tenant_id, einvoice_cancel_deadline_at)
  WHERE einvoice_status = 'VALID';

CREATE UNIQUE INDEX IF NOT EXISTS invoices_sync_document_key
  ON core.invoices (tenant_id, sync_provider, sync_document_id)
  WHERE sync_document_id IS NOT NULL;
-- One mirrored document is one invoice. Without this a retried push that got a
-- new UUID would silently produce two invoices claiming to be the same document.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_einvoice_uuid_key
  ON core.invoices (tenant_id, einvoice_uuid)
  WHERE einvoice_uuid IS NOT NULL;

-- ═══ 3 · Invoice lines ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.invoice_lines (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invoice_id          uuid        NOT NULL,
  n                   smallint    NOT NULL CHECK (n >= 1),
  description         text        NOT NULL,
  detail              text,
  qty                 numeric(10,2) NOT NULL CHECK (qty >= 0),
  unit_price_sen      bigint      NOT NULL DEFAULT 0 CHECK (unit_price_sen >= 0),
  -- Rounded half-up BEFORE it is summed; totals sum the ROUNDED lines. The
  -- ordering is the rule (DECISIONS §7) and summing unrounded lines then
  -- rounding the total gives a different answer.
  amount_sen          bigint      GENERATED ALWAYS AS
                        (app.round_half_up_sen(unit_price_sen::numeric * qty)) STORED,
  currency            core.currency_code NOT NULL DEFAULT 'MYR',
  tax_code            text,
  -- Critic C-11: per-line classification and unit-of-measure codes. `tax_code`
  -- alone was unconstrained free text that nothing read.
  classification_code text        CHECK (classification_code IS NULL
                                         OR classification_code ~ '^[0-9]{3}$'),
  uom_code            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_id, n),
  CONSTRAINT invoice_lines_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES core.invoices (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.invoice_lines IS
  'There is deliberately NO per_pax column: a package price is one line at qty 1 and '
  'a per-pax figure is display only (§18/S3). amount_sen is GENERATED, so a caller '
  'cannot supply a total that disagrees with its own unit price and quantity.';

SELECT app.finalise_table('core','invoice_lines',false,NULL,ARRAY['invoice_id','n']);

-- ═══ 4 · Reconciliation ═════════════════════════════════════════════════════
--
-- The 007 pattern, reused rather than reinvented: AFTER trigger recomputes the
-- header, DEFERRABLE constraint trigger asserts at COMMIT.

CREATE OR REPLACE FUNCTION core.invoice_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant  uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_invoice uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  UPDATE core.invoices i
     SET subtotal_sen = COALESCE(c.net, 0)
    FROM (SELECT sum(l.amount_sen) AS net
            FROM core.invoice_lines l
           WHERE l.tenant_id = v_tenant AND l.invoice_id = v_invoice) c
   WHERE i.tenant_id = v_tenant AND i.id = v_invoice;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

COMMENT ON FUNCTION core.invoice_recalc() IS
  'AFTER INSERT/UPDATE/DELETE on invoice_lines. Recomputes subtotal_sen from the '
  'rounded lines. sst_sen and total_sen are GENERATED from subtotal_sen, so this '
  'one write settles all three.';

REVOKE ALL ON FUNCTION core.invoice_recalc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_invoice_lines_recalc ON core.invoice_lines;
CREATE TRIGGER trg_invoice_lines_recalc
  AFTER INSERT OR UPDATE OR DELETE ON core.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION core.invoice_recalc();

CREATE OR REPLACE FUNCTION core.invoice_assert_reconciled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE v_net bigint; v_row record; v_paid bigint;
BEGIN
  -- ⚠ RE-READ THE ROW, for the reason 007 found by executing it: a DEFERRED
  -- constraint trigger's NEW is the tuple as it stood at the TRIGGERING
  -- statement, not at COMMIT. The line trigger updates the header afterwards,
  -- so trusting NEW compares the lines against a header from before they were
  -- written, and fails a transaction that is correct.
  SELECT * INTO v_row FROM core.invoices
   WHERE tenant_id = NEW.tenant_id AND id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;   -- deleted later in the same transaction

  SELECT COALESCE(sum(amount_sen), 0) INTO v_net
    FROM core.invoice_lines
   WHERE tenant_id = NEW.tenant_id AND invoice_id = NEW.id;

  -- An invoice with no lines is a draft being started, not a disagreement. Only
  -- an invoice that HAS lines must reconcile to them.
  IF EXISTS (SELECT 1 FROM core.invoice_lines
              WHERE tenant_id = NEW.tenant_id AND invoice_id = NEW.id)
     AND v_row.subtotal_sen <> v_net THEN
    RAISE EXCEPTION
      'TOTAL_NOT_RECONCILED: invoice % header does not equal the sum of its '
      'rounded lines', v_row.ref
      USING ERRCODE = 'integrity_constraint_violation',
            DETAIL = jsonb_build_object('reason','TOTAL_NOT_RECONCILED',
                                        'claimedSubtotal', v_row.subtotal_sen,
                                        'lineSubtotal', v_net)::text;
  END IF;

  -- outstanding_sen is the other half of the same guarantee. It is maintained by
  -- the payment trigger; this refuses to let anything else break it, including a
  -- direct UPDATE on the header that never touches a payment row.
  SELECT COALESCE(sum(CASE WHEN is_reversal THEN -amount_sen ELSE amount_sen END), 0)
    INTO v_paid
    FROM core.payments
   WHERE tenant_id = NEW.tenant_id AND invoice_id = NEW.id;

  IF v_row.outstanding_sen <> GREATEST(v_row.total_sen - v_paid, 0) THEN
    RAISE EXCEPTION
      'OUTSTANDING_NOT_RECONCILED: invoice % claims % outstanding against a total '
      'of % and payments of %', v_row.ref, v_row.outstanding_sen,
      v_row.total_sen, v_paid
      USING ERRCODE = 'integrity_constraint_violation',
            DETAIL = jsonb_build_object('reason','OUTSTANDING_NOT_RECONCILED',
                                        'claimed', v_row.outstanding_sen,
                                        'total', v_row.total_sen,
                                        'paid', v_paid)::text;
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION core.invoice_assert_reconciled() IS
  'DEFERRABLE INITIALLY DEFERRED constraint trigger. A multi-line edit legitimately '
  'passes through states where the header and the lines do not match, so this fires '
  'at COMMIT. Guards BOTH totals-from-lines and outstanding-from-payments, because a '
  'direct UPDATE on the header bypasses both maintaining triggers.';

REVOKE ALL ON FUNCTION core.invoice_assert_reconciled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_invoice_reconciled ON core.invoices;
CREATE CONSTRAINT TRIGGER trg_invoice_reconciled
  AFTER INSERT OR UPDATE ON core.invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.invoice_assert_reconciled();

-- ═══ 5 · The frozen validated invoice, and its only legal exit ══════════════

-- The cancellation deadline, derived on every write. See the column comment for
-- why this is a trigger and not a generated column.
CREATE OR REPLACE FUNCTION core.invoice_set_cancel_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  -- Unconditional assignment, not `IF NEW.x IS NULL THEN`. A caller supplying a
  -- deadline is exactly the case this exists to defeat, and a null-guard would
  -- let them.
  NEW.einvoice_cancel_deadline_at :=
    CASE WHEN NEW.einvoice_validated_at IS NULL THEN NULL
         ELSE NEW.einvoice_validated_at + interval '72 hours' END;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION core.invoice_set_cancel_deadline() IS
  'BEFORE INSERT OR UPDATE. Overwrites einvoice_cancel_deadline_at from '
  'einvoice_validated_at, unconditionally. Replaces a GENERATED column that '
  'PostgreSQL refuses because timestamptz + interval is STABLE.';

REVOKE ALL ON FUNCTION core.invoice_set_cancel_deadline() FROM PUBLIC, anon, authenticated;

-- Name sorts before trg_invoice_guard_validated, so the deadline is settled
-- before the guard reads it. Triggers fire in name order and that is the only
-- ordering guarantee available.
DROP TRIGGER IF EXISTS trg_a_invoice_cancel_deadline ON core.invoices;
CREATE TRIGGER trg_a_invoice_cancel_deadline
  BEFORE INSERT OR UPDATE ON core.invoices
  FOR EACH ROW EXECUTE FUNCTION core.invoice_set_cancel_deadline();

CREATE OR REPLACE FUNCTION core.invoice_guard_validated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  -- Doc 01: once the document is validated downstream, every column except
  -- status, outstanding_sen, the sync/einvoice mirror and updated_at is frozen.
  -- A validated tax invoice is a filed document; editing one is not an edit, it
  -- is a second document that disagrees with the filed one.
  IF OLD.einvoice_status = 'VALID' THEN
    IF NEW.subtotal_sen  IS DISTINCT FROM OLD.subtotal_sen
    OR NEW.sst_rate      IS DISTINCT FROM OLD.sst_rate
    OR NEW.sst_reason    IS DISTINCT FROM OLD.sst_reason
    OR NEW.issued_at     IS DISTINCT FROM OLD.issued_at
    OR NEW.due_at        IS DISTINCT FROM OLD.due_at
    OR NEW.terms_days    IS DISTINCT FROM OLD.terms_days
    OR NEW.einvoice_type_code IS DISTINCT FROM OLD.einvoice_type_code THEN
      RAISE EXCEPTION
        'INVOICE_VALIDATED_FROZEN: invoice % is validated downstream; issue a '
        'credit note instead of editing it', OLD.ref
        USING ERRCODE = 'integrity_constraint_violation',
              DETAIL = jsonb_build_object('reason','INVOICE_VALIDATED_FROZEN',
                                          'invoiceRef', OLD.ref)::text;
    END IF;
  END IF;

  -- The 72-hour window, enforced rather than remembered. After it, the exit is a
  -- credit note, which is a new document and leaves the filed one standing.
  IF NEW.einvoice_status = 'CANCELLED' AND OLD.einvoice_status <> 'CANCELLED' THEN
    IF OLD.einvoice_cancel_deadline_at IS NULL THEN
      RAISE EXCEPTION
        'EINVOICE_NOT_VALIDATED: invoice % was never validated, so there is no '
        'cancellation window to use', OLD.ref
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF now() > OLD.einvoice_cancel_deadline_at THEN
      RAISE EXCEPTION
        'EINVOICE_CANCEL_WINDOW_CLOSED: invoice % passed its 72-hour cancellation '
        'window at %; issue a credit note', OLD.ref, OLD.einvoice_cancel_deadline_at
        USING ERRCODE = 'integrity_constraint_violation',
              DETAIL = jsonb_build_object('reason','EINVOICE_CANCEL_WINDOW_CLOSED',
                                          'deadline', OLD.einvoice_cancel_deadline_at)::text;
    END IF;
    IF NEW.void_reason IS NULL THEN
      RAISE EXCEPTION
        'CANCELLATION_REASON_REQUIRED: invoice % cannot be cancelled without a '
        'reason', OLD.ref
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION core.invoice_guard_validated() IS
  'BEFORE UPDATE. Freezes a downstream-validated invoice against edits to the '
  'figures, and enforces the statutory 72-hour cancellation window with a reason. '
  'Critic C-11: doc 01 froze a validated invoice - the correct instinct - but with '
  'no credit note and no cancellation record there was no legal exit from a mistake.';

REVOKE ALL ON FUNCTION core.invoice_guard_validated() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_invoice_guard_validated ON core.invoices;
CREATE TRIGGER trg_invoice_guard_validated
  BEFORE UPDATE ON core.invoices
  FOR EACH ROW EXECUTE FUNCTION core.invoice_guard_validated();

-- ═══ 6 · Sync entries ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.invoice_sync_entries (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invoice_id         uuid        NOT NULL,
  at                 timestamptz NOT NULL DEFAULT now(),
  state              core.sync_state NOT NULL,
  einvoice_status    core.einvoice_status,
  provider_code      text,
  detail             text,
  resolution         text,
  webhook_receipt_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_sync_entries_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES core.invoices (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.invoice_sync_entries IS
  'Append-only. Every push attempt and every validation result that came back, in '
  'order. This is what answers "why does finance think this invoice is fine and the '
  'portal does not" without opening the accounting package. webhook_receipt_id ties '
  'an entry to the delivery that produced it (012).';

SELECT app.finalise_table('core','invoice_sync_entries',false,NULL,
  ARRAY['invoice_id','at','state']);

CREATE INDEX IF NOT EXISTS invoice_sync_entries_invoice_at_idx
  ON core.invoice_sync_entries (tenant_id, invoice_id, at DESC);

-- ═══ 7 · Payments ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.payments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                 text,
  invoice_id          uuid        NOT NULL,
  amount_sen          bigint      NOT NULL CHECK (amount_sen > 0),
  currency            core.currency_code NOT NULL DEFAULT 'MYR',
  received_at         timestamptz NOT NULL DEFAULT now(),
  method              text        NOT NULL
                      CHECK (method IN ('BANK_TRANSFER','CHEQUE','CARD','HRDC_DISBURSEMENT')),
  external_reference  text,
  recorded_by_user_id uuid        REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- A correction is a REVERSAL ROW, never an edit. `amount_sen > 0` on every row
  -- and the sign carried by this flag means a reversal is as visible and as
  -- auditable as the payment it reverses.
  is_reversal         boolean     NOT NULL DEFAULT false,
  reverses_payment_id uuid,
  reversal_reason     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by_kind     app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id       text        NOT NULL DEFAULT 'system',
  created_by_name     text,
  CONSTRAINT payments_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES core.invoices (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT payments_reversal_is_complete
    CHECK (NOT is_reversal
           OR (reverses_payment_id IS NOT NULL AND reversal_reason IS NOT NULL)),
  CONSTRAINT payments_non_reversal_has_no_target
    CHECK (is_reversal OR (reverses_payment_id IS NULL AND reversal_reason IS NULL))
);

COMMENT ON TABLE core.payments IS
  'Money received. NEVER updated and never deleted - a correction is a reversal row '
  'pointing at what it reverses, with a reason. That is why amount_sen is positive '
  'on every row and the sign lives in is_reversal: a signed amount column would let '
  'a correction be entered as an ordinary payment and disappear into the total.';

SELECT app.finalise_table('core','payments',true,'PAY',
  ARRAY['invoice_id','amount_sen','currency','is_reversal','reverses_payment_id']);

-- ⚠ ADDED AFTER finalise_table, and it has to be. This foreign key is SELF-
-- referential and composite, so it needs `UNIQUE (tenant_id, id)` on the very
-- table being created — and that unique constraint is one of the things
-- finalise_table adds. Declaring it inline in CREATE TABLE fails with "there is
-- no unique constraint matching given keys for referenced table", which is
-- accurate and reads like a missing parent table. Found by running it.
DO $$ BEGIN
  ALTER TABLE core.payments
    ADD CONSTRAINT payments_reverses_fk FOREIGN KEY (tenant_id, reverses_payment_id)
    REFERENCES core.payments (tenant_id, id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payments_external_reference_key
  ON core.payments (tenant_id, invoice_id, external_reference)
  WHERE external_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_invoice_idx
  ON core.payments (tenant_id, invoice_id, received_at DESC);
-- One reversal per payment. Two reversals of one payment would take the balance
-- below what was ever received, and the CHECK on outstanding_sen would surface
-- it as an unrelated failure much later.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_reversal_key
  ON core.payments (tenant_id, reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION core.payment_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant  uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_invoice uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
  v_total   bigint;
  v_paid    bigint;
  v_row     record;
BEGIN
  -- ⚠ LOCK THE PARENT FIRST, and read the compared value INSIDE the lock. Two
  -- concurrent payments against one invoice would otherwise both read the same
  -- outstanding figure and both write it, losing one. Parent-before-child is
  -- also the lock order 007's portal acceptance uses, so the two cannot deadlock
  -- against each other under load.
  SELECT * INTO v_row FROM core.invoices
   WHERE tenant_id = v_tenant AND id = v_invoice
   FOR UPDATE;
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(sum(CASE WHEN is_reversal THEN -amount_sen ELSE amount_sen END), 0)
    INTO v_paid
    FROM core.payments
   WHERE tenant_id = v_tenant AND invoice_id = v_invoice;

  v_total := v_row.total_sen;

  UPDATE core.invoices
     SET outstanding_sen = GREATEST(v_total - v_paid, 0),
         status = CASE
           -- A voided or draft invoice is not moved by money arriving against it.
           WHEN status IN ('VOID','DRAFT')            THEN status
           WHEN v_paid >= v_total AND v_total > 0     THEN 'PAID'
           WHEN v_paid > 0                            THEN 'PARTIALLY_PAID'
           -- Falling back to SENT rather than to OVERDUE: overdue is a function
           -- of the date and is settled by 015's sweep, not by a payment being
           -- reversed at 3am.
           WHEN due_at IS NOT NULL AND due_at < current_date THEN 'OVERDUE'
           ELSE 'SENT'
         END
   WHERE tenant_id = v_tenant AND id = v_invoice;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

COMMENT ON FUNCTION core.payment_apply() IS
  'AFTER INSERT on payments. Locks the invoice, re-reads the signed payment sum '
  'inside the lock, and writes outstanding_sen and status together. The read is '
  'inside the lock deliberately: a read before it is the stale read the lock exists '
  'to prevent.';

REVOKE ALL ON FUNCTION core.payment_apply() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payments_apply ON core.payments;
CREATE TRIGGER trg_payments_apply
  AFTER INSERT ON core.payments
  FOR EACH ROW EXECUTE FUNCTION core.payment_apply();

-- Payments are append-only, and that is enforced rather than documented.
CREATE OR REPLACE FUNCTION core.payment_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION
    'PAYMENT_IMMUTABLE: payments are append-only; record a reversal row instead '
    'of %ing payment %', lower(TG_OP), OLD.ref
    USING ERRCODE = 'integrity_constraint_violation',
          DETAIL = jsonb_build_object('reason','PAYMENT_IMMUTABLE',
                                      'operation', TG_OP)::text;
END;
$fn$;

REVOKE ALL ON FUNCTION core.payment_reject_mutation() FROM PUBLIC, anon, authenticated;

-- ⚠ Attached BEFORE the updated_at trigger fires would be wrong: app.set_updated_at
-- is also a BEFORE UPDATE trigger, and triggers fire in NAME order. `trg_a_...`
-- sorts before `trg_payments_updated_at`, so the refusal wins regardless of what
-- else is attached later.
DROP TRIGGER IF EXISTS trg_a_payments_immutable ON core.payments;
CREATE TRIGGER trg_a_payments_immutable
  BEFORE UPDATE OR DELETE ON core.payments
  FOR EACH ROW EXECUTE FUNCTION core.payment_reject_mutation();

-- ═══ 8 · Credit notes ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.credit_notes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref             text,
  invoice_id      uuid        NOT NULL,
  organisation_id uuid        NOT NULL,
  reason          text        NOT NULL,
  issued_at       timestamptz,
  subtotal_sen    bigint      NOT NULL DEFAULT 0 CHECK (subtotal_sen >= 0),
  sst_rate        core.rate   NOT NULL DEFAULT 0,
  sst_sen         bigint      GENERATED ALWAYS AS
                    (app.round_half_up_sen(subtotal_sen::numeric * sst_rate)) STORED,
  total_sen       bigint      GENERATED ALWAYS AS
                    (subtotal_sen + app.round_half_up_sen(subtotal_sen::numeric * sst_rate)) STORED,
  currency        core.currency_code NOT NULL DEFAULT 'MYR',
  einvoice_type_code text     NOT NULL DEFAULT '02'
                     CHECK (einvoice_type_code IN ('02','03')),
  einvoice_status core.einvoice_status NOT NULL DEFAULT 'NOT_SUBMITTED',
  einvoice_uuid   text,
  einvoice_long_id text,
  einvoice_validated_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text        NOT NULL DEFAULT 'system',
  created_by_name text,
  CONSTRAINT credit_notes_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES core.invoices (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_notes_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_notes_currency_is_myr CHECK (currency = 'MYR')
);

COMMENT ON TABLE core.credit_notes IS
  'The legal exit from a mistake on a filed invoice. Critic C-11/H-19: doc 01 freezes '
  'a validated invoice, which is the correct instinct, but with no credit note and no '
  'cancellation record there was no way out of an error except editing a filed tax '
  'document. ON DELETE RESTRICT against the invoice: a credited invoice cannot be '
  'deleted out from under the note that credits it.';

SELECT app.finalise_table('core','credit_notes',true,'CRN',
  ARRAY['invoice_id','organisation_id','currency']);

CREATE INDEX IF NOT EXISTS credit_notes_invoice_idx
  ON core.credit_notes (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS core.credit_note_lines (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  credit_note_id uuid        NOT NULL,
  n              smallint    NOT NULL CHECK (n >= 1),
  description    text        NOT NULL,
  qty            numeric(10,2) NOT NULL CHECK (qty >= 0),
  unit_price_sen bigint      NOT NULL DEFAULT 0 CHECK (unit_price_sen >= 0),
  amount_sen     bigint      GENERATED ALWAYS AS
                   (app.round_half_up_sen(unit_price_sen::numeric * qty)) STORED,
  currency       core.currency_code NOT NULL DEFAULT 'MYR',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, credit_note_id, n),
  CONSTRAINT credit_note_lines_note_fk FOREIGN KEY (tenant_id, credit_note_id)
    REFERENCES core.credit_notes (tenant_id, id) ON DELETE CASCADE
);

SELECT app.finalise_table('core','credit_note_lines',false,NULL,
  ARRAY['credit_note_id','n']);

CREATE OR REPLACE FUNCTION core.credit_note_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_note   uuid := COALESCE(NEW.credit_note_id, OLD.credit_note_id);
BEGIN
  UPDATE core.credit_notes cn
     SET subtotal_sen = COALESCE(c.net, 0)
    FROM (SELECT sum(l.amount_sen) AS net
            FROM core.credit_note_lines l
           WHERE l.tenant_id = v_tenant AND l.credit_note_id = v_note) c
   WHERE cn.tenant_id = v_tenant AND cn.id = v_note;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

REVOKE ALL ON FUNCTION core.credit_note_recalc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_credit_note_lines_recalc ON core.credit_note_lines;
CREATE TRIGGER trg_credit_note_lines_recalc
  AFTER INSERT OR UPDATE OR DELETE ON core.credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION core.credit_note_recalc();

-- A credit note may not exceed what it credits. Deferred, because the lines and
-- the header settle across several statements in one transaction.
CREATE OR REPLACE FUNCTION core.credit_note_assert_within_invoice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE v_invoice_total bigint; v_credited bigint; v_ref text;
BEGIN
  SELECT total_sen, ref INTO v_invoice_total, v_ref
    FROM core.invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.invoice_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT COALESCE(sum(total_sen), 0) INTO v_credited
    FROM core.credit_notes
   WHERE tenant_id = NEW.tenant_id AND invoice_id = NEW.invoice_id;

  IF v_credited > v_invoice_total THEN
    RAISE EXCEPTION
      'CREDIT_EXCEEDS_INVOICE: credit notes against invoice % total % sen against '
      'an invoice of % sen', v_ref, v_credited, v_invoice_total
      USING ERRCODE = 'integrity_constraint_violation',
            DETAIL = jsonb_build_object('reason','CREDIT_EXCEEDS_INVOICE',
                                        'credited', v_credited,
                                        'invoiceTotal', v_invoice_total)::text;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION core.credit_note_assert_within_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_credit_note_within_invoice ON core.credit_notes;
CREATE CONSTRAINT TRIGGER trg_credit_note_within_invoice
  AFTER INSERT OR UPDATE ON core.credit_notes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.credit_note_assert_within_invoice();

-- ═══ 9 · Receivables aging ══════════════════════════════════════════════════
--
-- Doc 04 §7. Buckets are DATA with an exclusion constraint, not boundaries
-- written into a query. The constraint is the point: overlapping buckets would
-- double-count an invoice, and a validation function would have to be called to
-- notice. Verified in doc 04 by inserting [25,40) and having it refused.

CREATE TABLE IF NOT EXISTS core.aging_buckets (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code       text        NOT NULL,
  label      text        NOT NULL,
  days       int4range   NOT NULL,
  sort       smallint    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CONSTRAINT aging_buckets_no_overlap
    EXCLUDE USING gist (tenant_id WITH =, days WITH &&)
);

COMMENT ON TABLE core.aging_buckets IS
  'current / d1_30 / d31_60 / d60_plus as DATA (doc 04 §7). The GiST exclusion makes '
  'overlapping buckets unrepresentable, so an invoice can never be double-counted - '
  'a check that validation code would have to remember to run. Seeded per tenant in '
  '016. In `core`, not `app`: the aging report is read through the Data API, and '
  'critic C-03 is the record of what happens when a client-readable table is put in '
  'a schema PostgREST cannot see.';

SELECT app.finalise_table('core','aging_buckets',false,NULL,ARRAY['code']);

CREATE OR REPLACE FUNCTION core.receivables_aging(p_tenant_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (code text, label text, sort smallint,
               invoice_count bigint, outstanding_sen bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT b.code, b.label, b.sort,
         count(i.id),
         COALESCE(sum(i.outstanding_sen), 0)::bigint
    FROM core.aging_buckets b
    LEFT JOIN core.invoices i
      ON i.tenant_id = b.tenant_id
     AND i.outstanding_sen > 0
     AND i.status IN ('SENT','PARTIALLY_PAID','OVERDUE')
     AND i.due_at IS NOT NULL
     -- The bucket definition is the ONLY place the boundaries exist. A query
     -- that said `between 1 and 30` here would be a second definition, and the
     -- two would drift the first time finance asked for a fifth bucket.
     AND b.days @> GREATEST(0, (p_as_of - i.due_at))
   WHERE b.tenant_id = p_tenant_id
   GROUP BY b.code, b.label, b.sort
   ORDER BY b.sort;
$fn$;

COMMENT ON FUNCTION core.receivables_aging(uuid, date) IS
  'Aging by bucket as at a date. SECURITY DEFINER and REVOKEd from every client role '
  'until 014 grants it: the tenant is an ARGUMENT, so exposing it before the tables '
  'have policies would publish a cross-tenant reader. 014 grants EXECUTE and the '
  'body re-checks the caller''s tenant. daysOverdue, aging and dsoDays are never '
  'columns (doc 01 §3.4); DSO in particular needs a window agreed with Finance '
  'before it means anything (doc 04 §7).';

REVOKE ALL ON FUNCTION core.receivables_aging(uuid, date) FROM PUBLIC, anon, authenticated;

-- ═══ 10 · The collections ladder ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.collection_rules (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  stage               core.collection_stage NOT NULL,
  trigger_days_overdue smallint   NOT NULL CHECK (trigger_days_overdue >= 0),
  channel             core.enquiry_channel NOT NULL,
  template_id         uuid,
  requires_role       app.app_role,
  autonomy            core.autonomy_level NOT NULL DEFAULT 'SUGGEST',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stage),
  -- Doc 04 §7 encodes DECISIONS §1's autonomy ceilings as constraints rather
  -- than as policy checks, so "reminder 3 is always human" and "a trading hold
  -- needs an MD" are unrepresentable rather than merely policed. Verified in
  -- doc 04 by promoting REMINDER_3 to AUTONOMOUS and having it refused.
  CONSTRAINT collection_rules_late_stages_never_autonomous
    CHECK (stage NOT IN ('REMINDER_3','HUMAN_CALL','TRADING_HOLD')
           OR autonomy <> 'AUTONOMOUS'),
  CONSTRAINT collection_rules_trading_hold_needs_md
    CHECK (stage <> 'TRADING_HOLD' OR requires_role = 'MD')
);

COMMENT ON TABLE core.collection_rules IS
  'The 7/30/45/60/75 ladder as DATA, seeded per tenant in 016. The ladder is '
  'configuration, not code: a finance lead moves reminder 2 from 30 days to 21 '
  'without a migration. The two CHECK constraints are the parts that are NOT '
  'configuration, because DECISIONS §1 fixes them.';

SELECT app.finalise_table('core','collection_rules',false,NULL,ARRAY['stage']);

CREATE OR REPLACE FUNCTION core.collection_stage_for(p_tenant_id uuid, p_days_overdue int)
RETURNS core.collection_stage
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT r.stage
    FROM core.collection_rules r
   WHERE r.tenant_id = p_tenant_id
     AND r.trigger_days_overdue <= p_days_overdue
   ORDER BY r.trigger_days_overdue DESC
   LIMIT 1;
$fn$;

COMMENT ON FUNCTION core.collection_stage_for(uuid, integer) IS
  'The furthest stage the ladder has reached at N days overdue. Resolved from '
  'collection_rules, never from a hardcoded ladder. Doc 04 §7 verified 34 days -> '
  'REMINDER_2 (matching the contract''s INV-2026-0288 fixture) and 80 -> '
  'TRADING_HOLD; test_010 re-runs both against real rows.';

REVOKE ALL ON FUNCTION core.collection_stage_for(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS core.collections_cases (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                  text,
  invoice_id           uuid        NOT NULL,
  organisation_id      uuid        NOT NULL,
  stage                core.collection_stage NOT NULL DEFAULT 'REMINDER_1',
  stage_entered_at     timestamptz NOT NULL DEFAULT now(),
  next_action_at       timestamptz,
  next_action_type     text,
  next_action_status   text        CHECK (next_action_status IS NULL
                                     OR next_action_status IN ('DRAFT_READY','SCHEDULED','BLOCKED')),
  autonomy             core.autonomy_level NOT NULL DEFAULT 'SUGGEST',
  -- Stamped by the gate in 011 when ACCOUNT_TRADING_HOLD is approved. Left
  -- without a foreign key ON PURPOSE: app.action_requests does not exist yet,
  -- and 011 adds the constraint rather than 010 guessing its shape.
  trading_hold_action_id uuid,
  closed_at            timestamptz,
  closed_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by_kind      app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id        text        NOT NULL DEFAULT 'system',
  created_by_name      text,
  CONSTRAINT collections_cases_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES core.invoices (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT collections_cases_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT collections_cases_closed_needs_reason
    CHECK ((closed_at IS NULL) = (closed_reason IS NULL)),
  -- A trading hold without the approval that authorised it is exactly the state
  -- the action envelope exists to make impossible.
  CONSTRAINT collections_cases_hold_needs_approval
    CHECK (stage <> 'TRADING_HOLD' OR trading_hold_action_id IS NOT NULL)
);

COMMENT ON TABLE core.collections_cases IS
  'One case per overdue invoice. The UNIQUE index below is per OPEN case, not per '
  'invoice: an invoice that was chased, settled, and went overdue again on a later '
  'line is a second case, and collapsing the two would lose the first chase.';

SELECT app.finalise_table('core','collections_cases',true,'COL',
  ARRAY['invoice_id','organisation_id']);

CREATE UNIQUE INDEX IF NOT EXISTS collections_cases_one_open_per_invoice
  ON core.collections_cases (tenant_id, invoice_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS collections_cases_queue_idx
  ON core.collections_cases (tenant_id, stage, next_action_at) WHERE closed_at IS NULL;

-- ═══ 11 · Verify ════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_cnt int; v_bad text;
BEGIN
  -- Every table created here is RLS enabled AND forced with zero policies.
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND c.relname IN ('tenant_tax_profiles','invoices','invoice_lines',
                      'invoice_sync_entries','payments','credit_notes',
                      'credit_note_lines','aging_buckets','collection_rules',
                      'collections_cases')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '010 verify: table(s) not RLS enabled AND forced: %', v_bad;
  END IF;

  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND c.relname IN ('tenant_tax_profiles','invoices','invoice_lines',
                      'invoice_sync_entries','payments','credit_notes',
                      'credit_note_lines','aging_buckets','collection_rules',
                      'collections_cases');
  IF v_cnt <> 10 THEN
    RAISE EXCEPTION '010 verify: expected 10 tables, found %', v_cnt;
  END IF;

  -- The derived money columns are GENERATED, not merely constrained. A CHECK
  -- rejects a wrong total; GENERATED makes one unrepresentable, and the
  -- difference is the whole argument of doc 04 §1.3.
  SELECT string_agg(a.attrelid::regclass::text || '.' || a.attname, ', ') INTO v_bad
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid IN ('core.invoices'::regclass, 'core.invoice_lines'::regclass,
                       'core.credit_notes'::regclass, 'core.credit_note_lines'::regclass)
    AND a.attname IN ('sst_sen','total_sen','amount_sen')
    AND a.attgenerated <> 's';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '010 verify: column(s) expected GENERATED STORED but are not: %', v_bad;
  END IF;

  -- Five functions, all pinned to the empty search_path.
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'core'
    AND p.proname IN ('invoice_recalc','invoice_assert_reconciled',
                      'invoice_guard_validated','payment_apply',
                      'payment_reject_mutation','credit_note_recalc',
                      'credit_note_assert_within_invoice',
                      'invoice_set_cancel_deadline',
                      'receivables_aging','collection_stage_for')
    AND 'search_path=""' = ANY (p.proconfig);
  IF v_cnt <> 10 THEN
    RAISE EXCEPTION
      '010 verify: expected 10 functions at search_path="", found %', v_cnt;
  END IF;

  -- No client role holds EXECUTE on the two readers. Granting before 014 gives
  -- the tables policies would publish a cross-tenant reader.
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN unnest(ARRAY['anon','authenticated']) AS r(role_name)
  WHERE n.nspname = 'core'
    AND p.proname IN ('receivables_aging','collection_stage_for')
    AND has_function_privilege(r.role_name, p.oid, 'EXECUTE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '010 verify: % client EXECUTE grant(s) on the finance readers', v_cnt;
  END IF;

  RAISE NOTICE
    '010 verify: OK - 10 tables RLS-forced, 3 generated money columns, 10 functions '
    'at search_path="", 0 client EXECUTE grants.';
END;
$verify$;

COMMIT;
