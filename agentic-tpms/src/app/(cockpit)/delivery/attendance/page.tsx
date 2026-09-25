import Link from "next/link";
import { Body, DataTable, EmptyState, MetricStrip, MiniBar, PageHeader, StatusChip, type StatusTone } from "@/components/kit";
import { dayLabel } from "@/components/attendance/labels";
import { finLabel, opsLabel, opsTone } from "@/components/packages/stageTone";
import { Frame } from "@/components/shell/Frame";
import { LiveRefresh } from "@/components/shell/LiveRefresh";
import { formatRange } from "@/lib/dates";
import { type AttendanceDeskRow, attendanceDesk } from "@/server/attendance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attendance desk" };

function dayText(r: AttendanceDeskRow): { text: string; tone: StatusTone } {
  if (r.dayOfDelivery === null) return { text: "dates not set", tone: "neutral" };
  if (r.dayOfDelivery === 0) return { text: r.startDate ? `starts ${dayLabel(r.startDate)}` : "not started", tone: "neutral" };
  if (r.dayOfDelivery > r.days) return { text: "all days held", tone: "neutral" };
  return { text: `day ${r.dayOfDelivery} of ${r.days} · today`, tone: "info" };
}

function t3Text(r: AttendanceDeskRow): string {
  if (r.days === 0) return "—";
  const covered = `${r.t3.daysCovered.length}/${r.days} days`;
  const parts = [covered];
  if (r.t3.verified) parts.push(`${r.t3.verified} verified`);
  if (r.t3.flagged) parts.push(`${r.t3.flagged} flagged`);
  if (r.t3.templates === 0) parts.push("not printed");
  return parts.join(" · ");
}

/**
 * Every package in delivery (ready, running or just finished) whose claim is
 * not assembled yet: what each still needs before delivery can be verified.
 * The work itself happens on the package's Attendance tab.
 */
export default async function AttendanceDeskPage() {
  const rows = await attendanceDesk();
  const today = rows.filter((r) => r.dayOfDelivery !== null && r.dayOfDelivery >= 1 && r.dayOfDelivery <= r.days).length;
  const open = rows.reduce((n, r) => n + r.openReviews, 0);
  const overdue = rows.reduce((n, r) => n + r.slots.overdue, 0);
  const flagged = rows.reduce((n, r) => n + r.photos.flagged, 0);
  const ocr = rows.reduce((n, r) => n + r.t3.ocrInFlight, 0);

  return (
    <Frame crumbs={[{ label: "Delivery" }, { label: "Attendance desk" }]}>
      <LiveRefresh />
      <PageHeader
        title="Attendance desk"
        summary="Packages from ready-for-event to delivered whose claim is not yet assembled — Form T3 scans, Track A check-ins, exceptions and session photos in one view."
      >
        <MetricStrip
          cells={[
            { label: "Packages", value: String(rows.length), sub: `${today} in delivery today` },
            { label: "Exceptions to review", value: String(open), sub: "across all packages" },
            { label: "Slots overdue", value: String(overdue), sub: "unrecorded on days already over" },
            { label: "Flagged photos", value: String(flagged), sub: "EXIF outside venue or dates" },
            { label: "OCR in flight", value: String(ocr), sub: "scans waiting for the worker" },
          ]}
        />
      </PageHeader>
      <Body>
        <DataTable
          label="Packages in delivery"
          rows={rows}
          rowKey={(r) => r.packageId}
          rowHref={(r) => `/operations/${r.packageCode}/attendance`}
          empty={<EmptyState title="No package is in delivery" description="Packages appear here from Ready for event until their claim is assembled." />}
          columns={[
            {
              key: "pkg",
              label: "Package",
              cell: (r) => (
                <div className="flex min-w-0 flex-col">
                  <Link href={`/operations/${r.packageCode}/attendance`} className="font-medium text-ink hover:underline">
                    {r.title}
                  </Link>
                  <span className="text-[12px] text-ink-muted">
                    <span className="font-mono text-[11px]">{r.packageCode}</span> · {r.clientName}
                  </span>
                </div>
              ),
            },
            {
              key: "stage",
              label: "Stage",
              cell: (r) => (
                <div className="flex flex-col items-start gap-1">
                  <StatusChip tone={opsTone(r.operationalStage)}>{opsLabel(r.operationalStage)}</StatusChip>
                  <span className="text-[11px] text-ink-muted">{finLabel(r.financialStage)}</span>
                </div>
              ),
            },
            {
              key: "days",
              label: "Days",
              cell: (r) => {
                const d = dayText(r);
                return (
                  <div className="flex flex-col items-start gap-1">
                    <span className="whitespace-nowrap text-[12px] text-ink-secondary">{formatRange(r.startDate, r.endDate)}</span>
                    <StatusChip tone={d.tone} shape="square" className="px-2 py-[1px] text-[11px]">
                      {d.text}
                    </StatusChip>
                  </div>
                );
              },
            },
            {
              key: "slots",
              label: "Slots recorded",
              cell: (r) => (
                <div className="flex min-w-[140px] flex-col gap-1">
                  <span className="tabular-nums">
                    {r.slots.recorded} / {r.slots.expected}
                    <span className="text-[12px] text-ink-muted"> · {r.participants} pax</span>
                  </span>
                  <MiniBar value={r.slots.expected ? r.slots.recorded / r.slots.expected : 0} state={r.slots.missing === 0 && r.slots.expected > 0 ? "success" : r.slots.overdue > 0 ? "warning" : "neutral"} label={`${r.packageCode} slots recorded`} width="120px" />
                  {r.slots.overdue > 0 ? <span className="text-[11px] text-ink-muted">{r.slots.overdue} overdue from past days</span> : null}
                </div>
              ),
            },
            {
              key: "exceptions",
              label: "Exceptions",
              align: "right",
              cell: (r) =>
                r.openReviews > 0 ? (
                  <StatusChip tone="warning">{r.openReviews} to review</StatusChip>
                ) : (
                  <span className="text-[12px] text-ink-muted">none</span>
                ),
            },
            {
              key: "photos",
              label: "Photos",
              cell: (r) => (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="tabular-nums">
                    {r.photos.verified}/{r.photos.total}
                    <span className="text-[12px] text-ink-muted"> verified</span>
                  </span>
                  {r.photos.flagged ? <StatusChip tone="danger" shape="square" className="px-2 py-[1px] text-[11px]">{r.photos.flagged} flagged</StatusChip> : null}
                </div>
              ),
            },
            {
              key: "t3",
              label: "Form T3",
              cell: (r) => (
                <div className="flex flex-col items-start gap-1">
                  <span className="whitespace-nowrap text-[12px] text-ink-secondary">{t3Text(r)}</span>
                  {r.t3.ocrInFlight ? (
                    <StatusChip tone="info" shape="square" className="px-2 py-[1px] text-[11px]">
                      {r.t3.ocrInFlight} OCR queued
                    </StatusChip>
                  ) : null}
                </div>
              ),
            },
            {
              key: "eligible",
              label: "≥ 80%",
              align: "right",
              cell: (r) => (
                <span className="tabular-nums">
                  {r.eligible}/{r.participants}
                </span>
              ),
            },
          ]}
        />
      </Body>
    </Frame>
  );
}
