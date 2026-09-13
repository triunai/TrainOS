import type { ActionRequest, Actor, PageRequest } from "@trainos/contract";
import { ContractError, createFixtureClient, isContractError } from "@trainos/fixtures";

import type { FromTransport, RpcTransport, TransportResponse } from "../transport";

/**
 * The conformance harness: PostgREST, played by the fixture oracle.
 *
 * ONE of these, shared by the golden-path suite and by the three per-feature
 * suites. A second copy would be the divergence CLAUDE.md calls a defect, and
 * it would be a dangerous one — a per-feature harness that wrapped the envelope
 * slightly differently would prove that the feature agrees with ITS OWN mock
 * rather than with the oracle.
 *
 * WHAT A SUITE BUILT ON THIS PROVES. The double answers each RPC by asking the
 * oracle and wrapping the answer the way `app.ok()` would, and refuses the way
 * `RAISE … USING ERRCODE = 'TRNOS'` would. The two clients therefore differ
 * only by the envelope round trip: serialise, unwrap, classify, adapt. If the
 * unwrap rule mishandles a shape, if a domain refusal comes back classified as
 * transport, or if an adapter drops a field or an argument, the two answers
 * stop matching and the case fails — with no database anywhere in the loop.
 *
 * WHAT IT CANNOT PROVE. That the SQL exists, that it returns this shape, or
 * that RLS lets the caller see it. Those need a database and belong to the
 * migrations lane. This pins the seam, not the server.
 */

export type Oracle = ReturnType<typeof createFixtureClient>;
export type Args = Record<string, unknown>;

/** How one RPC name is answered, from the oracle's own endpoint. */
export type RpcHandlers = Record<string, (args: Args, oracle: Oracle) => Promise<unknown>>;

/** How one §8 view name is answered. Rows only — the client builds the page. */
export type ViewHandlers = Record<string, (oracle: Oracle) => Promise<unknown[]>>;

/**
 * `app.ok()`, in TypeScript: exactly `{success, data}` and never a third key.
 *
 * Written out rather than imported so a suite states the envelope it expects
 * independently of the code under test. A change to the unwrap rule that also
 * changed this helper would prove nothing.
 */
export const okEnvelope = (data: unknown): TransportResponse => ({
  data: { success: true, data },
  error: null,
});

/**
 * A `RAISE EXCEPTION … USING ERRCODE = 'TRNOS', DETAIL = '<jsonb>'` as
 * supabase-js would surface it.
 *
 * This is the shape 011 actually produces — it refuses by raising, not by
 * returning `app.err()`. Getting this double wrong in the other direction is
 * how a policy refusal ends up classified as a transport failure with a retry
 * button on it.
 */
export const raised = (error: ContractError): TransportResponse => ({
  data: null,
  error: {
    message: error.message,
    code: "TRNOS",
    details: JSON.stringify({
      code: error.code,
      ...(error.details ?? {}),
      ...(error.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: error.approvalRequestId }),
    }),
  },
});

/**
 * The §1 query grammar, back out of the RPC arguments the client built.
 *
 * All four parts, not just the page size. `p_view` is the one that earns its
 * keep: the enquiry inbox's pill tabs are saved views, and an oracle that never
 * received the view id would answer the unfiltered queue while the RPC client
 * asked for a filtered one — two different questions, compared as if they were
 * one, and a green test over a dropped argument.
 */
export function toPageRequest(args: Args): PageRequest {
  const request: PageRequest = {};

  const filter = args.p_filter;
  if (Array.isArray(filter) && filter.length > 0) request.filter = filter as PageRequest["filter"];

  if (typeof args.p_sort === "string") request.sort = args.p_sort;
  if (typeof args.p_view === "string") request.view = args.p_view;

  const page = args.p_page;
  if (typeof page === "object" && page !== null) {
    const { size, cursor } = page as { size?: unknown; cursor?: unknown };
    const shape: NonNullable<PageRequest["page"]> = {};
    if (typeof size === "number") shape.size = size;
    if (typeof cursor === "string") shape.cursor = cursor;
    if (Object.keys(shape).length > 0) request.page = shape;
  }

  return request;
}

/**
 * `core.perform_action`, played by the oracle.
 *
 * Shared rather than restated per feature: every governed write in the app goes
 * through this one endpoint, and a per-suite copy that read `p_payload` or
 * `p_idempotency_key` slightly differently would let an argument the client
 * stopped sending pass unnoticed in two suites out of three.
 *
 * The two casts are the transport boundary being honest: these values arrived
 * as `jsonb` and the compiler knows nothing about them. Narrowing is what the
 * SQL function does, and a double cast — which E2 forbids — is not needed for
 * either.
 */
export const performActionHandler = (args: Args, oracle: Oracle): Promise<unknown> =>
  oracle.performAction(
    {
      type: args.p_type as ActionRequest["type"],
      targetRef: String(args.p_target_ref),
      payload: args.p_payload as Record<string, unknown>,
      requestedBy: args.p_requested_by as Actor,
    },
    { idempotencyKey: String(args.p_idempotency_key) },
  );

/** `a_snake_key` as the contract spells it, so a `.match()` filter lands. */
const camel = (key: string): string => key.replace(/_([a-z])/g, (_all, next) => next.toUpperCase());

/**
 * A PostgREST answer for a name nothing serves.
 *
 * `PGRST202` for a function, `PGRST205` for a table — the two codes the client
 * classifies as `NOT_DEPLOYED`. Serving an empty result instead would be the
 * failure the classification exists to prevent: a screen drawing "no records"
 * over a database that has never heard of the table.
 */
const missing = (code: "PGRST202" | "PGRST205", what: string): TransportResponse => ({
  data: null,
  error: { message: `Could not find ${what}`, code },
});

/**
 * The `core` schema, standing in for PostgREST.
 *
 * It satisfies `RpcTransport` structurally — no cast, which is what E2 asks for
 * and also what makes a suite built on it a test of the real code path rather
 * than of an asserted shape.
 */
export function oracleTransport(
  oracle: Oracle,
  rpcs: RpcHandlers,
  views: ViewHandlers = {},
): RpcTransport {
  return {
    rpc: async (name, args) => {
      const serve = rpcs[name];
      if (serve === undefined) return missing("PGRST202", `the function core.${name}`);
      try {
        return okEnvelope(await serve(args, oracle));
      } catch (thrown) {
        if (isContractError(thrown)) return raised(thrown);
        throw thrown;
      }
    },

    from: (table): FromTransport => ({
      select: () => {
        const rows = async (filter?: Record<string, string>): Promise<TransportResponse> => {
          const serve = views[table];
          if (serve === undefined) {
            return missing("PGRST205", `the table 'core.${table}' in the schema cache`);
          }
          try {
            const all = await serve(oracle);
            if (filter === undefined) return { data: all, error: null };
            const matched = all.filter((row) =>
              Object.entries(filter).every(
                ([key, value]) => (row as Record<string, unknown>)[camel(key)] === value,
              ),
            );
            return { data: matched, error: null };
          } catch (thrown) {
            if (isContractError(thrown)) return raised(thrown);
            throw thrown;
          }
        };

        return Object.assign(rows(), { match: (filter: Record<string, string>) => rows(filter) });
      },
    }),
  };
}

/**
 * A transport that answers everything the way the hosted project does today.
 *
 * `PGRST106` — `core` is not an exposed schema — is what every call in the app
 * currently gets back, measured rather than assumed. A feature suite uses it to
 * prove its screens degrade to the "not deployed" state rather than to an error
 * with a retry button on a configuration setting.
 */
export function unexposedSchemaTransport(): RpcTransport {
  const refusal: TransportResponse = {
    data: null,
    error: {
      message: "Invalid schema: core",
      code: "PGRST106",
      hint: "Only the following schemas are exposed: public, graphql_public",
    },
  };
  const answer = () => Promise.resolve(refusal);

  return {
    rpc: answer,
    from: () => ({ select: () => Object.assign(answer(), { match: answer }) }),
  };
}
