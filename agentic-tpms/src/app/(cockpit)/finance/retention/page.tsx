import Link from "next/link";
import { AIChip, Body, DataTable, EmptyState, Field, MetricStrip, PageHeader, PillTabNav, type ProvenanceLike, Section, StatusChip, TextArea, TextInput } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { RETENTION_STATUS_LABEL, RETENTION_TONE } from "@/components/finance/tones";
import { Frame } from "@/components/shell/Frame";
import { addDays, daysBetween, formatDate, todayMY } from "@/lib/dates";
import { plain } from "@/server/actions";
import { OPERATORS } from "@/server/auth/operator";
import { CADENCE_LABEL, CADENCES, listRetentionDesk, type Cadence, type RetentionDeskRow } from "@/server/retention";
import { approveRetentionAction, skipRetentionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retention" };

/** What each cadence does. R14: total over the domain's CADENCES. */
const CADENCE_DOES: Record<Cadence, string> = {
  EXECUTIVE_PACK_T14: "Fourteen days after the last training day: attendance, Kirkpatrick L2 pre/post scores and certificate links, as a PDF pack for the client's decision maker.",
  SYLLABUS_LADDER_T90: "Ninety days after: the next course up the catalogue ladder for the same cohort, with its outline.",
  LEVY_YEAR_END_T300: "Levy-paying clients only: 300 days after, or 60 days before the client's levy year ends when that is sooner, while unused levy can still fund one more grant.",
};

const VIEWS = [
  { id: "review", label: "To review", statuses: ["DRAFTED", "APPROVED"] },
  { id: "scheduled", label: "Scheduled", statuses: ["PENDING"] },
  { id: "sent", label: "Sent", statuses: ["DISPATCHED"] },
  { id: "skipped", label: "Skipped", statuses: ["SKIPPED"] },
] as const;

type Prov = {
  draft?: ProvenanceLike;
  basis?: string;
  approval?: { by?: string; at?: string; edited?: boolean };
  dispatch?: { status?: string; by?: string };
  skipped?: { by?: string; at?: string };
};
const prov = (r: RetentionDeskRow) => (r.provenance ?? {}) as Prov;
const operatorName = (id?: string) => (id ? OPERATORS.find((o) => o.id === id)?.name ?? id : "—");
const cadence = (r: RetentionDeskRow) => CADENCE_LABEL[r.cadenceType as Cadence] ?? r.cadenceType;

function due(date: string, today: string): string {
  const d = daysBetween(today, date);
  return d === 0 ? "due today" : d < 0 ? `due ${-d} days ago` : `in ${d} days`;
}

function PackageCell({ r }: { r: RetentionDeskRow }) {
  return (
    <div className="flex min-w-0 flex-col">
      <Link href={`/operations/${r.packageCode}`} className="font-mono text-[12px] text-primary-hover hover:underline">{r.packageCode}</Link>
      <span className="max-w-[180px] truncate text-[12px] text-ink-muted" title={r.clientName}>{r.clientName}</span>
    </div>
  );
}

function SkipButton({ r }: { r: RetentionDeskRow }) {
  return (
    <ActionButton
      action={skipRetentionAction}
      args={[r.id]}
      label="Skip"
      kind="ghost"
      confirm={{ title: `Skip ${cadence(r)} for ${r.packageCode}?`, body: "Nothing is sent for this cadence and it cannot be reopened. The other cadences stay scheduled.", confirmLabel: "Skip cadence" }}
      reason={{ label: "Why is this cadence skipped?", placeholder: "e.g. the client asked us to reconnect after their budget cycle", minLength: 5 }}
    />
  );
}

/** The draft's first substantive lines: the greeting is dropped and line breaks folded for a two-line preview. */
function preview(body: string | null): string {
  return (body ?? "").replace(/^\s*Dear[^\n]*\n+/, "").replace(/\s+/g, " ").trim();
}

function DraftItem({ r, today }: { r: RetentionDeskRow; today: string }) {
  const p = prov(r);
  const retry = r.status === "APPROVED";
  return (
    <li className="flex flex-col gap-1 border-b border-divider px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-ink">{cadence(r)}</span>
        <AIChip provenance={p.draft ?? { tier: "L4" }} />
        {retry ? <StatusChip tone={RETENTION_TONE[r.status]}>{RETENTION_STATUS_LABEL[r.status]}</StatusChip> : null}
        <div className="ml-auto flex items-center gap-1">
          <FormDrawer
            trigger={retry ? "Retry send" : "Review & send"}
            title={`${cadence(r)} · ${r.packageCode}`}
            subtitle={`To ${r.picName} <${r.picEmail}>`}
            action={approveRetentionAction}
            submitLabel={retry ? "Send again" : "Approve & send"}
          >
            <input type="hidden" name="scheduleId" value={r.id} />
            <input type="hidden" name="originalSubject" value={r.draftSubject ?? ""} />
            <input type="hidden" name="originalBody" value={r.draftBody ?? ""} />
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
              <AIChip provenance={p.draft ?? { tier: "L4" }} />
              <span>drafted by {p.draft?.agent ?? "the retention agent"} from the package&apos;s own records; edit anything before it goes.</span>
            </div>
            <Field label="Subject"><TextInput name="subject" required minLength={5} maxLength={255} defaultValue={r.draftSubject ?? ""} /></Field>
            <Field label="Message" hint={r.vaultId ? "The PDF pack is attached as drafted." : undefined}>
              <TextArea name="body" required minLength={20} rows={16} defaultValue={r.draftBody ?? ""} />
            </Field>
            <p className="text-[12px] text-ink-muted">Approving sends it now under your name and records it in the audit ledger. Mail is logged instead of sent until SMTP is configured.</p>
          </FormDrawer>
          <SkipButton r={r} />
        </div>
      </div>
      <p className="text-[12px] text-ink-muted">
        <Link href={`/operations/${r.packageCode}`} className="font-mono text-primary-hover hover:underline">{r.packageCode}</Link> · {r.clientName} · due {formatDate(r.scheduledFor)} ({due(r.scheduledFor, today).replace(/^due /, "")})
      </p>
      <p className="pt-1 text-[13px] font-medium text-ink">{r.draftSubject}</p>
      <p className="line-clamp-2 max-w-[760px] text-[12px] text-ink-secondary">{preview(r.draftBody)}</p>
      <p className="text-[12px] text-ink-muted">
        To {r.picName} · {r.picEmail}
        {r.vaultId ? (
          <>
            {" · "}
            <a href={`/api/v1/vault/${r.vaultId}`} target="_blank" rel="noreferrer" className="text-primary-hover hover:underline">attachment</a>
          </>
        ) : null}
        {r.recommendedCourse ? ` · recommends ${r.recommendedCourse.title} (${r.recommendedCourse.code})` : ""}
      </p>
    </li>
  );
}

export default async function RetentionPage({ searchParams }: { searchParams: { view?: string } }) {
  const rows = plain(await listRetentionDesk());
  const today = todayMY();
  const view = VIEWS.find((v) => v.id === searchParams.view) ?? VIEWS[0];
  const inView = (statuses: readonly string[]) => rows.filter((r) => statuses.includes(r.status));
  const visible = inView(view.statuses);
  const dueSoon = rows.filter((r) => r.status === "PENDING" && r.scheduledFor <= addDays(today, 30)).length;

  return (
    <Frame crumbs={[{ label: "Claims & AP" }, { label: "Retention" }]}>
      <PageHeader title="Retention" summary="Stage 7 · three client cadences per delivered package · an agent drafts each one when it falls due; nothing reaches the client until you approve it">
        <MetricStrip
          cells={[
            { label: "Drafts to review", value: String(inView(VIEWS[0].statuses).length), sub: "waiting on you" },
            { label: "Due in 30 days", value: String(dueSoon), sub: "drafted on the day" },
            { label: "Sent", value: String(inView(VIEWS[2].statuses).length) },
            { label: "Skipped", value: String(inView(VIEWS[3].statuses).length) },
          ]}
        />
      </PageHeader>
      <Body>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <PillTabNav label="Retention view" activeId={view.id} tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, count: inView(v.statuses).length, href: `/finance/retention?view=${v.id}` }))} />
            {visible.length === 0 ? (
              <Section>
                <EmptyState title={view.id === "review" ? "No drafts waiting" : `Nothing ${view.label.toLowerCase()}`} description={view.id === "review" ? "Each cadence is drafted on its due date and lands here for review." : undefined} />
              </Section>
            ) : view.id === "review" ? (
              <Section flush eyebrow="Human in the loop" title={`${visible.length} ${visible.length === 1 ? "draft" : "drafts"} to review`}>
                <ul>
                  {visible.map((r) => (
                    <DraftItem key={r.id} r={r} today={today} />
                  ))}
                </ul>
              </Section>
            ) : view.id === "scheduled" ? (
              <Section flush>
                <DataTable
                  label="Scheduled cadences"
                  rows={visible}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: "due", label: "Due", cell: (r) => (<div className="flex flex-col"><span className="tabular-nums">{formatDate(r.scheduledFor)}</span><span className="text-[12px] text-ink-muted">{due(r.scheduledFor, today)}</span></div>) },
                    { key: "pkg", label: "Package", cell: (r) => <PackageCell r={r} /> },
                    { key: "cadence", label: "Cadence", cell: (r) => cadence(r) },
                    { key: "skip", label: "", align: "right", cell: (r) => <SkipButton r={r} /> },
                  ]}
                />
              </Section>
            ) : view.id === "sent" ? (
              <Section flush>
                <DataTable
                  label="Sent cadences"
                  rows={visible}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: "sent", label: "Sent", cell: (r) => (<div className="flex flex-col whitespace-nowrap"><span>{formatDate(r.dispatchedAt)}</span><span className="text-[12px] text-ink-muted">{formatDate(r.dispatchedAt, true).split(", ")[1] ?? ""}</span></div>) },
                    { key: "pkg", label: "Package", cell: (r) => <PackageCell r={r} /> },
                    { key: "cadence", label: "Cadence", cell: (r) => (<div className="flex flex-col"><span className="whitespace-nowrap">{cadence(r)}</span><span className="max-w-[200px] truncate text-[12px] text-ink-muted" title={r.draftSubject ?? ""}>{r.draftSubject}</span></div>) },
                    {
                      key: "to",
                      label: "To · approved by",
                      cell: (r) => (
                        <div className="flex flex-col">
                          <span className="max-w-[180px] truncate text-[12px]" title={r.picEmail}>{r.picEmail}</span>
                          <span className="whitespace-nowrap text-[12px] text-ink-muted">{operatorName(prov(r).approval?.by)}{prov(r).approval?.edited ? " · edited" : ""}</span>
                        </div>
                      ),
                    },
                    { key: "via", label: "Delivery", cell: (r) => <span className="font-mono text-[12px] text-ink-muted" title={prov(r).dispatch?.status === "LOGGED" ? "Recorded in the outbound log; SMTP is not configured" : undefined}>{prov(r).dispatch?.status?.toLowerCase() ?? "—"}</span> },
                  ]}
                />
              </Section>
            ) : (
              <Section flush>
                <DataTable
                  label="Skipped cadences"
                  rows={visible}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: "pkg", label: "Package", cell: (r) => <PackageCell r={r} /> },
                    { key: "cadence", label: "Cadence", cell: (r) => <span className="whitespace-nowrap">{cadence(r)}</span> },
                    { key: "due", label: "Was due", cell: (r) => <span className="whitespace-nowrap">{formatDate(r.scheduledFor)}</span> },
                    { key: "reason", label: "Reason", cell: (r) => <span className="text-[12px] text-ink-secondary">{r.responseNotes}</span> },
                    { key: "by", label: "Skipped by", cell: (r) => operatorName(prov(r).skipped?.by) },
                  ]}
                />
              </Section>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Section eyebrow="Stage 7" title="The three cadences">
              <ul className="flex flex-col gap-3">
                {CADENCES.map((c) => (
                  <li key={c} className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-ink">{CADENCE_LABEL[c]}</span>
                    <span className="text-[12px] text-ink-secondary">{CADENCE_DOES[c]}</span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section eyebrow="Agents propose, you dispose" title="How a draft is made">
              <p className="text-[12px] text-ink-secondary">
                On the due date the L4 retention agent writes the email from the package&apos;s own facts (attendance, scores, the catalogue ladder, the client&apos;s levy year). With no model key it uses a deterministic template and its chip says so. Approve sends it to the client&apos;s primary contact; skip closes the cadence with your reason.
              </p>
            </Section>
          </div>
        </div>
      </Body>
    </Frame>
  );
}
