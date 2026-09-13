-- ============================================================================
-- Migration 017: baseline amendment. Nine PUBLIC grants nobody intended, seven
-- unconstrained jsonb columns, two wrong numeric precisions, and the regulatory
-- shape the September research says 001-016 is missing.
-- ============================================================================
--
-- FEATURE. This is the amendment pass. It changes tables 005 through 013 already
-- created rather than adding a layer on top of them, which makes it the most
-- dangerous migration in the pack: every statement here runs against a table that
-- may already hold rows, and two of them change a column's TYPE.
--
-- OBJECTS. Three new tables (`core.tax_policies`, `core.data_retention_policies`,
-- `core.data_breach_register`), two new functions (`app.resolve_tax_policy`,
-- `core.retrieve_knowledge`), nine REVOKEs, seven CHECK constraints, two type
-- changes, six new columns, one new unique constraint, and the registry rows the
-- HRD Corp research supplies.
--
-- ── SOURCES, NAMED PER SECTION RATHER THAN IN A LIST ────────────────────────
--
-- Every regulatory number in this file comes from one of the six research
-- documents dated 2026-09-13 and is cited at the line that uses it, because a
-- number without a citation in a tax table is a number nobody can re-check. Where
-- the research says a figure is UNCONFIRMED, the row is seeded `PROPOSED` and the
-- header says so — the compliance research is explicit about this and it is not
-- a formality: "All rows load `status = 'PROPOSED'` per `cr_active_needs_verification`
-- until a named Finance verifier confirms each against the circular text — none
-- should be inserted `ACTIVE` from this document alone."
--
-- ── SPINE ───────────────────────────────────────────────────────────────────
--
-- Spine untouched: no action type, no handler, no branch in the envelope. `core.
-- retrieve_knowledge` is a read, and the tax resolver is called by the money path
-- rather than by the gate.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('core.quotations') IS NULL
     OR pg_catalog.to_regclass('core.compliance_rules') IS NULL
     OR pg_catalog.to_regclass('core.knowledge_chunks') IS NULL THEN
    RAISE EXCEPTION '017 preflight: 007, 009 or 013 has not been applied';
  END IF;
  IF pg_catalog.to_regproc('app.apply_tenant_policies') IS NULL THEN
    RAISE EXCEPTION
      '017 preflight: app.apply_tenant_policies is absent; 014 has not been '
      'applied. 017 creates three tenant-scoped tables and they must receive the '
      'same policy posture as every other table rather than a hand-written one.';
  END IF;
END;
$preflight$;

-- ============================================================================
-- §1 · The nine PUBLIC EXECUTE grants, revoked
-- ============================================================================
-- 001 measured, and recorded in its own header, that doc 02 §4.1's baseline line
-- `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON FUNCTIONS FROM PUBLIC` **does not
-- take**: it records no row in `pg_default_acl` and a function created afterwards
-- is still executable by PUBLIC and therefore by `anon`. 001 kept the line as the
-- documented baseline, said explicitly that it is NOT the guard, and named the
-- real guard as "per-object REVOKE at creation in every migration plus test_014's
-- schema-wide sweep".
--
-- Nine functions in `core` slipped through that guard. All nine are TRIGGER
-- functions or helpers created by 007 and 009 without a per-object REVOKE, and
-- they have been executable by PUBLIC — which now, after 014, means executable by
-- `authenticated`, because 014 granted `USAGE ON SCHEMA core`. Before 014 the
-- schema USAGE was missing and the grants were unreachable; **014 is what turned
-- a latent defect into a live one**, which is why this revoke lands in the pack
-- immediately after it rather than being filed.
--
-- `core.apply_rule_offset` is listed first because it is the only one of the nine
-- that is NOT a trigger function. It is a plain callable that takes a date, an
-- integer and an offset unit and returns a date — the arithmetic behind every
-- HRD Corp deadline in the registry. A caller who can execute it can enumerate
-- the rule engine's date arithmetic directly; more to the point, it is the one
-- that is reachable through PostgREST as an RPC the moment `core` is exposed,
-- because the other eight take no arguments and return `trigger`, a type
-- PostgREST will not call.
--
-- The other eight fire as triggers regardless of the grant, so revoking EXECUTE
-- does not disable them: a trigger function is invoked by the executor, not by
-- the caller's privilege. Revoking is free and the grant was never intended.

REVOKE ALL ON FUNCTION core.apply_rule_offset(date, integer, core.rule_offset_unit)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION core.enforce_attendance_day_lock()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.enforce_attendance_entry_lock()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.freeze_applied_quotation()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.freeze_sent_proposal_sections()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.quotation_assert_floor()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.quotation_assert_reconciled()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.quotation_block_placeholder()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.sync_rule_scheme_key()             FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- §2 · Ruling R-JSONB on the seven columns that never received it
-- ============================================================================
-- "Every jsonb column carries a CHECK asserting the keys it must contain" (doc 01,
-- ruling R-JSONB). 012's verify block sweeps for columns with no CHECK naming
-- them; re-derived against the full 001-016 set, exactly seven remain, spread
-- across 005, 006, 008, 009 and 013.
--
-- ⚠ ALL SEVEN GET THE **TYPE HALF ONLY**, AND THIS FILE SAYS SO RATHER THAN
-- LETTING A READER ASSUME OTHERWISE. 013 set the precedent and the same reasoning
-- applies here: the key half of R-JSONB asserts "the keys its consumers read",
-- and **none of these seven columns has a consumer that declares any.** There is
-- no SQL that reads them, no comment naming a shape, and no entry in
-- `packages/contract` fixing one. Inventing required keys in a CHECK constraint
-- would freeze a shape nobody has agreed, on a table that may already hold rows,
-- and the first real consumer would then have to ship a migration to un-freeze it.
--
-- The type half is not nothing. `jsonb` accepts `"hello"`, `42`, `true` and `null`
-- as perfectly valid scalars, and every one of them survives a naive
-- `col IS NOT NULL` check while breaking any `->>` the first consumer writes.
-- 012's own note calls this "the half of R-JSONB that N-02 says gets skipped".
--
-- `saved_views.filters` defaults to `'[]'` and is therefore an ARRAY; the other
-- six default to `'{}'`. The constraint follows the default rather than
-- flattening all seven to 'object', which would make `saved_views` unwritable at
-- its own default value.

-- ⚠ GUARDED, BECAUSE `ADD CONSTRAINT` HAS NO `IF NOT EXISTS`. This is the third
-- time this pack has hit the same trap — 004 hit it on `ref_formats_tenant_id_key`
-- and 006 hit it on the three foreign keys it adds to 002's and 005's tables, and
-- both entries in the catalog name it as a migration trap the Supabase schema
-- guidance calls out explicitly. 017 hit it again, and was caught by re-running
-- the file rather than by remembering. A migration that cannot be re-run is a
-- migration that cannot be recovered halfway through.
--
-- NOT VALID then VALIDATE, rather than a plain ADD, and the reason is operational:
-- a plain ADD CONSTRAINT takes an ACCESS EXCLUSIVE lock AND scans the whole table
-- under it. NOT VALID takes the lock only long enough to record the constraint —
-- every subsequent write is checked immediately — and VALIDATE then scans under a
-- SHARE UPDATE EXCLUSIVE lock that blocks neither reads nor writes. On an empty
-- database the difference is nothing; on a customer's `knowledge_chunks` it is
-- the difference between a lock held for a moment and one held for a table scan.
DO $jsonb$
DECLARE
  r        pg_catalog.record;
  v_added  integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('compliance_rules',              'compliance_rules_applies_when_is_object',              'applies_when',    'object'),
      ('evaluation_responses',          'evaluation_responses_answers_is_object',               'answers',         'object'),
      ('hrdc_packet_documents',         'hrdc_packet_documents_meta_is_object',                 'meta',            'object'),
      ('knowledge_chunks',              'knowledge_chunks_metadata_is_object',                  'metadata',        'object'),
      ('organisation_health_snapshots', 'organisation_health_snapshots_components_is_object',   'components',      'object'),
      -- `saved_views.filters` defaults to '[]' and is therefore an ARRAY. The
      -- constraint follows the column's own default rather than flattening all
      -- seven to 'object', which would make saved_views unwritable at its default.
      ('saved_views',                   'saved_views_filters_is_array',                         'filters',         'array'),
      ('tna_recommendations',           'tna_recommendations_scoring_weights_is_object',        'scoring_weights', 'object')
    ) AS t(tbl, con, col, kind)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conrelid = pg_catalog.to_regclass('core.' || r.tbl)
                      AND conname  = r.con) THEN
      EXECUTE pg_catalog.format(
        'ALTER TABLE core.%I ADD CONSTRAINT %I CHECK (pg_catalog.jsonb_typeof(%I) = %L) NOT VALID',
        r.tbl, r.con, r.col, r.kind);
      EXECUTE pg_catalog.format(
        'ALTER TABLE core.%I VALIDATE CONSTRAINT %I', r.tbl, r.con);
      v_added := v_added + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '017: % of 7 R-JSONB constraint(s) added', v_added;
END;
$jsonb$;

-- ============================================================================
-- §3 · Two numeric precisions, changed data-preservingly
-- ============================================================================
-- Root `CLAUDE.md`: "`numeric(6,4)` for margin, commission and tax rates.
-- `numeric(4,3)` for confidence, fit and eval scores, with
-- `CHECK (x >= 0 AND x <= 1)`. Never `float`."
--
--   `core.quotations.margin_rate` is bare `numeric` — unconstrained precision and
--   scale. Its two neighbours on the same table, `floor_margin_rate` and
--   `commission_rate`, are both `numeric(6,4)` already, so the row currently
--   stores the binding floor at four decimal places and the margin it is compared
--   against at arbitrary precision. **That comparison is the below-floor
--   decision**, and 007 derives `below_floor` from it.
--
--   `core.evaluation_responses.overall_score` is `numeric(3,2)` — two decimals
--   where the rule says three. 4.33 out of 5 stored as 0.87 rather than 0.867.
--
-- ⚠ BOTH DIRECTIONS ARE WIDENING, WHICH IS WHY THIS IS SAFE. `numeric` →
-- `numeric(6,4)` narrows nothing in scale (bare numeric has no scale to lose, and
-- any existing value with more than four decimals would ROUND — see the guard
-- below). `numeric(3,2)` → `numeric(4,3)` adds a digit of scale and a digit of
-- precision; every representable value maps exactly, `0.87` becomes `0.870`, and
-- no row can fail.
--
-- The guard is on the first one only, and it refuses rather than rounding: a
-- margin rate silently rounded from 0.28571 to 0.2857 could move a quotation
-- across its floor, and a migration is not the place to make that decision.

DO $precision$
DECLARE v_bad integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_bad
    FROM core.quotations
   WHERE margin_rate IS NOT NULL
     AND pg_catalog.scale(margin_rate) > 4;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      '017: % quotation(s) hold a margin_rate with more than 4 decimal places. '
      'Narrowing to numeric(6,4) would ROUND them, and a rounded margin can cross '
      'the floor that decides whether the quotation needed an approval. Resolve '
      'these rows deliberately before applying 017.', v_bad;
  END IF;

  SELECT pg_catalog.count(*) INTO v_bad
    FROM core.quotations
   WHERE margin_rate IS NOT NULL
     AND (margin_rate < -99.9999 OR margin_rate > 99.9999);
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      '017: % quotation(s) hold a margin_rate outside numeric(6,4) range', v_bad;
  END IF;
END;
$precision$;

ALTER TABLE core.quotations
  ALTER COLUMN margin_rate TYPE numeric(6,4);

ALTER TABLE core.evaluation_responses
  ALTER COLUMN overall_score TYPE numeric(4,3);

-- The bound the rule names, which neither column carried. An eval score is a
-- normalised 0..1 figure; without the CHECK a five-point Likert answer written
-- straight into the column as `4.5` is accepted and every average built on it is
-- wrong by a factor nobody notices.
DO $score$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.evaluation_responses'::regclass
                    AND conname='evaluation_responses_overall_score_range') THEN
    ALTER TABLE core.evaluation_responses
      ADD CONSTRAINT evaluation_responses_overall_score_range
      CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 1)) NOT VALID;
    ALTER TABLE core.evaluation_responses
      VALIDATE CONSTRAINT evaluation_responses_overall_score_range;
  END IF;
END;
$score$;

COMMENT ON COLUMN core.quotations.margin_rate IS
  'numeric(6,4) per root CLAUDE.md, matching floor_margin_rate and commission_rate '
  'on the same row. Was bare numeric until 017, which meant the binding floor was '
  'stored at four decimals and the margin compared against it was not. 017.';

COMMENT ON COLUMN core.evaluation_responses.overall_score IS
  'numeric(4,3) in 0..1 per root CLAUDE.md. Was numeric(3,2) with no bound until '
  '017. 017.';

-- ============================================================================
-- §3b · The composite unique 014 found missing and deferred
-- ============================================================================
-- 014's verify caught `core.rule_set_versions` with no tenant index, because 009
-- hand-rolled that table instead of passing it through `app.finalise_table`. 014
-- added the index, since it created the policy that needed it, and left the
-- composite `UNIQUE (tenant_id, id)` here because it is a shape change to a table
-- that may hold rows.
--
-- The composite unique is not decoration. It is what lets a CHILD table declare
-- `FOREIGN KEY (tenant_id, rule_set_version_id) REFERENCES core.rule_set_versions
-- (tenant_id, id)` — the composite-FK rule that makes a cross-tenant reference
-- unrepresentable at the storage engine, independently of RLS. Without it, any
-- future child of this table can only reference `(id)` and the tenant check
-- becomes a policy's job, which 005's own entry calls the weaker guarantee.

DO $rsv$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'core.rule_set_versions'::regclass
       AND conname  = 'rule_set_versions_tenant_id_id_key')
  THEN
    -- tenant_id is NULLABLE here (national rule sets), and a UNIQUE over a
    -- nullable column treats NULLs as distinct, so national rows are unaffected
    -- and tenant rows get the composite key a child FK needs.
    ALTER TABLE core.rule_set_versions
      ADD CONSTRAINT rule_set_versions_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END;
$rsv$;

-- ============================================================================
-- §4 · core.tax_policies — SST as an effective-dated table, never a column default
-- ============================================================================
-- Ruling R-C, from the user: "SST is an effective-dated, tenant-scoped
-- `core.tax_policies` table resolved by `app.resolve_tax_policy()`; both taxable
-- (Group G 8%) and Education Act exempt policies seeded; **never a column
-- default**."
--
-- The "never a column default" half is the point. 010 stores `sst_rate` and
-- `sst_reason` ON the invoice, which is correct — a filed invoice must keep the
-- rate it was filed at, because the rate is a fact about that document and not a
-- lookup. What was missing is where the rate COMES FROM at the moment the invoice
-- is written. A default on the column answers "what rate" with "the rate that was
-- in the DDL when this table was created", which is unchangeable without a
-- migration and untraceable afterwards.
--
-- ── THE TAX POSITION, WITH ITS SOURCE ───────────────────────────────────────
--
-- `docs/research/2026-09-13-myinvois-sst-pdpa-schema-impact.md`:
--
--   * Training and coaching is its own taxable category under **Group G
--     (Professionals)** of the Service Tax Regulations 2018 — RMCD's *Guide on
--     Consultancy, Training or Coaching Services* — taxed at **8% since 1 March
--     2024**, with a registration threshold of **RM 500,000** over 12 months.
--
--   * The exemption people reach for does not apply: "The SST exemption for
--     'education services' applies only to institutions **registered under the
--     Education Act 1996** (schools, colleges, universities) — a private, HRD
--     Corp-accredited corporate training provider is not that, and is taxable
--     regardless of any educational component."
--
-- **So the default flips.** Before this migration nothing in the schema expressed
-- a default position at all; the research's recommendation is that the taxable
-- position is the default and exemption is the exception that must be justified.
-- Both policies are seeded because the exempt one is selectable — a tenant that
-- IS an Education Act institution exists, and the second policy is how they are
-- served without a code change. `exempt_reason_required` is what makes the
-- exemption cost something: selecting it obliges the caller to say why, and
-- `app.resolve_tax_policy` returns that flag so the money path can enforce it.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────
--
-- **Rate in basis points, not a numeric rate.** `rate_bps smallint` — 8% is 800.
-- Root CLAUDE.md prescribes `numeric(6,4)` for tax RATES and this column is
-- deliberately not that, for the same reason money is `bigint` sen and never
-- `numeric`: the policy TABLE is a configuration value that is compared, ordered
-- and versioned, and an integer has one representation per value. The invoice
-- keeps `numeric(6,5)` (010's choice) for the rate it was FILED at; the resolver
-- converts. Recorded because it looks like a rule violation and is a deliberate
-- boundary.
--
-- **Tenant-scoped with a global fallback**, exactly like 009's rule registry:
-- `tenant_id NULL` is the national policy, a tenant row overrides it locally and
-- nowhere else. 014's `app.apply_tenant_policies` derives the `tenant_id IS NULL`
-- half of the read predicate from the column's nullability, so this table gets it
-- automatically.
--
-- **Bitemporal, like 009.** Two ranges: `validity` (when the rate was in force)
-- and `known` (when we knew it). Re-resolving an old invoice's tax must return
-- what the registry said THEN, not what today's registry says — a rate change
-- announced in March and backdated to January must not silently re-decide an
-- invoice filed in February. A GiST exclusion over both axes makes "which policy
-- applied on this date as known on that date" have exactly one answer.

CREATE TABLE IF NOT EXISTS core.tax_policies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  policy_code           text NOT NULL,
  service_category      text NOT NULL,
  tax_group             text,
  rate_bps              smallint NOT NULL,
  exempt                boolean NOT NULL DEFAULT false,
  exempt_reason_required boolean NOT NULL DEFAULT false,
  is_default            boolean NOT NULL DEFAULT false,
  -- Validity: when the rate was in force.
  effective_from        date NOT NULL,
  effective_to          date,
  validity              daterange GENERATED ALWAYS AS
                          (daterange(effective_from, effective_to, '[)')) STORED,
  -- Known: when the registry knew it. 009's second axis, same shape.
  registry_from         timestamptz NOT NULL DEFAULT now(),
  registry_to           timestamptz,
  known                 tstzrange GENERATED ALWAYS AS
                          (tstzrange(registry_from, registry_to, '[)')) STORED,
  -- Source span, so a rate can be traced to the sentence that set it.
  source_title          text,
  source_section        text,
  source_excerpt        text,
  source_url            text,
  version               integer NOT NULL DEFAULT 1,
  status                text NOT NULL DEFAULT 'PROPOSED',
  verified_by_user_id   uuid,
  verified_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tax_policies_status_check
    CHECK (status IN ('PROPOSED','ACTIVE','SUPERSEDED','WITHDRAWN')),
  CONSTRAINT tax_policies_rate_range
    CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  -- An exempt policy taxes nothing. Making the contradiction unrepresentable
  -- rather than catching it in a service layer, the way 010 does for
  -- invoices_sst_exempt_has_no_rate.
  CONSTRAINT tax_policies_exempt_has_no_rate
    CHECK (NOT exempt OR rate_bps = 0),
  -- A reason can only be required where there is an exemption to justify.
  CONSTRAINT tax_policies_reason_only_when_exempt
    CHECK (exempt OR NOT exempt_reason_required),
  CONSTRAINT tax_policies_effective_order
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- 009's own rule, carried: a policy cannot go ACTIVE without a named verifier.
  CONSTRAINT tax_policies_active_needs_verification
    CHECK (status <> 'ACTIVE' OR (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL))
);

-- One answer per (scope, category) per instant on both axes. `tenant_id` is in
-- the key with `=`, so a tenant override and the national policy it overrides do
-- NOT collide — they are different scopes, and the resolver picks between them by
-- precedence rather than by the constraint refusing one of them.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

DO $excl$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.tax_policies'::regclass
                    AND conname='tax_policies_one_answer') THEN
    ALTER TABLE core.tax_policies
      ADD CONSTRAINT tax_policies_one_answer
      EXCLUDE USING gist (
        tenant_id        WITH =,
        service_category WITH =,
        validity         WITH &&,
        known            WITH &&)
      WHERE (status IN ('PROPOSED','ACTIVE'));
  END IF;
END;
$excl$;

CREATE INDEX IF NOT EXISTS tax_policies_lookup_idx
  ON core.tax_policies (service_category, tenant_id, effective_from DESC);

-- A policy code identifies a policy within its scope. Without this the seed below
-- has nothing to conflict ON, and re-running 017 inserts a second copy of every
-- national policy — which is not merely untidy: two rows with the same validity
-- and the same known range make `resolve_tax_policy`'s answer depend on physical
-- row order. Found by re-running the migration, which is the only way to find it.
-- Two partial indexes rather than one, because a UNIQUE over a nullable tenant_id
-- treats NULLs as distinct and would not constrain the national rows at all.
CREATE UNIQUE INDEX IF NOT EXISTS tax_policies_national_code_key
  ON core.tax_policies (policy_code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tax_policies_tenant_code_key
  ON core.tax_policies (tenant_id, policy_code) WHERE tenant_id IS NOT NULL;

SELECT app.finalise_table('core','tax_policies',false,NULL,
                          ARRAY['policy_code','effective_from']);

COMMENT ON TABLE core.tax_policies IS
  'Effective-dated, tenant-scoped SST policy with a national fallback (ruling '
  'R-C). Never a column default: an invoice STORES the rate it was filed at, and '
  'this table is where that rate comes from at the moment of writing. Bitemporal '
  'like 009''s rule registry, so re-resolving an old invoice returns what the '
  'registry said THEN. Rate is basis points because a policy value is compared '
  'and versioned; the invoice keeps 010''s numeric. 017.';

COMMENT ON COLUMN core.tax_policies.rate_bps IS
  'Basis points. 8% = 800. Deliberately not the numeric(6,4) root CLAUDE.md '
  'prescribes for tax rates: that rule governs the rate STORED ON A DOCUMENT, and '
  'this is a configuration value that is compared, ordered and versioned, where '
  'an integer has exactly one representation per value. 017.';

-- ── app.resolve_tax_policy ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.resolve_tax_policy(
  p_tenant_id uuid,
  p_category  text,
  p_on_date   date DEFAULT NULL,
  p_as_known  timestamptz DEFAULT NULL
) RETURNS TABLE (
  policy_id              uuid,
  policy_code            text,
  rate_bps               smallint,
  rate                   numeric,
  exempt                 boolean,
  exempt_reason_required boolean,
  scope                  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_on    date        := COALESCE(p_on_date, (pg_catalog.now())::date);
  v_known timestamptz := COALESCE(p_as_known, pg_catalog.now());
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'resolve_tax_policy: p_tenant_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_category IS NULL OR pg_catalog.btrim(p_category) = '' THEN
    RAISE EXCEPTION 'resolve_tax_policy: p_category is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  SELECT tp.id,
         tp.policy_code,
         tp.rate_bps,
         (tp.rate_bps::numeric / 10000)::numeric(6,5),
         tp.exempt,
         tp.exempt_reason_required,
         CASE WHEN tp.tenant_id IS NULL THEN 'NATIONAL' ELSE 'TENANT' END
    FROM core.tax_policies AS tp
   WHERE tp.service_category = p_category
     AND (tp.tenant_id = p_tenant_id OR tp.tenant_id IS NULL)
     AND tp.validity @> v_on
     AND tp.known    @> v_known
     AND tp.status IN ('ACTIVE','PROPOSED')
   -- A tenant override wins locally and nowhere else: NULLS LAST puts the
   -- tenant's own row first and falls through to the national one when there is
   -- no override. Then ACTIVE before PROPOSED, so a verified policy is never
   -- shadowed by an unverified one sitting on the same dates.
   ORDER BY tp.tenant_id NULLS LAST,
            (tp.status = 'ACTIVE') DESC,
            tp.effective_from DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'resolve_tax_policy: no tax policy for category % on % (as known at %). A '
      'missing policy must not silently become a zero rate: that is an invoice '
      'filed with no SST and no reason.', p_category, v_on, v_known
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION app.resolve_tax_policy(uuid,text,date,timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app.resolve_tax_policy(uuid,text,date,timestamptz) IS
  'Resolves the SST policy for a tenant, service category and date, on both '
  'temporal axes. Tenant override beats national; ACTIVE beats PROPOSED. RAISES '
  'when nothing resolves rather than returning zero, because a missing policy '
  'silently becoming a zero rate is an invoice filed with no SST and no reason. '
  'Ruling R-C. 017.';

-- ── The two seeded policies ─────────────────────────────────────────────────
-- ⚠ BOTH LOAD AS `PROPOSED`, NOT `ACTIVE`, and the constraint above enforces it:
-- ACTIVE requires a named verifier. The compliance research is explicit that
-- nothing should be inserted ACTIVE from a document alone, and the same standard
-- applies to a tax rate — more so, because this one decides what a customer is
-- billed. A named Finance verifier moves them to ACTIVE; until then the resolver
-- still returns them (PROPOSED is a usable answer and an empty answer is not),
-- and `core.v_tax_policy_unverified` below is the operational reminder.

INSERT INTO core.tax_policies
  (tenant_id, policy_code, service_category, tax_group, rate_bps, exempt,
   exempt_reason_required, is_default, effective_from, source_title,
   source_section, source_excerpt, source_url, status)
VALUES
  (NULL, 'SST-G-TRAINING-8', 'CORPORATE_TRAINING', 'GROUP_G_PROFESSIONALS',
   800, false, false, true, DATE '2024-03-01',
   'Service Tax Regulations 2018 — Group G (Professionals); RMCD Guide on Consultancy, Training or Coaching Services',
   'Group G',
   'Training and coaching is a taxable service under Group G (Professionals) at 8% with effect from 1 March 2024. Registration threshold RM500,000 over 12 months.',
   'https://mysst.customs.gov.my/', 'PROPOSED'),
  (NULL, 'SST-EDU-ACT-EXEMPT', 'EDUCATION_ACT_INSTITUTION', NULL,
   0, true, true, false, DATE '2024-03-01',
   'Service Tax Regulations 2018 — education services exemption; Education Act 1996',
   'Education services',
   'The SST exemption for education services applies only to institutions registered under the Education Act 1996 (schools, colleges, universities). A private, HRD Corp-accredited corporate training provider is not that, and is taxable regardless of any educational component.',
   'https://mysst.customs.gov.my/', 'PROPOSED')
ON CONFLICT (policy_code) WHERE tenant_id IS NULL DO NOTHING;

CREATE OR REPLACE VIEW core.v_tax_policy_unverified
WITH (security_invoker = true) AS
  SELECT tp.id, tp.tenant_id, tp.policy_code, tp.service_category,
         tp.rate_bps, tp.effective_from, tp.status
    FROM core.tax_policies AS tp
   WHERE tp.status = 'PROPOSED';

COMMENT ON VIEW core.v_tax_policy_unverified IS
  'Tax policies still awaiting a named Finance verifier. Non-empty is the normal '
  'state on a fresh database and a standing action item on a live one: every rate '
  'here is being used to bill a customer without anyone having signed it off. 017.';

-- ============================================================================
-- §5 · Quotations get SST, resolved through the policy rather than assumed
-- ============================================================================
-- 010 gave the INVOICE `sst_rate`, `sst_reason` and a generated `sst_sen`. The
-- QUOTATION — the document the customer actually sees and accepts — had none of
-- it. The consequence is the one finance complains about: a quotation quotes a
-- net figure, the invoice adds 8%, and the customer's approved budget is 8% short
-- of the invoice they receive.
--
-- The columns mirror 010's names exactly rather than inventing a parallel
-- vocabulary, so the invoice can be built from the quotation field-for-field.
-- `sst_sen` is GENERATED from the sell price and the rate, the way 010 generates
-- the invoice's — a wrong SST total is unrepresentable rather than merely
-- rejected — and it is computed on the SUMMED NET, which 010's own pin proves is
-- not pedantry: three lines at RM 333.33 at 8% give 8,001 sen per line and 8,000
-- sen on the summed net.

ALTER TABLE core.quotations
  ADD COLUMN IF NOT EXISTS sst_policy_id uuid REFERENCES core.tax_policies(id),
  ADD COLUMN IF NOT EXISTS sst_rate      numeric(6,5) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sst_reason    text NOT NULL DEFAULT 'STANDARD_RATED',
  ADD COLUMN IF NOT EXISTS sst_exempt_reason text;

ALTER TABLE core.quotations
  ADD COLUMN IF NOT EXISTS sst_sen bigint
    GENERATED ALWAYS AS (app.round_half_up_sen(sell_price_sen * sst_rate)) STORED;

ALTER TABLE core.quotations
  ADD COLUMN IF NOT EXISTS gross_price_sen bigint
    GENERATED ALWAYS AS
      (sell_price_sen + app.round_half_up_sen(sell_price_sen * sst_rate)) STORED;

DO $qsst$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.quotations'::regclass
                    AND conname='quotations_sst_reason_check') THEN
    -- The same four-value vocabulary 010 put on the invoice. A fifth value on one
    -- of the two documents is exactly the divergence the project rules forbid.
    ALTER TABLE core.quotations ADD CONSTRAINT quotations_sst_reason_check
      CHECK (sst_reason IN ('TRAINING_EXEMPT','STANDARD_RATED','ZERO_RATED','OUT_OF_SCOPE'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.quotations'::regclass
                    AND conname='quotations_sst_exempt_has_no_rate') THEN
    ALTER TABLE core.quotations ADD CONSTRAINT quotations_sst_exempt_has_no_rate
      CHECK (sst_reason <> 'TRAINING_EXEMPT' OR sst_rate = 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.quotations'::regclass
                    AND conname='quotations_exempt_needs_reason') THEN
    -- ⚠ THIS IS THE HALF THAT MAKES `exempt_reason_required` MEAN ANYTHING.
    -- The research's finding is that the taxable position is the default and
    -- exemption is the exception; a quotation that claims TRAINING_EXEMPT without
    -- writing down WHY is the shape of an under-billed customer and an RMCD
    -- question nobody can answer two years later.
    ALTER TABLE core.quotations ADD CONSTRAINT quotations_exempt_needs_reason
      CHECK (sst_reason <> 'TRAINING_EXEMPT'
             OR (sst_exempt_reason IS NOT NULL AND pg_catalog.btrim(sst_exempt_reason) <> ''));
  END IF;
END;
$qsst$;

COMMENT ON COLUMN core.quotations.sst_policy_id IS
  'The core.tax_policies row this quotation resolved through, stamped at pricing '
  'time. Stamped rather than re-resolved for the same reason 007 stamps '
  'floor_margin_rate: a policy change must not silently reprice a quotation '
  'already sent. 017.';

-- The invoice gains the same pointer, so a filed invoice can say which policy
-- produced its rate rather than only what the rate was.
ALTER TABLE core.invoices
  ADD COLUMN IF NOT EXISTS sst_policy_id uuid REFERENCES core.tax_policies(id);

COMMENT ON COLUMN core.invoices.sst_policy_id IS
  'The core.tax_policies row that produced sst_rate. 010 stored the rate; 017 '
  'stores its provenance, so "why was this invoice taxed at 8%" has an answer '
  'that survives a later policy change. 017.';

-- ============================================================================
-- §6 · contact_consents.purpose — PDPA asks what, not just whether
-- ============================================================================
-- 005 made `core.contact_consents` an append-only ledger rather than a flag,
-- because "did this person consent on 4 March 2024" must stay answerable after
-- they withdraw. What it could not answer is **what they consented TO**.
--
-- `docs/research/2026-09-13-myinvois-sst-pdpa-schema-impact.md` names both
-- columns: `purpose text NOT NULL` and `notice_version text`. The PDPA's notice
-- and choice principle is purpose-bound — consent to be contacted about a
-- training enquiry is not consent to a marketing broadcast — and `notice_version`
-- is what makes the consent reconstructible: the notice text changes, and proving
-- compliance means showing the version the person actually saw.
--
-- ⚠ DEFAULTED, NOT NULLABLE, AND THE DEFAULT IS AN ADMISSION. Existing rows
-- cannot be back-filled with a purpose nobody recorded, and guessing one would
-- manufacture evidence. `UNSPECIFIED_PRE_017` is deliberately not a valid purpose
-- for new consent — the CHECK forbids it on any row recorded after this migration
-- — so every legacy row is visibly a gap rather than silently a marketing opt-in.

ALTER TABLE core.contact_consents
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'UNSPECIFIED_PRE_017',
  ADD COLUMN IF NOT EXISTS notice_version text;

DO $consent$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.contact_consents'::regclass
                    AND conname='contact_consents_purpose_check') THEN
    ALTER TABLE core.contact_consents ADD CONSTRAINT contact_consents_purpose_check
      CHECK (purpose IN ('ENQUIRY_RESPONSE','TRAINING_ADMINISTRATION',
                         'MARKETING','FEEDBACK_SURVEY','CERTIFICATE_DELIVERY',
                         'UNSPECIFIED_PRE_017'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.contact_consents'::regclass
                    AND conname='contact_consents_no_new_unspecified') THEN
    ALTER TABLE core.contact_consents
      ADD CONSTRAINT contact_consents_no_new_unspecified
      CHECK (purpose <> 'UNSPECIFIED_PRE_017' OR recorded_at < DATE '2026-09-14')
      NOT VALID;
    ALTER TABLE core.contact_consents
      VALIDATE CONSTRAINT contact_consents_no_new_unspecified;
  END IF;
END;
$consent$;

COMMENT ON COLUMN core.contact_consents.purpose IS
  'What the person consented TO. PDPA notice-and-choice is purpose-bound: consent '
  'to be contacted about a training enquiry is not consent to a marketing '
  'broadcast. UNSPECIFIED_PRE_017 marks rows that predate this column and is '
  'forbidden on anything recorded after 2026-09-13, so a legacy gap stays visible '
  'instead of becoming a silent opt-in. 017.';

COMMENT ON COLUMN core.contact_consents.notice_version IS
  'The version of the privacy notice the person actually saw. The notice text '
  'changes; proving compliance means reconstructing what was shown, not what is '
  'shown now. 017.';

-- ============================================================================
-- §7 · PDPA: retention policy and breach register
-- ============================================================================
-- Both tables and both field lists are from
-- `docs/research/2026-09-13-myinvois-sst-pdpa-schema-impact.md`. The amended PDPA
-- obligations are IN FORCE, not forthcoming — the research corrects the proposal
-- pack on exactly this point: cross-border self-assessment since 1 April 2025,
-- DPO registration since 1 June 2025, and processors now directly liable for the
-- Security Principle.

CREATE TABLE IF NOT EXISTS core.data_retention_policies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  data_category    text NOT NULL,
  purpose          text NOT NULL,
  retention_period interval NOT NULL,
  legal_basis      text NOT NULL,
  source_ref       text,
  effective_from   date NOT NULL DEFAULT CURRENT_DATE,
  effective_to     date,
  -- ⚠ Approval state, NOT an auto-delete switch. The research is explicit that
  -- these rows should be QUEUED_FOR_APPROVAL rather than acting on their own, and
  -- 015 refuses to schedule the four retention reapers until rows here are
  -- approved. A retention policy that deletes the moment somebody types it is a
  -- data-loss incident with a compliance justification attached.
  status           text NOT NULL DEFAULT 'QUEUED_FOR_APPROVAL',
  approved_by_user_id uuid,
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT drp_status_check
    CHECK (status IN ('QUEUED_FOR_APPROVAL','APPROVED','SUPERSEDED','WITHDRAWN')),
  CONSTRAINT drp_approved_needs_approver
    CHECK (status <> 'APPROVED' OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT drp_period_positive
    CHECK (retention_period > interval '0'),
  CONSTRAINT drp_effective_order
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

SELECT app.finalise_table('core','data_retention_policies',false,NULL,
                          ARRAY['data_category','effective_from']);

COMMENT ON TABLE core.data_retention_policies IS
  'PDPA retention periods per data category, shaped like the 009 rules registry. '
  'Rows are QUEUED_FOR_APPROVAL by default and do not delete anything: 015 '
  'deliberately leaves the four retention reapers unscheduled until approved rows '
  'exist here, because deleting on a window nobody signed off is worse than not '
  'deleting. 017.';

CREATE TABLE IF NOT EXISTS core.data_breach_register (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  detected_at              timestamptz NOT NULL,
  nature                   text NOT NULL,
  affected_count           integer,
  significant_harm         boolean NOT NULL DEFAULT false,
  notified_commissioner_at timestamptz,
  notified_subjects_at     timestamptz,
  remediation              text,
  retained_until           date,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dbr_affected_count_sane
    CHECK (affected_count IS NULL OR affected_count >= 0),
  -- The statutory ordering. You cannot have told the subjects before you told the
  -- Commissioner; a register that permits it records a sequence that did not
  -- happen, which is worse than no register.
  CONSTRAINT dbr_notification_order
    CHECK (notified_subjects_at IS NULL
           OR notified_commissioner_at IS NULL
           OR notified_subjects_at >= notified_commissioner_at),
  CONSTRAINT dbr_detected_before_notified
    CHECK (notified_commissioner_at IS NULL OR notified_commissioner_at >= detected_at)
);

SELECT app.finalise_table('core','data_breach_register',false,NULL,
                          ARRAY['detected_at']);

-- The two statutory clocks, as GENERATED columns rather than as application
-- logic: 72 hours to the Commissioner, and 7 days from that notification to the
-- affected subjects where significant harm is likely. Both from the research.
-- Deadlines are derived so they cannot be edited away — the same reasoning as
-- 010's 72-hour e-invoice cancellation window, which is a stored deadline that a
-- pin proves cannot be extended.
-- ⚠ THE UTC PIVOT IS NOT DECORATION. `timestamptz + interval` is STABLE, not
-- IMMUTABLE — month and day arithmetic on a timestamptz depends on the session's
-- TimeZone — and a generated column requires an immutable expression, so the
-- obvious spelling is rejected outright by Postgres. Pivoting through
-- `AT TIME ZONE 'UTC'` does the arithmetic on a plain `timestamp`, where `+` IS
-- immutable, and converts back. The result is identical for a fixed-hour and a
-- fixed-day offset, which is what both of these are. Found by the expression
-- being refused, not by reading the manual.
ALTER TABLE core.data_breach_register
  ADD COLUMN IF NOT EXISTS commissioner_deadline_at timestamptz
    GENERATED ALWAYS AS
      (((detected_at AT TIME ZONE 'UTC') + interval '72 hours') AT TIME ZONE 'UTC') STORED;

ALTER TABLE core.data_breach_register
  ADD COLUMN IF NOT EXISTS subjects_deadline_at timestamptz
    GENERATED ALWAYS AS
      (((notified_commissioner_at AT TIME ZONE 'UTC') + interval '7 days') AT TIME ZONE 'UTC') STORED;

COMMENT ON TABLE core.data_breach_register IS
  'PDPA s.12B breach register. Commissioner within 72 hours of detection; '
  'affected subjects within 7 days of that notification where significant harm is '
  'likely. Both deadlines are GENERATED so they cannot be edited away. ⚠ '
  'retained_until is deliberately NULLABLE and unset: some guidance suggests a '
  '2-year minimum retention for the register itself and the research flags that '
  'figure as UNCONFIRMED, so 017 records the column and refuses to invent the '
  'number. 017.';

COMMENT ON COLUMN core.data_breach_register.retained_until IS
  '⚠ UNSET BY DESIGN. The 2-year minimum some guidance suggests for the register '
  'itself is recorded in the research as unverified. A retention date invented '
  'here would be indistinguishable from a researched one six months from now. 017.';

-- ============================================================================
-- §8 · The HRD Corp registry: three check keys and the 5-day query rule
-- ============================================================================
-- From `docs/research/2026-09-13-hrdcorp-compliance-refresh.md`. Three deadlines
-- are named together there and only one of them had anywhere to live:
--
--   * **5 calendar days to respond to a query.** "Single query round: 1 query per
--     application, 5 calendar days to respond or application expires." Circular
--     2/2026, effective 15 June 2026. ⚠ The research flags this as **not in
--     Appendix B** of the proposal pack — it is a recommended ADDITION, which is
--     why it arrives here with a new check key rather than against an existing
--     one. It is also the sharpest of the three: the application EXPIRES, so a
--     missed query deadline is a lost grant rather than a late one.
--   * **90-day commencement window.** Training must start within 90 days of
--     approval. Circular 2/2026, effective 15 June 2026.
--   * **6-month claim window.** A claim must be filed within 6 months of
--     completion. ⚠ The research marks this "Matches, unconfirmed against primary
--     text" — the circular PDF was unreachable. It is seeded like the others and
--     flagged, because leaving it out entirely would be worse: an unseeded rule
--     is invisible, a PROPOSED one is a question somebody can answer.
--
-- ⚠ ALL ROWS LOAD `PROPOSED`. The research's instruction is quoted in this file's
-- header and 009's `cr_active_needs_verification` enforces it: a rule cannot go
-- ACTIVE without a named verifier. Nothing here is inserted ACTIVE from a
-- document alone.

-- ⚠ THE CHECK KEYS ARE PROVISIONED, NOT INSERTED, AND THAT WAS FOUND BY THE PIN.
-- `core.check_keys` is tenant-scoped with `tenant_id NOT NULL`. An earlier draft
-- of this section seeded them with `INSERT … SELECT … CROSS JOIN public.tenants`,
-- which is correct SQL and seeds NOTHING on a database with no tenants yet — and
-- worse, seeds nothing for every tenant created AFTER 017 is applied, which is
-- all of them. test_017 T8f caught it by asking for `CHK_QUERY_DEADLINE` after
-- creating its own tenant.
--
-- The rules themselves are national (`tenant_id NULL`) and stay a plain INSERT.
-- The check keys are per-tenant configuration and therefore belong to the
-- provisioning path 016 established, in exactly its shape: a seeding function, an
-- AFTER INSERT trigger beside 016's, and a backfill for tenants that already
-- exist. Three seeds on `public.tenants` now — action policies (011), ref formats
-- (016) and check keys (017) — which is the pattern working rather than three
-- copies of it.

CREATE OR REPLACE FUNCTION app.seed_compliance_check_keys(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'seed_compliance_check_keys: p_tenant_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO core.check_keys (tenant_id, check_key, label, description, position, active)
  SELECT p_tenant_id, k.check_key, k.label, k.description, k.position, true
    FROM (VALUES
      ('CHK_QUERY_DEADLINE',      'Query response deadline',
       'HRD Corp raises at most one query per application; 5 calendar days to respond or the application expires. Circular 2/2026, effective 15 June 2026.', 80::smallint),
      ('CHK_COMMENCEMENT_WINDOW', 'Commencement window',
       'Training must commence within 90 days of grant approval. Circular 2/2026, effective 15 June 2026.', 81::smallint),
      ('CHK_CLAIM_WINDOW',        'Claim window',
       'A claim must be filed within 6 months of completion. UNCONFIRMED against primary circular text.', 82::smallint)
    ) AS k(check_key, label, description, position)
   WHERE NOT EXISTS (
     SELECT 1 FROM core.check_keys AS existing
      WHERE existing.tenant_id = p_tenant_id
        AND existing.check_key = k.check_key);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION app.seed_compliance_check_keys(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.seed_check_keys_on_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM app.seed_compliance_check_keys(NEW.id);
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION app.seed_check_keys_on_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tenants_seed_check_keys ON public.tenants;
CREATE TRIGGER trg_tenants_seed_check_keys
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app.seed_check_keys_on_tenant();

DO $ck_backfill$
DECLARE r pg_catalog.record; v_total integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    v_total := v_total + app.seed_compliance_check_keys(r.id);
  END LOOP;
  RAISE NOTICE '017: backfilled % compliance check key(s)', v_total;
END;
$ck_backfill$;

INSERT INTO core.compliance_rules
  (tenant_id, rule_code, family_key, check_key, scheme_key, delivery_mode, side,
   subject, subject_field, op, reference_kind, reference,
   offset_amount, offset_unit, effective_from, status,
   source_title, source_section, source_excerpt)
SELECT NULL::uuid,
       v.rule_code, v.family_key, v.check_key, '*',
       'ANY'::core.delivery_mode,
       v.side::core.rule_side,
       v.subject, v.subject_field,
       'LTE'::core.rule_op,
       'FIELD'::core.rule_reference_kind,
       v.reference,
       v.offset_amount,
       v.offset_unit::core.rule_offset_unit,
       DATE '2026-06-15',
       'PROPOSED'::core.rule_status,
       v.source_title, v.source_section, v.source_excerpt
  FROM (VALUES
    ('HRD-QUERY-5D','QUERY_RESPONSE','CHK_QUERY_DEADLINE','GRANT',
     'grant_application','query_responded_at','query_raised_at', 5,'DAY',
     'HRD Corp Circular 2/2026','Query handling',
     'Single query round: one query per application, 5 calendar days to respond or the application expires.'),
    ('HRD-007','COMMENCEMENT_WINDOW','CHK_COMMENCEMENT_WINDOW','GRANT',
     'engagement','starts_on','approval_date', 90,'DAY',
     'HRD Corp Circular 2/2026','Commencement',
     'Training must commence within 90 days of grant approval.'),
    ('HRD-009','CLAIM_WINDOW','CHK_CLAIM_WINDOW','CLAIM',
     'engagement','claim_submitted_at','completed_at', 6,'MONTH',
     'HRD Corp Circular 2/2026 (UNCONFIRMED - primary PDF unreachable 2026-09-13)',
     'Claim window',
     'A claim must be filed within 6 months of completion. Flagged unconfirmed in the 2026-09-13 compliance refresh.')
  ) AS v(rule_code, family_key, check_key, side, subject, subject_field,
         reference, offset_amount, offset_unit,
         source_title, source_section, source_excerpt)
 -- ⚠ WHERE NOT EXISTS rather than ON CONFLICT, because there is no unique
 -- constraint on rule_code to conflict against and 009 deliberately does not add
 -- one: a rule is SUPERSEDED by a new row carrying the same code with a later
 -- validity, which is the point of a bitemporal registry. Re-running 017 with a
 -- bare ON CONFLICT DO NOTHING therefore inserted a second copy of all three
 -- rules, and nothing refused it. Found by re-running the migration rather than
 -- by reading it, which is the third re-runnability defect this pack has caught
 -- that way.
 WHERE NOT EXISTS (
   SELECT 1 FROM core.compliance_rules AS existing
    WHERE existing.rule_code = v.rule_code
      AND existing.tenant_id IS NULL);

-- ============================================================================
-- §9 · HRD-TDF accreditation expiry on the trainer
-- ============================================================================
-- 006 gave `core.trainers` a boolean `hrd_tdf`. A boolean cannot express the one
-- thing that matters operationally: **the accreditation is valid for 3 years**,
-- and the research corrects the proposal pack's attribution while it is at it —
-- the mandate is **Circular 6/2024, effective 1 January 2025**, not the
-- Circular 2/2026 the pack cited.
--
-- "3-yr validity; 360 active-training hours to renew (or assessment route); apply
-- ≥3 months before expiry." A boolean says a trainer was accredited once. The
-- expiry date says whether they can be put in front of a claimable class next
-- month, and the derived `hrd_tdf_expiring_soon` is the 3-month renewal window
-- the research names — computed rather than stored, because a stored flag needs a
-- job to keep it true and the date already carries the information.
--
-- `ttt_valid_to` already exists beside it for the TTT certificate, so this column
-- follows that name rather than inventing a third convention.

ALTER TABLE core.trainers
  ADD COLUMN IF NOT EXISTS hrd_tdf_valid_to date,
  ADD COLUMN IF NOT EXISTS hrd_tdf_ref text;

DO $tdf$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='core.trainers'::regclass
                    AND conname='trainers_hrd_tdf_needs_expiry') THEN
    -- An accredited trainer with no expiry date is the row that quietly keeps
    -- being scheduled after the accreditation lapses. NOT VALID because existing
    -- rows predate the column and cannot be back-filled with a date nobody
    -- recorded; new and updated rows are checked from here on.
    ALTER TABLE core.trainers ADD CONSTRAINT trainers_hrd_tdf_needs_expiry
      CHECK (NOT hrd_tdf OR hrd_tdf_valid_to IS NOT NULL) NOT VALID;
  END IF;
END;
$tdf$;

COMMENT ON COLUMN core.trainers.hrd_tdf_valid_to IS
  'HRD-TDF accreditation expiry. 3-year validity, 360 active-training hours to '
  'renew (or the assessment route), apply at least 3 months before expiry. '
  'Mandated by Circular 6/2024 effective 1 January 2025 — NOT Circular 2/2026, '
  'which the proposal pack misattributed and the 2026-09-13 compliance refresh '
  'corrected. The boolean hrd_tdf says a trainer was accredited once; this says '
  'whether they can take a claimable class next month. 017.';

CREATE OR REPLACE VIEW core.v_trainer_accreditation
WITH (security_invoker = true) AS
  SELECT tr.id,
         tr.tenant_id,
         tr.ref,
         tr.name,
         tr.hrd_tdf,
         tr.hrd_tdf_valid_to,
         tr.ttt_valid_to,
         (tr.hrd_tdf AND tr.hrd_tdf_valid_to IS NOT NULL
            AND tr.hrd_tdf_valid_to < CURRENT_DATE)                     AS hrd_tdf_expired,
         (tr.hrd_tdf AND tr.hrd_tdf_valid_to IS NOT NULL
            AND tr.hrd_tdf_valid_to >= CURRENT_DATE
            AND tr.hrd_tdf_valid_to < CURRENT_DATE + 90)                AS hrd_tdf_expiring_soon
    FROM core.trainers AS tr;

COMMENT ON VIEW core.v_trainer_accreditation IS
  'Derived accreditation state. `expiring_soon` is the 3-month renewal window the '
  'HRD-TDF rules require applications to be filed in. Derived rather than stored '
  'because a stored flag needs a job to keep it true, and the date already carries '
  'the information. 017.';

-- ============================================================================
-- §10 · core.retrieve_knowledge — and the one setting that makes it correct
-- ============================================================================
-- ⚠ THERE IS NO RETRIEVAL RPC IN 001-016. 013 created `core.knowledge_chunks`
-- with `embedding vector(1536)` and 001 created the HNSW index over it, and
-- nothing reads either. 017 creates the function, because the finding this
-- section exists to carry is a property OF that function and cannot be recorded
-- anywhere else.
--
-- **`hnsw.iterative_scan` defaults to `off`, and under RLS that silently
-- under-returns.** From `docs/research/2026-09-13-vector-storage-decision.md`:
-- "With RLS adding a `tenant_id` predicate on top of an HNSW ANN scan, a top-k
-- retrieval will silently return fewer than k rows for any tenant that is a small
-- share of the table."
--
-- The mechanism is worth stating because the failure is invisible. An HNSW index
-- scan walks the graph and returns roughly `ef_search` candidates; the tenant
-- predicate is then applied ON TOP of those candidates. A tenant holding 2% of
-- the rows sees roughly 2% of the candidates survive the filter, so a request for
-- k=10 comes back with one row — **not an error, not a warning, just a short
-- answer that looks like "there wasn't much relevant".** Every RAG answer built
-- on it is quietly under-grounded.
--
-- pgvector 0.8.0's recovery mechanism is iterative index scans, and it is off by
-- default. `relaxed_order` lets the scan continue past the first batch until it
-- has k rows that pass the filter; `strict_order` does the same while guaranteeing
-- exact distance ordering at a higher cost. `relaxed_order` is chosen because
-- retrieval feeds a model that re-ranks anyway, and the ordering guarantee buys
-- nothing a downstream re-rank does not already provide.
--
-- **`SET LOCAL`, not `SET`**, and not a function-level `SET`: it applies for the
-- remainder of the transaction and is rolled back with it, so a pooled connection
-- cannot carry the setting into somebody else's query. `hnsw.max_scan_tuples`
-- (default 20,000) is the bound that stops `relaxed_order` from degenerating into
-- a sequential scan of the whole index for a tenant with no matches at all.

CREATE OR REPLACE FUNCTION core.retrieve_knowledge(
  p_embedding extensions.vector,
  p_k         integer DEFAULT 10,
  p_source_id uuid DEFAULT NULL
) RETURNS TABLE (
  chunk_id            uuid,
  knowledge_source_id uuid,
  seq                 integer,
  content             text,
  metadata            jsonb,
  distance            double precision
)
LANGUAGE plpgsql
-- ⚠ VOLATILE, NOT STABLE, AND NOT BY PREFERENCE. This function is a pure read and
-- STABLE is what it deserves, but `SET LOCAL` is refused inside a non-volatile
-- function — "SET is not allowed in a non-volatile function", raised at CALL time
-- rather than at CREATE time, which is why it survived the migration and was
-- caught by the pin. The setting is the entire point of the function (see below),
-- so the volatility label yields. The cost is that the planner will not fold
-- multiple calls in one query into one; retrieval is called once per request, so
-- that cost is not paid in practice.
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
BEGIN
  IF p_embedding IS NULL THEN
    RAISE EXCEPTION 'retrieve_knowledge: p_embedding is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_k IS NULL OR p_k < 1 OR p_k > 200 THEN
    RAISE EXCEPTION 'retrieve_knowledge: p_k must be between 1 and 200'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The finding this function exists to carry. Without it a tenant holding a
  -- small share of core.knowledge_chunks gets fewer than p_k rows and no error.
  SET LOCAL hnsw.iterative_scan = relaxed_order;

  RETURN QUERY
  SELECT kc.id,
         kc.knowledge_source_id,
         kc.seq,
         kc.content,
         kc.metadata,
         (kc.embedding OPERATOR(extensions.<=>) p_embedding)::double precision
    FROM core.knowledge_chunks AS kc
   WHERE kc.tenant_id = v_tenant
     AND kc.embedding IS NOT NULL
     AND (p_source_id IS NULL OR kc.knowledge_source_id = p_source_id)
   ORDER BY kc.embedding OPERATOR(extensions.<=>) p_embedding
   LIMIT p_k;
END;
$fn$;

REVOKE ALL ON FUNCTION core.retrieve_knowledge(extensions.vector,integer,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.retrieve_knowledge(extensions.vector,integer,uuid)
  TO authenticated;

COMMENT ON FUNCTION core.retrieve_knowledge(extensions.vector,integer,uuid) IS
  'Tenant-scoped HNSW retrieval. Sets hnsw.iterative_scan = relaxed_order for the '
  'transaction, because the setting defaults to `off` and a tenant predicate on '
  'top of an ANN scan then returns FEWER THAN k rows with no error — a quietly '
  'under-grounded RAG answer rather than a visible failure. SET LOCAL so a pooled '
  'connection cannot carry it into another session''s query. 017.';

-- ============================================================================
-- §11 · The three new tables take 014's posture, not a hand-written one
-- ============================================================================
-- 014's §2 loop policied the 113 tenant-scoped core tables that existed then.
-- These three arrived afterwards, and a table that reaches production with a
-- hand-written policy beside 113 generated ones is the divergence the project
-- rules forbid — and the more dangerous kind, because it looks deliberate.
--
-- `app.apply_tenant_policies` derives the global-row fallback from the column's
-- nullability, so `core.tax_policies` and `core.data_retention_policies` get the
-- `tenant_id IS NULL` half automatically (both have national rows) and
-- `core.data_breach_register` does not (its `tenant_id` is NOT NULL — a breach
-- always belongs to somebody).

SELECT app.apply_tenant_policies('core','tax_policies');
SELECT app.apply_tenant_policies('core','data_retention_policies');
SELECT app.apply_tenant_policies('core','data_breach_register');

-- And the grant layer, matching 014: SELECT only, authenticated only.
GRANT SELECT ON core.tax_policies             TO authenticated;
GRANT SELECT ON core.data_retention_policies  TO authenticated;
GRANT SELECT ON core.data_breach_register     TO authenticated;
GRANT SELECT ON core.v_tax_policy_unverified  TO authenticated;
GRANT SELECT ON core.v_trainer_accreditation  TO authenticated;
REVOKE ALL ON core.tax_policies            FROM PUBLIC, anon;
REVOKE ALL ON core.data_retention_policies FROM PUBLIC, anon;
REVOKE ALL ON core.data_breach_register    FROM PUBLIC, anon;
REVOKE ALL ON core.v_tax_policy_unverified FROM PUBLIC, anon;
REVOKE ALL ON core.v_trainer_accreditation FROM PUBLIC, anon;

-- ============================================================================
-- §12 · Verify
-- ============================================================================

DO $verify$
DECLARE
  v_bad  text;
  v_n    integer;
  v_rate numeric;
BEGIN
  -- (1) No function in core is executable by PUBLIC any more. Re-derived from
  --     the catalogue, so a tenth function created without a REVOKE fails here.
  SELECT pg_catalog.string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core'
     AND has_function_privilege('public', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '017 verify: core function(s) still executable by PUBLIC: %. 001 measured '
      'that ALTER DEFAULT PRIVILEGES does not take, so a per-object REVOKE is the '
      'only guard.', v_bad;
  END IF;

  -- (2) R-JSONB: no jsonb column in core or app lacks a CHECK naming it.
  SELECT pg_catalog.string_agg(pg_catalog.format('%s.%s', c.relname, a.attname), ', ')
    INTO v_bad
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_class     AS c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('core','app') AND c.relkind = 'r'
     AND NOT a.attisdropped AND a.attnum > 0
     AND a.atttypid = 'jsonb'::regtype
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                      WHERE k.conrelid = c.oid AND k.contype = 'c'
                        AND a.attnum = ANY (k.conkey));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '017 verify: jsonb column(s) with no CHECK (R-JSONB): %', v_bad;
  END IF;

  -- (3) The two precisions.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='core' AND table_name='quotations'
                    AND column_name='margin_rate'
                    AND numeric_precision=6 AND numeric_scale=4) THEN
    RAISE EXCEPTION '017 verify: core.quotations.margin_rate is not numeric(6,4)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='core' AND table_name='evaluation_responses'
                    AND column_name='overall_score'
                    AND numeric_precision=4 AND numeric_scale=3) THEN
    RAISE EXCEPTION '017 verify: core.evaluation_responses.overall_score is not numeric(4,3)';
  END IF;

  -- (4) Both tax policies exist, neither is ACTIVE without a verifier, and the
  --     default position is the TAXABLE one. That last clause is the research's
  --     actual finding and the one most likely to be reversed by accident.
  SELECT pg_catalog.count(*) INTO v_n FROM core.tax_policies WHERE tenant_id IS NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION '017 verify: expected 2 national tax policies, found %', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.tax_policies
                  WHERE policy_code='SST-G-TRAINING-8' AND rate_bps=800
                    AND NOT exempt AND is_default) THEN
    RAISE EXCEPTION
      '017 verify: the Group G 8%% taxable policy is missing or is not the default. '
      'The research finding is that corporate training is TAXABLE and exemption is '
      'the exception that must be justified.';
  END IF;
  IF EXISTS (SELECT 1 FROM core.tax_policies
              WHERE status='ACTIVE' AND verified_by_user_id IS NULL) THEN
    RAISE EXCEPTION '017 verify: a tax policy is ACTIVE with no named verifier';
  END IF;

  -- (5) The resolver returns the taxable default for corporate training, and it
  --     returns 0.08 rather than 800 — the units conversion is the thing that
  --     would be wrong by a factor of 10,000 and still look plausible.
  SELECT r.rate INTO v_rate
    FROM app.resolve_tax_policy(
           '00000000-0000-0000-0000-000000000000'::uuid,
           'CORPORATE_TRAINING', DATE '2026-09-13') AS r;
  IF v_rate IS DISTINCT FROM 0.08000 THEN
    RAISE EXCEPTION
      '017 verify: resolve_tax_policy returned rate % for CORPORATE_TRAINING, '
      'expected 0.08000. Basis points are stored; a rate is returned.', v_rate;
  END IF;

  -- (6) The three new tables carry 014's posture rather than a hand-written one.
  FOREACH v_bad IN ARRAY ARRAY['tax_policies','data_retention_policies','data_breach_register']
  LOOP
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy AS p
         WHERE p.polrelid = pg_catalog.to_regclass('core.' || v_bad)
           AND p.polname IN (v_bad || '_tenant_select', v_bad || '_tenant_isolation')) <> 2
    THEN
      RAISE EXCEPTION
        '017 verify: core.% does not carry 014''s two-policy posture. A table with '
        'a hand-written policy beside 113 generated ones is the divergence the '
        'project rules forbid, and it looks deliberate.', v_bad;
    END IF;
  END LOOP;

  -- (7) The retrieval RPC really carries the setting. Asserted on the function
  --     body, because a later edit that dropped the line would leave a function
  --     that still returns rows — just fewer of them, with no error.
  IF pg_catalog.strpos(
       pg_catalog.regexp_replace(
         pg_catalog.pg_get_functiondef(
           'core.retrieve_knowledge(extensions.vector,integer,uuid)'::regprocedure),
         '\s+','','g'),
       'SETLOCALhnsw.iterative_scan=relaxed_order') = 0
  THEN
    RAISE EXCEPTION
      '017 verify: core.retrieve_knowledge does not set hnsw.iterative_scan. '
      'Without it a tenant holding a small share of core.knowledge_chunks gets '
      'fewer than k rows and no error at all.';
  END IF;

  -- (8) The three HRD Corp rules landed and all of them are PROPOSED.
  SELECT pg_catalog.count(*) INTO v_n
    FROM core.compliance_rules
   WHERE rule_code IN ('HRD-QUERY-5D','HRD-007','HRD-009');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '017 verify: expected 3 HRD Corp deadline rules, found %', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM core.compliance_rules
              WHERE rule_code IN ('HRD-QUERY-5D','HRD-007','HRD-009')
                AND status <> 'PROPOSED') THEN
    RAISE EXCEPTION
      '017 verify: an HRD Corp rule was seeded at a status other than PROPOSED. '
      'The compliance research is explicit: none should be inserted ACTIVE from '
      'the document alone.';
  END IF;

  RAISE NOTICE
    '017 verify: OK - 0 PUBLIC-executable core functions, 0 unconstrained jsonb '
    'columns, both precisions corrected, 2 tax policies (taxable default), 3 HRD '
    'Corp rules at PROPOSED, and the retrieval RPC carries hnsw.iterative_scan';
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
