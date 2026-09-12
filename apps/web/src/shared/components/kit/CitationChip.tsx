import { cn } from "@/shared/lib/utils";
import { FOCUS_RING } from "./tokens";

/**
 * The source-citation chip. Kit.dc.html §05, and its governing rule: "uncited
 * AI prose is not allowed on record pages."
 *
 * Two shapes from one component, both mono, both opening the same drawer:
 *   · `inline`  — a superscript number inside AI-authored prose (M03-S02)
 *   · `rule`    — a trailing `§ HRD-014` on a compliance check row (M12-S02)
 *
 * A citation is always actionable. If there is nothing to open, the prose it
 * sits in should not have been AI-authored.
 */

export interface CitationChipProps {
  /** `1` for an inline numbered citation, `§ HRD-014` for a rule reference. */
  children: React.ReactNode;
  variant?: "inline" | "rule";
  /** Opens the cited source, normally the audit or rule drawer. */
  onOpen?: () => void;
  /** What is being cited, for the accessible name — "HRD Corp rule HRD-014". */
  label?: string;
  className?: string;
}

export function CitationChip({
  children,
  variant = "rule",
  onOpen,
  label,
  className,
}: CitationChipProps) {
  const shared = cn("font-mono transition-colors", FOCUS_RING);

  if (variant === "inline") {
    return (
      <sup>
        <button
          type="button"
          onClick={onOpen}
          aria-label={label ?? `Source ${String(children)}`}
          className={cn(
            shared,
            "ml-0.5 inline-flex min-w-[16px] items-center justify-center rounded-[4px] border border-primary-border bg-ai-tint px-1 text-[10px] leading-4 text-primary-hover hover:bg-ai-tint-2",
            className,
          )}
        >
          {children}
        </button>
      </sup>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={cn(
        shared,
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] border border-border bg-card px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-surface-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}
