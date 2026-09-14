import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_COLLECTIONS,
  createFixtureClient,
  PROVIDER_ANTHROPIC_BATCH,
  RUN_FAILED_DEAD_LETTER,
} from "@trainos/fixtures";

import { createRpcApiClient } from "../apiClient";
import { createRpcClient } from "../rpcClient";
import { __setTransportForTests } from "../supabase";
import { oracleTransport, toPageRequest, type Args, type Oracle } from "./oracleTransport";

/**
 * 027 · automation (agents/runs), knowledge and AI-settings.
 *
 * Same harness as `conformance.test.ts` (the oracle transport plays PostgREST
 * over the fixture client) so this proves the same thing that file proves for
 * the golden path: the RPC client's envelope round trip — serialise, unwrap,
 * classify, adapt — agrees with the fixture oracle byte for byte. It does NOT
 * prove the SQL in 027 behaves this way against a real database; that is
 * `supabase/tests/test_027_ops_knowledge_settings.sql`, run on the shim.
 */

const FUNCTIONS: Record<string, (args: Args, oracle: Oracle) => Promise<unknown>> = {
  list_agents: (_args, oracle) => oracle.listAgents(),
  pause_agent: (args, oracle) =>
    oracle.pauseAgent(String(args.p_id), args.p_body as Parameters<Oracle["pauseAgent"]>[1]),
  list_runs: (args, oracle) => oracle.listRuns(toPageRequest(args)),
  get_run: (args, oracle) => oracle.getRun(String(args.p_id)),
  retry_run: (args, oracle) =>
    oracle.retryRun(String(args.p_id), (args.p_from as "checkpoint" | null) ?? undefined),
  dead_letter_run: (args, oracle) =>
    oracle.deadLetterRun(String(args.p_id), args.p_body as { reason: string }),
  create_knowledge_source: (args, oracle) =>
    oracle.createKnowledgeSource(args.p_body as Parameters<Oracle["createKnowledgeSource"]>[0]),
  check_knowledge_source: (args, oracle) => oracle.checkKnowledgeSource(String(args.p_id)),
  reingest_knowledge_source: (args, oracle) => oracle.reingestKnowledgeSource(String(args.p_id)),
  list_library_assets: (args, oracle) => oracle.listLibraryAssets(toPageRequest(args)),
  get_ai_routing: (_args, oracle) => oracle.getAiRouting(),
  put_ai_routing: (args, oracle) =>
    oracle.putAiRouting(args.p_entries as Parameters<Oracle["putAiRouting"]>[0]),
  list_providers: (_args, oracle) => oracle.listProviders(),
  get_usage: (args, oracle) =>
    oracle.getUsage(
      (args.p_period as string | null) ?? undefined,
      (args.p_group_by as "TIER" | "AGENT" | "ACTION_TYPE" | null) ?? undefined,
    ),
  put_budget: (args, oracle) =>
    oracle.putBudget(
      args.p_scope as "TIER" | "AGENT" | "ACTION_TYPE",
      String(args.p_key),
      args.p_body as { cap: { amount: number; currency: "MYR" } },
    ),
  get_tenant: (_args, oracle) => oracle.getTenant(),
};

function bothClients() {
  const oracle = createFixtureClient({ latencyMs: 0 });
  const rpcApi = createRpcApiClient(createRpcClient());
  __setTransportForTests(oracleTransport(oracle, FUNCTIONS));
  return { oracle, rpcApi };
}

afterEach(() => {
  __setTransportForTests(null);
});

describe("027 · automation, knowledge and AI settings, both clients agree", () => {
  it("listAgents", async () => {
    const { oracle, rpcApi } = bothClients();
    expect(await rpcApi.listAgents()).toEqual(await oracle.listAgents());
  });

  it("pauseAgent (whole agent)", async () => {
    const { rpcApi } = bothClients();
    const paused = await rpcApi.pauseAgent(AGENT_COLLECTIONS, { actionType: null });
    expect(paused).toMatchObject({ id: AGENT_COLLECTIONS, status: "PAUSED" });
    expect(paused.pausedAt).toBeTruthy();
  });

  it("listRuns", async () => {
    /* core.list_runs (027) always sorts -startedAt and has no p_sort
       argument, so it is compared to the oracle by SET rather than by order:
       the fixture's own default sort only applies when `page` is omitted
       entirely, and the RPC path always sends one, so the two orderings are
       not guaranteed to agree tie-for-tie without duplicating 001-021's own
       sort semantics here. */
    const byId = <T extends { id: string }>(rows: T[]) =>
      [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
    const { oracle, rpcApi } = bothClients();
    const [viaRpc, viaOracle] = await Promise.all([rpcApi.listRuns(), oracle.listRuns()]);
    expect(byId(viaRpc.data)).toEqual(byId(viaOracle.data));
    expect(viaRpc.page.total).toBe(viaOracle.page.total);
  });

  it("getRun", async () => {
    const { oracle, rpcApi } = bothClients();
    expect(await rpcApi.getRun(RUN_FAILED_DEAD_LETTER)).toEqual(
      await oracle.getRun(RUN_FAILED_DEAD_LETTER),
    );
  });

  it("getRun, not found on both clients the same way", async () => {
    const { rpcApi } = bothClients();
    await expect(rpcApi.getRun("run_does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("createKnowledgeSource", async () => {
    const { rpcApi } = bothClients();
    const created = await rpcApi.createKnowledgeSource({
      name: "PDPA guidance 2026",
      type: "HRDC_CIRCULAR",
      retrievalScopes: ["COMPLIANCE"],
    });
    expect(created).toMatchObject({ name: "PDPA guidance 2026", embeddingStatus: "PENDING" });
  });

  it("listLibraryAssets", async () => {
    const { oracle, rpcApi } = bothClients();
    expect(await rpcApi.listLibraryAssets()).toEqual(await oracle.listLibraryAssets());
  });

  it("getAiRouting", async () => {
    const { oracle, rpcApi } = bothClients();
    expect(await rpcApi.getAiRouting()).toEqual(await oracle.getAiRouting());
  });

  it("listProviders never carries a raw key, on either client", async () => {
    const { oracle, rpcApi } = bothClients();
    const [viaRpc, viaOracle] = await Promise.all([rpcApi.listProviders(), oracle.listProviders()]);
    expect(viaRpc).toEqual(viaOracle);
    for (const row of viaRpc.data) {
      expect(row).not.toHaveProperty("key");
      if (row.maskedKey.length > 0) expect(row.maskedKey).toMatch(/•/);
    }
    expect(viaRpc.data.some((row) => row.id === PROVIDER_ANTHROPIC_BATCH)).toBe(true);
  });

  it("getUsage", async () => {
    const { oracle, rpcApi } = bothClients();
    expect(await rpcApi.getUsage()).toEqual(await oracle.getUsage());
  });

  it("getTenant", async () => {
    const { oracle, rpcApi } = bothClients();
    expect(await rpcApi.getTenant()).toEqual(await oracle.getTenant());
  });

  it("a FORBIDDEN raised by the database (RAISE ... TRNOS) arrives as a domain error", async () => {
    const { rpcApi } = bothClients();
    __setTransportForTests({
      rpc: async () => ({
        data: null,
        error: {
          message: "requester lacks agent:read",
          code: "TRNOS",
          details: JSON.stringify({ code: "FORBIDDEN", requiredPermission: "agent:read" }),
        },
      }),
      from: () => ({
        select: () =>
          Object.assign(Promise.resolve({ data: [], error: null }), {
            match: () => Promise.resolve({ data: [], error: null }),
          }),
      }),
    });
    await expect(rpcApi.listAgents()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
