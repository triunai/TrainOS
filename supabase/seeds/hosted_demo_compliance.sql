-- TrainOS hosted demo data for the compliance domain — HRD Corp rules
-- registry, rule changes, claim packets and compliance checks.
--
-- Runs AFTER `hosted_demo_akademi_perdana.sql`, for the EXISTING tenant
-- `akademi-perdana`, which carries no engagements of its own and no verified
-- compliance rules.
--
-- Run (one transaction, stop on the first error):
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_compliance.sql
--
-- Remove exactly what it added:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_compliance_wipe.sql
--
-- Pin (ends in ROLLBACK): supabase/tests/test_025_hrdc_compliance.sql
--
-- Hosted-safe by construction, same rules as the base demo seed:
--   * never provisions a tenant, never writes auth.users/memberships/profiles;
--   * never disables a trigger — every gated status (011 core.state_transitions)
--     is reached the way `app.perform_action` reaches it: a genuine
--     `core.action_requests` row of the gating type is created, published as
--     `app.effect_applier` for the one statement that needs it, and cleared —
--     the same LEGAL verification path `test_009`'s own `pg_temp.activate_rule`
--     fixture helper uses, not a second one invented here;
--   * leaves every `ref` NULL so `core.assign_ref` allocates it;
--   * depends ONLY on the base demo seed (organisations, programmes, the
--     tenant's default ENGAGEMENT pipeline) — not on any other domain lane's
--     seed. Engagements do not exist yet in the base seed or in any merged
--     lane at the time this was written, so three minimal ones are created
--     here, named so a later 'training'/'engagements' seed lane can recognise
--     and skip re-creating them by ref if it lands first.
--
-- WHAT THIS CLOSES. 009:298's `cr_active_needs_verification` CHECK and 011's
-- `enforce_state_transition` mean `core.resolve_rules` (ACTIVE/SUPERSEDED only)
-- returns NOTHING against 017's seed, because every rule 017 seeded loads
-- PROPOSED and nothing in 001-021 ever verifies one. §1 below verifies the
-- three national HRD-Corp rules 017 already seeded (HRD-QUERY-5D, HRD-007,
-- HRD-009) rather than inventing new ones, so the registry a real HRD Corp
-- circular produced is what the demo actually exercises.
--
-- Idempotent: every id is pg_temp.demo_id(<stable key>), guarded by NOT EXISTS.

CREATE OR REPLACE FUNCTION pg_temp.demo_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ('c0341a4e-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo:compliance:' || p_key) AS h) AS k;
$fn$;

-- GOV-07 fixture helper — see test_009's own copy and comment. Creates a
-- genuine action_requests row of the gating type, targeting the row that is
-- about to cross the edge, and publishes it as the applier for exactly the
-- statement that needs it.
CREATE OR REPLACE FUNCTION pg_temp.gate(p_tenant uuid, p_type text, p_target uuid, p_requested_by text)
RETURNS void LANGUAGE plpgsql AS $gate$
DECLARE v_id uuid;
BEGIN
  INSERT INTO core.action_requests
    (tenant_id, action_type, target_id, status, requested_by_kind, requested_by_id)
  VALUES (p_tenant, p_type, p_target, 'EXECUTING', 'HUMAN', p_requested_by)
  RETURNING id INTO v_id;
  PERFORM set_config('app.effect_applier', v_id::text, true);
END $gate$;

CREATE OR REPLACE FUNCTION pg_temp.ungate() RETURNS void LANGUAGE plpgsql AS $ungate$
BEGIN
  PERFORM set_config('app.effect_applier', '', true);
END $ungate$;

DROP TABLE IF EXISTS pg_temp.demo_ctx;
CREATE TEMP TABLE demo_ctx ON COMMIT DROP AS
SELECT tenant.id                                  AS t,
       'd1449fad-b732-4ee2-93c9-37f338e01358'::uuid AS u1,
       'ad615910-2d87-42a4-9855-58f52409ec6d'::uuid AS u2,
       '415dad6e-c53f-4a84-ab50-bf8e9e65223f'::uuid AS u3,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = 'd1449fad-b732-4ee2-93c9-37f338e01358') AS u1n,
       now()                                      AS at
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $pre$
DECLARE v_active integer; v_verifier text; v_orgs integer; v_progs integer; v_pipe integer;
BEGIN
  IF (SELECT count(*) FROM demo_ctx) <> 1 THEN
    RAISE EXCEPTION 'compliance demo seed: tenant akademi-perdana not found; this seed never provisions';
  END IF;
  -- Roles are hosted's own assignment, not a fixture this seed dictates:
  -- khucode/codeshern are ADMIN, khumeren/wishes2vows are MD. All three
  -- named members must exist as ACTIVE, whatever role they hold.
  SELECT count(*) INTO v_active FROM public.memberships m, demo_ctx c
   WHERE m.tenant_id = c.t AND m.user_id IN (c.u1, c.u2, c.u3)
     AND m.actor_kind = 'HUMAN' AND m.status = 'ACTIVE';
  IF v_active <> 3 THEN
    RAISE EXCEPTION 'compliance demo seed: expected all three named users as ACTIVE members, found %', v_active;
  END IF;
  -- The rule verifier (u2, khumeren) must hold compliance:rule:approve
  -- (002's matrix: FINANCE and MD only — ADMIN does not) since the packet
  -- submitter below needs hrdc:mark_submitted the same way (FINANCE/MD/OPS,
  -- not ADMIN). Checked by role rather than assumed.
  SELECT m.role::text INTO v_verifier FROM public.memberships m, demo_ctx c
   WHERE m.tenant_id = c.t AND m.user_id = c.u2 AND m.actor_kind = 'HUMAN' AND m.status = 'ACTIVE';
  IF v_verifier NOT IN ('MD','FINANCE') THEN
    RAISE EXCEPTION 'compliance demo seed: u2 must hold MD or FINANCE (has compliance:rule:approve '
      'and hrdc:mark_submitted per 002''s matrix); found %', v_verifier;
  END IF;
  SELECT count(*) INTO v_orgs FROM core.organisations o, demo_ctx c WHERE o.tenant_id = c.t;
  SELECT count(*) INTO v_progs FROM core.programmes p, demo_ctx c WHERE p.tenant_id = c.t;
  SELECT count(*) INTO v_pipe FROM core.pipelines p, demo_ctx c
   WHERE p.tenant_id = c.t AND p.object = 'ENGAGEMENT' AND p.is_default;
  IF v_orgs = 0 OR v_progs = 0 OR v_pipe = 0 THEN
    RAISE EXCEPTION
      'compliance demo seed: base demo data missing (orgs=%, programmes=%, engagement pipeline=%). '
      'Run hosted_demo_akademi_perdana.sql first.', v_orgs, v_progs, v_pipe;
  END IF;
  IF (SELECT count(*) FROM core.hrdc_document_types t, demo_ctx c WHERE t.tenant_id = c.t) = 0 THEN
    RAISE EXCEPTION 'compliance demo seed: core.hrdc_document_types has no rows for this tenant; apply 025 first.';
  END IF;
END
$pre$;

-- ═══ 1 · Verify the three national HRD Corp rules 017 already seeded ═══════
--
-- Grant-side: HRD-QUERY-5D (query response), HRD-007 (commencement window).
-- Claim-side: HRD-009 (claim window). All three load PROPOSED from 017; this
-- is the one place in the whole applied set that moves them ACTIVE, over the
-- legal RULE_CHANGE_APPROVE edge, with a named verifier and a timestamp
-- (009:298's own requirement).
DO $verify_rules$
DECLARE
  v_ctx  demo_ctx%ROWTYPE;
  v_rule record;
BEGIN
  SELECT * INTO v_ctx FROM demo_ctx;
  FOR v_rule IN
    SELECT id, rule_code FROM core.compliance_rules
     WHERE tenant_id IS NULL AND status = 'PROPOSED'
       AND rule_code IN ('HRD-QUERY-5D','HRD-007','HRD-009')
  LOOP
    -- u2 (khumeren, MD): 002's matrix gives compliance:rule:approve to
    -- FINANCE and MD only, not ADMIN — the verifier has to be someone who
    -- could actually hold that permission.
    PERFORM pg_temp.gate(v_ctx.t, 'RULE_CHANGE_APPROVE', v_rule.id, v_ctx.u2::text);
    UPDATE core.compliance_rules
       SET status = 'ACTIVE', verified_by_user_id = v_ctx.u2, verified_at = v_ctx.at - interval '30 days'
     WHERE id = v_rule.id;
    PERFORM pg_temp.ungate();
  END LOOP;
END
$verify_rules$;

-- Two registry snapshots: the one the grant/claim sides resolved against, and
-- a slightly later one, so a version-drift row (§5) has two real versions to
-- cite rather than a synthetic pair.
INSERT INTO core.rule_set_versions (id, tenant_id, version_key, registry_asof, note)
SELECT pg_temp.demo_id('rsv-2026-08-01'), NULL, 'rs_2026_08_01', TIMESTAMPTZ '2026-08-01 00:00:00+08', 'Registry as of 1 Aug 2026, before the September verification pass.'
 WHERE NOT EXISTS (SELECT 1 FROM core.rule_set_versions WHERE id = pg_temp.demo_id('rsv-2026-08-01'));
INSERT INTO core.rule_set_versions (id, tenant_id, version_key, registry_asof, note)
SELECT pg_temp.demo_id('rsv-2026-09-14'), NULL, 'rs_2026_09_14', demo_ctx.at, 'Registry as of the 2026-09-13 compliance refresh.'
  FROM demo_ctx
 WHERE NOT EXISTS (SELECT 1 FROM core.rule_set_versions WHERE id = pg_temp.demo_id('rsv-2026-09-14'));

-- ═══ 2 · Three minimal engagements ══════════════════════════════════════════
--
-- No engagements exist yet in the base seed or in any lane merged at the time
-- this was written (per the compliance lane brief). Three are created here,
-- each against a real organisation and programme from the base seed and the
-- tenant's own default ENGAGEMENT pipeline, in their initial state (PROPOSED)
-- with no status walk — the compliance screens read engagement.ref and
-- grant_rule_set_version_id, not the delivery lifecycle.
INSERT INTO core.engagements
  (id, tenant_id, ref, organisation_id, programme_id, owner_id, pipeline_id, title, status,
   value_sen, currency, grant_rule_set_version_id, grant_pinned_at, starts_on, ends_on,
   created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, NULL,
       (SELECT o.id FROM core.organisations o WHERE o.tenant_id = c.t AND o.ref = v.org_ref),
       (SELECT p.id FROM core.programmes p WHERE p.tenant_id = c.t AND p.ref = v.prog_ref),
       c.u1,
       (SELECT p.id FROM core.pipelines p WHERE p.tenant_id = c.t AND p.object = 'ENGAGEMENT' AND p.is_default),
       v.title, 'PROPOSED',
       v.value, 'MYR',
       pg_temp.demo_id(v.rsv), c.at - interval '20 days', v.starts, v.ends,
       c.at - interval '25 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('eng-aurora',  'ORG-0003', 'PRG-0004', 'Safety Leadership Essentials · Aurora Manufacturing',
     1850000::bigint, 'rsv-2026-08-01', DATE '2026-11-10', DATE '2026-11-11'),
    ('eng-kenanga', 'ORG-0002', 'PRG-0005', 'Sales Excellence for Store Managers · Kenanga Retail',
     1240000::bigint, 'rsv-2026-08-01', DATE '2026-10-06', DATE '2026-10-07'),
    ('eng-meridian','ORG-0004', 'PRG-0001', 'Leading Through Change · Meridian Logistics',
     1920000::bigint, 'rsv-2026-09-14', DATE '2026-12-02', DATE '2026-12-03')
  ) AS v(k, org_ref, prog_ref, title, value, rsv, starts, ends)
 WHERE NOT EXISTS (SELECT 1 FROM core.engagements WHERE id = pg_temp.demo_id(v.k));

-- ═══ 3 · Claim packets, walked over their legal edges ═══════════════════════
--
-- Aurora: DRAFT, two of five documents present — the working case.
-- Kenanga: READY (all five present), not yet submitted — the "ready to file"
--   case, and the claim side of ruleResolution stays null.
-- Meridian: SUBMITTED, claim side pinned to the newer registry snapshot —
--   the completed case, reached via HRDC_PACKET_MARK_SUBMITTED, the legal
--   gate, not a direct UPDATE.
INSERT INTO core.hrdc_packets
  (id, tenant_id, ref, engagement_id, organisation_id, scheme, employer_code,
   claim_value_sen, levy_available_sen, currency, completeness, status,
   deadline_at, deadline_severity, grant_reference, grant_submitted_at, grant_approved_at,
   created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, NULL,
       pg_temp.demo_id(v.eng),
       (SELECT e.organisation_id FROM core.engagements e WHERE e.id = pg_temp.demo_id(v.eng)),
       v.scheme::core.hrdc_scheme, v.employer_code,
       v.claim, v.levy, 'MYR', 0, 'DRAFT',
       c.at + v.deadline_offset, v.severity::core.severity,
       v.grant_ref, c.at - interval '40 days', c.at - interval '35 days',
       c.at - interval '20 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('pkt-aurora',  'eng-aurora',  'SBL_KHAS', 'EMP-AUR-001', 1850000::bigint, 6200000::bigint,
     interval '18 days', 'WARN', 'GRA-AUR-2026-0142'),
    ('pkt-kenanga', 'eng-kenanga','SBL',      'EMP-KEN-004', 1240000::bigint, 3100000::bigint,
     interval '45 days', 'INFO', 'GRA-KEN-2026-0098'),
    ('pkt-meridian','eng-meridian','SBL_KHAS', 'EMP-MER-002', 1920000::bigint, 9800000::bigint,
     interval '6 days',  'DANGER', 'GRA-MER-2026-0177')
  ) AS v(k, eng, scheme, employer_code, claim, levy, deadline_offset, severity, grant_ref)
 WHERE NOT EXISTS (SELECT 1 FROM core.hrdc_packets WHERE id = pg_temp.demo_id(v.k));

-- Every packet gets all five required documents, MISSING by default.
INSERT INTO core.hrdc_packet_documents (id, tenant_id, hrdc_packet_id, document_type, status)
SELECT pg_temp.demo_id('doc-' || v.pkt || '-' || doctype.document_type),
       c.t, pg_temp.demo_id(v.pkt), doctype.document_type, 'MISSING'
  FROM demo_ctx c,
       (VALUES ('pkt-aurora'), ('pkt-kenanga'), ('pkt-meridian')) AS v(pkt),
       core.hrdc_document_types AS doctype
 WHERE doctype.tenant_id = c.t
   AND NOT EXISTS (
     SELECT 1 FROM core.hrdc_packet_documents
      WHERE id = pg_temp.demo_id('doc-' || v.pkt || '-' || doctype.document_type));

-- Aurora: two of five present (partial — the working case).
UPDATE core.hrdc_packet_documents AS doc
   SET status = 'PRESENT', source_ref = 'ATT-DEMO-0001', attached_at = demo_ctx.at - interval '3 days'
  FROM demo_ctx
 WHERE doc.tenant_id = demo_ctx.t
   AND doc.hrdc_packet_id = pg_temp.demo_id('pkt-aurora')
   AND doc.document_type IN ('TRAINING_SCHEDULE','TRAINER_TTT_CERT')
   AND doc.status = 'MISSING';
UPDATE core.hrdc_packets SET completeness = 0.400
 WHERE id = pg_temp.demo_id('pkt-aurora') AND completeness = 0;

-- Kenanga: all five present, walked DRAFT -> READY over the ungated edge
-- (011:1099-1100).
UPDATE core.hrdc_packet_documents AS doc
   SET status = 'PRESENT', source_ref = 'ATT-DEMO-0002', attached_at = demo_ctx.at - interval '5 days'
  FROM demo_ctx
 WHERE doc.tenant_id = demo_ctx.t
   AND doc.hrdc_packet_id = pg_temp.demo_id('pkt-kenanga')
   AND doc.status = 'MISSING';
UPDATE core.hrdc_packets SET completeness = 1
 WHERE id = pg_temp.demo_id('pkt-kenanga') AND completeness = 0;
UPDATE core.hrdc_packets SET status = 'READY'
 WHERE id = pg_temp.demo_id('pkt-kenanga') AND status = 'DRAFT';

-- Meridian: all five present, walked DRAFT -> READY -> SUBMITTED, the last
-- edge over the legal HRDC_PACKET_MARK_SUBMITTED gate.
UPDATE core.hrdc_packet_documents AS doc
   SET status = 'PRESENT', source_ref = 'ATT-DEMO-0003', attached_at = demo_ctx.at - interval '10 days'
  FROM demo_ctx
 WHERE doc.tenant_id = demo_ctx.t
   AND doc.hrdc_packet_id = pg_temp.demo_id('pkt-meridian')
   AND doc.status = 'MISSING';
UPDATE core.hrdc_packets SET completeness = 1
 WHERE id = pg_temp.demo_id('pkt-meridian') AND completeness = 0;
UPDATE core.hrdc_packets SET status = 'READY'
 WHERE id = pg_temp.demo_id('pkt-meridian') AND status = 'DRAFT';

DO $submit_meridian$
DECLARE v_ctx demo_ctx%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_ctx FROM demo_ctx;
  v_id := pg_temp.demo_id('pkt-meridian');
  IF (SELECT status FROM core.hrdc_packets WHERE id = v_id) = 'READY' THEN
    -- u2 (khumeren, MD): hrdc:mark_submitted is FINANCE/MD/OPS, not ADMIN.
    PERFORM pg_temp.gate(v_ctx.t, 'HRDC_PACKET_MARK_SUBMITTED', v_id, v_ctx.u2::text);
    UPDATE core.hrdc_packets
       SET status = 'SUBMITTED',
           claim_reference = 'CLM-MER-2026-0311',
           claim_submitted_at = v_ctx.at - interval '2 days',
           claim_rule_set_version_id = pg_temp.demo_id('rsv-2026-09-14')
     WHERE id = v_id;
    PERFORM pg_temp.ungate();
  END IF;
END
$submit_meridian$;

-- ═══ 4 · Compliance check results ═══════════════════════════════════════════
--
-- Meridian (submitted): both grant-side rules PASS, claim-side rule PASS —
-- the clean case. Aurora (in progress): the commencement-window rule WARNs,
-- close to its threshold — the working case a screen actually needs to show
-- something other than green. One row per (engagement, rule).
INSERT INTO core.compliance_check_results
  (id, tenant_id, engagement_id, check_key, state, label, computed,
   compliance_rule_id, rule_set_version_id, rule_side, rules_as_of, basis, method, evaluated_at)
SELECT pg_temp.demo_id('ccr-' || v.eng || '-' || v.check_key),
       c.t, pg_temp.demo_id(v.eng), v.check_key, v.state::core.check_state, v.label, v.computed::jsonb,
       (SELECT r.id FROM core.compliance_rules r WHERE r.rule_code = v.rule_code AND r.tenant_id IS NULL),
       pg_temp.demo_id(v.rsv), v.side::core.rule_side, v.rules_as_of::date, v.basis::core.rule_resolution_basis,
       'DETERMINISTIC', v.evaluated_at
  FROM demo_ctx c, (VALUES
    ('eng-meridian','CHK_QUERY_DEADLINE','PASS','Query response deadline',
     '{"queryRaisedAt":null,"queryRespondedAt":null}', 'HRD-QUERY-5D','rsv-2026-09-14','GRANT','2026-08-15','GRANT_SUBMITTED', now() - interval '2 days'),
    ('eng-meridian','CHK_COMMENCEMENT_WINDOW','PASS','Commencement window',
     '{"approvalDate":"2026-08-12","startsOn":"2026-12-02","limitDays":90}', 'HRD-007','rsv-2026-09-14','GRANT','2026-08-15','GRANT_SUBMITTED', now() - interval '2 days'),
    ('eng-meridian','CHK_CLAIM_WINDOW','PASS','Claim window',
     '{"completedAt":"2026-12-03","claimSubmittedAt":"2026-09-12","limitMonths":6}', 'HRD-009','rsv-2026-09-14','CLAIM','2026-09-12','CLAIM_SUBMITTED', now() - interval '2 days'),
    ('eng-aurora','CHK_COMMENCEMENT_WINDOW','WARN','Commencement window',
     '{"approvalDate":"2026-08-02","startsOn":"2026-11-10","limitDays":90,"daysUsed":86}', 'HRD-007','rsv-2026-08-01','GRANT','2026-08-02','GRANT_SUBMITTED', now() - interval '1 day')
  ) AS v(eng, check_key, state, label, computed, rule_code, rsv, side, rules_as_of, basis, evaluated_at)
 WHERE NOT EXISTS (SELECT 1 FROM core.compliance_check_results WHERE id = pg_temp.demo_id('ccr-' || v.eng || '-' || v.check_key));

-- One version-drift row on Aurora's commencement check: DECISIONS §6, the
-- applicable version changed between the grant pin and today's registry.
INSERT INTO core.compliance_version_drifts
  (id, tenant_id, compliance_check_result_id, applied_version_id, current_version_id, severity, message)
SELECT pg_temp.demo_id('drift-aurora-commencement'), c.t,
       pg_temp.demo_id('ccr-eng-aurora-CHK_COMMENCEMENT_WINDOW'),
       pg_temp.demo_id('rsv-2026-08-01'), pg_temp.demo_id('rsv-2026-09-14'), 'WARN',
       'The commencement-window rule was re-verified on 13 Sep 2026, after this check last ran. Re-run to confirm the result still holds.'
  FROM demo_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.compliance_version_drifts WHERE id = pg_temp.demo_id('drift-aurora-commencement'));

-- ═══ 5 · A rule change set — an ingested circular, PROPOSED ════════════════

INSERT INTO core.rule_change_sets
  (id, tenant_id, document_id, title, published_at, ingested_at, effective_from,
   extracted_by_model, extraction_confidence, status)
SELECT pg_temp.demo_id('rcs-circular-3-2026'), c.t, 'HRDC-CIRCULAR-3-2026',
       'HRD Corp Circular 3/2026 — Claim window amendment', DATE '2026-09-01', c.at - interval '10 days',
       DATE '2027-01-01', 'claude-sonnet-5', 0.910, 'PROPOSED'
  FROM demo_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.rule_change_sets WHERE id = pg_temp.demo_id('rcs-circular-3-2026'));

INSERT INTO core.rule_changes
  (id, tenant_id, rule_change_set_id, change_key, op, target_rule_id, before_text, after_text,
   source_page, source_section, source_excerpt, confidence, withheld, status)
SELECT pg_temp.demo_id('rc-circular-3-2026-claim-window'), c.t, pg_temp.demo_id('rcs-circular-3-2026'),
       'claim-window-extension', 'SUPERSEDE'::core.rule_change_op,
       (SELECT r.id FROM core.compliance_rules r WHERE r.rule_code = 'HRD-009' AND r.tenant_id IS NULL),
       'A claim must be filed within 6 months of completion.',
       'A claim must be filed within 9 months of completion, effective 1 January 2027.',
       4, 'Claim submission', 'Providers have raised the 6-month window as too tight for multi-cohort programmes; effective 1 January 2027 the window extends to 9 months.',
       0.910, false, 'PROPOSED'
  FROM demo_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.rule_changes WHERE id = pg_temp.demo_id('rc-circular-3-2026-claim-window'));

INSERT INTO core.rule_change_affected_engagements (id, tenant_id, rule_change_id, engagement_id)
SELECT pg_temp.demo_id('rcae-circular-3-2026-meridian'), c.t,
       pg_temp.demo_id('rc-circular-3-2026-claim-window'), pg_temp.demo_id('eng-meridian')
  FROM demo_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.rule_change_affected_engagements WHERE id = pg_temp.demo_id('rcae-circular-3-2026-meridian'));

DROP TABLE pg_temp.demo_ctx;
