import { useRef, useState, type ReactNode } from "react";
import type { Provenance, ProvenanceOrigin } from "@trainos/contract";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";
import { AI_GLYPH, AI_POPOVER_BG, FOCUS_RING, WARNING_ACCENT_BG } from "./tokens";
import { ProvenanceBlock } from "./ProvenanceBlock";

/**
 * The AI chip. Kit.dc.html §02 "AI badge" and §05 "Provenance block", whose
 * seven badge variants this component is the single implementation of.
 *
 * CLAUDE.md, verbatim: "AI is the primary hue at 6% tint plus the ✦ glyph and a
 * text label, never a solid fill and never a fourth accent. Solid blue means a
 * human triggered it."
 *
 * That rule is enforced by the type, not by documentation: there is no `solid`
 * variant and no `className` escape into a fill. Every variant below is a tint
 * plus a 1px border, and every one carries both the glyph and words. The two
 * exceptions are deliberate and both come from §05: `awaiting` is amber because
 * the wait is the state rather than the model, and `failed` is danger because a
 * failure needs the same red as any other failure. `system` is grey — "generated
 * by a rule/template, no model — never violet".
 *
 * Absent provenance means human-authored (contract §1), so a human-authored
 * value renders NO badge at all. That is `variant="human"`, which returns null.
 */

export type AIChipVariant =
  "human" | "system" | "suggested" | "executed" | "awaiting" | "low-confidence" | "failed";

/** Tint + border + text, one per variant. No entry here is a solid fill. */
const VARIANT: Record<Exclude<AIChipVariant, "human">, string> = {
  system: "bg-surface text-ink-secondary border-border",
  suggested: "bg-ai-tint text-primary-hover border-primary-border",
  /* Acted autonomously under policy: the same tint, a heavier border. Weight
     rises with consequence, which is the same grammar the autonomy ladder uses. */
  executed: "bg-ai-tint text-primary-hover border-primary",
  awaiting: "bg-warning-fill text-warning border-warning-border",
  "low-confidence": "bg-ai-tint text-primary-hover border-primary-border",
  failed: "bg-danger-fill text-danger border-danger-border",
};

/**
 * Pick the badge variant from a contract `Provenance`.
 *
 * One place decides, so a low-confidence value looks the same on the enquiry
 * screen and in the approval queue. `lowConfidenceBelow` is the threshold at
 * which a normal AI badge becomes the amber-dotted one; the pack's example is
 * 41% against an unstated bar, and REPORT.md is explicit that low confidence
 * WARNS and never blocks.
 */
export function variantOf(
  provenance: Provenance | undefined,
  lowConfidenceBelow = 0.6,
): AIChipVariant {
  if (!provenance) return "human";

  const origin: ProvenanceOrigin = provenance.origin;
  if (origin === "HUMAN") return "human";
  if (origin === "SYSTEM") return "system";

  if (typeof provenance.confidence === "number" && provenance.confidence < lowConfidenceBelow) {
    return "low-confidence";
  }

  return origin === "AI_EXECUTED" ? "executed" : "suggested";
}

const DEFAULT_LABEL: Record<Exclude<AIChipVariant, "human">, string> = {
  system: "System",
  suggested: "AI suggested",
  executed: "AI executed",
  awaiting: "Awaiting approval",
  "low-confidence": "Low confidence",
  failed: "AI failed",
};

export interface AIChipProps {
  /** Omit to derive from `provenance`. Pass explicitly for `awaiting`/`failed`. */
  variant?: AIChipVariant;
  /**
   * The provenance envelope. Renders the popover and, when `variant` is
   * omitted, chooses it. Absent provenance is a human-authored value and the
   * chip disappears entirely.
   */
  provenance?: Provenance;
  /** Overrides the default wording. The chip always has words — this cannot be empty. */
  label?: string;
  /** Show `· 82%`. Defaults on when the provenance carries a confidence. */
  showConfidence?: boolean;
  /**
   * Suppress the hover/focus popover. Use inside a dense table cell where the
   * row already opens the record; everywhere else the popover is the point,
   * because §05 requires provenance to be reachable from the badge.
   */
  withoutPopover?: boolean;
  /** Extra rows under the popover's metadata, e.g. an "Open trace" link. */
  popoverFooter?: ReactNode;
  className?: string;
}

export function AIChip({
  variant,
  provenance,
  label,
  showConfidence,
  withoutPopover,
  popoverFooter,
  className,
}: AIChipProps) {
  const resolved = variant ?? variantOf(provenance);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();

  /* A human-authored value carries no badge. §05: "Human — no visible badge,
     filter/audit only." Rendering a grey "Human" chip on every untouched field
     would drown the ones that matter. */
  if (resolved === "human") return null;

  const confidence = provenance?.confidence;
  const withConfidence =
    (showConfidence ?? typeof confidence === "number") && typeof confidence === "number";

  const text = label ?? DEFAULT_LABEL[resolved];
  const hasPopover = !withoutPopover && Boolean(provenance);

  const chip = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-[3px] text-[12px] font-medium",
        resolved === "executed" && "font-semibold",
        VARIANT[resolved],
        className,
      )}
    >
      {/* The glyph and a dot are two different marks. The glyph says "AI"; the
          dot says how much to trust it, and turns amber for low confidence —
          the one place amber appears on a blue chip. */}
      <span aria-hidden="true">{AI_GLYPH}</span>
      {resolved === "low-confidence" ? (
        <span
          aria-hidden="true"
          className={cn("h-[5px] w-[5px] rounded-pill", WARNING_ACCENT_BG)}
        />
      ) : null}
      {text}
      {withConfidence ? (
        <span className="font-mono text-[11px]">· {Math.round(confidence * 100)}%</span>
      ) : null}
      {resolved === "executed" ? (
        <span className="rounded-[3px] border border-primary px-1 font-mono text-[9px] tracking-[0.08em]">
          AUTO
        </span>
      ) : null}
    </span>
  );

  if (!hasPopover) return chip;

  /* The popover is the scaffold's Radix-backed `ui/popover`, which supplies the
     positioning, the outside-click dismissal, the Escape handling and the
     focus return. §05 requires provenance to be reachable FROM the badge, so
     there are two ways in and both are supported: hovering, which is how a
     mouse reads it in passing, and activating the trigger with Enter, Space or
     a tap, which is how everyone else does. A hover-only panel is not reachable
     by keyboard or by touch at all.
  
     Radix portals the content, so it is not a descendant of the trigger and a
     plain `onMouseLeave` on the trigger would close the panel the instant the
     pointer set off towards it. Hence the short grace period, cancelled when
     the pointer arrives on the content itself. */
  const openNow = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="inline-flex" onMouseEnter={openNow} onMouseLeave={closeSoon}>
        <PopoverTrigger asChild>
          <button type="button" className={cn("rounded-pill", FOCUS_RING)}>
            {chip}
          </button>
        </PopoverTrigger>
      </span>

      <PopoverContent
        align="start"
        sideOffset={6}
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        /* Keep focus where the reader put it. The popover is reference
           material, not a destination, and stealing focus into it would strand
           a keyboard user inside a panel they only meant to glance at. */
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          "z-30 flex w-[340px] flex-col gap-1.5 rounded-control border border-primary-border p-3 text-left shadow-raised",
          AI_POPOVER_BG,
        )}
      >
        <ProvenanceBlock provenance={provenance as Provenance} />
        {popoverFooter}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The name the design pack uses for the same component. Kit.dc.html §02 calls
 * it "AI badge"; §05 calls it a provenance badge. One implementation, so the
 * two names cannot drift apart.
 */
export const AIBadge = AIChip;
