import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApprovalBulkDecideRequest, ApprovalDecideRequest } from "@trainos/contract";
import { APPROVAL_AURORA, USER_KELVIN } from "@trainos/contract";
import { createFixtureClient, isContractError } from "@trainos/fixtures";

import { createRpcApiClient, type ApiClient } from "../apiClient";
import { isNotDeployed } from "../notDeployed";
import { classifyTransportFailure, createRpcClient } from "../rpcClient";
import { __setTransportForTests } from "../supabase";
import {
  oracleTransport,
  toPageRequest,
  unexposedSchemaTransport,
  type Oracle,
  type RpcHandlers,
  type ViewHandlers,
} from "./oracleTransport";

/**
 * M02 · approvals, through the seam.
 *
 * Every call `features/approvals/api.ts` makes: the pill-tab views, the grouped
 * inbox, the decision payload, the audit trail, and both writes. The decision
 * is the one governed write in the app a person makes with money on the other
 * side of it, so this suite compares the WRITE path as hard as the read path —
 * a decision that replayed on one client and did not on the other would be two
 * audit entries for one human judgement.
 *
 * Signed in as Kelvin, the SALES_MANAGER who decides APV-2026-0771. The fixture
 * client enforces permissions for real; as Amirah every decision here would be
 * refused, and the suite would be comparing two identical `FORBIDDEN`s rather
 * than the decision it means to pin.
 */

/**
 * One element of `p_items`, in the DATABASE's spelling.
 *
 * `approvalId` and `expectedDiffHash`, camelCase, and no per-item `decision` —
 * `app.bulk_decide` reads exactly these two keys off each element
 * (011:3506-3507) under a single top-level `p_decision`. The contract's own
 * `ApprovalBulkDecideRequest.items` uses `diffHash`, so the rename happens in
 * `rpcClient.bulkDecide` and this type is what must come out the other side.
 */
type WireItem = { approvalId: string; expectedDiffHash: string };

/** What `bulk_decide_approvals` was actually called with, in call order. */
const bulkWireCalls: { items: WireItem[]; idempotencyKey: string }[] = [];

/** What `decide_approval` was actually called with, in call order. */
const decideWireCalls: Record<string, unknown>[] = [];

const FUNCTIONS: RpcHandlers = {
  list_approvals: (args, oracle) => oracle.listApprovals(toPageRequest(args)),
  get_approval: (args, oracle) => oracle.getApproval(String(args.p_id)),
  get_audit: (args, oracle) => oracle.getAudit(String(args.p_resource_type), String(args.p_id)),
  decide_approval: (args, oracle) => {
    decideWireCalls.push({ ...args });
    return oracle.decideApproval(
      String(args.p_approval_id),
      {
        decision: args.p_decision,
        note: args.p_note,
        diffHash: args.p_expected_diff_hash,
      } as ApprovalDecideRequest,
      { idempotencyKey: String(args.p_idempotency_key) },
    );
  },
  bulk_decide_approvals: (args, oracle) => {
    /* Recorded so the suite can assert what actually went ON THE WIRE, not just
       what came back. The p_items shape and the derived key are the contract
       here, and a round trip through the oracle would hide both. */
    bulkWireCalls.push({
      items: args.p_items as WireItem[],
      idempotencyKey: String(args.p_idempotency_key),
    });
    return oracle.bulkDecideApprovals(
      {
        items: (args.p_items as WireItem[]).map((item) => ({
          approvalId: item.approvalId,
          diffHash: item.expectedDiffHash,
        })),
        decision: args.p_decision,
        note: args.p_note,
      } as ApprovalBulkDecideRequest,
      { idempotencyKey: String(args.p_idempotency_key) },
    );
  },
};

/** §2 the saved views behind M02-S01's pill tabs. */
const VIEWS: ViewHandlers = {
  v_saved_views: async (oracle) => (await oracle.listViews()).data,
};

/**
 * `diffHash` here must match `APPROVAL_AURORA`'s fixture row
 * (`packages/fixtures/src/data/approvals.ts`) exactly, or every decide call
 * in this suite would refuse with `DIFF_CHANGED` before it exercised
 * anything else.
 */
const APPROVE: ApprovalDecideRequest = {
  decision: "APPROVE",
  note: "Within the revised cap.",
  diffHash: "diff_0771_v1",
};

describe("M02 · the two clients answer the approval screens the same", () => {
  let oracle: Oracle;
  let fixtures: ApiClient;
  let rpc: ApiClient;

  beforeEach(() => {
    bulkWireCalls.length = 0;
    decideWireCalls.length = 0;
    oracle = createFixtureClient({ latencyMs: 0, actorId: USER_KELVIN });
    fixtures = createFixtureClient({ latencyMs: 0, actorId: USER_KELVIN });
    __setTransportForTests(oracleTransport(oracle, FUNCTIONS, VIEWS));
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const calls: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["useApprovalViews", (client) => client.listViews("APPROVAL")],
    ["useApprovalInbox", (client) => client.listApprovals({ group: "URGENCY" })],
    ["useApproval", (client) => client.getApproval(APPROVAL_AURORA)],
    ["useApprovalAudit", (client) => client.getAudit("approvals", APPROVAL_AURORA)],
    [
      "useDecideApproval",
      (client) =>
        client.decideApproval(APPROVAL_AURORA, APPROVE, {
          idempotencyKey: "approval-decide:test",
        }),
    ],
  ];

  for (const [hook, call] of calls) {
    it(`${hook} — same value from both`, async () => {
      const [viaFixtures, viaRpc] = await Promise.all([call(fixtures), call(rpc)]);
      expect(viaRpc).toEqual(viaFixtures);
    });
  }

  /**
   * The grouping survives the round trip.
   *
   * `groups[]` is a SIBLING of `data` in `ApprovalListResponse`, which is the
   * exact shape the unwrap rule treats specially: strip `success`, and unwrap
   * only if `data` is then alone. An envelope built by hand rather than by
   * `app.ok()` would hand the screen `{data, page, groups}` unwrapped one level
   * too far, and M02-S01's urgency headings would vanish without an error.
   */
  it("the urgency groups arrive as a sibling of `data`, not unwrapped away", async () => {
    const inbox = await rpc.listApprovals({ group: "URGENCY" });
    expect(Array.isArray(inbox.groups)).toBe(true);
    expect(inbox.groups.length).toBeGreaterThan(0);
    expect(inbox.page).toBeDefined();
  });

  /**
   * The §7 refusal M02-S01 is built around: a money-carrying row in a bulk
   * selection. It has a DESIGNED surface — the blocked refs, inline — so it has
   * to arrive as a domain refusal with its details, not as a transport failure.
   */
  it("a bulk decision over a monetary approval refuses identically", async () => {
    const body: ApprovalBulkDecideRequest = {
      items: [{ approvalId: APPROVAL_AURORA, diffHash: "diff_0771_v1" }],
      decision: "APPROVE",
    };
    const fromFixtures = await fixtures
      .bulkDecideApprovals(body, { idempotencyKey: "bulk:test" })
      .catch((error: unknown) => error);
    const fromRpc = await rpc
      .bulkDecideApprovals(body, { idempotencyKey: "bulk:test" })
      .catch((error: unknown) => error);

    /* Unconditional: a money row in a bulk batch MUST refuse. The old
       `if (isContractError(fromFixtures))` let a fixture that stopped refusing
       pass on `toEqual`, and it compared codes without naming one, which is
       how `AGENT_PAUSED` stood in for 011's `BULK_NOT_PERMITTED` unnoticed. */
    expect(isContractError(fromFixtures)).toBe(true);
    expect(isContractError(fromRpc)).toBe(true);
    expect(isContractError(fromRpc) && fromRpc.code).toBe("BULK_NOT_PERMITTED");
    expect(isContractError(fromRpc) && fromRpc.code).toBe(
      isContractError(fromFixtures) && fromFixtures.code,
    );
    expect(isContractError(fromRpc) && fromRpc.details).toEqual(
      isContractError(fromFixtures) && fromFixtures.details,
    );
  });

  /**
   * The same refusal as PostgREST hands it over, with the fixture out of the
   * loop. Every other assertion in this suite answers from `FixtureClient`, so
   * it can only prove the two clients agree with EACH OTHER. This one feeds
   * `classifyTransportFailure` the DETAIL 011:3566-3571 (11508ed) builds —
   * `jsonb_build_object(...)::text`, so jsonb's own key order and spacing —
   * and asserts the code survives. Before `BULK_NOT_PERMITTED` joined
   * `ErrorCode`, `isErrorCode` failed and it degraded to `VALIDATION_FAILED`,
   * so the inbox's named-blockers banner could never render against Postgres.
   */
  it("keeps the database's BULK_NOT_PERMITTED and its blocked rows through classification", () => {
    const error = classifyTransportFailure({
      code: "TRNOS",
      message: "one or more approvals may not be decided in bulk",
      details:
        '{"code": "BULK_NOT_PERMITTED", "notBulkApprovable": ' +
        '[{"id": "apv_0771", "ref": "APV-2026-0771", "reason": "MONETARY_VALUE"}]}',
    });
    expect(error).toMatchObject({
      kind: "domain",
      code: "BULK_NOT_PERMITTED",
      status: 409,
      message: "one or more approvals may not be decided in bulk",
      details: {
        notBulkApprovable: [{ id: "apv_0771", ref: "APV-2026-0771", reason: "MONETARY_VALUE" }],
      },
    });
  });

  /**
   * 011:3407-3479 (062e5e2): a bulk APPROVE carries one `diffHash` per item,
   * and both clients must refuse a hashless or stale item identically, before
   * admitting a fresh one. `APV-2026-0773` is bulk-approvable (unlike
   * `APPROVAL_AURORA` above, which is money-carrying and refuses for a
   * different reason before either check runs) — see
   * `packages/fixtures/src/data/approvals.ts`, `diffHash: "diff_0773_v1"`.
   */
  it("bulk decide refuses a hashless or stale item identically, and admits a fresh one", async () => {
    const RULE_CHANGE = "APV-2026-0773";

    const hashless = await fixtures
      .bulkDecideApprovals(
        { items: [{ approvalId: RULE_CHANGE, diffHash: "" }], decision: "APPROVE" },
        { idempotencyKey: "bulk-decide:hashless:fixtures" },
      )
      .catch((error: unknown) => error);
    const hashlessRpc = await rpc
      .bulkDecideApprovals(
        { items: [{ approvalId: RULE_CHANGE, diffHash: "" }], decision: "APPROVE" },
        { idempotencyKey: "bulk-decide:hashless:rpc" },
      )
      .catch((error: unknown) => error);
    expect(isContractError(hashless)).toBe(true);
    expect(isContractError(hashlessRpc)).toBe(true);
    expect(isContractError(hashlessRpc) && hashlessRpc.code).toBe("VALIDATION_FAILED");
    expect(isContractError(hashlessRpc) && hashlessRpc.code).toBe(
      isContractError(hashless) && hashless.code,
    );

    const stale = await fixtures
      .bulkDecideApprovals(
        { items: [{ approvalId: RULE_CHANGE, diffHash: "stale-hash" }], decision: "APPROVE" },
        { idempotencyKey: "bulk-decide:stale:fixtures" },
      )
      .catch((error: unknown) => error);
    const staleRpc = await rpc
      .bulkDecideApprovals(
        { items: [{ approvalId: RULE_CHANGE, diffHash: "stale-hash" }], decision: "APPROVE" },
        { idempotencyKey: "bulk-decide:stale:rpc" },
      )
      .catch((error: unknown) => error);
    expect(isContractError(stale)).toBe(true);
    expect(isContractError(staleRpc)).toBe(true);
    expect(isContractError(staleRpc) && staleRpc.code).toBe("DIFF_CHANGED");
    expect(isContractError(staleRpc) && staleRpc.code).toBe(isContractError(stale) && stale.code);
    expect(isContractError(staleRpc) && staleRpc.details).toEqual(
      isContractError(stale) && stale.details,
    );

    /* Neither refusal above applied anything, so the same fresh hash still
       clears on both — the negative cases are only meaningful next to this. */
    const fresh = {
      items: [{ approvalId: RULE_CHANGE, diffHash: "diff_0773_v1" }],
      decision: "APPROVE" as const,
    };
    const freshFromFixtures = await fixtures.bulkDecideApprovals(fresh, {
      idempotencyKey: "bulk-decide:fresh:fixtures",
    });
    const freshFromRpc = await rpc.bulkDecideApprovals(fresh, {
      idempotencyKey: "bulk-decide:fresh:rpc",
    });
    expect(freshFromRpc).toEqual(freshFromFixtures);
  });

  /**
   * The argument the DATABASE receives, asserted directly rather than inferred
   * from what came back.
   *
   * `core.bulk_decide_approvals(p_items jsonb, p_decision text, p_note text,
   * p_idempotency_key text)` (014:1328) forwards to `app.bulk_decide`, which
   * reads `item ->> 'approvalId'` and `item ->> 'expectedDiffHash'` off each
   * element (011:3506-3507). Three ways to get this wrong are all silent:
   * sending `p_ids` (the dropped 4-arg overload — 011:3405 drops it precisely so
   * this resolves to nothing rather than to the wrong function), snake_casing
   * the keys (`->>` finds nothing, the hash reads NULL, and 011 compares the
   * hash only when non-NULL, so the APPROVE sails through unguarded), or
   * hanging a per-item `decision` on the element (there is none; one top-level
   * `p_decision` governs the batch).
   */
  it("sends p_items with the database's own key spelling, and no p_ids", async () => {
    await rpc.bulkDecideApprovals(
      {
        items: [
          { approvalId: "apv_0774", diffHash: "diff_0774_v1" },
          { approvalId: "apv_0775", diffHash: "diff_0775_v1" },
        ],
        decision: "APPROVE",
      },
      { idempotencyKey: "bulk-decide:shape" },
    );

    expect(bulkWireCalls).toHaveLength(1);
    expect(bulkWireCalls[0].items).toEqual([
      { approvalId: "apv_0774", expectedDiffHash: "diff_0774_v1" },
      { approvalId: "apv_0775", expectedDiffHash: "diff_0775_v1" },
    ]);
    /* Exactly two keys per element: a stray `diffHash` alongside would mean the
       rename half-happened and the guard would still be reading NULL. */
    for (const item of bulkWireCalls[0].items) {
      expect(Object.keys(item).sort()).toEqual(["approvalId", "expectedDiffHash"]);
    }
  });

  /**
   * ⚠ SELECTION ORDER IS NOT INTENT, SO IT MUST NOT CHANGE THE KEY.
   *
   * `app.bulk_decide` takes its idempotency request hash over
   * `array_agg(x ORDER BY x)` — sorted (011:3447) — with the comment that a
   * client hashing "its selection in click order" made the same two approvals
   * picked in the other order produce a different key. Sorting server-side
   * settles the COMPARISON for one key; only the client can mint one key. Until
   * this pinned it, `useBulkDecideApprovals` passed
   * `derivedIdempotencyKey("approval-decide", "bulk", body)` — which also
   * overrode the adapter's derivation entirely, because `key()` is
   * `options?.idempotencyKey ?? fallback` — and a retry after a dropped
   * connection ran the whole batch a second time instead of replaying it.
   */
  it("derives one idempotency key for one selection, whichever order it was ticked in", async () => {
    const first = { approvalId: "apv_0774", diffHash: "diff_0774_v1" };
    const second = { approvalId: "apv_0775", diffHash: "diff_0775_v1" };

    /* No `idempotencyKey` option, deliberately: passing one is what the screen
       used to do and it is exactly what this asserts nobody does. The refusals
       are irrelevant here — the key is recorded before the oracle runs. */
    await rpc
      .bulkDecideApprovals({ items: [first, second], decision: "APPROVE" })
      .catch(() => undefined);
    await rpc
      .bulkDecideApprovals({ items: [second, first], decision: "APPROVE" })
      .catch(() => undefined);

    expect(bulkWireCalls).toHaveLength(2);
    expect(bulkWireCalls[1].idempotencyKey).toBe(bulkWireCalls[0].idempotencyKey);
    /* Scoped to the bulk write, not borrowed from the single decide. */
    expect(bulkWireCalls[0].idempotencyKey.startsWith("approval-bulk-decide:")).toBe(true);

    /* …and the selection is still sent in the order it was ticked, because
       011:3506 iterates `p_items` in order to build `results`. */
    expect(bulkWireCalls[1].items.map((item) => item.approvalId)).toEqual(["apv_0775", "apv_0774"]);

    /* A REPRICED approval is a different decision, not a replay: the per-item
       hash is part of the intent, so a changed hash must change the key. */
    await rpc
      .bulkDecideApprovals({
        items: [first, { ...second, diffHash: "diff_0775_v2" }],
        decision: "APPROVE",
      })
      .catch(() => undefined);
    expect(bulkWireCalls[2].idempotencyKey).not.toBe(bulkWireCalls[0].idempotencyKey);
  });

  /**
   * §7 finding #6 (docs/reviews/2026-09-13-codex-retrofit-014-017.md): the
   * client must send the diff hash it rendered, and BOTH clients must refuse
   * a decision made against a hash that no longer matches — the fixture
   * oracle (`FixtureClient.decideApproval`) and `core.decide_approval`'s own
   * guard (`011:2781-2787`) alike. A hash that fails on only one client is
   * exactly the silent no-op the finding is about.
   */
  it("a stale diff hash refuses identically on both clients, a fresh one does not", async () => {
    const stale: ApprovalDecideRequest = { ...APPROVE, diffHash: "stale-hash" };
    const fromFixtures = await fixtures
      .decideApproval(APPROVAL_AURORA, stale, { idempotencyKey: "approval-decide:stale" })
      .catch((error: unknown) => error);
    const fromRpc = await rpc
      .decideApproval(APPROVAL_AURORA, stale, { idempotencyKey: "approval-decide:stale" })
      .catch((error: unknown) => error);

    expect(isContractError(fromFixtures)).toBe(true);
    expect(isContractError(fromRpc)).toBe(true);
    expect(isContractError(fromRpc) && fromRpc.code).toBe(
      isContractError(fromFixtures) && fromFixtures.code,
    );
    expect(isContractError(fromRpc) && fromRpc.code).toBe("DIFF_CHANGED");
    expect(isContractError(fromRpc) && fromRpc.details).toEqual(
      isContractError(fromFixtures) && fromFixtures.details,
    );

    /* The fresh hash `APPROVE` carries is accepted on both — the negative
       case above is only meaningful next to a positive one. */
    const freshFromFixtures = await fixtures.decideApproval(APPROVAL_AURORA, APPROVE, {
      idempotencyKey: "approval-decide:fresh",
    });
    const freshFromRpc = await rpc.decideApproval(APPROVAL_AURORA, APPROVE, {
      idempotencyKey: "approval-decide:fresh",
    });
    expect(freshFromRpc).toEqual(freshFromFixtures);
  });

  /**
   * The single decide's argument list, asserted on the wire.
   *
   * `core.decide_approval(p_approval_id uuid, p_decision text, p_note text,
   * p_expected_diff_hash text, p_idempotency_key text)` (014:1274-1280 at
   * 11508ed) refuses an APPROVE whose hash is missing or blank (014:1287-1297).
   * PostgREST matches named arguments, so a renamed key does not reach the
   * parameter: the hash reads NULL and every web APPROVE is refused. The fresh
   * decide elsewhere in this suite would catch a dropped hash only indirectly,
   * through the oracle's answer.
   */
  it("sends the single decide with 014's five argument names, the rendered hash among them", async () => {
    await rpc.decideApproval(APPROVAL_AURORA, APPROVE, { idempotencyKey: "approval-decide:wire" });

    expect(decideWireCalls).toHaveLength(1);
    expect(decideWireCalls[0]).toEqual({
      p_approval_id: APPROVAL_AURORA,
      p_decision: "APPROVE",
      p_note: APPROVE.note,
      p_expected_diff_hash: APPROVE.diffHash,
      p_idempotency_key: "approval-decide:wire",
    });

    /* And a hashless APPROVE refuses the way the wrapper refuses it, on both. */
    const hashless: ApprovalDecideRequest = { ...APPROVE, diffHash: "" };
    const fromFixtures = await fixtures
      .decideApproval(APPROVAL_AURORA, hashless, { idempotencyKey: "approval-decide:hashless" })
      .catch((error: unknown) => error);
    const fromRpc = await rpc
      .decideApproval(APPROVAL_AURORA, hashless, { idempotencyKey: "approval-decide:hashless" })
      .catch((error: unknown) => error);
    expect(isContractError(fromRpc) && fromRpc.code).toBe("VALIDATION_FAILED");
    expect(isContractError(fromRpc) && fromRpc.details).toEqual({
      fields: [{ field: "diffHash", reason: "REQUIRED" }],
    });
    expect(isContractError(fromRpc) && fromRpc.details).toEqual(
      isContractError(fromFixtures) && fromFixtures.details,
    );
  });

  /**
   * The key is the DECISION's, so the second click replays the first answer.
   *
   * Both clients derive it through `derivedIdempotencyKey`, and the adapter
   * passes the caller's through untouched when one is given. If either half
   * stopped being true, a double-clicked approve would be one decision on
   * fixtures and two against Supabase — with two audit entries, which is the
   * thing §3's key exists to prevent.
   */
  it("a replayed decision returns the first answer rather than deciding twice", async () => {
    const key = { idempotencyKey: "approval-decide:replay" };
    const first = await rpc.decideApproval(APPROVAL_AURORA, APPROVE, key);
    const second = await rpc.decideApproval(APPROVAL_AURORA, APPROVE, key);
    expect(second).toEqual(first);
  });
});

/** The state M02 is in on the hosted project until the RPC pack lands. */
describe("M02 · an undeployed environment", () => {
  let rpc: ApiClient;

  beforeEach(() => {
    __setTransportForTests(unexposedSchemaTransport());
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const reads: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["the inbox", (client) => client.listApprovals({ group: "URGENCY" })],
    ["an approval", (client) => client.getApproval(APPROVAL_AURORA)],
    ["the audit trail", (client) => client.getAudit("approvals", APPROVAL_AURORA)],
    ["the saved views", (client) => client.listViews("APPROVAL")],
  ];

  for (const [what, call] of reads) {
    it(`${what} reads as not deployed`, async () => {
      const thrown = await call(rpc).catch((error: unknown) => error);
      expect(isNotDeployed(thrown)).toBe(true);
    });
  }

  /** A decision cannot be attempted either, and says so as a fact. */
  it("a decision reads as not deployed", async () => {
    const thrown = await rpc
      .decideApproval(APPROVAL_AURORA, APPROVE)
      .catch((error: unknown) => error);
    expect(isNotDeployed(thrown)).toBe(true);
  });
});
