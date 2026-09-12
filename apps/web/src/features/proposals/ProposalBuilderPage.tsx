import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type {
  ActionRequest,
  ActionResponse,
  Proposal,
  ProposalSection,
  ProposalSendPayload,
} from "@trainos/contract";
import { TEMPLATE_PROPOSAL } from "@trainos/contract";
import {
  AIChip,
  ApprovalBanner,
  Breadcrumb,
  CitationChip,
  ContentCard,
  ErrorState,
  ExceptionBanner,
  GhostButton,
  LoadingState,
  PrimaryButton,
  ProvenancePanel,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  humanise,
  type MetricCellProps,
} from "@/shared/components/kit";
import { useMe } from "@/shared/hooks/useMe";
import {
  actionRequest,
  errorMessageOf,
  useApproval,
  useEditSection,
  useProposal,
  useProposalClient,
  useRegenerateSection,
  useSendProposal,
} from "./api";
import { PROPOSALS_LIST_PATH } from "./paths";
import { needsReview, originLabel } from "./sections";

/**
 * M07-S02 · Proposal builder.
 *
 * Three columns: the section rail, the section being worked on, and the live
 * preview. Every section carries its own provenance, so the AI chip lives per
 * section rather than once on the record — a proposal is a mixed document and
 * a single page-level badge would claim more or less than is true.
 *
 * The low-confidence section WARNS; it never hard-blocks the send. The pack is
 * explicit about this and equally explicit that the flag must travel to the
 * approver, so it is repeated inside the approval banner once the send queues.
 */

export function ProposalBuilderPage() {
  const { proposalRef } = useParams<{ proposalRef: string }>();
  const { me } = useMe();

  const proposalQuery = useProposal(proposalRef);
  const proposal = proposalQuery.data;
  const clientQuery = useProposalClient(proposal?.opportunityRef);

  const [activeN, setActiveN] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState<string | null>(null);
  const [queued, setQueued] = useState<ActionResponse | null>(null);

  const send = useSendProposal(proposal?.ref);
  const regenerate = useRegenerateSection(proposal?.ref);
  const edit = useEditSection(proposal?.ref);

  const sections = useMemo(() => proposal?.sections ?? [], [proposal]);
  const active = sections.find((section) => section.n === activeN) ?? sections[0];
  const flagged = sections.filter(needsReview);

  /* The first section is the landing selection, and it must not fight a
     reader who has already chosen one. */
  useEffect(() => {
    if (activeN === null && sections.length > 0) setActiveN(sections[0]?.n ?? null);
  }, [activeN, sections]);

  const queuedRef =
    queued?.status === "QUEUED_FOR_APPROVAL" ? queued.approvalRequest.ref : undefined;
  const approvalQuery = useApproval(queuedRef);

  if (proposalQuery.isPending) return <LoadingState label="Loading the proposal" />;

  if (proposalQuery.isError || !proposal) {
    return (
      <ErrorState
        title="Could not load this proposal"
        description={errorMessageOf(proposalQuery.error)}
        onRetry={() => void proposalQuery.refetch()}
      />
    );
  }

  const sendRequest = (): ActionRequest<ProposalSendPayload> => ({
    type: "PROPOSAL_SEND",
    targetRef: proposal.ref,
    payload: {
      channel: "EMAIL",
      templateId: proposal.templateId || TEMPLATE_PROPOSAL,
      to: [],
      attachPdf: true,
    },
    requestedBy: { id: me.id, name: me.name, kind: "HUMAN" },
  });

  const onSend = () => {
    send.mutate(actionRequest(sendRequest()), { onSuccess: (response) => setQueued(response) });
  };

  const sendButton = (
    <PrimaryButton type="button" disabled={send.isPending} onClick={onSend}>
      {send.isPending ? "Sending…" : "Send for approval"}
    </PrimaryButton>
  );

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb
        items={[
          { label: "Sales" },
          { label: "Proposals", href: PROPOSALS_LIST_PATH },
          { label: proposal.ref },
        ]}
      />

      <ContentCard flush>
        <RecordHeader
          title={clientQuery.data ? `${proposal.ref} · ${clientQuery.data.name}` : proposal.ref}
          meta={[
            proposal.opportunityRef,
            proposal.templateId,
            `created ${proposal.createdAt.slice(0, 10)}`,
            `owner ${proposal.createdBy.name ?? proposal.createdBy.id}`,
          ]}
          chips={
            <>
              <StatusChip tone={proposal.status === "DRAFT" ? "neutral" : "info"}>
                {humanise(proposal.status)}
              </StatusChip>
              {proposal.runId ? (
                <AIChip
                  variant="executed"
                  label={`Drafted by ${proposal.createdBy.name ?? "the proposal agent"}`}
                />
              ) : null}
            </>
          }
          actions={
            <>
              <GhostButton type="button">Preview</GhostButton>
              <SecondaryButton type="button">Save draft</SecondaryButton>
            </>
          }
          primaryAction={sendButton}
          metrics={metricsFor(proposal, flagged.length)}
        />

        <SendOutcome
          response={queued}
          approval={approvalQuery.data}
          flaggedSections={flagged.map((section) => section.n)}
        />

        {send.isError ? (
          <div className="px-5 pb-4">
            <ExceptionBanner
              severity="DANGER"
              title="The send was refused"
              subtitle={errorMessageOf(send.error)}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-0 border-t border-divider lg:grid-cols-[220px_minmax(0,1fr)_300px]">
          <SectionRail
            sections={sections}
            activeN={active?.n ?? null}
            onSelect={(n) => {
              setActiveN(n);
              setDraftBody(null);
            }}
            templateId={proposal.templateId}
          />

          <SectionEditor
            key={active?.n}
            section={active}
            draftBody={draftBody}
            onDraftChange={setDraftBody}
            onRegenerate={() => active && regenerate.mutate(active.n)}
            onSave={() =>
              active &&
              draftBody !== null &&
              edit.mutate(
                { n: active.n, body: { body: draftBody } },
                { onSuccess: () => setDraftBody(null) },
              )
            }
            isRegenerating={regenerate.isPending}
            isSaving={edit.isPending}
            error={regenerate.error ?? edit.error}
            flagged={flagged}
            onOpenFlagged={(n) => {
              setActiveN(n);
              setDraftBody(null);
            }}
            policyNote={policyNote(proposal)}
            sendButton={sendButton}
          />

          <LivePreview proposal={proposal} />
        </div>
      </ContentCard>
    </div>
  );
}

function metricsFor(proposal: Proposal, flaggedCount: number): MetricCellProps[] {
  return [
    { label: "Value", value: proposal.value },
    {
      label: "Margin",
      value: `${Math.round(proposal.marginRate * 100)}%`,
      sub: "floor 35%",
    },
    {
      label: "Sections",
      value: String(proposal.sections.length),
      ...(flaggedCount > 0 ? { sub: `${flaggedCount} needs review` } : { sub: "all reviewed" }),
    },
    ...(proposal.runId ? [{ label: "Run", value: proposal.runId } as MetricCellProps] : []),
  ];
}

/**
 * What the policy will do on send. The threshold is the policy's, not this
 * screen's — the sentence names it so the reader is not surprised by a queue.
 */
function policyNote(proposal: Proposal): string {
  return `Policy APV-01 reviews a proposal of this value before it leaves. Sending queues ${proposal.ref} to the approver rather than mailing it.`;
}

/* ---- The three §3 outcomes ------------------------------------------ */

function SendOutcome({
  response,
  approval,
  flaggedSections,
}: {
  response: ActionResponse | null;
  approval: Parameters<typeof ApprovalBanner>[0]["approval"] | undefined;
  flaggedSections: number[];
}) {
  if (!response) return null;

  const flagNote =
    flaggedSections.length > 0
      ? `Section ${flaggedSections.join(", ")} is flagged low confidence and travels with this request.`
      : undefined;

  if (response.status === "QUEUED_FOR_APPROVAL") {
    return (
      <div className="flex flex-col gap-2 px-5 pb-4">
        {/* The reference is the thing the reader quotes to anyone else, so it
            is on the page even when the banner has the richer story. */}
        <p className="font-mono text-[11px] text-ink-muted">
          {response.approvalRequest.ref} · policy {response.approvalRequest.policyId} ·{" "}
          {response.approvalRequest.approverRole}
        </p>
        {approval ? (
          <ApprovalBanner
            approval={approval}
            approverRole={response.approvalRequest.approverRole}
            {...(response.approvalRequest.assignedTo?.name
              ? { approverName: response.approvalRequest.assignedTo.name }
              : {})}
          />
        ) : (
          <ExceptionBanner
            severity="INFO"
            title={`Queued for approval as ${response.approvalRequest.ref}`}
            subtitle={`Policy ${response.approvalRequest.policyId} holds this until ${response.approvalRequest.approverRole} decides.`}
          />
        )}
        {flagNote ? <ExceptionBanner severity="WARN" title={flagNote} /> : null}
      </div>
    );
  }

  if (response.status === "SUGGESTED") {
    return (
      <div className="px-5 pb-4">
        <ExceptionBanner
          severity="INFO"
          title="Returned as a draft rather than sent"
          subtitle={response.draft.body}
        />
      </div>
    );
  }

  return (
    <div className="px-5 pb-4">
      <ExceptionBanner
        severity="INFO"
        title="Sent"
        subtitle={response.result.effects.map((effect) => effect.description).join(" · ")}
      />
    </div>
  );
}

/* ---- The section rail ------------------------------------------------ */

function SectionRail({
  sections,
  activeN,
  onSelect,
  templateId,
}: {
  sections: ProposalSection[];
  activeN: number | null;
  onSelect: (n: number) => void;
  templateId: string;
}) {
  return (
    <nav aria-label="Proposal sections" className="border-r border-divider p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-ink">Sections</h2>
        <span className="font-mono text-[10px] text-ink-muted">{templateId}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {sections.map((section) => (
          <li key={section.n}>
            <button
              type="button"
              aria-current={section.n === activeN}
              onClick={() => onSelect(section.n)}
              className={
                section.n === activeN
                  ? "w-full rounded-[8px] border border-primary-border bg-ai-tint px-2.5 py-2 text-left"
                  : "w-full rounded-[8px] border border-transparent px-2.5 py-2 text-left hover:bg-surface-hover"
              }
            >
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] text-ink-muted">{section.n}</span>
                <span className="text-[13px] text-ink">{section.title}</span>
              </span>
              <span className="mt-1 block text-[11px] text-ink-muted">
                {originLabel(section)}
                {typeof section.provenance?.confidence === "number"
                  ? ` · ${Math.round(section.provenance.confidence * 100)}%`
                  : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ---- The editor ------------------------------------------------------ */

function SectionEditor({
  section,
  draftBody,
  onDraftChange,
  onRegenerate,
  onSave,
  isRegenerating,
  isSaving,
  error,
  flagged,
  onOpenFlagged,
  policyNote: note,
  sendButton,
}: {
  section: ProposalSection | undefined;
  draftBody: string | null;
  onDraftChange: (value: string | null) => void;
  onRegenerate: () => void;
  onSave: () => void;
  isRegenerating: boolean;
  isSaving: boolean;
  error: unknown;
  flagged: ProposalSection[];
  onOpenFlagged: (n: number) => void;
  policyNote: string;
  sendButton: ReactNode;
}) {
  if (!section) {
    return (
      <div className="p-5">
        <ExceptionBanner severity="INFO" title="This proposal has no sections yet." />
      </div>
    );
  }

  const editing = draftBody !== null;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-[15px] font-semibold text-ink">
          {section.n} · {section.title}
        </h2>
        {section.provenance ? (
          <AIChip
            provenance={section.provenance}
            {...(needsReview(section) ? { variant: "low-confidence" as const } : {})}
          />
        ) : null}
        <div className="ml-auto flex gap-2">
          <GhostButton type="button" disabled={isRegenerating} onClick={onRegenerate}>
            {isRegenerating ? "Regenerating…" : "Regenerate"}
          </GhostButton>
          {editing ? (
            <SecondaryButton type="button" disabled={isSaving} onClick={onSave}>
              {isSaving ? "Saving…" : "Save edit"}
            </SecondaryButton>
          ) : (
            <SecondaryButton type="button" onClick={() => onDraftChange(section.body ?? "")}>
              Edit before use
            </SecondaryButton>
          )}
        </div>
      </div>

      {error ? (
        <ExceptionBanner
          severity="DANGER"
          title="That change did not apply"
          subtitle={errorMessageOf(error)}
        />
      ) : null}

      {editing ? (
        <textarea
          aria-label={`Body of section ${section.n}`}
          className="min-h-[180px] w-full rounded-[8px] border border-border bg-surface p-3 text-[13px] leading-relaxed text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          value={draftBody}
          onChange={(event) => onDraftChange(event.target.value)}
        />
      ) : (
        <p className="text-[13px] leading-relaxed text-ink">{section.body}</p>
      )}

      {/* §7: uncited AI prose is not permitted on a record page. The chips are
          the section's own provenance sources, not a decoration. */}
      {section.provenance?.sources && section.provenance.sources.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-secondary">Sources</span>
          {section.provenance.sources.map((source, index) => (
            <CitationChip
              key={`${source.type}-${source.ref}`}
              label={`${source.type} ${source.ref}`}
            >
              {index + 1}
            </CitationChip>
          ))}
          <span className="font-mono text-[10px] text-ink-muted">
            {section.provenance.sources.map((source) => source.ref).join(" · ")}
          </span>
        </div>
      ) : null}

      {section.mergeFieldsUsed && section.mergeFieldsUsed.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-secondary">Merge fields</span>
          {section.mergeFieldsUsed.map((field) => (
            <span
              key={field}
              className="rounded-[4px] border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-secondary"
            >
              {`{{${field}}}`}
            </span>
          ))}
        </div>
      ) : null}

      {flagged.length > 0 ? (
        <ExceptionBanner
          severity="WARN"
          title={`Section ${flagged.map((row) => row.n).join(", ")} needs review before this is sent`}
          subtitle={flagged
            .map(
              (row) =>
                `${row.title} was generated at ${Math.round((row.provenance?.confidence ?? 0) * 100)}% confidence.`,
            )
            .join(" ")}
          action={
            <SecondaryButton
              type="button"
              onClick={() => onOpenFlagged(flagged[0]?.n ?? section.n)}
            >
              Open section {flagged[0]?.n}
            </SecondaryButton>
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
        <p className="max-w-[52ch] text-[12px] text-ink-secondary">{note}</p>
        {sendButton}
      </div>
    </div>
  );
}

/* ---- The live preview ------------------------------------------------ */

function LivePreview({ proposal }: { proposal: Proposal }) {
  const lead = proposal.sections[0];
  const investment = proposal.sections.find((section) =>
    section.title.toLowerCase().includes("investment"),
  );
  const agentProvenance = proposal.sections.find((section) => section.provenance)?.provenance;

  return (
    <aside aria-label="Live preview" className="flex flex-col gap-4 border-l border-divider p-4">
      <h2 className="text-[13px] font-semibold text-ink">Live preview</h2>

      <div className="rounded-[10px] border border-border bg-surface p-3">
        <p className="font-mono text-[10px] text-ink-muted">
          {proposal.ref} · {proposal.createdAt.slice(0, 10)}
        </p>
        {lead ? (
          <>
            <p className="mt-2 text-[13px] font-semibold text-ink">{lead.title}</p>
            <p className="mt-1 line-clamp-4 text-[12px] leading-relaxed text-ink-secondary">
              {lead.body}
            </p>
          </>
        ) : null}
        {investment ? (
          <p className="mt-3 border-t border-divider pt-2 text-[12px] leading-relaxed text-ink-secondary">
            {investment.body}
          </p>
        ) : null}
      </div>

      {agentProvenance ? <ProvenancePanel provenance={agentProvenance} title="Provenance" /> : null}
    </aside>
  );
}

export default ProposalBuilderPage;
