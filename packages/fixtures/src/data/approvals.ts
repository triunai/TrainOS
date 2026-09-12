/**
 * §7 · Approvals, and the §2 policy table they come from.
 *
 * Screens M02-S01 (grouped inbox) and M02-S02 (detail).
 *
 * Seven pending approvals, grouped 1 breaching / 4 today / 2 this week, which
 * is the `groups[]` and the `total: 7` the contract's own example returns and
 * the `7` the sidebar badge shows. `bulkApprovable` is false on every row
 * carrying a monetary value, so the inbox's bulk action is blocked exactly
 * where the pack says it is.
 */

import type { ApprovalDetail, Policy, UrgencyGroup } from "@trainos/contract";
import {
  AGENT_COLLECTIONS,
  AGENT_COMPLIANCE,
} from "./agents-ids";
import {
  AGENT_PROPOSAL,
  APPROVAL_AURORA,
  DOCUMENT_CIRCULAR_09,
  ENGAGEMENT_AURORA,
  ENQUIRY_AURORA,
  INVOICE_OVERDUE,
  POLICY_DISCOUNT,
  POLICY_INVOICE_CREATE,
  POLICY_PROPOSAL_SEND,
  POLICY_REMINDER_SEND,
  PROGRAMME_LEADING_CHANGE,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  RUN_PROPOSAL,
  RUN_RULE_EXTRACT,
  TNA_AURORA,
  TRAINER_FARAH_REF,
  USER_AMIRAH,
  USER_KELVIN,
} from "@trainos/contract";
import { QUOTATION_SUTERA, PROPOSAL_SUTERA } from "./proposals";
import { myr } from "./_helpers";

/** Approval refs beyond the canonical APV-2026-0771. */
export const APPROVAL_DISCOUNT = "APV-2026-0768";
export const APPROVAL_REMINDER = "APV-2026-0772";
export const APPROVAL_RULE_CHANGE = "APV-2026-0773";
export const APPROVAL_ATTENDANCE = "APV-2026-0774";
export const APPROVAL_TRAINER_BOOK = "APV-2026-0775";
export const APPROVAL_BUDGET_CAP = "APV-2026-0776";

/** Policy ids the contract names outside the four canonical ones. */
export const POLICY_INVOICE_PUSH = "FIN-02";
export const POLICY_TRAINER_BOOK = "OPS-03";
export const POLICY_ATTENDANCE_APPROVE = "OPS-01";
export const POLICY_ATTENDANCE_UNLOCK = "OPS-02";
export const POLICY_HRDC_SUBMIT = "HRD-CLM-01";
export const POLICY_RULE_CHANGE = "CMP-01";
export const POLICY_BUDGET_CAP_RAISE = "AI-01";
/** Ruling R3 — the last rung of the §9 collections ladder, MD-approved. */
export const POLICY_TRADING_HOLD = "FIN-04";
export const POLICY_AGENT_AUTONOMY = "AGT-01";

/**
 * §2 `GET /v1/policies` — read-only for the demo.
 *
 * The four canonical policies are verbatim; the rest encode the DECISIONS §1
 * autonomy matrix rule of thumb — anything that moves money, commits to a
 * client, or touches HRDC state is act-with-approval and never higher.
 */
export const policies: Policy[] = [
  {
    id: POLICY_PROPOSAL_SEND,
    actionType: "PROPOSAL_SEND",
    description: "Proposal send above RM 15,000 or first proposal to an organisation",
    conditions: [
      { field: "payload.value.amount", op: "gte", value: 1500000 },
      { field: "context.firstProposalToOrg", op: "eq", value: true },
    ],
    combinator: "ANY",
    approverRole: "SALES_MANAGER",
    slaMinutes: 240,
    escalateToRole: "MD",
    escalateAfterMinutes: 360,
  },
  {
    id: POLICY_DISCOUNT,
    actionType: "DISCOUNT_APPROVE",
    description: "Sell price below the binding floor",
    conditions: [{ field: "context.belowFloorPrice", op: "eq", value: true }],
    combinator: "ALL",
    approverRole: "SALES_MANAGER",
    slaMinutes: 240,
    escalateToRole: "MD",
    escalateAfterMinutes: 360,
  },
  {
    id: POLICY_TRAINER_BOOK,
    actionType: "TRAINER_BOOK",
    description: "Trainer booking and rate confirmation — a commitment to a client",
    conditions: [],
    combinator: "ALL",
    approverRole: "OPS",
    slaMinutes: 480,
  },
  {
    id: POLICY_ATTENDANCE_APPROVE,
    actionType: "ATTENDANCE_APPROVE",
    description: "Attendance lock — one-way, and HRD Corp treats it as immutable",
    conditions: [],
    combinator: "ALL",
    approverRole: "OPS",
    slaMinutes: 480,
  },
  {
    id: POLICY_ATTENDANCE_UNLOCK,
    actionType: "ATTENDANCE_UNLOCK",
    description: "Attendance unlock — voids the claim packet",
    conditions: [],
    combinator: "ALL",
    approverRole: "MD",
    slaMinutes: 240,
  },
  {
    id: POLICY_HRDC_SUBMIT,
    actionType: "HRDC_PACKET_MARK_SUBMITTED",
    description: "Recording an eTRIS filing reference against a claim packet",
    conditions: [],
    combinator: "ALL",
    approverRole: "FINANCE",
    slaMinutes: 480,
  },
  {
    id: POLICY_INVOICE_CREATE,
    actionType: "INVOICE_CREATE",
    description: "Invoice creation — pushes the document to the accounting package",
    conditions: [],
    combinator: "ALL",
    approverRole: "FINANCE",
    slaMinutes: 480,
    escalateToRole: "MD",
    escalateAfterMinutes: 720,
  },
  {
    id: POLICY_INVOICE_PUSH,
    actionType: "INVOICE_PUSH",
    description: "Re-pushing an invoice to the accounting package",
    conditions: [],
    combinator: "ALL",
    approverRole: "FINANCE",
    slaMinutes: 480,
  },
  {
    id: POLICY_REMINDER_SEND,
    actionType: "REMINDER_SEND",
    description: "Collections reminder send — nothing leaves without a human at this level",
    conditions: [],
    combinator: "ALL",
    approverRole: "FINANCE",
    slaMinutes: 240,
    escalateToRole: "MD",
    escalateAfterMinutes: 480,
  },
  {
    id: POLICY_TRADING_HOLD,
    actionType: "ACCOUNT_TRADING_HOLD",
    description: "Trading hold at 75 days overdue — the last rung of the collections ladder",
    conditions: [],
    combinator: "ALL",
    approverRole: "MD",
    slaMinutes: 480,
  },
  {
    id: POLICY_RULE_CHANGE,
    actionType: "RULE_CHANGE_APPROVE",
    description: "Activating a rule read out of a circular — ingestion proposes, never activates",
    conditions: [],
    combinator: "ALL",
    approverRole: "FINANCE",
    slaMinutes: 1440,
  },
  {
    id: POLICY_BUDGET_CAP_RAISE,
    actionType: "BUDGET_CAP_RAISE",
    description: "Raising a model-spend cap",
    conditions: [],
    combinator: "ALL",
    approverRole: "MD",
    slaMinutes: 240,
  },
  {
    id: POLICY_AGENT_AUTONOMY,
    actionType: "AGENT_AUTONOMY_CHANGE",
    description: "Promoting an agent's autonomy for an action type",
    conditions: [],
    combinator: "ALL",
    approverRole: "MD",
    slaMinutes: 1440,
  },
];

/** The stored approval: the detail payload plus the two list-only fields. */
export type FixtureApproval = ApprovalDetail & {
  bulkApprovable: boolean;
  urgencyGroup: UrgencyGroup;
  createdAt: string;
};

/**
 * §7 the seven pending approvals.
 *
 * APV-2026-0771 is verbatim from §7, SLA values included: the contract returns
 * `slaRemainingMinutes` and `slaBreached` as server facts and the UI renders
 * them rather than recomputing from `slaDueAt`, which is why the September
 * timestamp and the "2 hours left" flag sit side by side unchanged.
 */
export const approvals: FixtureApproval[] = [
  {
    id: "apv_0768",
    ref: APPROVAL_DISCOUNT,
    policyId: POLICY_DISCOUNT,
    actionType: "DISCOUNT_APPROVE",
    subject: "Discount below floor · Sutera Hospitality Group",
    targetRef: QUOTATION_SUTERA,
    value: myr(700000),
    marginRate: 0.23,
    requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
    slaDueAt: "2026-11-13T17:00:00+08:00",
    slaRemainingMinutes: -1052,
    /** The SLA-breached row M02-S01 renders in danger with its checkbox disabled. */
    slaBreached: true,
    status: "PENDING",
    bulkApprovable: false,
    urgencyGroup: "BREACHING",
    createdAt: "2026-11-13T13:00:00+08:00",
    reason:
      "RM 7,000 is below the RM 7,350 floor for 18 pax; policy APV-02 requires a manager decision.",
    recommendation: {
      verdict: "REQUEST_CHANGES",
      rationale:
        "The account has been dormant since June and the margin at this price is 0.23, well under the 0.35 floor.",
    },
    evidence: [
      { n: 1, type: "QUOTATION", ref: QUOTATION_SUTERA, label: "Margin 23% against a 35% floor" },
      { n: 2, type: "PROPOSAL", ref: PROPOSAL_SUTERA, label: "Service recovery, 18 pax, 1 day" },
    ],
    deviations: ["Below the absolute tier floor, not only the margin floor."],
    risk: { level: "HIGH", note: "Sets a precedent for a dormant account returning at a discount." },
    diff: [
      { op: "UPDATE", entity: "Quotation", ref: QUOTATION_SUTERA, description: "sellPrice RM 9,800 → RM 7,000" },
      { op: "UPDATE", entity: "Proposal", ref: PROPOSAL_SUTERA, description: "value RM 9,800 → RM 7,000" },
    ],
  },
  {
    id: "apv_0771",
    ref: APPROVAL_AURORA,
    policyId: POLICY_PROPOSAL_SEND,
    actionType: "PROPOSAL_SEND",
    subject: "Send proposal · Aurora Manufacturing Sdn Bhd",
    targetRef: PROPOSAL_AURORA,
    value: myr(1850000),
    marginRate: 0.41,
    requestedBy: { kind: "AGENT", id: AGENT_PROPOSAL, name: "Proposal Agent", runId: RUN_PROPOSAL },
    confidence: 0.82,
    autonomy: "ACT_WITH_APPROVAL",
    slaDueAt: "2026-09-11T13:14:00+08:00",
    slaRemainingMinutes: 120,
    slaBreached: false,
    status: "PENDING",
    bulkApprovable: false,
    urgencyGroup: "TODAY",
    createdAt: "2026-09-11T09:14:12+08:00",
    reason:
      "Value above the RM 15,000 threshold in policy APV-01, and this is the first proposal to this organisation.",
    recommendation: {
      verdict: "SEND_AS_DRAFTED",
      rationale: "Gap coverage complete, margin above floor, trainer confirmed available.",
      provenance: {
        origin: "AI_GENERATED",
        confidence: 0.82,
        agentId: AGENT_PROPOSAL,
        runId: RUN_PROPOSAL,
        tier: "STRONG_1",
        model: "Claude Sonnet 5",
        provider: "ANTHROPIC",
        cacheHitRate: 0.41,
      },
    },
    evidence: [
      {
        n: 1,
        type: "EMAIL",
        ref: ENQUIRY_AURORA,
        label: "Enquiry email, 11 Sep — 30 managers, November, conflict & communication",
      },
      { n: 2, type: "TNA", ref: TNA_AURORA, label: "Competency gaps confirmed by Nurul Hassan" },
      {
        n: 3,
        type: "PROGRAMME",
        ref: PROGRAMME_LEADING_CHANGE,
        label: "Leading Through Change — 2 days, RM 18,500 / 30 pax",
      },
      { n: 4, type: "TRAINER", ref: TRAINER_FARAH_REF, label: "Farah Aziz available 12–13 Nov" },
      { n: 5, type: "QUOTATION", ref: QUOTATION_AURORA, label: "Margin 41%, above 35% floor" },
    ],
    deviations: [
      "Client requested November specifically.",
      "Only one matched trainer is available in that window.",
    ],
    risk: {
      level: "MEDIUM",
      note: "Single trainer dependency — if Farah Aziz withdraws, the November window has no second-choice match at this competency level.",
    },
    diff: [
      { op: "UPDATE", entity: "Proposal", ref: PROPOSAL_AURORA, description: "status DRAFT → SENT" },
      { op: "ADD", entity: "Email", description: "To nurul.hassan@auroramfg.com.my with PDF attachment" },
      { op: "UPDATE", entity: "Opportunity", ref: "OPP-0512", description: "stage → PROPOSAL_SENT" },
      { op: "ADD", entity: "Task", description: "Follow-up for Amirah, due 16 Sep 2026" },
      { op: "REMOVE", entity: "Quotation", ref: QUOTATION_AURORA, description: "Draft lock released" },
    ],
    previewUrl: `/v1/proposals/${PROPOSAL_AURORA}/preview?format=HTML`,
    modelAgreement: {
      quorum: 2,
      of: 3,
      agreed: ["Claude Sonnet 5", "Gemini 3.1 Pro"],
      dissented: [{ model: "GPT-5.6 Terra", note: "Prefers waiting for Daniel Wong in December" }],
    },
  },
  {
    id: "apv_0772",
    ref: APPROVAL_REMINDER,
    policyId: POLICY_REMINDER_SEND,
    actionType: "REMINDER_SEND",
    subject: "Send reminder 2 · INV-2026-0288, 34 days overdue",
    targetRef: INVOICE_OVERDUE,
    value: myr(1240000),
    requestedBy: { kind: "AGENT", id: AGENT_COLLECTIONS, name: "Collections Agent", runId: "run_4926" },
    confidence: 0.88,
    autonomy: "ACT_WITH_APPROVAL",
    slaDueAt: "2026-11-14T14:30:00+08:00",
    slaRemainingMinutes: 238,
    slaBreached: false,
    status: "PENDING",
    bulkApprovable: false,
    urgencyGroup: "TODAY",
    createdAt: "2026-11-14T08:30:00+08:00",
    reason: "Policy FIN-03 routes every collections reminder to a human before it leaves.",
    recommendation: {
      verdict: "SEND_AS_DRAFTED",
      rationale: "Second reminder is due at 30 days; the contact has email consent on record.",
    },
    evidence: [
      { n: 1, type: "INVOICE", ref: INVOICE_OVERDUE, label: "RM 12,400 outstanding, 34 days" },
      { n: 2, type: "CONTACT", ref: "CON-0233", label: "Email consent recorded 04 Mar 2024" },
    ],
    deviations: ["The account also has a proposal in flight, so tone is softened."],
    risk: { level: "LOW", note: "Repeat client with a clean payment history before this invoice." },
    diff: [
      { op: "ADD", entity: "Email", description: "Reminder 2 to nurul.hassan@auroramfg.com.my" },
      { op: "UPDATE", entity: "Receivable", ref: INVOICE_OVERDUE, description: "stage REMINDER_2 → REMINDER_3 due 25 Nov" },
    ],
  },
  {
    id: "apv_0773",
    ref: APPROVAL_RULE_CHANGE,
    policyId: POLICY_RULE_CHANGE,
    actionType: "RULE_CHANGE_APPROVE",
    subject: "Approve 1 rule change · Circular 09/2026",
    targetRef: DOCUMENT_CIRCULAR_09,
    requestedBy: { kind: "AGENT", id: AGENT_COMPLIANCE, name: "Compliance Agent", runId: RUN_RULE_EXTRACT },
    confidence: 0.94,
    autonomy: "ACT_WITH_APPROVAL",
    slaDueAt: "2026-11-14T18:00:00+08:00",
    slaRemainingMinutes: 448,
    slaBreached: false,
    status: "PENDING",
    /** No monetary value, so the inbox may bulk-approve this one. */
    bulkApprovable: true,
    urgencyGroup: "TODAY",
    createdAt: "2026-11-14T09:45:00+08:00",
    reason:
      "A new circular supersedes the 3-day public lead time from 1 Jan 2027; four open engagements are affected.",
    recommendation: {
      verdict: "APPROVE",
      rationale: "Extraction confidence 0.94, source span quoted verbatim from section 2.1.",
    },
    evidence: [
      { n: 1, type: "HRDC_STATEMENT", ref: DOCUMENT_CIRCULAR_09, label: "Circular 09/2026, section 2.1, page 3" },
    ],
    deviations: ["Effective date is the circular's, not today's."],
    risk: { level: "MEDIUM", note: "Two January engagements were scheduled under the old lead time." },
    diff: [
      { op: "UPDATE", entity: "ComplianceRule", ref: "HRD-015", description: "status ACTIVE → SUPERSEDED from 2027-01-01" },
      { op: "ADD", entity: "ComplianceRule", ref: "HRD-022", description: "Public lead time 14 calendar days" },
    ],
  },
  {
    id: "apv_0774",
    ref: APPROVAL_ATTENDANCE,
    policyId: POLICY_ATTENDANCE_APPROVE,
    actionType: "ATTENDANCE_APPROVE",
    subject: "Lock attendance · ENG-0231 day 2, 28 of 30 present",
    targetRef: ENGAGEMENT_AURORA,
    requestedBy: { kind: "HUMAN", id: "u_siti", name: "Siti Nordin" },
    slaDueAt: "2026-11-14T17:00:00+08:00",
    slaRemainingMinutes: 388,
    slaBreached: false,
    status: "PENDING",
    /** No monetary value, so this row may be bulk-approved. */
    bulkApprovable: true,
    urgencyGroup: "TODAY",
    createdAt: "2026-11-14T08:02:00+08:00",
    reason:
      "Attendance lock is one-way and HRD Corp treats a locked sheet as immutable, so it is never autonomous.",
    recommendation: {
      verdict: "APPROVE",
      rationale: "Signatures reconcile at 56 of 56 expected for the present participants.",
    },
    evidence: [
      { n: 1, type: "PROGRAMME", ref: PROGRAMME_LEADING_CHANGE, label: "Two-day programme, AM/PM sessions" },
      { n: 2, type: "TRAINER", ref: TRAINER_FARAH_REF, label: "Farah Aziz signed the day-2 declaration" },
    ],
    deviations: ["Two participants absent on medical leave both days."],
    risk: { level: "LOW", note: "Locking day 2 completes the attendance evidence for the claim packet." },
    diff: [
      { op: "UPDATE", entity: "AttendanceSheet", ref: `${ENGAGEMENT_AURORA}/day-2`, description: "status PENDING_APPROVAL → LOCKED" },
      { op: "UPDATE", entity: "Engagement", ref: ENGAGEMENT_AURORA, description: "lifecycle ATTENDANCE_LOCKED → DONE" },
    ],
  },
  {
    id: "apv_0775",
    ref: APPROVAL_TRAINER_BOOK,
    policyId: POLICY_TRAINER_BOOK,
    actionType: "TRAINER_BOOK",
    subject: "Confirm trainer · Kenanga Retail, 14–15 Jan 2027",
    targetRef: "ENG-0244",
    requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
    slaDueAt: "2026-11-18T12:00:00+08:00",
    slaRemainingMinutes: 5608,
    slaBreached: false,
    status: "PENDING",
    bulkApprovable: true,
    urgencyGroup: "THIS_WEEK",
    createdAt: "2026-11-13T12:00:00+08:00",
    reason: "Trainer booking is a commitment to a client and never starts above act-with-approval.",
    recommendation: {
      verdict: "APPROVE",
      rationale: "Farah Aziz is free in the window and TTT certification runs to 30 Jun 2027.",
    },
    evidence: [{ n: 1, type: "TRAINER_AVAILABILITY", ref: TRAINER_FARAH_REF, label: "Free 14–15 Jan 2027" }],
    deviations: [],
    risk: { level: "LOW", note: "Two months of notice." },
    diff: [{ op: "UPDATE", entity: "Engagement", ref: "ENG-0244", description: "trainer soft-hold → confirmed" }],
  },
  {
    id: "apv_0776",
    ref: APPROVAL_BUDGET_CAP,
    policyId: POLICY_BUDGET_CAP_RAISE,
    actionType: "BUDGET_CAP_RAISE",
    subject: "Raise SPECIAL tier cap · RM 200 → RM 300",
    targetRef: "TIER/SPECIAL",
    value: myr(30000),
    requestedBy: { kind: "HUMAN", id: "u_khairul", name: "Khairul Anwar" },
    slaDueAt: "2026-11-17T10:00:00+08:00",
    slaRemainingMinutes: 4288,
    slaBreached: false,
    status: "PENDING",
    bulkApprovable: false,
    urgencyGroup: "THIS_WEEK",
    createdAt: "2026-11-14T10:00:00+08:00",
    reason: "The SPECIAL tier is paused by cap and rule extraction is queued behind it.",
    recommendation: {
      verdict: "APPROVE",
      rationale: "Forecast RM 812 against a RM 940 overall cap; the raise stays inside it.",
    },
    evidence: [{ n: 1, type: "ACTION", ref: "TIER/SPECIAL", label: "Spend RM 200 of a RM 200 cap" }],
    deviations: ["Second raise this quarter."],
    risk: { level: "MEDIUM", note: "Opus-class calls are the most expensive per run." },
    diff: [{ op: "UPDATE", entity: "Budget", ref: "TIER/SPECIAL", description: "cap RM 200 → RM 300" }],
  },
];

/** §15 item 1 — "Median decision time this week: 3m 40s", as the proposed field. */
export const approvalsSummary = { medianDecisionSeconds: 220 };
