import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CompletenessBar,
  DataTable,
  DensityToggle,
  Drawer,
  DocumentChecklistRow,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSearch,
  FilterSelect,
  ListToolbar,
  LoadingState,
  PartialDataBanner,
  PillTabGroup,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
  type PartialRead,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { HRDC_PACKET_PATH } from "@/features/hrdc";
import { hrdcSchemeLabel } from "@/features/programmes";
import { useClaimPackets, useHrdcDeadlines, useOrganisations } from "./api";
import { hrdcDocumentLabel } from "./labels";
import { byUrgency, documentRows, type DocumentRow } from "./registers";

/**
 * `/compliance/documents` — every document every open claim packet requires.
 *
 * M12's anatomy applied to a register. The claim-packet screen answers "is THIS
 * packet complete"; this one answers "what is missing anywhere", which is the
 * question Finance has on the day a claim window closes.
 *
 * WHERE THE ROWS COME FROM. There is no documents endpoint and no packets list:
 * `GET /v1/hrdc/packets/{engagementRef}` is per engagement. `GET
 * /v1/hrdc/deadlines` is the list of engagements that HAVE an open claim, so it
 * is the index, and each packet is then read on its own key. That is a fan-out
 * and it is the honest one — the alternative was inventing a list endpoint.
 *
 * The drawer shows the whole packet through the kit's own
 * `DocumentChecklistRow`, the component the claim-packet screen already uses,
 * so one document row looks the same wherever it is read.
 */

const ANY = "ALL";

const TABS = { missing: "Missing", all: "All" } as const;

type TabId = keyof typeof TABS;

export function ComplianceDocumentsScreen() {
  useBreadcrumb([{ label: "Compliance" }, { label: "Documents" }]);

  const navigate = useNavigate();
  const [tabOverride, setTab] = useState<TabId | null>(null);
  const [type, setType] = useState<string>(ANY);
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");
  const [openRef, setOpenRef] = useState<string | null>(null);

  const deadlines = useHrdcDeadlines();
  const engagementRefs = useMemo(
    () => (deadlines.data?.data ?? []).map((deadline) => deadline.engagementRef),
    [deadlines.data],
  );
  const packets = useClaimPackets(engagementRefs);

  const loaded = useMemo(
    () => packets.flatMap((packet) => (packet.data ? [packet.data] : [])),
    [packets],
  );

  const organisationRefs = useMemo(
    () => [...new Set(loaded.map((packet) => packet.organisationRef))],
    [loaded],
  );
  const organisations = useOrganisations(organisationRefs);

  const nameOf = useMemo(() => {
    const names = new Map<string, string>();
    organisationRefs.forEach((ref, index) => {
      const name = organisations[index]?.data?.name;
      if (name) names.set(ref, name);
    });
    return names;
  }, [organisationRefs, organisations]);

  /* A packet that failed is a row that is ABSENT, which is the one failure a
     register must never render as "nothing missing here". Named per engagement
     so the reader knows which claim they are not seeing. */
  const partial: PartialRead[] = [
    ...engagementRefs.map((ref, index) => ({
      label: `the claim packet for ${ref}`,
      error: packets[index]?.isError ? toApiError(packets[index]?.error) : null,
      retry: () => void packets[index]?.refetch(),
    })),
    ...organisationRefs.map((ref, index) => ({
      label: `the client name for ${ref}`,
      error: organisations[index]?.isError ? toApiError(organisations[index]?.error) : null,
      retry: () => void organisations[index]?.refetch(),
    })),
  ];

  const all = useMemo(() => byUrgency(documentRows(loaded)), [loaded]);
  const missing = all.filter((row) => !row.present).length;
  const tab: TabId = tabOverride ?? (missing > 0 ? "missing" : "all");

  const types = useMemo(() => [...new Set(all.map((row) => row.type))].sort(), [all]);

  const inTab = useMemo(
    () => (tab === "all" ? all : all.filter((row) => !row.present)),
    [all, tab],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inTab.filter((row) => {
      if (type !== ANY && row.type !== type) return false;
      if (needle.length === 0) return true;
      return (
        row.label.toLowerCase().includes(needle) ||
        row.engagementRef.toLowerCase().includes(needle) ||
        (row.reference ?? "").toLowerCase().includes(needle)
      );
    });
  }, [inTab, type, query]);

  const chips: FilterChipModel[] = [];
  if (type !== ANY) chips.push({ id: "type", label: "Document", value: hrdcDocumentLabel(type) });
  if (query.trim()) chips.push({ id: "query", label: "Search", value: query.trim() });

  const openPacket = loaded.find((packet) => packet.engagementRef === openRef) ?? null;

  const columns: Column<DocumentRow>[] = [
    {
      key: "label",
      label: "Document",
      accessor: (row) => (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-ink">{row.label}</div>
          {/* The server's own context line where it sends one. No second
              line where it does not — repeating the name in another register
              is the "said twice" tell §9 names. */}
          {row.meta ? <div className="truncate text-[12px] text-ink-muted">{row.meta}</div> : null}
        </div>
      ),
    },
    {
      key: "engagement",
      label: "Claim",
      width: "240px",
      accessor: (row) => (
        <div className="min-w-0">
          <div className="truncate text-[13px] text-ink">
            {nameOf.get(row.organisationRef) ?? row.organisationRef}
          </div>
          <div className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{row.engagementRef}</span>
            {` · ${hrdcSchemeLabel(row.scheme as never)}`}
          </div>
        </div>
      ),
    },
    {
      key: "reference",
      label: "Reference",
      width: "184px",
      accessor: (row) =>
        row.reference ? (
          <span className="truncate font-mono text-[12px] text-ink">{row.reference}</span>
        ) : (
          <span className="text-[12px] text-ink-muted">—</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      width: "132px",
      accessor: (row) => (
        <StatusChip tone={row.present ? "success" : "warning"}>
          {row.present ? "Present" : "Missing"}
        </StatusChip>
      ),
    },
  ];

  const packetsPending = deadlines.isPending || packets.some((packet) => packet.isPending);

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Claim documents"
        withoutCondensed
        meta={[
          `${loaded.length} open ${loaded.length === 1 ? "packet" : "packets"}`,
          `${all.length} required ${all.length === 1 ? "document" : "documents"}`,
          missing === 0 ? "nothing missing" : `${missing} missing`,
        ]}
      />

      <div className="px-5 py-3">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Claim documents"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={[
                { id: "missing", label: TABS.missing, count: missing },
                { id: "all", label: TABS.all, count: all.length },
              ]}
            />
          }
          filters={
            <FilterBar
              filters={chips}
              shown={rows.length}
              total={inTab.length}
              onRemove={(id) => (id === "type" ? setType(ANY) : setQuery(""))}
              onClearAll={() => {
                setType(ANY);
                setQuery("");
              }}
            >
              <FilterSearch
                label="Search documents"
                value={query}
                onChange={setQuery}
                placeholder="Name, engagement or reference"
              />
              <FilterSelect
                label="Document"
                value={type}
                onChange={setType}
                options={[
                  { value: ANY, label: "Any document" },
                  ...types.map((value) => ({ value, label: hrdcDocumentLabel(value) })),
                ]}
              />
            </FilterBar>
          }
          actions={<DensityToggle value={density} onChange={setDensity} />}
        />
      </div>

      {partial.some((read) => read.error) ? (
        <div className="px-5 pt-4">
          <PartialDataBanner reads={partial} />
        </div>
      ) : null}

      {packetsPending ? <LoadingState label="Loading the claim packets" /> : null}

      {deadlines.isError ? (
        <ErrorState
          title="The open claims could not be loaded"
          error={toApiError(deadlines.error)}
          onRetry={() => void deadlines.refetch()}
        />
      ) : null}

      {!packetsPending && !deadlines.isError ? (
        <DataTable
          label="Claim documents"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          density={density}
          onRowClick={(row) => setOpenRef(row.engagementRef)}
          empty={
            all.length === 0 ? (
              <EmptyState
                title="No claim packet is open"
                description="Required documents appear here once an engagement has a claim window running."
              />
            ) : inTab.length === 0 ? (
              /* The TAB is empty, which is good news. Checked before the filter
                 branch: a search that matches nothing on this tab is not the
                 same fact, and saying "nothing is missing" over a failed search
                 would be a lie the reader cannot see through. */
              <EmptyState
                title="Nothing is missing"
                description="Every open packet has all five documents. Switch to All to see them."
              />
            ) : (
              <EmptyState
                title="No document matches these filters"
                description="Clear a filter to widen the register."
              />
            )
          }
        />
      ) : null}

      <Drawer
        open={openPacket !== null}
        onClose={() => setOpenRef(null)}
        title={nameOf.get(openPacket?.organisationRef ?? "") ?? "Claim packet"}
        subtitle={openPacket?.engagementRef}
        width="560px"
        footer={
          openPacket ? (
            <SecondaryButton
              onClick={() => navigate(`${HRDC_PACKET_PATH}/${openPacket.engagementRef}`)}
            >
              Open the claim packet
            </SecondaryButton>
          ) : null
        }
      >
        {openPacket ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone="neutral">{humanise(openPacket.status)}</StatusChip>
              <StatusChip tone="neutral">{hrdcSchemeLabel(openPacket.scheme)}</StatusChip>
            </div>

            <CompletenessBar value={openPacket.completeness} />

            <div className="flex flex-col">
              {/* The kit's own row, the one the claim-packet screen uses. A
                  document looks the same wherever it is read. */}
              {openPacket.requiredDocuments.map((document) => (
                <DocumentChecklistRow key={document.type} document={document} />
              ))}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

export default ComplianceDocumentsScreen;
