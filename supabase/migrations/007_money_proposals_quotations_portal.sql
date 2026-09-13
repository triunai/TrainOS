-- ============================================================================
-- Migration 007: money — rate cards, provenance, proposals, quotations with
-- generated floors and reconciliation, and the client portal's share tokens.
-- ============================================================================
--
-- FEATURE. The priced half of the product, and the only migration in this set
-- where an arithmetic mistake becomes an invoice a customer disputes.
--
-- THE MONEY RULES, AND WHERE EACH ONE IS ENFORCED (DECISIONS §7, doc 04)
--
--   Integer sen, `bigint`, suffix `_sen`. Never `numeric`, never `float`. The
--   verify block at the foot of this file asserts, off the catalogue, that no
--   column anywhere in `core` whose name ends `_sen` has type `real` or
--   `double precision`. A catalogue query cannot rot the way a code review can.
--
--   TOTAL-FROM-LINES, ALWAYS. Each line is `unit_price_sen x qty` rounded
--   half-up through `app.round_half_up_sen`, and the header sums the ROUNDED
--   lines. `quotations.sell_price_sen` and `direct_cost_sen` are maintained by
--   a DEFERRABLE CONSTRAINT TRIGGER that recomputes them from the lines and
--   refuses to commit a header that disagrees. Deferrable matters: a multi-line
--   edit passes through intermediate states where the header and the lines
--   genuinely do not match, and a non-deferred trigger would reject a perfectly
--   correct transaction halfway through it.
--
--   THE FLOOR IS GENERATED, AND THERE ARE TWO OF THEM. `programme_floor_price_sen`
--   is the absolute commercial-policy figure stamped from the programme tier at
--   pricing time. `margin_floor_price_sen` is derived from cost and the margin
--   floor. The BINDING floor is the greater, and `below_floor` and
--   `binding_floor_basis` are generated from the row. Generated, not stored,
--   because the costing screen and the approval screen must not be able to
--   compute it differently — that disagreement is the whole failure mode.
--   ⚠ `ceil`, not `round`, on the margin floor: rounding it down would let a
--   price one sen under the floor pass as compliant.
--
--   `floor_margin_rate` AND `commission_rate` ARE STAMPED, NOT READ THROUGH.
--   Copied onto the quotation at pricing time rather than joined to the rate
--   card, so the floor is reproducible from the row alone after the card is
--   retired — and so a rate-card edit cannot silently reprice a quotation that
--   has already been sent to a client.
--
-- THE JSONB NULL-CHECK TRAP, and why every jsonb CHECK here is written the long
-- way. Doc 04 §4.3 states it: `CHECK (jury IS NULL OR jury->>'mode' IN (...))`
-- is WRONG, because when `mode` is absent `jury->>'mode'` is NULL, `NULL IN
-- (...)` is NULL, and a CHECK that evaluates to NULL PASSES. Every jsonb check
-- in this migration therefore tests `?` for key presence FIRST and only then
-- tests the value. T7 proves it on the exact payload the naive form lets past.
--
-- ⚠ SCHEMA. Doc 04 qualifies every object `app.` and makes no schema statement.
-- Doc 03 §1 — which outranks it — uses `core.quotations`, `core.invoices` and
-- `core.compliance_rules` throughout its own executable SQL, and doc 05
-- resolved the same question to `core` against migration 001. So these are
-- `core` tables with `app` helpers, and doc 04's `app.quotation` is what doc 01
-- calls it: "a verification harness, not a competing table". Conflict C1.
--
-- ⚠ SINGULAR. Doc 04 is singular throughout (`app.invoice`, `app.rate_card`).
-- Doc 05 resolved to plural citing migration 001's conflict note, doc 03 uses
-- plural, and doc 01 is plural. Pluralised here. Conflict C5.
--
-- SPINE: untouched. `quotations.discount_approval_id` points AT the action
-- envelope; nothing here modifies it. The FK is deferred to 011.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   No client-callable RPC. All tables RLS enabled and FORCED, zero policies,
--   until 014. `core.public_share_tokens` stores only a SHA-256 hash: the token
--   itself is never written, so a database dump does not hand anyone a live
--   client link.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1/2. No RPC, no envelope. 3. RpcMap: none. 4. Call sites: 010 invoices from
--   these, 011 gates them, 016 seeds. 5. Casts: the generated columns cast
--   `bigint` to `numeric` before dividing, which is deliberate and is the only
--   place integer division would silently truncate. 6. Reload/restore: none.
--   7. Public routes: the portal's read path reaches `public_share_tokens` in
--   014 through a SECURITY DEFINER RPC, never through a policy on the table.
--
-- Rollback: rollbacks/007_money_proposals_quotations_portal_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ 1 · Money domains ══════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE DOMAIN core.currency_code AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE DOMAIN core.rate AS numeric(6,5) CHECK (VALUE >= 0 AND VALUE <= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON DOMAIN core.rate IS
  'A proportion in [0,1] at five decimal places. A domain rather than a bare '
  'numeric so the range check cannot be forgotten on the next column that needs it.';

-- ═══ 2 · Provenance ═════════════════════════════════════════════════════════
-- Doc 04 §4.1. The allowlist table exists so `subject_table` cannot name a
-- relation that does not exist: a polymorphic pointer with no referent is an
-- orphan class nobody reconciles.

CREATE TABLE IF NOT EXISTS core.provenance_subjects (
  subject_table text PRIMARY KEY,
  note          text
);
REVOKE ALL ON TABLE core.provenance_subjects FROM PUBLIC, anon, authenticated;

-- RLS enabled AND FORCED. This was the third and last table in the pack with
-- neither, and it is in `core`, which config.toml EXPOSES to PostgREST - so an
-- unguarded table here is reachable from a browser, not merely untidy. It is not
-- put through app.finalise_table because it is deliberately global: an allowlist
-- of nine table names, no tenant_id, no id, no ref, and finalise_table's whole
-- contract is a tenant-scoped table.
--
-- NO POLICY, and unlike app.role_permissions that costs nothing here, which is
-- worth stating so the next author does not "fix" it by adding one. Nothing in
-- SQL reads this table: its only consumer is the foreign key on
-- core.provenance.subject_table, and PostgreSQL performs referential integrity
-- checks with row security bypassed by design. Deny-all is therefore the correct
-- terminal state, not a gap for 014 to fill.
ALTER TABLE core.provenance_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.provenance_subjects FORCE  ROW LEVEL SECURITY;

INSERT INTO core.provenance_subjects (subject_table, note) VALUES
  ('enquiries',                 'classification'),
  ('enquiry_extraction_fields', 'one row per extracted field'),
  ('tna_gaps',                  'identified gaps'),
  ('tna_recommendations',       'programme ranking'),
  ('proposal_sections',         'generated section bodies'),
  ('organisation_suggestions',  'cross-sell panel'),
  ('outbound_messages',         'drafted follow-ups and reminders'),
  ('compliance_rules',          'rules extracted from a circular'),
  ('compliance_check_results',  'interpreted checks')
ON CONFLICT (subject_table) DO NOTHING;

CREATE TABLE IF NOT EXISTS core.provenance (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  subject_table  text           NOT NULL REFERENCES core.provenance_subjects(subject_table),
  subject_id     uuid           NOT NULL,
  field          text,
  origin         core.provenance_origin NOT NULL,
  confidence     numeric(4,3)   CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  tier           text,
  model          text,
  provider       core.ai_provider,
  cache_hit_rate numeric(4,3)   CHECK (cache_hit_rate IS NULL OR cache_hit_rate BETWEEN 0 AND 1),
  agent_id       text,
  run_id         uuid,
  generated_at   timestamptz,
  edited_by      uuid           REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_by_name text,
  edited_at      timestamptz,
  reviewed_by    uuid           REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  needs_review   boolean        NOT NULL DEFAULT false,
  sources        jsonb          NOT NULL DEFAULT '[]'::jsonb,
  jury           jsonb,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'SYSTEM',
  created_by_id   text          NOT NULL DEFAULT 'system',
  created_by_name text,
  -- A model-authored value with no model and no timestamp cannot be explained
  -- to the client who asks where a number came from.
  CONSTRAINT provenance_ai_needs_model
    CHECK (origin NOT IN ('AI_GENERATED','AI_EXECUTED')
           OR (model IS NOT NULL AND generated_at IS NOT NULL)),
  -- and the reverse: a human-authored value that claims a model is a lie.
  CONSTRAINT provenance_human_has_no_model
    CHECK (origin <> 'HUMAN' OR (model IS NULL AND run_id IS NULL)),
  CONSTRAINT provenance_sources_is_array CHECK (jsonb_typeof(sources) = 'array'),
  -- ⚠ THE NULL-CHECK TRAP. Key presence is tested with `?` BEFORE any value is
  -- read. The naive spelling — jury IS NULL OR jury->>'mode' IN (...) — passes
  -- a jury object with no `mode` at all, because ->> yields NULL, NULL IN (...)
  -- yields NULL, and a CHECK that evaluates to NULL is satisfied.
  CONSTRAINT provenance_jury_well_formed CHECK (
    jury IS NULL OR (
          jury ? 'mode' AND jury ? 'quorum' AND jury ? 'of'
      AND jury ->> 'mode' IN ('GATE','SAMPLE','ESCALATE')
      AND jsonb_typeof(jury -> 'quorum') = 'number'
      AND jsonb_typeof(jury -> 'of') = 'number'
      AND (jury ->> 'quorum')::int >= 1
      AND (jury ->> 'quorum')::int <= (jury ->> 'of')::int
      AND (jury ->> 'mode' <> 'SAMPLE'
           OR (jury ? 'sampleRate'
               AND (jury ->> 'sampleRate')::numeric > 0
               AND (jury ->> 'sampleRate')::numeric <= 1))
      AND (jury ->> 'mode' <> 'ESCALATE' OR jury ? 'triggers')
    ))
);

-- Doc 04 notes that `unique (subject_table, subject_id, field)` does NOT dedupe
-- the record-level case, because two NULL fields do not conflict. Two partial
-- indexes, so both cases are actually unique.
CREATE UNIQUE INDEX IF NOT EXISTS provenance_field_uq
  ON core.provenance (tenant_id, subject_table, subject_id, field) WHERE field IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS provenance_record_uq
  ON core.provenance (tenant_id, subject_table, subject_id) WHERE field IS NULL;
CREATE INDEX IF NOT EXISTS provenance_run_idx
  ON core.provenance (tenant_id, run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provenance_review_queue_idx
  ON core.provenance (tenant_id, generated_at DESC)
  WHERE origin IN ('AI_GENERATED','AI_SUGGESTED','AI_EXECUTED') AND reviewed_at IS NULL;

SELECT app.finalise_table('core','provenance',false,NULL,ARRAY['subject_table','subject_id','field','origin']);

-- ═══ 3 · Rate cards ═════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE core.rate_card_status AS ENUM ('PLACEHOLDER','DRAFT','ACTIVE','RETIRED');
  COMMENT ON TYPE core.rate_card_status IS
    'Declared by 007, NOT generated from packages/contract/src/enums.ts - the '
    'contract has no rate-card lifecycle. PLACEHOLDER is 007''s own value and is '
    'what core.quotation_block_placeholder() refuses to price against.';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS core.rate_cards (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  version        text           NOT NULL,
  currency       core.currency_code NOT NULL DEFAULT 'MYR',
  status         core.rate_card_status NOT NULL DEFAULT 'DRAFT',
  effective_from date           NOT NULL,
  effective_to   date,
  validity       daterange      GENERATED ALWAYS AS
                   (daterange(effective_from, effective_to, '[)')) STORED,
  is_placeholder boolean        GENERATED ALWAYS AS (status = 'PLACEHOLDER') STORED,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text          NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, version),
  CONSTRAINT rate_cards_dates_ordered CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- At most one card in force at a time. Two overlapping ACTIVE cards means the
  -- answer to "what is the band A day rate on 12 November" depends on which row
  -- the query happened to read first.
  CONSTRAINT rate_cards_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, validity WITH &&
  ) WHERE (status IN ('PLACEHOLDER','ACTIVE'))
);

COMMENT ON COLUMN core.rate_cards.version IS
  'The API''s rateCardVersion string. DECISIONS §5 says the launch value is '
  '"v0-placeholder" until Finance supplies numbers, and the costing screen renders '
  'that label so nobody quotes from an empty card. Frozen after insert, so the '
  'label cannot drift under a quotation that was priced against it.';

SELECT app.finalise_table('core','rate_cards',false,NULL,ARRAY['version','effective_from']);

-- The eight component tables. Each is (rate_card_id, key) -> value.
CREATE TABLE IF NOT EXISTS core.rate_card_trainer_days (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rate_card_id  uuid NOT NULL,
  band          core.trainer_band NOT NULL,
  trainer_id    uuid,
  day_rate_sen  bigint NOT NULL CHECK (day_rate_sen >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rctd_card_fk FOREIGN KEY (tenant_id, rate_card_id)
    REFERENCES core.rate_cards (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT rctd_trainer_fk FOREIGN KEY (tenant_id, trainer_id)
    REFERENCES core.trainers (tenant_id, id) ON DELETE CASCADE
);
-- Exactly one band rate per card, plus any number of per-trainer overrides.
CREATE UNIQUE INDEX IF NOT EXISTS rctd_band_default_uq
  ON core.rate_card_trainer_days (tenant_id, rate_card_id, band) WHERE trainer_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rctd_trainer_override_uq
  ON core.rate_card_trainer_days (tenant_id, rate_card_id, trainer_id) WHERE trainer_id IS NOT NULL;
SELECT app.finalise_table('core','rate_card_trainer_days',false,NULL,ARRAY['rate_card_id','band']);

CREATE TABLE IF NOT EXISTS core.rate_card_materials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rate_card_id   uuid NOT NULL,
  programme_type text NOT NULL,
  per_pax_sen    bigint NOT NULL CHECK (per_pax_sen >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rate_card_id, programme_type),
  CONSTRAINT rcm_card_fk FOREIGN KEY (tenant_id, rate_card_id)
    REFERENCES core.rate_cards (tenant_id, id) ON DELETE CASCADE
);
SELECT app.finalise_table('core','rate_card_materials',false,NULL,ARRAY['rate_card_id','programme_type']);

CREATE TABLE IF NOT EXISTS core.rate_card_venues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rate_card_id uuid NOT NULL,
  mode         core.venue_mode NOT NULL,
  day_rate_sen bigint CHECK (day_rate_sen IS NULL OR day_rate_sen >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rate_card_id, mode),
  CONSTRAINT rcv_card_fk FOREIGN KEY (tenant_id, rate_card_id)
    REFERENCES core.rate_cards (tenant_id, id) ON DELETE CASCADE,
  -- Training at the client's own site costs the client nothing for venue.
  -- Charging for it is the modelling error DECISIONS §5 names.
  CONSTRAINT rcv_client_site_is_free CHECK (mode <> 'CLIENT_SITE' OR day_rate_sen = 0)
);
COMMENT ON COLUMN core.rate_card_venues.day_rate_sen IS
  'NULL means "quote per engagement" (DECISIONS §5, external venues). Not zero - '
  'zero is a real price and would sum into a total as a free venue.';
SELECT app.finalise_table('core','rate_card_venues',false,NULL,ARRAY['rate_card_id','mode']);

CREATE TABLE IF NOT EXISTS core.rate_card_travel (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rate_card_id  uuid NOT NULL,
  region        core.travel_region NOT NULL,
  per_trip_sen  bigint NOT NULL CHECK (per_trip_sen >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rate_card_id, region),
  CONSTRAINT rct_card_fk FOREIGN KEY (tenant_id, rate_card_id)
    REFERENCES core.rate_cards (tenant_id, id) ON DELETE CASCADE
);
SELECT app.finalise_table('core','rate_card_travel',false,NULL,ARRAY['rate_card_id','region']);

CREATE TABLE IF NOT EXISTS core.rate_card_meals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rate_card_id     uuid NOT NULL,
  programme_type   text NOT NULL,
  per_pax_sen      bigint NOT NULL CHECK (per_pax_sen >= 0),
  acm_ceiling_sen  bigint NOT NULL CHECK (acm_ceiling_sen >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rate_card_id, programme_type),
  CONSTRAINT rcme_card_fk FOREIGN KEY (tenant_id, rate_card_id)
    REFERENCES core.rate_cards (tenant_id, id) ON DELETE CASCADE,
  -- HRD Corp's Allowable Cost Matrix caps the claimable meal rate. A card that
  -- prices meals above its own ceiling produces a claim that is rejected after
  -- the training has already been delivered.
  CONSTRAINT rcme_within_acm_ceiling CHECK (per_pax_sen <= acm_ceiling_sen)
);
SELECT app.finalise_table('core','rate_card_meals',false,NULL,ARRAY['rate_card_id','programme_type']);

CREATE TABLE IF NOT EXISTS core.rate_card_commissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rate_card_id uuid NOT NULL,
  role         app.app_role NOT NULL,
  band         int8range NOT NULL,
  pct          core.rate NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rcc_card_fk FOREIGN KEY (tenant_id, rate_card_id)
    REFERENCES core.rate_cards (tenant_id, id) ON DELETE CASCADE,
  -- Deal bands may not overlap within a role, or the commission on a given deal
  -- size depends on which row is read first.
  CONSTRAINT rcc_no_band_overlap EXCLUDE USING gist (
    tenant_id WITH =, rate_card_id WITH =, role WITH =, band WITH &&
  )
);
SELECT app.finalise_table('core','rate_card_commissions',false,NULL,ARRAY['rate_card_id','role']);

CREATE TABLE IF NOT EXISTS core.rate_card_margin_floors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rate_card_id   uuid NOT NULL,
  programme_type text NOT NULL,
  floor_pct      core.rate NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rate_card_id, programme_type),
  CONSTRAINT rcmf_card_fk FOREIGN KEY (tenant_id, rate_card_id)
    REFERENCES core.rate_cards (tenant_id, id) ON DELETE CASCADE
);
SELECT app.finalise_table('core','rate_card_margin_floors',false,NULL,ARRAY['rate_card_id','programme_type']);

CREATE TABLE IF NOT EXISTS core.rate_card_discount_authorities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rate_card_id uuid NOT NULL,
  role         app.app_role NOT NULL,
  max_pct      core.rate NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rate_card_id, role),
  CONSTRAINT rcda_card_fk FOREIGN KEY (tenant_id, rate_card_id)
    REFERENCES core.rate_cards (tenant_id, id) ON DELETE CASCADE
);
SELECT app.finalise_table('core','rate_card_discount_authorities',false,NULL,ARRAY['rate_card_id','role']);

-- ═══ 4 · Proposals ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.proposals (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref             text,
  opportunity_id  uuid           NOT NULL,
  organisation_id uuid           NOT NULL,
  template_id     uuid           NOT NULL,
  programme_id    uuid,
  run_id          uuid,          -- FK added by 013, which creates core.runs
  status          core.proposal_status NOT NULL DEFAULT 'DRAFT',
  value_sen       bigint         CHECK (value_sen IS NULL OR value_sen >= 0),
  currency        core.currency_code NOT NULL DEFAULT 'MYR',
  margin_rate     numeric(6,4),
  sent_at         timestamptz,
  first_viewed_at timestamptz,
  accepted_at     timestamptz,
  lost_at         timestamptz,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id   text           NOT NULL DEFAULT 'agent_proposal',
  created_by_name text,
  CONSTRAINT proposals_opportunity_fk FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES core.opportunities (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT proposals_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT proposals_template_fk FOREIGN KEY (tenant_id, template_id)
    REFERENCES core.templates (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT proposals_programme_fk FOREIGN KEY (tenant_id, programme_id)
    REFERENCES core.programmes (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT proposals_sent_needs_timestamp CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
);

COMMENT ON COLUMN core.proposals.organisation_id IS
  'Denormalised from the opportunity SO THE POLICY GATE''S firstProposalToOrg probe '
  'is one index hit and not a join (doc 03 decision 7). Unlike organisations.'
  'proposal_count, this one IS a gate input - it is an immutable foreign key, not a '
  'running total, so it cannot go stale.';

CREATE INDEX IF NOT EXISTS proposals_opportunity_idx ON core.proposals (tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS proposals_status_idx      ON core.proposals (tenant_id, status, updated_at DESC);
-- The partial index doc 03 §2.3 prescribes for the live firstProposalToOrg probe.
CREATE INDEX IF NOT EXISTS proposals_org_sent
  ON core.proposals (tenant_id, organisation_id)
  WHERE status IN ('SENT','VIEWED','ACCEPTED','LOST');

SELECT app.finalise_table('core','proposals',true,'PRO',
  ARRAY['opportunity_id','organisation_id']);

CREATE TABLE IF NOT EXISTS core.proposal_sections (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  proposal_id       uuid           NOT NULL,
  n                 smallint       NOT NULL CHECK (n >= 1),
  title             text           NOT NULL,
  body              text,
  merge_fields_used text[],
  needs_review      boolean        NOT NULL DEFAULT false,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  created_by_kind   app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id     text           NOT NULL DEFAULT 'agent_proposal',
  created_by_name   text,
  UNIQUE (tenant_id, proposal_id, n),
  CONSTRAINT proposal_sections_proposal_fk FOREIGN KEY (tenant_id, proposal_id)
    REFERENCES core.proposals (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.proposal_sections IS
  'The contract''s warnings[] is NOT a table. LOW_CONFIDENCE_SECTION is a view over '
  'provenance.confidence below a threshold, so a warning can never disagree with the '
  'confidence that produced it.';

SELECT app.finalise_table('core','proposal_sections',false,NULL,ARRAY['proposal_id','n']);

-- A SENT proposal freezes. §4 of doc 01: template, value and every section body.
-- A trigger rather than a CHECK, because the rule spans two tables.
CREATE OR REPLACE FUNCTION core.freeze_sent_proposal_sections()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE v_status core.proposal_status;
BEGIN
  SELECT status INTO v_status FROM core.proposals
  WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
    AND id = COALESCE(NEW.proposal_id, OLD.proposal_id);

  IF v_status IN ('SENT','VIEWED','ACCEPTED','LOST') THEN
    RAISE EXCEPTION
      'PROPOSAL_SENT: section % of a % proposal cannot be changed. The client has '
      'already seen it; a revision is a new proposal.',
      COALESCE(NEW.n, OLD.n), v_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_proposal_sections_freeze ON core.proposal_sections;
CREATE TRIGGER trg_proposal_sections_freeze
  BEFORE UPDATE OR DELETE ON core.proposal_sections
  FOR EACH ROW EXECUTE FUNCTION core.freeze_sent_proposal_sections();

-- ═══ 5 · The client portal ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.public_share_tokens (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  target_kind      text        NOT NULL CHECK (target_kind IN ('PROPOSAL','TNA')),
  proposal_id      uuid,
  tna_id           uuid,
  token_hash       bytea       NOT NULL,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at       timestamptz,
  last_accessed_at timestamptz,
  access_count     integer     NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by_kind  app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id    text        NOT NULL DEFAULT 'system',
  created_by_name  text,
  CONSTRAINT pst_proposal_fk FOREIGN KEY (tenant_id, proposal_id)
    REFERENCES core.proposals (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT pst_tna_fk FOREIGN KEY (tenant_id, tna_id)
    REFERENCES core.tnas (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT pst_exactly_one_target CHECK (num_nonnulls(proposal_id, tna_id) = 1),
  -- and the target must be the kind it says it is
  CONSTRAINT pst_kind_matches_target CHECK (
    (target_kind = 'PROPOSAL' AND proposal_id IS NOT NULL)
    OR (target_kind = 'TNA' AND tna_id IS NOT NULL))
);

COMMENT ON TABLE core.public_share_tokens IS
  'ONE table for both the client proposal page and the TNA questionnaire link - the '
  'name sb-tenancy''s RLS already targets. The TOKEN IS NEVER STORED: only its '
  'SHA-256 hash, so a database dump does not hand anyone a live client link.';
-- GLOBAL, not per tenant. The token is the ONLY thing an unauthenticated caller
-- presents, so it must RESOLVE the tenant rather than assume one. A per-tenant
-- unique would permit the same hash in two tenants and make resolution ambiguous.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conname = 'public_share_tokens_token_hash_key') THEN
    ALTER TABLE core.public_share_tokens
      ADD CONSTRAINT public_share_tokens_token_hash_key UNIQUE (token_hash);
  END IF;
END $$;

COMMENT ON CONSTRAINT public_share_tokens_token_hash_key ON core.public_share_tokens IS
  'GLOBAL, not per tenant: the token is the only thing an unauthenticated caller '
  'presents, so it must resolve the tenant rather than assume one.';

CREATE INDEX IF NOT EXISTS pst_live_idx
  ON core.public_share_tokens (tenant_id, proposal_id) WHERE revoked_at IS NULL;

SELECT app.finalise_table('core','public_share_tokens',false,NULL,
  ARRAY['target_kind','proposal_id','tna_id','token_hash','issued_at']);

CREATE TABLE IF NOT EXISTS core.portal_comments (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  proposal_id     uuid           NOT NULL,
  contact_id      uuid,
  author_name     text           NOT NULL,
  author_kind     app.actor_kind NOT NULL,
  body            text           NOT NULL,
  posted_at       timestamptz    NOT NULL DEFAULT now(),
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'CLIENT',
  created_by_id   text           NOT NULL DEFAULT 'portal',
  created_by_name text,
  CONSTRAINT pc_proposal_fk FOREIGN KEY (tenant_id, proposal_id)
    REFERENCES core.proposals (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT pc_contact_fk FOREIGN KEY (tenant_id, contact_id)
    REFERENCES core.contacts (tenant_id, id) ON DELETE SET NULL
);
COMMENT ON COLUMN core.portal_comments.author_name IS
  'FROZEN AT WRITE TIME even when contact_id is set. The client page is a legal '
  'record of what the client saw; renaming a contact afterwards must not rewrite the '
  'name under a comment they posted.';
SELECT app.finalise_table('core','portal_comments',false,NULL,
  ARRAY['proposal_id','author_name','author_kind','body','posted_at']);

CREATE TABLE IF NOT EXISTS core.portal_acceptances (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  proposal_id      uuid           NOT NULL,
  accepted_by_name text           NOT NULL,
  accepted_by_role text,
  accepted_at      timestamptz    NOT NULL DEFAULT now(),
  signature_id     uuid,
  engagement_id    uuid,          -- FK added by 008
  share_token_id   uuid,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),
  created_by_kind  app.actor_kind NOT NULL DEFAULT 'CLIENT',
  created_by_id    text           NOT NULL DEFAULT 'portal',
  created_by_name  text,
  UNIQUE (tenant_id, proposal_id),
  CONSTRAINT pa_proposal_fk FOREIGN KEY (tenant_id, proposal_id)
    REFERENCES core.proposals (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT pa_signature_fk FOREIGN KEY (tenant_id, signature_id)
    REFERENCES core.signatures (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT pa_token_fk FOREIGN KEY (tenant_id, share_token_id)
    REFERENCES core.public_share_tokens (tenant_id, id) ON DELETE SET NULL
);
COMMENT ON TABLE core.portal_acceptances IS
  'ONE row per proposal, enforced by UNIQUE (tenant_id, proposal_id). That is the '
  'contract''s "a second accept returns the original acceptance" implemented at the '
  'STORAGE layer rather than in application code, so a double-clicked Accept button '
  'cannot create a second binding acceptance whatever the handler does.';
SELECT app.finalise_table('core','portal_acceptances',false,NULL,
  ARRAY['proposal_id','accepted_by_name','accepted_at','signature_id']);


-- ═══ 6 · Quotations ═════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.quotations (
  id                        uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                       text,
  proposal_id               uuid           NOT NULL,
  supersedes_quotation_id   uuid,
  version                   smallint       NOT NULL DEFAULT 1 CHECK (version >= 1),
  rate_card_id              uuid           NOT NULL,
  pax                       smallint       NOT NULL CHECK (pax > 0),
  sell_price_sen            bigint         NOT NULL DEFAULT 0 CHECK (sell_price_sen >= 0),
  direct_cost_sen           bigint         NOT NULL DEFAULT 0 CHECK (direct_cost_sen >= 0),
  currency                  core.currency_code NOT NULL DEFAULT 'MYR',
  programme_floor_price_sen bigint         NOT NULL DEFAULT 0 CHECK (programme_floor_price_sen >= 0),
  floor_margin_rate         numeric(6,4)   NOT NULL DEFAULT 0
                            CHECK (floor_margin_rate >= 0 AND floor_margin_rate < 1),
  commission_rate           numeric(6,4)   CHECK (commission_rate IS NULL OR commission_rate BETWEEN 0 AND 1),
  commission_payable_on     text           CHECK (commission_payable_on IS NULL
                                                  OR commission_payable_on IN ('COLLECTION','INVOICE')),
  discount_approval_id      uuid,          -- FK added by 011 (app.action_requests)
  invoice_id                uuid,          -- FK added by 010; sb-money puts the edge on THIS side
  status                    text           NOT NULL DEFAULT 'DRAFT'
                            CHECK (status IN ('DRAFT','APPLIED','SUPERSEDED')),

  -- ── Generated money. All of it, deliberately. ────────────────────────────
  margin_sen  bigint GENERATED ALWAYS AS (sell_price_sen - direct_cost_sen) STORED,
  margin_rate numeric GENERATED ALWAYS AS
    ((sell_price_sen - direct_cost_sen)::numeric / nullif(sell_price_sen, 0)) STORED,

  -- ⚠ ceil, NOT round. Rounding the margin floor DOWN would let a price one sen
  -- under the floor pass as compliant, and "one sen under" is exactly the shape
  -- a deliberate underprice takes.
  margin_floor_price_sen bigint GENERATED ALWAYS AS
    (ceil(direct_cost_sen::numeric / nullif(1 - floor_margin_rate, 0))::bigint) STORED,

  -- Two independent floors; the BINDING one is the greater.
  floor_price_sen bigint GENERATED ALWAYS AS
    (greatest(programme_floor_price_sen,
              ceil(direct_cost_sen::numeric / nullif(1 - floor_margin_rate, 0))::bigint)) STORED,

  binding_floor_basis text GENERATED ALWAYS AS
    (CASE WHEN programme_floor_price_sen >=
               ceil(direct_cost_sen::numeric / nullif(1 - floor_margin_rate, 0))::bigint
          THEN 'PROGRAMME' ELSE 'MARGIN' END) STORED,

  below_floor boolean GENERATED ALWAYS AS
    (sell_price_sen < greatest(programme_floor_price_sen,
              ceil(direct_cost_sen::numeric / nullif(1 - floor_margin_rate, 0))::bigint)) STORED,

  commission_sen bigint GENERATED ALWAYS AS
    (app.round_half_up_sen(sell_price_sen::numeric * COALESCE(commission_rate, 0))) STORED,

  -- Display only. DECISIONS §7: a per-pax figure is never a line.
  display_per_pax_sen bigint GENERATED ALWAYS AS
    (app.round_half_up_sen(sell_price_sen::numeric / nullif(pax, 0))) STORED,

  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,

  UNIQUE (tenant_id, proposal_id, version),
  CONSTRAINT quotations_proposal_fk FOREIGN KEY (tenant_id, proposal_id)
    REFERENCES core.proposals (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT quotations_rate_card_fk FOREIGN KEY (tenant_id, rate_card_id)
    REFERENCES core.rate_cards (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT quotations_myr_only CHECK (currency = 'MYR'),

  -- ⚠ THE FLOOR RULE IS NOT A CHECK CONSTRAINT, AND THAT IS A CORRECTION.
  -- Doc 04 §1.7 writes `floor_price_needs_approval` as a table CHECK. Executed,
  -- that makes a quotation impossible to CREATE: in a total-from-lines model the
  -- header starts at sell_price_sen = 0 and is filled by the line trigger, so an
  -- immediate CHECK fires against a zero sell price and a non-zero programme
  -- floor before a single line can be written. The very first attempt to insert
  -- the contract's own fixture failed on it.
  --
  -- The rule is real and is enforced below by a DEFERRABLE CONSTRAINT TRIGGER,
  -- which judges the floor at COMMIT - the only moment at which the lines, and
  -- therefore the price, actually exist. Same rule, correct instant.
  CONSTRAINT quotations_status_valid CHECK (status IN ('DRAFT','APPLIED','SUPERSEDED'))
);

COMMENT ON COLUMN core.quotations.floor_margin_rate IS
  'STAMPED onto the quotation at pricing time from the rate card, not read through '
  'to it. Two consequences, both intended: the floor stays reproducible from this '
  'row alone after the card is retired, and editing a rate card cannot silently '
  'reprice a quotation that has already gone to a client.';
COMMENT ON COLUMN core.quotations.binding_floor_basis IS
  'Which of the two floors actually binds. GENERATED rather than a column this lane '
  'maintains, so the costing screen and the approval screen cannot compute it '
  'differently - that disagreement is the entire failure mode.';
COMMENT ON COLUMN core.quotations.display_per_pax_sen IS
  'DISPLAY ONLY. DECISIONS §7: RM 18,500 for 30 pax is a PACKAGE price - one line at '
  'qty 1 - and 18,500 / 30 = 616.67 is informational. A per-pax figure that does not '
  'multiply cleanly must never become a line.';

CREATE UNIQUE INDEX IF NOT EXISTS quotations_one_applied_uq
  ON core.quotations (tenant_id, proposal_id) WHERE status = 'APPLIED';
CREATE INDEX IF NOT EXISTS quotations_below_floor_idx
  ON core.quotations (tenant_id, proposal_id) WHERE below_floor;

SELECT app.finalise_table('core','quotations',true,'QUO',
  ARRAY['proposal_id','version','rate_card_id']);

-- The self-reference has to wait for finalise_table to create the
-- (tenant_id, id) unique it points at - a table cannot reference a constraint on
-- itself that does not exist yet.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'quotations_supersedes_fk') THEN
    ALTER TABLE core.quotations
      ADD CONSTRAINT quotations_supersedes_fk
      FOREIGN KEY (tenant_id, supersedes_quotation_id)
      REFERENCES core.quotations (tenant_id, id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core.quotation_lines (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  quotation_id   uuid           NOT NULL,
  n              smallint       NOT NULL CHECK (n >= 1),
  item           text           NOT NULL,
  detail         text,
  basis          text           NOT NULL DEFAULT 'PER_UNIT'
                 CHECK (basis IN ('PACKAGE','PER_PAX','PER_DAY','PER_UNIT')),
  qty            numeric(12,3)  NOT NULL CHECK (qty >= 0),
  unit           text           CHECK (unit IS NULL OR unit IN ('DAY','PAX','TRIP')),
  unit_price_sen bigint         NOT NULL DEFAULT 0 CHECK (unit_price_sen >= 0),
  -- Each line is rounded half-up BEFORE it is summed. That ordering is the rule;
  -- summing unrounded lines and rounding the total gives a different answer.
  total_sen      bigint         GENERATED ALWAYS AS
                   (app.round_half_up_sen(unit_price_sen::numeric * qty)) STORED,
  currency       core.currency_code NOT NULL DEFAULT 'MYR',
  is_cost        boolean        NOT NULL DEFAULT true,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, quotation_id, n),
  CONSTRAINT ql_quotation_fk FOREIGN KEY (tenant_id, quotation_id)
    REFERENCES core.quotations (tenant_id, id) ON DELETE CASCADE,
  -- DECISIONS §7: a package price is ONE line at qty 1.
  CONSTRAINT ql_package_is_one CHECK (basis <> 'PACKAGE' OR qty = 1)
);

COMMENT ON COLUMN core.quotation_lines.total_sen IS
  'GENERATED, so a caller cannot supply a total that disagrees with its own unit '
  'price and quantity. This is the half of total-from-lines that a service layer '
  'would have to be trusted to do; here it is not trusted, it is derived.';

SELECT app.finalise_table('core','quotation_lines',false,NULL,ARRAY['quotation_id','n']);

-- ── The reconciliation trigger ──────────────────────────────────────────────
-- Recomputes the header from the lines. DEFERRABLE INITIALLY DEFERRED because a
-- multi-line edit passes through intermediate states where the header and the
-- lines genuinely do not match, and a non-deferred check would reject a
-- perfectly correct transaction halfway through it.

CREATE OR REPLACE FUNCTION core.quotation_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_quote  uuid := COALESCE(NEW.quotation_id, OLD.quotation_id);
BEGIN
  UPDATE core.quotations q
     SET sell_price_sen  = c.sell,
         direct_cost_sen = c.cost
    FROM (
      SELECT COALESCE(sum(l.total_sen) FILTER (WHERE NOT l.is_cost), 0) AS sell,
             COALESCE(sum(l.total_sen) FILTER (WHERE     l.is_cost), 0) AS cost
        FROM core.quotation_lines l
       WHERE l.tenant_id = v_tenant AND l.quotation_id = v_quote
    ) c
   WHERE q.tenant_id = v_tenant AND q.id = v_quote;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

REVOKE ALL ON FUNCTION core.quotation_recalc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quotation_lines_recalc ON core.quotation_lines;
CREATE TRIGGER trg_quotation_lines_recalc
  AFTER INSERT OR UPDATE OR DELETE ON core.quotation_lines
  FOR EACH ROW EXECUTE FUNCTION core.quotation_recalc();

-- And the assertion, at COMMIT, that the header still equals the lines. The
-- recalc above maintains it; this refuses to let anything else break it —
-- including a direct UPDATE on the header that bypasses the lines entirely.
CREATE OR REPLACE FUNCTION core.quotation_assert_reconciled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE v_sell bigint; v_cost bigint; v_row record;
BEGIN
  -- ⚠ RE-READ THE ROW. A DEFERRED constraint trigger's NEW is the tuple as it
  -- stood at the TRIGGERING STATEMENT, not at COMMIT. The line trigger updates
  -- the header afterwards, so trusting NEW here compares the lines against a
  -- header from before they were written and fails a correct transaction. Found
  -- by running it: the first attempt reported a header of 0 sen against lines
  -- that summed correctly.
  SELECT * INTO v_row FROM core.quotations
  WHERE tenant_id = NEW.tenant_id AND id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;   -- deleted later in the same transaction

  SELECT COALESCE(sum(total_sen) FILTER (WHERE NOT is_cost), 0),
         COALESCE(sum(total_sen) FILTER (WHERE     is_cost), 0)
    INTO v_sell, v_cost
  FROM core.quotation_lines
  WHERE tenant_id = NEW.tenant_id AND quotation_id = NEW.id;

  -- A quotation with no lines at all is a draft being started, not a
  -- disagreement. Only a quotation that HAS lines must reconcile to them.
  IF EXISTS (SELECT 1 FROM core.quotation_lines
             WHERE tenant_id = NEW.tenant_id AND quotation_id = NEW.id)
     AND (v_row.sell_price_sen <> v_sell OR v_row.direct_cost_sen <> v_cost) THEN
    RAISE EXCEPTION
      'TOTAL_NOT_RECONCILED: quotation % header does not equal the sum of its '
      'rounded lines', v_row.ref
      USING ERRCODE = 'integrity_constraint_violation',
            DETAIL = jsonb_build_object(
              'reason','TOTAL_NOT_RECONCILED',
              'claimedSell', v_row.sell_price_sen, 'lineSell', v_sell,
              'claimedCost', v_row.direct_cost_sen, 'lineCost', v_cost)::text;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_quotation_reconciled ON core.quotations;
CREATE CONSTRAINT TRIGGER trg_quotation_reconciled
  AFTER INSERT OR UPDATE ON core.quotations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.quotation_assert_reconciled();

-- An APPLIED quotation is frozen entirely; a change writes a new version row.
CREATE OR REPLACE FUNCTION core.freeze_applied_quotation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.status = 'APPLIED' AND NEW.status = 'APPLIED'
     AND to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RAISE EXCEPTION
      'QUOTATION_APPLIED: quotation % is applied and cannot be changed. A revision '
      'is a new version row, not an edit.', OLD.ref
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_quotations_freeze_applied ON core.quotations;
CREATE TRIGGER trg_quotations_freeze_applied
  BEFORE UPDATE ON core.quotations
  FOR EACH ROW EXECUTE FUNCTION core.freeze_applied_quotation();

-- A quotation may be DRAFTED against the placeholder rate card, but not APPLIED.
CREATE OR REPLACE FUNCTION core.quotation_block_placeholder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE v_placeholder boolean;
BEGIN
  IF NEW.status <> 'APPLIED' THEN RETURN NEW; END IF;
  SELECT is_placeholder INTO v_placeholder
  FROM core.rate_cards WHERE tenant_id = NEW.tenant_id AND id = NEW.rate_card_id;

  IF v_placeholder THEN
    RAISE EXCEPTION
      'RATE_CARD_PLACEHOLDER: quotation % cannot be applied against a placeholder '
      'rate card. DECISIONS §5 holds the costing screen at "rate card v0 - '
      'placeholder" until Finance supplies the numbers, so that nobody quotes from it.',
      NEW.ref
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

-- The floor rule, at the only instant it can be judged: COMMIT.
CREATE OR REPLACE FUNCTION core.quotation_assert_floor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE v_row record;
BEGIN
  -- Re-read, for the same reason as the reconciliation trigger: a deferred
  -- trigger's NEW predates the line trigger's update of the header.
  SELECT * INTO v_row FROM core.quotations
  WHERE tenant_id = NEW.tenant_id AND id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- A quotation with no lines is a draft being started, not a breach.
  IF NOT EXISTS (SELECT 1 FROM core.quotation_lines
                 WHERE tenant_id = NEW.tenant_id AND quotation_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF v_row.below_floor AND v_row.discount_approval_id IS NULL THEN
    RAISE EXCEPTION
      'FLOOR_PRICE_BREACH: quotation % is priced at % sen, below the binding % '
      'floor of % sen, with no DISCOUNT_APPROVE behind it.',
      v_row.ref, v_row.sell_price_sen, v_row.binding_floor_basis, v_row.floor_price_sen
      USING ERRCODE = 'integrity_constraint_violation',
            DETAIL = jsonb_build_object(
              'reason','FLOOR_PRICE_BREACH',
              'floorPriceSen', v_row.floor_price_sen,
              'bindingFloorBasis', v_row.binding_floor_basis,
              'resultingMarginRate', v_row.margin_rate,
              'requiresPolicy','APV-02')::text;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_quotation_floor ON core.quotations;
CREATE CONSTRAINT TRIGGER trg_quotation_floor
  AFTER INSERT OR UPDATE ON core.quotations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.quotation_assert_floor();

DROP TRIGGER IF EXISTS trg_quotations_placeholder_guard ON core.quotations;
CREATE TRIGGER trg_quotations_placeholder_guard
  BEFORE INSERT OR UPDATE ON core.quotations
  FOR EACH ROW EXECUTE FUNCTION core.quotation_block_placeholder();

-- ═══ 7 · Deferred FK from 005, now closable ═════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'follow_ups_proposal_fk') THEN
    ALTER TABLE core.follow_ups
      ADD CONSTRAINT follow_ups_proposal_fk FOREIGN KEY (tenant_id, proposal_id)
      REFERENCES core.proposals (tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- ═══ 8 · Verify ═════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_bad text; v_cnt int;
BEGIN
  -- THE CATALOGUE QUERY THAT CANNOT ROT. No money column anywhere in `core` may
  -- be a floating type. float8 cannot represent 0.1, and a sen that drifts is a
  -- customer dispute the database caused.
  SELECT string_agg(format('%s.%s (%s)', c.relname, a.attname, t.typname), ', ') INTO v_bad
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c     ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_type t      ON t.oid = a.atttypid
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND a.attnum > 0 AND NOT a.attisdropped
    AND (a.attname LIKE '%\_sen' OR a.attname LIKE '%\_rate' OR a.attname LIKE '%\_pct')
    AND t.typname IN ('float4','float8');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '007 verify: floating-point money or rate column(s): %. float8 cannot '
      'represent 0.1; a sen that drifts is a customer dispute the database caused.',
      v_bad;
  END IF;

  -- The reconciliation trigger must be a DEFERRABLE CONSTRAINT trigger. A plain
  -- AFTER trigger of the same name would reject a correct multi-line edit
  -- halfway through the transaction, and would look identical in a diff.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'core.quotations'::regclass
      AND tgname = 'trg_quotation_reconciled'
      AND tgdeferrable AND tginitdeferred
  ) THEN
    RAISE EXCEPTION
      '007 verify: trg_quotation_reconciled is missing or is not DEFERRABLE '
      'INITIALLY DEFERRED.';
  END IF;

  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'core.quotations'::regclass AND a.attgenerated = 's';
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION '007 verify: expected 8 generated columns on quotations, found %', v_cnt;
  END IF;

  RAISE NOTICE
    '007 verify: OK - no floating money anywhere in core, 8 generated columns, '
    'reconciliation deferred.';
END;
$verify$;

COMMIT;
