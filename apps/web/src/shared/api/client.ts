import type {
  ActionRequest,
  ActionResponse,
  Agent,
  AgentEval,
  AgentPauseRequest,
  AgentRegistryResponse,
  ApprovalBulkDecideRequest,
  ApprovalDecideRequest,
  ApprovalDecideResponse,
  ApprovalBulkDecideResponse,
  ApprovalDetail,
  ApprovalListResponse,
  AuditEntry,
  AutomationRun,
  BadgeCounts,
  Budget,
  BudgetScope,
  BudgetWrite,
  ChannelConsent,
  CollectionRule,
  ComplianceRule,
  Contact,
  Enquiry,
  ExecutiveDashboard,
  EnquiryDetail,
  EnquiryExtractionPatch,
  FollowUp,
  HrdcDeadline,
  KnowledgeSource,
  KnowledgeSourceCheckResponse,
  KnowledgeSourceCreateRequest,
  KnowledgeSourceReingestResponse,
  ListResponse,
  MessageChannel,
  MessageDraft,
  Me,
  MeProfile,
  ModelTier,
  NavigationTree,
  Opportunity,
  Organisation,
  OrganisationRelations,
  PageRequest,
  PipelineConfig,
  PipelineObject,
  Policy,
  Programme,
  ProgrammeDelivery,
  Proposal,
  ProposalCreateRequest,
  ProposalSectionRegenerateResponse,
  ProposalSectionWrite,
  ProposalsVsWonReport,
  ProviderKey,
  Quotation,
  QuotationWrite,
  RateCard,
  RoutingEntry,
  RoutingResponse,
  RuleChangeSet,
  RunDeadLetterRequest,
  SavedView,
  Template,
  TemplateType,
  Tna,
  TnaRecommendationsResponse,
  Trainer,
  UsageResponse,
} from "@trainos/contract";

import type { Result } from "./errors";

/**
 * The client interface. DECLARATION ONLY — there is no runtime in this file.
 *
 * `scripts/check-rpc-contract.mjs` (E3) parses this file TEXTUALLY with
 * `/^ {2}([a-zA-Z0-9_]+)\(([^)]*)\):\s*([^;]+);/gm`, and `[^;]` matches a
 * newline. So a two-space-indented `name(args): …` whose line does NOT end in a
 * semicolon still matches — it just swallows everything up to the next `;`
 * anywhere in the file, and reports the method as BROKEN. A class method body
 * at two spaces of indent is exactly that shape. THAT is why the implementation
 * lives in `rpcClient.ts` and this file holds nothing but types: the gate and a
 * class cannot share a file.
 *
 * Two further constraints the parser imposes, both load-bearing:
 *
 * - ONE `import type { … } from "@trainos/contract"` block. E3 reads the FIRST
 *   match and treats its names as the entire set a return type may be built
 *   from, so a second block would be invisible and its types would read as
 *   locally invented.
 * - Every signature on ONE line, under Prettier's 100-column limit. A signature
 *   Prettier wraps is a signature the gate stops seeing, and a method the gate
 *   cannot see is a method whose shape nobody is comparing to the contract.
 *
 * `Result` is imported from `./errors` rather than declared here. E3 exempts
 * the name so this file could define its own, and that is precisely the
 * divergence CLAUDE.md calls a defect — two `Result` types over one seam means
 * `error` narrows to one union in a hook and a different one in a component.
 */

/**
 * A write body plus the §1 idempotency key.
 *
 * The contract carries the key in an `Idempotency-Key` HEADER; every RPC in
 * 001–011 takes it as `p_idempotency_key text`. PostgREST would ignore the
 * header, so the bridge is here: the key is part of the request VALUE, and the
 * database owns the replay. See §7 item 7 of `08-rpc-pattern-from-showroom.md`.
 */
export type Idempotent<T> = T & { idempotencyKey: string };

/** `POST /v1/actions` — the one endpoint every write in the app goes through. */
export type ActionInput = Idempotent<ActionRequest>;

/** `POST /v1/approvals/{id}/decide`. */
export type DecideInput = Idempotent<ApprovalDecideRequest>;

/** `POST /v1/approvals/bulk-decide`. */
export type BulkDecideInput = Idempotent<ApprovalBulkDecideRequest>;

/** `POST /v1/proposals`. */
export type ProposalInput = Idempotent<ProposalCreateRequest>;

/** `PUT /v1/quotations/{id}`. */
export type QuotationInput = Idempotent<QuotationWrite>;

/**
 * `POST /v1/proposals/{id}/sections` — a section a person typed.
 *
 * The body is written out rather than imported because the contract has no
 * shape for it: §13 publishes `PUT /sections/{n}` and
 * `POST /sections/{n}/regenerate`, both of which need the section to exist
 * already, so "Add section" on M07-S02 has no published endpoint. The fixture
 * client implements it and reports the gap; this mirrors its body exactly.
 * E3 reads RETURN types, and this one returns the contract's `Proposal`.
 */
export type SectionInput = Idempotent<{ title: string; body?: string }>;

/** `PUT /v1/proposals/{id}/sections/{n}`. */
export type SectionWriteInput = Idempotent<ProposalSectionWrite>;

/** `GET /v1/ai/usage?groupBy=`. Kept local so the signature fits one line (027). */
export type UsageGroupBy = "TIER" | "AGENT" | "ACTION_TYPE";

/**
 * The methods, grouped by golden-path order then by the §8 view reads.
 *
 * A method here may name an RPC that does not exist in the database yet. That
 * is deliberate and the gap is enumerated in `RPC_NAMES` in `rpcClient.ts` and
 * specified in `docs/architecture/09-golden-path-rpc-specs.md` — the interface
 * is the contract the migrations lane implements against, not a report of what
 * has already shipped.
 */
export interface TrainOsClient {
  me(): Promise<Result<Me>>;
  meProfile(): Promise<Result<MeProfile>>;
  navigation(): Promise<Result<NavigationTree>>;
  badges(): Promise<Result<BadgeCounts>>;
  getExecutiveDashboard(period: string): Promise<Result<ExecutiveDashboard>>;
  getProposalsVsWon(months: number): Promise<Result<ProposalsVsWonReport>>;
  listEnquiries(query: PageRequest): Promise<Result<ListResponse<Enquiry>>>;
  getEnquiry(id: string): Promise<Result<EnquiryDetail>>;
  patchExtraction(id: string, patch: EnquiryExtractionPatch): Promise<Result<EnquiryDetail>>;
  listFollowUps(query: PageRequest): Promise<Result<ListResponse<FollowUp>>>;
  getFollowUpDraft(id: string, channel: MessageChannel): Promise<Result<MessageDraft>>;
  getOrganisation(id: string): Promise<Result<Organisation>>;
  getOrganisationRelations(id: string): Promise<Result<OrganisationRelations>>;
  getOpportunity(id: string): Promise<Result<Opportunity>>;
  getTna(id: string): Promise<Result<Tna>>;
  getTnaRecommendations(id: string): Promise<Result<TnaRecommendationsResponse>>;
  createProposal(input: ProposalInput): Promise<Result<Proposal>>;
  listProposals(query: PageRequest): Promise<Result<ListResponse<Proposal>>>;
  getProposal(id: string): Promise<Result<Proposal>>;
  addSection(id: string, input: SectionInput): Promise<Result<Proposal>>;
  putSection(id: string, n: number, input: SectionWriteInput): Promise<Result<Proposal>>;
  regenerateSection(id: string, n: number): Promise<Result<ProposalSectionRegenerateResponse>>;
  listQuotations(query: PageRequest): Promise<Result<ListResponse<Quotation>>>;
  getQuotation(id: string): Promise<Result<Quotation>>;
  rateCard(): Promise<Result<RateCard>>;
  putQuotation(id: string, input: QuotationInput): Promise<Result<Quotation>>;
  listApprovals(query: PageRequest): Promise<Result<ApprovalListResponse>>;
  getApproval(id: string): Promise<Result<ApprovalDetail>>;
  decideApproval(id: string, input: DecideInput): Promise<Result<ApprovalDecideResponse>>;
  bulkDecide(input: BulkDecideInput): Promise<Result<ApprovalBulkDecideResponse>>;
  audit(resourceType: string, id: string): Promise<Result<ListResponse<AuditEntry>>>;
  performAction(input: ActionInput): Promise<Result<ActionResponse>>;
  listTemplates(type?: TemplateType): Promise<Result<ListResponse<Template>>>;
  listPolicies(): Promise<Result<ListResponse<Policy>>>;
  getPolicy(id: string): Promise<Result<Policy>>;
  getPipelineConfig(object: PipelineObject): Promise<Result<PipelineConfig>>;
  listViews(): Promise<Result<ListResponse<SavedView>>>;
  listTrainers(): Promise<Result<ListResponse<Trainer>>>;
  listContacts(): Promise<Result<ListResponse<Contact>>>;
  getContact(id: string): Promise<Result<Contact>>;
  getContactConsent(id: string): Promise<Result<ListResponse<ChannelConsent>>>;
  listProgrammes(): Promise<Result<ListResponse<Programme>>>;
  getProgramme(id: string): Promise<Result<Programme>>;
  getProgrammeDeliveries(id: string): Promise<Result<ListResponse<ProgrammeDelivery>>>;
  listHrdcDeadlines(): Promise<Result<ListResponse<HrdcDeadline>>>;
  listCollectionRules(): Promise<Result<ListResponse<CollectionRule>>>;
  listComplianceRules(): Promise<Result<ListResponse<ComplianceRule>>>;
  getComplianceRule(id: string): Promise<Result<ComplianceRule>>;
  listRuleChanges(): Promise<Result<ListResponse<RuleChangeSet>>>;
  listEvals(): Promise<Result<ListResponse<AgentEval>>>;
  listKnowledgeSources(): Promise<Result<ListResponse<KnowledgeSource>>>;
  listAiTiers(): Promise<Result<ListResponse<ModelTier>>>;
  listBudgets(): Promise<Result<ListResponse<Budget>>>;

  /* §10 automation: agents and runs (027). */
  listAgents(): Promise<Result<AgentRegistryResponse>>;
  pauseAgent(id: string, body: AgentPauseRequest): Promise<Result<Agent>>;
  listRuns(query: PageRequest): Promise<Result<ListResponse<AutomationRun>>>;
  getRun(id: string): Promise<Result<AutomationRun>>;
  retryRun(id: string, from?: "checkpoint"): Promise<Result<AutomationRun>>;
  deadLetterRun(id: string, body: RunDeadLetterRequest): Promise<Result<AutomationRun>>;

  /* §17 knowledge (027). */
  createKnowledgeSource(body: KnowledgeSourceCreateRequest): Promise<Result<KnowledgeSource>>;
  checkKnowledgeSource(id: string): Promise<Result<KnowledgeSourceCheckResponse>>;
  reingestKnowledgeSource(id: string): Promise<Result<KnowledgeSourceReingestResponse>>;
  /* Fixture-only (data/library.ts) — no contract type, so this is untyped
     past ListResponse. See 027's PR body. */
  listLibraryAssets(query: PageRequest): Promise<Result<ListResponse<unknown>>>;

  /* §17 AI settings: routing, providers (read), usage, budgets, tenant (027). */
  getAiRouting(): Promise<Result<RoutingResponse>>;
  putAiRouting(entries: RoutingEntry[]): Promise<Result<RoutingResponse>>;
  listProviders(): Promise<Result<ListResponse<ProviderKey>>>;
  getUsage(period?: string, groupBy?: UsageGroupBy): Promise<Result<UsageResponse>>;
  putBudget(scope: BudgetScope, key: string, body: BudgetWrite): Promise<Result<Budget>>;
  /* Fixture-only (data/tenant.ts) — §1 keeps tenancy out of the API surface,
     so there is no contract type. See 027's PR body. */
  getTenant(): Promise<Result<unknown>>;
}
