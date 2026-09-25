import Link from "next/link";
import { AIChip, Banner, Body, EmptyState, Field, PageHeader, SELECTED_TINT, Section, StatusChip, TextArea, TextInput } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { outboxStatusMeta } from "@/components/demand/labels";
import { Frame } from "@/components/shell/Frame";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { plain } from "@/server/actions";
import { OPERATORS } from "@/server/auth/operator";
import { MAX_WORDS, OPT_OUT_LINE, SEQUENCE_STEPS, STEP_DELAY_DAYS, batchNotes, listDraftRequests, listOutbox, listOutboxBatches, type OutboxRow } from "@/server/outbound";
import { approveBatchAction, draftSequenceAction, editDraftAction, importCsvAction, rejectBatchAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outbound outbox" };

const UUID = /^[0-9a-f-]{36}$/i;
const who = (id: string | null | undefined) => (id ? (OPERATORS.find((o) => o.id === id)?.name ?? id) : "—");

function draftChip(row: OutboxRow) {
  const p = row.provenance as Record<string, unknown>;
  if (p.source === "HUMAN_EDIT") return <AIChip variant="rule" label={`Edited by ${who(typeof p.editedBy === "string" ? p.editedBy : null)}`} />;
  return (
    <AIChip
      provenance={{
        tier: String(p.tier ?? "L4"),
        agent: typeof p.agent === "string" ? p.agent : undefined,
        mode: typeof p.mode === "string" ? p.mode : undefined,
        provider: typeof p.provider === "string" ? p.provider : undefined,
        model: typeof p.model === "string" ? p.model : undefined,
        fallbackReason: typeof p.fallbackReason === "string" ? p.fallbackReason : typeof p.rejectedReason === "string" ? `model draft refused: ${p.rejectedReason}` : undefined,
      }}
    />
  );
}

export default async function OutboxPage({ searchParams }: { searchParams: { batch?: string } }) {
  const [batches, requests] = await Promise.all([listOutboxBatches().then(plain), listDraftRequests()]);
  const notes = await batchNotes(batches.map((b) => b.batchId));
  const waiting = batches.filter((b) => (b.counts.WAITING_APPROVAL ?? 0) > 0);
  const selectedId =
    searchParams.batch && UUID.test(searchParams.batch) && batches.some((b) => b.batchId === searchParams.batch)
      ? searchParams.batch
      : (waiting[0] ?? batches[0])?.batchId;
  const selected = batches.find((b) => b.batchId === selectedId);
  const rows = selectedId ? plain(await listOutbox(selectedId)) : [];
  const pending = selected ? (selected.counts.WAITING_APPROVAL ?? 0) : 0;

  // Group the batch's rows by target: one card per recipient, its touches in order.
  const targets = new Map<string, OutboxRow[]>();
  for (const r of rows) targets.set(r.targetPicEmail, [...(targets.get(r.targetPicEmail) ?? []), r]);

  return (
    <Frame crumbs={[{ label: "Pipeline" }, { label: "Outbound outbox" }]}>
      <PageHeader
        title="Outbound outbox"
        summary={`HITL review desk · ${waiting.length} batch${waiting.length === 1 ? "" : "es"} awaiting approval · the L4 writer drafts three touches per target and nothing sends until a named operator approves the batch`}
        actions={
          <>
            <FormDrawer trigger="Draft a sequence" title="Draft a sequence" subtitle="One permissioned target · three touches" action={draftSequenceAction} submitLabel="Queue drafting">
              <p className="text-[13px] text-ink-secondary">For a contact you have the right to email (a referral, an event list you own). Free-mail addresses, the opt-out list and anyone already in a sequence are skipped.</p>
              <Field label="Company"><TextInput name="company" required /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Contact name"><TextInput name="picName" /></Field>
                <Field label="Work email"><TextInput name="picEmail" type="email" required /></Field>
              </div>
              <Field label="SSM number" hint="Optional"><TextInput name="ssm" /></Field>
              <Field label="Hiring signal" hint="What makes training timely — the writer's hook"><TextArea name="hiringSignal" placeholder="e.g. Hiring 20 production supervisors for the new Kulim line" /></Field>
              <Field label="Campaign note"><TextInput name="campaignNote" placeholder="e.g. Q4 levy expiry reminder" /></Field>
            </FormDrawer>
            <FormDrawer trigger="Import targets CSV" title="Import targets CSV" subtitle="company, name, email, ssm, notes" action={importCsvAction} submitLabel="Import & queue drafting">
              <p className="text-[13px] text-ink-secondary">
                Only lists the provider has the right to use. The header row needs a company column and an email column; name, SSM and notes (the hiring signal) are optional. Rows with a bad email are skipped and reported.
              </p>
              <Field label="CSV file"><input name="file" type="file" accept=".csv,text/csv" required className="text-[13px]" /></Field>
              <Field label="Campaign note"><TextInput name="campaignNote" placeholder="e.g. Listed manufacturers, levy expiry Q4" /></Field>
            </FormDrawer>
          </>
        }
      />
      <Body>
        {requests.length ? (
          <Banner tone="info" title={`${requests.length} draft request${requests.length === 1 ? "" : "s"} with the worker`}>
            {requests.map((r) => `${r.targets} target${r.targets === 1 ? "" : "s"}${r.campaignNote ? ` · ${r.campaignNote}` : ""} · ${r.status.toLowerCase()}${r.lastError ? ` (${r.lastError})` : ""}`).join(" — ")}. The batch appears here for review once drafted.
          </Banner>
        ) : null}
        {batches.length === 0 ? (
          <Section title="No batches yet">
            <EmptyState title="Nothing drafted" description="Import a permissioned target list or draft a sequence for one contact. Drafts wait here for your approval." />
          </Section>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Section eyebrow={`${batches.length} batches`} title="Batches" flush>
              <ul>
                {batches.map((b) => {
                  const active = b.batchId === selectedId;
                  return (
                    <li key={b.batchId} className="border-b border-divider last:border-b-0">
                      <Link href={`/outbox?batch=${b.batchId}`} aria-current={active ? "true" : undefined} className={cn("flex flex-col gap-1.5 px-4 py-2.5 hover:bg-surface-hover", active && SELECTED_TINT)}>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-ink">{notes[b.batchId]?.campaignNote ?? "Levy-utilisation sequence"}</span>
                          <span className="shrink-0 font-mono text-[11px] text-ink-muted">{formatDate(b.createdAt)}</span>
                        </span>
                        <span className="text-[12px] text-ink-secondary">
                          {b.targets} target{b.targets === 1 ? "" : "s"} · {b.rows} emails · drafted for {who(notes[b.batchId]?.draftedBy)}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {Object.entries(b.counts).map(([s, n]) => (
                            <StatusChip key={s} tone={outboxStatusMeta(s).tone} className="px-2 py-0 text-[11px]">
                              {n} {outboxStatusMeta(s).label.toLowerCase()}
                            </StatusChip>
                          ))}
                        </span>
                        {b.approvedBy ? <span className="text-[11px] text-ink-muted">approved by {who(b.approvedBy)}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>

            {selected ? (
              <div className="flex min-w-0 flex-col gap-4">
                <Section
                  eyebrow={`Batch ${selected.batchId.slice(0, 8)} · drafted ${formatDate(selected.createdAt, true)} for ${who(notes[selected.batchId]?.draftedBy)}`}
                  title={notes[selected.batchId]?.campaignNote ?? "Levy-utilisation sequence"}
                  actions={
                    pending > 0 ? (
                      <>
                        <ActionButton action={rejectBatchAction} args={[selected.batchId]} label="Reject batch" kind="danger" reason={{ label: "Why is this batch rejected?", placeholder: "e.g. Tone too pushy for listed companies", minLength: 5 }} />
                        <ActionButton
                          action={approveBatchAction}
                          args={[selected.batchId]}
                          label="Approve batch"
                          kind="primary"
                          confirm={{
                            title: `Approve ${pending} email${pending === 1 ? "" : "s"}?`,
                            body: (
                              <p>
                                Every waiting draft becomes approved under your name. Touch 1 dispatches now; touches {SEQUENCE_STEPS.filter((s) => s > 1).map((s) => `${s} on day ${STEP_DELAY_DAYS[s]}`).join(" and ")}. A reply, a bounce or an opt-out stops that target&apos;s sequence.
                              </p>
                            ),
                            confirmLabel: "Approve & dispatch",
                          }}
                        />
                      </>
                    ) : (
                      <StatusChip tone={selected.decisionStatus === "REJECTED" ? "neutral" : "success"}>{selected.decisionStatus ? selected.decisionStatus.toLowerCase() : "reviewed"}</StatusChip>
                    )
                  }
                >
                  <p className="text-[12px] text-ink-secondary">
                    {selected.targets} target{selected.targets === 1 ? "" : "s"} × {SEQUENCE_STEPS.length} touches · bodies under {MAX_WORDS} words, each ending “{OPT_OUT_LINE}” · a model draft that breaks a rule is replaced by the deterministic template, never trimmed.
                  </p>
                </Section>

                {[...targets.entries()].map(([email, touches]) => {
                  const head = touches[0];
                  return (
                    <Section key={email} eyebrow={email} title={head.targetCompany} flush>
                      {head.hiringSignalNotes ? <p className="border-b border-divider px-4 py-2 text-[12px] text-ink-secondary">Signal: {head.hiringSignalNotes}</p> : null}
                      <ol>
                        {touches.map((t) => {
                          const st = outboxStatusMeta(t.status);
                          return (
                            <li key={t.id} className="flex flex-col gap-2 border-b border-divider px-4 py-3 last:border-b-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[11px] text-ink-muted">
                                  Touch {t.sequenceStep} · day {STEP_DELAY_DAYS[t.sequenceStep as keyof typeof STEP_DELAY_DAYS] ?? "?"}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{t.subjectLine}</span>
                                {draftChip(t)}
                                <StatusChip tone={st.tone}>{st.label}</StatusChip>
                                {t.status === "WAITING_APPROVAL" ? (
                                  <FormDrawer trigger="Edit" triggerKind="ghost" title={`Edit touch ${t.sequenceStep}`} subtitle={`${t.targetCompany} · ${t.targetPicEmail}`} action={editDraftAction} submitLabel="Save draft">
                                    <input type="hidden" name="rowId" value={t.id} />
                                    <Field label="Subject"><TextInput name="subject" defaultValue={t.subjectLine} required maxLength={255} /></Field>
                                    <Field label="Body" hint={`Under ${MAX_WORDS} words including the opt-out line, which is re-appended on save`}>
                                      <TextArea name="body" defaultValue={t.emailBodyText} className="min-h-[220px]" />
                                    </Field>
                                  </FormDrawer>
                                ) : null}
                              </div>
                              <p className="whitespace-pre-wrap rounded-control border border-divider bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink">{t.emailBodyText}</p>
                              <p className="text-[11px] text-ink-muted">
                                {t.wordCount} / {MAX_WORDS} words
                                {t.approvedByUserId ? ` · approved by ${who(t.approvedByUserId)}${t.approvedAt ? ` ${formatDate(t.approvedAt, true)}` : ""}` : ""}
                                {t.sentAt ? ` · sent ${formatDate(t.sentAt, true)}` : ""}
                              </p>
                            </li>
                          );
                        })}
                      </ol>
                    </Section>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </Body>
    </Frame>
  );
}
