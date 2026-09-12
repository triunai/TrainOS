import type { ReactNode } from "react";
import type { AppliedFilter } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { FOCUS_RING } from "./tokens";

/**
 * The filter bar. Kit.dc.html §08: dismissible chips (`Label: value ✕`), a
 * dashed "+ Filter" affordance, and a right-aligned "N of M shown" counter.
 *
 * The counter is not decoration. A filtered table that does not say it is
 * filtered is how a user concludes a record has been deleted, so the count and
 * the chips both stay visible until the filters are cleared.
 *
 * Filters arrive as the contract's `AppliedFilter`, which carries `source`:
 * a `VIEW` filter came from the saved view and a `REQUEST` filter from the
 * user. The two dismiss differently — removing a view's filter means leaving
 * the view — so a `VIEW` chip renders without an ✕ and says where it came from.
 */

export interface FilterChipModel {
  /** Stable id for dismissal. Usually `${field}:${op}`. */
  id: string;
  /** The field's display name, e.g. "Stage". */
  label: string;
  /** The value as a user would read it, e.g. "Proposal sent". */
  value: string;
  /** A `VIEW` filter belongs to the saved view and cannot be dismissed alone. */
  locked?: boolean;
}

/** Map contract filters onto chips. `format` turns an opaque value into words. */
export function chipsFromFilters(
  filters: AppliedFilter[],
  format: (filter: AppliedFilter) => { label: string; value: string },
): FilterChipModel[] {
  return filters.map((filter) => ({
    id: `${filter.field}:${filter.op}`,
    locked: filter.source === "VIEW",
    ...format(filter),
  }));
}

export interface FilterBarProps {
  filters: FilterChipModel[];
  onRemove?: (id: string) => void;
  /** Opens the add-filter menu. Without it the dashed affordance is not rendered. */
  onAdd?: () => void;
  onClearAll?: () => void;
  /** "N of M shown". Both numbers, or neither. */
  shown?: number;
  total?: number;
  /** Extra controls on the right, e.g. a density toggle. */
  children?: ReactNode;
  className?: string;
}

export function FilterBar({
  filters,
  onRemove,
  onAdd,
  onClearAll,
  shown,
  total,
  children,
  className,
}: FilterBarProps) {
  const counting = typeof shown === "number" && typeof total === "number";

  return (
    <div
      role="group"
      aria-label="Filters"
      className={cn("flex flex-wrap items-center gap-2 px-4 py-2.5", className)}
    >
      {filters.map((filter) => (
        <span
          key={filter.id}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border bg-surface py-1 pl-2.5 pr-1 text-[12px] text-ink-secondary"
        >
          <span className="text-ink-muted">{filter.label}:</span>
          <span className="font-medium text-ink">{filter.value}</span>
          {filter.locked || !onRemove ? (
            <span
              className="pr-1.5 font-mono text-[10px] text-ink-muted"
              title="From the saved view"
            >
              view
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onRemove(filter.id)}
              aria-label={`Remove filter ${filter.label}: ${filter.value}`}
              className={cn(
                "rounded-[4px] px-1 text-ink-muted hover:bg-surface-hover hover:text-ink",
                FOCUS_RING,
              )}
            >
              ✕
            </button>
          )}
        </span>
      ))}

      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            "inline-flex items-center gap-1 rounded-[6px] border border-dashed border-border-strong px-2.5 py-1 text-[12px] text-ink-muted hover:border-primary-border hover:text-primary-hover",
            FOCUS_RING,
          )}
        >
          + Filter
        </button>
      ) : null}

      {filters.some((filter) => !filter.locked) && onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className={cn("rounded-[4px] text-[12px] text-ink-muted hover:text-ink", FOCUS_RING)}
        >
          Clear
        </button>
      ) : null}

      <div className="ml-auto flex items-center gap-3">
        {children}
        {counting ? (
          <span
            aria-live="polite"
            className="whitespace-nowrap font-mono text-[11px] text-ink-muted"
          >
            {shown} of {total} shown
          </span>
        ) : null}
      </div>
    </div>
  );
}

export type Density = "comfortable" | "compact";

export interface DensityToggleProps {
  value: Density;
  onChange: (value: Density) => void;
  className?: string;
}

/** The Comfortable/Compact segmented toggle from §08's view row. */
export function DensityToggle({ value, onChange, className }: DensityToggleProps) {
  return (
    <div
      role="group"
      aria-label="Row density"
      className={cn("inline-flex rounded-control border border-border bg-card", className)}
    >
      {(["comfortable", "compact"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "px-2.5 py-1 text-[12px] capitalize first:rounded-l-control last:rounded-r-control",
            value === option
              ? "bg-ai-tint-2 font-medium text-primary-hover"
              : "text-ink-muted hover:bg-surface-hover",
            FOCUS_RING,
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
