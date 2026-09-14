import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AttendanceCaptureRequest } from "@trainos/contract";
import {
  ENGAGEMENT_AURORA,
  PARTICIPANT_AHMAD,
  PROGRAMME_LEADING_CHANGE,
  USER_KHAIRUL,
} from "@trainos/contract";
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
} from "./oracleTransport";

/**
 * M09-S02 / M10-S06 / M06-S02 · engagements, attendance, the programme write —
 * through the seam.
 *
 * All seven of these had no `TrainOsClient` method at all before this lane
 * (NO-ADAPTER in the gap matrix): rejected by name inside the adapter's proxy
 * on Supabase. `getProgrammeDeliveries` is also exercised here even though its
 * adapter predates this lane, because this lane changed its wiring — it now
 * resolves the route's ref to a uuid before the view `.match()`, the same fix
 * `getOrganisationRelations` already carries, rather than a ref landing in
 * `v_programme_deliveries.programme_id` (a uuid column) and matching nothing.
 */

const FUNCTIONS: RpcHandlers = {
  list_engagements: (args, oracle) => oracle.listEngagements(toPageRequest(args)),
  get_engagement: (args, oracle) => oracle.getEngagement(String(args.p_id)),
  get_engagement_participants: (args, oracle) =>
    oracle.getEngagementParticipants(String(args.p_id), toPageRequest(args)),
  get_attendance: (args, oracle) => oracle.getAttendance(String(args.p_id), Number(args.p_day)),
  capture_attendance: (args, oracle) =>
    oracle.captureAttendance(
      String(args.p_id),
      Number(args.p_day),
      args.p_body as AttendanceCaptureRequest,
    ),
  export_attendance: (args, oracle) =>
    oracle.exportAttendance(String(args.p_id), String(args.p_format)),
  get_programme: (args, oracle) => oracle.getProgramme(String(args.p_id)),
  put_programme: (args, oracle) =>
    oracle.putProgramme(String(args.p_id), args.p_body as Record<string, unknown>),
};

const CAPTURE: AttendanceCaptureRequest = {
  participantRef: PARTICIPANT_AHMAD,
  session: "PM",
  present: true,
  method: "MANUAL",
};

describe("M09/M10/M06 · the two clients answer the training screens the same", () => {
  let oracle: Oracle;
  let fixtures: ApiClient;
  let rpc: ApiClient;

  beforeEach(() => {
    oracle = createFixtureClient({ latencyMs: 0, actorId: USER_KHAIRUL });
    fixtures = createFixtureClient({ latencyMs: 0, actorId: USER_KHAIRUL });
    __setTransportForTests(oracleTransport(oracle, FUNCTIONS));
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const calls: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["useEngagements", (client) => client.listEngagements()],
    ["useEngagement", (client) => client.getEngagement(ENGAGEMENT_AURORA)],
    ["useEngagementParticipants", (client) => client.getEngagementParticipants(ENGAGEMENT_AURORA)],
    ["useAttendance (day 2, open)", (client) => client.getAttendance(ENGAGEMENT_AURORA, 2)],
    ["useExportAttendance", (client) => client.exportAttendance(ENGAGEMENT_AURORA, "HRDC")],
    ["useProgramme", (client) => client.getProgramme(PROGRAMME_LEADING_CHANGE)],
  ];

  for (const [hook, call] of calls) {
    it(`${hook} — same value from both`, async () => {
      const [viaFixtures, viaRpc] = await Promise.all([call(fixtures), call(rpc)]);
      expect(viaRpc).toEqual(viaFixtures);
    });
  }

  /** M10-S06's primary: a capture on the open day lands the same mark on both. */
  it("useCaptureAttendance — same sheet from both", async () => {
    const [viaFixtures, viaRpc] = await Promise.all([
      fixtures.captureAttendance(ENGAGEMENT_AURORA, 2, CAPTURE),
      rpc.captureAttendance(ENGAGEMENT_AURORA, 2, CAPTURE),
    ]);
    expect(viaRpc).toEqual(viaFixtures);
  });

  /**
   * Day 1 is locked in the fixture world. The refusal — code, http, details —
   * is the story M10-S06 exists to tell, so both clients must carry it intact.
   */
  it("a capture on the locked day refuses identically, details intact", async () => {
    const locked: AttendanceCaptureRequest = { ...CAPTURE, session: "AM" };
    const fromFixtures = await fixtures
      .captureAttendance(ENGAGEMENT_AURORA, 1, locked)
      .catch((error: unknown) => error);
    const fromRpc = await rpc
      .captureAttendance(ENGAGEMENT_AURORA, 1, locked)
      .catch((error: unknown) => error);

    expect(isContractError(fromFixtures)).toBe(true);
    expect(isContractError(fromRpc)).toBe(true);
    if (!isContractError(fromFixtures) || !isContractError(fromRpc)) return;

    expect(fromRpc.code).toBe("ATTENDANCE_LOCKED");
    expect(fromRpc.http).toBe(fromFixtures.http);
    expect(fromRpc.details).toEqual(fromFixtures.details);
  });

  /** M06-S02's primary: ADMIN's catalogue edit lands the same record on both. */
  it("useEditProgramme — same record from both", async () => {
    const edit = { name: "Leading Through Change (rev.)" };
    const [viaFixtures, viaRpc] = await Promise.all([
      fixtures.putProgramme(PROGRAMME_LEADING_CHANGE, edit),
      rpc.putProgramme(PROGRAMME_LEADING_CHANGE, edit),
    ]);
    expect(viaRpc).toEqual(viaFixtures);
  });
});

/** The state M09/M10/M06 are in on the hosted project until this pack lands. */
describe("M09/M10/M06 · an undeployed environment", () => {
  let rpc: ApiClient;

  beforeEach(() => {
    __setTransportForTests(unexposedSchemaTransport());
    rpc = createRpcApiClient(createRpcClient());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  const reads: [string, (client: ApiClient) => Promise<unknown>][] = [
    ["the engagement list", (client) => client.listEngagements()],
    ["an engagement", (client) => client.getEngagement(ENGAGEMENT_AURORA)],
    ["an attendance sheet", (client) => client.getAttendance(ENGAGEMENT_AURORA, 1)],
  ];

  for (const [what, call] of reads) {
    it(`${what} reads as not deployed`, async () => {
      const thrown = await call(rpc).catch((error: unknown) => error);
      expect(isNotDeployed(thrown)).toBe(true);
    });
  }
});
