import Link from "next/link";
import { AIChip, Banner, Body, DefinitionList, Field, LINK_BUTTON, MetricStrip, Section, Select, StatusChip } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { ExceptionDesk, type ExceptionItem, type UpcomingDay } from "@/components/attendance/ExceptionDesk";
import { PHOTO_REASON_LABEL, SHEET_ISSUE_LABEL, TASK_STATUS_LABEL, dayLabel, labelOf, timeMY, vaultTone } from "@/components/attendance/labels";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { UniverSheet } from "@/components/univer/UniverSheet";
import { formatDate } from "@/lib/dates";
import { plain } from "@/server/actions";
import { type EvidenceTaskState, attendanceMatrix, buildAttendanceWorkbook, evidenceTaskStates, sessionWindow, t3DaysCovered } from "@/server/attendance";
import type { VaultDocument } from "@/server/db/schema";
import { serviceHealth } from "@/server/extraction/client";
import { evaluateGuards, type GuardVerdict } from "@/server/fsm/guards";
import { TRANSITIONS } from "@/server/fsm/transitions";
import { loadPackageRecord } from "@/server/packages/record";
import { completeDeliveryAction, startDeliveryAction } from "../actions";
import { generateTemplatesAction, renderDigitalT3Action, resolveSlotsAction, simulateScanAction, uploadPhotosAction, uploadScanAction } from "./actions";

export const dynamic = "force-dynamic";

const OPEN_STAGES = new Set(["READY_FOR_EVENT", "DELIVERY_IN_PROGRESS", "DELIVERY_COMPLETED"]);
const PRE_CLAIM = new Set(["ESTIMATE", "GRANT_RESERVED", "UPFRONT_CLAIM_SUBMITTED", "CLAIM_NOT_READY"]);
const COMPLETE_RULE = TRANSITIONS.find((t) => t.reason === "DELIVERY_VERIFIED_SUCCESS");

const TRACK_NAME: Record<string, string> = { A_DIGITAL: "Track A", B_OCR: "Track B OCR", MANUAL_OVERRIDE: "Manual" };

type Meta = Record<string, unknown>;
const meta = (d: VaultDocument) => (d.extractedMetadata ?? {}) as Meta;
const newestFirst = (a: VaultDocument, b: VaultDocument) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();

function TaskChip({ task }: { task: EvidenceTaskState | undefined }) {
  if (!task || task.status === "COMPLETED") return null;
  const s = TASK_STATUS_LABEL[task.status];
  return (
    <StatusChip tone={s.tone} shape="square" className="px-2 py-[1px] text-[11px]" title={task.lastError ?? undefined}>
      {task.taskType === "attendance.ocr_t3" ? "OCR" : "EXIF check"} {s.label}
      {task.status === "FAILED" ? ` after ${task.attempts} attempt${task.attempts === 1 ? "" : "s"}` : ""}
    </StatusChip>
  );
}

function VerdictList({ verdict }: { verdict: GuardVerdict }) {
  return (
    <ul className="flex flex-col gap-1">
      {verdict.blocking.map((b) => (
        <li key={b.code} className="flex gap-1.5 text-[12px] text-ink-secondary">
          <span aria-hidden="true" className="text-danger">✕</span>
          <span className="min-w-0 flex-1">{b.message}</span>
          <span className="font-mono text-[11px] text-ink-muted">{b.code}</span>
        </li>
      ))}
      {verdict.warnings.map((w) => (
        <li key={w.code} className="flex gap-1.5 text-[12px] text-ink-secondary">
          <span aria-hidden="true" className="text-warning">!</span>
          <span className="min-w-0 flex-1">{w.message}</span>
          <span className="font-mono text-[11px] text-ink-muted">{w.code}</span>
        </li>
      ))}
      {verdict.blocking.length === 0 ? (
        <li className="flex gap-1.5 text-[12px] text-ink-secondary">
          <span aria-hidden="true" className="text-success">✓</span>
          Every blocking L0 check passes.
        </li>
      ) : null}
    </ul>
  );
}

export default async function AttendancePage({ params }: { params: { code: string } }) {
  const record = await loadPackageRecord(params.code);
  const { snapshot: s } = record;
  const p = s.pkg;
  const code = p.packageCode;
  const stage = p.operationalStage;

  if (!OPEN_STAGES.has(stage)) {
    return (
      <Body>
        <Section eyebrow="Dual-track attendance" title="Attendance opens when the package is ready for the event">
          <div className="flex flex-col gap-2 text-[13px] text-ink-secondary">
            <p>
              Once the T-14 viability check passes, this desk issues the Form T3 register for each day, reads scanned sheets with the L2 extractor, collects Track A e-signatures from the participants&apos; own phones and checks session photos against the venue and the training dates.
            </p>
            <p>
              The package is at <span className="font-medium text-ink">{stage.toLowerCase().replace(/_/g, " ")}</span>. Participant links and the room QR are on the{" "}
              <Link href={`/operations/${code}/participants`} className="text-primary-hover hover:underline">
                Participants
              </Link>{" "}
              tab.
            </p>
          </div>
        </Section>
      </Body>
    );
  }

  const [matrix, tasks, health] = await Promise.all([
    attendanceMatrix(p.id).then(plain),
    evidenceTaskStates(p.id),
    serviceHealth().then(
      (h) => ({ ok: true as const, dev: Boolean(h.dev), engine: h.engines.paddleocr ? "PaddleOCR + template grid" : "template grid (OpenCV)" }),
      (e: unknown) => ({ ok: false as const, dev: false, error: e instanceof Error ? e.message : String(e) }),
    ),
  ]);
  const book = buildAttendanceWorkbook(matrix);
  const editable = PRE_CLAIM.has(p.financialStage);
  const today = s.today;
  const days = Array.from({ length: matrix.durationDays }, (_, i) => ({ dayIndex: i + 1, date: matrix.dates[i] ?? null }));

  // ---- exceptions: open reviews on any day; an unrecorded slot only once its check-in window has closed
  const now = new Date();
  const items: ExceptionItem[] = [];
  const upcomingMissing = new Map<string, { dayIndex: number; session: "AM" | "PM"; slots: number }>();
  for (const participant of matrix.participants) {
    for (const cell of participant.cells) {
      const date = matrix.dates[cell.dayIndex - 1] ?? null;
      const held = date !== null && sessionWindow(date, cell.session).closesAt.getTime() <= now.getTime();
      const base = {
        key: `${participant.id}:${cell.dayIndex}:${cell.session}`,
        participantId: participant.id,
        participantName: participant.name,
        nricMasked: participant.nricMasked,
        dayIndex: cell.dayIndex,
        session: cell.session,
        dateLabel: date ? dayLabel(date) : "—",
        cell: book.cellOf[`${participant.id}:${cell.dayIndex}:${cell.session}`] ?? null,
        readings: (Object.entries(cell.tracks) as Array<[string, boolean]>).map(([track, present]) => ({
          track: (track === "A_DIGITAL" ? "A" : track === "B_OCR" ? "B" : "M") as "A" | "B" | "M",
          present,
        })),
      };
      if (cell.needsReview) {
        items.push({ ...base, reasons: [...new Set(cell.reviewReasons)], recordIds: cell.openRecordIds, confidence: cell.confidence });
      } else if (cell.present === null && held) {
        items.push({ ...base, reasons: ["NOT_RECORDED"], recordIds: [], confidence: null });
      } else if (cell.present === null) {
        const key = `${cell.dayIndex}:${cell.session}`;
        const entry = upcomingMissing.get(key) ?? { dayIndex: cell.dayIndex, session: cell.session, slots: 0 };
        entry.slots += 1;
        upcomingMissing.set(key, entry);
      }
    }
  }
  const upcoming: UpcomingDay[] = [...upcomingMissing.values()]
    .sort((a, b) => a.dayIndex - b.dayIndex || a.session.localeCompare(b.session))
    .map((u) => {
      const date = matrix.dates[u.dayIndex - 1];
      const window = date ? sessionWindow(date, u.session) : null;
      const openNow = window !== null && window.opensAt.getTime() <= now.getTime();
      return {
        key: `${u.dayIndex}:${u.session}`,
        label: `Day ${u.dayIndex} ${u.session}${date ? ` · ${dayLabel(date)}` : ""}`,
        detail: openNow
          ? `check-in open until ${timeMY(window.closesAt)} — ${u.slots} not signed yet`
          : window
            ? `opens ${timeMY(window.opensAt)} — ${u.slots} slots to record`
            : `${u.slots} slots to record`,
      };
    });
  const reviewCount = items.filter((i) => i.recordIds.length > 0).length;
  const unrecordedCount = items.length - reviewCount;

  // ---- evidence in the vault
  const templates = s.vault.filter((d) => d.documentType === "FORM_T3_TEMPLATE").sort(newestFirst);
  const t3Docs = s.vault.filter((d) => d.documentType === "FORM_T3").sort(newestFirst);
  const photos = s.vault.filter((d) => d.documentType === "PHOTO_EVIDENCE").sort(newestFirst);
  const flaggedPhotos = photos.filter((d) => d.verificationStatus === "FLAGGED").length;
  const verifiedPhotos = photos.filter((d) => d.verificationStatus === "VERIFIED").length;
  const rosterOrder = matrix.participants.map((x) => x.id).join(",");
  const signedDigitally = (day: number) => matrix.participants.some((x) => x.cells.some((c) => c.dayIndex === day && c.tracks.A_DIGITAL === true));
  const canUpload = OPEN_STAGES.has(stage);

  // ---- readiness: the DELIVERY_VERIFIED_SUCCESS guard, live or projected
  const startMove = record.nextOps.find((m) => m.rule.reason === "DELIVERY_STARTED");
  const completeMove = record.nextOps.find((m) => m.rule.reason === "DELIVERY_VERIFIED_SUCCESS");
  const completion: GuardVerdict | null =
    completeMove?.verdict ??
    (stage === "READY_FOR_EVENT" && COMPLETE_RULE ? evaluateGuards({ ...s, pkg: { ...p, operationalStage: "DELIVERY_COMPLETED" } }, COMPLETE_RULE, "USER") : null);
  const pendingT3 = record.pendingDecisions.filter((d) => d.gate === "ATTENDANCE_EXCEPTION");

  const dayOptions = days.map((d) => (
    <option key={d.dayIndex} value={d.dayIndex}>
      Day {d.dayIndex}
      {d.date ? ` · ${dayLabel(d.date)}` : ""}
    </option>
  ));
  const defaultDay = String(days.find((d) => d.date === today)?.dayIndex ?? days.filter((d) => d.date && d.date < today).pop()?.dayIndex ?? 1);

  return (
    <Body>
      {pendingT3.map((d) => (
        <Banner
          key={d.id}
          tone="warning"
          // The decision's title keeps the count it was first raised with; the summary is refreshed on every settle.
          title={`Form T3 Day ${String((d.payload as { dayIndex?: number }).dayIndex ?? "?")}: exceptions await review`}
          actions={
            <Link href={`/decisions/${d.id}`} className={LINK_BUTTON.ghost}>
              Decision ›
            </Link>
          }
        >
          {d.summary}
        </Banner>
      ))}
      {!health.ok ? (
        <Banner tone="neutral" title="The extraction service is not answering">
          Scans and photos are still stored and queued; the L2 extractor reads them once the service is back. <span className="font-mono text-[11px]">{health.error}</span>
        </Banner>
      ) : null}

      <MetricStrip
        bare
        cells={[
          {
            label: "Slots recorded",
            value: `${matrix.totals.recorded} / ${matrix.totals.slots}`,
            bar: matrix.totals.slots ? matrix.totals.recorded / matrix.totals.slots : 0,
            barState: matrix.totals.missing === 0 ? "success" : "neutral",
            sub: `${matrix.totals.missing} not recorded · ${matrix.durationDays} day${matrix.durationDays === 1 ? "" : "s"} × AM/PM`,
          },
          { label: "Eligible participants", value: `${s.participants.eligible} / ${s.participants.active}`, sub: "at ≥ 80% attendance (claimable)" },
          { label: "Open exceptions", value: String(items.length), sub: `${reviewCount} to review · ${unrecordedCount} unrecorded` },
          { label: "Flagged photos", value: String(flaggedPhotos), sub: `${photos.length} uploaded · ${verifiedPhotos} verified` },
        ]}
      />

      <Section
        eyebrow="Attendance exception desk · Univer grid"
        title="Participants × day × session"
        actions={<AIChip variant="extraction" label="Paper readings by L2 extraction" />}
        flush
      >
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_370px]">
          <div className="flex min-w-0 flex-col gap-2 px-4 py-3.5">
            {matrix.participants.length === 0 ? (
              <p className="py-6 text-[13px] text-ink-muted">No active participants on the roster.</p>
            ) : (
              <>
                <p className="sr-only">The grid below is a visual summary; every slot that needs attention is listed, with its controls, beside it.</p>
                <UniverSheet snapshot={book.snapshot} flaggedCells={book.flaggedCells} readOnly height={Math.min(560, Math.max(220, 36 + book.rows * 26))} />
                <p className="text-[12px] text-ink-muted">
                  <span className="text-ink-secondary">✓</span> present · <span className="text-ink-secondary">✗</span> absent · — not recorded · <span className="font-medium text-ink-secondary">A</span> digital check-in ·{" "}
                  <span className="font-medium text-ink-secondary">B</span> Form T3 OCR (confidence) · <span className="font-medium text-ink-secondary">M</span> manual override · ⚑ needs review (tinted). Effective reading: override &gt; OCR &gt; digital.
                </p>
              </>
            )}
          </div>
          <div className="min-w-0 border-t border-divider xl:border-l xl:border-t-0">
            <p className="border-b border-divider px-4 py-2.5 text-[13px] font-semibold text-ink">
              {items.length === 0 ? "No open exceptions" : `${items.length} slot${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} a human`}
            </p>
            <ExceptionDesk code={code} items={items} upcoming={upcoming} resolve={resolveSlotsAction} readOnly={!editable} />
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            eyebrow="Track B · paper register"
            title="Form PSMB/SBL-KHAS/T3/01"
            flush
            actions={
              <>
                <ActionButton action={generateTemplatesAction} args={[code]} label={templates.length ? "Regenerate templates" : "Generate templates"} kind="ghost" />
                {canUpload ? (
                  <FormDrawer trigger="Upload scan" title="Upload a scanned Form T3" subtitle="PDF, PNG, JPEG, TIFF or WebP · up to 25 MB" action={uploadScanAction} submitLabel="Upload and read">
                    <input type="hidden" name="code" value={code} />
                    <Field label="Training day">
                      <Select name="dayIndex" defaultValue={defaultDay}>
                        {dayOptions}
                      </Select>
                    </Field>
                    <Field label="Scanned sheet" hint="Every page of the day's register in one file. The QR on each page tells the reader which rows are which.">
                      <input name="scan" type="file" accept="application/pdf,image/png,image/jpeg,image/tiff,image/webp" required className="text-[13px]" />
                    </Field>
                    <p className="text-[12px] text-ink-muted">The file is stored content-addressed and the L2 extractor reads it on the worker. Unclear or blank cells come back to the exception desk; a clean sheet is verified automatically.</p>
                  </FormDrawer>
                ) : null}
                {canUpload && health.ok && health.dev ? (
                  <FormDrawer trigger="Simulate a filled scan" triggerKind="ghost" title="Simulate a filled scan" subtitle="Dev only · the extraction service renders a synthetic scan of the day's template" action={simulateScanAction} submitLabel="Simulate and upload">
                    <input type="hidden" name="code" value={code} />
                    <Field label="Training day">
                      <Select name="dayIndex" defaultValue={defaultDay}>
                        {dayOptions}
                      </Select>
                    </Field>
                    <Field label="Sheet" hint="Uploaded through the real path: vault, task queue, OCR, exceptions.">
                      <Select name="variant" defaultValue="realistic">
                        <option value="realistic">Realistic — one blank cell and one faint signature per page</option>
                        <option value="clean">Clean re-scan — every cell signed</option>
                      </Select>
                    </Field>
                    <Banner tone="info" title="Not evidence">
                      A simulated sheet is for demonstrating the OCR path. It lands in the vault like any scan, so use it only on demo packages.
                    </Banner>
                  </FormDrawer>
                ) : null}
              </>
            }
          >
            {templates.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-muted">No templates yet. Generate the register: one A4 landscape sheet per day, with fiducials and a layout QR so a scan can be read without guessing the grid.</p>
            ) : null}
            <ul>
              {days.map((d) => {
                const template = templates.find((t) => meta(t).dayIndex === d.dayIndex);
                const stale = template && ((meta(template).participantIds as string[] | undefined) ?? []).join(",") !== rosterOrder;
                const scans = t3Docs.filter((t) => meta(t).source === "TRACK_B_SCAN" && (t3DaysCovered(meta(t)).includes(d.dayIndex) || meta(t).declaredDayIndex === d.dayIndex));
                const digital = t3Docs.filter((t) => meta(t).source === "TRACK_A" && meta(t).dayIndex === d.dayIndex);
                return (
                  <li key={d.dayIndex} className="flex flex-col gap-2 border-b border-divider px-4 py-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink">Day {d.dayIndex}</span>
                      <span className="text-[12px] text-ink-muted">{d.date ? dayLabel(d.date) : "—"}</span>
                      {template ? (
                        <a href={`/api/v1/vault/${template.id}`} target="_blank" rel="noreferrer" className="text-[12px] text-primary-hover hover:underline">
                          Blank register (PDF)
                        </a>
                      ) : null}
                      {stale ? (
                        <StatusChip tone="warning" shape="square" className="px-2 py-[1px] text-[11px]">
                          roster changed since printing
                        </StatusChip>
                      ) : null}
                      <span className="ml-auto flex items-center gap-2">
                        {digital[0] ? (
                          <a href={`/api/v1/vault/${digital[0].id}`} target="_blank" rel="noreferrer" className="text-[12px] text-primary-hover hover:underline">
                            Digital T3 · {String(meta(digital[0]).signedSlots ?? "?")} e-signatures
                          </a>
                        ) : null}
                        {signedDigitally(d.dayIndex) ? (
                          <ActionButton action={renderDigitalT3Action} args={[code, d.dayIndex]} label={digital.length ? "Recompile digital T3" : "Compile digital T3"} kind="ghost" />
                        ) : null}
                      </span>
                    </div>
                    {scans.length === 0 ? (
                      <p className="text-[12px] text-ink-muted">No scan for this day yet.</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {scans.map((scan) => {
                          const ocr = meta(scan).ocr as
                            | { status?: string; engine?: string; records?: number; present?: number; exceptions?: number; warnings?: string[]; sheetIssues?: number; error?: string }
                            | undefined;
                          return (
                            <li key={scan.id} className="flex flex-col gap-1 rounded-control bg-surface px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <a href={`/api/v1/vault/${scan.id}`} target="_blank" rel="noreferrer" className="max-w-[280px] truncate text-[13px] text-primary-hover hover:underline">
                                  {scan.fileName}
                                </a>
                                <StatusChip tone={vaultTone(scan.verificationStatus)}>{scan.verificationStatus.toLowerCase()}</StatusChip>
                                <TaskChip task={tasks.get(scan.id)} />
                                {ocr ? <AIChip variant={ocr.status === "UNREADABLE" ? "failed" : "extraction"} label={`L2 · ${ocr.engine ?? "extractor"}`} /> : null}
                                <span className="ml-auto text-[11px] text-ink-muted">{formatDate(scan.createdAt ?? null, true)}</span>
                              </div>
                              {ocr ? (
                                <p className="text-[12px] text-ink-secondary">
                                  {ocr.status === "UNREADABLE"
                                    ? `Unreadable: ${ocr.error ?? "no page of this upload matched the register"}`
                                    : `${ocr.records ?? 0} slots read · ${ocr.present ?? 0} signed · ${ocr.exceptions ?? 0} exception${ocr.exceptions === 1 ? "" : "s"} raised when read`}
                                  {ocr.sheetIssues ? ` · ${ocr.sheetIssues} sheet issue${ocr.sheetIssues === 1 ? "" : "s"}` : ""}
                                </p>
                              ) : null}
                              {ocr?.warnings?.length ? (
                                <ul className="flex flex-col gap-0.5">
                                  {ocr.warnings.map((w) => (
                                    <li key={w} className="text-[11px] text-ink-muted">
                                      {w}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              {scan.verificationNotes ? <p className="text-[11px] text-ink-muted">{scan.verificationNotes}</p> : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-divider px-4 py-2 text-[11px] text-ink-muted">
              Sheet-level findings ({Object.values(SHEET_ISSUE_LABEL).join(", ").toLowerCase()}) are listed on the day&apos;s exception decision. Extraction service: {health.ok ? `${health.engine}${health.dev ? " · dev mode" : ""}` : "unreachable"}.
            </p>
          </Section>

          <Section
            eyebrow="Evidence · EXIF GPS and capture date"
            title="Session photos"
            flush
            actions={
              canUpload ? (
                <FormDrawer trigger="Upload photos" title="Upload session photos" subtitle="JPEG, PNG, HEIC, WebP or TIFF · up to 20 MB each" action={uploadPhotosAction} submitLabel="Upload and check">
                  <input type="hidden" name="code" value={code} />
                  <Field label="Photos" hint="Original camera files: the check reads the photo's own GPS position and capture time.">
                    <input name="photos" type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,image/webp,image/tiff" required className="text-[13px]" />
                  </Field>
                  <p className="text-[12px] text-ink-muted">A photo is verified when it was taken within 1.5 km of the booked venue on a training day (Malaysia time). Anything else is flagged with its reasons for you to judge. HRD Corp expects at least two.</p>
                </FormDrawer>
              ) : null
            }
          >
            {photos.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-muted">No session photos yet. At least two are needed before delivery can be verified.</p>
            ) : (
              <ul>
                {photos.map((photo) => {
                  const m = meta(photo);
                  const reasons = Array.isArray(m.reasons) ? (m.reasons as string[]) : [];
                  const checked = Boolean(m.checkedAt);
                  return (
                    <li key={photo.id} className="flex items-start gap-3 border-b border-divider px-4 py-3 last:border-b-0">
                      <a href={`/api/v1/vault/${photo.id}`} target="_blank" rel="noreferrer" className="block h-[72px] w-24 shrink-0 overflow-hidden rounded-control border border-border bg-surface">
                        {/* eslint-disable-next-line @next/next/no-img-element -- vault bytes are served by the integrity-checking route, not next/image */}
                        <img src={`/api/v1/vault/${photo.id}`} alt={`Session photo ${photo.fileName}`} className="h-full w-full object-cover" loading="lazy" />
                      </a>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="min-w-0 truncate text-[13px] font-medium text-ink" title={photo.fileName}>
                            {photo.fileName}
                          </span>
                          <StatusChip tone={vaultTone(photo.verificationStatus)}>{photo.verificationStatus.toLowerCase()}</StatusChip>
                          <TaskChip task={tasks.get(photo.id)} />
                          {checked ? <AIChip variant="rule" label="EXIF rule · L2" className="ml-auto" /> : null}
                        </div>
                        {checked ? (
                          <p className="text-[12px] text-ink-secondary">
                            {m.takenAt ? `Taken ${formatDate(m.takenAt as string, true)}` : "No capture time"}
                            {typeof m.distanceKm === "number" ? ` · ${(m.distanceKm as number).toFixed(2)} km from ${(m.venue as { name?: string } | null)?.name ?? "the venue"}` : ""}
                          </p>
                        ) : (
                          <p className="text-[12px] text-ink-muted">EXIF check pending</p>
                        )}
                        {reasons.length ? (
                          <ul className="flex flex-wrap gap-1">
                            {reasons.map((r) => (
                              <li key={r}>
                                <StatusChip tone="danger" shape="square" className="px-2 py-[1px] text-[11px]">
                                  {labelOf(PHOTO_REASON_LABEL, r)}
                                </StatusChip>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section eyebrow="L0 guard · DELIVERY_VERIFIED_SUCCESS" title={stage === "DELIVERY_COMPLETED" ? "Delivery verified" : "What still blocks completion"}>
            <div className="flex flex-col gap-3">
              {stage === "DELIVERY_COMPLETED" ? (
                <p className="text-[13px] text-ink-secondary">
                  Delivery was verified complete; the claim collation has started on the{" "}
                  <Link href={`/operations/${code}/claims`} className="text-primary-hover hover:underline">
                    Claims &amp; AP
                  </Link>{" "}
                  tab.{editable ? " Attendance corrections here still change who is claimable until the claim is assembled." : ""}
                </p>
              ) : completion ? (
                <VerdictList verdict={completion} />
              ) : null}
              {stage === "READY_FOR_EVENT" && startMove ? (
                <div className="flex flex-col gap-2 border-t border-divider pt-3">
                  <p className="text-[12px] text-ink-secondary">Delivery has not been marked started. {startMove.verdict.warnings.map((w) => w.message).join(" ")}</p>
                  <div>
                    <ActionButton action={startDeliveryAction} args={[code]} label="Start delivery" kind="primary" disabled={startMove.verdict.blocking.length > 0} />
                  </div>
                </div>
              ) : null}
              {stage === "DELIVERY_IN_PROGRESS" && completeMove ? (
                <div>
                  <ActionButton
                    action={completeDeliveryAction}
                    args={[code]}
                    label="Complete delivery"
                    kind="primary"
                    disabled={completeMove.verdict.blocking.length > 0}
                    confirm={{
                      title: "Verify and complete delivery?",
                      body: "The operational machine moves to Delivery completed and the claim collation starts. Attendance can still be corrected until the claim is assembled.",
                      confirmLabel: "Complete delivery",
                    }}
                  />
                </div>
              ) : null}
              <DefinitionList
                items={[
                  ["Slots unrecorded", String(s.attendance.missingSlots)],
                  ["Reviews open", String(s.attendance.openReviews)],
                  ["Form T3 in vault", `${t3Docs.filter((d) => d.verificationStatus !== "FLAGGED").length} (${t3Docs.filter((d) => d.verificationStatus === "VERIFIED").length} verified)`],
                  ["Session photos", `${photos.filter((d) => d.verificationStatus !== "FLAGGED").length} usable of ${photos.length}`],
                  ["Records by track", Object.entries(s.attendance.byTrack).map(([t, n]) => `${TRACK_NAME[t] ?? t} ${n}`).join(" · ") || "none"],
                ]}
              />
            </div>
          </Section>

          <Section eyebrow="Track A · zero-login" title="Digital check-in">
            <div className="flex flex-col gap-2 text-[13px] text-ink-secondary">
              <p>
                Participants sign each session on their own phone, from their personal link or by scanning the room QR. Signatures are compiled into a digital Form T3 per day.
              </p>
              <div>
                <Link href={`/operations/${code}/participants`} className={LINK_BUTTON.secondary}>
                  Links &amp; room QR ›
                </Link>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </Body>
  );
}
