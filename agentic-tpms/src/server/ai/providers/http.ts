import { ProviderError, type ProviderId } from "./types";

/**
 * The one place the AI layer touches the network.
 *
 * Every adapter and the embeddings client post through `postJson`, so the
 * timeout, the error classification and the test seam exist once. Tests swap
 * `fetch` here rather than patching the global, which other lanes' tests share.
 */
let fetchOverride: typeof fetch | undefined;

export function setFetchForTests(fn: typeof fetch): void {
  fetchOverride = fn;
}

export function resetFetch(): void {
  fetchOverride = undefined;
}

function currentFetch(): typeof fetch {
  return fetchOverride ?? globalThis.fetch;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

export interface JsonResponse<T> {
  status: number;
  body: T | undefined;
  latencyMs: number;
}

/**
 * POST a JSON body and read a JSON reply. A non-2xx answer becomes a
 * ProviderError carrying the status (the router reads `retryable` off it);
 * no answer at all — network failure, abort, timeout — is a ProviderError with
 * no status, which classifies as retryable.
 *
 * The timeout covers reading the body too: a server that sends headers and
 * then stalls is as stuck as one that never answers.
 */
export async function postJson<T>(
  provider: ProviderId,
  url: string,
  init: { headers: Record<string, string>; body: unknown; timeoutMs?: number; signal?: AbortSignal },
): Promise<JsonResponse<T>> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const started = Date.now();
  try {
    const response = await currentFetch()(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...init.headers },
      body: JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const body = parseJson<T & { error?: unknown }>(text);
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      throw new ProviderError(provider, `HTTP ${response.status}: ${errorDetail(body, text, response.statusText)}`, {
        status: response.status,
      });
    }
    return { status: response.status, body, latencyMs };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const reason = timedOut
      ? `timed out after ${timeoutMs}ms`
      : init.signal?.aborted
        ? "aborted by caller"
        : error instanceof Error
          ? error.message
          : String(error);
    throw new ProviderError(provider, `Request failed: ${reason}`);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function parseJson<T>(text: string): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Anthropic: `{error:{message}}`. OpenAI family: the same, or `{error:"..."}`, or a bare `{message}`. */
function errorDetail(body: unknown, raw: string, statusText: string): string {
  if (body && typeof body === "object") {
    const record = body as { error?: unknown; message?: unknown };
    if (typeof record.error === "string") return record.error;
    if (record.error && typeof record.error === "object") {
      const message = (record.error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return (raw || statusText || "no body").slice(0, 300);
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
