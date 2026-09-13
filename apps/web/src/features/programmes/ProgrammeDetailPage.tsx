import { useMemo, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { Engagement, Programme, ProgrammeDelivery, Role } from "@trainos/contract";
import {
  Breadcrumb,
  ContentCard,
  DataTable,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  GhostButton,
  LoadingState,
  MoneyText,
  PrimaryButton,
  PROGRAMME_TONE,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  formatDate,
  formatDateRange,
  humanise,
  type Column,
  type MetricCellProps,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { isDomainError, readableMessage, toApiError } from "@/shared/api";
import { useMe } from "@/shared/hooks/useMe";
import {
  canEditCatalogue,
  useEditProgramme,
  useEngagementsForProgramme,
  useProgramme,
  useProgrammeDeliveries,
  useTrainers,
} from "./api";
import {
  POOL_LABEL,
  POOL_TONE,
  dayRange,
  nearestWindow,
  poolRows,
  type PoolRow,
} from "./availability";
import { hrdcSchemeLabel } from "./labels";
import { PROGRAMMES_LIST_PATH } from "./paths";

/**
 * M06-S02 · Programme detail.
 *
 * A deliberately human-maintained catalogue record: no agent writes here, so
 * there is no AI chip, no provenance block and no proposed-action card on this
 * page. "Not every screen needs an agent" is the pack's own note.
 *
 * The state the screen exists to render is the trainer pool's second row — a
 * pool trainer already committed across the window this programme is being
 * delivered in. That constraint is what later makes the M02 approval "medium
 * risk", so it has to be legible here rather than discovered downstream.
 */

/* ---- Small layout pieces -------------------------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function KeyValueRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-divider py-1.5 text-[12px] last:border-b-0">
      <span className="text-ink-secondary">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

/* ---- The screen ------------------------------------------------------ */

export function ProgrammeDetailPage() {
  /* BreadcrumbProvider exists so the TOP BAR owns the path: "a screen
     rendering its own trail inside the content card puts the path in the wrong
     place." This screen rendered a <Breadcrumb/> in its content. Ends at the
     list, because RecordHeader below already renders the programme's name. */
  useBreadcrumb([{ label: "Training" }, { label: "Programmes", href: PROGRAMMES_LIST_PATH }]);
  const { programmeRef } = useParams<{ programmeRef: string }>();
  const { me } = useMe();

  const programmeQuery = useProgramme(programmeRef);
  const deliveriesQuery = useProgrammeDeliveries(programmeRef);
  const trainersQuery = useTrainers();
  const engagementsQuery = useEngagementsForProgramme(programmeQuery.data?.ref);

  const programme = programmeQuery.data;

  const window = useMemo(
    () => nearestWindow(engagementsQuery.data ?? [], new Date().toISOString().slice(0, 10)),
    [engagementsQuery.data],
  );

  const pool = useMemo(
    () => poolRows(programme?.trainerPool ?? [], trainersQuery.data?.data ?? [], window),
    [programme, trainersQuery.data, window],
  );

  const bookedElsewhere = pool.filter((row) => row.status === "BOOKED");

  if (programmeQuery.isPending) return <LoadingState label="Loading the programme" />;

  if (programmeQuery.isError || !programme) {
    return (
      <ErrorState
        title="Could not load this programme"
        error={toApiError(programmeQuery.error)}
        onRetry={() => void programmeQuery.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ContentCard flush>
        <RecordHeader
          accent
          collapsible
          recordType="programme"
          title={programme.name}
          recordRef={programme.ref}
          meta={[
            humanise(programme.category).toLowerCase(),
            `${programme.days} ${programme.days === 1 ? "day" : "days"}`,
            `v${programme.version}`,
            "owner L&D",
            `updated ${formatDate(programme.updatedAt)}`,
          ]}
          chips={
            <>
              <StatusChip tone={PROGRAMME_TONE[programme.status]}>
                {humanise(programme.status)}
              </StatusChip>
              {programme.hrdcClaimable ? <StatusChip tone="info">HRDC claimable</StatusChip> : null}
            </>
          }
          actions={
            <>
              <GhostButton type="button">Version history</GhostButton>
              <SecondaryButton type="button">Duplicate</SecondaryButton>
            </>
          }
          primaryAction={<EditProgrammeAction programme={programme} role={me.role} />}
          metrics={metricsFor(programme, pool.length)}
        />

        {bookedElsewhere.length > 0 && window ? (
          <div className="px-5 pb-4">
            <ExceptionBanner
              severity="WARN"
              title={`${bookedElsewhere.map((row) => row.name).join(", ")} already booked across ${dayRange(window.dates)}`}
              subtitle={`${bookedElsewhere.length} of ${pool.length} pool trainers cannot take a second cohort in that window, which is the constraint the delivery approval will weigh.`}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 border-t border-divider px-5 py-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-6">
            <Section title="Outcomes">
              <ul className="flex flex-col gap-1.5">
                {programme.outcomes.map((outcome) => (
                  <li key={outcome} className="flex gap-2 text-[13px] text-ink">
                    <span aria-hidden="true" className="text-ink-muted">
                      —
                    </span>
                    <span>{outcome}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Modules">
              <ModulesTable programme={programme} />
            </Section>

            <Section title="Past deliveries">
              <DeliveriesTable
                deliveries={deliveriesQuery.data?.data ?? []}
                isPending={deliveriesQuery.isPending}
                isError={deliveriesQuery.isError}
                error={deliveriesQuery.error}
                onRetry={() => void deliveriesQuery.refetch()}
              />
            </Section>
          </div>

          <div className="flex flex-col gap-6">
            <Section title="Pricing tiers">
              <div>
                {programme.pricingTiers.map((tier, index) => {
                  const previous = programme.pricingTiers[index - 1];
                  return (
                    <KeyValueRow
                      key={tier.maxPax}
                      label={
                        previous
                          ? `${previous.maxPax + 1}–${tier.maxPax} pax`
                          : `Up to ${tier.maxPax} pax`
                      }
                      value={<MoneyText value={tier.price} />}
                    />
                  );
                })}
                {/* The absolute floor. M07-S03 validates against this exact value. */}
                <KeyValueRow
                  label={
                    <span className="font-medium text-ink">
                      Absolute floor · {Math.round(programme.floorMarginRate * 100)}% margin
                    </span>
                  }
                  value={<MoneyText value={programme.floorPrice} />}
                />
              </div>
            </Section>

            <Section title="Trainer pool">
              <TrainerPoolList
                rows={pool}
                window={window}
                isPending={trainersQuery.isPending || engagementsQuery.isPending}
              />
            </Section>

            <Section title="Materials">
              <div>
                {programme.materials.map((material) => (
                  <KeyValueRow
                    key={`${material.type}-${material.version}`}
                    label={humanise(material.type)}
                    value={`v${material.version} · ${material.languages.join("/")}`}
                  />
                ))}
              </div>
            </Section>

            <Section title="HRD Corp">
              <p className="text-[12px] leading-relaxed text-ink-secondary">
                {programme.hrdcClaimable ? (
                  <>
                    Claimable under{" "}
                    <b className="font-semibold text-ink">
                      {hrdcSchemeLabel(programme.hrdcScheme)}
                    </b>
                    . The claim packet needs the attendance sheet, the trainer&rsquo;s TTT
                    certificate, the tax invoice and the evaluation summary.
                  </>
                ) : (
                  "Not claimable. Any levy conversation on this programme is out of scope."
                )}
              </p>
            </Section>
          </div>
        </div>
      </ContentCard>
    </div>
  );
}

function metricsFor(programme: Programme, poolSize: number): MetricCellProps[] {
  return [
    { label: "List price", value: programme.listPrice, sub: `${programme.listPricePax} pax` },
    { label: "Duration", value: `${programme.days} ${programme.days === 1 ? "day" : "days"}` },
    { label: "Delivered", value: `${programme.stats.deliveries}×` },
    {
      label: "Avg evaluation",
      value: programme.stats.averageEvaluation.toFixed(1),
      sub: "out of 5",
    },
    { label: "Trainer pool", value: String(poolSize) },
  ];
}

/* ---- The one primary action ----------------------------------------- */

/**
 * "Edit programme" is the view's single solid primary, and it is role-gated to
 * the catalogue owners. Sales sees the record read-only, so the button is
 * absent rather than disabled — a button that will always refuse is noise.
 *
 * The refusal is still rendered when it happens: the client is the boundary,
 * and a 403 comes back with the role that would have been allowed.
 */
function EditProgrammeAction({ programme, role }: { programme: Programme; role: Role }) {
  const edit = useEditProgramme(programme.ref);
  const editFailure = toApiError(edit.error);

  if (!canEditCatalogue(role)) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <PrimaryButton
        type="button"
        disabled={edit.isPending}
        onClick={() => edit.mutate({ status: programme.status })}
      >
        {edit.isPending ? "Saving…" : "Edit programme"}
      </PrimaryButton>
      {edit.isError ? (
        <span role="alert" className="text-[11px] text-danger">
          {/* Against the typed DomainError, not a helper that widened the
              contract's ErrorCode to `string` — a renamed code would have
              compiled clean and silently stopped matching. */}
          {isDomainError(editFailure) && editFailure.code === "FORBIDDEN"
            ? "Editing the catalogue is restricted to Admin and L&D."
            : readableMessage(editFailure)}
        </span>
      ) : null}
    </div>
  );
}

/* ---- Tables ---------------------------------------------------------- */

function ModulesTable({ programme }: { programme: Programme }) {
  const columns: Column<Programme["modules"][number]>[] = [
    { key: "n", label: "#", width: "44px", accessor: (module) => module.n },
    { key: "title", label: "Module", accessor: (module) => module.title },
    { key: "format", label: "Format", accessor: (module) => humanise(module.format) },
    {
      key: "duration",
      label: "Duration",
      align: "right",
      accessor: (module) => `${module.durationMinutes} min`,
    },
  ];
  return (
    <DataTable
      label={`Modules of ${programme.name}`}
      columns={columns}
      rows={programme.modules}
      rowKey={(module) => String(module.n)}
      density="compact"
    />
  );
}

function DeliveriesTable({
  deliveries,
  isPending,
  isError,
  error,
  onRetry,
}: {
  deliveries: ProgrammeDelivery[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (isPending) return <LoadingState rows={3} label="Loading past deliveries" />;
  if (isError) {
    return (
      <ErrorState
        title="Could not load past deliveries"
        error={toApiError(error)}
        onRetry={onRetry}
      />
    );
  }

  const columns: Column<ProgrammeDelivery>[] = [
    { key: "client", label: "Client", accessor: (row) => row.organisationName },
    { key: "dates", label: "Dates", accessor: (row) => formatDateRange(row.dates) },
    { key: "pax", label: "Pax", align: "right", accessor: (row) => row.pax },
    {
      key: "evaluation",
      label: "Evaluation",
      align: "right",
      accessor: (row) => (row.evaluation > 0 ? row.evaluation.toFixed(1) : "—"),
    },
    {
      key: "value",
      label: "Value",
      align: "right",
      accessor: (row) => <MoneyText value={row.value} />,
    },
  ];

  return (
    <DataTable
      label="Past deliveries"
      columns={columns}
      rows={deliveries}
      rowKey={(row) => row.engagementRef}
      density="compact"
      empty={
        <EmptyState
          title="Not delivered yet"
          description="Deliveries appear here once the first cohort is closed out."
        />
      }
    />
  );
}

function TrainerPoolList({
  rows,
  window,
  isPending,
}: {
  rows: PoolRow[];
  window: Engagement | undefined;
  isPending: boolean;
}) {
  if (isPending) return <LoadingState rows={2} label="Loading the trainer pool" />;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No trainers in the pool"
        description="Add a certified trainer before this programme can be scheduled."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {window ? (
        <p className="text-[11px] text-ink-muted">
          Availability against {dayRange(window.dates)} · {window.ref}
        </p>
      ) : null}
      {rows.map((row) => (
        <div
          key={row.trainerRef}
          className="flex items-start justify-between gap-3 border-b border-divider pb-2 last:border-b-0"
        >
          <div>
            <div className="text-[13px] font-medium text-ink">{row.name}</div>
            <div className="text-[11px] text-ink-muted">
              {[
                row.tttCertified ? "TTT certified" : "No TTT certificate",
                row.rating === undefined ? null : row.rating.toFixed(1),
                row.conflictDates.length > 0
                  ? `${row.status === "DELIVERING" ? "delivering" : "booked"} ${dayRange(row.conflictDates)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <StatusChip tone={POOL_TONE[row.status]}>{POOL_LABEL[row.status]}</StatusChip>
        </div>
      ))}
    </div>
  );
}

export default ProgrammeDetailPage;
