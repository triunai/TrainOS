import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APPROVAL_AURORA,
  ENQUIRY_AURORA,
  OPPORTUNITY_AURORA,
  ORG_AURORA,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  TNA_AURORA,
  USER_AMIRAH,
} from "@trainos/contract";
import { ContractError, createFixtureClient, isContractError } from "@trainos/fixtures";

import { createRpcApiClient, type ApiClient } from "../apiClient";
import { isDomainError } from "../errors";
import { classifyTransportFailure, createRpcClient, unwrapEnvelope } from "../rpcClient";
import { __setTransportForTests } from "../supabase";
import type { RpcTransport, TransportResponse } from "../transport";

/**
 * ONE set of cases, run against BOTH clients.
 *
 * The fixture client is the oracle: it implements the contract against an
 * in-memory store and every screen in the app is built on its answers. The RPC
 * client is the thing being checked, driven through the SAME port production
 * uses, with a double standing in for PostgREST.
 *
 * WHAT THIS ACTUALLY PROVES. The double answers each RPC by asking the oracle
 * and then wrapping the answer the way `app.ok()` would, and refuses the way
 * `RAISE … USING ERRCODE = 'TRNOS'` would. So the two clients differ only by
 * the envelope round trip: serialise, unwrap, classify, adapt. If the unwrap
 * rule mis-handles a shape, if a domain refusal comes back classified as
 * transport, or if the adapter drops a field, the two answers stop matching and
 * the case fails — with no hosted database anywhere in the loop.
 *
 * WHAT IT CANNOT PROVE. That the SQL exists, that it returns this shape, or
 * that RLS lets the caller see it. Those are the migrations lane's, and they
 * need a database. This suite pins the seam, not the server.
 */

/** The §3 request the action-gate case sends, as a value both clients get. */
const ARCHIVE_ENQUIRY = {
  type: "ENQUIRY_ARCHIVE",
  targetRef: ENQUIRY_AURORA,
  payload: { reason: "Duplicate of an earlier enquiry." },
  requestedBy: { id: USER_AMIRAH, name: "Amirah", kind: "HUMAN" },
} as const;

type Oracle = ReturnType<typeof createFixtureClient>;

/**
 * `app.ok()`, in TypeScript: exactly `{success, data}` and never a third key.
 *
 * Written out rather than imported so the test states the envelope it expects
 * independently of the code under test. A change to the unwrap rule that also
 * changed this helper would prove nothing.
 */
const okEnvelope = (data: unknown): TransportResponse => ({
  data: { success: true, data },
  error: null,
});

/**
 * A `RAISE EXCEPTION … USING ERRCODE = 'TRNOS', DETAIL = '<jsonb>'` as
 * supabase-js would surface it.
 *
 * This is the shape 011 actually produces — it refuses by raising, not by
 * returning `app.err()`. Getting this double wrong in the other direction is
 * how a policy refusal ends up classified as a transport failure with a retry
 * button on it.
 */
const raised = (error: ContractError): TransportResponse => ({
  data: null,
  error: {
    message: error.message,
    code: "TRNOS",
    details: JSON.stringify({
      code: error.code,
      ...(error.details ?? {}),
      ...(error.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: error.approvalRequestId }),
    }),
  },
});

type Args = Record<string, unknown>;

/** Each RPC the suite exercises, answered by the oracle. */
const FUNCTIONS: Record<string, (args: Args, oracle: Oracle) => Promise<unknown>> = {
  me: (_args, oracle) => oracle.getMe(),
  navigation: (_args, oracle) => oracle.getNavigation(),
  list_enquiries: (args, oracle) => oracle.listEnquiries(toPageRequest(args)),
  get_enquiry: (args, oracle) => oracle.getEnquiry(String(args.p_id)),
  get_organisation: (args, oracle) => oracle.getOrganisation(String(args.p_id)),
  get_opportunity: (args, oracle) => oracle.getOpportunity(String(args.p_id)),
  get_tna: (args, oracle) => oracle.getTna(String(args.p_id)),
  get_proposal: (args, oracle) => oracle.getProposal(String(args.p_id)),
  get_quotation: (args, oracle) => oracle.getQuotation(String(args.p_id)),
  list_approvals: (args, oracle) => oracle.listApprovals(toPageRequest(args)),
  get_approval: (args, oracle) => oracle.getApproval(String(args.p_id)),
  perform_action: (args, oracle) =>
    oracle.performAction(
      {
        type: ARCHIVE_ENQUIRY.type,
        targetRef: String(args.p_target_ref),
        payload: args.p_payload as Record<string, unknown>,
        requestedBy: ARCHIVE_ENQUIRY.requestedBy,
      },
      { idempotencyKey: String(args.p_idempotency_key) },
    ),
};

/** The §1 query grammar, back out of the RPC arguments the client built. */
function toPageRequest(args: Args): { page?: { size?: number } } {
  const page = args.p_page;
  if (typeof page !== "object" || page === null) return {};
  const size = (page as { size?: unknown }).size;
  return typeof size === "number" ? { page: { size } } : {};
}

/**
 * The `core` schema, standing in for PostgREST.
 *
 * It satisfies `RpcTransport` structurally — no cast, which is what E2 is
 * asking for and also what makes this a test of the real code path rather than
 * of an asserted shape.
 */
function fakeCore(oracle: Oracle): RpcTransport {
  return {
    rpc: async (name, args) => {
      const serve = FUNCTIONS[name];
      if (serve === undefined) {
        return {
          data: null,
          error: { message: `Could not find the function core.${name}`, code: "PGRST202" },
        };
      }
      try {
        return okEnvelope(await serve(args, oracle));
      } catch (thrown) {
        if (isContractError(thrown)) return raised(thrown);
        throw thrown;
      }
    },
    from: () => ({
      select: () => {
        const response: TransportResponse = { data: [], error: null };
        const settled = Promise.resolve(response);
        return Object.assign(settled, { match: () => settled });
      },
    }),
  };
}

describe("the unwrap rule", () => {
  it("unwraps a lone `data`", () => {
    expect(unwrapEnvelope({ success: true, data: { id: "x" } })).toEqual({
      data: { id: "x" },
      error: null,
    });
  });

  /**
   * The incident, as a test. One sibling key beside `data` must flip the result
   * from the unwrapped value to the whole rest of the envelope — every caller
   * depends on that being the rule rather than a surprise.
   */
  it("passes the rest through when a sibling joins `data`", () => {
    const body = { success: true, data: [1], hasMore: true };
    expect(unwrapEnvelope(body)).toEqual({ data: { data: [1], hasMore: true }, error: null });
  });

  it("passes an empty success through as {}", () => {
    expect(unwrapEnvelope({ success: true })).toEqual({ data: {}, error: null });
  });

  it("passes a raw value through untouched", () => {
    expect(unwrapEnvelope(["a", "b"])).toEqual({ data: ["a", "b"], error: null });
    expect(unwrapEnvelope(7)).toEqual({ data: 7, error: null });
  });

  /** `app.err()` writes no message, so the client has to supply a floor. */
  it("turns a messageless app.err into a domain error with a readable message", () => {
    const result = unwrapEnvelope({ success: false, error: { code: "NOT_FOUND" } });
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ kind: "domain", code: "NOT_FOUND", status: 404 });
    expect(result.error?.message.length).toBeGreaterThan(0);
  });
});

describe("the two clients answer the same", () => {
  let oracle: Oracle;
  let fixtures: ApiClient;
  let rpc: ApiClient;

  beforeEach(() => {
    oracle = createFixtureClient({ latencyMs: 0, actorId: USER_AMIRAH });
    fixtures = createFixtureClient({ latencyMs: 0, actorId: USER_AMIRAH });
    __setTransportForTests(fakeCore(oracle));
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const reads: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["/v1/me", (client) => client.getMe()],
    ["/v1/navigation", (client) => client.getNavigation()],
    ["/v1/enquiries", (client) => client.listEnquiries({ page: { size: 5 } })],
    ["/v1/enquiries/{id}", (client) => client.getEnquiry(ENQUIRY_AURORA)],
    ["/v1/organisations/{id}", (client) => client.getOrganisation(ORG_AURORA)],
    ["/v1/opportunities/{id}", (client) => client.getOpportunity(OPPORTUNITY_AURORA)],
    ["/v1/tnas/{id}", (client) => client.getTna(TNA_AURORA)],
    ["/v1/proposals/{id}", (client) => client.getProposal(PROPOSAL_AURORA)],
    ["/v1/quotations/{id}", (client) => client.getQuotation(QUOTATION_AURORA)],
    ["/v1/approvals", (client) => client.listApprovals({ page: { size: 5 } })],
    ["/v1/approvals/{id}", (client) => client.getApproval(APPROVAL_AURORA)],
  ];

  for (const [endpoint, call] of reads) {
    it(`${endpoint} — same value from both`, async () => {
      const [viaFixtures, viaRpc] = await Promise.all([call(fixtures), call(rpc)]);
      expect(viaRpc).toEqual(viaFixtures);
    });
  }

  /**
   * The write path, including the key.
   *
   * Both clients derive the idempotency key from the same request through the
   * same function, so a replay on one is a replay on the other. That is the
   * property that makes the seam swappable: a double-clicked button must not
   * mean one governed action on fixtures and two against Supabase.
   */
  it("POST /v1/actions — same §3 outcome from both", async () => {
    const viaFixtures = await fixtures.performAction({ ...ARCHIVE_ENQUIRY });
    const viaRpc = await rpc.performAction({ ...ARCHIVE_ENQUIRY });
    expect(viaRpc).toEqual(viaFixtures);
  });

  /**
   * A refusal must stay a refusal.
   *
   * `NOT_FOUND` travels as a raised `TRNOS` exception, gets classified as a
   * domain error, and is rethrown as the contract's own `ContractError`. If any
   * step mis-classifies it the app puts a retry button on a 404, which is the
   * failure `errors.ts` exists to prevent.
   */
  it("a 404 arrives as a domain refusal, not a transport failure", async () => {
    const fromFixtures = await fixtures.getEnquiry("ENQ-0000-0000").catch((e: unknown) => e);
    const fromRpc = await rpc.getEnquiry("ENQ-0000-0000").catch((e: unknown) => e);

    expect(isContractError(fromFixtures)).toBe(true);
    expect(isContractError(fromRpc)).toBe(true);
    expect((fromRpc as ContractError).code).toBe((fromFixtures as ContractError).code);
    expect((fromRpc as ContractError).http).toBe(404);
  });

  /**
   * An RPC that is not deployed is a DEPLOYMENT fact, and must read as one.
   *
   * Every RPC this client names is unbuilt today, so this is the app's normal
   * state until the migrations lane lands. Classifying it as a domain refusal
   * would put the database's absence in front of the user as a policy decision.
   */
  it("a missing function is a transport failure, not a refusal", async () => {
    const thrown = await rpc.getContact("CON-0001").catch((e: unknown) => e);
    expect(isContractError(thrown)).toBe(false);
    expect(thrown).toBeInstanceOf(Error);
  });

  /** An endpoint with no RPC at all fails by name rather than answering empty. */
  it("an unimplemented method rejects by name", async () => {
    const thrown = await rpc.getExecutiveDashboard().catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("getExecutiveDashboard()");
  });
});

describe("error classification", () => {
  it("keeps a domain refusal out of the retryable branch", () => {
    const result = unwrapEnvelope({ success: false, error: { code: "FORBIDDEN" } });
    expect(result.error).not.toBeNull();
    expect(result.error !== null && isDomainError(result.error)).toBe(true);
  });

  /**
   * MEASURED against the hosted project, not assumed.
   *
   * Every call this client makes today comes back
   * `{"code":"PGRST106","message":"Invalid schema: core"}`, because the hosted
   * project exposes only `public, graphql_public`. `config.toml` exposes
   * `core`, but that file configures the LOCAL CLI stack. Classified as a 500
   * this reads as "TrainOS is down" and invites a retry that can never work;
   * classified as a deployment fact it reads as "not deployed", which is true
   * and actionable.
   */
  it("reads an unexposed schema as not deployed, not as a server fault", () => {
    const error = classifyTransportFailure({
      message: "Invalid schema: core",
      code: "PGRST106",
      hint: "Only the following schemas are exposed: public, graphql_public",
    });
    expect(error.kind).toBe("transport");
    expect(error).toMatchObject({ code: "SERVER", status: 404 });
    expect(error.message).toContain("not deployed");
  });

  /** A table PostgREST has never seen is the same kind of fact as a function. */
  it("reads a table missing from the schema cache as not deployed", () => {
    const error = classifyTransportFailure({
      message: "Could not find the table 'public.tenants' in the schema cache",
      code: "PGRST205",
    });
    expect(error).toMatchObject({ kind: "transport", code: "SERVER", status: 404 });
  });
});
