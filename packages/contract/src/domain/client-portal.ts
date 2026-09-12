/**
 * §11 · Client portal, realtime and inbound webhooks.
 *
 * Screen M07-S07 (client proposal page). The portal is the only surface that
 * is not behind tenant auth.
 */

import type { DateOnly, Money, Rate, Ref, Timestamp } from '../envelope';
import type { HRDCScheme, ProposalStatus, SyncState } from '../enums';

/* ------------------------------------------------------------------ *
 * §11 · GET /v1/public/proposals/{token} — M07-S07
 * ------------------------------------------------------------------ */

/**
 * §11 the commercial summary the client sees.
 *
 * `hrdcClaimableUpTo` is a decimal fraction of the total, `1.0` meaning fully
 * claimable.
 */
export interface PortalInvestment {
  total: Money;
  hrdcScheme: HRDCScheme;
  hrdcClaimableUpTo: Rate;
  levyAvailable?: Money;
}

/** §11 a proposal section, client-safe: body only, no provenance. */
export interface PortalSection {
  n: number;
  title: string;
  body: string;
}

/** §11 the recorded acceptance. */
export interface PortalAcceptance {
  acceptedBy: string;
  role: string;
  acceptedAt: Timestamp;
  signatureRef: string;
}

/** §11 a comment thread entry on the portal. */
export interface PortalComment {
  author: string;
  authorKind: 'CLIENT' | 'HUMAN';
  at: Timestamp;
  body: string;
}

/**
 * §11 the client-safe projection of a proposal.
 *
 * **No margin, no cost lines, no internal provenance.** The token is a signed,
 * expiring link (30 days, revocable).
 * TODO(contract §16 Q6): revoke the token on acceptance, or keep it live so
 * the client can re-download?
 */
export interface PortalProposal {
  ref: Ref;
  organisationName: string;
  issuedAt: DateOnly;
  sections: PortalSection[];
  investment: PortalInvestment;
  status: ProposalStatus;
  acceptance: PortalAcceptance | null;
  comments: PortalComment[];
}

/** §11 `POST /v1/public/proposals/{token}/comments`. */
export interface PortalCommentRequest {
  author: string;
  body: string;
}

/**
 * §11 `POST /v1/public/proposals/{token}/accept`.
 *
 * Creates the engagement and emits `ProposalAccepted`. Idempotent by token: a
 * second accept returns the original acceptance.
 */
export interface PortalAcceptRequest {
  name: string;
  role: string;
}

/** §11 the accept result. */
export interface PortalAcceptResponse {
  engagementRef: Ref;
  acceptedAt: Timestamp;
  signatureRef: string;
}

/** §14 `POST /v1/public/tnas/{token}/submit` — emits `TNACompleted`. */
export interface PortalTnaSubmitRequest {
  responses: { questionId: string; value: unknown }[];
  completedBy: { name: string; role: string };
}

/* ------------------------------------------------------------------ *
 * §11 · Inbound webhooks
 * ------------------------------------------------------------------ */

/**
 * §11 the four inbound webhooks, each with the header or field used as its
 * idempotency key. Replays of a seen key return
 * `200 { "status": "IGNORED_DUPLICATE" }`.
 */
export const INBOUND_WEBHOOKS = [
  {
    path: '/v1/webhooks/email',
    source: 'mail provider',
    idempotencyKey: 'Message-ID header',
    emits: ['EnquiryReceived'],
  },
  {
    path: '/v1/webhooks/whatsapp',
    source: 'WhatsApp BSP',
    idempotencyKey: 'messages[0].id',
    emits: ['EnquiryReceived'],
  },
  {
    path: '/v1/webhooks/proposal-accepted',
    source: 'portal (internal)',
    idempotencyKey: 'token + acceptedAt',
    emits: ['ProposalAccepted'],
  },
  {
    path: '/v1/webhooks/accounting',
    source: 'accounting package',
    idempotencyKey: 'provider + documentId + state',
    emits: ['InvoicePushed', 'InvoiceValidated'],
  },
] as const;

/** §11 the accounting package's callback. */
export interface AccountingWebhookPayload {
  provider: string;
  documentId: string;
  externalRef: Ref;
  state: SyncState;
  uin?: string;
  at: Timestamp;
}

/** §11 the reply to a webhook whose idempotency key has been seen. */
export interface WebhookDuplicateResponse {
  status: 'IGNORED_DUPLICATE';
}
