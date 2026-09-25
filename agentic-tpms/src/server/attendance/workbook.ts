import { shortDay } from "@/lib/dates";
import type { AttendanceMatrix, MatrixCell } from "./ingestT3";

/**
 * The attendance exception grid as a Univer workbook snapshot (IWorkbookData
 * shape), built from `attendanceMatrix` — participants down, day × AM/PM
 * across. Pure data: the browser canvas (`UniverSheet`) renders it read-only
 * and paints `flaggedCells`; nothing is computed in the sheet, so what the
 * operator sees is exactly the effective state the database holds.
 *
 * Cell vocabulary (also rendered as the legend):
 *   ✓ / ✗   present / absent (the effective record: override > OCR > digital)
 *   A B M   Track A digital · Track B OCR (with its confidence) · manual override
 *   —       nothing recorded
 *   ⚑       an open review on the slot (also painted as a flagged cell)
 */
export const ATTENDANCE_SHEET_ID = "attendance";
export const ATTENDANCE_WORKBOOK_ID = "tpms-attendance";

export const TRACK_LETTER: Record<NonNullable<MatrixCell["track"]>, string> = {
  A_DIGITAL: "A",
  B_OCR: "B",
  MANUAL_OVERRIDE: "M",
};

export interface AttendanceWorkbook {
  snapshot: Record<string, unknown>;
  /** A1 addresses of slots with an open review. */
  flaggedCells: string[];
  /** `${participantId}:${dayIndex}:${session}` -> A1 address, so a list can point at the grid. */
  cellOf: Record<string, string>;
  rows: number;
  columns: number;
}

/** `25 Sep` from `2026-09-25`; the fixed-word formatters live together in lib/dates. */
export { shortDay };

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** The text a slot shows on the grid. */
export function cellText(cell: MatrixCell): string {
  const flag = cell.needsReview ? "⚑ " : "";
  if (cell.present === null || cell.track === null) return `${flag}—`;
  const mark = cell.present ? "✓" : "✗";
  const letter = TRACK_LETTER[cell.track];
  if (letter === undefined) throw new Error(`Unknown attendance track ${String(cell.track)}`);
  const confidence = cell.track === "B_OCR" && cell.confidence !== null ? ` ${Math.round(cell.confidence * 100)}%` : "";
  return `${flag}${mark} ${letter}${confidence}`;
}

export function buildAttendanceWorkbook(matrix: AttendanceMatrix): AttendanceWorkbook {
  // Name, rate and eligibility stay frozen on the left; the slots scroll; the masked NRIC closes the row.
  const firstSlotColumn = 3;
  const slotColumns = matrix.durationDays * 2;
  const nricColumn = firstSlotColumn + slotColumns;
  const columns = nricColumn + 1;
  const header: Record<number, Record<string, unknown>> = {
    0: { v: "Participant", s: "hd" },
    1: { v: "Rate", s: "hd" },
    2: { v: "≥ 80%", s: "hd" },
    [nricColumn]: { v: "NRIC", s: "hd" },
  };
  for (let day = 1; day <= matrix.durationDays; day += 1) {
    const date = matrix.dates[day - 1];
    const suffix = date ? ` · ${shortDay(date)}` : "";
    header[firstSlotColumn + (day - 1) * 2] = { v: `D${day} AM${suffix}`, s: "hd" };
    header[firstSlotColumn + (day - 1) * 2 + 1] = { v: `D${day} PM`, s: "hd" };
  }
  const cellData: Record<number, Record<number, Record<string, unknown>>> = { 0: header };
  const flaggedCells: string[] = [];
  const cellOf: Record<string, string> = {};

  matrix.participants.forEach((p, i) => {
    const r = i + 1;
    const row: Record<number, Record<string, unknown>> = {
      0: { v: p.name },
      1: { v: `${Number(p.attendanceRate).toFixed(0)}%`, s: "ct" },
      2: { v: p.eligible ? "claimable" : "not yet", s: "ct" },
      [nricColumn]: { v: p.nricMasked, s: "mono" },
    };
    for (const cell of p.cells) {
      const c = firstSlotColumn + (cell.dayIndex - 1) * 2 + (cell.session === "AM" ? 0 : 1);
      const address = `${columnLetter(c)}${r + 1}`;
      row[c] = { v: cellText(cell), s: "ct" };
      cellOf[`${p.id}:${cell.dayIndex}:${cell.session}`] = address;
      if (cell.needsReview) flaggedCells.push(address);
    }
    cellData[r] = row;
  });

  const columnData: Record<number, { w: number }> = { 0: { w: 200 }, 1: { w: 56 }, 2: { w: 76 }, [nricColumn]: { w: 124 } };
  for (let c = firstSlotColumn; c < nricColumn; c += 1) columnData[c] = { w: (c - firstSlotColumn) % 2 === 0 ? 122 : 92 };

  const snapshot = {
    id: ATTENDANCE_WORKBOOK_ID,
    name: `${matrix.packageCode} attendance`,
    appVersion: "1.0.2",
    locale: "enUS",
    styles: {
      hd: { bl: 1, ht: 2 },
      ct: { ht: 2 },
      mono: { ff: "JetBrains Mono" },
    },
    sheetOrder: [ATTENDANCE_SHEET_ID],
    sheets: {
      [ATTENDANCE_SHEET_ID]: {
        id: ATTENDANCE_SHEET_ID,
        name: "Attendance",
        rowCount: matrix.participants.length + 1,
        columnCount: columns,
        cellData,
        columnData,
        defaultRowHeight: 24,
        freeze: { xSplit: 3, ySplit: 1, startRow: 1, startColumn: 3 },
      },
    },
    resources: [],
  };
  return { snapshot, flaggedCells, cellOf, rows: matrix.participants.length + 1, columns };
}
