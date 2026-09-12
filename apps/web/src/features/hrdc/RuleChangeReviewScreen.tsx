import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ActionResponse, DiffLine, RuleChange, RuleChangeSet } from "@trainos/contract";
import {
  AIChip,
  Breadcrumb,
  ContentCard,
  DateText,
  DiffBlock,
  ErrorState,
  formatDate,
  ExceptionBanner,
  LoadingState,
  PrimaryButton,
  RecordHeader,
  RefChip,
  SecondaryButton,
  StatusChip,
} from "@/shared/components/kit";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { toApiError } from "@/shared/api";
import { ActionOutcome } from "./ActionOutcome";
import { useApproveRuleChanges, useRuleChangeSet } from "./api";

/**
 * M12-S08 · rule change review.
 *
 * Ingestion proposes; it never activates. A circular arrives, a model reads it,
 * and every rule it claims to find sits here as a dated, cited proposal until a
 * human approves it one at a time.
 *
 * The two panes are one argument: the highlighted span in the document pane is
 * the SAME text the selected diff card was extracted from, so approving a
 * change never means trusting a summary of a sentence nobody read.
 */

/**
 * DECISIONS: a change read at under 0.80 confidence is held for manual
 * transcription rather than shown as a diff — a low-confidence diff invites a
 * reader to approve a sentence the model did not understand. Belongs in the
 * contract as `RULE_CHANGE_MIN_CONFIDENCE`; asked fixtures to export it.
 */
const RULE_CHANGE_MIN_CONFIDENCE = 0.8;

const OP_TONE = { ADD: "success", MODIFY: "info", SUPERSEDE: "warning" } as const;

/** A change's before/after as the kit's diff lines. */
function diffOf(change: RuleChange): DiffLine[] {
  const lines: DiffLine[] = [];
  if (change.before !== null) {
    lines.push({
      op: "REMOVE",
      entity: "Rule",
      ...(change.targetRuleId ? { ref: change.targetRuleId } : {}),
      description: change.before,
    });
  }
  lines.push({
    op: change.before === null ? "ADD" : "UPDATE",
    entity: "Rule",
    ...(change.newRuleId ? { ref: change.newRuleId } : {}),
    description: change.after,
  });
  return lines;
}

export function RuleChangeReviewScreen({ documentId }: { documentId: string }) {
  const changeSet = useRuleChangeSet(documentId);
  const approve = useApproveRuleChanges(documentId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [outcome, setOutcome] = useState<ActionResponse | undefined>(undefined);

  const data = changeSet.data;

  /** Shown as diffs, and held for transcription. Two lists, one rule. */
  const { shown, held } = useMemo(() => {
    const changes = data?.changes ?? [];
    return {
      shown: changes.filter((change) => change.confidence >= RULE_CHANGE_MIN_CONFIDENCE),
      held: changes.filter((change) => change.confidence < RULE_CHANGE_MIN_CONFIDENCE),
    };
  }, [data]);

  if (changeSet.isPending) {
    return <LoadingState rows={8} label={`Loading the rule changes read from ${documentId}`} />;
  }

  if (changeSet.error || !data) {
    return (
      <ErrorState
        title="This rule change set could not be loaded"
        error={toApiError(changeSet.error)}
        onRetry={() => void changeSet.refetch()}
      />
    );
  }

  const selected = shown.find((change) => change.id === selectedId) ?? shown[0] ?? null;
  const widest = shown.reduce<RuleChange | null>(
    (worst, change) =>
      change.affectedEngagements.length > (worst?.affectedEngagements.length ?? 0) ? change : worst,
    null,
  );
  const affectedTotal = new Set(
    shown.flatMap((change) => change.affectedEngagements.map((engagement) => engagement.ref)),
  ).size;

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  const onApprove = async () => {
    try {
      setOutcome(await approve.mutateAsync({ changeIds: [...checked] }));
    } catch {
      /* Rendered by ActionOutcome from the mutation's error. */
    }
  };

  return (
    <div className="flex flex-col">
      <div className="px-6 pt-5">
        <Breadcrumb
          items={[
            { label: "Compliance" },
            { label: "Rule changes", href: "/compliance/rule-changes" },
            { label: data.title },
          ]}
          linkAs={({ href, children, className }) => (
            <Link to={href} className={className}>
              {children}
            </Link>
          )}
        />
      </div>

      <RecordHeader
        title={`${data.title} · proposed rule changes`}
        recordRef={data.documentId}
        meta={[
          `published ${formatDate(data.publishedAt)}`,
          `ingested ${formatDate(data.ingestedAt)}`,
          `extracted by ${data.extractedBy.model}`,
          `effective ${formatDate(data.effectiveFrom)}`,
        ]}
        chips={
          <>
            <StatusChip tone="warning" live>{`${shown.length} proposed`}</StatusChip>
            <AIChip
              provenance={{
                origin: "AI_SUGGESTED",
                model: data.extractedBy.model,
                confidence: data.extractedBy.confidence,
                runId: data.extractedBy.runId,
                generatedAt: data.ingestedAt,
              }}
            />
          </>
        }
        actions={
          <SecondaryButton onClick={() => setChecked(new Set())} disabled={checked.size === 0}>
            Clear selection
          </SecondaryButton>
        }
        primaryAction={
          <PrimaryButton
            onClick={() => void onApprove()}
            disabled={checked.size === 0 || approve.isPending}
          >
            Approve selected
          </PrimaryButton>
        }
        metrics={[
          { label: "Proposed changes", value: `${shown.length}` },
          {
            label: "Affecting",
            value: `${affectedTotal} engagements`,
            sub: held.length > 0 ? `${held.length} held for transcription` : undefined,
          },
          {
            label: "Confidence",
            value: data.extractedBy.confidence.toFixed(2),
            sub: "extraction",
          },
          { label: "Published", value: <DateText value={data.publishedAt} /> },
          { label: "Effective", value: <DateText value={data.effectiveFrom} /> },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 px-6 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DocumentPane changeSet={data} selected={selected} />

        <div className="flex flex-col gap-4">
          {widest && widest.affectedEngagements.length > 0 ? (
            <ExceptionBanner
              severity="WARN"
              title={`One change affects ${widest.affectedEngagements.length} open engagements`}
              subtitle={`${widest.targetRuleId ?? ""}${
                widest.newRuleId ? ` → ${widest.newRuleId}` : ""
              } · ${widest.after}. Those engagements would fail the new check.`}
              action={
                <div className="flex flex-wrap gap-1">
                  {widest.affectedEngagements.map((engagement) => (
                    <RefChip key={engagement.ref} refValue={engagement.ref} />
                  ))}
                </div>
              }
            />
          ) : null}

          <ActionOutcome
            response={outcome}
            error={approve.error}
            subject={`Rule changes · ${data.title}`}
            executedTitle="Rule changes activated"
          />

          {shown.map((change) => (
            <ChangeCard
              key={change.id}
              change={change}
              model={data.extractedBy.model}
              effectiveFrom={data.effectiveFrom}
              selected={selected?.id === change.id}
              checked={checked.has(change.id)}
              onSelect={() => setSelectedId(change.id)}
              onToggle={() => toggle(change.id)}
            />
          ))}

          {held.map((change) => (
            <ExceptionBanner
              key={change.id}
              severity="INFO"
              title="Held for manual transcription"
              subtitle={`A change to ${change.targetRuleId ?? "an unnamed rule"} was read at ${change.confidence.toFixed(
                2,
              )} confidence, below the ${RULE_CHANGE_MIN_CONFIDENCE.toFixed(
                2,
              )} floor. It is not shown as a diff: §${change.sourceSpan.section} on page ${
                change.sourceSpan.page
              } needs reading by a person.`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The source document, with the selected change's span highlighted.
 *
 * Only the extracted spans are available, so the pane says so rather than
 * implying it is showing the whole circular.
 */
function DocumentPane({
  changeSet,
  selected,
}: {
  changeSet: RuleChangeSet;
  selected: RuleChange | null;
}) {
  return (
    <ContentCard
      eyebrow="SOURCE DOCUMENT"
      title={changeSet.title}
      actions={
        <span className="font-mono text-[11px] text-ink-muted">
          {selected ? `page ${selected.sourceSpan.page}` : "—"}
        </span>
      }
    >
      <p className="pb-3 text-[12px] text-ink-muted">
        The spans the extraction read, in document order. Everything else in {changeSet.documentId}{" "}
        produced no proposed change.
      </p>
      <div className="flex flex-col gap-4 rounded-control border border-border bg-surface px-4 py-4">
        {changeSet.changes.map((change) => {
          const isSelected = selected?.id === change.id;
          return (
            <div key={change.id}>
              <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                {`§${change.sourceSpan.section} · page ${change.sourceSpan.page}`}
              </p>
              <p
                className={
                  isSelected
                    ? "mt-1 rounded-[3px] bg-ai-tint px-1.5 py-1 text-[13px] leading-relaxed text-ink"
                    : "mt-1 px-1.5 py-1 text-[13px] leading-relaxed text-ink-secondary"
                }
              >
                {change.sourceSpan.excerpt}
              </p>
            </div>
          );
        })}
      </div>
    </ContentCard>
  );
}

function ChangeCard({
  change,
  model,
  effectiveFrom,
  selected,
  checked,
  onSelect,
  onToggle,
}: {
  change: RuleChange;
  model: string;
  effectiveFrom: string;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <ContentCard
      className={selected ? "border-primary-border" : undefined}
      title={`${change.targetRuleId ?? "New rule"}${change.newRuleId ? ` → ${change.newRuleId}` : ""}`}
      actions={
        <div className="flex items-center gap-2">
          <StatusChip tone={OP_TONE[change.op]}>{change.op}</StatusChip>
          <AIChip
            provenance={{
              origin: "AI_SUGGESTED",
              model,
              confidence: change.confidence,
              generatedAt: effectiveFrom,
            }}
          />
          <SecondaryButton onClick={onSelect} aria-pressed={selected}>
            {selected ? "Shown in document" : "Show in document"}
          </SecondaryButton>
        </div>
      }
    >
      <DiffBlock lines={diffOf(change)} title="If you approve" />

      <p className="pt-2 text-[12px] text-ink-secondary">
        Effective <DateText value={effectiveFrom} />
        {change.affectedEngagements.length > 0
          ? ` · affects ${change.affectedEngagements.length} open engagements`
          : " · affects no open engagement"}
      </p>

      <div className="flex items-center gap-2 pt-3">
        <Checkbox
          id={`include-${change.id}`}
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={`Include ${change.id} in the approval`}
        />
        <label htmlFor={`include-${change.id}`} className="cursor-pointer text-[13px] text-ink">
          Include in the approval
        </label>
      </div>
    </ContentCard>
  );
}
