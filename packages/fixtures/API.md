# @trainos/fixtures — client API

The complete `FixtureClient` surface, grouped the way `packages/contract/src/endpoints.ts`
groups it. Written for screen agents: if a screen needs something that is not
here, ask for it rather than hardcoding data in the screen.

Every method is async. Ids and business refs are interchangeable everywhere —
`getProposal("PRO-2026-0184")` and `getProposal(opaqueId)` both resolve.

See `README.md` for the dataset itself, the decisions applied over the earlier
contract text, and the contract gaps this package reports.

## Factory and client controls

```ts
createFixtureClient(config?: {
  latencyMs?: number;   // simulated round trip, default 120
  seed?: number;        // reserved; the dataset is deterministic
  actorId?: string;     // who is signed in, default "u_amirah" (SALES)
}): FixtureClient

fixtureClient            // shared singleton, for a UI that wants one instance
resetStore(): void       // rebuilds the singleton's store from the seed data
```

```ts
client.signInAs(actorId: string): void   // changes what /me returns and what is permitted
client.setLatency(ms: number): void
client.reset(): void                     // fresh store, drops every subscription
client.store: FixtureStore               // the raw store, for tests and seed loaders
client.actorId: string
client.lastMeta: { status: number; headers: Record<string, string> }
```

## Errors

```ts
class ContractError extends Error {
  code: ErrorCode;              // the §1 code
  http: number;                 // from the contract's ERROR_STATUS
  details?: ErrorDetails;       // the bag that code prescribes
  approvalRequestId?: string;
  toEnvelope(): ErrorEnvelope;  // the §1 body, as it would arrive over the wire
}

isContractError(value: unknown): value is ContractError
notFound(what: string, id: string): ContractError
forbidden(message: string, details?: ErrorDetails): ContractError
validationFailed(message: string, details?: ErrorDetails): ContractError
```

Errors are **thrown, never returned**. A `403` carries `requiredRole` and
`requiredPermission` so the UI can explain rather than just disable.

A UI boundary should catch at its adapter and convert once, because
`toEnvelope()` returns the contract's own `ErrorEnvelope` — so the layer that
normalises errors can stay coupled to `@trainos/contract` and never import this
package:

```ts
try {
  return ok(await fixtures.getQuotation(id));
} catch (thrown) {
  if (isContractError(thrown)) return fail(domainErrorFromEnvelope(thrown.toEnvelope()));
  throw thrown;
}
```

`isContractError` accepts both an `instanceof` match and the structural shape,
so it still returns true if a bundler ends up with two copies of this module.
Mis-classifying a refusal as a transport failure is what puts a retry button on
a policy decision, so the guard is deliberately not `instanceof`-only.

## Events

```ts
client.events.on(type, handler): Unsubscribe        // §14 by name, e.g. "ApprovalRequested"
client.events.onAny(handler): Unsubscribe           // every event, for an audit drawer
client.events.subscribe(channels, handler): Unsubscribe
client.events.emitted: DomainEvent[]                // the outbox, in order
```

Channels are the five §11 names: `badges`, `approvals`, `enquiries`,
`invoices`, and `runs:{runId}`. Handler payloads are the contract's
`DomainEvent` union, discriminated on `type`.

## §2 · Session and shell

```ts
getMe(): Me
getNavigation(role?: Role): NavigationTree
getBadges(): BadgeCounts
search(query: string): SearchResult
getAudit(resourceType: string, id: string): ListResponse<AuditEntry>
listViews(object?: SavedViewObject, page?: PageRequest): ListResponse<SavedView>
createView(body: SavedViewWrite, opts?: RequestOptions): SavedView
updateView(id: string, body: Partial<SavedViewWrite>): SavedView
deleteView(id: string): void
listTemplates(type?: TemplateType, page?: PageRequest): ListResponse<Template>
listPolicies(page?: PageRequest): ListResponse<Policy>
getPolicy(id: string): Policy
getPipelineConfig(object: string): PipelineConfig        // ENGAGEMENT | DEAL_CHAIN | OPPORTUNITY
listNotifications(): ListResponse<FixtureNotification>   // not a contract endpoint
```

## §3 · The action envelope

```ts
performAction(request: ActionRequest, opts?: RequestOptions): ActionResponse
performActionWithMeta(request: ActionRequest, opts?: RequestOptions): { response, meta }
```

## §4 · Enquiries, leads and follow-ups

```ts
listEnquiries(page?: PageRequest): ListResponse<Enquiry>
getEnquiry(id: string): EnquiryDetail
patchEnquiryExtraction(id: string, patch: EnquiryExtractionPatch): EnquiryDetail
listFollowUps(page?: PageRequest): ListResponse<FollowUp>
getFollowUpDraft(id: string, channel: "EMAIL" | "WHATSAPP"): MessageDraft
getContactConsent(contactId: string): ListResponse<ChannelConsent>
```

## §5 · Organisations, contacts, opportunities

```ts
getOrganisation(id: string): Organisation
getOrganisationRelations(id: string, types?: readonly string[]): OrganisationRelations
getOrganisationSuggestions(id: string): ListResponse<OrganisationSuggestion>
listContacts(page?: PageRequest): ListResponse<Contact>
getContact(id: string): Contact
listOpportunities(page?: PageRequest): ListResponse<Opportunity>
getOpportunity(id: string): Opportunity
patchOpportunity(id: string, patch: OpportunityPatch): Opportunity
```

## §6 · TNA, programmes, proposals, quotations

```ts
getTna(id: string): Tna
getTnaRecommendations(id: string): TnaRecommendationsResponse
reopenTna(id: string, opts?: RequestOptions): Tna
listProgrammes(page?: PageRequest): ListResponse<Programme>
getProgramme(id: string): Programme
getProgrammeDeliveries(id: string): ListResponse<ProgrammeDelivery>
putProgramme(id: string, body: Partial<Programme>): Programme          // ADMIN only
listTrainers(page?: PageRequest): ListResponse<FixtureTrainer>
createProposal(body: ProposalCreateRequest, opts?: RequestOptions): Proposal
getProposal(id: string): Proposal
putProposalSection(id: string, n: number, body: ProposalSectionWrite): Proposal
regenerateProposalSection(id: string, n: number): ProposalSectionRegenerateResponse
getProposalPreview(id: string, format?: "HTML" | "PDF"): ProposalPreview
getQuotation(id: string): QuotationWithFloors                          // needs quotation:read
putQuotation(id: string, body: QuotationWrite): QuotationWithFloors     // needs quotation:write
getRateCard(): RateCard
```

## §7 · Approvals

```ts
listApprovals(page?: PageRequest & { group?: "URGENCY" }): ApprovalListResponse
getApproval(id: string): ApprovalDetail
decideApproval(id: string, body: ApprovalDecideRequest, opts?: RequestOptions): ApprovalDecideResponse
bulkDecideApprovals(body: ApprovalBulkDecideRequest, opts?: RequestOptions): ApprovalBulkDecideResponse
```

## §8 · Engagements, participants, attendance

```ts
listEngagements(page?: PageRequest): ListResponse<EngagementProjection>
getEngagement(id: string): EngagementProjection            // no finance block for OPS
getEngagementParticipants(id: string, page?: PageRequest): ListResponse<Participant>
getAttendance(id: string, day?: number): AttendanceSheet
captureAttendance(id: string, day: number, body: AttendanceCaptureRequest): AttendanceSheet
exportAttendance(id: string, format?: string): AttendanceExport
```

## §9 · HRD Corp and finance

```ts
getClaimPacket(engagementRef: string): ClaimPacket
attachPacketDocument(id: string, body: HrdcDocumentAttachRequest): ClaimPacket
exportClaimPacket(id: string): HrdcPacketExport
listHrdcDeadlines(page?: PageRequest): ListResponse<HrdcDeadline>
createInvoice(body, opts?: RequestOptions): Invoice        // 422 if the total does not reconcile
listInvoices(page?: PageRequest): ListResponse<Invoice>
getInvoice(id: string): Invoice
recordPayment(id: string, body: PaymentRecordRequest, opts?: RequestOptions): Invoice
getReceivablesAging(): ReceivablesAging
listReceivables(page?: PageRequest): ListResponse<FixtureReceivable>
getCollectionsQueue(page?: PageRequest): FixtureCollectionsQueueResponse
getCollectionDraft(invoiceRef: string): MessageDraft
getCollectionRules(): ListResponse<CollectionRule>
```

## §10 · Agents, runs, dashboards

```ts
listAgents(): AgentRegistryResponse
getAgent(id: string): Agent
putAgentAutonomy(id: string, body: AgentAutonomyWrite): Agent     // MD only; 422 on a money-moving ceiling
pauseAgent(id: string, body: AgentPauseRequest, opts?: RequestOptions): Agent
listEvals(agentId?: string): ListResponse<AgentEval>
listRuns(page?: PageRequest): ListResponse<AutomationRun>
getRun(id: string): AutomationRun
retryRun(id: string, from?: "checkpoint"): AutomationRun
deadLetterRun(id: string, body: RunDeadLetterRequest, opts?: RequestOptions): AutomationRun
replayRun(id: string, mode?: "SANDBOX"): RunReplayResponse
getExecutiveDashboard(period?: string): ExecutiveDashboard
getMetric(key: string, scope?: string, id?: string): MetricResponse
getProposalsVsWon(months?: number): ProposalsVsWonReport
getHoursSaved(): HoursSavedReport
```

## §11 · Client portal, webhooks

```ts
getPortalProposal(token: string): PortalProposal
addPortalComment(token: string, body: PortalCommentRequest): PortalProposal
acceptPortalProposal(token: string, body: PortalAcceptRequest, opts?: RequestOptions): PortalAcceptResponse
submitPortalTna(token: string, body: PortalTnaSubmitRequest): Tna
accountingWebhook(payload: AccountingWebhookPayload): WebhookDuplicateResponse | Invoice
```

## §17 · AI operations, compliance, knowledge

```ts
getAiTiers(): ListResponse<ModelTier>
putAiTier(key: string, body: ModelTierWrite): ModelTier                 // ADMIN only
getAiRouting(): RoutingResponse
putAiRouting(entries: RoutingEntry[]): RoutingResponse                  // future runs only
listProviders(): ListResponse<ProviderKey>
createProvider(body: ProviderKeyCreateRequest, opts?: RequestOptions): ProviderKey
testProvider(id: string): ProviderKeyTestResponse
rotateProvider(id: string, body: ProviderKeyRotateRequest): ProviderKey
revealProvider(id: string): ProviderKeyRevealResponse                   // ADMIN only, audited
deleteProvider(id: string): void                                        // 409 if a tier is orphaned
getUsage(period?: string, groupBy?: "TIER" | "AGENT" | "ACTION_TYPE"): UsageResponse
getUsageForecast(period?: string): UsageForecast
getBudgets(): ListResponse<Budget>
putBudget(scope: BudgetScope, key: string, body: BudgetWrite): Budget    // raising a cap is MD-gated
listComplianceRules(page?: PageRequest): ListResponse<ComplianceRule>
getComplianceRule(id: string): ComplianceRule
createComplianceRule(body): ComplianceRule                               // loads as PROPOSED
putComplianceRule(id: string, body: Partial<ComplianceRule>): ComplianceRule
listRuleChanges(page?: PageRequest): ListResponse<RuleChangeSet>
getRuleChangeSet(documentId: string): RuleChangeSet
getComplianceChecks(engagementRef: string): ComplianceChecksResponse
listKnowledgeSources(page?: PageRequest): ListResponse<KnowledgeSource>
createKnowledgeSource(body: KnowledgeSourceCreateRequest): KnowledgeSource
checkKnowledgeSource(id: string): KnowledgeSourceCheckResponse
reingestKnowledgeSource(id: string): KnowledgeSourceReingestResponse
```

## Agent-runtime reads

Derivations over the same store the endpoint methods use, so an agent and a
screen can never see different numbers.

```ts
draftProposal(input: {
  organisationRef: string;
  programmeRef: string;
  quotationRef?: string;
  templateId?: string;
  sections?: readonly { key?: string; heading: string; body: string }[];
}, opts?: RequestOptions): ProposalDraftResult
searchOrganisations(query: string): Organisation[]
searchProgrammes(query: string, tags?: readonly string[]): Programme[]
listTrainerAvailability(programmeRef: string, from: DateOnly, to: DateOnly): TrainerAvailability[]
computeQuotation(input: { programmeRef: string; pax: number; days?: number; discountRate?: Rate }): ComputedQuotation
```

`draftProposal` resolves the organisation to its opportunity itself — the open
one if there is one, the most recently updated otherwise — because
`ProposalCreateRequest` needs an `opportunityRef` and that walk is domain
knowledge. If every consumer did it in its own adapter, each would pick a
slightly different opportunity.

`ComputedQuotation.proposalValue` is deliberately separate from `total`: the §3
gate compares the ex-SST figure against the APV-01 threshold, and folding tax
into the value would push an RM 14,900 proposal over an RM 15,000 gate on tax
alone.

## Four things not to rediscover

**Lists.** Every `page?` parameter is a `PageRequest`:
`{ filter?: FilterClause[], sort?: "-field", page?: { size, cursor }, view?: savedViewId }`.
A saved view's filters merge **underneath** the request's and the request wins
on the same field; `appliedFilters[]` on the response says which clause came
from where.

**Idempotency.** Pass `opts.idempotencyKey` on writes. The same key with the
same body replays the original response and sets
`lastMeta.headers["Idempotent-Replay"] === "true"`; the same key with a
different body throws `IDEMPOTENT_REPLAY`.

**Permissions are enforced, not advisory.** OPS holds no `quotation:read`, so
`getQuotation` throws `403` for an OPS principal and `getEngagement` returns no
`finance` block for them. Check the projection; do not assume `finance` exists.

**A run trace guarantees its shape, not its size.** `run_4821` has one root,
every `parentId` resolving inside the run, and the APV-01 halt naming the
approval. It does **not** guarantee a node count: the agent runtime resumes
across workers, so how many nodes a trace has is a function of how the run was
sliced. Assert on the halt and the parentage, never on `nodes.length`.

**The gate reads the record, not the request.** An action's gated value comes
from the stored record, so understating a value in a payload changes nothing.
An identical pending approval is the same request, so re-proposing
`PROPOSAL_SEND` on PRO-2026-0184 returns the standing APV-2026-0771 rather than
queueing a duplicate.
