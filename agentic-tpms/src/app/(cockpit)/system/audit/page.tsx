import { Banner, Body, PageHeader, Section } from "@/components/kit";
import { AuditTimeline } from "@/components/packages/AuditTimeline";
import { Frame } from "@/components/shell/Frame";
import { listAudit, verifyChain } from "@/server/audit/ledger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit ledger" };

export default async function AuditLedgerPage({ searchParams }: { searchParams: { type?: string } }) {
  const [rows, chain] = await Promise.all([listAudit({ entityType: searchParams.type, limit: 300 }), verifyChain()]);
  return (
    <Frame crumbs={[{ label: "Automation" }, { label: "Audit ledger" }]}>
      <PageHeader title="Audit ledger" summary="Append-only · SHA-256 hash-chained · every stage move carries actor type, actor id and reason code" />
      <Body>
        <Banner tone={chain.ok ? "success" : "danger"} title={chain.ok ? `Chain verified — ${chain.rows} rows recomputed from genesis` : `Chain broken at row #${chain.firstBrokenSeq}`}>
          Head checkpoint <span className="font-mono">{chain.head ?? "—"}</span>. Export this value with any claim pack to prove the trail has not been rewritten since.
        </Banner>
        <Section eyebrow={searchParams.type ? `Filtered: ${searchParams.type}` : "Latest 300"} title="Entries" bodyClassName="py-1">
          <AuditTimeline rows={rows} />
        </Section>
      </Body>
    </Frame>
  );
}
