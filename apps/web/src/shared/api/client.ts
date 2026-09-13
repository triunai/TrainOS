import type {
  ActionRequest,
  ActionResponse,
  AgentEval,
  ApprovalBulkDecideRequest,
  ApprovalDecideRequest,
  ApprovalDecideResponse,
  ApprovalBulkDecideResponse,
  ApprovalDetail,
  ApprovalListResponse,
  BadgeCounts,
  Budget,
  ChannelConsent,
  CollectionRule,
  ComplianceRule,
  Contact,
  Enquiry,
  EnquiryDetail,
  EnquiryExtractionPatch,
  FollowUp,
  HrdcDeadline,
  KnowledgeSource,
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
  Quotation,
  QuotationWrite,
  RuleChangeSet,
  SavedView,
  Template,
  TemplateType,
  Tna,
  TnaRecommendationsResponse,
  Trainer,
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
  getProposal(id: string): Promise<Result<Proposal>>;
  getQuotation(id: string): Promise<Result<Quotation>>;
  putQuotation(id: string, input: QuotationInput): Promise<Result<Quotation>>;
  listApprovals(query: PageRequest): Promise<Result<ApprovalListResponse>>;
  getApproval(id: string): Promise<Result<ApprovalDetail>>;
  decideApproval(id: string, input: DecideInput): Promise<Result<ApprovalDecideResponse>>;
  bulkDecide(input: BulkDecideInput): Promise<Result<ApprovalBulkDecideResponse>>;
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
}
