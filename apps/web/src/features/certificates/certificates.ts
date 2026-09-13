import type { Engagement, Participant } from "@trainos/contract";
import type { StatusTone } from "@/shared/components/kit";

/**
 * Certificate issuance, per delivery.
 *
 * Like the assessments register next door, this is built on what the contract
 * really publishes rather than on an invented domain: `CERTIFICATES_ISSUED` is
 * a key on the engagement's checklist, and `Participant.certificateId` is the
 * per-person artefact. There is no `/v1/certificates`.
 *
 * CONSOLIDATION WARNING, deliberately left in the code. This is the SECOND
 * register keyed on an engagement checklist item — `features/assessments`
 * built the first. CLAUDE.md standardises a pattern once it appears on more
 * than two screens, so a THIRD one must promote a shared
 * `checklistState(engagement, key, today)` into the engagements feature's
 * barrel and migrate both of these in the same pass. Two is the last time
 * writing it out is the cheaper answer.
 *
 * The roll-up and the per-person record disagree in the seed: three
 * engagements report certificates issued and NO participant anywhere carries a
 * `certificateId`. That is a real gap, so the drawer says so rather than
 * rendering a blank column that reads as a loading failure.
 */

export const CERTIFICATE_KEY = "CERTIFICATES_ISSUED";

export type CertificateState = "ISSUED" | "PENDING" | "NOT_DUE" | "UNTRACKED";

export interface CertificateRow {
  id: string;
  engagementRef: string;
  organisationRef: string;
  title: string;
  engagementStatus: string;
  deliveredOn: string | null;
  participants: number;
  attended: number;
  state: CertificateState;
  label: string;
  tone: StatusTone;
}

const LABEL: Record<CertificateState, string> = {
  ISSUED: "Issued",
  PENDING: "Pending",
  NOT_DUE: "Not due",
  UNTRACKED: "Not tracked",
};

const TONE: Record<CertificateState, StatusTone> = {
  ISSUED: "success",
  PENDING: "warning",
  NOT_DUE: "neutral",
  UNTRACKED: "danger",
};

export function certificateStateOf(engagement: Engagement, today: string): CertificateState {
  const item = engagement.checklist.find((entry) => entry.key === CERTIFICATE_KEY);
  if (item?.done) return "ISSUED";

  /* Nobody earns a certificate for a delivery that was cancelled. */
  if (engagement.status === "CANCELLED") return "NOT_DUE";

  const last = [...engagement.dates].sort().at(-1) ?? null;
  if (last === null || last > today) return "NOT_DUE";

  return item === undefined ? "UNTRACKED" : "PENDING";
}

export function certificateRows(
  engagements: readonly Engagement[],
  today: string,
): CertificateRow[] {
  return engagements
    .map((engagement) => {
      const state = certificateStateOf(engagement, today);
      return {
        id: engagement.ref,
        engagementRef: engagement.ref,
        organisationRef: engagement.organisationRef,
        title: engagement.title,
        engagementStatus: engagement.status,
        deliveredOn: [...engagement.dates].sort().at(-1) ?? null,
        participants: engagement.metrics.participants,
        attended: engagement.metrics.attended,
        state,
        label: LABEL[state],
        tone: TONE[state],
      };
    })
    .sort((left, right) => {
      const weight = (row: CertificateRow) =>
        row.state === "UNTRACKED" ? 0 : row.state === "PENDING" ? 1 : 2;
      const byState = weight(left) - weight(right);
      if (byState !== 0) return byState;
      return (right.deliveredOn ?? "").localeCompare(left.deliveredOn ?? "");
    });
}

export function countByState(rows: readonly CertificateRow[]): Record<CertificateState, number> {
  return rows.reduce((totals, row) => ({ ...totals, [row.state]: totals[row.state] + 1 }), {
    ISSUED: 0,
    PENDING: 0,
    NOT_DUE: 0,
    UNTRACKED: 0,
  });
}

/**
 * What the per-participant records actually say, for the drawer.
 *
 * Separate from the roll-up on purpose: the point of opening a row is to see
 * whether the engagement's claim is backed by certificate identifiers, and a
 * function that quietly reconciled the two would destroy the answer.
 */
export interface IssuanceTally {
  registered: number;
  withCertificate: number;
  /** True when the engagement claims issuance that no participant record backs. */
  unbacked: boolean;
}

export function tallyIssuance(
  participants: readonly Participant[],
  state: CertificateState,
): IssuanceTally {
  const withCertificate = participants.filter(
    (participant) => (participant.certificateId ?? "").length > 0,
  ).length;

  return {
    registered: participants.length,
    withCertificate,
    unbacked: state === "ISSUED" && participants.length > 0 && withCertificate === 0,
  };
}
