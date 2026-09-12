-- ============================================================================
-- Migration 004: the shell — reference tables, pipeline and template config,
-- ref allocation, attachments, and the table finaliser every later migration
-- uses.
-- ============================================================================
--
-- FEATURE. Three jobs, in this order because each depends on the last.
--
--   1. `app.finalise_table()` — ONE procedure that gives a tenant-scoped table
--      its whole standard posture. Doc 01's Conventions say every table carries
--      the same eight columns, the same `UNIQUE (tenant_id, id)`, the same
--      `UNIQUE (tenant_id, ref)`, the same `updated_at` trigger and the same
--      frozen `ref`. Doc 02 §4.1 says every one is RLS-enabled and FORCED with
--      a tenant index. That is eight facts x roughly eighty tables. Written out
--      per table it is six hundred lines of copy-paste in which exactly one
--      table will be missing FORCE, and nothing will notice until that table is
--      the one that leaks. Written once, a single pin proves it for all of them
--      and test_014 re-derives it from the catalogs.
--
--      This is the project's own consolidation rule applied to SQL: a pattern
--      on more than two tables becomes a named component before it is used
--      again.
--
--   2. Ref allocation. `ENQ-2026-0912` and `ORG-0114` are two formats over one
--      mechanism: a `(tenant_id, prefix, period)` counter, a SECURITY DEFINER
--      allocator, and a BEFORE INSERT trigger. Allocation is one
--      `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, which serialises per
--      prefix per tenant rather than globally and holds the row lock for
--      microseconds.
--
--   3. The configuration and reference data the rest of the model reads instead
--      of hardcoding: pipelines and their steps, templates and their sections,
--      metric definitions, the hours-saved baseline tables, attachments and
--      signatures, and the three reference tables that replace the open enums
--      003 deliberately did not create.
--
-- WHY `pipeline_steps` IS THE POINT OF THIS MIGRATION
--
-- The project rule is that stage names and their order render from pipeline
-- configuration, never hardcoded. The contract shows TWO different lifecycles
-- for the same object — six steps on the organisation relations panel, nine on
-- the engagement detail. Those are two `pipelines` rows, not two literal arrays
-- in two components. `engagement_step_states` therefore stores no label and no
-- position: it stores a foreign key to a step, and every label and every
-- ordering in the product resolves through this table.
--
-- ⚠ CONFLICT C4, resolved. Doc 01 §3.6 wants `action_types` as a TENANT-SCOPED
-- reference table in `core`. Doc 03 §1.1 defines `app.action_types` as "Global,
-- not tenant-scoped: this is the product's vocabulary, seeded by migration.
-- Tenants customise *policies* and *grants*, never the catalogue." 03 outranks
-- 01 and is also plainly right — an action type is a capability the software
-- has, not a per-customer setting — so the catalogue is global and lives in
-- `app`. It is created here rather than in 011 because 004's
-- `hours_saved_baselines.action_type` already needs it to exist. 011 adds the
-- gate tables that reference it; the nineteen-row seed lands with 011, where
-- doc 03 §3 defines it.
--
-- ⚠ AUTHOR ADDITION. `core.check_keys` and `core.hrdc_document_types` are
-- tenant-scoped reference tables doc 01 §3.6 names but does not give columns
-- for beyond "`id`, natural key, `label`, `description`, `position`, `active`".
-- Implemented to that description exactly, with nothing invented.
--
-- SPINE: the action envelope does not exist until 011. `app.finalise_table` is
-- itself a new spine object — every table migration after this one goes through
-- it — and it is therefore pinned harder than anything else in this migration.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   `app.finalise_table` is DDL-executing and SECURITY DEFINER. It is callable
--   ONLY by the migration role: EXECUTE is revoked from PUBLIC, anon and
--   authenticated, and it is never referenced from any RPC. A client-reachable
--   function that runs `EXECUTE format(...)` on a caller-supplied identifier is
--   an arbitrary-DDL primitive, so both halves of that sentence matter — it
--   quotes every identifier with `%I` AND nobody can call it.
--   `core.next_ref` is SECURITY DEFINER so the sequence table needs no grants.
--   Every table created here is RLS-enabled and FORCED with ZERO policies, i.e.
--   deny-all, until 014. No table is ever open between this migration and that
--   one.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope: no client-callable RPC added.
--   2. Unwrap: no jsonb envelope crosses the boundary.
--   3. RpcMap: no entries — these are tables the Data API reads directly once
--      014 grants them, not RPCs.
--   4. Call sites: `app.finalise_table` is called by 005-013. `core.next_ref` is
--      called by the ref trigger on every table with a `ref`.
--   5. Casts: none.
--   6. Reload/restore: no client behaviour yet.
--   7. Public routes: none. `anon` receives nothing here.
--
-- Rollback: rollbacks/004_shell_config_and_ref_allocation_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ 1 · The table finaliser ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app.finalise_table(
  p_schema    text,
  p_table     text,
  p_has_ref   boolean DEFAULT true,
  p_ref_prefix text   DEFAULT NULL,
  p_immutable text[]  DEFAULT ARRAY[]::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
  v_rel      regclass;
  v_frozen   text[];
  v_args     text;
BEGIN
  -- to_regclass, not a bare cast: the cast raises with a message that does not
  -- say which call site was wrong.
  v_rel := to_regclass(format('%I.%I', p_schema, p_table));
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'finalise_table: %.% does not exist', p_schema, p_table
      USING ERRCODE = 'undefined_table';
  END IF;

  -- Every finalised table MUST be tenant-scoped. A table that reaches 014
  -- without a tenant_id gets no tenant predicate, and a policy that cannot
  -- filter by tenant is a policy that does not isolate.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_rel AND attname = 'tenant_id'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION
      'finalise_table: %.% has no tenant_id column. Every finalised table is '
      'tenant-scoped; a table without one cannot be isolated by any policy.',
      p_schema, p_table
      USING ERRCODE = 'undefined_column';
  END IF;

  IF p_has_ref AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_rel AND attname = 'ref' AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'finalise_table: %.% was declared p_has_ref but has no ref column',
      p_schema, p_table USING ERRCODE = 'undefined_column';
  END IF;

  -- ── Composite tenant-safe key. Doc 01: every FK in this model is
  --    (tenant_id, parent_id) → parent (tenant_id, id), which makes a
  --    cross-tenant reference unrepresentable at the storage layer,
  --    independently of whatever RLS says. That needs a UNIQUE on the parent's
  --    (tenant_id, id) to point at.
  -- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so re-running a migration
  -- would fail here on the second pass with "relation already exists" and tell
  -- the reader nothing about which call site. Guarded explicitly, which is the
  -- idiom the Supabase schema guidance prescribes for exactly this gap.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = v_rel AND conname = p_table || '_tenant_id_key'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE (tenant_id, id)',
      p_schema, p_table, p_table || '_tenant_id_key');
  END IF;

  IF p_has_ref AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = v_rel AND conname = p_table || '_tenant_ref_key'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE (tenant_id, ref)',
      p_schema, p_table, p_table || '_tenant_ref_key');
  END IF;

  -- ── Tenant index. Doc 02 §4.1 warns that a composite PK only covers
  --    tenant_id when tenant_id LEADS it. These tables are keyed on `id`, so
  --    the index is not optional.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.%I (tenant_id)',
    p_table || '_tenant_id_idx', p_schema, p_table);

  -- ── updated_at
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',
                 'trg_' || p_table || '_updated_at', p_schema, p_table);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',
    'trg_' || p_table || '_updated_at', p_schema, p_table);

  -- ── Immutability. tenant_id is always frozen; ref is frozen when present.
  --    Doc 01: refs "are immutable after insert". A tenant_id that can move is
  --    a row that can be transplanted into another customer's account.
  v_frozen := ARRAY['tenant_id'] || CASE WHEN p_has_ref THEN ARRAY['ref'] ELSE ARRAY[]::text[] END
              || COALESCE(p_immutable, ARRAY[]::text[]);
  SELECT string_agg(quote_literal(c), ', ') INTO v_args FROM unnest(v_frozen) AS c;

  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',
                 'trg_' || p_table || '_immutable', p_schema, p_table);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %I.%I FOR EACH ROW '
    'EXECUTE FUNCTION app.enforce_immutable_columns(%s)',
    'trg_' || p_table || '_immutable', p_schema, p_table, v_args);

  -- ── Ref allocation
  IF p_has_ref THEN
    IF p_ref_prefix IS NULL THEN
      RAISE EXCEPTION 'finalise_table: %.% has a ref but no prefix was given',
        p_schema, p_table USING ERRCODE = 'invalid_parameter_value';
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',
                   'trg_' || p_table || '_ref', p_schema, p_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I.%I FOR EACH ROW '
      'EXECUTE FUNCTION core.assign_ref(%L)',
      'trg_' || p_table || '_ref', p_schema, p_table, p_ref_prefix);
  END IF;

  -- ── RLS: enabled AND forced, with no policy. Deny-all until 014.
  --    Enabling here rather than in 014 means no table in this set is ever open,
  --    not even for the duration of one migration.
  EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', p_schema, p_table);
  EXECUTE format('ALTER TABLE %I.%I FORCE  ROW LEVEL SECURITY', p_schema, p_table);
  EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC, anon, authenticated',
                 p_schema, p_table);
END;
$fn$;

COMMENT ON FUNCTION app.finalise_table(text, text, boolean, text, text[]) IS
  'Gives a tenant-scoped table its whole standard posture: composite (tenant_id, id) '
  'and (tenant_id, ref) uniques, tenant index, updated_at trigger, frozen tenant_id '
  'and ref, ref allocation, and RLS enabled AND FORCED with no policy. '
  'MIGRATION-ROLE ONLY - it executes DDL from its arguments. Every identifier is '
  'quoted with %I, and EXECUTE is revoked from every client role, because either '
  'alone would be insufficient.';

REVOKE ALL ON FUNCTION app.finalise_table(text, text, boolean, text, text[])
  FROM PUBLIC, anon, authenticated;

-- ═══ 2 · Ref allocation ═════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.ref_formats (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  prefix      text        NOT NULL CHECK (prefix ~ '^[A-Z]{3}$'),
  entity      text        NOT NULL,
  dated       boolean     NOT NULL DEFAULT false,
  width       smallint    NOT NULL DEFAULT 4 CHECK (width BETWEEN 3 AND 8),
  gapless     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, prefix)
);

COMMENT ON TABLE core.ref_formats IS
  'The ref registry. `dated` selects PREFIX-YYYY-NNNN over PREFIX-NNNN. '
  '`gapless` is FALSE for every prefix at launch and is stored rather than assumed '
  'because INV- is the one prefix where Malaysian tax-invoice numbering conventionally '
  'expects no gaps - see the open question in doc 01.';

CREATE TABLE IF NOT EXISTS core.ref_sequences (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  prefix      text        NOT NULL,
  period      text        NOT NULL,
  next_value  bigint      NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, prefix, period)
);

COMMENT ON TABLE core.ref_sequences IS
  'One counter per (tenant, prefix, period). `period` is the four-digit year for a '
  'dated prefix and the single character ''-'' otherwise - a sentinel rather than '
  'NULL, so the UNIQUE constraint actually constrains (NULLs do not conflict).';

CREATE INDEX IF NOT EXISTS ref_formats_tenant_id_idx   ON core.ref_formats (tenant_id);
CREATE INDEX IF NOT EXISTS ref_sequences_tenant_id_idx ON core.ref_sequences (tenant_id);

SELECT app.finalise_table('core', 'ref_formats', false, NULL, ARRAY[]::text[]);
SELECT app.finalise_table('core', 'ref_sequences', false, NULL, ARRAY[]::text[]);
-- ref_formats and ref_sequences carry no `ref` of their own: they ARE the ref
-- registry, and a registry that needs the registry to name itself does not start.

-- The allocator. One statement, one row lock, held for microseconds.
CREATE OR REPLACE FUNCTION core.next_ref(p_tenant_id uuid, p_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
  v_fmt    record;
  v_period text;
  v_n      bigint;
BEGIN
  SELECT dated, width INTO v_fmt
  FROM core.ref_formats
  WHERE tenant_id = p_tenant_id AND prefix = p_prefix;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'next_ref: no ref_format for prefix % in this tenant', p_prefix
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Dated prefixes restart each calendar year. The year is taken in the tenant's
  -- own timezone, not the server's: a record created at 08:00 MYT on 1 January
  -- is a January record to the customer, and UTC would call it December.
  v_period := CASE WHEN v_fmt.dated
                   THEN to_char(now() AT TIME ZONE COALESCE(
                          (SELECT timezone FROM public.tenants WHERE id = p_tenant_id),
                          'Asia/Kuala_Lumpur'), 'YYYY')
                   ELSE '-' END;

  INSERT INTO core.ref_sequences (tenant_id, prefix, period, next_value)
  VALUES (p_tenant_id, p_prefix, v_period, 2)
  ON CONFLICT (tenant_id, prefix, period)
  DO UPDATE SET next_value = core.ref_sequences.next_value + 1,
                updated_at = now()
  RETURNING CASE WHEN core.ref_sequences.next_value = 2 THEN 1
                 ELSE core.ref_sequences.next_value - 1 END
  INTO v_n;

  RETURN CASE WHEN v_fmt.dated
              THEN p_prefix || '-' || v_period || '-' || lpad(v_n::text, v_fmt.width, '0')
              ELSE p_prefix || '-' || lpad(v_n::text, v_fmt.width, '0') END;
END;
$fn$;

COMMENT ON FUNCTION core.next_ref(uuid, text) IS
  'Allocates the next human reference for a prefix. Serialises per (tenant, prefix, '
  'period), never globally. Refs are NOT gapless: a rolled-back transaction burns a '
  'number, which is accepted for every prefix at launch.';

REVOKE ALL ON FUNCTION core.next_ref(uuid, text) FROM PUBLIC, anon, authenticated;

-- The BEFORE INSERT trigger `finalise_table` attaches. Prefix comes from the
-- trigger argument, so one function serves every table.
CREATE OR REPLACE FUNCTION core.assign_ref()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
  IF TG_NARGS <> 1 THEN
    RAISE EXCEPTION 'assign_ref on %.% needs exactly one prefix argument',
      TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- An explicitly supplied ref is honoured. Seeds and fixtures need to write
  -- `ENQ-2026-0912` verbatim; the immutability trigger freezes it afterwards
  -- either way.
  IF NEW.ref IS NULL THEN
    NEW.ref := core.next_ref(NEW.tenant_id, TG_ARGV[0]);
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION core.assign_ref() FROM PUBLIC, anon, authenticated;

-- ═══ 3 · The action-type catalogue (doc 03 §1.1) ════════════════════════════
-- Global, not tenant-scoped. Seeded by 011, where doc 03 defines the rows.

CREATE TABLE IF NOT EXISTS app.action_types (
  key                 text PRIMARY KEY,
  label               text NOT NULL,
  domain              text NOT NULL
                      CHECK (domain IN ('SALES','OPS','FINANCE','COMPLIANCE','GOVERNANCE')),
  money_moving        boolean NOT NULL DEFAULT false,
  client_facing       boolean NOT NULL DEFAULT false,
  hrdc_touching       boolean NOT NULL DEFAULT false,
  reversible          boolean NOT NULL DEFAULT false,
  ceiling_autonomy    text NOT NULL DEFAULT 'ACT_WITH_APPROVAL'
                      CHECK (ceiling_autonomy IN ('OBSERVE','SUGGEST','ACT_WITH_APPROVAL','AUTONOMOUS')),
  ceiling_reason      text
                      CHECK (ceiling_reason IN ('MONEY_MOVING','CLIENT_COMMITMENT','HRDC_STATE','SAFETY','NONE')),
  target_entity       text NOT NULL,
  payload_schema      jsonb NOT NULL DEFAULT '{}'::jsonb,
  value_source        text
                      CHECK (value_source IN ('QUOTATION','INVOICE','HRDC_CLAIM','PAYMENT','BUDGET_CAP','NONE')),
  max_effect_attempts int NOT NULL DEFAULT 5,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT action_types_money_ceiling
    CHECK (NOT money_moving OR ceiling_autonomy <> 'AUTONOMOUS'),
  CONSTRAINT action_types_hrdc_ceiling
    CHECK (NOT hrdc_touching OR ceiling_autonomy <> 'AUTONOMOUS')
);

COMMENT ON TABLE app.action_types IS
  'The product''s vocabulary of actions. GLOBAL, not tenant-scoped: tenants '
  'customise policies and grants, never the catalogue (doc 03 s1.1). The two table '
  'constraints are the schema-level half of the 422 MONEY_MOVING_CEILING answer; '
  'the other half is a trigger on autonomy_grants in 011, because the ceiling must '
  'also hold when a GRANT is raised rather than when the catalogue is seeded.';

REVOKE ALL ON TABLE app.action_types FROM PUBLIC, anon, authenticated;

-- ═══ 4 · Tenant-scoped reference tables ═════════════════════════════════════
-- These replace the open sets 003 deliberately did not make enums.

CREATE TABLE IF NOT EXISTS core.check_keys (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  check_key   text        NOT NULL,
  label       text        NOT NULL,
  description text,
  position    smallint    NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, check_key)
);

CREATE TABLE IF NOT EXISTS core.hrdc_document_types (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  document_type text        NOT NULL,
  label         text        NOT NULL,
  description   text,
  position      smallint    NOT NULL DEFAULT 0,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_type)
);

SELECT app.finalise_table('core', 'check_keys', false, NULL, ARRAY[]::text[]);
SELECT app.finalise_table('core', 'hrdc_document_types', false, NULL, ARRAY[]::text[]);

COMMENT ON TABLE core.hrdc_document_types IS
  'A reference table and not the core.hrdc_document_type enum, because HRD Corp '
  'changes this list and a tenant may be asked for a document the product has not '
  'shipped a label for. An enum would need a migration; a row needs an admin screen.';

-- ═══ 5 · Attachments and signatures ═════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.attachments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref               text,
  storage_bucket    text        NOT NULL,
  storage_path      text        NOT NULL,
  filename          text        NOT NULL,
  content_type      text        NOT NULL,
  byte_size         bigint      NOT NULL CHECK (byte_size >= 0),
  checksum          text,
  uploaded_by_user_id uuid      REFERENCES auth.users(id) ON DELETE SET NULL,
  virus_scanned_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by_kind   app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id     text        NOT NULL DEFAULT 'system',
  created_by_name   text,
  UNIQUE (tenant_id, storage_bucket, storage_path)
);

SELECT app.finalise_table('core', 'attachments', true, 'ATT', ARRAY['storage_bucket', 'storage_path', 'checksum']);
-- storage_bucket, storage_path and checksum are frozen: an attachment that can be
-- re-pointed at different bytes after an HRD Corp packet cites it is not evidence.

COMMENT ON TABLE core.attachments IS
  'Referencing tables hold attachment_id; this table holds no back-pointer. That is '
  'deliberate: no polymorphic owner column means no orphan class to reconcile and no '
  'owner_type string that can name a table that does not exist.';

CREATE TABLE IF NOT EXISTS core.signatures (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref             text,
  attachment_id   uuid,
  signed_at       timestamptz NOT NULL DEFAULT now(),
  signer_name     text        NOT NULL,
  signer_role     text,
  method          text        NOT NULL CHECK (method IN ('DRAWN','TYPED','CLICKWRAP')),
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text        NOT NULL DEFAULT 'system',
  created_by_name text,
  CONSTRAINT signatures_attachment_fk
    FOREIGN KEY (tenant_id, attachment_id) REFERENCES core.attachments (tenant_id, id)
    ON DELETE RESTRICT
);

SELECT app.finalise_table('core', 'signatures', true, 'SIG', ARRAY['attachment_id', 'signed_at', 'signer_name', 'method']);
-- A signature is frozen entirely once written. Everything about it is the record.

COMMENT ON TABLE core.signatures IS
  'One signature concept, one table. Serves attendance_entries.signature_id and '
  'portal_acceptances.signature_id alike - a second signature table for the portal '
  'would be the divergence the project rules forbid.';

-- ═══ 6 · Shell configuration ════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.saved_views (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref         text,
  object      core.saved_view_object NOT NULL,
  label       text        NOT NULL,
  filters     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  columns     text[]      NOT NULL DEFAULT '{}',
  is_default  boolean     NOT NULL DEFAULT false,
  owner_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visibility  core.view_visibility NOT NULL DEFAULT 'PRIVATE',
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text    NOT NULL DEFAULT 'system',
  created_by_name text
);

COMMENT ON COLUMN core.saved_views.visibility IS
  'The schema''s answer to contract s16 Q9 ("shared or personal?"): both. '
  'PRIVATE / TEAM / TENANT are exactly the three values sb-tenancy''s policy reads. '
  '`count` in the response is computed, never stored.';

CREATE UNIQUE INDEX IF NOT EXISTS saved_views_owner_label_uq
  ON core.saved_views (tenant_id, owner_id, object, label) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_one_default_uq
  ON core.saved_views (tenant_id, owner_id, object) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS saved_views_owner_idx ON core.saved_views (tenant_id, owner_id);

SELECT app.finalise_table('core', 'saved_views', true, 'SVW', ARRAY['object', 'owner_id']);

CREATE TABLE IF NOT EXISTS core.templates (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                   text,
  template_type         core.template_type NOT NULL,
  version               smallint    NOT NULL DEFAULT 1 CHECK (version >= 1),
  label                 text        NOT NULL,
  merge_fields          text[]      NOT NULL DEFAULT '{}',
  status                text        NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  category              core.message_category,
  rate_per_message_sen  bigint      CHECK (rate_per_message_sen IS NULL OR rate_per_message_sen >= 0),
  approved_provider_ref text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by_kind       app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id         text        NOT NULL DEFAULT 'system',
  created_by_name       text,
  UNIQUE (tenant_id, template_type, label, version),
  -- category and rate are WhatsApp-only facts. A PROPOSAL template carrying a
  -- per-message rate is a modelling error that would reach the cost estimate.
  CONSTRAINT templates_whatsapp_only_fields CHECK (
    template_type = 'WHATSAPP'
    OR (category IS NULL AND rate_per_message_sen IS NULL AND approved_provider_ref IS NULL)
  )
);

SELECT app.finalise_table('core', 'templates', true, 'TPL', ARRAY['template_type', 'version']);
-- template_type and version are frozen because templates are versioned, never
-- edited: re-versioning a row in place is how a five-year-old proposal starts
-- rendering from a template it was never built with.

COMMENT ON TABLE core.templates IS
  'Templates are VERSIONED, NEVER EDITED. A proposal built from v7 must still render '
  'as v7 in five years, and contract s10''s guardrail "Approved template version" is '
  'meaningless otherwise. A change is a new version row.';

CREATE TABLE IF NOT EXISTS core.template_sections (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  template_id  uuid        NOT NULL,
  n            smallint    NOT NULL CHECK (n >= 1),
  title        text        NOT NULL,
  ai_enabled   boolean     NOT NULL DEFAULT false,
  default_body text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_id, n),
  CONSTRAINT template_sections_template_fk
    FOREIGN KEY (tenant_id, template_id) REFERENCES core.templates (tenant_id, id)
    ON DELETE CASCADE
);

SELECT app.finalise_table('core', 'template_sections', false, NULL, ARRAY['template_id', 'n']);

CREATE TABLE IF NOT EXISTS core.pipelines (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref         text,
  object      text        NOT NULL CHECK (object IN ('ENGAGEMENT','OPPORTUNITY','PACKET')),
  name        text        NOT NULL,
  is_default  boolean     NOT NULL DEFAULT false,
  version     smallint    NOT NULL DEFAULT 1 CHECK (version >= 1),
  status      text        NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by_kind app.actor_kind NOT NULL DEFAULT 'HUMAN',
  created_by_id   text    NOT NULL DEFAULT 'system',
  created_by_name text,
  UNIQUE (tenant_id, object, name, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS pipelines_one_default_uq
  ON core.pipelines (tenant_id, object) WHERE is_default;

SELECT app.finalise_table('core', 'pipelines', true, 'PIP', ARRAY['object']);

CREATE TABLE IF NOT EXISTS core.pipeline_steps (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  pipeline_id         uuid        NOT NULL,
  step_key            text        NOT NULL,
  label               text        NOT NULL,
  position            smallint    NOT NULL CHECK (position >= 0),
  terminal            boolean     NOT NULL DEFAULT false,
  blocking_check_keys text[]      NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, pipeline_id, step_key),
  UNIQUE (tenant_id, pipeline_id, position),
  CONSTRAINT pipeline_steps_pipeline_fk
    FOREIGN KEY (tenant_id, pipeline_id) REFERENCES core.pipelines (tenant_id, id)
    ON DELETE CASCADE
);

SELECT app.finalise_table('core', 'pipeline_steps', false, NULL, ARRAY['pipeline_id', 'step_key']);

COMMENT ON TABLE core.pipeline_steps IS
  'The whole reason engagement_step_states stores no label and no position. The '
  'contract shows TWO lifecycles for the same object - six steps on the organisation '
  'relations panel, nine on the engagement detail. Those are two pipelines rows, not '
  'two hardcoded arrays in two components.';

CREATE TABLE IF NOT EXISTS core.metric_definitions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  metric_key         text        NOT NULL,
  label              text        NOT NULL,
  scope              text        NOT NULL CHECK (scope IN ('TENANT','ORGANISATION','ENGAGEMENT')),
  value_kind         text        NOT NULL CHECK (value_kind IN ('MONEY','COUNT','RATE','DURATION')),
  formula            text,
  is_estimate        boolean     NOT NULL DEFAULT false,
  drill_to_template  text,
  sql_source         text,
  compare_period     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_key, scope)
);

SELECT app.finalise_table('core', 'metric_definitions', false, NULL, ARRAY['metric_key', 'scope']);

COMMENT ON COLUMN core.metric_definitions.drill_to_template IS
  'Contract s5 is explicit that the UI never hardcodes a drill route. Every '
  'MetricStrip cell is self-describing because its definition, including drillTo, '
  'is data.';

CREATE TABLE IF NOT EXISTS core.hours_saved_baseline_tables (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  version              text        NOT NULL,
  basis                core.hours_saved_basis NOT NULL DEFAULT 'ILLUSTRATIVE',
  haircut              numeric(3,2) NOT NULL DEFAULT 0.70 CHECK (haircut > 0 AND haircut <= 1),
  effective_from       date        NOT NULL,
  signed_off_by_user_id uuid       REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_off_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version),
  -- DECISIONS s4: a MEASURED basis is the product of time-and-motion sampling
  -- signed by the process owners. Claiming MEASURED without that signature is
  -- how an illustrative number becomes an ROI claim.
  CONSTRAINT hours_saved_measured_needs_signoff
    CHECK (basis <> 'MEASURED' OR (signed_off_by_user_id IS NOT NULL AND signed_off_at IS NOT NULL))
);

SELECT app.finalise_table('core', 'hours_saved_baseline_tables', false, NULL, ARRAY['version']);

CREATE TABLE IF NOT EXISTS core.hours_saved_baselines (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  baseline_table_id uuid        NOT NULL,
  action_type       text        NOT NULL REFERENCES app.action_types(key) ON DELETE RESTRICT,
  baseline_minutes  integer     NOT NULL CHECK (baseline_minutes >= 0),
  sample_size       smallint    CHECK (sample_size IS NULL OR sample_size >= 0),
  credited          boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, baseline_table_id, action_type),
  CONSTRAINT hours_saved_baselines_table_fk
    FOREIGN KEY (tenant_id, baseline_table_id)
      REFERENCES core.hours_saved_baseline_tables (tenant_id, id) ON DELETE CASCADE
);

SELECT app.finalise_table('core', 'hours_saved_baselines', false, NULL, ARRAY['baseline_table_id', 'action_type']);

COMMENT ON TABLE core.hours_saved_baselines IS
  'baseline_minutes is MEASURED in discovery, not assumed (DECISIONS s4). '
  '`human_minutes_spent` is deliberately NOT here: it is per action, not per type, '
  'and belongs on sb-actions'' action_requests. Flagged to that lane.';


-- ═══ 7 · Verify ═════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_bad  text;
  v_cnt  int;
BEGIN
  -- Every core table is RLS enabled AND forced, and carries ZERO policies.
  -- Zero is the point: deny-all until 014. A table that arrives here with a
  -- policy got one from somewhere this migration does not control.
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '004 verify: core table(s) not RLS enabled+forced: %', v_bad;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy pol WHERE pol.polrelid = c.oid);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '004 verify: core table(s) already carry a policy: %. Policies belong in 014.',
      v_bad;
  END IF;

  -- Every finalised table has its composite (tenant_id, id) unique, which is what
  -- the composite tenant-safe foreign keys in 005-013 will point at. Without it,
  -- a child FK falls back to (id) alone and cross-tenant references become
  -- representable again.
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint k
      WHERE k.conrelid = c.oid AND k.contype = 'u'
        AND k.conkey = ARRAY[
          (SELECT attnum FROM pg_catalog.pg_attribute
            WHERE attrelid = c.oid AND attname = 'tenant_id'),
          (SELECT attnum FROM pg_catalog.pg_attribute
            WHERE attrelid = c.oid AND attname = 'id')]::smallint[]);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '004 verify: core table(s) without a (tenant_id, id) unique: %', v_bad;
  END IF;

  -- No client role may touch a core table yet.
  SELECT string_agg(format('%s->%s', r.role_name, c.relname), ', ') INTO v_bad
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN unnest(ARRAY['anon','authenticated']) AS r(role_name)
  WHERE n.nspname = 'core' AND c.relkind = 'r'
    AND has_table_privilege(r.role_name, c.oid, 'SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '004 verify: client grant(s) on core before 014: %', v_bad;
  END IF;

  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r';

  RAISE NOTICE
    '004 verify: OK - % core tables, all RLS-forced, all deny-all, all with a '
    '(tenant_id, id) unique, none reachable by a client role.', v_cnt;
END;
$verify$;

COMMIT;
