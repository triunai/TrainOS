import type { ZodType } from "zod";

/**
 * The 5-tier agent pool.
 *   L0 — deterministic rules (src/server/fsm/guards.ts); never an LLM
 *   L1 — fast classifier / router (Gemini Flash Lite class)
 *   L2 — extraction (PaddleOCR microservice, EXIF); not an LLM tier here
 *   L3 — domain specialists (DeepSeek V3 class) — outlines, invoices, TNA
 *   L4 — tone specialist (Claude) — outbound copy, executive packs
 */
export type LlmTier = "L1" | "L3" | "L4";
export type AgentTier = "L0" | "L1" | "L2" | "L3" | "L4";

export interface Provenance {
  tier: AgentTier;
  agent: string;
  /** LLM = a model produced it; TEMPLATE = deterministic fallback (no key, cap hit, or model failure). */
  mode: "LLM" | "TEMPLATE" | "RULE" | "EXTRACTION";
  provider: string;
  model: string;
  costMyr: number;
  latencyMs: number;
  /** Why the template ran instead of a model, when it did. */
  fallbackReason?: string;
  confidence?: number;
  runId?: string;
}

export interface RunTierInput<T> {
  tier: LlmTier;
  /** Stable agent name, e.g. "commercial.outline_writer". Drives the cost breakdown. */
  agent: string;
  packageId?: string | null;
  leadId?: string | null;
  system: string;
  prompt: string;
  /** When set, the model must return JSON matching this schema (one repair retry, then template). */
  json?: { schema: ZodType<T> };
  maxTokens?: number;
  /** Deterministic output used when no model is available or allowed. Must always succeed. */
  template: () => T | Promise<T>;
}

export interface RunTierResult<T> {
  output: T;
  provenance: Provenance;
}
