import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ActionResponse,
  GapPriority,
  Money,
  TnaGap,
  TnaRecommendation,
} from "@trainos/contract";
import {
  ActionOutcome,
  AIChip,
  Breadcrumb,
  CitationChip,
  DataTable,
  describeActionError,
  ErrorState,
  Fab,
  formatDate,
  formatDateRange,
  formatTime,
  humanise,
  LoadingState,
  MiniBar,
  MoneyText,
  PrimaryButton,
  RecordHeader,
  RefChip,
  SecondaryButton,
  StatusChip,
  TNA_TONE,
  type ActionError,
  type Column,
  PartialDataBanner,
} from "@/shared/components/kit";
import { readableMessage, toApiError, useActor } from "@/shared/api";
import { useTnaAction, useReopenTna, useTna, useTnaClient, useTnaRecommendations } from "./api";

/**
 * M05-S02 · TNA detail (`M05 TNA.dc.html`).
 *
 * What the client actually needs, with the evidence, turned into a ranked
 * programme choice. The ranking is honest on purpose: the third programme sits
 * at 22% and is still listed, because a ranking that only shows what fits
 * teaches nobody what was considered.
 *
 * Two absences are rendered as absences, never as zero. A TNA with no stated
 * budget says "not stated" — `RM 0` would be a number the client never gave —
 * and a recommendation with no price indication shows no price at all.
 *
 * The primary is "Use recommendation": it seeds the proposal and is not policy
 * gated at this step, but all three action outcomes still render because the
 * gate is the server's call, not the screen's.
 */

const PRIORITY_TONE: Record<GapPriority, "warning" | "neutral"> = {
  HIGH: "warning",
  MEDIUM: "neutral",
  LOW: "neutral",
};

export function TnaDetailPage() {
  const { tnaId } = useParams<{ tnaId: string }>();
  const navigate = useNavigate();

  const tna = useTna(tnaId);
  const client = useTnaClient(tna.data?.opportunityRef);
  const recommendations = useTnaRecommendations(tnaId);
  const reopen = useReopenTna(tnaId);
  const action = useTnaAction();
  const actor = useActor();

  const [response, setResponse] = useState<ActionResponse | undefined>(undefined);
  const [failure, setFailure] = useState<ActionError | undefined>(undefined);

  const clearOutcome = () => {
    setResponse(undefined);
    setFailure(undefined);
  };

  if (tna.isPending) return <LoadingState rows={8} label="Loading the TNA" />;

  if (tna.isError || !tna.data) {
    return (
      <ErrorState
        title="The TNA did not load"
        error={toApiError(tna.error)}
        onRetry={() => void tna.refetch()}
      />
    );
  }

  const record = tna.data;
  const ranked = recommendations.data?.data ?? [];
  const best = ranked[0];
  const deliveryWindow = record.constraints.find(
    (constraint) => constraint.code === "DELIVERY_WINDOW",
  );

  const accept = (programmeId: string) => {
    clearOutcome();
    action.mutate(
      {
        type: "TNA_RECOMMENDATION_ACCEPT",
        targetRef: record.ref,
        payload: { programmeId },
        requestedBy: actor,
      },
      {
        /* Every §3 outcome arrives here as a value, the refusal included: a
           queued approval is a success and rendering it through an error path
           is how an approval queue becomes invisible. */
        onSuccess: (result) => {
          if (result.kind === "error") {
            setFailure(describeActionError(result.error, readableMessage(result.error)));
            return;
          }
          setResponse(result.response);
        },
      },
    );
  };

  const gapColumns: Column<TnaGap>[] = [
    {
      key: "gap",
      label: "Gap",
      accessor: (gap) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink">{gap.name}</span>
          <span className="text-[11px] text-ink-muted">{gap.description}</span>
        </div>
      ),
    },
    {
      key: "evidence",
      label: "Evidence",
      width: "180px",
      accessor: (gap) => <span className="text-ink-secondary">{gap.evidenceRefs.join(", ")}</span>,
    },
    {
      key: "priority",
      label: "Priority",
      width: "110px",
      accessor: (gap) => (
        <StatusChip tone={PRIORITY_TONE[gap.priority]}>{humanise(gap.priority)}</StatusChip>
      ),
    },
    {
      key: "source",
      label: "Source",
      align: "right",
      width: "130px",
      accessor: (gap) => <AIChip provenance={gap.provenance} label="TNA Agent" />,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-4">
        {/* Ends at the list. RecordHeader owns the identity and the breadcrumb owns
            the path — the ref was rendered twice, six pixels apart. */}
        <Breadcrumb items={[{ label: "Sales" }, { label: "TNA" }]} />
      </div>

      <RecordHeader
        accent
        collapsible
        recordType="tna"
        /* The record names itself by reference and client. The audience is a
           metric below, so putting it in the title too would say it twice. */
        title={client.data ? client.data.name : "Training needs analysis"}
        recordRef={record.ref}
        meta={[
          record.opportunityRef,
          record.completedBy ? `by ${record.completedBy.name ?? record.completedBy.id}` : null,
          record.completedAt
            ? `completed ${formatDate(record.completedAt)}, ${formatTime(record.completedAt)}`
            : null,
        ]}
        chips={
          <>
            <StatusChip tone={TNA_TONE[record.status]} live>
              {humanise(record.status)}
            </StatusChip>
            <StatusChip>Questionnaire returned</StatusChip>
          </>
        }
        actions={
          <>
            <SecondaryButton onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              Reopen questionnaire
            </SecondaryButton>
            <SecondaryButton>Audit trail</SecondaryButton>
          </>
        }
        primaryAction={
          <PrimaryButton
            onClick={() => best && accept(best.programmeId)}
            disabled={!best || action.isPending}
          >
            Use recommendation
          </PrimaryButton>
        }
        metrics={[
          {
            label: "Audience",
            value: `${record.audience.headcount} ${humanise(record.audience.level).toLowerCase()}s`,
          },
          { label: "Gaps identified", value: `${record.gaps.length}` },
          { label: "Evidence", value: `${record.evidence.length} sources` },
          {
            label: "Window",
            value: deliveryWindow?.label ?? <span className="text-ink-muted">not stated</span>,
          },
          {
            /* Budget absent is an ABSENCE, not zero. `MoneyText` would render
               RM 0.00 and that is a number the client never gave. */
            label: "Budget",
            value: record.budget ? (
              <MoneyText value={record.budget as Money} compact />
            ) : (
              <span className="text-ink-muted">not stated</span>
            ),
          },
        ]}
      />

      {/* The client is half the record's title — "TNA-0042 · Aurora
          Manufacturing". A failed read fell back to the bare reference, which
          is also what an unmatched TNA looks like, so the failure was
          unreadable. */}
      <PartialDataBanner
        className="mx-5 mb-3"
        reads={[
          {
            label: "The client this TNA belongs to",
            error: client.isError ? toApiError(client.error) : null,
            retry: () => void client.refetch(),
          },
        ]}
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto border-r border-divider px-5 py-4">
          <section className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                Competency gaps
              </h2>
              <AIChip
                className="ml-auto"
                provenance={recommendations.data?.provenance}
                label="TNA Agent"
              />
            </div>
            <DataTable
              label="Competency gaps"
              columns={gapColumns}
              rows={record.gaps}
              rowKey={(gap) => gap.name}
              density="compact"
              stickyHeader={false}
            />
          </section>

          <section className="flex flex-col gap-2.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              Audience profile
            </h2>
            <dl className="grid grid-cols-4 gap-4">
              <Cell label="Headcount" value={`${record.audience.headcount}`} />
              <Cell label="Level" value={humanise(record.audience.level)} />
              <Cell label="Sites" value={record.audience.sites.join(", ")} />
              <Cell label="Language" value={record.audience.language} />
            </dl>
          </section>

          <section className="flex flex-col gap-2.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              Constraints
            </h2>
            <div className="flex flex-wrap gap-2">
              {record.constraints.map((constraint) => (
                <StatusChip
                  key={constraint.code}
                  tone={constraint.severity === "WARN" ? "warning" : "neutral"}
                >
                  {constraint.label}
                </StatusChip>
              ))}
              {record.budget ? null : <StatusChip>Budget not stated</StatusChip>}
            </div>
          </section>
        </div>

        <aside className="flex w-[420px] shrink-0 flex-col gap-4 overflow-auto px-5 py-4">
          {recommendations.isPending ? (
            <LoadingState rows={5} label="Loading recommendations" />
          ) : recommendations.isError ? (
            <ErrorState
              title="Recommendations did not load"
              error={toApiError(recommendations.error)}
              onRetry={() => void recommendations.refetch()}
            />
          ) : (
            <section className="overflow-hidden rounded-control border border-primary-border">
              <div className="flex items-center gap-2 border-b border-primary-border bg-ai-tint px-3 py-2">
                <AIChip
                  provenance={recommendations.data?.provenance}
                  label="Programme recommendation"
                />
                <span className="ml-auto text-[12px] text-primary-hover">
                  {recommendations.data?.scoringModel.version}
                </span>
              </div>

              <div className="flex flex-col gap-3 p-3">
                {ranked.map((recommendation, index) => (
                  <RecommendationCard
                    key={recommendation.programmeId}
                    recommendation={recommendation}
                    leading={index === 0}
                    busy={action.isPending}
                    onUse={() => accept(recommendation.programmeId)}
                    onOpenProgramme={() =>
                      navigate(`/training/programmes/${recommendation.programmeId}`)
                    }
                  />
                ))}
              </div>
            </section>
          )}

          <ActionOutcome
            response={response}
            error={failure}
            subject={`Use recommendation · ${record.ref}`}
            onDismiss={clearOutcome}
          />

          <section className="flex flex-col gap-2.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              Evidence
            </h2>
            <ul className="flex flex-col gap-2 text-[12px]">
              {record.evidence.map((evidence, index) => (
                <li key={`${evidence.ref}-${index}`} className="flex items-center gap-2">
                  <CitationChip variant="inline" label={`Source ${index + 1}: ${evidence.ref}`}>
                    {index + 1}
                  </CitationChip>
                  <RefChip type={evidence.type} />
                  <span className="truncate text-ink-secondary">{evidence.ref}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <Fab />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="text-[14px] font-medium text-ink">{value}</dd>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  leading,
  busy,
  onUse,
  onOpenProgramme,
}: {
  recommendation: TnaRecommendation;
  leading: boolean;
  busy: boolean;
  onUse: () => void;
  onOpenProgramme: () => void;
}) {
  const percent = Math.round(recommendation.fitScore * 100);
  const available = (recommendation.trainerAvailability ?? []).filter(
    (trainer) => trainer.available,
  );

  return (
    <article
      className={
        leading
          ? "flex flex-col gap-1.5 rounded-control border border-primary-border bg-card p-3"
          : "flex flex-col gap-1.5 rounded-control border border-border bg-surface p-3"
      }
    >
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={onOpenProgramme}
          className="text-left text-[14px] font-semibold text-ink underline-offset-2 hover:underline"
        >
          {recommendation.name}
        </button>
        <span
          className={
            leading
              ? "ml-auto font-mono text-[13px] font-semibold text-primary-hover"
              : "ml-auto font-mono text-[13px] font-semibold text-ink-secondary"
          }
        >
          {percent}%
        </span>
      </div>

      <p className="text-[12px] text-ink-secondary">
        {recommendation.priceIndication ? (
          <MoneyText value={recommendation.priceIndication} compact />
        ) : (
          "no price indication"
        )}
      </p>

      <MiniBar
        value={recommendation.fitScore}
        label={`Fit score for ${recommendation.name}`}
        valueText={`${percent}% fit`}
        size="md"
      />

      <p className="text-[12px] leading-[1.5] text-ink-secondary">{recommendation.rationale}</p>

      {available.length > 0 ? (
        <p className="text-[12px] text-ink-muted">
          {available
            .map((trainer) =>
              trainer.dates ? `${trainer.name} ${formatDateRange(trainer.dates)}` : trainer.name,
            )
            .join(" · ")}
        </p>
      ) : null}

      {leading ? (
        <div className="flex gap-2 pt-1">
          <SecondaryButton onClick={onUse} disabled={busy}>
            Use recommendation
          </SecondaryButton>
          <SecondaryButton>Compare</SecondaryButton>
        </div>
      ) : null}
    </article>
  );
}
