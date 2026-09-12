/**
 * §9 + §17 + §18 · HRD Corp claim packets, the rules registry, rule-change
 * review and compliance checks.
 *
 * Screens M12-S02 (packet), M12-S07 (registry), M12-S08 (rule changes),
 * and the checks block M09-S02 shares.
 *
 * DECISIONS §3 is applied over the earlier text: the five-working-day claim
 * window is wrong and the window is six months from completion, every rule
 * loads as PROPOSED until compliance verifies it against the circular PDF, and
 * day counts are calendar days. DECISIONS §6 replaces the single `asOf` with
 * the two-sided rule resolution.
 */

import type {
  ClaimPacket,
  ComplianceChecksResponse,
  ComplianceRule,
  HrdcDeadline,
  RuleChangeSet,
} from "@trainos/contract";
import {
  CHECK_DOCS_COMPLETE,
  CHECK_LEAD_TIME,
  CHECK_MEAL_CEILING,
  DOCUMENT_CIRCULAR_04,
  DOCUMENT_CIRCULAR_09,
  ENGAGEMENT_AFFECTED_1,
  ENGAGEMENT_AFFECTED_2,
  ENGAGEMENT_AURORA,
  ENGAGEMENT_BLOCKED,
  HRDC_CLAIM,
  HRDC_EMPLOYER_CODE,
  HRDC_GRANT,
  INVOICE_AURORA,
  ORG_AURORA,
  RULE_DOCS_COMPLETE,
  RULE_LEAD_TIME_INHOUSE,
  RULE_LEAD_TIME_PUBLIC,
  RULE_LEAD_TIME_PUBLIC_2027,
  RULE_MEAL_CEILING,
  RULE_SET_2026_06_15,
  RULE_SET_2027_01_01,
  RULE_SUPERSEDED,
  TTT_FARAH,
  USER_JASON,
} from "@trainos/contract";
import { AGENT_COMPLIANCE } from "./agents-ids";
import { ENGAGEMENT_WINDOW_CLOSING } from "./engagements";
import { ORG_KENANGA } from "./organisations";
import { myr } from "./_helpers";

/** Rule ids the design-pack inventory lists beyond the six the contract names. */
export const RULE_COMMENCEMENT_WINDOW = "HRD-007";
export const RULE_CLAIM_WINDOW = "HRD-009";
export const RULE_NO_AMENDMENT = "HRD-018";
export const RULE_TRAINER_ACCREDITATION = "HRD-023";

/** Check keys beyond the three the contract names. */
export const CHECK_COMMENCEMENT_WINDOW = "CHK_COMMENCEMENT_WINDOW";
export const CHECK_CLAIM_WINDOW = "CHK_CLAIM_WINDOW";
export const CHECK_TRAINER_ACCREDITATION = "CHK_TRAINER_ACCREDITATION";

/**
 * §9 `GET /v1/hrdc/packets/{engagementRef}`.
 *
 * ENG-0231 is the §9 example with DECISIONS §3 applied: the deadline is six
 * months from completion (13 Nov 2026 → 13 May 2027), not five working days,
 * which is why its severity is INFO while two documents are still missing.
 * ENG-0189 carries the closing window the pack renders in danger.
 */
export const claimPackets: ClaimPacket[] = [
  {
    id: "pkt_0231",
    engagementRef: ENGAGEMENT_AURORA,
    organisationRef: ORG_AURORA,
    scheme: "SBL_KHAS",
    employerCode: HRDC_EMPLOYER_CODE,
    claimValue: myr(1850000),
    levyAvailable: myr(6100000),
    completeness: 0.62,
    status: "DRAFT",
    deadlineAt: "2027-05-13T23:59:59+08:00",
    daysRemaining: 180,
    deadlineSeverity: "INFO",
    requiredDocuments: [
      {
        type: "ATTENDANCE_SHEET",
        label: "Attendance sheet",
        status: "PRESENT",
        ref: `${ENGAGEMENT_AURORA}/attendance`,
        meta: "Locked 14 Nov · 28/30 present",
      },
      { type: "TRAINER_TTT_CERT", status: "PRESENT", ref: TTT_FARAH, meta: "Valid to 30 Jun 2027" },
      { type: "TAX_INVOICE", status: "PRESENT", ref: INVOICE_AURORA, meta: "MyInvois validated" },
      { type: "EVALUATION_SUMMARY", status: "MISSING", meta: "24 of 30 responses collected" },
      { type: "TRAINING_SCHEDULE", status: "MISSING" },
    ],
    grant: {
      reference: HRDC_GRANT,
      submittedAt: "2026-10-02T09:14:00+08:00",
      approvedAt: "2026-10-09T00:00:00+08:00",
    },
    submission: null,
    submissionLog: [
      {
        at: "2026-10-02T09:14:00+08:00",
        actor: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
        event: "GRANT_SUBMITTED",
        reference: HRDC_GRANT,
      },
      {
        at: "2026-10-09T00:00:00+08:00",
        actor: { kind: "SYSTEM", id: "sys_scheduler", name: "Scheduler" },
        event: "GRANT_APPROVED",
        reference: HRDC_GRANT,
      },
      {
        at: "2026-11-14T10:30:00+08:00",
        actor: { kind: "AGENT", id: AGENT_COMPLIANCE, name: "Compliance Agent" },
        event: "PACKET_ASSEMBLED",
        completeness: 0.62,
      },
    ],
  },
  {
    id: "pkt_0198",
    engagementRef: ENGAGEMENT_BLOCKED,
    organisationRef: ORG_AURORA,
    scheme: "SBL",
    employerCode: HRDC_EMPLOYER_CODE,
    claimValue: myr(1620000),
    levyAvailable: myr(6100000),
    completeness: 0.6,
    status: "DRAFT",
    deadlineAt: "2027-02-21T23:59:59+08:00",
    daysRemaining: 99,
    deadlineSeverity: "INFO",
    requiredDocuments: [
      {
        type: "ATTENDANCE_SHEET",
        label: "Attendance sheet",
        status: "PRESENT",
        ref: `${ENGAGEMENT_BLOCKED}/attendance`,
        meta: "Locked 25 Aug · 28/28 present",
      },
      { type: "TRAINER_TTT_CERT", status: "MISSING", meta: "Trainer is not HRD Corp accredited" },
      { type: "TAX_INVOICE", status: "PRESENT", ref: "INV-2026-0288", meta: "MyInvois validated" },
      { type: "EVALUATION_SUMMARY", status: "PRESENT", meta: "28 of 28 responses collected" },
      { type: "TRAINING_SCHEDULE", status: "MISSING" },
    ],
    grant: {
      reference: "GRT-2026-71180",
      submittedAt: "2026-07-06T10:00:00+08:00",
      approvedAt: "2026-07-15T00:00:00+08:00",
    },
    submission: null,
    submissionLog: [
      {
        at: "2026-07-06T10:00:00+08:00",
        actor: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
        event: "GRANT_SUBMITTED",
        reference: "GRT-2026-71180",
      },
      {
        at: "2026-08-25T11:00:00+08:00",
        actor: { kind: "AGENT", id: AGENT_COMPLIANCE, name: "Compliance Agent" },
        event: "PACKET_ASSEMBLED",
        completeness: 0.6,
      },
    ],
  },
  {
    id: "pkt_0189",
    engagementRef: ENGAGEMENT_WINDOW_CLOSING,
    organisationRef: ORG_KENANGA,
    scheme: "SBL_KHAS",
    employerCode: "HRDC-1908-4417",
    claimValue: myr(2240000),
    levyAvailable: myr(12400000),
    /** Complete — the only thing standing between this and a filing is a human. */
    completeness: 1,
    status: "READY",
    deadlineAt: "2026-11-17T23:59:59+08:00",
    daysRemaining: 3,
    deadlineSeverity: "DANGER",
    requiredDocuments: [
      {
        type: "ATTENDANCE_SHEET",
        label: "Attendance sheet",
        status: "PRESENT",
        ref: `${ENGAGEMENT_WINDOW_CLOSING}/attendance`,
        meta: "Locked 22 May · 30/30 present",
      },
      { type: "TRAINER_TTT_CERT", status: "PRESENT", ref: "TTT-2022-1174", meta: "Valid to 30 Nov 2027" },
      { type: "TAX_INVOICE", status: "PRESENT", ref: "INV-2026-0201", meta: "MyInvois validated" },
      { type: "EVALUATION_SUMMARY", status: "PRESENT", meta: "30 of 30 responses collected" },
      { type: "TRAINING_SCHEDULE", status: "PRESENT" },
    ],
    grant: {
      reference: "GRT-2026-69024",
      submittedAt: "2026-04-10T09:00:00+08:00",
      approvedAt: "2026-04-21T00:00:00+08:00",
    },
    submission: null,
    submissionLog: [
      {
        at: "2026-05-22T09:00:00+08:00",
        actor: { kind: "AGENT", id: AGENT_COMPLIANCE, name: "Compliance Agent" },
        event: "PACKET_ASSEMBLED",
        completeness: 1,
      },
    ],
  },
];

/** §9 `GET /v1/hrdc/deadlines` — what the compliance badge counts. */
export const hrdcDeadlines: HrdcDeadline[] = [
  {
    engagementRef: ENGAGEMENT_WINDOW_CLOSING,
    organisationRef: ORG_KENANGA,
    deadlineAt: "2026-11-17T23:59:59+08:00",
    daysRemaining: 3,
    status: "AT_RISK",
    severity: "DANGER",
  },
  {
    engagementRef: ENGAGEMENT_BLOCKED,
    organisationRef: ORG_AURORA,
    deadlineAt: "2027-02-21T23:59:59+08:00",
    daysRemaining: 99,
    status: "BLOCKED",
    severity: "WARN",
  },
  {
    engagementRef: ENGAGEMENT_AURORA,
    organisationRef: ORG_AURORA,
    deadlineAt: "2027-05-13T23:59:59+08:00",
    daysRemaining: 180,
    status: "BLOCKED",
    severity: "WARN",
  },
];

/**
 * §17 `GET /v1/compliance/rules` — the ten rules the design pack names.
 *
 * DECISIONS §3 supplies the conditions and the effective dates; HRD-014 is the
 * §17 example verbatim. `dayBasis` is CALENDAR everywhere until circular text
 * says otherwise.
 */
export const complianceRules: ComplianceRule[] = [
  {
    id: RULE_SUPERSEDED,
    scheme: "SBL_KHAS",
    subject: "In-house application lead time (superseded)",
    expression: {
      field: "training_start",
      op: "GTE",
      reference: "grant_approval",
      offsetDays: 7,
      dayBasis: "CALENDAR",
    },
    effectiveFrom: "2024-01-01",
    effectiveTo: "2026-06-14",
    status: "SUPERSEDED",
    source: {
      documentId: "DOC-0102",
      title: "Circular 02/2024",
      section: "3.1",
      page: 3,
      excerpt:
        "Applications for in-house programmes shall be submitted not less than seven (7) days before commencement.",
    },
    supersedesId: null,
    supersededById: RULE_LEAD_TIME_INHOUSE,
    usedByChecks: [CHECK_LEAD_TIME],
    affectedOpenEngagements: 0,
    verifiedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
    verifiedAt: "2024-02-02T00:00:00+08:00",
  },
  {
    id: RULE_COMMENCEMENT_WINDOW,
    scheme: "SBL_KHAS",
    subject: "Commencement window",
    expression: {
      field: "training_start",
      op: "LTE",
      reference: "grant_approval",
      offsetDays: 90,
      dayBasis: "CALENDAR",
    },
    effectiveFrom: "2026-06-15",
    effectiveTo: null,
    status: "ACTIVE",
    source: {
      documentId: DOCUMENT_CIRCULAR_04,
      title: "Circular 2/2026",
      section: "3.4",
      page: 5,
      excerpt:
        "Training shall commence within ninety (90) days of the date of grant approval, failing which the grant lapses.",
    },
    supersedesId: null,
    supersededById: null,
    usedByChecks: [CHECK_COMMENCEMENT_WINDOW],
    affectedOpenEngagements: 3,
    verifiedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
    verifiedAt: "2026-06-20T00:00:00+08:00",
  },
  {
    id: RULE_CLAIM_WINDOW,
    scheme: "SBL_KHAS",
    subject: "Claim submission window",
    /** DECISIONS §3: six months from completion, not five working days. */
    expression: {
      field: "claim_submitted",
      op: "LTE",
      reference: "training_completion",
      offsetDays: 183,
      dayBasis: "CALENDAR",
    },
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    status: "ACTIVE",
    source: {
      documentId: DOCUMENT_CIRCULAR_04,
      title: "Circular 2/2026",
      section: "5.2",
      page: 9,
      excerpt:
        "Claims shall be submitted within six (6) months from the date of completion of the training programme.",
    },
    supersedesId: null,
    supersededById: null,
    usedByChecks: [CHECK_CLAIM_WINDOW],
    affectedOpenEngagements: 3,
    verifiedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
    verifiedAt: "2026-06-20T00:00:00+08:00",
  },
  {
    id: RULE_DOCS_COMPLETE,
    scheme: "SBL_KHAS",
    subject: "Required claim documents",
    expression: { field: "documents_present", op: "EQ", reference: "documents_required" },
    effectiveFrom: "2026-06-15",
    effectiveTo: null,
    status: "ACTIVE",
    source: {
      documentId: DOCUMENT_CIRCULAR_04,
      title: "Circular 2/2026",
      section: "5.1",
      page: 8,
      excerpt:
        "A claim shall be accompanied by the attendance record, trainer accreditation, tax invoice, evaluation summary and training schedule.",
    },
    supersedesId: null,
    supersededById: null,
    usedByChecks: [CHECK_DOCS_COMPLETE],
    affectedOpenEngagements: 2,
    verifiedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
    verifiedAt: "2026-06-20T00:00:00+08:00",
  },
  {
    id: RULE_LEAD_TIME_INHOUSE,
    scheme: "SBL_KHAS",
    subject: "In-house application lead time",
    expression: {
      field: "training_start",
      op: "GTE",
      reference: "grant_approval",
      offsetDays: 14,
      dayBasis: "CALENDAR",
    },
    effectiveFrom: "2026-06-15",
    effectiveTo: null,
    status: "ACTIVE",
    source: {
      documentId: DOCUMENT_CIRCULAR_04,
      title: "Circular 04/2026",
      section: "3.2",
      page: 4,
      excerpt:
        "Employers are required to submit grant applications at least fourteen (14) days before the commencement date of in-house training programmes.",
    },
    supersedesId: RULE_SUPERSEDED,
    supersededById: null,
    usedByChecks: [CHECK_LEAD_TIME],
    affectedOpenEngagements: 4,
    verifiedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
    verifiedAt: "2026-06-20T00:00:00+08:00",
    provenance: {
      origin: "AI_SUGGESTED",
      confidence: 0.93,
      model: "Gemini 3.1 Pro",
      provider: "GOOGLE",
      tier: "STRONG_2",
      generatedAt: "2026-06-18T00:00:00+08:00",
      editedBy: { id: USER_JASON, name: "Jason Lee", at: "2026-06-20T00:00:00+08:00" },
    },
  },
  {
    id: RULE_LEAD_TIME_PUBLIC,
    scheme: "SBL",
    subject: "Public programme application lead time",
    expression: {
      field: "training_start",
      op: "GTE",
      reference: "grant_approval",
      offsetDays: 3,
      dayBasis: "CALENDAR",
    },
    effectiveFrom: "2026-06-15",
    /** Superseded from 1 Jan 2027 by HRD-022 — the dated replacement M12-S07 renders. */
    effectiveTo: "2026-12-31",
    status: "ACTIVE",
    source: {
      documentId: DOCUMENT_CIRCULAR_04,
      title: "Circular 2/2026",
      section: "3.3",
      page: 4,
      excerpt:
        "Applications for public programmes shall be submitted at least three (3) days before the commencement date.",
    },
    supersedesId: null,
    supersededById: RULE_LEAD_TIME_PUBLIC_2027,
    usedByChecks: [CHECK_LEAD_TIME],
    affectedOpenEngagements: 4,
    verifiedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
    verifiedAt: "2026-06-20T00:00:00+08:00",
  },
  {
    id: RULE_NO_AMENDMENT,
    scheme: "SBL_KHAS",
    subject: "No amendment after grant approval",
    expression: { field: "grant_terms", op: "IMMUTABLE_AFTER", reference: "grant_approval" },
    effectiveFrom: "2026-06-15",
    effectiveTo: null,
    status: "ACTIVE",
    source: {
      documentId: DOCUMENT_CIRCULAR_04,
      title: "Circular 2/2026",
      section: "4.1",
      page: 6,
      excerpt: "Approved grant terms shall not be amended after the date of approval.",
    },
    supersedesId: null,
    supersededById: null,
    usedByChecks: [],
    affectedOpenEngagements: 0,
    verifiedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
    verifiedAt: "2026-06-20T00:00:00+08:00",
  },
  {
    id: RULE_MEAL_CEILING,
    scheme: "SBL_KHAS",
    subject: "Allowable Cost Matrix — meals per participant",
    expression: { field: "meals_per_pax", op: "LTE", reference: "acm_ceiling_2026" },
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    status: "ACTIVE",
    source: {
      documentId: "DOC-0170",
      title: "Allowable Cost Matrix 2026",
      section: "2.4",
      page: 11,
      excerpt: "Meals and refreshments shall not exceed RM 25.00 per participant per training day.",
    },
    supersedesId: null,
    supersededById: null,
    usedByChecks: [CHECK_MEAL_CEILING],
    affectedOpenEngagements: 2,
    verifiedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
    verifiedAt: "2026-02-14T00:00:00+08:00",
  },
  {
    id: RULE_LEAD_TIME_PUBLIC_2027,
    scheme: "SBL",
    subject: "Public programme application lead time (from 2027)",
    expression: {
      field: "training_start",
      op: "GTE",
      reference: "grant_approval",
      offsetDays: 14,
      dayBasis: "CALENDAR",
    },
    effectiveFrom: "2027-01-01",
    effectiveTo: null,
    /** Proposed, not active: it arrives through the M12-S08 review, not silently. */
    status: "PROPOSED",
    source: {
      documentId: DOCUMENT_CIRCULAR_09,
      title: "Circular 09/2026",
      section: "2.1",
      page: 3,
      excerpt:
        "With effect from 1 January 2027, employers are required to submit grant applications for public training programmes at least fourteen (14) days before the commencement date…",
    },
    supersedesId: RULE_LEAD_TIME_PUBLIC,
    supersededById: null,
    usedByChecks: [CHECK_LEAD_TIME],
    affectedOpenEngagements: 4,
    verifiedBy: null,
    verifiedAt: null,
    provenance: {
      origin: "AI_SUGGESTED",
      confidence: 0.94,
      model: "Gemini 3.1 Pro",
      provider: "GOOGLE",
      tier: "STRONG_2",
      runId: "run_4912",
      generatedAt: "2026-11-14T09:41:00+08:00",
    },
  },
  {
    id: RULE_TRAINER_ACCREDITATION,
    scheme: "SBL_KHAS",
    subject: "Trainer accreditation at grant application",
    expression: { field: "trainer.hrd_tdf", op: "EQ", reference: "true" },
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    /** Awaiting verification against the circular PDF — the unverified row on M12-S07. */
    status: "PROPOSED",
    source: {
      documentId: "DOC-0155",
      title: "HRD Corp trainer guidelines",
      section: "1.2",
      page: 2,
      excerpt:
        "The trainer named in the grant application shall hold a valid HRD Corp Train-the-Trainer accreditation.",
    },
    supersedesId: null,
    supersededById: null,
    usedByChecks: [CHECK_TRAINER_ACCREDITATION],
    affectedOpenEngagements: 1,
    verifiedBy: null,
    verifiedAt: null,
    provenance: {
      origin: "AI_SUGGESTED",
      confidence: 0.81,
      model: "Gemini 3.1 Pro",
      provider: "GOOGLE",
      tier: "STRONG_2",
      generatedAt: "2026-06-18T00:00:00+08:00",
    },
  },
];

/**
 * §17 `GET /v1/compliance/rule-changes/{documentId}`.
 *
 * `chg_2` sits below the 0.80 floor, so the diff view must withhold it and
 * flag it for manual transcription rather than render it as a change.
 */
export const ruleChangeSets: RuleChangeSet[] = [
  {
    documentId: DOCUMENT_CIRCULAR_09,
    title: "Circular 09/2026",
    publishedAt: "2026-11-08",
    ingestedAt: "2026-11-14T09:40:00+08:00",
    extractedBy: { model: "Gemini 3.1 Pro", confidence: 0.91, runId: "run_4912" },
    effectiveFrom: "2027-01-01",
    changes: [
      {
        id: "chg_1",
        op: "SUPERSEDE",
        targetRuleId: RULE_LEAD_TIME_PUBLIC,
        newRuleId: RULE_LEAD_TIME_PUBLIC_2027,
        before: "training_start ≥ grant_approval + 3 days",
        after: "training_start ≥ grant_approval + 14 days",
        sourceSpan: {
          page: 3,
          section: "2.1",
          excerpt:
            "With effect from 1 January 2027, employers are required to submit grant applications for public training programmes at least fourteen (14) days before the commencement date…",
        },
        confidence: 0.94,
        affectedEngagements: [{ ref: ENGAGEMENT_AFFECTED_1 }, { ref: ENGAGEMENT_AFFECTED_2 }],
        status: "PROPOSED",
      },
      {
        id: "chg_2",
        op: "MODIFY",
        targetRuleId: RULE_MEAL_CEILING,
        newRuleId: null,
        before: "meals_per_pax ≤ RM 25.00",
        after: "meals_per_pax ≤ RM 28.00",
        sourceSpan: {
          page: 7,
          section: "4.3",
          excerpt:
            "…refreshment rates shall be reviewed in line with the revised Allowable Cost Matrix, subject to publication…",
        },
        /** Below RULE_CHANGE_MIN_CONFIDENCE — withheld from the diff view. */
        confidence: 0.62,
        affectedEngagements: [],
        status: "PROPOSED",
      },
    ],
  },
];

/**
 * §17 + §18 `GET /v1/compliance/checks?engagementRef=`.
 *
 * Six checks: four pass, one warns, one fails. The failure is what sets the
 * engagement's `HRDC_CLAIM` lifecycle step to BLOCKED — the stepper renders
 * that state, it does not compute it.
 *
 * `ruleResolution` replaces the §17 single `asOf`: grant-side rules resolve as
 * at grant submission, claim-side as at claim submission, and a side that has
 * not happened yet carries nulls.
 */
export const complianceChecks: Record<string, ComplianceChecksResponse> = {
  [ENGAGEMENT_AURORA]: {
    engagementRef: ENGAGEMENT_AURORA,
    evaluatedAt: "2026-11-14T10:32:00+08:00",
    ruleResolution: {
      grantSide: { asOf: "2026-10-02", basis: "GRANT_SUBMITTED", ruleSetVersion: RULE_SET_2026_06_15 },
      claimSide: { asOf: null, basis: "CLAIM_SUBMITTED", ruleSetVersion: null },
    },
    versionDrift: [],
    summary: { pass: 4, warn: 1, fail: 1 },
    checks: [
      {
        key: CHECK_LEAD_TIME,
        state: "PASS",
        label: "Application lead time · in-house",
        computed: {
          grantApproval: "2026-10-09",
          offsetDays: 14,
          earliestStart: "2026-10-23",
          trainingStart: "2026-11-12",
        },
        display: "grant approved 09 Oct → earliest start 23 Oct → training 12 Nov",
        ruleId: RULE_LEAD_TIME_INHOUSE,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_COMMENCEMENT_WINDOW,
        state: "PASS",
        label: "Commencement within 90 days",
        computed: { grantApproval: "2026-10-09", latestStart: "2027-01-07", trainingStart: "2026-11-12" },
        display: "grant approved 09 Oct → must start by 07 Jan → training 12 Nov",
        ruleId: RULE_COMMENCEMENT_WINDOW,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_CLAIM_WINDOW,
        state: "PASS",
        label: "Claim window · 6 months from completion",
        computed: { completion: "2026-11-13", deadline: "2027-05-13", claimSubmitted: null },
        display: "completed 13 Nov → claim by 13 May 2027",
        ruleId: RULE_CLAIM_WINDOW,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_TRAINER_ACCREDITATION,
        state: "PASS",
        label: "Trainer accreditation at grant application",
        computed: { trainerRef: "TRN-0007", hrdTdf: true, tttRef: TTT_FARAH, validTo: "2027-06-30" },
        display: "Farah Aziz · TTT-2019-4471 valid to 30 Jun 2027",
        ruleId: RULE_TRAINER_ACCREDITATION,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_MEAL_CEILING,
        state: "WARN",
        label: "Meal cost ceiling",
        computed: { perPax: myr(2600), ceiling: myr(2500) },
        display: "RM 26.00 per pax against an RM 25.00 ceiling",
        ruleId: RULE_MEAL_CEILING,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_DOCS_COMPLETE,
        state: "FAIL",
        label: "Required documents complete",
        computed: { present: 3, required: 5, missing: ["EVALUATION_SUMMARY", "TRAINING_SCHEDULE"] },
        display: "3 of 5 documents present",
        ruleId: RULE_DOCS_COMPLETE,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
    ],
  },
  /**
   * §18 the version-drift case: a public programme applied for under the
   * 3-day rule but scheduled into January, when the 14-day rule applies. The
   * response cites both versions rather than silently switching.
   */
  [ENGAGEMENT_AFFECTED_1]: {
    engagementRef: ENGAGEMENT_AFFECTED_1,
    evaluatedAt: "2026-11-14T10:32:00+08:00",
    ruleResolution: {
      grantSide: { asOf: "2026-11-12", basis: "GRANT_SUBMITTED", ruleSetVersion: RULE_SET_2026_06_15 },
      claimSide: { asOf: null, basis: "CLAIM_SUBMITTED", ruleSetVersion: null },
    },
    versionDrift: [
      {
        checkKey: CHECK_LEAD_TIME,
        appliedVersion: RULE_SET_2026_06_15,
        currentVersion: RULE_SET_2027_01_01,
        severity: "WARN",
        message:
          "Applied 3-day public lead time in force at submission; 14 days applies from 1 Jan 2027.",
      },
    ],
    summary: { pass: 2, warn: 1, fail: 0 },
    checks: [
      {
        key: CHECK_LEAD_TIME,
        state: "WARN",
        label: "Application lead time · public",
        computed: {
          grantApproval: "2026-11-20",
          offsetDays: 3,
          earliestStart: "2026-11-23",
          trainingStart: "2027-01-14",
          offsetDaysFrom2027: 14,
        },
        display: "3-day rule applied at submission; 14 days applies from 1 Jan 2027",
        ruleId: RULE_LEAD_TIME_PUBLIC,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_COMMENCEMENT_WINDOW,
        state: "PASS",
        label: "Commencement within 90 days",
        computed: { grantApproval: "2026-11-20", latestStart: "2027-02-18", trainingStart: "2027-01-14" },
        ruleId: RULE_COMMENCEMENT_WINDOW,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_TRAINER_ACCREDITATION,
        state: "PASS",
        label: "Trainer accreditation at grant application",
        computed: { trainerRef: "TRN-0007", hrdTdf: true },
        ruleId: RULE_TRAINER_ACCREDITATION,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
    ],
  },
  [ENGAGEMENT_BLOCKED]: {
    engagementRef: ENGAGEMENT_BLOCKED,
    evaluatedAt: "2026-11-14T10:32:00+08:00",
    ruleResolution: {
      grantSide: { asOf: "2026-07-06", basis: "GRANT_SUBMITTED", ruleSetVersion: RULE_SET_2026_06_15 },
      claimSide: { asOf: null, basis: "CLAIM_SUBMITTED", ruleSetVersion: null },
    },
    versionDrift: [],
    summary: { pass: 2, warn: 0, fail: 2 },
    checks: [
      {
        key: CHECK_LEAD_TIME,
        state: "PASS",
        label: "Application lead time · in-house",
        computed: { grantApproval: "2026-07-15", offsetDays: 14, earliestStart: "2026-07-29", trainingStart: "2026-08-20" },
        ruleId: RULE_LEAD_TIME_INHOUSE,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_CLAIM_WINDOW,
        state: "PASS",
        label: "Claim window · 6 months from completion",
        computed: { completion: "2026-08-21", deadline: "2027-02-21", claimSubmitted: null },
        ruleId: RULE_CLAIM_WINDOW,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_TRAINER_ACCREDITATION,
        state: "FAIL",
        label: "Trainer accreditation at grant application",
        computed: { trainerRef: "TRN-0024", hrdTdf: false, tttRef: null },
        display: "Noora Idris holds no HRD Corp TTT accreditation",
        ruleId: RULE_TRAINER_ACCREDITATION,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_DOCS_COMPLETE,
        state: "FAIL",
        label: "Required documents complete",
        computed: { present: 3, required: 5, missing: ["TRAINER_TTT_CERT", "TRAINING_SCHEDULE"] },
        ruleId: RULE_DOCS_COMPLETE,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
    ],
  },
  [ENGAGEMENT_WINDOW_CLOSING]: {
    engagementRef: ENGAGEMENT_WINDOW_CLOSING,
    evaluatedAt: "2026-11-14T10:32:00+08:00",
    ruleResolution: {
      grantSide: { asOf: "2026-04-10", basis: "GRANT_SUBMITTED", ruleSetVersion: RULE_SET_2026_06_15 },
      claimSide: { asOf: null, basis: "CLAIM_SUBMITTED", ruleSetVersion: null },
    },
    versionDrift: [],
    summary: { pass: 3, warn: 1, fail: 0 },
    checks: [
      {
        key: CHECK_CLAIM_WINDOW,
        state: "WARN",
        label: "Claim window · 6 months from completion",
        computed: { completion: "2026-05-21", deadline: "2026-11-17", daysRemaining: 3 },
        display: "completed 21 May → claim by 17 Nov · 3 days left",
        ruleId: RULE_CLAIM_WINDOW,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_DOCS_COMPLETE,
        state: "PASS",
        label: "Required documents complete",
        computed: { present: 5, required: 5, missing: [] },
        ruleId: RULE_DOCS_COMPLETE,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_LEAD_TIME,
        state: "PASS",
        label: "Application lead time · in-house",
        computed: { grantApproval: "2026-04-21", offsetDays: 14, earliestStart: "2026-05-05", trainingStart: "2026-05-20" },
        ruleId: RULE_LEAD_TIME_INHOUSE,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
      {
        key: CHECK_TRAINER_ACCREDITATION,
        state: "PASS",
        label: "Trainer accreditation at grant application",
        computed: { trainerRef: "TRN-0019", hrdTdf: true },
        ruleId: RULE_TRAINER_ACCREDITATION,
        provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
      },
    ],
  },
};

/** The eTRIS reference a human records once they have filed — used by the tests. */
export const sampleClaimReference = HRDC_CLAIM;
