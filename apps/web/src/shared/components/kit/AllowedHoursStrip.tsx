import type { AllowedHourWindow } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { PEAK_BG } from "./tokens";

/**
 * The allowed-hours strip. Kit.dc.html §10: 24 equal cells, one per hour MYT,
 * each either allowed (AI tint) or peak (the amber band), with a two-item legend.
 *
 * A band, not a status. The strip says when a tier's traffic is cheap, which is
 * a routing fact — the same reasoning that keeps `TierChip` neutral.
 *
 * The contract's `AllowedHourWindow` is `[start, end)` — half-open, so
 * `[9, 12]` is 09:00, 10:00 and 11:00 and not noon. Getting that wrong shifts
 * every band by an hour, so the boundary is spelled out in `isWithin` rather
 * than left to a reader of the comparison.
 */

export interface AllowedHoursStripProps {
  /** Hours the tier may run in. An empty list means every hour is allowed. */
  allowed?: AllowedHourWindow[];
  /** Provider peak windows — expensive, avoid. Drawn over the allowed shading. */
  peak?: AllowedHourWindow[];
  /** Hide the legend where several strips stack in a table column. */
  withoutLegend?: boolean;
  className?: string;
}

/** `[start, end)` — end-exclusive, matching the contract. */
function isWithin(hour: number, windows: AllowedHourWindow[]): boolean {
  return windows.some(([start, end]) => hour >= start && hour < end);
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function AllowedHoursStrip({
  allowed,
  peak = [],
  withoutLegend,
  className,
}: AllowedHoursStripProps) {
  const allowedAll = !allowed || allowed.length === 0;

  const describe = (hour: number) => {
    const permitted = allowedAll || isWithin(hour, allowed);
    if (!permitted) return "not allowed";
    return isWithin(hour, peak) ? "peak · avoid" : "allowed";
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        role="img"
        aria-label={`Allowed hours, Malaysia time. ${
          HOURS.filter((hour) => describe(hour) === "allowed").length
        } of 24 hours allowed off-peak.`}
        className="flex h-[22px] min-w-[220px] overflow-hidden rounded-[5px] border border-border"
      >
        {HOURS.map((hour) => {
          const state = describe(hour);
          return (
            <div
              key={hour}
              title={`${String(hour).padStart(2, "0")}:00 · ${state}`}
              className={cn(
                "flex-1 border-r border-divider last:border-r-0",
                state === "peak · avoid"
                  ? PEAK_BG
                  : state === "allowed"
                    ? "bg-ai-tint-2"
                    : "bg-surface",
              )}
            />
          );
        })}
      </div>

      {withoutLegend ? null : (
        <div className="flex flex-wrap gap-3.5 text-[12px] text-ink-secondary">
          <Legend className="border border-border bg-ai-tint-2">Allowed</Legend>
          <Legend className={PEAK_BG}>Peak · avoid</Legend>
          {allowedAll ? null : <Legend className="border border-border bg-surface">Closed</Legend>}
        </div>
      )}
    </div>
  );
}

function Legend({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[2px]", className)} />
      {children}
    </span>
  );
}
