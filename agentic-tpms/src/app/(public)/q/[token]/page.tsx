import { PublicProblem } from "@/components/attendance/PublicProblem";
import { QuizForm } from "@/components/attendance/QuizForm";
import { assessmentKindForPurpose, getQuiz } from "@/server/assessments";
import { verifyQuizToken } from "@/server/attendance";
import { isDomainError } from "@/server/domain/errors";
import { submitQuizAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assessment", robots: { index: false, follow: false } };

/** `/q/<jwt>` — the pre- or post-assessment, whichever the link was issued for. */
export default async function QuizPage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  try {
    const claims = await verifyQuizToken(token);
    const quiz = await getQuiz(claims.packageId, claims.participantId as string, assessmentKindForPurpose(claims.purpose));
    return (
      <QuizForm
        token={token}
        submit={submitQuizAction}
        quiz={{
          kind: quiz.kind,
          participantName: quiz.participantName,
          programmeTitle: quiz.programmeTitle,
          quizVersion: quiz.quizVersion,
          questionCount: quiz.questionCount,
          status: quiz.status,
          submitted: quiz.submitted,
          questions: quiz.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })),
        }}
      />
    );
  } catch (error) {
    if (isDomainError(error)) return <PublicProblem code={error.code} details={error.details} heading="Assessment" />;
    throw error;
  }
}
