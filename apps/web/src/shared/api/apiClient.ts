import type {
  ActionRequest,
  ApprovalBulkDecideRequest,
  ApprovalDecideRequest,
  EnquiryExtractionPatch,
  MessageChannel,
  PageRequest,
  ProposalCreateRequest,
  ProposalSectionWrite,
  QuotationWrite,
  SavedView,
  TemplateType,
} from "@trainos/contract";
import { ContractError, EventBus, paginate, type FixtureClient } from "@trainos/fixtures";

import type { TrainOsClient } from "./client";
import { ApiErrorException, type Result } from "./errors";
import { derivedIdempotencyKey, stableIdempotencyKey } from "./idempotency";
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
    throw new ContractError(
      result.error.code,
      result.error.message,
      result.error.details,
      result.error.approvalRequestId,
    );
  }
  throw new ApiErrorException(result.error);
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

    listEnquiries: async (page?: PageRequest) => must(await rpc.listEnquiries(page ?? {})),
    getEnquiry: async (id: string) => must(await rpc.getEnquiry(id)),
    patchEnquiryExtraction: async (id: string, patch: EnquiryExtractionPatch) =>
      must(await rpc.patchExtraction(id, patch)),

    listFollowUps: async (page?: PageRequest) => must(await rpc.listFollowUps(page ?? {})),
    getFollowUpDraft: async (id: string, channel: MessageChannel) =>
      must(await rpc.getFollowUpDraft(id, channel)),

    getOrganisation: async (id: string) => must(await rpc.getOrganisation(id)),
    getOrganisationRelations: async (id: string) => must(await rpc.getOrganisationRelations(id)),

    getOpportunity: async (id: string) => must(await rpc.getOpportunity(id)),

    getTna: async (id: string) => must(await rpc.getTna(id)),
    getTnaRecommendations: async (id: string) => must(await rpc.getTnaRecommendations(id)),

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
          idempotencyKey: key(
            options,
            derivedIdempotencyKey("approval-bulk-decide", body.ids.join(","), body),
          ),
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
    listHrdcDeadlines: async (page?: PageRequest) =>
      paginate(must(await rpc.listHrdcDeadlines()).data, page),
    getCollectionRules: async () => must(await rpc.listCollectionRules()),
    listComplianceRules: async (page?: PageRequest) =>
      paginate(must(await rpc.listComplianceRules()).data, page),
    getComplianceRule: async (id: string) => must(await rpc.getComplianceRule(id)),
    listRuleChanges: async (page?: PageRequest) =>
      paginate(must(await rpc.listRuleChanges()).data, page),
    listEvals: async (agentId?: string) => {
      const rows = must(await rpc.listEvals()).data;
      return paginate(agentId === undefined ? rows : rows.filter((e) => e.agentId === agentId));
    },
    listKnowledgeSources: async (page?: PageRequest) =>
      paginate(must(await rpc.listKnowledgeSources()).data, page),
    getAiTiers: async () => must(await rpc.listAiTiers()),
    getBudgets: async () => must(await rpc.listBudgets()),
  };
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
          new Error(
            `${property}() is not implemented by the Supabase client yet. ` +
              "Its RPC is specified in docs/architecture/09-golden-path-rpc-specs.md.",
          ),
        );
    },
    has(_target, property) {
      return typeof property === "string";
    },
  });
}
