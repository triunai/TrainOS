import { describe, expect, it } from "vitest";
import { OPTIONS_PER_QUESTION, QUESTIONS_PER_BANK, quizVersion, templateQuestions } from "@/server/assessments";
import { withIds } from "@/server/assessments/bank";
import { arrangeQuiz, scoreAnswers } from "@/server/assessments/service";
import { permutation } from "@/server/assessments/shuffle";
import { CHANGE_COURSE, EXCEL_COURSE, asCourse } from "./assessments-fixtures";

const change = asCourse("00000000-0000-4000-8000-000000000001", CHANGE_COURSE);
const excel = asCourse("00000000-0000-4000-8000-000000000002", EXCEL_COURSE);
const catalog = [change, excel];
const code = (e: unknown) => (e as { code?: string }).code;

describe("template quiz generator", () => {
  it("builds 10 well-formed 4-option questions, deterministically", () => {
    const a = templateQuestions(change, catalog);
    const b = templateQuestions(change, catalog);
    expect(a).toEqual(b);
    expect(a).toHaveLength(QUESTIONS_PER_BANK);
    for (const q of a) {
      expect(q.options).toHaveLength(OPTIONS_PER_QUESTION);
      expect(new Set(q.options.map((o) => o.toLowerCase())).size).toBe(OPTIONS_PER_QUESTION);
      expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex).toBeLessThan(OPTIONS_PER_QUESTION);
    }
    expect(new Set(a.map((q) => q.prompt + q.options[q.answerIndex])).size).toBe(QUESTIONS_PER_BANK);
  });

  it("keys outcome questions to the course's own outcomes and never offers them as distractors", () => {
    const own = [
      "Explain the four stages of the change curve and how people move through them",
      "Apply the ADKAR model to plan a change initiative",
      "Analyse sources of resistance within a team",
      "Design a stakeholder communication plan for a restructuring",
    ];
    const bank = templateQuestions(change, catalog);
    const recognition = bank.filter((q) => q.prompt.includes("Leading Through Change") && !q.prompt.includes("NOT"));
    const outcomeQs = recognition.filter((q) => own.includes(q.options[q.answerIndex]));
    // Families are interleaved, so outcome recognition shares the bank with
    // module, cognitive-demand, placement and focus-area questions.
    expect(outcomeQs.length).toBeGreaterThanOrEqual(2);
    expect(bank.some((q) => q.prompt.startsWith("Which topic is covered in"))).toBe(true);
    expect(bank.some((q) => q.prompt.includes("asks participants to do what"))).toBe(true);
    for (const q of outcomeQs) {
      const distractors = q.options.filter((_, i) => i !== q.answerIndex);
      expect(distractors.some((d) => own.includes(d))).toBe(false);
    }
  });

  it("refuses a course with nothing to assess instead of inventing a test", () => {
    const empty = { ...change, learningOutcomes: [], masterOutlineMarkdown: "" };
    expect(() => templateQuestions(empty, catalog)).toThrow();
    try {
      templateQuestions(empty, catalog);
    } catch (e) {
      expect(code(e)).toBe("COURSE_HAS_NO_OUTCOMES");
    }
  });
});

describe("per-sitting arrangement and scoring", () => {
  const bank = { id: "bank-1", questions: withIds(templateQuestions(change, catalog)) };

  it("never exposes the answer key and shuffles per participant and per sitting", () => {
    const pre = arrangeQuiz(bank, "p-1", "PRE");
    expect(JSON.stringify(pre.questions)).not.toMatch(/answer/i);
    expect(pre.questions.map((q) => q.id).sort()).toEqual(bank.questions.map((q) => q.id).sort());
    const post = arrangeQuiz(bank, "p-1", "POST");
    const other = arrangeQuiz(bank, "p-2", "PRE");
    expect(post.questions.map((q) => q.id)).not.toEqual(pre.questions.map((q) => q.id));
    expect(other.questions.map((q) => q.id)).not.toEqual(pre.questions.map((q) => q.id));
    expect(arrangeQuiz(bank, "p-1", "PRE").questions).toEqual(pre.questions);
  });

  it("maps displayed options back to the canonical key", () => {
    const view = arrangeQuiz(bank, "p-9", "POST").questions;
    const key = new Map(bank.questions.map((q) => [q.id, q.options[q.answerIndex]]));
    const all = view.map((q) => ({ questionId: q.id, optionIndex: q.options.indexOf(key.get(q.id) as string) }));
    expect(scoreAnswers(bank, "p-9", "POST", all).score).toBe(100);
    // The same displayed indices are wrong for a different sitting's arrangement often enough to matter.
    const wrongSeven = all.map((a, i) => (i < 7 ? { ...a, optionIndex: (a.optionIndex + 1) % OPTIONS_PER_QUESTION } : a));
    expect(scoreAnswers(bank, "p-9", "POST", wrongSeven)).toMatchObject({ correct: 3, total: 10, score: 30 });
    expect(scoreAnswers(bank, "p-9", "POST", all.slice(0, 5)).score).toBe(50);
  });

  it("rejects unknown questions, duplicates and out-of-range options (R14)", () => {
    const q = bank.questions[0].id;
    expect(() => scoreAnswers(bank, "p", "PRE", [{ questionId: "q99-zzz", optionIndex: 0 }])).toThrow(/not in this quiz/);
    expect(() => scoreAnswers(bank, "p", "PRE", [{ questionId: q, optionIndex: 0 }, { questionId: q, optionIndex: 1 }])).toThrow(/twice/);
    expect(() => scoreAnswers(bank, "p", "PRE", [{ questionId: q, optionIndex: 4 }])).toThrow(/does not exist/);
    expect(() => scoreAnswers(bank, "p", "PRE", [])).toThrow(/No answers/);
  });

  it("versions the visible quiz, not the answer key", () => {
    const flipped = { ...bank, questions: bank.questions.map((q) => ({ ...q, answerIndex: (q.answerIndex + 1) % 4 })) };
    expect(quizVersion(flipped)).toBe(quizVersion(bank));
    const edited = { ...bank, questions: bank.questions.map((q, i) => (i === 0 ? { ...q, prompt: `${q.prompt}?` } : q)) };
    expect(quizVersion(edited)).not.toBe(quizVersion(bank));
  });

  it("permutation is a bijection", () => {
    const perm = permutation(10, "seed");
    expect([...perm].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
