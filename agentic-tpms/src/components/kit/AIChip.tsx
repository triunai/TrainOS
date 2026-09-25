"use client";

import { cn } from "@/lib/cn";
import { AI_GLYPH } from "./tokens";

/**
 * FORKED FROM TrainOS kit/AIChip.tsx (simplified: provenance shows in a title
 * tooltip instead of a popover). AI is a 6% tint + ✦ + a text label — never a
 * solid fill. `template` is grey: produced by a deterministic template, no model.
 */
export type AIChipVariant = "suggested" | "executed" | "awaiting" | "template" | "failed" | "rule" | "extraction";

const VARIANT: Record<AIChipVariant, string> = {
  suggested: "bg-ai-tint text-primary-hover border-primary-border",
  executed: "bg-ai-tint text-primary-hover border-primary font-semibold",
  awaiting: "bg-warning-fill text-warning border-warning-border",
  template: "bg-surface text-ink-secondary border-border",
  rule: "bg-surface text-ink-secondary border-border",
  extraction: "bg-ai-tint text-primary-hover border-primary-border",
  failed: "bg-danger-fill text-danger border-danger-border",
};

const LABEL: Record<AIChipVariant, string> = {
  suggested: "AI suggested",
  executed: "AI executed",
  awaiting: "Awaiting approval",
  template: "Template",
  rule: "L0 rule",
  extraction: "Extracted",
  failed: "AI failed",
};

export interface ProvenanceLike {
  tier?: string;
  agent?: string;
  mode?: string;
  provider?: string;
  model?: string;
  costMyr?: number;
  latencyMs?: number;
  fallbackReason?: string;
  confidence?: number;
}

export function variantFromProvenance(p?: ProvenanceLike | null): AIChipVariant {
  if (!p || !p.mode) return "suggested";
  if (p.mode === "TEMPLATE") return "template";
  if (p.mode === "RULE") return "rule";
  if (p.mode === "EXTRACTION") return "extraction";
  return "suggested";
}

export function AIChip({
  variant,
  provenance,
  label,
  className,
}: {
  variant?: AIChipVariant;
  provenance?: ProvenanceLike | null;
  label?: string;
  className?: string;
}) {
  const resolved = variant ?? variantFromProvenance(provenance);
  const tip = provenance
    ? [
        provenance.tier && `Tier ${provenance.tier}`,
        provenance.agent,
        provenance.model && `${provenance.provider ?? ""} ${provenance.model}`.trim(),
        typeof provenance.costMyr === "number" && `RM ${provenance.costMyr.toFixed(4)}`,
        typeof provenance.latencyMs === "number" && `${provenance.latencyMs} ms`,
        provenance.fallbackReason && `fallback: ${provenance.fallbackReason}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const confidence = typeof provenance?.confidence === "number" ? provenance.confidence : undefined;
  return (
    <span
      title={tip}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-[3px] text-[12px] font-medium",
        VARIANT[resolved],
        className,
      )}
    >
      <span aria-hidden="true">{AI_GLYPH}</span>
      {label ?? (provenance?.tier ? `${LABEL[resolved]} · ${provenance.tier}` : LABEL[resolved])}
      {confidence !== undefined ? <span className="text-[11px] tabular-nums">· {Math.round(confidence * 100)}%</span> : null}
    </span>
  );
}
