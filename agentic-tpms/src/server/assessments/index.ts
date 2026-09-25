/**
 * Public surface of the Kirkpatrick assessment engine. Callers (the `/q/[token]`
 * quiz page, the package screen, the claim/executive packs) import from here.
 */
export {
  QUESTIONS_PER_BANK,
  OPTIONS_PER_QUESTION,
  QUIZ_AGENT,
  seedQuizBanks,
  ensureQuizBank,
  loadQuizBank,
  quizVersion,
  templateQuestions,
  type QuizBank,
  type SeedResult,
  type CourseForQuiz,
} from "./bank";
export {
  ASSESSMENT_KINDS,
  assertAssessmentKind,
  assessmentKindForPurpose,
  getQuiz,
  submitAssessment,
  type AssessmentKind,
  type QuizView,
  type QuizQuestionView,
  type SubmitAssessmentInput,
  type SubmitAssessmentResult,
} from "./service";
export {
  SCORE_BANDS,
  cohortReport,
  renderKirkpatrickReportPdf,
  type CohortReport,
  type CohortParticipantRow,
  type KirkpatrickReportResult,
} from "./report";
export { handlers } from "./tasks";
