/**
 * §6 · Programmes, trainers and the §18 rate card.
 *
 * Screen M06-S02. Programme prices are the server values the quotation screen
 * validates against — `floorPrice` here is the absolute floor, and
 * `floorMarginRate` is the second, independent floor the client derives from
 * direct cost. See `client/pricing.ts` for how the two combine.
 *
 * `GET /v1/trainers` is in the §13 matrix but the contract publishes no
 * `Trainer` type, so `FixtureTrainer` is defined here and reported as a gap.
 */

import type { DateOnly, Programme, ProgrammeDelivery, RateCard, Ref, Timestamp } from "@trainos/contract";
import {
  PROGRAMME_CONFLICT,
  PROGRAMME_DATA_LITERACY,
  PROGRAMME_LEADING_CHANGE,
  RATE_CARD_PLACEHOLDER_VERSION,
  TRAINER_DANIEL_REF,
  TRAINER_FARAH_REF,
  TTT_FARAH,
  USER_KHAIRUL,
} from "@trainos/contract";
import { actorFor } from "./tenant";
import { entity, myr } from "./_helpers";

/** Programmes the pack names outside the three §6 examples. */
export const PROGRAMME_SAFETY = "PRG-0022";
export const PROGRAMME_SALES_EXCELLENCE = "PRG-0009";

/** Trainers beyond the two §6 names. */
export const TRAINER_LEE_REF = "TRN-0019";
export const TRAINER_NOORA_REF = "TRN-0024";

/**
 * A trainer as the M06-S02 pool table and the §6 availability block render
 * them. Not a contract type — see the README's contract-gaps note.
 */
export interface FixtureTrainer {
  id: string;
  ref: Ref;
  name: string;
  email: string;
  bands: "A" | "B" | "C";
  tttCertified: boolean;
  tttRef: string | null;
  tttValidTo: DateOnly | null;
  /** §17 `CHK_TRAINER_ACCREDITATION` reads this. */
  hrdTdf: boolean;
  rating: number;
  programmeRefs: Ref[];
  /** Dates the trainer is already committed, as `YYYY-MM-DD` day keys. */
  bookedDates: DateOnly[];
  lastDeliveredAt: Timestamp | null;
}

export const trainers: FixtureTrainer[] = [
  {
    id: "trn_farah",
    ref: TRAINER_FARAH_REF,
    name: "Farah Aziz",
    email: "farah.aziz@akademiperdana.my",
    bands: "A",
    tttCertified: true,
    tttRef: TTT_FARAH,
    tttValidTo: "2027-06-30",
    hrdTdf: true,
    rating: 4.7,
    programmeRefs: [PROGRAMME_LEADING_CHANGE, PROGRAMME_CONFLICT],
    bookedDates: ["2026-11-12", "2026-11-13"],
    lastDeliveredAt: "2026-11-13T17:30:00+08:00",
  },
  {
    id: "trn_daniel",
    ref: TRAINER_DANIEL_REF,
    name: "Daniel Wong",
    email: "daniel.wong@akademiperdana.my",
    bands: "A",
    tttCertified: true,
    tttRef: "TTT-2021-8830",
    tttValidTo: "2028-01-31",
    hrdTdf: true,
    rating: 4.4,
    /** Booked across the client's November window — the constraint behind the M02-S02 risk note. */
    programmeRefs: [PROGRAMME_LEADING_CHANGE],
    bookedDates: ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"],
    lastDeliveredAt: "2026-11-11T17:30:00+08:00",
  },
  {
    id: "trn_lee",
    ref: TRAINER_LEE_REF,
    name: "Lee Chin Hoe",
    email: "lee.chinhoe@akademiperdana.my",
    bands: "B",
    tttCertified: true,
    tttRef: "TTT-2022-1174",
    tttValidTo: "2027-11-30",
    hrdTdf: true,
    rating: 4.2,
    programmeRefs: [PROGRAMME_DATA_LITERACY, PROGRAMME_SALES_EXCELLENCE],
    bookedDates: [],
    lastDeliveredAt: "2026-10-22T17:30:00+08:00",
  },
  {
    id: "trn_noora",
    ref: TRAINER_NOORA_REF,
    name: "Noora Idris",
    email: "noora.idris@akademiperdana.my",
    bands: "C",
    tttCertified: false,
    tttRef: null,
    tttValidTo: null,
    /** No HRD Corp accreditation — the negative case for `CHK_TRAINER_ACCREDITATION`. */
    hrdTdf: false,
    rating: 4.0,
    programmeRefs: [PROGRAMME_SAFETY],
    bookedDates: [],
    lastDeliveredAt: "2026-09-04T17:30:00+08:00",
  },
];

/** §6 `GET /v1/programmes` — the catalogue every recommendation and engagement points at. */
export const programmes: Programme[] = [
  {
    ...entity(PROGRAMME_LEADING_CHANGE, "2023-02-14T09:00:00+08:00", "2026-07-01T09:00:00+08:00", actorFor(USER_KHAIRUL)),
    name: "Leading Through Change",
    category: "LEADERSHIP",
    days: 2,
    version: 4,
    status: "ACTIVE",
    hrdcScheme: "SBL_KHAS",
    hrdcClaimable: true,
    listPrice: myr(1850000),
    listPricePax: 30,
    floorPrice: myr(1390000),
    floorMarginRate: 0.35,
    outcomes: [
      "Name the four escalation patterns that stall cross-team work",
      "Run a structured de-escalation conversation without losing the decision",
      "Agree a shared definition of done between production and quality",
    ],
    modules: [
      { n: 1, title: "Reading the escalation", format: "FACILITATED", durationMinutes: 90 },
      { n: 2, title: "The de-escalation conversation", format: "PRACTICE", durationMinutes: 120 },
      { n: 3, title: "Cross-functional commitments", format: "WORKSHOP", durationMinutes: 150 },
      { n: 4, title: "Leading the change you asked for", format: "FACILITATED", durationMinutes: 120 },
    ],
    pricingTiers: [
      { maxPax: 20, price: myr(1450000) },
      { maxPax: 30, price: myr(1850000) },
      { maxPax: 40, price: myr(2240000) },
    ],
    trainerPool: [
      { trainerRef: TRAINER_FARAH_REF, name: "Farah Aziz", tttCertified: true, tttRef: TTT_FARAH, rating: 4.7 },
      { trainerRef: TRAINER_DANIEL_REF, name: "Daniel Wong", tttCertified: true, rating: 4.4 },
    ],
    materials: [{ type: "WORKBOOK", version: 4, languages: ["EN"] }],
    stats: { deliveries: 14, averageEvaluation: 4.5 },
  },
  {
    ...entity(PROGRAMME_CONFLICT, "2022-09-05T09:00:00+08:00", "2026-05-19T09:00:00+08:00", actorFor(USER_KHAIRUL)),
    name: "Conflict to Collaboration",
    category: "LEADERSHIP",
    days: 1,
    version: 3,
    status: "ACTIVE",
    hrdcScheme: "SBL_KHAS",
    hrdcClaimable: true,
    listPrice: myr(980000),
    listPricePax: 20,
    /**
     * The absolute floor sits above the margin floor for this programme, so it
     * is the case where the tier floor binds — the mirror of QUO-2026-0184.
     */
    floorPrice: myr(735000),
    floorMarginRate: 0.35,
    outcomes: [
      "Separate the position from the interest in a live dispute",
      "Close a disagreement with a written, shared commitment",
    ],
    modules: [
      { n: 1, title: "Positions and interests", format: "FACILITATED", durationMinutes: 90 },
      { n: 2, title: "The repair conversation", format: "PRACTICE", durationMinutes: 120 },
      { n: 3, title: "Writing the commitment", format: "WORKSHOP", durationMinutes: 90 },
    ],
    pricingTiers: [
      { maxPax: 20, price: myr(980000) },
      { maxPax: 30, price: myr(1320000) },
    ],
    trainerPool: [
      { trainerRef: TRAINER_FARAH_REF, name: "Farah Aziz", tttCertified: true, tttRef: TTT_FARAH, rating: 4.6 },
    ],
    materials: [{ type: "WORKBOOK", version: 3, languages: ["EN", "MS"] }],
    stats: { deliveries: 22, averageEvaluation: 4.6 },
  },
  {
    ...entity(PROGRAMME_DATA_LITERACY, "2024-01-22T09:00:00+08:00", "2026-03-11T09:00:00+08:00", actorFor(USER_KHAIRUL)),
    name: "Data Literacy for Managers",
    category: "ANALYTICS",
    days: 2,
    version: 2,
    status: "ACTIVE",
    hrdcScheme: "SBL_KHAS",
    hrdcClaimable: true,
    listPrice: myr(1920000),
    listPricePax: 25,
    floorPrice: myr(1440000),
    floorMarginRate: 0.35,
    outcomes: [
      "Read an operational dashboard without being misled by it",
      "Ask for the measure that would change the decision",
    ],
    modules: [
      { n: 1, title: "What the number is not telling you", format: "FACILITATED", durationMinutes: 120 },
      { n: 2, title: "From dashboard to decision", format: "WORKSHOP", durationMinutes: 180 },
    ],
    pricingTiers: [
      { maxPax: 25, price: myr(1920000) },
      { maxPax: 40, price: myr(2560000) },
    ],
    trainerPool: [{ trainerRef: TRAINER_LEE_REF, name: "Lee Chin Hoe", tttCertified: true, rating: 4.2 }],
    materials: [{ type: "WORKBOOK", version: 2, languages: ["EN"] }],
    stats: { deliveries: 6, averageEvaluation: 4.3 },
  },
  {
    ...entity(PROGRAMME_SAFETY, "2021-11-30T09:00:00+08:00", "2026-02-02T09:00:00+08:00", actorFor(USER_KHAIRUL)),
    name: "Safety Leadership Essentials",
    category: "SAFETY",
    days: 2,
    version: 6,
    status: "ACTIVE",
    hrdcScheme: "SBL",
    hrdcClaimable: true,
    listPrice: myr(1620000),
    listPricePax: 30,
    floorPrice: myr(1215000),
    floorMarginRate: 0.35,
    outcomes: [
      "Stop work without stopping the relationship",
      "Run a five-minute pre-shift safety conversation that lands",
    ],
    modules: [
      { n: 1, title: "The stop-work conversation", format: "PRACTICE", durationMinutes: 120 },
      { n: 2, title: "Pre-shift habits", format: "FACILITATED", durationMinutes: 90 },
    ],
    pricingTiers: [
      { maxPax: 30, price: myr(1620000) },
      { maxPax: 45, price: myr(2180000) },
    ],
    trainerPool: [{ trainerRef: TRAINER_NOORA_REF, name: "Noora Idris", tttCertified: false, rating: 4.0 }],
    materials: [{ type: "WORKBOOK", version: 6, languages: ["EN", "MS"] }],
    stats: { deliveries: 31, averageEvaluation: 4.4 },
  },
  {
    ...entity(PROGRAMME_SALES_EXCELLENCE, "2023-06-12T09:00:00+08:00", "2026-08-14T09:00:00+08:00", actorFor(USER_KHAIRUL)),
    name: "Sales Excellence for Store Managers",
    category: "SALES",
    days: 2,
    version: 3,
    status: "ACTIVE",
    hrdcScheme: "SBL_KHAS",
    hrdcClaimable: true,
    listPrice: myr(2240000),
    listPricePax: 30,
    floorPrice: myr(1680000),
    floorMarginRate: 0.35,
    outcomes: ["Coach a floor conversation in under ten minutes", "Read the weekly mix without the report"],
    modules: [
      { n: 1, title: "The floor coaching loop", format: "PRACTICE", durationMinutes: 150 },
      { n: 2, title: "Reading the mix", format: "WORKSHOP", durationMinutes: 120 },
    ],
    pricingTiers: [
      { maxPax: 30, price: myr(2240000) },
      { maxPax: 50, price: myr(3400000) },
    ],
    trainerPool: [{ trainerRef: TRAINER_LEE_REF, name: "Lee Chin Hoe", tttCertified: true, rating: 4.2 }],
    materials: [{ type: "WORKBOOK", version: 3, languages: ["EN"] }],
    stats: { deliveries: 9, averageEvaluation: 4.1 },
  },
];

/**
 * §6 `GET /v1/programmes/{id}/deliveries` — past deliveries, keyed by programme ref.
 *
 * Ruling R8 lifted this row into the contract verbatim, so the local copy is
 * gone and the name re-exports the contract's. It followed the M06-S02
 * data-contract line (`Delivery{clientId,dates,pax,evaluation,valueRM}`) and
 * still does — from one place now (W-64).
 */
export type { ProgrammeDelivery } from "@trainos/contract";

export const programmeDeliveries: Record<string, ProgrammeDelivery[]> = {
  [PROGRAMME_LEADING_CHANGE]: [
    {
      engagementRef: "ENG-0231",
      organisationRef: "ORG-0114",
      organisationName: "Aurora Manufacturing Sdn Bhd",
      dates: "2026-11-12/2026-11-13",
      pax: 30,
      evaluation: 4.6,
      value: myr(1850000),
    },
    {
      engagementRef: "ENG-0244",
      organisationRef: "ORG-0121",
      organisationName: "Kenanga Retail Group Berhad",
      dates: "2027-01-14/2027-01-15",
      pax: 24,
      evaluation: 0,
      value: myr(1650000),
    },
  ],
  [PROGRAMME_CONFLICT]: [
    {
      engagementRef: "ENG-0203",
      organisationRef: "ORG-0133",
      organisationName: "Sutera Hospitality Group",
      dates: "2026-06-11/2026-06-11",
      pax: 18,
      evaluation: 4.5,
      value: myr(980000),
    },
  ],
  [PROGRAMME_DATA_LITERACY]: [
    {
      engagementRef: "ENG-0228",
      organisationRef: "ORG-0128",
      organisationName: "Meridian Logistics Sdn Bhd",
      dates: "2026-10-08/2026-10-09",
      pax: 22,
      evaluation: 4.3,
      value: myr(1920000),
    },
    {
      engagementRef: "ENG-0251",
      organisationRef: "ORG-0128",
      organisationName: "Meridian Logistics Sdn Bhd",
      dates: "2027-01-21/2027-01-22",
      pax: 22,
      evaluation: 0,
      value: myr(1920000),
    },
  ],
  [PROGRAMME_SAFETY]: [
    {
      engagementRef: "ENG-0198",
      organisationRef: "ORG-0114",
      organisationName: "Aurora Manufacturing Sdn Bhd",
      dates: "2026-08-20/2026-08-21",
      pax: 28,
      evaluation: 4.2,
      value: myr(1620000),
    },
  ],
  [PROGRAMME_SALES_EXCELLENCE]: [],
};

/**
 * §18 the rate card.
 *
 * DECISIONS §5: schema now, numbers from Finance. The version is
 * `v0-placeholder`, which the quotation screen must render as such so nobody
 * quotes from the demo numbers.
 */
export const rateCard: RateCard = {
  version: RATE_CARD_PLACEHOLDER_VERSION,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  currency: "MYR",
  trainerDayRate: [
    { band: "A", rate: myr(480000), override: [{ trainerRef: TRAINER_FARAH_REF, rate: myr(480000) }] },
    { band: "B", rate: myr(360000) },
    { band: "C", rate: myr(280000) },
  ],
  materialsPerPax: [
    { programmeType: "LEADERSHIP", rate: myr(4000) },
    { programmeType: "ANALYTICS", rate: myr(5500) },
    { programmeType: "SAFETY", rate: myr(3500) },
    { programmeType: "SALES", rate: myr(4500) },
  ],
  venue: [{ mode: "CLIENT_SITE", rate: myr(0) }, { mode: "OWN_VENUE", rate: myr(90000) }, { mode: "EXTERNAL" }],
  travel: [
    { region: "KLANG_VALLEY", rate: myr(30000) },
    { region: "PENINSULAR", rate: myr(85000) },
    { region: "EAST_MALAYSIA", rate: myr(190000) },
  ],
  mealsPerPax: { rate: myr(2600), acmCeiling: myr(2500) },
  commissionPct: [
    { role: "SALES", band: "STANDARD", pct: 0.08 },
    { role: "SALES", band: "STRATEGIC", pct: 0.06 },
    { role: "SALES_MANAGER", band: "STANDARD", pct: 0.02 },
  ],
  marginFloorPct: [
    { programmeType: "LEADERSHIP", pct: 0.35 },
    { programmeType: "ANALYTICS", pct: 0.35 },
    { programmeType: "SAFETY", pct: 0.35 },
    { programmeType: "SALES", pct: 0.35 },
  ],
  discountAuthority: [
    { role: "SALES", maxPct: 0.05 },
    { role: "SALES_MANAGER", maxPct: 0.15 },
    { role: "MD", maxPct: 0.3 },
  ],
};
