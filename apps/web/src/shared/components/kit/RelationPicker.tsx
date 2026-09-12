import { useId } from "react";
import type { EvidenceType, Ref } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { RefChip } from "./RefChip";
import { FOCUS_RING } from "./tokens";

/**
 * The relation picker. Kit.dc.html §03: a search header, a results list where
 * each row is prefixed with its typed three-letter tag, and a trailing
 * "+ Create …" affordance.
 *
 * Every relation field in TrainOS is this — picking an organisation on an
 * enquiry, a trainer on an engagement, a programme on a proposal. The typed tag
 * is what makes a mixed-type result list usable, which is why it is not optional.
 *
 * The create affordance is last and is dashed, so it never competes with a real
 * match. Creating a duplicate organisation because the search was one letter off
 * is the failure this ordering exists to prevent.
 *
 * A listbox, not a menu: these are options being chosen from, and
 * `aria-selected` is what communicates the current one.
 */

export interface RelationOption {
  ref: Ref;
  type: EvidenceType;
  label: string;
  /** One line of disambiguation — a city, a domain, a date. */
  meta?: string;
}

export interface RelationPickerProps {
  query: string;
  onQueryChange: (query: string) => void;
  options: RelationOption[];
  /** The chosen record's ref. */
  selectedRef?: Ref;
  onSelect: (option: RelationOption) => void;
  /** The field's name, e.g. "Organisation". */
  label: string;
  /** Renders the "+ Create" row. */
  onCreate?: (query: string) => void;
  createLabel?: string;
  loading?: boolean;
  className?: string;
}

export function RelationPicker({
  query,
  onQueryChange,
  options,
  selectedRef,
  onSelect,
  label,
  onCreate,
  createLabel,
  loading,
  className,
}: RelationPickerProps) {
  const id = useId();

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-ink-secondary">
        {label}
      </label>

      <div className="overflow-hidden rounded-control border border-border bg-card">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          className={cn(
            "w-full border-b border-divider bg-card px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-primary",
            FOCUS_RING,
          )}
        />

        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="max-h-56 overflow-y-auto"
        >
          {loading ? (
            <li className="px-2.5 py-3 text-[13px] text-ink-muted">Searching…</li>
          ) : options.length === 0 ? (
            <li className="px-2.5 py-3 text-[13px] text-ink-muted">No matches</li>
          ) : (
            options.map((option) => {
              const selected = option.ref === selectedRef;
              return (
                <li key={option.ref} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => onSelect(option)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13px] hover:bg-surface-hover",
                      selected && "bg-ai-tint-2 text-primary-hover",
                      FOCUS_RING,
                    )}
                  >
                    <RefChip type={option.type} />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.meta ? (
                      <span className="shrink-0 truncate text-[12px] text-ink-muted">
                        {option.meta}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {onCreate ? (
          <button
            type="button"
            onClick={() => onCreate(query)}
            className={cn(
              "flex w-full items-center gap-2 border-t border-dashed border-border px-2.5 py-2 text-left text-[13px] text-ink-muted hover:text-primary-hover",
              FOCUS_RING,
            )}
          >
            + {createLabel ?? `Create ${label.toLowerCase()}`}
            {query ? <span className="truncate font-medium text-ink">“{query}”</span> : null}
          </button>
        ) : null}
      </div>
    </div>
  );
}
