/**
 * §6 · TNAs, recommendations, proposals and quotations, plus the §11 client-safe
 * portal projection.
 *
 * Screens M05-S02 (TNA detail), M07-S02 (proposal builder), M07-S03 (quotation
 * worksheet), M07-S07 (client proposal page).
 *
 * Two states the pack insists on and this file reproduces verbatim: the TNA's
 * `budget: null` is a real absence rather than a zero, and section 5 of
 * PRO-2026-0184 is generated at 0.41 confidence so a clean send is blocked.
 */

import type {
  Quotation,
  PortalProposal,
  Proposal,
  Tna,
  TnaRecommendationsResponse,
} from "@trainos/contract";
import {
  AGENT_PROPOSAL,
  AGENT_TNA,
  ENQUIRY_AURORA,
  OPPORTUNITY_AURORA,
  ORG_AURORA,
  PROGRAMME_CONFLICT,
  PROGRAMME_DATA_LITERACY,
  PROGRAMME_LEADING_CHANGE,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  RATE_CARD_PLACEHOLDER_VERSION,
  RUN_PROPOSAL,
  RUN_TNA,
  TEMPLATE_PROPOSAL,
  TNA_AURORA,
  TRAINER_DANIEL_REF,
  TRAINER_FARAH_REF,
  USER_AMIRAH,
} from "@trainos/contract";
import { OPPORTUNITY_MERIDIAN, OPPORTUNITY_SUTERA, ORG_MERIDIAN } from "./organisations";
import { actorFor, clientActor } from "./tenant";
import { entity, myr } from "./_helpers";

/** Records the pack implies but does not number. */
export const TNA_MERIDIAN = "TNA-0051";
export const TNA_KENANGA = "TNA-0054";
export const PROPOSAL_MERIDIAN = "PRO-2026-0191";
export const PROPOSAL_SUTERA = "PRO-2026-0166";
export const QUOTATION_MERIDIAN = "QUO-2026-0191";
/** The Sutera quotation — the case where the absolute tier floor binds, not the margin floor. */
export const QUOTATION_SUTERA = "QUO-2026-0179";

/** §11 the signed portal tokens. Opaque in production; stable here so demos can link. */
export const PORTAL_TOKEN_AURORA = "tok_aurora_pro_0184";
export const PORTAL_TOKEN_MERIDIAN = "tok_meridian_pro_0191";

/** §6 `GET /v1/tnas/{id}`. */
export const tnas: Tna[] = [
  {
    ...entity(TNA_AURORA, "2026-09-11T09:05:31+08:00", "2026-09-11T09:10:00+08:00", actorFor(USER_AMIRAH)),
    opportunityRef: OPPORTUNITY_AURORA,
    status: "COMPLETE",
    completedBy: clientActor,
    completedAt: "2026-09-11T09:10:00+08:00",
    audience: { headcount: 30, level: "LINE_MANAGER", sites: ["Shah Alam", "Klang"], language: "EN" },
    constraints: [
      { code: "DELIVERY_WINDOW", label: "November 2026", severity: "WARN" },
      { code: "MAX_DAYS_OFF_FLOOR", label: "Max 2 days" },
      { code: "HRDC_CLAIMABLE_REQUIRED", label: "Must be claimable" },
    ],
    /** Not zero — the client stated no budget, and the screen must render the absence. */
    budget: null,
    gaps: [
      {
        name: "Conflict resolution",
        description: "Production vs quality escalations",
        priority: "HIGH",
        evidenceRefs: ["Q4", "Q7"],
        provenance: {
          origin: "AI_GENERATED",
          confidence: 0.91,
          agentId: AGENT_TNA,
          runId: RUN_TNA,
          tier: "STRONG_1",
          model: "Claude Sonnet 5",
          provider: "ANTHROPIC",
          cacheHitRate: 0.38,
          generatedAt: "2026-09-11T09:12:40+08:00",
        },
      },
      {
        name: "Cross-functional communication",
        description: "Shift handover loses the decision, not the data",
        priority: "HIGH",
        evidenceRefs: ["Q4", "Q9", "Q11"],
        provenance: {
          origin: "AI_GENERATED",
          confidence: 0.87,
          agentId: AGENT_TNA,
          runId: RUN_TNA,
          tier: "STRONG_1",
          model: "Claude Sonnet 5",
          provider: "ANTHROPIC",
          generatedAt: "2026-09-11T09:12:40+08:00",
        },
      },
      {
        name: "Giving corrective feedback",
        description: "Supervisors escalate rather than address on the floor",
        priority: "MEDIUM",
        evidenceRefs: ["Q12"],
        provenance: {
          origin: "AI_GENERATED",
          confidence: 0.74,
          agentId: AGENT_TNA,
          runId: RUN_TNA,
          generatedAt: "2026-09-11T09:12:40+08:00",
        },
      },
    ],
    evidence: [
      { type: "EMAIL", ref: ENQUIRY_AURORA },
      { type: "QUESTIONNAIRE", ref: `${TNA_AURORA}/responses` },
      { type: "HISTORY", ref: `${ORG_AURORA}/2024-2025` },
      { type: "CATALOGUE", ref: "PRG-*/nov-availability" },
    ],
  },
  {
    ...entity(TNA_MERIDIAN, "2026-10-14T09:20:00+08:00", "2026-10-20T11:00:00+08:00", actorFor(USER_AMIRAH)),
    opportunityRef: OPPORTUNITY_MERIDIAN,
    status: "COMPLETE",
    completedBy: { id: "c_faridah", name: "Faridah Omar", kind: "CLIENT" },
    completedAt: "2026-10-20T11:00:00+08:00",
    audience: { headcount: 22, level: "PLANNER", sites: ["Port Klang"], language: "EN" },
    constraints: [{ code: "DELIVERY_WINDOW", label: "December 2026" }],
    budget: myr(4200000),
    gaps: [
      {
        name: "Interpreting operational dashboards",
        description: "Planners act on the headline, not the distribution",
        priority: "HIGH",
        evidenceRefs: ["Q2", "Q5"],
        provenance: { origin: "AI_GENERATED", confidence: 0.88, agentId: AGENT_TNA, runId: RUN_TNA },
      },
    ],
    evidence: [{ type: "QUESTIONNAIRE", ref: `${TNA_MERIDIAN}/responses` }],
  },
  {
    ...entity(TNA_KENANGA, "2026-10-30T09:00:00+08:00", "2026-10-30T09:00:00+08:00", actorFor(USER_AMIRAH)),
    opportunityRef: "OPP-0498",
    status: "SENT",
    completedBy: null,
    completedAt: null,
    audience: { headcount: 48, level: "STORE_MANAGER", sites: ["Klang Valley", "Johor"], language: "EN" },
    constraints: [{ code: "DELIVERY_WINDOW", label: "Q1 2027" }],
    budget: null,
    gaps: [],
    evidence: [],
  },
];

/** §6 `GET /v1/tnas/{id}/recommendations` — the 0.22 low-fit row is kept on purpose. */
export const tnaRecommendations: Record<string, TnaRecommendationsResponse> = {
  [TNA_AURORA]: {
    data: [
      {
        programmeId: PROGRAMME_LEADING_CHANGE,
        name: "Leading Through Change",
        fitScore: 0.91,
        rationale: "Covers both high-priority gaps; Farah Aziz free 12–13 Nov.",
        priceIndication: myr(1850000),
        trainerAvailability: [
          {
            trainerRef: TRAINER_FARAH_REF,
            name: "Farah Aziz",
            available: true,
            dates: "2026-11-12/2026-11-13",
          },
          { trainerRef: TRAINER_DANIEL_REF, name: "Daniel Wong", available: false },
        ],
      },
      {
        programmeId: PROGRAMME_CONFLICT,
        name: "Conflict to Collaboration",
        fitScore: 0.78,
        rationale: "Covers conflict only; no communication module.",
        priceIndication: myr(980000),
      },
      {
        programmeId: PROGRAMME_DATA_LITERACY,
        name: "Data Literacy for Managers",
        fitScore: 0.22,
        rationale: "No gap match; listed for completeness.",
      },
    ],
    provenance: {
      origin: "AI_GENERATED",
      confidence: 0.89,
      agentId: AGENT_TNA,
      runId: RUN_TNA,
      tier: "STRONG_1",
      model: "Claude Sonnet 5",
      provider: "ANTHROPIC",
      cacheHitRate: 0.38,
      generatedAt: "2026-09-11T09:13:10+08:00",
      sources: [
        { type: "TNA", ref: TNA_AURORA },
        { type: "CATALOGUE", ref: "PRG-*" },
      ],
    },
    scoringModel: {
      version: "fit-v3",
      weights: { gapCoverage: 0.5, audienceFit: 0.2, windowFit: 0.2, trainerAvailability: 0.1 },
    },
  },
  [TNA_MERIDIAN]: {
    data: [
      {
        programmeId: PROGRAMME_DATA_LITERACY,
        name: "Data Literacy for Managers",
        fitScore: 0.94,
        rationale: "Direct gap match; repeat cohort from October.",
        priceIndication: myr(1920000),
      },
    ],
    provenance: {
      origin: "AI_GENERATED",
      confidence: 0.92,
      agentId: AGENT_TNA,
      runId: RUN_TNA,
      generatedAt: "2026-10-20T11:04:00+08:00",
    },
    scoringModel: {
      version: "fit-v3",
      weights: { gapCoverage: 0.5, audienceFit: 0.2, windowFit: 0.2, trainerAvailability: 0.1 },
    },
  },
};

/** §6 `GET /v1/proposals/{id}`. */
export const proposals: Proposal[] = [
  {
    ...entity(PROPOSAL_AURORA, "2026-09-11T09:14:02+08:00", "2026-09-11T09:31:10+08:00", {
      id: AGENT_PROPOSAL,
      name: "Proposal Agent",
      kind: "AGENT",
    }),
    opportunityRef: OPPORTUNITY_AURORA,
    templateId: TEMPLATE_PROPOSAL,
    status: "DRAFT",
    value: myr(1850000),
    marginRate: 0.41,
    runId: RUN_PROPOSAL,
    sections: [
      {
        n: 1,
        title: "Understanding your needs",
        body: "Aurora Manufacturing's 30 line managers report friction between production and quality teams…",
        mergeFieldsUsed: ["contact.name"],
        provenance: {
          origin: "AI_GENERATED",
          confidence: 0.88,
          agentId: AGENT_PROPOSAL,
          runId: RUN_PROPOSAL,
          tier: "STRONG_1",
          model: "Claude Sonnet 5",
          provider: "ANTHROPIC",
          cacheHitRate: 0.41,
          sources: [{ type: "TNA", ref: TNA_AURORA }],
          generatedAt: "2026-09-11T09:14:09+08:00",
          jury: {
            quorum: 2,
            of: 3,
            agreed: ["Claude Sonnet 5", "Gemini 3.1 Pro"],
            dissented: [
              { model: "GPT-5.6 Terra", note: "Preferred waiting for Daniel Wong in December" },
            ],
          },
        },
      },
      {
        n: 2,
        title: "Recommended programme",
        body: "Leading Through Change is a two-day facilitated programme for up to 30 participants…",
        mergeFieldsUsed: ["programme.title", "engagement.dates"],
        provenance: {
          origin: "AI_GENERATED",
          confidence: 0.92,
          agentId: AGENT_PROPOSAL,
          runId: RUN_PROPOSAL,
          tier: "STRONG_1",
          model: "Claude Sonnet 5",
          provider: "ANTHROPIC",
          generatedAt: "2026-09-11T09:14:09+08:00",
        },
      },
      {
        n: 3,
        title: "Delivery plan",
        body: "Two consecutive days on site at Aurora HQ Shah Alam, 12 and 13 November 2026…",
        provenance: {
          origin: "AI_SUGGESTED",
          confidence: 0.9,
          agentId: AGENT_PROPOSAL,
          runId: RUN_PROPOSAL,
          editedBy: { id: USER_AMIRAH, name: "Amirah Yusof", at: "2026-09-11T09:31:10+08:00" },
        },
      },
      {
        n: 4,
        title: "Investment",
        body: "RM 18,500 for up to 30 participants, inclusive of materials and trainer travel.",
        mergeFieldsUsed: ["investment.total"],
        provenance: {
          origin: "AI_GENERATED",
          confidence: 0.95,
          agentId: AGENT_PROPOSAL,
          runId: RUN_PROPOSAL,
          generatedAt: "2026-09-11T09:14:09+08:00",
        },
      },
      {
        n: 5,
        title: "HRDC claim guidance",
        body: "This programme is claimable under SBL-Khas subject to prior grant approval…",
        /** 0.41 confidence — the flag that blocks a clean send and travels to the approver. */
        needsReview: true,
        provenance: {
          origin: "AI_GENERATED",
          confidence: 0.41,
          agentId: AGENT_PROPOSAL,
          runId: RUN_PROPOSAL,
          tier: "STRONG_1",
          model: "Claude Sonnet 5",
          provider: "ANTHROPIC",
          generatedAt: "2026-09-11T09:14:09+08:00",
        },
      },
    ],
    warnings: [
      {
        code: "LOW_CONFIDENCE_SECTION",
        sectionN: 5,
        message:
          "Generated at 0.41 confidence; the 2026 SBL-Khas wording could not be verified.",
      },
    ],
  },
  {
    ...entity(PROPOSAL_MERIDIAN, "2026-10-21T10:00:00+08:00", "2026-11-06T09:15:00+08:00", {
      id: AGENT_PROPOSAL,
      name: "Proposal Agent",
      kind: "AGENT",
    }),
    opportunityRef: OPPORTUNITY_MERIDIAN,
    templateId: TEMPLATE_PROPOSAL,
    status: "VIEWED",
    value: myr(1920000),
    marginRate: 0.43,
    runId: RUN_PROPOSAL,
    sections: [
      {
        n: 1,
        title: "Understanding your needs",
        body: "Meridian's planning team needs to read the distribution, not the headline…",
        provenance: { origin: "AI_GENERATED", confidence: 0.9, agentId: AGENT_PROPOSAL, runId: RUN_PROPOSAL },
      },
      { n: 2, title: "Recommended programme", body: "Data Literacy for Managers, two days, December 2026." },
    ],
  },
  {
    ...entity(PROPOSAL_SUTERA, "2026-05-20T10:00:00+08:00", "2026-06-30T15:00:00+08:00", actorFor(USER_AMIRAH)),
    opportunityRef: OPPORTUNITY_SUTERA,
    templateId: TEMPLATE_PROPOSAL,
    status: "LOST",
    value: myr(980000),
    marginRate: 0.39,
    sections: [{ n: 1, title: "Understanding your needs", body: "Front office service recovery…" }],
  },
];

/**
 * §6 `GET /v1/quotations/{id}`.
 *
 * QUO-2026-0184 is verbatim from §6. Its lines sum to RM 11,400 of direct
 * cost, which against the RM 18,500 sell price is a 0.38 margin, not the 0.41
 * the contract also states — the discrepancy is the contract's, kept here
 * rather than silently corrected, and reported.
 */
export const quotations: Quotation[] = [
  {
    ...entity(QUOTATION_AURORA, "2026-09-11T09:14:20+08:00", "2026-09-11T09:30:00+08:00", actorFor(USER_AMIRAH)),
    proposalRef: PROPOSAL_AURORA,
    status: "DRAFT",
    rateCardYear: 2026,
    rateCardVersion: RATE_CARD_PLACEHOLDER_VERSION,
    lines: [
      {
        item: "TRAINER_FEE",
        detail: "Farah Aziz · TTT certified",
        qty: 2,
        unit: "DAY",
        rate: myr(480000),
        total: myr(960000),
      },
      { item: "VENUE", detail: "Client site · Aurora HQ Shah Alam", qty: 0, total: myr(0) },
      { item: "MATERIALS", qty: 30, rate: myr(4000), total: myr(120000) },
      { item: "TRAVEL", qty: 2, rate: myr(30000), total: myr(60000) },
    ],
    sellPrice: myr(1850000),
    directCost: myr(1140000),
    marginRate: 0.41,
    floorPrice: myr(1753846),
    floorMarginRate: 0.35,
    /* Ruling R6: both floors recorded, the higher binds — 1,140.00 direct cost at a 0.35 floor margin needs RM 17,538.46, above the
       RM 13,900 catalogue floor, so margin binds. */
    absoluteFloorPrice: myr(1390000),
    marginFloorPrice: myr(1753846),
    bindingFloorBasis: "MARGIN",
    commissionRate: 0.08,
    commission: myr(148000),
    commissionPayableOn: "COLLECTION",
    /** §15 item 3 / §18 — display only, never a line. */
    display: { perPax: myr(61667) },
  },
  {
    ...entity(QUOTATION_SUTERA, "2026-05-20T10:10:00+08:00", "2026-06-02T09:00:00+08:00", actorFor(USER_AMIRAH)),
    proposalRef: PROPOSAL_SUTERA,
    status: "APPLIED",
    rateCardYear: 2026,
    rateCardVersion: RATE_CARD_PLACEHOLDER_VERSION,
    lines: [
      { item: "TRAINER_FEE", detail: "Farah Aziz · 1 day", qty: 1, unit: "DAY", rate: myr(280000), total: myr(280000) },
      { item: "VENUE", detail: "Client site · Sutera Bukit Bintang", qty: 0, total: myr(0) },
      { item: "MATERIALS", qty: 18, rate: myr(4000), total: myr(72000) },
      { item: "TRAVEL", qty: 1, unit: "TRIP", rate: myr(30000), total: myr(30000) },
    ],
    sellPrice: myr(980000),
    directCost: myr(382000),
    marginRate: 0.61,
    /**
     * The mirror of QUO-2026-0184: direct cost of RM 3,820 puts the margin
     * floor at RM 5,876.92, so the programme's RM 7,350 tier floor is the
     * higher of the two and binds.
     */
    floorPrice: myr(735000),
    floorMarginRate: 0.35,
    /* Ruling R6: both floors recorded, the higher binds — the margin floor lands at RM 5,876.92, below the RM 7,350 catalogue floor,
       so the catalogue binds. */
    absoluteFloorPrice: myr(735000),
    marginFloorPrice: myr(587692),
    bindingFloorBasis: "ABSOLUTE",
    commissionRate: 0.08,
    commission: myr(78400),
    commissionPayableOn: "COLLECTION",
    display: { perPax: myr(54444) },
  },
  {
    ...entity(QUOTATION_MERIDIAN, "2026-10-21T10:05:00+08:00", "2026-10-21T10:05:00+08:00", actorFor(USER_AMIRAH)),
    proposalRef: PROPOSAL_MERIDIAN,
    status: "APPLIED",
    rateCardYear: 2026,
    rateCardVersion: RATE_CARD_PLACEHOLDER_VERSION,
    lines: [
      { item: "TRAINER_FEE", detail: "Lee Chin Hoe · 2 days", qty: 2, unit: "DAY", rate: myr(360000), total: myr(720000) },
      { item: "VENUE", detail: "Own venue · Akademi Perdana", qty: 1, rate: myr(90000), total: myr(90000) },
      { item: "MATERIALS", qty: 22, rate: myr(5500), total: myr(121000) },
      { item: "TRAVEL", qty: 2, rate: myr(30000), total: myr(60000) },
    ],
    sellPrice: myr(1920000),
    directCost: myr(991000),
    marginRate: 0.48,
    floorPrice: myr(1524615),
    floorMarginRate: 0.35,
    /* Ruling R6: both floors recorded, the higher binds — RM 15,246.15 from the margin floor clears the RM 14,400 catalogue floor, so
       margin binds. */
    absoluteFloorPrice: myr(1440000),
    marginFloorPrice: myr(1524615),
    bindingFloorBasis: "MARGIN",
    commissionRate: 0.08,
    commission: myr(153600),
    commissionPayableOn: "COLLECTION",
    display: { perPax: myr(87273) },
  },
];

/**
 * §11 `GET /v1/public/proposals/{token}` — the client-safe projection.
 *
 * No margin, no cost lines, no internal provenance. The Aurora page renders
 * the accepted-and-locked state the pack calls for, even though the internal
 * record is still `DRAFT` with APV-2026-0771 pending: the pack tells a
 * September approval story over a November delivery, and both states are in
 * the design files. Reported rather than reconciled away.
 */
export const portalProposals: Record<string, PortalProposal> = {
  [PORTAL_TOKEN_AURORA]: {
    ref: PROPOSAL_AURORA,
    /** Ruling R8: the page's own heading. `organisationName` names the client. */
    title: "Leading Through Change — Aurora Manufacturing",
    organisationName: "Aurora Manufacturing Sdn Bhd",
    issuedAt: "2026-09-11",
    sections: [
      { n: 1, title: "Understanding your needs", body: "Your 30 line managers…" },
      {
        n: 2,
        title: "Recommended programme",
        body: "Leading Through Change is a two-day facilitated programme for up to 30 participants.",
      },
      {
        n: 3,
        title: "Delivery plan",
        body: "Two consecutive days on site at Aurora HQ Shah Alam, 12 and 13 November 2026.",
      },
      {
        n: 4,
        title: "Investment",
        body: "RM 18,500 for up to 30 participants, inclusive of materials and trainer travel.",
      },
      {
        n: 5,
        title: "HRDC claim guidance",
        body: "This programme is claimable under SBL-Khas subject to prior grant approval.",
      },
    ],
    investment: {
      total: myr(1850000),
      hrdcScheme: "SBL_KHAS",
      hrdcClaimableUpTo: 1,
      levyAvailable: myr(6100000),
    },
    status: "ACCEPTED",
    acceptance: {
      acceptedBy: "Nurul Hassan",
      role: "HR Manager",
      acceptedAt: "2026-09-15T10:24:00+08:00",
      signatureRef: "sig_c19a",
    },
    comments: [
      {
        author: "Nurul Hassan",
        authorKind: "CLIENT",
        at: "2026-09-12T14:02:00+08:00",
        body: "Can we confirm the November dates before we take this to the plant director?",
      },
      {
        author: "Amirah Yusof",
        authorKind: "HUMAN",
        at: "2026-09-12T16:20:00+08:00",
        body: "Yes — 12 and 13 November are held for you until Friday.",
      },
    ],
      /**
     * Ruling R8. No source names a portal contact, so this is the proposal's
     * own owner on the Akademi Perdana side, on the tenant's domain — the
     * person a client replying to this page would actually reach.
     */
    vendorContact: {
      name: "Amirah Yusof",
      role: "Client Partner",
      email: "amirah.yusof@akademiperdana.com.my",
      phone: "+60 3 7955 2088",
    },
},
  [PORTAL_TOKEN_MERIDIAN]: {
    ref: PROPOSAL_MERIDIAN,
    title: "Data Literacy for Managers — Meridian Logistics",
    organisationName: "Meridian Logistics Sdn Bhd",
    issuedAt: "2026-10-21",
    sections: [
      { n: 1, title: "Understanding your needs", body: "Your planning team reads the headline…" },
      { n: 2, title: "Recommended programme", body: "Data Literacy for Managers, two days, December 2026." },
    ],
    investment: { total: myr(1920000), hrdcScheme: "SBL_KHAS", hrdcClaimableUpTo: 1 },
    status: "VIEWED",
    acceptance: null,
    comments: [],
      /**
     * Ruling R8. No source names a portal contact, so this is the proposal's
     * own owner on the Akademi Perdana side, on the tenant's domain — the
     * person a client replying to this page would actually reach.
     */
    vendorContact: {
      name: "Amirah Yusof",
      role: "Client Partner",
      email: "amirah.yusof@akademiperdana.com.my",
      phone: "+60 3 7955 2088",
    },
},
};

/** §11 which organisation a portal token belongs to, for the accept path. */
export const portalTokenOrganisation: Record<string, string> = {
  [PORTAL_TOKEN_AURORA]: ORG_AURORA,
  [PORTAL_TOKEN_MERIDIAN]: ORG_MERIDIAN,
};
