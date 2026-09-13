import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import type { FilterChipModel } from "./adapters";
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

/**
 * The Comfortable/Compact toggle from §08's view row.
 *
 * Brief §10 ends with "density Comfortable/Compact uses the same control", so
 * this is the segmented control the saved-view switcher is, at toolbar scale:
 * one bounded track on surface L2, a hairline divider at the seam, the chosen
 * option a filled surface inset inside the track. It is deliberately NOT a
 * `PillTabGroup` — two options that both stay visible are a `group` of toggle
 * buttons, not a tablist, and giving them tab semantics would promise arrow-key
 * navigation between panels that do not exist.
 *
 * Smaller than the switcher on purpose: 26px segments against 32px, because
 * this sits INSIDE a filter bar and a control that matched the page's view
 * switcher would compete with it.
 */
export function DensityToggle({ value, onChange, className }: DensityToggleProps) {
  const options = ["comfortable", "compact"] as const;

  return (
    <div
      role="group"
      aria-label="Row density"
      className={cn(
        "inline-flex items-center rounded-control border border-border bg-surface p-0.5",
        className,
      )}
    >
      {options.map((option, index) => {
        const active = value === option;

        return (
          <div key={option} className="contents">
            {/* The seam disappears next to the filled segment: the fill is the
                separation, and a hairline beside it reads as a double rule. */}
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "my-1 w-px shrink-0 self-stretch bg-border",
                  (active || value === options[index - 1]) && "bg-transparent",
                )}
              />
            ) : null}

            <button
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option)}
              className={cn(
                "flex h-[26px] items-center whitespace-nowrap rounded-[6px] border px-2.5 text-[12px] capitalize transition-colors",
                active
                  ? "border-primary-border bg-ai-tint-2 font-medium text-primary-hover"
                  : "border-transparent text-ink-muted hover:bg-surface-hover hover:text-ink",
                FOCUS_RING,
              )}
            >
              {option}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The two controls that go INSIDE a filter bar.
 *
 * `ProgrammesListPage` hand-rolled the select with a comment reading "the kit
 * has no filter-select control yet", which was true of a kit serving one list
 * screen. It is not true of a kit serving seven: CLAUDE.md's consolidation rule
 * turns the third copy into a defect, so the pattern is named here and the
 * older copy is migrated in the same pass.
 *
 * Both are deliberately NOT form fields. `Field`/`TextField` stack a 12px label
 * above the control because a form asks a question; a filter bar states a
 * narrowing, so the label sits beside the control and the whole thing holds the
 * bar's 28px row. Using `TextField` here would have grown the bar by 20px and
 * put a second field vocabulary on every list screen.
 * ------------------------------------------------------------------ */

/** The shared geometry. A modest rectangle at `--radius-control`, per §6. */
const FILTER_CONTROL =
  "h-7 rounded-control border border-border bg-surface px-2 text-[12px] text-ink placeholder:text-ink-muted";

export interface FilterSelectOption {
  value: string;
  label: string;
}

export interface FilterSelectProps {
  /** Sits beside the control and is its accessible name. Sentence case. */
  label: string;
  value: string;
  options: FilterSelectOption[];
  onChange: (value: string) => void;
  className?: string;
}

/**
 * One facet, as a native select.
 *
 * Native on purpose: a listbox this small buys nothing a `<select>` does not
 * already give for free on a phone, with a keyboard, or to a screen reader, and
 * the kit has no popover primitive that would not be a fourth menu vocabulary.
 */
export function FilterSelect({ label, value, options, onChange, className }: FilterSelectProps) {
  return (
    <label className={cn("flex items-center gap-2 text-[12px] text-ink-secondary", className)}>
      <span>{label}</span>
      <select
        className={cn(FILTER_CONTROL, FOCUS_RING)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface FilterSearchProps {
  /** The accessible name, e.g. "Search organisations". Rendered for sighted
   *  readers too unless `labelHidden`, because an unlabelled box in a row of
   *  labelled facets reads as a different kind of control. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  labelHidden?: boolean;
  className?: string;
}

/**
 * The free-text narrowing, for a list whose server read takes a query.
 *
 * `type="search"` rather than `type="text"`: it gives the browser's own clear
 * affordance and the right virtual keyboard, and the kit gains no clear button
 * of its own to keep in step with it.
 */
export function FilterSearch({
  label,
  value,
  onChange,
  placeholder,
  labelHidden,
  className,
}: FilterSearchProps) {
  return (
    <label className={cn("flex items-center gap-2 text-[12px] text-ink-secondary", className)}>
      <span className={labelHidden ? "sr-only" : undefined}>{label}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...(placeholder === undefined ? {} : { placeholder })}
        className={cn(FILTER_CONTROL, "w-[184px]", FOCUS_RING)}
      />
    </label>
  );
}
