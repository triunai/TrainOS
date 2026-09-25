"use client";

import Link from "next/link";
import { KanbanBoard, StatusChip, TrafficLights, type TrafficLight } from "@/components/kit";
import { FOCUS_RING } from "@/components/kit/tokens";
import { cn } from "@/lib/cn";
import { formatRange } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { finLabel, finTone, opsLabel } from "./stageTone";

export interface BoardCard {
  id: string;
  packageCode: string;
  title: string;
  clientName: string;
  operationalStage: string;
  financialStage: string;
  startDate: string | null;
  endDate: string | null;
  amount: string;
  participants: number;
  paxEstimate: number;
  trainerName: string | null;
  deliveryMode: string;
  pendingDecisions: number;
  lights: TrafficLight[];
}

/**
 * The Operations Kanban: one lane per operational stage, in FSM order (the
 * stage list comes from the server's vocabulary, never retyped here). Cards
 * carry the tri-factor lights so a coordinator sees what is at risk without
 * opening anything.
 */
export function PackageBoard({ lanes }: { lanes: Array<{ id: string; cards: BoardCard[] }> }) {
  return (
    <KanbanBoard
      label="Training packages by operational stage"
      lanes={lanes.map((lane) => ({
        id: lane.id,
        label: opsLabel(lane.id),
        summary: `${lane.cards.length} ${lane.cards.length === 1 ? "package" : "packages"} · ${formatRM(
          lane.cards.reduce((acc, c) => acc + Number(c.amount || 0), 0),
          { compact: true },
        )}`,
        items: lane.cards,
      }))}
      itemKey={(c) => c.id}
      emptyLabel="No packages"
      renderItem={(c) => <Card card={c} />}
    />
  );
}

function Card({ card }: { card: BoardCard }) {
  return (
    <Link
      href={`/operations/${card.packageCode}`}
      className={cn("flex flex-col gap-2 rounded-panel border border-border bg-card p-3 shadow-card transition-colors hover:border-border-strong", FOCUS_RING)}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{card.clientName}</p>
        {card.pendingDecisions > 0 ? (
          <span title={`${card.pendingDecisions} decision(s) waiting`} className="inline-flex min-w-[18px] items-center justify-center rounded-pill border border-warning-border bg-warning-fill px-1 font-mono text-[10px] leading-[16px] text-warning">
            {card.pendingDecisions}
          </span>
        ) : null}
      </div>
      <p className="-mt-1.5 truncate text-[12px] text-ink-secondary">{card.title}</p>
      <p className="text-[17px] font-semibold tabular-nums tracking-[-0.01em] text-ink">{formatRM(card.amount, { compact: true })}</p>
      <div className="flex flex-col gap-0.5 text-[12px] text-ink-secondary">
        <span>{formatRange(card.startDate, card.endDate)}</span>
        <span className="flex items-center justify-between">
          <span className="truncate">{card.trainerName ?? "Trainer not sourced"}</span>
          <span className="tabular-nums text-ink-muted">
            {card.participants}/{card.paxEstimate} pax
          </span>
        </span>
      </div>
      <TrafficLights lights={card.lights} />
      <div className="flex items-center justify-between gap-2 border-t border-divider pt-2">
        <span className="font-mono text-[11px] text-ink-muted">{card.packageCode}</span>
        <StatusChip tone={finTone(card.financialStage)} className="px-2 py-[1px] text-[11px]">
          {finLabel(card.financialStage)}
        </StatusChip>
      </div>
    </Link>
  );
}
