/**
 * §5 · Organisations, contacts, opportunities.
 *
 * Aurora Manufacturing is the story; the other five organisations exist
 * because the design pack's tables, pickers and pipeline charts render them
 * (design-pack §6.1), and a list with one row is not a list.
 */

import type {
  Contact,
  ContactSummary,
  Opportunity,
  Organisation,
  OrganisationRelations,
  OrganisationSuggestion,
} from "@trainos/contract";
import {
  AGENT_KNOWLEDGE,
  CONTACT_NURUL,
  CONTACT_RAVI,
  ENGAGEMENT_AURORA,
  ENGAGEMENT_AURORA_IN_FLIGHT,
  ENGAGEMENT_BLOCKED,
  ENQUIRY_AURORA,
  HRDC_EMPLOYER_CODE,
  INVOICE_AURORA,
  INVOICE_OVERDUE,
  OPPORTUNITY_AURORA,
  ORG_AURORA,
  PROGRAMME_CONFLICT,
  USER_AMIRAH,
} from "@trainos/contract";
import { actorFor } from "./tenant";
import { entity, myr } from "./_helpers";

/** Refs the design pack names but leaves unnumbered. */
export const ORG_AURORA_PRECISION = "ORG-0115";
export const ORG_KENANGA = "ORG-0121";
export const ORG_MERIDIAN = "ORG-0128";
export const ORG_SUTERA = "ORG-0133";
export const ORG_PERDANA_UTILITIES = "ORG-0140";

export const CONTACT_WEI_SHENG = "CON-0250";
export const CONTACT_FARIDAH = "CON-0255";
export const CONTACT_SURESH = "CON-0264";
export const CONTACT_GANESH = "CON-0271";

export const OPPORTUNITY_KENANGA = "OPP-0498";
export const OPPORTUNITY_MERIDIAN = "OPP-0505";
export const OPPORTUNITY_SUTERA = "OPP-0470";
export const OPPORTUNITY_PERDANA = "OPP-0521";

/** §5 `GET /v1/organisations/{id}` — six organisations, Aurora first. */
export const organisations: Organisation[] = [
  {
    id: "org_aurora",
    ref: ORG_AURORA,
    name: "Aurora Manufacturing Sdn Bhd",
    industry: "MANUFACTURING",
    location: "Shah Alam",
    owner: actorFor(USER_AMIRAH),
    status: "ACTIVE_CLIENT",
    hrdcRegistered: true,
    hrdcEmployerCode: HRDC_EMPLOYER_CODE,
    metrics: {
      lifetimeValue: {
        value: myr(21430000),
        drillTo: `/v1/invoices?filter[organisationRef][eq]=${ORG_AURORA}&filter[status][eq]=PAID`,
      },
      openPipeline: {
        value: myr(1850000),
        secondary: "1 opportunity",
        drillTo: `/v1/opportunities?filter[organisationRef][eq]=${ORG_AURORA}&filter[stage][in]=QUALIFYING,PROPOSAL_SENT`,
      },
      arOverdue: {
        value: myr(1240000),
        secondary: "34 days",
        delta: { rate: 0.18, direction: "UP", severity: "WARN", comparedTo: "2026-10" },
        drillTo: `/v1/receivables?filter[organisationRef][eq]=${ORG_AURORA}`,
      },
      hrdcLevyAvailable: {
        value: myr(6100000),
        secondary: "expires 31 Dec 2026",
        drillTo: `/v1/hrdc/packets?filter[organisationRef][eq]=${ORG_AURORA}`,
      },
      healthScore: { value: 74, secondary: "of 100", drillTo: `/v1/metrics/HEALTH_SCORE?scope=ORGANISATION&id=${ORG_AURORA}` },
    },
    createdAt: "2024-03-04T09:00:00+08:00",
    updatedAt: "2026-11-14T10:04:00+08:00",
  },
  {
    id: "org_aurora_precision",
    ref: ORG_AURORA_PRECISION,
    name: "Aurora Precision Tooling Sdn Bhd",
    industry: "MANUFACTURING",
    location: "Klang",
    owner: actorFor(USER_AMIRAH),
    status: "PROSPECT",
    hrdcRegistered: true,
    hrdcEmployerCode: "HRDC-2204-1190",
    metrics: {
      lifetimeValue: { value: myr(0), drillTo: `/v1/invoices?filter[organisationRef][eq]=${ORG_AURORA_PRECISION}` },
      openPipeline: { value: myr(0), drillTo: `/v1/opportunities?filter[organisationRef][eq]=${ORG_AURORA_PRECISION}` },
      arOverdue: { value: myr(0), drillTo: `/v1/receivables?filter[organisationRef][eq]=${ORG_AURORA_PRECISION}` },
      hrdcLevyAvailable: { value: myr(1850000), drillTo: `/v1/hrdc/packets?filter[organisationRef][eq]=${ORG_AURORA_PRECISION}` },
      healthScore: { value: 50, secondary: "of 100" },
    },
    createdAt: "2026-08-19T11:20:00+08:00",
    updatedAt: "2026-08-19T11:20:00+08:00",
  },
  {
    id: "org_kenanga",
    ref: ORG_KENANGA,
    name: "Kenanga Retail Group Berhad",
    industry: "RETAIL",
    location: "Kuala Lumpur",
    owner: actorFor(USER_AMIRAH),
    status: "ACTIVE_CLIENT",
    hrdcRegistered: true,
    hrdcEmployerCode: "HRDC-1908-4417",
    metrics: {
      lifetimeValue: { value: myr(9840000), drillTo: `/v1/invoices?filter[organisationRef][eq]=${ORG_KENANGA}` },
      openPipeline: { value: myr(6720000), secondary: "1 opportunity", drillTo: `/v1/opportunities?filter[organisationRef][eq]=${ORG_KENANGA}` },
      arOverdue: { value: myr(0), drillTo: `/v1/receivables?filter[organisationRef][eq]=${ORG_KENANGA}` },
      hrdcLevyAvailable: { value: myr(12400000), drillTo: `/v1/hrdc/packets?filter[organisationRef][eq]=${ORG_KENANGA}` },
      healthScore: { value: 81, secondary: "of 100" },
    },
    createdAt: "2023-07-11T09:00:00+08:00",
    updatedAt: "2026-11-06T16:12:00+08:00",
  },
  {
    id: "org_meridian",
    ref: ORG_MERIDIAN,
    name: "Meridian Logistics Sdn Bhd",
    industry: "LOGISTICS",
    location: "Port Klang",
    owner: actorFor(USER_AMIRAH),
    status: "ACTIVE_CLIENT",
    hrdcRegistered: true,
    hrdcEmployerCode: "HRDC-2102-6620",
    metrics: {
      lifetimeValue: { value: myr(7320000), drillTo: `/v1/invoices?filter[organisationRef][eq]=${ORG_MERIDIAN}` },
      openPipeline: { value: myr(4200000), secondary: "1 opportunity", drillTo: `/v1/opportunities?filter[organisationRef][eq]=${ORG_MERIDIAN}` },
      arOverdue: { value: myr(0), drillTo: `/v1/receivables?filter[organisationRef][eq]=${ORG_MERIDIAN}` },
      hrdcLevyAvailable: { value: myr(3900000), drillTo: `/v1/hrdc/packets?filter[organisationRef][eq]=${ORG_MERIDIAN}` },
      healthScore: { value: 62, secondary: "of 100" },
    },
    createdAt: "2024-11-02T09:00:00+08:00",
    updatedAt: "2026-11-10T09:40:00+08:00",
  },
  {
    id: "org_sutera",
    ref: ORG_SUTERA,
    name: "Sutera Hospitality Group",
    industry: "HOSPITALITY",
    location: "Kuala Lumpur",
    owner: actorFor(USER_AMIRAH),
    status: "DORMANT",
    hrdcRegistered: true,
    hrdcEmployerCode: "HRDC-2007-3312",
    metrics: {
      lifetimeValue: { value: myr(2940000), drillTo: `/v1/invoices?filter[organisationRef][eq]=${ORG_SUTERA}` },
      openPipeline: { value: myr(0), drillTo: `/v1/opportunities?filter[organisationRef][eq]=${ORG_SUTERA}` },
      arOverdue: { value: myr(0), drillTo: `/v1/receivables?filter[organisationRef][eq]=${ORG_SUTERA}` },
      hrdcLevyAvailable: { value: myr(880000), drillTo: `/v1/hrdc/packets?filter[organisationRef][eq]=${ORG_SUTERA}` },
      healthScore: { value: 38, secondary: "of 100" },
    },
    createdAt: "2022-05-18T09:00:00+08:00",
    updatedAt: "2026-06-30T15:00:00+08:00",
  },
  {
    id: "org_perdana_utilities",
    ref: ORG_PERDANA_UTILITIES,
    name: "Perdana Utilities Berhad",
    industry: "UTILITIES",
    location: "Cyberjaya",
    owner: actorFor(USER_AMIRAH),
    status: "PROSPECT",
    hrdcRegistered: true,
    hrdcEmployerCode: "HRDC-1806-9021",
    metrics: {
      lifetimeValue: { value: myr(0), drillTo: `/v1/invoices?filter[organisationRef][eq]=${ORG_PERDANA_UTILITIES}` },
      openPipeline: { value: myr(2730000), secondary: "1 opportunity", drillTo: `/v1/opportunities?filter[organisationRef][eq]=${ORG_PERDANA_UTILITIES}` },
      arOverdue: { value: myr(0), drillTo: `/v1/receivables?filter[organisationRef][eq]=${ORG_PERDANA_UTILITIES}` },
      hrdcLevyAvailable: { value: myr(21700000), drillTo: `/v1/hrdc/packets?filter[organisationRef][eq]=${ORG_PERDANA_UTILITIES}` },
      healthScore: { value: 55, secondary: "of 100" },
    },
    createdAt: "2026-05-21T09:00:00+08:00",
    updatedAt: "2026-11-02T11:30:00+08:00",
  },
];

/** §5 `GET /v1/contacts` — CON-0233 consented on both channels, CON-0241 on neither. */
export const contacts: Contact[] = [
  {
    ...entity(CONTACT_NURUL, "2024-03-04T09:12:00+08:00", "2026-09-15T10:24:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_AURORA,
    name: "Nurul Hassan",
    role: "HR Manager",
    email: "nurul.hassan@auroramfg.com.my",
    phone: "+60123344551",
    primary: true,
    consent: { email: true, whatsapp: true },
  },
  {
    ...entity(CONTACT_RAVI, "2024-06-18T14:00:00+08:00", "2025-02-11T09:00:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_AURORA,
    name: "Ravi Subramaniam",
    role: "Plant Director",
    email: "ravi.s@auroramfg.com.my",
    phone: null,
    primary: false,
    consent: { email: false, whatsapp: false },
    pdpaFlag: "NO_CONSENT",
  },
  {
    ...entity(CONTACT_WEI_SHENG, "2023-07-11T09:20:00+08:00", "2026-10-28T10:00:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_KENANGA,
    name: "Lim Wei Sheng",
    role: "Head of Learning",
    email: "weisheng.lim@kenangaretail.com.my",
    phone: "+60129900112",
    primary: true,
    consent: { email: true, whatsapp: false },
  },
  {
    ...entity(CONTACT_FARIDAH, "2024-11-02T09:30:00+08:00", "2026-11-10T09:40:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_MERIDIAN,
    name: "Faridah Omar",
    role: "HR Business Partner",
    email: "faridah.omar@meridianlog.com.my",
    phone: "+60127788330",
    primary: true,
    consent: { email: true, whatsapp: true },
  },
  {
    ...entity(CONTACT_SURESH, "2022-05-18T09:40:00+08:00", "2026-06-30T15:00:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_SUTERA,
    name: "Suresh Kumaran",
    role: "General Manager",
    email: "suresh@suterahospitality.com",
    phone: null,
    primary: true,
    consent: { email: true, whatsapp: false },
  },
  {
    ...entity(CONTACT_GANESH, "2026-05-21T09:15:00+08:00", "2026-11-02T11:30:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_PERDANA_UTILITIES,
    name: "Ganesh Pillai",
    role: "Safety & Training Lead",
    email: "ganesh.pillai@perdanautilities.com.my",
    phone: "+60133322990",
    primary: true,
    consent: { email: true, whatsapp: true },
  },
];

/** §5 the relations panel, keyed by organisation ref. */
export const organisationRelations: Record<string, OrganisationRelations> = {
  [ORG_AURORA]: {
    engagements: [
      /*
       * FIRST, because Organisation 360's header stepper walks the most recent
       * engagement and this is the only Aurora deal still moving. Everything
       * below it has delivered or been cancelled, so the header used to draw
       * six identical DONE ticks: no dates, no subline, nothing waiting on
       * anybody. M04-S02 draws dates on the done stages and a stage held by a
       * named person, and a stepper that only ever renders one state proves
       * only that it renders.
       *
       * The chain is the §5 DEAL_CHAIN vocabulary, and it carries all three
       * states the component distinguishes — done with the day it happened,
       * one current stage waiting on a person, and the stages that cannot
       * start until it clears.
       *
       * The APPROVAL note names Kelvin Tan because he is the approver the
       * queue shows on Aurora's pending proposal send. It carries NO `ref`:
       * APV-2026-0771 is that approval, but its target is PRO-2026-0184, whose
       * opportunity is WON and whose engagement has already delivered. Citing
       * it would make one pending approval appear to gate two deals.
       */
      {
        ref: ENGAGEMENT_AURORA_IN_FLIGHT,
        title: "Conflict to Collaboration — Aurora line leaders",
        dates: "2026-12-10/2026-12-11",
        value: myr(1480000),
        lifecycle: [
          { key: "ENQUIRY", state: "DONE", at: "2026-09-08" },
          { key: "TNA", state: "DONE", at: "2026-09-10" },
          { key: "PROPOSAL", state: "DONE", at: "2026-09-12" },
          { key: "APPROVAL", state: "CURRENT", note: "Pending Kelvin Tan" },
          { key: "SENT", state: "PENDING" },
          { key: "DELIVERY", state: "PENDING" },
        ],
      },
      {
        ref: ENGAGEMENT_AURORA,
        title: "Leading Through Change",
        dates: "2026-11-12/2026-11-13",
        value: myr(1850000),
        lifecycle: [
          { key: "ENQUIRY", state: "DONE" },
          { key: "TNA", state: "DONE" },
          { key: "PROPOSAL", state: "DONE" },
          { key: "APPROVAL", state: "DONE" },
          { key: "SENT", state: "DONE" },
          { key: "DELIVERY", state: "DONE" },
        ],
      },
      {
        ref: ENGAGEMENT_BLOCKED,
        title: "Safety Leadership Essentials",
        dates: "2026-08-20/2026-08-21",
        value: myr(1620000),
        lifecycle: [
          { key: "ENQUIRY", state: "DONE" },
          { key: "TNA", state: "SKIPPED", note: "Repeat client" },
          { key: "PROPOSAL", state: "DONE" },
          { key: "APPROVAL", state: "DONE" },
          { key: "SENT", state: "DONE" },
          { key: "DELIVERY", state: "BLOCKED", note: "2 claim documents missing" },
        ],
      },
    ],
    contacts: [
      {
        ref: CONTACT_NURUL,
        name: "Nurul Hassan",
        role: "HR Manager",
        primary: true,
        consent: { email: true, whatsapp: true },
      },
      {
        ref: CONTACT_RAVI,
        name: "Ravi Subramaniam",
        role: "Plant Director",
        consent: { email: false, whatsapp: false },
        pdpaFlag: "NO_CONSENT",
      },
    ],
    invoices: [
      { ref: INVOICE_OVERDUE, status: "OVERDUE", daysOverdue: 34, amount: myr(1240000) },
      { ref: INVOICE_AURORA, status: "SENT", amount: myr(1850000) },
    ],
    hrdc: {
      employerCode: HRDC_EMPLOYER_CODE,
      levyAvailable: myr(6100000),
      packets: [
        { ref: ENGAGEMENT_BLOCKED, state: "BLOCKED", missingDocuments: 2 },
        /**
         * DECISIONS §3 moves the claim window to six months, so this packet is
         * blocked on documents rather than on a three-day deadline.
         */
        { ref: ENGAGEMENT_AURORA, state: "BLOCKED", missingDocuments: 2, daysRemaining: 180 },
      ],
    },
  },
};

/** §5 the cross-sell panel. `agent_knowledge` is paused, so this is its last output. */
export const organisationSuggestions: Record<string, OrganisationSuggestion[]> = {
  [ORG_AURORA]: [
    {
      type: "CROSS_SELL",
      programmeId: PROGRAMME_CONFLICT,
      title: "Conflict to Collaboration",
      rationale:
        "RM 61,000 unused levy expiring 31 Dec; 42 supervisors have not attended any programme; the programme scored 4.6 with their managers.",
      provenance: {
        origin: "AI_SUGGESTED",
        confidence: 0.76,
        agentId: AGENT_KNOWLEDGE,
        tier: "MID",
        model: "DeepSeek V4 Pro",
        provider: "DEEPSEEK",
        cacheHitRate: 0.52,
        generatedAt: "2026-11-08T22:10:00+08:00",
        sources: [
          { type: "HRDC_STATEMENT", ref: HRDC_EMPLOYER_CODE },
          { type: "PARTICIPANT_QUERY", ref: `${ORG_AURORA}/no-attendance` },
        ],
      },
      actions: [
        { type: "OPPORTUNITY_CREATE", label: "Create opportunity" },
        { type: "SUGGESTION_DISMISS", label: "Dismiss" },
      ],
    },
  ],
};

/** §5 `GET /v1/opportunities` — one per active deal in the pack. */
export const opportunities: Opportunity[] = [
  {
    ...entity(OPPORTUNITY_AURORA, "2026-09-11T09:05:31+08:00", "2026-09-15T10:24:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_AURORA,
    stage: "WON",
    value: myr(1850000),
    probability: 1,
    owner: actorFor(USER_AMIRAH),
    sourceEnquiryRef: ENQUIRY_AURORA,
    expectedCloseDate: "2026-09-30",
  },
  {
    ...entity(OPPORTUNITY_KENANGA, "2026-10-28T10:00:00+08:00", "2026-11-06T16:12:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_KENANGA,
    stage: "QUALIFYING",
    value: myr(6720000),
    probability: 0.3,
    owner: actorFor(USER_AMIRAH),
    expectedCloseDate: "2026-12-19",
  },
  {
    ...entity(OPPORTUNITY_MERIDIAN, "2026-10-14T09:00:00+08:00", "2026-11-10T09:40:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_MERIDIAN,
    stage: "PROPOSAL_SENT",
    value: myr(4200000),
    probability: 0.6,
    owner: actorFor(USER_AMIRAH),
    expectedCloseDate: "2026-11-28",
  },
  {
    ...entity(OPPORTUNITY_SUTERA, "2026-05-06T09:00:00+08:00", "2026-06-30T15:00:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_SUTERA,
    stage: "LOST",
    value: myr(980000),
    probability: 0,
    owner: actorFor(USER_AMIRAH),
    expectedCloseDate: "2026-06-30",
  },
  {
    ...entity(OPPORTUNITY_PERDANA, "2026-09-30T09:00:00+08:00", "2026-11-02T11:30:00+08:00", actorFor(USER_AMIRAH)),
    organisationRef: ORG_PERDANA_UTILITIES,
    stage: "NEGOTIATION",
    value: myr(2730000),
    probability: 0.75,
    owner: actorFor(USER_AMIRAH),
    expectedCloseDate: "2026-12-05",
  },
];
