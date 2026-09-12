-- ============================================================================
-- Migration 005: sales — organisations, contacts and consent, enquiries and
-- their extraction, opportunities, follow-ups, and the needs analysis.
-- ============================================================================
--
-- FEATURE. The path from an inbound message to a qualified opportunity with a
-- signed-off needs analysis. Fourteen tables, all finalised through
-- `app.finalise_table` so they carry 004's standard posture and are deny-all
-- until 014.
--
-- FOUR MODELLING DECISIONS THAT ARE NOT OBVIOUS, AND WHY
--
--   1. `contact_consents` IS AN APPEND-ONLY LEDGER, NOT A FLAG. PDPA requires
--      the history: "did this person consent on 4 March 2024" has to stay
--      answerable after they withdraw. A boolean on `contacts` answers only
--      "today". Current state is a view, and `contacts.pdpa_flag` is a cache
--      for the relations panel, never the source.
--
--   2. `enquiry_extraction_fields` IS ONE ROW PER FIELD. Each extracted field
--      carries its own provenance and its own edit history — the contract shows
--      `topic` at 0.94 AI_GENERATED next to `timing` at 0.88 AI_SUGGESTED with
--      an `editedBy`. Four columns on `enquiries` could hold the values but not
--      four independent provenances, and a PATCH to one field would have to
--      rewrite a shared provenance row.
--
--   3. `organisations.proposal_count` and `first_proposal_sent_at` ARE
--      DENORMALISED ON PURPOSE, and this is the one place this migration adds
--      a second source of truth. Contract §16 Q3 asks who owns
--      `firstProposalToOrg`; doc 03 Phase-1 decision 7 answers it — computed
--      LIVE from a partial index on `proposals`, not denormalised. ⚠ These two
--      columns therefore exist as a CACHE for the organisation header only, and
--      the policy gate MUST NOT read them. Recorded as deviation D2; the
--      comment on each column says so, because a column that looks
--      authoritative and is not is exactly what a later author will trust.
--
--   4. `enquiries` CHECKS THAT A LOW-CONFIDENCE ITEM CANNOT BE ARCHIVED. The
--      contract says items below the classification threshold "are never
--      auto-archived". That is a sentence about a background job. The
--      constraint makes it a property of the data: while `needs_human_review`
--      stands, `status` cannot be `ARCHIVED`, whatever archived it.
--
-- ⚠ FORWARD REFERENCES, DEFERRED ON PURPOSE. Three columns here point at tables
-- that do not exist yet: `organisation_suggestions.programme_id` (006),
-- `follow_ups.proposal_id` (007) and `follow_ups.invoice_id` (010). The COLUMNS
-- are created here, because doc 01 puts them on these tables; the FOREIGN KEY
-- CONSTRAINTS are added by the migration that creates the target, each one
-- named in that migration's header. A column with no constraint is a real gap
-- for as long as it lasts, so test_005 T8 asserts the columns exist and
-- test_014 asserts every one of the three constraints has since been added —
-- the gap is tracked rather than hoped about.
--
-- SPINE: untouched. No action-envelope object is named by a byte of this
-- migration; the gate arrives in 011 and reads these tables, not the reverse.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   No RPC. Every table is RLS enabled and FORCED with zero policies (004's
--   finaliser), so nothing here is reachable by any client until 014.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope / 2. Unwrap: no RPC, no envelope.
--   3. RpcMap: no entries — these are Data API tables, not RPCs.
--   4. Call sites: none yet; 014 grants them, 016 seeds them.
--   5. Casts: none. 6. Reload/restore: no client behaviour.
--   7. Public routes: none. The portal reaches proposals in 007, never these.
--
-- Rollback: rollbacks/005_sales_organisations_enquiries_tna_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ organisations ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.organisations (
  id                     uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                    text,
  name                   text           NOT NULL,
  industry               text,
  location               text,
  owner_id               uuid           NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status                 core.organisation_status NOT NULL DEFAULT 'PROSPECT',
  hrdc_registered        boolean        NOT NULL DEFAULT false,
  hrdc_employer_code     text,
  proposal_count         integer        NOT NULL DEFAULT 0 CHECK (proposal_count >= 0),
  first_proposal_sent_at timestamptz,
  health_score           smallint       CHECK (health_score IS NULL OR health_score BETWEEN 0 AND 100),
  archived_at            timestamptz,
  created_at             timestamptz    NOT NULL DEFAULT now(),
  updated_at             timestamptz    NOT NULL DEFAULT now(),
  created_by_kind        app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id          text           NOT NULL DEFAULT 'system',
  created_by_name        text,
  CONSTRAINT organisations_hrdc_code_required
    CHECK (hrdc_registered = false OR hrdc_employer_code IS NOT NULL)
);

COMMENT ON COLUMN core.organisations.proposal_count IS
  '⚠ CACHE FOR THE HEADER ONLY. Contract s16 Q3 asks who owns firstProposalToOrg; '
  'doc 03 decision 7 answers it - computed LIVE from a partial index on proposals. '
  'The policy gate MUST NOT read this column. A stale cache here is a cosmetic '
  'header defect; a stale cache in the gate is an approval that should have fired '
  'and did not.';
COMMENT ON COLUMN core.organisations.first_proposal_sent_at IS
  'Same caveat as proposal_count: header display, never a policy input.';
COMMENT ON COLUMN core.organisations.health_score IS
  'Latest value from organisation_health_snapshots, denormalised for the record '
  'header. The snapshots table is the history and the source.';

CREATE UNIQUE INDEX IF NOT EXISTS organisations_hrdc_code_uq
  ON core.organisations (tenant_id, hrdc_employer_code) WHERE hrdc_employer_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS organisations_owner_idx  ON core.organisations (tenant_id, owner_id);
CREATE INDEX IF NOT EXISTS organisations_status_idx ON core.organisations (tenant_id, status);
-- ⌘K search (contract §2). Trigram, because the query is a substring match on a
-- name a user is half-remembering, which no b-tree prefix index serves.
CREATE INDEX IF NOT EXISTS organisations_name_trgm
  ON core.organisations USING gin (name extensions.gin_trgm_ops);

SELECT app.finalise_table('core','organisations',true,'ORG',ARRAY[]::text[]);

CREATE TABLE IF NOT EXISTS core.organisation_health_snapshots (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  organisation_id uuid           NOT NULL,
  score           smallint       NOT NULL CHECK (score BETWEEN 0 AND 100),
  components      jsonb          NOT NULL DEFAULT '{}'::jsonb,
  computed_at     timestamptz    NOT NULL DEFAULT now(),
  model_version   text           NOT NULL,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'SYSTEM',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,
  CONSTRAINT ohs_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ohs_org_computed_idx
  ON core.organisation_health_snapshots (tenant_id, organisation_id, computed_at DESC);
-- Append-only: every column is frozen, so a score cannot be revised after the
-- fact. A health history that can be edited is not a history.
SELECT app.finalise_table('core','organisation_health_snapshots',false,NULL,
  ARRAY['organisation_id','score','computed_at','model_version']);

-- ═══ contacts and consent ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.contacts (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref             text,
  organisation_id uuid           NOT NULL,
  name            text           NOT NULL,
  job_title       text,
  email           extensions.citext,
  phone           text,
  is_primary      boolean        NOT NULL DEFAULT false,
  pdpa_flag       text,
  redacted_at     timestamptz,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,
  CONSTRAINT contacts_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE RESTRICT,
  -- A contact with neither an email nor a phone cannot be contacted, which
  -- makes it a note rather than a contact.
  CONSTRAINT contacts_reachable CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

COMMENT ON COLUMN core.contacts.job_title IS
  'The contract calls this `role`. Renamed to avoid colliding with app_role, which '
  'is a permission and not a job.';
COMMENT ON COLUMN core.contacts.pdpa_flag IS
  'Cache of the consent ledger for the relations panel. core.contact_consents is '
  'the source; this column is never the answer to a legal question.';

CREATE UNIQUE INDEX IF NOT EXISTS contacts_one_primary_uq
  ON core.contacts (tenant_id, organisation_id) WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_uq
  ON core.contacts (tenant_id, organisation_id, lower(email))
  WHERE email IS NOT NULL AND redacted_at IS NULL;
CREATE INDEX IF NOT EXISTS contacts_org_idx  ON core.contacts (tenant_id, organisation_id);
CREATE INDEX IF NOT EXISTS contacts_name_trgm
  ON core.contacts USING gin (name extensions.gin_trgm_ops);

SELECT app.finalise_table('core','contacts',true,'CON',ARRAY['organisation_id']);

CREATE TABLE IF NOT EXISTS core.contact_consents (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  contact_id      uuid           NOT NULL,
  channel         core.enquiry_channel NOT NULL,
  granted         boolean        NOT NULL,
  recorded_at     timestamptz    NOT NULL,
  source          text,
  withdrawn_at    timestamptz,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, contact_id, channel, recorded_at),
  CONSTRAINT contact_consents_contact_fk FOREIGN KEY (tenant_id, contact_id)
    REFERENCES core.contacts (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.contact_consents IS
  'An APPEND-ONLY consent ledger, not a mutable flag. PDPA requires the history: '
  '"did this person consent on 4 March 2024" must stay answerable after they '
  'withdraw, and a boolean answers only "today". Current state is the view '
  'v_contact_consent_current. Only withdrawn_at is mutable - withdrawal is a new '
  'fact about an existing record, not a rewrite of it.';

CREATE INDEX IF NOT EXISTS contact_consents_current_idx
  ON core.contact_consents (tenant_id, contact_id, channel, recorded_at DESC);

SELECT app.finalise_table('core','contact_consents',false,NULL,
  ARRAY['contact_id','channel','granted','recorded_at']);

CREATE OR REPLACE VIEW core.v_contact_consent_current AS
SELECT DISTINCT ON (c.tenant_id, c.contact_id, c.channel)
       c.tenant_id, c.contact_id, c.channel,
       c.granted AND c.withdrawn_at IS NULL AS effective_granted,
       c.granted, c.recorded_at, c.withdrawn_at, c.source
FROM core.contact_consents c
ORDER BY c.tenant_id, c.contact_id, c.channel, c.recorded_at DESC;

COMMENT ON VIEW core.v_contact_consent_current IS
  'Current consent per (contact, channel). A view and not a column, so it cannot '
  'disagree with the ledger it summarises. security_invoker so the caller''s RLS '
  'on contact_consents applies - a view that bypassed it would be a cross-tenant '
  'read of exactly the data PDPA cares most about.';

ALTER VIEW core.v_contact_consent_current SET (security_invoker = true);

-- ═══ enquiries ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.enquiries (
  id                        uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                       text,
  channel                   core.enquiry_channel NOT NULL,
  status                    core.enquiry_status  NOT NULL DEFAULT 'OPEN',
  received_at               timestamptz    NOT NULL,
  from_name                 text,
  from_email                extensions.citext,
  from_phone                text,
  subject                   text,
  preview                   text,
  body                      text,
  classification_label      text,
  classification_confidence numeric(4,3)
                            CHECK (classification_confidence IS NULL
                                   OR classification_confidence BETWEEN 0 AND 1),
  needs_human_review        boolean        NOT NULL DEFAULT false,
  estimated_value_sen       bigint         CHECK (estimated_value_sen IS NULL OR estimated_value_sen >= 0),
  currency                  char(3)        NOT NULL DEFAULT 'MYR',
  matched_organisation_id   uuid,
  matched_contact_id        uuid,
  match_reason              core.organisation_match_reason,
  assigned_to_user_id       uuid           REFERENCES auth.users(id) ON DELETE SET NULL,
  external_message_id       text,
  created_at                timestamptz    NOT NULL DEFAULT now(),
  updated_at                timestamptz    NOT NULL DEFAULT now(),
  created_by_kind           app.actor_kind NOT NULL DEFAULT 'SYSTEM',
  created_by_id             text           NOT NULL DEFAULT 'ingest_email',
  created_by_name           text,
  CONSTRAINT enquiries_matched_org_fk FOREIGN KEY (tenant_id, matched_organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT enquiries_matched_contact_fk FOREIGN KEY (tenant_id, matched_contact_id)
    REFERENCES core.contacts (tenant_id, id) ON DELETE SET NULL,
  -- The contract's "never auto-archived" as a property of the data rather than a
  -- sentence about a background job. While the flag stands, nothing can archive
  -- the row - not the job, not a bulk action, not a hand-written UPDATE.
  CONSTRAINT enquiries_low_confidence_never_archived
    CHECK (needs_human_review = false OR status <> 'ARCHIVED'),
  -- A match without a reason is a match nobody can audit.
  CONSTRAINT enquiries_match_reason_present
    CHECK (matched_organisation_id IS NULL OR match_reason IS NOT NULL)
);

COMMENT ON COLUMN core.enquiries.preview IS
  'First ~160 characters, stored so the inbox list never reads `body`. The inbox is '
  'the highest-traffic screen in the product and body can be a full email thread.';
COMMENT ON COLUMN core.enquiries.external_message_id IS
  'The mail Message-ID or the WhatsApp messages[0].id. This is the STORAGE-LEVEL '
  'half of webhook idempotency; sb-events owns webhook_receipts, which is the other '
  'half. Two halves because a duplicate delivery must be rejected even if the '
  'receipt table has been pruned.';

CREATE UNIQUE INDEX IF NOT EXISTS enquiries_external_id_uq
  ON core.enquiries (tenant_id, channel, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS enquiries_inbox_idx    ON core.enquiries (tenant_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS enquiries_channel_idx  ON core.enquiries (tenant_id, channel);
CREATE INDEX IF NOT EXISTS enquiries_matched_idx  ON core.enquiries (tenant_id, matched_organisation_id);
CREATE INDEX IF NOT EXISTS enquiries_assigned_idx
  ON core.enquiries (tenant_id, assigned_to_user_id) WHERE status <> 'CONVERTED';
CREATE INDEX IF NOT EXISTS enquiries_subject_trgm
  ON core.enquiries USING gin (subject extensions.gin_trgm_ops);

SELECT app.finalise_table('core','enquiries',true,'ENQ',
  ARRAY['channel','received_at','external_message_id']);

CREATE TABLE IF NOT EXISTS core.enquiry_extraction_fields (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  enquiry_id      uuid           NOT NULL,
  field_key       text           NOT NULL,
  value           text,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id   text           NOT NULL DEFAULT 'agent_lead',
  created_by_name text,
  UNIQUE (tenant_id, enquiry_id, field_key),
  CONSTRAINT eef_enquiry_fk FOREIGN KEY (tenant_id, enquiry_id)
    REFERENCES core.enquiries (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.enquiry_extraction_fields IS
  'One row per extracted field, because each carries its OWN provenance and its own '
  'edit history: the contract shows `topic` at 0.94 AI_GENERATED beside `timing` at '
  '0.88 AI_SUGGESTED with an editedBy. Four columns on enquiries could hold the '
  'values but not four independent provenances. `value` may legitimately be NULL - '
  'the contract''s `budget: null` at 0.97 confidence is the model asserting there is '
  'no budget, which is not the same as not having looked.';

SELECT app.finalise_table('core','enquiry_extraction_fields',false,NULL,
  ARRAY['enquiry_id','field_key']);

-- ═══ opportunities, suggestions, follow-ups ═════════════════════════════════

CREATE TABLE IF NOT EXISTS core.opportunities (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                text,
  organisation_id    uuid           NOT NULL,
  primary_contact_id uuid,
  source_enquiry_id  uuid,
  owner_id           uuid           NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  stage              core.opportunity_stage NOT NULL DEFAULT 'NEW',
  value_sen          bigint         CHECK (value_sen IS NULL OR value_sen >= 0),
  currency           char(3)        NOT NULL DEFAULT 'MYR',
  probability        numeric(4,3)   CHECK (probability IS NULL OR probability BETWEEN 0 AND 1),
  stage_changed_at   timestamptz    NOT NULL DEFAULT now(),
  lost_reason        text,
  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now(),
  created_by_kind    app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id      text           NOT NULL DEFAULT 'system',
  created_by_name    text,
  CONSTRAINT opportunities_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT opportunities_contact_fk FOREIGN KEY (tenant_id, primary_contact_id)
    REFERENCES core.contacts (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT opportunities_enquiry_fk FOREIGN KEY (tenant_id, source_enquiry_id)
    REFERENCES core.enquiries (tenant_id, id) ON DELETE SET NULL,
  -- A lost deal with no reason teaches nobody anything, and "why did we lose"
  -- is the only question the pipeline report exists to answer.
  CONSTRAINT opportunities_lost_needs_reason
    CHECK (stage <> 'LOST' OR lost_reason IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS opportunities_one_per_enquiry_uq
  ON core.opportunities (tenant_id, source_enquiry_id) WHERE source_enquiry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS opportunities_stage_idx ON core.opportunities (tenant_id, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS opportunities_org_idx   ON core.opportunities (tenant_id, organisation_id);
CREATE INDEX IF NOT EXISTS opportunities_owner_idx ON core.opportunities (tenant_id, owner_id, stage);

COMMENT ON INDEX core.opportunities_one_per_enquiry_uq IS
  'One enquiry converts once. Without this, a double-clicked Convert button creates '
  'two opportunities for one enquiry and the pipeline total is wrong by the value of '
  'the deal - which is the number the managing director reads first.';

SELECT app.finalise_table('core','opportunities',true,'OPP',
  ARRAY['organisation_id','source_enquiry_id']);

CREATE TABLE IF NOT EXISTS core.organisation_suggestions (
  id                   uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  organisation_id      uuid           NOT NULL,
  suggestion_type      text           NOT NULL,
  programme_id         uuid,          -- FK added by 006, which creates core.programmes
  title                text           NOT NULL,
  rationale            text           NOT NULL,
  status               text           NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN','ACTED','DISMISSED')),
  dismissed_at         timestamptz,
  dismissed_by_user_id uuid           REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz    NOT NULL DEFAULT now(),
  updated_at           timestamptz    NOT NULL DEFAULT now(),
  created_by_kind      app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id        text           NOT NULL DEFAULT 'agent_knowledge',
  created_by_name      text,
  CONSTRAINT os_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT os_dismissed_pair
    CHECK ((status = 'DISMISSED') = (dismissed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS os_open_idx
  ON core.organisation_suggestions (tenant_id, organisation_id) WHERE status = 'OPEN';
SELECT app.finalise_table('core','organisation_suggestions',false,NULL,
  ARRAY['organisation_id','suggestion_type']);

CREATE TABLE IF NOT EXISTS core.follow_ups (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref             text,
  organisation_id uuid           NOT NULL,
  contact_id      uuid           NOT NULL,
  proposal_id     uuid,          -- FK added by 007
  invoice_id      uuid,          -- FK added by 010
  reason          text           NOT NULL,
  due_date        date           NOT NULL,
  status          core.follow_up_status NOT NULL DEFAULT 'DUE',
  autonomy        core.autonomy_level   NOT NULL DEFAULT 'SUGGEST',
  owner_id        uuid           NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id   text           NOT NULL DEFAULT 'agent_followup',
  created_by_name text,
  CONSTRAINT follow_ups_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT follow_ups_contact_fk FOREIGN KEY (tenant_id, contact_id)
    REFERENCES core.contacts (tenant_id, id) ON DELETE RESTRICT,
  -- At most one target. A follow-up chasing both a proposal and an invoice is
  -- two different conversations with the same customer.
  CONSTRAINT follow_ups_single_target CHECK (num_nonnulls(proposal_id, invoice_id) <= 1)
);

COMMENT ON COLUMN core.follow_ups.autonomy IS
  'A SNAPSHOT of the grant at creation time, not a live lookup, so the queue can '
  'explain why a given row is a draft rather than a send even after the matrix '
  'changes. The live level is app.autonomy_grants and the gate reads that.';

CREATE INDEX IF NOT EXISTS follow_ups_due_idx
  ON core.follow_ups (tenant_id, owner_id, due_date) WHERE status = 'DUE';
CREATE INDEX IF NOT EXISTS follow_ups_proposal_idx ON core.follow_ups (tenant_id, proposal_id);
CREATE INDEX IF NOT EXISTS follow_ups_invoice_idx  ON core.follow_ups (tenant_id, invoice_id);

SELECT app.finalise_table('core','follow_ups',true,'FUP',ARRAY['organisation_id','contact_id']);

-- ═══ needs analysis ═════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.tnas (
  id                        uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                       text,
  opportunity_id            uuid           NOT NULL,
  questionnaire_template_id uuid,
  status                    core.tna_status NOT NULL DEFAULT 'DRAFT',
  sent_at                   timestamptz,
  completed_at              timestamptz,
  completed_by_kind         app.actor_kind,
  completed_by_id           text,
  completed_by_name         text,
  audience_headcount        integer        CHECK (audience_headcount IS NULL OR audience_headcount > 0),
  audience_level            text,
  audience_sites            text[],
  audience_language         char(2),
  budget_sen                bigint         CHECK (budget_sen IS NULL OR budget_sen >= 0),
  currency                  char(3)        NOT NULL DEFAULT 'MYR',
  reopened_at               timestamptz,
  created_at                timestamptz    NOT NULL DEFAULT now(),
  updated_at                timestamptz    NOT NULL DEFAULT now(),
  created_by_kind           app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id             text           NOT NULL DEFAULT 'system',
  created_by_name           text,
  UNIQUE (tenant_id, opportunity_id),
  CONSTRAINT tnas_opportunity_fk FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES core.opportunities (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT tnas_template_fk FOREIGN KEY (tenant_id, questionnaire_template_id)
    REFERENCES core.templates (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT tnas_complete_needs_timestamp
    CHECK (status <> 'COMPLETE' OR completed_at IS NOT NULL)
);

COMMENT ON COLUMN core.tnas.budget_sen IS
  'NULL is meaningful and is not "unknown": the contract shows `budget: null` as the '
  'client declining to state one. The distinction survives because the column is '
  'nullable rather than defaulted to zero.';
COMMENT ON COLUMN core.tnas.audience_sites IS
  'Display-only, never filtered on - which is why it is an array column and not a '
  'child table. The rule in doc 01 is that anything a screen filters, sorts or groups '
  'by is a column of its own.';

SELECT app.finalise_table('core','tnas',true,'TNA',ARRAY['opportunity_id']);

CREATE TABLE IF NOT EXISTS core.tna_constraints (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  tna_id          uuid           NOT NULL,
  code            text           NOT NULL,
  label           text           NOT NULL,
  severity        core.severity,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text           NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, tna_id, code),
  CONSTRAINT tna_constraints_tna_fk FOREIGN KEY (tenant_id, tna_id)
    REFERENCES core.tnas (tenant_id, id) ON DELETE CASCADE
);
SELECT app.finalise_table('core','tna_constraints',false,NULL,ARRAY['tna_id','code']);

CREATE TABLE IF NOT EXISTS core.tna_gaps (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  tna_id          uuid           NOT NULL,
  name            text           NOT NULL,
  description     text,
  priority        core.gap_priority NOT NULL,
  evidence_refs   text[]         NOT NULL DEFAULT '{}',
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id   text           NOT NULL DEFAULT 'agent_tna',
  created_by_name text,
  CONSTRAINT tna_gaps_tna_fk FOREIGN KEY (tenant_id, tna_id)
    REFERENCES core.tnas (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN core.tna_gaps.evidence_refs IS
  'Questionnaire question ids ("Q4", "Q7"), NOT entity refs. Named evidence_refs in '
  'the contract, and the ambiguity is worth the comment: nothing here joins to a '
  'record.';
CREATE INDEX IF NOT EXISTS tna_gaps_priority_idx ON core.tna_gaps (tenant_id, tna_id, priority);
SELECT app.finalise_table('core','tna_gaps',false,NULL,ARRAY['tna_id']);

CREATE TABLE IF NOT EXISTS core.tna_evidence (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  tna_id          uuid           NOT NULL,
  source_type     core.evidence_type NOT NULL,
  source_ref      text           NOT NULL,
  excerpt         text,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id   text           NOT NULL DEFAULT 'agent_tna',
  created_by_name text,
  CONSTRAINT tna_evidence_tna_fk FOREIGN KEY (tenant_id, tna_id)
    REFERENCES core.tnas (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE core.tna_evidence IS
  '⚠ CONSOLIDATION CANDIDATE, flagged not resolved. The (source_type, source_ref, '
  'excerpt) triple appears here, in sb-money''s provenance_sources, and in '
  'sb-actions'' action_evidence. Three tables, one shape. Unifying it needs all '
  'three lanes to agree and is not this migration''s to decide - doc 01 raises it in '
  'its own Deviations section and it is repeated here so it is visible at the point '
  'someone would otherwise add a fourth.';
SELECT app.finalise_table('core','tna_evidence',false,NULL,ARRAY['tna_id']);

CREATE TABLE IF NOT EXISTS core.tna_recommendations (
  id                     uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  tna_id                 uuid           NOT NULL,
  programme_id           uuid           NOT NULL,   -- FK added by 006
  fit_score              numeric(4,3)   NOT NULL CHECK (fit_score BETWEEN 0 AND 1),
  rationale              text,
  price_indication_sen   bigint         CHECK (price_indication_sen IS NULL OR price_indication_sen >= 0),
  currency               char(3)        NOT NULL DEFAULT 'MYR',
  rank                   smallint,
  scoring_model_version  text           NOT NULL,
  scoring_weights        jsonb          NOT NULL DEFAULT '{}'::jsonb,
  accepted_at            timestamptz,
  created_at             timestamptz    NOT NULL DEFAULT now(),
  updated_at             timestamptz    NOT NULL DEFAULT now(),
  created_by_kind        app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id          text           NOT NULL DEFAULT 'agent_tna',
  created_by_name        text,
  UNIQUE (tenant_id, tna_id, programme_id),
  CONSTRAINT tna_recs_tna_fk FOREIGN KEY (tenant_id, tna_id)
    REFERENCES core.tnas (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN core.tna_recommendations.scoring_model_version IS
  'NOT NULL on purpose. The contract returns a scoringModel with weights, and a '
  'recommendation whose model version is unknown cannot be re-explained to a client '
  'who asks six months later why programme A scored 0.91 and B scored 0.78.';
CREATE INDEX IF NOT EXISTS tna_recs_fit_idx
  ON core.tna_recommendations (tenant_id, tna_id, fit_score DESC);
SELECT app.finalise_table('core','tna_recommendations',false,NULL,
  ARRAY['tna_id','programme_id','scoring_model_version']);


-- ═══ Verify ═════════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_cnt int; v_bad text;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND c.relname IN ('organisations','organisation_health_snapshots','contacts',
                      'contact_consents','enquiries','enquiry_extraction_fields',
                      'opportunities','organisation_suggestions','follow_ups','tnas',
                      'tna_constraints','tna_gaps','tna_evidence','tna_recommendations');
  IF v_cnt <> 14 THEN
    RAISE EXCEPTION '005 verify: expected 14 sales tables, found %', v_cnt;
  END IF;

  -- Every FK into a tenant-scoped parent must be COMPOSITE. A single-column FK
  -- makes a cross-tenant reference representable again, which is the one
  -- guarantee this model buys at the storage layer rather than in RLS.
  SELECT string_agg(format('%s.%s', c.relname, k.conname), ', ') INTO v_bad
  FROM pg_catalog.pg_constraint k
  JOIN pg_catalog.pg_class c  ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_class pc ON pc.oid = k.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE n.nspname = 'core' AND k.contype = 'f'
    AND pn.nspname = 'core'
    AND array_length(k.conkey, 1) < 2;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '005 verify: single-column FK(s) into a core parent: %. Every FK in this model '
      'is (tenant_id, parent_id) so a cross-tenant reference is unrepresentable.', v_bad;
  END IF;

  -- The deferred forward references: columns present, constraints deliberately
  -- absent until their target exists.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                 WHERE attrelid = 'core.follow_ups'::regclass AND attname = 'proposal_id') THEN
    RAISE EXCEPTION '005 verify: follow_ups.proposal_id missing';
  END IF;

  RAISE NOTICE '005 verify: OK - 14 sales tables, every core FK composite.';
END;
$verify$;

COMMIT;
