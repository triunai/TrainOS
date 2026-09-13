import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { AttendanceRow, AttendanceSheet, CaptureMethod } from "@trainos/contract";
import {
  ActionOutcome,
  ConfirmDialog,
  ContentCard,
  DataTable,
  describeActionError,
  ErrorState,
  ExceptionBanner,
  LoadingState,
  PillTabGroup,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  formatDate,
  formatTime,
  humanise,
  toast,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import {
  asApiError,
  useAttendanceDays,
  useCaptureAttendance,
  useEngagement,
  useExportAttendance,
  usePerformAction,
} from "./api";
import { absentees, markLabel } from "./attendanceModel";

/**
 * M10-S06 · attendance capture, one AM/PM sheet per delivery day.
 *
 * The state the design pack draws is LOCKED, and the page carries NO solid
 * primary button in it: REPORT.md names M10-S06 and M07-S07 as the two
 * documented exceptions to the one-primary rule, because approved attendance is
 * immutable under HRD Corp rules and nothing may be written. Export, approve
 * and request-unlock are all secondary.
 *
 * Capture is disabled FROM THE RESPONSE. `captureModes` on the sheet is all
 * `false` once a day is approved, and the controls read that field — §8 is
 * explicit that the UI disables from the response rather than from its own
 * logic, so a screen-side lock rule would be a second, quieter source of truth
 * that drifts the first time the server's rule changes.
 *
 * The lock is one-way and it explains itself: approving an already-approved day
 * returns `409 ATTENDANCE_LOCKED`, whose details carry `unlockActionType:
 * "ATTENDANCE_UNLOCK"` — the refusal names its own escape hatch, and that is
 * what the page renders rather than a dead end.
 */
export function AttendanceCapturePage() {
  const { id = "" } = useParams<{ id: string }>();
  const [search, setSearch] = useSearchParams();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [reason, setReason] = useState("");

  const engagement = useEngagement(id);
  const days = useMemo(
    () => (engagement.data?.sessions ?? []).map((session) => session.day),
    [engagement.data],
  );
  const sheets = useAttendanceDays(id, days.length > 0 ? days : [1]);
  const action = usePerformAction();
  const exportSheet = useExportAttendance(id);

  const loaded = sheets.flatMap((query) => (query.data ? [query.data] : []));
  const requestedDay = Number(search.get("day") ?? "");
  const sheet =
    loaded.find((candidate) => candidate.day === requestedDay) ?? loaded[0] ?? undefined;

  const capture = useCaptureAttendance(id, sheet?.day ?? 1);

  /* The top bar renders the path; this screen only declares it. Attendance
     hangs off Participants, not Engagements — that is the nav entry a reader
     walked to get here. */
  useBreadcrumb([
    { label: "Home", href: "/" },
    { label: "Training", href: "/training/participants" },
    { label: "Participants", href: "/training/participants" },
    { label: `${engagement.data?.ref ?? id} attendance` },
  ]);

  if (engagement.isPending || sheets.some((query) => query.isPending)) {
    return <LoadingState rows={8} label="Loading the attendance sheet" />;
  }
  if (engagement.isError || !engagement.data) {
    return (
      <ErrorState
        title="This engagement could not be opened"
        error={asApiError(engagement.error)}
      />
    );
  }
  if (!sheet) {
    const failure = sheets.find((query) => query.isError);
    return (
      <ErrorState
        title="No attendance sheet has been created yet"
        {...(failure ? { error: asApiError(failure.error) } : {})}
      />
    );
  }

  const record = engagement.data;
  const locked = sheet.status === "LOCKED";
  const notComplete = absentees(sheet.rows);

  return (
    <div className="flex flex-col">
      <RecordHeader
        title={`Attendance · ${record.ref}`}
        meta={[
          record.title,
          record.dates.map(formatDate).join(" – "),
          record.owner.name ? `captured by ${record.owner.name}` : null,
          sheet.approvedBy?.name ? `approved by ${sheet.approvedBy.name}` : null,
        ]}
        chips={[
          <StatusChip key="lock" live tone="neutral" glyph={locked ? "🔒" : undefined}>
            {humanise(sheet.status)}
          </StatusChip>,
          ...(sheet.approvedAt
            ? [
                <StatusChip key="approved" tone="success">
                  Approved {formatDate(sheet.approvedAt)}
                </StatusChip>,
              ]
            : []),
        ]}
        /* No primaryAction, on purpose. See the file header. */
        actions={
          <>
            <SecondaryButton
              disabled={exportSheet.isPending}
              onClick={() =>
                exportSheet.mutate("HRDC", {
                  onSuccess: (result) =>
                    toast.success("HRDC sheet ready", { description: result.url }),
                })
              }
            >
              Export HRDC sheet
            </SecondaryButton>
            <SecondaryButton
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  type: "ATTENDANCE_APPROVE",
                  targetRef: record.ref,
                  payload: { day: sheet.day },
                })
              }
            >
              Approve day
            </SecondaryButton>
            <SecondaryButton onClick={() => setUnlockOpen(true)}>Request unlock</SecondaryButton>
          </>
        }
        metrics={[
          { label: "Registered", value: sheet.summary.registered },
          ...loaded.map((entry) => ({
            label: `Present day ${entry.day}`,
            value: Math.max(entry.summary.presentAm, entry.summary.presentPm),
            sub: `${Math.round(
              (Math.max(entry.summary.presentAm, entry.summary.presentPm) /
                Math.max(entry.summary.registered, 1)) *
                100,
            )}%`,
          })),
          {
            label: "Overall",
            value: `${Math.round(record.metrics.attendanceRate * 100)}%`,
            bar: record.metrics.attendanceRate,
          },
          {
            label: "Signatures",
            value: `${sheet.summary.signatures} / ${sheet.summary.signaturesExpected}`,
          },
        ]}
      />

      <div className="flex flex-col gap-5 px-5 py-5">
        {(action.data || action.error) && (
          <ActionOutcome
            {...(action.data ? { response: action.data } : {})}
            {...(action.error
              ? {
                  error: describeActionError(
                    asApiError(action.error),
                    `Day ${sheet.day} was not updated`,
                  ),
                }
              : {})}
            subject={`${record.ref} day ${sheet.day}`}
            onDismiss={() => action.reset()}
          />
        )}

        {capture.error ? (
          <ActionOutcome
            error={describeActionError(
              asApiError(capture.error),
              `Attendance on day ${sheet.day} was not captured`,
            )}
            subject={`Capture on day ${sheet.day}`}
            onDismiss={() => capture.reset()}
          />
        ) : null}

        {locked ? (
          <ExceptionBanner
            severity="INFO"
            title={`Attendance approved on ${formatDate(sheet.approvedAt)} at ${formatTime(
              sheet.approvedAt,
            )} and locked — it cannot be modified`}
            subtitle="HRD Corp requires approved attendance records to be immutable. A correction needs an unlock request, which voids and rebuilds the claim packet and is written to the audit log."
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <PillTabGroup
            label="Delivery days"
            activeId={String(sheet.day)}
            onSelect={(next) => setSearch({ day: next })}
            tabs={loaded.map((entry) => ({
              id: String(entry.day),
              label: `Day ${entry.day} · ${formatDate(entry.date)}`,
              count: Math.max(entry.summary.presentAm, entry.summary.presentPm),
            }))}
          />
          <CaptureModes sheet={sheet} />
        </div>

        <ContentCard
          title={`Day ${sheet.day} · ${formatDate(sheet.date)}`}
          actions={
            notComplete.length > 0 ? (
              <StatusChip tone="warning">{notComplete.length} not complete</StatusChip>
            ) : undefined
          }
          flush
        >
          <AttendanceTable
            sheet={sheet}
            busy={capture.isPending}
            onToggle={(row, session) =>
              capture.mutate({
                participantRef: row.participantRef,
                session,
                present: !(session === "AM" ? row.am : row.pm).present,
                method: "MANUAL" as CaptureMethod,
              })
            }
          />
          <p className="border-t border-divider px-4 py-2.5 text-[12px] text-ink-muted">
            {sheet.rows.length} registered ·{" "}
            {notComplete.length === 0
              ? "every participant present for both sessions"
              : notComplete
                  .map(
                    (row) =>
                      `${row.name} (${
                        row.am.present || row.pm.present ? "partial" : markLabel(row.am)
                      })`,
                  )
                  .join(" · ")}
          </p>
        </ContentCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <ContentCard title="HRDC attendance sheet">
            <p className="text-[13px] leading-[1.6] text-ink-secondary">
              HRD Corp format · {record.dates.length} days · signatures per AM and PM session ·
              trainer declaration signed by {record.metrics.trainer.name}.
            </p>
            <div className="flex gap-2 pt-2.5">
              <SecondaryButton
                disabled={exportSheet.isPending}
                onClick={() =>
                  exportSheet.mutate("HRDC", {
                    onSuccess: (result) =>
                      toast.success("HRDC sheet ready", { description: result.url }),
                  })
                }
              >
                Export PDF
              </SecondaryButton>
            </div>
          </ContentCard>

          <ContentCard title="Lock trail">
            {sheet.approvedBy && sheet.approvedAt ? (
              <ol className="flex flex-col gap-1.5 text-[13px] text-ink-secondary">
                <li>
                  <span className="font-mono text-[12px] text-ink">
                    {formatDate(sheet.approvedAt)} {formatTime(sheet.approvedAt)}
                  </span>{" "}
                  · approved and locked by {sheet.approvedBy.name} · immutable
                </li>
              </ol>
            ) : (
              <p className="text-[13px] text-ink-secondary">
                This day has not been approved yet, so there is nothing in the lock trail.
              </p>
            )}
          </ContentCard>
        </div>
      </div>

      <ConfirmDialog
        open={unlockOpen}
        title={`Request unlock for ${record.ref} day ${sheet.day}?`}
        description={
          <div className="flex flex-col gap-2.5">
            <p>
              Unlocking voids the claim packet and requires a fresh approval before submission. The
              request is written to the audit log and notifies Operations and Finance.
            </p>
            <ReasonField label="Reason" value={reason} onChange={setReason} />
          </div>
        }
        confirmLabel="Request unlock"
        busy={action.isPending}
        onCancel={() => setUnlockOpen(false)}
        onConfirm={() => {
          action.mutate({
            type: "ATTENDANCE_UNLOCK",
            targetRef: record.ref,
            payload: { reason: reason.trim(), day: sheet.day },
          });
          setUnlockOpen(false);
        }}
      />
    </div>
  );
}

/**
 * A labelled text input for the unlock reason.
 *
 * The kit ships no `TextField` yet — `MoneyInput` is its only input — so this
 * is styled from tokens and carries no colour of its own. Requested from the
 * `kit` agent; this collapses to `<TextField/>` when it lands. It is duplicated
 * in `features/portal` rather than imported across features, because
 * `.dependency-cruiser.cjs` forbids reaching into another feature and a shared
 * control belongs in the kit, not in a sibling screen.
 */
function ReasonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-control border border-border bg-card px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-disabled focus-visible:border-primary-border focus-visible:ring-2 focus-visible:ring-primary/30"
      />
    </label>
  );
}

/**
 * The capture modes the server says are available. All three go false once the
 * day is approved, which is what greys the strip out — the screen asserts
 * nothing of its own here.
 */
function CaptureModes({ sheet }: { sheet: AttendanceSheet }) {
  const modes: [label: string, enabled: boolean][] = [
    ["QR check-in", sheet.captureModes.qr],
    ["Signature", sheet.captureModes.signature],
    ["Manual", sheet.captureModes.manual],
  ];
  const anyEnabled = modes.some(([, enabled]) => enabled);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
        {anyEnabled ? "Capture modes" : "Capture modes disabled while locked"}
      </span>
      {modes.map(([label, enabled]) => (
        <SecondaryButton key={label} disabled={!enabled}>
          {label}
        </SecondaryButton>
      ))}
    </div>
  );
}

function AttendanceTable({
  sheet,
  busy,
  onToggle,
}: {
  sheet: AttendanceSheet;
  busy: boolean;
  onToggle: (row: AttendanceRow, session: "AM" | "PM") => void;
}) {
  const cell = (row: AttendanceRow, session: "AM" | "PM") => {
    const mark = session === "AM" ? row.am : row.pm;
    return (
      <button
        type="button"
        disabled={!sheet.captureModes.manual || busy}
        aria-label={`${row.name} ${session} · ${mark.present ? "present" : "absent"}`}
        onClick={() => onToggle(row, session)}
        className="rounded-control px-1.5 py-0.5 text-[13px] text-ink-secondary enabled:hover:bg-surface-hover disabled:cursor-default"
      >
        {markLabel(mark)}
      </button>
    );
  };

  const columns: Column<AttendanceRow>[] = [
    { key: "name", label: "Participant", accessor: (row) => row.name },
    { key: "department", label: "Department", accessor: (row) => row.department },
    { key: "am", label: "AM session", accessor: (row) => cell(row, "AM") },
    { key: "pm", label: "PM session", accessor: (row) => cell(row, "PM") },
    {
      key: "signature",
      label: "Signature",
      accessor: (row) =>
        row.signatureRef ? (
          <span className="font-mono text-[11px] text-ink-muted">{row.signatureRef}</span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
  ];

  return (
    <DataTable
      label={`Attendance for day ${sheet.day}`}
      columns={columns}
      rows={sheet.rows}
      rowKey={(row) => row.participantRef}
      density="compact"
    />
  );
}

export default AttendanceCapturePage;
