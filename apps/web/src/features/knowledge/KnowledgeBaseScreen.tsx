import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { KnowledgeSource, RetrievalScope } from "@trainos/contract";
import {
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  LoadingState,
  MiniBar,
  RecordHeader,
  StatusChip,
  type Column,
  type StatusTone,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { useKnowledgeSources } from "./api";
import { useExtractedRules } from "./corpus.api";
import { KNOWLEDGE_SOURCES_PATH } from "./paths";

/**
 * Knowledge › Knowledge base.
 *
 * This screen and Sources (M16-S05) read the same six rows and are deliberately
 * not the same page. Sources is the OPERATOR's view: six documents, their
 * ingest state, their monitor, and the buttons that re-check and re-ingest
 * them. This is the READER's view: can the agents answer right now, in which
 * scope, and where are they blind. Neither is a second copy of the other's
 * table — this one never lists the healthy inventory, because a source that
 * works is not the reason anybody opens this page.
 *
 * CLAUDE.md forbids two visual languages for one problem, so the rule applied
 * here is that the inventory belongs to Sources and the COVERAGE belongs here.
 * If that division stops being worth two leaves, the answer is to merge the
 * leaves rather than to let both grow a source table.
 *
 * Three facts the page is built to make unmissable:
 *
 *  - A source whose embedding failed still has chunks. It answers from keyword
 *    matching, which is worse and is not nothing, and rendering it as simply
 *    unavailable would send somebody looking for an outage that is not there.
 *  - A source with zero chunks is not retrievable at all yet, which is a
 *    different failure from the one above and gets its own line.
 *  - A CHANGED source stays searchable and is quarantined from rule
 *    extraction. Its old answers are the best available until somebody reads
 *    the change; its new rules are not in force. Both halves have to be said,
 *    or the reader concludes one of them.
 */

const SCOPE_LABEL: Record<RetrievalScope, string> = {
  COMPLIANCE: "Internal and compliance answers",
  CLIENT_FACING: "Client-facing generation",
};

const SCOPE_GATES: Record<RetrievalScope, string> = {
  COMPLIANCE: "What an agent may cite when answering staff and checking a claim.",
  CLIENT_FACING: "What may reach a proposal, a covering email or the client portal.",
};

/** A source that cannot answer fully right now, and what that costs. */
interface BlindSpot {
  source: KnowledgeSource;
  severity: "danger" | "warning";
  state: string;
  reason: string;
  consequence: string;
}

/**
 * A blind spot's tone.
 *
 * Named for what it maps, not for the word "severity". It used to be
 * `SEVERITY_TONE`, which now shadows the kit's export of that name — a reader
 * who sees `SEVERITY_TONE` in a screen that imports from the kit reasonably
 * assumes it IS the kit's, and it is not: the kit's is keyed on the contract's
 * `Severity` (INFO / WARN / DANGER / ALERT) and this is keyed on a local
 * two-value union that is already a `StatusTone`. Two different vocabularies
 * under one name is the divergence CLAUDE.md calls a defect, and the cheap
 * half of the fix is to stop sharing the name.
 */
const BLIND_SPOT_TONE: Record<BlindSpot["severity"], StatusTone> = {
  danger: "danger",
  warning: "warning",
};

/** One row per scope: how much of the corpus answers inside it. */
interface Coverage {
  scope: RetrievalScope;
  sources: number;
  answerableChunks: number;
  heldBackChunks: number;
  excludedSources: number;
}

export function KnowledgeBaseScreen() {
  useBreadcrumb([{ label: "Knowledge" }, { label: "Knowledge base" }]);

  const sources = useKnowledgeSources();
  const rules = useExtractedRules();

  const all = useMemo(() => sources.data?.data ?? [], [sources.data]);

  const totalChunks = all.reduce((total, source) => total + source.chunks, 0);
  /* Only an INDEXED source answers by meaning. The others are counted apart
     rather than folded into the total, because the whole point of this page is
     the difference between "in the corpus" and "answerable". */
  const answerable = all
    .filter((source) => source.embeddingStatus === "INDEXED")
    .reduce((total, source) => total + source.chunks, 0);

  const coverage = useMemo<Coverage[]>(
    () =>
      (["COMPLIANCE", "CLIENT_FACING"] as RetrievalScope[]).map((scope) => {
        const inScope = all.filter((source) => source.retrievalScopes.includes(scope));
        return {
          scope,
          sources: inScope.length,
          answerableChunks: inScope
            .filter((source) => source.embeddingStatus === "INDEXED")
            .reduce((total, source) => total + source.chunks, 0),
          heldBackChunks: inScope
            .filter((source) => source.embeddingStatus !== "INDEXED")
            .reduce((total, source) => total + source.chunks, 0),
          excludedSources: all.length - inScope.length,
        };
      }),
    [all],
  );

  const blindSpots = useMemo<BlindSpot[]>(() => {
    const spots: BlindSpot[] = [];
    for (const source of all) {
      if (source.embeddingStatus === "PENDING" || source.chunks === 0) {
        spots.push({
          source,
          severity: "danger",
          state: "Not retrievable",
          reason: "Ingested, not yet vectorised — it has no chunks at all.",
          consequence: "Nothing in this document can be cited, by meaning or by keyword.",
        });
        continue;
      }
      if (source.embeddingStatus === "FAILED") {
        spots.push({
          source,
          severity: "warning",
          state: "Keyword only",
          reason: `${source.chunks} chunks exist and their embedding failed.`,
          consequence:
            "It answers from keyword matching, so a question phrased differently from the text will miss it.",
        });
        continue;
      }
      if (source.monitorStatus === "CHANGED_REVIEW_PENDING") {
        spots.push({
          source,
          severity: "warning",
          state: "New rules not in force",
          reason: "The document changed and is quarantined from rule extraction.",
          consequence:
            "It stays searchable and its existing answers stand; anything the change introduced is not applied until the diffs are reviewed.",
        });
        continue;
      }
      if (source.monitorStatus === "FAILED") {
        spots.push({
          source,
          severity: "warning",
          state: "Not re-read",
          reason: "The weekly fetch has been failing.",
          consequence:
            "Its answers are as old as the last successful check and should be read that way.",
        });
      }
    }
    return spots;
  }, [all]);

  const ruleRows = rules.data?.data ?? [];
  const active = ruleRows.filter((rule) => rule.status === "ACTIVE").length;
  const proposed = ruleRows.filter((rule) => rule.status === "PROPOSED").length;
  const changed = all.find((source) => source.monitorStatus === "CHANGED_REVIEW_PENDING");

  const coverageColumns: Column<Coverage>[] = [
    {
      key: "scope",
      label: "Answers in",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{SCOPE_LABEL[row.scope]}</p>
          <p className="truncate text-[12px] text-ink-muted">{SCOPE_GATES[row.scope]}</p>
        </div>
      ),
    },
    {
      key: "sources",
      label: "Sources",
      width: "150px",
      align: "right",
      accessor: (row) => (
        <div className="text-right">
          <p className="tabular-nums text-[13px] text-ink">{`${row.sources} of ${all.length}`}</p>
          {row.excludedSources > 0 ? (
            <p className="text-[11px] text-ink-muted">{`${row.excludedSources} excluded`}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "chunks",
      label: "Answerable chunks",
      width: "190px",
      align: "right",
      accessor: (row) => (
        <div className="flex flex-col items-end gap-1">
          <span className="tabular-nums text-[13px] text-ink">
            {row.answerableChunks.toLocaleString("en-MY")}
          </span>
          {row.heldBackChunks > 0 ? (
            <span className="text-[11px] text-ink-muted">
              {`${row.heldBackChunks.toLocaleString("en-MY")} not answerable`}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "share",
      label: "Share of corpus",
      width: "160px",
      accessor: (row) => (
        <MiniBar
          value={totalChunks === 0 ? 0 : row.answerableChunks / totalChunks}
          label={`${SCOPE_LABEL[row.scope]} coverage`}
        />
      ),
    },
  ];

  const blindColumns: Column<BlindSpot>[] = [
    {
      key: "source",
      label: "Source",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{row.source.name}</p>
          <p className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{row.source.version}</span>
            {" · last checked "}
            {row.source.lastCheckedAt ? <DateText value={row.source.lastCheckedAt} /> : "never"}
          </p>
        </div>
      ),
    },
    {
      key: "state",
      label: "State",
      width: "180px",
      accessor: (row) => <StatusChip tone={BLIND_SPOT_TONE[row.severity]}>{row.state}</StatusChip>,
    },
    {
      key: "why",
      label: "Why, and what it costs",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="text-[13px] text-ink">{row.reason}</p>
          <p className="text-[12px] text-ink-muted">{row.consequence}</p>
        </div>
      ),
    },
  ];

  const loading = sources.isPending || rules.isPending;
  const failed = sources.error ?? rules.error;

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        title="Knowledge base"
        withoutCondensed
        meta={[
          `${all.length} sources`,
          `${answerable.toLocaleString("en-MY")} of ${totalChunks.toLocaleString("en-MY")} chunks answerable`,
          blindSpots.length > 0
            ? `${blindSpots.length} blind spot${blindSpots.length === 1 ? "" : "s"}`
            : "no blind spots",
        ]}
        actions={
          <Link
            to={KNOWLEDGE_SOURCES_PATH}
            className="text-[13px] text-ink-secondary underline-offset-4 hover:text-ink hover:underline"
          >
            Manage sources
          </Link>
        }
      />

      {changed ? (
        <div className="px-5">
          <ExceptionBanner
            severity="WARN"
            title={`${changed.name} has changed, and its new rules are not in force`}
            subtitle="The document stays searchable and every answer it already supports still stands. What the change introduced is quarantined until the diffs are reviewed, because extraction proposes and never activates."
          />
        </div>
      ) : null}

      {loading ? (
        <div className="px-5">
          <LoadingState rows={6} label="Loading the corpus" />
        </div>
      ) : null}

      {failed ? (
        <div className="px-5">
          <ErrorState
            title="The corpus could not be read"
            error={failed}
            onRetry={() => {
              void sources.refetch();
              void rules.refetch();
            }}
          />
        </div>
      ) : null}

      {!loading && !failed ? (
        <>
          {/* Flat sections, not a card per section: tightening brief §2 and §9.
              A heading, the table, and spacing between them is the whole
              separation these three need. */}
          <Section title="What the agents can answer">
            <DataTable
              label="Retrieval coverage by scope"
              columns={coverageColumns}
              rows={coverage}
              rowKey={(row) => row.scope}
              empty={
                <EmptyState
                  title="No retrieval scope is configured"
                  description="Until a source declares a scope, nothing in the corpus is reachable by an agent."
                />
              }
            />
          </Section>

          <Section title="Blind spots">
            <DataTable
              label="Sources that cannot answer fully"
              columns={blindColumns}
              rows={blindSpots}
              rowKey={(row) => row.source.id}
              empty={
                <EmptyState
                  title="Nothing is blind"
                  description="Every source is vectorised, current and inside its monitoring cadence. The corpus answers everything it holds."
                />
              }
            />
          </Section>

          <Section title="What has been read out of it">
            <p className="px-5 text-[13px] leading-relaxed text-ink-secondary">
              {`${ruleRows.length} compliance rules have been extracted from this corpus — ${active} active`}
              {proposed > 0
                ? `, ${proposed} still awaiting a human check against the circular`
                : ""}
              {
                ". Extraction proposes and never activates, so a rule loads as proposed and stays there until somebody verifies it. The rules themselves, their quoted source text and their lineage live in the "
              }
              <Link
                to="/compliance/rules"
                className="text-ink underline underline-offset-4 hover:text-primary"
              >
                rules registry
              </Link>
              {", which owns them; this page only says how much of the corpus has been read."}
            </p>
          </Section>
        </>
      ) : null}
    </div>
  );
}

/**
 * A titled block with no border around it.
 *
 * The tightening brief kills the card-per-section: hierarchy comes from
 * typography and spacing first, and a border is drawn only where a
 * relationship would otherwise be ambiguous. Three tables down a page are not
 * ambiguous.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 pt-2">
      <h2 className="px-5 text-[15px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default KnowledgeBaseScreen;
