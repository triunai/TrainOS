/**
 * The narrow port the RPC client talks to.
 *
 * supabase-js satisfies it and so does a test double, WITHOUT a cast. That
 * matters more than it looks: E2 forbids the double cast anywhere under
 * `shared/api`, tests included, and it forbids it for a good reason — asserting
 * a mock into a client type is how a test ends up proving something about a
 * shape the real transport never had. A port both can satisfy structurally
 * means the conformance suite exercises the SAME code path production does.
 *
 * Only what the client actually uses is declared: `rpc` for the 80 RPC
 * endpoints, `from().select()` for the 22 §8 view reads.
 */

/** What a PostgREST call resolves to. */
export interface TransportResponse {
  data: unknown;
  error: TransportFailure | null;
}

/**
 * The `PostgrestError` fields this client reads.
 *
 * `code` is the SQLSTATE or the PostgREST code and is the ONLY thing errors are
 * classified on. `details` carries the jsonb a `RAISE … USING DETAIL` put
 * there, which is where a domain error code lives.
 */
export interface TransportFailure {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** A `.select()` that can still be narrowed, or awaited as it stands. */
export interface SelectTransport extends PromiseLike<TransportResponse> {
  match(filter: Record<string, string>): PromiseLike<TransportResponse>;
}

export interface FromTransport {
  select(columns: string): SelectTransport;
}

export interface SchemaTransport {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<TransportResponse>;
  from(table: string): FromTransport;
}

/** One schema-scoped PostgREST surface. `core`, in every case here. */
export type RpcTransport = SchemaTransport;
