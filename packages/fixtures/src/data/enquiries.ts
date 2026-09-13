/**
 * §4 · Enquiries, leads and follow-ups.
 *
 * Screens M03-S01 (inbox), M03-S02 (detail), M03-S06 (follow-up queue — the
 * screen REPORT.md omits and the design-pack inventory flags).
 *
 * Every row is stored as a full `EnquiryDetail`; the inbox endpoint projects it
 * down to `Enquiry`, so `GET /v1/enquiries/{id}` can never 404 on a row the
 * list just rendered.
 */

import type {
  ChannelConsent,
  Enquiry,
  EnquiryChannel,
  EnquiryDetail,
  EnquiryStatus,
  FollowUp,
  MessageDraft,
  Money,
  Provenance,
} from "@trainos/contract";
import {
  AGENT_FOLLOWUP,
  AGENT_LEAD,
  CONTACT_NURUL,
  ENQUIRY_AURORA,
  FOLLOW_UP_AURORA,
  INVOICE_OVERDUE,
  ORG_AURORA,
  PROGRAMME_DATA_LITERACY,
  PROGRAMME_LEADING_CHANGE,
  PROPOSAL_AURORA,
  RUN_CLASSIFY,
  RUN_FOLLOWUP,
  TEMPLATE_FOLLOWUP_WHATSAPP,
  TEMPLATE_TNA,
  USER_AMIRAH,
} from "@trainos/contract";
import { PROGRAMME_SAFETY, PROGRAMME_SALES_EXCELLENCE } from "./programmes";
import {
  CONTACT_FARIDAH,
  CONTACT_GANESH,
  CONTACT_SURESH,
  CONTACT_WEI_SHENG,
  ORG_KENANGA,
  ORG_MERIDIAN,
  ORG_PERDANA_UTILITIES,
  ORG_SUTERA,
} from "./organisations";
import { actorFor } from "./tenant";
import { SYSTEM_ACTOR, entity, myr } from "./_helpers";

/** Refs for the follow-ups the design pack renders beside FUP-0311. */
export const FOLLOW_UP_KENANGA = "FUP-0304";
export const FOLLOW_UP_MERIDIAN = "FUP-0307";
export const FOLLOW_UP_PERDANA = "FUP-0309";
export const FOLLOW_UP_SUTERA = "FUP-0312";
export const FOLLOW_UP_AURORA_RAVI = "FUP-0314";
export const FOLLOW_UP_KENANGA_2 = "FUP-0316";
export const FOLLOW_UP_MERIDIAN_2 = "FUP-0318";
export const FOLLOW_UP_PERDANA_2 = "FUP-0320";

/** A classification provenance, since every inbox row carries one. */
const classified = (confidence: number, runId = RUN_CLASSIFY): Provenance => ({
  origin: "AI_GENERATED",
  confidence,
  agentId: AGENT_LEAD,
  runId,
  tier: "FAST",
  model: "Gemini 3.1 Flash",
  provider: "GOOGLE",
  cacheHitRate: 0.71,
  generatedAt: "2026-09-11T08:53:02+08:00",
});

interface EnquirySpec {
  ref: string;
  channel: EnquiryChannel;
  status: EnquiryStatus;
  receivedAt: string;
  fromName: string;
  email: string | null;
  phone: string | null;
  subject: string;
  preview: string;
  body: string;
  label: string;
  confidence: number;
  needsHumanReview?: boolean;
  estimatedValue: Money | null;
  organisationRef?: string;
  organisationName?: string;
  matchReason?: "EXACT_DOMAIN" | "FUZZY_NAME" | "MANUAL";
  assignedTo?: string;
  topic: string | null;
  audience: string | null;
  timing: string | null;
  /** The agent's proposed next step, which is what M03-S01's primary acts on. */
  suggestion?: { programmeId: string; value: Money; summary: string; confidence: number };
}

/** Builds the repetitive inbox rows. The Aurora row is written out in full below. */
const buildEnquiry = (spec: EnquirySpec): EnquiryDetail => ({
  ...entity(spec.ref, spec.receivedAt, spec.receivedAt, SYSTEM_ACTOR),
  channel: spec.channel,
  status: spec.status,
  receivedAt: spec.receivedAt,
  from: { name: spec.fromName, email: spec.email, phone: spec.phone },
  subject: spec.subject,
  preview: spec.preview,
  classification: {
    label: spec.label,
    provenance: classified(spec.confidence),
    ...(spec.needsHumanReview ? { needsHumanReview: true } : {}),
  },
  estimatedValue: spec.estimatedValue,
  matchedOrganisation:
    spec.organisationRef && spec.organisationName
      ? {
          id: `org_${spec.organisationRef.toLowerCase().replace(/-/g, "_")}`,
          ref: spec.organisationRef,
          name: spec.organisationName,
          matchReason: spec.matchReason ?? "FUZZY_NAME",
        }
      : null,
  assignedTo: spec.assignedTo ? actorFor(spec.assignedTo) : null,
  body: spec.body,
  ...(spec.suggestion
    ? {
        suggestedAction: {
          type: "OPPORTUNITY_CONVERT" as const,
          autonomy: "ACT_WITH_APPROVAL" as const,
          summary: spec.suggestion.summary,
          payload: {
            value: spec.suggestion.value,
            questionnaireTemplateId: TEMPLATE_TNA,
            programmeId: spec.suggestion.programmeId,
          },
          provenance: {
            origin: "AI_SUGGESTED" as const,
            confidence: spec.suggestion.confidence,
            agentId: AGENT_LEAD,
            runId: RUN_CLASSIFY,
          },
        },
      }
    : {}),
  extraction: {
    topic: { value: spec.topic, provenance: classified(spec.confidence) },
    audience: { value: spec.audience, provenance: classified(spec.confidence) },
    timing: { value: spec.timing, provenance: classified(spec.confidence) },
    budget: { value: null, provenance: classified(0.9) },
  },
  related: [],
});

/** §4 the enquiry that starts the demo, written out with every §4 field. */
const auroraEnquiry: EnquiryDetail = {
  ...entity(ENQUIRY_AURORA, "2026-09-11T08:52:04+08:00", "2026-09-11T09:05:31+08:00", SYSTEM_ACTOR),
  channel: "EMAIL",
  status: "CONVERTED",
  receivedAt: "2026-09-11T08:52:04+08:00",
  from: { name: "Nurul Hassan", email: "nurul.hassan@auroramfg.com.my", phone: null },
  subject: "Leadership training for 30 managers",
  preview: "Hi, we're looking for leadership training for approximately 30 managers…",
  classification: { label: "LEADERSHIP", provenance: classified(0.94) },
  estimatedValue: myr(1850000),
  matchedOrganisation: {
    id: "org_aurora",
    ref: ORG_AURORA,
    name: "Aurora Manufacturing Sdn Bhd",
    matchReason: "EXACT_DOMAIN",
  },
  assignedTo: actorFor(USER_AMIRAH),
  body: "Hi, we're looking for leadership training for approximately 30 managers, preferably in November, focused on conflict management and communication.",
  extraction: {
    topic: {
      value: "Conflict & communication",
      provenance: {
        origin: "AI_GENERATED",
        confidence: 0.94,
        agentId: AGENT_LEAD,
        runId: RUN_CLASSIFY,
        sources: [
          {
            type: "EMAIL",
            ref: ENQUIRY_AURORA,
            excerpt: "conflict management and communication",
          },
        ],
      },
    },
    audience: {
      value: "30 line managers",
      provenance: { origin: "AI_GENERATED", confidence: 0.94, agentId: AGENT_LEAD, runId: RUN_CLASSIFY },
    },
    timing: {
      value: "2026-11",
      provenance: {
        origin: "AI_SUGGESTED",
        confidence: 0.88,
        agentId: AGENT_LEAD,
        runId: RUN_CLASSIFY,
        editedBy: { id: USER_AMIRAH, name: "Amirah Yusof", at: "2026-09-11T09:03:00+08:00" },
      },
    },
    /** The confident null: the model is sure no budget is stated, not unsure of a value. */
    budget: {
      value: null,
      provenance: { origin: "AI_GENERATED", confidence: 0.97, agentId: AGENT_LEAD, runId: RUN_CLASSIFY },
    },
  },
  suggestedAction: {
    type: "OPPORTUNITY_CONVERT",
    autonomy: "ACT_WITH_APPROVAL",
    summary: "Convert to OPP-0512 at RM 18,500, attach TNA-0042, shortlist PRG-0031",
    payload: {
      value: myr(1850000),
      questionnaireTemplateId: TEMPLATE_TNA,
      programmeId: PROGRAMME_LEADING_CHANGE,
    },
    provenance: { origin: "AI_SUGGESTED", confidence: 0.91, agentId: AGENT_LEAD, runId: RUN_CLASSIFY },
  },
  related: [
    { type: "ORGANISATION", ref: ORG_AURORA, label: "4 engagements" },
    { type: "CONTACT", ref: CONTACT_NURUL, label: "HR Manager · consented" },
    { type: "INVOICE", ref: INVOICE_OVERDUE, label: "overdue 34 days", severity: "ALERT" },
  ],
};

/**
 * §4 `GET /v1/enquiries` — 18 rows, matching the `page.total` the contract's
 * own example returns.
 *
 * Two states the inbox must render: `ENQ-2026-0931` is the 0.41-confidence
 * WhatsApp row with `needsHumanReview: true`, and `ENQ-2026-0918` is the
 * auto-archived non-enquiry.
 */
export const enquiries: EnquiryDetail[] = [
  auroraEnquiry,
  buildEnquiry({
    ref: "ENQ-2026-0931",
    channel: "WHATSAPP",
    status: "OPEN",
    receivedAt: "2026-11-13T17:41:00+08:00",
    fromName: "+60 12-778 3410",
    email: null,
    phone: "+60127783410",
    subject: "training?",
    preview: "hi do you all do the safety one ah",
    body: "hi do you all do the safety one ah",
    label: "UNCLEAR",
    confidence: 0.41,
    needsHumanReview: true,
    estimatedValue: null,
    topic: null,
    audience: null,
    timing: null,
  }),
  buildEnquiry({
    ref: "ENQ-2026-0918",
    channel: "EMAIL",
    status: "ARCHIVED",
    receivedAt: "2026-11-12T07:04:00+08:00",
    fromName: "Conference Alerts",
    email: "noreply@conferencealerts.example",
    phone: null,
    subject: "Your invitation: ASEAN L&D Summit 2027",
    preview: "Register now for early-bird rates on the region's largest L&D gathering…",
    body: "Register now for early-bird rates on the region's largest L&D gathering. Group discounts available.",
    label: "NOT_AN_ENQUIRY",
    confidence: 0.96,
    estimatedValue: null,
    topic: null,
    audience: null,
    timing: null,
  }),
  buildEnquiry({
    ref: "ENQ-2026-0929",
    channel: "EMAIL",
    status: "ASSIGNED",
    receivedAt: "2026-11-13T09:12:00+08:00",
    fromName: "Lim Wei Sheng",
    email: "weisheng.lim@kenangaretail.com.my",
    phone: null,
    subject: "Sales excellence programme for store managers",
    preview: "We would like to run a sales excellence programme for 48 store managers in Q1…",
    body: "We would like to run a sales excellence programme for 48 store managers in Q1 2027, across Klang Valley and Johor.",
    label: "SALES_EXCELLENCE",
    confidence: 0.92,
    estimatedValue: myr(6720000),
    organisationRef: ORG_KENANGA,
    organisationName: "Kenanga Retail Group Berhad",
    matchReason: "EXACT_DOMAIN",
    assignedTo: USER_AMIRAH,
    topic: "Sales excellence",
    audience: "48 store managers",
    timing: "2027-01",
    suggestion: {
      programmeId: PROGRAMME_SALES_EXCELLENCE,
      value: myr(6720000),
      summary: "Convert to an opportunity at RM 67,200, attach a TNA, shortlist PRG-0009",
      confidence: 0.88,
    },
  }),
  buildEnquiry({
    ref: "ENQ-2026-0927",
    channel: "WEB_FORM",
    status: "ASSIGNED",
    receivedAt: "2026-11-12T15:33:00+08:00",
    fromName: "Faridah Omar",
    email: "faridah.omar@meridianlog.com.my",
    phone: "+60127788330",
    subject: "Data literacy refresher",
    preview: "Following last year's cohort, we want a refresher for the planning team…",
    body: "Following last year's cohort, we want a refresher for the planning team — about 22 people, ideally December.",
    label: "DATA_LITERACY",
    confidence: 0.88,
    estimatedValue: myr(4200000),
    organisationRef: ORG_MERIDIAN,
    organisationName: "Meridian Logistics Sdn Bhd",
    matchReason: "EXACT_DOMAIN",
    assignedTo: USER_AMIRAH,
    topic: "Data literacy",
    audience: "22 planners",
    timing: "2026-12",
    suggestion: {
      programmeId: PROGRAMME_DATA_LITERACY,
      value: myr(4200000),
      summary: "Convert to an opportunity at RM 42,000, attach a TNA, shortlist PRG-0044",
      confidence: 0.85,
    },
  }),
  buildEnquiry({
    ref: "ENQ-2026-0925",
    channel: "PHONE",
    status: "OPEN",
    receivedAt: "2026-11-12T11:02:00+08:00",
    fromName: "Ganesh Pillai",
    email: "ganesh.pillai@perdanautilities.com.my",
    phone: "+60133322990",
    subject: "Safety leadership — substation teams",
    preview: "Called to ask about safety leadership for substation supervisors…",
    body: "Called to ask about safety leadership for substation supervisors. Around 35 people, wants HRD Corp claimable.",
    label: "SAFETY",
    confidence: 0.86,
    estimatedValue: myr(2730000),
    organisationRef: ORG_PERDANA_UTILITIES,
    organisationName: "Perdana Utilities Berhad",
    matchReason: "MANUAL",
    topic: "Safety leadership",
    audience: "35 supervisors",
    timing: "2027-02",
    suggestion: {
      programmeId: PROGRAMME_SAFETY,
      value: myr(2730000),
      summary: "Convert to an opportunity at RM 27,300, attach a TNA, shortlist PRG-0022",
      confidence: 0.79,
    },
  }),
  buildEnquiry({
    ref: "ENQ-2026-0923",
    channel: "EMAIL",
    status: "OPEN",
    receivedAt: "2026-11-11T16:20:00+08:00",
    fromName: "Suresh Kumaran",
    email: "suresh@suterahospitality.com",
    phone: null,
    subject: "Re-opening conversation on service recovery",
    preview: "We paused last year but would like to revisit service recovery training…",
    body: "We paused last year but would like to revisit service recovery training for front office, maybe 18 people.",
    label: "SERVICE",
    confidence: 0.79,
    estimatedValue: myr(980000),
    organisationRef: ORG_SUTERA,
    organisationName: "Sutera Hospitality Group",
    matchReason: "FUZZY_NAME",
    topic: "Service recovery",
    audience: "18 front office",
    timing: null,
  }),
  buildEnquiry({
    ref: "ENQ-2026-0921",
    channel: "WHATSAPP",
    status: "OPEN",
    receivedAt: "2026-11-11T10:05:00+08:00",
    fromName: "+60 19-220 8871",
    email: null,
    phone: "+60192208871",
    subject: "Quotation request",
    preview: "Good morning, can I get a quote for a 1-day communication workshop…",
    body: "Good morning, can I get a quote for a 1-day communication workshop for 25 staff in Penang?",
    label: "COMMUNICATION",
    confidence: 0.83,
    estimatedValue: myr(890000),
    topic: "Communication",
    audience: "25 staff",
    timing: null,
  }),
  buildEnquiry({
    ref: "ENQ-2026-0919",
    channel: "EMAIL",
    status: "ASSIGNED",
    receivedAt: "2026-11-10T14:48:00+08:00",
    fromName: "Procurement — Nusantara Foods",
    email: "procurement@nusantarafoods.example",
    phone: null,
    subject: "RFQ: supervisory skills, 2 cohorts",
    preview: "Please find attached our RFQ for supervisory skills training, two cohorts…",
    body: "Please find attached our RFQ for supervisory skills training, two cohorts of 25, delivery by March 2027.",
    label: "SUPERVISORY",
    confidence: 0.9,
    estimatedValue: myr(3600000),
    assignedTo: USER_AMIRAH,
    topic: "Supervisory skills",
    audience: "2 cohorts of 25",
    timing: "2027-03",
  }),
  buildEnquiry({
    ref: "ENQ-2026-0917",
    channel: "WEB_FORM",
    status: "OPEN",
    receivedAt: "2026-11-10T09:31:00+08:00",
    fromName: "Adeline Chong",
    email: "adeline.chong@brightpath.example",
    phone: null,
    subject: "Coaching for new team leads",
    preview: "We have 12 newly promoted team leads and no structured coaching…",
    body: "We have 12 newly promoted team leads and no structured coaching. What do you recommend?",
    label: "COACHING",
    confidence: 0.81,
    estimatedValue: myr(1200000),
    topic: "Coaching",
    audience: "12 team leads",
    timing: null,
  }),
  buildEnquiry({
    ref: "ENQ-2026-0915",
    channel: "EMAIL",
    status: "NOT_AN_ENQUIRY",
    receivedAt: "2026-11-09T18:02:00+08:00",
    fromName: "Zul from PrintWorks",
    email: "sales@printworks.example",
    phone: null,
    subject: "Corporate gifts and lanyards",
    preview: "We supply lanyards, notebooks and corporate gifts at wholesale rates…",
    body: "We supply lanyards, notebooks and corporate gifts at wholesale rates. Can we be your vendor?",
    label: "VENDOR_PITCH",
    confidence: 0.94,
    estimatedValue: null,
    topic: null,
    audience: null,
    timing: null,
  }),
  buildEnquiry({
    ref: "ENQ-2026-0913",
    channel: "EMAIL",
    status: "OPEN",
    receivedAt: "2026-11-09T11:14:00+08:00",
    fromName: "Hasnah Ibrahim",
    email: "hasnah@tenagaklang.example",
    phone: null,
    subject: "Change management for engineering",
    preview: "Our engineering division is restructuring and needs change management support…",
    body: "Our engineering division is restructuring and needs change management support for about 40 engineers.",
    label: "LEADERSHIP",
    confidence: 0.87,
    estimatedValue: myr(2450000),
    topic: "Change management",
    audience: "40 engineers",
    timing: "2027-01",
  }),
  buildEnquiry({
    ref: "ENQ-2026-0911",
    channel: "PHONE",
    status: "ASSIGNED",
    receivedAt: "2026-11-08T15:55:00+08:00",
    fromName: "Rahim Yaakob",
    email: null,
    phone: "+60195512004",
    subject: "Follow-up on last year's proposal",
    preview: "Asked whether the 2025 proposal pricing still stands for a January intake…",
    body: "Asked whether the 2025 proposal pricing still stands for a January intake.",
    label: "PRICING_QUERY",
    confidence: 0.72,
    estimatedValue: null,
    assignedTo: USER_AMIRAH,
    topic: "Pricing query",
    audience: null,
    timing: "2027-01",
  }),
  buildEnquiry({
    ref: "ENQ-2026-0909",
    channel: "WHATSAPP",
    status: "OPEN",
    receivedAt: "2026-11-08T08:22:00+08:00",
    fromName: "+60 13-901 5566",
    email: null,
    phone: "+60139015566",
    subject: "HRDC claimable?",
    preview: "Is your leadership programme claimable under SBL-Khas?",
    body: "Is your leadership programme claimable under SBL-Khas?",
    label: "HRDC_QUERY",
    confidence: 0.89,
    estimatedValue: null,
    topic: "HRD Corp eligibility",
    audience: null,
    timing: null,
  }),
  buildEnquiry({
    ref: "ENQ-2026-0907",
    channel: "EMAIL",
    status: "CONVERTED",
    receivedAt: "2026-11-06T10:40:00+08:00",
    fromName: "Faridah Omar",
    email: "faridah.omar@meridianlog.com.my",
    phone: null,
    subject: "Confirming the December cohort",
    preview: "Confirming we want to proceed with the December cohort as discussed…",
    body: "Confirming we want to proceed with the December cohort as discussed.",
    label: "DATA_LITERACY",
    confidence: 0.93,
    estimatedValue: myr(4200000),
    organisationRef: ORG_MERIDIAN,
    organisationName: "Meridian Logistics Sdn Bhd",
    matchReason: "EXACT_DOMAIN",
    assignedTo: USER_AMIRAH,
    topic: "Data literacy",
    audience: "22 planners",
    timing: "2026-12",
  }),
  buildEnquiry({
    ref: "ENQ-2026-0905",
    channel: "WEB_FORM",
    status: "OPEN",
    receivedAt: "2026-11-05T13:18:00+08:00",
    fromName: "Tan Mei Ling",
    email: "meiling.tan@sinarcapital.example",
    phone: null,
    subject: "Presentation skills, mid-level",
    preview: "Looking for a half-day presentation skills session for 30 analysts…",
    body: "Looking for a half-day presentation skills session for 30 analysts, ideally on site.",
    label: "COMMUNICATION",
    confidence: 0.85,
    estimatedValue: myr(760000),
    topic: "Presentation skills",
    audience: "30 analysts",
    timing: "2026-12",
  }),
  buildEnquiry({
    ref: "ENQ-2026-0903",
    channel: "EMAIL",
    status: "ARCHIVED",
    receivedAt: "2026-11-04T09:02:00+08:00",
    fromName: "Careers Portal",
    email: "careers@jobstack.example",
    phone: null,
    subject: "Trainer application — Ismail bin Othman",
    preview: "A candidate has applied to your trainer pool listing…",
    body: "A candidate has applied to your trainer pool listing. Review the application in the portal.",
    label: "NOT_AN_ENQUIRY",
    confidence: 0.95,
    estimatedValue: null,
    topic: null,
    audience: null,
    timing: null,
  }),
  buildEnquiry({
    ref: "ENQ-2026-0901",
    channel: "EMAIL",
    status: "OPEN",
    receivedAt: "2026-11-03T16:45:00+08:00",
    fromName: "Yusof Karim",
    email: "yusof.karim@bandarhealth.example",
    phone: null,
    subject: "Conflict management for clinical leads",
    preview: "Our clinical leads need conflict management; about 20 people, flexible dates…",
    body: "Our clinical leads need conflict management; about 20 people, flexible dates in the first half of 2027.",
    label: "LEADERSHIP",
    confidence: 0.9,
    estimatedValue: myr(1450000),
    topic: "Conflict management",
    audience: "20 clinical leads",
    timing: "2027-H1",
  }),
];

/**
 * §4 `GET /v1/follow-ups` — nine rows, matching the contract's `total: 9`.
 *
 * FUP-0311 is the one with a draft; FUP-0304 and FUP-0307 are the two overdue
 * rows M03-S06 renders in danger.
 */
export const followUps: FollowUp[] = [
  {
    id: "fup_0311",
    ref: FOLLOW_UP_AURORA,
    contact: { ref: CONTACT_NURUL, name: "Nurul Hassan" },
    organisation: { ref: ORG_AURORA, name: "Aurora Manufacturing Sdn Bhd" },
    reason: `${PROPOSAL_AURORA} sent 11 Sep · not opened since 13 Sep`,
    dueDate: "2026-09-16",
    status: "DUE",
    autonomy: "SUGGEST",
  },
  {
    id: "fup_0304",
    ref: FOLLOW_UP_KENANGA,
    contact: { ref: CONTACT_WEI_SHENG, name: "Lim Wei Sheng" },
    organisation: { ref: ORG_KENANGA, name: "Kenanga Retail Group Berhad" },
    reason: "Discovery call requested 28 Oct · no reply to two emails",
    dueDate: "2026-11-10",
    status: "OVERDUE",
    autonomy: "SUGGEST",
  },
  {
    id: "fup_0307",
    ref: FOLLOW_UP_MERIDIAN,
    contact: { ref: CONTACT_FARIDAH, name: "Faridah Omar" },
    organisation: { ref: ORG_MERIDIAN, name: "Meridian Logistics Sdn Bhd" },
    reason: "Proposal viewed 06 Nov · decision promised by 11 Nov",
    dueDate: "2026-11-11",
    status: "OVERDUE",
    autonomy: "SUGGEST",
  },
  {
    id: "fup_0309",
    ref: FOLLOW_UP_PERDANA,
    contact: { ref: CONTACT_GANESH, name: "Ganesh Pillai" },
    organisation: { ref: ORG_PERDANA_UTILITIES, name: "Perdana Utilities Berhad" },
    reason: "Negotiation stalled on start date · last contact 02 Nov",
    dueDate: "2026-11-14",
    status: "DUE",
    autonomy: "SUGGEST",
  },
  {
    id: "fup_0312",
    ref: FOLLOW_UP_SUTERA,
    contact: { ref: CONTACT_SURESH, name: "Suresh Kumaran" },
    organisation: { ref: ORG_SUTERA, name: "Sutera Hospitality Group" },
    reason: "Re-opened conversation 11 Nov · send catalogue",
    dueDate: "2026-11-14",
    status: "DUE",
    autonomy: "SUGGEST",
  },
  {
    id: "fup_0314",
    ref: FOLLOW_UP_AURORA_RAVI,
    contact: { ref: "CON-0241", name: "Ravi Subramaniam" },
    organisation: { ref: ORG_AURORA, name: "Aurora Manufacturing Sdn Bhd" },
    reason: "Named on the delivery brief · no PDPA consent recorded",
    dueDate: "2026-11-18",
    status: "DUE",
    autonomy: "OBSERVE",
  },
  {
    id: "fup_0316",
    ref: FOLLOW_UP_KENANGA_2,
    contact: { ref: CONTACT_WEI_SHENG, name: "Lim Wei Sheng" },
    organisation: { ref: ORG_KENANGA, name: "Kenanga Retail Group Berhad" },
    reason: "Levy statement requested · chase before year end",
    dueDate: "2026-11-21",
    status: "DUE",
    autonomy: "SUGGEST",
  },
  {
    id: "fup_0318",
    ref: FOLLOW_UP_MERIDIAN_2,
    contact: { ref: CONTACT_FARIDAH, name: "Faridah Omar" },
    organisation: { ref: ORG_MERIDIAN, name: "Meridian Logistics Sdn Bhd" },
    reason: "December cohort confirmed 06 Nov · send joining instructions",
    dueDate: "2026-11-25",
    status: "SENT",
    autonomy: "SUGGEST",
  },
  {
    id: "fup_0320",
    ref: FOLLOW_UP_PERDANA_2,
    contact: { ref: CONTACT_GANESH, name: "Ganesh Pillai" },
    organisation: { ref: ORG_PERDANA_UTILITIES, name: "Perdana Utilities Berhad" },
    reason: "Safety brief shared 02 Nov · no response needed yet",
    dueDate: "2026-12-02",
    status: "DISMISSED",
    autonomy: "OBSERVE",
  },
];

/**
 * §4 `GET /v1/follow-ups/{id}/draft?channel=` — keyed `ref::CHANNEL`.
 *
 * Rates are server-side facts: RM 0.0564 utility, RM 0.3467 marketing,
 * rounded to the sen at estimate time with the exact rate returned as a string.
 */
export const followUpDrafts: Record<string, MessageDraft> = {
  [`${FOLLOW_UP_AURORA}::WHATSAPP`]: {
    channel: "WHATSAPP",
    templateId: TEMPLATE_FOLLOWUP_WHATSAPP,
    category: "UTILITY",
    body: "Hi Puan Nurul, following up on the leadership proposal we sent on 11 September…",
    recipients: 1,
    ratePerMessage: myr(6),
    ratePerMessageExact: "0.0564",
    estimatedCost: myr(6),
    alternativeCategoryRate: {
      category: "MARKETING",
      ratePerMessage: myr(35),
      /** §4: the exact marketing rate, so the comparison line does not round to RM 0.35. */
      ratePerMessageExact: "0.3467",
    },
    consent: { channel: "WHATSAPP", granted: true, recordedAt: "2024-03-04T10:12:00+08:00" },
    provenance: {
      origin: "AI_SUGGESTED",
      confidence: 0.82,
      agentId: AGENT_FOLLOWUP,
      runId: RUN_FOLLOWUP,
      tier: "MID",
      model: "DeepSeek V4 Pro",
      provider: "DEEPSEEK",
      cacheHitRate: 0.66,
      generatedAt: "2026-09-16T08:02:00+08:00",
    },
  },
  [`${FOLLOW_UP_AURORA}::EMAIL`]: {
    channel: "EMAIL",
    templateId: "tpl_email_followup_v4",
    category: "UTILITY",
    body: "Dear Puan Nurul,\n\nFollowing up on the leadership proposal we sent on 11 September…",
    recipients: 1,
    ratePerMessage: myr(0),
    estimatedCost: myr(0),
    consent: { channel: "EMAIL", granted: true, recordedAt: "2024-03-04T10:12:00+08:00" },
    provenance: {
      origin: "AI_SUGGESTED",
      confidence: 0.84,
      agentId: AGENT_FOLLOWUP,
      runId: RUN_FOLLOWUP,
      generatedAt: "2026-09-16T08:02:00+08:00",
    },
  },
  [`${FOLLOW_UP_KENANGA}::EMAIL`]: {
    channel: "EMAIL",
    templateId: "tpl_email_followup_v4",
    category: "UTILITY",
    body: "Dear Wei Sheng,\n\nChecking in on the discovery call we discussed on 28 October…",
    recipients: 1,
    ratePerMessage: myr(0),
    estimatedCost: myr(0),
    consent: { channel: "EMAIL", granted: true, recordedAt: "2023-07-11T09:20:00+08:00" },
    provenance: {
      origin: "AI_SUGGESTED",
      confidence: 0.78,
      agentId: AGENT_FOLLOWUP,
      runId: RUN_FOLLOWUP,
      generatedAt: "2026-11-14T07:40:00+08:00",
    },
  },
  [`${FOLLOW_UP_AURORA_RAVI}::WHATSAPP`]: {
    channel: "WHATSAPP",
    templateId: TEMPLATE_FOLLOWUP_WHATSAPP,
    category: "UTILITY",
    body: "Hi Encik Ravi, a quick note about the delivery brief…",
    recipients: 1,
    ratePerMessage: myr(6),
    ratePerMessageExact: "0.0564",
    estimatedCost: myr(6),
    alternativeCategoryRate: {
      category: "MARKETING",
      ratePerMessage: myr(35),
      /** §4: the exact marketing rate, so the comparison line does not round to RM 0.35. */
      ratePerMessageExact: "0.3467",
    },
    /** The PDPA block the queue must render before anything can be sent. */
    consent: { channel: "WHATSAPP", granted: false, recordedAt: null },
    provenance: {
      origin: "AI_SUGGESTED",
      confidence: 0.69,
      agentId: AGENT_FOLLOWUP,
      runId: RUN_FOLLOWUP,
      generatedAt: "2026-11-14T07:40:00+08:00",
    },
  },
};

/** §4 `GET /v1/contacts/{id}/consent` — the PDPA check M03-S06 runs before a send. */
export const contactConsents: Record<string, ChannelConsent[]> = {
  [CONTACT_NURUL]: [
    { channel: "EMAIL", granted: true, recordedAt: "2024-03-04T10:12:00+08:00" },
    { channel: "WHATSAPP", granted: true, recordedAt: "2024-03-04T10:12:00+08:00" },
  ],
  "CON-0241": [
    { channel: "EMAIL", granted: false, recordedAt: null },
    { channel: "WHATSAPP", granted: false, recordedAt: null },
  ],
  [CONTACT_WEI_SHENG]: [
    { channel: "EMAIL", granted: true, recordedAt: "2023-07-11T09:20:00+08:00" },
    { channel: "WHATSAPP", granted: false, recordedAt: null },
  ],
  [CONTACT_FARIDAH]: [
    { channel: "EMAIL", granted: true, recordedAt: "2024-11-02T09:30:00+08:00" },
    { channel: "WHATSAPP", granted: true, recordedAt: "2024-11-02T09:30:00+08:00" },
  ],
  [CONTACT_SURESH]: [
    { channel: "EMAIL", granted: true, recordedAt: "2022-05-18T09:40:00+08:00" },
    { channel: "WHATSAPP", granted: false, recordedAt: null },
  ],
  [CONTACT_GANESH]: [
    { channel: "EMAIL", granted: true, recordedAt: "2026-05-21T09:15:00+08:00" },
    { channel: "WHATSAPP", granted: true, recordedAt: "2026-05-21T09:15:00+08:00" },
  ],
};

/** The §4 list projection: the inbox row, without the detail-only fields. */
export const toEnquiryRow = (detail: EnquiryDetail): Enquiry => {
  const { body: _body, extraction: _extraction, suggestedAction: _suggested, related: _related, ...row } = detail;
  return row;
};
