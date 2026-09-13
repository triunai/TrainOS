import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { RetrievalScope } from "@trainos/contract";
import type { FixtureLibraryAsset } from "@trainos/fixtures";
import {
  DataTable,
  DateText,
  DensityToggle,
  Drawer,
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
  RecordHeader,
  StatusChip,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
  type StatusTone,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { useLibraryAssets } from "./corpus.api";

/**
 * Knowledge › Library.
 *
 * The second corpus. Sources (M16-S05) holds the external documents the system
 * WATCHES; this holds the internal content it WRITES FROM — programme
 * outlines, case studies, trainer profiles, the proposal paragraphs that get
 * reused. Two collections, two screens, and the reason they are not one is that
 * a circular is monitored for change and a case study is not.
 *
 * The tightening brief §18 governs the shape, because this is a control panel
 * like Sources: a human summary first, the table as the hero, and the
 * machinery — version, format, size, who owns it, what it is about — one click
 * away in the row drawer rather than spread across eight columns.
 *
 * The column that earns its place is "Used for". It carries the same
 * `retrievalScopes` a knowledge source carries, and it is the rule the page
 * exists to make visible: an asset that is not client-facing can inform a staff
 * answer and can never reach a proposal. The pricing playbook is the example —
 * it holds margin commentary, and it has been drawn on 44 times without once
 * being allowed into client text.
 */

const TABS = {
  review: "Needs review",
  published: "Published",
  draft: "Draft",
  archived: "Archived",
  all: "All",
} as const;

type TabId = keyof typeof TABS;

const TAB_STATUS: Record<Exclude<TabId, "all">, FixtureLibraryAsset["status"]> = {
  review: "NEEDS_REVIEW",
  published: "PUBLISHED",
  draft: "DRAFT",
  archived: "ARCHIVED",
};

const STATUS_TONE: Record<FixtureLibraryAsset["status"], StatusTone> = {
  PUBLISHED: "success",
  NEEDS_REVIEW: "warning",
  DRAFT: "info",
  ARCHIVED: "neutral",
};

const STATUS_LABEL: Record<FixtureLibraryAsset["status"], string> = {
  PUBLISHED: "Published",
  NEEDS_REVIEW: "Needs review",
  DRAFT: "Draft",
  ARCHIVED: "Archived",
};

const KIND_LABEL: Record<FixtureLibraryAsset["kind"], string> = {
  PROGRAMME_OUTLINE: "Programme outline",
  CASE_STUDY: "Case study",
  TRAINER_PROFILE: "Trainer profile",
  PROPOSAL_SECTION: "Proposal section",
  ONE_PAGER: "One-pager",
  EVALUATION_REPORT: "Evaluation report",
};

/**
 * The scopes as a sentence rather than a list of enum names.
 *
 * "Client answers · Internal" is what the reader is deciding between, and
 * printing `CLIENT_FACING` would make them translate it themselves.
 */
function usedFor(scopes: RetrievalScope[]): string {
  const parts: string[] = [];
  if (scopes.includes("CLIENT_FACING")) parts.push("Client answers");
  if (scopes.includes("COMPLIANCE")) parts.push("Internal");
  return parts.length > 0 ? parts.join(" · ") : "Not retrievable";
}

/** Bytes as a figure a person reads, not as a number they convert. */
function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

export function LibraryScreen() {
  useBreadcrumb([{ label: "Knowledge" }, { label: "Library" }]);

  const navigate = useNavigate();
  const library = useLibraryAssets();

  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("ALL");
  const [density, setDensity] = useState<Density>("comfortable");
  const [open, setOpen] = useState<FixtureLibraryAsset | null>(null);

  const all = useMemo(() => library.data?.data ?? [], [library.data]);

  const kinds = useMemo(() => [...new Set(all.map((asset) => asset.kind))].sort(), [all]);

  const narrowed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((asset) => {
      if (kind !== "ALL" && asset.kind !== kind) return false;
      if (needle === "") return true;
      return (
        asset.title.toLowerCase().includes(needle) ||
        (asset.subjectRef ?? "").toLowerCase().includes(needle)
      );
    });
  }, [all, kind, query]);

  const countOf = (id: TabId) =>
    id === "all"
      ? narrowed.length
      : narrowed.filter((asset) => asset.status === TAB_STATUS[id]).length;

  const rows = useMemo(
    () => (tab === "all" ? narrowed : narrowed.filter((asset) => asset.status === TAB_STATUS[tab])),
    [narrowed, tab],
  );

  const stale = all.filter((asset) => asset.status === "NEEDS_REVIEW");
  const published = all.filter((asset) => asset.status === "PUBLISHED").length;
  const drafts = all.filter((asset) => asset.status === "DRAFT").length;

  const chips: FilterChipModel[] = [];
  if (query.trim().length > 0) chips.push({ id: "query", label: "Search", value: query.trim() });
  if (kind !== "ALL") {
    chips.push({
      id: "kind",
      label: "Kind",
      value: KIND_LABEL[kind as FixtureLibraryAsset["kind"]] ?? humanise(kind),
    });
  }

  const columns: Column<FixtureLibraryAsset>[] = [
    {
      key: "title",
      label: "Asset",
      accessor: (asset) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{asset.title}</p>
          <p className="truncate text-[12px] text-ink-muted">
            {KIND_LABEL[asset.kind]}
            {" · "}
            <span className="font-mono">{`v${asset.version}`}</span>
          </p>
        </div>
      ),
    },
    {
      key: "usedFor",
      label: "Used for",
      width: "180px",
      accessor: (asset) => (
        <span className="text-[12px] text-ink-secondary">
          {usedFor(asset.retrievalScopes)}
          {asset.retrievalScopes.includes("CLIENT_FACING") ? null : (
            <span className="block text-[11px] text-ink-muted">excluded from client text</span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "150px",
      accessor: (asset) => (
        <StatusChip tone={STATUS_TONE[asset.status]}>{STATUS_LABEL[asset.status]}</StatusChip>
      ),
    },
    {
      key: "used",
      label: "Drawn on",
      width: "150px",
      align: "right",
      /* Usage is the number that decides whether a stale asset matters. An
         outline nobody cites can wait; one cited eighteen times cannot. */
      accessor: (asset) => (
        <div className="text-right">
          <p className="tabular-nums text-[13px] text-ink">
            {asset.timesUsed === 0 ? "never" : `${asset.timesUsed}×`}
          </p>
          {asset.lastUsedAt ? (
            <p className="text-[11px] text-ink-muted">
              last <DateText value={asset.lastUsedAt} />
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "updatedAt",
      label: "Updated",
      width: "116px",
      accessor: (asset) => <DateText value={asset.updatedAt} />,
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Library"
        withoutCondensed
        meta={[
          `${all.length} assets`,
          `${published} published`,
          stale.length > 0 ? `${stale.length} needs review` : null,
          drafts > 0 ? `${drafts} draft` : null,
        ]}
        actions={<DensityToggle value={density} onChange={setDensity} />}
      />

      {stale.length > 0 ? (
        <div className="px-5 pb-1">
          <ExceptionBanner
            severity="WARN"
            title={`${stale[0]?.title} has not been reviewed since its subject changed`}
            subtitle={`It has been drawn on ${stale[0]?.timesUsed} times since, most recently on ${new Date(
              stale[0]?.lastUsedAt ?? stale[0]?.updatedAt ?? "",
            ).toLocaleDateString("en-MY", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}. Content stays available while it waits — withdrawing it would take a mostly-correct answer away to guard against a change nobody has read yet.`}
            action={<GhostButton onClick={() => setOpen(stale[0] ?? null)}>Open asset</GhostButton>}
          />
        </div>
      ) : null}

      <ListToolbar
        tabs={
          <PillTabGroup
            label="Asset status"
            activeId={tab}
            onSelect={(id) => setTab(id as TabId)}
            tabs={(Object.keys(TABS) as TabId[]).map((id) => ({
              id,
              label: TABS[id],
              count: countOf(id),
            }))}
          />
        }
        filters={
          <FilterBar
            filters={chips}
            shown={rows.length}
            total={all.length}
            onRemove={(id) => {
              if (id === "query") setQuery("");
              if (id === "kind") setKind("ALL");
            }}
            onClearAll={() => {
              setQuery("");
              setKind("ALL");
            }}
          >
            <FilterSearch
              label="Search the library"
              labelHidden
              value={query}
              onChange={setQuery}
              placeholder="Title or subject"
            />
            <FilterSelect
              label="Kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: "ALL", label: "Any kind" },
                ...kinds.map((value) => ({ value, label: KIND_LABEL[value] })),
              ]}
            />
          </FilterBar>
        }
      />

      {library.isPending ? <LoadingState rows={8} label="Loading the content library" /> : null}

      {library.isError ? (
        <ErrorState
          title="The content library could not be loaded"
          error={library.error}
          onRetry={() => void library.refetch()}
        />
      ) : null}

      {!library.isPending && !library.isError ? (
        <DataTable
          label="Library assets"
          columns={columns}
          rows={rows}
          rowKey={(asset) => asset.id}
          density={density}
          onRowClick={(asset) => setOpen(asset)}
          empty={
            <EmptyState
              title="Nothing in the library matches"
              description="No asset is in this state for the current kind and search. Widen the filter or choose another tab."
            />
          }
        />
      ) : null}

      <AssetDrawer asset={open} onClose={() => setOpen(null)} onNavigate={navigate} />
    </div>
  );
}

/**
 * The machinery, one click away — the brief's "hide it until somebody needs
 * it". Eight facts that would have cost eight columns.
 */
function AssetDrawer({
  asset,
  onClose,
  onNavigate,
}: {
  asset: FixtureLibraryAsset | null;
  onClose: () => void;
  onNavigate: (to: string) => void;
}) {
  if (!asset) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={asset.title}
      subtitle={`${KIND_LABEL[asset.kind]} · v${asset.version}`}
      width="440px"
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-ink">Where it may be used</h3>
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            {asset.retrievalScopes.includes("CLIENT_FACING")
              ? "Retrievable for client-facing generation and for internal answers, so it can be quoted in a proposal."
              : "Retrievable for internal answers only. It can inform a staff reply and is excluded from every client-facing document the generator writes."}
          </p>
          <dl className="flex flex-col gap-1.5 text-[13px]">
            <Line term="Retrieval scopes" value={usedFor(asset.retrievalScopes)} />
            <Line term="Status" value={STATUS_LABEL[asset.status]} />
            <Line
              term="Drawn on"
              value={asset.timesUsed === 0 ? "never" : `${asset.timesUsed} generated documents`}
            />
          </dl>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-ink">The file</h3>
          <dl className="flex flex-col gap-1.5 text-[13px]">
            <Line term="Format" value={asset.format} />
            <Line term="Size" value={fileSize(asset.sizeBytes)} />
            <Line term="Owner" value={asset.owner.name} />
            <Line term="Updated" value={<DateText value={asset.updatedAt} withTime />} />
            <Line
              term="Last drawn on"
              value={
                asset.lastUsedAt ? (
                  <DateText value={asset.lastUsedAt} withTime />
                ) : (
                  <span className="text-ink-muted">never</span>
                )
              }
            />
          </dl>
        </section>

        {asset.subjectRef ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-medium text-ink">What it is about</h3>
            <p className="text-[13px] text-ink-secondary">
              <span className="font-mono text-[12px]">{asset.subjectRef}</span>
            </p>
            {asset.subjectRef.startsWith("PRG-") ? (
              <GhostButton onClick={() => onNavigate(`/training/programmes/${asset.subjectRef}`)}>
                Open the programme
              </GhostButton>
            ) : null}
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}

function Line({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{term}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

export default LibraryScreen;
