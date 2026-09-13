/**
 * The in-memory store.
 *
 * `createStore()` deep-copies the seed data so a test can mutate freely and
 * `resetStore()` puts everything back. Nothing here is contract surface — the
 * client is the only thing that reads it.
 */

import type {
  ActionDraft,
  Agent,
  AgentEval,
  AgentRegistrySummary,
  AttendanceSheet,
  AutomationRun,
  Budget,
  ClaimPacket,
  CollectionRule,
  ComplianceChecksResponse,
  ComplianceRule,
  Contact,
  Quotation,
  Engagement,
  EnquiryDetail,
  ExecutiveDashboard,
  FollowUp,
  HoursSavedReport,
  HrdcDeadline,
  Invoice,
  KnowledgeSource,
  Me,
  MessageDraft,
  MetricResponse,
  ModelTier,
  Opportunity,
  Organisation,
  OrganisationRelations,
  OrganisationSuggestion,
  Participant,
  PipelineConfig,
  Policy,
  PortalProposal,
  Programme,
  Proposal,
  ProposalsVsWonReport,
  ProviderKey,
  RateCard,
  Receivable,
  ReceivablesAging,
  RoutingEntry,
  RuleChangeSet,
  SavedView,
  SearchResult,
  Template,
  Tna,
  TnaRecommendationsResponse,
  UsageResponse,
  AuditEntry,
  BadgeCounts,
  ChannelConsent,
} from "@trainos/contract";
import type { FixtureCommission } from "../data/commissions";
import type { FixtureLibraryAsset } from "../data/library";
import * as data from "../data";
import type { FixtureApproval } from "../data/approvals";
import type { FixtureNotification } from "../data/shell";
import type { FixtureTrainer, ProgrammeDelivery } from "../data/programmes";
import type { FixtureTenant } from "../data/tenant";

/** Deep copy. Every fixture is JSON-safe by construction, so this is enough. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One recorded idempotency key: §1 retains them for 24 hours. */
export interface IdempotencyRecord {
  bodyHash: string;
  response: unknown;
  at: string;
}

export interface FixtureStore {
  tenant: FixtureTenant;
  users: Me[];
  pipelines: PipelineConfig[];

  organisations: Organisation[];
  contacts: Contact[];
  opportunities: Opportunity[];
  organisationRelations: Record<string, OrganisationRelations>;
  organisationSuggestions: Record<string, OrganisationSuggestion[]>;

  enquiries: EnquiryDetail[];
  followUps: FollowUp[];
  followUpDrafts: Record<string, MessageDraft>;
  contactConsents: Record<string, ChannelConsent[]>;

  programmes: Programme[];
  trainers: FixtureTrainer[];
  programmeDeliveries: Record<string, ProgrammeDelivery[]>;
  rateCard: RateCard;

  tnas: Tna[];
  tnaRecommendations: Record<string, TnaRecommendationsResponse>;
  proposals: Proposal[];
  quotations: Quotation[];
  portalProposals: Record<string, PortalProposal>;

  policies: Policy[];
  approvals: FixtureApproval[];

  engagements: Engagement[];
  participants: Participant[];
  attendanceSheets: Record<string, AttendanceSheet>;

  claimPackets: ClaimPacket[];
  hrdcDeadlines: HrdcDeadline[];
  complianceRules: ComplianceRule[];
  ruleChangeSets: RuleChangeSet[];
  complianceChecks: Record<string, ComplianceChecksResponse>;

  invoices: Invoice[];
  receivables: Receivable[];
  receivablesAging: ReceivablesAging;
  collectionRules: CollectionRule[];
  collectionDrafts: Record<string, MessageDraft>;
  /** Derived from quotations, invoices and the rate card — see data/commissions.ts. */
  commissions: FixtureCommission[];

  agents: Agent[];
  agentRegistrySummary: AgentRegistrySummary;
  agentEvals: AgentEval[];
  runs: AutomationRun[];

  modelTiers: ModelTier[];
  routingEntries: RoutingEntry[];
  routingUnsavedChanges: number;
  providerKeys: ProviderKey[];
  budgets: Budget[];
  usageByGrouping: Record<string, UsageResponse>;
  usageForecast: { period: string; forecast: { amount: number; currency: "MYR" }; cap: { amount: number; currency: "MYR" } };

  knowledgeSources: KnowledgeSource[];
  libraryAssets: FixtureLibraryAsset[];

  executiveDashboards: Record<string, ExecutiveDashboard>;
  proposalsVsWon: ProposalsVsWonReport;
  hoursSaved: HoursSavedReport;
  metricResponses: Record<string, MetricResponse>;

  savedViews: SavedView[];
  templates: Template[];
  auditEntries: Record<string, AuditEntry[]>;
  notifications: FixtureNotification[];
  searchResults: Record<string, SearchResult>;
  badgeCounts: BadgeCounts;

  /** §3 `SUGGESTED` drafts an agent handed over, by draft id. */
  drafts: Map<string, ActionDraft>;
  /** §1 `Idempotency-Key` → the original response. */
  idempotency: Map<string, IdempotencyRecord>;
  /** Monotonic counters so generated refs stay stable across a run. */
  counters: { approval: number; draft: number; run: number; invoice: number; payment: number };
}

export const createStore = (): FixtureStore => ({
  tenant: clone(data.tenant),
  users: clone(data.users),
  pipelines: clone(data.pipelines),

  organisations: clone(data.organisations),
  contacts: clone(data.contacts),
  opportunities: clone(data.opportunities),
  organisationRelations: clone(data.organisationRelations),
  organisationSuggestions: clone(data.organisationSuggestions),

  enquiries: clone(data.enquiries),
  followUps: clone(data.followUps),
  followUpDrafts: clone(data.followUpDrafts),
  contactConsents: clone(data.contactConsents),

  programmes: clone(data.programmes),
  trainers: clone(data.trainers),
  programmeDeliveries: clone(data.programmeDeliveries),
  rateCard: clone(data.rateCard),

  tnas: clone(data.tnas),
  tnaRecommendations: clone(data.tnaRecommendations),
  proposals: clone(data.proposals),
  quotations: clone(data.quotations),
  portalProposals: clone(data.portalProposals),

  policies: clone(data.policies),
  approvals: clone(data.approvals),

  engagements: clone(data.engagements),
  participants: clone(data.participants),
  attendanceSheets: clone(data.attendanceSheets),

  claimPackets: clone(data.claimPackets),
  hrdcDeadlines: clone(data.hrdcDeadlines),
  complianceRules: clone(data.complianceRules),
  ruleChangeSets: clone(data.ruleChangeSets),
  complianceChecks: clone(data.complianceChecks),

  invoices: clone(data.invoices),
  receivables: clone(data.receivables),
  receivablesAging: clone(data.receivablesAging),
  collectionRules: clone(data.collectionRules),
  collectionDrafts: clone(data.collectionDrafts),
  commissions: clone(data.commissions),

  agents: clone(data.agents),
  agentRegistrySummary: clone(data.agentRegistrySummary),
  agentEvals: clone(data.agentEvals),
  runs: clone(data.runs),

  modelTiers: clone(data.modelTiers),
  routingEntries: clone(data.routingEntries),
  routingUnsavedChanges: data.routingUnsavedChanges,
  providerKeys: clone(data.providerKeys),
  budgets: clone(data.budgets),
  usageByGrouping: clone(data.usageByGrouping),
  usageForecast: clone(data.usageForecast),

  knowledgeSources: clone(data.knowledgeSources),
  libraryAssets: clone(data.libraryAssets),

  executiveDashboards: clone(data.executiveDashboards),
  proposalsVsWon: clone(data.proposalsVsWon),
  hoursSaved: clone(data.hoursSaved),
  metricResponses: clone(data.metricResponses),

  savedViews: clone(data.savedViews),
  templates: clone(data.templates),
  auditEntries: clone(data.auditEntries),
  notifications: clone(data.notifications),
  searchResults: clone(data.searchResults),
  badgeCounts: clone(data.badgeCounts),

  drafts: new Map(),
  idempotency: new Map(),
  counters: { approval: 776, draft: 88, run: 4930, invoice: 311, payment: 0 },
});

/** Matches an entity by its opaque id or by its business ref — demos use both. */
export const byIdOrRef = <T extends { id?: string; ref?: string }>(
  rows: readonly T[],
  key: string,
): T | undefined => rows.find((row) => row.id === key || row.ref === key);
