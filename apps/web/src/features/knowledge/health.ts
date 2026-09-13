import type { KnowledgeSource, KnowledgeSourceType, MonitorStatus } from "@trainos/contract";
import type { StatusTone } from "@/shared/components/kit";

/**
 * What state a source is in, as ONE fact.
 *
 * The contract carries two independent state fields — `monitorStatus` (is the
 * document still what we ingested?) and `embeddingStatus` (have we finished
 * reading it?) — and the old screen gave each its own column and its own chip.
 * That is two questions asked of every row to answer one: is this source
 * pulling its weight, and if not, what do I do about it.
 *
 * The order below is the priority, and it is not arbitrary. A failed fetch
 * outranks a pending embedding because there is nothing to embed; a changed
 * document outranks both because it is the only state that puts the agents'
 * answers and the source out of agreement.
 */
export type SourceHealth = "FAILED" | "CHANGED" | "PROCESSING" | "HEALTHY";

export function healthOf(source: KnowledgeSource): SourceHealth {
  if (source.monitorStatus === "FAILED" || source.embeddingStatus === "FAILED") return "FAILED";
  if (source.monitorStatus === "CHANGED_REVIEW_PENDING") return "CHANGED";
  if (source.embeddingStatus === "PENDING") return "PROCESSING";
  return "HEALTHY";
}

export const HEALTH_LABEL: Record<SourceHealth, string> = {
  FAILED: "Fetch failed",
  CHANGED: "Changed",
  PROCESSING: "Processing",
  HEALTHY: "Healthy",
};

/**
 * `HEALTHY` is neutral rather than green on purpose. Four of six rows are
 * healthy, and a column of green chips is a column of decoration — CLAUDE.md
 * puts status colour on chips so that colour still MEANS something when it
 * appears. The two rows that need a person are the two that get a hue.
 */
export const HEALTH_TONE: Record<SourceHealth, StatusTone> = {
  FAILED: "danger",
  CHANGED: "warning",
  PROCESSING: "info",
  HEALTHY: "neutral",
};

/**
 * The ONE action a row in trouble promotes into the table, per tightening
 * brief §18. A healthy row promotes nothing and keeps its maintenance in the
 * row overflow — that asymmetry is the design: an action in the row means
 * something is wrong with this row.
 */
export const PROMOTED_ACTION: Record<SourceHealth, string | null> = {
  FAILED: "Retry",
  CHANGED: "Review changes",
  PROCESSING: "View progress",
  HEALTHY: null,
};

/** Does this source want a person? The "Needs attention" tab is exactly this. */
export function needsAttention(source: KnowledgeSource): boolean {
  const health = healthOf(source);
  return health === "FAILED" || health === "CHANGED";
}

/**
 * `humanise` turns `HRDC_CIRCULAR` into "Hrdc circular", which is a body the
 * reader has never heard of. The corpus is HRD Corp's, and its name is not a
 * casing accident.
 */
export const TYPE_LABEL: Record<KnowledgeSourceType, string> = {
  HRDC_CIRCULAR: "HRD Corp circular",
};

/**
 * What the source is READ FOR, which is the question a reader of this table is
 * actually asking — not which scope flags are set.
 *
 * `CLIENT_FACING` is the consequential one: a source carrying it can reach a
 * proposal. Everything else informs staff answers and compliance checks and
 * never leaves the building, which is one word, not a list of scope names.
 */
export function usedForLabel(source: KnowledgeSource): string {
  return source.retrievalScopes.includes("CLIENT_FACING") ? "Client answers" : "Internal";
}

/** How often the monitor looks, in words. `MANUAL` means it does not. */
export function cadenceOf(status: MonitorStatus): string {
  return status === "MANUAL" ? "Not watched · maintained by hand" : "Weekly · content hash";
}
