-- ═══════════════════════════════════════════════════════════════════════════
-- 022 · The profile modal and the executive dashboard: `core.me_profile`,
--       `core.get_executive_dashboard`, `core.get_proposals_vs_won`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 001–020 ARE APPLIED TO HOSTED (021 is a sibling lane, not touched here) AND
-- ARE NOT EDITED. Everything here is a NEW object. Nothing is replaced.
--
-- ── WHY THIS WAS NOT BUILT IN 018 OR 020 ───────────────────────────────────
--
-- 020's own header says it in as many words: "NOT BUILT, and reported rather
-- than stubbed: `core.me_profile` (018's own reasoning stands — `MeProfile`
-- requires location, jobTitle, department, staffNumber and a session block
-- that no table carries) and the three dashboard RPCs (no metric definition
-- or hours-saved baseline exists to compute them from)." Both reasons still
-- hold. This migration does not invent a table to make them true. It builds
-- what a real tenant's own data actually supports and returns `null` — a
-- true statement about an unmeasured fact — for every field nothing stores.
--
-- ── RULING, RECORDED ────────────────────────────────────────────────────────
--
-- `location`, `jobTitle`, `department`, `staffNumber` and the `session` block
-- on `MeProfile` are treated as OPTIONAL and returned `null`: no table in
-- 001–020 carries a work location, a job title, a department, a staff number,
-- or the login-security block (`lastSignInAt`, `browser`, `place`,
-- `activeSessions`, `twoFactorEnabled` — none of these are JWT claims and none
-- is stored). The web/contract lane is widening `MeProfile` to make these
-- fields optional in the same window this migration lands in; until then a
-- strict client reading `null` where the type says `string` is that lane's
-- risk to carry, not a reason to fabricate a value here.
--
-- `ADMIN_HOURS_SAVED` is NOT in `get_executive_dashboard`'s `metrics` array,
-- and `core.get_hours_saved` (`GET /v1/reports/hours-saved`) is NOT built:
-- there is no baseline-minutes table anywhere in 001–020, and DECISIONS §4's
-- own words are "the figure is ILLUSTRATIVE because the baseline has not been
-- measured yet" — illustrative is exactly what a real-data RPC must not
-- return. The web shows "not available" for this tile, per the same ruling.
--
-- Every other metric IS derived from real tenant rows. The five open
-- questions (which stages count as "open", how "at risk" maps between the
-- panel-state spelling and the contract's filter spelling, which permission
-- gates M01-S01) were answered from what is ALREADY in the schema — see the
-- metric definitions in §2 and the permission note below — not invented.
--
-- ── PERMISSION ──────────────────────────────────────────────────────────────
--
-- `app.role_permissions` (002) already seeds `dashboard:executive:read` for
-- SALES_MANAGER, FINANCE, MD and ADMIN — narrower than the generic
-- `dashboard:read` six roles hold (which gates the plain nav item, not this
-- screen) and a closer match to the contract's `roles: ['MD']` on
-- `/v1/dashboards/executive`, `/v1/reports/proposals-vs-won` and
-- `/v1/reports/hours-saved` than `dashboard:read` would be. Both dashboard
-- RPCs below gate on `dashboard:executive:read`, decided before any read.
-- `core.me_profile` gates on membership only, matching `core.me()` (018):
-- the profile modal is the caller's own record and every active member may
-- open it.
--
-- ── POSTURE ────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER, `SET search_path = ''` (supabase/CLAUDE.md rule 1 and
-- test_001 T3 require the empty path exactly, asserted as the literal
-- `search_path=""` in `proconfig`), `SET statement_timeout = '10s'`, tenant
-- from `app.require_tenant_id()`, `app.ok`/`app.err` envelopes, every relation
-- schema-qualified, `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE TO
-- authenticated`. Overload count 1 for all three, asserted in `$verify$`.
--
-- ── §2 · METRIC DEFINITIONS (worked, as required) ──────────────────────────
--
--  OPEN_PIPELINE          SUM(core.opportunities.value_sen)
--                          WHERE stage IN ('QUALIFYING','PROPOSAL_SENT','NEGOTIATION')
--                          secondary = COUNT(*) of the same set.
--                          The three-stage set, not all five non-terminal
--                          stages, matches the fixture's own drillTo filter
--                          (`packages/fixtures/src/data/dashboards.ts`
--                          OPEN_PIPELINE) exactly — NEW and TNA_SENT are
--                          pre-qualification and are not "pipeline" the MD
--                          reads as at-risk-of-slipping revenue.
--  AR_OVERDUE              SUM(core.invoices.outstanding_sen)
--                          WHERE status = 'OVERDUE' AND voided_at IS NULL
--                          secondary = COUNT(*) of the same set.
--  PROPOSALS_SENT          COUNT(core.proposals)
--                          WHERE sent_at IS NOT NULL
--                            AND sent_at falls in the CALENDAR QUARTER that
--                            contains p_period's month
--                          A proposal that moved past SENT (VIEWED, ACCEPTED,
--                          LOST) still counts — `sent_at` is stamped once and
--                          frozen (`app.enforce_immutable_columns`), so this
--                          is "how many went out", not "how many are still
--                          sitting at SENT".
--  CLAIM_VALUE_AT_RISK     SUM(core.hrdc_packets.claim_value_sen)
--                          WHERE panel_state IN ('DEADLINE_AT_RISK','BLOCKED')
--                            AND voided_at IS NULL
--                          secondary = COUNT(*) of the same set.
--                          `panel_state = 'DEADLINE_AT_RISK'` is the DB
--                          spelling of the contract's `HrdcDeadlineStatus =
--                          'AT_RISK'` — packages/contract/src/enums.ts
--                          documents the spelling divergence explicitly and
--                          says not to unify it.
--  ADMIN_HOURS_SAVED       NOT EMITTED. No baseline table exists. See above.
--  approvalsPending        The 5 PENDING rows from `core.v_approval_requests`
--                          (011/020) in the SAME urgency order `list_approvals`
--                          groups by (BREACHING, TODAY, THIS_WEEK, LATER),
--                          then `sla_due_at` ascending. Reuses the view 020
--                          already built rather than re-deriving urgency.
--  agentActivity           One row per `core.agents` row with `status =
--                          'ACTIVE'` in the tenant.
--                            actionsToday = COUNT(core.runs) with
--                              started_at in [today 00:00 UTC, tomorrow 00:00
--                              UTC). UTC calendar day, not tenant-local — the
--                              contract defines no "today" and 013 stores no
--                              tenant-local run boundary; stated as a
--                              limitation below.
--                            autonomy = the MODE of
--                              COALESCE(core.action_requests.granted_level,
--                              'OBSERVE') across today's runs for that agent
--                              (joined run -> action_request on
--                              action_request_id), defaulting to 'OBSERVE'
--                              when the agent ran nothing today. A run with no
--                              action_request (pure observation, nothing
--                              governed) counts as OBSERVE.
--                            costMonth = SUM(core.runs.cost_sen) with
--                              started_at in the current UTC calendar month,
--                              as Money in MYR (013's `core.runs.currency`
--                              default and `core.ai_budgets`' only currency).
--                            evalScore = the MEDIAN of core.evals.score
--                              (percentile_cont(0.5), matching 013's own
--                              comment that GOLDEN_SET/JURY_GATE "feed …
--                              evalScore (a rolling median)") over kind IN
--                              ('GOLDEN_SET','JURY_GATE'), `null` when the
--                              agent has no such eval — no fabricated score.
--  autonomyMix              The distribution of the SAME per-run
--                          COALESCE(granted_level,'OBSERVE') used above,
--                          computed over EVERY run today, tenant-wide (not per
--                          agent): `rate` = that level's share of today's run
--                          count, rounded to 3 decimals to match
--                          `AutonomyMixSlice.rate`'s `Rate` precision
--                          elsewhere in the contract. `[]` when nothing ran
--                          today — an empty mix is the true statement, not a
--                          guessed one.
--  agentSpend               spent = SUM(core.budget_status.spend_sen) WHERE
--                            scope = 'AGENT'; budget = SUM(cap_sen) over the
--                            same rows. `core.budget_scope` has no TENANT
--                            value (it is TIER | AGENT | ACTION_TYPE), so the
--                            AGENT-scope budgets are the tenant-wide AI spend
--                            figure the dashboard's granularity actually
--                            matches (one budget per agent, same axis as
--                            `agentActivity`). Both are 0, not null, when no
--                            AGENT-scope budget is provisioned — a real "$0 of
--                            $0" is a fact, unlike hours-saved's "no formula
--                            at all".
--  ProposalsVsWonReport     For each of the trailing p_months CALENDAR MONTHS
--  (get_proposals_vs_won)   ending at and including the month `now()` falls
--                          in, oldest first:
--                            sent = COUNT(core.proposals) WHERE sent_at falls
--                              in that month
--                            won  = COUNT(core.proposals) WHERE status =
--                              'ACCEPTED' AND accepted_at falls in that month
--                          This is a monthly FLOW ("how many went out this
--                          month" / "how many closed this month"), not a
--                          cohort conversion rate — a proposal sent in month M
--                          that is accepted in month M+2 contributes to
--                          `sent` in M and `won` in M+2, which is what the
--                          fixture's own series (`packages/fixtures/src/data/
--                          dashboards.ts` `proposalsVsWon`) shows: `won` is
--                          never required to be <= that same month's `sent`.
--
-- ── WHAT IS DELIBERATELY NOT COMPUTED ───────────────────────────────────────
--
-- No `delta` (rate/direction/comparedTo) is emitted on any `DashboardMetric`
-- or `MetricResponse`-shaped cell here. `DashboardMetric.delta` is OPTIONAL,
-- and no table in 001–020 stores a point-in-time snapshot of any of these four
-- sums — computing one would mean fabricating a "last period" figure, which
-- is the exact thing this migration's ruling forbids. A snapshot table is a
-- clean follow-up; this migration does not invent one to fill a field that
-- is allowed to be absent.
--
-- `TenantIdentity.code` (`MeProfile.tenant.code`) is `null`: `public.tenants`
-- (002) has `slug` and `name`, never a short code like "APSB". `mobile` was
-- already optional in the contract and stays absent — no table stores a
-- staff mobile number.
--
-- `MeProfile.moduleCount` IS computed, from a real and already-load-bearing
-- source: the same 14-row nav VALUES list `core.navigation()` (018:919-934)
-- filters by `app.role_permissions`, counted rather than rendered. Duplicated
-- here rather than shared, because `core.navigation()` returns a full tree and
-- `me_profile` needs only the count; the duplication is a real cost, named
-- rather than hidden, and `$verify$` V2 pins the count at 14 candidate rows so
-- a later edit to `core.navigation()`'s list is at least forced to notice this
-- file exists.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, WORKED ──────────────────────────────────
--
--  1 ENVELOPE. `app.ok`/`app.err`, unchanged shape. No sibling top-level key.
--  2 UNWRAP. `data` is the sole non-`success` key on every return.
--  3 RpcMap. New entries: `me_profile(): MeProfile`, `get_executive_dashboard
--    (period: string): ExecutiveDashboard`, `get_proposals_vs_won(months?:
--    number): ProposalsVsWonReport`. `packages/contract/src/endpoints.ts`
--    already lists all three paths (`GET /v1/me/profile`,
--    `GET /v1/dashboards/executive`, `GET /v1/reports/proposals-vs-won`);
--    `apps/web`'s `rpc.types.ts` `RpcMap` entries are this file's own TS
--    wiring debt, owed to `web-022` — this migration adds no TypeScript.
--  4 CALL SITES. None yet in `apps/web` (M01-S01 is not wired to these RPCs
--    on this branch) — a dead RPC is expected for a brand-new read, not a
--    finding. `web-022` is the consuming lane.
--  5 CASTS. No TypeScript in this migration.
--  6 RELOAD. All three are reads with no idempotency surface.
--  7 PUBLIC ROUTES. Nothing is granted to anon.
--
-- ── DEPLOY ORDER ─────────────────────────────────────────────────────────────
--
-- Purely additive: three new function names, nothing replaced, nothing in the
-- envelope or spine touched. Safe to apply before or after `web-022` lands,
-- since no existing client calls any of the three. Needs no hosted privilege
-- beyond 020's: every statement is `CREATE FUNCTION` in `core` (owned by the
-- migration role) or a grant/revoke on an object this file just created.
--
-- Spine untouched: no action type, no handler, no branch in the envelope.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

-- ═══ 1 · core.me_profile() ══════════════════════════════════════════════════

CREATE FUNCTION core.me_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant       uuid := app.require_tenant_id();
  v_actor        record;
  v_member       public.memberships%ROWTYPE;
  v_profile      public.user_profiles%ROWTYPE;
  v_tenant_row   public.tenants%ROWTYPE;
  v_user_id      uuid;
  v_email        text;
  v_module_count integer;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;

  -- NEVER A PARTIAL PROFILE. Same posture as `core.me()` (018): a role-less
  -- or membership-less caller is FORBIDDEN, not a profile full of nulls.
  IF v_actor.role IS NULL OR v_actor.actor_id IS NULL THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'NO_APP_ROLE'));
  END IF;

  -- `MeProfile` is the SIGNED-IN PRINCIPAL'S OWN RECORD, and every field it
  -- carries (email, avatar, session) presumes a human account. An AGENT
  -- principal's `actor_id` is a text slug, never a uuid, and has no
  -- `auth.users` row of its own to read a profile from.
  IF v_actor.actor_kind = 'HUMAN' THEN
    BEGIN
      v_user_id := v_actor.actor_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_user_id := NULL;
    END;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'NOT_A_HUMAN_PRINCIPAL'));
  END IF;

  SELECT tenant.* INTO v_tenant_row FROM public.tenants AS tenant
   WHERE tenant.id = v_tenant;

  SELECT profile.* INTO v_profile FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_user_id;

  SELECT membership.* INTO v_member FROM public.memberships AS membership
   WHERE membership.tenant_id = v_tenant AND membership.user_id = v_user_id;

  IF v_member.tenant_id IS NULL THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'NO_MEMBERSHIP'));
  END IF;

  -- `auth.users.email` rather than `user_profiles.email`: the profile column
  -- is nullable and the modal's identity line cannot show a blank email for a
  -- real account. `SECURITY DEFINER` is what makes `auth.users` reachable.
  SELECT au.email INTO v_email FROM auth.users AS au WHERE au.id = v_user_id;

  -- `moduleCount` — see the header note. Deliberately the SAME 14 rows and
  -- the SAME permission match `core.navigation()` (018) uses for its `MAIN`
  -- group, counted rather than rendered.
  SELECT pg_catalog.count(*) INTO v_module_count
    FROM (VALUES
            ('dashboard:read'), ('approval:read'), ('enquiry:read'),
            ('organisation:read'), ('opportunity:read'), ('tna:read'),
            ('proposal:read'), ('programme:read'), ('engagement:read'),
            ('hrdc:read'), ('invoice:read'), ('collection:read'),
            ('agent:read'), ('compliance:read')
          ) AS nav(permission)
   WHERE EXISTS (
     SELECT 1 FROM app.role_permissions AS rp
      WHERE rp.role = v_member.role AND rp.permission = nav.permission);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',          v_actor.actor_id,
    'tenant',      pg_catalog.jsonb_build_object(
                     'name', v_tenant_row.name,
                     -- No short code is stored anywhere in 001-020.
                     'code', NULL::text),
    -- Not stored anywhere in 001-020. See the header ruling.
    'location',    NULL::text,
    'jobTitle',    NULL::text,
    'department',  NULL::text,
    'email',       COALESCE(v_email, v_profile.email::text),
    'staffNumber', NULL::text,
    'moduleCount', COALESCE(v_module_count, 0),
    -- No login-security data is stored anywhere in 001-020.
    'session',     NULL)
    -- `mobile` was already OPTIONAL on the contract and no table carries a
    -- staff mobile number; the key is omitted entirely rather than nulled,
    -- matching how every other optional contract field is emitted in 018/020.
  );
END;
$fn$;

COMMENT ON FUNCTION core.me_profile() IS
  '022. `GET /v1/me/profile`, ruled R14. The caller''s own MeProfile. Five '
  'fields (location, jobTitle, department, staffNumber, session) are `null` '
  'because no table in 001-020 carries them - see this migration''s header. '
  '`moduleCount` is real, derived from the same nav-permission match '
  'core.navigation() (018) uses.';

-- ═══ 2 · core.get_executive_dashboard(p_period) ═════════════════════════════

CREATE FUNCTION core.get_executive_dashboard(p_period text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant           uuid := app.require_tenant_id();
  v_month_start      timestamptz;
  v_month_end        timestamptz;
  v_quarter_start    timestamptz;
  v_quarter_end      timestamptz;
  v_day_start        timestamptz := pg_catalog.date_trunc('day', pg_catalog.now());
  v_day_end          timestamptz := v_day_start + interval '1 day';
  v_this_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.now());
  v_this_month_end   timestamptz := v_this_month_start + interval '1 month';

  v_open_pipeline_sen  bigint;
  v_open_pipeline_n    integer;
  v_ar_overdue_sen     bigint;
  v_ar_overdue_n       integer;
  v_proposals_sent_n   integer;
  v_claim_at_risk_sen  bigint;
  v_claim_at_risk_n    integer;
  v_metrics            jsonb;
  v_approvals_pending  jsonb;
  v_agent_activity     jsonb;
  v_autonomy_mix       jsonb;
  v_agent_spend        jsonb;
BEGIN
  -- PERMISSION DECIDED BEFORE ANY READ. See the header's permission note.
  IF NOT app.has_permission('dashboard:executive:read') THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'MISSING_PERMISSION',
                                    'permission', 'dashboard:executive:read'));
  END IF;

  IF p_period IS NULL OR p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'period', 'reason', 'MUST_BE_YYYY_MM'))));
  END IF;

  BEGIN
    v_month_start := pg_catalog.to_date(p_period || '-01', 'YYYY-MM-DD');
  EXCEPTION WHEN OTHERS THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'period', 'reason', 'MUST_BE_YYYY_MM'))));
  END;
  v_month_end     := v_month_start + interval '1 month';
  v_quarter_start := pg_catalog.date_trunc('quarter', v_month_start);
  v_quarter_end   := v_quarter_start + interval '3 months';

  -- OPEN_PIPELINE
  SELECT COALESCE(pg_catalog.sum(o.value_sen), 0), pg_catalog.count(*)
    INTO v_open_pipeline_sen, v_open_pipeline_n
    FROM core.opportunities AS o
   WHERE o.tenant_id = v_tenant
     AND o.stage IN ('QUALIFYING', 'PROPOSAL_SENT', 'NEGOTIATION');

  -- AR_OVERDUE
  SELECT COALESCE(pg_catalog.sum(i.outstanding_sen), 0), pg_catalog.count(*)
    INTO v_ar_overdue_sen, v_ar_overdue_n
    FROM core.invoices AS i
   WHERE i.tenant_id = v_tenant
     AND i.status = 'OVERDUE'
     AND i.voided_at IS NULL;

  -- PROPOSALS_SENT, this quarter (the quarter containing p_period's month)
  SELECT pg_catalog.count(*)
    INTO v_proposals_sent_n
    FROM core.proposals AS p
   WHERE p.tenant_id = v_tenant
     AND p.sent_at IS NOT NULL
     AND p.sent_at >= v_quarter_start
     AND p.sent_at <  v_quarter_end;

  -- CLAIM_VALUE_AT_RISK
  SELECT COALESCE(pg_catalog.sum(h.claim_value_sen), 0), pg_catalog.count(*)
    INTO v_claim_at_risk_sen, v_claim_at_risk_n
    FROM core.hrdc_packets AS h
   WHERE h.tenant_id = v_tenant
     AND h.panel_state IN ('DEADLINE_AT_RISK', 'BLOCKED')
     AND h.voided_at IS NULL;

  -- No ADMIN_HOURS_SAVED entry. See the header.
  v_metrics := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'key', 'OPEN_PIPELINE', 'label', 'Open pipeline',
      'value', app._money(v_open_pipeline_sen, 'MYR'),
      'secondary', v_open_pipeline_n || ' opportunities',
      'drillTo', '/v1/opportunities?filter[stage][in]=QUALIFYING,PROPOSAL_SENT,NEGOTIATION'),
    pg_catalog.jsonb_build_object(
      'key', 'AR_OVERDUE', 'label', 'AR overdue',
      'value', app._money(v_ar_overdue_sen, 'MYR'),
      'secondary', v_ar_overdue_n || ' invoices',
      'drillTo', '/v1/receivables?filter[daysOverdue][gte]=1'),
    pg_catalog.jsonb_build_object(
      'key', 'PROPOSALS_SENT', 'label', 'Proposals sent',
      'value', v_proposals_sent_n,
      'secondary', 'this quarter',
      'drillTo', '/v1/reports/proposals-vs-won?months=6'),
    pg_catalog.jsonb_build_object(
      'key', 'CLAIM_VALUE_AT_RISK', 'label', 'Claim value at risk',
      'value', app._money(v_claim_at_risk_sen, 'MYR'),
      'secondary', v_claim_at_risk_n || ' packets',
      'drillTo', '/v1/hrdc/deadlines?filter[status][eq]=AT_RISK'));

  -- approvalsPending: the same view and the same urgency order 020's
  -- `core.list_approvals` groups by, top 5.
  SELECT COALESCE(pg_catalog.jsonb_agg(row.item ORDER BY row.ord), '[]'::jsonb)
    INTO v_approvals_pending
    FROM (
      SELECT pg_catalog.row_number() OVER (
               ORDER BY pg_catalog.array_position(
                          ARRAY['BREACHING','TODAY','THIS_WEEK','LATER'], a.urgency_group),
                        a.sla_due_at) AS ord,
             pg_catalog.jsonb_build_object(
               'ref',          a.ref,
               'subject',      a.subject,
               'slaDueAt',     a.sla_due_at,
               'slaBreached',  COALESCE(a.sla_breached, false),
               'urgencyGroup', a.urgency_group)
             || CASE WHEN a.value_sen IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('value',
                            app._money(a.value_sen, a.currency)) END AS item
        FROM core.v_approval_requests AS a
       WHERE a.tenant_id = v_tenant AND a.status = 'PENDING'
       ORDER BY pg_catalog.array_position(
                  ARRAY['BREACHING','TODAY','THIS_WEEK','LATER'], a.urgency_group),
                a.sla_due_at
       LIMIT 5
    ) AS row;

  -- agentActivity / autonomyMix / agentSpend. See the header's metric
  -- definitions for `today`, the autonomy resolution and the AGENT-scope
  -- budget choice.
  WITH today_runs AS (
    SELECT r.agent_id, r.cost_sen,
           COALESCE(ar.granted_level, 'OBSERVE') AS level
      FROM core.runs AS r
      LEFT JOIN core.action_requests AS ar
             ON ar.tenant_id = r.tenant_id AND ar.id = r.action_request_id
     WHERE r.tenant_id = v_tenant
       AND r.started_at >= v_day_start
       AND r.started_at <  v_day_end
  ),
  today_by_agent AS (
    SELECT agent_id, pg_catalog.count(*) AS n
      FROM today_runs GROUP BY agent_id
  ),
  agent_mode AS (
    SELECT DISTINCT ON (agent_id) agent_id, level
      FROM (
        SELECT agent_id, level, pg_catalog.count(*) AS n
          FROM today_runs GROUP BY agent_id, level
      ) AS counted
     ORDER BY agent_id, n DESC, level
  ),
  month_by_agent AS (
    SELECT agent_id, pg_catalog.sum(cost_sen) AS cost_sen
      FROM core.runs
     WHERE tenant_id = v_tenant
       AND started_at >= v_this_month_start
       AND started_at <  v_this_month_end
     GROUP BY agent_id
  ),
  agent_eval AS (
    SELECT agent_id,
           -- Rounded to 3 decimals: `percentile_cont` interpolates through
           -- double precision, which leaves an artifact like 0.8500000000000001
           -- on the wire for a clean two-value median.
           pg_catalog.round(
             (pg_catalog.percentile_cont(0.5) WITHIN GROUP (ORDER BY score))::numeric, 3) AS median_score
      FROM core.evals
     WHERE tenant_id = v_tenant AND kind IN ('GOLDEN_SET', 'JURY_GATE') AND score IS NOT NULL
     GROUP BY agent_id
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(row.item ORDER BY row.actions_today DESC, row.agent_name), '[]'::jsonb)
    INTO v_agent_activity
    FROM (
      SELECT pg_catalog.jsonb_build_object(
               'agentId',      agent.agent_id,
               'agentName',    agent.name,
               'actionsToday', COALESCE(tba.n, 0),
               'autonomy',     COALESCE(am.level, 'OBSERVE'),
               'costMonth',    app._money(COALESCE(mba.cost_sen, 0)::bigint, 'MYR'),
               'evalScore',    ae.median_score) AS item,
             COALESCE(tba.n, 0) AS actions_today,
             agent.name AS agent_name
        FROM core.agents AS agent
        LEFT JOIN today_by_agent AS tba ON tba.agent_id = agent.agent_id
        LEFT JOIN agent_mode     AS am  ON am.agent_id  = agent.agent_id
        LEFT JOIN month_by_agent AS mba ON mba.agent_id = agent.agent_id
        LEFT JOIN agent_eval     AS ae  ON ae.agent_id  = agent.agent_id
       WHERE agent.tenant_id = v_tenant AND agent.status = 'ACTIVE'
    ) AS row;

  WITH today_runs AS (
    SELECT r.agent_id,
           COALESCE(ar.granted_level, 'OBSERVE') AS level
      FROM core.runs AS r
      LEFT JOIN core.action_requests AS ar
             ON ar.tenant_id = r.tenant_id AND ar.id = r.action_request_id
     WHERE r.tenant_id = v_tenant
       AND r.started_at >= v_day_start
       AND r.started_at <  v_day_end
  ),
  by_level AS (
    SELECT level, pg_catalog.count(*) AS n
      FROM today_runs GROUP BY level
  ),
  -- The window function is materialised HERE, one row per level, so the
  -- aggregate below never nests a window call inside it (PostgreSQL refuses
  -- that combination outright: "aggregate function calls cannot contain
  -- window function calls").
  by_level_rate AS (
    SELECT level, n,
           pg_catalog.round(n::numeric / NULLIF(pg_catalog.sum(n) OVER (), 0), 3) AS rate
      FROM by_level
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('level', level, 'rate', rate)
           ORDER BY pg_catalog.array_position(
                      ARRAY['OBSERVE','SUGGEST','ACT_WITH_APPROVAL','AUTONOMOUS'], level)),
         '[]'::jsonb)
    INTO v_autonomy_mix
    FROM by_level_rate;

  SELECT pg_catalog.jsonb_build_object(
           'spent',  app._money(COALESCE(pg_catalog.sum(b.spend_sen), 0)::bigint, 'MYR'),
           'budget', app._money(COALESCE(pg_catalog.sum(b.cap_sen), 0)::bigint, 'MYR'))
    INTO v_agent_spend
    FROM core.budget_status AS b
   WHERE b.tenant_id = v_tenant AND b.scope = 'AGENT';

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'metrics',         v_metrics,
    'approvalsPending', v_approvals_pending,
    'agentActivity',   v_agent_activity,
    'autonomyMix',     v_autonomy_mix,
    'agentSpend',      v_agent_spend));
END;
$fn$;

COMMENT ON FUNCTION core.get_executive_dashboard(text) IS
  '022. `GET /v1/dashboards/executive?period=`. Gated on `dashboard:executive:read`. '
  'Every metric is derived from real tenant rows - see this migration''s header for '
  'the worked formula of each. No `delta` on any cell: no snapshot table exists to '
  'compute a real comparedTo value. `ADMIN_HOURS_SAVED` is not emitted; no baseline exists.';

-- ═══ 3 · core.get_proposals_vs_won(p_months) ════════════════════════════════

CREATE FUNCTION core.get_proposals_vs_won(p_months integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_series  jsonb;
BEGIN
  IF NOT app.has_permission('dashboard:executive:read') THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'MISSING_PERMISSION',
                                    'permission', 'dashboard:executive:read'));
  END IF;

  IF p_months IS NULL OR p_months < 1 OR p_months > 24 THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'months', 'reason', 'MUST_BE_BETWEEN_1_AND_24'))));
  END IF;

  -- One row per trailing month, oldest first. `sent`/`won` are two
  -- independent monthly counts - see the header's metric definition for why
  -- `won` is not a conversion rate of that same month's `sent`.
  WITH months AS (
    SELECT pg_catalog.date_trunc('month', pg_catalog.now())
             - (n || ' months')::interval AS month_start
      FROM pg_catalog.generate_series(p_months - 1, 0, -1) AS n
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'period', pg_catalog.to_char(m.month_start, 'YYYY-MM'),
             'sent',   (SELECT pg_catalog.count(*) FROM core.proposals AS p
                         WHERE p.tenant_id = v_tenant
                           AND p.sent_at IS NOT NULL
                           AND p.sent_at >= m.month_start
                           AND p.sent_at <  m.month_start + interval '1 month'),
             'won',    (SELECT pg_catalog.count(*) FROM core.proposals AS p
                         WHERE p.tenant_id = v_tenant
                           AND p.status = 'ACCEPTED'
                           AND p.accepted_at >= m.month_start
                           AND p.accepted_at <  m.month_start + interval '1 month'))
           ORDER BY m.month_start), '[]'::jsonb)
    INTO v_series
    FROM months AS m;

  RETURN app.ok(pg_catalog.jsonb_build_object('series', v_series));
END;
$fn$;

COMMENT ON FUNCTION core.get_proposals_vs_won(integer) IS
  '022. `GET /v1/reports/proposals-vs-won?months=`. Gated on '
  '`dashboard:executive:read`. `sent`/`won` are independent monthly counts, '
  'not a cohort conversion - see this migration''s header.';

-- ═══ 4 · Grants ══════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION core.me_profile()                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_executive_dashboard(text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_proposals_vs_won(integer)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.me_profile()                     TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_executive_dashboard(text)     TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_proposals_vs_won(integer)     TO authenticated;

-- ═══ 5 · $verify$ ════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_bad  text[];
  v_body text;
BEGIN
  -- V1 · IDENTITY AND OVERLOAD COUNT. Exactly one definition of each, exactly
  -- the signature this file created.
  IF pg_catalog.to_regprocedure('core.me_profile()') IS NULL
     OR pg_catalog.to_regprocedure('core.get_executive_dashboard(text)') IS NULL
     OR pg_catalog.to_regprocedure('core.get_proposals_vs_won(integer)') IS NULL THEN
    RAISE EXCEPTION '022 verify V1: an expected signature is missing';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core'
         AND p.proname IN ('me_profile','get_executive_dashboard','get_proposals_vs_won')) <> 3 THEN
    RAISE EXCEPTION '022 verify V1: overload count is not exactly one per function';
  END IF;

  -- V2 · POSTURE on every function this file creates.
  SELECT pg_catalog.array_agg(p.oid::regprocedure::text ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core'
     AND p.proname IN ('me_profile','get_executive_dashboard','get_proposals_vs_won')
     AND NOT (p.prosecdef
              AND p.proconfig @> ARRAY['search_path=""']
              AND p.proconfig @> ARRAY['statement_timeout=10s']
              AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,
                         pg_catalog.acldefault('f', p.proowner))) AS acl
                 WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '022 verify V2: posture wrong on %', v_bad;
  END IF;

  -- V3 · THE PERMISSION GATE IS DECIDED BEFORE ANY READ, in both dashboard
  -- RPCs, and `me_profile` gates on membership rather than a permission
  -- string (matching `core.me()`, 018).
  SELECT app._body_sql('core.get_executive_dashboard(text)'::regprocedure) INTO v_body;
  IF pg_catalog.strpos(v_body, 'app.has_permission(''dashboard:executive:read'')') = 0 THEN
    RAISE EXCEPTION '022 verify V3a: get_executive_dashboard has lost its permission gate';
  END IF;
  IF pg_catalog.strpos(v_body, 'app.has_permission(') > pg_catalog.strpos(v_body, 'FROM core.opportunities') THEN
    RAISE EXCEPTION '022 verify V3b: get_executive_dashboard reads before it authorizes';
  END IF;
  SELECT app._body_sql('core.get_proposals_vs_won(integer)'::regprocedure) INTO v_body;
  IF pg_catalog.strpos(v_body, 'app.has_permission(''dashboard:executive:read'')') = 0 THEN
    RAISE EXCEPTION '022 verify V3c: get_proposals_vs_won has lost its permission gate';
  END IF;
  SELECT app._body_sql('core.me_profile()'::regprocedure) INTO v_body;
  IF pg_catalog.strpos(v_body, 'NO_MEMBERSHIP') = 0 THEN
    RAISE EXCEPTION '022 verify V3d: me_profile has lost its membership gate';
  END IF;

  -- V4 · NO FABRICATED HOURS-SAVED. `get_hours_saved` was deliberately not
  -- built, and `ADMIN_HOURS_SAVED` is deliberately not in the metrics array.
  IF pg_catalog.to_regprocedure('core.get_hours_saved()') IS NOT NULL THEN
    RAISE EXCEPTION '022 verify V4: get_hours_saved exists with no baseline to back it';
  END IF;
  SELECT app._body_sql('core.get_executive_dashboard(text)'::regprocedure) INTO v_body;
  IF pg_catalog.strpos(v_body, 'ADMIN_HOURS_SAVED') > 0 THEN
    RAISE EXCEPTION '022 verify V4b: ADMIN_HOURS_SAVED was emitted with no baseline to back it';
  END IF;
END
$verify$;

COMMIT;
