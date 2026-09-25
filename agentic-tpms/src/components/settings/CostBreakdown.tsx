"use client";

import { useState } from "react";
import { MiniBar, PillTabs } from "@/components/kit";
import { formatRM } from "@/lib/money";

interface Slice {
  key: string;
  costMyr: string;
  calls: number;
  share: number;
}

/** TrainOS M20-S16 "Cost breakdown": one card, three cuts, bars scaled to the largest row. */
export function CostBreakdown({ byTier, byAgent, byModel }: { byTier: Slice[]; byAgent: Slice[]; byModel: Slice[] }) {
  const [view, setView] = useState("tier");
  const rows = view === "tier" ? byTier : view === "agent" ? byAgent : byModel;
  const max = Math.max(0.0001, ...rows.map((r) => Number(r.costMyr)));
  return (
    <div className="flex flex-col gap-3">
      <PillTabs activeId={view} onSelect={setView} tabs={[{ id: "tier", label: "By tier" }, { id: "agent", label: "By agent" }, { id: "model", label: "By model" }]} />
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">No model calls this month. Agents ran on their deterministic templates.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="truncate text-ink">{r.key}</span>
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink">
                  {formatRM(r.costMyr)} <span className="text-ink-muted">· {r.calls} calls</span>
                </span>
              </div>
              <MiniBar value={Number(r.costMyr) / max} label={r.key} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
