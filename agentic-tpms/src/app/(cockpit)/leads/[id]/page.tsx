import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AIChip, Banner, Body, Checkbox, DataTable, DefinitionList, Field, LINK_BUTTON, RecordHeader, Section, Select, StatusChip, TextInput } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { NavigatingFormDrawer } from "@/components/demand/NavigatingFormDrawer";
import { CHANNEL_LABEL, LEAD_STATUS, MESSAGE_STATUS_TONE, ageLabel, classifierName, intentLabel, l1Provenance, leadStatusMeta } from "@/components/demand/labels";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { plain } from "@/server/actions";
import { isDomainError } from "@/server/domain/errors";
import { DELIVERY_MODES, DELIVERY_MODE_LABEL } from "@/server/domain/stages";
import {
  QUALIFY_THRESHOLD,
  REVIEW_THRESHOLD,
  TRIAGE_OPTIONS,
  getLeadDetail,
  isWhatsAppCapable,
  leadAgentRuns,
  leadInboxRow,
  type TriageRoute,
} from "@/server/ingestion";
import { listCourses, searchCourses } from "@/server/knowledge";
import { convertLeadAction, resolveTriageAction, runTriageAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead" };

interface TnaProfile {
  microTna?: { sentAt?: string; messageId?: string; deliveryStatus?: string; agentRunId?: string };
  answers?: { levyActive?: boolean | null; cohortSize?: number | null; timeline?: string | null };
  lastReply?: string;
  repliedAt?: string;
  privateCashBy?: string | null;
}

interface Bubble {
  key: string;
  at: string;
  inbound: boolean;
  body: string;
  caption: string;
  chip?: ReactNode;
}

const NOT_CONVERTIBLE = new Set(["CONVERTED", "DUPLICATE", "ARCHIVED"]);

export default async function LeadPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const detail = await getLeadDetail(params.id).catch((error) => {
    if (isDomainError(error)) notFound();
    throw error;
  });
  const [row, runs] = await Promise.all([leadInboxRow(params.id), leadAgentRuns(params.id)]);
  if (!row) notFound();
  const lead = plain(detail.lead);
  const messages = plain(detail.messages);
  const duplicates = plain(detail.duplicates);
  const triage = detail.triage as { pLevy?: { features?: Record<string, number> } } | null;
  const l1 = row.l1;
  const tna = (lead.tnaProfile ?? {}) as TnaProfile;
  const status = leadStatusMeta(lead.status);
  const convertible = !NOT_CONVERTIBLE.has(lead.status);

  const [courses, matches] = convertible
    ? await Promise.all([listCourses(), lead.trainingTopic ? searchCourses(lead.trainingTopic, { limit: 3 }).catch(() => []) : Promise.resolve([])])
    : [[], []];
  const matchIds = new Set(matches.map((m) => m.id));

  // The WhatsApp thread: their opening message (WhatsApp leads), what we sent, their latest reply.
  const microRun = runs.find((r) => r.id === tna.microTna?.agentRunId);
  const bubbles: Bubble[] = [];
  if (lead.channelSource === "WHATSAPP_INBOUND" && lead.message) {
    bubbles.push({ key: "opening", at: new Date(lead.createdAt).toISOString(), inbound: true, body: lead.message, caption: `${lead.picFullName || lead.picPhoneE164} · opened the chat` });
  }
  for (const m of messages.filter((m) => m.channel === "WHATSAPP")) {
    const isMicro = m.kind === "MICRO_TNA";
    bubbles.push({
      key: m.id,
      at: new Date(m.createdAt).toISOString(),
      inbound: false,
      body: m.body,
      caption: `${m.kind.toLowerCase().replace(/_/g, " ")} · ${m.status.toLowerCase()}`,
      chip: isMicro && microRun ? <AIChip provenance={{ ...(microRun.provenance as Record<string, unknown>), tier: microRun.tier }} /> : undefined,
    });
  }
  if (tna.lastReply && tna.repliedAt) {
    bubbles.push({ key: "reply", at: tna.repliedAt, inbound: true, body: tna.lastReply, caption: `${lead.picFullName || lead.picPhoneE164} · latest reply` });
  }
  bubbles.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const showThread = bubbles.length > 0 || isWhatsAppCapable(lead.picPhoneE164);

  const features = Object.entries(triage?.pLevy?.features ?? {});

  return (
    <Frame crumbs={[{ label: "Pipeline" }, { label: "Leads", href: "/leads" }, { label: `Lead ${lead.id.slice(0, 8)}` }]}>
      <RecordHeader
        title={lead.companyName}
        chips={
          <>
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            {row.isTest ? <StatusChip tone="warning">Platform test submission</StatusChip> : null}
          </>
        }
        meta={[CHANNEL_LABEL[row.channel], row.channel === "MANUAL" ? "operator-entered" : row.verified ? "signed webhook" : "unsigned webhook", `received ${formatDate(lead.createdAt, true)}`, lead.companyDomain, lead.ssmRegistrationNumber ? `SSM ${lead.ssmRegistrationNumber}` : null]}
        actions={
          lead.status === "CONVERTED" && row.packageCode ? (
            <Link href={`/operations/${row.packageCode}`} className={LINK_BUTTON.secondary}>
              Open {row.packageCode}
            </Link>
          ) : convertible ? (
            <NavigatingFormDrawer
              trigger="Convert to package"
              title="Convert to package"
              subtitle={`${lead.companyName} · creates the client if new, then a DRAFT package`}
              action={convertLeadAction}
              submitLabel="Create package"
            >
              <input type="hidden" name="leadId" value={lead.id} />
              <p className="text-[13px] text-ink-secondary">
                The client is matched by domain or SSM number, or created. The package starts in DRAFT and the commercial sourcing agent is queued to draft the proposal; nothing reaches the client until Gate 1.
              </p>
              <Field label="Programme title"><TextInput name="title" required defaultValue={lead.trainingTopic ?? ""} /></Field>
              <Field label="Catalog course" hint={matches.length ? "Closest matches first — pgvector search on the enquiry topic" : "Optional"}>
                <Select name="courseId" defaultValue={matches[0]?.id ?? ""}>
                  <option value="">No catalog course</option>
                  {matches.length ? (
                    <optgroup label="Closest to the enquiry">
                      {matches.map((m) => (
                        <option key={m.id} value={m.id}>{`${m.courseCode} · ${m.title} (${m.score.toFixed(2)})`}</option>
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label="All courses">
                    {courses.filter((c) => !matchIds.has(c.id)).map((c) => (
                      <option key={c.id} value={c.id}>{`${c.courseCode} · ${c.title}`}</option>
                    ))}
                  </optgroup>
                </Select>
              </Field>
              <Field label="Delivery mode">
                <Select name="deliveryMode" defaultValue={lead.deliveryPreference ?? "IN_HOUSE"}>
                  {DELIVERY_MODES.map((m) => (
                    <option key={m} value={m}>{DELIVERY_MODE_LABEL[m]}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start date"><TextInput name="startDate" type="date" /></Field>
                <Field label="End date"><TextInput name="endDate" type="date" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Participants (pax)"><TextInput name="pax" required inputMode="numeric" defaultValue={lead.estimatedPax ?? ""} /></Field>
                <Field label="Minimum to run" hint="Gate 2 checks this at T-14"><TextInput name="minParticipants" inputMode="numeric" defaultValue="5" /></Field>
              </div>
              <Checkbox name="venueByClient" label="The client provides the venue" />
            </NavigatingFormDrawer>
          ) : null
        }
        metrics={[
          { label: "Estimated pax", value: lead.estimatedPax ? String(lead.estimatedPax) : "—", sub: tna.answers?.cohortSize ? "from the micro-TNA reply" : undefined },
          { label: "Delivery preference", value: lead.deliveryPreference ? DELIVERY_MODE_LABEL[lead.deliveryPreference as keyof typeof DELIVERY_MODE_LABEL] ?? lead.deliveryPreference : "—" },
          { label: "Age", value: ageLabel(lead.createdAt), sub: formatDate(lead.createdAt) },
          { label: "Messages sent", value: String(messages.length) },
        ]}
      />
      <Body>
        {lead.status === "TRIAGE_REVIEW" ? (
          <Banner tone="warning" title="Awaiting your triage call">
            {l1?.abstain
              ? `The classifier abstained: ${l1.abstain.reason}. Missing: ${l1.abstain.missing.join(", ") || "—"}.`
              : `P(levy) ${l1?.pLevy?.toFixed(2) ?? "—"} is between ${REVIEW_THRESHOLD} and ${QUALIFY_THRESHOLD}, so the router left the call to you.`}
          </Banner>
        ) : null}
        {lead.status === "DUPLICATE" && lead.duplicateOf ? (
          <Banner tone="neutral" title="Duplicate of an open lead">
            Same company domain or number within 90 days.{" "}
            <Link href={`/leads/${lead.duplicateOf}`} className="text-primary-hover hover:underline">Open the original lead</Link>. Re-route it below if it is really new business.
          </Banner>
        ) : null}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Section eyebrow={`Inbound · ${CHANNEL_LABEL[row.channel]}`} title={lead.trainingTopic ?? "Enquiry"}>
              <div className="flex flex-col gap-3">
                {lead.channelSource === "WHATSAPP_INBOUND" ? (
                  <p className="text-[13px] text-ink-secondary">Opened a WhatsApp chat — the message is the first one in the thread below.</p>
                ) : (
                  <p className="whitespace-pre-wrap rounded-control border border-divider bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink">{lead.message || "No message body — the platform sent fields only."}</p>
                )}
                <DefinitionList
                  items={[
                    ["Campaign", lead.campaignId ?? "—"],
                    ["Ad", lead.adId ?? "—"],
                    ["Platform ids", Object.entries(detail.intake.platformIds).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"],
                    ["WhatsApp opt-in", lead.hasWhatsappOptIn ? "yes" : "no"],
                    ["Captured by", detail.intake.owner ? `${detail.intake.owner.name ?? detail.intake.owner.email} (smart BCC)` : "—"],
                  ]}
                />
                {duplicates.length ? (
                  <p className="text-[12px] text-ink-secondary">
                    Later submissions folded into this lead:{" "}
                    {duplicates.map((d, i) => (
                      <span key={d.id}>
                        {i ? ", " : ""}
                        <Link href={`/leads/${d.id}`} className="text-primary-hover hover:underline">{`${d.picFullName || d.picEmail} · ${formatDate(d.createdAt)}`}</Link>
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            </Section>

            <Section
              eyebrow="L1 fast classifier · typed decision primitives"
              title={l1 ? `${intentLabel(l1.intent)} → ${l1.route ? (LEAD_STATUS[l1.route as keyof typeof LEAD_STATUS]?.label ?? l1.route) : "—"}` : "Not classified yet"}
              actions={l1 ? <AIChip provenance={l1Provenance(l1)} /> : null}
            >
              {l1 ? (
                <div className="flex flex-col gap-3">
                  <DefinitionList
                    items={[
                      ["Intent", `${intentLabel(l1.intent)}${l1.intentConfidence !== null ? ` · confidence ${Math.round(l1.intentConfidence * 100)}%` : ""}`],
                      ["P(levy payer)", `${l1.pLevy?.toFixed(3) ?? "—"} · qualify ≥ ${QUALIFY_THRESHOLD}, review ≥ ${REVIEW_THRESHOLD}`],
                      ["Urgency", l1.urgency ? `${l1.urgency} / 5` : "—"],
                      ["Abstained", l1.abstain ? `${l1.abstain.reason} (missing ${l1.abstain.missing.join(", ") || "—"})` : "no"],
                      ["Route (L0 rule)", `${l1.route ?? "—"} · ${l1.reason ?? "—"}`],
                      ["Classifier", classifierName(l1)],
                      ["Run", `${l1.runStatus.toLowerCase()} · ${l1.latencyMs ?? "—"} ms · ${formatDate(l1.startedAt, true)}`],
                    ]}
                  />
                  {features.length ? (
                    <div>
                      <p className="pb-1 text-[12px] font-medium text-ink-muted">P(levy) evidence</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {features.map(([name, value]) => (
                          <li key={name} className="rounded-control border border-divider px-2 py-0.5 font-mono text-[11px] text-ink-secondary">
                            {name} {Number(value).toFixed(2)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className="text-[12px] text-ink-muted">The classifier only produces the numbers; the route is the L0 rule applied to them. Your triage call always overrides it.</p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-secondary">
                  <p className="flex-1">{lead.status === "DUPLICATE" ? "Duplicates are not classified; the original lead carries the verdict." : "The lead.triage task is queued for the worker."}</p>
                  {lead.status === "LEAD_INGESTED" ? <ActionButton action={runTriageAction} args={[lead.id]} label="Run L1 triage now" kind="ghost" /> : null}
                </div>
              )}
            </Section>

            {showThread ? (
              <Section eyebrow="WhatsApp · micro-TNA" title={tna.answers ? `Levy ${tna.answers.levyActive === true ? "active" : tna.answers.levyActive === false ? "not active" : "unknown"}` : tna.microTna ? "Waiting for a reply" : lead.status === "LEAD_QUALIFIED_TNA" ? "Queued" : "Not sent"}>
                <div className="flex flex-col gap-3">
                  {bubbles.length ? (
                    <ol className="flex flex-col gap-2.5">
                      {bubbles.map((b) => (
                        <li key={b.key} className={b.inbound ? "flex flex-col items-start gap-1" : "flex flex-col items-end gap-1"}>
                          <p className={b.inbound ? "max-w-[85%] whitespace-pre-wrap rounded-control border border-divider bg-surface px-3 py-2 text-[13px] text-ink" : "max-w-[85%] whitespace-pre-wrap rounded-control border border-border bg-card px-3 py-2 text-[13px] text-ink"}>
                            {b.body}
                          </p>
                          <span className="flex items-center gap-2 text-[11px] text-ink-muted">
                            {b.chip}
                            {b.caption} · {formatDate(b.at, true)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-[13px] text-ink-muted">
                      {!isWhatsAppCapable(lead.picPhoneE164)
                        ? "No WhatsApp-capable mobile number."
                        : lead.status === "LEAD_QUALIFIED_TNA"
                          ? "Qualified — the lead.whatsapp_micro_tna task is queued for the worker."
                          : "Sent only to a qualified lead, while it is still a lead."}
                    </p>
                  )}
                  {tna.answers ? (
                    <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-2.5 text-[12px] text-ink-secondary">
                      <AIChip variant="rule" label="L0 reply parser" />
                      <span>
                        levy {tna.answers.levyActive === true ? "active" : tna.answers.levyActive === false ? "not active" : "unknown"} · cohort {tna.answers.cohortSize ?? "—"} · timeline {tna.answers.timeline ?? "—"}
                        {tna.privateCashBy === "MICRO_TNA" ? " · moved to private cash by the reply" : ""}
                      </span>
                    </div>
                  ) : null}
                </div>
              </Section>
            ) : null}

            <Section eyebrow="Outbound message log" title={`Messages sent · ${messages.length}`} flush>
              <DataTable
                label="Messages sent to this lead"
                rows={messages}
                rowKey={(m) => m.id}
                density="compact"
                empty={<p className="px-4 py-3 text-[13px] text-ink-muted">Nothing sent to this lead yet.</p>}
                columns={[
                  { key: "at", label: "Sent", cell: (m) => <span className="whitespace-nowrap text-[12px]">{formatDate(m.createdAt, true)}</span> },
                  { key: "ch", label: "Channel", cell: (m) => `${m.channel === "WHATSAPP" ? "WhatsApp" : "Email"} · ${m.kind.toLowerCase().replace(/_/g, " ")}` },
                  { key: "to", label: "To", mono: true, cell: (m) => m.toAddress },
                  { key: "what", label: "Message", cell: (m) => <span className="line-clamp-2 text-[12px] text-ink-secondary">{m.subject ?? m.body}</span> },
                  { key: "st", label: "Status", cell: (m) => <StatusChip tone={MESSAGE_STATUS_TONE[m.status] ?? "neutral"} title={m.error ?? undefined}>{m.status.toLowerCase()}</StatusChip> },
                ]}
              />
            </Section>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Section eyebrow="Triage decision" title="Your call overrides the classifier" flush>
              {lead.status === "CONVERTED" ? (
                <p className="px-4 py-3 text-[13px] text-ink-secondary">This lead is a training package now; triage is closed.</p>
              ) : (
                <ul>
                  {TRIAGE_OPTIONS.map((o) => (
                    <li key={o.id} className="flex items-start gap-3 border-b border-divider px-4 py-3 last:border-b-0">
                      <p className="min-w-0 flex-1 text-[12px] text-ink-secondary">{o.description}</p>
                      <ActionButton
                        action={resolveTriageAction}
                        args={[lead.id, o.id as TriageRoute]}
                        label={o.label}
                        kind="secondary"
                        confirm={{ title: `${o.label}?`, body: <p>{o.description}. Recorded against your name in the audit ledger; any pending LEAD_TRIAGE decision is resolved.</p>, confirmLabel: "Record decision" }}
                        reason={{ label: "Note (optional)", placeholder: "e.g. Confirmed levy payer on the phone", minLength: 0 }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Contact">
              <DefinitionList
                items={[
                  ["Person", lead.picFullName || "—"],
                  ["Email", lead.picEmail || "—"],
                  ["Phone", lead.picPhoneE164 ? `${lead.picPhoneE164}${isWhatsAppCapable(lead.picPhoneE164) ? " · WhatsApp-capable" : " · landline"}` : "—"],
                  ["Account type", lead.accountType === "PRIVATE_CASH" ? "Private cash" : "SBL-Khas levy"],
                  ["Client", lead.clientId ? <Link key="c" href={`/clients/${lead.clientId}`} className="text-primary-hover hover:underline">Open client</Link> : "not linked yet"],
                ]}
              />
            </Section>
          </div>
        </div>
      </Body>
    </Frame>
  );
}
