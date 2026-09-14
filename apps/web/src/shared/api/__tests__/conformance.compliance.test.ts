import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ComplianceRule } from "@trainos/contract";
import { DOCUMENT_CIRCULAR_09, ENGAGEMENT_AURORA, USER_AMIRAH } from "@trainos/contract";
import { createFixtureClient } from "@trainos/fixtures";

import { createRpcApiClient, type ApiClient } from "../apiClient";
import { isNotDeployed } from "../notDeployed";
import { createRpcClient } from "../rpcClient";
import { __setTransportForTests } from "../supabase";
import {
  oracleTransport,
  unexposedSchemaTransport,
  type Oracle,
  type RpcHandlers,
} from "./oracleTransport";

/**
 * M12 · HRD Corp packets and the rules registry, through the seam.
 *
 * Every call `features/hrdc/api.ts` and `features/compliance/api.ts` make to
 * one of 025's six RPCs, run against both clients with the transport mocked.
 */

const FUNCTIONS: RpcHandlers = {
  get_claim_packet: (args, oracle) => oracle.getClaimPacket(String(args.p_id)),
  get_compliance_checks: (args, oracle) =>
    oracle.getComplianceChecks(String(args.p_engagement_ref)),
  attach_packet_document: (args, oracle) =>
    oracle.attachPacketDocument(
      String(args.p_id),
      args.p_body as { type: "EVALUATION_SUMMARY"; ref: string },
    ),
  export_claim_packet: (args, oracle) => oracle.exportClaimPacket(String(args.p_id)),
  create_compliance_rule: (args, oracle) =>
    oracle.createComplianceRule(args.p_body as Omit<ComplianceRule, "status">),
  get_rule_change_set: (args, oracle) => oracle.getRuleChangeSet(String(args.p_document_id)),
};

/** The body `useAttachDocument` sends when a document is uploaded. */
const ATTACH_BODY = { type: "EVALUATION_SUMMARY" as const, ref: "ATT-2026-9001" };

/** The body `RulesRegistryScreen`'s "Add rule" drawer sends. */
const NEW_RULE: Omit<ComplianceRule, "status"> = {
  id: "HRD-TEST-01",
  scheme: "SBL_KHAS",
  subject: "Test rule added by the conformance suite",
  expression: { field: "starts_on", op: "LTE", reference: "approval_date", offsetDays: 90 },
  effectiveFrom: "2026-09-14",
  effectiveTo: null,
  source: {
    documentId: "DOC-MANUAL",
    title: "Entered by hand",
    section: "—",
    page: 0,
    excerpt: "Test excerpt.",
  },
  supersedesId: null,
  supersededById: null,
  usedByChecks: [],
  affectedOpenEngagements: 0,
  verifiedBy: null,
  verifiedAt: null,
};

describe("M12 · the two clients answer the compliance screens the same", () => {
  let oracle: Oracle;
  let fixtures: ApiClient;
  let rpc: ApiClient;

  beforeEach(() => {
    oracle = createFixtureClient({ latencyMs: 0, actorId: USER_AMIRAH });
    fixtures = createFixtureClient({ latencyMs: 0, actorId: USER_AMIRAH });
    __setTransportForTests(oracleTransport(oracle, FUNCTIONS, {}));
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const calls: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["useClaimPacket", (client) => client.getClaimPacket(ENGAGEMENT_AURORA)],
    ["useComplianceChecks", (client) => client.getComplianceChecks(ENGAGEMENT_AURORA)],
    ["useAttachDocument", (client) => client.attachPacketDocument(ENGAGEMENT_AURORA, ATTACH_BODY)],
    ["useExportPacket", (client) => client.exportClaimPacket(ENGAGEMENT_AURORA)],
    ["useCreateComplianceRule", (client) => client.createComplianceRule({ ...NEW_RULE })],
    ["useRuleChangeSet", (client) => client.getRuleChangeSet(DOCUMENT_CIRCULAR_09)],
  ];

  for (const [hook, call] of calls) {
    it(`${hook} — same value from both`, async () => {
      const [viaFixtures, viaRpc] = await Promise.all([call(fixtures), call(rpc)]);
      expect(viaRpc).toEqual(viaFixtures);
    });
  }

  /**
   * DECISIONS §3: a hand-added rule loads PROPOSED and unverified regardless
   * of what the caller sends — the server ignores an attempt to submit it
   * verified.
   */
  it("createComplianceRule always loads PROPOSED and unverified", async () => {
    const created = await rpc.createComplianceRule({
      ...NEW_RULE,
      id: "HRD-TEST-02",
    } as Omit<ComplianceRule, "status">);
    expect(created.status).toBe("PROPOSED");
    expect(created.verifiedBy).toBeNull();
    expect(created.verifiedAt).toBeNull();
  });

  /** A missing engagement refuses rather than failing. */
  it("a missing engagement's claim packet refuses NOT_FOUND", async () => {
    const thrown = await rpc.getClaimPacket("ENG-0000-0000").catch((error: unknown) => error);
    expect(isNotDeployed(thrown)).toBe(false);
    expect(thrown).toMatchObject({ code: "NOT_FOUND" });
  });

  /** A missing rule-change document refuses rather than failing. */
  it("an unknown rule-change document refuses NOT_FOUND", async () => {
    const thrown = await rpc.getRuleChangeSet("DOC-0000").catch((error: unknown) => error);
    expect(isNotDeployed(thrown)).toBe(false);
    expect(thrown).toMatchObject({ code: "NOT_FOUND" });
  });
});

/**
 * The state every compliance screen is in on the hosted project today, before
 * this migration is applied.
 */
describe("M12 · an undeployed environment", () => {
  let rpc: ApiClient;

  beforeEach(() => {
    __setTransportForTests(unexposedSchemaTransport());
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const reads: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["the claim packet", (client) => client.getClaimPacket(ENGAGEMENT_AURORA)],
    ["the compliance checks", (client) => client.getComplianceChecks(ENGAGEMENT_AURORA)],
    ["the packet export", (client) => client.exportClaimPacket(ENGAGEMENT_AURORA)],
    ["the rule change set", (client) => client.getRuleChangeSet(DOCUMENT_CIRCULAR_09)],
  ];

  for (const [what, call] of reads) {
    it(`${what} reads as not deployed`, async () => {
      const thrown = await call(rpc).catch((error: unknown) => error);
      expect(isNotDeployed(thrown)).toBe(true);
    });
  }

  it("attachPacketDocument writes as not deployed", async () => {
    const thrown = await rpc
      .attachPacketDocument(ENGAGEMENT_AURORA, ATTACH_BODY)
      .catch((error: unknown) => error);
    expect(isNotDeployed(thrown)).toBe(true);
  });

  it("createComplianceRule writes as not deployed", async () => {
    const thrown = await rpc.createComplianceRule({ ...NEW_RULE }).catch((error: unknown) => error);
    expect(isNotDeployed(thrown)).toBe(true);
  });
});
