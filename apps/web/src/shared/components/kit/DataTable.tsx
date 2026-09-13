import { useMemo, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/components/states";
import { FOCUS_RING, SECTION_LABEL, SELECTED_TINT } from "./tokens";
import type { Density } from "./FilterBar";

/**
 * The data table. Kit.dc.html §08, verbatim: "Every list screen in TrainOS is
 * this component with different columns."
 *
 * That sentence is the whole design. Everything a list screen varies — columns,
 * sorting, grouping, selection, density, the empty state — is a prop here, so a
 * screen that needs a table writes no table markup at all. If a screen needs
 * something this does not do, it is added HERE and every list screen gets it.
 *
 * Columns are typed against the row: `accessor` receives the row and returns a
 * node, so a money column and a status column are both just columns and neither
 * needs a special case in this file.
 *
 * Three things in §08 that are easy to get wrong and are therefore built in:
 *
 * 1. Grouped rows with captions — the approval inbox groups by urgency, and the
 *    caption is a real `<tr>` inside the table rather than a heading above a
 *    second table, so one scroll and one sticky header serve every group.
 * 2. A disabled selection checkbox needs a REASON. `bulkApprovable` is false for
 *    any action carrying a monetary value (contract §7); a checkbox that is
 *    simply greyed out teaches the user nothing, so `selectionDisabledReason`
 *    is required whenever selection is disabled and becomes the title and the
 *    accessible name.
 * 3. The selected-row treatment is a tint plus a 2px inset left rule, never a
 *    saturated fill: selection is a state the user set, not a status.
 */

export interface Column<Row> {
  /** Stable key. Also the sort key handed back to `onSort`. */
  key: string;
  /** The column heading, in sentence case. UI font — see the `<th>` below. */
  label: string;
  accessor: (row: Row) => ReactNode;
  align?: "left" | "right";
  /**
   * Cell typography. Brief §1: mono is for machine-ish values only — a ref
   * (`HRDC-2201-8834`), a version, a checksum — so a column opts IN to it here.
   * Numbers are not machine-ish: a right-aligned column gets the UI font with
   * tabular numerals, which is what makes a money column align, and mono makes
   * an amount read as a serial number.
   */
  variant?: "code";
  sortable?: boolean;
  /** Column width, e.g. "120px" or "20%". Omit to share the remainder. */
  width?: string;
  /** A hidden header label for a column whose head should read blank. */
  srOnlyLabel?: boolean;
}

export interface RowGroup<Row> {
  /** Caption above the block, e.g. "Breaching SLA". */
  caption: string;
  /** Rendered beside the caption — a count chip, usually. */
  meta?: ReactNode;
  rows: Row[];
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  /** Flat rows. Mutually exclusive with `groups`. */
  rows?: Row[];
  /** Captioned blocks, for the approval inbox. Mutually exclusive with `rows`. */
  groups?: RowGroup<Row>[];
  rowKey: (row: Row) => string;

  /** Turns on selection. Omit for a read-only table. */
  selectedKeys?: ReadonlySet<string>;
  onSelectionChange?: (keys: ReadonlySet<string>) => void;
  /**
   * Return a reason to forbid selecting this row, or undefined to allow it.
   * The reason is shown — a disabled checkbox with no explanation is a dead end.
   */
  selectionDisabledReason?: (row: Row) => string | undefined;

  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;

  onRowClick?: (row: Row) => void;
  /**
   * Marks a row as carrying an AI suggestion: the row takes the 6% AI tint.
   *
   * CLAUDE.md, verbatim: "AI is the primary hue at 6% tint plus the ✦ glyph and
   * a text label, never a solid fill and never a fourth accent." The tint alone
   * is not enough and is not meant to be — a marked row must still carry an
   * `AIChip` in one of its cells, because colour is not a label and a reader
   * with no colour sees nothing at all. This prop exists so that the ONE way a
   * table says "an agent has something to say about this row" lives here rather
   * than in a `className` each list screen invents for itself.
   *
   * Precedence is deliberate: selection wins over suggestion, and suggestion
   * wins over the zebra stripe. Selection is a state the reader just set and
   * must stay visible; the stripe is only a reading aid.
   */
  rowSuggested?: (row: Row) => boolean;
  density?: Density;
  /** Sticky header. On by default — a long list without one is unreadable. */
  stickyHeader?: boolean;
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode;
  /** Accessible name for the table. */
  label: string;
  className?: string;
}

/* Kit.dc.html draws every cell at 12px horizontal — `px-4` was a rounding of
   that to the nearest Tailwind step, and four extra pixels on both sides of
   five columns is most of why the agent table on M01-S01 read as heavy. */
const PAD: Record<Density, string> = {
  comfortable: "px-3 py-[11px]",
  compact: "px-3 py-1.5",
};

export function DataTable<Row>({
  columns,
  rows,
  groups,
  rowKey,
  selectedKeys,
  onSelectionChange,
  selectionDisabledReason,
  sortKey,
  sortDirection,
  onSort,
  onRowClick,
  rowSuggested,
  density = "comfortable",
  stickyHeader = true,
  empty,
  label,
  className,
}: DataTableProps<Row>) {
  const selectable = Boolean(selectedKeys && onSelectionChange);

  const blocks: RowGroup<Row>[] = useMemo(
    () => groups ?? [{ caption: "", rows: rows ?? [] }],
    [groups, rows],
  );

  const allRows = useMemo(() => blocks.flatMap((block) => block.rows), [blocks]);

  const selectableRows = useMemo(
    () => allRows.filter((row) => !selectionDisabledReason?.(row)),
    [allRows, selectionDisabledReason],
  );

  const allSelected =
    selectableRows.length > 0 && selectableRows.every((row) => selectedKeys?.has(rowKey(row)));

  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? new Set() : new Set(selectableRows.map((row) => rowKey(row))));
  };

  const toggleOne = (key: string) => {
    if (!onSelectionChange || !selectedKeys) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };

  if (allRows.length === 0) {
    return (
      <div className={className}>
        {empty ?? (
          <EmptyState
            title="No results"
            description="No rows match the filters in play. Clear a filter to widen the search."
          />
        )}
      </div>
    );
  }

  const columnCount = columns.length + (selectable ? 1 : 0);

  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{label}</caption>

        <thead className={cn("bg-surface text-left", stickyHeader && "sticky top-0 z-10")}>
          <tr className="border-b border-border">
            {selectable ? (
              <th scope="col" className="w-9 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={allSelected ? "Clear selection" : "Select all rows"}
                  className={cn("h-3.5 w-3.5 accent-primary", FOCUS_RING)}
                />
              </th>
            ) : null}

            {columns.map((column) => {
              const sorted = sortKey === column.key;

              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={
                    sorted ? (sortDirection === "desc" ? "descending" : "ascending") : undefined
                  }
                  className={cn(
                    /* UI font, sentence case (tightening brief §1). Mono is
                       for machine-ish values — a ref, a version, a hash — and a
                       column heading is a label. Tracked uppercase mono is also
                       half of the combination §9 names as the thing that reads
                       as generated. Every screen already passes a sentence-case
                       label, so this is the whole migration.

                       The style itself now lives in `SECTION_LABEL`: this head
                       migrated first and held the rule as a literal, and a rule
                       with two homes is the divergence CLAUDE.md forbids. */
                    "whitespace-nowrap px-3 py-2",
                    SECTION_LABEL,
                    column.align === "right" && "text-right",
                  )}
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-[4px] hover:text-ink",
                        sorted && "text-ink",
                        FOCUS_RING,
                      )}
                    >
                      <span className={cn(column.srOnlyLabel && "sr-only")}>{column.label}</span>
                      <span aria-hidden="true" className="text-[9px]">
                        {sorted ? (sortDirection === "desc" ? "▾" : "▴") : "⇅"}
                      </span>
                    </button>
                  ) : (
                    <span className={cn(column.srOnlyLabel && "sr-only")}>{column.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {blocks.map((block, blockIndex) => (
            <TableBlock
              key={block.caption || `block-${blockIndex}`}
              block={block}
              columns={columns}
              columnCount={columnCount}
              rowKey={rowKey}
              selectable={selectable}
              selectedKeys={selectedKeys}
              onToggle={toggleOne}
              selectionDisabledReason={selectionDisabledReason}
              onRowClick={onRowClick}
              rowSuggested={rowSuggested}
              density={density}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableBlock<Row>({
  block,
  columns,
  columnCount,
  rowKey,
  selectable,
  selectedKeys,
  onToggle,
  selectionDisabledReason,
  onRowClick,
  rowSuggested,
  density,
}: {
  block: RowGroup<Row>;
  columns: Column<Row>[];
  columnCount: number;
  rowKey: (row: Row) => string;
  selectable: boolean;
  selectedKeys?: ReadonlySet<string>;
  onToggle: (key: string) => void;
  selectionDisabledReason?: (row: Row) => string | undefined;
  onRowClick?: (row: Row) => void;
  rowSuggested?: (row: Row) => boolean;
  density: Density;
}) {
  return (
    <>
      {block.caption ? (
        <tr>
          <th
            colSpan={columnCount}
            scope="colgroup"
            /* The group caption is a header too, so it takes the same
               typography as the column heads: UI font, sentence case as the
               screen passed it, muted ink. */
            className={cn(
              "border-b border-t border-divider bg-surface px-3 py-1.5 text-left",
              SECTION_LABEL,
            )}
          >
            <span className="inline-flex items-center gap-2">
              {block.caption}
              {block.meta}
            </span>
          </th>
        </tr>
      ) : null}

      {block.rows.map((row, index) => {
        const key = rowKey(row);
        const selected = selectedKeys?.has(key) ?? false;
        const suggested = rowSuggested?.(row) ?? false;
        const disabledReason = selectionDisabledReason?.(row);

        return (
          <tr
            key={key}
            aria-selected={selectable ? selected : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            data-suggested={suggested ? "" : undefined}
            className={cn(
              "border-b border-divider",
              /* Zebra, per §08. Only on the un-selected rows — a tint on a tint
                 is a third surface nobody asked for — and not under a suggested
                 row either, for the same reason. */
              index % 2 === 1 && !selected && !suggested && "bg-surface/60",
              /* The 6% AI tint. Never a fill: the row still reads as a row, and
                 the chip in it is what says why it is marked. */
              suggested && !selected && "bg-ai-tint",
              /* A selected row raises its own muted floor (verification row
                 1b). `--ai-tint-2` is the selected row AND the active-nav
                 tint, and `--ink-muted` on it measures 4.36:1 in light — under
                 AA, and only in light, because the dark pair is 4.55:1.

                 Lightening the tint is not the fix: it would land 0.9 L* from
                 `--ai-tint` and the suggested row and the selected row would
                 stop being two surfaces. Retargeting the cells one by one is
                 not the fix either — the muted ink is inside the CELL
                 RENDERERS a screen passes, which this component never sees.

                 So the row rebinds the token for its own subtree:
                 `--ink-muted` resolves to `--ink-secondary` (6.54:1 light,
                 6.69:1 dark) inside a selected row. Every `text-ink-muted`
                 descendant follows, in both themes, with no call site knowing.
                 It is a scope, not a second colour: nothing new enters the
                 palette and the unselected rows are untouched. */
              selected && cn(SELECTED_TINT, "shadow-[inset_2px_0_0_rgb(var(--primary))]"),
              onRowClick && "cursor-pointer hover:bg-surface-hover",
            )}
          >
            {selectable ? (
              <td className={cn("w-9", PAD[density])}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={Boolean(disabledReason)}
                  onChange={() => onToggle(key)}
                  onClick={(event) => event.stopPropagation()}
                  /* The reason IS the label when selection is forbidden. §7:
                     `bulkApprovable` is false for anything carrying money, and
                     the user deserves to know that rather than guess. */
                  aria-label={disabledReason ?? `Select ${key}`}
                  title={disabledReason}
                  className={cn(
                    "h-3.5 w-3.5 accent-primary disabled:cursor-not-allowed disabled:opacity-40",
                    FOCUS_RING,
                  )}
                />
              </td>
            ) : null}

            {columns.map((column) => (
              <td
                key={column.key}
                className={cn(
                  PAD[density],
                  "align-middle text-ink",
                  column.align === "right" && "text-right",
                  /* Brief §1: a number is set in the UI font with tabular
                     numerals, never in mono. Right-aligned means numeric here —
                     money, pax, counts — and the figures line up because the
                     numerals are tabular, not because the face is monospaced. */
                  column.align === "right" && column.variant !== "code" && "tabular-nums",
                  /* Mono only where the column said so: a ref, a version, an
                     id. Opting in is the column's job, never this file's. */
                  column.variant === "code" && "font-mono",
                )}
              >
                {column.accessor(row)}
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

export interface BulkActionBarProps {
  count: number;
  /** Buttons. The pack's sample is Assign / Tag / Export / Archive. */
  children: ReactNode;
  onClear: () => void;
  className?: string;
}

/**
 * The bulk-action bar. §08: appears only when at least one row is selected, on
 * the AI tint. It is announced live — a bar that slides in silently is a bar a
 * screen-reader user never learns exists.
 */
export function BulkActionBar({ count, children, onClear, className }: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div
      role="status"
      className={cn(
        SELECTED_TINT,
        "flex flex-wrap items-center gap-3 border-b border-primary-border px-4 py-2",
        className,
      )}
    >
      <span className="text-[13px] font-medium text-primary-hover">{count} selected</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className={cn(
          "ml-auto rounded-[4px] text-[12px] text-ink-secondary hover:text-ink",
          FOCUS_RING,
        )}
      >
        Clear
      </button>
    </div>
  );
}
