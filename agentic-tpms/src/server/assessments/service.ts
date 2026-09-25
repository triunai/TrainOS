import { sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Executor, type Tx, db, one, rows, withTx } from "../db/client";
import { DomainError } from "../domain/errors";
import { type QuizBank, ensureQuizBank, quizVersion } from "./bank";
import { permutation } from "./shuffle";

/**
 * Request-driven Level 2 assessment: the public quiz page (`/q/[token]`)
 * resolves its magic link to (packageId, participantId, kind) and calls
 * `getQuiz` to render and `submitAssessment` to score.
 *
 * The answer key never leaves the server: participants get a per-sitting
 * arrangement (question order and option order seeded by bank + participant +
 * kind), submit DISPLAYED option indices, and the server re-derives the same
 * arrangement to map them back to the canonical key. No per-question feedback
 * is returned — PRE feedback would hand the participant the POST key.
 */
export const ASSESSMENT_KINDS = ["PRE", "POST"] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export const ASSESSMENT_ACTOR: Actor = { type: "SYSTEM", id: "sys_assessment_engine" };

/** R14: an unknown sitting is an error, never a default. */
export function assertAssessmentKind(value: string): AssessmentKind {
  if (!(ASSESSMENT_KINDS as readonly string[]).includes(value)) {
    throw new DomainError("UNKNOWN_ASSESSMENT_KIND", `Unknown assessment kind: ${value}`);
  }
  return value as AssessmentKind;
}

/** Magic-link purpose → sitting. Any other purpose is not a quiz link. */
export function assessmentKindForPurpose(purpose: string): AssessmentKind {
  if (purpose === "QUIZ_PRE") return "PRE";
  if (purpose === "QUIZ_POST") return "POST";
  throw new DomainError("NOT_A_QUIZ_LINK", `Magic-link purpose ${purpose} is not a quiz`);
}

export interface QuizQuestionView {
  id: string;
  prompt: string;
  options: string[];
}

export interface QuizView {
  packageId: string;
  participantId: string;
  participantName: string;
  kind: AssessmentKind;
  programmeTitle: string;
  quizVersion: string;
  questionCount: number;
  /** OPEN: answer now. SUBMITTED: this sitting is done. CLOSED: PRE after the POST exists. */
  status: "OPEN" | "SUBMITTED" | "CLOSED";
  submitted: { score: number; submittedAt: string } | null;
  /** Empty unless `status` is OPEN. Never carries the answer key. */
  questions: QuizQuestionView[];
}

interface Arrangement {
  questions: QuizQuestionView[];
  /** questionId → perm where perm[displayedIndex] = canonicalIndex */
  optionMaps: Map<string, number[]>;
}

export function arrangeQuiz(bank: Pick<QuizBank, "id" | "questions">, participantId: string, kind: AssessmentKind): Arrangement {
  const seed = `${bank.id}|${participantId}|${kind}`;
  const order = permutation(bank.questions.length, `${seed}|order`);
  const optionMaps = new Map<string, number[]>();
  const questions = order.map((index) => {
    const q = bank.questions[index];
    const perm = permutation(q.options.length, `${seed}|${q.id}`);
    optionMaps.set(q.id, perm);
    return { id: q.id, prompt: q.prompt, options: perm.map((ci) => q.options[ci]) };
  });
  return { questions, optionMaps };
}

// ------------------------------------------------------------------ loading

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParticipantContext {
  participant_id: string;
  package_id: string;
  full_name: string;
  registration_status: string;
  course_id: string | null;
  operational_stage: string;
  package_title: string;
}

async function loadContext(executor: Executor, packageId: string, participantId: string, lock: boolean): Promise<ParticipantContext> {
  if (!UUID.test(packageId) || !UUID.test(participantId)) {
    throw new DomainError("PARTICIPANT_NOT_FOUND", "Participant not found for this package");
  }
  if (lock) {
    // Serialises concurrent submissions for one participant, so the
    // PRE-after-POST rule cannot be raced.
    await executor.execute(sql`select id from tpms.package_participants where id = ${participantId}::uuid for update`);
  }
  const ctx = await one<ParticipantContext>(
    executor,
    sql`select p.id as participant_id, p.package_id, p.full_name, p.registration_status,
               pk.course_id, pk.operational_stage, pk.title as package_title
          from tpms.package_participants p
          join tpms.training_packages pk on pk.id = p.package_id
         where p.id = ${participantId}::uuid and p.package_id = ${packageId}::uuid`,
  );
  if (!ctx) throw new DomainError("PARTICIPANT_NOT_FOUND", "Participant not found for this package");
  if (ctx.registration_status === "WITHDRAWN") {
    throw new DomainError("PARTICIPANT_WITHDRAWN", "This participant has withdrawn from the programme");
  }
  if (ctx.operational_stage === "CANCELLED") {
    throw new DomainError("PACKAGE_CANCELLED", "This programme has been cancelled");
  }
  if (!ctx.course_id) {
    throw new DomainError("NO_COURSE_LINKED", "This package is not linked to a catalogue course, so it has no quiz bank");
  }
  return ctx;
}

interface ExistingSitting {
  kind: AssessmentKind;
  score: string;
  submitted_at: Date;
}

async function existingSittings(executor: Executor, participantId: string): Promise<Map<AssessmentKind, ExistingSitting>> {
  const list = await rows<ExistingSitting>(
    executor,
    sql`select kind, score, submitted_at from tpms.participant_assessments where participant_id = ${participantId}::uuid`,
  );
  return new Map(list.map((r) => [assertAssessmentKind(r.kind), r]));
}

// ------------------------------------------------------------------ getQuiz

export async function getQuiz(packageId: string, participantId: string, kind: string): Promise<QuizView> {
  const sitting = assertAssessmentKind(kind);
  const executor = db();
  const ctx = await loadContext(executor, packageId, participantId, false);
  const bank = await ensureQuizBank(executor, ctx.course_id as string);
  const done = await existingSittings(executor, participantId);
  const mine = done.get(sitting);
  const status: QuizView["status"] = mine ? "SUBMITTED" : sitting === "PRE" && done.has("POST") ? "CLOSED" : "OPEN";
  return {
    packageId,
    participantId,
    participantName: ctx.full_name,
    kind: sitting,
    programmeTitle: ctx.package_title,
    quizVersion: quizVersion(bank),
    questionCount: bank.questions.length,
    status,
    submitted: mine ? { score: Number(mine.score), submittedAt: new Date(mine.submitted_at).toISOString() } : null,
    questions: status === "OPEN" ? arrangeQuiz(bank, participantId, sitting).questions : [],
  };
}

// --------------------------------------------------------- submitAssessment

const submitSchema = z.object({
  packageId: z.string(),
  participantId: z.string(),
  kind: z.string(),
  answers: z
    .array(z.object({ questionId: z.string().min(1).max(64), optionIndex: z.number().int() }))
    .max(100),
  quizVersion: z.string().max(64).optional(),
  reaction: z.object({ rating: z.number().int() }).optional(),
});

export type SubmitAssessmentInput = z.input<typeof submitSchema>;

export interface SubmitAssessmentResult {
  assessmentId: string;
  kind: AssessmentKind;
  score: number;
  correct: number;
  total: number;
  submittedAt: string;
  /** POST only, when a PRE exists: post − pre in percentage points. */
  delta: number | null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

interface Scored {
  correct: number;
  total: number;
  score: number;
  answers: Array<{ questionId: string; optionIndex: number; chosen: number; correct: boolean }>;
}

export function scoreAnswers(bank: Pick<QuizBank, "id" | "questions">, participantId: string, kind: AssessmentKind, answers: Array<{ questionId: string; optionIndex: number }>): Scored {
  if (answers.length === 0) throw new DomainError("EMPTY_SUBMISSION", "No answers were submitted");
  const { optionMaps } = arrangeQuiz(bank, participantId, kind);
  const key = new Map(bank.questions.map((q) => [q.id, q.answerIndex]));
  const seen = new Set<string>();
  const scored = answers.map((a) => {
    const perm = optionMaps.get(a.questionId);
    if (!perm) throw new DomainError("UNKNOWN_QUESTION", `Question ${a.questionId} is not in this quiz`, { questionId: a.questionId });
    if (seen.has(a.questionId)) throw new DomainError("DUPLICATE_ANSWER", `Question ${a.questionId} was answered twice`, { questionId: a.questionId });
    seen.add(a.questionId);
    if (a.optionIndex < 0 || a.optionIndex >= perm.length) {
      throw new DomainError("INVALID_OPTION", `Option ${a.optionIndex} does not exist for question ${a.questionId}`, { questionId: a.questionId });
    }
    const chosen = perm[a.optionIndex];
    return { questionId: a.questionId, optionIndex: a.optionIndex, chosen, correct: chosen === key.get(a.questionId) };
  });
  const correct = scored.filter((s) => s.correct).length;
  const total = bank.questions.length;
  // Unanswered questions count as wrong: the denominator is the bank, not the submission.
  return { correct, total, score: round2((correct / total) * 100), answers: scored };
}

export async function submitAssessment(input: SubmitAssessmentInput): Promise<SubmitAssessmentResult> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("INVALID_SUBMISSION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const { packageId, participantId, answers, reaction } = parsed.data;
  const kind = assertAssessmentKind(parsed.data.kind);
  if (reaction && (kind !== "POST" || reaction.rating < 1 || reaction.rating > 5)) {
    throw new DomainError("INVALID_REACTION", "A reaction rating (1–5) is captured with the post-assessment only");
  }

  return withTx(ASSESSMENT_ACTOR, { reasonCode: "ASSESSMENT_SUBMITTED", reasonDetails: "Self-submitted via quiz link" }, async (tx: Tx) => {
    const ctx = await loadContext(tx, packageId, participantId, true);
    const done = await existingSittings(tx, participantId);
    if (done.has(kind)) throw new DomainError("ALREADY_SUBMITTED", `The ${kind} assessment has already been submitted`);
    if (kind === "PRE" && done.has("POST")) {
      throw new DomainError("PRE_AFTER_POST", "The pre-assessment cannot be taken after the post-assessment");
    }

    const bank = await ensureQuizBank(tx, ctx.course_id as string);
    const version = quizVersion(bank);
    if (parsed.data.quizVersion && parsed.data.quizVersion !== version) {
      throw new DomainError("QUIZ_VERSION_MISMATCH", "The quiz changed after it was opened; reload and try again");
    }
    const scored = scoreAnswers(bank, participantId, kind, answers);

    const [inserted] = await rows<{ id: string; submitted_at: Date }>(
      tx,
      sql`insert into tpms.participant_assessments (package_id, participant_id, kind, score, answers, reaction_rating)
          values (${packageId}::uuid, ${participantId}::uuid, ${kind}, ${scored.score},
                  ${JSON.stringify(scored.answers)}::jsonb, ${reaction?.rating ?? null})
          on conflict (participant_id, kind) do nothing
          returning id, submitted_at`,
    );
    if (!inserted) throw new DomainError("ALREADY_SUBMITTED", `The ${kind} assessment has already been submitted`);

    if (kind === "PRE") {
      await tx.execute(sql`update tpms.package_participants set kirkpatrick_pre_score = ${scored.score} where id = ${participantId}::uuid`);
    } else {
      await tx.execute(sql`update tpms.package_participants set kirkpatrick_post_score = ${scored.score} where id = ${participantId}::uuid`);
    }

    await recordAudit(tx, {
      entityType: "PARTICIPANT_ASSESSMENT",
      entityId: inserted.id,
      reasonCode: "ASSESSMENT_SUBMITTED",
      details: `${kind} assessment scored ${scored.score}%`,
      metadata: { package_id: packageId, participant_id: participantId, kind, score: scored.score, quiz_version: version },
    });

    const pre = done.get("PRE");
    return {
      assessmentId: inserted.id,
      kind,
      score: scored.score,
      correct: scored.correct,
      total: scored.total,
      submittedAt: new Date(inserted.submitted_at).toISOString(),
      delta: kind === "POST" && pre ? round2(scored.score - Number(pre.score)) : null,
    };
  });
}
