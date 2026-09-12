/**
 * §13 · Screen → endpoint matrix, plus the §17 "New screen → endpoint rows".
 *
 * One entry per endpoint the matrix names, joined with the roles each
 * endpoint's own section states. Paths include the §1 base path `/v1`; the
 * tenant is implicit from auth and never appears in a path.
 */

import type { Role } from './enums';

/** HTTP verbs used by the contract. `SSE` marks the §11 event stream. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'SSE';

/**
 * One row of the matrix.
 *
 * - `screenIds` — the screens in §13 / §17 that call it. Empty for endpoints
 *   that exist in the contract but belong to no screen (webhooks, drill
 *   targets).
 * - `roles` — who may call it. Empty for the unauthenticated portal and
 *   inbound webhooks.
 * - `gated` — a policy may intercept the call and return an approval instead
 *   of the effect (§3), or the section marks the write approval-gated.
 * - `idempotent` — safe to replay. True for GET/PUT/DELETE by definition, and
 *   for the POSTs the contract marks idempotent via `Idempotency-Key` (§1).
 */
export interface EndpointSpec {
  readonly method: HttpMethod;
  readonly path: string;
  readonly screenIds: readonly string[];
  readonly roles: readonly Role[];
  readonly gated: boolean;
  readonly idempotent: boolean;
}

/** §1 every role — for the shell endpoints the matrix marks "all roles". */
const ALL_ROLES = [
  'SALES',
  'SALES_MANAGER',
  'OPS',
  'FINANCE',
  'MD',
  'ADMIN',
  'TRAINER',
  'CLIENT',
  'AGENT',
] as const;

/** §13 + §17 the endpoint table. */
export const ENDPOINTS = [
  /* §2 · Session and shell — every screen */
  { method: 'GET', path: '/v1/me', screenIds: [], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'GET', path: '/v1/navigation', screenIds: [], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'GET', path: '/v1/search', screenIds: [], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'GET', path: '/v1/{resourceType}/{id}/audit', screenIds: ['M04-S02'], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'GET', path: '/v1/views', screenIds: ['M03-S01', 'M02-S01'], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'POST', path: '/v1/views', screenIds: ['M03-S01', 'M02-S01'], roles: ALL_ROLES, gated: false, idempotent: false },
  { method: 'PATCH', path: '/v1/views/{id}', screenIds: ['M03-S01', 'M02-S01'], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'DELETE', path: '/v1/views/{id}', screenIds: ['M03-S01', 'M02-S01'], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'GET', path: '/v1/templates', screenIds: ['M07-S02'], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'GET', path: '/v1/policies', screenIds: [], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'GET', path: '/v1/policies/{id}', screenIds: ['M07-S02'], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'GET', path: '/v1/config/pipelines', screenIds: ['M04-S02', 'M09-S02'], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'SSE', path: '/v1/events', screenIds: ['M01-S01', 'M02-S01', 'M03-S01', 'M13-S02', 'M13-S05', 'M18-S04'], roles: ALL_ROLES, gated: false, idempotent: true },

  /* §3 · The action envelope */
  { method: 'POST', path: '/v1/actions', screenIds: ['M01-S01', 'M02-S01', 'M03-S01', 'M03-S02', 'M03-S06', 'M05-S02', 'M07-S02', 'M07-S03', 'M09-S02', 'M10-S06', 'M12-S02', 'M12-S08', 'M13-S02', 'M13-S05', 'M20-S16'], roles: ALL_ROLES, gated: true, idempotent: true },

  /* §4 · Enquiries, leads and follow-ups */
  { method: 'GET', path: '/v1/enquiries', screenIds: ['M03-S01'], roles: ['SALES', 'SALES_MANAGER'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/enquiries/{id}', screenIds: ['M03-S01', 'M03-S02'], roles: ['SALES', 'SALES_MANAGER'], gated: false, idempotent: true },
  { method: 'PATCH', path: '/v1/enquiries/{id}/extraction', screenIds: ['M03-S02'], roles: ['SALES'], gated: false, idempotent: false },
  { method: 'GET', path: '/v1/follow-ups', screenIds: ['M03-S06'], roles: ['SALES'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/follow-ups/{id}/draft', screenIds: ['M03-S06'], roles: ['SALES'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/contacts/{id}/consent', screenIds: ['M03-S06'], roles: ['SALES'], gated: false, idempotent: true },

  /* §5 · Organisations, contacts, opportunities */
  { method: 'GET', path: '/v1/organisations/{id}', screenIds: ['M04-S02', 'M03-S02'], roles: ['SALES', 'FINANCE', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/organisations/{id}/relations', screenIds: ['M04-S02'], roles: ['SALES', 'FINANCE', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/organisations/{id}/suggestions', screenIds: ['M04-S02'], roles: ['SALES'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/contacts', screenIds: [], roles: ['SALES', 'SALES_MANAGER'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/contacts/{id}', screenIds: [], roles: ['SALES', 'SALES_MANAGER'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/opportunities', screenIds: ['M01-S01', 'M04-S02'], roles: ['SALES', 'SALES_MANAGER', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/opportunities/{id}', screenIds: [], roles: ['SALES', 'SALES_MANAGER', 'MD'], gated: false, idempotent: true },
  { method: 'PATCH', path: '/v1/opportunities/{id}', screenIds: [], roles: ['SALES', 'SALES_MANAGER'], gated: false, idempotent: true },

  /* §6 · TNA, programmes, proposals, quotations (ruling R2) */
  { method: 'GET', path: '/v1/tnas/{id}', screenIds: ['M05-S02'], roles: ['SALES'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/tnas/{id}/recommendations', screenIds: ['M05-S02'], roles: ['SALES'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/tnas/{id}/reopen', screenIds: ['M05-S02'], roles: ['SALES'], gated: false, idempotent: false },
  { method: 'GET', path: '/v1/programmes', screenIds: [], roles: ['SALES', 'OPS'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/programmes/{id}', screenIds: ['M06-S02', 'M07-S03'], roles: ['SALES', 'OPS'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/programmes/{id}/deliveries', screenIds: ['M06-S02'], roles: ['SALES', 'OPS'], gated: false, idempotent: true },
  { method: 'PUT', path: '/v1/programmes/{id}', screenIds: ['M06-S02'], roles: ['ADMIN'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/trainers', screenIds: ['M06-S02'], roles: ['SALES', 'OPS'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/proposals', screenIds: ['M05-S02', 'M07-S02'], roles: ['SALES'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/proposals/{id}', screenIds: ['M07-S02', 'M02-S02'], roles: ['SALES', 'SALES_MANAGER'], gated: false, idempotent: true },
  { method: 'PUT', path: '/v1/proposals/{id}/sections/{n}', screenIds: ['M07-S02'], roles: ['SALES'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/proposals/{id}/sections/{n}/regenerate', screenIds: ['M07-S02'], roles: ['SALES'], gated: false, idempotent: false },
  { method: 'GET', path: '/v1/proposals/{id}/preview', screenIds: ['M07-S02', 'M02-S02'], roles: ['SALES', 'SALES_MANAGER'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/quotations/{id}', screenIds: ['M07-S03'], roles: ['SALES', 'FINANCE'], gated: false, idempotent: true },
  { method: 'PUT', path: '/v1/quotations/{id}', screenIds: ['M07-S03'], roles: ['SALES', 'FINANCE'], gated: false, idempotent: true },

  /* §7 · Approvals */
  { method: 'GET', path: '/v1/approvals', screenIds: ['M02-S01', 'M01-S01'], roles: ['SALES_MANAGER', 'MD', 'FINANCE'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/approvals/{id}', screenIds: ['M02-S02'], roles: ['SALES_MANAGER', 'MD'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/approvals/{id}/decide', screenIds: ['M02-S01', 'M02-S02'], roles: ['SALES_MANAGER', 'MD'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/approvals/bulk-decide', screenIds: ['M02-S01'], roles: ['SALES_MANAGER', 'MD'], gated: false, idempotent: true },

  /* §8 · Engagements, participants, attendance */
  { method: 'GET', path: '/v1/engagements', screenIds: ['M12-S08'], roles: ['OPS', 'FINANCE', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/engagements/{id}', screenIds: ['M09-S02'], roles: ['OPS', 'FINANCE', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/engagements/{id}/participants', screenIds: ['M09-S02'], roles: ['OPS', 'FINANCE', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/engagements/{id}/attendance', screenIds: ['M10-S06'], roles: ['OPS', 'TRAINER'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/engagements/{id}/attendance/{day}/capture', screenIds: ['M10-S06'], roles: ['OPS', 'TRAINER'], gated: false, idempotent: false },
  { method: 'GET', path: '/v1/engagements/{id}/attendance/export', screenIds: ['M10-S06'], roles: ['OPS', 'TRAINER'], gated: false, idempotent: true },

  /* §9 · HRD Corp and finance */
  { method: 'GET', path: '/v1/hrdc/packets/{engagementRef}', screenIds: ['M12-S02', 'M09-S02'], roles: ['FINANCE', 'OPS'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/hrdc/packets/{id}/documents', screenIds: ['M12-S02'], roles: ['FINANCE', 'OPS'], gated: false, idempotent: false },
  { method: 'GET', path: '/v1/hrdc/packets/{id}/export', screenIds: ['M12-S02'], roles: ['FINANCE', 'OPS'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/hrdc/deadlines', screenIds: [], roles: ['FINANCE', 'OPS'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/invoices', screenIds: ['M13-S02'], roles: ['FINANCE'], gated: true, idempotent: true },
  { method: 'GET', path: '/v1/invoices', screenIds: [], roles: ['FINANCE'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/invoices/{id}', screenIds: ['M13-S02', 'M09-S02'], roles: ['FINANCE'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/invoices/{id}/payments', screenIds: ['M13-S02'], roles: ['FINANCE'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/receivables', screenIds: ['M01-S01', 'M04-S02'], roles: ['FINANCE', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/receivables/aging', screenIds: ['M13-S05'], roles: ['FINANCE'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/collections/queue', screenIds: ['M13-S05'], roles: ['FINANCE'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/collections/{invoiceRef}/draft', screenIds: ['M13-S05'], roles: ['FINANCE'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/collections/rules', screenIds: ['M13-S05'], roles: ['FINANCE'], gated: false, idempotent: true },

  /* §10 · Agents, runs, dashboards */
  { method: 'GET', path: '/v1/agents', screenIds: ['M18-S01'], roles: ['ADMIN', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/agents/{id}', screenIds: ['M18-S01'], roles: ['ADMIN', 'MD'], gated: false, idempotent: true },
  { method: 'PUT', path: '/v1/agents/{id}/autonomy', screenIds: ['M18-S01'], roles: ['MD'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/agents/{id}/pause', screenIds: ['M18-S01'], roles: ['ADMIN', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/evals', screenIds: ['M18-S01'], roles: ['ADMIN', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/runs', screenIds: ['M18-S04'], roles: ['ADMIN'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/runs/{id}', screenIds: ['M18-S04', 'M02-S02'], roles: ['ADMIN'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/runs/{id}/retry', screenIds: ['M18-S04'], roles: ['ADMIN'], gated: false, idempotent: false },
  { method: 'POST', path: '/v1/runs/{id}/dead-letter', screenIds: ['M18-S04'], roles: ['ADMIN'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/runs/{id}/replay', screenIds: ['M18-S04'], roles: ['ADMIN'], gated: false, idempotent: false },
  { method: 'GET', path: '/v1/dashboards/executive', screenIds: ['M01-S01'], roles: ['MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/metrics/{key}', screenIds: ['M01-S01', 'M04-S02'], roles: ALL_ROLES, gated: false, idempotent: true },
  { method: 'GET', path: '/v1/reports/proposals-vs-won', screenIds: ['M01-S01'], roles: ['MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/reports/hours-saved', screenIds: ['M01-S01'], roles: ['MD'], gated: false, idempotent: true },

  /* §11 · Client portal — unauthenticated signed links */
  { method: 'GET', path: '/v1/public/proposals/{token}', screenIds: ['M07-S07'], roles: ['CLIENT'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/public/proposals/{token}/comments', screenIds: ['M07-S07'], roles: ['CLIENT'], gated: false, idempotent: false },
  { method: 'POST', path: '/v1/public/proposals/{token}/accept', screenIds: ['M07-S07'], roles: ['CLIENT'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/public/tnas/{token}/submit', screenIds: [], roles: ['CLIENT'], gated: false, idempotent: true },

  /* §11 · Inbound webhooks — authenticated by provider signature, not by role */
  { method: 'POST', path: '/v1/webhooks/email', screenIds: [], roles: [], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/webhooks/whatsapp', screenIds: [], roles: [], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/webhooks/proposal-accepted', screenIds: [], roles: [], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/webhooks/accounting', screenIds: ['M13-S02'], roles: [], gated: false, idempotent: true },

  /* §17 · Model tiers and routing — M20-S20 */
  { method: 'GET', path: '/v1/ai/tiers', screenIds: ['M20-S20'], roles: ['ADMIN', 'MD'], gated: false, idempotent: true },
  { method: 'PUT', path: '/v1/ai/tiers/{key}', screenIds: ['M20-S20'], roles: ['ADMIN'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/ai/routing', screenIds: ['M20-S20'], roles: ['ADMIN', 'MD'], gated: false, idempotent: true },
  { method: 'PUT', path: '/v1/ai/routing', screenIds: ['M20-S20'], roles: ['ADMIN'], gated: false, idempotent: true },

  /* §17 · Provider keys (BYOK) — M20-S21 */
  { method: 'GET', path: '/v1/ai/providers', screenIds: ['M20-S21'], roles: ['ADMIN'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/ai/providers', screenIds: ['M20-S21'], roles: ['ADMIN'], gated: false, idempotent: false },
  { method: 'POST', path: '/v1/ai/providers/{id}/test', screenIds: ['M20-S21'], roles: ['ADMIN'], gated: false, idempotent: false },
  { method: 'POST', path: '/v1/ai/providers/{id}/rotate', screenIds: ['M20-S21'], roles: ['ADMIN'], gated: false, idempotent: false },
  { method: 'POST', path: '/v1/ai/providers/{id}/reveal', screenIds: ['M20-S21'], roles: ['ADMIN'], gated: false, idempotent: false },
  { method: 'DELETE', path: '/v1/ai/providers/{id}', screenIds: ['M20-S21'], roles: ['ADMIN'], gated: false, idempotent: true },

  /* §17 · Usage and budgets — M20-S16 */
  { method: 'GET', path: '/v1/ai/usage', screenIds: ['M20-S16', 'M20-S20'], roles: ['ADMIN', 'FINANCE', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/ai/usage/forecast', screenIds: ['M20-S16'], roles: ['ADMIN', 'FINANCE', 'MD'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/ai/budgets', screenIds: ['M20-S16'], roles: ['ADMIN', 'FINANCE', 'MD'], gated: false, idempotent: true },
  { method: 'PUT', path: '/v1/ai/budgets/{scope}/{key}', screenIds: ['M20-S16'], roles: ['ADMIN'], gated: true, idempotent: true },

  /* §17 · HRD Corp rules registry — M12-S07 */
  { method: 'GET', path: '/v1/compliance/rules', screenIds: ['M12-S07'], roles: ['FINANCE', 'OPS', 'ADMIN'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/compliance/rules/{id}', screenIds: ['M12-S07'], roles: ['FINANCE', 'OPS', 'ADMIN'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/compliance/rules', screenIds: ['M12-S07'], roles: ['FINANCE', 'ADMIN'], gated: true, idempotent: false },
  { method: 'PUT', path: '/v1/compliance/rules/{id}', screenIds: ['M12-S07'], roles: ['FINANCE', 'ADMIN'], gated: true, idempotent: true },

  /* §17 · Rule-change review — M12-S08 */
  { method: 'GET', path: '/v1/compliance/rule-changes', screenIds: ['M12-S08'], roles: ['FINANCE', 'ADMIN'], gated: false, idempotent: true },
  { method: 'GET', path: '/v1/compliance/rule-changes/{documentId}', screenIds: ['M12-S08'], roles: ['FINANCE', 'ADMIN'], gated: false, idempotent: true },

  /* §17 · Compliance checks — M12-S02, M09-S02 */
  { method: 'GET', path: '/v1/compliance/checks', screenIds: ['M12-S02', 'M09-S02'], roles: ['FINANCE', 'OPS'], gated: false, idempotent: true },

  /* §17 · Knowledge sources — M16-S05 */
  { method: 'GET', path: '/v1/knowledge/sources', screenIds: ['M16-S05'], roles: ['ADMIN', 'FINANCE'], gated: false, idempotent: true },
  { method: 'POST', path: '/v1/knowledge/sources', screenIds: ['M16-S05'], roles: ['ADMIN'], gated: false, idempotent: false },
  { method: 'POST', path: '/v1/knowledge/sources/{id}/check', screenIds: ['M16-S05'], roles: ['ADMIN'], gated: false, idempotent: false },
  { method: 'POST', path: '/v1/knowledge/sources/{id}/reingest', screenIds: ['M16-S05'], roles: ['ADMIN'], gated: false, idempotent: false },
] as const satisfies readonly EndpointSpec[];

/** §13 one row of the table, narrowed to its literal path and method. */
export type Endpoint = (typeof ENDPOINTS)[number];

/** §13 every path in the contract. */
export type EndpointPath = Endpoint['path'];

/** §13 every screen id the matrix names. `M22-S04` has no endpoints — static document. */
export const SCREEN_IDS = [
  'M01-S01',
  'M02-S01',
  'M02-S02',
  'M03-S01',
  'M03-S02',
  'M03-S06',
  'M04-S02',
  'M05-S02',
  'M06-S02',
  'M07-S02',
  'M07-S03',
  'M07-S07',
  'M09-S02',
  'M10-S06',
  'M12-S02',
  'M12-S07',
  'M12-S08',
  'M13-S02',
  'M13-S05',
  'M16-S05',
  'M18-S01',
  'M18-S04',
  'M20-S16',
  'M20-S20',
  'M20-S21',
  'M22-S04',
] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];
