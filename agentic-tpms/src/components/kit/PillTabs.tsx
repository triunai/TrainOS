"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { FOCUS_RING } from "./tokens";

/**
 * FORKED FROM TrainOS kit/PillTabGroup.tsx — the segmented pill group. Two
 * flavours share one geometry: `PillTabs` switches local state, `PillTabNav`
 * is route-driven (package sub-pages).
 */
const SEGMENT =
  "relative flex h-8 min-w-[64px] items-center justify-center gap-1.5 whitespace-nowrap rounded-control px-3 text-[13px] font-medium transition-colors";
const ACTIVE = "border border-primary-border bg-ai-tint-2 text-primary-hover";
const IDLE = "border border-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink";

export interface PillTab {
  id: string;
  label: string;
  count?: number;
}

export function PillTabs({ tabs, activeId, onSelect, label = "Views", className }: { tabs: PillTab[]; activeId: string; onSelect: (id: string) => void; label?: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex w-fit max-w-full items-center gap-0.5 rounded-panel border border-border bg-surface p-0.5", className)}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button key={tab.id} type="button" role="tab" aria-selected={active} onClick={() => onSelect(tab.id)} className={cn(SEGMENT, active ? ACTIVE : IDLE, FOCUS_RING)}>
            <span className="truncate">{tab.label}</span>
            {typeof tab.count === "number" ? <span className={cn("text-[12px] font-normal tabular-nums", active ? "text-primary-hover" : "text-ink-muted")}>{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function PillTabNav({
  tabs,
  activeId,
  className,
  label = "Record sections",
}: {
  tabs: Array<PillTab & { href: string }>;
  activeId: string;
  className?: string;
  /** Accessible name of the nav landmark: what these tabs switch between. */
  label?: string;
}) {
  return (
    <nav aria-label={label} className={cn("inline-flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-panel border border-border bg-surface p-0.5", className)}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <Link key={tab.id} href={tab.href} aria-current={active ? "page" : undefined} className={cn(SEGMENT, active ? ACTIVE : IDLE, FOCUS_RING)}>
            <span className="truncate">{tab.label}</span>
            {typeof tab.count === "number" && tab.count > 0 ? <span className={cn("text-[12px] font-normal tabular-nums", active ? "text-primary-hover" : "text-ink-muted")}>{tab.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
