# @trainos/fixtures — client API (commit 1c73e18). Import from "@trainos/fixtures".

FACTORY: createFixtureClient({ latencyMs?=120, seed?, actorId? }): FixtureClient · fixtureClient (singleton) · resetStore() · client.signInAs(actorId) · client.setLatency(ms) · client.reset() · client.lastMeta
Every method async. Ids and refs interchangeable (getProposal("PRO-2026-0184") works).
ERRORS: class ContractError { code: ErrorCode; http; details?; approvalRequestId?; toEnvelope() } — thrown, never returned. isContractError(v).
EVENTS: client.events.on(type, h) → unsubscribe · client.events.onAny(h) · client.events.subscribe(channels[], h) channels: badges, approvals, enquiries, invoices, runs:{runId} · client.events.emitted. Payload = contract DomainEvent union discriminated on type.
LISTS take PageRequest { filter?: FilterClause[], sort?: "-field", page?: { size, cursor }, view?: savedViewId }; response.appliedFilters[] says source. Writes take opts.idempotencyKey (replay → lastMeta.headers["Idempotent-Replay"]==="true"; different body → IDEMPOTENT_REPLAY).
PERMISSIONS ENFORCED: OPS has no quotation:read → getQuotation 403s; getEngagement returns no finance block for OPS (EngagementProjection).

§2 SHELL: getMe() · getNavigation(role?) · getBadges() · search(q) · getAudit(resourceType,id) · listViews(object?,page?) createView updateView deleteView · listTemplates(type?) · listPolicies() getPolicy(id) · getPipelineConfig("ENGAGEMENT"|"DEAL_CHAIN"|"OPPORTUNITY") · listNotifications()
§3 ACTIONS: performAction(request: ActionRequest, opts?) → ActionResponse (EXECUTED | QUEUED_FOR_APPROVAL | SUGGESTED) · performActionWithMeta
§4 ENQUIRIES: listEnquiries(page?) getEnquiry(id) patchEnquiryExtraction(id,patch) · listFollowUps(page?) getFollowUpDraft(id,"EMAIL"|"WHATSAPP") getContactConsent(contactId)
§5 ORGS: getOrganisation(id) getOrganisationRelations(id,types?) getOrganisationSuggestions(id) · listContacts getContact · listOpportunities getOpportunity patchOpportunity
§6 TNA/PROGRAMMES/PROPOSALS/QUOTATIONS: getTna(id) getTnaRecommendations(id) reopenTna(id) · listProgrammes getProgramme getProgrammeDeliveries putProgramme · listTrainers · createProposal getProposal putProposalSection(id,n,body) regenerateProposalSection(id,n) getProposalPreview(id,format?) · getQuotation(id): QuotationWithFloors (has bindingFloorBasis) putQuotation(id,body) · getRateCard()
§7 APPROVALS: listApprovals(page? & {group?:"URGENCY"}): ApprovalListResponse (groups breaching/today/week) · getApproval(id): ApprovalDetail · decideApproval(id,body,opts?) · bulkDecideApprovals(body,opts?) (409 on money-moving)
§8 ENGAGEMENTS: listEngagements getEngagement(id): EngagementProjection · getEngagementParticipants(id,page?) · getAttendance(id,day?) captureAttendance(id,day,body) (409 ATTENDANCE_LOCKED) exportAttendance(id,format?)
§9 HRDC/FINANCE: getClaimPacket(engagementRef) attachPacketDocument(id,body) exportClaimPacket(id) listHrdcDeadlines · createInvoice listInvoices getInvoice recordPayment(id,body) · getReceivablesAging() listReceivables getCollectionsQueue getCollectionDraft(invoiceRef) getCollectionRules()
§10 AGENTS/RUNS/DASHBOARDS: listAgents getAgent putAgentAutonomy(id,body) pauseAgent(id,body) listEvals(agentId?) · listRuns getRun(id) retryRun(id,from?) deadLetterRun(id,body) replayRun(id,mode?) · getExecutiveDashboard(period?) getMetric(key,scope?,id?) getProposalsVsWon(months?) getHoursSaved()
§11 PORTAL: getPortalProposal(token) addPortalComment(token,body) acceptPortalProposal(token,body) submitPortalTna(token,body)
§17 AI OPS/COMPLIANCE: getAiTiers putAiTier(key,body) getAiRouting putAiRouting(entries) · listProviders createProvider testProvider rotateProvider revealProvider deleteProvider · getUsage(period?,groupBy?) getUsageForecast getBudgets putBudget(scope,key,body) · listComplianceRules getComplianceRule createComplianceRule putComplianceRule · listRuleChanges getRuleChangeSet(documentId) getComplianceChecks(engagementRef) · listKnowledgeSources createKnowledgeSource checkKnowledgeSource reingestKnowledgeSource
Fixture-only types: FixtureTrainer, FixtureNotification, ProgrammeDelivery, FixtureReceivable, EngagementProjection, QuotationWithFloors.
Missing something? SendMessage the agent named `fixtures` (may be shut down → tell team-lead).
