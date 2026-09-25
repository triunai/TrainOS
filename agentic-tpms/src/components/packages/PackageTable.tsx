"use client";

import { DataTable, StatusChip, TrafficLights, type TrafficLight } from "@/components/kit";
import { formatRange } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { finLabel, finTone, opsLabel, opsTone } from "./stageTone";

export interface PackageTableRow {
  id: string;
  packageCode: string;
  title: string;
  clientName: string;
  operationalStage: string;
  financialStage: string;
  startDate: string | null;
  endDate: string | null;
  quotedAmount: string;
  grantApprovedAmount: string | null;
  participants: number;
  paxEstimate: number;
  trainerName: string | null;
  lights: TrafficLight[];
}

export function PackageTable({ rows }: { rows: PackageTableRow[] }) {
  return (
    <DataTable
      label="Training packages"
      rows={rows}
      rowKey={(r) => r.id}
      rowHref={(r) => `/operations/${r.packageCode}`}
      columns={[
        { key: "code", label: "Package", cell: (r) => r.packageCode, mono: true, width: "130px" },
        {
          key: "title",
          label: "Client · programme",
          cell: (r) => (
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-ink">{r.clientName}</span>
              <span className="truncate text-[12px] text-ink-secondary">{r.title}</span>
            </div>
          ),
        },
        { key: "dates", label: "Dates", cell: (r) => <span className="whitespace-nowrap">{formatRange(r.startDate, r.endDate)}</span> },
        { key: "ops", label: "Operational", cell: (r) => <StatusChip tone={opsTone(r.operationalStage)}>{opsLabel(r.operationalStage)}</StatusChip> },
        { key: "fin", label: "Financial", cell: (r) => <StatusChip tone={finTone(r.financialStage)}>{finLabel(r.financialStage)}</StatusChip> },
        { key: "ready", label: "Readiness", cell: (r) => <TrafficLights lights={r.lights} /> },
        { key: "pax", label: "Pax", align: "right", cell: (r) => `${r.participants}/${r.paxEstimate}` },
        { key: "amount", label: "Value", align: "right", cell: (r) => formatRM(r.grantApprovedAmount ?? r.quotedAmount, { compact: true }) },
      ]}
    />
  );
}
