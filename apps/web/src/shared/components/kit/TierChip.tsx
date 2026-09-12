import type { TierKey } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { tierLabel } from "./format";

/**
 * The tier chip. Kit.dc.html §10, verbatim: "Neutral by design. A tier is a
 * routing fact, not a status — colouring it would spend accent on something the
 * user cannot act on."
 *
 * So there is no `tone` prop and no way to colour this chip. A degraded tier is
 * a separate `StatusChip` beside it, because the degradation is the status and
 * the tier is still just the tier.
 *
 * `STRONG_1` renders as `STRONG-1` and `DEEP_THINK` as `DEEP THINK`, matching
 * the artboard: underscores are a wire format, not a label.
 */

export interface TierChipProps {
  tier: TierKey;
  /** The model carrying the tier right now, e.g. "Claude Sonnet 5". Muted suffix. */
  model?: string;
  className?: string;
}

export function TierChip({ tier, model, className }: TierChipProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border bg-surface px-2.5 py-[3px] text-[12px] font-medium text-ink-secondary",
        className,
      )}
    >
      <span className="font-mono text-[10px] tracking-[0.06em] text-ink">{tierLabel(tier)}</span>
      {model ? <span className="text-ink-muted">{model}</span> : null}
    </span>
  );
}
