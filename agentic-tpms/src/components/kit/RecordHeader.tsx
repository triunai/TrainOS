"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MetricStrip, type MetricCellProps } from "./MetricStrip";
import { OnAccentProvider } from "./onAccent";

/**
 * FORKED FROM TrainOS kit/RecordHeader.tsx. Record identity appears ONCE per
 * page, here: title, chips, the meta line (reference · client · dates), the
 * view's one primary action, metrics and the stepper. `accent` renders the
 * blue gradient card (tokens --surface-accent-gradient), with every kit child
 * restyled for the blue ground through the OnAccent context.
 */
export interface RecordHeaderProps {
  title: string;
  meta?: Array<string | null | undefined | false>;
  chips?: ReactNode;
  actions?: ReactNode;
  metrics?: MetricCellProps[];
  stepper?: ReactNode;
  accent?: boolean;
  below?: ReactNode;
  className?: string;
}

export function RecordHeader({ title, meta, chips, actions, metrics, stepper, accent, below, className }: RecordHeaderProps) {
  const metaLine = (meta ?? []).filter(Boolean).join(" · ");
  const header = (
    <header
      className={cn(
        "flex flex-col gap-3.5",
        accent ? "mx-5 mb-5 mt-2.5 rounded-panel bg-[image:var(--surface-accent-gradient)] px-6 pb-5 pt-5" : "px-5 pb-4 pt-5",
        className,
      )}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-2.5">
        <h1 className={cn("whitespace-nowrap text-[22px] font-semibold tracking-[-0.015em]", accent && "text-[rgb(var(--on-accent))]")}>{title}</h1>
        {chips}
        {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {metaLine ? (
        <p className={cn("-mt-1.5 font-mono text-[11px] tracking-[0.01em]", accent ? "text-[rgb(var(--on-accent))]" : "text-ink-muted")}>{metaLine}</p>
      ) : null}
      {metrics && metrics.length > 0 ? (
        <div className={cn("flex flex-col", accent && "gap-3.5 pt-0.5")}>
          {accent ? <div aria-hidden="true" className="h-px bg-[rgb(var(--on-accent)/0.18)]" /> : null}
          <MetricStrip cells={metrics} variant={accent ? "accent" : "default"} bare={accent} />
        </div>
      ) : null}
      {stepper ? <div className={cn(accent ? "pt-1" : "border-t border-divider pt-3.5")}>{stepper}</div> : null}
      {below}
    </header>
  );
  return accent ? <OnAccentProvider value={true}>{header}</OnAccentProvider> : header;
}

/** List-screen header: title, one-line summary, actions. Same geometry as RecordHeader. */
export function PageHeader({ title, summary, actions, children }: { title: string; summary?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 px-5 pb-4 pt-5">
      <div className="flex min-h-9 flex-wrap items-center gap-2.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{title}</h1>
        {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {summary ? <p className="-mt-1 text-[13px] text-ink-secondary">{summary}</p> : null}
      {children}
    </header>
  );
}
