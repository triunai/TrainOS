-- ============================================================================
-- Migration 008: delivery — engagements and their lifecycle, sessions,
-- participants, attendance with a ONE-WAY lock, certificates, evaluations and
-- outbound messages.
-- ============================================================================
--
-- FEATURE. What happens between a won deal and a closed engagement. Twelve
-- tables. One of them, `attendance_days`, exists for a rule HRD Corp imposes and
-- the product cannot bend.
--
-- ══ ATTENDANCE IMMUTABILITY IS THE POINT OF THIS MIGRATION ══════════════════
--
-- Contract §8: approved attendance returns `409 ATTENDANCE_LOCKED` and "the lock
-- is one-way". DECISIONS §3 lists attendance immutability as an eTRIS rule.
-- Once a day is LOCKED:
--
--   * no `attendance_entries` row for that day may be inserted, changed or
--     deleted — enforced by a trigger on the CHILD table that reads the
--     parent's status, because the rule is about the day and the writes happen
--     to the entries;
--   * the day's own approval columns freeze;
--   * `capture_qr`, `capture_signature` and `capture_manual` are forced to
--     false, so the contract's "captureModes are all false while locked" is a
--     property of the row rather than something the UI is trusted to render.
--     The UI disables from the response; the response now cannot say otherwise.
--
-- UNLOCKING IS NOT AN UPDATE, IT IS AN ACTION. `ATTENDANCE_UNLOCK` requires a
-- reason, voids the claim packet, and is always audited (contract §8). The
-- trigger therefore permits LOCKED → OPEN only when `unlock_reason` is supplied
-- in the same statement, and increments `unlock_count` itself so the count
-- cannot be reset by the same hand that unlocked. A day that has been unlocked
-- is not the same as a day that was never locked, and the count is how the
-- compliance review sees the difference.
--
-- ⚠ WHAT THIS MIGRATION DELIBERATELY DOES NOT DO. It does not stop a
-- `service_role` connection rewriting attendance: `service_role` carries
-- BYPASSRLS, and a trigger is not RLS, so the trigger DOES still fire for it —
-- but a superuser can disable triggers. That is a platform-access question, not
-- a schema one, and pretending otherwise here would be the more dangerous
-- error. What the schema guarantees is that no ordinary path, however
-- well-intentioned, can rewrite a locked day.
--
-- TWO PROJECTIONS WITH ONE WRITER EACH
--   `engagement_trainers` is the join sb-tenancy's trainer policies read. Doc 01
--   is explicit that a policy cannot afford to union `sessions` and
--   `trainer_bookings` on every row check, so this table is maintained BY
--   TRIGGER from both and never by hand.
--   `programmes.deliveries_count` is maintained by trigger from engagements
--   reaching DELIVERED.
--
-- SPINE: untouched. `ATTENDANCE_APPROVE` and `ATTENDANCE_UNLOCK` are action
-- types the gate will dispatch in 011; this migration is what makes the lock
-- real once it does.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   No RPC. All tables RLS enabled and FORCED, zero policies, until 014.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1/2. No RPC, no envelope. 3. RpcMap: none. 4. Call sites: 009 claims from
--   these, 010 invoices from them, 011 gates them. 5. Casts: none.
--   6. Reload/restore: none. 7. Public routes: none.
--
-- Rollback: rollbacks/008_delivery_engagements_sessions_attendance_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ engagements ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.engagements (
  id                        uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                       text,
  organisation_id           uuid           NOT NULL,
  opportunity_id            uuid,
  proposal_id               uuid,
  programme_id              uuid           NOT NULL,
  owner_id                  uuid           NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  pipeline_id               uuid           NOT NULL,
  title                     text           NOT NULL,
  status                    core.engagement_status NOT NULL DEFAULT 'PROPOSED',
  venue                     text,
  venue_mode                core.venue_mode,
  value_sen                 bigint         CHECK (value_sen IS NULL OR value_sen >= 0),
  currency                  core.currency_code NOT NULL DEFAULT 'MYR',
  grant_rule_set_version_id uuid,          -- FK added by 009 (core.rule_set_versions)
  grant_pinned_at           timestamptz,
  starts_on                 date,
  ends_on                   date,
  closed_out_at             timestamptz,
  created_at                timestamptz    NOT NULL DEFAULT now(),
  updated_at                timestamptz    NOT NULL DEFAULT now(),
  created_by_kind           app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id             text           NOT NULL DEFAULT 'system',
  created_by_name           text,
  CONSTRAINT engagements_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT engagements_opportunity_fk FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES core.opportunities (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT engagements_proposal_fk FOREIGN KEY (tenant_id, proposal_id)
    REFERENCES core.proposals (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT engagements_programme_fk FOREIGN KEY (tenant_id, programme_id)
    REFERENCES core.programmes (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT engagements_pipeline_fk FOREIGN KEY (tenant_id, pipeline_id)
    REFERENCES core.pipelines (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT engagements_dates_ordered CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  -- A pinned rule set without the instant it was pinned cannot be re-explained
  -- to HRD Corp, and the pair is what DECISIONS §6 actually requires.
  CONSTRAINT engagements_grant_pin_pair
    CHECK ((grant_rule_set_version_id IS NULL) = (grant_pinned_at IS NULL))
);

COMMENT ON COLUMN core.engagements.grant_rule_set_version_id IS
  'The rule-set version in force at GRANT SUBMISSION (DECISIONS §6), pinned once '
  'and then frozen. Grant-side rules resolve as at submission because HRD Corp '
  'evaluates against the rules in force when they RECEIVE the thing - not as at the '
  'training date, which is what contract §17 assumed and §18 superseded.';
COMMENT ON TABLE core.engagements IS
  'The `dates[]` array in the contract is NOT a column here: delivery dates derive '
  'from core.sessions, because the sessions exist anyway and two sources of truth '
  'for when training happened is exactly the divergence the project rules forbid. '
  'starts_on/ends_on are the planned window, maintained from the sessions.';

CREATE INDEX IF NOT EXISTS engagements_status_idx ON core.engagements (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS engagements_org_idx    ON core.engagements (tenant_id, organisation_id);
CREATE INDEX IF NOT EXISTS engagements_prog_idx   ON core.engagements (tenant_id, programme_id);
CREATE INDEX IF NOT EXISTS engagements_owner_idx  ON core.engagements (tenant_id, owner_id);

SELECT app.finalise_table('core','engagements',true,'ENG',
  ARRAY['organisation_id','programme_id','grant_rule_set_version_id','grant_pinned_at']);

CREATE TABLE IF NOT EXISTS core.engagement_step_states (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  engagement_id    uuid           NOT NULL,
  pipeline_step_id uuid           NOT NULL,
  state            core.lifecycle_state NOT NULL DEFAULT 'PENDING',
  at               timestamptz,
  note             text,
  target_ref       text,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, engagement_id, pipeline_step_id),
  CONSTRAINT ess_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT ess_step_fk FOREIGN KEY (tenant_id, pipeline_step_id)
    REFERENCES core.pipeline_steps (tenant_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE core.engagement_step_states IS
  'THE STEP KEY AND ITS ORDER ARE NEVER STORED HERE. They come from pipeline_steps, '
  'which is what satisfies the project rule that stage names and order render from '
  'configuration. HRDC_CLAIM = BLOCKED is WRITTEN by the compliance evaluator when a '
  'check fails; the stepper renders that state, it does not compute it.';
CREATE UNIQUE INDEX IF NOT EXISTS ess_one_current_uq
  ON core.engagement_step_states (tenant_id, engagement_id) WHERE state = 'CURRENT';
SELECT app.finalise_table('core','engagement_step_states',false,NULL,
  ARRAY['engagement_id','pipeline_step_id']);

CREATE TABLE IF NOT EXISTS core.engagement_checklist_items (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  engagement_id  uuid        NOT NULL,
  item_key       text        NOT NULL,
  label          text        NOT NULL,
  done           boolean     NOT NULL DEFAULT false,
  done_at        timestamptz,
  done_by_user_id uuid       REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, engagement_id, item_key),
  CONSTRAINT eci_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT eci_done_pair CHECK (done = false OR done_at IS NOT NULL)
);
SELECT app.finalise_table('core','engagement_checklist_items',false,NULL,
  ARRAY['engagement_id','item_key']);

CREATE TABLE IF NOT EXISTS core.sessions (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref            text,
  engagement_id  uuid           NOT NULL,
  trainer_id     uuid,
  day            smallint       NOT NULL CHECK (day >= 1),
  on_date        date           NOT NULL,
  title          text,
  venue          text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text          NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, engagement_id, day, on_date, title),
  CONSTRAINT sessions_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT sessions_trainer_fk FOREIGN KEY (tenant_id, trainer_id)
    REFERENCES core.trainers (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT sessions_times_ordered CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS sessions_date_idx    ON core.sessions (tenant_id, on_date);
CREATE INDEX IF NOT EXISTS sessions_trainer_idx ON core.sessions (tenant_id, trainer_id, on_date);
SELECT app.finalise_table('core','sessions',true,'SES',ARRAY['engagement_id']);

CREATE TABLE IF NOT EXISTS core.engagement_trainers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  engagement_id uuid        NOT NULL,
  trainer_id    uuid        NOT NULL,
  role          text        NOT NULL DEFAULT 'LEAD'
                CHECK (role IN ('LEAD','CO_FACILITATOR','OBSERVER')),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, engagement_id, trainer_id),
  CONSTRAINT et_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT et_trainer_fk FOREIGN KEY (tenant_id, trainer_id)
    REFERENCES core.trainers (tenant_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE core.engagement_trainers IS
  'The join sb-tenancy''s trainer-scoped policies read. sessions.trainer_id and '
  'trainer_bookings both imply the link, but a policy cannot afford to union two '
  'tables on every row check. A PROJECTION with ONE WRITER: maintained by trigger '
  'from sessions, never by hand.';
-- (tenant_id, trainer_id) is the direction the POLICY reads: "which engagements
-- can this trainer see". The other direction is served by the unique constraint.
CREATE INDEX IF NOT EXISTS et_trainer_idx ON core.engagement_trainers (tenant_id, trainer_id);
SELECT app.finalise_table('core','engagement_trainers',false,NULL,
  ARRAY['engagement_id','trainer_id']);

CREATE TABLE IF NOT EXISTS core.participants (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref               text,
  engagement_id     uuid           NOT NULL,
  contact_id        uuid,
  name              text           NOT NULL,
  department        text,
  email             extensions.citext,
  identity_no_hash  bytea,
  identity_no_last4 char(4),
  registered_at     timestamptz    NOT NULL DEFAULT now(),
  withdrawn_at      timestamptz,
  redacted_at       timestamptz,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  created_by_kind   app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id     text           NOT NULL DEFAULT 'system',
  created_by_name   text,
  CONSTRAINT participants_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT participants_contact_fk FOREIGN KEY (tenant_id, contact_id)
    REFERENCES core.contacts (tenant_id, id) ON DELETE SET NULL
);
COMMENT ON COLUMN core.participants.identity_no_hash IS
  'HRD Corp requires an identity number on the claim. The NUMBER IS NEVER STORED: a '
  'SHA-256 hash plus the last four digits is enough to match a participant against '
  'the employer''s own record and to display "...1234", and a database dump then '
  'does not leak a national identity number for thirty people per engagement.';
CREATE UNIQUE INDEX IF NOT EXISTS participants_email_uq
  ON core.participants (tenant_id, engagement_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS participants_engagement_idx ON core.participants (tenant_id, engagement_id);
CREATE INDEX IF NOT EXISTS participants_contact_idx    ON core.participants (tenant_id, contact_id);
SELECT app.finalise_table('core','participants',true,'PAR',ARRAY['engagement_id']);

-- ═══ attendance ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.attendance_days (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  engagement_id     uuid           NOT NULL,
  day               smallint       NOT NULL CHECK (day >= 1),
  on_date           date           NOT NULL,
  status            core.attendance_status NOT NULL DEFAULT 'OPEN',
  immutable         boolean        NOT NULL DEFAULT false,
  approved_by_kind  app.actor_kind,
  approved_by_id    text,
  approved_by_name  text,
  approved_at       timestamptz,
  capture_qr        boolean        NOT NULL DEFAULT true,
  capture_signature boolean        NOT NULL DEFAULT true,
  capture_manual    boolean        NOT NULL DEFAULT true,
  unlocked_at       timestamptz,
  unlock_reason     text,
  unlock_count      smallint       NOT NULL DEFAULT 0 CHECK (unlock_count >= 0),
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  created_by_kind   app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id     text           NOT NULL DEFAULT 'system',
  created_by_name   text,
  UNIQUE (tenant_id, engagement_id, day),
  CONSTRAINT ad_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE RESTRICT,
  -- A locked day with no approver is a lock nobody is accountable for.
  CONSTRAINT ad_locked_needs_approver
    CHECK (status <> 'LOCKED' OR (approved_at IS NOT NULL AND approved_by_id IS NOT NULL)),
  -- `immutable` tracks `status`. Two columns that can disagree is one column too
  -- many; they are kept in step by the trigger and the constraint proves it.
  CONSTRAINT ad_immutable_tracks_status CHECK (immutable = (status = 'LOCKED')),
  -- Contract §8: captureModes are all false while locked. A property of the row,
  -- so the response cannot say otherwise and the UI has nothing to get wrong.
  CONSTRAINT ad_locked_disables_capture
    CHECK (status <> 'LOCKED' OR (capture_qr = false AND capture_signature = false
                                  AND capture_manual = false)),
  CONSTRAINT ad_unlock_pair CHECK ((unlocked_at IS NULL) = (unlock_reason IS NULL))
);

COMMENT ON TABLE core.attendance_days IS
  'One row per engagement per day. THIS IS THE TABLE THE IMMUTABILITY RULE EXISTS '
  'FOR (contract §8, DECISIONS §3). The lock is one-way: unlocking is an ACTION with '
  'a reason that voids the claim packet, not an UPDATE.';
COMMENT ON COLUMN core.attendance_days.unlock_count IS
  'Incremented BY THE TRIGGER, never by the caller, so it cannot be reset by the '
  'same hand that unlocked. A day that has been unlocked is not the same as a day '
  'that was never locked, and this count is how a compliance review sees the '
  'difference.';

CREATE INDEX IF NOT EXISTS ad_engagement_idx ON core.attendance_days (tenant_id, engagement_id, day);
SELECT app.finalise_table('core','attendance_days',false,NULL,ARRAY['engagement_id','day','on_date']);

CREATE TABLE IF NOT EXISTS core.attendance_entries (
  id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  attendance_day_id   uuid           NOT NULL,
  participant_id      uuid           NOT NULL,
  half                core.attendance_half NOT NULL,
  present             boolean        NOT NULL,
  marked_at           timestamptz,
  method              core.capture_method,
  absence_reason      core.absence_reason,
  signature_id        uuid,
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now(),
  created_by_kind     app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id       text           NOT NULL DEFAULT 'system',
  created_by_name     text,
  UNIQUE (tenant_id, attendance_day_id, participant_id, half),
  CONSTRAINT ae_day_fk FOREIGN KEY (tenant_id, attendance_day_id)
    REFERENCES core.attendance_days (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ae_participant_fk FOREIGN KEY (tenant_id, participant_id)
    REFERENCES core.participants (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ae_signature_fk FOREIGN KEY (tenant_id, signature_id)
    REFERENCES core.signatures (tenant_id, id) ON DELETE RESTRICT,
  -- Present means captured somehow; absent means a reason. An absence with no
  -- reason is the row HRD Corp asks about.
  CONSTRAINT ae_present_needs_method
    CHECK (present = false OR (method IS NOT NULL AND marked_at IS NOT NULL)),
  CONSTRAINT ae_absent_needs_reason
    CHECK (present = true OR absence_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ae_day_idx ON core.attendance_entries (tenant_id, attendance_day_id);
SELECT app.finalise_table('core','attendance_entries',false,NULL,
  ARRAY['attendance_day_id','participant_id','half']);

-- ── The lock ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION core.enforce_attendance_day_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
  -- LOCKED -> LOCKED: the approval facts freeze. Only updated_at may move.
  IF OLD.status = 'LOCKED' AND NEW.status = 'LOCKED' THEN
    IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION
        'ATTENDANCE_LOCKED: attendance for engagement % day % was approved on % and '
        'cannot be modified.', OLD.engagement_id, OLD.day, OLD.approved_at
        USING ERRCODE = 'integrity_constraint_violation',
              DETAIL = jsonb_build_object(
                'code','ATTENDANCE_LOCKED',
                'approvedAt', OLD.approved_at,
                'unlockPath','/v1/actions',
                'unlockActionType','ATTENDANCE_UNLOCK')::text;
    END IF;
    RETURN NEW;
  END IF;

  -- LOCKED -> anything else is an UNLOCK, and an unlock needs a reason.
  IF OLD.status = 'LOCKED' AND NEW.status <> 'LOCKED' THEN
    IF NEW.unlock_reason IS NULL OR btrim(NEW.unlock_reason) = '' THEN
      RAISE EXCEPTION
        'ATTENDANCE_UNLOCK_REASON_REQUIRED: unlocking attendance voids the HRD Corp '
        'claim packet and must state why.'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    -- The count is the trigger''s, not the caller''s.
    NEW.unlock_count := OLD.unlock_count + 1;
    NEW.unlocked_at  := now();
    NEW.immutable    := false;
    -- Capture reopens with the day.
    NEW.capture_qr := true; NEW.capture_signature := true; NEW.capture_manual := true;
    NEW.approved_at := NULL; NEW.approved_by_id := NULL;
    NEW.approved_by_kind := NULL; NEW.approved_by_name := NULL;
    RETURN NEW;
  END IF;

  -- anything -> LOCKED: capture closes with the day, and `immutable` follows.
  IF NEW.status = 'LOCKED' THEN
    NEW.immutable := true;
    NEW.capture_qr := false; NEW.capture_signature := false; NEW.capture_manual := false;
    IF NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
  ELSE
    NEW.immutable := false;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_attendance_days_lock ON core.attendance_days;
CREATE TRIGGER trg_attendance_days_lock
  BEFORE UPDATE ON core.attendance_days
  FOR EACH ROW EXECUTE FUNCTION core.enforce_attendance_day_lock();

-- The same rule on the CHILD table, because the writes happen to the entries and
-- the rule is about the day. Without this, a locked day's marks are freely
-- editable and the lock protects only its own approval columns.
CREATE OR REPLACE FUNCTION core.enforce_attendance_entry_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_status core.attendance_status; v_day smallint; v_eng uuid;
BEGIN
  SELECT status, day, engagement_id INTO v_status, v_day, v_eng
  FROM core.attendance_days
  WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
    AND id = COALESCE(NEW.attendance_day_id, OLD.attendance_day_id);

  IF v_status = 'LOCKED' THEN
    RAISE EXCEPTION
      'ATTENDANCE_LOCKED: attendance for engagement % day % is approved and cannot '
      'be modified.', v_eng, v_day
      USING ERRCODE = 'integrity_constraint_violation',
            DETAIL = jsonb_build_object(
              'code','ATTENDANCE_LOCKED',
              'unlockPath','/v1/actions',
              'unlockActionType','ATTENDANCE_UNLOCK')::text;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_attendance_entries_lock ON core.attendance_entries;
CREATE TRIGGER trg_attendance_entries_lock
  BEFORE INSERT OR UPDATE OR DELETE ON core.attendance_entries
  FOR EACH ROW EXECUTE FUNCTION core.enforce_attendance_entry_lock();

-- ═══ certificates, evaluations, messages ════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.certificates (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref            text,
  participant_id uuid           NOT NULL,
  engagement_id  uuid           NOT NULL,
  issued_at      timestamptz    NOT NULL DEFAULT now(),
  template_id    uuid,
  attachment_id  uuid,
  serial         text           NOT NULL,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'SYSTEM',
  created_by_id   text          NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, participant_id, engagement_id),
  UNIQUE (tenant_id, serial),
  CONSTRAINT cert_participant_fk FOREIGN KEY (tenant_id, participant_id)
    REFERENCES core.participants (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT cert_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT cert_template_fk FOREIGN KEY (tenant_id, template_id)
    REFERENCES core.templates (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT cert_attachment_fk FOREIGN KEY (tenant_id, attachment_id)
    REFERENCES core.attachments (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.finalise_table('core','certificates',true,'CRT',
  ARRAY['participant_id','engagement_id','serial','issued_at']);

CREATE TABLE IF NOT EXISTS core.evaluation_responses (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  engagement_id  uuid           NOT NULL,
  participant_id uuid,
  submitted_at   timestamptz    NOT NULL DEFAULT now(),
  overall_score  numeric(3,2)   CHECK (overall_score IS NULL OR overall_score BETWEEN 0 AND 5),
  answers        jsonb          NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'CLIENT',
  created_by_id   text          NOT NULL DEFAULT 'portal',
  created_by_name text,
  CONSTRAINT er_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT er_participant_fk FOREIGN KEY (tenant_id, participant_id)
    REFERENCES core.participants (tenant_id, id) ON DELETE SET NULL
);
COMMENT ON COLUMN core.evaluation_responses.participant_id IS
  'NULLABLE on purpose: an anonymous evaluation is a real evaluation, and forcing '
  'attribution would change what people write.';
CREATE UNIQUE INDEX IF NOT EXISTS er_one_per_participant_uq
  ON core.evaluation_responses (tenant_id, engagement_id, participant_id)
  WHERE participant_id IS NOT NULL;
SELECT app.finalise_table('core','evaluation_responses',false,NULL,
  ARRAY['engagement_id','participant_id','submitted_at']);

CREATE TABLE IF NOT EXISTS core.message_rates (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  channel        core.enquiry_channel NOT NULL,
  category       core.message_category NOT NULL,
  rate_exact     numeric(10,6) NOT NULL CHECK (rate_exact >= 0),
  currency       core.currency_code NOT NULL DEFAULT 'MYR',
  effective_from timestamptz NOT NULL,
  effective_to   timestamptz,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  source         text        NOT NULL CHECK (source IN ('BSP_API','MANUAL')),
  stale_after    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, category, effective_from)
);
COMMENT ON TABLE core.message_rates IS
  'Contract §16.4 asks what TTL applies to a WhatsApp rate and what the composer '
  'shows when the lookup fails. `stale_after` is the answer to the first and makes '
  'the second answerable: a rate past it is displayed as stale rather than as fact. '
  '`rate_exact` is numeric(10,6) because the BSP quotes RM 0.0564 and rounding that '
  'to the sen at storage time would lose the rate itself - the SEN figure is derived '
  'at estimate time, per the contract.';
SELECT app.finalise_table('core','message_rates',false,NULL,
  ARRAY['channel','category','effective_from','rate_exact']);

CREATE TABLE IF NOT EXISTS core.outbound_messages (
  id                     uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                    text,
  purpose                text           NOT NULL
                         CHECK (purpose IN ('FOLLOWUP','REMINDER','BROADCAST','JOINING_INSTRUCTIONS')),
  channel                core.enquiry_channel NOT NULL,
  template_id            uuid,
  category               core.message_category,
  contact_id             uuid,
  to_address             text           NOT NULL,
  follow_up_id           uuid,
  invoice_id             uuid,          -- FK added by 010
  engagement_id          uuid,
  body                   text           NOT NULL,
  status                 text           NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT','QUEUED','SENT','FAILED','CANCELLED')),
  sent_at                timestamptz,
  rate_per_message_sen   bigint         CHECK (rate_per_message_sen IS NULL OR rate_per_message_sen >= 0),
  rate_per_message_exact numeric(10,6),
  estimated_cost_sen     bigint         CHECK (estimated_cost_sen IS NULL OR estimated_cost_sen >= 0),
  actual_cost_sen        bigint         CHECK (actual_cost_sen IS NULL OR actual_cost_sen >= 0),
  currency               core.currency_code NOT NULL DEFAULT 'MYR',
  message_rate_id        uuid,
  consent_id             uuid,
  provider_message_id    text,
  created_at             timestamptz    NOT NULL DEFAULT now(),
  updated_at             timestamptz    NOT NULL DEFAULT now(),
  created_by_kind        app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id          text           NOT NULL DEFAULT 'agent_followup',
  created_by_name        text,
  CONSTRAINT om_template_fk FOREIGN KEY (tenant_id, template_id)
    REFERENCES core.templates (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT om_contact_fk FOREIGN KEY (tenant_id, contact_id)
    REFERENCES core.contacts (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT om_follow_up_fk FOREIGN KEY (tenant_id, follow_up_id)
    REFERENCES core.follow_ups (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT om_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT om_rate_fk FOREIGN KEY (tenant_id, message_rate_id)
    REFERENCES core.message_rates (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT om_consent_fk FOREIGN KEY (tenant_id, consent_id)
    REFERENCES core.contact_consents (tenant_id, id) ON DELETE RESTRICT,
  -- ⚠ A SENT MESSAGE MUST CITE THE CONSENT IT RELIED ON. Not "the contact had
  -- consented at the time" as a claim someone makes later - the row that granted
  -- it, by id. PDPA asks which permission a message was sent under, and a
  -- foreign key is the only answer that cannot be reconstructed favourably.
  CONSTRAINT om_sent_needs_consent
    CHECK (status <> 'SENT' OR (sent_at IS NOT NULL AND consent_id IS NOT NULL))
);
COMMENT ON TABLE core.outbound_messages IS
  'ONE table behind FOLLOWUP_SEND, REMINDER_SEND and BROADCAST_SEND. Three '
  'near-identical message tables would be exactly the divergence the project rules '
  'forbid, and would give three places for the consent check to be forgotten.';
CREATE UNIQUE INDEX IF NOT EXISTS om_provider_id_uq
  ON core.outbound_messages (tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS om_status_idx  ON core.outbound_messages (tenant_id, status, sent_at DESC);
CREATE INDEX IF NOT EXISTS om_invoice_idx ON core.outbound_messages (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS om_contact_idx ON core.outbound_messages (tenant_id, contact_id);
SELECT app.finalise_table('core','outbound_messages',true,'MSG',ARRAY['purpose','channel']);

-- ═══ Projections with one writer each ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION core.sync_engagement_trainers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.trainer_id IS NOT NULL THEN
    INSERT INTO core.engagement_trainers (tenant_id, engagement_id, trainer_id, role)
    VALUES (NEW.tenant_id, NEW.engagement_id, NEW.trainer_id, 'LEAD')
    ON CONFLICT (tenant_id, engagement_id, trainer_id) DO NOTHING;
  END IF;

  -- A trainer removed from their LAST session on an engagement stops being
  -- assigned to it. Without this the policy keeps showing them an engagement
  -- they are no longer on.
  IF TG_OP <> 'INSERT' AND OLD.trainer_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR NEW.trainer_id IS DISTINCT FROM OLD.trainer_id) THEN
    DELETE FROM core.engagement_trainers et
     WHERE et.tenant_id = OLD.tenant_id
       AND et.engagement_id = OLD.engagement_id
       AND et.trainer_id = OLD.trainer_id
       AND NOT EXISTS (
         SELECT 1 FROM core.sessions s
          WHERE s.tenant_id = OLD.tenant_id
            AND s.engagement_id = OLD.engagement_id
            AND s.trainer_id = OLD.trainer_id
            AND s.id <> OLD.id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;
REVOKE ALL ON FUNCTION core.sync_engagement_trainers() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sessions_sync_engagement_trainers ON core.sessions;
CREATE TRIGGER trg_sessions_sync_engagement_trainers
  AFTER INSERT OR UPDATE OR DELETE ON core.sessions
  FOR EACH ROW EXECUTE FUNCTION core.sync_engagement_trainers();

CREATE OR REPLACE FUNCTION core.sync_programme_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status = 'DELIVERED' AND OLD.status IS DISTINCT FROM 'DELIVERED' THEN
    UPDATE core.programmes SET deliveries_count = deliveries_count + 1
     WHERE tenant_id = NEW.tenant_id AND id = NEW.programme_id;
  ELSIF OLD.status = 'DELIVERED' AND NEW.status IS DISTINCT FROM 'DELIVERED' THEN
    UPDATE core.programmes SET deliveries_count = greatest(deliveries_count - 1, 0)
     WHERE tenant_id = NEW.tenant_id AND id = NEW.programme_id;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION core.sync_programme_deliveries() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_engagements_sync_deliveries ON core.engagements;
CREATE TRIGGER trg_engagements_sync_deliveries
  AFTER UPDATE OF status ON core.engagements
  FOR EACH ROW EXECUTE FUNCTION core.sync_programme_deliveries();

-- ═══ Deferred FKs now closable ══════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'tb_engagement_fk') THEN
    ALTER TABLE core.trainer_bookings
      ADD CONSTRAINT tb_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
      REFERENCES core.engagements (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'pa_engagement_fk') THEN
    ALTER TABLE core.portal_acceptances
      ADD CONSTRAINT pa_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
      REFERENCES core.engagements (tenant_id, id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══ Verify ═════════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND c.relname IN ('engagements','engagement_step_states','engagement_checklist_items',
                      'sessions','engagement_trainers','participants','attendance_days',
                      'attendance_entries','certificates','evaluation_responses',
                      'message_rates','outbound_messages');
  IF v_cnt <> 12 THEN
    RAISE EXCEPTION '008 verify: expected 12 delivery tables, found %', v_cnt;
  END IF;

  -- The lock must be enforced on BOTH tables. On the parent alone it protects
  -- only its own approval columns, and every mark on a locked day stays editable.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                 WHERE tgrelid = 'core.attendance_days'::regclass
                   AND tgname = 'trg_attendance_days_lock' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid = 'core.attendance_entries'::regclass
                      AND tgname = 'trg_attendance_entries_lock' AND NOT tgisinternal) THEN
    RAISE EXCEPTION
      '008 verify: the attendance lock is not enforced on BOTH attendance_days and '
      'attendance_entries. On the parent alone, every mark on a locked day is still '
      'editable.';
  END IF;

  RAISE NOTICE '008 verify: OK - 12 delivery tables, attendance locked on parent and child.';
END;
$verify$;

COMMIT;
