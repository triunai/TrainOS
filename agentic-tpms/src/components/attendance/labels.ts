import type { StatusTone } from "@/components/kit";
import { calendarDay, clockMY } from "@/lib/dates";
import type { EvidenceTaskState, NOT_RECORDED, ReviewReason, SHEET_ISSUES } from "@/server/attendance";
import type { PhotoReason } from "@/server/extraction/photoExif";

/**
 * Server-safe vocabulary for the attendance screens (no "use client": server
 * pages and client components both import it; the domain imports are
 * type-only, so nothing server-side reaches a client bundle). Every map is
 * keyed by the domain's own type, so a new reason in the domain is a compile
 * error here. A value the map does not know is shown verbatim as
 * unrecognised (R14): it never falls through to a friendly-looking label.
 */

/** Slot-level exception reasons: attendance/records.ts REVIEW_REASONS + NOT_RECORDED. */
export const EXCEPTION_REASON = {
  LOW_CONFIDENCE: { label: "Low OCR confidence", hint: "The reading was unclear — check the paper sheet.", tone: "warning" },
  UNSIGNED: { label: "Blank on the sheet", hint: "Read as absent. An absence costs the claim for this participant, so confirm it.", tone: "warning" },
  TRACK_DISAGREEMENT: { label: "Signed digitally, blank on paper", hint: "Track A says present, the Form T3 says absent.", tone: "danger" },
  NOT_RECORDED: { label: "Not recorded", hint: "No reading from either track. Record it by hand or re-scan.", tone: "neutral" },
} as const satisfies Record<ReviewReason | typeof NOT_RECORDED, { label: string; hint: string; tone: StatusTone }>;
export type ExceptionReason = keyof typeof EXCEPTION_REASON;

export function exceptionReason(code: string): { label: string; hint: string; tone: StatusTone; known: boolean } {
  const known = (EXCEPTION_REASON as Record<string, { label: string; hint: string; tone: StatusTone }>)[code];
  return known ? { ...known, known: true } : { label: `Unrecognised: ${code}`, hint: "The extractor raised a reason this screen does not know.", tone: "danger", known: false };
}

/** Scan-level findings: attendance/records.ts SHEET_ISSUES. */
export const SHEET_ISSUE_LABEL: Record<(typeof SHEET_ISSUES)[number], string> = {
  PAGE_UNREADABLE: "Page unreadable",
  FOREIGN_PACKAGE: "Page from another package",
  DAY_OUT_OF_RANGE: "Day outside the programme",
  UNKNOWN_PARTICIPANT: "Row not on the roster",
  MISSING_SHEET_PAGES: "Sheet pages missing",
  NAME_MISMATCH: "Printed name differs",
};

/** extraction/photoExif.ts PHOTO_REASONS. */
export const PHOTO_REASON_LABEL: Record<PhotoReason, string> = {
  EXIF_MISSING: "No EXIF data",
  GPS_MISSING: "No GPS position",
  TIMESTAMP_MISSING: "No capture time",
  TOO_FAR: "Too far from the venue",
  OUTSIDE_TRAINING_DATES: "Outside the training dates",
  VENUE_UNKNOWN: "Venue has no coordinates",
  ROT_MANUAL_REVIEW: "Remote delivery — check by eye",
};

export function labelOf(map: Record<string, string>, code: string): string {
  return map[code] ?? `Unrecognised: ${code}`;
}

export const VAULT_STATUS_TONE: Record<"PENDING" | "VERIFIED" | "FLAGGED", StatusTone> = {
  PENDING: "warning",
  VERIFIED: "success",
  FLAGGED: "danger",
};

export function vaultTone(status: string): StatusTone {
  return (VAULT_STATUS_TONE as Record<string, StatusTone>)[status] ?? "danger";
}

/** task_queue statuses, as the operator reads them beside a scan or a photo. */
export const TASK_STATUS_LABEL: Record<EvidenceTaskState["status"], { label: string; tone: StatusTone }> = {
  QUEUED: { label: "queued for the worker", tone: "info" },
  PROCESSING: { label: "reading now", tone: "info" },
  COMPLETED: { label: "read", tone: "neutral" },
  FAILED: { label: "failed", tone: "danger" },
};

export const SESSION_LABEL: Record<"AM" | "PM", string> = { AM: "Morning (AM)", PM: "Afternoon (PM)" };

/** `Sat 26 Sep` for a `YYYY-MM-DD` training date (Malaysia calendar day); hydration-safe. */
export const dayLabel = calendarDay;

/** `09:31` in Malaysia time for an instant; hydration-safe. */
export const timeMY = clockMY;
