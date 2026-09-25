import { Body, DataTable, PageHeader, StatusChip } from "@/components/kit";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { listClients } from "@/server/clients/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: { q?: string } }) {
  const clients = plain(await listClients(searchParams.q));
  return (
    <Frame crumbs={[{ label: "Pipeline" }, { label: "Clients" }]}>
      <PageHeader title="Clients" summary={`${clients.length} corporate accounts · SBL-Khas levy contributors and private-cash accounts`} />
      <Body>
        <DataTable
          label="Clients"
          rows={clients}
          rowKey={(c) => c.id}
          rowHref={(c) => `/clients/${c.id}`}
          columns={[
            { key: "name", label: "Company", cell: (c) => (<div className="flex flex-col"><span className="font-medium">{c.companyName}</span><span className="text-[12px] text-ink-muted">{c.companyDomain ?? "—"} · SSM {c.ssmRegistration ?? "—"}</span></div>) },
            { key: "account", label: "Account", cell: (c) => <StatusChip tone={c.accountType === "SBL_KHAS_LEVY" ? (c.levyRegistered ? "success" : "warning") : "neutral"}>{c.accountType === "SBL_KHAS_LEVY" ? (c.levyRegistered ? "Levy verified" : "Levy unverified") : "Private cash"}</StatusChip> },
            { key: "pic", label: "PIC", cell: (c) => (<div className="flex flex-col text-[12px]"><span>{c.primaryPicName}</span><span className="text-ink-muted">{c.primaryPicEmail}</span></div>) },
            { key: "pk", label: "Packages", align: "right", cell: (c) => String(c.packages) },
            { key: "live", label: "Live value", align: "right", cell: (c) => formatRM(c.liveValue, { compact: true }) },
            { key: "settled", label: "Settled", align: "right", cell: (c) => formatRM(c.settledValue, { compact: true }) },
            { key: "fye", label: "FYE", cell: (c) => (c.fiscalYearEndMonth ? new Date(2026, c.fiscalYearEndMonth - 1, 1).toLocaleString("en-GB", { month: "short" }) : "—") },
            { key: "last", label: "Last training", cell: (c) => formatDate(c.lastStart) },
          ]}
        />
      </Body>
    </Frame>
  );
}
