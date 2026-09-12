import type { EvidenceType, Ref } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { TYPE_TAG } from "./adapters";

/**
 * The typed record tag. Kit.dc.html §03 "Relation picker" and §05 command
 * palette: every result row is prefixed with a bordered mono three-letter tag
 * saying what kind of thing it is — ORG, CON, PRO, TNA.
 *
 * Type first, then identity. In a mixed result list the tag is what makes the
 * list scannable, and three characters is the width that keeps a column of them
 * aligned.
 */

export interface RefChipProps {
  /** The record's business reference, e.g. `ORG-0114`. Rendered when no `type` tag is wanted. */
  refValue?: Ref;
  /** Renders the three-letter tag for this kind. */
  type?: EvidenceType;
  className?: string;
}

export function RefChip({ refValue, type, className }: RefChipProps) {
  const text = type ? TYPE_TAG[type] : refValue;
  if (!text) return null;

  return (
    <span
      title={type && refValue ? refValue : undefined}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-[5px] border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] tracking-[0.04em] text-ink-secondary",
        className,
      )}
    >
      {text}
    </span>
  );
}
