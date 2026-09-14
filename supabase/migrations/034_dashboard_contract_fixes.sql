-- ═══════════════════════════════════════════════════════════════════════════
-- 034 · Executive dashboard contract fixes (M1, M2, M3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- M1. NOT applied in this migration — orchestrator ruling, 2026-09-14: 002's
-- `app.role_permissions` is authoritative over `endpoints.ts:150-153`'s
-- narrower `roles: ['MD']` note. `dashboard:executive:read` is deliberately
-- held by SALES_MANAGER, FINANCE, MD and ADMIN (002:895,1002,1065,1161), and
-- hosted has two ADMIN founders who must keep the executive dashboard. A
-- previous version of this migration added a function-local
-- `app.role() IS DISTINCT FROM 'MD'` check after the permission gate; it has
-- been removed. `core.get_executive_dashboard` and `core.get_proposals_vs_won`
-- stay gated on `app.has_permission('dashboard:executive:read')` alone, as
-- 022 shipped them. Left as an explicitly open item, not silently dropped:
-- if product later wants the contract's narrower MD-only reading enforced,
-- that is a decision for 002's role matrix, not a per-RPC carve-out here.
--
-- M2. Three of the four dashboard metrics and `agentSpend` sum a `_sen`
-- column without grouping by the row's own `currency`: `OPEN_PIPELINE`
-- (`core.opportunities.value_sen`/`currency`), `AR_OVERDUE` (`core.invoices.
-- outstanding_sen`/`currency`), `CLAIM_VALUE_AT_RISK` (`core.hrdc_packets.
-- claim_value_sen`/`currency`) and `agentSpend` (`core.budget_status.
-- spend_sen`/`cap_sen`/`currency`) — all four tables carry a real per-row
-- `currency` column (defaulting to MYR, not constrained to it), and the
-- existing code sums every row regardless and labels the result MYR
-- (`app._money(v_sum, 'MYR')`). A single non-MYR row today silently
-- misstates the total. Fixed by summing MYR rows only into `value` and, for
-- the three metrics that carry a `secondary` string (the contract's shape —
-- `docs/design/API_CONTRACT.md`'s worked example, `packages/fixtures/src/
-- data/dashboards.ts` — has no other field to put a currency breakdown in),
-- appending a `(N non-MYR excluded)` note to it WHEN AND ONLY WHEN such rows
-- exist, so the byte-for-byte MYR-only fixture path `test_022` already pins
-- is unchanged. `agentSpend` has no `secondary` slot in its contract shape
-- (`{spent,budget}` only) — its non-MYR rows are excluded from the MYR total
-- with nowhere to report the exclusion; this is recorded as the one place
-- M2's fix cannot also surface the note, and is the same "don't invent
-- fields" instruction M2 itself gives.
--
-- M3. `get_executive_dashboard`'s `agent_eval` CTE takes the all-time median
-- of `core.evals.score` for `kind IN ('GOLDEN_SET','JURY_GATE')`. 020's
-- `core.v_agent_evals` (020:1172-1186), the view the same "AgentEval" concept
-- reads elsewhere, already windows to the trailing 30 days
-- (`eval.evaluated_at >= pg_catalog.now() - interval '30 days'`). 034 adds
-- the SAME window to `agent_eval`'s WHERE clause — the aggregation itself
-- (median via `percentile_cont(0.5)`) is untouched; 022's own comment calls
-- it "a rolling median" and nothing in the finding asks to change the
-- statistic, only the time bound it is taken over.
--
-- M6 (AAL2 on OPP-01 decisions) is explicitly OUT OF SCOPE for 034 per the
-- brief — a product decision, not a defect, and listed here as an open item
-- rather than silently skipped.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('core.get_executive_dashboard(text)') IS NULL THEN
    RAISE EXCEPTION '034 preflight: core.get_executive_dashboard(text) is absent; 022 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('core.get_proposals_vs_won(integer)') IS NULL THEN
    RAISE EXCEPTION '034 preflight: core.get_proposals_vs_won(integer) is absent; 022 has not been applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.role_permissions WHERE permission = 'dashboard:executive:read' AND role = 'MD') THEN
    RAISE EXCEPTION '034 preflight: MD does not hold dashboard:executive:read; 002 has changed shape';
  END IF;
  -- M1 not applied here (see header): dashboard:executive:read stays a
  -- four-role permission. Assert the other three still hold it, so a future
  -- 002 change that narrows the matrix is caught here rather than silently
  -- changing this migration's meaning.
  IF NOT EXISTS (SELECT 1 FROM app.role_permissions WHERE permission = 'dashboard:executive:read' AND role = 'SALES_MANAGER')
     OR NOT EXISTS (SELECT 1 FROM app.role_permissions WHERE permission = 'dashboard:executive:read' AND role = 'FINANCE')
     OR NOT EXISTS (SELECT 1 FROM app.role_permissions WHERE permission = 'dashboard:executive:read' AND role = 'ADMIN')
  THEN
    RAISE EXCEPTION '034 preflight: dashboard:executive:read is no longer held by SALES_MANAGER/FINANCE/ADMIN; 002 has changed shape, M1 ruling needs revisiting';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION core.get_executive_dashboard(p_period text)
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

  v_open_pipeline_sen      bigint;
  v_open_pipeline_n        integer;
  v_open_pipeline_fx_n     integer;
  v_ar_overdue_sen         bigint;
  v_ar_overdue_n           integer;
  v_ar_overdue_fx_n        integer;
  v_proposals_sent_n       integer;
  v_claim_at_risk_sen      bigint;
  v_claim_at_risk_n        integer;
  v_claim_at_risk_fx_n     integer;
  v_metrics            jsonb;
  v_approvals_pending  jsonb;
  v_agent_activity     jsonb;
  v_autonomy_mix       jsonb;
  v_agent_spend        jsonb;
  v_open_pipeline_secondary text;
  v_ar_overdue_secondary    text;
  v_claim_at_risk_secondary text;
BEGIN
  -- PERMISSION DECIDED BEFORE ANY READ. See the header's permission note.
  IF NOT app.has_permission('dashboard:executive:read') THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'MISSING_PERMISSION',
                                    'permission', 'dashboard:executive:read'));
  END IF;

  -- M1 DROPPED per ruling (2026-09-14): 002's role_permissions matrix is
  -- authoritative for RPC gates, not endpoints.ts's role list — hosted has
  -- two ADMIN founders who must keep executive dashboard access, and
  -- narrowing this RPC to MD alone would have broken that. The permission
  -- gate above (dashboard:executive:read, held by SALES_MANAGER, FINANCE, MD
  -- and ADMIN per 002) is unchanged from 022. endpoints.ts's role list gets
  -- reconciled to 002 separately.

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

  -- OPEN_PIPELINE — 034 (M2): MYR rows only in the sum; non-MYR rows counted
  -- separately and folded into `secondary` only when there are any.
  SELECT COALESCE(pg_catalog.sum(o.value_sen), 0), pg_catalog.count(*)
    INTO v_open_pipeline_sen, v_open_pipeline_n
    FROM core.opportunities AS o
   WHERE o.tenant_id = v_tenant
     AND o.stage IN ('QUALIFYING', 'PROPOSAL_SENT', 'NEGOTIATION')
     AND o.currency = 'MYR';
  SELECT pg_catalog.count(*) INTO v_open_pipeline_fx_n
    FROM core.opportunities AS o
   WHERE o.tenant_id = v_tenant
     AND o.stage IN ('QUALIFYING', 'PROPOSAL_SENT', 'NEGOTIATION')
     AND o.currency <> 'MYR';
  v_open_pipeline_secondary := v_open_pipeline_n || ' opportunities'
    || CASE WHEN v_open_pipeline_fx_n > 0
            THEN ' (' || v_open_pipeline_fx_n || ' non-MYR excluded)' ELSE '' END;

  -- AR_OVERDUE — 034 (M2), same treatment.
  SELECT COALESCE(pg_catalog.sum(i.outstanding_sen), 0), pg_catalog.count(*)
    INTO v_ar_overdue_sen, v_ar_overdue_n
    FROM core.invoices AS i
   WHERE i.tenant_id = v_tenant
     AND i.status = 'OVERDUE'
     AND i.voided_at IS NULL
     AND i.currency = 'MYR';
  SELECT pg_catalog.count(*) INTO v_ar_overdue_fx_n
    FROM core.invoices AS i
   WHERE i.tenant_id = v_tenant
     AND i.status = 'OVERDUE'
     AND i.voided_at IS NULL
     AND i.currency <> 'MYR';
  v_ar_overdue_secondary := v_ar_overdue_n || ' invoices'
    || CASE WHEN v_ar_overdue_fx_n > 0
            THEN ' (' || v_ar_overdue_fx_n || ' non-MYR excluded)' ELSE '' END;

  -- PROPOSALS_SENT, this quarter (the quarter containing p_period's month).
  -- A count, not a sum of money — no currency to group by.
  SELECT pg_catalog.count(*)
    INTO v_proposals_sent_n
    FROM core.proposals AS p
   WHERE p.tenant_id = v_tenant
     AND p.sent_at IS NOT NULL
     AND p.sent_at >= v_quarter_start
     AND p.sent_at <  v_quarter_end;

  -- CLAIM_VALUE_AT_RISK — 034 (M2), same treatment.
  SELECT COALESCE(pg_catalog.sum(h.claim_value_sen), 0), pg_catalog.count(*)
    INTO v_claim_at_risk_sen, v_claim_at_risk_n
    FROM core.hrdc_packets AS h
   WHERE h.tenant_id = v_tenant
     AND h.panel_state IN ('DEADLINE_AT_RISK', 'BLOCKED')
     AND h.voided_at IS NULL
     AND h.currency = 'MYR';
  SELECT pg_catalog.count(*) INTO v_claim_at_risk_fx_n
    FROM core.hrdc_packets AS h
   WHERE h.tenant_id = v_tenant
     AND h.panel_state IN ('DEADLINE_AT_RISK', 'BLOCKED')
     AND h.voided_at IS NULL
     AND h.currency <> 'MYR';
  v_claim_at_risk_secondary := v_claim_at_risk_n || ' packets'
    || CASE WHEN v_claim_at_risk_fx_n > 0
            THEN ' (' || v_claim_at_risk_fx_n || ' non-MYR excluded)' ELSE '' END;

  -- No ADMIN_HOURS_SAVED entry. See 022's header.
  v_metrics := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'key', 'OPEN_PIPELINE', 'label', 'Open pipeline',
      'value', app._money(v_open_pipeline_sen, 'MYR'),
      'secondary', v_open_pipeline_secondary,
      'drillTo', '/v1/opportunities?filter[stage][in]=QUALIFYING,PROPOSAL_SENT,NEGOTIATION'),
    pg_catalog.jsonb_build_object(
      'key', 'AR_OVERDUE', 'label', 'AR overdue',
      'value', app._money(v_ar_overdue_sen, 'MYR'),
      'secondary', v_ar_overdue_secondary,
      'drillTo', '/v1/receivables?filter[daysOverdue][gte]=1'),
    pg_catalog.jsonb_build_object(
      'key', 'PROPOSALS_SENT', 'label', 'Proposals sent',
      'value', v_proposals_sent_n,
      'secondary', 'this quarter',
      'drillTo', '/v1/reports/proposals-vs-won?months=6'),
    pg_catalog.jsonb_build_object(
      'key', 'CLAIM_VALUE_AT_RISK', 'label', 'Claim value at risk',
      'value', app._money(v_claim_at_risk_sen, 'MYR'),
      'secondary', v_claim_at_risk_secondary,
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
  -- 034 (M3). The trailing-30-day window core.v_agent_evals (020:1172-1186)
  -- already uses, added here so the two "AgentEval" readings in this schema
  -- agree. The aggregation (median via percentile_cont) is unchanged.
  agent_eval AS (
    SELECT agent_id,
           pg_catalog.round(
             (pg_catalog.percentile_cont(0.5) WITHIN GROUP (ORDER BY score))::numeric, 3) AS median_score
      FROM core.evals
     WHERE tenant_id = v_tenant AND kind IN ('GOLDEN_SET', 'JURY_GATE') AND score IS NOT NULL
       AND evaluated_at >= pg_catalog.now() - interval '30 days'
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

  -- 034 (M2): AGENT-scope budgets, MYR rows only. No `secondary` slot exists
  -- on this object's contract shape (`{spent,budget}`) to report an
  -- exclusion in — see the header.
  SELECT pg_catalog.jsonb_build_object(
           'spent',  app._money(COALESCE(pg_catalog.sum(b.spend_sen), 0)::bigint, 'MYR'),
           'budget', app._money(COALESCE(pg_catalog.sum(b.cap_sen), 0)::bigint, 'MYR'))
    INTO v_agent_spend
    FROM core.budget_status AS b
   WHERE b.tenant_id = v_tenant AND b.scope = 'AGENT' AND b.currency = 'MYR';

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'metrics',         v_metrics,
    'approvalsPending', v_approvals_pending,
    'agentActivity',   v_agent_activity,
    'autonomyMix',     v_autonomy_mix,
    'agentSpend',      v_agent_spend));
END;
$fn$;

COMMENT ON FUNCTION core.get_executive_dashboard(text) IS
  '022, amended by 034 (M2/M3; M1 ruled out — see this migration''s header). '
  'GET /v1/dashboards/executive?period=. Gated on dashboard:executive:read '
  'alone, as 022 shipped it (SALES_MANAGER/FINANCE/MD/ADMIN per 002). '
  'OPEN_PIPELINE/AR_OVERDUE/CLAIM_VALUE_AT_RISK/agentSpend sum MYR '
  'rows only (034: mixed-currency correctness); evalScore is a trailing-30-'
  'day median, matching core.v_agent_evals (034).';

-- ═══ core.get_proposals_vs_won(p_months) — 034 (M1) only; counts, no sums ═

CREATE OR REPLACE FUNCTION core.get_proposals_vs_won(p_months integer DEFAULT 6)
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

  -- M1 DROPPED per ruling — see get_executive_dashboard's identical note above.

  IF p_months IS NULL OR p_months < 1 OR p_months > 24 THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'months', 'reason', 'MUST_BE_BETWEEN_1_AND_24'))));
  END IF;

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
  '022, unchanged by 034 (M1 ruled out — see this migration''s header; M2 '
  'does not apply, no sum here). GET /v1/reports/proposals-vs-won?months=. '
  'Gated on dashboard:executive:read alone, as 022 shipped it. sent/won are '
  'independent monthly counts, not a cohort conversion - see 022''s header.';

-- Grants unchanged: 022:757-761 already grants both to authenticated only,
-- and CREATE OR REPLACE on an unchanged signature does not reset them.

-- ═══ Verify ═════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_body text;
BEGIN
  -- V1 · M1 dropped per ruling: neither RPC narrows to MD; the permission
  -- gate alone (dashboard:executive:read) still governs, and all four roles
  -- 022 originally gated it for still hold that permission.
  v_body := app._body_sql('core.get_executive_dashboard(text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'app.role() IS DISTINCT FROM ''MD''') > 0 THEN
    RAISE EXCEPTION '034 verify V1a: get_executive_dashboard still carries the dropped MD-only check';
  END IF;
  v_body := app._body_sql('core.get_proposals_vs_won(integer)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'app.role() IS DISTINCT FROM ''MD''') > 0 THEN
    RAISE EXCEPTION '034 verify V1c: get_proposals_vs_won still carries the dropped MD-only check';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM app.role_permissions
       WHERE permission = 'dashboard:executive:read'
         AND role IN ('SALES_MANAGER','FINANCE','MD','ADMIN')) <> 4
  THEN
    RAISE EXCEPTION '034 verify V1d: dashboard:executive:read is not held by all four of SALES_MANAGER/FINANCE/MD/ADMIN';
  END IF;

  -- V2 · M2: every mixed-currency sum site now filters currency = 'MYR'.
  v_body := app._body_sql('core.get_executive_dashboard(text)'::regprocedure);
  IF (pg_catalog.length(v_body) - pg_catalog.length(
        pg_catalog.replace(v_body, 'currency = ''MYR''', ''))) / pg_catalog.length('currency = ''MYR''') < 4
  THEN
    RAISE EXCEPTION '034 verify V2: fewer than 4 currency = ''MYR'' guards found (opportunities, invoices, hrdc_packets, budget_status)';
  END IF;

  -- V3 · M3: the agent_eval CTE carries the 30-day window.
  IF pg_catalog.strpos(v_body, 'evaluated_at >= pg_catalog.now() - interval ''30 days''') = 0 THEN
    RAISE EXCEPTION '034 verify V3: agent_eval CTE has no trailing-30-day window';
  END IF;

  -- V4 · signatures and grants intact.
  IF pg_catalog.to_regprocedure('core.get_executive_dashboard(text)') IS NULL
     OR pg_catalog.to_regprocedure('core.get_proposals_vs_won(integer)') IS NULL
  THEN
    RAISE EXCEPTION '034 verify V4: a dashboard RPC signature changed or is missing';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated',
       'core.get_executive_dashboard(text)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated',
       'core.get_proposals_vs_won(integer)'::regprocedure, 'EXECUTE')
  THEN
    RAISE EXCEPTION '034 verify V4: authenticated lost EXECUTE on a dashboard RPC';
  END IF;
END
$verify$;

COMMIT;
