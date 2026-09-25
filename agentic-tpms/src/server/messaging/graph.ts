/**
 * The Meta Graph API seam (WhatsApp Cloud API sends, Lead Ads field fetches).
 * One place owns the base URL, the timeout and the error shape, and tests
 * swap the fetch implementation here instead of patching globals.
 */
export const GRAPH_BASE_URL = "https://graph.facebook.com/v20.0";
const TIMEOUT_MS = 10_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike | undefined;

export function setGraphFetchForTests(fn: FetchLike | undefined): void {
  fetchImpl = fn;
}

export class GraphError extends Error {
  readonly status: number;
  readonly code: number | null;
  constructor(status: number, message: string, code: number | null) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
  }
}

/** Access tokens travel in the Authorization header, never the URL, so they cannot land in a proxy log. */
export async function graphRequest<T>(
  path: string,
  opts: { method?: "GET" | "POST"; token: string; body?: unknown; query?: Record<string, string> },
): Promise<T> {
  const url = new URL(`${GRAPH_BASE_URL}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const doFetch = fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const response = await doFetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      authorization: `Bearer ${opts.token}`,
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const err = (parsed as { error?: { message?: string; code?: number } } | null)?.error;
    const message = (err?.message ?? text.slice(0, 300)) || `HTTP ${response.status}`;
    throw new GraphError(response.status, message.split(opts.token).join("[token]"), err?.code ?? null);
  }
  return parsed as T;
}
