/**
 * §4 · Enquiries, leads and follow-ups.
 *
 * Screens M03-S01 (inbox), M03-S02 (detail), M03-S06 (follow-up queue).
 */

import type {
  Actor,
  Confidence,
  DateOnly,
  EntityEnvelope,
  Money,
  Provenance,
  ProvenancedValue,
  Ref,
  Timestamp,
} from '../envelope';
import type {
  AutonomyLevel,
  EnquiryChannel,
  EnquiryStatus,
  EvidenceType,
  MessageCategory,
  OrganisationMatchReason,
  Severity,
} from '../enums';
import type { SuggestedAction } from '../actions';

/* ------------------------------------------------------------------ *
 * §4 · GET /v1/enquiries — M03-S01
 * ------------------------------------------------------------------ */

/** §4 who the enquiry came from. Channel decides which of the two is present. */
export interface EnquiryOrigin {
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * §4 the AI classification on an inbox row.
 *
 * Items below the classification threshold return `needsHumanReview: true`
 * and are never auto-archived.
 */
export interface EnquiryClassification {
  label: string;
  provenance: Provenance;
  needsHumanReview?: boolean;
}

/** §4 the organisation an enquiry was matched to, and why. */
export interface MatchedOrganisation {
  id: string;
  ref: Ref;
  name: string;
  matchReason: OrganisationMatchReason;
}

/** §4 an enquiry as listed on the inbox. */
export interface Enquiry extends EntityEnvelope {
  channel: EnquiryChannel;
  status: EnquiryStatus;
  receivedAt: Timestamp;
  from: EnquiryOrigin;
  subject: string;
  /** Truncated body for the list row. */
  preview: string;
  classification: EnquiryClassification;
  estimatedValue: Money | null;
  matchedOrganisation: MatchedOrganisation | null;
  assignedTo: Actor | null;
}

/* ------------------------------------------------------------------ *
 * §4 · GET /v1/enquiries/{id} — M03-S02
 * ------------------------------------------------------------------ */

/**
 * §4 the four extracted fields, each carrying its own provenance.
 *
 * `budget` is the demo's null-with-high-confidence case: the model is
 * confident there is no budget stated, not unsure about the value.
 */
export interface EnquiryExtraction {
  topic: ProvenancedValue<string | null>;
  audience: ProvenancedValue<string | null>;
  /** `2026-11` — a month, not a date. */
  timing: ProvenancedValue<string | null>;
  budget: ProvenancedValue<Money | null>;
}

/** §4 a related record chip on the detail screen. */
export interface RelatedRecord {
  type: EvidenceType;
  ref: Ref;
  label: string;
  severity?: Severity;
}

/** §4 the enquiry detail payload. */
export interface EnquiryDetail extends Enquiry {
  body: string;
  extraction: EnquiryExtraction;
  suggestedAction?: SuggestedAction<OpportunityConvertPayload>;
  related: RelatedRecord[];
}

/**
 * §4 `PATCH /v1/enquiries/{id}/extraction` — edit before use.
 *
 * The field's provenance flips to `AI_SUGGESTED` with `editedBy`.
 * Idempotent: no, last write wins. Emits: none.
 */
export interface EnquiryExtractionPatch {
  field: keyof EnquiryExtraction;
  value: unknown;
}

/* ------------------------------------------------------------------ *
 * §4 · POST /v1/actions `type: OPPORTUNITY_CONVERT`
 * ------------------------------------------------------------------ */

/** §4 the convert payload the suggested action carries. */
export interface OpportunityConvertPayload {
  value: Money;
  questionnaireTemplateId: string;
  programmeId: string;
}

/**
 * §4 the `EXECUTED` result of a convert.
 *
 * Not policy-gated — no money moves and nothing leaves the system.
 * Emits `OpportunityCreated`.
 */
export interface OpportunityConvertResult {
  opportunity: { id: string; ref: Ref; stage: string; value: Money };
  tna: { id: string; ref: Ref; status: string };
  effects: import('../actions').Effect[];
}

/* ------------------------------------------------------------------ *
 * §4 · GET /v1/follow-ups — M03-S06
 * ------------------------------------------------------------------ */

/** §4 a queued follow-up. */
export interface FollowUp {
  id: string;
  ref: Ref;
  contact: { ref: Ref; name: string };
  organisation: { ref: Ref; name: string };
  /** Why the follow-up exists, in the words the queue renders. */
  reason: string;
  dueDate: DateOnly;
  status: FollowUpStatus;
  autonomy: AutonomyLevel;
}

/**
 * §4 follow-up status. Only `DUE` appears in the example; the queue is filtered
 * with `filter[due][eq]=TODAY`.
 * TODO(contract §16): catalogue the follow-up status vocabulary.
 */
export const FOLLOW_UP_STATUSES = ['DUE', 'OVERDUE', 'SENT', 'DISMISSED'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/** §4 recorded PDPA consent for a channel. */
export interface ChannelConsent {
  channel: 'EMAIL' | 'WHATSAPP';
  granted: boolean;
  recordedAt: Timestamp | null;
}

/** §4 the marketing-rate comparison shown beside a utility-category draft. */
export interface AlternativeCategoryRate {
  category: MessageCategory;
  ratePerMessage: Money;
}

/**
 * §4 `GET /v1/follow-ups/{id}/draft?channel=` — the agent's draft plus its cost.
 *
 * Rates are server-side facts, not display constants: `RM 0.0564` utility and
 * `RM 0.3467` marketing, expressed in minor units rounded to the sen at
 * estimate time, with the exact rate returned as a string for display.
 * TODO(contract §16 Q4): rate cache TTL, and what the composer shows when the
 * rate lookup fails.
 */
export interface MessageDraft {
  channel: 'EMAIL' | 'WHATSAPP';
  templateId: string;
  category: MessageCategory;
  body: string;
  recipients: number;
  ratePerMessage: Money;
  /** Unrounded rate as a decimal string, e.g. `"0.0564"`. */
  ratePerMessageExact?: string;
  estimatedCost: Money;
  alternativeCategoryRate?: AlternativeCategoryRate;
  consent: ChannelConsent;
  provenance?: Provenance;
}

/**
 * §4 `POST /v1/actions` `type: FOLLOWUP_SEND`.
 *
 * At `SUGGEST` autonomy an agent caller gets `200 SUGGESTED`; a human caller
 * gets `202 EXECUTED`.
 */
export interface FollowUpSendPayload {
  channel: 'EMAIL' | 'WHATSAPP';
  templateId: string;
  body?: string;
}

/** §4 `POST /v1/actions` `type: ENQUIRY_ARCHIVE`. Reason required below 0.9 confidence. */
export interface EnquiryArchivePayload {
  reason?: string;
  confidence?: Confidence;
}
