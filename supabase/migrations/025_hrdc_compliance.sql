-- ============================================================================
-- Migration 025: compliance — the six NO-ADAPTER HRD Corp / rules-registry
-- RPCs the web calls with no SQL behind them yet: getComplianceChecks,
-- getClaimPacket, attachPacketDocument, exportClaimPacket,
-- createComplianceRule, getRuleChangeSet.
-- ============================================================================
--
-- 001–021 ARE APPLIED TO HOSTED AND ARE NOT EDITED. Everything here is a new
-- object in `core` or `app`, or a new row in an existing registry table
-- (`app.tenant_seed_checks`). No 001–021 function is replaced.
--
-- ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
--
-- The gap matrix ((b2), api-gaps/matrix.md) lists six methods the web calls
-- with no client adapter and no SQL: `getComplianceChecks`, `getClaimPacket`,
-- `attachPacketDocument`, `exportClaimPacket`, `createComplianceRule`,
-- `getRuleChangeSet`. `listComplianceRules`, `getComplianceRule`,
-- `listRuleChanges` and `listHrdcDeadlines` are already adapter-backed (018,
-- 020) and are untouched here.
--
-- ── DEFECT: `core.hrdc_document_types` IS NEVER SEEDED ─────────────────────
--
-- `core.hrdc_packet_documents.document_type` is FK'd to `core.hrdc_document_types
-- (tenant_id, document_type)` (009), a per-tenant reference table (004) that no
-- migration through 021 ever inserts a row into for any tenant. A packet with no
-- document-type rows for its tenant cannot carry a single required document, so
-- `attachPacketDocument` would refuse every call with a foreign-key violation
-- and the packet screen would render an empty checklist forever. §1 provisions
-- it the way 016/017 provision `ref_formats`/`check_keys`: a seed function, an
-- AFTER INSERT trigger on `public.tenants`, registration in
-- `app.tenant_seed_checks` so `app.provision_tenant` refuses a tenant missing
-- it, and a backfill for tenants that already exist. The five rows are the
-- contract's own `HRDC_DOCUMENT_TYPES` (packages/contract/src/enums.ts).
--
-- ── DEFECT: `core.compliance_rules` HAS NO ACTIVE ROW ANYWHERE ─────────────
--
-- 009:298 `cr_active_needs_verification` and 011's `enforce_state_transition`
-- gate `PROPOSED -> ACTIVE` on `compliance_rules.status` behind
-- `RULE_CHANGE_APPROVE`, and 011's own `execute_in_database_action` for that
-- action type updates `core.rule_changes` only — never the `compliance_rules`
-- row a change targets. So no migration through 021 has a way to make a rule
-- ACTIVE, `core.resolve_rules` (009) filters on `status IN ('ACTIVE',
-- 'SUPERSEDED')`, and every rule 017 seeded loads PROPOSED. This is a real gap
-- in 011, out of reach here (001-021 are not edited); §8's seed closes it the
-- way `test_009`'s own `pg_temp.activate_rule` helper does — by creating a
-- genuine `core.action_requests` row of type `RULE_CHANGE_APPROVE` targeting
-- the rule, publishing it as `app.effect_applier`, and only then updating
-- `status`. That is the LEGAL verification path 011 itself defines; nothing
-- here invents a second one.
--
-- ── READS VS WRITES ─────────────────────────────────────────────────────────
--
-- `getComplianceChecks` and `getClaimPacket` are reads: `app.err`/`app.ok`,
-- authz-first, `NOT_FOUND` as data. `attachPacketDocument` and
-- `createComplianceRule` are writes: authz-first, then every refusal is a
-- `RAISE … USING ERRCODE = 'TRNOS'` so a refused write leaves nothing behind,
-- exactly 021's `core.put_quotation` shape (optional `p_idempotency_key`,
-- advisory lock, `app.idempotency_keys`, same-body replay, different-body
-- `IDEMPOTENT_REPLAY`). `exportClaimPacket` mutates nothing and is a read.
--
-- ── AUTHORIZATION ───────────────────────────────────────────────────────────
--
-- All six permissions already exist in 002's matrix — nothing is added to
-- `app.role_permissions`:
--   getComplianceChecks   -> compliance:check:read (OPS, FINANCE, MD, ADMIN)
--   getClaimPacket        -> hrdc:read              (OPS, FINANCE, MD, ADMIN)
--   attachPacketDocument  -> hrdc:document:write     (OPS, FINANCE, MD, ADMIN)
--   exportClaimPacket     -> hrdc:export             (OPS, FINANCE, MD, ADMIN)
--   createComplianceRule  -> compliance:rule:write   (FINANCE, ADMIN only —
--                            MD holds compliance:rule:approve/:read but NOT
--                            :write; flagged under "could not verify" below,
--                            not changed here since it would mean editing 002)
--   getRuleChangeSet      -> compliance:rule:read    (OPS, FINANCE, MD, ADMIN)
--
-- ── TENANCY ON `createComplianceRule` ───────────────────────────────────────
--
-- 009's own comment on `compliance_rules.tenant_id`: "Writes to a NULL-tenant
-- row are a service_role provisioning act: there is deliberately NO
-- platform-admin role, because a tenant ADMIN must not be able to change
-- compliance for every other training provider on the platform." A client
-- write is never service_role, so a hand-added rule is inserted with
-- `tenant_id = app.require_tenant_id()` — a tenant override, never national.
-- Not a product decision needing escalation: it is the one tenancy 009
-- documents as legal for a client-facing caller.
--
-- ── WHAT THE CREATE-RULE SCREEN DOES NOT COLLECT ────────────────────────────
--
-- `RulesRegistryScreen.tsx`'s "Add rule" drawer submits `expression: {field:"",
-- op:"EQ", reference:""}` literally — a placeholder form, not a wired one —
-- and never sends `side`, `familyKey`, `checkKey` or `deliveryMode`, all of
-- which `core.compliance_rules` requires NOT NULL with no usable default for a
-- hand-typed rule. `side` defaults to `GRANT`, `delivery_mode` stays its column
-- default `ANY`, and `family_key`/`check_key` are synthesised from the
-- caller's own `id` (rule code) so the row never collides with a real HRD
-- family and `core.resolve_rules`'s per-family `DISTINCT ON` never picks it
-- over an HRD Corp rule it was not meant to compete with. This is a UI gap the
-- screen itself will need to close (a side selector, at minimum); flagged, not
-- silently product-decided beyond what keeps the row insertable.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, WORKED ─────────────────────────────────
--
--  1 ENVELOPE. `app.ok`/`app.err` for the four reads; `RAISE … ERRCODE TRNOS`
--    for the two writes, identically to 021's `put_quotation`/`create_proposal`.
--  2 UNWRAP. No top-level key beside `data`.
--  3 RpcMap. Six new `core` functions, one argument list each, `$verify$`
--    below asserts an overload count of 1 for each.
--  4 CALL SITES. `getClaimPacket`: hrdc/api.ts:82, compliance/api.ts:38.
--    `getComplianceChecks`: hrdc/api.ts:90, engagements/api.ts:126 (024's
--    file — read only, not edited here). `attachPacketDocument`:
--    hrdc/api.ts:127. `exportClaimPacket`: hrdc/api.ts:147.
--    `createComplianceRule`: hrdc/api.ts:174, RulesRegistryScreen.tsx:268.
--    `getRuleChangeSet`: hrdc/api.ts:190.
--  5 CASTS. apps/web/src/shared/api/client.ts, apiClient.ts, rpcClient.ts —
--    same commit, one method each, no double cast (E2).
--  6 RELOAD/RESTORE. The two writes replay via `core.get_claim_packet` /
--    `core.get_compliance_rule` (018) on a repeated idempotency key.
--  7 PUBLIC ROUTES. Nothing granted to anon.
--
-- Rollback: rollbacks/025_hrdc_compliance_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ 1 · core.hrdc_document_types, provisioned like 016/017 ════════════════

CREATE OR REPLACE FUNCTION app.seed_hrdc_document_types(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'seed_hrdc_document_types: p_tenant_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The contract's own HRDC_DOCUMENT_TYPES (packages/contract/src/enums.ts).
  INSERT INTO core.hrdc_document_types (tenant_id, document_type, label, description, position)
  SELECT p_tenant_id, d.document_type, d.label, d.description, d.position
    FROM (VALUES
      ('ATTENDANCE_SHEET',   'Attendance sheet',
       'Signed daily attendance, exported from the engagement''s attendance record.', 10::smallint),
      ('TRAINER_TTT_CERT',   'Trainer TTT certificate',
       'The delivering trainer''s Train-The-Trainer accreditation.', 20::smallint),
      ('TAX_INVOICE',        'Tax invoice',
       'The tax invoice raised for the engagement.', 30::smallint),
      ('EVALUATION_SUMMARY', 'Evaluation summary',
       'Participant evaluation summary for the cohort.', 40::smallint),
      ('TRAINING_SCHEDULE',  'Training schedule',
       'The approved training schedule for the delivery dates claimed.', 50::smallint)
    ) AS d(document_type, label, description, position)
   WHERE NOT EXISTS (
     SELECT 1 FROM core.hrdc_document_types AS existing
      WHERE existing.tenant_id = p_tenant_id
        AND existing.document_type = d.document_type);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION app.seed_hrdc_document_types(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.seed_hrdc_document_types_on_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM app.seed_hrdc_document_types(NEW.id);
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION app.seed_hrdc_document_types_on_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tenants_seed_hrdc_document_types ON public.tenants;
CREATE TRIGGER trg_tenants_seed_hrdc_document_types
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app.seed_hrdc_document_types_on_tenant();

-- Register with 016's completeness guard, same shape as 017's check_keys row.
INSERT INTO app.tenant_seed_checks (pack, label, schema_name, table_name, note) VALUES
  ('025','HRD Corp document types','core','hrdc_document_types',
   'A claim packet has no required-document checklist at all: core.hrdc_packet_documents.document_type '
   'is FK''d to this table and attachPacketDocument refuses every call with a foreign-key violation, so '
   'the packet screen renders an empty, permanently-incomplete checklist.')
ON CONFLICT (schema_name, table_name) DO UPDATE
  SET pack = EXCLUDED.pack, label = EXCLUDED.label, note = EXCLUDED.note;

DO $doctype_backfill$
DECLARE r pg_catalog.record; v_total integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    v_total := v_total + app.seed_hrdc_document_types(r.id);
  END LOOP;
  RAISE NOTICE '025: backfilled % hrdc_document_types row(s)', v_total;
END;
$doctype_backfill$;

-- ═══ 2 · core.get_claim_packet(p_id text) ═══════════════════════════════════
--
-- `p_id` accepts the packet's own id/ref OR the engagement's id/ref — every
-- call site (hrdc/api.ts, compliance/api.ts) holds an engagementRef, never the
-- packet's own HPK ref, and FixtureClient.getClaimPacket resolves the same way
-- (`row.engagementRef === engagementRef || row.id === engagementRef`).

CREATE OR REPLACE FUNCTION core.get_claim_packet(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    record;
BEGIN
  IF NOT app.has_permission('hrdc:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','hrdc:read'));
  END IF;

  SELECT packet.id, packet.scheme, packet.employer_code, packet.claim_value_sen,
         packet.levy_available_sen, packet.currency, packet.completeness, packet.status,
         packet.deadline_at, packet.deadline_severity,
         packet.grant_reference, packet.grant_submitted_at, packet.grant_approved_at,
         packet.claim_reference, packet.claim_submitted_at,
         engagement.ref AS engagement_ref, organisation.ref AS organisation_ref
    INTO v_row
    FROM core.hrdc_packets AS packet
    JOIN core.engagements AS engagement
      ON engagement.tenant_id = packet.tenant_id AND engagement.id = packet.engagement_id
    JOIN core.organisations AS organisation
      ON organisation.tenant_id = packet.tenant_id AND organisation.id = packet.organisation_id
   WHERE packet.tenant_id = v_tenant
     AND (packet.id::text = p_id OR packet.ref = p_id
          OR engagement.id::text = p_id OR engagement.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',              v_row.id::text,
    'engagementRef',   v_row.engagement_ref,
    'organisationRef', v_row.organisation_ref,
    'scheme',          v_row.scheme::text,
    'employerCode',    v_row.employer_code,
    'claimValue',      app._money(v_row.claim_value_sen, v_row.currency::text),
    -- Contract types `levyAvailable` as a required Money; 009 stores it
    -- nullable (a packet can be drafted before the employer's levy balance is
    -- on file). COALESCEd to zero rather than emitting a shape the contract
    -- forbids — see app._money's null-means-absent rule.
    'levyAvailable',   app._money(COALESCE(v_row.levy_available_sen, 0), v_row.currency::text),
    'completeness',    v_row.completeness,
    'status',          v_row.status::text,
    'deadlineAt',      v_row.deadline_at,
    -- `pg_catalog.date_part`, not `EXTRACT(... FROM ...)`: the EXTRACT special
    -- form is not resolvable schema-qualified (011:573 sets the convention).
    'daysRemaining',   CASE WHEN v_row.deadline_at IS NULL THEN NULL
                             ELSE pg_catalog.ceil(pg_catalog.date_part(
                                    'epoch', v_row.deadline_at - pg_catalog.now()) / 86400)::integer END,
    'deadlineSeverity', COALESCE(v_row.deadline_severity::text, 'INFO'),
    'requiredDocuments', (
      SELECT COALESCE(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'type',   doc.document_type,
                 'label',  doctype.label,
                 'status', doc.status::text)
               || CASE WHEN COALESCE(att.ref, doc.source_ref) IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('ref', COALESCE(att.ref, doc.source_ref)) END
               || CASE WHEN doc.attached_at IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('meta',
                              'Attached ' || pg_catalog.to_char(doc.attached_at, 'DD Mon')) END
               ORDER BY doctype.position, doc.document_type), '[]'::jsonb)
        FROM core.hrdc_packet_documents AS doc
        JOIN core.hrdc_document_types AS doctype
          ON doctype.tenant_id = doc.tenant_id AND doctype.document_type = doc.document_type
        LEFT JOIN core.attachments AS att
          ON att.tenant_id = doc.tenant_id AND att.id = doc.attachment_id
       WHERE doc.tenant_id = v_tenant AND doc.hrdc_packet_id = v_row.id),
    'grant', CASE WHEN v_row.grant_reference IS NULL THEN NULL
                  ELSE pg_catalog.jsonb_build_object(
                    'reference',   v_row.grant_reference,
                    'submittedAt', v_row.grant_submitted_at,
                    'approvedAt',  v_row.grant_approved_at) END,
    'submission', CASE WHEN v_row.claim_reference IS NULL THEN NULL
                       ELSE pg_catalog.jsonb_build_object(
                         'reference',   v_row.claim_reference,
                         'submittedAt', v_row.claim_submitted_at) END,
    -- 009 has no dedicated submission-log table. Derived from the audit trail
    -- HRDC_PACKET_MARK_SUBMITTED (011/012) writes, rather than a second store
    -- of the same history; empty for a packet nothing has happened to yet.
    'submissionLog', (
      SELECT COALESCE(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'at', audit.at, 'actor', audit.actor, 'event', audit.event)
               ORDER BY audit.at), '[]'::jsonb)
        FROM core.audit_entries AS audit
       WHERE audit.tenant_id = v_tenant
         AND audit.subject_type = 'HRDC_PACKET'
         AND audit.subject_id = v_row.id)));
END;
$fn$;

-- ═══ 3 · core.get_compliance_checks(p_engagement_ref text) ═════════════════

CREATE OR REPLACE FUNCTION core.get_compliance_checks(p_engagement_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_eng     record;
  v_packet  record;
  v_latest  timestamptz;
  v_checks  jsonb;
  v_pass    integer;
  v_warn    integer;
  v_fail    integer;
  v_drift   jsonb;
BEGIN
  IF NOT app.has_permission('compliance:check:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','compliance:check:read'));
  END IF;

  SELECT engagement.id, engagement.ref, engagement.grant_pinned_at,
         grant_version.version_key AS grant_version_key
    INTO v_eng
    FROM core.engagements AS engagement
    LEFT JOIN core.rule_set_versions AS grant_version
      ON grant_version.id = engagement.grant_rule_set_version_id
   WHERE engagement.tenant_id = v_tenant
     AND (engagement.id::text = p_engagement_ref OR engagement.ref = p_engagement_ref);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('engagementRef', p_engagement_ref));
  END IF;

  -- §18: the claim side may not have happened yet. `v_packet` stays a
  -- null-valued record when there is no packet, and every field read off it
  -- below reads as SQL NULL rather than raising.
  SELECT packet.claim_submitted_at, claim_version.version_key AS claim_version_key
    INTO v_packet
    FROM core.hrdc_packets AS packet
    LEFT JOIN core.rule_set_versions AS claim_version
      ON claim_version.id = packet.claim_rule_set_version_id
   WHERE packet.tenant_id = v_tenant AND packet.engagement_id = v_eng.id;

  -- Each evaluation run writes a NEW batch of rows sharing one `evaluated_at`
  -- (009's own comment: "Re-running a check writes a NEW row rather than
  -- editing one, so the assessment history survives"). The screen renders the
  -- latest batch.
  SELECT pg_catalog.max(result.evaluated_at) INTO v_latest
    FROM core.compliance_check_results AS result
   WHERE result.tenant_id = v_tenant AND result.engagement_id = v_eng.id;

  SELECT
    COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'key',   result.check_key,
        'state', result.state::text,
        'label', result.label,
        'computed', result.computed)
      || CASE WHEN result.display IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('display', result.display) END
      || pg_catalog.jsonb_build_object('ruleId', result.compliance_rule_id::text)
      -- §17 compliance checks: a deterministic check carries origin SYSTEM,
      -- method DETERMINISTIC and no model (contract Provenance doc comment).
      -- No worker in this repo runs an INTERPRETED check yet, so that branch
      -- is defensive rather than exercised.
      || pg_catalog.jsonb_build_object('provenance',
           CASE WHEN result.method = 'INTERPRETED'
                THEN pg_catalog.jsonb_build_object('origin','AI_GENERATED','method',result.method)
                ELSE pg_catalog.jsonb_build_object('origin','SYSTEM','method','DETERMINISTIC') END)
      ORDER BY result.check_key), '[]'::jsonb),
    pg_catalog.count(*) FILTER (WHERE result.state = 'PASS'),
    pg_catalog.count(*) FILTER (WHERE result.state = 'WARN'),
    pg_catalog.count(*) FILTER (WHERE result.state = 'FAIL')
    INTO v_checks, v_pass, v_warn, v_fail
    FROM core.compliance_check_results AS result
   WHERE result.tenant_id = v_tenant AND result.engagement_id = v_eng.id
     AND result.evaluated_at = v_latest;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'checkKey',       result.check_key,
             'appliedVersion', applied.version_key,
             'currentVersion', current_v.version_key,
             'severity',       drift.severity::text,
             'message',        drift.message)
           ORDER BY drift.created_at), '[]'::jsonb)
    INTO v_drift
    FROM core.compliance_version_drifts AS drift
    JOIN core.compliance_check_results AS result
      ON result.tenant_id = drift.tenant_id AND result.id = drift.compliance_check_result_id
    JOIN core.rule_set_versions AS applied  ON applied.id  = drift.applied_version_id
    JOIN core.rule_set_versions AS current_v ON current_v.id = drift.current_version_id
   WHERE drift.tenant_id = v_tenant AND result.engagement_id = v_eng.id
     AND result.evaluated_at = v_latest;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'engagementRef', v_eng.ref,
    'evaluatedAt',   COALESCE(v_latest, pg_catalog.now()),
    'ruleResolution', pg_catalog.jsonb_build_object(
      'grantSide', pg_catalog.jsonb_build_object(
        'asOf',           v_eng.grant_pinned_at::date,
        'basis',          'GRANT_SUBMITTED',
        'ruleSetVersion', v_eng.grant_version_key),
      'claimSide', pg_catalog.jsonb_build_object(
        'asOf',           v_packet.claim_submitted_at::date,
        'basis',          'CLAIM_SUBMITTED',
        'ruleSetVersion', v_packet.claim_version_key)),
    'versionDrift', v_drift,
    'summary', pg_catalog.jsonb_build_object(
      'pass', COALESCE(v_pass, 0), 'warn', COALESCE(v_warn, 0), 'fail', COALESCE(v_fail, 0)),
    'checks', v_checks));
END;
$fn$;

-- ═══ 4 · core.attach_packet_document(p_id, p_body, p_idempotency_key) ══════
--
-- A direct write, not routed through the action envelope: 009/011 gate only
-- `hrdc_packets.status`, and `DRAFT -> READY` (and back) is an UNGATED legal
-- edge (011:1099-1100, `gated_by` NULL) — a document attach is not one of the
-- doc 01 §5.3 governed actions, only its side-effect on completeness is.

CREATE OR REPLACE FUNCTION core.attach_packet_document(
  p_id              text,
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant       uuid := app.require_tenant_id();
  v_actor        record;
  v_packet       core.hrdc_packets%ROWTYPE;
  v_doc          core.hrdc_packet_documents%ROWTYPE;
  v_type         text;
  v_ref          text;
  v_completeness numeric(4,3);
  v_hash         text;
  v_key          app.idempotency_keys%ROWTYPE;
BEGIN
  -- 025 · AUTHZ FIRST, decided before any read, validation or write.
  IF NOT app.has_permission('hrdc:document:write') THEN
    RAISE EXCEPTION 'requester lacks %', 'hrdc:document:write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','FORBIDDEN','requiredPermission','hrdc:document:write')::text;
  END IF;

  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  SELECT packet.* INTO v_packet
    FROM core.hrdc_packets AS packet
    JOIN core.engagements AS engagement
      ON engagement.tenant_id = packet.tenant_id AND engagement.id = packet.engagement_id
   WHERE packet.tenant_id = v_tenant
     AND (packet.id::text = p_id OR packet.ref = p_id
          OR engagement.id::text = p_id OR engagement.ref = p_id)
   FOR UPDATE OF packet;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such claim packet'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND','id',p_id)::text;
  END IF;

  IF NULLIF(p_idempotency_key,'') IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
    v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                pg_catalog.jsonb_build_object('id', p_id, 'body', p_body)::text, 'UTF8')), 'hex');
    INSERT INTO app.idempotency_keys (tenant_id, actor_id, endpoint, key, request_hash)
    VALUES (v_tenant, v_actor.actor_id, 'POST /v1/hrdc/packets/{id}/documents', p_idempotency_key, v_hash)
    ON CONFLICT (tenant_id, actor_id, endpoint, key) DO NOTHING
    RETURNING * INTO v_key;
    IF v_key.id IS NULL THEN
      SELECT existing.* INTO v_key FROM app.idempotency_keys AS existing
       WHERE existing.tenant_id = v_tenant AND existing.actor_id = v_actor.actor_id
         AND existing.endpoint = 'POST /v1/hrdc/packets/{id}/documents' AND existing.key = p_idempotency_key;
      IF v_key.request_hash IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'idempotency key reused with a different body'
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object(
                           'code','IDEMPOTENT_REPLAY',
                           'reason','KEY_REUSED_WITH_DIFFERENT_BODY',
                           'retryable', false)::text;
      END IF;
      PERFORM pg_catalog.set_config('response.headers','[{"Idempotent-Replay":"true"}]', true);
      RETURN core.get_claim_packet(v_packet.id::text);
    END IF;
  END IF;

  p_body := COALESCE(p_body, '{}'::jsonb);
  v_type := NULLIF(p_body ->> 'type', '');
  -- `Ref` (packages/contract/src/envelope.ts) is a plain string; `url` is the
  -- alternative the contract's `HrdcDocumentAttachRequest` offers. Either
  -- satisfies 009's `hpd_present_needs_evidence` CHECK once stored as
  -- `source_ref` — there is no attachment-upload endpoint in this lane's scope
  -- (non-goal: no worker/upload changes), so neither is resolved to a
  -- `core.attachments` row.
  v_ref  := COALESCE(NULLIF(p_body ->> 'ref', ''), NULLIF(p_body ->> 'url', ''));

  IF v_type IS NULL OR v_ref IS NULL THEN
    RAISE EXCEPTION 'attach_packet_document body validation failed'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',
              (CASE WHEN v_type IS NULL
                    THEN pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field','type','reason','REQUIRED'))
                    ELSE '[]'::jsonb END)
              || (CASE WHEN v_ref IS NULL
                    THEN pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field','ref','reason','REQUIRED'))
                    ELSE '[]'::jsonb END))::text;
  END IF;

  SELECT doc.* INTO v_doc
    FROM core.hrdc_packet_documents AS doc
   WHERE doc.tenant_id = v_tenant AND doc.hrdc_packet_id = v_packet.id AND doc.document_type = v_type
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that document is not on this packet''s checklist'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND','type',v_type)::text;
  END IF;

  UPDATE core.hrdc_packet_documents
     SET status = 'PRESENT', source_ref = v_ref, attached_at = pg_catalog.now()
   WHERE tenant_id = v_tenant AND id = v_doc.id;

  SELECT pg_catalog.round(
           pg_catalog.count(*) FILTER (WHERE status = 'PRESENT')::numeric
             / NULLIF(pg_catalog.count(*), 0), 3)
    INTO v_completeness
    FROM core.hrdc_packet_documents
   WHERE tenant_id = v_tenant AND hrdc_packet_id = v_packet.id;
  v_completeness := COALESCE(v_completeness, 0);

  UPDATE core.hrdc_packets SET completeness = v_completeness
   WHERE tenant_id = v_tenant AND id = v_packet.id;

  -- `DRAFT <-> READY` is ungated (011:1099-1100): completeness reaching or
  -- leaving 1.0 walks the edge directly. `READY -> SUBMITTED` stays behind
  -- `HRDC_PACKET_MARK_SUBMITTED` and is untouched here.
  IF v_completeness = 1 AND v_packet.status = 'DRAFT' THEN
    UPDATE core.hrdc_packets SET status = 'READY' WHERE tenant_id = v_tenant AND id = v_packet.id;
  ELSIF v_completeness < 1 AND v_packet.status = 'READY' THEN
    UPDATE core.hrdc_packets SET status = 'DRAFT' WHERE tenant_id = v_tenant AND id = v_packet.id;
  END IF;

  IF v_key.id IS NOT NULL THEN
    -- `response` must carry a `status` key or 011's `idempotency_keys_response_shape`
    -- CHECK refuses the write; `state` and `response` are a pair per
    -- `idempotency_keys_completion_pair`, so both flip together.
    UPDATE app.idempotency_keys
       SET state = 'COMPLETED',
           response = pg_catalog.jsonb_build_object(
             'status','EXECUTED','entity','hrdc_packet_document',
             'id', v_packet.id::text, 'type', v_type),
           status_code = 200,
           completed_at = pg_catalog.now(),
           expires_at = pg_catalog.now() + interval '24 hours'
     WHERE id = v_key.id;
  END IF;

  RETURN core.get_claim_packet(v_packet.id::text);
END;
$fn$;

-- ═══ 5 · core.export_claim_packet(p_id text) ═══════════════════════════════
--
-- No worker or storage change is in scope for this lane (non-goal): the eTRIS
-- upload bundle is not actually assembled anywhere in 001-021. This returns a
-- deterministic, time-bounded URL in the same shape `exportAttendance` (the
-- delivery lane's own gap) will need, and is listed under "could not verify":
-- the URL resolves to nothing until a real export job exists.

CREATE OR REPLACE FUNCTION core.export_claim_packet(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_ref    text;
BEGIN
  IF NOT app.has_permission('hrdc:export') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','hrdc:export'));
  END IF;

  SELECT engagement.ref INTO v_ref
    FROM core.hrdc_packets AS packet
    JOIN core.engagements AS engagement
      ON engagement.tenant_id = packet.tenant_id AND engagement.id = packet.engagement_id
   WHERE packet.tenant_id = v_tenant
     AND (packet.id::text = p_id OR packet.ref = p_id
          OR engagement.id::text = p_id OR engagement.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'url',       '/exports/' || v_ref || '-etris-bundle.zip',
    'expiresAt', pg_catalog.now() + interval '15 minutes'));
END;
$fn$;

-- ═══ 6 · core.create_compliance_rule(p_body, p_idempotency_key) ════════════

CREATE OR REPLACE FUNCTION core.create_compliance_rule(
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_actor    record;
  v_hash     text;
  v_key      app.idempotency_keys%ROWTYPE;
  v_missing  jsonb := '[]'::jsonb;
  v_code     text;
  v_family   text;
  v_new_id   uuid;
BEGIN
  -- 025 · AUTHZ FIRST.
  IF NOT app.has_permission('compliance:rule:write') THEN
    RAISE EXCEPTION 'requester lacks %', 'compliance:rule:write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','FORBIDDEN','requiredPermission','compliance:rule:write')::text;
  END IF;

  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  p_body := COALESCE(p_body, '{}'::jsonb);
  v_code := NULLIF(pg_catalog.btrim(p_body ->> 'id'), '');
  IF v_code IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','id','reason','REQUIRED'));
  END IF;
  IF NULLIF(p_body ->> 'subject', '') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','subject','reason','REQUIRED'));
  END IF;
  IF NULLIF(p_body ->> 'scheme', '') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','scheme','reason','REQUIRED'));
  END IF;
  IF NULLIF(p_body #>> '{expression,op}', '') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','expression.op','reason','REQUIRED'));
  END IF;
  IF NULLIF(p_body ->> 'effectiveFrom', '') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','effectiveFrom','reason','REQUIRED'));
  END IF;
  IF pg_catalog.jsonb_array_length(v_missing) > 0 THEN
    RAISE EXCEPTION 'compliance rule body validation failed'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','VALIDATION_FAILED','fields', v_missing)::text;
  END IF;

  IF NULLIF(p_idempotency_key,'') IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
    v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_body::text, 'UTF8')), 'hex');
    INSERT INTO app.idempotency_keys (tenant_id, actor_id, endpoint, key, request_hash)
    VALUES (v_tenant, v_actor.actor_id, 'POST /v1/compliance/rules', p_idempotency_key, v_hash)
    ON CONFLICT (tenant_id, actor_id, endpoint, key) DO NOTHING
    RETURNING * INTO v_key;
    IF v_key.id IS NULL THEN
      SELECT existing.* INTO v_key FROM app.idempotency_keys AS existing
       WHERE existing.tenant_id = v_tenant AND existing.actor_id = v_actor.actor_id
         AND existing.endpoint = 'POST /v1/compliance/rules' AND existing.key = p_idempotency_key;
      IF v_key.request_hash IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'idempotency key reused with a different body'
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object(
                           'code','IDEMPOTENT_REPLAY',
                           'reason','KEY_REUSED_WITH_DIFFERENT_BODY',
                           'retryable', false)::text;
      END IF;
      IF v_key.state = 'COMPLETED' AND v_key.response IS NOT NULL AND v_key.response ? 'id' THEN
        PERFORM pg_catalog.set_config('response.headers','[{"Idempotent-Replay":"true"}]', true);
        RETURN core.get_compliance_rule(v_key.response ->> 'id');
      END IF;
      RAISE EXCEPTION 'a request with this idempotency key is still in flight'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                         'code','IDEMPOTENT_REPLAY','reason','IN_FLIGHT','retryable', true)::text;
    END IF;
  END IF;

  -- `family_key`/`check_key` are not in the contract's `ComplianceRule` and
  -- the "Add rule" screen never collects a side, mode or family for a
  -- hand-typed rule. Synthesised from the caller's own code so the row can
  -- never collide with, supersede, or be superseded by an HRD Corp family it
  -- was not meant to compete with in `core.resolve_rules`'s per-family
  -- `DISTINCT ON`.
  v_family := 'USR_' || upper(regexp_replace(v_code, '[^A-Za-z0-9]+', '_', 'g'));

  INSERT INTO core.compliance_rules (
    tenant_id, rule_code, family_key, check_key, scheme, delivery_mode, side,
    kind, subject, subject_field, op, reference_kind, reference,
    offset_amount, offset_unit, effective_from, effective_to,
    source_document_id, source_title, source_section, source_page, source_excerpt,
    supersedes_rule_id,
    created_by_kind, created_by_id, created_by_name
  )
  VALUES (
    v_tenant, v_code, v_family, v_family,
    (p_body ->> 'scheme')::core.hrdc_scheme,
    'ANY'::core.delivery_mode,
    -- Not collected by the UI (see header). GRANT is the documented default
    -- until the screen adds a selector.
    'GRANT'::core.rule_side,
    'BINDING'::core.rule_kind,
    p_body ->> 'subject',
    COALESCE(p_body #>> '{expression,field}', ''),
    (p_body #>> '{expression,op}')::core.rule_op,
    'FIELD'::core.rule_reference_kind,
    COALESCE(p_body #>> '{expression,reference}', ''),
    COALESCE((p_body #>> '{expression,offsetDays}')::integer, 0),
    -- core.rule_offset_unit is DAY/MONTH only; §17's CALENDAR-vs-WORKING
    -- `dayBasis` has no column to land in (the same gap core.get_compliance_rule
    -- already carries, which always reports CALENDAR for the same reason).
    'DAY'::core.rule_offset_unit,
    (p_body ->> 'effectiveFrom')::date,
    NULLIF(p_body ->> 'effectiveTo', '')::date,
    NULLIF(p_body #>> '{source,documentId}', ''),
    NULLIF(p_body #>> '{source,title}', ''),
    NULLIF(p_body #>> '{source,section}', ''),
    NULLIF(p_body #>> '{source,page}', '')::smallint,
    NULLIF(p_body #>> '{source,excerpt}', ''),
    NULLIF(p_body ->> 'supersedesId', '')::uuid,
    'HUMAN'::app.actor_kind, v_actor.actor_id,
    NULLIF(p_body ->> 'requestedByName', '')
  )
  RETURNING id INTO v_new_id;

  IF v_key.id IS NOT NULL THEN
    UPDATE app.idempotency_keys
       SET state = 'COMPLETED',
           response = pg_catalog.jsonb_build_object(
             'status','EXECUTED','entity','compliance_rule','id', v_new_id::text),
           status_code = 201,
           completed_at = pg_catalog.now(),
           expires_at = pg_catalog.now() + interval '24 hours'
     WHERE id = v_key.id;
  END IF;

  RETURN core.get_compliance_rule(v_new_id::text);
END;
$fn$;

-- ═══ 7 · core.get_rule_change_set(p_document_id text) ══════════════════════
--
-- Mirrors 020's `core.v_rule_change_sets` projection exactly, narrowed to one
-- document and with an explicit `NOT_FOUND` rather than the view's silent
-- empty set — the same authz-first-then-base-tables shape `core.get_approval`
-- uses over `core.v_approval_requests`.

CREATE OR REPLACE FUNCTION core.get_rule_change_set(p_document_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    record;
BEGIN
  IF NOT app.has_permission('compliance:rule:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','compliance:rule:read'));
  END IF;

  SELECT change_set.id, change_set.document_id, change_set.title, change_set.published_at,
         change_set.ingested_at, change_set.extracted_by_model, change_set.extraction_confidence,
         change_set.run_id, change_set.effective_from
    INTO v_row
    FROM core.rule_change_sets AS change_set
   WHERE change_set.tenant_id = v_tenant AND change_set.document_id = p_document_id;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('documentId', p_document_id));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'documentId',   v_row.document_id,
    'title',        v_row.title,
    'publishedAt',  v_row.published_at,
    'ingestedAt',   v_row.ingested_at,
    'extractedBy',  pg_catalog.jsonb_build_object(
                       'model',      v_row.extracted_by_model,
                       'confidence', v_row.extraction_confidence,
                       'runId',      v_row.run_id::text),
    'effectiveFrom', v_row.effective_from,
    'changes', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id',           change.id::text,
               'op',           change.op::text,
               'targetRuleId', change.target_rule_id::text,
               'newRuleId',    change.new_rule_id::text,
               'before',       change.before_text,
               'after',        change.after_text,
               'sourceSpan',   pg_catalog.jsonb_build_object(
                                  'page',    change.source_page,
                                  'section', change.source_section,
                                  'excerpt', change.source_excerpt),
               'confidence',   change.confidence,
               'affectedEngagements', COALESCE((
                 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('ref', engagement.ref)
                                             ORDER BY engagement.ref)
                   FROM core.rule_change_affected_engagements AS affected
                   JOIN core.engagements AS engagement
                     ON engagement.tenant_id = affected.tenant_id AND engagement.id = affected.engagement_id
                  WHERE affected.tenant_id = change.tenant_id
                    AND affected.rule_change_id = change.id), '[]'::jsonb),
               'status', change.status)
             ORDER BY change.change_key, change.id)
        FROM core.rule_changes AS change
       WHERE change.tenant_id = v_tenant AND change.rule_change_set_id = v_row.id), '[]'::jsonb)));
END;
$fn$;

-- ═══ 8 · Grants ═════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION core.get_claim_packet(text)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_compliance_checks(text)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.attach_packet_document(text, jsonb, text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.export_claim_packet(text)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.create_compliance_rule(jsonb, text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_rule_change_set(text)                  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION core.get_claim_packet(text)                    TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_compliance_checks(text)               TO authenticated;
GRANT EXECUTE ON FUNCTION core.attach_packet_document(text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.export_claim_packet(text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION core.create_compliance_rule(jsonb, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_rule_change_set(text)                 TO authenticated;

COMMENT ON FUNCTION core.get_claim_packet(text) IS
  'GET /v1/hrdc/packets/{engagementRef}. hrdc:read. 025.';
COMMENT ON FUNCTION core.get_compliance_checks(text) IS
  'GET /v1/compliance/checks?engagementRef=. compliance:check:read. 025.';
COMMENT ON FUNCTION core.attach_packet_document(text, jsonb, text) IS
  'POST /v1/hrdc/packets/{id}/documents. hrdc:document:write. 025.';
COMMENT ON FUNCTION core.export_claim_packet(text) IS
  'GET /v1/hrdc/packets/{id}/export. hrdc:export. Placeholder URL: no export job exists yet. 025.';
COMMENT ON FUNCTION core.create_compliance_rule(jsonb, text) IS
  'POST /v1/compliance/rules. compliance:rule:write (FINANCE, ADMIN — not MD; 002''s own matrix). 025.';
COMMENT ON FUNCTION core.get_rule_change_set(text) IS
  'GET /v1/compliance/rule-changes/{documentId}. compliance:rule:read. 025.';

-- ═══ 9 · Verify ═════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_cnt int;
BEGIN
  -- V1 · every function exists exactly once (no accidental overload — E1's
  -- PGRST203 trap).
  SELECT pg_catalog.count(*) INTO v_cnt FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core'
     AND p.proname IN ('get_claim_packet','get_compliance_checks','attach_packet_document',
                        'export_claim_packet','create_compliance_rule','get_rule_change_set');
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION '025 verify: expected 6 new core functions, found %', v_cnt;
  END IF;

  IF EXISTS (
    SELECT p.proname, pg_catalog.count(*) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core'
       AND p.proname IN ('get_claim_packet','get_compliance_checks','attach_packet_document',
                          'export_claim_packet','create_compliance_rule','get_rule_change_set')
     GROUP BY p.proname HAVING pg_catalog.count(*) <> 1) THEN
    RAISE EXCEPTION '025 verify: one of the six functions is overloaded';
  END IF;

  -- V2 · every function is SECURITY DEFINER with search_path = '' (rule 1).
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core'
       AND p.proname IN ('get_claim_packet','get_compliance_checks','attach_packet_document',
                          'export_claim_packet','create_compliance_rule','get_rule_change_set')
       AND (NOT p.prosecdef OR NOT ('search_path=""' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))))) THEN
    RAISE EXCEPTION '025 verify: a function is missing SECURITY DEFINER or SET search_path = ''''';
  END IF;

  -- V3 · none of the six is reachable by anon.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core'
       AND p.proname IN ('get_claim_packet','get_compliance_checks','attach_packet_document',
                          'export_claim_packet','create_compliance_rule','get_rule_change_set')
       AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '025 verify: anon can execute one of the six functions';
  END IF;

  -- V4 · the hrdc_document_types provisioning trigger exists and the akademi
  -- perdana tenant already has document types (would be backfilled if the
  -- tenant pre-exists in this database, and seeded on insert otherwise).
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'tenants'
       AND NOT t.tgisinternal AND t.tgname = 'trg_tenants_seed_hrdc_document_types') THEN
    RAISE EXCEPTION '025 verify: the hrdc_document_types seed trigger is missing from public.tenants';
  END IF;
  SELECT pg_catalog.count(DISTINCT (tenant_id, document_type)) INTO v_cnt
    FROM core.hrdc_document_types;
  IF EXISTS (SELECT 1 FROM public.tenants) AND v_cnt = 0 THEN
    RAISE EXCEPTION '025 verify: tenants exist but core.hrdc_document_types is empty — the backfill did not run';
  END IF;

  RAISE NOTICE '025 verify: OK - 6 functions, definer+empty search_path, anon refused, document types provisioned.';
END;
$verify$;

COMMIT;
