/**
 * M02-S02 · Approval detail.
 *
 * "Let an approver decide in under a minute with the reasoning, the evidence
 * and the exact consequences visible without leaving the page."
 *
 * The proof screen's structure is the contract, and it is one vertical
 * narrative in a fixed order:
 *
 *   why you are here → what is recommended → what it stands on → what changes
 *
 * The consequence block is the ONLY bordered element in the decision column,
 * because it answers the approver's real question. Everything above it is held
 * together by spacing and type, per CLAUDE.md's hierarchy rule.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ApprovalDecision, DiffLine } from "@trainos/contract";
import {
  AIChip,
  CitationChip,
  DangerButton,
  DateText,
  DiffBlock,
  ErrorState,
  ExceptionBanner,
  JuryChip,
  KeyboardShortcut,
  LoadingState,
  MoneyText,
  PrimaryButton,
  RecordHeader,
  RefChip,
  SecondaryButton,
  StatusChip,
  APPROVAL_TONE,
  humanise,
  type MetricCellProps,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { isDomainError, toApiError } from "@/shared/api";
import { useApproval, useApprovalAudit, useApprovalInbox, useDecideApproval } from "./api";
import { APPROVALS_PATH, approvalPath } from "./paths";

/** The two decisions §7 requires a note for. */
const NEEDS_NOTE: ApprovalDecision[] = ["REJECT", "REQUEST_CHANGES"];

const DECISION_LABEL: Record<ApprovalDecision, string> = {
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
  REJECT: "Reject",
};

/** A section of the narrative. No border — spacing and type do the work. */
function Block({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function ApprovalDetail() {
  const { ref = "" } = useParams();
  const navigate = useNavigate();

  const approval = useApproval(ref);
  const audit = useApprovalAudit(ref);
  const decide = useDecideApproval(ref);

  /* The queue rail. The same grouped read the inbox uses, so the rail and the
     inbox can never disagree about what is next. */
  const queue = useApprovalInbox({ group: "URGENCY" });
  const queueRows = queue.data?.data ?? [];
  const position = queueRows.findIndex((row) => row.ref === ref);

  const [armed, setArmed] = useState<ApprovalDecision | null>(null);
  const [note, setNote] = useState("");

  /* The trail names the record; RecordHeader names the subject. The two say
     different things on purpose, so neither repeats the other. */
  useBreadcrumb([
    { label: "Home", href: "/" },
    { label: "Approvals", href: APPROVALS_PATH },
    { label: approval.data?.ref ?? ref },
  ]);

  const detail = approval.data;
  const decided = decide.data;
  const pending = detail?.status === "PENDING" && decided === undefined;

  /* A · R · C, the pack's keystrokes. Bound only while the approval is still
     open, so a decided record cannot be decided twice by a stray key. */
  useEffect(() => {
    if (!pending) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const key = event.key.toLowerCase();
      if (key === "a") setArmed("APPROVE");
      else if (key === "r") setArmed("REJECT");
      else if (key === "c") setArmed("REQUEST_CHANGES");
      else return;
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending]);

  const submit = (decision: ApprovalDecision) => {
    const needsNote = NEEDS_NOTE.includes(decision);
    if (needsNote && note.trim().length === 0) {
      setArmed(decision);
      return;
    }
    /* Fire-and-forget, per CLAUDE.md R3: the mutation carries
       `meta.toastOnError`, so a refusal is never silent. */
    decide.mutate({ decision, note: needsNote ? note.trim() : null });
    setArmed(null);
  };

  if (approval.isPending) {
    return (
      <div className="flex flex-col">
        <LoadingState rows={8} label="Loading the approval" className="px-5" />
      </div>
    );
  }

  if (approval.error || !detail) {
    /* TanStack hands back the EXCEPTION the query threw, not the `ApiError`
       inside it. Unwrapping is what keeps a NOT_FOUND classified as a refusal
       — and a refusal, per CLAUDE.md R2, is never offered a retry button. */
    const failure = approval.error ? toApiError(approval.error) : undefined;

    return (
      <div className="flex flex-col">
        <ErrorState
          title="That approval could not be opened"
          {...(failure ? { error: failure } : {})}
          {...(failure && isDomainError(failure) ? {} : { onRetry: () => void approval.refetch() })}
          action={
            <SecondaryButton onClick={() => navigate(APPROVALS_PATH)}>
              Back to the inbox
            </SecondaryButton>
          }
        />
      </div>
    );
  }

  /* The five header cells the proof screen carries. Each is a fact about the
     decision, not a drillable metric, so none of them takes an `onDrill`. */
  const metrics: MetricCellProps[] = [
    ...(detail.value ? [{ label: "Value", value: detail.value }] : []),
    {
      label: "Agent",
      value:
        detail.requestedBy.kind === "AGENT" ? (
          <AIChip
            variant="suggested"
            label={detail.requestedBy.name}
            {...(detail.recommendation.provenance
              ? { provenance: detail.recommendation.provenance }
              : { withoutPopover: true })}
          />
        ) : (
          detail.requestedBy.name
        ),
    },
    ...(typeof detail.confidence === "number"
      ? [{ label: "Confidence", value: `${Math.round(detail.confidence * 100)}%` }]
      : []),
    ...(typeof detail.marginRate === "number"
      ? [{ label: "Margin", value: `${Math.round(detail.marginRate * 100)}%` }]
      : []),
    { label: "Risk", value: humanise(detail.risk.level) },
  ];

  const metaLine = [
    detail.targetRef,
    `policy ${detail.policyId}`,
    detail.slaBreached
      ? "SLA breached"
      : typeof detail.slaRemainingMinutes === "number"
        ? `SLA ${Math.round(detail.slaRemainingMinutes / 60)}h remaining`
        : null,
  ];

  /* §7: a 409 means the world moved under the rendered diff and carries the
     recomputed one. The toast reports the failure; this panel shows the new
     consequences, so the two do not repeat each other. */
  const decideFailure = decide.error ? toApiError(decide.error) : undefined;
  const recomputed: DiffLine[] | undefined =
    decideFailure && isDomainError(decideFailure) && decideFailure.details?.diffChanged === true
      ? (decideFailure.details.diff as DiffLine[] | undefined)
      : undefined;

  const actions = pending ? (
    <>
      <DangerButton onClick={() => submit("REJECT")} disabled={decide.isPending}>
        Reject
      </DangerButton>
      <SecondaryButton onClick={() => submit("REQUEST_CHANGES")} disabled={decide.isPending}>
        Request changes
      </SecondaryButton>
      <PrimaryButton onClick={() => submit("APPROVE")} disabled={decide.isPending}>
        {decide.isPending ? "Deciding…" : "Approve"}
      </PrimaryButton>
    </>
  ) : null;

  const status = decided?.status ?? detail.status;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordHeader
        title={detail.subject}
        recordRef={detail.ref}
        meta={metaLine}
        metrics={metrics}
        chips={
          <StatusChip tone={APPROVAL_TONE[status]}>
            {status === "PENDING" ? "Awaiting your approval" : humanise(status)}
          </StatusChip>
        }
        {...(actions ? { primaryAction: actions } : {})}
      />

      {armed && NEEDS_NOTE.includes(armed) ? (
        <div className="mx-5 mb-4 flex flex-col gap-2 rounded-control border border-border bg-surface p-3.5">
          <label
            htmlFor="approval-note"
            className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted"
          >
            {DECISION_LABEL[armed]} — say why
          </label>
          <textarea
            id="approval-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="rounded-control border border-border bg-card px-3 py-2 text-[13px] text-ink"
            placeholder="The requester sees this. Be specific about what has to change."
          />
          <div className="flex items-center gap-2">
            <SecondaryButton
              onClick={() => submit(armed)}
              disabled={note.trim().length === 0 || decide.isPending}
            >
              Submit {DECISION_LABEL[armed].toLowerCase()}
            </SecondaryButton>
            <SecondaryButton
              onClick={() => {
                setArmed(null);
                setNote("");
              }}
            >
              Cancel
            </SecondaryButton>
            {note.trim().length === 0 ? (
              <span className="text-[12px] text-ink-muted">A note is required.</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-wrap items-start gap-0">
        {/* ---- Queue rail ------------------------------------------------ */}
        <aside className="flex w-[248px] shrink-0 flex-col gap-3 border-r border-divider px-5 pb-5">
          <div className="flex items-baseline justify-between gap-2">
            <button
              type="button"
              onClick={() => navigate(APPROVALS_PATH)}
              className="text-[12px] text-primary-hover hover:underline"
            >
              ← Approval inbox
            </button>
            {position >= 0 ? (
              <span className="font-mono text-[11px] text-ink-muted">
                {position + 1} of {queueRows.length}
              </span>
            ) : null}
          </div>

          <ul className="flex flex-col">
            {queueRows.map((row) => {
              const current = row.ref === detail.ref;
              return (
                <li key={row.ref} className="border-t border-divider first:border-t-0">
                  <button
                    type="button"
                    onClick={() => navigate(approvalPath(row.ref))}
                    className={`flex w-full flex-col gap-0.5 py-2.5 text-left ${
                      current ? "text-ink" : "text-ink-secondary hover:text-ink"
                    }`}
                  >
                    <span className={`text-[13px] ${current ? "font-semibold" : "font-medium"}`}>
                      {row.subject}
                    </span>
                    <span
                      className={`font-mono text-[11px] ${
                        row.slaBreached ? "text-danger" : "text-ink-muted"
                      }`}
                    >
                      {row.value ? (
                        <MoneyText value={row.value} compact />
                      ) : (
                        humanise(row.actionType)
                      )}
                      {row.slaBreached ? " · SLA breached" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap gap-2">
            <KeyboardShortcut keys={["A"]} action="approve" />
            <KeyboardShortcut keys={["R"]} action="reject" />
            <KeyboardShortcut keys={["C"]} action="request changes" />
          </div>
        </aside>

        {/* ---- Decision column ------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col gap-5 px-5 pb-6">
          {decided ? (
            <ExceptionBanner
              severity="INFO"
              title={`${humanise(decided.status)} by ${decided.decidedBy.name ?? decided.decidedBy.id}`}
              subtitle={`${decided.effects.length} change${
                decided.effects.length === 1 ? "" : "s"
              } applied`}
            />
          ) : null}

          {recomputed ? (
            <ExceptionBanner
              severity="WARN"
              title="This approval moved while you were reading it"
              subtitle="The consequences below have been recomputed. Read them again before deciding."
            />
          ) : null}

          <Block title="Why this needs you">
            <p className="text-[13px] leading-[1.6] text-ink-secondary">{detail.reason}</p>
          </Block>

          <Block
            title="Recommendation"
            aside={
              <>
                {detail.recommendation.provenance ? (
                  <AIChip
                    provenance={detail.recommendation.provenance}
                    label={detail.requestedBy.name}
                    showConfidence
                  />
                ) : null}
                {detail.modelAgreement ? <JuryChip jury={detail.modelAgreement} /> : null}
              </>
            }
          >
            <p className="text-[15px] font-semibold text-ink">
              {humanise(detail.recommendation.verdict)}
            </p>
            <p className="text-[13px] leading-[1.6] text-ink-secondary">
              {detail.recommendation.rationale}
            </p>
          </Block>

          <Block title={`Evidence · ${detail.evidence.length}`}>
            <ol className="flex flex-col gap-1.5">
              {detail.evidence.map((item) => (
                <li key={item.n} className="flex items-start gap-2 text-[13px] text-ink-secondary">
                  <CitationChip label={`Source ${item.n}`}>{item.n}</CitationChip>
                  <span className="min-w-0 flex-1 leading-[1.55]">{item.label}</span>
                  <RefChip refValue={item.ref} type={item.type} />
                </li>
              ))}
            </ol>
          </Block>

          {detail.modelAgreement && detail.modelAgreement.dissented.length > 0 ? (
            <Block title="Model disagreement">
              <ul className="flex flex-col gap-1">
                {detail.modelAgreement.dissented.map((vote) => (
                  <li key={vote.model} className="text-[13px] text-ink-secondary">
                    <span className="font-medium text-ink">{vote.model}</span> differed ·{" "}
                    {vote.note}
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-ink-muted">
                Agreed: {detail.modelAgreement.agreed.join(", ")}
              </p>
            </Block>
          ) : null}

          {detail.deviations.length > 0 ? (
            <Block title="Differs from normal">
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {detail.deviations.map((line) => (
                  <li key={line} className="text-[13px] leading-[1.55] text-ink-secondary">
                    {line}
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}

          <Block
            title="Risk"
            aside={
              <StatusChip
                tone={
                  detail.risk.level === "HIGH"
                    ? "danger"
                    : detail.risk.level === "MEDIUM"
                      ? "warning"
                      : "neutral"
                }
              >
                {humanise(detail.risk.level)}
              </StatusChip>
            }
          >
            <p className="text-[13px] leading-[1.6] text-ink-secondary">{detail.risk.note}</p>
          </Block>

          {/* The one bordered element in the column. */}
          <DiffBlock
            lines={recomputed ?? detail.diff}
            title={`If you approve, this happens · ${(recomputed ?? detail.diff).length} changes`}
          />

          {decided ? (
            <DiffBlock
              lines={decided.effects}
              title={`What happened · ${decided.effects.length}`}
            />
          ) : null}
        </div>

        {/* ---- Preview pane ---------------------------------------------- */}
        <aside className="flex w-[300px] shrink-0 flex-col gap-4 border-l border-divider px-5 pb-6">
          <Block title="What is being decided">
            <div className="flex flex-col gap-1.5 text-[13px] text-ink-secondary">
              <span className="flex items-center gap-2">
                <RefChip refValue={detail.targetRef} />
                <span>{humanise(detail.actionType)}</span>
              </span>
              {detail.value ? (
                <span className="font-mono text-[15px] font-semibold text-ink">
                  <MoneyText value={detail.value} />
                </span>
              ) : null}
              <span className="text-[12px] text-ink-muted">
                Queued <DateText value={detail.slaDueAt} withTime />
              </span>
            </div>
          </Block>

          <Block title={`Audit trail · ${audit.data?.data.length ?? 0}`}>
            {audit.data && audit.data.data.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {audit.data.data.map((entry) => (
                  <li key={`${entry.at}-${entry.event}`} className="flex flex-col gap-0.5">
                    <span className="font-mono text-[11px] text-ink-muted">
                      <DateText value={entry.at} withTime /> · {entry.actor.name ?? entry.actor.id}
                    </span>
                    <span className="text-[12px] leading-[1.5] text-ink-secondary">
                      {entry.summary}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-ink-muted">
                Nothing has been recorded against this approval yet.
              </p>
            )}
          </Block>
        </aside>
      </div>
    </div>
  );
}
