import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Body, DefinitionList, RecordHeader, Section, StatusChip } from "@/components/kit";
import { PackageTable } from "@/components/packages/PackageTable";
import { Frame } from "@/components/shell/Frame";
import { todayMY } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { db, schema } from "@/server/db/client";
import { listPackageCards } from "@/server/packages/queries";
import { readinessLights } from "@/server/packages/readiness";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const [client] = await db().select().from(schema.corporateClients).where(eq(schema.corporateClients.id, params.id));
  if (!client) notFound();
  const today = todayMY();
  const packages = (await listPackageCards()).filter((p) => p.clientName === client.companyName).map((c) => ({ ...c, lights: readinessLights(c, today) }));
  const leads = await db().select().from(schema.leadRecords).where(eq(schema.leadRecords.clientId, client.id));
  const live = packages.filter((p) => p.operationalStage !== "CANCELLED").reduce((a, p) => a + Number(p.grantApprovedAmount ?? p.quotedAmount), 0);
  return (
    <Frame crumbs={[{ label: "Pipeline" }, { label: "Clients", href: "/clients" }, { label: client.companyName }]}>
      <RecordHeader
        title={client.companyName}
        chips={<StatusChip tone={client.levyRegistered ? "success" : "warning"}>{client.accountType === "PRIVATE_CASH" ? "Private cash" : client.levyRegistered ? "HRD Corp levy verified" : "Levy unverified"}</StatusChip>}
        meta={[client.companyDomain, client.ssmRegistration ? `SSM ${client.ssmRegistration}` : null, client.hrdcorpMycoid ? `MyCoID ${client.hrdcorpMycoid}` : null]}
        metrics={[
          { label: "Packages", value: String(packages.length) },
          { label: "Lifetime value", value: formatRM(live, { compact: true }) },
          { label: "Malaysian headcount", value: client.malaysianHeadcount ? String(client.malaysianHeadcount) : "—", sub: client.malaysianHeadcount && client.malaysianHeadcount >= 10 ? "levy-liable (≥ 10)" : undefined },
          { label: "Levy balance (est.)", value: formatRM(client.levyBalanceEstimate, { compact: true }) },
        ]}
      />
      <Body>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Section title="Training packages" flush>
            <PackageTable rows={plain(packages)} />
          </Section>
          <div className="flex flex-col gap-4">
            <Section title="Contact">
              <DefinitionList items={[["PIC", client.primaryPicName], ["Email", client.primaryPicEmail], ["Phone", client.primaryPicPhone], ["Industry", client.industrySector ?? "—"], ["Fiscal year end", client.fiscalYearEndMonth ? `month ${client.fiscalYearEndMonth}` : "—"]]} />
            </Section>
            <Section title={`Leads · ${leads.length}`}>
              <ul className="flex flex-col gap-1 text-[13px]">
                {leads.map((l) => (
                  <li key={l.id}>
                    <a href={`/leads/${l.id}`} className="text-primary-hover hover:underline">{l.trainingTopic ?? l.picFullName}</a> <span className="text-ink-muted">· {l.status.toLowerCase()}</span>
                  </li>
                ))}
                {leads.length === 0 ? <li className="text-ink-muted">No leads linked.</li> : null}
              </ul>
            </Section>
          </div>
        </div>
      </Body>
    </Frame>
  );
}
