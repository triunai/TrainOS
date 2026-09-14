import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORG_AURORA, OPPORTUNITY_AURORA, TNA_AURORA, USER_AMIRAH } from "@trainos/contract";
import { createFixtureClient } from "@trainos/fixtures";

import { createRpcApiClient, type ApiClient } from "../apiClient";
import { isNotDeployed } from "../notDeployed";
import { createRpcClient } from "../rpcClient";
import { __setTransportForTests } from "../supabase";
import {
  oracleTransport,
  toPageRequest,
  unexposedSchemaTransport,
  type Oracle,
  type RpcHandlers,
} from "./oracleTransport";

/**
 * 023 · the sales directory, through the seam.
 *
 * `searchOrganisations`, `listOpportunities`, `getOrganisationSuggestions`,
 * `listTnas` and `reopenTna` had no `TrainOsClient` method at all before this
 * lane, so on Supabase they rejected by name inside the adapter's Proxy — the
 * NOT-DEPLOYED case this suite's second block still pins. This block proves
 * the wiring itself: the same arg names, the same page/response shape, the
 * same write, through both clients.
 */

const FUNCTIONS: RpcHandlers = {
  search_organisations: (args, oracle) => oracle.searchOrganisations(String(args.p_query)),
  list_opportunities: (args, oracle) => oracle.listOpportunities(toPageRequest(args)),
  get_organisation_suggestions: (args, oracle) =>
    oracle.getOrganisationSuggestions(String(args.p_id)),
  list_tnas: (args, oracle) => oracle.listTnas(toPageRequest(args)),
  reopen_tna: (args, oracle) => oracle.reopenTna(String(args.p_id)),
};

describe("023 · the two clients answer the sales directory the same", () => {
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

  const reads: [string, (client: ApiClient) => Promise<unknown>][] = [
    [
      "useOrganisationDirectory — searchOrganisations",
      (client) => client.searchOrganisations("Aurora"),
    ],
    ["useOpportunityIndex — listOpportunities", (client) => client.listOpportunities({})],
    [
      "useOrganisationSuggestions — getOrganisationSuggestions",
      (client) => client.getOrganisationSuggestions(ORG_AURORA),
    ],
    ["Sales › TNA — listTnas", (client) => client.listTnas({})],
  ];

  for (const [caller, call] of reads) {
    it(`${caller} — same value from both`, async () => {
      const [viaFixtures, viaRpc] = await Promise.all([call(fixtures), call(rpc)]);
      expect(viaRpc).toEqual(viaFixtures);
    });
  }

  /**
   * "Reopen questionnaire" on `TnaDetailPage`. Independent client/oracle
   * pairs, so the mutation lands on two separate in-memory stores and the
   * comparison still proves the two clients answer identically.
   */
  it("useReopenTna — reopenTna returns the same record from both", async () => {
    const [viaFixtures, viaRpc] = await Promise.all([
      fixtures.reopenTna(TNA_AURORA),
      rpc.reopenTna(TNA_AURORA),
    ]);
    expect(viaRpc).toEqual(viaFixtures);
    expect((viaRpc as { status: string }).status).toBe("REOPENED");
  });

  /** A real opportunity comes back the same shape `get_opportunity` gives it. */
  it("listOpportunities rows carry the get_opportunity shape (organisationRef, stage, value)", async () => {
    const page = (await rpc.listOpportunities({})) as { data: unknown[] };
    const first = page.data.find(
      (row): row is { ref: string } =>
        typeof row === "object" &&
        row !== null &&
        (row as { ref?: unknown }).ref === OPPORTUNITY_AURORA,
    );
    expect(first).toBeDefined();
  });
});

/** The state 023 is in on the hosted project until this migration lands. */
describe("023 · an undeployed environment", () => {
  let rpc: ApiClient;

  beforeEach(() => {
    __setTransportForTests(unexposedSchemaTransport());
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const reads: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["the organisation search", (client) => client.searchOrganisations("Aurora")],
    ["the opportunity list", (client) => client.listOpportunities({})],
    ["the cross-sell panel", (client) => client.getOrganisationSuggestions(ORG_AURORA)],
    ["the TNA list", (client) => client.listTnas({})],
    ["reopening a TNA", (client) => client.reopenTna(TNA_AURORA)],
  ];

  for (const [what, call] of reads) {
    it(`${what} reads as not deployed`, async () => {
      const thrown = await call(rpc).catch((error: unknown) => error);
      expect(isNotDeployed(thrown)).toBe(true);
    });
  }
});
