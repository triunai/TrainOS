import type { ClaimPacket, HrdcDeadline, RequiredDocument } from "@trainos/contract";
import type { StatusTone } from "@/shared/components/kit";
import { hrdcDocumentLabel } from "./labels";

/**
 * The two compliance registers' models. Pure, no React.
 *
 * Both read the HRD Corp data that already exists — `GET /v1/hrdc/deadlines`
 * and `GET /v1/hrdc/packets/{engagementRef}` — rather than a documents or
 * deadlines domain of their own, which the contract does not publish.
 */

/* ------------------------------------------------------------------ *
 * Deadlines
 * ------------------------------------------------------------------ */

/**
 * The deadline's tone, from the SERVER's severity.
 *
 * Not from `daysRemaining`. The server sends `severity` because urgency is a
 * policy question — a 99-day deadline on a BLOCKED packet is a warning and a
 * 180-day one is not — and `statusTone.ts` already carries the note about
 * `Organisation360Page` having derived urgency from the day count and getting
 * it wrong. Deriving it a second time here would reintroduce exactly that.
 */
export const SEVERITY_TONE: Record<string, StatusTone> = {
  INFO: "neutral",
  WARN: "warning",
  DANGER: "danger",
  ALERT: "danger",
};

export interface DeadlineRow extends HrdcDeadline {
  id: string;
  /** Past the deadline, which `daysRemaining` reports as a negative number. */
  overdue: boolean;
  tone: StatusTone;
}

/**
 * Deadlines, soonest first.
 *
 * The brief says sorted by due date, and `deadlineAt` is the due date — sorting
 * on `daysRemaining` would agree today and diverge the moment the server sends
 * a stale count. Ties break on the engagement ref so the order is stable
 * between renders rather than depending on the array's arrival order.
 */
export function deadlineRows(deadlines: readonly HrdcDeadline[]): DeadlineRow[] {
  return [...deadlines]
    .map((deadline) => ({
      ...deadline,
      id: deadline.engagementRef,
      overdue: deadline.daysRemaining < 0,
      tone: SEVERITY_TONE[deadline.severity] ?? "neutral",
    }))
    .sort((left, right) => {
      const byDate = left.deadlineAt.localeCompare(right.deadlineAt);
      return byDate !== 0 ? byDate : left.engagementRef.localeCompare(right.engagementRef);
    });
}

/* ------------------------------------------------------------------ *
 * Documents
 * ------------------------------------------------------------------ */

export interface DocumentRow {
  /** `<engagementRef>::<type>` — a type alone repeats across packets. */
  id: string;
  engagementRef: string;
  organisationRef: string;
  packetId: string;
  packetStatus: string;
  scheme: string;
  completeness: number;
  type: string;
  label: string;
  status: string;
  reference: string | null;
  /** The server's own one-line context, e.g. `Locked 14 Nov · 28/30 present`. */
  meta: string | null;
  present: boolean;
  document: RequiredDocument;
}

/**
 * Every required document of every packet, as one register.
 *
 * The packet's own `label` wins; where the server sends none, `labels.ts`
 * supplies HRD Corp's written name for the type. A raw `TRAINER_TTT_CERT` in
 * the name column reads as machine output leaking into the UI — see the note
 * in `labels.ts`, which is a correction to this file's first version.
 *
 * `meta` is the server's own sentence and is never assembled here. What counts
 * as complete is not a frontend concern.
 */
export function documentRows(packets: readonly ClaimPacket[]): DocumentRow[] {
  return packets.flatMap((packet) =>
    packet.requiredDocuments.map((document) => ({
      id: `${packet.engagementRef}::${document.type}`,
      engagementRef: packet.engagementRef,
      organisationRef: packet.organisationRef,
      packetId: packet.id,
      packetStatus: packet.status,
      scheme: packet.scheme,
      completeness: packet.completeness,
      type: document.type,
      label: document.label ?? hrdcDocumentLabel(document.type),
      status: document.status,
      reference: document.ref ?? null,
      meta: document.meta ?? null,
      present: document.status === "PRESENT",
      document,
    })),
  );
}

/** Missing first, then by packet, then by the packet's own document order. */
export function byUrgency(rows: readonly DocumentRow[]): DocumentRow[] {
  return [...rows].sort((left, right) => {
    if (left.present !== right.present) return left.present ? 1 : -1;
    return left.engagementRef.localeCompare(right.engagementRef);
  });
}
