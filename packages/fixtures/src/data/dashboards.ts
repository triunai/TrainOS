/**
 * §10 + §18 · Dashboards, metrics and reports — M01-S01.
 *
 * Every metric cell is self-describing and carries its own `drillTo`, so the
 * UI never hardcodes a drill route.
 *
 * DECISIONS §4 is applied to admin hours saved: the figure is ILLUSTRATIVE
 * because the baseline has not been measured yet, the tile must render
 * `basis` rather than a bare number, and the first quarter carries a 0.7
 * haircut labelled "measured baseline × 0.7 (conservative)".
 */

import type {
  AgentDaily,
  AgentSpend,
  ApprovalSummary,
  AutonomyMixSlice,
  DashboardMetric,
  ExecutiveDashboard,
  HoursSavedReport,
  MetricResponse,
  ProposalsVsWonReport,
} from "@trainos/contract";
import { AGENT_LEAD, AGENT_PROPOSAL, AGENT_TNA, ORG_AURORA } from "@trainos/contract";
import { AGENT_COLLECTIONS, AGENT_COMPLIANCE } from "./agents-ids";
import { approvals } from "./approvals";
import { myr } from "./_helpers";

/** §10 the five cells M01-S01 renders. */
export const executiveMetrics: DashboardMetric[] = [
  {
    key: "OPEN_PIPELINE",
    label: "Open pipeline",
    value: myr(21430000),
    secondary: "12 opportunities",
    drillTo: "/v1/opportunities?filter[stage][in]=QUALIFYING,PROPOSAL_SENT,NEGOTIATION",
  },
  {
    key: "AR_OVERDUE",
    label: "AR overdue",
    value: myr(5780000),
    secondary: "4 invoices",
    delta: { rate: 0.18, direction: "UP", severity: "WARN", comparedTo: "2026-10" },
    drillTo: "/v1/receivables?filter[daysOverdue][gte]=1",
  },
  {
    key: "PROPOSALS_SENT",
    label: "Proposals sent",
    value: 31,
    secondary: "this quarter",
    delta: { rate: 0.06, direction: "UP", severity: "INFO", comparedTo: "2026-Q3" },
    drillTo: "/v1/reports/proposals-vs-won?months=6",
  },
  {
    key: "CLAIM_VALUE_AT_RISK",
    label: "Claim value at risk",
    value: myr(4090000),
    secondary: "3 packets",
    delta: { rate: 0.12, direction: "UP", severity: "DANGER", comparedTo: "2026-10" },
    drillTo: "/v1/hrdc/deadlines?filter[status][eq]=AT_RISK",
  },
  {
    key: "ADMIN_HOURS_SAVED",
    label: "Admin hours saved",
    value: 41,
    /** DECISIONS §4 — illustrative, and the tile must say so. */
    estimate: true,
    secondary: "illustrative · baseline not yet measured",
    formula: "Σ max(0, baselineMinutes − humanMinutes) ÷ 60 × haircut",
    drillTo: "/v1/reports/hours-saved?period=2026-11",
  },
];

/** §10 the five approvals the dashboard embeds, newest urgency first. */
export const approvalsPending: ApprovalSummary[] = approvals.slice(0, 5).map((approval) => ({
  ref: approval.ref,
  subject: approval.subject,
  ...(approval.value ? { value: approval.value } : {}),
  slaDueAt: approval.slaDueAt,
  slaBreached: approval.slaBreached,
  urgencyGroup: approval.urgencyGroup,
}));

/** §10 today's agent activity. */
export const agentActivity: AgentDaily[] = [
  {
    agentId: AGENT_LEAD,
    agentName: "Lead Agent",
    actionsToday: 42,
    autonomy: "AUTONOMOUS",
    costMonth: myr(1240),
    evalScore: 0.93,
  },
  {
    agentId: AGENT_PROPOSAL,
    agentName: "Proposal Agent",
    actionsToday: 6,
    autonomy: "ACT_WITH_APPROVAL",
    costMonth: myr(1890),
    evalScore: 0.89,
  },
  {
    agentId: AGENT_TNA,
    agentName: "TNA Agent",
    actionsToday: 4,
    autonomy: "SUGGEST",
    costMonth: myr(2180),
    evalScore: 0.9,
  },
  {
    agentId: AGENT_COLLECTIONS,
    agentName: "Collections Agent",
    actionsToday: 11,
    autonomy: "ACT_WITH_APPROVAL",
    costMonth: myr(980),
    evalScore: 0.88,
  },
  {
    agentId: AGENT_COMPLIANCE,
    agentName: "Compliance Agent",
    actionsToday: 8,
    autonomy: "ACT_WITH_APPROVAL",
    costMonth: myr(1180),
    evalScore: 0.91,
  },
];

/** §10 the autonomy mix donut. */
export const autonomyMix: AutonomyMixSlice[] = [
  { level: "OBSERVE", rate: 0.12 },
  { level: "SUGGEST", rate: 0.46 },
  { level: "ACT_WITH_APPROVAL", rate: 0.34 },
  { level: "AUTONOMOUS", rate: 0.08 },
];

/** §10 spend against budget. */
export const agentSpend: AgentSpend = { spent: myr(8420), budget: myr(25000) };

/** §10 `GET /v1/dashboards/executive?period=`, keyed by period. */
export const executiveDashboards: Record<string, ExecutiveDashboard> = {
  "2026-11": {
    metrics: executiveMetrics,
    approvalsPending,
    agentActivity,
    autonomyMix,
    agentSpend,
  },
};

/** §10 `GET /v1/reports/proposals-vs-won?months=6`. */
export const proposalsVsWon: ProposalsVsWonReport = {
  series: [
    { period: "2026-06", sent: 52, won: 31 },
    { period: "2026-07", sent: 44, won: 26 },
    { period: "2026-08", sent: 38, won: 24 },
    { period: "2026-09", sent: 49, won: 30 },
    { period: "2026-10", sent: 41, won: 22 },
    { period: "2026-11", sent: 31, won: 17 },
  ],
};

/**
 * §18 `GET /v1/reports/hours-saved`.
 *
 * `basis` is ILLUSTRATIVE until the time-and-motion sampling in discovery
 * produces a measured baseline table. `credited` already has the 0.7 haircut
 * applied.
 */
export const hoursSaved: HoursSavedReport = {
  hours: 41,
  basis: "ILLUSTRATIVE",
  haircut: 0.7,
  baselineTableVersion: "baseline-v0-illustrative",
  actionTypes: [
    { key: "ENQUIRY_ARCHIVE", baselineMinutes: 6, humanMinutes: 1, credited: 12.3 },
    { key: "OPPORTUNITY_CONVERT", baselineMinutes: 18, humanMinutes: 4, credited: 8.2 },
    { key: "PROPOSAL_DRAFT", baselineMinutes: 95, humanMinutes: 22, credited: 11.4 },
    { key: "HRDC_PACKET_MARK_SUBMITTED", baselineMinutes: 60, humanMinutes: 18, credited: 5.9 },
    { key: "REMINDER_SEND", baselineMinutes: 12, humanMinutes: 3, credited: 3.2 },
  ],
};

/** §10 `GET /v1/metrics/{key}?scope=&id=`, keyed `KEY::scope::id` or just `KEY`. */
export const metricResponses: Record<string, MetricResponse> = {
  OPEN_PIPELINE: {
    value: myr(21430000),
    secondary: "12 opportunities",
    drillTo: "/v1/opportunities?filter[stage][in]=QUALIFYING,PROPOSAL_SENT,NEGOTIATION",
  },
  AR_OVERDUE: {
    value: myr(5780000),
    secondary: "4 invoices",
    delta: { rate: 0.18, direction: "UP", severity: "WARN", comparedTo: "2026-10" },
    drillTo: "/v1/receivables?filter[daysOverdue][gte]=1",
  },
  ADMIN_HOURS_SAVED: {
    value: 41,
    secondary: "illustrative · baseline not yet measured",
    drillTo: "/v1/reports/hours-saved?period=2026-11",
  },
  [`HEALTH_SCORE::ORGANISATION::${ORG_AURORA}`]: {
    value: 74,
    secondary: "of 100",
    delta: { rate: 0.04, direction: "DOWN", severity: "WARN", comparedTo: "2026-10" },
    drillTo: `/v1/organisations/${ORG_AURORA}/relations`,
  },
  [`LIFETIME_VALUE::ORGANISATION::${ORG_AURORA}`]: {
    value: myr(21430000),
    secondary: "since Mar 2024",
    drillTo: `/v1/invoices?filter[organisationRef][eq]=${ORG_AURORA}&filter[status][eq]=PAID`,
  },
};
