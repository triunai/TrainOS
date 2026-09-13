import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EnquiryExtractionPatch, MessageChannel } from "@trainos/contract";
import { ENQUIRY_AURORA, FOLLOW_UP_AURORA, ORG_AURORA, USER_AMIRAH } from "@trainos/contract";
import { createFixtureClient } from "@trainos/fixtures";

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
  type ViewHandlers,
} from "./oracleTransport";

/**
 * M03 · enquiries, through the seam.
 *
 * EVERY call the feature makes, run against both clients with the transport
 * mocked. The list is not a sample: it is `features/enquiries/api.ts` read off
 * hook by hook — the saved-view tabs, the queue (unfiltered and view-filtered),
 * the detail, the matched organisation, the follow-up queue, the drafts in both
 * channels, the edit-before-use patch and the §3 action each screen's primary
 * fires. A call this feature makes that is NOT here is a call nobody is
 * comparing, and the first place it can differ is in front of a user.
 */

const FUNCTIONS: RpcHandlers = {
  /**
   * Newest first, decided by the SERVER.
   *
   * The fixture client applies `-receivedAt` when a caller sends no sort, which
   * makes the default part of the endpoint's contract rather than a
   * convenience of one client. Left out here, the RPC client would answer in
   * insertion order and M03-S01 would open on an arbitrary row.
   */
  list_enquiries: (args, oracle) => {
    const query = toPageRequest(args);
    return oracle.listEnquiries(
      query.sort === undefined ? { ...query, sort: "-receivedAt" } : query,
    );
  },
  get_enquiry: (args, oracle) => oracle.getEnquiry(String(args.p_id)),
  patch_enquiry_extraction: (args, oracle) =>
    oracle.patchEnquiryExtraction(String(args.p_id), args.p_patch as EnquiryExtractionPatch),
  get_organisation: (args, oracle) => oracle.getOrganisation(String(args.p_id)),
  /**
   * The queue's default order is the SERVER's, and it is due date.
   *
   * The fixture client applies it when a caller sends no sort, which makes it
   * part of the endpoint's contract rather than a convenience of one client —
   * so `list_follow_ups` states it here. Left out, the RPC client would answer
   * in insertion order while the oracle answered in due order, and M03-S06
   * would put the least urgent chase at the top of the queue.
   */
  list_follow_ups: (args, oracle) => {
    const query = toPageRequest(args);
    return oracle.listFollowUps(query.sort === undefined ? { ...query, sort: "dueDate" } : query);
  },
  get_follow_up_draft: (args, oracle) =>
    oracle.getFollowUpDraft(String(args.p_id), args.p_channel as "EMAIL" | "WHATSAPP"),
  perform_action: performActionHandler,
};

/** §2 the saved views behind the inbox's pill tabs. */
const VIEWS: ViewHandlers = {
  v_saved_views: async (oracle) => (await oracle.listViews()).data,
};

/** The §3 request M03-S01's one solid primary sends. */
const CONVERT = {
  type: "OPPORTUNITY_CONVERT",
  targetRef: ENQUIRY_AURORA,
  payload: { value: { amount: 48000, currency: "MYR" } },
  requestedBy: { id: USER_AMIRAH, name: "Amirah", kind: "HUMAN" },
} as const;

/** The edit-before-use patch M03-S02 sends when a field is corrected. */
const PATCH: EnquiryExtractionPatch = { field: "timing", value: "2026-12" };

describe("M03 · the two clients answer the enquiry screens the same", () => {
  let oracle: Oracle;
  let fixtures: ApiClient;
  let rpc: ApiClient;

  beforeEach(() => {
    oracle = createFixtureClient({ latencyMs: 0, actorId: USER_AMIRAH });
    fixtures = createFixtureClient({ latencyMs: 0, actorId: USER_AMIRAH });
    __setTransportForTests(oracleTransport(oracle, FUNCTIONS, VIEWS));
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const calls: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["useEnquiryViews", (client) => client.listViews("ENQUIRY")],
    ["useEnquiries — all open", (client) => client.listEnquiries(undefined)],
    [
      "useEnquiries — a saved view",
      (client) => client.listEnquiries({ view: "view_needs_review" }),
    ],
    ["useEnquiry", (client) => client.getEnquiry(ENQUIRY_AURORA)],
    ["useOrganisation", (client) => client.getOrganisation(ORG_AURORA)],
    ["useFollowUps", (client) => client.listFollowUps(undefined)],
    ["useFollowUpDraft — WhatsApp", (client) => draft(client, "WHATSAPP")],
    ["useFollowUpDraft — email", (client) => draft(client, "EMAIL")],
    ["usePatchExtraction", (client) => client.patchEnquiryExtraction(ENQUIRY_AURORA, PATCH)],
    ["useEnquiryAction", (client) => client.performAction({ ...CONVERT })],
  ];

  for (const [hook, call] of calls) {
    it(`${hook} — same value from both`, async () => {
      const [viaFixtures, viaRpc] = await Promise.all([call(fixtures), call(rpc)]);
      expect(viaRpc).toEqual(viaFixtures);
    });
  }

  /**
   * The saved view has to reach the SERVER, not be applied after the answer.
   *
   * `pageFor()` on M03-S01 turns a pill tab into `{ view }`, and if that
   * argument is dropped anywhere in the seam the tab silently shows the whole
   * queue. Comparing against the unfiltered read is what makes the case fail
   * when nothing filters.
   */
  it("a pill tab filters the queue server-side", async () => {
    const filtered = await rpc.listEnquiries({ view: "view_needs_review" });
    const everything = await rpc.listEnquiries(undefined);
    expect(filtered.data.length).toBeGreaterThan(0);
    expect(filtered.data.length).toBeLessThan(everything.data.length);
  });

  /** A refusal stays a refusal, with the contract's own code on it. */
  it("a missing enquiry refuses rather than failing", async () => {
    const thrown = await rpc.getEnquiry("ENQ-0000-0000").catch((error: unknown) => error);
    expect(isNotDeployed(thrown)).toBe(false);
    expect(thrown).toMatchObject({ code: "NOT_FOUND" });
  });
});

/**
 * The state every enquiry screen is in on the hosted project today.
 *
 * `PGRST106` — `core` is not an exposed schema — has to reach the screens as
 * "not deployed" rather than as a server fault, because that is what decides
 * whether M03-S01 draws an empty state or an error with a retry button over a
 * dashboard setting nobody can change by clicking it.
 */
describe("M03 · an undeployed environment", () => {
  let rpc: ApiClient;

  beforeEach(() => {
    __setTransportForTests(unexposedSchemaTransport());
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const reads: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["the queue", (client) => client.listEnquiries(undefined)],
    ["an enquiry", (client) => client.getEnquiry(ENQUIRY_AURORA)],
    ["the follow-up queue", (client) => client.listFollowUps(undefined)],
    ["a draft", (client) => draft(client, "EMAIL")],
    ["the saved views", (client) => client.listViews("ENQUIRY")],
  ];

  for (const [what, call] of reads) {
    it(`${what} reads as not deployed`, async () => {
      const thrown = await call(rpc).catch((error: unknown) => error);
      expect(isNotDeployed(thrown)).toBe(true);
    });
  }
});

/** One call, spelled once: the draft read takes the channel the toggle holds. */
function draft(client: ApiClient, channel: MessageChannel): Promise<unknown> {
  return client.getFollowUpDraft(FOLLOW_UP_AURORA, channel);
}
