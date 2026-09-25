import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AssessmentKind,
  type QuizView,
  cohortReport,
  getQuiz,
  loadQuizBank,
  renderKirkpatrickReportPdf,
  seedQuizBanks,
  submitAssessment,
} from "@/server/assessments";
import { verifyChain } from "@/server/audit/ledger";
import { db, one, rows } from "@/server/db/client";
import { updatePackageFields } from "@/server/fsm/service";
import { readDocument } from "@/server/storage/vault";
import { expectRefusal, releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt, fixtureNric, type LifecycleFixture } from "../helpers/lifecycle";
import { CHANGE_COURSE, EXCEL_COURSE, insertCourse } from "../unit/assessments-fixtures";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

const code = async (work: Promise<unknown>) =>
  work.then(
    () => "RESOLVED",
    (e: { code?: string }) => e.code ?? String(e),
  );

let fx: LifecycleFixture;
let courseId: string;
const pid = (i: number) => fx.participantIds[i];

/** Answer the participant's own arrangement: the first `correct` right, the rest wrong. */
async function sit(i: number, kind: AssessmentKind, correct: number, extra: { reaction?: { rating: number } } = {}) {
  const view = await getQuiz(fx.pkg.id, pid(i), kind);
  const bank = await loadQuizBank(db(), courseId);
  const key = new Map(bank!.questions.map((q) => [q.id, q.options[q.answerIndex]]));
  const answers = view.questions.map((q, n) => {
    const right = q.options.indexOf(key.get(q.id) as string);
    return { questionId: q.id, optionIndex: n < correct ? right : (right + 1) % q.options.length };
  });
  return submitAssessment({ packageId: fx.pkg.id, participantId: pid(i), kind, answers, quizVersion: view.quizVersion, ...extra });
}

describe("quiz banks", () => {
  beforeAll(async () => {
    fx = await buildPackageAt("DELIVERY_COMPLETED");
    courseId = await insertCourse(db(), CHANGE_COURSE);
    await insertCourse(db(), EXCEL_COURSE);
    await updatePackageFields(fx.pkg.id, { courseId }, ALEX, "COURSE_LINKED");
  });

  it("seeds one 10-question bank per course, idempotently, with an agent run each", async () => {
    const first = await seedQuizBanks(db());
    expect(first.seeded.map((s) => s.courseCode).sort()).toEqual(["DT-XLS-201", "LD-CHG-101"]);
    expect(first.seeded.every((s) => s.mode === "TEMPLATE")).toBe(true);
    const again = await seedQuizBanks(db());
    expect(again.seeded).toEqual([]);
    expect(again.skipped.map((s) => s.reason)).toEqual(["EXISTS", "EXISTS"]);

    const bank = await loadQuizBank(db(), courseId);
    expect(bank!.questions).toHaveLength(10);
    expect(new Set(bank!.questions.map((q) => q.id)).size).toBe(10);
    expect(bank!.provenance).toMatchObject({ mode: "TEMPLATE", generator: "outcome-template-v1", courseCode: "LD-CHG-101" });

    const runs = await rows<{ status: string; tier: string }>(
      db(),
      sql`select status, tier from tpms.agent_runs where agent = 'assessments.quiz_writer'`,
    );
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.tier === "L3" && r.status === "FALLBACK")).toBe(true);
  });

  it("serves the quiz without the answer key, shuffled per participant and sitting", async () => {
    const pre = await getQuiz(fx.pkg.id, pid(0), "PRE");
    expect(pre).toMatchObject({ status: "OPEN", questionCount: 10, programmeTitle: "Leading Through Change", submitted: null });
    expect(pre.questions).toHaveLength(10);
    expect(JSON.stringify(pre)).not.toMatch(/answer/i);
    for (const q of pre.questions) expect(Object.keys(q).sort()).toEqual(["id", "options", "prompt"]);

    const post = await getQuiz(fx.pkg.id, pid(0), "POST");
    const other = await getQuiz(fx.pkg.id, pid(1), "PRE");
    expect(post.questions.map((q) => q.id)).not.toEqual(pre.questions.map((q) => q.id));
    expect(other.questions.map((q) => q.id)).not.toEqual(pre.questions.map((q) => q.id));
    expect(post.quizVersion).toBe(pre.quizVersion);
    expect((await getQuiz(fx.pkg.id, pid(0), "PRE")).questions).toEqual(pre.questions);
  });
});

describe("submission rules", () => {
  it("scores the percentage correct and records it on the participant", async () => {
    const pre = await sit(0, "PRE", 4);
    expect(pre).toMatchObject({ kind: "PRE", score: 40, correct: 4, total: 10, delta: null });
    const post = await sit(0, "POST", 9, { reaction: { rating: 4 } });
    expect(post).toMatchObject({ kind: "POST", score: 90, delta: 50 });

    const p = await one<{ kirkpatrick_pre_score: string; kirkpatrick_post_score: string }>(
      db(),
      sql`select kirkpatrick_pre_score, kirkpatrick_post_score from tpms.package_participants where id = ${pid(0)}::uuid`,
    );
    expect(Number(p!.kirkpatrick_pre_score)).toBe(40);
    expect(Number(p!.kirkpatrick_post_score)).toBe(90);
    const view: QuizView = await getQuiz(fx.pkg.id, pid(0), "POST");
    expect(view).toMatchObject({ status: "SUBMITTED", submitted: { score: 90 }, questions: [] });
  });

  it("refuses a second submission of the same sitting", async () => {
    expect(await code(sit(0, "PRE", 10))).toBe("ALREADY_SUBMITTED");
    expect(await code(sit(0, "POST", 10))).toBe("ALREADY_SUBMITTED");
  });

  it("refuses a PRE after the POST exists, and closes the PRE quiz", async () => {
    await sit(1, "POST", 8);
    expect((await getQuiz(fx.pkg.id, pid(1), "PRE")).status).toBe("CLOSED");
    expect(await code(sit(1, "PRE", 5))).toBe("PRE_AFTER_POST");
  });

  it("refuses withdrawn participants, foreign packages and malformed answers", async () => {
    await db().execute(sql`update tpms.package_participants set registration_status = 'WITHDRAWN' where id = ${pid(5)}::uuid`);
    expect(await code(getQuiz(fx.pkg.id, pid(5), "PRE"))).toBe("PARTICIPANT_WITHDRAWN");
    expect(await code(sit(5, "PRE", 5))).toBe("PARTICIPANT_WITHDRAWN");

    const other = await buildPackageAt("READY_FOR_EVENT");
    expect(await code(getQuiz(other.pkg.id, pid(2), "PRE"))).toBe("PARTICIPANT_NOT_FOUND");
    expect(await code(getQuiz(other.pkg.id, other.participantIds[0], "PRE"))).toBe("NO_COURSE_LINKED");
    expect(await code(getQuiz(fx.pkg.id, pid(2), "MID"))).toBe("UNKNOWN_ASSESSMENT_KIND");
    expect(await code(getQuiz("not-a-uuid", pid(2), "PRE"))).toBe("PARTICIPANT_NOT_FOUND");

    const base = { packageId: fx.pkg.id, participantId: pid(2), kind: "PRE" };
    expect(await code(submitAssessment({ ...base, answers: [{ questionId: "q01-000000", optionIndex: 0 }] }))).toBe("UNKNOWN_QUESTION");
    const view = await getQuiz(fx.pkg.id, pid(2), "PRE");
    expect(await code(submitAssessment({ ...base, answers: [{ questionId: view.questions[0].id, optionIndex: 7 }] }))).toBe("INVALID_OPTION");
    expect(await code(submitAssessment({ ...base, answers: [{ questionId: view.questions[0].id, optionIndex: 0 }], quizVersion: "stale" }))).toBe(
      "QUIZ_VERSION_MISMATCH",
    );
    expect(await code(submitAssessment({ ...base, answers: [{ questionId: view.questions[0].id, optionIndex: 0 }], reaction: { rating: 5 } }))).toBe(
      "INVALID_REACTION",
    );
    // None of the refusals left a row behind.
    const n = await one<{ n: number }>(db(), sql`select count(*)::int as n from tpms.participant_assessments where participant_id = ${pid(2)}::uuid`);
    expect(n!.n).toBe(0);
  });

  it("makes a submitted score final in the database (ASSESSMENT_FINAL)", async () => {
    await expectRefusal(
      db().execute(sql`update tpms.participant_assessments set score = 100 where participant_id = ${pid(0)}::uuid`),
      /ASSESSMENT_FINAL/,
    );
    await expectRefusal(
      db().execute(sql`insert into tpms.participant_assessments (package_id, participant_id, kind, score, reaction_rating)
                       values (${fx.pkg.id}::uuid, ${pid(3)}::uuid, 'PRE', 10, 3)`),
      /assessment_reaction_range/,
    );
  });

  it("serialises concurrent submissions of one sitting", async () => {
    const results = await Promise.all([code(sit(4, "PRE", 3)), code(sit(4, "PRE", 3))]);
    expect(results.sort()).toEqual(["ALREADY_SUBMITTED", "RESOLVED"]);
  });
});

describe("cohort report (Kirkpatrick Level 2)", () => {
  it("computes averages per sitting and the gain over matched pairs", async () => {
    // So far: P1 PRE 40 / POST 90 (rating 4), P2 POST 80, P5 PRE 30, P6 withdrawn.
    await sit(2, "PRE", 6);
    await sit(2, "POST", 7, { reaction: { rating: 5 } });
    await sit(3, "PRE", 5);
    await sit(3, "POST", 5);

    const r = await cohortReport(fx.pkg.id);
    expect(r).toMatchObject({ n: 5, nPre: 4, nPost: 4, nPaired: 3 });
    expect(r.preAvg).toBe(45); // (40 + 60 + 50 + 30) / 4
    expect(r.postAvg).toBe(72.5); // (90 + 80 + 70 + 50) / 4
    expect(r.paired).toEqual({ preAvg: 50, postAvg: 70 });
    expect(r.deltaAvg).toBe(20); // (50 + 10 + 0) / 3
    expect(r.deltaPct).toBe(40); // 20 / 50
    expect(r.improvedCount).toBe(2);
    expect(r.distribution).toEqual([
      { band: "0–19", pre: 0, post: 0 },
      { band: "20–39", pre: 1, post: 0 },
      { band: "40–59", pre: 2, post: 1 },
      { band: "60–79", pre: 1, post: 1 },
      { band: "80–100", pre: 0, post: 2 },
    ]);
    expect(r.reaction).toEqual({ n: 2, avg: 4.5 });
    expect(r.quiz).toMatchObject({ questionCount: 10, mode: "TEMPLATE" });

    expect(r.perParticipant.map((p) => [p.name, p.pre, p.post, p.delta])).toEqual([
      ["Participant 1", 40, 90, 50],
      ["Participant 2", null, 80, null],
      ["Participant 3", 60, 70, 10],
      ["Participant 4", 50, 50, 0],
      ["Participant 5", 30, null, null],
    ]);
    for (const p of r.perParticipant) expect(p.nricMasked).toMatch(/^\*{6}-\*\*-\d{4}$/);
    const json = JSON.stringify(r);
    for (let i = 0; i < 6; i += 1) expect(json).not.toContain(fixtureNric(90, i));
  });

  it("files the report PDF in the vault once per distinct content", async () => {
    const first = await renderKirkpatrickReportPdf(fx.pkg.id);
    expect(first.created).toBe(true);
    const stored = await readDocument(first.vaultId);
    expect(stored!.intact).toBe(true);
    expect(stored!.doc).toMatchObject({ documentType: "KIRKPATRICK_REPORT", verificationStatus: "VERIFIED", packageId: fx.pkg.id });
    expect(stored!.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(stored!.bytes)).getPageCount()).toBeGreaterThanOrEqual(1);

    const again = await renderKirkpatrickReportPdf(fx.pkg.id);
    expect(again).toMatchObject({ created: false, vaultId: first.vaultId, sha256: first.sha256 });

    const fresh = await buildPackageAt("DELIVERY_COMPLETED");
    expect(await code(renderKirkpatrickReportPdf(fresh.pkg.id))).toBe("NO_ASSESSMENTS");
  });

  it("audits every submission without breaking the chain", async () => {
    const audits = await rows<{ metadata_diff: Record<string, unknown> }>(
      db(),
      sql`select metadata_diff from tpms.audit_ledger where reason_code = 'ASSESSMENT_SUBMITTED'`,
    );
    expect(audits).toHaveLength(8); // P1 x2, P2, P3 x2, P4 x2, P5 (one of the concurrent pair)
    expect(audits.every((a) => a.metadata_diff.package_id === fx.pkg.id)).toBe(true);
    expect((await verifyChain()).ok).toBe(true);
  });
});
