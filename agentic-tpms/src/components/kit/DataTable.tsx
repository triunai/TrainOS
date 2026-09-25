import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ClickableRow } from "./ClickableRow";
import { EmptyState } from "./States";
import { SECTION_LABEL } from "./tokens";

/**
 * FORKED FROM TrainOS kit/DataTable.tsx — high-density table: surface header,
 * zebra rows, sticky head, tabular numbers, row click navigates. Server-safe
 * (no "use client"): cell renderers run wherever the table is rendered, and
 * only ClickableRow ships to the browser.
 */
export interface Column<Row> {
  key: string;
  label: string;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right";
  width?: string;
  mono?: boolean;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  rowHref,
  empty,
  label,
  density = "comfortable",
  className,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string | undefined;
  empty?: ReactNode;
  label: string;
  density?: "comfortable" | "compact";
  className?: string;
}) {
  if (rows.length === 0) {
    return <div className={className}>{empty ?? <EmptyState title="Nothing here yet" description="Rows appear as soon as there is work in this view." />}</div>;
  }
  const pad = density === "compact" ? "px-3 py-1.5" : "px-3 py-[11px]";
  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{label}</caption>
        <thead className="sticky top-0 z-10 bg-surface text-left">
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th key={c.key} scope="col" style={c.width ? { width: c.width } : undefined} className={cn("whitespace-nowrap px-3 py-2", SECTION_LABEL, c.align === "right" && "text-right")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const href = rowHref?.(row);
            const className = cn("border-b border-divider", index % 2 === 1 && "bg-surface/60", href && "cursor-pointer hover:bg-surface-hover");
            const cells = columns.map((c) => (
              <td key={c.key} className={cn(pad, "align-middle", c.align === "right" && "text-right tabular-nums", c.mono && "font-mono text-[12px]")}>
                {c.cell(row)}
              </td>
            ));
            return href ? (
              <ClickableRow key={rowKey(row)} href={href} className={className}>
                {cells}
              </ClickableRow>
            ) : (
              <tr key={rowKey(row)} className={className}>
                {cells}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
