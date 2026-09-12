/**
 * The tool boundary.
 *
 * An agent never touches data. It calls a named operation with typed
 * arguments, and a {@link ToolAdapter} decides what that means. Today the only
 * adapter reads fixtures; tomorrow one calls the real API. The agent code does
 * not change, and — more to the point — nothing an agent can say to a model
 * can reach past this interface.
 *
 * The last operation, `actions.perform`, is the important one: an agent's
 * output is always a `POST /v1/actions` call, never a direct write. That is
 * how a policy halt is possible at all.
 */

import type {
  ActionRequest,
  ActionResponse,
  Money,
  Ref,
} from '@trainos/contract';

/** The seven operations the demo chain needs. */
export const TOOL_OPERATIONS = [
  'enquiries.get',
  'organisations.search',
  'programmes.search',
  'trainers.availability',
  'quotations.compute',
  'proposals.draft',
  'actions.perform',
] as const;

export type ToolOperation = (typeof TOOL_OPERATIONS)[number];

/**
 * Wire names the models see.
 *
 * OpenAI's function-name grammar is `^[a-zA-Z0-9_-]{1,64}$` — no dots — so the
 * dotted operation names are flattened for the wire and mapped back here.
 * Keeping both directions in one table stops the two drifting apart.
 */
export const WIRE_NAMES: Readonly<Record<ToolOperation, string>> = {
  'enquiries.get': 'enquiries_get',
  'organisations.search': 'organisations_search',
  'programmes.search': 'programmes_search',
  'trainers.availability': 'trainers_availability',
  'quotations.compute': 'quotations_compute',
  'proposals.draft': 'proposals_draft',
  'actions.perform': 'actions_perform',
};

const BY_WIRE_NAME = new Map<string, ToolOperation>(
  Object.entries(WIRE_NAMES).map(([op, wire]) => [wire, op as ToolOperation]),
);

export function operationForWireName(name: string): ToolOperation | undefined {
  return BY_WIRE_NAME.get(name);
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/**
 * What a tool call produced.
 *
 * `truncated` exists because §17 has a `TRUNCATION` run event: a tool that
 * returns more than the node can afford to read stores the whole thing and
 * hands back a slice, and the trace says so rather than quietly losing data.
 */
export interface ToolResult {
  ok: boolean;
  data: unknown;
  /** Populated when the adapter trimmed the payload. */
  truncated?: { storedTokens: number; fetchMoreAvailable: boolean };
  error?: { code: string; message: string };
}

export interface ToolAdapter {
  /** Which operations this adapter can serve. */
  supports(op: ToolOperation): boolean;
  execute(op: ToolOperation, args: Record<string, unknown>): Promise<ToolResult>;
}

/* ------------------------------------------------------------------ *
 * The data shapes the tools deal in
 * ------------------------------------------------------------------ */

/** A slice of `GET /v1/enquiries/{id}` — what the Reader needs. */
export interface EnquirySummary {
  ref: Ref;
  receivedAt: string;
  subject: string;
  body: string;
  fromName: string;
  fromEmail: string;
  organisationHint: string;
}

/** A slice of an organisation record, plus why it matched. */
export interface OrganisationMatch {
  ref: Ref;
  name: string;
  status: string;
  matchReason: 'EXACT_DOMAIN' | 'FUZZY_NAME' | 'MANUAL';
  confidence: number;
  hrdcEmployerCode?: string;
  openBalance?: Money;
  priorEngagements: number;
}

/** A programme the Matcher may choose. */
export interface ProgrammeMatch {
  ref: Ref;
  title: string;
  days: number;
  listPrice: Money;
  maxPax: number;
  fit: number;
  hrdcClaimable: boolean;
  tags: string[];
}

/** One trainer's availability in a window. */
export interface TrainerAvailability {
  ref: Ref;
  name: string;
  tttCertificate?: string;
  tttValidTo?: string;
  hrdTdf: boolean;
  available: boolean;
  availableDates: string[];
  dayRate: Money;
}

/** The costing behind a quotation. Lines are truth, totals are sums (§18). */
export interface QuotationResult {
  ref: Ref;
  lines: Array<{ label: string; unitPrice: Money; qty: number; total: Money }>;
  net: Money;
  sst: Money;
  total: Money;
  /**
   * The figure the proposal states and HRD Corp claims against — net of SST.
   *
   * This, not `total`, is what the policy gate compares to a threshold. SST is
   * a pass-through the client does not approve, and folding it into the value
   * would push a RM 14,900 proposal over a RM 15,000 gate on tax alone.
   */
  proposalValue: Money;
  cost: Money;
  marginRate: number;
  floorMarginRate: number;
  belowFloor: boolean;
  rateCardVersion: string;
  /** Informational only — never a line. DECISIONS §7. */
  perPaxDisplay: string;
}

/** A drafted proposal. */
export interface ProposalDraftResult {
  ref: Ref;
  templateId: string;
  templateVersion: number;
  sections: Array<{ key: string; heading: string; body: string }>;
  value: Money;
  quotationRef: Ref;
}

/* ------------------------------------------------------------------ *
 * The fixture-backed data source
 * ------------------------------------------------------------------ */

/**
 * The read surface the fixture adapter needs.
 *
 * Deliberately small and local. `@trainos/fixtures` is being written in
 * parallel and does not export `createFixtureClient` yet, so the runtime codes
 * against this interface and `fixture-adapter.ts` is the single file that
 * changes when the real client lands.
 */
export interface ToolContext {
  getEnquiry(ref: Ref): EnquirySummary | undefined;
  searchOrganisations(query: string): OrganisationMatch[];
  searchProgrammes(query: string, tags?: string[]): ProgrammeMatch[];
  trainerAvailability(programmeRef: Ref, from: string, to: string): TrainerAvailability[];
  computeQuotation(input: {
    programmeRef: Ref;
    pax: number;
    days?: number;
    discountRate?: number;
  }): QuotationResult;
  draftProposal(input: {
    organisationRef: Ref;
    programmeRef: Ref;
    quotationRef: Ref;
    sections?: Array<{ key: string; heading: string; body: string }>;
  }): ProposalDraftResult;
  /**
   * The policy gate. Returns the §3 response union — `EXECUTED`,
   * `QUEUED_FOR_APPROVAL` or `SUGGESTED`. Never a direct write.
   */
  performAction(request: ActionRequest): ActionResponse;
}
