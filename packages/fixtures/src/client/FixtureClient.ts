/**
 * The fixture client — the §13 endpoint surface as typed methods, backed by an
 * in-memory store.
 *
 * It is the contract, not a mock: `performAction` runs the §3 evaluation order
 * over a real policy table and returns one of the three documented outcomes,
 * errors are §1 `ContractError`s carrying the right code and details, lists use
 * the §1 filter grammar and cursor pages, and every state change writes its
 * §14 event and pushes the §11 channel frame that goes with it.
 *
 * Methods are grouped by contract section, in the order `endpoints.ts` lists
 * them.
 */

import type {
  Actor,
  ActionDraft,
  ActionRequest,
  ActionResponse,
  ActionResult,
  Agent,
  AgentEval,
  AgentRegistryResponse,
  AnyActor,
  ApprovalBulkDecideRequest,
  ApprovalBulkDecideResponse,
  ApprovalDecideRequest,
  ApprovalDecideResponse,
  ApprovalDetail,
  ApprovalGroup,
  ApprovalListResponse,
  ApprovalRequest,
  ApprovalRequestRef,
  AttendanceCaptureRequest,
  AttendanceExport,
  AttendanceSheet,
  AuditEntry,
  AutomationRun,
  AutonomyLevel,
  Badge,
  BadgeCounts,
  BindingFloorBasis,
  Budget,
  BudgetWrite,
  ClaimPacket,
  CollectionRule,
  ComplianceChecksResponse,
  ComplianceRule,
  Contact,
  ChannelConsent,
  CollectionsQueueResponse,
  Quotation,
  QuotationLine,
  QuotationWrite,
  Rate,
  DateOnly,
  DiffLine,
  Effect,
  Engagement,
  EngagementFinance,
  Enquiry,
  EnquiryDetail,
  EnquiryExtractionPatch,
  ExecutiveDashboard,
  FollowUp,
  GovernedActionType,
  HoursSavedReport,
  HrdcDeadline,
  HrdcDocumentAttachRequest,
  HrdcPacketExport,
  Invoice,
  KnowledgeSource,
  KnowledgeSourceCheckResponse,
  KnowledgeSourceCreateRequest,
  KnowledgeSourceReingestResponse,
  ListResponse,
  Me,
  MessageDraft,
  MetricResponse,
  ModelTier,
  ModelTierWrite,
  Money,
  NavigationTree,
  Opportunity,
  OpportunityPatch,
  Organisation,
  OrganisationRelations,
  OrganisationSuggestion,
  PageRequest,
  Participant,
  PaymentRecordRequest,
  PipelineConfig,
  PipelineObject,
  Policy,
  PortalAcceptRequest,
  PortalAcceptResponse,
  PortalCommentRequest,
  PortalProposal,
  PortalTnaSubmitRequest,
  Programme,
  Proposal,
  ProposalPreview,
  ProposalSectionRegenerateResponse,
  ProposalSectionWrite,
  ProposalsVsWonReport,
  ProviderKey,
  ProviderKeyCreateRequest,
  ProviderKeyRevealResponse,
  ProviderKeyRotateRequest,
  ProviderKeyTestResponse,
  RateCard,
  Receivable,
  ReceivablesAging,
  Role,
  RoutingEntry,
  RoutingResponse,
  RuleChangeSet,
  SavedView,
  SavedViewWrite,
  SearchResult,
  Template,
  TemplateType,
  Timestamp,
  Tna,
  TrainerAvailability,
  TnaRecommendationsResponse,
  UsageDailySeries,
  UsageForecast,
  UsageResponse,
  WebhookDuplicateResponse,
  AccountingWebhookPayload,
  ProposalCreateRequest,
  RunDeadLetterRequest,
  RunReplayResponse,
  AgentAutonomyWrite,
  AgentPauseRequest,
} from "@trainos/contract";
import { IDEMPOTENT_REPLAY_HEADER } from "@trainos/contract";

import type { FixtureApproval } from "../data/approvals";
import type { FixtureNotification } from "../data/shell";
import type { FixtureTrainer, ProgrammeDelivery } from "../data/programmes";
import type { FixtureTenant } from "../data/tenant";
import type { FixtureCommission } from "../data/commissions";
import type { FixtureLibraryAsset } from "../data/library";
import { NOW, lineTotal, myr, roundHalfUpSen, sumMoney } from "../data/_helpers";
import { approvalsSummary } from "../data/approvals";
import { navigationFor } from "../data/shell";
import { toEnquiryRow } from "../data/enquiries";
import { portalTokenOrganisation } from "../data/proposals";
import { permissionsFor, roleFor } from "../data/tenant";

import { ContractError, forbidden, notFound, validationFailed } from "./errors";
import { EventBus, resetEventSequence } from "./events";
import { paginate, readPath } from "./query";
import {
  DEFAULT_MINIMUM_CONFIDENCE,
  MINIMUM_CONFIDENCE,
  assignApprover,
  computeContextFlags,
  grantedAutonomy,
  matchPolicy,
  payloadValue,
} from "./policy";
import {
  evaluateFloors,
  floorPriceBreach,
  marginFloorPrice,
  reconcileInvoice,
  resultingMarginRate,
  withFloors,
} from "./pricing";
import { byIdOrRef, createStore, type FixtureStore } from "./store";

/**
 * §6 + §18 the result of pricing a delivery from the catalogue.
 *
 * `proposalValue` is deliberately separate from `total`: the §3 gate compares
 * the ex-SST figure against the APV-01 threshold, and folding tax into the
 * value would push an RM 14,900 proposal over an RM 15,000 gate on tax alone.
 */
export interface ComputedQuotation {
  programmeRef: string;
  pax: number;
  days: number;
  lines: QuotationLine[];
  costLines: QuotationLine[];
  proposalValue: Money;
  sst: Money;
  sstReason: string;
  total: Money;
  directCost: Money;
  marginRate: Rate;
  absoluteFloorPrice: Money;
  marginFloorPrice: Money;
  floorPrice: Money;
  bindingFloorBasis: BindingFloorBasis;
  belowFloor: boolean;
  rateCardVersion: string;
  display: { perPax: Money };
}

/** §6 what `draftProposal` resolved on the caller's behalf, alongside the draft. */
export interface ProposalDraftResult {
  proposal: Proposal;
  opportunityRef: string;
  organisationRef: string;
  quotationRef?: string;
}

/** Options every state-changing call accepts. */
export interface RequestOptions {
  /** §1 `Idempotency-Key`. Replay with the same body returns the original. */
  idempotencyKey?: string;
}

/** What the transport would have carried alongside the body. */
export interface ResponseMeta {
  status: number;
  headers: Record<string, string>;
}

export interface FixtureClientConfig {
  /** Simulated round trip, in milliseconds. Default 120. */
  latencyMs?: number;
  /** Reserved for generated variation; the dataset itself is deterministic. */
  seed?: number;
  /** Who the client is signed in as. Default Amirah Yusof (SALES). */
  actorId?: string;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** Every calendar day in an inclusive `YYYY-MM-DD` range. */
const datesBetween = (from: DateOnly, to: DateOnly): DateOnly[] => {
  const days: DateOnly[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return days;
  for (let cursor = start; cursor <= end; cursor += 86400000) {
    const iso = new Date(cursor).toISOString().slice(0, 10);
    days.push(iso);
  }
  return days;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
};

/** The §7 list projection of a stored approval. */
const toApprovalRow = (approval: FixtureApproval): ApprovalRequest => ({
  id: approval.id,
  ref: approval.ref,
  policyId: approval.policyId,
  actionType: approval.actionType,
  subject: approval.subject,
  targetRef: approval.targetRef,
  ...(approval.value ? { value: approval.value } : {}),
  requestedBy: approval.requestedBy,
  ...(approval.confidence !== undefined ? { confidence: approval.confidence } : {}),
  ...(approval.autonomy ? { autonomy: approval.autonomy } : {}),
  slaDueAt: approval.slaDueAt,
  ...(approval.slaRemainingMinutes !== undefined
    ? { slaRemainingMinutes: approval.slaRemainingMinutes }
    : {}),
  slaBreached: approval.slaBreached,
  status: approval.status,
  bulkApprovable: approval.bulkApprovable,
  urgencyGroup: approval.urgencyGroup,
});

export class FixtureClient {
  #store: FixtureStore;
  #latencyMs: number;
  #actorId: string;
  #lastMeta: ResponseMeta = { status: 200, headers: {} };

  /** §14 the outbox and the §11 channels. */
  readonly events = new EventBus();

  constructor(config: FixtureClientConfig = {}) {
    this.#store = createStore();
    this.#latencyMs = config.latencyMs ?? 120;
    this.#actorId = config.actorId ?? "u_amirah";
  }

  /* ---------------------------------------------------------------- *
   * Client-level controls
   * ---------------------------------------------------------------- */

  /** The raw store, for tests and for seeding a Supabase fixture loader. */
  get store(): FixtureStore {
    return this.#store;
  }

  /** The transport metadata of the most recent call. */
  get lastMeta(): ResponseMeta {
    return this.#lastMeta;
  }

  /** Sign the client in as someone else — changes what `/v1/me` returns. */
  signInAs(actorId: string): void {
    this.#actorId = actorId;
  }

  get actorId(): string {
    return this.#actorId;
  }

  setLatency(latencyMs: number): void {
    this.#latencyMs = latencyMs;
  }

  /** Rebuilds the store from the seed data and drops every subscription. */
  reset(): void {
    this.#store = createStore();
    this.events.clear();
    resetEventSequence();
    this.#lastMeta = { status: 200, headers: {} };
  }

  async #read<T>(value: T, status = 200): Promise<T> {
    await sleep(this.#latencyMs);
    this.#lastMeta = { status, headers: {} };
    return value;
  }

  /**
   * §1 idempotency: the same key with the same body returns the original
   * response and sets `Idempotent-Replay: true`; the same key with a different
   * body is `409 IDEMPOTENT_REPLAY`.
   */
  async #write<T>(options: RequestOptions, body: unknown, status: number, run: () => T): Promise<T> {
    await sleep(this.#latencyMs);
    const key = options.idempotencyKey;
    if (!key) {
      this.#lastMeta = { status, headers: {} };
      return run();
    }
    const bodyHash = stableStringify(body);
    const seen = this.#store.idempotency.get(key);
    if (seen) {
      if (seen.bodyHash !== bodyHash) {
        throw new ContractError(
          "IDEMPOTENT_REPLAY",
          `Idempotency key ${key} was already used with a different body.`,
          { key },
        );
      }
      this.#lastMeta = { status: 200, headers: { [IDEMPOTENT_REPLAY_HEADER]: "true" } };
      return seen.response as T;
    }
    const response = run();
    this.#store.idempotency.set(key, { bodyHash, response, at: NOW });
    this.#lastMeta = { status, headers: {} };
    return response;
  }

  /**
   * §2 permissions come from `/me`, and a gated call returns `403` naming the
   * role that holds the grant — so the UI can explain rather than just disable.
   */
  #requirePermission(permission: string, requiredRole: Role): void {
    if (permissionsFor(this.#actorId).includes(permission)) return;
    throw forbidden(
      `${permission} is not granted to ${roleFor(this.#actorId) ?? "this principal"}.`,
      { requiredRole, requiredPermission: permission },
    );
  }

  #actor(id = this.#actorId): AnyActor {
    const user = this.#store.users.find((candidate) => candidate.id === id);
    return { id, name: user?.name ?? id, kind: user ? "HUMAN" : "SYSTEM" };
  }

  /* ---------------------------------------------------------------- *
   * §2 · Session and shell
   * ---------------------------------------------------------------- */

  async getMe(): Promise<Me> {
    const me = this.#store.users.find((user) => user.id === this.#actorId);
    if (!me) throw notFound("User", this.#actorId);
    return this.#read(me);
  }

  /**
   * The tenant record. Fixture-only, and deliberately so.
   *
   * §1 keeps tenancy IMPLICIT from auth — the tenant never appears in a path or
   * a body, so the contract publishes no `Tenant` type and no endpoint that
   * returns one. `/settings/organisation` still has to render the organisation
   * it is configuring, and the record already exists in the store to stamp
   * events with. This exposes that record rather than inventing a contract
   * shape the API has decided not to have; `FixtureTenant` is a fixture type
   * for the same reason `FixtureNotification` is.
   *
   * TODO(contract §2): if organisation settings ever become writable, that is a
   * real endpoint and a real contract type, and this method goes away.
   */
  async getTenant(): Promise<FixtureTenant> {
    return this.#read(this.#store.tenant);
  }

  async getNavigation(role?: Role): Promise<NavigationTree> {
    const resolved = role ?? roleFor(this.#actorId) ?? "SALES";
    return this.#read(navigationFor(resolved));
  }

  async getBadges(): Promise<BadgeCounts> {
    return this.#read(this.#store.badgeCounts);
  }

  async search(query: string): Promise<SearchResult> {
    const key = query.trim().toLowerCase();
    return this.#read(this.#store.searchResults[key] ?? { records: [], actions: [] });
  }

  async getAudit(resourceType: string, id: string): Promise<ListResponse<AuditEntry>> {
    const rows = this.#store.auditEntries[`${resourceType}::${id}`] ?? [];
    return this.#read(paginate(rows, { sort: "-at" }));
  }

  async listViews(object?: SavedView["object"], page?: PageRequest): Promise<ListResponse<SavedView>> {
    const rows = object ? this.#store.savedViews.filter((view) => view.object === object) : this.#store.savedViews;
    return this.#read(paginate(rows, page));
  }

  async createView(body: SavedViewWrite, options: RequestOptions = {}): Promise<SavedView> {
    return this.#write(options, body, 201, () => {
      const view: SavedView = {
        id: `view_${this.#store.savedViews.length + 1}`,
        label: body.label,
        object: body.object,
        count: 0,
        isDefault: body.isDefault ?? false,
        filters: body.filters,
        columns: body.columns,
      };
      this.#store.savedViews.push(view);
      return view;
    });
  }

  async updateView(id: string, body: Partial<SavedViewWrite>): Promise<SavedView> {
    await sleep(this.#latencyMs);
    const view = this.#store.savedViews.find((candidate) => candidate.id === id);
    if (!view) throw notFound("Saved view", id);
    Object.assign(view, body);
    this.#lastMeta = { status: 200, headers: {} };
    return view;
  }

  async deleteView(id: string): Promise<void> {
    await sleep(this.#latencyMs);
    const index = this.#store.savedViews.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw notFound("Saved view", id);
    this.#store.savedViews.splice(index, 1);
    this.#lastMeta = { status: 204, headers: {} };
  }

  async listTemplates(type?: TemplateType, page?: PageRequest): Promise<ListResponse<Template>> {
    const rows = type ? this.#store.templates.filter((template) => template.type === type) : this.#store.templates;
    return this.#read(paginate(rows, page));
  }

  async listPolicies(page?: PageRequest): Promise<ListResponse<Policy>> {
    return this.#read(paginate(this.#store.policies, page));
  }

  async getPolicy(id: string): Promise<Policy> {
    const policy = this.#store.policies.find((candidate) => candidate.id === id);
    if (!policy) throw notFound("Policy", id);
    return this.#read(policy);
  }

  /**
   * §5 / §8 the stage definitions. `object` is typed, so asking for a pipeline
   * the contract does not name is a compile error rather than a 404 at runtime.
   */
  async getPipelineConfig(object: PipelineObject): Promise<PipelineConfig> {
    const pipeline = this.#store.pipelines.find((candidate) => candidate.object === object);
    if (!pipeline) throw notFound("Pipeline", object);
    return this.#read(pipeline);
  }

  /** Not a contract endpoint — the top-bar bell. See the README's gaps note. */
  async listNotifications(): Promise<ListResponse<FixtureNotification>> {
    return this.#read(paginate(this.#store.notifications, { sort: "-at" }));
  }

  /* ---------------------------------------------------------------- *
   * §4 · Enquiries, leads and follow-ups
   * ---------------------------------------------------------------- */

  async listEnquiries(page?: PageRequest): Promise<ListResponse<Enquiry>> {
    const view = page?.view ? this.#store.savedViews.find((candidate) => candidate.id === page.view) : undefined;
    const result = paginate(this.#store.enquiries, page ?? { sort: "-receivedAt" }, view);
    return this.#read({ ...result, data: result.data.map(toEnquiryRow) });
  }

  async getEnquiry(id: string): Promise<EnquiryDetail> {
    const enquiry = byIdOrRef(this.#store.enquiries, id);
    if (!enquiry) throw notFound("Enquiry", id);
    return this.#read(enquiry);
  }

  /** §4 editing an extracted field flips its provenance to AI_SUGGESTED. */
  async patchEnquiryExtraction(id: string, patch: EnquiryExtractionPatch): Promise<EnquiryDetail> {
    await sleep(this.#latencyMs);
    const enquiry = byIdOrRef(this.#store.enquiries, id);
    if (!enquiry) throw notFound("Enquiry", id);
    const field = enquiry.extraction[patch.field];
    if (!field) throw validationFailed(`Unknown extraction field ${String(patch.field)}.`);
    const actor = this.#actor();
    (field as { value: unknown }).value = patch.value;
    field.provenance = {
      ...(field.provenance ?? { origin: "AI_SUGGESTED" }),
      origin: "AI_SUGGESTED",
      editedBy: { id: actor.id, name: actor.name ?? actor.id, at: NOW },
    };
    enquiry.updatedAt = NOW;
    this.#lastMeta = { status: 200, headers: {} };
    return enquiry;
  }

  async listFollowUps(page?: PageRequest): Promise<ListResponse<FollowUp>> {
    return this.#read(paginate(this.#store.followUps, page ?? { sort: "dueDate" }));
  }

  async getFollowUpDraft(id: string, channel: "EMAIL" | "WHATSAPP"): Promise<MessageDraft> {
    const followUp = byIdOrRef(this.#store.followUps, id);
    if (!followUp) throw notFound("Follow-up", id);
    const draft = this.#store.followUpDrafts[`${followUp.ref}::${channel}`];
    if (!draft) throw notFound(`Draft for ${channel}`, followUp.ref);
    return this.#read(draft);
  }

  async getContactConsent(contactId: string): Promise<ListResponse<ChannelConsent>> {
    const contact = byIdOrRef(this.#store.contacts, contactId);
    if (!contact) throw notFound("Contact", contactId);
    return this.#read(paginate(this.#store.contactConsents[contact.ref] ?? []));
  }

  /* ---------------------------------------------------------------- *
   * §5 · Organisations, contacts, opportunities
   * ---------------------------------------------------------------- */

  async getOrganisation(id: string): Promise<Organisation> {
    const organisation = byIdOrRef(this.#store.organisations, id);
    if (!organisation) throw notFound("Organisation", id);
    return this.#read(organisation);
  }

  async getOrganisationRelations(id: string, types?: readonly string[]): Promise<OrganisationRelations> {
    const organisation = byIdOrRef(this.#store.organisations, id);
    if (!organisation) throw notFound("Organisation", id);
    const relations = this.#store.organisationRelations[organisation.ref] ?? {};
    if (!types || types.length === 0) return this.#read(relations);
    const wanted = new Set(types.map((type) => type.toUpperCase()));
    return this.#read({
      ...(wanted.has("ENGAGEMENT") ? { engagements: relations.engagements } : {}),
      ...(wanted.has("CONTACT") ? { contacts: relations.contacts } : {}),
      ...(wanted.has("INVOICE") ? { invoices: relations.invoices } : {}),
      ...(wanted.has("HRDC") ? { hrdc: relations.hrdc } : {}),
    });
  }

  async getOrganisationSuggestions(id: string): Promise<ListResponse<OrganisationSuggestion>> {
    const organisation = byIdOrRef(this.#store.organisations, id);
    if (!organisation) throw notFound("Organisation", id);
    return this.#read(paginate(this.#store.organisationSuggestions[organisation.ref] ?? []));
  }

  async listContacts(page?: PageRequest): Promise<ListResponse<Contact>> {
    return this.#read(paginate(this.#store.contacts, page));
  }

  async getContact(id: string): Promise<Contact> {
    const contact = byIdOrRef(this.#store.contacts, id);
    if (!contact) throw notFound("Contact", id);
    return this.#read(contact);
  }

  async listOpportunities(page?: PageRequest): Promise<ListResponse<Opportunity>> {
    return this.#read(paginate(this.#store.opportunities, page));
  }

  async getOpportunity(id: string): Promise<Opportunity> {
    const opportunity = byIdOrRef(this.#store.opportunities, id);
    if (!opportunity) throw notFound("Opportunity", id);
    return this.#read(opportunity);
  }

  async patchOpportunity(id: string, patch: OpportunityPatch): Promise<Opportunity> {
    await sleep(this.#latencyMs);
    const opportunity = byIdOrRef(this.#store.opportunities, id);
    if (!opportunity) throw notFound("Opportunity", id);
    const fromStage = opportunity.stage;
    Object.assign(opportunity, patch);
    opportunity.updatedAt = NOW;
    if (patch.stage && patch.stage !== fromStage) {
      this.events.emit(
        "OpportunityStageChanged",
        { opportunityRef: opportunity.ref, fromStage, toStage: patch.stage },
        this.#actor(),
        NOW,
      );
    }
    this.#lastMeta = { status: 200, headers: {} };
    return opportunity;
  }

  /* ---------------------------------------------------------------- *
   * §6 · TNA, programmes, proposals, quotations
   * ---------------------------------------------------------------- */

  /**
   * §6 every TNA.
   *
   * §13 publishes `GET /v1/tna/{id}` and no collection beside it, because the
   * pack reaches a TNA from its opportunity rather than from a list. The nav
   * tree still has a `Sales › TNA` leaf, so the list has to exist for the
   * screen above it to be honest — added here and reported as a contract gap,
   * the same way `addProposalSection` was.
   */
  async listTnas(page?: PageRequest): Promise<ListResponse<Tna>> {
    return this.#read(paginate(this.#store.tnas, page));
  }

  async getTna(id: string): Promise<Tna> {
    const tna = byIdOrRef(this.#store.tnas, id);
    if (!tna) throw notFound("TNA", id);
    return this.#read(tna);
  }

  async getTnaRecommendations(id: string): Promise<TnaRecommendationsResponse> {
    const tna = byIdOrRef(this.#store.tnas, id);
    if (!tna) throw notFound("TNA", id);
    const recommendations = this.#store.tnaRecommendations[tna.ref];
    if (!recommendations) throw notFound("Recommendations for", tna.ref);
    return this.#read(recommendations);
  }

  async reopenTna(id: string, options: RequestOptions = {}): Promise<Tna> {
    const tna = byIdOrRef(this.#store.tnas, id);
    if (!tna) throw notFound("TNA", id);
    return this.#write(options, { id }, 200, () => {
      tna.status = "REOPENED";
      tna.updatedAt = NOW;
      return tna;
    });
  }

  async listProgrammes(page?: PageRequest): Promise<ListResponse<Programme>> {
    return this.#read(paginate(this.#store.programmes, page));
  }

  async getProgramme(id: string): Promise<Programme> {
    const programme = byIdOrRef(this.#store.programmes, id);
    if (!programme) throw notFound("Programme", id);
    return this.#read(programme);
  }

  async getProgrammeDeliveries(id: string): Promise<ListResponse<ProgrammeDelivery>> {
    const programme = byIdOrRef(this.#store.programmes, id);
    if (!programme) throw notFound("Programme", id);
    return this.#read(paginate(this.#store.programmeDeliveries[programme.ref] ?? []));
  }

  /** §6 `PUT /v1/programmes/{id}` is ADMIN only; SALES gets 403 with the role it needs. */
  async putProgramme(id: string, body: Partial<Programme>): Promise<Programme> {
    await sleep(this.#latencyMs);
    const programme = byIdOrRef(this.#store.programmes, id);
    if (!programme) throw notFound("Programme", id);
    const role = roleFor(this.#actorId);
    if (role !== "ADMIN") {
      throw forbidden("Editing the programme catalogue is restricted to ADMIN and L&D.", {
        requiredRole: "ADMIN",
      });
    }
    Object.assign(programme, body);
    programme.updatedAt = NOW;
    this.#lastMeta = { status: 200, headers: {} };
    return programme;
  }

  async listTrainers(page?: PageRequest): Promise<ListResponse<FixtureTrainer>> {
    return this.#read(paginate(this.#store.trainers, page));
  }

  async createProposal(body: ProposalCreateRequest, options: RequestOptions = {}): Promise<Proposal> {
    const opportunity = byIdOrRef(this.#store.opportunities, body.opportunityRef);
    if (!opportunity) throw notFound("Opportunity", body.opportunityRef);
    return this.#write(options, body, 201, () => {
      const existing = this.#store.proposals.find((row) => row.opportunityRef === opportunity.ref);
      if (existing) return existing;
      const programme = byIdOrRef(this.#store.programmes, body.programmeId);
      const ref = `PRO-2026-${String(this.#store.proposals.length + 200).padStart(4, "0")}`;
      const proposal: Proposal = {
        id: `ent_${ref.toLowerCase().replace(/-/g, "_")}`,
        ref,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: { id: "agent_proposal", name: "Proposal Agent", kind: "AGENT" },
        opportunityRef: opportunity.ref,
        templateId: body.templateId,
        status: "DRAFT",
        value: programme?.listPrice ?? opportunity.value,
        marginRate: 0.4,
        sections: [{ n: 1, title: "Understanding your needs", body: "…" }],
      };
      this.#store.proposals.push(proposal);
      this.events.emit(
        "ProposalDrafted",
        {
          proposalRef: proposal.ref,
          templateId: proposal.templateId,
          agentId: "agent_proposal",
          runId: "run_4821",
          value: proposal.value,
        },
        { id: "agent_proposal", name: "Proposal Agent", kind: "AGENT" },
        NOW,
      );
      return proposal;
    });
  }

  /** §6 every proposal. Same gap as `listTnas`: §13 publishes only the record. */
  async listProposals(page?: PageRequest): Promise<ListResponse<Proposal>> {
    return this.#read(paginate(this.#store.proposals, page));
  }

  async getProposal(id: string): Promise<Proposal> {
    const proposal = byIdOrRef(this.#store.proposals, id);
    if (!proposal) throw notFound("Proposal", id);
    return this.#read(proposal);
  }

  /**
   * §6 appends a section to a proposal.
   *
   * The §13 matrix has no endpoint for this — it publishes
   * `PUT /sections/{n}` and `POST /sections/{n}/regenerate`, both of which
   * need the section to exist already — so the "Add section" control on
   * M07-S02 has nothing to call. Implemented here and reported as a gap.
   *
   * The new section carries **no provenance**, because §1 says absent
   * provenance means human-authored. Stamping one would claim a model wrote
   * something a person typed.
   */
  async addProposalSection(
    id: string,
    body: { title: string; body?: string },
    options: RequestOptions = {},
  ): Promise<Proposal> {
    const proposal = byIdOrRef(this.#store.proposals, id);
    if (!proposal) throw notFound("Proposal", id);
    if (body.title.trim().length === 0) {
      throw validationFailed("A section needs a title.", {
        fields: [{ field: "title", reason: "REQUIRED" }],
      });
    }
    return this.#write(options, { id: proposal.ref, ...body }, 201, () => {
      const nextN = proposal.sections.reduce((highest, section) => Math.max(highest, section.n), 0) + 1;
      proposal.sections.push({
        n: nextN,
        title: body.title,
        ...(body.body === undefined ? {} : { body: body.body }),
      });
      proposal.updatedAt = NOW;
      return proposal;
    });
  }

  async putProposalSection(id: string, n: number, body: ProposalSectionWrite): Promise<Proposal> {
    await sleep(this.#latencyMs);
    const proposal = byIdOrRef(this.#store.proposals, id);
    if (!proposal) throw notFound("Proposal", id);
    const section = proposal.sections.find((candidate) => candidate.n === n);
    if (!section) throw notFound(`Section ${n} of proposal`, id);
    const actor = this.#actor();
    section.body = body.body;
    if (body.title) section.title = body.title;
    section.provenance = {
      ...(section.provenance ?? { origin: "AI_SUGGESTED" }),
      origin: "AI_SUGGESTED",
      editedBy: { id: actor.id, name: actor.name ?? actor.id, at: NOW },
    };
    proposal.updatedAt = NOW;
    this.#lastMeta = { status: 200, headers: {} };
    return proposal;
  }

  async regenerateProposalSection(id: string, n: number): Promise<ProposalSectionRegenerateResponse> {
    await sleep(this.#latencyMs);
    const proposal = byIdOrRef(this.#store.proposals, id);
    if (!proposal) throw notFound("Proposal", id);
    const section = proposal.sections.find((candidate) => candidate.n === n);
    if (!section) throw notFound(`Section ${n} of proposal`, id);
    const runId = `run_${++this.#store.counters.run}`;
    section.body = `${section.body ?? ""} (regenerated)`.trim();
    section.needsReview = false;
    section.provenance = {
      origin: "AI_GENERATED",
      confidence: 0.86,
      agentId: "agent_proposal",
      runId,
      tier: "STRONG_1",
      model: "Claude Sonnet 5",
      provider: "ANTHROPIC",
      generatedAt: NOW,
    };
    proposal.updatedAt = NOW;
    this.events.emit(
      "ProposalDrafted",
      {
        proposalRef: proposal.ref,
        templateId: proposal.templateId,
        agentId: "agent_proposal",
        runId,
        value: proposal.value,
      },
      { id: "agent_proposal", name: "Proposal Agent", kind: "AGENT" },
      NOW,
    );
    this.#lastMeta = { status: 200, headers: {} };
    return { section, runId };
  }

  async getProposalPreview(id: string, format: "HTML" | "PDF" = "HTML"): Promise<ProposalPreview> {
    const proposal = byIdOrRef(this.#store.proposals, id);
    if (!proposal) throw notFound("Proposal", id);
    return this.#read({
      url: `/previews/${proposal.ref}.${format.toLowerCase()}`,
      format,
      expiresAt: "2026-11-15T10:32:00+08:00",
    });
  }

  /**
   * §6 `GET /v1/quotations/{id}`.
   *
   * Restricted to principals holding `quotation:read`; the tenancy design
   * withholds it from OPS, who get `403` with the role that does hold it.
   *
   * The response carries both floors and the derived `bindingFloorBasis`. The
   * contract's `Quotation` has neither, so they are computed here and reported
   * as a gap rather than added to the contract.
   */
  /**
   * §6 every quotation, priced.
   *
   * Gated exactly as `getQuotation` is: the tenancy design withholds
   * `quotation:read` from OPS, and a list that answered where the record
   * refuses would be a way round the gate rather than a convenience. Each row
   * goes through `withFloors`, so `bindingFloorBasis` travels with it and a
   * list row can say which constraint holds the price up without a second read.
   */
  async listQuotations(page?: PageRequest): Promise<ListResponse<Quotation>> {
    this.#requirePermission("quotation:read", "SALES");
    const result = paginate(this.#store.quotations, page);
    return this.#read({
      ...result,
      data: result.data.map((row) => withFloors(row, this.#programmeForQuotation(row))),
    });
  }

  async getQuotation(id: string): Promise<Quotation> {
    this.#requirePermission("quotation:read", "SALES");
    const quotation = byIdOrRef(this.#store.quotations, id);
    if (!quotation) throw notFound("Quotation", id);
    return this.#read(withFloors(quotation, this.#programmeForQuotation(quotation)));
  }

  /**
   * §6 `PUT /v1/quotations/{id}` recalculates server-side and rejects a sell
   * price below the binding floor — the higher of the programme's absolute
   * floor and the margin floor derived from direct cost.
   */
  async putQuotation(id: string, body: QuotationWrite): Promise<Quotation> {
    await sleep(this.#latencyMs);
    this.#requirePermission("quotation:write", "SALES");
    const quotation = byIdOrRef(this.#store.quotations, id);
    if (!quotation) throw notFound("Quotation", id);
    if (body.lines) {
      quotation.lines = body.lines;
      quotation.directCost = myr(
        body.lines.reduce((total: number, line: QuotationLine) => total + line.total.amount, 0),
      );
    }
    const sellPrice = body.sellPrice ?? quotation.sellPrice;
    const programme = this.#programmeForQuotation(quotation);
    const evaluation = evaluateFloors(quotation, sellPrice, programme);
    if (evaluation.breached) {
      this.#lastMeta = { status: 422, headers: {} };
      throw floorPriceBreach(evaluation, sellPrice, programme?.listPricePax ?? 30);
    }
    quotation.sellPrice = sellPrice;
    quotation.marginRate = evaluation.resultingMarginRate;
    quotation.floorPrice = evaluation.floorPrice;
    quotation.commission = myr(Math.round(sellPrice.amount * quotation.commissionRate));
    quotation.updatedAt = NOW;
    this.#lastMeta = { status: 200, headers: {} };
    return withFloors(quotation, programme);
  }

  #programmeForQuotation(quotation: Quotation): Programme | undefined {
    const proposal = byIdOrRef(this.#store.proposals, quotation.proposalRef);
    if (!proposal) return undefined;
    const opportunity = byIdOrRef(this.#store.opportunities, proposal.opportunityRef);
    if (!opportunity) return undefined;
    const engagement = this.#store.engagements.find((row) => row.opportunityRef === opportunity.ref);
    if (engagement) return byIdOrRef(this.#store.programmes, engagement.programmeRef);
    const recommendation = Object.values(this.#store.tnaRecommendations)
      .flatMap((response) => response.data)
      .find((row) => row.priceIndication?.amount === proposal.value.amount);
    return recommendation ? byIdOrRef(this.#store.programmes, recommendation.programmeId) : undefined;
  }

  /** §18 the rate card. Placeholder until Finance supplies the numbers. */
  async getRateCard(): Promise<RateCard> {
    return this.#read(this.#store.rateCard);
  }

  /* ---------------------------------------------------------------- *
   * §7 · Approvals
   * ---------------------------------------------------------------- */

  async listApprovals(page?: PageRequest & { group?: "URGENCY" }): Promise<ApprovalListResponse> {
    const view = page?.view ? this.#store.savedViews.find((candidate) => candidate.id === page.view) : undefined;
    const result = paginate(this.#store.approvals, page ?? {}, view);
    const groups: ApprovalGroup[] = (["BREACHING", "TODAY", "THIS_WEEK", "LATER"] as const)
      .map((key) => ({ key, count: result.data.filter((row) => row.urgencyGroup === key).length }))
      .filter((group) => group.count > 0);
    return this.#read({
      data: result.data.map(toApprovalRow),
      page: result.page,
      groups,
      summary: approvalsSummary,
    });
  }

  async getApproval(id: string): Promise<ApprovalDetail> {
    const approval = byIdOrRef(this.#store.approvals, id);
    if (!approval) throw notFound("Approval", id);
    return this.#read(approval);
  }

  /**
   * §7 `effects[]` must equal the `diff[]` the detail screen rendered.
   *
   * A decision on an approval that is no longer pending is `409` — the demo's
   * stand-in for the diff having moved under the approver.
   */
  async decideApproval(
    id: string,
    body: ApprovalDecideRequest,
    options: RequestOptions = {},
  ): Promise<ApprovalDecideResponse> {
    const approval = byIdOrRef(this.#store.approvals, id);
    if (!approval) throw notFound("Approval", id);
    if ((body.decision === "REJECT" || body.decision === "REQUEST_CHANGES") && !body.note) {
      throw validationFailed("A note is required to reject or request changes.", {
        fields: [{ field: "note", reason: "REQUIRED" }],
      });
    }
    return this.#write(options, { id: approval.id, ...body }, 200, () => {
      if (approval.status !== "PENDING") {
        throw new ContractError(
          "AGENT_PAUSED",
          `${approval.ref} was already decided; the diff no longer applies.`,
          { diffChanged: true, diff: approval.diff },
        );
      }
      const decidedBy = this.#actor();
      const effects: Effect[] = body.decision === "APPROVE" ? approval.diff.map(toEffect) : [];
      approval.status =
        body.decision === "APPROVE"
          ? "APPROVED"
          : body.decision === "REJECT"
            ? "REJECTED"
            : "CHANGES_REQUESTED";
      if (body.decision === "APPROVE") this.#applyApprovedAction(approval);
      this.#store.badgeCounts.approvals = this.#store.approvals.filter(
        (row) => row.status === "PENDING",
      ).length;
      this.events.emit(
        "ApprovalDecided",
        {
          approvalRef: approval.ref,
          decision: body.decision,
          decidedBy,
          decidedAt: NOW,
          effects,
        },
        decidedBy,
        NOW,
      );
      this.events.publish("approvals", {
        event: "DECIDED",
        approvalRef: approval.ref,
        urgencyGroup: approval.urgencyGroup,
        slaBreached: approval.slaBreached,
      });
      this.events.publish("badges", this.#store.badgeCounts);
      return {
        status: approval.status,
        decidedBy: { id: decidedBy.id, name: decidedBy.name ?? decidedBy.id, kind: "HUMAN" },
        decidedAt: NOW,
        effects,
      };
    });
  }

  /** §7 `409` if any id carries a monetary value, i.e. `bulkApprovable: false`. */
  async bulkDecideApprovals(
    body: ApprovalBulkDecideRequest,
    options: RequestOptions = {},
  ): Promise<ApprovalBulkDecideResponse> {
    return this.#write(options, body, 200, () => {
      const rows = body.ids.map((id) => {
        const approval = byIdOrRef(this.#store.approvals, id);
        if (!approval) throw notFound("Approval", id);
        return approval;
      });
      const blocked = rows.filter((approval) => !approval.bulkApprovable);
      if (blocked.length > 0) {
        throw new ContractError(
          "AGENT_PAUSED",
          "One or more selected approvals carry a monetary value and must be decided individually.",
          { blockers: blocked.map((approval) => approval.ref) },
        );
      }
      const decidedBy = this.#actor();
      const results = rows.map((approval) => {
        const effects: Effect[] = body.decision === "APPROVE" ? approval.diff.map(toEffect) : [];
        approval.status =
          body.decision === "APPROVE"
            ? "APPROVED"
            : body.decision === "REJECT"
              ? "REJECTED"
              : "CHANGES_REQUESTED";
        if (body.decision === "APPROVE") this.#applyApprovedAction(approval);
        this.events.emit(
          "ApprovalDecided",
          { approvalRef: approval.ref, decision: body.decision, decidedBy, decidedAt: NOW, effects },
          decidedBy,
          NOW,
        );
        return { id: approval.id, ref: approval.ref, status: approval.status, effects };
      });
      this.#store.badgeCounts.approvals = this.#store.approvals.filter(
        (row) => row.status === "PENDING",
      ).length;
      this.events.publish("badges", this.#store.badgeCounts);
      return { results };
    });
  }

  /** Applies the state change an approved approval promised in its diff. */
  #applyApprovedAction(approval: FixtureApproval): void {
    switch (approval.actionType) {
      case "PROPOSAL_SEND": {
        const proposal = byIdOrRef(this.#store.proposals, approval.targetRef);
        if (proposal) {
          proposal.status = "SENT";
          proposal.updatedAt = NOW;
          const opportunity = byIdOrRef(this.#store.opportunities, proposal.opportunityRef);
          if (opportunity) opportunity.stage = "PROPOSAL_SENT";
          this.events.emit(
            "ProposalSent",
            { proposalRef: proposal.ref, channel: "EMAIL", to: ["nurul.hassan@auroramfg.com.my"], sentAt: NOW },
            this.#actor(),
            NOW,
          );
        }
        break;
      }
      case "ATTENDANCE_APPROVE": {
        const sheet = this.#store.attendanceSheets[`${approval.targetRef}::2`];
        if (sheet) this.#lockAttendance(sheet);
        break;
      }
      case "RULE_CHANGE_APPROVE": {
        this.#approveRuleChanges(approval.targetRef);
        break;
      }
      case "ACCOUNT_TRADING_HOLD": {
        const organisation = byIdOrRef(this.#store.organisations, approval.targetRef);
        if (organisation) {
          organisation.status = "DORMANT";
          organisation.updatedAt = NOW;
          this.events.emit(
            "AccountTradingHoldApplied",
            {
              organisationRef: organisation.ref,
              invoiceRefs: this.#store.receivables
                .filter((row) => row.organisation.ref === organisation.ref)
                .map((row) => row.invoiceRef),
              appliedBy: this.#actor(),
              approvalRef: approval.ref,
            },
            this.#actor(),
            NOW,
          );
        }
        break;
      }
      case "DISCOUNT_APPROVE": {
        const quotation = byIdOrRef(this.#store.quotations, approval.targetRef);
        if (quotation && approval.value) {
          quotation.sellPrice = approval.value;
          quotation.marginRate = approval.marginRate ?? quotation.marginRate;
          quotation.updatedAt = NOW;
        }
        break;
      }
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- *
   * §8 · Engagements, participants, attendance
   * ---------------------------------------------------------------- */

  async listEngagements(page?: PageRequest): Promise<ListResponse<Engagement>> {
    const result = paginate(this.#store.engagements, page);
    return this.#read({ ...result, data: result.data.map((row) => this.#projectEngagement(row)) });
  }

  /**
   * §8 `GET /v1/engagements/{id}`, projected for the caller.
   *
   * The tenancy design withholds commercial pricing from OPS, so the OPS
   * projection drops the `finance` block entirely rather than zeroing it — a
   * missing field is honest, a zero is a lie. The contract types `finance` as
   * required, which is why the projection has its own type; reported as a gap.
   */
  async getEngagement(id: string): Promise<Engagement> {
    const engagement = byIdOrRef(this.#store.engagements, id);
    if (!engagement) throw notFound("Engagement", id);
    return this.#read(this.#projectEngagement(engagement));
  }

  #projectEngagement(engagement: Engagement): Engagement {
    if (permissionsFor(this.#actorId).includes("quotation:read")) return engagement;
    const { finance: _finance, ...withoutFinance } = engagement;
    return withoutFinance;
  }

  async getEngagementParticipants(id: string, page?: PageRequest): Promise<ListResponse<Participant>> {
    const engagement = byIdOrRef(this.#store.engagements, id);
    if (!engagement) throw notFound("Engagement", id);
    const rows = this.#store.participants.filter((row) => row.engagementRef === engagement.ref);
    return this.#read(paginate(rows, page ?? { page: { size: 50 } }));
  }

  async getAttendance(id: string, day = 1): Promise<AttendanceSheet> {
    const engagement = byIdOrRef(this.#store.engagements, id);
    if (!engagement) throw notFound("Engagement", id);
    const sheet = this.#store.attendanceSheets[`${engagement.ref}::${day}`];
    if (!sheet) throw notFound(`Attendance day ${day} for`, engagement.ref);
    return this.#read(sheet);
  }

  /** §8 approved attendance is immutable: capture on a locked day is `409`. */
  async captureAttendance(
    id: string,
    day: number,
    body: AttendanceCaptureRequest,
  ): Promise<AttendanceSheet> {
    await sleep(this.#latencyMs);
    const engagement = byIdOrRef(this.#store.engagements, id);
    if (!engagement) throw notFound("Engagement", id);
    const sheet = this.#store.attendanceSheets[`${engagement.ref}::${day}`];
    if (!sheet) throw notFound(`Attendance day ${day} for`, engagement.ref);
    if (sheet.status === "LOCKED") {
      this.#lastMeta = { status: 409, headers: {} };
      throw new ContractError(
        "ATTENDANCE_LOCKED",
        `Attendance for ${engagement.ref} day ${day} was approved on 14 Nov 2026 and cannot be modified.`,
        {
          approvedAt: sheet.approvedAt ?? NOW,
          unlockPath: "/v1/actions",
          unlockActionType: "ATTENDANCE_UNLOCK",
        },
      );
    }
    const row = sheet.rows.find((candidate) => candidate.participantRef === body.participantRef);
    if (!row) throw notFound("Participant", body.participantRef);
    const mark = body.session === "AM" ? row.am : row.pm;
    mark.present = body.present;
    mark.method = body.method;
    if (body.present) {
      mark.at = NOW;
      delete mark.reason;
    } else if (body.reason) {
      mark.reason = body.reason;
      delete mark.at;
    }
    sheet.summary.presentAm = sheet.rows.filter((candidate) => candidate.am.present).length;
    sheet.summary.presentPm = sheet.rows.filter((candidate) => candidate.pm.present).length;
    this.#lastMeta = { status: 200, headers: {} };
    return sheet;
  }

  async exportAttendance(id: string, format = "HRDC"): Promise<AttendanceExport> {
    const engagement = byIdOrRef(this.#store.engagements, id);
    if (!engagement) throw notFound("Engagement", id);
    return this.#read({
      url: `/exports/${engagement.ref}-attendance-${format.toLowerCase()}.xlsx`,
      expiresAt: "2026-11-15T10:32:00+08:00",
    });
  }

  #lockAttendance(sheet: AttendanceSheet): void {
    sheet.status = "LOCKED";
    sheet.immutable = true;
    sheet.approvedBy = this.#actor();
    sheet.approvedAt = NOW;
    sheet.captureModes = { qr: false, signature: false, manual: false };
    this.events.emit(
      "AttendanceLocked",
      {
        engagementRef: sheet.engagementRef,
        day: sheet.day,
        approvedBy: this.#actor(),
        approvedAt: NOW,
        present: sheet.summary.presentAm,
        total: sheet.summary.registered,
      },
      this.#actor(),
      NOW,
    );
  }

  /* ---------------------------------------------------------------- *
   * §9 · HRD Corp and finance
   * ---------------------------------------------------------------- */

  async getClaimPacket(engagementRef: string): Promise<ClaimPacket> {
    const packet = this.#store.claimPackets.find(
      (row) => row.engagementRef === engagementRef || row.id === engagementRef,
    );
    if (!packet) throw notFound("Claim packet for", engagementRef);
    return this.#read(packet);
  }

  async attachPacketDocument(id: string, body: HrdcDocumentAttachRequest): Promise<ClaimPacket> {
    await sleep(this.#latencyMs);
    const packet = this.#store.claimPackets.find((row) => row.id === id || row.engagementRef === id);
    if (!packet) throw notFound("Claim packet", id);
    const document = packet.requiredDocuments.find((row) => row.type === body.type);
    if (!document) throw notFound(`Required document ${body.type} on packet`, id);
    document.status = "PRESENT";
    if (body.ref) document.ref = body.ref;
    const present = packet.requiredDocuments.filter((row) => row.status === "PRESENT").length;
    packet.completeness = Math.round((present / packet.requiredDocuments.length) * 100) / 100;
    if (packet.completeness === 1) {
      packet.status = "READY";
      this.events.emit(
        "HRDCPacketReady",
        {
          engagementRef: packet.engagementRef,
          scheme: packet.scheme,
          claimValue: packet.claimValue,
          deadlineAt: packet.deadlineAt,
        },
        this.#actor(),
        NOW,
      );
    }
    this.#lastMeta = { status: 200, headers: {} };
    return packet;
  }

  async exportClaimPacket(id: string): Promise<HrdcPacketExport> {
    const packet = this.#store.claimPackets.find((row) => row.id === id || row.engagementRef === id);
    if (!packet) throw notFound("Claim packet", id);
    return this.#read({
      url: `/exports/${packet.engagementRef}-etris-bundle.zip`,
      expiresAt: "2026-11-15T10:32:00+08:00",
    });
  }

  async listHrdcDeadlines(page?: PageRequest): Promise<ListResponse<HrdcDeadline>> {
    return this.#read(paginate(this.#store.hrdcDeadlines, page ?? { sort: "daysRemaining" }));
  }

  /**
   * §9 + §18 `POST /v1/invoices`.
   *
   * Rejects a payload whose total does not equal the sum of its rounded lines
   * with `details.reason: "TOTAL_NOT_RECONCILED"`.
   */
  async createInvoice(body: Omit<Invoice, keyof { id: 1; ref: 1; createdAt: 1; updatedAt: 1; createdBy: 1 }> & Partial<Pick<Invoice, "ref">>, options: RequestOptions = {}): Promise<Invoice> {
    const reconciliation = reconcileInvoice(body);
    if (!reconciliation.reconciled) {
      await sleep(this.#latencyMs);
      this.#lastMeta = { status: 422, headers: {} };
      throw validationFailed("Invoice total does not reconcile to the sum of its rounded lines.", {
        reason: "TOTAL_NOT_RECONCILED",
        expectedSubtotal: reconciliation.expectedSubtotal,
        expectedTotal: reconciliation.expectedTotal,
        fields: reconciliation.offendingLines.map((index) => ({
          field: `lines[${index}].amount`,
          reason: "LINE_TOTAL_MISMATCH",
        })),
      });
    }
    return this.#write(options, body, 201, () => {
      const ref = body.ref ?? `INV-2026-${String(++this.#store.counters.invoice).padStart(4, "0")}`;
      const invoice: Invoice = {
        ...(body as Omit<Invoice, "id" | "ref" | "createdAt" | "updatedAt" | "createdBy">),
        id: `ent_${ref.toLowerCase().replace(/-/g, "_")}`,
        ref,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: this.#actor() as Invoice["createdBy"],
      };
      this.#store.invoices.push(invoice);
      this.events.emit(
        "InvoicePushed",
        { invoiceRef: invoice.ref, provider: "ACCOUNTING", documentId: `ACC-${invoice.ref}`, at: NOW },
        this.#actor(),
        NOW,
      );
      this.events.publish("invoices", { invoiceRef: invoice.ref, syncState: invoice.sync.state });
      return invoice;
    });
  }

  async listInvoices(page?: PageRequest): Promise<ListResponse<Invoice>> {
    return this.#read(paginate(this.#store.invoices, page));
  }

  async getInvoice(id: string): Promise<Invoice> {
    const invoice = byIdOrRef(this.#store.invoices, id);
    if (!invoice) throw notFound("Invoice", id);
    return this.#read(invoice);
  }

  async recordPayment(
    id: string,
    body: PaymentRecordRequest,
    options: RequestOptions = {},
  ): Promise<Invoice> {
    const invoice = byIdOrRef(this.#store.invoices, id);
    if (!invoice) throw notFound("Invoice", id);
    return this.#write(options, { id: invoice.ref, ...body }, 201, () => {
      invoice.payments.push({
        id: `pay_${++this.#store.counters.payment}`,
        at: body.at,
        amount: body.amount,
        ...(body.method ? { method: body.method } : {}),
        ...(body.reference ? { reference: body.reference } : {}),
      });
      const paid = invoice.payments.reduce((total, payment) => total + payment.amount.amount, 0);
      invoice.outstanding = myr(Math.max(0, invoice.total.amount - paid));
      invoice.status = invoice.outstanding.amount === 0 ? "PAID" : "PARTIALLY_PAID";
      invoice.updatedAt = NOW;
      return invoice;
    });
  }

  async getReceivablesAging(): Promise<ReceivablesAging> {
    return this.#read(this.#store.receivablesAging);
  }

  async listReceivables(page?: PageRequest): Promise<ListResponse<Receivable>> {
    return this.#read(paginate(this.#store.receivables, page ?? { sort: "-daysOverdue" }));
  }

  /**
   * §9 `GET /v1/collections/queue`.
   *
   * The last rung is the ruled `ACCOUNT_TRADING_HOLD`. Ruling R7 widened
   * `CollectionNextAction.type` to `AnyActionType` so the contract's own
   * `Receivable` can hold it; the fixture widening it needed before is gone.
   */
  async getCollectionsQueue(page?: PageRequest): Promise<CollectionsQueueResponse> {
    const result = paginate(this.#store.receivables, page ?? { sort: "-daysOverdue" });
    return this.#read({ data: result.data, aging: this.#store.receivablesAging, page: result.page });
  }

  async getCollectionDraft(invoiceRef: string): Promise<MessageDraft> {
    const draft = this.#store.collectionDrafts[invoiceRef];
    if (!draft) throw notFound("Collections draft for", invoiceRef);
    return this.#read(draft);
  }

  async getCollectionRules(): Promise<ListResponse<CollectionRule>> {
    return this.#read(paginate(this.#store.collectionRules));
  }

  /**
   * Sales commission accruals — the Finance › Commissions leaf.
   *
   * Not a contract endpoint: the contract puts commission ON a quotation and a
   * rate table on the rate card, and never declares the collection. The rows
   * are derived in `data/commissions.ts`, where the derivation is written out.
   *
   * Gated on `quotation:read` for the same reason `getQuotation` is: a
   * commission row restates a quotation's sell price and its commission rate,
   * so serving it to a principal who may not read the quotation would route
   * around the §6 permission rather than enforce it.
   */
  async listCommissions(page?: PageRequest): Promise<ListResponse<FixtureCommission>> {
    this.#requirePermission("quotation:read", "FINANCE");
    return this.#read(paginate(this.#store.commissions, page ?? { sort: "-amount.amount" }));
  }

  /* ---------------------------------------------------------------- *
   * §10 · Agents, runs, dashboards
   * ---------------------------------------------------------------- */

  async listAgents(): Promise<AgentRegistryResponse> {
    return this.#read({ data: this.#store.agents, summary: this.#store.agentRegistrySummary });
  }

  async getAgent(id: string): Promise<Agent> {
    const agent = this.#store.agents.find((candidate) => candidate.id === id);
    if (!agent) throw notFound("Agent", id);
    return this.#read(agent);
  }

  /** §10 setting a money-moving action type to AUTONOMOUS is a 422, by design. */
  async putAgentAutonomy(id: string, body: AgentAutonomyWrite): Promise<Agent> {
    await sleep(this.#latencyMs);
    const agent = this.#store.agents.find((candidate) => candidate.id === id);
    if (!agent) throw notFound("Agent", id);
    if (roleFor(this.#actorId) !== "MD") {
      throw forbidden("Autonomy promotions are decided by the MD.", { requiredRole: "MD" });
    }
    const grant = agent.autonomy.find((candidate) => candidate.actionType === body.actionType);
    if (!grant) throw notFound(`Grant for ${body.actionType} on agent`, id);
    if (body.level === "AUTONOMOUS" && grant.ceilingReason === "MONEY_MOVING") {
      this.#lastMeta = { status: 422, headers: {} };
      throw validationFailed(
        `${body.actionType} moves money and cannot exceed act-with-approval.`,
        { reason: "MONEY_MOVING_CEILING" },
      );
    }
    grant.level = body.level;
    this.#lastMeta = { status: 200, headers: {} };
    return agent;
  }

  async pauseAgent(id: string, body: AgentPauseRequest, options: RequestOptions = {}): Promise<Agent> {
    const agent = this.#store.agents.find((candidate) => candidate.id === id);
    if (!agent) throw notFound("Agent", id);
    return this.#write(options, { id, ...body }, 200, () => {
      if (body.actionType === null) {
        agent.status = "PAUSED";
        agent.pausedAt = NOW;
        agent.pausedReason = "MANUAL_PAUSE";
        for (const grant of agent.autonomy) grant.paused = true;
      } else {
        const grant = agent.autonomy.find((candidate) => candidate.actionType === body.actionType);
        if (!grant) throw notFound(`Grant for ${body.actionType} on agent`, id);
        grant.paused = true;
      }
      return agent;
    });
  }

  async listEvals(agentId?: string): Promise<ListResponse<AgentEval>> {
    const rows = agentId
      ? this.#store.agentEvals.filter((row) => row.agentId === agentId)
      : this.#store.agentEvals;
    return this.#read(paginate(rows));
  }

  async listRuns(page?: PageRequest): Promise<ListResponse<AutomationRun>> {
    return this.#read(paginate(this.#store.runs, page ?? { sort: "-startedAt" }));
  }

  async getRun(id: string): Promise<AutomationRun> {
    const run = this.#store.runs.find((candidate) => candidate.id === id || candidate.ref === id);
    if (!run) throw notFound("Run", id);
    return this.#read(run);
  }

  /** §17 `?from=checkpoint` resumes from the last checkpoint using the state card. */
  async retryRun(id: string, from?: "checkpoint"): Promise<AutomationRun> {
    await sleep(this.#latencyMs);
    const run = this.#store.runs.find((candidate) => candidate.id === id || candidate.ref === id);
    if (!run) throw notFound("Run", id);
    const retryId = `run_${++this.#store.counters.run}`;
    const retry: AutomationRun = {
      ...run,
      id: retryId,
      ref: `#${retryId.replace("run_", "")}`,
      startedAt: NOW,
      status: "SUCCEEDED",
      outcome: from === "checkpoint" ? "RESUMED_FROM_CHECKPOINT" : "RETRIED",
      ...(run.failure ? { failure: { ...run.failure, deadLettered: false } } : {}),
    };
    this.#store.runs.push(retry);
    this.events.emit(
      "AgentRunCompleted",
      {
        runId: retry.id,
        agentId: retry.agentId,
        status: retry.status,
        durationMs: retry.durationMs,
        cost: retry.cost,
        outcome: retry.outcome ?? "RETRIED",
      },
      { id: retry.agentId, name: retry.agentId, kind: "AGENT" },
      NOW,
    );
    this.#lastMeta = { status: 202, headers: {} };
    return retry;
  }

  async deadLetterRun(
    id: string,
    body: RunDeadLetterRequest,
    options: RequestOptions = {},
  ): Promise<AutomationRun> {
    const run = this.#store.runs.find((candidate) => candidate.id === id || candidate.ref === id);
    if (!run) throw notFound("Run", id);
    return this.#write(options, { id, ...body }, 200, () => {
      run.status = "FAILED";
      run.failure = {
        code: run.failure?.code ?? "MANUAL_DEAD_LETTER",
        message: body.reason,
        attempts: run.failure?.attempts ?? 1,
        retryable: false,
        deadLettered: true,
      };
      this.events.emit(
        "AgentRunFailed",
        {
          runId: run.id,
          agentId: run.agentId,
          failureCode: run.failure.code,
          attempts: run.failure.attempts,
          deadLettered: true,
        },
        { id: run.agentId, name: run.agentId, kind: "AGENT" },
        NOW,
      );
      return run;
    });
  }

  async replayRun(id: string, mode: "SANDBOX" = "SANDBOX"): Promise<RunReplayResponse> {
    const run = this.#store.runs.find((candidate) => candidate.id === id || candidate.ref === id);
    if (!run) throw notFound("Run", id);
    const sandboxId = `run_${++this.#store.counters.run}_sandbox`;
    return this.#read({ runId: sandboxId, mode }, 202);
  }

  async getExecutiveDashboard(period = "2026-11"): Promise<ExecutiveDashboard> {
    const dashboard = this.#store.executiveDashboards[period];
    if (!dashboard) throw notFound("Dashboard for period", period);
    return this.#read(dashboard);
  }

  async getMetric(key: string, scope?: string, id?: string): Promise<MetricResponse> {
    const scoped = scope && id ? this.#store.metricResponses[`${key}::${scope}::${id}`] : undefined;
    const metric = scoped ?? this.#store.metricResponses[key];
    if (!metric) throw notFound("Metric", key);
    return this.#read(metric);
  }

  async getProposalsVsWon(months = 6): Promise<ProposalsVsWonReport> {
    return this.#read({ series: this.#store.proposalsVsWon.series.slice(-months) });
  }

  /** §18 the tile must render `basis`; it may not display a bare number. */
  async getHoursSaved(): Promise<HoursSavedReport> {
    return this.#read(this.#store.hoursSaved);
  }

  /* ---------------------------------------------------------------- *
   * §11 · Client portal, realtime, webhooks
   * ---------------------------------------------------------------- */

  async getPortalProposal(token: string): Promise<PortalProposal> {
    const proposal = this.#store.portalProposals[token];
    if (!proposal) throw notFound("Portal proposal for token", token);
    return this.#read(proposal);
  }

  async addPortalComment(token: string, body: PortalCommentRequest): Promise<PortalProposal> {
    await sleep(this.#latencyMs);
    const proposal = this.#store.portalProposals[token];
    if (!proposal) throw notFound("Portal proposal for token", token);
    proposal.comments.push({ author: body.author, authorKind: "CLIENT", at: NOW, body: body.body });
    this.#lastMeta = { status: 201, headers: {} };
    return proposal;
  }

  /** §11 idempotent by token: a second accept returns the original acceptance. */
  async acceptPortalProposal(
    token: string,
    body: PortalAcceptRequest,
    options: RequestOptions = {},
  ): Promise<PortalAcceptResponse> {
    const portal = this.#store.portalProposals[token];
    if (!portal) throw notFound("Portal proposal for token", token);
    return this.#write(options, { token, ...body }, 200, () => {
      const organisationRef = portalTokenOrganisation[token];
      const existing = this.#store.engagements.find(
        (row) => row.organisationRef === organisationRef && row.status !== "CANCELLED",
      );
      if (portal.acceptance) {
        return {
          engagementRef: existing?.ref ?? "ENG-0231",
          acceptedAt: portal.acceptance.acceptedAt,
          signatureRef: portal.acceptance.signatureRef,
        };
      }
      const signatureRef = `sig_${token.slice(-4)}`;
      portal.acceptance = {
        acceptedBy: body.name,
        role: body.role,
        acceptedAt: NOW,
        signatureRef,
      };
      portal.status = "ACCEPTED";
      const engagementRef = existing?.ref ?? "ENG-0231";
      this.events.emit(
        "ProposalAccepted",
        { proposalRef: portal.ref, acceptedBy: body.name, acceptedAt: NOW, engagementRef },
        { id: "portal", name: body.name, kind: "CLIENT" },
        NOW,
      );
      return { engagementRef, acceptedAt: NOW, signatureRef };
    });
  }

  async submitPortalTna(token: string, body: PortalTnaSubmitRequest): Promise<Tna> {
    await sleep(this.#latencyMs);
    const tna = this.#store.tnas.find((row) => row.status === "SENT") ?? this.#store.tnas[0];
    if (!tna) throw notFound("TNA for token", token);
    tna.status = "COMPLETE";
    tna.completedAt = NOW;
    tna.completedBy = { id: "c_portal", name: body.completedBy.name, kind: "CLIENT" };
    this.events.emit(
      "TNACompleted",
      {
        tnaRef: tna.ref,
        opportunityRef: tna.opportunityRef,
        completedBy: tna.completedBy,
        completedAt: NOW,
      },
      tna.completedBy,
      NOW,
    );
    this.#lastMeta = { status: 200, headers: {} };
    return tna;
  }

  /** §11 the accounting callback, idempotent on `provider + documentId + state`. */
  async accountingWebhook(
    payload: AccountingWebhookPayload,
  ): Promise<WebhookDuplicateResponse | Invoice> {
    await sleep(this.#latencyMs);
    const key = `${payload.provider}:${payload.documentId}:${payload.state}`;
    if (this.#store.idempotency.has(key)) {
      this.#lastMeta = { status: 200, headers: {} };
      return { status: "IGNORED_DUPLICATE" };
    }
    this.#store.idempotency.set(key, { bodyHash: stableStringify(payload), response: null, at: NOW });
    const invoice = byIdOrRef(this.#store.invoices, payload.externalRef);
    if (!invoice) throw notFound("Invoice", payload.externalRef);
    invoice.sync.state = payload.state;
    invoice.sync.lastAttemptAt = payload.at;
    if (payload.uin) invoice.sync.uin = payload.uin;
    invoice.syncLog.push({
      at: payload.at,
      state: payload.state,
      ...(payload.uin ? { uin: payload.uin } : {}),
    });
    if (payload.state === "VALIDATED" && payload.uin) {
      this.events.emit(
        "InvoiceValidated",
        { invoiceRef: invoice.ref, uin: payload.uin, at: payload.at },
        { id: "sys_webhook", name: "Accounting webhook", kind: "SYSTEM" },
        payload.at,
      );
    }
    this.events.publish("invoices", { invoiceRef: invoice.ref, syncState: payload.state });
    this.#lastMeta = { status: 200, headers: {} };
    return invoice;
  }

  /* ---------------------------------------------------------------- *
   * §17 · Model tiers and routing
   * ---------------------------------------------------------------- */

  async getAiTiers(): Promise<ListResponse<ModelTier>> {
    return this.#read(paginate(this.#store.modelTiers, { page: { size: 50 } }));
  }

  async putAiTier(key: string, body: ModelTierWrite): Promise<ModelTier> {
    await sleep(this.#latencyMs);
    const tier = this.#store.modelTiers.find((candidate) => candidate.key === key);
    if (!tier) throw notFound("Tier", key);
    if (roleFor(this.#actorId) !== "ADMIN") {
      throw forbidden("Tier configuration is restricted to ADMIN.", { requiredRole: "ADMIN" });
    }
    Object.assign(tier, body);
    this.#lastMeta = { status: 200, headers: {} };
    return tier;
  }

  async getAiRouting(): Promise<RoutingResponse> {
    return this.#read({
      data: this.#store.routingEntries,
      unsavedChanges: this.#store.routingUnsavedChanges,
    });
  }

  /** §17 applies to future runs only — never retroactive. */
  async putAiRouting(entries: RoutingEntry[]): Promise<RoutingResponse> {
    await sleep(this.#latencyMs);
    if (roleFor(this.#actorId) !== "ADMIN") {
      throw forbidden("Routing changes are restricted to ADMIN.", { requiredRole: "ADMIN" });
    }
    for (const entry of entries) {
      const existing = this.#store.routingEntries.find((row) => row.actionType === entry.actionType);
      if (existing) Object.assign(existing, entry);
      else this.#store.routingEntries.push(entry);
    }
    this.#store.routingUnsavedChanges = 0;
    this.#lastMeta = { status: 200, headers: {} };
    return { data: this.#store.routingEntries, unsavedChanges: 0 };
  }

  /* ---------------------------------------------------------------- *
   * §17 · Provider keys (BYOK)
   * ---------------------------------------------------------------- */

  async listProviders(): Promise<ListResponse<ProviderKey>> {
    return this.#read(paginate(this.#store.providerKeys, { page: { size: 50 } }));
  }

  /** §17 the key is write-only; the response is the masked record. */
  async createProvider(body: ProviderKeyCreateRequest, options: RequestOptions = {}): Promise<ProviderKey> {
    return this.#write(options, { ...body, key: "***" }, 201, () => {
      const record: ProviderKey = {
        id: `prv_${body.provider.toLowerCase()}_${this.#store.providerKeys.length + 1}`,
        provider: body.provider,
        label: body.label,
        status: "VALID",
        maskedKey: `${body.key.slice(0, 6)}••••••••••••${body.key.slice(-4)}`,
        scopeTiers: body.scopeTiers,
        spendMonth: myr(0),
        ...(body.cap ? { cap: body.cap } : {}),
        ...(body.rotationDate ? { rotationDate: body.rotationDate } : {}),
        billingOwner: body.billingOwner,
        region: body.region,
        lastTestedAt: NOW,
        addedBy: { id: this.#actorId, name: this.#actor().name ?? this.#actorId, at: NOW },
      };
      this.#store.providerKeys.push(record);
      return record;
    });
  }

  async testProvider(id: string): Promise<ProviderKeyTestResponse> {
    await sleep(this.#latencyMs);
    const provider = this.#store.providerKeys.find((candidate) => candidate.id === id);
    if (!provider) throw notFound("Provider key", id);
    provider.lastTestedAt = NOW;
    this.#lastMeta = { status: 200, headers: {} };
    return {
      status: provider.status,
      lastTestedAt: NOW,
      ...(provider.status === "INVALID"
        ? { message: `Key rejected by ${provider.provider}; ${provider.activeFallbackTier} is carrying its traffic.` }
        : {}),
    };
  }

  async rotateProvider(id: string, body: ProviderKeyRotateRequest): Promise<ProviderKey> {
    await sleep(this.#latencyMs);
    const provider = this.#store.providerKeys.find((candidate) => candidate.id === id);
    if (!provider) throw notFound("Provider key", id);
    provider.maskedKey = `${body.key.slice(0, 6)}••••••••••••${body.key.slice(-4)}`;
    provider.status = "VALID";
    provider.lastTestedAt = NOW;
    delete provider.invalidSince;
    delete provider.activeFallbackTier;
    this.#lastMeta = { status: 200, headers: {} };
    return provider;
  }

  /** §17 returns the key once and writes `ProviderKeyRevealed`. */
  async revealProvider(id: string): Promise<ProviderKeyRevealResponse> {
    await sleep(this.#latencyMs);
    const provider = this.#store.providerKeys.find((candidate) => candidate.id === id);
    if (!provider) throw notFound("Provider key", id);
    if (roleFor(this.#actorId) !== "ADMIN") {
      throw forbidden("Revealing a provider key is restricted to ADMIN.", { requiredRole: "ADMIN" });
    }
    this.events.emit(
      "ProviderKeyRevealed",
      { providerId: provider.id, actor: this.#actor(), at: NOW },
      this.#actor(),
      NOW,
    );
    this.#lastMeta = { status: 200, headers: {} };
    return { key: `${provider.maskedKey.split("•")[0] ?? "sk-"}revealed-once`, revealedAt: NOW };
  }

  /** §17 `409` if a tier would be left without a key. */
  async deleteProvider(id: string): Promise<void> {
    await sleep(this.#latencyMs);
    const index = this.#store.providerKeys.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw notFound("Provider key", id);
    const provider = this.#store.providerKeys[index];
    if (!provider) throw notFound("Provider key", id);
    const orphaned = provider.scopeTiers.filter(
      (tier) =>
        !this.#store.providerKeys.some(
          (candidate) => candidate.id !== id && candidate.scopeTiers.includes(tier),
        ),
    );
    if (orphaned.length > 0) {
      this.#lastMeta = { status: 409, headers: {} };
      throw new ContractError(
        "AGENT_PAUSED",
        `Removing this key would leave ${orphaned.join(", ")} without a provider.`,
        { blockers: orphaned },
      );
    }
    this.#store.providerKeys.splice(index, 1);
    this.#lastMeta = { status: 204, headers: {} };
  }

  /* ---------------------------------------------------------------- *
   * §17 · Usage and budgets
   * ---------------------------------------------------------------- */

  async getUsage(period = "2026-11", groupBy: "TIER" | "AGENT" | "ACTION_TYPE" = "TIER"): Promise<UsageResponse> {
    const usage = this.#store.usageByGrouping[`${period}::${groupBy}`];
    if (!usage) throw notFound("Usage for", `${period} grouped by ${groupBy}`);
    return this.#read(usage);
  }

  /**
   * §17 ruled R13 · the peak / off-peak series behind the M20-S16 chart.
   *
   * `UsageTotals.offPeakShare` is one number for the month, and the screen
   * explains it as a routing outcome rather than a coincidence. A scalar
   * cannot show that — a share that fell because one week routed badly reads
   * exactly like one that fell because volume moved.
   */
  async getUsageDaily(period = "2026-11"): Promise<UsageDailySeries> {
    if (this.#store.usageDaily.period !== period) throw notFound("Daily usage for period", period);
    return this.#read(this.#store.usageDaily);
  }

  async getUsageForecast(period = "2026-11"): Promise<UsageForecast> {
    if (this.#store.usageForecast.period !== period) throw notFound("Forecast for period", period);
    return this.#read(this.#store.usageForecast);
  }

  async getBudgets(): Promise<ListResponse<Budget>> {
    return this.#read(paginate(this.#store.budgets, { page: { size: 50 } }));
  }

  /** §17 raising a cap is MD-gated; it goes through `BUDGET_CAP_RAISE`. */
  async putBudget(scope: Budget["scope"], key: string, body: BudgetWrite): Promise<Budget> {
    await sleep(this.#latencyMs);
    const budget = this.#store.budgets.find((row) => row.scope === scope && row.key === key);
    if (!budget) throw notFound("Budget", `${scope}/${key}`);
    if (body.cap.amount > budget.cap.amount && roleFor(this.#actorId) !== "MD") {
      throw forbidden("Raising a spend cap is decided by the MD.", { requiredRole: "MD" });
    }
    budget.cap = body.cap;
    budget.state =
      budget.spend.amount >= budget.cap.amount
        ? "PAUSED"
        : budget.spend.amount / budget.cap.amount > 0.9
          ? "NEAR"
          : "WITHIN";
    this.#lastMeta = { status: 200, headers: {} };
    return budget;
  }

  /* ---------------------------------------------------------------- *
   * §17 · Compliance rules, rule changes, checks
   * ---------------------------------------------------------------- */

  async listComplianceRules(page?: PageRequest): Promise<ListResponse<ComplianceRule>> {
    return this.#read(paginate(this.#store.complianceRules, page ?? { page: { size: 50 } }));
  }

  async getComplianceRule(id: string): Promise<ComplianceRule> {
    const rule = this.#store.complianceRules.find((candidate) => candidate.id === id);
    if (!rule) throw notFound("Compliance rule", id);
    return this.#read(rule);
  }

  /** DECISIONS §3 — a new rule loads as PROPOSED until compliance verifies it. */
  async createComplianceRule(body: Omit<ComplianceRule, "status">): Promise<ComplianceRule> {
    await sleep(this.#latencyMs);
    const rule: ComplianceRule = { ...body, status: "PROPOSED", verifiedBy: null, verifiedAt: null };
    this.#store.complianceRules.push(rule);
    this.#lastMeta = { status: 201, headers: {} };
    return rule;
  }

  async putComplianceRule(id: string, body: Partial<ComplianceRule>): Promise<ComplianceRule> {
    await sleep(this.#latencyMs);
    const rule = this.#store.complianceRules.find((candidate) => candidate.id === id);
    if (!rule) throw notFound("Compliance rule", id);
    Object.assign(rule, body);
    this.#lastMeta = { status: 200, headers: {} };
    return rule;
  }

  async listRuleChanges(page?: PageRequest): Promise<ListResponse<RuleChangeSet>> {
    return this.#read(paginate(this.#store.ruleChangeSets, page));
  }

  async getRuleChangeSet(documentId: string): Promise<RuleChangeSet> {
    const changeSet = this.#store.ruleChangeSets.find((row) => row.documentId === documentId);
    if (!changeSet) throw notFound("Rule change set", documentId);
    return this.#read(changeSet);
  }

  async getComplianceChecks(engagementRef: string): Promise<ComplianceChecksResponse> {
    const checks = this.#store.complianceChecks[engagementRef];
    if (!checks) throw notFound("Compliance checks for", engagementRef);
    return this.#read(checks);
  }

  #approveRuleChanges(documentId: string, changeIds?: readonly string[]): void {
    const changeSet = this.#store.ruleChangeSets.find((row) => row.documentId === documentId);
    if (!changeSet) return;
    for (const change of changeSet.changes) {
      if (changeIds && !changeIds.includes(change.id)) continue;
      change.status = "ACTIVE";
      if (change.newRuleId) {
        const created = this.#store.complianceRules.find((rule) => rule.id === change.newRuleId);
        if (created) {
          created.status = "ACTIVE";
          /** The circular's effective date, never the approval timestamp. */
          created.effectiveFrom = changeSet.effectiveFrom;
        }
      }
      if (change.op === "SUPERSEDE" && change.targetRuleId) {
        const superseded = this.#store.complianceRules.find((rule) => rule.id === change.targetRuleId);
        if (superseded) {
          superseded.status = "SUPERSEDED";
          superseded.supersededById = change.newRuleId;
        }
      }
      this.events.emit(
        "RuleChangeApproved",
        {
          ruleId: change.newRuleId ?? change.targetRuleId ?? change.id,
          op: change.op,
          effectiveFrom: changeSet.effectiveFrom,
          approvedBy: this.#actor(),
        },
        this.#actor(),
        NOW,
      );
    }
  }

  /* ---------------------------------------------------------------- *
   * §17 · Knowledge sources
   * ---------------------------------------------------------------- */

  async listKnowledgeSources(page?: PageRequest): Promise<ListResponse<KnowledgeSource>> {
    return this.#read(paginate(this.#store.knowledgeSources, page ?? { page: { size: 50 } }));
  }

  /**
   * The content library — the Knowledge › Library leaf.
   *
   * The second corpus: reusable sales and delivery content, as against the
   * monitored external documents `listKnowledgeSources` returns. Not a contract
   * endpoint; see `data/library.ts` for why it is a separate collection rather
   * than more knowledge sources.
   */
  async listLibraryAssets(page?: PageRequest): Promise<ListResponse<FixtureLibraryAsset>> {
    return this.#read(paginate(this.#store.libraryAssets, page ?? { page: { size: 50 } }));
  }

  async createKnowledgeSource(body: KnowledgeSourceCreateRequest): Promise<KnowledgeSource> {
    await sleep(this.#latencyMs);
    const source: KnowledgeSource = {
      id: `src_${this.#store.knowledgeSources.length + 1}`,
      name: body.name,
      type: body.type,
      version: "v1",
      ingestedAt: NOW,
      chunks: 0,
      embeddingStatus: "PENDING",
      lastCheckedAt: NOW,
      monitorStatus: "WATCHING",
      contentHash: "sha256:pending",
      retrievalScopes: body.retrievalScopes,
      ruleChangeSetId: null,
    };
    this.#store.knowledgeSources.push(source);
    this.#lastMeta = { status: 201, headers: {} };
    return source;
  }

  async checkKnowledgeSource(id: string): Promise<KnowledgeSourceCheckResponse> {
    await sleep(this.#latencyMs);
    const source = this.#store.knowledgeSources.find((candidate) => candidate.id === id);
    if (!source) throw notFound("Knowledge source", id);
    const previousHash = source.contentHash;
    source.lastCheckedAt = NOW;
    const changed = source.monitorStatus === "CHANGED_REVIEW_PENDING";
    if (changed) {
      this.events.emit(
        "SourceChanged",
        { sourceId: source.id, oldHash: previousHash, newHash: source.contentHash, detectedAt: NOW },
        { id: "sys_monitor", name: "Corpus monitor", kind: "SYSTEM" },
        NOW,
      );
    }
    this.#lastMeta = { status: 200, headers: {} };
    return {
      id: source.id,
      monitorStatus: source.monitorStatus,
      lastCheckedAt: NOW,
      contentHash: source.contentHash,
      changed,
    };
  }

  async reingestKnowledgeSource(id: string): Promise<KnowledgeSourceReingestResponse> {
    await sleep(this.#latencyMs);
    const source = this.#store.knowledgeSources.find((candidate) => candidate.id === id);
    if (!source) throw notFound("Knowledge source", id);
    source.embeddingStatus = "INDEXED";
    source.monitorStatus = "WATCHING";
    source.ingestedAt = NOW;
    if (source.chunks === 0) source.chunks = 96;
    const runId = `run_${++this.#store.counters.run}`;
    this.#lastMeta = { status: 202, headers: {} };
    return { id: source.id, embeddingStatus: source.embeddingStatus, chunks: source.chunks, runId };
  }

  /* ---------------------------------------------------------------- *
   * Agent-runtime reads
   *
   * The tool surface `packages/agent-runtime` codes against. These are
   * derivations over the same store the endpoint methods use — an agent and a
   * screen can never see different numbers.
   * ---------------------------------------------------------------- */

  /** Organisations matching a name fragment, best match first. */
  async searchOrganisations(query: string): Promise<Organisation[]> {
    const needle = query.trim().toLowerCase();
    const matches = this.#store.organisations.filter(
      (row) => row.name.toLowerCase().includes(needle) || row.ref.toLowerCase() === needle,
    );
    return this.#read(matches);
  }

  /** Programmes matching a name fragment, optionally narrowed by category. */
  async searchProgrammes(query: string, tags: readonly string[] = []): Promise<Programme[]> {
    const needle = query.trim().toLowerCase();
    const matches = this.#store.programmes.filter((row) => {
      const nameMatch = needle.length === 0 || row.name.toLowerCase().includes(needle);
      const tagMatch = tags.length === 0 || tags.some((tag) => row.category === tag.toUpperCase());
      return nameMatch && tagMatch;
    });
    return this.#read(matches);
  }

  /**
   * §6 which of a programme's pool is free across a date range.
   *
   * Availability is read from the trainer's booked days, so the November window
   * really does leave Farah Aziz as the only match — the constraint the M02-S02
   * risk note is standing on.
   */
  async listTrainerAvailability(
    programmeRef: string,
    from: DateOnly,
    to: DateOnly,
  ): Promise<TrainerAvailability[]> {
    const programme = byIdOrRef(this.#store.programmes, programmeRef);
    if (!programme) throw notFound("Programme", programmeRef);
    const days = datesBetween(from, to);
    const availability = programme.trainerPool.map((entry): TrainerAvailability => {
      const trainer = this.#store.trainers.find((row) => row.ref === entry.trainerRef);
      const clash = days.some((day) => trainer?.bookedDates.includes(day) ?? false);
      return {
        trainerRef: entry.trainerRef,
        name: entry.name,
        available: !clash,
        dates: `${from}/${to}`,
      };
    });
    return this.#read(availability);
  }

  /**
   * §6 drafts a proposal for an organisation, resolving the opportunity itself.
   *
   * `ProposalCreateRequest` needs an `opportunityRef`, but a caller holding an
   * organisation has to walk organisation → opportunity to get one. That walk
   * is domain knowledge, not caller convenience: if every consumer does it in
   * its own adapter, each one picks a slightly different opportunity. It lives
   * here so there is one answer — the open opportunity if there is one, the
   * most recently updated otherwise.
   *
   * Passing `quotationRef` binds that quotation to the new proposal, which is
   * the direction the contract models the link (`Quotation.proposalRef`).
   */
  async draftProposal(
    input: {
      organisationRef: string;
      programmeRef: string;
      quotationRef?: string;
      templateId?: string;
      sections?: readonly { key?: string; heading: string; body: string }[];
    },
    options: RequestOptions = {},
  ): Promise<ProposalDraftResult> {
    const organisation = byIdOrRef(this.#store.organisations, input.organisationRef);
    if (!organisation) throw notFound("Organisation", input.organisationRef);

    const OPEN_STAGES = new Set(["NEW", "QUALIFYING", "TNA_SENT", "PROPOSAL_SENT", "NEGOTIATION"]);
    const candidates = this.#store.opportunities
      .filter((row) => row.organisationRef === organisation.ref)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const opportunity = candidates.find((row) => OPEN_STAGES.has(row.stage)) ?? candidates[0];
    if (!opportunity) {
      throw notFound("Open opportunity for organisation", organisation.ref);
    }

    const proposal = await this.createProposal(
      {
        opportunityRef: opportunity.ref,
        templateId: input.templateId ?? "tpl_proposal_std_v7",
        programmeId: input.programmeRef,
      },
      options,
    );

    if (input.sections && input.sections.length > 0) {
      proposal.sections = input.sections.map((section, index) => ({
        n: index + 1,
        title: section.heading,
        body: section.body,
      }));
      proposal.updatedAt = NOW;
    }

    if (input.quotationRef) {
      const quotation = byIdOrRef(this.#store.quotations, input.quotationRef);
      if (!quotation) throw notFound("Quotation", input.quotationRef);
      quotation.proposalRef = proposal.ref;
      quotation.updatedAt = NOW;
    }

    return {
      proposal,
      opportunityRef: opportunity.ref,
      organisationRef: organisation.ref,
      ...(input.quotationRef ? { quotationRef: input.quotationRef } : {}),
    };
  }

  /**
   * §6 + §18 prices a delivery from the catalogue and the rate card.
   *
   * `proposalValue` is the ex-SST figure the §3 gate compares against the
   * APV-01 threshold, kept separate from `total` so tax can never push a
   * proposal over a commercial threshold on its own. The package price is one
   * line at `qty: 1`, per DECISIONS §7; materials and travel are direct costs,
   * not lines on the client's quote.
   */
  async computeQuotation(input: {
    programmeRef: string;
    pax: number;
    days?: number;
    discountRate?: Rate;
  }): Promise<ComputedQuotation> {
    const programme = byIdOrRef(this.#store.programmes, input.programmeRef);
    if (!programme) throw notFound("Programme", input.programmeRef);

    const tier =
      [...programme.pricingTiers].sort((a, b) => a.maxPax - b.maxPax).find((row) => input.pax <= row.maxPax) ??
      programme.pricingTiers.at(-1);
    const listPrice = tier?.price ?? programme.listPrice;
    const discountRate = input.discountRate ?? 0;
    const sellPrice = myr(roundHalfUpSen(listPrice.amount * (1 - discountRate)));
    const days = input.days ?? programme.days;

    const bandRate =
      this.#store.rateCard.trainerDayRate.find((row) => row.band === "A")?.rate ?? myr(480000);
    const materialsRate =
      this.#store.rateCard.materialsPerPax.find((row) => row.programmeType === programme.category)?.rate ??
      myr(4000);
    const travelRate =
      this.#store.rateCard.travel.find((row) => row.region === "KLANG_VALLEY")?.rate ?? myr(30000);

    const costLines: QuotationLine[] = [
      { item: "TRAINER_FEE", qty: days, unit: "DAY", rate: bandRate, total: lineTotal(bandRate, days) },
      { item: "VENUE", detail: "Client site", qty: 0, total: myr(0) },
      { item: "MATERIALS", qty: input.pax, rate: materialsRate, total: lineTotal(materialsRate, input.pax) },
      { item: "TRAVEL", qty: days, rate: travelRate, total: lineTotal(travelRate, days) },
    ];
    const directCost = sumMoney(costLines.map((line) => line.total));

    const draft: Quotation = {
      id: "quo_computed",
      ref: "QUO-COMPUTED",
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: this.#actor() as Quotation["createdBy"],
      proposalRef: "",
      /* Priced but not yet attached to a proposal, so the draft state. */
      status: "DRAFT",
      rateCardVersion: this.#store.rateCard.version,
      lines: costLines,
      sellPrice,
      directCost,
      marginRate: resultingMarginRate(sellPrice, directCost),
      floorPrice: programme.floorPrice,
      floorMarginRate: programme.floorMarginRate,
      /* Seeded from the catalogue so the draft satisfies R6; `evaluateFloors`
         below recomputes all three and the returned quotation carries those. */
      absoluteFloorPrice: programme.floorPrice,
      marginFloorPrice: marginFloorPrice(directCost, programme.floorMarginRate),
      bindingFloorBasis: "ABSOLUTE",
      commissionRate: 0.08,
      commission: myr(roundHalfUpSen(sellPrice.amount * 0.08)),
      commissionPayableOn: "COLLECTION",
      display: { perPax: myr(roundHalfUpSen(sellPrice.amount / Math.max(1, input.pax))) },
    };
    const evaluation = evaluateFloors(draft, sellPrice, programme);

    return this.#read({
      programmeRef: programme.ref,
      pax: input.pax,
      days,
      /** One package line at qty 1 — the client's quote, not the cost sheet. */
      lines: [
        {
          item: "PROGRAMME_FEE",
          detail: `${programme.name} · ${days}-day programme · up to ${input.pax} participants`,
          qty: 1,
          rate: sellPrice,
          total: sellPrice,
        },
      ],
      costLines,
      /** Ex-SST, and the only figure the policy gate may compare. */
      proposalValue: sellPrice,
      sst: myr(0),
      sstReason: "TRAINING_EXEMPT",
      total: sellPrice,
      directCost,
      marginRate: draft.marginRate,
      absoluteFloorPrice: evaluation.absoluteFloorPrice,
      marginFloorPrice: evaluation.marginFloorPrice,
      floorPrice: evaluation.floorPrice,
      bindingFloorBasis: evaluation.bindingFloor,
      belowFloor: evaluation.breached,
      rateCardVersion: this.#store.rateCard.version,
      display: { perPax: draft.display?.perPax ?? myr(0) },
    });
  }

  /* ---------------------------------------------------------------- *
   * §3 · The action envelope
   * ---------------------------------------------------------------- */

  /** §3 `POST /v1/actions`, with the transport metadata alongside the body. */
  async performActionWithMeta(
    request: ActionRequest,
    options: RequestOptions = {},
  ): Promise<{ response: ActionResponse; meta: ResponseMeta }> {
    const response = await this.performAction(request, options);
    return { response, meta: this.#lastMeta };
  }

  /**
   * §3 the one endpoint every primary button goes through.
   *
   * Validation that would make the action impossible runs first — there is no
   * point queueing an approval for something that cannot happen — and then the
   * five evaluation inputs resolve in the order §3 lists them.
   */
  async performAction(request: ActionRequest, options: RequestOptions = {}): Promise<ActionResponse> {
    return this.#write(options, request, 202, () => {
      this.#assertTargetExists(request);
      this.#validateAction(request);

      const requester = request.requestedBy;
      this.events.emit(
        "ActionRequested",
        {
          actionType: request.type,
          targetRef: request.targetRef,
          requestedBy: requester,
          ...(request.confidence !== undefined ? { confidence: request.confidence } : {}),
        },
        requester,
        NOW,
      );

      /* Step 1 — autonomy, for agent requesters only. */
      if (requester.kind === "AGENT") {
        const grant = grantedAutonomy(this.#store, requester.id, request.type);
        if (!grant) throw notFound("Agent", requester.id);
        if (grant.agentPaused || grant.paused) {
          throw new ContractError("AGENT_PAUSED", `${requester.id} is paused for ${request.type}.`, {
            reason: "AGENT_PAUSED",
          });
        }
        if (grant.level === "OBSERVE") {
          throw forbidden(`${requester.id} may only observe ${request.type}.`, {
            requiredRole: "AGENT",
          });
        }
        if (grant.level === "SUGGEST") return this.#suggest(request);
      }

      /* Steps 2 and 3 — value and the server-computed context flags. */
      const context = computeContextFlags(this.#store, request);
      const policy = matchPolicy(this.#store.policies, request, context);

      /* Step 4 — the agent's confidence against its minimum for this type. */
      if (requester.kind === "AGENT") {
        const minimum = MINIMUM_CONFIDENCE[request.type] ?? DEFAULT_MINIMUM_CONFIDENCE;
        if ((request.confidence ?? 0) < minimum) return this.#suggest(request);
      }

      /* Step 5 — the approver, who is never the requester. */
      if (policy) return this.#queueForApproval(request, policy, context);

      return this.#execute(request);
    });
  }

  /**
   * The monetary value the policy gate compares against its threshold.
   *
   * Architecture doc 03 decision 2: the value comes from the **record**, never
   * from the request body, or an agent could understate a proposal to slip
   * under APV-01. The payload is consulted only where it *is* the value being
   * proposed — a new sell price, a new budget cap — and never where a stored
   * record already knows the answer.
   */
  #resolveActionValue(request: ActionRequest): Money | undefined {
    switch (request.type) {
      case "PROPOSAL_SEND": {
        const proposal = byIdOrRef(this.#store.proposals, request.targetRef);
        return proposal?.value;
      }
      case "INVOICE_CREATE":
      case "INVOICE_PUSH": {
        const invoice = byIdOrRef(this.#store.invoices, request.targetRef);
        return invoice?.total ?? payloadValue(request);
      }
      case "PAYMENT_RECORD":
      case "REMINDER_SEND": {
        const invoice = byIdOrRef(this.#store.invoices, request.targetRef);
        return invoice?.outstanding ?? payloadValue(request);
      }
      case "ACCOUNT_TRADING_HOLD": {
        const organisation = byIdOrRef(this.#store.organisations, request.targetRef);
        if (!organisation) return payloadValue(request);
        return myr(
          this.#store.receivables
            .filter((row) => row.organisation.ref === organisation.ref)
            .reduce((total, row) => total + row.amount.amount, 0),
        );
      }
      case "HRDC_PACKET_MARK_SUBMITTED": {
        const packet = this.#store.claimPackets.find((row) => row.engagementRef === request.targetRef);
        return packet?.claimValue;
      }
      case "TRAINER_BOOK":
      case "ATTENDANCE_APPROVE":
      case "ATTENDANCE_UNLOCK":
      case "RULE_CHANGE_APPROVE":
        /** These carry no money, and a payload claiming otherwise is ignored. */
        return undefined;
      default:
        /** QUOTATION_APPLY, DISCOUNT_APPROVE and BUDGET_CAP_RAISE propose the value itself. */
        return payloadValue(request);
    }
  }

  #assertTargetExists(request: ActionRequest): void {
    const collections: readonly { rows: readonly { id?: string; ref?: string }[] }[] = [
      { rows: this.#store.enquiries },
      { rows: this.#store.opportunities },
      { rows: this.#store.proposals },
      { rows: this.#store.quotations },
      { rows: this.#store.engagements },
      { rows: this.#store.invoices },
      { rows: this.#store.followUps },
      { rows: this.#store.tnas },
      { rows: this.#store.claimPackets.map((packet) => ({ id: packet.id, ref: packet.engagementRef })) },
      { rows: this.#store.ruleChangeSets.map((set) => ({ id: set.documentId, ref: set.documentId })) },
      { rows: this.#store.agents },
      { rows: this.#store.organisations },
      { rows: this.#store.budgets.map((budget) => ({ id: `${budget.scope}/${budget.key}`, ref: `${budget.scope}/${budget.key}` })) },
    ];
    const found = collections.some(({ rows }) => byIdOrRef(rows, request.targetRef) !== undefined);
    if (!found) throw notFound("Action target", request.targetRef);
  }

  /** The 4xx cases that hold regardless of who is asking. */
  #validateAction(request: ActionRequest): void {
    switch (request.type) {
      case "HRDC_PACKET_MARK_SUBMITTED": {
        const packet = this.#store.claimPackets.find((row) => row.engagementRef === request.targetRef);
        if (!packet) throw notFound("Claim packet for", request.targetRef);
        if (packet.completeness < 1) {
          const missing = packet.requiredDocuments
            .filter((document) => document.status === "MISSING")
            .map((document) => document.type);
          throw validationFailed(
            `${request.targetRef} is ${Math.round(packet.completeness * 100)}% complete and cannot be filed.`,
            {
              reason: "PACKET_INCOMPLETE",
              blockers: missing,
              fields: missing.map((type) => ({ field: `requiredDocuments.${type}`, reason: "MISSING" })),
            },
          );
        }
        break;
      }
      case "ENGAGEMENT_CLOSE_OUT": {
        const engagement = byIdOrRef(this.#store.engagements, request.targetRef);
        if (!engagement) throw notFound("Engagement", request.targetRef);
        const blockers = engagement.checklist
          .filter((item) => !item.done)
          .map((item) => `${item.key}_MISSING`);
        if (blockers.length > 0) {
          throw validationFailed(`${engagement.ref} cannot be closed out yet.`, { blockers });
        }
        break;
      }
      case "QUOTATION_APPLY": {
        const quotation = byIdOrRef(this.#store.quotations, request.targetRef);
        if (!quotation) break;
        const sellPrice = payloadValue(request) ?? quotation.sellPrice;
        const programme = this.#programmeForQuotation(quotation);
        const evaluation = evaluateFloors(quotation, sellPrice, programme);
        if (evaluation.breached) {
          throw floorPriceBreach(evaluation, sellPrice, programme?.listPricePax ?? 30);
        }
        break;
      }
      case "ATTENDANCE_APPROVE": {
        const payload = (request.payload ?? {}) as { day?: number };
        const day = payload.day ?? 1;
        const sheet = this.#store.attendanceSheets[`${request.targetRef}::${day}`];
        if (!sheet) throw notFound(`Attendance day ${day} for`, request.targetRef);
        if (sheet.status === "LOCKED") {
          throw new ContractError(
            "ATTENDANCE_LOCKED",
            `Attendance for ${request.targetRef} day ${day} is already locked.`,
            {
              approvedAt: sheet.approvedAt ?? NOW,
              unlockPath: "/v1/actions",
              unlockActionType: "ATTENDANCE_UNLOCK",
            },
          );
        }
        break;
      }
      case "ATTENDANCE_UNLOCK": {
        const payload = (request.payload ?? {}) as { reason?: string; day?: number };
        if (!payload.reason) {
          throw validationFailed("Unlocking attendance requires a reason.", {
            fields: [{ field: "payload.reason", reason: "REQUIRED" }],
          });
        }
        break;
      }
      case "ENQUIRY_ARCHIVE": {
        const payload = (request.payload ?? {}) as { reason?: string };
        if ((request.confidence ?? 1) < 0.9 && !payload.reason) {
          throw validationFailed("Archiving below 0.9 confidence requires a reason.", {
            fields: [{ field: "payload.reason", reason: "REQUIRED" }],
          });
        }
        break;
      }
      default:
        break;
    }
  }

  /** §3 `200 SUGGESTED` — the agent may not act, so it hands over a draft. */
  #suggest(request: ActionRequest): ActionResponse {
    const draft: ActionDraft = {
      id: `drf_${++this.#store.counters.draft}`,
      type: request.type,
      body: request.reasoning ?? `Proposed ${request.type} on ${request.targetRef}.`,
      expiresAt: "2026-11-21T00:00:00+08:00",
    };
    this.#store.drafts.set(draft.id, draft);
    this.#lastMeta = { status: 200, headers: {} };
    return { status: "SUGGESTED", draft };
  }

  /** §3 `202 QUEUED_FOR_APPROVAL` — a policy intercepted the action. */
  #queueForApproval(
    request: ActionRequest,
    policy: Policy,
    context: ReturnType<typeof computeContextFlags>,
  ): ActionResponse {
    /**
     * An identical pending approval is the same request, not a second one:
     * re-proposing PROPOSAL_SEND on PRO-2026-0184 returns APV-2026-0771 rather
     * than queueing a duplicate behind it.
     */
    const existing = this.#store.approvals.find(
      (row) =>
        row.status === "PENDING" &&
        row.actionType === request.type &&
        row.targetRef === request.targetRef,
    );
    if (existing) {
      this.#lastMeta = { status: 202, headers: {} };
      return {
        status: "QUEUED_FOR_APPROVAL",
        approvalRequest: {
          id: existing.id,
          ref: existing.ref,
          policyId: existing.policyId,
          approverRole: policy.approverRole,
          ...(this.#assignedTo(policy, request.requestedBy.id)
            ? { assignedTo: this.#assignedTo(policy, request.requestedBy.id) }
            : {}),
          slaDueAt: existing.slaDueAt,
          createdAt: existing.createdAt,
        },
      };
    }

    const approver = assignApprover(this.#store, policy, request.requestedBy.id);
    const ref = `APV-2026-${String(++this.#store.counters.approval).padStart(4, "0")}`;
    const value = this.#resolveActionValue(request);
    const diff = this.#diffFor(request);
    const approval: FixtureApproval = {
      id: `apv_${ref.slice(-4)}`,
      ref,
      policyId: policy.id,
      actionType: request.type,
      subject: `${request.type.replace(/_/g, " ").toLowerCase()} · ${request.targetRef}`,
      targetRef: request.targetRef,
      ...(value ? { value } : {}),
      requestedBy: {
        kind: request.requestedBy.kind === "AGENT" ? "AGENT" : "HUMAN",
        id: request.requestedBy.id,
        name: request.requestedBy.name ?? request.requestedBy.id,
      },
      ...(request.confidence !== undefined ? { confidence: request.confidence } : {}),
      slaDueAt: NOW,
      slaRemainingMinutes: policy.slaMinutes,
      slaBreached: false,
      status: "PENDING",
      /** Server-decided: false for any action carrying a monetary value. */
      bulkApprovable: value === undefined,
      urgencyGroup: policy.slaMinutes <= 240 ? "TODAY" : "THIS_WEEK",
      createdAt: NOW,
      reason: policy.description,
      recommendation: {
        verdict: request.requestedBy.kind === "AGENT" ? "SEND_AS_DRAFTED" : "APPROVE",
        rationale: request.reasoning ?? policy.description,
      },
      evidence: (request.evidence ?? []).map((item, index) => ({
        n: index + 1,
        type: item.type,
        ref: item.ref,
        label: item.excerpt ?? item.ref,
      })),
      deviations: context.belowFloorPrice ? ["Sell price is below the binding floor."] : [],
      risk: { level: value && value.amount > 5000000 ? "HIGH" : "MEDIUM", note: policy.description },
      diff,
    };
    this.#store.approvals.push(approval);
    this.#store.badgeCounts.approvals = this.#store.approvals.filter(
      (row) => row.status === "PENDING",
    ).length;

    this.events.emit(
      "ApprovalRequested",
      {
        approvalRef: approval.ref,
        policyId: policy.id,
        actionType: request.type,
        targetRef: request.targetRef,
        ...(value ? { value } : {}),
        approverRole: policy.approverRole,
        slaDueAt: approval.slaDueAt,
      },
      request.requestedBy,
      NOW,
    );
    this.events.publish("approvals", {
      event: "CREATED",
      approvalRef: approval.ref,
      urgencyGroup: approval.urgencyGroup,
      slaBreached: false,
    });
    this.events.publish("badges", this.#store.badgeCounts);

    const approvalRequest: ApprovalRequestRef = {
      id: approval.id,
      ref: approval.ref,
      policyId: policy.id,
      approverRole: policy.approverRole,
      ...(approver ? { assignedTo: { id: approver.id, name: approver.name, kind: "HUMAN" } } : {}),
      slaDueAt: approval.slaDueAt,
      createdAt: approval.createdAt,
    };
    this.#lastMeta = { status: 202, headers: {} };
    return { status: "QUEUED_FOR_APPROVAL", approvalRequest };
  }

  #assignedTo(policy: Policy, requesterId: string): Actor | undefined {
    const approver = assignApprover(this.#store, policy, requesterId);
    return approver ? { id: approver.id, name: approver.name, kind: "HUMAN" } : undefined;
  }

  /** §3 `202 EXECUTED` — the action ran, and `effects[]` says what changed. */
  #execute(request: ActionRequest): ActionResponse {
    const effects = this.#diffFor(request).map(toEffect);
    const result: ActionResult = { effects };
    const actor = request.requestedBy as AnyActor;

    switch (request.type) {
      case "ENQUIRY_ARCHIVE": {
        const enquiry = byIdOrRef(this.#store.enquiries, request.targetRef);
        if (enquiry) {
          enquiry.status = "ARCHIVED";
          enquiry.updatedAt = NOW;
        }
        break;
      }
      case "OPPORTUNITY_CONVERT": {
        const enquiry = byIdOrRef(this.#store.enquiries, request.targetRef);
        if (enquiry) {
          enquiry.status = "CONVERTED";
          enquiry.updatedAt = NOW;
        }
        const payload = (request.payload ?? {}) as { value?: Money; questionnaireTemplateId?: string };
        const opportunity =
          this.#store.opportunities.find((row) => row.sourceEnquiryRef === enquiry?.ref) ??
          this.#store.opportunities[0];
        const tna = opportunity
          ? this.#store.tnas.find((row) => row.opportunityRef === opportunity.ref)
          : undefined;
        if (opportunity) {
          result.opportunity = {
            id: opportunity.id,
            ref: opportunity.ref,
            stage: "QUALIFYING",
            value: payload.value ?? opportunity.value,
          };
          this.events.emit(
            "OpportunityCreated",
            {
              opportunityRef: opportunity.ref,
              organisationRef: opportunity.organisationRef,
              value: payload.value ?? opportunity.value,
              sourceEnquiryRef: enquiry?.ref ?? "",
            },
            actor,
            NOW,
          );
        }
        if (tna) result.tna = { id: tna.id, ref: tna.ref, status: tna.status };
        break;
      }
      case "PROPOSAL_SEND": {
        const proposal = byIdOrRef(this.#store.proposals, request.targetRef);
        if (proposal) {
          proposal.status = "SENT";
          proposal.updatedAt = NOW;
          result.proposalId = proposal.id;
          result.sentAt = NOW;
          this.events.emit(
            "ProposalSent",
            {
              proposalRef: proposal.ref,
              channel: "EMAIL",
              to: ((request.payload ?? {}) as { to?: string[] }).to ?? [],
              sentAt: NOW,
            },
            actor,
            NOW,
          );
        }
        break;
      }
      case "QUOTATION_APPLY": {
        const quotation = byIdOrRef(this.#store.quotations, request.targetRef);
        const sellPrice = payloadValue(request);
        if (quotation && sellPrice) {
          quotation.sellPrice = sellPrice;
          quotation.updatedAt = NOW;
          const proposal = byIdOrRef(this.#store.proposals, quotation.proposalRef);
          if (proposal) proposal.value = sellPrice;
        }
        break;
      }
      case "ATTENDANCE_APPROVE": {
        const payload = (request.payload ?? {}) as { day?: number };
        const sheet = this.#store.attendanceSheets[`${request.targetRef}::${payload.day ?? 1}`];
        if (sheet) this.#lockAttendance(sheet);
        break;
      }
      case "ATTENDANCE_UNLOCK": {
        const payload = (request.payload ?? {}) as { day?: number };
        const sheet = this.#store.attendanceSheets[`${request.targetRef}::${payload.day ?? 1}`];
        if (sheet) {
          sheet.status = "OPEN";
          sheet.immutable = false;
          sheet.approvedBy = null;
          sheet.approvedAt = null;
          sheet.captureModes = { qr: true, signature: true, manual: true };
        }
        const packet = this.#store.claimPackets.find((row) => row.engagementRef === request.targetRef);
        if (packet) {
          packet.status = "DRAFT";
          packet.completeness = 0;
        }
        break;
      }
      case "HRDC_PACKET_MARK_SUBMITTED": {
        const packet = this.#store.claimPackets.find((row) => row.engagementRef === request.targetRef);
        const payload = (request.payload ?? {}) as { reference?: string; submittedAt?: string };
        if (packet && payload.reference) {
          packet.status = "SUBMITTED";
          packet.submission = {
            reference: payload.reference,
            submittedAt: payload.submittedAt ?? NOW,
            submittedBy: actor,
          };
          packet.submissionLog.push({
            at: payload.submittedAt ?? NOW,
            actor,
            event: "CLAIM_SUBMITTED",
            reference: payload.reference,
          });
          this.events.emit(
            "HRDCPacketSubmitted",
            {
              engagementRef: packet.engagementRef,
              reference: payload.reference,
              submittedBy: actor,
              submittedAt: payload.submittedAt ?? NOW,
            },
            actor,
            NOW,
          );
        }
        break;
      }
      case "PAYMENT_RECORD": {
        const invoice = byIdOrRef(this.#store.invoices, request.targetRef);
        const amount = payloadValue(request);
        if (invoice && amount) {
          invoice.payments.push({ id: `pay_${++this.#store.counters.payment}`, at: NOW, amount });
          const paid = invoice.payments.reduce((total, payment) => total + payment.amount.amount, 0);
          invoice.outstanding = myr(Math.max(0, invoice.total.amount - paid));
          invoice.status = invoice.outstanding.amount === 0 ? "PAID" : "PARTIALLY_PAID";
        }
        break;
      }
      case "FOLLOWUP_SEND": {
        const followUp = byIdOrRef(this.#store.followUps, request.targetRef);
        if (followUp) followUp.status = "SENT";
        break;
      }
      case "AGENT_PAUSE": {
        const agent = this.#store.agents.find((row) => row.id === request.targetRef);
        if (agent) {
          agent.status = "PAUSED";
          agent.pausedAt = NOW;
          agent.pausedReason = "MANUAL_PAUSE";
        }
        break;
      }
      case "RULE_CHANGE_APPROVE": {
        const payload = (request.payload ?? {}) as { documentId?: string; changeIds?: string[] };
        this.#approveRuleChanges(payload.documentId ?? request.targetRef, payload.changeIds);
        break;
      }
      default:
        break;
    }

    this.#lastMeta = { status: 202, headers: {} };
    return { status: "EXECUTED", result };
  }

  /** The "if you approve, this happens" lines — and, on execute, what happened. */
  #diffFor(request: ActionRequest): DiffLine[] {
    switch (request.type) {
      case "ENQUIRY_ARCHIVE":
        return [
          {
            op: "UPDATE",
            entity: "Enquiry",
            ref: request.targetRef,
            description: "status → ARCHIVED",
          },
        ];
      case "OPPORTUNITY_CONVERT":
        return [
          { op: "ADD", entity: "Opportunity", description: "Created from the enquiry" },
          { op: "ADD", entity: "TNA", description: "Questionnaire sent to the client contact" },
          {
            op: "UPDATE",
            entity: "Enquiry",
            ref: request.targetRef,
            description: "status OPEN → CONVERTED",
          },
        ];
      case "PROPOSAL_SEND":
        return [
          { op: "UPDATE", entity: "Proposal", ref: request.targetRef, description: "status DRAFT → SENT" },
          { op: "ADD", entity: "Email", description: "Covering email with the proposal PDF" },
          { op: "UPDATE", entity: "Opportunity", description: "stage → PROPOSAL_SENT" },
        ];
      case "QUOTATION_APPLY":
      case "DISCOUNT_APPROVE":
        return [
          {
            op: "UPDATE",
            entity: "Quotation",
            ref: request.targetRef,
            description: "sellPrice updated and the proposal value follows",
          },
        ];
      case "ATTENDANCE_APPROVE":
        return [
          {
            op: "UPDATE",
            entity: "AttendanceSheet",
            ref: request.targetRef,
            description: "status → LOCKED, immutable",
          },
        ];
      case "ATTENDANCE_UNLOCK":
        return [
          { op: "UPDATE", entity: "AttendanceSheet", ref: request.targetRef, description: "status → OPEN" },
          { op: "REMOVE", entity: "ClaimPacket", description: "Claim packet voided" },
        ];
      case "HRDC_PACKET_MARK_SUBMITTED":
        return [
          {
            op: "UPDATE",
            entity: "ClaimPacket",
            ref: request.targetRef,
            description: "status READY → SUBMITTED with the eTRIS reference",
          },
        ];
      case "INVOICE_CREATE":
      case "INVOICE_PUSH":
        return [
          { op: "ADD", entity: "Invoice", description: "Pushed to the accounting package" },
        ];
      case "PAYMENT_RECORD":
        return [
          { op: "ADD", entity: "Payment", ref: request.targetRef, description: "Payment recorded" },
        ];
      case "REMINDER_SEND":
        return [
          { op: "ADD", entity: "Message", ref: request.targetRef, description: "Collections reminder sent" },
        ];
      case "FOLLOWUP_SEND":
        return [{ op: "ADD", entity: "Message", ref: request.targetRef, description: "Follow-up sent" }];
      case "TRAINER_BOOK":
        return [
          {
            op: "UPDATE",
            entity: "Engagement",
            ref: request.targetRef,
            description: "trainer soft-hold → confirmed",
          },
        ];
      case "RULE_CHANGE_APPROVE":
        return [
          {
            op: "UPDATE",
            entity: "ComplianceRule",
            ref: request.targetRef,
            description: "Proposed changes activated from the circular's effective date",
          },
        ];
      case "BUDGET_CAP_RAISE":
        return [{ op: "UPDATE", entity: "Budget", ref: request.targetRef, description: "cap raised" }];
      case "AGENT_AUTONOMY_CHANGE":
        return [
          { op: "UPDATE", entity: "Agent", ref: request.targetRef, description: "autonomy level changed" },
        ];
      case "AGENT_PAUSE":
        return [{ op: "UPDATE", entity: "Agent", ref: request.targetRef, description: "status → PAUSED" }];
      case "ACCOUNT_TRADING_HOLD":
        return [
          {
            op: "UPDATE",
            entity: "Organisation",
            ref: request.targetRef,
            description: "Trading hold applied; no new orders accepted until the account clears",
          },
        ];
      case "ENGAGEMENT_CLOSE_OUT":
        return [
          { op: "UPDATE", entity: "Engagement", ref: request.targetRef, description: "status → CLOSED" },
        ];
      case "TNA_RECOMMENDATION_ACCEPT":
        return [{ op: "ADD", entity: "Proposal", description: "Drafted from the accepted recommendation" }];
      case "BROADCAST_SEND":
        return [{ op: "ADD", entity: "Message", ref: request.targetRef, description: "Broadcast sent" }];
      default:
        return [];
    }
  }
}

/** §7 `effects[]` must equal `diff[]`, so one maps straight onto the other. */
const toEffect = (line: DiffLine): Effect => ({
  op: line.op,
  entity: line.entity,
  ...(line.ref ? { ref: line.ref } : {}),
  description: line.description,
});

/** Kept so the unused-import checker sees these contract types are load-bearing. */
export type { AutonomyLevel, Badge, GovernedActionType, Timestamp };
