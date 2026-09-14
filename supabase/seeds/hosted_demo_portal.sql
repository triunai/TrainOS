-- TrainOS hosted demo: ONE live client-portal link for tenant `akademi-perdana`.
--
-- Run AFTER migration 028 and AFTER hosted_demo_akademi_perdana.sql, in one
-- transaction, stopping on the first error:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_portal.sql
--
-- The run PRINTS the link path once, as a one-row result named `portal_link`
-- (`/p/tk_pt_…`). Prefix it with the web app's origin. The raw token exists
-- only in that output and in a temp table dropped at COMMIT; the database stores
-- its SHA-256 and nothing else, so a lost link cannot be recovered — revoke it
-- (public_share_tokens.revoked_at) and re-run to mint another. The link expires
-- 30 days after it is minted (007's default).
--
-- Remove exactly what it added (run BEFORE hosted_demo_wipe.sql, whose guard
-- refuses while these rows reference its organisation and programme):
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_portal_wipe.sql
--
-- Pin (ends in ROLLBACK): supabase/seeds/test_hosted_demo_portal.sql
--
-- WHAT IT WRITES. A new DRAFT proposal for Aurora Precision Tooling (an existing
-- demo PROSPECT with no proposal yet), with its contact, opportunity, four
-- sections and a priced quotation — then SENDS it through the real envelope and
-- mints the link:
--
--   1. PROPOSAL_SEND via core.perform_action as Code Shern (the account owner).
--      Policy APV-01 queues it on BOTH of its conditions: RM 26,400 is above
--      its RM 15,000 threshold, and it is the first proposal to the
--      organisation. The value alone guarantees the queue, so a proposal
--      someone else already sent this prospect cannot turn the send into an
--      immediate one that skips the approval.
--   2. APPROVE via core.decide_approval as Khu Code — a DIFFERENT MD, because
--      011 GOV-03 refuses self-approval — with the approval's own diff hash.
--      011 executes the effect: DRAFT -> SENT, under the running action.
--   3. app.issue_portal_token (028) for that SENT proposal.
--
-- WHY A NEW PROPOSAL, not one of the three the demo seed already has. Each of
-- those is carrying a demo story a real send would break: Aurora Manufacturing
-- and Meridian each have a seeded PENDING PROPOSAL_SEND approval in the inbox
-- (sending the proposal by another request would strand it, and deciding it
-- later would fail on SENT -> SENT), and Perdana's quotation has a pending
-- below-floor discount. A new prospect's first proposal needs none of them.
--
-- HOSTED-SAFE, as hosted_demo_akademi_perdana.sql is:
--   * the tenant is taken by slug; never provisions, never writes auth.users,
--     memberships or profiles; every user reference is one of the three MDs;
--   * no trigger is disabled. Rows are inserted in initial states and walked
--     over ungated edges (opportunity NEW -> QUALIFYING); the gated edge
--     (proposal DRAFT -> SENT) is walked only by 011 executing an approved
--     PROPOSAL_SEND;
--   * refs are left NULL for core.assign_ref;
--   * the contact's address is on the reserved `.example` domain (RFC 2606),
--     so the send's email effect — should a worker ever drain it — cannot reach
--     a real inbox.
--
-- IDEMPOTENT. Direct inserts use deterministic ids from pg_temp.portal_id(<key>)
-- (d0280a11-5eed-4xxx-8xxx-…), guarded by NOT EXISTS. The send is attempted only
-- while the proposal is DRAFT with no PROPOSAL_SEND request against it; the
-- approval only while PENDING; a link is minted only when the proposal has no
-- live link. A second run writes nothing and prints no link.
--
-- The two principals are set with set_config(..., true): transaction-local, and
-- cleared again at the end of this file.

-- ── Context ──────────────────────────────────────────────────────────────────

-- hosted_demo_akademi_perdana.sql's own id function, READ ONLY here: it locates
-- the organisation, programme, template and rate card that seed wrote.
CREATE OR REPLACE FUNCTION pg_temp.demo_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ('de30da7a-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo:' || p_key) AS h) AS k;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.portal_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ('d0280a11-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo-portal:' || p_key) AS h) AS k;
$fn$;

-- The claims app.custom_access_token_hook would issue for this MD IN THIS
-- TENANT, built from the membership row rather than from principal_claims(),
-- which picks the user's default membership and could name another tenant.
CREATE OR REPLACE FUNCTION pg_temp.portal_claims(p_tenant uuid, p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT jsonb_build_object(
           'sub', m.user_id, 'role', 'authenticated', 'aal', 'aal1',
           'tenant_id', m.tenant_id, 'app_role', m.role, 'actor_kind', m.actor_kind,
           'agent_id', m.agent_id, 'team_id', m.primary_team_id, 'trainer_id', m.trainer_id,
           'client_scope', m.client_scope, 'team_scope', m.team_scope,
           'mfa_required', m.mfa_required)::text
    FROM public.memberships m
   WHERE m.tenant_id = p_tenant AND m.user_id = p_user
     AND m.role = 'MD' AND m.actor_kind = 'HUMAN' AND m.status = 'ACTIVE';
$fn$;

DROP TABLE IF EXISTS pg_temp.portal_ctx;
CREATE TEMP TABLE portal_ctx ON COMMIT DROP AS
SELECT tenant.id                                  AS t,
       'd1449fad-b732-4ee2-93c9-37f338e01358'::uuid AS u1,
       'ad615910-2d87-42a4-9855-58f52409ec6d'::uuid AS u2,
       '415dad6e-c53f-4a84-ab50-bf8e9e65223f'::uuid AS u3,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = '415dad6e-c53f-4a84-ab50-bf8e9e65223f') AS u3n,
       now()                                      AS at
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DROP TABLE IF EXISTS pg_temp.portal_link;
CREATE TEMP TABLE portal_link (portal_link text) ON COMMIT DROP;

DO $pre$
DECLARE
  v_ctx portal_ctx%ROWTYPE;
  v_md  integer;
BEGIN
  IF (SELECT count(*) FROM portal_ctx) <> 1 THEN
    RAISE EXCEPTION 'portal demo seed: tenant akademi-perdana not found; this seed never provisions';
  END IF;
  SELECT * INTO v_ctx FROM portal_ctx;
  SELECT count(*) INTO v_md
    FROM public.memberships m
   WHERE m.tenant_id = v_ctx.t AND m.user_id IN (v_ctx.u1, v_ctx.u2, v_ctx.u3)
     AND m.role = 'MD' AND m.actor_kind = 'HUMAN' AND m.status = 'ACTIVE';
  IF v_md <> 3 OR v_ctx.u3n IS NULL THEN
    RAISE EXCEPTION 'portal demo seed: expected all three MD users as ACTIVE members with profiles, found %', v_md;
  END IF;
  IF to_regprocedure('core.accept_portal_proposal(text,jsonb)') IS NULL
     OR to_regprocedure('app.issue_portal_token(uuid,uuid,interval)') IS NULL THEN
    RAISE EXCEPTION 'portal demo seed: migration 028 is not applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.organisations x WHERE x.tenant_id = v_ctx.t AND x.id = pg_temp.demo_id('org:auroratl'))
     OR NOT EXISTS (SELECT 1 FROM core.programmes x WHERE x.tenant_id = v_ctx.t AND x.id = pg_temp.demo_id('prg:conflict'))
     OR NOT EXISTS (SELECT 1 FROM core.templates x WHERE x.tenant_id = v_ctx.t AND x.id = pg_temp.demo_id('tpl:proposal'))
     OR NOT EXISTS (SELECT 1 FROM core.rate_cards x WHERE x.tenant_id = v_ctx.t AND x.id = pg_temp.demo_id('rc:2026')) THEN
    RAISE EXCEPTION 'portal demo seed: run hosted_demo_akademi_perdana.sql first';
  END IF;
  -- An accept must be able to create its engagement, or the link demos a refusal.
  IF NOT EXISTS (SELECT 1 FROM core.pipelines x WHERE x.tenant_id = v_ctx.t AND x.object = 'ENGAGEMENT' AND x.is_default) THEN
    RAISE EXCEPTION 'portal demo seed: the tenant has no default ENGAGEMENT pipeline (019)';
  END IF;
END
$pre$;

-- ── Contact, opportunity ─────────────────────────────────────────────────────

INSERT INTO core.contacts (id, tenant_id, organisation_id, name, job_title, email, phone, is_primary, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.portal_id('con:hana'), c.t, pg_temp.demo_id('org:auroratl'), 'Hana Rahman', 'Head of People',
       'hana.rahman@auroratooling.example', NULL, true, c.at - interval '20 days', 'HUMAN', c.u3::text, c.u3n
  FROM portal_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.contacts x WHERE x.id = pg_temp.portal_id('con:hana'));

INSERT INTO core.contact_consents (id, tenant_id, contact_id, channel, granted, recorded_at, purpose, source, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.portal_id('cns:hana:EMAIL'), c.t, pg_temp.portal_id('con:hana'), 'EMAIL', true,
       c.at - interval '20 days', 'ENQUIRY_RESPONSE', 'demo seed', c.at - interval '20 days', 'HUMAN', c.u3::text, c.u3n
  FROM portal_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.contact_consents x WHERE x.id = pg_temp.portal_id('cns:hana:EMAIL'));

INSERT INTO core.opportunities (id, tenant_id, organisation_id, primary_contact_id, owner_id, value_sen, probability, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.portal_id('opp:auroratl'), c.t, pg_temp.demo_id('org:auroratl'), pg_temp.portal_id('con:hana'), c.u3,
       2640000, 0.600, c.at - interval '9 days', 'HUMAN', c.u3::text, c.u3n
  FROM portal_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.opportunities x WHERE x.id = pg_temp.portal_id('opp:auroratl'));

UPDATE core.opportunities AS o SET stage = 'QUALIFYING', stage_changed_at = now()
  FROM portal_ctx c
 WHERE o.tenant_id = c.t AND o.id = pg_temp.portal_id('opp:auroratl') AND o.stage = 'NEW';

-- ── Proposal (DRAFT), sections, quotation ────────────────────────────────────

INSERT INTO core.proposals (id, tenant_id, opportunity_id, organisation_id, template_id, programme_id, value_sen, margin_rate, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.portal_id('pro:auroratl'), c.t, pg_temp.portal_id('opp:auroratl'), pg_temp.demo_id('org:auroratl'),
       pg_temp.demo_id('tpl:proposal'), pg_temp.demo_id('prg:conflict'), 2640000, 0.6030,
       c.at - interval '2 days', 'AGENT', 'agent_proposal', 'Proposal Agent'
  FROM portal_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.proposals x WHERE x.id = pg_temp.portal_id('pro:auroratl'));

INSERT INTO core.proposal_sections (id, tenant_id, proposal_id, n, title, body, merge_fields_used, needs_review, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.portal_id('sec:auroratl:' || v.n), c.t, pg_temp.portal_id('pro:auroratl'), v.n, v.title, v.body, v.fields, false,
       p.created_at, 'AGENT', 'agent_proposal', 'Proposal Agent'
  FROM portal_ctx c, (VALUES
    (1, 'Understanding your needs', 'Aurora Precision Tooling''s 26 shift supervisors are moving from one plant to two in Klang. Handover disagreements between the day and night shifts now reach the plant manager instead of being settled on the floor.', ARRAY['client.name']),
    (2, 'Recommended programme',    'Conflict to Collaboration is a one-day facilitated workshop, run as two cohorts of up to 26 supervisors so each plant keeps a shift on the floor, built on handover disputes your supervisors have already had.', ARRAY['programme.title']),
    (3, 'Delivery plan',            'One day on site at each Klang plant in January 2027, with a two-hour follow-up clinic for each cohort six weeks later.', ARRAY['engagement.dates']),
    (4, 'Investment',               'RM 26,400 for two cohorts of up to 26 participants each, inclusive of materials and trainer travel. Claimable under HRD Corp SBL-Khas subject to prior grant approval.', ARRAY['investment.total'])
  ) AS v(n, title, body, fields)
  JOIN core.proposals p ON p.id = pg_temp.portal_id('pro:auroratl')
 WHERE NOT EXISTS (SELECT 1 FROM core.proposal_sections x WHERE x.id = pg_temp.portal_id('sec:auroratl:' || v.n));

INSERT INTO core.quotations (id, tenant_id, proposal_id, rate_card_id, pax, sell_price_sen, direct_cost_sen, programme_floor_price_sen, floor_margin_rate, commission_rate, commission_payable_on, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.portal_id('quo:auroratl'), c.t, pg_temp.portal_id('pro:auroratl'), pg_temp.demo_id('rc:2026'), 52,
       2640000, 1048000, 1716000, 0.35, 0.08, 'COLLECTION', c.at - interval '2 days', 'HUMAN', c.u3::text, c.u3n
  FROM portal_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.quotations x WHERE x.id = pg_temp.portal_id('quo:auroratl'));

INSERT INTO core.quotation_lines (id, tenant_id, quotation_id, n, item, detail, basis, qty, unit, unit_price_sen, is_cost, created_at)
SELECT pg_temp.portal_id('ql:auroratl:' || v.n), c.t, pg_temp.portal_id('quo:auroratl'), v.n, v.item, v.detail, v.basis, v.qty, v.unit, v.price, v.is_cost, q.created_at
  FROM portal_ctx c, (VALUES
    (1, 'TRAINER_FEE', 'Band B trainer · 2 cohort days', 'PER_DAY',  2::numeric, 'DAY',  360000::bigint, true),
    (2, 'VENUE',       'Client sites · Klang',           'PER_UNIT', 0,          NULL,   0,              true),
    (3, 'MATERIALS',   'Workbooks',                      'PER_PAX',  52,         'PAX',  4000,           true),
    (4, 'TRAVEL',      'Klang Valley',                   'PER_UNIT', 4,          'TRIP', 30000,          true),
    (5, 'SELL_PRICE',  'Quoted price to the client',     'PACKAGE',  1,          NULL,   2640000,        false)
  ) AS v(n, item, detail, basis, qty, unit, price, is_cost)
  JOIN core.quotations q ON q.id = pg_temp.portal_id('quo:auroratl')
 WHERE NOT EXISTS (SELECT 1 FROM core.quotation_lines x WHERE x.id = pg_temp.portal_id('ql:auroratl:' || v.n));

SET CONSTRAINTS core.trg_quotation_reconciled, core.trg_quotation_floor IMMEDIATE;
SET CONSTRAINTS core.trg_quotation_reconciled, core.trg_quotation_floor DEFERRED;

-- ── Send through the envelope, approve as another MD, mint the link ──────────

DO $send$
DECLARE
  v_ctx      portal_ctx%ROWTYPE;
  v_proposal core.proposals%ROWTYPE;
  v_result   jsonb;
  v_approval core.approval_requests%ROWTYPE;
  v_token    text;
BEGIN
  SELECT * INTO v_ctx FROM portal_ctx;
  SELECT * INTO v_proposal FROM core.proposals
   WHERE tenant_id = v_ctx.t AND id = pg_temp.portal_id('pro:auroratl');

  -- 1 · PROPOSAL_SEND as the account owner.
  IF v_proposal.status = 'DRAFT'
     AND NOT EXISTS (SELECT 1 FROM core.action_requests r
                      WHERE r.tenant_id = v_ctx.t AND r.action_type = 'PROPOSAL_SEND'
                        AND r.target_id = v_proposal.id) THEN
    PERFORM set_config('request.jwt.claims', pg_temp.portal_claims(v_ctx.t, v_ctx.u3), true);
    v_result := core.perform_action(
      'PROPOSAL_SEND', v_proposal.ref, jsonb_build_object('channel', 'EMAIL'), NULL, NULL,
      'First proposal to Aurora Precision Tooling, for the portal demo.', '[]'::jsonb,
      'hosted-demo-portal:send:' || v_proposal.id::text);
    IF v_result #>> '{data,status}' IS DISTINCT FROM 'QUEUED_FOR_APPROVAL' THEN
      RAISE EXCEPTION 'portal demo seed: PROPOSAL_SEND expected QUEUED_FOR_APPROVAL under APV-01, got %', v_result;
    END IF;
  END IF;

  -- 2 · APPROVE as a different MD, with the diff hash the approval carries.
  SELECT a.* INTO v_approval
    FROM core.approval_requests a
    JOIN core.action_requests r ON r.tenant_id = a.tenant_id AND r.id = a.action_request_id
   WHERE a.tenant_id = v_ctx.t AND r.action_type = 'PROPOSAL_SEND'
     AND r.target_id = v_proposal.id AND a.status = 'PENDING';
  IF FOUND THEN
    IF v_approval.requested_by_id = v_ctx.u1::text THEN
      RAISE EXCEPTION 'portal demo seed: the pending send was requested by the approving MD';
    END IF;
    PERFORM set_config('request.jwt.claims', pg_temp.portal_claims(v_ctx.t, v_ctx.u1), true);
    v_result := core.decide_approval(
      v_approval.id, 'APPROVE', 'Approved for the client portal demo.', v_approval.diff_hash,
      'hosted-demo-portal:decide:' || v_approval.id::text);
    IF v_result #>> '{data,status}' IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION 'portal demo seed: the approval did not execute: %', v_result;
    END IF;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);

  SELECT * INTO v_proposal FROM core.proposals
   WHERE tenant_id = v_ctx.t AND id = pg_temp.portal_id('pro:auroratl');
  IF v_proposal.status NOT IN ('SENT','VIEWED','ACCEPTED') THEN
    RAISE EXCEPTION 'portal demo seed: proposal % is % after the send; expected SENT', v_proposal.ref, v_proposal.status;
  END IF;

  -- 3 · One live link at a time.
  IF NOT EXISTS (SELECT 1 FROM core.public_share_tokens s
                  WHERE s.tenant_id = v_ctx.t AND s.proposal_id = v_proposal.id
                    AND s.target_kind = 'PROPOSAL' AND s.revoked_at IS NULL
                    AND s.expires_at > now()) THEN
    v_token := app.issue_portal_token(v_ctx.t, v_proposal.id, interval '30 days');
    INSERT INTO portal_link VALUES ('/p/' || v_token);
  ELSE
    RAISE NOTICE 'portal demo seed: % already has a live link; none minted. Revoke it and re-run for a new one.', v_proposal.ref;
  END IF;
END
$send$;

-- The one place the raw token is shown. Zero rows on a re-run.
SELECT portal_link FROM pg_temp.portal_link;
