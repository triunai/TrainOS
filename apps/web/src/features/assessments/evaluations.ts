import type { Engagement } from "@trainos/contract";
import type { StatusTone } from "@/shared/components/kit";

/**
 * Post-course evaluation, per delivery.
 *
 * WHAT THIS SCREEN IS, AND WHY IT IS NOT SOMETHING ELSE. The contract publishes
 * no assessment domain: there is no `Assessment` type, no `/v1/assessments`
 * row in the §13 endpoint matrix, and no artboard. Inventing one would have
 * meant seeding a fixture shape the API has never agreed to, and every screen
 * built on it would be fiction the day a real endpoint arrived.
 *
 * What DOES exist is the evaluation summary: `EVALUATION_SUMMARY` is one of the
 * five `HRDCDocumentType`s the claim packet requires, and it appears on the
 * engagement's own checklist. So the assessments register answers the question
 * the product actually has to answer — which deliveries owe an evaluation
 * summary, and which are holding up a claim — from data that is really there.
 * The gap is reported rather than papered over.
 *
 * A leaf module: pure, no React.
 */

/** The checklist key the engagement records this against. */
export const EVALUATION_KEY = "EVALUATION_SUMMARY";

/**
 * Four states, not two.
 *
 * `UNTRACKED` exists because most engagements in the seed carry NO
 * `EVALUATION_SUMMARY` checklist item at all, and an absent item is not the
 * same fact as an unticked one. Collapsing the two would report a delivery
 * nobody has set up for evaluation as merely overdue, which sends Operations
 * chasing a box that does not exist. R14's principle in a read: an unrecognised
 * shape gets its own answer rather than falling into whichever branch is the
 * `else`.
 */
export type EvaluationState = "COMPILED" | "OUTSTANDING" | "NOT_DUE" | "UNTRACKED";

export interface AssessmentRow {
  id: string;
  engagementRef: string;
  organisationRef: string;
  programmeRef: string;
  title: string;
  engagementStatus: string;
  /** The last delivery day, which is when an evaluation becomes due. */
  deliveredOn: string | null;
  participants: number;
  attended: number;
  attendanceRate: number;
  state: EvaluationState;
  label: string;
  tone: StatusTone;
}

const LABEL: Record<EvaluationState, string> = {
  COMPILED: "Compiled",
  OUTSTANDING: "Outstanding",
  NOT_DUE: "Not due",
  UNTRACKED: "Not tracked",
};

const TONE: Record<EvaluationState, StatusTone> = {
  COMPILED: "success",
  OUTSTANDING: "warning",
  NOT_DUE: "neutral",
  UNTRACKED: "danger",
};

export function evaluationStateOf(engagement: Engagement, today: string): EvaluationState {
  const item = engagement.checklist.find((entry) => entry.key === EVALUATION_KEY);
  if (item?.done) return "COMPILED";

  /* A cancelled delivery never happened, so nothing is owed for it. */
  if (engagement.status === "CANCELLED") return "NOT_DUE";

  const last = [...engagement.dates].sort().at(-1) ?? null;
  if (last === null || last > today) return "NOT_DUE";

  return item === undefined ? "UNTRACKED" : "OUTSTANDING";
}

export function assessmentRows(engagements: readonly Engagement[], today: string): AssessmentRow[] {
  return (
    engagements
      .map((engagement) => {
        const state = evaluationStateOf(engagement, today);
        return {
          id: engagement.ref,
          engagementRef: engagement.ref,
          organisationRef: engagement.organisationRef,
          programmeRef: engagement.programmeRef,
          title: engagement.title,
          engagementStatus: engagement.status,
          deliveredOn: [...engagement.dates].sort().at(-1) ?? null,
          participants: engagement.metrics.participants,
          attended: engagement.metrics.attended,
          attendanceRate: engagement.metrics.attendanceRate,
          state,
          label: LABEL[state],
          tone: TONE[state],
        };
      })
      /* Outstanding and untracked first, then by delivery date, newest first: the
       reader came for what is owed, not for a chronology. */
      .sort((left, right) => {
        const weight = (row: AssessmentRow) =>
          row.state === "UNTRACKED" ? 0 : row.state === "OUTSTANDING" ? 1 : 2;
        const byState = weight(left) - weight(right);
        if (byState !== 0) return byState;
        return (right.deliveredOn ?? "").localeCompare(left.deliveredOn ?? "");
      })
  );
}

/** How many rows sit in each state, for the toolbar's counts. */
export function countByState(rows: readonly AssessmentRow[]): Record<EvaluationState, number> {
  return rows.reduce((totals, row) => ({ ...totals, [row.state]: totals[row.state] + 1 }), {
    COMPILED: 0,
    OUTSTANDING: 0,
    NOT_DUE: 0,
    UNTRACKED: 0,
  });
}
