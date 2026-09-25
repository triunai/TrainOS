import Link from "next/link";
import { LINK_BUTTON, PageHeader } from "@/components/kit";
import { PackageBoard, type BoardCard } from "@/components/packages/PackageBoard";
import { Frame } from "@/components/shell/Frame";
import { LiveRefresh } from "@/components/shell/LiveRefresh";
import { todayMY } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { OPS_STAGES } from "@/server/domain/stages";
import { listPackageCards } from "@/server/packages/queries";
import { readinessLights } from "@/server/packages/readiness";

export const dynamic = "force-dynamic";
export const metadata = { title: "Package board" };

export default async function OperationsBoardPage() {
  const cards = await listPackageCards();
  const today = todayMY();
  const board: BoardCard[] = cards.map((c) => ({
    id: c.id,
    packageCode: c.packageCode,
    title: c.title,
    clientName: c.clientName,
    operationalStage: c.operationalStage,
    financialStage: c.financialStage,
    startDate: c.startDate,
    endDate: c.endDate,
    amount: c.grantApprovedAmount ?? c.quotedAmount,
    participants: c.participants,
    paxEstimate: c.paxEstimate,
    trainerName: c.trainerName,
    deliveryMode: c.deliveryMode,
    pendingDecisions: c.pendingDecisions,
    lights: readinessLights(c, today),
  }));
  const live = board.filter((c) => !["CANCELLED", "DELIVERY_COMPLETED"].includes(c.operationalStage));
  const atRisk = live.filter((c) => c.lights.some((l) => l.light === "red")).length;
  const pipeline = live.reduce((acc, c) => acc + Number(c.amount || 0), 0);
  const lanes = OPS_STAGES.filter((s) => s !== "CANCELLED").map((stage) => ({ id: stage, cards: board.filter((c) => c.operationalStage === stage) }));

  return (
    <Frame crumbs={[{ label: "Operations", href: "/operations" }, { label: "Package board" }]} fill>
      <LiveRefresh />
      <PageHeader
        title="Package board"
        summary={`${live.length} live packages · ${formatRM(pipeline, { compact: true })} in pipeline · ${atRisk} at risk · Trainer × Venue × e-TRiS readiness`}
        actions={
          <>
            <Link href="/operations/list" className={LINK_BUTTON.secondary}>
              List view
            </Link>
            <Link href="/operations/new" className={LINK_BUTTON.secondary}>
              New package
            </Link>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 px-5 pb-5">
        <PackageBoard lanes={lanes} />
      </div>
    </Frame>
  );
}
