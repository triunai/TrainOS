import type { DiffLine } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { SECTION_LABEL } from "./tokens";

/**
 * The diff block — "if you approve, this happens".
 *
 * Contract §7 is emphatic: "The diff is the contract that matters most:
 * `effects[]` returned by POST /decide MUST match the `diff[]` rendered on the
 * detail screen." So this renders `DiffLine[]` exactly as the server sent it,
 * in order, and composes nothing. An approver signing off on a sentence this
 * component invented would be signing off on the wrong thing.
 *
 * `op` drives the glyph and the colour: ADD is a green `+`, REMOVE a red `−`,
 * UPDATE a neutral `~`. Green and red here are the same chip colours used
 * everywhere else — an added line is not a status, but the plus/minus grammar
 * is universal enough that borrowing the tones costs nothing.
 */

const OP = {
  ADD: { glyph: "+", className: "text-success" },
  REMOVE: { glyph: "−", className: "text-danger" },
  UPDATE: { glyph: "~", className: "text-ink-secondary" },
} as const;

export interface DiffBlockProps {
  lines: DiffLine[];
  /** Defaults to the pack's wording. */
  title?: string;
  className?: string;
}

export function DiffBlock({ lines, title = "If you approve", className }: DiffBlockProps) {
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-control border border-border bg-surface p-3",
        className,
      )}
    >
      <h3 className={SECTION_LABEL}>{title}</h3>
      <ul className="flex flex-col gap-1">
        {lines.map((line, index) => {
          const op = OP[line.op];
          return (
            <li
              key={`${line.op}-${line.entity}-${index}`}
              className="flex gap-2 font-mono text-[12px]"
            >
              <span aria-hidden="true" className={cn("w-2 shrink-0", op.className)}>
                {op.glyph}
              </span>
              <span className="sr-only">{line.op.toLowerCase()}:</span>
              <span className="min-w-0 text-ink-secondary">
                {line.description}
                {line.ref ? <span className="text-ink-muted"> · {line.ref}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
