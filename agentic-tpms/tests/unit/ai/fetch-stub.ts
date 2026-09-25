import { resetFetch, setFetchForTests } from "@/server/ai/providers";

/**
 * A recording fetch for the AI layer's test seam. Every provider call goes
 * through `setFetchForTests`, so no test ever reaches a real vendor, and the
 * global `fetch` other lanes' tests use is left alone.
 */
export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export type Responder = (call: RecordedCall, index: number, signal: AbortSignal | undefined) => Response | Promise<Response>;

export function stubFetch(responder: Responder): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(input),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    };
    calls.push(call);
    return responder(call, calls.length - 1, init?.signal ?? undefined);
  }) as typeof fetch;
  setFetchForTests(fn);
  return calls;
}

/** A fetch that fails the test if anything reaches the network layer. */
export function forbidFetch(): RecordedCall[] {
  return stubFetch((call) => {
    throw new Error(`unexpected provider call to ${call.url}`);
  });
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch that never answers until its signal aborts, as a stalled vendor would. */
export function hangingResponse(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), { once: true });
  });
}

export function openAiReply(content: string, usage: Record<string, unknown> = { prompt_tokens: 100, completion_tokens: 20 }, model = "stub-model") {
  return { model, choices: [{ finish_reason: "stop", message: { role: "assistant", content } }], usage };
}

export function anthropicReply(text: string, usage: Record<string, unknown> = { input_tokens: 100, output_tokens: 20 }, model = "claude-sonnet-5") {
  return { model, type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text }], usage };
}

export { resetFetch };
