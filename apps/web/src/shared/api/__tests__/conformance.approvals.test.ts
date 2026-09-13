import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApprovalBulkDecideRequest, ApprovalDecideRequest } from "@trainos/contract";
import { APPROVAL_AURORA, USER_KELVIN } from "@trainos/contract";
import { createFixtureClient, isContractError } from "@trainos/fixtures";

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

const FUNCTIONS: RpcHandlers = {
  list_approvals: (args, oracle) => oracle.listApprovals(toPageRequest(args)),
  get_approval: (args, oracle) => oracle.getApproval(String(args.p_id)),
  get_audit: (args, oracle) => oracle.getAudit(String(args.p_resource_type), String(args.p_id)),
  decide_approval: (args, oracle) =>
    oracle.decideApproval(
      String(args.p_approval_id),
      {
        decision: args.p_decision,
        note: args.p_note,
        diffHash: args.p_expected_diff_hash,
      } as ApprovalDecideRequest,
      { idempotencyKey: String(args.p_idempotency_key) },
    ),
  bulk_decide_approvals: (args, oracle) =>
    oracle.bulkDecideApprovals(
      {
        items: (args.p_items as { approvalId: string; expectedDiffHash: string }[]).map((item) => ({
          approvalId: item.approvalId,
          diffHash: item.expectedDiffHash,
        })),
        decision: args.p_decision,
        note: args.p_note,
      } as ApprovalBulkDecideRequest,
      { idempotencyKey: String(args.p_idempotency_key) },
    ),
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

    if (isContractError(fromFixtures)) {
      expect(isContractError(fromRpc)).toBe(true);
      expect(isContractError(fromRpc) && fromRpc.code).toBe(fromFixtures.code);
      expect(isContractError(fromRpc) && fromRpc.details).toEqual(fromFixtures.details);
      return;
    }
    expect(fromRpc).toEqual(fromFixtures);
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
