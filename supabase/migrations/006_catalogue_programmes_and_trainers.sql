-- ============================================================================
-- Migration 006: the catalogue — programmes and their modules, pricing tiers
-- and materials; trainers, their pool membership, availability and bookings.
-- ============================================================================
--
-- FEATURE. What the business sells and who delivers it. Eight tables. The
-- catalogue sits in Delivery rather than Sales because `PUT /programmes/{id}`
-- is ADMIN + L&D and returns FORBIDDEN to SALES (contract §6): Sales reads it,
-- Delivery owns it.
--
-- THE THREE THINGS THIS MIGRATION GETS RIGHT THAT ARE EASY TO GET WRONG
--
--   1. `floor_price_sen` IS AN ABSOLUTE FLOOR, NOT A MARGIN. Doc 01 §3.2 works
--      the arithmetic: the contract's RM 13,900 floor against an RM 18,500 sell
--      price is a commercial-policy number. A 0.35 margin floor on RM 11,400 of
--      cost would be RM 17,538, which is not what the screen shows. Storing a
--      rate and deriving the floor would put a different number on the approval
--      screen from the one the salesperson was told, which is the worst
--      possible place for a rounding disagreement.
--
--   2. A TRAINER CANNOT BE DOUBLE-BOOKED, AND THE DATABASE IS WHAT STOPS IT.
--      Two confirmed bookings for the same trainer over overlapping dates is
--      not a validation error to be caught in a service layer — it is a
--      trainer standing in the wrong city, a client without a facilitator, and
--      an HRD Corp claim that cannot be filed. An EXCLUSION constraint over a
--      daterange, using btree_gist so `trainer_id` can be compared with `=` in
--      the same constraint, makes it unrepresentable. It applies only to
--      CONFIRMED rows: soft holds are explicitly allowed to overlap, because
--      holding two options for a client while they decide is the point of a
--      soft hold.
--
--   3. AVAILABILITY AND BOOKINGS CANNOT DISAGREE. `trainer_availability` is a
--      declared calendar and `BOOKED` days on it are written by a trigger on
--      `trainer_bookings`, never by hand. Two hand-maintained calendars for one
--      trainer is the divergence the project rules forbid, and here it shows up
--      as a trainer who is available on a screen and booked in the database.
--
-- ⚠ RATE CARDS ARE NOT HERE. DECISIONS §5 defines the rate card and doc 01 says
-- plainly that "the rates themselves live in sb-money's rate card".
-- `trainers.band` and `trainers.day_rate_override_sen` are the JOIN KEYS into
-- it, not the rates. The rate-card tables arrive with the money batch (007),
-- which is also where the floor-price and margin arithmetic lives.
--
-- DEFERRED FKs CLOSED HERE. 005 created `organisation_suggestions.programme_id`
-- and `tna_recommendations.programme_id` without constraints, because
-- `core.programmes` did not exist. Both are added at the end of this migration.
-- `trainer_bookings.engagement_id` is the reverse case and is left open until
-- 008 creates `core.engagements`.
--
-- SPINE: untouched.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   No RPC. All eight tables RLS enabled and FORCED, zero policies, until 014.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1/2. No RPC, no envelope. 3. RpcMap: none; Data API tables.
--   4. Call sites: 007 prices from these, 008 schedules from them, 016 seeds.
--   5. Casts: none. 6. Reload/restore: none. 7. Public routes: none.
--
-- Rollback: rollbacks/006_catalogue_programmes_and_trainers_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ programmes ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.programmes (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                text,
  name               text           NOT NULL,
  category           text           NOT NULL,
  days               smallint       NOT NULL CHECK (days > 0),
  version            smallint       NOT NULL DEFAULT 1 CHECK (version >= 1),
  status             text           NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  hrdc_scheme        core.hrdc_scheme,
  hrdc_claimable     boolean        NOT NULL DEFAULT false,
  list_price_sen     bigint         NOT NULL CHECK (list_price_sen >= 0),
  list_price_pax     smallint       NOT NULL CHECK (list_price_pax > 0),
  floor_price_sen    bigint         NOT NULL CHECK (floor_price_sen >= 0),
  floor_margin_rate  numeric(6,4)   NOT NULL CHECK (floor_margin_rate BETWEEN 0 AND 1),
  currency           char(3)        NOT NULL DEFAULT 'MYR',
  outcomes           text[]         NOT NULL DEFAULT '{}',
  deliveries_count   integer        NOT NULL DEFAULT 0 CHECK (deliveries_count >= 0),
  average_evaluation numeric(3,2)   CHECK (average_evaluation IS NULL OR average_evaluation BETWEEN 0 AND 5),
  archived_at        timestamptz,
  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now(),
  created_by_kind    app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id      text           NOT NULL DEFAULT 'system',
  created_by_name    text,
  -- A floor above the list price is not a floor, it is a refusal to sell.
  CONSTRAINT programmes_floor_below_list CHECK (floor_price_sen <= list_price_sen),
  -- A claimable programme with no scheme cannot be claimed against anything.
  CONSTRAINT programmes_claimable_needs_scheme
    CHECK (hrdc_claimable = false OR hrdc_scheme IS NOT NULL)
);

COMMENT ON COLUMN core.programmes.floor_price_sen IS
  'An ABSOLUTE floor in sen, set by commercial policy - not derived from cost and '
  'not a margin. Doc 01 works it: the contract''s RM 13,900 floor against RM 18,500 '
  'is this number, whereas a 0.35 margin floor on RM 11,400 of cost would be '
  'RM 17,538. Deriving it would put a different figure on the approval screen from '
  'the one the salesperson was quoted.';
COMMENT ON COLUMN core.programmes.deliveries_count IS
  'stats.deliveries, maintained by a trigger in 008 once engagements exist. Display '
  'only: it is a count of history, never an input to pricing or policy.';
COMMENT ON TABLE core.programmes IS
  'No immutability. PUT /programmes/{id} is ADMIN + L&D and a price change does NOT '
  'reprice existing quotations - each quotation snapshots the floor it was priced '
  'against and pins its rate card version, so history is protected by the quotation, '
  'not by freezing the catalogue.';

CREATE INDEX IF NOT EXISTS programmes_status_idx ON core.programmes (tenant_id, status, category);
CREATE INDEX IF NOT EXISTS programmes_name_trgm
  ON core.programmes USING gin (name extensions.gin_trgm_ops);

SELECT app.finalise_table('core','programmes',true,'PRG',ARRAY[]::text[]);

CREATE TABLE IF NOT EXISTS core.programme_modules (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  programme_id     uuid           NOT NULL,
  n                smallint       NOT NULL CHECK (n >= 1),
  title            text           NOT NULL,
  format           text           NOT NULL CHECK (format IN ('FACILITATED','SELF_PACED','COACHING')),
  duration_minutes integer        NOT NULL CHECK (duration_minutes > 0),
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),
  created_by_kind  app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id    text           NOT NULL DEFAULT 'system',
  created_by_name  text,
  UNIQUE (tenant_id, programme_id, n),
  CONSTRAINT programme_modules_programme_fk FOREIGN KEY (tenant_id, programme_id)
    REFERENCES core.programmes (tenant_id, id) ON DELETE CASCADE
);
SELECT app.finalise_table('core','programme_modules',false,NULL,ARRAY['programme_id']);

CREATE TABLE IF NOT EXISTS core.programme_pricing_tiers (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  programme_id    uuid           NOT NULL,
  max_pax         smallint       NOT NULL CHECK (max_pax > 0),
  price_sen       bigint         NOT NULL CHECK (price_sen >= 0),
  floor_price_sen bigint         NOT NULL CHECK (floor_price_sen >= 0),
  currency        char(3)        NOT NULL DEFAULT 'MYR',
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, programme_id, max_pax),
  CONSTRAINT ppt_floor_below_price CHECK (floor_price_sen <= price_sen),
  CONSTRAINT ppt_programme_fk FOREIGN KEY (tenant_id, programme_id)
    REFERENCES core.programmes (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.programme_pricing_tiers IS
  'Read in ASCENDING max_pax: the first tier whose max_pax >= headcount wins, and a '
  'headcount above the largest tier is a quote, not a lookup. That rule is not '
  'expressible as a constraint, so it is written here and implemented once in the '
  'pricing function rather than in each caller.';

SELECT app.finalise_table('core','programme_pricing_tiers',false,NULL,ARRAY['programme_id','max_pax']);

CREATE TABLE IF NOT EXISTS core.programme_materials (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  programme_id    uuid           NOT NULL,
  material_type   text           NOT NULL CHECK (material_type IN ('WORKBOOK','SLIDES','ASSESSMENT')),
  version         smallint       NOT NULL DEFAULT 1 CHECK (version >= 1),
  languages       char(2)[]      NOT NULL DEFAULT '{}',
  attachment_id   uuid,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, programme_id, material_type, version),
  CONSTRAINT pm_programme_fk FOREIGN KEY (tenant_id, programme_id)
    REFERENCES core.programmes (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT pm_attachment_fk FOREIGN KEY (tenant_id, attachment_id)
    REFERENCES core.attachments (tenant_id, id) ON DELETE SET NULL
);
SELECT app.finalise_table('core','programme_materials',false,NULL,ARRAY['programme_id','material_type','version']);

-- ═══ trainers ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.trainers (
  id                    uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                   text,
  name                  text           NOT NULL,
  email                 extensions.citext,
  phone                 text,
  user_id               uuid           REFERENCES auth.users(id) ON DELETE RESTRICT,
  band                  core.trainer_band,
  day_rate_override_sen bigint         CHECK (day_rate_override_sen IS NULL OR day_rate_override_sen >= 0),
  ttt_certified         boolean        NOT NULL DEFAULT false,
  ttt_ref               text,
  ttt_valid_to          date,
  hrd_tdf               boolean        NOT NULL DEFAULT false,
  rating                numeric(3,2)   CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
  status                text           NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','INACTIVE','RETIRED')),
  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now(),
  created_by_kind       app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id         text           NOT NULL DEFAULT 'system',
  created_by_name       text,
  -- HRD Corp asks for the certificate reference on the claim. A trainer flagged
  -- certified with no reference produces a packet that cannot be completed.
  CONSTRAINT trainers_ttt_ref_required CHECK (ttt_certified = false OR ttt_ref IS NOT NULL)
);

COMMENT ON COLUMN core.trainers.band IS
  'A JOIN KEY into sb-money''s rate card, not a rate. DECISIONS s5 puts the three '
  'band day-rates in the rate card, versioned and effective-dated, so a rate change '
  'does not silently reprice a quotation that was already sent.';
COMMENT ON COLUMN core.trainers.day_rate_override_sen IS
  'A per-trainer override of the band rate, in sen. Still not the rate card - it is '
  'the exception the rate card admits.';
COMMENT ON COLUMN core.trainers.hrd_tdf IS
  'HRD Corp Train-the-Trainer accreditation, required at GRANT APPLICATION time '
  '(DECISIONS s3). Separate from ttt_certified, which is the internal certification.';

CREATE INDEX IF NOT EXISTS trainers_certified_idx
  ON core.trainers (tenant_id, status) WHERE ttt_certified;
CREATE INDEX IF NOT EXISTS trainers_name_trgm
  ON core.trainers USING gin (name extensions.gin_trgm_ops);

SELECT app.finalise_table('core','trainers',true,'TRN',ARRAY[]::text[]);

-- 002 left memberships.trainer_id without a constraint because core.trainers did
-- not exist. Closed here. Doc 02 s1.2 marks it [assumed] against this table.
-- Guarded, because Postgres has no ADD CONSTRAINT IF NOT EXISTS and a
-- re-applied migration must not fail on its second pass.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'memberships_trainer_fk') THEN
    ALTER TABLE public.memberships
      ADD CONSTRAINT memberships_trainer_fk
      FOREIGN KEY (tenant_id, trainer_id) REFERENCES core.trainers (tenant_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core.programme_trainers (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  programme_id    uuid           NOT NULL,
  trainer_id      uuid           NOT NULL,
  certified_at    date,
  rating_override numeric(3,2)   CHECK (rating_override IS NULL OR rating_override BETWEEN 0 AND 5),
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, programme_id, trainer_id),
  CONSTRAINT pt_programme_fk FOREIGN KEY (tenant_id, programme_id)
    REFERENCES core.programmes (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT pt_trainer_fk FOREIGN KEY (tenant_id, trainer_id)
    REFERENCES core.trainers (tenant_id, id) ON DELETE CASCADE
);
SELECT app.finalise_table('core','programme_trainers',false,NULL,ARRAY['programme_id','trainer_id']);

CREATE TABLE IF NOT EXISTS core.trainer_availability (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  trainer_id      uuid           NOT NULL,
  on_date         date           NOT NULL,
  state           text           NOT NULL CHECK (state IN ('AVAILABLE','BLOCKED','BOOKED')),
  note            text,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, trainer_id, on_date),
  CONSTRAINT ta_trainer_fk FOREIGN KEY (tenant_id, trainer_id)
    REFERENCES core.trainers (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.trainer_availability IS
  'A DECLARED calendar. BOOKED days are written by the trainer_bookings trigger and '
  'never by hand, so the calendar and the bookings cannot disagree. Two hand-kept '
  'calendars for one trainer is the divergence the project rules forbid, and here it '
  'shows up as a trainer who is free on a screen and booked in the database.';

CREATE INDEX IF NOT EXISTS ta_date_state_idx ON core.trainer_availability (tenant_id, on_date, state);
SELECT app.finalise_table('core','trainer_availability',false,NULL,ARRAY['trainer_id','on_date']);

CREATE TABLE IF NOT EXISTS core.trainer_bookings (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref             text,
  trainer_id      uuid           NOT NULL,
  engagement_id   uuid,          -- FK added by 008, which creates core.engagements
  state           core.booking_state NOT NULL DEFAULT 'SOFT_HOLD',
  starts_on       date           NOT NULL,
  ends_on         date           NOT NULL,
  hold_expires_at timestamptz,
  day_rate_sen    bigint         CHECK (day_rate_sen IS NULL OR day_rate_sen >= 0),
  currency        char(3)        NOT NULL DEFAULT 'MYR',
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,
  CONSTRAINT tb_trainer_fk FOREIGN KEY (tenant_id, trainer_id)
    REFERENCES core.trainers (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT tb_dates_ordered CHECK (ends_on >= starts_on),
  -- DECISIONS §1: the soft hold is 72 hours. A hold with no expiry is a
  -- confirmed booking that nobody agreed to.
  CONSTRAINT tb_hold_needs_expiry
    CHECK (state <> 'SOFT_HOLD' OR hold_expires_at IS NOT NULL),
  -- ── THE ONE THAT MATTERS ──────────────────────────────────────────────────
  -- A trainer cannot hold two CONFIRMED bookings over overlapping dates. Not a
  -- validation error caught in a service layer: a trainer in the wrong city, a
  -- client with no facilitator, and an HRD Corp claim that cannot be filed.
  -- btree_gist is what lets `=` on a uuid sit in the same EXCLUDE as `&&` on a
  -- range. SOFT_HOLD rows are deliberately outside the constraint - holding two
  -- options for a client while they decide is the entire point of a soft hold.
  CONSTRAINT tb_no_double_booking EXCLUDE USING gist (
    tenant_id  WITH =,
    trainer_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  ) WHERE (state = 'CONFIRMED')
);

CREATE INDEX IF NOT EXISTS tb_trainer_dates_idx
  ON core.trainer_bookings (tenant_id, trainer_id, starts_on);
CREATE INDEX IF NOT EXISTS tb_expiring_holds_idx
  ON core.trainer_bookings (tenant_id, hold_expires_at) WHERE state = 'SOFT_HOLD';

SELECT app.finalise_table('core','trainer_bookings',true,'TBK',ARRAY['trainer_id']);

-- The trigger that keeps the declared calendar honest.
CREATE OR REPLACE FUNCTION core.sync_trainer_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r        record;
  v_day    date;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  IF TG_OP <> 'INSERT' THEN
    -- Release the OLD span first, so a moved booking does not leave BOOKED days
    -- behind on dates it no longer covers.
    FOR v_day IN SELECT generate_series(OLD.starts_on, OLD.ends_on, '1 day')::date LOOP
      UPDATE core.trainer_availability
         SET state = 'AVAILABLE'
       WHERE tenant_id = OLD.tenant_id AND trainer_id = OLD.trainer_id
         AND on_date = v_day AND state = 'BOOKED';
    END LOOP;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.state = 'CONFIRMED' THEN
    FOR v_day IN SELECT generate_series(NEW.starts_on, NEW.ends_on, '1 day')::date LOOP
      INSERT INTO core.trainer_availability (tenant_id, trainer_id, on_date, state, note)
      VALUES (NEW.tenant_id, NEW.trainer_id, v_day, 'BOOKED', 'auto: booking ' || NEW.id)
      ON CONFLICT (tenant_id, trainer_id, on_date)
      DO UPDATE SET state = 'BOOKED', updated_at = now();
    END LOOP;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

REVOKE ALL ON FUNCTION core.sync_trainer_availability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trainer_bookings_sync_availability ON core.trainer_bookings;
CREATE TRIGGER trg_trainer_bookings_sync_availability
  AFTER INSERT OR UPDATE OR DELETE ON core.trainer_bookings
  FOR EACH ROW EXECUTE FUNCTION core.sync_trainer_availability();

-- ═══ Deferred FKs from 005, now closable ════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'os_programme_fk') THEN
    ALTER TABLE core.organisation_suggestions
      ADD CONSTRAINT os_programme_fk FOREIGN KEY (tenant_id, programme_id)
      REFERENCES core.programmes (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'tna_recs_programme_fk') THEN
    ALTER TABLE core.tna_recommendations
      ADD CONSTRAINT tna_recs_programme_fk FOREIGN KEY (tenant_id, programme_id)
      REFERENCES core.programmes (tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- ═══ Verify ═════════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND c.relname IN ('programmes','programme_modules','programme_pricing_tiers',
                      'programme_materials','trainers','programme_trainers',
                      'trainer_availability','trainer_bookings');
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION '006 verify: expected 8 catalogue tables, found %', v_cnt;
  END IF;

  -- The double-booking constraint must exist AND be an exclusion constraint.
  -- A unique index of the same name would not catch an OVERLAP, only an exact
  -- date match, and would look correct in every diff.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'core.trainer_bookings'::regclass
      AND conname = 'tb_no_double_booking' AND contype = 'x'
  ) THEN
    RAISE EXCEPTION
      '006 verify: tb_no_double_booking is missing or is not an EXCLUSION '
      'constraint. Anything else catches only an exact date match, never an overlap.';
  END IF;

  -- The three deferred FKs closed by this migration.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conname = 'os_programme_fk')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conname = 'tna_recs_programme_fk')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conname = 'memberships_trainer_fk') THEN
    RAISE EXCEPTION '006 verify: a deferred foreign key was not closed';
  END IF;

  RAISE NOTICE
    '006 verify: OK - 8 catalogue tables, double-booking excluded, 3 deferred FKs closed.';
END;
$verify$;

COMMIT;
