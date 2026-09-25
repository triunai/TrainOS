import type { ZodType } from "zod";
import { type ResolvedCredential, resolveCredentials, scrubSecret } from "./keys";
import { usdToMyr } from "./pricing";
import { type ChatMessage, type ChatResult, type ProviderId, ProviderError, callChat, isRequestDefect } from "./providers";
import { budgetState, monthToDateSpend, recordUsage } from "./spend";
import { getTierConfig } from "./tiers";
import type { LlmTier, Provenance, RunTierInput, RunTierResult } from "./types";

export { setFetchForTests, resetFetch } from "./providers";

/**
 * The BYOK tier router — the real `runTier`.
 *
 * Candidates are the tier's primary route, then each fallback route, each
 * paired with every usable credential for its vendor (stored keys first, then
 * the environment). The first candidate to return a valid output wins. When
 * none does, the caller's deterministic `template()` runs instead, and the
 * provenance says why. Provider trouble never reaches the caller as an
 * exception: a missing key, a spent budget, an outage and an unusable answer
 * are all ordinary outcomes of an agent call, and the business flow above
 * must keep moving on the template.
 *
 * Every model call writes one `llm_usage` row (OK or ERROR) and a fallback
 * writes one more (FALLBACK_TEMPLATE or BUDGET_BLOCKED), so the Usage page
 * accounts for the attempts as well as the answer.
 */
export type FallbackReason = "NO_PROVIDER_CONFIGURED" | "BUDGET_EXHAUSTED" | "PROVIDER_ERROR" | "SCHEMA_INVALID";

/** L1 sits in front of interactive flows; a classifier that takes longer than this is not worth waiting for. */
export const TIER_TIMEOUT_MS: Readonly<Record<LlmTier, number>> = { L1: 4_000, L3: 60_000, L4: 60_000 };

export const TEMPLATE_PROVIDER = "template";
export const TEMPLATE_MODEL = "deterministic-template";

const JSON_INSTRUCTION = "Respond with a single JSON object and nothing else: no prose before or after it, no markdown, no code fences.";

interface Candidate {
  provider: ProviderId;
  model: string;
  credential: ResolvedCredential;
}

interface CallContext<T> {
  input: RunTierInput<T>;
  runId: string | null;
  started: number;
  /** MYR spent by every call this invocation made, answer or not. */
  spentMyr: number;
}

type Attempt<T> =
  | { kind: "ok"; value: T }
  | { kind: "invalid"; error: string }
  | { kind: "error"; error: ProviderError };

/**
 * @param opts.runId links the usage rows to an `agent_runs` row, when the
 *   caller opened one with `startAgentRun`.
 */
export async function runTier<T>(input: RunTierInput<T>, opts: { runId?: string | null } = {}): Promise<RunTierResult<T>> {
  const ctx: CallContext<T> = { input, runId: opts.runId ?? null, started: Date.now(), spentMyr: 0 };
  const config = await getTierConfig(input.tier);
  if (!config.enabled) return fallback(ctx, "NO_PROVIDER_CONFIGURED", `tier ${input.tier} is disabled in Settings`);

  const candidates: Candidate[] = [];
  for (const route of [{ provider: config.provider, model: config.model }, ...config.fallback]) {
    for (const credential of await resolveCredentials(route.provider, input.tier)) {
      candidates.push({ provider: route.provider, model: route.model, credential });
    }
  }
  if (candidates.length === 0) {
    return fallback(ctx, "NO_PROVIDER_CONFIGURED", `no key for ${[config.provider, ...config.fallback.map((r) => r.provider)].join(", ")}`);
  }

  // Asked before any spend, never after: a tier that has blown its cap must
  // not make one more call to find out.
  const tierSpend = await monthToDateSpend({ tier: input.tier });
  if (budgetState(tierSpend, config.monthlyCapMyr) === "PAUSED") {
    return fallback(ctx, "BUDGET_EXHAUSTED", `tier ${input.tier} has spent RM ${tierSpend} of its RM ${config.monthlyCapMyr} monthly cap`);
  }

  const maxTokens = input.maxTokens ?? config.maxTokens;
  const system = input.json ? [input.system, JSON_INSTRUCTION].filter(Boolean).join("\n\n") : input.system;
  const failures: string[] = [];
  let keyCapped = 0;

  for (const candidate of candidates) {
    const { credential } = candidate;
    if (credential.keyId && credential.monthlyCapMyr !== null) {
      const keySpend = await monthToDateSpend({ keyId: credential.keyId });
      if (budgetState(keySpend, credential.monthlyCapMyr) === "PAUSED") {
        keyCapped += 1;
        continue;
      }
    }

    const outcome = await attempt(ctx, candidate, system, maxTokens);
    if (outcome.kind === "ok") {
      const provenance: Provenance = {
        tier: input.tier,
        agent: input.agent,
        mode: "LLM",
        provider: candidate.provider,
        model: candidate.model,
        costMyr: round8(ctx.spentMyr),
        latencyMs: Date.now() - ctx.started,
        ...(ctx.runId ? { runId: ctx.runId } : {}),
      };
      return { output: outcome.value, provenance };
    }
    if (outcome.kind === "invalid") {
      // The next routes serve the same model through another door; it would
      // fail the same schema the same way, at twice the price.
      return fallback(ctx, "SCHEMA_INVALID", outcome.error);
    }
    failures.push(`${candidate.provider}/${candidate.model}: ${scrubSecret(outcome.error.message, credential.apiKey)}`);
    if (isRequestDefect(outcome.error)) break;
  }

  if (failures.length > 0) return fallback(ctx, "PROVIDER_ERROR", failures.join(" | "));
  return fallback(ctx, "BUDGET_EXHAUSTED", `${keyCapped} key(s) on tier ${input.tier} are over their own monthly cap`);
}

/** One candidate: the call, validation, and at most one repair round that shows the model its error. */
async function attempt<T>(ctx: CallContext<T>, candidate: Candidate, system: string, maxTokens: number): Promise<Attempt<T>> {
  const { input } = ctx;
  const messages: ChatMessage[] = [{ role: "user", content: input.prompt }];
  for (let round = 0; ; round += 1) {
    const callStarted = Date.now();
    let result: ChatResult;
    try {
      result = await callChat(
        candidate.provider,
        candidate.credential,
        { model: candidate.model, system: system || undefined, messages, maxTokens, json: Boolean(input.json) },
        { timeoutMs: TIER_TIMEOUT_MS[input.tier] },
      );
    } catch (thrown) {
      // A non-ProviderError here is an adapter tripping over a malformed
      // reply. It is still this vendor's answer being unusable, so it is
      // recorded and the chain moves on rather than failing the caller.
      const error =
        thrown instanceof ProviderError
          ? thrown
          : new ProviderError(candidate.provider, `Unreadable reply: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      await recordUsage({
        runId: ctx.runId,
        agent: input.agent,
        tier: input.tier,
        provider: candidate.provider,
        model: candidate.model,
        keyId: candidate.credential.keyId,
        packageId: input.packageId,
        latencyMs: Date.now() - callStarted,
        status: "ERROR",
        error: scrubSecret(error.message, candidate.credential.apiKey),
      });
      return { kind: "error", error };
    }

    const costMyr = usdToMyr(result.costUsd);
    ctx.spentMyr += costMyr;
    const check = validate(result.text, input.json?.schema);
    await recordUsage({
      runId: ctx.runId,
      agent: input.agent,
      tier: input.tier,
      provider: candidate.provider,
      model: candidate.model,
      keyId: candidate.credential.keyId,
      packageId: input.packageId,
      inputTokens: result.usage.in,
      outputTokens: result.usage.out,
      cacheReadTokens: result.usage.cacheRead ?? 0,
      costUsd: result.costUsd,
      costMyr,
      costEstimated: result.costEstimated,
      latencyMs: result.latencyMs,
      status: "OK",
      error: check.ok ? null : `OUTPUT_INVALID: ${check.error}`,
    });
    if (check.ok) return { kind: "ok", value: check.value };
    if (round === 1) return { kind: "invalid", error: check.error };

    // No assistant prefill on current Claude models: the bad reply goes back
    // as a completed assistant turn and the correction is a new user turn.
    messages.push({ role: "assistant", content: result.text.trim() || "(empty reply)" });
    messages.push({ role: "user", content: repairPrompt(check.error, result.stopReason === "max_tokens", Boolean(input.json)) });
  }
}

function repairPrompt(error: string, truncated: boolean, json: boolean): string {
  const cause = truncated ? `${error}. The reply was cut off at the token limit, so keep the corrected answer shorter` : error;
  return json
    ? `Your previous reply could not be used: ${cause}. Reply again with only the corrected JSON object.`
    : `Your previous reply could not be used: ${cause}. Reply again with the requested text only.`;
}

async function fallback<T>(ctx: CallContext<T>, reason: FallbackReason, detail: string): Promise<RunTierResult<T>> {
  const { input } = ctx;
  const output = await input.template();
  const latencyMs = Date.now() - ctx.started;
  await recordUsage({
    runId: ctx.runId,
    agent: input.agent,
    tier: input.tier,
    provider: TEMPLATE_PROVIDER,
    model: TEMPLATE_MODEL,
    packageId: input.packageId,
    costEstimated: false,
    latencyMs,
    status: reason === "BUDGET_EXHAUSTED" ? "BUDGET_BLOCKED" : "FALLBACK_TEMPLATE",
    error: `${reason}: ${detail}`,
  });
  return {
    output,
    provenance: {
      tier: input.tier,
      agent: input.agent,
      mode: "TEMPLATE",
      provider: TEMPLATE_PROVIDER,
      model: TEMPLATE_MODEL,
      // What the failed attempts cost, which is not nothing when a model
      // answered twice with something unusable.
      costMyr: round8(ctx.spentMyr),
      latencyMs,
      fallbackReason: reason,
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    },
  };
}

// ---------------------------------------------------------------- output validation

type Check<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The JSON inside a reply: the body of a ```json fence if there is one,
 * otherwise the text itself, otherwise the span from the first `{` to the
 * last `}` (a model that prefaces its object with a sentence).
 */
export function extractJson(text: string): string | null {
  let body = text.trim();
  const fenced = /```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/.exec(body);
  body = fenced ? fenced[1].trim() : body.replace(/^```[a-zA-Z]*\s*/, "").trim();
  if (!body) return null;
  if (body.startsWith("{") || body.startsWith("[")) return body;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

function validate<T>(text: string, schema: ZodType<T> | undefined): Check<T> {
  if (!schema) {
    const trimmed = text.trim();
    // Without a schema the caller asked for text, so T is string.
    return trimmed ? { ok: true, value: trimmed as unknown as T } : { ok: false, error: "the reply was empty" };
  }
  const body = extractJson(text);
  if (body === null) return { ok: false, error: text.trim() ? "the reply contained no JSON object" : "the reply was empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return { ok: false, error: `the reply was not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, error: `the JSON did not match the required structure (${issues})` };
}

/** agent_runs.cost_myr precision (numeric(16,8), migration 0010). */
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
