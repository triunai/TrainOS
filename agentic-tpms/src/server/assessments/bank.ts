import { sql } from "drizzle-orm";
import { z } from "zod";
import { runTier, startAgentRun, finishAgentRun, type Provenance } from "../ai";
import { type Executor, one, rows } from "../db/client";
import type { QuizQuestion } from "../db/schema";
import { DomainError } from "../domain/errors";
import { sha256Hex } from "../lib/crypto";
import { sample, shuffled } from "./shuffle";

/**
 * The quiz bank: one 10-question, 4-option MCQ bank per catalogue course,
 * shared by the PRE and POST sittings so the Level 2 delta compares like with
 * like. The canonical bank (with its answer key) lives only in
 * `tpms.quiz_banks`; participants see a per-sitting arrangement of it.
 *
 * Generation is template-first: a deterministic generator builds questions
 * from the course's learning outcomes and outline, with distractors drawn from
 * OTHER courses in the catalogue (a different focus area where possible) and
 * a fixed cross-domain pool. The L3 quiz writer may replace it with
 * model-drafted questions; anything that fails the schema or the sanity
 * checks falls back to the template, so a bank always exists.
 */
export const QUESTIONS_PER_BANK = 10;
export const OPTIONS_PER_QUESTION = 4;
export const QUIZ_AGENT = "assessments.quiz_writer";
export const TEMPLATE_GENERATOR = "outcome-template-v1";

export interface QuizBank {
  id: string;
  courseId: string;
  questions: QuizQuestion[];
  provenance: Record<string, unknown>;
}

export interface CourseForQuiz {
  id: string;
  courseCode: string;
  title: string;
  hrdFocusArea: string;
  targetSeniority: string;
  learningOutcomes: unknown;
  masterOutlineMarkdown: string;
}

type DraftQuestion = Omit<QuizQuestion, "id">;

// ------------------------------------------------------------------ parsing

interface Outcome {
  sentence: string;
  bloom: number;
}

const BLOOM_BY_VERB: Record<string, number> = {};
(
  [
    [1, "define list recall identify name state recognise recognize label match"],
    [2, "explain describe summarise summarize interpret classify discuss outline illustrate"],
    [3, "apply use demonstrate implement execute perform prepare conduct operate calculate practise practice handle"],
    [4, "analyse analyze compare differentiate examine investigate diagnose distinguish map"],
    [5, "evaluate assess justify critique judge recommend prioritise prioritize select review"],
    [6, "design create develop construct formulate plan build compose produce devise lead"],
  ] as Array<[number, string]>
).forEach(([level, verbs]) => verbs.split(" ").forEach((v) => (BLOOM_BY_VERB[v] = level)));

const BLOOM_DESCRIPTOR: Record<number, string> = {
  1: "Recall facts, terms and basic concepts",
  2: "Explain the ideas or concepts in their own words",
  3: "Use the method or procedure in a new, practical situation",
  4: "Break a situation into parts and examine how they relate",
  5: "Judge options against criteria and justify a decision",
  6: "Design or produce a new plan, product or solution",
};

const outcomeSchema = z.union([
  z.object({ verb: z.string().min(1), outcome: z.string().min(1), bloomLevel: z.coerce.number().optional() }),
  z.string().min(3),
]);

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const stripEnd = (s: string) => s.trim().replace(/[.;:]+$/, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function parseOutcomes(raw: unknown): Outcome[] {
  if (!Array.isArray(raw)) return [];
  const out: Outcome[] = [];
  for (const item of raw) {
    const parsed = outcomeSchema.safeParse(item);
    if (!parsed.success) continue;
    let verb: string;
    let rest: string;
    let bloom: number | undefined;
    if (typeof parsed.data === "string") {
      const text = stripEnd(parsed.data);
      [verb, rest] = [text.split(/\s+/)[0], text.split(/\s+/).slice(1).join(" ")];
    } else {
      verb = parsed.data.verb.trim();
      rest = stripEnd(parsed.data.outcome);
      bloom = parsed.data.bloomLevel;
      // Some catalogues repeat the verb inside the outcome text.
      if (norm(rest).startsWith(`${norm(verb)} `)) rest = rest.slice(verb.length).trim();
    }
    const sentence = sentenceCase(stripEnd(`${verb} ${rest}`.trim()));
    const level = bloom && bloom >= 1 && bloom <= 6 ? Math.round(bloom) : (BLOOM_BY_VERB[verb.toLowerCase()] ?? 3);
    if (sentence.length >= 6) out.push({ sentence, bloom: level });
  }
  return out;
}

interface Module {
  heading: string;
  topics: string[];
}

const plain = (s: string) => stripEnd(s.replace(/[*_`]+/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1").trim());

/** `## Module 2: Managing resistance` headings and the bullets under them. */
export function parseOutline(markdown: string, courseTitle: string): Module[] {
  const modules: Module[] = [];
  let current: Module | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      const text = plain(heading[1]);
      if (norm(text) === norm(courseTitle)) {
        current = null;
        continue;
      }
      current = { heading: text, topics: [] };
      modules.push(current);
      continue;
    }
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet && current) {
      const topic = plain(bullet[1]);
      if (topic.length >= 4 && topic.length <= 160) current.topics.push(sentenceCase(topic));
    }
  }
  return modules.filter((m) => m.heading.length > 0);
}

// ------------------------------------------------------------ distractors

const GENERIC_OUTCOMES = [
  "Prepare a monthly cash-flow forecast for a business unit",
  "Apply lockout-tagout procedures before machine maintenance",
  "Build a pivot table to summarise sales by region",
  "Conduct a HIRARC risk assessment for a workstation",
  "Draft a customer complaint response using a structured model",
  "Configure multi-factor authentication for staff accounts",
  "Plan a preventive maintenance schedule for production equipment",
  "Calculate the landed cost of an imported shipment",
  "Deliver a five-minute product pitch to a prospective client",
  "Interpret a statistical process control chart",
  "Write a job description aligned to a competency framework",
  "Apply 5S principles to organise a work area",
  "Negotiate payment terms with a supplier",
  "Identify phishing indicators in a suspicious email",
  "Reconcile a bank statement against the general ledger",
  "Plan a social media content calendar for a product launch",
];

const GENERIC_TOPICS = [
  "Principles of double-entry bookkeeping",
  "Machine guarding and lockout-tagout",
  "Pivot tables and conditional formatting",
  "Hazard identification and risk control (HIRARC)",
  "Handling difficult customers on the phone",
  "Password hygiene and multi-factor authentication",
  "Inventory valuation methods",
  "Incoterms and customs documentation",
  "Storytelling for sales presentations",
  "Statistical process control basics",
  "Competency-based interviewing",
  "5S workplace organisation",
  "Supplier negotiation tactics",
  "Food handling and HACCP basics",
  "Basic first aid and CPR",
  "Forklift pre-use inspection",
];

const GENERIC_FOCUS_AREAS = [
  "Digital Transformation",
  "Occupational Safety and Health",
  "Green Economy and Sustainability",
  "Leadership and Management",
  "Customer Service Excellence",
  "Finance and Accounting",
  "Industry 4.0 and Automation",
  "Sales and Marketing",
];

interface CatalogPools {
  outcomes: string[];
  topics: string[];
  focusAreas: string[];
}

/** Distractor pools from the rest of the catalogue, other focus areas first. */
function poolsFor(course: CourseForQuiz, catalog: CourseForQuiz[]): { preferred: CatalogPools; fallback: CatalogPools } {
  const others = catalog.filter((c) => c.id !== course.id);
  const collect = (list: CourseForQuiz[]): CatalogPools => ({
    outcomes: list.flatMap((c) => parseOutcomes(c.learningOutcomes).map((o) => o.sentence)),
    topics: list.flatMap((c) => parseOutline(c.masterOutlineMarkdown, c.title).flatMap((m) => m.topics)),
    focusAreas: list.map((c) => c.hrdFocusArea),
  });
  const differentArea = others.filter((c) => norm(c.hrdFocusArea) !== norm(course.hrdFocusArea));
  const sameArea = others.filter((c) => norm(c.hrdFocusArea) === norm(course.hrdFocusArea));
  const preferred = collect(differentArea);
  const same = collect(sameArea);
  return {
    preferred,
    fallback: {
      // Same-area courses are the last resort: their outcomes can be arguably
      // true of this course too, which makes a question ambiguous.
      outcomes: [...GENERIC_OUTCOMES, ...same.outcomes],
      topics: [...GENERIC_TOPICS, ...same.topics],
      focusAreas: [...GENERIC_FOCUS_AREAS, ...same.focusAreas],
    },
  };
}

function pickDistractors(preferred: string[], fallback: string[], exclude: string[], count: number, seed: string): string[] {
  const banned = new Set(exclude.map(norm));
  const take = (list: string[], n: number, s: string) => {
    const unique = [...new Map(list.filter((x) => !banned.has(norm(x))).map((x) => [norm(x), x])).values()];
    const picked = sample(unique, n, s);
    picked.forEach((p) => banned.add(norm(p)));
    return picked;
  };
  const first = take(preferred, count, `${seed}:p`);
  return first.length >= count ? first : [...first, ...take(fallback, count - first.length, `${seed}:f`)];
}

// --------------------------------------------------------------- template

function mcq(prompt: string, correct: string, distractors: string[], seed: string): DraftQuestion | null {
  if (distractors.length < OPTIONS_PER_QUESTION - 1) return null;
  const options = shuffled([correct, ...distractors.slice(0, OPTIONS_PER_QUESTION - 1)], seed);
  // Two options that read the same make the question unanswerable.
  if (new Set(options.map(norm)).size !== options.length) return null;
  return { prompt, options, answerIndex: options.indexOf(correct) };
}

const RECOGNITION_PROMPTS = [
  (t: string) => `Which of the following is a stated learning outcome of "${t}"?`,
  (t: string) => `By the end of "${t}", participants are expected to be able to:`,
  (t: string) => `Which capability does "${t}" set out to build?`,
  (t: string) => `Which of these objectives belongs to "${t}"?`,
];

/**
 * Deterministic 10-question bank. Question families, in priority order:
 *   A  outcome recognition        — one per learning outcome
 *   C  module topic               — one per outline module with topics
 *   B  cognitive demand (Bloom)   — what an outcome asks the learner to do
 *   D  topic placement            — which module covers a topic (4+ modules)
 *   F  NOT-an-outcome             — needs 3+ outcomes
 *   E  focus area alignment
 * then further A/C variants with fresh distractors until the bank is full.
 */
export function templateQuestions(course: CourseForQuiz, catalog: CourseForQuiz[]): DraftQuestion[] {
  const outcomes = parseOutcomes(course.learningOutcomes);
  const modules = parseOutline(course.masterOutlineMarkdown, course.title);
  if (outcomes.length === 0 && modules.every((m) => m.topics.length === 0)) {
    throw new DomainError(
      "COURSE_HAS_NO_OUTCOMES",
      `Course ${course.courseCode} has no learning outcomes or outline topics to assess`,
      { courseCode: course.courseCode },
    );
  }
  const { preferred, fallback } = poolsFor(course, catalog);
  const own = [...outcomes.map((o) => o.sentence), ...modules.flatMap((m) => m.topics), ...modules.map((m) => m.heading)];
  const seed = `bank:${course.courseCode}`;
  const title = course.title;

  const families: Array<Array<DraftQuestion | null>> = [];
  const recognition = (o: Outcome, i: number, variant: number) =>
    mcq(
      RECOGNITION_PROMPTS[(i + variant) % RECOGNITION_PROMPTS.length](title),
      o.sentence,
      pickDistractors(preferred.outcomes, fallback.outcomes, own, 3, `${seed}:A:${i}:${variant}`),
      `${seed}:A:${i}:${variant}:order`,
    );
  const topical = modules.filter((m) => m.topics.length > 0);
  const moduleTopic = (m: Module, i: number, variant: number) =>
    mcq(
      `Which topic is covered in "${m.heading}"?`,
      m.topics[variant % m.topics.length],
      pickDistractors(preferred.topics, fallback.topics, own, 3, `${seed}:C:${i}:${variant}`),
      `${seed}:C:${i}:${variant}:order`,
    );

  families.push(outcomes.map((o, i) => recognition(o, i, 0)));
  families.push(topical.map((m, i) => moduleTopic(m, i, 0)));
  families.push(
    outcomes.map((o, i) => {
      const others = [1, 2, 3, 4, 5, 6].filter((l) => l !== o.bloom);
      const distractors = sample(others, 3, `${seed}:B:${i}`).map((l) => BLOOM_DESCRIPTOR[l]);
      return mcq(`The outcome "${o.sentence}" asks participants to do what?`, BLOOM_DESCRIPTOR[o.bloom], distractors, `${seed}:B:${i}:order`);
    }),
  );
  if (modules.length >= 4) {
    families.push(
      topical.slice(0, 2).map((m, i) => {
        const distractors = sample(modules.filter((x) => x !== m).map((x) => x.heading), 3, `${seed}:D:${i}`);
        // The last topic, not the first: family C already asks about topics[0]
        // and the two questions would answer each other.
        const topic = m.topics[m.topics.length - 1];
        return mcq(`In "${title}", where is "${topic}" covered?`, m.heading, distractors, `${seed}:D:${i}:order`);
      }),
    );
  }
  if (outcomes.length >= 3) {
    const foreign = pickDistractors(preferred.outcomes, fallback.outcomes, own, 1, `${seed}:F`);
    if (foreign.length === 1) {
      families.push([
        mcq(
          `Which of the following is NOT a learning outcome of "${title}"?`,
          foreign[0],
          sample(outcomes.map((o) => o.sentence), 3, `${seed}:F:own`),
          `${seed}:F:order`,
        ),
      ]);
    }
  }
  families.push([
    mcq(
      `"${title}" is aligned to which HRD Corp focus area?`,
      course.hrdFocusArea,
      pickDistractors(preferred.focusAreas, fallback.focusAreas, [course.hrdFocusArea], 3, `${seed}:E`),
      `${seed}:E:order`,
    ),
  ]);

  const out: DraftQuestion[] = [];
  const seen = new Set<string>();
  const add = (q: DraftQuestion | null) => {
    if (!q || out.length >= QUESTIONS_PER_BANK) return;
    const key = `${norm(q.prompt)}|${norm(q.options[q.answerIndex])}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };
  // Round-robin across families so a course with many outcomes still gets
  // module and cognitive-demand questions, then top up with variants.
  const longest = Math.max(...families.map((f) => f.length));
  for (let i = 0; i < longest; i += 1) families.forEach((f) => add(f[i] ?? null));
  for (let variant = 1; out.length < QUESTIONS_PER_BANK && variant < 12; variant += 1) {
    outcomes.forEach((o, i) => add(recognition(o, i, variant)));
    topical.forEach((m, i) => add(moduleTopic(m, i, variant)));
  }
  if (out.length < QUESTIONS_PER_BANK) {
    throw new DomainError(
      "COURSE_TOO_THIN",
      `Course ${course.courseCode} yields only ${out.length} distinct questions; add learning outcomes or outline topics`,
      { courseCode: course.courseCode, questions: out.length },
    );
  }
  return out;
}

// ------------------------------------------------------------- LLM draft

const draftSchema = z.object({
  questions: z
    .array(
      z.object({
        prompt: z.string().min(10).max(400),
        options: z.array(z.string().min(1).max(200)).length(OPTIONS_PER_QUESTION),
        answerIndex: z.number().int().min(0).max(OPTIONS_PER_QUESTION - 1),
      }),
    )
    .length(QUESTIONS_PER_BANK),
});
type Draft = z.infer<typeof draftSchema>;

/** Schema-valid is not enough: duplicate options or prompts make a question unanswerable. */
function saneDraft(draft: Draft): boolean {
  const prompts = new Set(draft.questions.map((q) => norm(q.prompt)));
  if (prompts.size !== draft.questions.length) return false;
  return draft.questions.every((q) => new Set(q.options.map(norm)).size === q.options.length && q.options.every((o) => norm(o).length > 0));
}

async function draftQuestions(course: CourseForQuiz, catalog: CourseForQuiz[]): Promise<{ questions: DraftQuestion[]; provenance: Provenance; rejected: boolean }> {
  const template = templateQuestions(course, catalog);
  const outcomes = parseOutcomes(course.learningOutcomes).map((o) => `- ${o.sentence}`).join("\n");
  const result = await runTier<Draft>({
    tier: "L3",
    agent: QUIZ_AGENT,
    system:
      "You write Kirkpatrick Level 2 knowledge assessments for HRD Corp-funded corporate training in Malaysia. " +
      `Write exactly ${QUESTIONS_PER_BANK} multiple-choice questions, each with exactly ${OPTIONS_PER_QUESTION} options and one correct answer. ` +
      "Test the knowledge and skills in the learning outcomes, not trivia about the course. Distractors must be plausible " +
      "but clearly wrong to someone who completed the training. No 'all of the above' or 'none of the above'. " +
      "The same questions are used before and after training. Return JSON only.",
    prompt:
      `Course: ${course.title}\nFocus area: ${course.hrdFocusArea}\nAudience: ${course.targetSeniority}\n` +
      `Learning outcomes:\n${outcomes}\n\nOutline:\n${course.masterOutlineMarkdown.slice(0, 4000)}\n\n` +
      `Return {"questions":[{"prompt":"...","options":["...","...","...","..."],"answerIndex":0}, ...]}`,
    json: { schema: draftSchema },
    maxTokens: 3000,
    template: () => ({ questions: template }),
  });
  if (result.provenance.mode === "LLM" && !saneDraft(result.output)) {
    return { questions: template, provenance: { ...result.provenance, mode: "TEMPLATE", fallbackReason: "LLM_OUTPUT_REJECTED" }, rejected: true };
  }
  return { questions: result.output.questions, provenance: result.provenance, rejected: false };
}

/** Stable id per question; an answer to a regenerated question cannot silently match a different one. */
export function withIds(questions: DraftQuestion[]): QuizQuestion[] {
  return questions.map((q, i) => ({
    id: `q${String(i + 1).padStart(2, "0")}-${sha256Hex(`${q.prompt}\u0000${q.options.join("\u0000")}`).slice(0, 6)}`,
    prompt: q.prompt,
    options: [...q.options],
    answerIndex: q.answerIndex,
  }));
}

/**
 * Version tag for the bank as participants see it. It deliberately excludes
 * the answer key: with 10 questions of 4 options there are only ~10^6 keys,
 * so a hash that covered them could be brute-forced from the public value.
 */
export function quizVersion(bank: Pick<QuizBank, "id" | "questions">): string {
  const visible = bank.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options }));
  return sha256Hex(JSON.stringify({ bank: bank.id, questions: visible })).slice(0, 16);
}

// ------------------------------------------------------------ persistence

interface CourseRow {
  id: string;
  course_code: string;
  title: string;
  hrd_focus_area: string;
  target_seniority: string;
  learning_outcomes: unknown;
  master_outline_markdown: string;
}

const toCourse = (r: CourseRow): CourseForQuiz => ({
  id: r.id,
  courseCode: r.course_code,
  title: r.title,
  hrdFocusArea: r.hrd_focus_area,
  targetSeniority: r.target_seniority,
  learningOutcomes: r.learning_outcomes,
  masterOutlineMarkdown: r.master_outline_markdown,
});

async function loadCatalog(executor: Executor): Promise<CourseForQuiz[]> {
  const list = await rows<CourseRow>(
    executor,
    sql`select id, course_code, title, hrd_focus_area, target_seniority, learning_outcomes, master_outline_markdown
          from tpms.course_catalog order by course_code`,
  );
  return list.map(toCourse);
}

interface BankRow {
  id: string;
  course_id: string;
  questions: QuizQuestion[];
  provenance: Record<string, unknown>;
}

const toBank = (r: BankRow): QuizBank => ({ id: r.id, courseId: r.course_id, questions: r.questions, provenance: r.provenance ?? {} });

export async function loadQuizBank(executor: Executor, courseId: string): Promise<QuizBank | undefined> {
  const row = await one<BankRow>(
    executor,
    sql`select id, course_id, questions, provenance from tpms.quiz_banks where course_id = ${courseId}::uuid`,
  );
  return row ? toBank(row) : undefined;
}

async function createBank(executor: Executor, course: CourseForQuiz, catalog: CourseForQuiz[]): Promise<{ bank: QuizBank; mode: string }> {
  const runId = await startAgentRun(executor, { agent: QUIZ_AGENT, tier: "L3", inputSummary: `quiz bank for ${course.courseCode}: ${course.title}` });
  try {
    const draft = await draftQuestions(course, catalog);
    const questions = withIds(draft.questions);
    const provenance = {
      ...draft.provenance,
      runId,
      generator: draft.provenance.mode === "LLM" ? QUIZ_AGENT : TEMPLATE_GENERATOR,
      courseCode: course.courseCode,
    };
    await executor.execute(sql`insert into tpms.quiz_banks (course_id, questions, provenance)
        values (${course.id}::uuid, ${JSON.stringify(questions)}::jsonb, ${JSON.stringify(provenance)}::jsonb)
        on conflict (course_id) do nothing`);
    // A concurrent writer may have won the insert; the stored bank is the bank.
    const bank = await loadQuizBank(executor, course.id);
    if (!bank) throw new Error(`quiz bank for ${course.courseCode} vanished after insert`);
    await finishAgentRun(executor, runId, {
      status: draft.provenance.mode === "LLM" ? "SUCCEEDED" : "FALLBACK",
      output: { courseCode: course.courseCode, questions: bank.questions.length, rejectedModelOutput: draft.rejected },
      provenance: draft.provenance,
      costMyr: draft.provenance.costMyr,
    });
    return { bank, mode: draft.provenance.mode };
  } catch (error) {
    // Inside an aborted transaction this write fails too; the original error matters more.
    await finishAgentRun(executor, runId, { status: "FAILED", error: error instanceof Error ? error.message : String(error) }).catch(
      () => undefined,
    );
    throw error;
  }
}

/** The bank for a course, generating it on first use. */
export async function ensureQuizBank(executor: Executor, courseId: string): Promise<QuizBank> {
  const existing = await loadQuizBank(executor, courseId);
  if (existing) return existing;
  const catalog = await loadCatalog(executor);
  const course = catalog.find((c) => c.id === courseId);
  if (!course) throw new DomainError("COURSE_NOT_FOUND", `Course ${courseId} not found`);
  return (await createBank(executor, course, catalog)).bank;
}

export interface SeedResult {
  seeded: Array<{ courseCode: string; mode: string }>;
  skipped: Array<{ courseCode: string; reason: "EXISTS" | "COURSE_HAS_NO_OUTCOMES" | "COURSE_TOO_THIN" }>;
}

/**
 * Give every catalogue course a bank. Idempotent: a course that already has
 * one keeps it — regenerating a bank mid-cohort would split the PRE and POST
 * sittings across two different tests.
 */
export async function seedQuizBanks(executor: Executor, opts: { courseIds?: string[] } = {}): Promise<SeedResult> {
  const catalog = await loadCatalog(executor);
  const existing = new Set(
    (await rows<{ course_id: string }>(executor, sql`select course_id from tpms.quiz_banks`)).map((r) => r.course_id),
  );
  const result: SeedResult = { seeded: [], skipped: [] };
  for (const course of catalog) {
    if (opts.courseIds && !opts.courseIds.includes(course.id)) continue;
    if (existing.has(course.id)) {
      result.skipped.push({ courseCode: course.courseCode, reason: "EXISTS" });
      continue;
    }
    try {
      const { mode } = await createBank(executor, course, catalog);
      result.seeded.push({ courseCode: course.courseCode, mode });
    } catch (error) {
      if (error instanceof DomainError && (error.code === "COURSE_HAS_NO_OUTCOMES" || error.code === "COURSE_TOO_THIN")) {
        result.skipped.push({ courseCode: course.courseCode, reason: error.code });
        continue;
      }
      throw error;
    }
  }
  return result;
}
