import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LifecycleStep, PipelineStage } from "@trainos/contract";
import {
  CalendarGrid,
  CalendarList,
  ContentCard,
  EmptyState,
  ErrorState,
  FilterSelect,
  LifecycleStepper,
  LoadingState,
  PillTabGroup,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  calendarDays,
  formatDate,
  humanise,
  periodLabel,
  shiftPeriod,
  type CalendarEntry,
  type CalendarView,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import {
  engagementPath,
  useEngagements,
  useOrganisation,
  usePipelineConfig,
} from "@/features/engagements";
import { daysWithin, openingAnchor, scheduleDays, todayKey, type ScheduleDay } from "./schedule";

/**
 * `/training/calendar` — when is everything being delivered, and by whom.
 *
 * No artboard draws this screen. The composition is the Collections page's:
 * title → overview → view switcher → master/detail, with the grid in the master
 * position. Everything visual comes from the kit, including the grid, which was
 * added to the kit first precisely so this screen could not invent one.
 *
 * The delivery days come from `Engagement.dates[]` rather than from
 * `sessions[]`. Only ENG-0231 publishes sessions today, so a calendar built on
 * sessions would draw one course and imply the rest of the year was free.
 *
 * There is no primary button. A calendar has nothing to create — scheduling a
 * delivery happens on the engagement — and CLAUDE.md's one-primary rule is a
 * ceiling, not a quota. M07-S07 and M10-S06 set the precedent.
 */

type ViewId = CalendarView | "list";

const STATUS_ANY = "ALL";

export function TrainingCalendarScreen() {
  useBreadcrumb([{ label: "Training" }, { label: "Calendar" }]);

  const engagements = useEngagements();
  const pipeline = usePipelineConfig("ENGAGEMENT");

  const today = useMemo(() => todayKey(), []);
  const [view, setView] = useState<ViewId>("month");
  const [status, setStatus] = useState<string>(STATUS_ANY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* `null` means "wherever the schedule says", resolved below once the rows
     have arrived. Seeding state from a query that has not resolved would pin
     the anchor to the empty schedule's fallback for the life of the screen. */
  const [anchorOverride, setAnchorOverride] = useState<string | null>(null);

  const rows = useMemo(() => engagements.data?.data ?? [], [engagements.data]);
  const schedule = useMemo(() => scheduleDays(rows), [rows]);

  const statuses = useMemo(
    () => [...new Set(schedule.map((entry) => entry.status))].sort(),
    [schedule],
  );

  const filtered = useMemo(
    () => (status === STATUS_ANY ? schedule : schedule.filter((row) => row.status === status)),
    [schedule, status],
  );

  const anchor = anchorOverride ?? openingAnchor(filtered, today);

  /* The list view is the fallback for a reader the grid does not serve, so it
     is not period-scoped: it answers "when is everything", which is the whole
     schedule in date order. The grid answers "what is in this period". */
  const gridView: CalendarView = view === "week" ? "week" : "month";
  const period = calendarDays(anchor, gridView);
  const periodFrom = period[0] ?? anchor;
  const periodTo = period[period.length - 1] ?? anchor;
  const inPeriod = daysWithin(filtered, periodFrom, periodTo);

  const shown = view === "list" ? filtered : inPeriod;
  const entries = useMemo(() => shown.map(toEntry), [shown]);

  const selected = useMemo(
    () => filtered.find((row) => row.id === selectedId) ?? null,
    [filtered, selectedId],
  );
  const engagement = rows.find((row) => row.ref === selected?.engagementRef) ?? null;

  const engagementsInView = new Set(shown.map((row) => row.engagementRef)).size;

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Training calendar"
        withoutCondensed
        meta={[
          `${engagementsInView} ${engagementsInView === 1 ? "engagement" : "engagements"}`,
          `${shown.length} delivery ${shown.length === 1 ? "day" : "days"}`,
          view === "list" ? "the whole schedule" : periodLabel(anchor, gridView),
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: STATUS_ANY, label: "Any status" },
                ...statuses.map((value) => ({ value, label: humanise(value) })),
              ]}
            />
            {view === "list" ? null : (
              <div className="flex items-center gap-1.5">
                <SecondaryButton
                  onClick={() => setAnchorOverride(shiftPeriod(anchor, gridView, -1))}
                  aria-label={`Previous ${gridView}`}
                >
                  Previous
                </SecondaryButton>
                <SecondaryButton onClick={() => setAnchorOverride(today)}>Today</SecondaryButton>
                <SecondaryButton
                  onClick={() => setAnchorOverride(shiftPeriod(anchor, gridView, 1))}
                  aria-label={`Next ${gridView}`}
                >
                  Next
                </SecondaryButton>
              </div>
            )}
          </div>
        }
      />

      <div className="px-5 pb-4">
        <PillTabGroup
          label="Calendar view"
          activeId={view}
          onSelect={(id) => setView(id as ViewId)}
          tabs={[
            { id: "month", label: "Month" },
            { id: "week", label: "Week" },
            { id: "list", label: "List", count: filtered.length },
          ]}
        />
      </div>

      {engagements.isPending ? (
        <div className="px-5 pb-5">
          <LoadingState rows={6} label="Loading the delivery schedule" />
        </div>
      ) : null}

      {engagements.isError ? (
        <div className="px-5 pb-5">
          <ErrorState
            title="The delivery schedule could not be loaded"
            error={toApiError(engagements.error)}
            onRetry={() => void engagements.refetch()}
          />
        </div>
      ) : null}

      {!engagements.isPending && !engagements.isError ? (
        schedule.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="Nothing is scheduled"
              description="Delivery days appear here once an engagement is confirmed and its dates are set."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 px-5 pb-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div>
              {view === "list" ? (
                <CalendarList
                  label="Delivery days"
                  entries={entries}
                  formatDay={formatDate}
                  {...(selectedId === null ? {} : { selectedId })}
                  onSelect={(entry) => setSelectedId(entry.id)}
                  empty={
                    <EmptyState
                      title="No delivery matches this status"
                      description="Clear the status facet to see the whole schedule."
                    />
                  }
                />
              ) : (
                <CalendarGrid
                  label="Delivery days"
                  anchor={anchor}
                  view={gridView}
                  today={today}
                  entries={entries}
                  {...(selectedId === null ? {} : { selectedId })}
                  onSelect={(entry) => setSelectedId(entry.id)}
                  empty={
                    <EmptyState
                      title={`Nothing is delivered in ${periodLabel(anchor, gridView)}`}
                      description="Use Previous and Next to reach a period with deliveries, or switch to the list."
                    />
                  }
                />
              )}
            </div>

            <div className="flex flex-col gap-4">
              {selected && engagement ? (
                <DeliveryPanel
                  day={selected}
                  lifecycle={engagement.lifecycle}
                  {...(pipeline.data ? { stages: pipeline.data.stages } : {})}
                  stagesPending={pipeline.isPending}
                  {...(pipeline.isError
                    ? {
                        stagesError: toApiError(pipeline.error),
                        onRetryStages: () => void pipeline.refetch(),
                      }
                    : {})}
                />
              ) : (
                <ContentCard title="No day selected">
                  <p className="text-[13px] text-ink-secondary">
                    Choose a delivery day to see its engagement, its venue and where the claim has
                    got to.
                  </p>
                </ContentCard>
              )}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

/** One delivery day, in the kit's entry shape. */
function toEntry(day: ScheduleDay): CalendarEntry {
  return {
    id: day.id,
    day: day.day,
    title: day.title,
    meta: day.dayCount > 1 ? `Day ${day.dayNumber} of ${day.dayCount} · ${day.venue}` : day.venue,
    badge: <StatusChip tone={toneOf(day.status)}>{humanise(day.status)}</StatusChip>,
  };
}

/**
 * Status colour, and only on the chip.
 *
 * `EngagementStatus` is a closed enum, so this is exhaustive by construction
 * and an unknown value falls to neutral rather than to a colour that would
 * claim something. R14's principle in a rendering: an unrecognised value must
 * not silently pick a branch that means something.
 */
function toneOf(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "IN_DELIVERY":
      return "info";
    case "DELIVERED":
    case "CLOSED":
      return "success";
    case "PROPOSED":
      return "warning";
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * The selected day's engagement.
 *
 * The lifecycle renders from `GET /v1/config/pipelines` stages, never from a
 * list written here — CLAUDE.md's standing rule. When the stages have not
 * arrived the stepper still renders from the server's own step keys, which is
 * why the config's failure is reported beside it rather than instead of it: a
 * missing label is a degraded stepper, not an absent one.
 */
function DeliveryPanel({
  day,
  lifecycle,
  stages,
  stagesPending,
  stagesError,
  onRetryStages,
}: {
  day: ScheduleDay;
  lifecycle: LifecycleStep[];
  stages?: PipelineStage[];
  stagesPending: boolean;
  stagesError?: ReturnType<typeof toApiError>;
  onRetryStages?: () => void;
}) {
  const organisation = useOrganisation(day.organisationRef);

  return (
    <ContentCard
      title={day.title}
      {...(organisation.data ? { eyebrow: organisation.data.name } : {})}
      actions={<StatusChip tone={toneOf(day.status)}>{humanise(day.status)}</StatusChip>}
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[13px] text-ink">
          {formatDate(day.day)}
          {day.dayCount > 1 ? ` · day ${day.dayNumber} of ${day.dayCount}` : null}
        </p>

        {day.sessionTitle ? (
          <p className="text-[13px] font-medium text-ink">{day.sessionTitle}</p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <Detail label="Venue" value={day.venue} />
          <Detail label="Trainer" value={day.trainerName} />
          <Detail label="Engagement" value={day.engagementRef} mono />
        </dl>

        {organisation.isError ? (
          <ErrorState
            title="The client could not be loaded"
            error={toApiError(organisation.error)}
            onRetry={() => void organisation.refetch()}
          />
        ) : null}

        <div className="border-t border-divider pt-3.5">
          {stagesPending ? <LoadingState rows={1} label="Loading the pipeline stages" /> : null}
          {stagesError ? (
            <ErrorState
              title="Stage names could not be loaded"
              description="The steps below are the server's own keys until the pipeline configuration loads."
              error={stagesError}
              {...(onRetryStages ? { onRetry: onRetryStages } : {})}
            />
          ) : null}
          <LifecycleStepper steps={lifecycle} {...(stages ? { stages } : {})} variant="inline" />
        </div>

        <Link
          to={engagementPath(day.engagementRef)}
          className="text-[13px] font-medium text-primary-hover hover:underline"
        >
          Open the engagement →
        </Link>
      </div>
    </ContentCard>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={mono ? "truncate font-mono text-ink" : "truncate text-ink"}>{value}</dd>
    </div>
  );
}

export default TrainingCalendarScreen;
