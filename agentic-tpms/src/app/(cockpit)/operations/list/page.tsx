import Link from "next/link";
import { LINK_BUTTON, PageHeader, StatusChip, TrafficLights } from "@/components/kit";
import { PackageTable } from "@/components/packages/PackageTable";
import { Frame } from "@/components/shell/Frame";
import { todayMY } from "@/lib/dates";
import { listPackageCards } from "@/server/packages/queries";
import { readinessLights } from "@/server/packages/readiness";

export const dynamic = "force-dynamic";
export const metadata = { title: "All packages" };

export default async function PackageListPage({ searchParams }: { searchParams: { q?: string } }) {
  const cards = await listPackageCards({ search: searchParams.q });
  const today = todayMY();
  const rows = cards.map((c) => ({ ...c, lights: readinessLights(c, today) }));
  void StatusChip;
  void TrafficLights;
  return (
    <Frame crumbs={[{ label: "Operations", href: "/operations" }, { label: "All packages" }]}>
      <PageHeader
        title="All packages"
        summary={`${rows.length} training packages${searchParams.q ? ` matching “${searchParams.q}”` : ""} · both state machines per row`}
        actions={
          <Link href="/operations" className={LINK_BUTTON.secondary}>
            Board view
          </Link>
        }
      />
      <div className="px-5 pb-6">
        <PackageTable rows={JSON.parse(JSON.stringify(rows))} />
      </div>
    </Frame>
  );
}
