"use client";

import { PublicProblem } from "@/components/attendance/PublicProblem";

/** Anything unexpected on a quiz page: a friendly card, never a stack. */
export default function QuizError() {
  return <PublicProblem code="TRANSPORT" heading="Assessment" />;
}
