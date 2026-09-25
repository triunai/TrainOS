"use client";

import { PublicProblem } from "@/components/attendance/PublicProblem";

/** Anything unexpected on a check-in page: a friendly card, never a stack. */
export default function CheckInError() {
  return <PublicProblem code="TRANSPORT" heading="Attendance check-in" />;
}
