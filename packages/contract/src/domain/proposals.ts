/**
 * §6 · TNA, programmes, proposals, quotations — plus the §18 rate card.
 *
 * Screens M05-S02 (TNA detail), M06-S02 (programme detail),
 * M07-S02 (proposal builder), M07-S03 (costing worksheet).
 */

import type {
  AnyActor,
  Confidence,
  DateOnly,
  EntityEnvelope,
  Money,
  Provenance,
  Rate,
  Ref,
  Timestamp,
} from '../envelope';
import type {
  EvidenceType,
  GapPriority,
  HRDCScheme,
  ProposalStatus,
  Role,
  Severity,
  TNAStatus,
} from '../enums';

/* ------------------------------------------------------------------ *
 * §6 · TNA — M05-S02
 * ------------------------------------------------------------------ */

/** §6 who the training is for. */
export interface TnaAudience {
  headcount: number;
  /** e.g. `LINE_MANAGER`. No §12 entry; values come from the questionnaire. */
  level: string;
  sites: string[];
  /** ISO-639-1 upper, e.g. `EN`. */
  language: string;
}

/**
 * §6 a client constraint captured by the questionnaire.
 * `severity` is present only when the constraint is at risk.
 */
export interface TnaConstraint {
  code: string;
  label: string;
  severity?: Severity;
}

/** §6 one competency gap, with the questionnaire answers that evidence it. */
export interface TnaGap {
  name: string;
  description: string;
  priority: GapPriority;
  /** Question ids, e.g. `["Q4","Q7"]`. */
  evidenceRefs: string[];
  provenance?: Provenance;
}

/** §6 a citation on the TNA. */
export interface TnaEvidence {
  type: EvidenceType;
  ref: Ref;
  excerpt?: string;
}

/** §6 the TNA record. */
export interface Tna extends EntityEnvelope {
  opportunityRef: Ref;
  status: TNAStatus;
  completedBy: AnyActor | null;
  completedAt: Timestamp | null;
  audience: TnaAudience;
  constraints: TnaConstraint[];
  budget: Money | null;
  gaps: TnaGap[];
  evidence: TnaEvidence[];
}

/** §6 trainer availability attached to a recommendation. */
export interface TrainerAvailability {
  trainerRef: Ref;
  name: string;
  available: boolean;
  /** Rendered range, e.g. `2026-11-12/2026-11-13`. */
  dates?: string;
}

/** §6 one ranked programme. */
export interface TnaRecommendation {
  programmeId: string;
  name: string;
  fitScore: Rate;
  rationale: string;
  priceIndication?: Money;
  trainerAvailability?: TrainerAvailability[];
}

/** §6 the weights behind `fitScore`, surfaced so the UI can explain the ranking. */
export interface ScoringModel {
  version: string;
  weights: Record<string, Rate>;
}

/** §6 `GET /v1/tnas/{id}/recommendations`. */
export interface TnaRecommendationsResponse {
  data: TnaRecommendation[];
  provenance: Provenance;
  scoringModel: ScoringModel;
}

/* ------------------------------------------------------------------ *
 * §6 · Programmes — M06-S02
 * ------------------------------------------------------------------ */

/** §6 one module in the programme outline. */
export interface ProgrammeModule {
  n: number;
  title: string;
  format: string;
  durationMinutes: number;
}

/** §6 a headcount-banded price. */
export interface PricingTier {
  maxPax: number;
  price: Money;
}

/** §6 a trainer in the programme's pool. */
export interface TrainerPoolEntry {
  trainerRef: Ref;
  name: string;
  tttCertified: boolean;
  tttRef?: string;
  rating?: number;
}

/** §6 a material asset shipped with the programme. */
export interface ProgrammeMaterial {
  type: string;
  version: number;
  languages: string[];
}

/** §6 delivery history rolled up onto the programme. */
export interface ProgrammeStats {
  deliveries: number;
  averageEvaluation: number;
}

/**
 * §6 the programme record.
 *
 * `floorPrice` is the server value the costing screen validates against —
 * never a client constant.
 * `PUT /v1/programmes/{id}` is ADMIN + L&D only; SALES gets `403 FORBIDDEN`
 * with `details.requiredRole`.
 */
export interface Programme extends EntityEnvelope {
  name: string;
  category: string;
  days: number;
  version: number;
  status: string;
  hrdcScheme: HRDCScheme;
  hrdcClaimable: boolean;
  listPrice: Money;
  listPricePax: number;
  floorPrice: Money;
  floorMarginRate: Rate;
  outcomes: string[];
  modules: ProgrammeModule[];
  pricingTiers: PricingTier[];
  trainerPool: TrainerPoolEntry[];
  materials: ProgrammeMaterial[];
  stats: ProgrammeStats;
}

/* ------------------------------------------------------------------ *
 * §6 · Proposals — M07-S02
 * ------------------------------------------------------------------ */

/** §6 one section of the proposal, each with its own provenance. */
export interface ProposalSection {
  n: number;
  title: string;
  body?: string;
  mergeFieldsUsed?: string[];
  /** Set when the section was generated below the confidence threshold. */
  needsReview?: boolean;
  provenance?: Provenance;
}

/** §6 a warning rendered above the editor. */
export interface ProposalWarning {
  code: string;
  sectionN?: number;
  message: string;
}

/**
 * §6 the proposal record.
 *
 * Send is **not** a proposal endpoint — it is `POST /v1/actions`
 * `type: PROPOSAL_SEND`, which is how policy APV-01 intercepts it.
 */
export interface Proposal extends EntityEnvelope {
  opportunityRef: Ref;
  templateId: string;
  status: ProposalStatus;
  value: Money;
  marginRate: Rate;
  /** The agent run that drafted it, when one did. */
  runId?: string;
  sections: ProposalSection[];
  warnings?: ProposalWarning[];
}

/** §6 `POST /v1/proposals`. Idempotent: yes. Emits `ProposalDrafted`. */
export interface ProposalCreateRequest {
  opportunityRef: Ref;
  templateId: string;
  programmeId: string;
}

/** §6 `PUT /v1/proposals/{id}/sections/{n}` — manual edit. */
export interface ProposalSectionWrite {
  title?: string;
  body: string;
}

/** §6 `POST /v1/proposals/{id}/sections/{n}/regenerate` — new body plus a run id. */
export interface ProposalSectionRegenerateResponse {
  section: ProposalSection;
  runId: string;
}

/** §6 `GET /v1/proposals/{id}/preview?format=HTML|PDF`. */
export interface ProposalPreview {
  url: string;
  format: 'HTML' | 'PDF';
  expiresAt?: Timestamp;
}

/* ------------------------------------------------------------------ *
 * §6 · Quotations — M07-S03 (ruling R2: the section's "costing" is a quotation)
 * ------------------------------------------------------------------ */

/**
 * §6 one quotation line.
 *
 * §18: `total` is `rate × qty` rounded half-up to the sen. The quotation total
 * sums the rounded lines. A zero-quantity line (client-site venue) still
 * carries an explicit zero `total`.
 */
export interface QuotationLine {
  item: string;
  detail?: string;
  qty: number;
  unit?: string;
  rate?: Money;
  total: Money;
}

/**
 * §6 the quotation record, served at `GET /v1/quotations/{id}`.
 *
 * Ruling R2: §6 calls this a "costing" in prose, but the ref prefix is `QUO-`,
 * §18 calls it a quotation, and API.md and the REPORT recurring-entities block
 * both say `Quotation`. One name wins; this is it.
 *
 * §15 item 3: `perParticipant` (`sellPrice ÷ pax`) is display-only, and §18
 * makes that explicit — a per-pax figure that does not multiply cleanly must
 * never become a line.
 */
export interface Quotation extends EntityEnvelope {
  proposalRef: Ref;
  /** §6 original field. */
  rateCardYear?: number;
  /** §18 supersede: every quotation stores the rate card version it was priced against. */
  rateCardVersion: string;
  lines: QuotationLine[];
  sellPrice: Money;
  directCost: Money;
  marginRate: Rate;
  floorPrice: Money;
  floorMarginRate: Rate;
  commissionRate: Rate;
  commission: Money;
  commissionPayableOn: 'COLLECTION' | 'INVOICE';
  /** §15 item 3 — informational per-pax display, never a line. */
  display?: { perPax?: Money };
}

/** §6 `PUT /v1/quotations/{id}` — recalculates server-side. */
export interface QuotationWrite {
  lines?: QuotationLine[];
  sellPrice?: Money;
}

/**
 * §6 the `422 FLOOR_PRICE_BREACH` detail. The UI renders this as the red field
 * state; applying the price anyway goes through `POST /v1/actions`
 * `type: DISCOUNT_APPROVE`.
 */
export interface FloorPriceBreachDetails {
  floorPrice: Money;
  resultingMarginRate: Rate;
  requiresPolicy: string;
}

/* ------------------------------------------------------------------ *
 * §18 · Rate card — schema now, numbers from Finance
 * ------------------------------------------------------------------ */

/** §18 / DECISIONS §5 trainer bands. */
export const TRAINER_BANDS = ['A', 'B', 'C'] as const;
export type TrainerBand = (typeof TRAINER_BANDS)[number];

/** §18 / DECISIONS §5 venue modes: client site = 0, own venue = fixed, external = quote. */
export const VENUE_MODES = ['CLIENT_SITE', 'OWN_VENUE', 'EXTERNAL'] as const;
export type VenueMode = (typeof VENUE_MODES)[number];

/** §18 / DECISIONS §5 travel regions. */
export const TRAVEL_REGIONS = [
  'KLANG_VALLEY',
  'PENINSULAR',
  'EAST_MALAYSIA',
] as const;
export type TravelRegion = (typeof TRAVEL_REGIONS)[number];

/** §18 day rate by band, with an optional per-trainer override. */
export interface TrainerDayRate {
  band: TrainerBand;
  rate: Money;
  /** Per-trainer override keyed by trainer ref. */
  override?: { trainerRef: Ref; rate: Money }[];
}

/** §18 materials cost per pax, by programme type. */
export interface MaterialsPerPaxRate {
  programmeType: string;
  rate: Money;
}

/** §18 venue cost by mode. `EXTERNAL` is quoted, so it carries no fixed rate. */
export interface VenueRate {
  mode: VenueMode;
  rate?: Money;
}

/** §18 travel cost by region. */
export interface TravelRate {
  region: TravelRegion;
  rate: Money;
}

/** §18 meals per pax, capped by the ACM ceiling for the year. */
export interface MealsPerPaxRate {
  rate: Money;
  acmCeiling: Money;
}

/** §18 commission by role and deal band. */
export interface CommissionRate {
  role: Role;
  band: string;
  pct: Rate;
}

/** §18 margin floor by programme type. */
export interface MarginFloor {
  programmeType: string;
  pct: Rate;
}

/** §18 who may discount how much without an approval. */
export interface DiscountAuthority {
  role: Role;
  maxPct: Rate;
}

/**
 * §18 the rate card.
 *
 * Until Finance supplies values the API returns `version: "v0-placeholder"`
 * and clients render the placeholder label, so nobody quotes from it.
 */
export interface RateCard {
  version: string;
  effectiveFrom: DateOnly;
  effectiveTo: DateOnly | null;
  currency: 'MYR';
  trainerDayRate: TrainerDayRate[];
  materialsPerPax: MaterialsPerPaxRate[];
  venue: VenueRate[];
  travel: TravelRate[];
  mealsPerPax: MealsPerPaxRate;
  commissionPct: CommissionRate[];
  marginFloorPct: MarginFloor[];
  discountAuthority: DiscountAuthority[];
}

/** §18 the placeholder version clients must render as such. */
export const RATE_CARD_PLACEHOLDER_VERSION = 'v0-placeholder' as const;

/* ------------------------------------------------------------------ *
 * §6 · Action payloads
 * ------------------------------------------------------------------ */

/** §6 `POST /v1/actions` `type: TNA_RECOMMENDATION_ACCEPT`. */
export interface TnaRecommendationAcceptPayload {
  programmeId: string;
  templateId?: string;
}

/** §6 `POST /v1/actions` `type: QUOTATION_APPLY` — writes the price onto the proposal. */
export interface QuotationApplyPayload {
  sellPrice: Money;
}

/** §6 `POST /v1/actions` `type: DISCOUNT_APPROVE` — applying a below-floor price. */
export interface DiscountApprovePayload {
  sellPrice: Money;
  resultingMarginRate: Rate;
  reason: string;
}

/** §3 `POST /v1/actions` `type: PROPOSAL_SEND`. */
export interface ProposalSendPayload {
  channel: 'EMAIL' | 'WHATSAPP';
  templateId: string;
  to: string[];
  cc?: string[];
  attachPdf?: boolean;
}

/** §6 the confidence floor below which a section is flagged `needsReview`. */
export type SectionConfidence = Confidence;
