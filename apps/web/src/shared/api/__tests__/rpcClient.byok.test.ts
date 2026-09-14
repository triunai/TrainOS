import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderKey,
  ProviderKeyCreateRequest,
  ProviderKeyRevealResponse,
  ProviderKeyTestResponse,
} from "@trainos/contract";

import { createRpcApiClient } from "../apiClient";
import { isDomainError, ok, toApiError, type Result } from "../errors";
import { createRpcClient, type ProbePolling } from "../rpcClient";
import { __setTransportForTests } from "../supabase";
import type { RpcTransport, TransportResponse } from "../transport";
import { okEnvelope } from "./oracleTransport";

/**
 * The BYOK adapters (migration 029), against what goes on the wire.
 *
 * A recorder, not the oracle: what is under test is the argument names the
 * SQL declares, where the key travels, and how two database calls become the
 * contract's one synchronous `ProviderKeyTestResponse`.
 */

const KEY = "sk-ant-api03-WEBTESTSECRETabcdefghijklmnopqrstuvwxyz";
const FAST: ProbePolling = { intervalMs: 0, attempts: 3 };

const RECORD: ProviderKey = {
  id: "prv_anthropic_0123456789ab",
  provider: "ANTHROPIC",
  label: "Anthropic direct",
  status: "NOT_SET",
  maskedKey: "sk-ant-••••••••••••wxyz",
  scopeTiers: ["STRONG_1"],
  spendMonth: { amount: 0, currency: "MYR" },
  billingOwner: "CLIENT_ACCOUNT",
  region: "US",
  lastTestedAt: null,
  addedBy: { id: "u1", name: "Admin", at: "2026-09-14T10:00:00+08:00" },
};

const PENDING = {
  state: "PENDING",
  outcome: "PENDING",
  status: "NOT_SET",
  lastTestedAt: "2026-09-14T10:00:00+08:00",
  requestedAt: "2026-09-14T10:00:00+08:00",
};
const DONE_VALID = {
  state: "DONE",
  outcome: "OK",
  status: "VALID",
  lastTestedAt: "2026-09-14T10:00:02+08:00",
  requestedAt: "2026-09-14T10:00:00+08:00",
};

const BODY: ProviderKeyCreateRequest = {
  provider: "ANTHROPIC",
  label: "Anthropic direct",
  key: KEY,
  scopeTiers: ["STRONG_1"],
  billingOwner: "CLIENT_ACCOUNT",
  region: "US",
};

function recorder(answer: (name: string, call: number) => TransportResponse) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const transport: RpcTransport = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve(answer(name, calls.filter((c) => c.name === name).length));
    },
    from: () => {
      throw new Error("no view reads in the BYOK adapters");
    },
  };
  return { transport, calls };
}

const trnos = (detail: Record<string, unknown>): TransportResponse => ({
  data: null,
  error: { message: String(detail.code), code: "TRNOS", details: JSON.stringify(detail) },
});

afterEach(() => {
  __setTransportForTests(null);
});

describe("createProvider", () => {
  it("sends the 029 argument names, puts the key in p_key only, and folds in the probe verdict", async () => {
    const { transport, calls } = recorder((name, n) =>
      name === "create_provider" ? okEnvelope(RECORD) : okEnvelope(n < 2 ? PENDING : DONE_VALID),
    );
    __setTransportForTests(transport);

    const result = await createRpcClient(FAST).createProvider({
      ...BODY,
      cap: { amount: 500000, currency: "MYR" },
    });

    expect(calls[0]).toEqual({
      name: "create_provider",
      args: {
        p_provider: "ANTHROPIC",
        p_label: "Anthropic direct",
        p_key: KEY,
        p_scope_tiers: ["STRONG_1"],
        p_billing_owner: "CLIENT_ACCOUNT",
        p_region: "US",
        p_cap: { amount: 500000, currency: "MYR" },
        p_rotation_date: null,
      },
    });
    expect(calls.slice(1).map((c) => c.name)).toEqual([
      "get_provider_test_result",
      "get_provider_test_result",
    ]);
    /* The key leaves exactly once, in exactly one argument. */
    const carrying = calls.filter((c) => JSON.stringify(c.args).includes(KEY));
    expect(carrying).toEqual([calls[0]]);
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ status: "VALID", lastTestedAt: DONE_VALID.lastTestedAt });
    expect(JSON.stringify(result.data)).not.toContain(KEY);
  });

  it("returns the written record unchanged when the probe has not answered in the window", async () => {
    const { transport } = recorder((name) =>
      name === "create_provider" ? okEnvelope(RECORD) : okEnvelope(PENDING),
    );
    __setTransportForTests(transport);

    const result = await createRpcClient(FAST).createProvider(BODY);

    expect(result.data).toEqual(RECORD);
  });

  it("surfaces a duplicate key as VALIDATION_FAILED and does not poll", async () => {
    const { transport, calls } = recorder(() =>
      trnos({
        code: "VALIDATION_FAILED",
        fields: [{ field: "key", reason: "DUPLICATE", code: "KEY_ALREADY_ADDED" }],
        existingId: "prv_anthropic_0123456789ab",
      }),
    );
    __setTransportForTests(transport);

    const result = await createRpcClient(FAST).createProvider(BODY);

    expect(calls).toHaveLength(1);
    expect(result.error).toMatchObject({ kind: "domain", code: "VALIDATION_FAILED", status: 422 });
  });
});

describe("testProvider", () => {
  it("fires test_provider, polls get_provider_test_result, and answers the contract shape", async () => {
    const { transport, calls } = recorder((name, n) =>
      name === "test_provider"
        ? okEnvelope(PENDING)
        : okEnvelope(
            n < 3
              ? PENDING
              : {
                  ...DONE_VALID,
                  outcome: "INVALID_KEY",
                  status: "INVALID",
                  message: "The key was rejected by ANTHROPIC.",
                },
          ),
    );
    __setTransportForTests(transport);

    const result = await createRpcClient(FAST).testProvider(RECORD.id);

    expect(calls[0]).toEqual({ name: "test_provider", args: { p_id: RECORD.id } });
    expect(calls.filter((c) => c.name === "get_provider_test_result")).toHaveLength(3);
    expect(result.data).toEqual({
      status: "INVALID",
      lastTestedAt: DONE_VALID.lastTestedAt,
      message: "The key was rejected by ANTHROPIC.",
    });
  });

  it("says the provider has not answered when the window closes on a pending probe", async () => {
    const { transport } = recorder(() => okEnvelope(PENDING));
    __setTransportForTests(transport);

    const result = await createRpcClient(FAST).testProvider(RECORD.id);

    expect(result.data).toEqual({
      status: "NOT_SET",
      lastTestedAt: PENDING.requestedAt,
      message: "The provider has not answered yet. Test again in a moment to read its verdict.",
    });
  });

  it("does not poll when the probe is already DONE", async () => {
    const { transport, calls } = recorder(() => okEnvelope(DONE_VALID));
    __setTransportForTests(transport);

    const result = await createRpcClient(FAST).testProvider(RECORD.id);

    expect(calls.map((c) => c.name)).toEqual(["test_provider"]);
    expect(result.data).toEqual({ status: "VALID", lastTestedAt: DONE_VALID.lastTestedAt });
  });
});

describe("reveal, rotate and delete", () => {
  it("reveal sends p_id and returns {key, revealedAt}", async () => {
    const revealed = { key: KEY, revealedAt: "2026-09-14T10:00:00+08:00" };
    const { transport, calls } = recorder(() => okEnvelope(revealed));
    __setTransportForTests(transport);

    const result = await createRpcClient(FAST).revealProvider(RECORD.id);

    expect(calls).toEqual([{ name: "reveal_provider", args: { p_id: RECORD.id } }]);
    expect(result.data).toEqual(revealed);
  });

  it("an aal1 reveal is a FORBIDDEN domain refusal carrying AAL2_REQUIRED, not a sign-in prompt", async () => {
    const { transport } = recorder(() => trnos({ code: "FORBIDDEN", reason: "AAL2_REQUIRED" }));
    __setTransportForTests(transport);

    const result = await createRpcClient(FAST).revealProvider(RECORD.id);

    expect(result.error).toMatchObject({
      kind: "domain",
      code: "FORBIDDEN",
      status: 403,
      details: { reason: "AAL2_REQUIRED" },
    });
  });

  it("rotate sends p_id and p_key and polls the new material's probe", async () => {
    const { transport, calls } = recorder((name) =>
      name === "rotate_provider" ? okEnvelope(RECORD) : okEnvelope(DONE_VALID),
    );
    __setTransportForTests(transport);

    const result = await createRpcClient(FAST).rotateProvider(RECORD.id, KEY);

    expect(calls[0]).toEqual({ name: "rotate_provider", args: { p_id: RECORD.id, p_key: KEY } });
    expect(result.data).toMatchObject({ status: "VALID" });
  });

  it("delete resolves to nothing, and a keyless tier is AGENT_PAUSED with its blockers", async () => {
    const ok = recorder(() => okEnvelope({ id: RECORD.id, deleted: true }));
    __setTransportForTests(ok.transport);
    expect(await createRpcClient(FAST).deleteProvider(RECORD.id)).toEqual({
      data: undefined,
      error: null,
    });
    expect(ok.calls).toEqual([{ name: "delete_provider", args: { p_id: RECORD.id } }]);

    const blocked = recorder(() => trnos({ code: "AGENT_PAUSED", blockers: ["STRONG_1"] }));
    __setTransportForTests(blocked.transport);
    const refused = await createRpcClient(FAST).deleteProvider(RECORD.id);
    expect(refused.error).toMatchObject({
      code: "AGENT_PAUSED",
      status: 409,
      details: { blockers: ["STRONG_1"] },
    });
  });
});

describe("the fixture-shaped seam", () => {
  it("routes the five BYOK methods to the RPC client under the fixture client's signatures", async () => {
    const rpc = {
      createProvider: vi.fn(async (): Promise<Result<ProviderKey>> => ok(RECORD)),
      testProvider: vi.fn(async (): Promise<Result<ProviderKeyTestResponse>> =>
        ok({ status: "VALID", lastTestedAt: DONE_VALID.lastTestedAt }),
      ),
      rotateProvider: vi.fn(async (_id: string, _key: string): Promise<Result<ProviderKey>> =>
        ok(RECORD),
      ),
      revealProvider: vi.fn(async (): Promise<Result<ProviderKeyRevealResponse>> =>
        ok({ key: KEY, revealedAt: DONE_VALID.lastTestedAt }),
      ),
      deleteProvider: vi.fn(async (): Promise<Result<void>> => ok(undefined)),
    };
    const client = createRpcApiClient({ ...createRpcClient(FAST), ...rpc });

    await expect(client.createProvider(BODY)).resolves.toEqual(RECORD);
    await expect(client.testProvider(RECORD.id)).resolves.toMatchObject({ status: "VALID" });
    await expect(client.rotateProvider(RECORD.id, { key: KEY })).resolves.toEqual(RECORD);
    await expect(client.revealProvider(RECORD.id)).resolves.toMatchObject({ key: KEY });
    await expect(client.deleteProvider(RECORD.id)).resolves.toBeUndefined();
    expect(rpc.rotateProvider).toHaveBeenCalledWith(RECORD.id, KEY);
  });

  it("rethrows a refusal as the contract error the screen's RefusalBanner reads", async () => {
    const { transport } = recorder(() =>
      trnos({ code: "FORBIDDEN", reason: "REVEAL_RATE_LIMITED" }),
    );
    __setTransportForTests(transport);

    const thrown = await createRpcApiClient(createRpcClient(FAST))
      .revealProvider(RECORD.id)
      .catch((error: unknown) => error);

    const error = toApiError(thrown);
    expect(isDomainError(error) && error.code).toBe("FORBIDDEN");
  });
});
