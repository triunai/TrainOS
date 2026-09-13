import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { EngagementSession } from "@trainos/contract";
import {
  ActionOutcome,
  ChecklistRow,
  ContentCard,
  DataTable,
  describeActionError,
  ENGAGEMENT_TONE,
  ErrorState,
  ExceptionBanner,
  LifecycleStepper,
  LoadingState,
  MoneyText,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  RuleCheckRow,
  SecondaryButton,
  StatusChip,
  SYNC_TONE,
  formatDate,
  humanise,
  toast,
  type Column,
} from "@/shared/components/kit";
import { toApiError } from "@/shared/api";
import { useBreadcrumb } from "@/shared/components/layout";
import {
  useAttendanceDays,
  useComplianceChecks,
  useEngagement,
  useOrganisation,
  usePerformAction,
  usePipelineConfig,
} from "./api";
import { joinAttendance, markLabel, type ParticipantAttendance } from "./attendanceModel";

/**
 * M09-S02 · engagement detail. The operational spine of a delivered programme:
 * what happened, what is signed off, and what still blocks the money.
 *
 * Three rules this screen exists to honour:
 *
 *  1. The stepper renders the server's `LifecycleStep[]` against the stages
 *     `GET /v1/config/pipelines?object=ENGAGEMENT` defines. `HRDC_CLAIM` shows
 *     BLOCKED because a compliance check FAILS — the screen never computes that
 *     from a document count, it only draws what the server sent.
 *  2. `finance` is OPTIONAL. The OPS projection DROPS the block rather than
 *     zeroing it, so the finance panel renders only when the projection carries
 *     one. A missing field is honest; an RM 0.00 would be a lie to the person
 *     the tenancy design deliberately withholds pricing from.
 *  3. "Close out" is the view's single solid primary and it goes through the §3
 *     action envelope. While the claim checklist is incomplete the server
 *     refuses and names every blocker; those blockers are what gets rendered.
 */

const TAB_IDS = ["overview", "sessions", "participants", "hrdc", "finance"] as const;
type TabId = (typeof TAB_IDS)[number];

/**
 * The one stage this screen refers to by name, and it refers to it through the
 * pipeline rather than to the record directly. See the note at its use.
 */
const ATTENDANCE_LOCKED_STAGE = "ATTENDANCE_LOCKED";

export function EngagementDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("overview");

  const engagement = useEngagement(id);
  const pipeline = usePipelineConfig("ENGAGEMENT");
  const record = engagement.data;

  const checks = useComplianceChecks(record?.ref ?? "");
  const organisation = useOrganisation(record?.organisationRef);
  const days = useMemo(() => (record?.sessions ?? []).map((session) => session.day), [record]);
  const sheets = useAttendanceDays(id, days);
  const closeOut = usePerformAction();

  /* The top bar renders the path; this screen only declares it. Built inline —
     `useBreadcrumb` compares by value, so memoising it would be noise. */
  useBreadcrumb([
    { label: "Home", href: "/" },
    { label: "Training", href: "/training/engagements" },
    { label: "Engagements", href: "/training/engagements" },
  ]);

  if (engagement.isPending) return <LoadingState rows={8} label="Loading the engagement" />;
  if (engagement.isError || !record) {
    return (
      <ErrorState
        title="This engagement could not be opened"
        error={toApiError(engagement.error)}
      />
    );
  }

  const blockedStep = record.lifecycle.find((step) => step.state === "BLOCKED");

  /* The attendance metric's sub-line carries WHEN the sheet was locked, which
     means naming one stage. CLAUDE.md forbids hardcoding stage names and order,
     so the stage is resolved through the pipeline configuration and the word
     printed is the configured LABEL: rename the stage and the screen follows;
     remove it and the sub-line disappears rather than silently never matching,
     which is what a raw `find(key === "ATTENDANCE_LOCKED")` against the record
     did. The key itself is still a literal because `LifecycleStep.key` is typed
     `string` in the contract — a named constant is as close as this file can
     get until that enum exists. */
  const lockedStage = pipeline.data?.stages.find((stage) => stage.key === ATTENDANCE_LOCKED_STAGE);
  const lockedAt = lockedStage
    ? record.lifecycle.find((step) => step.key === lockedStage.key)?.at
    : undefined;
  const sheetData = sheets.flatMap((query) => (query.data ? [query.data] : []));
  const roster = joinAttendance(sheetData);
  const exceptions = roster.filter((row) => row.status !== "COMPLETE");
  const failing = (checks.data?.checks ?? []).filter((check) => check.state === "FAIL");
  const missingDocuments = failing.flatMap((check) => {
    const missing = (check.computed as { missing?: unknown }).missing;
    return Array.isArray(missing) ? missing.map(String) : [];
  });

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "sessions", label: "Sessions", count: record.sessions.length },
    { id: "participants", label: "Participants", count: record.metrics.participants },
    { id: "hrdc", label: "HRD Corp", count: checks.data?.summary.fail ?? 0 },
    ...(record.finance ? [{ id: "finance", label: "Finance" }] : []),
  ];

  const showOverview = tab === "overview";

  return (
    <div className="flex flex-col">
      <RecordHeader
        title={record.title}
        recordRef={record.ref}
        meta={[
          organisation.data?.name,
          record.dates.map(formatDate).join(" – "),
          record.venue,
          record.owner.name ? `owner ${record.owner.name}` : null,
          record.opportunityRef ? `from ${record.opportunityRef}` : null,
        ]}
        chips={[
          <StatusChip key="status" live tone={ENGAGEMENT_TONE[record.status]}>
            {humanise(record.status)}
          </StatusChip>,
          ...(blockedStep
            ? [
                <StatusChip key="blocked" tone="warning">
                  Claim blocked
                </StatusChip>,
              ]
            : []),
        ]}
        actions={
          <>
            <SecondaryButton onClick={() => toast.info("Run sheet is not wired yet")}>
              Run sheet
            </SecondaryButton>
            <SecondaryButton onClick={() => toast.info("Audit trail is not wired yet")}>
              Audit trail
            </SecondaryButton>
          </>
        }
        primaryAction={
          <PrimaryButton
            disabled={closeOut.isPending}
            onClick={() => closeOut.mutate({ type: "ENGAGEMENT_CLOSE_OUT", targetRef: record.ref })}
          >
            Close out
          </PrimaryButton>
        }
        metrics={[
          { label: "Value", value: <MoneyText value={record.value} compact /> },
          {
            label: "Participants",
            value: record.metrics.participants,
            sub: `${record.metrics.attended} attended`,
          },
          { label: "Trainer", value: record.metrics.trainer.name },
          {
            label: "Attendance",
            value: `${Math.round(record.metrics.attendanceRate * 100)}%`,
            ...(lockedStage && lockedAt
              ? { sub: `${lockedStage.label.toLowerCase()} ${formatDate(lockedAt)}` }
              : {}),
            onDrill: () => navigate(`/training/participants/${record.ref}/attendance`),
          },
          {
            label: "Claim completeness",
            value: `${Math.round(record.metrics.claimCompleteness * 100)}%`,
            bar: record.metrics.claimCompleteness,
            barState: blockedStep ? "near" : "within",
          },
        ]}
        stepper={
          <LifecycleStepper
            steps={record.lifecycle}
            {...(pipeline.data ? { stages: pipeline.data.stages } : {})}
            variant="header"
          />
        }
      />

      <div className="border-b border-divider px-5 pb-3">
        <PillTabGroup
          tabs={tabs}
          activeId={tab}
          onSelect={(next) => setTab(next as TabId)}
          label="Engagement sections"
        />
      </div>

      <div className="flex min-w-0 flex-col gap-5 px-5 py-5 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {(closeOut.data || closeOut.error) && (
            <ActionOutcome
              {...(closeOut.data ? { response: closeOut.data } : {})}
              {...(closeOut.error
                ? {
                    error: describeActionError(
                      toApiError(closeOut.error),
                      `${record.ref} could not be closed out`,
                    ),
                  }
                : {})}
              subject={`Close out ${record.ref}`}
              onDismiss={() => closeOut.reset()}
            />
          )}

          {blockedStep && (showOverview || tab === "hrdc") ? (
            <ExceptionBanner
              severity="WARN"
              title={`HRDC claim packet is ${Math.round(
                record.metrics.claimCompleteness * 100,
              )}% complete`}
              subtitle={[blockedStep.note, missingDocuments.map(humanise).join(" · ")]
                .filter(Boolean)
                .join(" — ")}
              action={
                <SecondaryButton onClick={() => toast.info("The claim packet is not wired yet")}>
                  Open packet
                </SecondaryButton>
              }
            />
          ) : null}

          {showOverview || tab === "hrdc" ? <ChecksCard id={record.ref} /> : null}

          {showOverview || tab === "sessions" ? (
            <SessionsCard sessions={record.sessions} engagementRef={record.ref} />
          ) : null}

          {showOverview || tab === "participants" ? (
            <ParticipantsCard
              roster={roster}
              days={days}
              exceptions={exceptions.length}
              loading={sheets.some((query) => query.isPending)}
            />
          ) : null}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-5 xl:w-[320px]">
          <ContentCard title="Checklist">
            <div className="flex flex-col">
              {record.checklist.map((item) => (
                <ChecklistRow key={item.key} label={item.label} done={item.done} />
              ))}
            </div>
          </ContentCard>

          {/* §8 the OPS projection has NO finance block. Render nothing rather
              than zeroes — see the file header. */}
          {record.finance ? (
            <ContentCard title="Finance">
              <dl className="flex flex-col gap-2 text-[13px]">
                <FinanceRow
                  term={record.finance.invoiceRef ?? "Not invoiced"}
                  value={<MoneyText value={record.value} />}
                />
                <FinanceRow
                  term="Accounting sync"
                  value={
                    <StatusChip tone={SYNC_TONE[record.finance.syncState]}>
                      {humanise(record.finance.syncState)}
                    </StatusChip>
                  }
                />
                <FinanceRow
                  term="Trainer payable"
                  value={<MoneyText value={record.finance.trainerPayable} />}
                />
                <FinanceRow
                  term="Margin realised"
                  value={`${Math.round(record.finance.realisedMarginRate * 100)}%`}
                />
              </dl>
            </ContentCard>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function FinanceRow({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-secondary">{term}</dt>
      <dd className="font-mono text-ink">{value}</dd>
    </div>
  );
}

/**
 * §17 the checks block. Every row shows its computed values and cites its rule,
 * which is what makes a BLOCKED lifecycle step auditable rather than merely
 * assertive. Every check the server returned is rendered — truncating the list
 * to match a static artboard would hide a failing rule.
 */
function ChecksCard({ id }: { id: string }) {
  const checks = useComplianceChecks(id);

  if (checks.isPending) return <LoadingState rows={3} label="Loading the rule checks" />;
  if (checks.isError || !checks.data) {
    return <ErrorState title="Rule checks are unavailable" error={toApiError(checks.error)} />;
  }

  const { summary, checks: rows, ruleResolution } = checks.data;

  return (
    <ContentCard
      title="Rule checks"
      actions={
        <StatusChip tone={summary.fail > 0 ? "danger" : summary.warn > 0 ? "warning" : "success"}>
          {summary.pass} pass · {summary.warn} warn · {summary.fail} fail
        </StatusChip>
      }
    >
      <div className="flex flex-col">
        {rows.map((check) => (
          <RuleCheckRow key={check.key} check={check} />
        ))}
      </div>
      <p className="pt-2.5 text-[11px] text-ink-muted">
        Grant-side rules {ruleResolution.grantSide.ruleSetVersion ?? "unresolved"} · claim-side{" "}
        {ruleResolution.claimSide.ruleSetVersion ?? "not submitted"}. The HRDC step stays Blocked
        while any check fails.
      </p>
    </ContentCard>
  );
}

function SessionsCard({
  sessions,
  engagementRef,
}: {
  sessions: EngagementSession[];
  engagementRef: string;
}) {
  const navigate = useNavigate();

  const columns: Column<EngagementSession>[] = [
    {
      key: "title",
      label: "Session",
      accessor: (row) => `Day ${row.day} · ${row.title}`,
    },
    { key: "date", label: "Date", accessor: (row) => formatDate(row.date) },
    { key: "venue", label: "Venue", accessor: (row) => row.venue },
    { key: "trainer", label: "Trainer", accessor: (row) => row.trainerRef },
    {
      key: "attendance",
      label: "Attendance",
      align: "right",
      accessor: (row) => `${row.present} / ${row.total}`,
    },
  ];

  return (
    <ContentCard title="Sessions" flush>
      <DataTable
        label="Delivery sessions"
        columns={columns}
        rows={sessions}
        rowKey={(row) => row.ref}
        onRowClick={(row) =>
          navigate(`/training/participants/${engagementRef}/attendance?day=${row.day}`)
        }
        empty={<p className="px-4 py-6 text-[13px] text-ink-muted">No sessions scheduled yet.</p>}
      />
    </ContentCard>
  );
}

function ParticipantsCard({
  roster,
  days,
  exceptions,
  loading,
}: {
  roster: ParticipantAttendance[];
  days: number[];
  exceptions: number;
  loading: boolean;
}) {
  const columns: Column<ParticipantAttendance>[] = [
    { key: "name", label: "Name", accessor: (row) => row.name },
    { key: "department", label: "Department", accessor: (row) => row.department },
    ...days.map((day) => ({
      key: `day-${day}`,
      label: `Day ${day}`,
      accessor: (row: ParticipantAttendance) => {
        const entry = row.days.find((candidate) => candidate.day === day);
        if (!entry) return <span className="text-ink-muted">—</span>;
        const present = entry.am.present && entry.pm.present;
        return (
          <span className={present ? "text-ink" : "text-ink-muted"}>
            {present ? "✓" : markLabel(entry.am.present ? entry.pm : entry.am)}
          </span>
        );
      },
    })),
    {
      key: "status",
      label: "Status",
      accessor: (row) => (
        <StatusChip tone={row.status === "COMPLETE" ? "neutral" : "warning"}>
          {humanise(row.status)}
        </StatusChip>
      ),
    },
  ];

  return (
    <ContentCard
      title={`Participants · ${roster.length}`}
      actions={
        exceptions > 0 ? (
          <StatusChip tone="warning">{exceptions} not complete</StatusChip>
        ) : undefined
      }
      flush
    >
      {loading ? (
        <LoadingState rows={5} label="Loading attendance" />
      ) : (
        <DataTable
          label="Registered participants"
          columns={columns}
          rows={roster}
          rowKey={(row) => row.participantRef}
          density="compact"
          empty={
            <p className="px-4 py-6 text-[13px] text-ink-muted">
              No attendance has been captured yet.
            </p>
          }
        />
      )}
    </ContentCard>
  );
}

export default EngagementDetailPage;
