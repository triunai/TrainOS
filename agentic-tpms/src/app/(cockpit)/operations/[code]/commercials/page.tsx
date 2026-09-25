import { AIChip, Banner, Body, DataTable, DefinitionList, Section, StatusChip, type StatusTone } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { QuoteDesk } from "@/components/commercial/QuoteDesk";
import { formatDate } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { getCommercialView } from "@/server/commercial";
import type { CourseOutline } from "@/server/commercial";
import type { StoredLineItem } from "@/server/pricing";
import { loadPackageRecord } from "@/server/packages/record";
import { approveAndDispatchAction, clientAcceptedAction, draftProposalAction, recomputeAction, requestRevisionAction, saveRevisionAction } from "./actions";

export const dynamic = "force-dynamic";

const Q_TONE: Record<string, StatusTone> = { DRAFT: "neutral", AWAITING_APPROVAL: "warning", APPROVED: "success", SUPERSEDED: "neutral", REJECTED: "danger" };

export default async function CommercialsPage({ params }: { params: { code: string } }) {
  const { snapshot: s } = await loadPackageRecord(params.code);
  const view = plain(await getCommercialView(s.pkg.id));
  const q = view.latest;
  const outline = (q?.courseOutline ?? null) as CourseOutline | null;
  const lines = (q?.lineItems ?? []) as StoredLineItem[];
  const editable = Object.entries(view.canvas.editableCells).map(([name]) => ({ name, cell: view.canvas.cellAddresses[name] }));
  const stage = view.pkg.operationalStage;
  const provenance = (q?.provenance ?? null) as Record<string, unknown> | null;

  if (!q) {
    return (
      <Body>
        <Section eyebrow="HITL Gate 1" title="Commercial outbox & quotation desk">
          <div className="flex flex-col gap-3 text-[13px] text-ink-secondary">
            <p>
              No quotation yet. The commercial sourcing agent (L3) matches a catalogue course by pgvector search, proposes a TTT-verified trainer and a venue, prices the job with the headless Univer engine against the Allowable Cost Matrix, and drafts the Form HRD-L&D outline. Nothing reaches the client until you approve it here.
            </p>
            {stage === "DRAFT" ? <ActionButton action={draftProposalAction} args={[view.pkg.packageCode]} label="Draft proposal" /> : null}
          </div>
        </Section>
      </Body>
    );
  }

  return (
    <Body>
      {view.pendingDecision ? (
        <Banner tone="warning" title={`Awaiting your approval · version ${q.version}`}>
          {view.pendingDecision.summary}
        </Banner>
      ) : null}
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            eyebrow="HITL Gate 1 · Allowable Cost Matrix worksheet"
            title={`Quotation v${q.version}`}
            actions={
              <div className="flex items-center gap-2">
                <AIChip provenance={provenance ? { ...provenance, tier: (provenance.tier as string) ?? "L3" } : undefined} variant={q.generatedBy === "USER" ? "rule" : undefined} label={q.generatedBy === "USER" ? `Edited by ${q.approvedBy ?? "operator"}` : undefined} />
                <StatusChip tone={Q_TONE[q.status] ?? "neutral"}>{q.status.toLowerCase().replace("_", " ")}</StatusChip>
              </div>
            }
          >
            <QuoteDesk
              code={view.pkg.packageCode}
              snapshot={(q.sheetSnapshot as Record<string, unknown>) ?? null}
              editable={editable}
              quotationId={q.id}
              awaitingApproval={q.status === "AWAITING_APPROVAL" && stage === "DRAFT"}
              recompute={recomputeAction as never}
              saveRevision={saveRevisionAction}
              approve={approveAndDispatchAction}
            />
          </Section>

          <Section eyebrow="Line items" title={`${formatRM(q.quotedAmount)} quoted · cap ${formatRM(q.allowableCap)} · ${Number(q.marginPct).toFixed(1)}% margin`} flush>
            <DataTable
              label="Line items"
              rows={lines}
              rowKey={(l) => l.code}
              density="compact"
              columns={[
                { key: "label", label: "Item", cell: (l) => l.label },
                { key: "kind", label: "Kind", cell: (l) => <StatusChip tone={l.kind === "FEE" ? "info" : "neutral"} shape="square" className="text-[11px]">{l.kind.toLowerCase()}</StatusChip> },
                { key: "qty", label: "Qty", align: "right", cell: (l) => `${l.qty} ${l.unit}` },
                { key: "unit", label: "Unit cost", align: "right", cell: (l) => formatRM(l.unitCost) },
                { key: "amount", label: "Amount", align: "right", cell: (l) => formatRM(l.amount) },
              ]}
            />
          </Section>

          {outline ? (
            <Section eyebrow="Form HRD-L&D" title={outline.courseTitle}>
              <div className="flex flex-col gap-3">
                <DefinitionList
                  items={[
                    ["Course code", outline.courseCode],
                    ["HRD focus area", outline.focusArea],
                    ["NOSS reference", outline.nossReference ? `${outline.nossReference} (illustrative)` : "—"],
                    ["Target audience", outline.targetAudience],
                    ["Duration", `${outline.durationDays} day(s) · ${outline.totalHours} contact hours`],
                  ]}
                />
                <div>
                  <p className="pb-1 text-[12px] font-medium text-ink-muted">Learning outcomes (Bloom&apos;s taxonomy, L0-validated)</p>
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {outline.learningOutcomes.map((o, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-6 shrink-0 font-mono text-[11px] text-ink-muted">L{o.bloomLevel}</span>
                        <span>
                          <span className="font-semibold">{o.verb}</span> {o.outcome.replace(new RegExp(`^${o.verb}\\s*`, "i"), "")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="pb-1 text-[12px] font-medium text-ink-muted">Modules</p>
                  <ol className="grid grid-cols-1 gap-1 text-[13px] md:grid-cols-2">
                    {outline.modules.map((m, i) => (
                      <li key={i} className="text-ink-secondary">
                        <span className="text-ink">{i + 1}. {(m as { title?: string }).title ?? String(m)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="pb-1 text-[12px] font-medium text-ink-muted">Workplace productivity justification</p>
                  <p className="text-[13px] text-ink-secondary">{outline.productivityJustification}</p>
                </div>
              </div>
            </Section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {stage === "QUOTED" ? (
            <Section eyebrow="Client response" title="Quotation dispatched">
              <div className="flex flex-col gap-2 text-[13px] text-ink-secondary">
                <p>When the client accepts, the financial machine reserves the grant and the e-TRiS support dossier is compiled for their HR to file.</p>
                <div className="flex flex-wrap gap-2">
                  <ActionButton action={clientAcceptedAction} args={[view.pkg.packageCode]} label="Client accepted" />
                  <ActionButton action={requestRevisionAction} args={[view.pkg.packageCode]} label="Request revision" kind="ghost" reason={{ label: "What does the client want changed?", minLength: 5 }} />
                </div>
              </div>
            </Section>
          ) : null}
          <Section eyebrow="Proposed resources" title="Trainer × Venue">
            <DefinitionList
              items={[
                ["Trainer", view.engagement ? `${view.engagement.status.toLowerCase().replace("_", " ")} · ${formatRM(view.engagement.dayRate)}/day` : (q.inputs as Record<string, unknown>).trainerId ? "proposed (hold on approval)" : "none matched"],
                ["Venue", view.venueCommitments.length ? view.venueCommitments.map((c) => `${c.status.toLowerCase()} · ${formatRM(c.cost)}`).join(", ") : (q.inputs as Record<string, unknown>).venueId ? "proposed (provisional on approval)" : "none"],
                ["Cost policy", q.costPolicyVersion],
              ]}
            />
          </Section>
          <Section eyebrow="Worktree" title="Versions" flush>
            <ul>
              {view.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-2 border-b border-divider px-4 py-2 text-[13px] last:border-b-0">
                  <span className="w-8 font-mono text-[12px] text-ink-muted">v{v.version}</span>
                  <span className="flex-1 truncate">
                    {formatRM(v.quotedAmount, { compact: true })} · {Number(v.marginPct).toFixed(1)}% · {v.generatedBy.toLowerCase()}
                  </span>
                  <StatusChip tone={Q_TONE[v.status] ?? "neutral"} className="text-[11px]">{v.status.toLowerCase().replace("_", " ")}</StatusChip>
                </li>
              ))}
            </ul>
            <p className="px-4 py-2 text-[11px] text-ink-muted">Latest {formatDate(q.createdAt, true)}</p>
          </Section>
        </div>
      </div>
    </Body>
  );
}
