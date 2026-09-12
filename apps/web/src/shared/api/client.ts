import type {
  ActionRequest,
  ActionResponse,
  Agent,
  AgentRegistryResponse,
  ApprovalDecideRequest,
  ApprovalDecideResponse,
  ApprovalDetail,
  ApprovalListResponse,
  AutomationRun,
  BadgeCounts,
  ClaimPacket,
  CollectionsQueueResponse,
  ComplianceRule,
  Contact,
  Engagement,
  Enquiry,
  EnquiryDetail,
  ExecutiveDashboard,
  FollowUp,
  HrdcDeadline,
  Invoice,
  KnowledgeSource,
  ListResponse,
  Me,
  ModelTier,
  NavigationTree,
  Opportunity,
  Organisation,
  OrganisationRelations,
  PageRequest,
  PipelineConfig,
  Policy,
  Programme,
  Proposal,
  Quotation,
  RuleChangeSet,
  RunStateCard,
  SavedView,
  SearchResult,
  Template,
  Tna,
  TnaRecommendationsResponse,
  UsageResponse,
} from "@trainos/contract";
import type { Result } from "./errors";

/**
 * THE DATA BOUNDARY.
 *
 * One interface, grouped by the API contract's own sections, describing every
 * call the app may make. Nothing outside `src/shared/api` constructs a request,
 * and no screen imports `fetch`.
 *
 * The shape is deliberate:
 *  - Every method returns `Promise<Result<T>>` — a `{ data, error }` tuple —
 *    and never throws for an expected failure, so a caller keeps an ordinary
 *    `if (error)` idiom and cannot forget the refusal path.
 *  - Every response type comes from `@trainos/contract`. A contract change is a
 *    compile error at every call site rather than a silent shape mismatch.
 *  - There is no implementation in this file. Implementations live beside it
 *    (`fixture-client.ts` today, an HTTP client later) and are selected once,
 *    in `index.ts`.
 *
 * Adding an endpoint: add it to the section interface here in the SAME change
 * as the contract type it returns. A method that exists in one and not the
 * other is the drift this boundary exists to prevent.
 */

/** §2 · Session and shell — every screen depends on these. */
export interface ShellApi {
  getMe(): Promise<Result<Me>>;
  getNavigation(): Promise<Result<NavigationTree>>;
  getBadgeCounts(): Promise<Result<BadgeCounts>>;
  search(query: string): Promise<Result<SearchResult>>;
  listSavedViews(object: string): Promise<Result<ListResponse<SavedView>>>;
  listTemplates(): Promise<Result<ListResponse<Template>>>;
  listPolicies(): Promise<Result<ListResponse<Policy>>>;
  getPipelineConfig(): Promise<Result<PipelineConfig[]>>;
}

/**
 * §3 · The action envelope.
 *
 * One entry point for every governed write. The response is a union: executed,
 * queued behind an approval, or returned as a suggestion. A caller must handle
 * all three — an approval is a success, not an error.
 */
export interface ActionsApi {
  submitAction(request: ActionRequest, idempotencyKey: string): Promise<Result<ActionResponse>>;
}

/** §4 · Enquiries, leads and follow-ups. */
export interface EnquiriesApi {
  listEnquiries(page?: PageRequest): Promise<Result<ListResponse<Enquiry>>>;
  getEnquiry(id: string): Promise<Result<EnquiryDetail>>;
  listFollowUps(page?: PageRequest): Promise<Result<ListResponse<FollowUp>>>;
}

/** §5 · Organisations, contacts, opportunities. */
export interface OrganisationsApi {
  getOrganisation(id: string): Promise<Result<Organisation>>;
  getOrganisationRelations(id: string): Promise<Result<OrganisationRelations>>;
  listContacts(page?: PageRequest): Promise<Result<ListResponse<Contact>>>;
  listOpportunities(page?: PageRequest): Promise<Result<ListResponse<Opportunity>>>;
}

/** §6 · TNA, programmes, proposals, costings. */
export interface ProposalsApi {
  getTna(id: string): Promise<Result<Tna>>;
  getTnaRecommendations(id: string): Promise<Result<TnaRecommendationsResponse>>;
  listProgrammes(page?: PageRequest): Promise<Result<ListResponse<Programme>>>;
  getProposal(id: string): Promise<Result<Proposal>>;
  getQuotation(id: string): Promise<Result<Quotation>>;
}

/** §7 · Approvals. */
export interface ApprovalsApi {
  listApprovals(page?: PageRequest): Promise<Result<ApprovalListResponse>>;
  getApproval(id: string): Promise<Result<ApprovalDetail>>;
  decideApproval(
    id: string,
    request: ApprovalDecideRequest,
  ): Promise<Result<ApprovalDecideResponse>>;
}

/** §8 · Engagements, sessions, attendance, participants. */
export interface EngagementsApi {
  listEngagements(page?: PageRequest): Promise<Result<ListResponse<Engagement>>>;
  getEngagement(id: string): Promise<Result<Engagement>>;
}

/** §9 · HRD Corp compliance, and §10 · finance. */
export interface ComplianceFinanceApi {
  listComplianceRules(page?: PageRequest): Promise<Result<ListResponse<ComplianceRule>>>;
  getRuleChangeSet(id: string): Promise<Result<RuleChangeSet>>;
  listHrdcDeadlines(page?: PageRequest): Promise<Result<ListResponse<HrdcDeadline>>>;
  getClaimPacket(id: string): Promise<Result<ClaimPacket>>;
  listInvoices(page?: PageRequest): Promise<Result<ListResponse<Invoice>>>;
  getCollectionsQueue(page?: PageRequest): Promise<Result<CollectionsQueueResponse>>;
}

/** §14 · Knowledge sources and the library. */
export interface KnowledgeApi {
  listKnowledgeSources(page?: PageRequest): Promise<Result<ListResponse<KnowledgeSource>>>;
  getKnowledgeSource(id: string): Promise<Result<KnowledgeSource>>;
}

/** §15 · Agents, runs and the autonomy matrix. */
export interface AgentsApi {
  getAgentRegistry(): Promise<Result<AgentRegistryResponse>>;
  getAgent(id: string): Promise<Result<Agent>>;
  listRuns(page?: PageRequest): Promise<Result<ListResponse<AutomationRun>>>;
  getRunStateCard(runId: string): Promise<Result<RunStateCard>>;
}

/** §17 · AI operations — model tiers, routing, provider keys, usage. */
export interface AiOpsApi {
  listModelTiers(): Promise<Result<ModelTier[]>>;
  getUsage(): Promise<Result<UsageResponse>>;
}

/** §16 · Reports and the executive dashboard. */
export interface ReportsApi {
  getExecutiveDashboard(): Promise<Result<ExecutiveDashboard>>;
}

/**
 * The whole client. One object, composed of the section interfaces above, so a
 * consumer can depend on a narrow slice (`ApprovalsApi`) in a test while the
 * app wires the full surface once.
 */
export interface TrainOsClient
  extends ShellApi,
    ActionsApi,
    EnquiriesApi,
    OrganisationsApi,
    ProposalsApi,
    ApprovalsApi,
    EngagementsApi,
    ComplianceFinanceApi,
    KnowledgeApi,
    AgentsApi,
    AiOpsApi,
    ReportsApi {}

/** Every method name on the client, for exhaustiveness checks in an implementation. */
export type TrainOsClientMethod = keyof TrainOsClient;
