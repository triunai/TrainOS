import type { AutonomyLevel } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { AutonomyChip } from "./AutonomyChip";
import { SECTION_LABEL } from "./tokens";

/**
 * The escalation ladder. §3.9's REPORT.md addition: "vertical dot list showing
 * where agent autonomy ends and a human takes over" — the collections ladder on
 * M13-S05, which runs 7 / 30 / 45 days, a human call at 60 and a trading hold at
 * 75 with MD approval.
 *
 * The handover is the point of the component. An agent ladder that does not say
 * where the agent stops is just a schedule; the rung where `autonomy` drops to
 * a human is drawn with a divider and a caption so the boundary is impossible
 * to miss.
 *
 * The vertical stepper from Kit §03 supplies the dot-and-connector grammar —
 * filled for a rung already reached, ringed for the current one, hollow ahead —
 * so this is not a second progress vocabulary.
 */

export interface LadderRung {
  /** When it fires, e.g. "Day 7" or "60 days overdue". */
  when: string;
  /** What happens, e.g. "Reminder 1 · email". */
  action: string;
  /** Who or what does it. Absent means a human does. */
  autonomy?: AutonomyLevel;
  /** Extra context, e.g. "requires MD approval". */
  note?: string;
  state?: "done" | "current" | "pending";
}

export interface EscalationLadderProps {
  rungs: LadderRung[];
  label?: string;
  className?: string;
}

export function EscalationLadder({
  rungs,
  label = "Escalation ladder",
  className,
}: EscalationLadderProps) {
  /* The first rung a human owns. Everything from here down is the handover. */
  const handoverIndex = rungs.findIndex((rung) => !rung.autonomy);

  return (
    <ol aria-label={label} className={cn("flex flex-col", className)}>
      {rungs.map((rung, index) => {
        const state = rung.state ?? "pending";
        const handover = index === handoverIndex && handoverIndex > 0;

        return (
          <li key={`${rung.when}-${rung.action}`} className="flex gap-3">
            <div className="flex w-3 shrink-0 flex-col items-center">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-2 h-2.5 w-2.5 shrink-0 rounded-pill",
                  state === "done" && "bg-ink",
                  state === "current" && "border-2 border-primary bg-card",
                  state === "pending" && "border border-border-strong bg-card",
                )}
              />
              {index < rungs.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn("w-px flex-1", state === "done" ? "bg-ink" : "bg-connector")}
                />
              ) : null}
            </div>

            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-1 pb-4",
                handover && "border-t border-dashed border-border-strong pt-3",
              )}
            >
              {handover ? (
                <span className={cn(SECTION_LABEL, "text-ink-secondary")}>A human takes over</span>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums text-[11px] text-ink-muted">{rung.when}</span>
                <span
                  className={cn(
                    "text-[13px]",
                    state === "current" ? "font-medium text-ink" : "text-ink-secondary",
                  )}
                >
                  {rung.action}
                </span>
                {rung.autonomy ? <AutonomyChip level={rung.autonomy} fluid /> : null}
              </div>

              {rung.note ? <p className="text-[12px] text-ink-muted">{rung.note}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
