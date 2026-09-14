-- ═══════════════════════════════════════════════════════════════════════════
-- 034 ROLLBACK · Executive dashboard contract fixes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores 022's `core.get_executive_dashboard(text)` and `core.get_
-- proposals_vs_won(integer)` bodies and comments verbatim: the MD-only role
-- check (M1), the currency = 'MYR' guards (M2) and the 30-day evalScore
-- window (M3) are all removed, reopening the three findings exactly as they
-- were before 034.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

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
  '022. `GET /v1/reports/proposals-vs-won?months=`. Gated on '
  '`dashboard:executive:read`. `sent`/`won` are independent monthly counts, '
  'not a cohort conversion - see this migration''s header.';

DO $verify$
DECLARE v_body text;
BEGIN
  v_body := app._body_sql('core.get_executive_dashboard(text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'app.role() IS DISTINCT FROM ''MD''') > 0 THEN
    RAISE EXCEPTION '034 rollback verify: get_executive_dashboard still carries the MD-only check';
  END IF;
  v_body := app._body_sql('core.get_proposals_vs_won(integer)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'app.role() IS DISTINCT FROM ''MD''') > 0 THEN
    RAISE EXCEPTION '034 rollback verify: get_proposals_vs_won still carries the MD-only check';
  END IF;
END
$verify$;

COMMIT;
