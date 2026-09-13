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
  MessageChannel,
  OpportunityStage,
  OrganisationMatchReason,
  RateSource,
  Severity,
  TNAStatus,
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
 * Ruled R18 · `POST /v1/actions` `type: OPPORTUNITY_STAGE_CHANGE`.
 *
 * `fromStage` is not redundant with the server's own record. Two people
 * dragging the same card, or one person on a stale board, would otherwise both
 * succeed and the later write would silently win — §7 already treats a diff
 * computed against a world that has moved as a `409`, and this is the same
 * hazard on a screen where the gesture is a drag and nobody reads a
 * confirmation. The server compares it and refuses a move from a stage the
 * deal has already left.
 */
export interface OpportunityStageChangePayload {
  stage: OpportunityStage;
  /** The stage the client believed the deal was in when the move was made. */
  fromStage: OpportunityStage;
  /** Required when moving to a terminal stage — `WON` and `LOST` end a deal. */
  reason?: string;
}

/**
 * §4 the `EXECUTED` result of a convert.
 *
 * Not policy-gated — no money moves and nothing leaves the system.
 * Emits `OpportunityCreated`.
 */
export interface OpportunityConvertResult {
  /**
   * Ruling R10: `stage` and `status` are the enums their own records carry.
   * The convert result is the first thing the UI sees of either record, and it
   * was the one place they arrived as bare strings.
   */
  opportunity: { id: string; ref: Ref; stage: OpportunityStage; value: Money };
  tna: { id: string; ref: Ref; status: TNAStatus };
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
  channel: MessageChannel;
  granted: boolean;
  recordedAt: Timestamp | null;
}

/**
 * §4 the marketing-rate comparison shown beside a utility-category draft.
 *
 * `ratePerMessage` is `Money`, which §1 defines as integer sen, so the §4
 * marketing rate of RM 0.3467 arrives as 35 and the comparison line printed
 * RM 0.35 while the primary rate beside it printed RM 0.0564. The sibling
 * `MessageDraft` already carried the unrounded string for exactly this
 * reason; the comparison needs it too, or the strip rounds on one line and
 * not the other and the six-fold difference the strip exists to show is read
 * off two different precisions.
 */
export interface AlternativeCategoryRate {
  category: MessageCategory;
  /** Rounded to the sen at estimate time. For arithmetic, not for display. */
  ratePerMessage: Money;
  /** Unrounded rate as a decimal string, e.g. `"0.3467"`. Preferred for display. */
  ratePerMessageExact?: string;
}

/**
 * §4 `GET /v1/follow-ups/{id}/draft?channel=` — the agent's draft plus its cost.
 *
 * Rates are server-side facts, not display constants: `RM 0.0564` utility and
 * `RM 0.3467` marketing, expressed in minor units rounded to the sen at
 * estimate time, with the exact rate returned as a string for display.
 *
 * **§16 Q4, ruling R11.** The question asks two things and they have different
 * owners. The cache TTL is an operations decision — it belongs in
 * `DECISIONS.md` beside the other seven, with a number Finance and the BSP
 * agree, and this package must not invent one. What the composer shows when
 * the lookup FAILS is a type question, and the type was answering it wrongly:
 * `ratePerMessage` and `estimatedCost` were required, so a server whose rate
 * lookup had failed had no honest value to send. It sends a stale rate or a
 * zero, and the strip renders it to four decimal places with no hedge — which
 * is the most convincing way to be wrong about money.
 *
 * So the failure becomes a value. `rateSource: 'UNAVAILABLE'` is a member of
 * the union, the two money fields are optional, and every consumer has to
 * decide what to render when they are absent instead of being handed a number
 * that was never looked up. `rateFetchedAt` carries the age of a `CACHED`
 * rate without the contract picking a TTL, so a composer can say how old the
 * figure is and the TTL decision stays where it belongs.
 *
 * This does not answer Q4. It stops the client answering it by accident.
 */
export interface MessageDraft {
  channel: MessageChannel;
  templateId: string;
  category: MessageCategory;
  body: string;
  recipients: number;
  /** Absent when `rateSource` is `UNAVAILABLE`. Rounded to the sen. */
  ratePerMessage?: Money;
  /** Unrounded rate as a decimal string, e.g. `"0.0564"`. */
  ratePerMessageExact?: string;
  /** Absent when `rateSource` is `UNAVAILABLE` — `recipients × rate`. */
  estimatedCost?: Money;
  /** §16 Q4 / R11: where the rate came from, including not coming at all. */
  rateSource: RateSource;
  /** When a `CACHED` rate was fetched. The TTL itself is not the type's call. */
  rateFetchedAt?: Timestamp;
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
  channel: MessageChannel;
  templateId: string;
  body?: string;
}

/** §4 `POST /v1/actions` `type: ENQUIRY_ARCHIVE`. Reason required below 0.9 confidence. */
export interface EnquiryArchivePayload {
  reason?: string;
  confidence?: Confidence;
}
