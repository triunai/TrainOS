import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProposalSectionWrite, QuotationWrite } from "@trainos/contract";
import {
  APPROVAL_AURORA,
  OPPORTUNITY_AURORA,
  ORG_AURORA,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  USER_AMIRAH,
} from "@trainos/contract";
import { createFixtureClient, isContractError } from "@trainos/fixtures";

import { createRpcApiClient, type ApiClient } from "../apiClient";
import { isNotDeployed } from "../notDeployed";
import { createRpcClient } from "../rpcClient";
import { __setTransportForTests } from "../supabase";
import {
  oracleTransport,
  performActionHandler,
  toPageRequest,
  unexposedSchemaTransport,
  type Oracle,
  type RpcHandlers,
} from "./oracleTransport";

/**
 * M07 · proposals and quotations, through the seam.
 *
 * Every call `features/proposals/api.ts` makes, run against both clients with
 * the transport mocked: the two lists, the record reads, the two hops that turn
 * an opportunity into a client name, all three section writes, the rate card,
 * the priced save, and the two §3 actions the screens' primaries fire.
 *
 * Six of these — `listProposals`, `listQuotations`, `getRateCard` and the three
 * section writes — had no `TrainOsClient` method at all before this lane, so on
 * Supabase they rejected by name inside the adapter's proxy. A screen cannot be
 * said to go through the seam while a third of its calls fall off it.
 */

const FUNCTIONS: RpcHandlers = {
  list_proposals: (args, oracle) => oracle.listProposals(toPageRequest(args)),
  get_proposal: (args, oracle) => oracle.getProposal(String(args.p_id)),
  get_opportunity: (args, oracle) => oracle.getOpportunity(String(args.p_id)),
  get_organisation: (args, oracle) => oracle.getOrganisation(String(args.p_id)),
  add_proposal_section: (args, oracle) =>
    oracle.addProposalSection(String(args.p_id), args.p_body as { title: string; body?: string }, {
      idempotencyKey: String(args.p_idempotency_key),
    }),
  put_proposal_section: (args, oracle) =>
    oracle.putProposalSection(
      String(args.p_id),
      Number(args.p_n),
      args.p_body as ProposalSectionWrite,
    ),
  regenerate_proposal_section: (args, oracle) =>
    oracle.regenerateProposalSection(String(args.p_id), Number(args.p_n)),
  list_quotations: (args, oracle) => oracle.listQuotations(toPageRequest(args)),
  get_quotation: (args, oracle) => oracle.getQuotation(String(args.p_id)),
  put_quotation: (args, oracle) =>
    oracle.putQuotation(String(args.p_id), args.p_body as QuotationWrite),
  get_rate_card: (_args, oracle) => oracle.getRateCard(),
  get_approval: (args, oracle) => oracle.getApproval(String(args.p_id)),
  perform_action: performActionHandler,
};

/** M07-S02's primary: send, which policy APV-01 intercepts above RM 15,000. */
const SEND = {
  type: "PROPOSAL_SEND",
  targetRef: PROPOSAL_AURORA,
  payload: { channel: "EMAIL" },
  requestedBy: { id: USER_AMIRAH, name: "Amirah", kind: "HUMAN" },
} as const;

/**
 * M07-S03's primary: apply the priced quotation to the proposal.
 *
 * `Money.amount` is in SEN, not ringgit: RM 20,000 is 2,000,000. Stated here
 * because the first draft of this file wrote 52,000 and was refused as RM
 * 520.00 against an RM 17,538.46 floor — which is the same mistake a screen
 * would make, and the reason the floor evaluation belongs to the server.
 */
const APPLY = {
  type: "QUOTATION_APPLY",
  targetRef: QUOTATION_AURORA,
  payload: { sellPrice: { amount: 2_000_000, currency: "MYR" } },
  requestedBy: { id: USER_AMIRAH, name: "Amirah", kind: "HUMAN" },
} as const;

const SECTION: ProposalSectionWrite = { body: "Rewritten by a consultant." };

describe("M07 · the two clients answer the proposal screens the same", () => {
  let oracle: Oracle;
  let fixtures: ApiClient;
  let rpc: ApiClient;

  beforeEach(() => {
    oracle = createFixtureClient({ latencyMs: 0, actorId: USER_AMIRAH });
    fixtures = createFixtureClient({ latencyMs: 0, actorId: USER_AMIRAH });
    __setTransportForTests(oracleTransport(oracle, FUNCTIONS));
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const calls: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["useProposals", (client) => client.listProposals()],
    ["useProposal", (client) => client.getProposal(PROPOSAL_AURORA)],
    [
      "useProposalClient — the opportunity hop",
      (client) => client.getOpportunity(OPPORTUNITY_AURORA),
    ],
    ["useProposalClient — the organisation hop", (client) => client.getOrganisation(ORG_AURORA)],
    ["useAddSection", (client) => client.addProposalSection(PROPOSAL_AURORA, { title: "Risks" })],
    ["useEditSection", (client) => client.putProposalSection(PROPOSAL_AURORA, 1, SECTION)],
    ["useRegenerateSection", (client) => client.regenerateProposalSection(PROPOSAL_AURORA, 1)],
    ["useQuotations", (client) => client.listQuotations()],
    ["useQuotation", (client) => client.getQuotation(QUOTATION_AURORA)],
    ["useRateCard", (client) => client.getRateCard()],
    ["useApproval", (client) => client.getApproval(APPROVAL_AURORA)],
    ["useSendProposal", (client) => client.performAction({ ...SEND })],
    ["useApplyQuotation", (client) => client.performAction({ ...APPLY })],
  ];

  for (const [hook, call] of calls) {
    it(`${hook} — same value from both`, async () => {
      const [viaFixtures, viaRpc] = await Promise.all([call(fixtures), call(rpc)]);
      expect(viaRpc).toEqual(viaFixtures);
    });
  }

  /**
   * The floor-price refusal, which is the whole point of M07-S03.
   *
   * `FLOOR_PRICE_BREACH` travels as a raised `TRNOS` exception rather than as
   * an `app.err()` envelope, and the screen does not merely report it: it reads
   * six fields out of `details` to say which floor binds and by how much. If
   * any of them is lost in the round trip the banner falls back to the generic
   * refusal surface and the consultant is told "no" without being told why.
   */
  it("a sell price under the floor refuses identically, details intact", async () => {
    const under: QuotationWrite = { sellPrice: { amount: 1000, currency: "MYR" } };
    const fromFixtures = await fixtures
      .putQuotation(QUOTATION_AURORA, under)
      .catch((error: unknown) => error);
    const fromRpc = await rpc
      .putQuotation(QUOTATION_AURORA, under)
      .catch((error: unknown) => error);

    expect(isContractError(fromFixtures)).toBe(true);
    expect(isContractError(fromRpc)).toBe(true);
    if (!isContractError(fromFixtures) || !isContractError(fromRpc)) return;

    expect(fromRpc.code).toBe("FLOOR_PRICE_BREACH");
    expect(fromRpc.http).toBe(fromFixtures.http);
    expect(fromRpc.details).toEqual(fromFixtures.details);
  });

  /** A priced save that clears the floor writes the same record through both. */
  it("a sell price above the floor saves identically", async () => {
    const over: QuotationWrite = { sellPrice: { amount: 2_000_000, currency: "MYR" } };
    const [viaFixtures, viaRpc] = await Promise.all([
      fixtures.putQuotation(QUOTATION_AURORA, over),
      rpc.putQuotation(QUOTATION_AURORA, over),
    ]);
    expect(viaRpc).toEqual(viaFixtures);
  });
});

/** The state M07 is in on the hosted project until the RPC pack lands. */
describe("M07 · an undeployed environment", () => {
  let rpc: ApiClient;

  beforeEach(() => {
    __setTransportForTests(unexposedSchemaTransport());
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const reads: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["the proposal list", (client) => client.listProposals()],
    ["a proposal", (client) => client.getProposal(PROPOSAL_AURORA)],
    ["the quotation list", (client) => client.listQuotations()],
    ["a quotation", (client) => client.getQuotation(QUOTATION_AURORA)],
    ["the rate card", (client) => client.getRateCard()],
  ];

  for (const [what, call] of reads) {
    it(`${what} reads as not deployed`, async () => {
      const thrown = await call(rpc).catch((error: unknown) => error);
      expect(isNotDeployed(thrown)).toBe(true);
    });
  }
});
