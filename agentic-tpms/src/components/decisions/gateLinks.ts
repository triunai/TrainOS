/** Where each gate is actually worked: the decision is the queue, the section page is the desk. */
export function gateHref(gate: string, packageCode: string | null, subjectRef: string): string | null {
  switch (gate) {
    case "GATE1_COMMERCIAL":
      return packageCode ? `/operations/${packageCode}/commercials` : null;
    case "GRANT_VERIFICATION":
      return packageCode ? `/operations/${packageCode}/grant` : null;
    case "GATE2_VIABILITY":
      return packageCode ? `/operations/${packageCode}/logistics` : null;
    case "ATTENDANCE_EXCEPTION":
      return packageCode ? `/operations/${packageCode}/attendance` : "/delivery/attendance";
    case "GATE3_CLAIM_REVIEW":
    case "GATE3_AP_DISBURSEMENT":
      return packageCode ? `/operations/${packageCode}/claims` : "/finance/claims";
    case "OUTBOX_BATCH":
      return `/outbox?batch=${subjectRef}`;
    case "LEAD_TRIAGE":
      return `/leads/${subjectRef}`;
    case "RETENTION_PROPOSAL":
      return "/finance/retention";
    default:
      return null;
  }
}
