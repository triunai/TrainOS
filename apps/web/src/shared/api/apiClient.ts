import type {
  ActionRequest,
  AgentPauseRequest,
  ApprovalBulkDecideRequest,
  ApprovalDecideRequest,
  AttendanceCaptureRequest,
  Budget,
  ComplianceRule,
  EnquiryExtractionPatch,
  HrdcDocumentAttachRequest,
  KnowledgeSourceCreateRequest,
  MessageChannel,
  PageRequest,
  Programme,
  ProposalCreateRequest,
  ProposalSectionWrite,
  QuotationWrite,
  RoutingEntry,
  RunDeadLetterRequest,
  SavedView,
  TemplateType,
} from "@trainos/contract";
import {
  ContractError,
  EventBus,
  paginate,
  type FixtureClient,
  type FixtureLibraryAsset,
  type FixtureTenant,
} from "@trainos/fixtures";

import type { TrainOsClient } from "./client";
import {
  ApiErrorException,
  transportError,
  withDiagnostics,
  type ErrorDiagnostics,
  type Result,
} from "./errors";
import {
  bulkDecideIdempotencyKey,
  derivedIdempotencyKey,
  stableIdempotencyKey,
} from "./idempotency";
import { createRpcClient } from "./rpcClient";

/**
 * The seam's type: the fixture client's PUBLIC surface, with the class brand
 * removed.
 *
 * `FixtureClient` holds `#private` fields, which makes its class type NOMINAL —
 * no other object can ever satisfy it, so `implements FixtureClient` is not
 * available to the RPC adapter. The homomorphic mapped type keeps every public
 * member and drops the brand, which is what lets two unrelated implementations
 * mount behind one `ApiContext`.
 *
 * The fixture client stays the definition rather than a hand-written interface
 * because it is the ORACLE: it implements all 115 endpoints today, and a
 * hand-written seam type would immediately be a second, drifting description of
 * the same surface.
 */
export type ApiClient = { [K in keyof FixtureClient]: FixtureClient[K] };

/**
 * `Result` in, value or throw out.
 *
 * The app's 600-odd call sites were written against a client that THROWS, and
 * `toApiError()` already knows how to turn a `ContractError` back into a
 * `DomainError` with its code, status and details intact. Rethrowing the
 * contract's own error type therefore keeps the whole existing error pipeline —
 * `ErrorState`'s retry decision included — working unchanged. Converting to
 * some new exception here would put a retry button back on policy decisions,
 * which is the exact failure `errors.ts` exists to prevent.
 */
function must<T>(result: Result<T>): T {
  if (result.error === null) return result.data;
  if (result.error.kind === "domain") {
    /* The operation and the database's own code ride along on the rethrown
       refusal, so the error state's Details can still name what refused. */
    throw Object.assign(
      new ContractError(
        result.error.code,
        result.error.message,
        result.error.details,
        result.error.approvalRequestId,
      ),
      diagnosticsOnly(result.error),
    );
  }
  throw new ApiErrorException(result.error);
}

function diagnosticsOnly({ operation, sourceCode }: ErrorDiagnostics): ErrorDiagnostics {
  return {
    ...(operation === undefined ? {} : { operation }),
    ...(sourceCode === undefined ? {} : { sourceCode }),
  };
}

/** §1 `Idempotency-Key`, as the fixture client's options bag carries it. */
interface RequestOptions {
  idempotencyKey?: string;
}

/**
 * The methods the Supabase client can answer today, under the fixture client's
 * own names and argument shapes.
 *
 * Names differ on purpose: `TrainOsClient` is named for the contract's RPCs
 * (`me`, `navigation`), the fixture client for its HTTP methods (`getMe`,
 * `getNavigation`). Mapping them here rather than renaming either is what keeps
 * the gate reading contract names and the app reading endpoint names.
 */
function adapters(rpc: TrainOsClient): Record<string, (...args: never[]) => unknown> {
  const key = (options: RequestOptions | undefined, fallback: string): string =>
    options?.idempotencyKey ?? fallback;

  return {
    getMe: async () => must(await rpc.me()),
    getMeProfile: async () => must(await rpc.meProfile()),
    getNavigation: async () => must(await rpc.navigation()),
    getBadges: async () => must(await rpc.badges()),
    getExecutiveDashboard: async (period: string) => must(await rpc.getExecutiveDashboard(period)),
    getProposalsVsWon: async (months: number) => must(await rpc.getProposalsVsWon(months)),

    listEnquiries: async (page?: PageRequest) => must(await rpc.listEnquiries(page ?? {})),
    getEnquiry: async (id: string) => must(await rpc.getEnquiry(id)),
    patchEnquiryExtraction: async (id: string, patch: EnquiryExtractionPatch) =>
      must(await rpc.patchExtraction(id, patch)),

    listFollowUps: async (page?: PageRequest) => must(await rpc.listFollowUps(page ?? {})),
    getFollowUpDraft: async (id: string, channel: MessageChannel) =>
      must(await rpc.getFollowUpDraft(id, channel)),

    getOrganisation: async (id: string) => must(await rpc.getOrganisation(id)),
    getOrganisationRelations: async (id: string) => must(await rpc.getOrganisationRelations(id)),
    searchOrganisations: async (query: string) => must(await rpc.searchOrganisations(query)),
    getOrganisationSuggestions: async (id: string) =>
      must(await rpc.getOrganisationSuggestions(id)),

    getOpportunity: async (id: string) => must(await rpc.getOpportunity(id)),
    listOpportunities: async (page?: PageRequest) => must(await rpc.listOpportunities(page ?? {})),

    getTna: async (id: string) => must(await rpc.getTna(id)),
    listTnas: async (page?: PageRequest) => must(await rpc.listTnas(page ?? {})),
    /* No options bag on the RPC signature: `reopen_tna` is a `patch_enquiry_
       extraction`-shaped detail edit, not a doc 09 §9 governed write, so it
       takes no idempotency key server-side either. */
    reopenTna: async (id: string, _options?: RequestOptions) => must(await rpc.reopenTna(id)),
    getTnaRecommendations: async (id: string) => must(await rpc.getTnaRecommendations(id)),

    listEngagements: async (page?: PageRequest) => must(await rpc.listEngagements(page ?? {})),
    getEngagement: async (id: string) => must(await rpc.getEngagement(id)),
    getEngagementParticipants: async (id: string, page?: PageRequest) =>
      must(await rpc.getEngagementParticipants(id, page ?? {})),
    getAttendance: async (id: string, day = 1) => must(await rpc.getAttendance(id, day)),
    captureAttendance: async (id: string, day: number, body: AttendanceCaptureRequest) =>
      must(await rpc.captureAttendance(id, day, body)),
    exportAttendance: async (id: string, format = "HRDC") =>
      must(await rpc.exportAttendance(id, format)),

    createProposal: async (body: ProposalCreateRequest, options?: RequestOptions) =>
      must(
        await rpc.createProposal({
          ...body,
          idempotencyKey: key(
            options,
            derivedIdempotencyKey("proposal-create", body.opportunityRef, body),
          ),
        }),
      ),
    listProposals: async (page?: PageRequest) => must(await rpc.listProposals(page ?? {})),
    getProposal: async (id: string) => must(await rpc.getProposal(id)),
    /* No options bag on the fixture signature for the two section writes, so
       the key is derived here — the same derivation the hooks use, not a
       second one. `n` rides in the subject because section 2 of a proposal is
       a different intent from section 3 of the same one. */
    addProposalSection: async (
      id: string,
      body: { title: string; body?: string },
      options?: RequestOptions,
    ) =>
      must(
        await rpc.addSection(id, {
          ...body,
          idempotencyKey: key(options, derivedIdempotencyKey("proposal-section-add", id, body)),
        }),
      ),
    putProposalSection: async (id: string, n: number, body: ProposalSectionWrite) =>
      must(
        await rpc.putSection(id, n, {
          ...body,
          idempotencyKey: derivedIdempotencyKey("proposal-section-put", `${id}#${n}`, body),
        }),
      ),
    regenerateProposalSection: async (id: string, n: number) =>
      must(await rpc.regenerateSection(id, n)),
    listQuotations: async (page?: PageRequest) => must(await rpc.listQuotations(page ?? {})),
    getQuotation: async (id: string) => must(await rpc.getQuotation(id)),
    getRateCard: async () => must(await rpc.rateCard()),
    /* No options bag on the fixture signature, so the key is derived here — the
       same derivation the hooks use, not a second one. */
    putQuotation: async (id: string, body: QuotationWrite) =>
      must(
        await rpc.putQuotation(id, {
          ...body,
          idempotencyKey: derivedIdempotencyKey("quotation-put", id, body),
        }),
      ),

    listApprovals: async (page?: PageRequest) => must(await rpc.listApprovals(page ?? {})),
    getApproval: async (id: string) => must(await rpc.getApproval(id)),
    getAudit: async (resourceType: string, id: string) => must(await rpc.audit(resourceType, id)),
    decideApproval: async (id: string, body: ApprovalDecideRequest, options?: RequestOptions) =>
      must(
        await rpc.decideApproval(id, {
          ...body,
          idempotencyKey: key(options, derivedIdempotencyKey("approval-decide", id, body)),
        }),
      ),
    bulkDecideApprovals: async (body: ApprovalBulkDecideRequest, options?: RequestOptions) =>
      must(
        await rpc.bulkDecide({
          ...body,
          /* ⚠ THE KEY IS DERIVED FROM THE SELECTION AS A SET, NOT IN CLICK ORDER.
             `app.bulk_decide` takes its idempotency request hash over the ids
             `array_agg(x ORDER BY x)` — SORTED (011:3447) — precisely because
             "the client hashes its selection in click order, so the same two
             approvals picked in the other order produced a different key and a
             spurious refusal on the retry". Sorting server-side fixes the hash
             COMPARISON but not the KEY: `stableStringify` sorts object keys and
             leaves array order alone, so {A,B} and {B,A} still derived two
             different keys, landed two idempotency rows, and the retry ran the
             batch a SECOND time instead of replaying it — the inverse of what
             the key is for, and a double decide on the one write a person makes
             with money behind it.

             Only the DERIVATION is sorted. The wire array keeps click order,
             because 011:3506 iterates `p_items` in the order given to build
             `results`, and the inbox reads that order back. */
          idempotencyKey: key(options, bulkDecideIdempotencyKey(body)),
        }),
      ),

    performAction: async (request: ActionRequest, options?: RequestOptions) =>
      must(
        await rpc.performAction({
          ...request,
          idempotencyKey: key(options, stableIdempotencyKey(request)),
        }),
      ),

    /* The §8 view reads. These carry no server-side page envelope, so paging is
       applied here with the contract's own `paginate` — the fixture client's
       function, deliberately, so the two clients cannot page differently. */
    listTemplates: async (type?: TemplateType, page?: PageRequest) =>
      paginate(must(await rpc.listTemplates(type)).data, page),
    listPolicies: async (page?: PageRequest) => paginate(must(await rpc.listPolicies()).data, page),
    getPolicy: async (id: string) => must(await rpc.getPolicy(id)),
    getPipelineConfig: async (object: Parameters<TrainOsClient["getPipelineConfig"]>[0]) =>
      must(await rpc.getPipelineConfig(object)),
    listViews: async (object?: SavedView["object"], page?: PageRequest) => {
      const rows = must(await rpc.listViews()).data;
      return paginate(object === undefined ? rows : rows.filter((v) => v.object === object), page);
    },
    listTrainers: async (page?: PageRequest) => paginate(must(await rpc.listTrainers()).data, page),
    listContacts: async (page?: PageRequest) => paginate(must(await rpc.listContacts()).data, page),
    getContact: async (id: string) => must(await rpc.getContact(id)),
    getContactConsent: async (id: string) => must(await rpc.getContactConsent(id)),
    listProgrammes: async (page?: PageRequest) =>
      paginate(must(await rpc.listProgrammes()).data, page),
    getProgramme: async (id: string) => must(await rpc.getProgramme(id)),
    getProgrammeDeliveries: async (id: string) => must(await rpc.getProgrammeDeliveries(id)),
    putProgramme: async (id: string, body: Partial<Programme>) =>
      must(await rpc.putProgramme(id, body)),
    listHrdcDeadlines: async (page?: PageRequest) =>
      paginate(must(await rpc.listHrdcDeadlines()).data, page),
    getClaimPacket: async (engagementRef: string) => must(await rpc.getClaimPacket(engagementRef)),
    /* No options bag on the fixture signature, so the key is derived here —
       the same derivation the hooks use, not a second one. */
    attachPacketDocument: async (engagementRef: string, body: HrdcDocumentAttachRequest) =>
      must(
        await rpc.attachPacketDocument(engagementRef, {
          ...body,
          idempotencyKey: derivedIdempotencyKey("hrdc-packet-attach", engagementRef, body),
        }),
      ),
    exportClaimPacket: async (engagementRef: string) =>
      must(await rpc.exportClaimPacket(engagementRef)),
    getComplianceChecks: async (engagementRef: string) =>
      must(await rpc.getComplianceChecks(engagementRef)),
    getCollectionRules: async () => must(await rpc.listCollectionRules()),
    listComplianceRules: async (page?: PageRequest) =>
      paginate(must(await rpc.listComplianceRules()).data, page),
    getComplianceRule: async (id: string) => must(await rpc.getComplianceRule(id)),
    /* No options bag on the fixture signature, so the key is derived here —
       the same derivation the hooks use, not a second one. */
    createComplianceRule: async (body: Omit<ComplianceRule, "status">) =>
      must(
        await rpc.createComplianceRule({
          ...body,
          idempotencyKey: derivedIdempotencyKey("compliance-rule-create", body.id, body),
        }),
      ),
    listRuleChanges: async (page?: PageRequest) =>
      paginate(must(await rpc.listRuleChanges()).data, page),
    getRuleChangeSet: async (documentId: string) => must(await rpc.getRuleChangeSet(documentId)),
    listEvals: async (agentId?: string) => {
      const rows = must(await rpc.listEvals()).data;
      return paginate(agentId === undefined ? rows : rows.filter((e) => e.agentId === agentId));
    },
    listKnowledgeSources: async (page?: PageRequest) =>
      paginate(must(await rpc.listKnowledgeSources()).data, page),
    getAiTiers: async () => must(await rpc.listAiTiers()),
    getBudgets: async () => must(await rpc.listBudgets()),

    /* §10 automation: agents and runs (027). */
    listAgents: async () => must(await rpc.listAgents()),
    pauseAgent: async (id: string, body: AgentPauseRequest, _options?: RequestOptions) =>
      must(await rpc.pauseAgent(id, body)),
    listRuns: async (page?: PageRequest) => must(await rpc.listRuns(page ?? {})),
    getRun: async (id: string) => must(await rpc.getRun(id)),
    retryRun: async (id: string, from?: "checkpoint") => must(await rpc.retryRun(id, from)),
    deadLetterRun: async (id: string, body: RunDeadLetterRequest, _options?: RequestOptions) =>
      must(await rpc.deadLetterRun(id, body)),

    /* §17 knowledge (027). */
    createKnowledgeSource: async (body: KnowledgeSourceCreateRequest) =>
      must(await rpc.createKnowledgeSource(body)),
    checkKnowledgeSource: async (id: string) => must(await rpc.checkKnowledgeSource(id)),
    reingestKnowledgeSource: async (id: string) => must(await rpc.reingestKnowledgeSource(id)),
    /* Fixture-only shape; the RPC layer returns it as `unknown` because it has
       no contract type (see client.ts). Cast back here — the one seam that
       already knows the fixture's shape is the oracle — through a runtime
       shape guard rather than a double cast through `unknown` (E2's rule:
       that double-cast pattern is what hid a real envelope-drift incident). */
    listLibraryAssets: async (page?: PageRequest) =>
      asLibraryAssetPage(must(await rpc.listLibraryAssets(page ?? {}))),

    /* §17 AI settings: routing, providers (read), usage, budgets, tenant (027). */
    getAiRouting: async () => must(await rpc.getAiRouting()),
    putAiRouting: async (entries: RoutingEntry[]) => must(await rpc.putAiRouting(entries)),
    listProviders: async () => must(await rpc.listProviders()),
    getUsage: async (period?: string, groupBy?: "TIER" | "AGENT" | "ACTION_TYPE") =>
      must(await rpc.getUsage(period, groupBy)),
    putBudget: async (scope: Budget["scope"], budgetKey: string, body: { cap: Budget["cap"] }) =>
      must(await rpc.putBudget(scope, budgetKey, body)),
    getTenant: async () => asFixtureTenant(must(await rpc.getTenant())),
  };
}

/** Runtime guard for {@link asFixtureTenant} — see its comment. */
function isFixtureTenantShape(value: unknown): value is FixtureTenant {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).name === "string" &&
    typeof (value as Record<string, unknown>).locale === "string" &&
    typeof (value as Record<string, unknown>).timezone === "string" &&
    typeof (value as Record<string, unknown>).currency === "string"
  );
}

/**
 * `core.get_tenant` (027) has no contract type to check against at the RPC
 * layer (see client.ts), so the shape is checked here, once, at the seam that
 * already treats `FixtureTenant` as the oracle for this endpoint.
 */
function asFixtureTenant(value: unknown): FixtureTenant {
  if (!isFixtureTenantShape(value)) {
    throw new Error("getTenant(): response does not match FixtureTenant's shape");
  }
  return value;
}

/** Runtime guard for {@link asLibraryAssetPage} — see its comment. */
function isLibraryAssetPageShape(
  value: unknown,
): value is { data: FixtureLibraryAsset[]; page: { next: string | null; total: number } } {
  if (typeof value !== "object" || value === null) return false;
  const data = (value as Record<string, unknown>).data;
  const page = (value as Record<string, unknown>).page;
  return (
    Array.isArray(data) &&
    typeof page === "object" &&
    page !== null &&
    typeof (page as Record<string, unknown>).total === "number"
  );
}

/**
 * `core.list_library_assets` (027) has no contract type (see client.ts), so
 * the envelope shape — `{data: [], page: {next, total}}` — is checked here
 * rather than double-cast through `unknown`.
 */
function asLibraryAssetPage(value: unknown): {
  data: FixtureLibraryAsset[];
  page: { next: string | null; total: number };
} {
  if (!isLibraryAssetPageShape(value)) {
    throw new Error("listLibraryAssets(): response does not match the expected page shape");
  }
  return value;
}

/**
 * The client-level controls `ApiProvider` drives, answered honestly.
 *
 * `signInAs` RECORDS rather than acts. In fixtures the role toggle really is
 * identity; against Supabase identity is the JWT and a client cannot reassign
 * it, so pretending otherwise would let the shell show a role the database will
 * refuse. The value is stored only so the provider's "did it change?" guard
 * still settles and its cache invalidation still fires on a role switch.
 *
 * `latencyMs` is likewise stored and ignored: there is nothing to simulate when
 * the round trip is real.
 */
function controls() {
  const events = new EventBus();
  let actorId = "";
  let latencyMs = 0;

  return {
    events,
    get actorId() {
      return actorId;
    },
    get latencyMs() {
      return latencyMs;
    },
    get lastMeta() {
      return { status: 200, headers: {} };
    },
    get store(): never {
      throw new Error(
        "The Supabase client has no in-memory store. A test that needs to seed rows " +
          "should run against the fixture client, which is the oracle.",
      );
    },
    signInAs: (next: string) => {
      actorId = next;
    },
    setLatency: (next: number) => {
      latencyMs = next;
    },
    reset: () => {
      events.clear();
    },
  };
}

/**
 * The fixture client's surface over the Supabase RPC client.
 *
 * A PROXY, NOT 130 STUBS. The contract has 115 endpoints and the RPC client
 * answers a fraction of them, so the alternative is a hundred hand-written
 * throwing methods that must be deleted one at a time as SQL lands. The trap
 * fails an unimplemented call by NAME, which is a better error than a stub
 * returning an empty list — a silent empty list looks like "no records" and
 * ships as a bug, while "not implemented by the Supabase client" is something
 * a reader can act on.
 *
 * The trap fails as `NOT_DEPLOYED`, the code a missing PostgREST function gets.
 * It is the same fact one step earlier — this environment does not serve the
 * endpoint — and as a bare `Error` it became a transport `UNKNOWN`, which every
 * screen drew as "Something went wrong. Try again." over a feature that has not
 * shipped. The method name stays in the message for whoever reads the cause.
 */
export function createRpcApiClient(rpc: TrainOsClient = createRpcClient()): ApiClient {
  const methods = adapters(rpc);
  const control = controls();

  return new Proxy({} as ApiClient, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      if (property in control) return Reflect.get(control, property);
      if (property in methods) return methods[property];
      return () =>
        Promise.reject(
          new ApiErrorException(
            withDiagnostics(
              transportError(
                "NOT_DEPLOYED",
                `${property}() is not implemented by the Supabase client yet. ` +
                  "Its RPC is specified in docs/architecture/09-golden-path-rpc-specs.md.",
                { status: 404 },
              ),
              { operation: `${property}()`, sourceCode: "NO_ADAPTER" },
            ),
          ),
        );
    },
    has(_target, property) {
      return typeof property === "string";
    },
  });
}
