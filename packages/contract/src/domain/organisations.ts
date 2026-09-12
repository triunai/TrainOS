/**
 * §5 · Organisations, contacts, opportunities.
 *
 * Screen M04-S02 (Organisation 360).
 */

import type {
  Actor,
  DateOnly,
  EntityEnvelope,
  MetricValue,
  Money,
  Provenance,
  Rate,
  Ref,
  Timestamp,
} from '../envelope';
import type {
  HrdcPacketPanelState,
  OpportunityStage,
  OrganisationStatus,
} from '../enums';
import type { UiActionType } from '../actions';
import type { LifecycleStep } from './engagements';

/* ------------------------------------------------------------------ *
 * §5 · GET /v1/organisations/{id} — record header
 * ------------------------------------------------------------------ */

/**
 * §5 the metric strip on the organisation record header.
 *
 * Each metric carries its own `drillTo` — the UI never hardcodes a drill route.
 */
export interface OrganisationMetrics {
  lifetimeValue: MetricValue<Money>;
  openPipeline: MetricValue<Money>;
  arOverdue: MetricValue<Money>;
  hrdcLevyAvailable: MetricValue<Money>;
  /** 0–100 composite, not a rate. */
  healthScore: MetricValue<number>;
}

/** §5 the organisation record. */
export interface Organisation {
  id: string;
  ref: Ref;
  name: string;
  industry: string;
  location: string;
  owner: Actor;
  status: OrganisationStatus;
  hrdcRegistered: boolean;
  hrdcEmployerCode: string | null;
  metrics: OrganisationMetrics;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ------------------------------------------------------------------ *
 * §5 · GET /v1/organisations/{id}/relations
 * ------------------------------------------------------------------ */

/** §5 PDPA consent flags carried on a contact row. */
export interface ContactConsent {
  email: boolean;
  whatsapp: boolean;
}

/** §5 a contact as listed on the relations panel. */
export interface ContactSummary {
  ref: Ref;
  name: string;
  role: string;
  primary?: boolean;
  consent: ContactConsent;
  /** Set when consent is missing, e.g. `NO_CONSENT`. */
  pdpaFlag?: string;
}

/** §5 the full contact record (`GET /v1/contacts/{id}`). */
export interface Contact extends EntityEnvelope {
  organisationRef: Ref;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  primary: boolean;
  consent: ContactConsent;
  pdpaFlag?: string;
}

/** §5 an engagement row on the relations panel, with its own lifecycle strip. */
export interface RelatedEngagement {
  ref: Ref;
  title: string;
  /** Rendered range, e.g. `2026-11-12/2026-11-13`. */
  dates: string;
  value: Money;
  /** From pipeline configuration (§5), never from the client. */
  lifecycle: LifecycleStep[];
}

/** §5 an invoice row on the relations panel. */
export interface RelatedInvoice {
  ref: Ref;
  status: string;
  daysOverdue?: number;
  amount: Money;
}

/** §5 an HRDC packet row on the relations panel. */
export interface RelatedHrdcPacket {
  ref: Ref;
  state: HrdcPacketPanelState;
  missingDocuments?: number;
  daysRemaining?: number;
}

/** §5 the organisation's HRD Corp position. */
export interface RelatedHrdc {
  employerCode: string;
  levyAvailable: Money;
  packets: RelatedHrdcPacket[];
}

/** §5 one call, tabbed client-side. */
export interface OrganisationRelations {
  engagements?: RelatedEngagement[];
  contacts?: ContactSummary[];
  invoices?: RelatedInvoice[];
  hrdc?: RelatedHrdc;
}

/* ------------------------------------------------------------------ *
 * §5 · GET /v1/organisations/{id}/suggestions — cross-sell panel
 * ------------------------------------------------------------------ */

/** §5 an offered next step on a suggestion card. */
export interface SuggestionAction {
  type: UiActionType;
  label: string;
}

/**
 * §5 a cross-sell suggestion. `rationale` is the sentence the card renders;
 * the citations behind it live in `provenance.sources`.
 */
export interface OrganisationSuggestion {
  type: 'CROSS_SELL';
  programmeId: string;
  title: string;
  rationale: string;
  provenance: Provenance;
  actions: SuggestionAction[];
}

/* ------------------------------------------------------------------ *
 * §5 · Opportunities
 * ------------------------------------------------------------------ */

/**
 * §5 an opportunity. `PATCH /v1/opportunities/{id}` emits
 * `OpportunityStageChanged`.
 */
export interface Opportunity extends EntityEnvelope {
  organisationRef: Ref;
  stage: OpportunityStage;
  value: Money;
  /** Decimal fraction per §1. */
  probability?: Rate;
  owner: Actor;
  sourceEnquiryRef?: Ref;
  expectedCloseDate?: DateOnly;
}

/** §5 `PATCH /v1/opportunities/{id}`. */
export interface OpportunityPatch {
  stage?: OpportunityStage;
  value?: Money;
  ownerId?: string;
  probability?: Rate;
}
