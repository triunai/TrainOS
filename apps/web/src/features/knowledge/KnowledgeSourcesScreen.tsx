import { useMemo, useState } from "react";
import type {
  KnowledgeSource,
  KnowledgeSourceType,
  MonitorStatus,
  RetrievalScope,
} from "@trainos/contract";
import {
  ContentCard,
  DataTable,
  DateText,
  EMBEDDING_TONE,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  GhostButton,
  humanise,
  LoadingState,
  MONITOR_TONE,
  PrimaryButton,
  RecordHeader,
  RefusalBanner,
  SecondaryButton,
  StatusChip,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { useCheckSource, useKnowledgeSources, useReingestSource } from "./api";

/**
 * M16-S05 · Knowledge sources.
 *
 * Primary user: System Admin; Compliance follows the changed-source link.
 * Primary button: "Add source".
 *
 * The screen answers two questions and they are not the same one. WHAT are the
 * agents allowed to read — the retrieval scopes, which decide whether a source
 * can be cited in a compliance answer, in client-facing text, or in neither.
 * And HOW FRESH is it — the monitor and embedding states, which decide whether
 * what they read is still true.
 *
 * The interesting state is a CHANGED source, and the rule it demonstrates is
 * worth stating on the page rather than leaving in a runbook: a changed source
 * is quarantined from rule extraction until its diffs are reviewed, and it
 * stays searchable the whole time. Pulling it out of search too would take the
 * old, still-correct answers away to protect against a change nobody has read
 * yet — trading a known good for an unknown one.
 */

const MONITOR_LABEL: Record<MonitorStatus, string> = {
  WATCHING: "Watching weekly",
  CHANGED_REVIEW_PENDING: "Changed · review pending",
  FAILED: "Failed · fetch",
  MANUAL: "Manual",
};

/**
 * `humanise` turns `HRDC_CIRCULAR` into "Hrdc circular", which is a body the
 * reader has never heard of. The corpus is HRD Corp's, and its name is not a
 * casing accident.
 */
const TYPE_LABEL: Record<KnowledgeSourceType, string> = {
  HRDC_CIRCULAR: "HRD Corp circular",
};

const SCOPE_LABEL: Record<RetrievalScope, string> = {
  COMPLIANCE: "Compliance",
  CLIENT_FACING: "Client-facing",
};

export function KnowledgeSourcesScreen() {
  const sources = useKnowledgeSources();
  useBreadcrumb([{ label: "Knowledge" }, { label: "Sources" }, { label: "Corpus" }]);

  const check = useCheckSource();
  const reingest = useReingestSource();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => sources.data?.data ?? [], [sources.data]);

  const columns = useMemo<Column<KnowledgeSource>[]>(
    () => [
      {
        key: "name",
        label: "Source",
        /* The version rides with the name. It is part of WHICH document this
           is, not a fact about it, and nine columns did not fit 1440px beside
           the 240px rail. */
        accessor: (source) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] font-medium text-ink">{source.name}</span>
            <span className="truncate text-[11px] text-ink-muted">
              {TYPE_LABEL[source.type]} · {source.version}
            </span>
          </div>
        ),
      },
      {
        key: "ingested",
        label: "Ingested",
        accessor: (source) => <DateText value={source.ingestedAt} />,
        width: "115px",
      },
      {
        key: "chunks",
        label: "Chunks",
        align: "right",
        accessor: (source) => (
          <span className="font-mono tabular-nums">
            {source.chunks === 0 ? "—" : source.chunks.toLocaleString("en-MY")}
          </span>
        ),
        width: "80px",
      },
      {
        key: "embedding",
        label: "Embedding",
        accessor: (source) => (
          <StatusChip tone={EMBEDDING_TONE[source.embeddingStatus]} shape="square">
            {humanise(source.embeddingStatus)}
          </StatusChip>
        ),
        width: "105px",
      },
      {
        key: "scopes",
        label: "Retrievable for",
        accessor: (source) => (
          <span className="text-[12px] text-ink-secondary">
            {source.retrievalScopes.map((scope) => SCOPE_LABEL[scope]).join(" · ")}
            {source.retrievalScopes.includes("CLIENT_FACING") ? null : (
              <span className="block text-[11px] text-ink-muted">excluded from client text</span>
            )}
          </span>
        ),
        width: "150px",
      },
      {
        key: "monitor",
        label: "Monitor",
        accessor: (source) => (
          <div className="flex flex-col items-start gap-1">
            <StatusChip tone={MONITOR_TONE[source.monitorStatus]}>
              {MONITOR_LABEL[source.monitorStatus]}
            </StatusChip>
            {source.monitorStatus === "CHANGED_REVIEW_PENDING" ? (
              <span className="text-[11px] text-ink-muted">
                quarantined from rule extraction · still searchable
              </span>
            ) : null}
            {/* "Last checked" folded in here rather than taking a column of its
                own: on a FAILED source the date is the whole point, and on a
                watched one it is the same weekly sweep on every row. */}
            <span className="text-[11px] text-ink-muted">
              {source.lastCheckedAt ? (
                <>
                  {source.monitorStatus === "FAILED" ? "failing since " : "checked "}
                  <DateText value={source.lastCheckedAt} withTime />
                </>
              ) : (
                "never checked"
              )}
            </span>
          </div>
        ),
        width: "215px",
      },
      {
        key: "actions",
        label: "Actions",
        srOnlyLabel: true,
        accessor: (source) => (
          <div className="flex items-center gap-1.5">
            <GhostButton
              disabled={check.isPending && busyId === source.id}
              onClick={() => {
                setBusyId(source.id);
                check.mutate(source.id);
              }}
            >
              Check
            </GhostButton>
            <GhostButton
              disabled={reingest.isPending && busyId === source.id}
              onClick={() => {
                setBusyId(source.id);
                reingest.mutate(source.id);
              }}
            >
              Re-ingest
            </GhostButton>
          </div>
        ),
        width: "160px",
      },
    ],
    [busyId, check, reingest],
  );

  if (sources.isPending) return <LoadingState rows={8} label="Loading knowledge sources" />;
  if (sources.isError) {
    return (
      <ErrorState
        title="Knowledge sources could not be loaded"
        error={sources.error}
        onRetry={() => void sources.refetch()}
      />
    );
  }

  const changed = rows.find((source) => source.monitorStatus === "CHANGED_REVIEW_PENDING");
  const failing = rows.find((source) => source.monitorStatus === "FAILED");
  const pending = rows.filter((source) => source.embeddingStatus === "PENDING").length;
  const indexed = rows.filter((source) => source.embeddingStatus === "INDEXED").length;
  const chunks = rows.reduce((total, source) => total + source.chunks, 0);
  const lastCheck = rows
    .map((source) => source.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="Sources"
        meta={[
          `${rows.length} sources`,
          changed ? "1 changed" : "none changed",
          failing ? "1 failing" : null,
        ]}
        actions={
          <>
            <SecondaryButton>Ingestion log</SecondaryButton>
            <SecondaryButton
              disabled={check.isPending}
              onClick={() => {
                const first = rows[0];
                if (!first) return;
                setBusyId(first.id);
                check.mutate(first.id);
              }}
            >
              Check now
            </SecondaryButton>
          </>
        }
        primaryAction={<PrimaryButton>Add source</PrimaryButton>}
        metrics={[
          { label: "Sources", value: rows.length },
          { label: "Chunks", value: chunks.toLocaleString("en-MY") },
          {
            label: "Embedded",
            value: `${indexed} of ${rows.length}`,
            sub: pending > 0 ? `${pending} pending` : undefined,
          },
          { label: "Changed · review pending", value: changed ? 1 : 0 },
          {
            label: "Last full check",
            value: lastCheck ? <DateText value={lastCheck} withTime /> : "—",
          },
          { label: "Monitor", value: "Weekly", sub: "hash comparison" },
        ]}
      />

      {changed ? (
        <div className="px-5">
          <ExceptionBanner
            severity="WARN"
            title={`${changed.name} changed since its last ingest`}
            subtitle={`Detected ${new Date(changed.lastCheckedAt ?? changed.ingestedAt).toLocaleString("en-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}. It is quarantined from rule extraction until its diffs are reviewed, and it stays searchable meanwhile — the old answers it supports are still the best ones available until somebody has read the change.`}
            action={
              changed.ruleChangeSetId ? <GhostButton>Open rule changes</GhostButton> : undefined
            }
          />
        </div>
      ) : null}

      {check.isError ? (
        <div className="px-5">
          <RefusalBanner title="The source check failed" error={check.error} />
        </div>
      ) : null}
      {check.isSuccess ? (
        <div className="px-5">
          <ExceptionBanner
            severity="INFO"
            title={
              check.data.changed
                ? "The source changed — a rule-change review has been opened"
                : "No change · the hash matches the last ingest"
            }
            subtitle={`Checked ${new Date(check.data.lastCheckedAt).toLocaleString("en-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}. A check compares hashes and never rewrites the corpus; only a re-ingest does that.`}
          />
        </div>
      ) : null}
      {reingest.isSuccess ? (
        <div className="px-5">
          <ExceptionBanner
            severity="INFO"
            title={`Re-ingested · ${reingest.data.chunks} chunks, embedding ${humanise(reingest.data.embeddingStatus).toLowerCase()}`}
            subtitle="Retrieval uses the new chunks as soon as the embedding finishes. Until then the source answers from keyword matching."
          />
        </div>
      ) : null}

      <div className="px-5">
        <ContentCard flush>
          <DataTable
            label="Knowledge sources"
            columns={columns}
            rows={rows}
            rowKey={(source) => source.id}
            stickyHeader
            empty={
              <EmptyState
                title="No sources ingested"
                description="Agents answer from the model alone until a source is added, which means they answer without citations."
                action={<SecondaryButton>Add source</SecondaryButton>}
              />
            }
          />
        </ContentCard>
      </div>

      {/* The two policies §4 asks to be stated on-screen. They are what makes
          the table above readable: without them, "Compliance" in a scope column
          and "Changed" in a monitor column are just words. */}
      <div className="grid grid-cols-1 gap-4 px-5 lg:grid-cols-2">
        <ContentCard title="Retrieval policy" eyebrow="What may be cited">
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            Compliance answers may cite HRD Corp circulars, scheme guides and the Allowable Cost
            Matrix. Internal SOPs are retrievable for staff answers and excluded from client-facing
            generation, so an internal delivery note can inform an operations reply and can never
            reach a proposal. A source in the{" "}
            <strong className="font-medium text-ink">Changed</strong> state is quarantined from rule
            extraction until its diffs are reviewed, and stays readable for search throughout.
          </p>
        </ContentCard>

        <ContentCard title="Monitoring" eyebrow="How freshness is known">
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            Watched sources are fetched weekly and hashed. A changed hash opens a rule-change review
            rather than updating anything — extraction proposes, it never activates. A fetch failure
            is retried three times and then flagged
            {failing ? (
              <>
                {" "}
                — {failing.name} has been failing since <DateText value={failing.lastCheckedAt} />,
                so its answers are as old as that date and should be read that way.
              </>
            ) : (
              "."
            )}
          </p>
        </ContentCard>
      </div>
    </div>
  );
}
