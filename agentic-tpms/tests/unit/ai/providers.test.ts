import { afterEach, describe, expect, it } from "vitest";
import { acceptsTemperature, anthropicChat } from "@/server/ai/providers/anthropic";
import { openAiCompatibleChat } from "@/server/ai/providers/openai-compatible";
import { openAiEmbeddings } from "@/server/ai/providers/embeddings";
import { ProviderError, isRequestDefect } from "@/server/ai/providers/types";
import { anthropicReply, hangingResponse, jsonResponse, openAiReply, resetFetch, stubFetch } from "./fetch-stub";

afterEach(resetFetch);

const KEY = { apiKey: "sk-ant-test-0000000000000000abcd" };

describe("anthropic adapter", () => {
  it("sends the Messages API shape: headers, system as a top-level field, no temperature for Sonnet 5", async () => {
    const calls = stubFetch(() => jsonResponse(200, anthropicReply("hello")));
    await anthropicChat(KEY, {
      model: "claude-sonnet-5",
      system: "You write warm, concise emails.",
      messages: [{ role: "user", content: "Draft a thank-you note." }],
      maxTokens: 512,
      temperature: 0.4,
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe(KEY.apiKey);
    expect(call.headers["anthropic-version"]).toBe("2023-06-01");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers.authorization).toBeUndefined();
    expect(call.body).toEqual({
      model: "claude-sonnet-5",
      max_tokens: 512,
      system: "You write warm, concise emails.",
      messages: [{ role: "user", content: "Draft a thank-you note." }],
    });
  });

  it("keeps temperature for models that still accept sampling, drops it for those that 400", async () => {
    const calls = stubFetch(() => jsonResponse(200, anthropicReply("ok", undefined, "claude-haiku-4-5")));
    await anthropicChat(KEY, { model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }], maxTokens: 8, temperature: 0.2 });
    expect(calls[0].body.temperature).toBe(0.2);
    expect(calls[0].body.system).toBeUndefined();

    for (const model of ["claude-sonnet-5", "claude-opus-5", "claude-opus-5-5", "claude-fable-5-1", "claude-fable-5", "anthropic/claude-sonnet-5"]) {
      expect(acceptsTemperature(model), model).toBe(false);
    }
    expect(acceptsTemperature("claude-haiku-4-5")).toBe(true);
  });

  it("parses text across blocks, skips thinking blocks, and prices usage with cache reads added back into input", async () => {
    stubFetch(() =>
      jsonResponse(200, {
        model: "claude-sonnet-5",
        stop_reason: "end_turn",
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "Hello " },
          { type: "text", text: "there" },
        ],
        usage: { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 4_000, cache_creation_input_tokens: 0 },
      }),
    );
    const result = await anthropicChat(KEY, { model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }], maxTokens: 600 });
    expect(result.text).toBe("Hello there");
    expect(result.provider).toBe("anthropic");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({ in: 5_000, out: 500, cacheRead: 4_000 });
    // 1000 fresh × $2 + 4000 cached × $0.20 + 500 out × $10, per million
    expect(result.costUsd).toBeCloseTo((1_000 * 2 + 4_000 * 0.2 + 500 * 10) / 1_000_000, 12);
    expect(result.costEstimated).toBe(true);
  });

  it("classifies failures: 503/529/429 are retryable, 400/401 are not, and a 400 is a request defect", async () => {
    for (const [status, retryable] of [
      [503, true],
      [529, true],
      [429, true],
      [408, true],
      [400, false],
      [401, false],
      [403, false],
      [404, false],
    ] as const) {
      stubFetch(() => jsonResponse(status, { type: "error", error: { type: "x", message: `status ${status}` } }));
      const error = await anthropicChat(KEY, { model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }], maxTokens: 8 }).catch((e) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.status).toBe(status);
      expect(error.retryable, String(status)).toBe(retryable);
      expect(error.message).toContain(`status ${status}`);
    }
    expect(isRequestDefect(new ProviderError("anthropic", "HTTP 400: bad field", { status: 400 }))).toBe(true);
    expect(isRequestDefect(new ProviderError("anthropic", "HTTP 400: Your credit balance is too low", { status: 400 }))).toBe(false);
    expect(isRequestDefect(new ProviderError("anthropic", "HTTP 401: invalid x-api-key", { status: 401 }))).toBe(false);
  });

  it("a network failure is a retryable ProviderError with no status", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const error = await anthropicChat(KEY, { model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }], maxTokens: 8 }).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.status).toBeUndefined();
    expect(error.retryable).toBe(true);
  });

  it("honours a custom base URL", async () => {
    const calls = stubFetch(() => jsonResponse(200, anthropicReply("ok")));
    await anthropicChat({ ...KEY, baseUrl: "https://gateway.example.my/anthropic/" }, { model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }], maxTokens: 8 });
    expect(calls[0].url).toBe("https://gateway.example.my/anthropic/v1/messages");
  });
});

describe("openai-compatible adapter", () => {
  it("sends system as the first message, Bearer auth, and response_format when JSON is requested", async () => {
    const calls = stubFetch(() => jsonResponse(200, openAiReply('{"ok":true}')));
    await openAiCompatibleChat(
      "deepseek",
      { apiKey: "sk-deepseek-00000000000000001234" },
      { model: "deepseek-chat", system: "Be terse.", messages: [{ role: "user", content: "Classify." }], maxTokens: 64, json: true },
    );
    const [call] = calls;
    expect(call.url).toBe("https://api.deepseek.com/chat/completions");
    expect(call.headers.authorization).toBe("Bearer sk-deepseek-00000000000000001234");
    expect(call.body).toEqual({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Classify." },
      ],
      max_tokens: 64,
      response_format: { type: "json_object" },
    });
  });

  it("omits response_format for plain text and uses each preset's base URL", async () => {
    const calls = stubFetch(() => jsonResponse(200, openAiReply("hi")));
    const req = { model: "m", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 8 };
    await openAiCompatibleChat("gemini", { apiKey: "AIzaSyTest00000000000000" }, req);
    await openAiCompatibleChat("openrouter", { apiKey: "sk-or-v1-000000000000" }, req);
    await openAiCompatibleChat("openai-compatible", { apiKey: "sk-000000000000", baseUrl: "http://localhost:8000/v1/" }, req);
    await openAiCompatibleChat("openai-compatible", { apiKey: "sk-000000000000" }, req);
    expect(calls.map((c) => c.url)).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions",
      "http://localhost:8000/v1/chat/completions",
      "https://api.openai.com/v1/chat/completions",
    ]);
    expect(calls[0].body.response_format).toBeUndefined();
    // OpenRouter only reports cost when usage accounting is requested.
    expect(calls[1].body.usage).toEqual({ include: true });
    expect(calls[1].headers["X-Title"]).toBe("agentic-tpms");
    expect(calls[0].body.usage).toBeUndefined();
  });

  it("OpenRouter's reported usage.cost wins over the price table and is marked not estimated", async () => {
    stubFetch(() =>
      jsonResponse(
        200,
        openAiReply("ok", { prompt_tokens: 2_000, completion_tokens: 300, cost: 0.0123, prompt_tokens_details: { cached_tokens: 500 } }, "anthropic/claude-sonnet-5"),
      ),
    );
    const result = await openAiCompatibleChat("openrouter", { apiKey: "sk-or-v1-000000000000" }, {
      model: "anthropic/claude-sonnet-5",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 400,
    });
    expect(result.costUsd).toBe(0.0123);
    expect(result.costEstimated).toBe(false);
    expect(result.usage).toEqual({ in: 2_000, out: 300, cacheRead: 500 });
    expect(result.provider).toBe("openrouter");
  });

  it("without a reported cost, prices by the table; DeepSeek's prompt_cache_hit_tokens are billed at the cache rate", async () => {
    stubFetch(() =>
      jsonResponse(200, openAiReply("ok", { prompt_tokens: 10_000, completion_tokens: 1_000, prompt_cache_hit_tokens: 8_000, prompt_cache_miss_tokens: 2_000 }, "deepseek-chat")),
    );
    const result = await openAiCompatibleChat("deepseek", { apiKey: "sk-000000000000" }, { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }], maxTokens: 1_000 });
    expect(result.usage).toEqual({ in: 10_000, out: 1_000, cacheRead: 8_000 });
    expect(result.costUsd).toBeCloseTo((2_000 * 0.28 + 8_000 * 0.028 + 1_000 * 0.42) / 1_000_000, 12);
    expect(result.costEstimated).toBe(true);
    expect(result.stopReason).toBe("end_turn");
  });

  it("reads content sent as an array of text parts and maps finish reasons", async () => {
    stubFetch(() =>
      jsonResponse(200, {
        choices: [{ finish_reason: "length", message: { content: [{ type: "text", text: "part one, " }, { type: "text", text: "part two" }] } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
    const result = await openAiCompatibleChat("openai-compatible", { apiKey: "sk-000000000000" }, { model: "x", messages: [{ role: "user", content: "hi" }], maxTokens: 8 });
    expect(result.text).toBe("part one, part two");
    expect(result.stopReason).toBe("max_tokens");
  });

  it("times out a stalled vendor with a retryable error", async () => {
    stubFetch((_call, _i, signal) => hangingResponse(signal));
    const started = Date.now();
    const error = await openAiCompatibleChat("gemini", { apiKey: "AIzaSyTest00000000000000" }, { model: "gemini-2.5-flash-lite", messages: [{ role: "user", content: "hi" }], maxTokens: 8 }, { timeoutMs: 50 }).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toMatch(/timed out after 50ms/);
    expect(error.retryable).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("embeddings adapter", () => {
  it("posts {model, input, dimensions} and returns vectors in index order", async () => {
    const v = (x: number) => Array.from({ length: 4 }, (_, i) => (i === x ? 1 : 0));
    const calls = stubFetch(() =>
      jsonResponse(200, {
        data: [
          { index: 1, embedding: v(1) },
          { index: 0, embedding: v(0) },
        ],
        usage: { prompt_tokens: 12 },
      }),
    );
    const result = await openAiEmbeddings("openai-compatible", { apiKey: "sk-000000000000" }, "text-embedding-3-small", ["a", "b"], { dimensions: 4 });
    expect(calls[0].url).toBe("https://api.openai.com/v1/embeddings");
    expect(calls[0].body).toEqual({ model: "text-embedding-3-small", input: ["a", "b"], dimensions: 4 });
    expect(result.vectors).toEqual([v(0), v(1)]);
    expect(result.costUsd).toBeCloseTo((12 * 0.02) / 1_000_000, 15);
  });

  it("refuses a reply of the wrong width as a non-retryable defect", async () => {
    stubFetch(() => jsonResponse(200, { data: [{ index: 0, embedding: [1, 0, 0] }], usage: { prompt_tokens: 1 } }));
    const error = await openAiEmbeddings("openai-compatible", { apiKey: "sk-000000000000" }, "m", ["a"], { dimensions: 4 }).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(false);
    expect(isRequestDefect(error)).toBe(true);
  });
});
