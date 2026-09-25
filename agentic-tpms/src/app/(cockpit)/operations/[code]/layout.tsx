import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RecordHeader, StatusChip } from "@/components/kit";
import { DualStepper } from "@/components/packages/DualStepper";
import { PackageBreadcrumb, PackageTabs } from "@/components/packages/PackageNav";
import { finLabel, finTone, opsLabel, opsTone } from "@/components/packages/stageTone";
import { Frame } from "@/components/shell/Frame";
import { LiveRefresh } from "@/components/shell/LiveRefresh";
import { daysBetween, formatRange } from "@/lib/dates";
import { formatRM, pct, toNumber } from "@/lib/money";
import { DELIVERY_MODE_LABEL, type DeliveryMode } from "@/server/domain/stages";
import { isDomainError } from "@/server/domain/errors";
import { loadPackageRecord } from "@/server/packages/record";

export const dynamic = "force-dynamic";

export default async function PackageLayout({ params, children }: { params: { code: string }; children: ReactNode }) {
  const record = await loadPackageRecord(params.code).catch((error) => {
    if (isDomainError(error)) notFound();
    throw error;
  });
  const { snapshot: s, pendingDecisions } = record;
  const p = s.pkg;
  const q = s.latestQuotation;
  const daysToStart = p.startDate ? daysBetween(s.today, p.startDate) : null;

  const counts = {
    overview: pendingDecisions.length,
    participants: s.participants.active,
    attendance: s.attendance.openReviews,
    claims: s.vouchers.filter((v) => v.status !== "PAID" && v.status !== "CANCELLED").length,
  };

  return (
    <Frame breadcrumb={<PackageBreadcrumb code={p.packageCode} />}>
      <LiveRefresh entityId={p.id} />
      <RecordHeader
        accent
        title={p.title}
        chips={
          <>
            <StatusChip tone={opsTone(p.operationalStage)} live>
              {opsLabel(p.operationalStage)}
            </StatusChip>
            <StatusChip tone={finTone(p.financialStage)}>{finLabel(p.financialStage)}</StatusChip>
            {p.vendorAutoconfirmHalted ? <StatusChip tone="warning">Vendor confirmations halted</StatusChip> : null}
          </>
        }
        meta={[
          p.packageCode,
          s.client.companyName,
          formatRange(p.startDate, p.endDate),
          DELIVERY_MODE_LABEL[p.deliveryMode as DeliveryMode] ?? p.deliveryMode,
          p.etrisGrantId ? `e-TRiS ${p.etrisGrantId}` : null,
        ]}
        metrics={[
          { label: "Quoted", value: formatRM(p.quotedAmount, { compact: true }), sub: p.costPolicyVersion ?? "not priced" },
          { label: "Allowable cap", value: formatRM(p.allowableCostCap, { compact: true }), sub: p.allowableCostCap ? `${pct((toNumber(p.quotedAmount) / Math.max(1, toNumber(p.allowableCostCap))) * 100, 0)} used` : "—" },
          { label: "Grant approved", value: formatRM(p.grantApprovedAmount, { compact: true }), sub: p.grantApprovedPax ? `${p.grantApprovedPax} pax approved` : "pending" },
          { label: "Cohort", value: `${s.participants.active} / ${p.paxEstimate}`, sub: `min ${p.minParticipants} · ${s.participants.eligible} eligible` },
          { label: "Gross margin", value: q ? pct(Number(q.marginPct), 1) : "—", sub: q ? formatRM(q.grossMargin, { compact: true }) : "no quotation" },
          { label: "Starts in", value: daysToStart === null ? "—" : daysToStart >= 0 ? `${daysToStart} days` : "started", sub: daysToStart !== null && daysToStart >= 0 && daysToStart <= 14 ? "inside T-14" : undefined },
        ]}
        stepper={<DualStepper ops={p.operationalStage} fin={p.financialStage} />}
      />
      <div className="px-5 pb-4">
        <PackageTabs code={p.packageCode} counts={counts} />
      </div>
      {children}
    </Frame>
  );
}
