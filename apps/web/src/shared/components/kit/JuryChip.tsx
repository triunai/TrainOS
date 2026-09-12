import type { ProvenanceJury } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { AI_GLYPH } from "./tokens";

/**
 * The jury chip. Kit.dc.html §10: "✦ Jury 2 of 3" in the AI tint when a jury
 * ran, a neutral "No jury" when none did — "the jury chip takes the AI tint
 * because it describes model behaviour."
 *
 * DECISIONS §2 is explicit that a jury is an object and never a boolean, so
 * this takes the contract's `ProvenanceJury` (or nothing) rather than a flag.
 * Dissent is surfaced in the tooltip, not buried: a 2-of-3 that one model
 * argued against is a different fact from a unanimous 3-of-3, and the approver
 * deciding on it should be able to see which.
 */

export interface JuryChipProps {
  /** Absent means no jury ran — a fact worth stating, so the chip still renders. */
  jury?: ProvenanceJury;
  className?: string;
}

export function JuryChip({ jury, className }: JuryChipProps) {
  if (!jury) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center whitespace-nowrap rounded-pill border border-border bg-surface px-2.5 py-[3px] text-[12px] text-ink-muted",
          className,
        )}
      >
        No jury
      </span>
    );
  }

  const dissent = jury.dissented.map((vote) => `${vote.model}: ${vote.note}`).join("\n");

  return (
    <span
      title={dissent || `Agreed: ${jury.agreed.join(", ")}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-primary-border bg-ai-tint px-2.5 py-[3px] text-[12px] font-medium text-primary-hover",
        className,
      )}
    >
      <span aria-hidden="true">{AI_GLYPH}</span>
      Jury {jury.quorum} of {jury.of}
    </span>
  );
}
