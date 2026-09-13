import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { KnowledgeSource } from "@trainos/contract";
import {
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  FilterSearch,
  FilterSelect,
  GhostButton,
  ListToolbar,
  LoadingState,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  RowActionMenu,
  SecondaryButton,
  StatusChip,
  toast,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { navPath } from "@/shared/config/nav";
import { HRDC_RULE_CHANGES_PATH } from "@/features/hrdc";
import { AddSourceDrawer } from "./AddSourceDrawer";
import { HowSourcesWorkDrawer, SourceDetailDrawer } from "./SourceDetailDrawer";
import { useCheckSource, useKnowledgeSources, useReingestSource } from "./api";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  PROMOTED_ACTION,
  TYPE_LABEL,
  healthOf,
  needsAttention,
  usedForLabel,
} from "./health";

/**
 * M16-S05 · Knowledge sources.
 *
 * The page answers one question and then shows the inventory: are my sources
 * healthy, and is anything asking for me? Tightening brief §18, and what it
 * replaced is worth naming, because the failure was not ugliness.
 *
 * The old screen knew a great deal and said all of it at once: a six-cell
 * metric band, seven columns, two chips per row, a per-row Check and Re-ingest
 * pair, a four-sentence banner and two explanatory cards. Every fact on it was
 * true and most of them were somebody's answer. Together they meant the
 * administrator who opened it to find out whether anything needed them had to
 * read a control panel to find two rows.
 *
 * So the machinery did not go away — chunks, embedding state, monitor cadence,
 * hash, version and retrieval permissions are all one click into the row —
 * and what changed is who pays for it. The table pays for the reading; the
 * drawer pays for the investigation. The one asymmetry that carries the design
 * is in the Status column: a row with a problem promotes ONE action into the
 * table, and a healthy row keeps its maintenance in the `⋯`. An action in a row
 * therefore MEANS something is wrong with that row, which twelve identical
 * ghost buttons could never mean.
 *
 * Primary user: System Admin; Compliance follows the changed-source link.
 */

const AUTOMATION_RUNS_PATH = navPath("Automation", "Runs");

const TABS = { all: "All", attention: "Needs attention" } as const;
type TabId = keyof typeof TABS;

const USED_FOR = [
  { value: "any", label: "Any use" },
  { value: "Client answers", label: "Client answers" },
  { value: "Internal", label: "Internal" },
];

export function KnowledgeSourcesScreen() {
  /* Knowledge › Sources, and no "Corpus" leaf. The contract has ONE corpus and
     no object to switch between: `KnowledgeSource` carries no corpus id, and
     there is no list endpoint above it. §18 makes the third crumb conditional
     on corpora being "a real switchable object", and it is not one, so a crumb
     naming it would be a control that does not exist. */
  useBreadcrumb([{ label: "Knowledge" }, { label: "Sources" }]);

  const navigate = useNavigate();
  const sources = useKnowledgeSources();
  const check = useCheckSource();
  const reingest = useReingestSource();

  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [usedFor, setUsedFor] = useState("any");
  const [adding, setAdding] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => sources.data?.data ?? [], [sources.data]);

  const attention = useMemo(() => rows.filter(needsAttention), [rows]);
  const changed = rows.find((source) => healthOf(source) === "CHANGED");

  /**
   * What "now" is, for the relative dates in the Checked column.
   *
   * Normally the wall clock, and in production always: a source cannot be
   * checked in the future. The fixture world is pinned to a single instant
   * that is ahead of the machine's clock, and anchoring on the freshest check
   * keeps the column relative there instead of degrading every row to a date.
   * A no-op wherever the data is real.
   */
  const clock = useMemo(() => {
    const latest = rows.reduce((newest, source) => {
      const at = new Date(source.lastCheckedAt ?? source.ingestedAt).getTime();
      return Number.isNaN(at) ? newest : Math.max(newest, at);
    }, 0);
    return Math.max(latest, Date.now());
  }, [rows]);

  const inTab = tab === "attention" ? attention : rows;
  const visible = useMemo(
    () =>
      inTab.filter((source) => {
        const matchesQuery =
          query.trim() === "" || source.name.toLowerCase().includes(query.trim().toLowerCase());
        const matchesUse = usedFor === "any" || usedForLabel(source) === usedFor;
        return matchesQuery && matchesUse;
      }),
    [inTab, query, usedFor],
  );

  const open = rows.find((source) => source.id === openId) ?? null;

  function runCheck(source: KnowledgeSource) {
    setBusyId(source.id);
    check.mutate(source.id, {
      onSuccess: (result) =>
        toast.info(
          result.changed
            ? `${source.name} changed — a rule-change review has been opened`
            : `${source.name} · no change`,
          {
            description:
              "A check compares hashes and never rewrites the corpus. Only a re-ingest does that.",
          },
        ),
    });
  }

  function runReingest(source: KnowledgeSource) {
    setBusyId(source.id);
    reingest.mutate(source.id, {
      onSuccess: (result) =>
        toast.success(`${source.name} re-ingested · ${result.chunks} chunks`, {
          description:
            "Retrieval uses the new chunks once the embedding finishes. Until then the source answers from keyword matching.",
        }),
    });
  }

  /** The one action a row in trouble promotes. Healthy rows promote nothing. */
  function runPromoted(source: KnowledgeSource) {
    const health = healthOf(source);
    if (health === "CHANGED") {
      if (source.ruleChangeSetId) navigate(`${HRDC_RULE_CHANGES_PATH}/${source.ruleChangeSetId}`);
      else setOpenId(source.id);
      return;
    }
    if (health === "FAILED") {
      runCheck(source);
      return;
    }
    /* PROCESSING — the embedding's state and its chunk count are in the drawer,
       which is where "progress" actually is. */
    setOpenId(source.id);
  }

  function checkAll() {
    const watched = rows.filter((source) => source.monitorStatus !== "MANUAL");
    if (watched.length === 0) return;
    void toast.promise(Promise.allSettled(watched.map((source) => check.mutateAsync(source.id))), {
      loading: `Checking ${watched.length} sources…`,
      success: (results) => {
        const changedNow = results.filter(
          (result) => result.status === "fulfilled" && result.value.changed,
        ).length;
        return changedNow === 0
          ? `Checked ${watched.length} sources · nothing changed`
          : `Checked ${watched.length} sources · ${changedNow} changed`;
      },
      error: "The check could not be completed",
    });
  }

  /* Not memoised. Six rows, and every accessor closes over the handlers
     above — a dependency array here would either list them all or go
     stale, and the kit's own tables pay the same nothing for rebuilding
     five column objects per render. */
  const columns: Column<KnowledgeSource>[] = [
    {
      key: "name",
      label: "Source",
      accessor: (source) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-medium text-ink">{source.name}</span>
          <span className="truncate text-[11px] text-ink-muted">
            {TYPE_LABEL[source.type]} · <span className="font-mono">{source.version}</span>
          </span>
        </div>
      ),
    },
    {
      key: "usedFor",
      label: "Used for",
      width: "140px",
      accessor: (source) => (
        <span className="text-[13px] text-ink-secondary">{usedForLabel(source)}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "178px",
      accessor: (source) => {
        const health = healthOf(source);
        const promoted = PROMOTED_ACTION[health];
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusChip tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</StatusChip>
            {promoted ? (
              <GhostButton
                disabled={busyId === source.id && check.isPending}
                onClick={(event) => {
                  event.stopPropagation();
                  runPromoted(source);
                }}
              >
                {`${promoted} →`}
              </GhostButton>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "checked",
      label: "Checked",
      width: "130px",
      accessor: (source) =>
        source.lastCheckedAt ? (
          <DateText
            value={source.lastCheckedAt}
            relative
            now={clock}
            className="text-ink-secondary"
          />
        ) : (
          <span className="text-[13px] text-ink-muted">Never</span>
        ),
    },
    {
      key: "overflow",
      label: "Actions",
      srOnlyLabel: true,
      width: "52px",
      align: "right",
      accessor: (source) =>
        /* Only on a healthy row. A row in trouble has its one action in the
             Status cell, and offering a second menu beside it would put the
             maintenance back on equal footing with the fix. */
        healthOf(source) === "HEALTHY" ? (
          <RowActionMenu
            label={source.name}
            actions={[
              { label: "Check", onSelect: () => runCheck(source) },
              { label: "Re-ingest", onSelect: () => runReingest(source) },
            ]}
          />
        ) : null,
    },
  ];

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

  const healthy = rows.length - attention.length;

  return (
    <div className="flex flex-col">
      <RecordHeader
        withoutCondensed
        title="Knowledge sources"
        meta={[
          `${rows.length} ${rows.length === 1 ? "source" : "sources"}`,
          `${healthy} healthy`,
          attention.length > 0 ? `${attention.length} need attention` : null,
        ]}
        chips={
          /* The quiet link §18 asks for beside the title. A button, not a
             chip — it opens something, and nothing about it is a status. */
          <button
            type="button"
            onClick={() => setHowOpen(true)}
            className="rounded-[4px] text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink-secondary"
          >
            How sources work
          </button>
        }
        actions={
          <>
            <SecondaryButton disabled={check.isPending} onClick={checkAll}>
              Check all
            </SecondaryButton>
            {/* An ingestion is an agent run, and the runs register is where its
                history already lives. A second history of the same events would
                be a second answer to one question. */}
            <SecondaryButton onClick={() => navigate(AUTOMATION_RUNS_PATH)}>
              History
            </SecondaryButton>
          </>
        }
        /* "Add source", not "+ Add source". §18 writes the plus as shorthand
           for the add affordance; rendered, it splits the button's children so
           the kit's one-primary registry reads the label as unlabelled, and no
           other primary in the app wears a glyph. */
        primaryAction={<PrimaryButton onClick={() => setAdding(true)}>Add source</PrimaryButton>}
      />

      {changed ? (
        <div className="px-5 pb-4">
          <ExceptionBanner
            severity="WARN"
            title={`${changed.name} has changed`}
            subtitle="Existing answers remain available. Review the changes before new rules become active."
            action={
              <GhostButton onClick={() => runPromoted(changed)}>Review changes →</GhostButton>
            }
            why="A changed source is quarantined from rule extraction until its diffs are reviewed, and stays searchable the whole time. Pulling it out of search too would take the old, still-correct answers away to guard against a change nobody has read yet — trading a known good for an unknown one. Extraction proposes; a human activates."
          />
        </div>
      ) : null}

      {/* No rule of its own. `ListToolbar` draws none and `DataTable`'s head
          draws exactly one directly beneath, so a border here is the second
          hairline §10b objects to — arriving from a different pair of elements
          than the one the ruling was written about. CLAUDE.md: remove a border
          whose removal leaves the relationship unambiguous. The gutter rides on
          the toolbar, which is how seventeen of the twenty-three call sites do
          it, CollectionsQueueScreen included. */}
      <ListToolbar
        className="px-5 pb-3"
        tabs={
          <PillTabGroup
            label="Sources"
            activeId={tab}
            onSelect={(id) => setTab(id as TabId)}
            tabs={[
              { id: "all", label: TABS.all, count: rows.length },
              { id: "attention", label: TABS.attention, count: attention.length },
            ]}
          />
        }
        filters={
          <FilterBar
            filters={[]}
            shown={visible.length}
            total={inTab.length}
            onClearAll={() => {
              setQuery("");
              setUsedFor("any");
            }}
          >
            <FilterSearch
              label="Search sources"
              labelHidden
              value={query}
              onChange={setQuery}
              placeholder="Source name"
            />
            <FilterSelect
              label="Used for"
              value={usedFor}
              options={USED_FOR}
              onChange={setUsedFor}
            />
          </FilterBar>
        }
      />

      <DataTable
        label="Knowledge sources"
        columns={columns}
        rows={visible}
        rowKey={(source) => source.id}
        stickyHeader
        onRowClick={(source) => setOpenId(source.id)}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No sources ingested"
              description="Agents answer from the model alone until a source is added, which means they answer without citations."
              action={<SecondaryButton onClick={() => setAdding(true)}>Add source</SecondaryButton>}
            />
          ) : tab === "attention" && attention.length === 0 ? (
            <EmptyState
              title="Nothing needs you"
              description="Every source is healthy: none has changed since its last ingest and none is failing to fetch."
            />
          ) : (
            <EmptyState
              title="No source matches this search"
              description="Clear the search or the Used-for filter to widen the inventory."
            />
          )
        }
      />

      <SourceDetailDrawer
        source={open}
        onClose={() => setOpenId(null)}
        onPromotedAction={runPromoted}
        onCheck={runCheck}
        onReingest={runReingest}
        busy={(check.isPending || reingest.isPending) && busyId === open?.id}
      />

      <HowSourcesWorkDrawer open={howOpen} onClose={() => setHowOpen(false)} />
      <AddSourceDrawer open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
