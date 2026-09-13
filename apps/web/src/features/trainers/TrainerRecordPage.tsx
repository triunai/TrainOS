import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Engagement, Programme } from "@trainos/contract";
import type { FixtureTrainer } from "@trainos/fixtures";
import {
  CalendarList,
  ContentCard,
  DataTable,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  LoadingState,
  MoneyText,
  PillTabGroup,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  formatDate,
  humanise,
  type CalendarEntry,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { todayKey } from "@/features/calendar";
import { engagementPath, useEngagements } from "@/features/engagements";
import { useProgrammes } from "@/features/programmes";
import { useTrainers } from "./api";
import { accreditationOf, nextBookedDay } from "./accreditation";
import { TRAINERS_LIST_PATH } from "./paths";

/**
 * `/training/trainers/:trainerRef` — the trainer record.
 *
 * M08-S02 is named as the target of M06-S02's pool table but the design pack
 * never draws it, so the anatomy comes from the pack's own record template:
 * RecordHeader owns the identity, a metric strip is row 3, and a pill tab group
 * switches the body. The breadcrumb owns the path and the name appears once.
 *
 * No primary button. There is no trainer write in the contract — no POST, no
 * PUT, nothing on `/v1/trainers` but the list — so a solid button here would be
 * a control that cannot do anything. M07-S07 and M10-S06 are the precedent for
 * a record with no primary.
 */

const TABS = { overview: "Overview", programmes: "Programmes", availability: "Availability" };

type TabId = keyof typeof TABS;

export function TrainerRecordPage() {
  const { trainerRef = "" } = useParams<{ trainerRef: string }>();
  const today = useMemo(() => todayKey(), []);
  const [tab, setTab] = useState<TabId>("overview");

  const trainers = useTrainers();
  const trainer = trainers.data?.data.find((row) => row.ref === trainerRef);

  useBreadcrumb([
    { label: "Training" },
    { label: "Trainers", href: TRAINERS_LIST_PATH },
    { label: trainer?.name ?? trainerRef },
  ]);

  if (trainers.isPending) return <LoadingState label="Loading the trainer" />;

  if (trainers.isError) {
    return (
      <ErrorState
        title="Could not load this trainer"
        error={toApiError(trainers.error)}
        onRetry={() => void trainers.refetch()}
      />
    );
  }

  if (!trainer) {
    return (
      <EmptyState
        title={`No trainer with the reference ${trainerRef}`}
        description="The pool may have changed since this link was made."
        action={
          <Link to={TRAINERS_LIST_PATH}>
            <SecondaryButton>Back to the pool</SecondaryButton>
          </Link>
        }
      />
    );
  }

  return <TrainerRecord trainer={trainer} today={today} tab={tab} onTab={setTab} />;
}

function TrainerRecord({
  trainer,
  today,
  tab,
  onTab,
}: {
  trainer: FixtureTrainer;
  today: string;
  tab: TabId;
  onTab: (tab: TabId) => void;
}) {
  const accreditation = accreditationOf(trainer, today);
  const programmes = useProgrammes();
  const engagements = useEngagements();

  const canDeliver = useMemo(
    () =>
      (programmes.data?.data ?? []).filter((programme) =>
        trainer.programmeRefs.includes(programme.ref),
      ),
    [programmes.data, trainer.programmeRefs],
  );

  /* The trainer's own deliveries. `Engagement.metrics.trainer` is the assignment;
     `bookedDates` is only the diary, and a diary entry says nothing about which
     delivery it belongs to. */
  const deliveries = useMemo(
    () =>
      (engagements.data?.data ?? []).filter(
        (engagement) => engagement.metrics.trainer.ref === trainer.ref,
      ),
    [engagements.data, trainer.ref],
  );

  const next = nextBookedDay(trainer, today);

  return (
    <div className="flex flex-col">
      <RecordHeader
        title={trainer.name}
        recordRef={trainer.ref}
        meta={[
          `Band ${trainer.bands}`,
          trainer.email,
          trainer.lastDeliveredAt ? `last delivered ${formatDate(trainer.lastDeliveredAt)}` : null,
        ]}
        chips={<StatusChip tone={accreditation.tone}>{accreditation.label}</StatusChip>}
        metrics={[
          { label: "Rating", value: trainer.rating.toFixed(1), sub: "out of 5" },
          {
            label: "Programmes",
            value: String(trainer.programmeRefs.length),
            sub: "they may deliver",
          },
          {
            label: "Days committed",
            value: String(trainer.bookedDates.length),
            sub: next ? `next ${formatDate(next)}` : "none ahead",
          },
          {
            label: "TTT valid to",
            value: trainer.tttValidTo ? formatDate(trainer.tttValidTo) : "—",
            sub: trainer.tttRef ?? "no certificate on record",
          },
        ]}
      />

      {accreditation.detail ? (
        <div className="px-5 pb-4">
          <ExceptionBanner
            severity={accreditation.tone === "danger" ? "DANGER" : "WARN"}
            title={accreditation.label}
            subtitle={accreditation.detail}
          />
        </div>
      ) : null}

      <div className="px-5 pb-4">
        <PillTabGroup
          label="Trainer record"
          activeId={tab}
          onSelect={(id) => onTab(id as TabId)}
          tabs={[
            { id: "overview", label: TABS.overview, count: deliveries.length },
            { id: "programmes", label: TABS.programmes, count: trainer.programmeRefs.length },
            { id: "availability", label: TABS.availability, count: trainer.bookedDates.length },
          ]}
        />
      </div>

      <div className="flex flex-col gap-5 px-5 pb-5">
        {tab === "overview" ? (
          <>
            <ContentCard title="Accreditation">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-4">
                <Fact
                  label="Train-the-Trainer"
                  value={trainer.tttRef ?? "Not on record"}
                  mono={Boolean(trainer.tttRef)}
                />
                <Fact
                  label="Certificate valid to"
                  value={trainer.tttValidTo ? formatDate(trainer.tttValidTo) : "—"}
                />
                <Fact
                  label="HRD Corp TDF"
                  value={trainer.hrdTdf ? "Registered" : "Not registered"}
                />
                <Fact
                  label="Claim eligibility"
                  value={accreditation.claimable ? "Can be cited" : "Cannot be cited"}
                />
              </dl>
              <p className="mt-3 text-[12px] text-ink-muted">
                Both gates are read by §17&apos;s trainer-accreditation check. A current certificate
                without HRD Corp registration still fails the claim.
              </p>
            </ContentCard>

            <ContentCard title="Deliveries" flush>
              {engagements.isPending ? (
                <LoadingState rows={3} label="Loading this trainer's deliveries" />
              ) : null}
              {engagements.isError ? (
                <ErrorState
                  title="The deliveries could not be loaded"
                  error={toApiError(engagements.error)}
                  onRetry={() => void engagements.refetch()}
                />
              ) : null}
              {!engagements.isPending && !engagements.isError ? (
                <DataTable
                  label="Deliveries"
                  columns={DELIVERY_COLUMNS}
                  rows={deliveries}
                  rowKey={(engagement) => engagement.ref}
                  empty={
                    <EmptyState
                      title="No delivery on record"
                      description="Engagements appear here once this trainer is assigned to one."
                    />
                  }
                />
              ) : null}
            </ContentCard>
          </>
        ) : null}

        {tab === "programmes" ? (
          <ContentCard title="Programmes they may deliver" flush>
            {programmes.isPending ? <LoadingState rows={3} label="Loading the catalogue" /> : null}
            {programmes.isError ? (
              <ErrorState
                title="The catalogue could not be loaded"
                error={toApiError(programmes.error)}
                onRetry={() => void programmes.refetch()}
              />
            ) : null}
            {!programmes.isPending && !programmes.isError ? (
              <DataTable
                label="Programmes"
                columns={PROGRAMME_COLUMNS}
                rows={canDeliver}
                rowKey={(programme) => programme.ref}
                empty={
                  <EmptyState
                    title="No programme assigned"
                    description="A trainer with no programme cannot be put on a delivery."
                  />
                }
              />
            ) : null}
          </ContentCard>
        ) : null}

        {tab === "availability" ? (
          <ContentCard title="Committed days">
            <CalendarList
              label="Committed days"
              entries={committedEntries(trainer, today)}
              formatDay={formatDate}
              empty={
                <EmptyState
                  title="Nothing in the diary"
                  description="This trainer has no committed days, so any window is open to them."
                />
              }
            />
            <p className="mt-3 text-[12px] text-ink-muted">
              Committed days come from the trainer&apos;s own diary. Which delivery a day belongs to
              is on the engagement, not here.
            </p>
          </ContentCard>
        ) : null}
      </div>
    </div>
  );
}

/** One committed day, in the kit's entry shape, past days marked as past. */
function committedEntries(trainer: FixtureTrainer, today: string): CalendarEntry[] {
  return [...trainer.bookedDates].sort().map((day) => ({
    id: `${trainer.ref}::${day}`,
    day,
    title: day >= today ? "Committed" : "Delivered",
    badge: (
      <StatusChip tone={day >= today ? "info" : "neutral"}>
        {day >= today ? "Ahead" : "Past"}
      </StatusChip>
    ),
  }));
}

/**
 * Only the fields this table reads.
 *
 * Not `Engagement` itself: `listEngagements` returns the role-dependent
 * PROJECTION, which drops the `finance` block for OPS, so a column typed on the
 * full record would be claiming a field the OPS reader's rows do not carry.
 */
type DeliveryRow = Pick<Engagement, "ref" | "title" | "status" | "dates" | "venue" | "value">;

const DELIVERY_COLUMNS: Column<DeliveryRow>[] = [
  {
    key: "title",
    label: "Engagement",
    accessor: (engagement) => (
      <div className="min-w-0">
        <Link
          to={engagementPath(engagement.ref)}
          className="block truncate text-[13px] font-medium text-ink hover:underline"
        >
          {engagement.title}
        </Link>
        <div className="truncate text-[12px] text-ink-muted">
          <span className="font-mono">{engagement.ref}</span>
          {` · ${engagement.venue}`}
        </div>
      </div>
    ),
  },
  {
    key: "dates",
    label: "Delivered",
    width: "148px",
    accessor: (engagement) => (
      <span className="text-[13px] tabular-nums text-ink-secondary">
        {engagement.dates.length > 0 ? formatDate(engagement.dates[0]) : "—"}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    width: "128px",
    accessor: (engagement) => <StatusChip tone="neutral">{humanise(engagement.status)}</StatusChip>,
  },
  {
    key: "value",
    label: "Value",
    width: "128px",
    align: "right",
    accessor: (engagement) => <MoneyText value={engagement.value} />,
  },
];

const PROGRAMME_COLUMNS: Column<Programme>[] = [
  {
    key: "name",
    label: "Programme",
    accessor: (programme) => (
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-ink">{programme.name}</div>
        <div className="truncate text-[12px] text-ink-muted">
          <span className="font-mono">{programme.ref}</span>
          {` · v${programme.version}`}
        </div>
      </div>
    ),
  },
  {
    key: "category",
    label: "Category",
    width: "148px",
    accessor: (programme) => humanise(programme.category),
  },
  {
    key: "days",
    label: "Duration",
    width: "104px",
    accessor: (programme) => `${programme.days} ${programme.days === 1 ? "day" : "days"}`,
  },
  {
    key: "listPrice",
    label: "List price",
    width: "132px",
    align: "right",
    accessor: (programme) => <MoneyText value={programme.listPrice} />,
  },
];

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={mono ? "truncate font-mono text-ink" : "truncate text-ink"}>{value}</dd>
    </div>
  );
}

export default TrainerRecordPage;
