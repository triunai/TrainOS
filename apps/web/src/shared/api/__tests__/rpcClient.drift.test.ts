import { afterEach, describe, expect, it } from "vitest";

import { createRpcClient } from "../rpcClient";
import { __setTransportForTests } from "../supabase";
import type { RpcTransport, TransportResponse } from "../transport";
import { okEnvelope } from "./oracleTransport";

/**
 * The view reads, against what the database actually keys and grants.
 *
 * `v_organisation_relations` and `v_contact_channel_consents` are keyed by a
 * UUID column, but every caller holds a REF — the `:organisationId` route
 * segment, `contact.organisationRef`. A ref in a uuid `.match()` is 22P02, which
 * reads as a server fault. And a view whose body calls a function the invoker
 * cannot execute answers 42501, which read as a logged-out session.
 *
 * The transport here is a recorder, not the oracle: what is under test is what
 * goes ON THE WIRE, which a round trip through the fixture client would hide.
 */

const ORG_UUID = "7d1c2a4e-1111-4222-8333-944455556666";
const CONTACT_UUID = "0b9f3e2d-aaaa-4bbb-8ccc-dddd11112222";
const PROGRAMME_UUID = "5c8e1f3a-2222-4111-9aaa-bbbb33334444";

interface Recorded {
  rpc: { name: string; args: Record<string, unknown> }[];
  match: { table: string; filter: Record<string, string> }[];
}

function recorder(
  answers: {
    rpc?: (name: string) => TransportResponse;
    view?: (table: string) => TransportResponse;
  } = {},
): { transport: RpcTransport; recorded: Recorded } {
  const recorded: Recorded = { rpc: [], match: [] };
  const empty: TransportResponse = { data: [], error: null };

  const transport: RpcTransport = {
    rpc: (name, args) => {
      recorded.rpc.push({ name, args });
      return Promise.resolve(answers.rpc?.(name) ?? okEnvelope({}));
    },
    from: (table) => ({
      select: () =>
        Object.assign(Promise.resolve(answers.view?.(table) ?? empty), {
          match: (filter: Record<string, string>) => {
            recorded.match.push({ table, filter });
            return Promise.resolve(answers.view?.(table) ?? empty);
          },
        }),
    }),
  };

  return { transport, recorded };
}

const record = (id: string) => okEnvelope({ id, ref: "unused" });

afterEach(() => {
  __setTransportForTests(null);
});

describe("the uuid-keyed view reads resolve a ref first", () => {
  it("organisation relations match on the organisation's id, not the route's ref", async () => {
    const { transport, recorded } = recorder({
      rpc: () => record(ORG_UUID),
      view: () => ({ data: [{ organisationId: ORG_UUID }], error: null }),
    });
    __setTransportForTests(transport);

    const result = await createRpcClient().getOrganisationRelations("ORG-0042");

    expect(result.error).toBeNull();
    expect(recorded.rpc).toEqual([{ name: "get_organisation", args: { p_id: "ORG-0042" } }]);
    expect(recorded.match).toEqual([
      { table: "v_organisation_relations", filter: { organisation_id: ORG_UUID } },
    ]);
  });

  it("a uuid goes straight to the view with no extra round trip", async () => {
    const { transport, recorded } = recorder({
      view: () => ({ data: [{ organisationId: ORG_UUID }], error: null }),
    });
    __setTransportForTests(transport);

    await createRpcClient().getOrganisationRelations(ORG_UUID);

    expect(recorded.rpc).toEqual([]);
    expect(recorded.match).toEqual([
      { table: "v_organisation_relations", filter: { organisation_id: ORG_UUID } },
    ]);
  });

  it("contact consent matches on the contact's id", async () => {
    const { transport, recorded } = recorder({ rpc: () => record(CONTACT_UUID) });
    __setTransportForTests(transport);

    await createRpcClient().getContactConsent("CON-0007");

    expect(recorded.rpc).toEqual([{ name: "get_contact", args: { p_id: "CON-0007" } }]);
    expect(recorded.match).toEqual([
      { table: "v_contact_channel_consents", filter: { contact_id: CONTACT_UUID } },
    ]);
  });

  it("programme deliveries match on the programme's id", async () => {
    const { transport, recorded } = recorder({ rpc: () => record(PROGRAMME_UUID) });
    __setTransportForTests(transport);

    await createRpcClient().getProgrammeDeliveries("PRG-0007");

    expect(recorded.rpc).toEqual([{ name: "get_programme", args: { p_id: "PRG-0007" } }]);
    expect(recorded.match).toEqual([
      { table: "v_programme_deliveries", filter: { programme_id: PROGRAMME_UUID } },
    ]);
  });

  it("a ref that does not resolve fails as the record read failed, without reading the view", async () => {
    const { transport, recorded } = recorder({
      rpc: () => ({ data: { success: false, error: { code: "NOT_FOUND" } }, error: null }),
    });
    __setTransportForTests(transport);

    const result = await createRpcClient().getOrganisationRelations("ORG-9999");

    expect(result.error).toMatchObject({ kind: "domain", code: "NOT_FOUND" });
    expect(recorded.match).toEqual([]);
  });
});

describe("a privilege refusal on a view read", () => {
  const refused: TransportResponse = {
    data: null,
    error: { message: "permission denied for function _money", code: "42501" },
  };

  it("reads as not deployed, because the grant has not shipped, not as a signed-out session", async () => {
    const { transport } = recorder({ view: () => refused });
    __setTransportForTests(transport);

    const client = createRpcClient();
    for (const result of [await client.listBudgets(), await client.listAiTiers()]) {
      expect(result.error).toMatchObject({ kind: "transport", code: "NOT_DEPLOYED" });
    }
  });

  it("leaves an RPC's 42501 as UNAUTHENTICATED, which sign-in reads as 'not linked'", async () => {
    const { transport } = recorder({ rpc: () => refused });
    __setTransportForTests(transport);

    const result = await createRpcClient().me();

    expect(result.error).toMatchObject({ kind: "transport", code: "UNAUTHENTICATED" });
  });
});
