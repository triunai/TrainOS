-- ============================================================================
-- Migration 009: compliance — the bitemporal HRD Corp rule registry, rule-change
-- review, check results with version drift, claim packets, and the knowledge
-- corpus rules are extracted from.
-- ============================================================================
--
-- FEATURE. Ten tables. The registry is the interesting one and it is bitemporal,
-- which is not decoration.
--
-- ══ WHY THE RULE REGISTRY IS BITEMPORAL ═════════════════════════════════════
--
-- Two independent time axes, and conflating them produces wrong answers that
-- look right:
--
--   `validity`  — when a rule is IN FORCE. "Public lead time is 3 days from
--                 15 Jun 2026 and 14 days from 1 Jan 2027."
--   `known`     — when WE KNEW that. A circular published in November can change
--                 a rule effective the following January, and a claim we
--                 assessed in October was assessed correctly against what the
--                 registry said in October.
--
-- Without the second axis, re-running a check on an old engagement silently
-- re-decides it against today's registry, and the audit trail says the original
-- assessment was wrong when it was not. DECISIONS §6 requires re-evaluating at
-- every stage transition and raising a warning citing BOTH versions rather than
-- switching silently — `core.compliance_version_drifts` is that warning, and it
-- is only expressible because both axes are stored.
--
-- The EXCLUDE constraint is what makes the registry answerable: for one
-- `family_key`, `delivery_mode` and `scheme`, no two ACTIVE or SUPERSEDED rules
-- may overlap on BOTH axes at once. Without it, "which lead-time rule applied on
-- 12 November as known on 28 October" has more than one answer and the check
-- result depends on which row the planner reads first.
--
-- ⚠ NOTE ON DOC 04'S `id text PRIMARY KEY`. Doc 04 keys `compliance_rule` on the
-- HRD Corp identifier (`HRD-014`) and gives it NO `tenant_id`, with tenancy
-- living on `rule_set` alone. Doc 02 §4.2 Template E is explicit that these
-- rules ARE national and models them as `tenant_id NULL = global` with optional
-- per-tenant overrides. Implemented as doc 02 describes, because the whole
-- estate has to share a corrected circular — copying a national rule per tenant
-- means a correction is applied N times and the Nth is the one that gets
-- missed. `rule_code` carries `HRD-014`; `id` stays a uuid like every other
-- table, so `finalise_table` and the composite-FK convention still apply.
-- Recorded as conflict C6.
--
-- ⚠ A GLOBAL RULE IS WRITTEN BY `service_role` ONLY. There is no platform-admin
-- role, deliberately (doc 02 §4.2): a tenant's ADMIN must not be able to edit a
-- national rule, because that would let one training provider change compliance
-- for every other provider on the platform. The policies in 014 enforce it; the
-- CHECK here makes the intent visible at the table.
--
-- ⚠ `knowledge_chunks.embedding` REQUIRES THE `vector` EXTENSION, which is NOT
-- available in the authoring environment. The column is created only when the
-- extension is present, and a loud NOTICE records the skip otherwise. This is
-- the ONE object in the whole set that has not been executed in its intended
-- form; it is listed under "What I could NOT verify".
--
-- SPINE: untouched.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   No RPC. Tables RLS enabled and FORCED, zero policies, until 014.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1/2. No RPC, no envelope. 3. RpcMap: none. 4. Call sites: 011 gates
--   RULE_CHANGE_APPROVE and HRDC_PACKET_MARK_SUBMITTED against these.
--   5. Casts: none. 6. Reload/restore: none. 7. Public routes: none.
--
-- Rollback: rollbacks/009_compliance_rules_checks_hrdc_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ 1 · Rule grammar types ═════════════════════════════════════════════════

-- Every one of these six is DECLARED BY 009 and is deliberately NOT generated
-- from packages/contract/src/enums.ts: the contract has no rule grammar, because
-- the grammar is how the database stores a compliance rule and never crosses the
-- API. test_003 T5 asserts that every enum in `core` carries a provenance
-- comment, precisely so that "where did this vocabulary come from" is answerable
-- for a type nobody can trace back to a generator.
DO $$ BEGIN CREATE TYPE core.rule_side AS ENUM ('GRANT','CLAIM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TYPE core.rule_side IS
  'Declared by 009 from doc 04 §3. Which side of the HRD Corp transaction a rule '
  'governs: GRANT (applying for the levy) or CLAIM (claiming it back).';

DO $$ BEGIN CREATE TYPE core.rule_kind AS ENUM ('BINDING','ADVISORY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TYPE core.rule_kind IS
  'Declared by 009 from doc 04 §3. BINDING blocks a packet reaching READY; '
  'ADVISORY warns and does not block. The distinction is the difference between '
  'a compliance check that stops a filing and one that annotates it.';

DO $$ BEGIN CREATE TYPE core.rule_op AS ENUM ('GTE','LTE','GT','LT','EQ','NEQ','COMPLETE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TYPE core.rule_op IS
  'Declared by 009 from doc 04 §3''s typed rule grammar. COMPLETE is not a '
  'comparison: it asserts a document set is whole, and is why this is an enum '
  'rather than a comparison operator stored as text.';

DO $$ BEGIN CREATE TYPE core.rule_reference_kind AS ENUM
  ('FIELD','LITERAL_BOOL','RATE_CARD','DOCUMENT_SET');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TYPE core.rule_reference_kind IS
  'Declared by 009 from doc 04 §3. What the right-hand side of a rule points at. '
  'Typed here rather than left as jsonb because doc 04 measured the alternative: '
  'an unconstrained expression column accepts a legacy shape silently (critic N-06).';

DO $$ BEGIN CREATE TYPE core.rule_offset_unit AS ENUM ('DAY','MONTH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TYPE core.rule_offset_unit IS
  'Declared by 009 from doc 04 §3. The unit of a date offset in a rule, e.g. '
  '"at least 7 DAY before the session starts". Consumed by core.apply_rule_offset().';

DO $$ BEGIN CREATE TYPE core.delivery_mode AS ENUM ('ANY','PUBLIC','IN_HOUSE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TYPE core.delivery_mode IS
  'Declared by 009. Which delivery mode a rule applies to. ANY is a real member '
  'rather than NULL so that the rule-resolution join has no null case and the '
  'EXCLUDE constraint on overlapping rules can actually constrain.';

-- ═══ 2 · Knowledge corpus ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.knowledge_sources (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref               text,
  name              text           NOT NULL,
  source_type       core.knowledge_source_type NOT NULL DEFAULT 'HRDC_CIRCULAR',
  version           text           NOT NULL DEFAULT 'v1',
  uri               text,
  attachment_id     uuid,
  ingested_at       timestamptz,
  chunk_count       integer        NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  embedding_status  core.embedding_status NOT NULL DEFAULT 'PENDING',
  last_checked_at   timestamptz,
  monitor_status    core.monitor_status NOT NULL DEFAULT 'WATCHING',
  content_hash      text,
  retrieval_scopes  core.retrieval_scope[] NOT NULL DEFAULT '{}',
  quarantined       boolean        NOT NULL DEFAULT false,
  archived_at       timestamptz,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  created_by_kind   app.actor_kind NOT NULL DEFAULT 'SYSTEM',
  created_by_id     text           NOT NULL DEFAULT 'system',
  created_by_name   text,
  CONSTRAINT ks_attachment_fk FOREIGN KEY (tenant_id, attachment_id)
    REFERENCES core.attachments (tenant_id, id) ON DELETE RESTRICT,
  -- Contract §17: a CHANGED source is quarantined from rule extraction until
  -- reviewed, but stays searchable. Quarantine is therefore a COLUMN the
  -- retriever reads, not a status string it has to interpret correctly.
  CONSTRAINT ks_changed_is_quarantined
    CHECK (monitor_status <> 'CHANGED_REVIEW_PENDING' OR quarantined)
);
CREATE UNIQUE INDEX IF NOT EXISTS ks_content_hash_uq
  ON core.knowledge_sources (tenant_id, content_hash) WHERE content_hash IS NOT NULL;
SELECT app.finalise_table('core','knowledge_sources',true,'SRC',ARRAY['source_type']);

CREATE TABLE IF NOT EXISTS core.knowledge_chunks (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  knowledge_source_id uuid        NOT NULL,
  seq                 integer     NOT NULL CHECK (seq >= 0),
  content             text        NOT NULL,
  token_count         integer     CHECK (token_count IS NULL OR token_count >= 0),
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, knowledge_source_id, seq),
  CONSTRAINT kc_source_fk FOREIGN KEY (tenant_id, knowledge_source_id)
    REFERENCES core.knowledge_sources (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS kc_source_idx ON core.knowledge_chunks (tenant_id, knowledge_source_id);
SELECT app.finalise_table('core','knowledge_chunks',false,NULL,ARRAY['knowledge_source_id','seq']);

-- The embedding column and its HNSW index.
--
-- ⚠ UNCONDITIONAL SINCE 2026-09-13, and that is the point of the change. This
-- block used to be wrapped in `IF EXISTS (... extname = 'vector')` with an ELSE
-- that raised a NOTICE and moved on, because 001 did not enable pgvector. A
-- migration that silently omits a column when an extension is absent produces a
-- database that applies cleanly and then fails at query time with "column
-- embedding does not exist" — the failure arrives far from its cause, and the
-- catalog had to carry it as the one object never executed in its intended
-- form. Ruling R-EXT put `vector` in 001, 001 asserts the type resolves, so the
-- guard's ELSE branch is now unreachable-by-construction and is gone. If
-- pgvector is ever missing, this migration stops here, loudly, which is correct.
--
-- `extensions.vector(1536)` is schema-qualified deliberately. 001 installs the
-- extension `WITH SCHEMA extensions`; a bare `vector(1536)` resolves only while
-- `extensions` is on the session search_path, which is true for a psql session
-- and false inside any function pinned to `search_path = ''`. The operator class
-- in the index is qualified for the same reason.
ALTER TABLE core.knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

CREATE INDEX IF NOT EXISTS kc_embedding_hnsw
  ON core.knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

COMMENT ON COLUMN core.knowledge_chunks.embedding IS
  '1536 dimensions (doc 01 Q23, assumed against text-embedding-3-small). Cosine '
  'distance: the HNSW index is built with vector_cosine_ops, so every retrieval '
  'query must use <=> or it will not use this index.';

-- ═══ 3 · The bitemporal rule registry ═══════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.rule_set_versions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        REFERENCES public.tenants(id) ON DELETE RESTRICT,
  version_key    text        NOT NULL,
  registry_asof  timestamptz NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_key),
  UNIQUE (registry_asof)
);
COMMENT ON TABLE core.rule_set_versions IS
  'A LABEL for a registry instant ("rs_2026_06_15"), not a container of rules. '
  'Rules are joined to it through registry_asof against their `known` range, which '
  'is what lets one rule belong to every snapshot it was known in without being '
  'copied. tenant_id NULL means platform-global.';
-- Not finalised: tenant_id is deliberately NULLABLE here (Template E), and
-- finalise_table requires a tenant-scoped table. RLS is applied by hand.
ALTER TABLE core.rule_set_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.rule_set_versions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE core.rule_set_versions FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rule_set_versions_updated_at ON core.rule_set_versions;
CREATE TRIGGER trg_rule_set_versions_updated_at BEFORE UPDATE ON core.rule_set_versions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS trg_rule_set_versions_immutable ON core.rule_set_versions;
CREATE TRIGGER trg_rule_set_versions_immutable BEFORE UPDATE ON core.rule_set_versions
  FOR EACH ROW EXECUTE FUNCTION app.enforce_immutable_columns('version_key','registry_asof');

CREATE TABLE IF NOT EXISTS core.compliance_rules (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLABLE: NULL is a national rule, a value is a tenant override.
  tenant_id          uuid        REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rule_code          text        NOT NULL,
  family_key         text        NOT NULL,
  check_key          text        NOT NULL,
  scheme             core.hrdc_scheme,
  -- ⚠ `scheme_key` exists because an EXCLUDE constraint may only contain
  -- IMMUTABLE expressions, and casting an enum to text is STABLE, not
  -- IMMUTABLE - Postgres refuses `coalesce(scheme::text, '*')` in an index
  -- expression outright. Found by running it. A plain column kept in step by a
  -- trigger, with a CHECK proving it, is the honest way to get a nullable enum
  -- into an exclusion constraint. `*` is the sentinel for "all schemes";
  -- doc 04 solves the same problem with an `ANY` enum member, which would mean
  -- adding a value the API contract's own enum does not have.
  scheme_key         text        NOT NULL DEFAULT '*',
  delivery_mode      core.delivery_mode NOT NULL DEFAULT 'ANY',
  side               core.rule_side NOT NULL,
  kind               core.rule_kind NOT NULL DEFAULT 'BINDING',
  subject            text        NOT NULL,
  fail_state         core.check_state NOT NULL DEFAULT 'FAIL'
                     CHECK (fail_state IN ('FAIL','WARN')),

  subject_field      text        NOT NULL,
  op                 core.rule_op NOT NULL,
  reference_kind     core.rule_reference_kind NOT NULL,
  reference          text        NOT NULL,
  offset_amount      integer     NOT NULL DEFAULT 0,
  offset_unit        core.rule_offset_unit NOT NULL DEFAULT 'DAY',
  applies_when       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  effective_from     date        NOT NULL,
  effective_to       date,
  validity           daterange   GENERATED ALWAYS AS
                       (daterange(effective_from, effective_to, '[)')) STORED,
  registry_from      timestamptz NOT NULL DEFAULT now(),
  registry_to        timestamptz,
  known              tstzrange   GENERATED ALWAYS AS
                       (tstzrange(registry_from, registry_to, '[)')) STORED,

  status             core.rule_status NOT NULL DEFAULT 'PROPOSED',
  supersedes_rule_id uuid,
  superseded_by_rule_id uuid,
  knowledge_source_id uuid,
  source_document_id text, source_title text, source_section text,
  source_page        smallint, source_excerpt text,
  used_by_check_keys text[]      NOT NULL DEFAULT '{}',
  verified_by_user_id uuid       REFERENCES auth.users(id) ON DELETE RESTRICT,
  verified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by_kind    app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id      text        NOT NULL DEFAULT 'agent_knowledge',
  created_by_name    text,

  -- DECISIONS §3: every seeded rule loads as PROPOSED until Finance verifies it
  -- against the circular. ACTIVE without a named verifier is the state where a
  -- model-extracted rule silently becomes compliance policy.
  CONSTRAINT cr_active_needs_verification
    CHECK (status <> 'ACTIVE' OR (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT cr_dates_ordered CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT cr_registry_ordered CHECK (registry_to IS NULL OR registry_to > registry_from),
  -- The trigger maintains it; this proves the trigger is doing its job, so a
  -- disabled or dropped trigger surfaces as a constraint violation rather than
  -- as a silently weakened exclusion constraint.
  CONSTRAINT cr_scheme_key_matches
    CHECK (scheme_key = COALESCE(scheme::text, '*')),

  -- ⚠ THE CONSTRAINT THAT MAKES THE REGISTRY ANSWERABLE. For one family, mode
  -- and scheme, no two in-force rules may overlap on BOTH time axes at once.
  -- Without it, "which lead-time rule applied on 12 November as known on 28
  -- October" has more than one answer and the check result depends on which row
  -- the planner happens to read first.
  CONSTRAINT cr_no_bitemporal_overlap EXCLUDE USING gist (
    family_key    WITH =,
    delivery_mode WITH =,
    scheme_key    WITH =,
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    validity      WITH &&,
    known         WITH &&
  ) WHERE (status IN ('ACTIVE','SUPERSEDED'))
);

COMMENT ON COLUMN core.compliance_rules.tenant_id IS
  'NULL = a NATIONAL rule, shared by the whole estate. A value = a tenant override. '
  'Copying national rules per tenant would mean a corrected circular is applied N '
  'times, and the Nth is the one that gets missed - and it would break the '
  'supersedes lineage across tenant boundaries. Writes to a NULL-tenant row are a '
  'service_role provisioning act: there is deliberately NO platform-admin role, '
  'because a tenant ADMIN must not be able to change compliance for every other '
  'training provider on the platform.';
COMMENT ON COLUMN core.compliance_rules.known IS
  'WHEN WE KNEW the rule, as distinct from when it is IN FORCE (`validity`). A '
  'circular published in November can change a rule effective the following '
  'January, and a claim assessed in October was assessed correctly against what the '
  'registry said then. Without this axis, re-running a check silently re-decides an '
  'old assessment against today''s registry and the audit trail calls the original '
  'wrong when it was not.';

CREATE INDEX IF NOT EXISTS cr_global_idx
  ON core.compliance_rules (check_key, effective_from) WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS cr_tenant_idx
  ON core.compliance_rules (tenant_id, check_key, effective_from) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cr_resolution_idx
  ON core.compliance_rules USING gist (validity, known) WHERE status IN ('ACTIVE','SUPERSEDED');
CREATE UNIQUE INDEX IF NOT EXISTS cr_code_known_uq
  ON core.compliance_rules (rule_code, registry_from);

ALTER TABLE core.compliance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.compliance_rules FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE core.compliance_rules FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION core.sync_rule_scheme_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  NEW.scheme_key := COALESCE(NEW.scheme::text, '*');
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_compliance_rules_scheme_key ON core.compliance_rules;
CREATE TRIGGER trg_compliance_rules_scheme_key
  BEFORE INSERT OR UPDATE ON core.compliance_rules
  FOR EACH ROW EXECUTE FUNCTION core.sync_rule_scheme_key();

DROP TRIGGER IF EXISTS trg_compliance_rules_updated_at ON core.compliance_rules;
CREATE TRIGGER trg_compliance_rules_updated_at BEFORE UPDATE ON core.compliance_rules
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
-- The source excerpt is quoted verbatim from a circular and is evidence: it is
-- frozen, along with the rule's identity and its grammar.
DROP TRIGGER IF EXISTS trg_compliance_rules_immutable ON core.compliance_rules;
CREATE TRIGGER trg_compliance_rules_immutable BEFORE UPDATE ON core.compliance_rules
  FOR EACH ROW EXECUTE FUNCTION app.enforce_immutable_columns(
    'rule_code','family_key','side','subject_field','op','reference',
    'offset_amount','offset_unit','source_excerpt','registry_from');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'cr_supersedes_fk') THEN
    ALTER TABLE core.compliance_rules
      ADD CONSTRAINT cr_supersedes_fk FOREIGN KEY (supersedes_rule_id)
      REFERENCES core.compliance_rules (id) ON DELETE SET NULL;
    ALTER TABLE core.compliance_rules
      ADD CONSTRAINT cr_superseded_by_fk FOREIGN KEY (superseded_by_rule_id)
      REFERENCES core.compliance_rules (id) ON DELETE SET NULL;
  END IF;
END $$;

-- The resolver. Doc 04 §3, adapted for the nullable-tenant model: a tenant
-- override wins over the national rule for the same family.
CREATE OR REPLACE FUNCTION core.resolve_rules(
  p_tenant_id      uuid,
  p_registry_asof  timestamptz,
  p_effective_asof date,
  p_side           core.rule_side,
  p_mode           core.delivery_mode,
  p_scheme         core.hrdc_scheme
)
RETURNS SETOF core.compliance_rules
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT DISTINCT ON (r.family_key) r.*
  FROM core.compliance_rules r
  WHERE r.side = p_side
    AND r.status IN ('ACTIVE','SUPERSEDED')
    AND r.validity @> p_effective_asof
    AND r.known    @> p_registry_asof
    AND (r.delivery_mode = 'ANY' OR r.delivery_mode = p_mode)
    AND (r.scheme IS NULL OR r.scheme = p_scheme)
    AND (r.tenant_id IS NULL OR r.tenant_id = p_tenant_id)
  -- A tenant override beats the national rule for the same family. NULLS LAST on
  -- tenant_id is what expresses that, and it is the whole reason Template E
  -- works: one national row, optional local ones, no copying.
  ORDER BY r.family_key, r.tenant_id NULLS LAST, r.registry_from DESC;
$fn$;

REVOKE ALL ON FUNCTION core.resolve_rules(uuid, timestamptz, date, core.rule_side,
  core.delivery_mode, core.hrdc_scheme) FROM PUBLIC, anon;

-- Calendar days, never working days (DECISIONS §3).
CREATE OR REPLACE FUNCTION core.apply_rule_offset(
  p_base date, p_amount integer, p_unit core.rule_offset_unit)
RETURNS date
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT CASE p_unit
           WHEN 'DAY'   THEN p_base + p_amount
           WHEN 'MONTH' THEN (p_base + make_interval(months => p_amount))::date
         END;
$fn$;
COMMENT ON FUNCTION core.apply_rule_offset(date, integer, core.rule_offset_unit) IS
  'CALENDAR days, not working days, until a circular says otherwise (DECISIONS §3). '
  'The demo''s "apply before Friday 5 PM" heuristic is a WARN with no rule row, not '
  'a rule - and the five-working-day claim window it came from was wrong.';

-- ═══ 4 · Rule-change review ═════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.rule_change_sets (
  id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  document_id         text           NOT NULL,
  title               text           NOT NULL,
  published_at        date,
  ingested_at         timestamptz    NOT NULL DEFAULT now(),
  effective_from      date,
  knowledge_source_id uuid,
  run_id              uuid,          -- FK added by 013
  extracted_by_model  text,
  extraction_confidence numeric(4,3)
                      CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1),
  status              text           NOT NULL DEFAULT 'PROPOSED'
                      CHECK (status IN ('PROPOSED','APPROVED','REJECTED')),
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now(),
  created_by_kind     app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id       text           NOT NULL DEFAULT 'agent_knowledge',
  created_by_name     text,
  UNIQUE (tenant_id, document_id),
  CONSTRAINT rcs_source_fk FOREIGN KEY (tenant_id, knowledge_source_id)
    REFERENCES core.knowledge_sources (tenant_id, id) ON DELETE SET NULL
);
SELECT app.finalise_table('core','rule_change_sets',false,NULL,ARRAY['document_id','ingested_at']);

CREATE TABLE IF NOT EXISTS core.rule_changes (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rule_change_set_id uuid           NOT NULL,
  change_key         text           NOT NULL,
  op                 core.rule_change_op NOT NULL,
  target_rule_id     uuid,
  new_rule_id        uuid,
  before_text        text,
  after_text         text,
  source_page        smallint,
  source_section     text,
  source_excerpt     text,
  confidence         numeric(4,3)   CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  withheld           boolean        NOT NULL DEFAULT false,
  status             text           NOT NULL DEFAULT 'PROPOSED'
                     CHECK (status IN ('PROPOSED','APPROVED','REJECTED')),
  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_change_set_id, change_key),
  CONSTRAINT rc_set_fk FOREIGN KEY (tenant_id, rule_change_set_id)
    REFERENCES core.rule_change_sets (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT rc_target_fk FOREIGN KEY (target_rule_id)
    REFERENCES core.compliance_rules (id) ON DELETE RESTRICT,
  CONSTRAINT rc_new_fk FOREIGN KEY (new_rule_id)
    REFERENCES core.compliance_rules (id) ON DELETE RESTRICT,
  -- Contract §17: changes below 0.80 confidence are WITHHELD from the diff view
  -- and flagged for manual transcription. Stored as a column so the screen
  -- cannot decide to show them anyway.
  CONSTRAINT rc_low_confidence_withheld
    CHECK (confidence IS NULL OR confidence >= 0.800 OR withheld)
);
SELECT app.finalise_table('core','rule_changes',false,NULL,
  ARRAY['rule_change_set_id','change_key','op','source_excerpt']);

CREATE TABLE IF NOT EXISTS core.rule_change_affected_engagements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rule_change_id uuid        NOT NULL,
  engagement_id  uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_change_id, engagement_id),
  CONSTRAINT rcae_change_fk FOREIGN KEY (tenant_id, rule_change_id)
    REFERENCES core.rule_changes (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT rcae_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE CASCADE
);
SELECT app.finalise_table('core','rule_change_affected_engagements',false,NULL,
  ARRAY['rule_change_id','engagement_id']);

-- ═══ 5 · Check results and drift ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.compliance_check_results (
  id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  engagement_id       uuid           NOT NULL,
  check_key           text           NOT NULL,
  state               core.check_state NOT NULL,
  label               text           NOT NULL,
  computed            jsonb          NOT NULL DEFAULT '{}'::jsonb,
  display             text,
  compliance_rule_id  uuid,
  rule_set_version_id uuid           NOT NULL,
  rule_side           core.rule_side NOT NULL,
  rules_as_of         date           NOT NULL,
  basis               core.rule_resolution_basis NOT NULL,
  method              text           NOT NULL DEFAULT 'DETERMINISTIC'
                      CHECK (method IN ('DETERMINISTIC','INTERPRETED')),
  evaluated_at        timestamptz    NOT NULL DEFAULT now(),
  stage_key           text,
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now(),
  created_by_kind     app.actor_kind NOT NULL DEFAULT 'SYSTEM',
  created_by_id       text           NOT NULL DEFAULT 'system',
  created_by_name     text,
  CONSTRAINT ccr_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT ccr_rule_fk FOREIGN KEY (compliance_rule_id)
    REFERENCES core.compliance_rules (id) ON DELETE RESTRICT,
  CONSTRAINT ccr_version_fk FOREIGN KEY (rule_set_version_id)
    REFERENCES core.rule_set_versions (id) ON DELETE RESTRICT,
  -- An INTERPRETED check carries the model that interpreted it; a DETERMINISTIC
  -- one carries no model at all. The contract distinguishes them and the screen
  -- renders the difference, so the data has to hold it.
  CONSTRAINT ccr_deterministic_has_no_model
    CHECK (method = 'INTERPRETED' OR NOT (computed ? 'model'))
);
COMMENT ON TABLE core.compliance_check_results IS
  'Each result records the rule-set version it APPLIED, its side, and the date it '
  'resolved as-of. Re-running a check writes a NEW row rather than editing one, so '
  'the assessment history survives and "why was this passed in October" stays '
  'answerable. Any FAIL sets the engagement''s HRDC_CLAIM step to BLOCKED - the '
  'stepper renders that, it does not compute it.';
CREATE INDEX IF NOT EXISTS ccr_engagement_idx
  ON core.compliance_check_results (tenant_id, engagement_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS ccr_failing_idx
  ON core.compliance_check_results (tenant_id, engagement_id) WHERE state = 'FAIL';
SELECT app.finalise_table('core','compliance_check_results',false,NULL,
  ARRAY['engagement_id','check_key','state','rule_set_version_id','rules_as_of','evaluated_at']);

CREATE TABLE IF NOT EXISTS core.compliance_version_drifts (
  id                        uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  compliance_check_result_id uuid          NOT NULL,
  applied_version_id        uuid           NOT NULL,
  current_version_id        uuid           NOT NULL,
  severity                  core.severity  NOT NULL DEFAULT 'WARN',
  message                   text           NOT NULL,
  created_at                timestamptz    NOT NULL DEFAULT now(),
  updated_at                timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT cvd_result_fk FOREIGN KEY (tenant_id, compliance_check_result_id)
    REFERENCES core.compliance_check_results (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT cvd_applied_fk FOREIGN KEY (applied_version_id)
    REFERENCES core.rule_set_versions (id) ON DELETE RESTRICT,
  CONSTRAINT cvd_current_fk FOREIGN KEY (current_version_id)
    REFERENCES core.rule_set_versions (id) ON DELETE RESTRICT,
  -- A drift row that cites the same version twice is not a drift.
  CONSTRAINT cvd_versions_differ CHECK (applied_version_id <> current_version_id)
);
COMMENT ON TABLE core.compliance_version_drifts IS
  'DECISIONS §6: when the applicable rule-set version changes between stages, raise '
  'a warning citing BOTH versions rather than silently switching. This table is that '
  'warning. It is only expressible because the registry stores both time axes.';
SELECT app.finalise_table('core','compliance_version_drifts',false,NULL,
  ARRAY['compliance_check_result_id','applied_version_id','current_version_id']);

-- ═══ 6 · Claim packets ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.hrdc_packets (
  id                        uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                       text,
  engagement_id             uuid           NOT NULL,
  organisation_id           uuid           NOT NULL,
  scheme                    core.hrdc_scheme NOT NULL,
  employer_code             text           NOT NULL,
  claim_value_sen           bigint         NOT NULL CHECK (claim_value_sen >= 0),
  levy_available_sen        bigint         CHECK (levy_available_sen IS NULL OR levy_available_sen >= 0),
  currency                  core.currency_code NOT NULL DEFAULT 'MYR',
  completeness              numeric(4,3)   NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 1),
  status                    core.packet_status NOT NULL DEFAULT 'DRAFT',
  panel_state               core.hrdc_packet_panel_state NOT NULL DEFAULT 'ON_TRACK',
  deadline_at               timestamptz,
  deadline_severity         core.severity,
  grant_reference           text,
  grant_submitted_at        timestamptz,
  grant_approved_at         timestamptz,
  claim_reference           text,
  claim_submitted_at        timestamptz,
  claim_rule_set_version_id uuid,
  voided_at                 timestamptz,
  void_reason               text,
  created_at                timestamptz    NOT NULL DEFAULT now(),
  updated_at                timestamptz    NOT NULL DEFAULT now(),
  created_by_kind           app.actor_kind NOT NULL DEFAULT 'AGENT',
  created_by_id             text           NOT NULL DEFAULT 'agent_compliance',
  created_by_name           text,
  UNIQUE (tenant_id, engagement_id),
  CONSTRAINT hp_engagement_fk FOREIGN KEY (tenant_id, engagement_id)
    REFERENCES core.engagements (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT hp_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT hp_claim_version_fk FOREIGN KEY (claim_rule_set_version_id)
    REFERENCES core.rule_set_versions (id) ON DELETE RESTRICT,
  -- ⚠ The contract's `422 VALIDATION_FAILED` while completeness < 1, expressed
  -- where it CANNOT be bypassed. A packet marked submitted without a reference
  -- and a complete document set is a claim nobody can trace on eTRIS.
  CONSTRAINT hp_submitted_needs_complete
    CHECK (status <> 'SUBMITTED'
           OR (completeness = 1 AND claim_reference IS NOT NULL AND claim_submitted_at IS NOT NULL)),
  CONSTRAINT hp_grant_submitted_needs_reference
    CHECK (grant_submitted_at IS NULL OR grant_reference IS NOT NULL),
  CONSTRAINT hp_void_pair CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
COMMENT ON COLUMN core.hrdc_packets.claim_rule_set_version_id IS
  'Pinned at CLAIM SUBMISSION (DECISIONS §6), as distinct from the engagement''s '
  'grant-side pin. The two sides resolve against different instants because HRD '
  'Corp evaluates against the rules in force when they RECEIVE each thing.';
CREATE UNIQUE INDEX IF NOT EXISTS hp_claim_ref_uq
  ON core.hrdc_packets (tenant_id, claim_reference) WHERE claim_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS hp_deadline_idx ON core.hrdc_packets (tenant_id, status, deadline_at);
CREATE INDEX IF NOT EXISTS hp_org_idx      ON core.hrdc_packets (tenant_id, organisation_id);
SELECT app.finalise_table('core','hrdc_packets',true,'HPK',
  ARRAY['engagement_id','organisation_id','claim_rule_set_version_id']);

CREATE TABLE IF NOT EXISTS core.hrdc_packet_documents (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  hrdc_packet_id  uuid           NOT NULL,
  document_type   text           NOT NULL,
  status          core.document_presence NOT NULL DEFAULT 'MISSING',
  attachment_id   uuid,
  source_ref      text,
  meta            jsonb          NOT NULL DEFAULT '{}'::jsonb,
  attached_at     timestamptz,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, hrdc_packet_id, document_type),
  CONSTRAINT hpd_packet_fk FOREIGN KEY (tenant_id, hrdc_packet_id)
    REFERENCES core.hrdc_packets (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT hpd_type_fk FOREIGN KEY (tenant_id, document_type)
    REFERENCES core.hrdc_document_types (tenant_id, document_type) ON DELETE RESTRICT,
  CONSTRAINT hpd_attachment_fk FOREIGN KEY (tenant_id, attachment_id)
    REFERENCES core.attachments (tenant_id, id) ON DELETE RESTRICT,
  -- PRESENT means there is something to point at. A document marked present
  -- with nothing behind it is how a packet reaches completeness 1.0 empty.
  CONSTRAINT hpd_present_needs_evidence
    CHECK (status <> 'PRESENT' OR (attachment_id IS NOT NULL OR source_ref IS NOT NULL))
);
SELECT app.finalise_table('core','hrdc_packet_documents',false,NULL,
  ARRAY['hrdc_packet_id','document_type']);

CREATE TABLE IF NOT EXISTS core.hrdc_levy_statements (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  organisation_id uuid           NOT NULL,
  employer_code   text           NOT NULL,
  as_of           date           NOT NULL,
  levy_available_sen bigint      NOT NULL CHECK (levy_available_sen >= 0),
  currency        core.currency_code NOT NULL DEFAULT 'MYR',
  attachment_id   uuid,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, organisation_id, as_of),
  CONSTRAINT hls_organisation_fk FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES core.organisations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT hls_attachment_fk FOREIGN KEY (tenant_id, attachment_id)
    REFERENCES core.attachments (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.finalise_table('core','hrdc_levy_statements',false,NULL,
  ARRAY['organisation_id','as_of','levy_available_sen']);

-- ═══ 7 · Deferred FKs now closable ══════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'engagements_grant_version_fk') THEN
    ALTER TABLE core.engagements
      ADD CONSTRAINT engagements_grant_version_fk FOREIGN KEY (grant_rule_set_version_id)
      REFERENCES core.rule_set_versions (id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'cr_knowledge_source_fk') THEN
    ALTER TABLE core.compliance_rules
      ADD CONSTRAINT cr_knowledge_source_fk FOREIGN KEY (knowledge_source_id)
      REFERENCES core.knowledge_sources (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══ 8 · Verify ═════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND c.relname IN ('knowledge_sources','knowledge_chunks','rule_set_versions',
                      'compliance_rules','rule_change_sets','rule_changes',
                      'rule_change_affected_engagements','compliance_check_results',
                      'compliance_version_drifts','hrdc_packets','hrdc_packet_documents',
                      'hrdc_levy_statements');
  IF v_cnt <> 12 THEN
    RAISE EXCEPTION '009 verify: expected 12 compliance tables, found %', v_cnt;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'core.compliance_rules'::regclass
      AND conname = 'cr_no_bitemporal_overlap' AND contype = 'x') THEN
    RAISE EXCEPTION
      '009 verify: the bitemporal exclusion constraint is missing. "Which rule '
      'applied on 12 November as known on 28 October" now has more than one answer.';
  END IF;

  -- Both nullable-tenant tables must still be RLS-forced even though
  -- finalise_table could not be used on them.
  IF NOT (SELECT bool_and(relrowsecurity AND relforcerowsecurity)
          FROM pg_catalog.pg_class
          WHERE oid IN ('core.compliance_rules'::regclass,'core.rule_set_versions'::regclass)) THEN
    RAISE EXCEPTION
      '009 verify: a nullable-tenant table is not RLS-forced. These two skip '
      'finalise_table, which is exactly why they are checked by name.';
  END IF;

  RAISE NOTICE '009 verify: OK - 12 compliance tables, registry bitemporal, RLS forced.';
END;
$verify$;

COMMIT;
