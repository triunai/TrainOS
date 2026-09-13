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
 * The consequence block is the ONLY bordered element in that narrative, because
 * it answers the approver's real question. Everything above it is held together
 * by spacing and type, per CLAUDE.md's hierarchy rule.
 *
 * PROTOTYPE (tightening brief §15a). This screen is the first opt-in to the
 * RECORD variant of `RecordHeader`: the whole header is one blue gradient card
 * — title row, meta line, hairline, metric strip — with a single round chevron
 * that collapses it to the title row and the meta line. Kit.dc.html §11-13
 * draws it; M04-S02 captions the same card "the record-page pattern every
 * entity in the chain inherits", so this is a first proof, not an approval-only
 * treatment.
 *
 * Nothing inside the header knows it is on blue. The buttons and the chip read
 * `useOnAccent` from the card, so the markup here is what it would be on a
 * white header, which is what keeps 26 other screens one prop away.
 *
 * The narrative stays in the decision column, where it always was. An earlier
 * pass moved it inside the card; the final ruling put it back, and the column
 * between the queue rail and the preview pane is the better home for it anyway
 * — it is a readable measure, and it leaves no dead space when the card
 * collapses.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ApprovalDecision, DiffLine } from "@trainos/contract";
import {
  AIChip,
  AI_GLYPH,
  APPROVAL_TONE,
  CitationChip,
  DangerButton,
  DateText,
  DiffBlock,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  humanise,
  JuryChip,
  KeyboardShortcut,
  LoadingState,
  MoneyText,
  PrimaryButton,
  RecordHeader,
  RefChip,
  SecondaryButton,
  StatusChip,
  TextArea,
  type MetricCellProps,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { isDomainError, isNotDeployed, notDeployedState, toApiError } from "@/shared/api";
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
  /* The decide takes the approval's ID. The route carries its REF, which
     `core.decide_approval(p_approval_id uuid, …)` cannot parse (22P02); the
     fixture client accepts either, which is why fixtures never showed it. The
     buttons only render once the detail has loaded, so the id is always there
     by the time a decision is sent. */
  const decide = useDecideApproval(approval.data?.id ?? ref);

  /* The queue rail. The same grouped read the inbox uses, so the rail and the
     inbox can never disagree about what is next. */
  const queue = useApprovalInbox({ group: "URGENCY" });
  const queueRows = queue.data?.data ?? [];
  const position = queueRows.findIndex((row) => row.ref === ref);

  const [armed, setArmed] = useState<ApprovalDecision | null>(null);
  const [note, setNote] = useState("");

  /* The trail names the record; RecordHeader names the subject. The two say
     different things on purpose, so neither repeats the other. */
  /* The trail is the PATH and stops at the list. CLAUDE.md: record identity
     appears once per page and RecordHeader owns it — the ref is already in the
     card's mono line, and a third copy in the topbar is the duplication the
     rule exists to stop. */
  useBreadcrumb([
    { label: "Home", href: "/" },
    { label: "Approvals", href: APPROVALS_PATH },
  ]);

  const detail = approval.data;
  const decided = decide.data;
  const pending = detail?.status === "PENDING" && decided === undefined;
  /* An APPROVE must echo the diff hash it was shown, and the database refuses
     one without it. A payload that carries none — an environment whose
     approval read predates the field — cannot be approved from here, so the
     button says so instead of sending a request that is certain to fail. */
  const canApprove = typeof detail?.diffHash === "string" && detail.diffHash.trim().length > 0;

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
    /* The buttons that call `submit` render only while `pending` is true,
       which already implies `detail` is loaded — this is for the type
       checker, not a reachable branch. */
    if (!detail) return;
    if (decision === "APPROVE" && !canApprove) return;
    const needsNote = NEEDS_NOTE.includes(decision);
    if (needsNote && note.trim().length === 0) {
      setArmed(decision);
      return;
    }
    /* Fire-and-forget, per CLAUDE.md R3: the mutation carries
       `meta.toastOnError`, so a refusal is never silent.

       `diffHash` is the hash off THIS detail read — echoing it back is what
       lets `core.decide_approval`'s optimistic-concurrency guard
       (`011:2781-2787`) tell a decision made against the diff still shown
       here from one made against a diff that has since changed underneath
       it. See finding #6, docs/reviews/2026-09-13-codex-retrofit-014-017.md. */
    decide.mutate({ decision, note: needsNote ? note.trim() : null, diffHash: detail.diffHash });
    setArmed(null);
  };

  if (approval.isPending) {
    return (
      <div className="flex flex-col">
        <LoadingState rows={8} label="Loading the approval" className="px-5" />
      </div>
    );
  }

  if (isNotDeployed(approval.error)) {
    return (
      <div className="flex flex-col">
        <EmptyState {...notDeployedState("This approval")} />
      </div>
    );
  }

  if (approval.error || !detail) {
    /* TanStack hands back the EXCEPTION the query threw, not the `ApiError`
       inside it. Unwrapping is what keeps a NOT_FOUND classified as a refusal
       — and a refusal, per CLAUDE.md R2, is never offered a retry button.
       Deciding that here as well as inside `ErrorState` was two copies of one
       rule; the component owns it, so this hands over the error and lets it. */
    const failure = approval.error ? toApiError(approval.error) : undefined;

    return (
      <div className="flex flex-col">
        <ErrorState
          title="That approval could not be opened"
          error={failure}
          onRetry={() => void approval.refetch()}
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
      /* An AIChip here would be a white pill on a vivid blue band — the
         per-cell slab §15a rules out, and a 6% tint means nothing on this
         ground anyway. CLAUDE.md's actual requirement is the ✦ glyph plus a
         text label, which survives intact as plain white type. The provenance
         popover is not lost: it is on the AIChip in Recommendation, one
         disclosure below, where it sits on an ordinary card surface. */
      value:
        detail.requestedBy.kind === "AGENT" ? (
          <span className="truncate">
            <span aria-hidden="true">{AI_GLYPH} </span>
            {detail.requestedBy.name}
          </span>
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
      <PrimaryButton onClick={() => submit("APPROVE")} disabled={decide.isPending || !canApprove}>
        {decide.isPending ? "Deciding…" : "Approve"}
      </PrimaryButton>
    </>
  ) : null;

  const status = decided?.status ?? detail.status;

  /* The narrative, verbatim and in order — only its container has changed. It
     now hangs off the metric band as that band's detail, which is what puts the
     five facts and the case that rests on them in one object instead of two. */
  const caseSections = (
    /* Back in the decision column, between the queue rail and the preview pane,
       which is where the final §15a ruling leaves it: the blue card carries the
       record's facts, not its case. The column is already a readable measure,
       so the cap this needed while it lived inside the full-width card is off. */
    <div className="flex flex-col gap-5">
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
                <span className="font-medium text-ink">{vote.model}</span> differed · {vote.note}
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

      {/* Still the one bordered element in the narrative. */}
      <DiffBlock
        lines={recomputed ?? detail.diff}
        title={`If you approve, this happens · ${(recomputed ?? detail.diff).length} changes`}
      />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Above the card, not inside the rail. A back link is a statement about
          where this page sits, so it belongs on the page surface and at the
          page's width — putting it in the rail made it look like the rail's
          heading and gave the queue a header block aligned to nothing. The
          position rides along as a muted suffix rather than as its own row. */}
      <div className="flex items-baseline gap-2 px-5 pt-4">
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

      <RecordHeader
        accent
        collapsible
        recordType="approval"
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
          <TextArea
            label={`${DECISION_LABEL[armed]} — say why`}
            value={note}
            onChange={setNote}
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
                    {/* W-08. A breach is a STATUS, so it wears a chip —
                        CLAUDE.md puts status colour on chips only, and red mono
                        text in a rail is the same claim made in the one place
                        the design system says not to make it. Same fix
                        applier-2 applied to the six other sites in 17535f3. */}
                    <span className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ink-muted">
                      {row.value ? (
                        <MoneyText value={row.value} compact />
                      ) : (
                        humanise(row.actionType)
                      )}
                      {row.slaBreached ? (
                        <StatusChip tone="danger" shape="square">
                          SLA breached
                        </StatusChip>
                      ) : null}
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

          {pending && !canApprove ? (
            <ExceptionBanner
              severity="INFO"
              title="Approving is not available here yet"
              subtitle="This environment does not send the change fingerprint an approval must echo back, so an approve would be refused. Reject and request changes still work."
            />
          ) : null}

          {recomputed ? (
            <ExceptionBanner
              severity="WARN"
              title="This approval moved while you were reading it"
              subtitle="The consequences below have been recomputed. Read them again before deciding."
            />
          ) : null}

          {caseSections}

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

          {/* Three branches, where there was one. The count in the heading was
              `audit.data?.data.length ?? 0`, so a failed read printed "Audit
              trail · 0" above the same sentence a genuinely empty trail gets:
              "nothing has happened to this approval" and "we could not find out
              what happened to this approval" were the same pixels. On an
              approval that is the wrong two things to confuse. The count is now
              omitted until there is an answer to count. */}
          <Block title={audit.data ? `Audit trail · ${audit.data.data.length}` : "Audit trail"}>
            {audit.isPending ? <LoadingState rows={2} label="Loading the audit trail" /> : null}

            {isNotDeployed(audit.error) ? (
              <EmptyState className="px-0 py-6" {...notDeployedState("The audit trail")} />
            ) : audit.isError ? (
              <ErrorState
                className="px-0 py-6"
                title="The audit trail did not load"
                error={toApiError(audit.error)}
                onRetry={() => void audit.refetch()}
              />
            ) : null}

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
            ) : null}

            {audit.data && audit.data.data.length === 0 ? (
              <EmptyState
                className="px-0 py-6"
                title="Nothing recorded yet"
                description="Every decision, reassignment and escalation on this approval is written here as it happens."
              />
            ) : null}
          </Block>
        </aside>
      </div>
    </div>
  );
}
