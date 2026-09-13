import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Participant } from "@trainos/contract";
import {
  DataTable,
  DensityToggle,
  Drawer,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  FilterSearch,
  ListToolbar,
  LoadingState,
  PillTabGroup,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  formatDate,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { todayKey } from "@/features/calendar";
import { engagementPath, useEngagementParticipants, useEngagements } from "@/features/engagements";
import {
  certificateRows,
  countByState,
  tallyIssuance,
  type CertificateRow,
  type CertificateState,
} from "./certificates";

/**
 * `/training/certificates` — which deliveries have issued certificates.
 *
 * List + filter bar with a detail drawer, the brief's shape. The drawer is
 * where the participant roll is read, and that is the whole reason it is a
 * drawer: `GET /v1/engagements/{id}/participants` is per engagement, so
 * fetching it for every row would be a fan-out to answer a question nobody has
 * asked yet. Opening a row is the moment the question is asked.
 *
 * No solid primary. Issuing a certificate is not an action the contract offers.
 */

const TABS = { pending: "Pending", all: "All", issued: "Issued" } as const;

type TabId = keyof typeof TABS;

export function CertificatesScreen() {
  useBreadcrumb([{ label: "Training" }, { label: "Certificates" }]);

  const today = useMemo(() => todayKey(), []);
  const [tabOverride, setTab] = useState<TabId | null>(null);
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");
  const [openRef, setOpenRef] = useState<string | null>(null);

  const engagements = useEngagements();

  const all = useMemo(
    () => certificateRows(engagements.data?.data ?? [], today),
    [engagements.data, today],
  );
  const counts = useMemo(() => countByState(all), [all]);
  const owed = counts.PENDING + counts.UNTRACKED;

  /* Same rule as the assessments register: open where the rows are. An empty
     default tab reads as a broken screen rather than as good news. */
  const tab: TabId = tabOverride ?? (owed > 0 ? "pending" : "all");

  const inTab = useMemo(
    () =>
      all.filter((row) => {
        if (tab === "all") return true;
        if (tab === "issued") return row.state === "ISSUED";
        return row.state === "PENDING" || row.state === "UNTRACKED";
      }),
    [all, tab],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return inTab;
    return inTab.filter(
      (row) =>
        row.title.toLowerCase().includes(needle) ||
        row.engagementRef.toLowerCase().includes(needle),
    );
  }, [inTab, query]);

  const chips: FilterChipModel[] = query.trim()
    ? [{ id: "query", label: "Search", value: query.trim() }]
    : [];

  const open = all.find((row) => row.engagementRef === openRef) ?? null;

  const columns: Column<CertificateRow>[] = [
    {
      key: "title",
      label: "Delivery",
      accessor: (row) => (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-ink">{row.title}</div>
          <div className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{row.engagementRef}</span>
            {` · ${humanise(row.engagementStatus)}`}
          </div>
        </div>
      ),
    },
    {
      key: "deliveredOn",
      label: "Delivered",
      width: "132px",
      sortable: true,
      accessor: (row) => (
        <span className="text-[13px] tabular-nums text-ink-secondary">
          {row.deliveredOn ? formatDate(row.deliveredOn) : "—"}
        </span>
      ),
    },
    {
      key: "attended",
      label: "Attended",
      width: "116px",
      align: "right",
      accessor: (row) => (
        <span className="text-[13px] tabular-nums text-ink">
          {`${row.attended} / ${row.participants}`}
        </span>
      ),
    },
    {
      key: "state",
      label: "Certificates",
      width: "148px",
      accessor: (row) => <StatusChip tone={row.tone}>{row.label}</StatusChip>,
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Certificates"
        withoutCondensed
        meta={[
          `${all.length} ${all.length === 1 ? "delivery" : "deliveries"}`,
          owed === 0 ? "nothing outstanding" : `${owed} awaiting issue`,
          `${counts.ISSUED} issued`,
        ]}
      />

      <div className="border-b border-border px-5 py-3">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Certificates"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={[
                { id: "pending", label: TABS.pending, count: owed },
                { id: "all", label: TABS.all, count: all.length },
                { id: "issued", label: TABS.issued, count: counts.ISSUED },
              ]}
            />
          }
          filters={
            <FilterBar
              filters={chips}
              shown={rows.length}
              total={inTab.length}
              onRemove={() => setQuery("")}
              onClearAll={() => setQuery("")}
            >
              <FilterSearch
                label="Search deliveries"
                value={query}
                onChange={setQuery}
                placeholder="Title or engagement ref"
              />
            </FilterBar>
          }
          actions={<DensityToggle value={density} onChange={setDensity} />}
        />
      </div>

      {engagements.isPending ? <LoadingState label="Loading the certificate register" /> : null}

      {engagements.isError ? (
        <ErrorState
          title="The certificate register could not be loaded"
          error={toApiError(engagements.error)}
          onRetry={() => void engagements.refetch()}
        />
      ) : null}

      {!engagements.isPending && !engagements.isError ? (
        <DataTable
          label="Certificates"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          density={density}
          onRowClick={(row) => setOpenRef(row.engagementRef)}
          empty={
            all.length === 0 ? (
              <EmptyState
                title="No deliveries yet"
                description="Certificates become due once a delivery's last day has passed."
              />
            ) : tab === "pending" ? (
              <EmptyState
                title="Nothing is awaiting issue"
                description="Every delivered course has had its certificates issued. Switch to All to see them."
              />
            ) : (
              <EmptyState
                title="No delivery matches this search"
                description="Clear the search to widen the register."
              />
            )
          }
        />
      ) : null}

      <Drawer
        open={open !== null}
        onClose={() => setOpenRef(null)}
        title={open?.title ?? "Certificates"}
        subtitle={open?.engagementRef}
        width="520px"
        footer={
          open ? (
            <Link to={engagementPath(open.engagementRef)}>
              <SecondaryButton>Open the engagement</SecondaryButton>
            </Link>
          ) : null
        }
      >
        {open ? <IssuanceDetail row={open} /> : null}
      </Drawer>
    </div>
  );
}

/**
 * The participant roll for one delivery.
 *
 * Read here and nowhere else: the list would otherwise fan out one request per
 * row to answer a question the reader has not asked.
 */
function IssuanceDetail({ row }: { row: CertificateRow }) {
  const participants = useEngagementParticipants(row.engagementRef);
  const roll = participants.data?.data ?? [];
  const tally = tallyIssuance(roll, row.state);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <StatusChip tone={row.tone}>{row.label}</StatusChip>
        <StatusChip tone="neutral">{humanise(row.engagementStatus)}</StatusChip>
      </div>

      <p className="text-[13px] leading-relaxed text-ink-secondary">{EXPLANATION[row.state]}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <Fact label="Delivered" value={row.deliveredOn ? formatDate(row.deliveredOn) : "—"} />
        <Fact label="Attended" value={`${row.attended} of ${row.participants}`} />
      </dl>

      {participants.isPending ? (
        <LoadingState rows={4} label="Loading the participant roll" />
      ) : null}

      {participants.isError ? (
        <ErrorState
          title="The participant roll could not be loaded"
          error={toApiError(participants.error)}
          onRetry={() => void participants.refetch()}
        />
      ) : null}

      {!participants.isPending && !participants.isError ? (
        <>
          {tally.unbacked ? (
            <ExceptionBanner
              severity="WARN"
              title="The engagement reports certificates issued, and no participant record carries one"
              subtitle={`All ${tally.registered} registered participants have an empty certificate identifier. The roll-up on the engagement and the per-participant records disagree, and the claim packet cites the participant records.`}
            />
          ) : null}

          <div className="border-t border-divider pt-4">
            <h3 className="text-[13px] font-medium text-ink">
              {`Participants · ${tally.withCertificate} of ${tally.registered} with a certificate`}
            </h3>

            {roll.length === 0 ? (
              <EmptyState
                title="No participants registered"
                description="Certificates are issued per participant, so a delivery with no roll has none to issue."
              />
            ) : (
              <ul className="mt-2 divide-y divide-divider">
                {roll.map((participant) => (
                  <ParticipantRow key={participant.ref} participant={participant} />
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ParticipantRow({ participant }: { participant: Participant }) {
  const certificate = participant.certificateId ?? null;
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{participant.name}</span>
        <span className="block truncate text-[12px] text-ink-muted">{participant.department}</span>
      </span>
      <span
        className={
          certificate
            ? "shrink-0 font-mono text-[12px] text-ink"
            : "shrink-0 text-[12px] text-ink-muted"
        }
      >
        {certificate ?? "No certificate"}
      </span>
    </li>
  );
}

const EXPLANATION: Record<CertificateState, string> = {
  ISSUED: "The engagement reports that certificates have been issued for this delivery.",
  PENDING:
    "This delivery is complete and its certificates have not been issued. Participants cannot evidence the training until they are.",
  NOT_DUE: "Nothing is due yet. Certificates follow the last delivery day.",
  UNTRACKED:
    "This engagement carries no certificate item on its checklist at all, so nobody is being asked to issue any. That is a setup gap rather than an overdue task.",
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="truncate text-ink">{value}</dd>
    </div>
  );
}

export default CertificatesScreen;
