"use server";

import { assessmentKindForPurpose, submitAssessment } from "@/server/assessments";
import { verifyQuizToken } from "@/server/attendance";
import { publicAct } from "../c/_lib/publicAct";

/**
 * Submit a pre/post quiz. The package, participant and sitting come from the
 * re-verified token, never from the client; the answer key never leaves the
 * server (submitAssessment maps displayed option indices back itself).
 */
export async function submitQuizAction(token: string, answers: Array<{ questionId: string; optionIndex: number }>, quizVersion: string, rating: number | null) {
  return publicAct(async () => {
    const claims = await verifyQuizToken(String(token));
    const kind = assessmentKindForPurpose(claims.purpose);
    const result = await submitAssessment({
      packageId: claims.packageId,
      participantId: claims.participantId as string,
      kind,
      answers: Array.isArray(answers) ? answers.map((a) => ({ questionId: String(a.questionId), optionIndex: Number(a.optionIndex) })) : [],
      quizVersion: String(quizVersion),
      reaction: kind === "POST" && typeof rating === "number" ? { rating } : undefined,
    });
    return { kind: result.kind, score: result.score, correct: result.correct, total: result.total, delta: result.delta, submittedAt: result.submittedAt };
  });
}
