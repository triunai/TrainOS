import Link from "next/link";
import { AIChip, Body, Checkbox, DataTable, Field, PageHeader, PillTabNav, Select, StatusChip, TextArea, TextInput } from "@/components/kit";
import { NavigatingFormDrawer } from "@/components/demand/NavigatingFormDrawer";
import { CHANNEL_LABEL, ageLabel, intentLabel, l1Provenance, leadStatusMeta, LEAD_STATUS } from "@/components/demand/labels";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { plain } from "@/server/actions";
import { DELIVERY_MODES, DELIVERY_MODE_LABEL } from "@/server/domain/stages";
import { LEAD_STATUSES, QUALIFY_THRESHOLD, REVIEW_THRESHOLD, leadStatusCounts, listLeadInbox, type LeadStatus } from "@/server/ingestion";
import { createLeadAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads" };

function isStatus(value: string | undefined): value is LeadStatus {
  return !!value && (LEAD_STATUSES as readonly string[]).includes(value);
}

export default async function LeadsPage({ searchParams }: { searchParams: { status?: string } }) {
  const status = isStatus(searchParams.status) ? searchParams.status : undefined;
  const [counts, leads] = await Promise.all([leadStatusCounts(), listLeadInbox({ status }).then(plain)]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const now = new Date();
  const dayAgo = now.getTime() - 86_400_000;
  const newToday = leads.filter((l) => new Date(l.createdAt).getTime() >= dayAgo).length;

  return (
    <Frame crumbs={[{ label: "Pipeline" }, { label: "Leads" }]}>
      <PageHeader
        title="Leads"
        summary={`${total} leads from every channel · ${counts.TRIAGE_REVIEW ?? 0} need your triage call · the L1 classifier qualifies at P(levy) ≥ ${QUALIFY_THRESHOLD} and sends ${REVIEW_THRESHOLD}–${QUALIFY_THRESHOLD} to you`}
        actions={
          <NavigatingFormDrawer trigger="New lead" title="New lead" subtitle="MANUAL · phone call, walk-in or event" action={createLeadAction} submitLabel="Record lead">
            <p className="text-[13px] text-ink-secondary">The lead is stored like any webhook lead and queued for L1 triage. Give an email or a mobile number — without one the intake refuses it.</p>
            <Field label="Company"><TextInput name="company" required placeholder="e.g. Hartalega Holdings Berhad" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact person"><TextInput name="name" required /></Field>
              <Field label="SSM number" hint="Optional"><TextInput name="ssm" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Work email"><TextInput name="email" type="email" /></Field>
              <Field label="Mobile / phone"><TextInput name="phone" placeholder="012-345 6789" /></Field>
            </div>
            <Checkbox name="whatsappOptIn" label="Agreed to be contacted on WhatsApp" />
            <Field label="Training need"><TextInput name="topic" placeholder="e.g. Effective supervisory skills" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Participants"><TextInput name="pax" inputMode="numeric" placeholder="e.g. 20" /></Field>
              <Field label="Delivery preference">
                <Select name="delivery" defaultValue="">
                  <option value="">Not stated</option>
                  {DELIVERY_MODES.map((m) => (
                    <option key={m} value={m}>{DELIVERY_MODE_LABEL[m]}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="How it came in"><TextInput name="source" placeholder="Phone call, walk-in, HRD Corp roadshow…" /></Field>
            <Field label="Notes"><TextArea name="message" placeholder="What they said — levy status, headcount, timing" /></Field>
          </NavigatingFormDrawer>
        }
      >
        <PillTabNav
          label="Lead status"
          activeId={status ?? "ALL"}
          tabs={[
            { id: "ALL", label: "All", count: total, href: "/leads" },
            ...LEAD_STATUSES.map((s) => ({ id: s, label: LEAD_STATUS[s].tab, count: counts[s] ?? 0, href: `/leads?status=${s}` })),
          ]}
        />
      </PageHeader>
      <Body>
        <p className="-mt-1 text-[12px] text-ink-muted">
          {leads.length} shown{status ? ` · ${leadStatusMeta(status).label.toLowerCase()}` : ""} · {newToday} in the last 24 h · hover a ✦ chip for the classifier&apos;s provenance
        </p>
        <DataTable
          label="Leads"
          rows={leads}
          rowKey={(l) => l.id}
          rowHref={(l) => `/leads/${l.id}`}
          density="compact"
          empty={<p className="px-3 py-8 text-center text-[13px] text-ink-muted">No leads{status ? " in this status" : " yet"}. Webhooks, the forwarding mailbox and “New lead” all land here.</p>}
          columns={[
            {
              key: "age",
              label: "Age",
              width: "64px",
              cell: (l) => (
                <span title={formatDate(l.createdAt, true)} className="whitespace-nowrap font-mono text-[12px] text-ink-secondary">
                  {ageLabel(l.createdAt, now)}
                </span>
              ),
            },
            {
              key: "source",
              label: "Source",
              cell: (l) => (
                <div className="flex flex-col">
                  <span className="whitespace-nowrap">{CHANNEL_LABEL[l.channel]}</span>
                  <span className="text-[11px] text-ink-muted">{l.isTest ? "platform test" : l.channel === "MANUAL" ? "by an operator" : l.verified ? "signed" : "unsigned"}</span>
                </div>
              ),
            },
            {
              key: "company",
              label: "Company",
              cell: (l) => (
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium text-ink">{l.companyName}</span>
                  <span className="text-[12px] text-ink-muted">{l.companyDomain ?? "no corporate domain"}</span>
                </div>
              ),
            },
            {
              key: "contact",
              label: "Contact",
              cell: (l) => (
                <div className="flex min-w-0 flex-col text-[12px]">
                  <span className="text-[13px] text-ink">{l.picFullName || "—"}</span>
                  <span className="text-ink-muted">{l.picEmail || l.picPhoneE164 || "—"}</span>
                </div>
              ),
            },
            {
              key: "need",
              label: "Enquiry",
              cell: (l) => (
                <div className="flex min-w-0 flex-col">
                  <span className="text-ink">{l.trainingTopic ?? "—"}</span>
                  <span className="text-[12px] text-ink-muted">{l.estimatedPax ? `${l.estimatedPax} pax` : "headcount not given"}</span>
                </div>
              ),
            },
            {
              key: "l1",
              label: "L1 classification",
              cell: (l) =>
                l.l1 ? (
                  <div className="flex flex-col items-start gap-1">
                    <AIChip provenance={l1Provenance(l.l1)} />
                    <span className="whitespace-nowrap text-[12px] text-ink-secondary">
                      {intentLabel(l.l1.intent)} · P(levy) {l.l1.pLevy?.toFixed(2) ?? "—"}
                      {l.l1.abstain ? " · abstained" : ""}
                    </span>
                  </div>
                ) : (
                  <span className="text-[12px] text-ink-muted">{l.status === "DUPLICATE" ? "not classified (duplicate)" : "queued"}</span>
                ),
            },
            {
              key: "status",
              label: "Status",
              cell: (l) => (
                <div className="flex flex-col items-start gap-1">
                  <StatusChip tone={leadStatusMeta(l.status).tone}>{leadStatusMeta(l.status).label}</StatusChip>
                  {l.packageCode ? (
                    <Link href={`/operations/${l.packageCode}`} className="font-mono text-[11px] text-primary-hover hover:underline">
                      {l.packageCode}
                    </Link>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </Body>
    </Frame>
  );
}
