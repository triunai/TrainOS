import { Banner, Body, Section } from "@/components/kit";
import { AuditTimeline } from "@/components/packages/AuditTimeline";
import { listPackageAudit, verifyChain } from "@/server/audit/ledger";
import { loadPackageRecord } from "@/server/packages/record";

export const dynamic = "force-dynamic";

export default async function PackageAuditPage({ params }: { params: { code: string } }) {
  const { snapshot } = await loadPackageRecord(params.code);
  const [rows, chain] = await Promise.all([listPackageAudit(snapshot.pkg.id, 500), verifyChain()]);
  return (
    <Body>
      <Banner
        tone={chain.ok ? "success" : "danger"}
        title={chain.ok ? `Hash chain intact — ${chain.rows} ledger rows recomputed from genesis` : `Hash chain BROKEN at row #${chain.firstBrokenSeq}`}
      >
        Each checkpoint is SHA-256(previous checkpoint ‖ canonical row). UPDATE, DELETE and TRUNCATE on the ledger are refused by trigger; a row
        altered by anyone who bypassed the triggers breaks every checkpoint after it. Head: <span className="font-mono">{chain.head?.slice(0, 24) ?? "—"}…</span>
      </Banner>
      <Section eyebrow={`${rows.length} entries for ${snapshot.pkg.packageCode}`} title="Audit trail" bodyClassName="py-1">
        <AuditTimeline rows={rows} />
      </Section>
    </Body>
  );
}
