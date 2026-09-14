import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PortalAcceptRequest, PortalCommentRequest } from "@trainos/contract";
import {
  PORTAL_TOKEN_AURORA,
  PORTAL_TOKEN_MERIDIAN,
  createFixtureClient,
  isContractError,
} from "@trainos/fixtures";

import { createRpcApiClient, type ApiClient } from "../apiClient";
import { isNotDeployed } from "../notDeployed";
import { createRpcClient } from "../rpcClient";
import { __setTransportForTests } from "../supabase";
import type { RpcTransport, TransportResponse } from "../transport";
import {
  okEnvelope,
  oracleTransport,
  unexposedSchemaTransport,
  type Oracle,
  type RpcHandlers,
} from "./oracleTransport";

/**
 * M07-S07 · the client portal, through the seam.
 *
 * Every call `features/portal/api.ts` makes, against both clients: the page
 * read, the comment, and the accept, twice. The argument names are 028's own —
 * `p_token` and `p_body` — so the oracle reads exactly those and a renamed
 * argument stops matching here rather than on the hosted page.
 */

const FUNCTIONS: RpcHandlers = {
  get_portal_proposal: (args, oracle) => oracle.getPortalProposal(String(args.p_token)),
  add_portal_comment: (args, oracle) =>
    oracle.addPortalComment(String(args.p_token), args.p_body as PortalCommentRequest),
  /* No key: none travels. 028 keys the acceptance by the proposal itself, which
     is the fixture's own no-key branch ("a second accept returns the original"). */
  accept_portal_proposal: (args, oracle) =>
    oracle.acceptPortalProposal(String(args.p_token), args.p_body as PortalAcceptRequest),
};

const COMMENT: PortalCommentRequest = {
  author: "Faridah Omar",
  body: "Can we move to 9 December?",
};
const ACCEPT: PortalAcceptRequest = { name: "Faridah Omar", role: "HR Business Partner" };

describe("M07-S07 · the two clients answer the portal the same", () => {
  let oracle: Oracle;
  let fixtures: ApiClient;
  let rpc: ApiClient;

  beforeEach(() => {
    oracle = createFixtureClient({ latencyMs: 0 });
    fixtures = createFixtureClient({ latencyMs: 0 });
    __setTransportForTests(oracleTransport(oracle, FUNCTIONS));
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const calls: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["usePortalProposal — accepted", (client) => client.getPortalProposal(PORTAL_TOKEN_AURORA)],
    ["usePortalProposal — viewed", (client) => client.getPortalProposal(PORTAL_TOKEN_MERIDIAN)],
    ["useAddPortalComment", (client) => client.addPortalComment(PORTAL_TOKEN_MERIDIAN, COMMENT)],
    [
      "useAcceptPortalProposal",
      (client) =>
        client.acceptPortalProposal(PORTAL_TOKEN_MERIDIAN, ACCEPT, {
          idempotencyKey: PORTAL_TOKEN_MERIDIAN,
        }),
    ],
  ];

  for (const [hook, call] of calls) {
    it(`${hook} — same value from both`, async () => {
      const [viaFixtures, viaRpc] = await Promise.all([call(fixtures), call(rpc)]);
      expect(viaRpc).toEqual(viaFixtures);
    });
  }

  /** §11 "a second accept returns the original acceptance", through both. */
  it("a second accept returns the first acceptance from both", async () => {
    const twice = async (client: ApiClient) => {
      const first = await client.acceptPortalProposal(PORTAL_TOKEN_MERIDIAN, ACCEPT);
      const second = await client.acceptPortalProposal(PORTAL_TOKEN_MERIDIAN, {
        name: "Somebody Else",
        role: "Intruder",
      });
      return { first, second };
    };
    const [viaFixtures, viaRpc] = await Promise.all([twice(fixtures), twice(rpc)]);
    expect(viaRpc.second).toEqual(viaRpc.first);
    expect(viaRpc).toEqual(viaFixtures);
  });

  it("an unknown link refuses as NOT_FOUND from both", async () => {
    const fromFixtures = await fixtures.getPortalProposal("tk_pt_unknown").catch((e: unknown) => e);
    const fromRpc = await rpc.getPortalProposal("tk_pt_unknown").catch((e: unknown) => e);

    expect(isContractError(fromFixtures)).toBe(true);
    expect(isContractError(fromRpc)).toBe(true);
    if (!isContractError(fromFixtures) || !isContractError(fromRpc)) return;
    expect(fromRpc.code).toBe("NOT_FOUND");
    expect(fromRpc.http).toBe(fromFixtures.http);
  });
});

/**
 * What goes ON THE WIRE, and what comes back from the shapes 028 really
 * answers with. A recorder, not the oracle: the fixture client throws, while
 * the read in SQL RETURNS `app.err('NOT_FOUND')` and the writes RAISE it.
 */
function recorder(answer: (name: string) => TransportResponse): {
  transport: RpcTransport;
  calls: { name: string; args: Record<string, unknown> }[];
} {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const transport: RpcTransport = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve(answer(name));
    },
    from: () => {
      throw new Error("the portal reads no view");
    },
  };
  return { transport, calls };
}

describe("M07-S07 · the portal on the wire", () => {
  afterEach(() => {
    __setTransportForTests(null);
  });

  it("sends the token and the body under 028's argument names, and nothing else", async () => {
    const { transport, calls } = recorder(() => okEnvelope({}));
    __setTransportForTests(transport);
    const client = createRpcApiClient(createRpcClient());

    await client.getPortalProposal("tk_pt_abc");
    await client.addPortalComment("tk_pt_abc", COMMENT);
    await client.acceptPortalProposal("tk_pt_abc", ACCEPT, { idempotencyKey: "tk_pt_abc" });

    expect(calls).toEqual([
      { name: "get_portal_proposal", args: { p_token: "tk_pt_abc" } },
      { name: "add_portal_comment", args: { p_token: "tk_pt_abc", p_body: COMMENT } },
      { name: "accept_portal_proposal", args: { p_token: "tk_pt_abc", p_body: ACCEPT } },
    ]);
  });

  it("the read's app.err NOT_FOUND and a write's TRNOS NOT_FOUND both reach the page as NOT_FOUND", async () => {
    const { transport } = recorder((name) =>
      name === "get_portal_proposal"
        ? { data: { success: false, error: { code: "NOT_FOUND" } }, error: null }
        : {
            data: null,
            error: {
              message: "portal link not found",
              code: "TRNOS",
              details: JSON.stringify({ code: "NOT_FOUND" }),
            },
          },
    );
    __setTransportForTests(transport);
    const client = createRpcApiClient(createRpcClient());

    for (const call of [
      () => client.getPortalProposal("tk_pt_gone"),
      () => client.addPortalComment("tk_pt_gone", COMMENT),
      () => client.acceptPortalProposal("tk_pt_gone", ACCEPT),
    ]) {
      const thrown = await call().catch((e: unknown) => e);
      expect(isContractError(thrown)).toBe(true);
      if (!isContractError(thrown)) return;
      expect(thrown.code).toBe("NOT_FOUND");
      expect(thrown.http).toBe(404);
    }
  });

  it("a malformed comment's VALIDATION_FAILED keeps its fields", async () => {
    const fields = [{ field: "body", reason: "INVALID" }];
    const { transport } = recorder(() => ({
      data: null,
      error: {
        message: "comment validation failed",
        code: "TRNOS",
        details: JSON.stringify({ code: "VALIDATION_FAILED", fields }),
      },
    }));
    __setTransportForTests(transport);

    const thrown = await createRpcApiClient(createRpcClient())
      .addPortalComment("tk_pt_abc", { author: "A", body: "" })
      .catch((e: unknown) => e);

    expect(isContractError(thrown)).toBe(true);
    if (!isContractError(thrown)) return;
    expect(thrown.code).toBe("VALIDATION_FAILED");
    expect(thrown.details).toEqual({ fields });
  });
});

describe("M07-S07 · an undeployed environment", () => {
  beforeEach(() => {
    __setTransportForTests(unexposedSchemaTransport());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  it("the portal page read reads as not deployed", async () => {
    const thrown = await createRpcApiClient(createRpcClient())
      .getPortalProposal(PORTAL_TOKEN_AURORA)
      .catch((e: unknown) => e);
    expect(isNotDeployed(thrown)).toBe(true);
  });
});
