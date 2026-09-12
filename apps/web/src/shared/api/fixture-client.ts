import type { TrainOsClient, TrainOsClientMethod } from "./client";
import { fail, NOT_IMPLEMENTED, type Result } from "./errors";

/**
 * The fixture client.
 *
 * Every method is declared and every method refuses, with the method name in
 * the message. That is the point: the app can be built, routed, typed and
 * rendered end to end before a single fixture exists, and a screen that reaches
 * for data it has not been given fails LOUDLY and specifically rather than
 * rendering an empty list that looks like a legitimate empty state.
 *
 * `NOT_IMPLEMENTED` is a TRANSPORT error, not a domain one, so it is never
 * mistaken for a server refusal and never retried.
 *
 * The fixtures package fills these in one at a time. Replacing a body here is
 * the whole change — no call site moves.
 */

const notImplemented = <T>(method: TrainOsClientMethod): Promise<Result<T>> =>
  Promise.resolve(fail<T>(NOT_IMPLEMENTED(method)));

export const fixtureClient: TrainOsClient = {
  getMe: () => notImplemented("getMe"),
  getNavigation: () => notImplemented("getNavigation"),
  getBadgeCounts: () => notImplemented("getBadgeCounts"),
  search: (_query) => notImplemented("search"),
  listSavedViews: (_object) => notImplemented("listSavedViews"),
  listTemplates: () => notImplemented("listTemplates"),
  listPolicies: () => notImplemented("listPolicies"),
  getPipelineConfig: () => notImplemented("getPipelineConfig"),
  submitAction: (_request, _idempotencyKey) => notImplemented("submitAction"),
  listEnquiries: (_page) => notImplemented("listEnquiries"),
  getEnquiry: (_id) => notImplemented("getEnquiry"),
  listFollowUps: (_page) => notImplemented("listFollowUps"),
  getOrganisation: (_id) => notImplemented("getOrganisation"),
  getOrganisationRelations: (_id) => notImplemented("getOrganisationRelations"),
  listContacts: (_page) => notImplemented("listContacts"),
  listOpportunities: (_page) => notImplemented("listOpportunities"),
  getTna: (_id) => notImplemented("getTna"),
  getTnaRecommendations: (_id) => notImplemented("getTnaRecommendations"),
  listProgrammes: (_page) => notImplemented("listProgrammes"),
  getProposal: (_id) => notImplemented("getProposal"),
  getQuotation: (_id) => notImplemented("getQuotation"),
  listApprovals: (_page) => notImplemented("listApprovals"),
  getApproval: (_id) => notImplemented("getApproval"),
  decideApproval: (_id, _request) => notImplemented("decideApproval"),
  listEngagements: (_page) => notImplemented("listEngagements"),
  getEngagement: (_id) => notImplemented("getEngagement"),
  listComplianceRules: (_page) => notImplemented("listComplianceRules"),
  getRuleChangeSet: (_id) => notImplemented("getRuleChangeSet"),
  listHrdcDeadlines: (_page) => notImplemented("listHrdcDeadlines"),
  getClaimPacket: (_id) => notImplemented("getClaimPacket"),
  listInvoices: (_page) => notImplemented("listInvoices"),
  getCollectionsQueue: (_page) => notImplemented("getCollectionsQueue"),
  listKnowledgeSources: (_page) => notImplemented("listKnowledgeSources"),
  getKnowledgeSource: (_id) => notImplemented("getKnowledgeSource"),
  getAgentRegistry: () => notImplemented("getAgentRegistry"),
  getAgent: (_id) => notImplemented("getAgent"),
  listRuns: (_page) => notImplemented("listRuns"),
  getRunStateCard: (_runId) => notImplemented("getRunStateCard"),
  listModelTiers: () => notImplemented("listModelTiers"),
  getUsage: () => notImplemented("getUsage"),
  getExecutiveDashboard: () => notImplemented("getExecutiveDashboard"),
};
