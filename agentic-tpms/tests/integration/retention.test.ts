import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, startOfDayMY } from "@/lib/dates";
import { embed } from "@/server/ai";
import { db, rows, schema } from "@/server/db/client";
import { updatePackageFields } from "@/server/fsm/service";
import { sha256Hex } from "@/server/lib/crypto";
import { approveRetention, skipRetention } from "@/server/retention/dispatch";
import { runRetention } from "@/server/retention/run";
import { levyAlertDate, listRetention, scheduleRetention } from "@/server/retention/schedule";
import { handlers as retentionHandlers } from "@/server/retention/tasks";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt } from "../helpers/lifecycle";
import { queuedTask, runQueued, uploadEvidence, vaultOf } from "../helpers/finance-harness";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

async function scheduled(fiscalYearEndMonth: number | null = null) {
  const fx = await buildPackageAt("DELIVERY_COMPLETED");
  if (fiscalYearEndMonth) {
    await db().update(schema.corporateClients).set({ fiscalYearEndMonth }).where(eq(schema.corporateClients.id, fx.pkg.clientId));
  }
  const result = await runQueued(retentionHandlers, "retention.schedule", { packageId: fx.pkg.id });
  const schedules = result.schedules as Array<{ id: string; cadenceType: string; scheduledFor: string; created: boolean }>;
  const byCadence = (c: string) => schedules.find((s) => s.cadenceType === c)!;
  return { ...fx, schedules, byCadence };
}

const suffix = () => Math.random().toString(36).slice(2, 8).toUpperCase();

async function course(code: string, title: string, level: number, outline: string, nextCourseCode: string | null = null) {
  const { vectors, model } = await embed([`${title}\n${outline}`]);
  const [row] = await db()
    .insert(schema.courseCatalog)
    .values({
      courseCode: code,
      title,
      hrdFocusArea: "Leadership and management",
      targetSeniority: "SUPERVISORY",
      level,
      nextCourseCode,
      durationDays: 2,
      learningOutcomes: [{ verb: "apply", outcome: title, bloomLevel: 3 }],
      masterOutlineMarkdown: outline,
      syllabusEmbedding: vectors[0],
      embeddingModel: model,
    })
    .returning();
  return row;
}

describe("retention scheduling", () => {
  it("creates the three cadences with delayed retention.run tasks at 00:00 MYT, idempotently", async () => {
    const fx = await scheduled(12);
    const end = fx.pkg.endDate!;
    expect(fx.byCadence("EXECUTIVE_PACK_T14").scheduledFor).toBe(addDays(end, 14));
    expect(fx.byCadence("SYLLABUS_LADDER_T90").scheduledFor).toBe(addDays(end, 90));
    expect(fx.byCadence("LEVY_YEAR_END_T300").scheduledFor).toBe(levyAlertDate(end, 12).date);

    for (const s of fx.schedules) {
      const task = await queuedTask("retention.run", { scheduleId: s.id });
      expect(task, s.cadenceType).toBeDefined();
      expect(task!.claimDue.getTime()).toBe(startOfDayMY(s.scheduledFor).getTime());
    }

    const again = await scheduleRetention(fx.pkg.id);
    expect(again.schedules.map((s) => s.created)).toEqual([false, false, false]);
    const [counts] = await rows<{ schedules: number; tasks: number }>(
      db(),
      sql`select (select count(*)::int from tpms.renewal_schedules where source_package_id = ${fx.pkg.id}::uuid) as schedules,
                 (select count(*)::int from tpms.task_queue where task_type = 'retention.run'
                    and payload->>'scheduleId' in (select id::text from tpms.renewal_schedules where source_package_id = ${fx.pkg.id}::uuid)) as tasks`,
    );
    expect(counts).toEqual({ schedules: 3, tasks: 3 });
    expect((await listRetention({ packageId: fx.pkg.id })).map((r) => r.cadenceType)).toEqual([
      "EXECUTIVE_PACK_T14",
      "SYLLABUS_LADDER_T90",
      "LEVY_YEAR_END_T300",
    ]);
  });
});

describe("retention drafts and dispatch", () => {
  it("drafts the T+14 executive pack with the Kirkpatrick delta and certificate links, then dispatches on approval", async () => {
    const fx = await scheduled();
    const [p1, p2] = fx.participantIds;
    await db().insert(schema.participantAssessments).values([
      { packageId: fx.pkg.id, participantId: p1, kind: "PRE", score: "50" },
      { packageId: fx.pkg.id, participantId: p1, kind: "POST", score: "80" },
      { packageId: fx.pkg.id, participantId: p2, kind: "PRE", score: "60" },
      { packageId: fx.pkg.id, participantId: p2, kind: "POST", score: "70" },
    ]);
    const certPdf = await uploadEvidence(fx.pkg.id, "CERTIFICATE");
    const serial = `CERT-${suffix()}`;
    await db().execute(sql`insert into tpms.certificates
        (package_id, participant_id, certificate_serial, document_vault_id, payload_sha256, sha256_hash, public_verification_url, payload)
        values (${fx.pkg.id}::uuid, ${p1}::uuid, ${serial}, ${certPdf.id}::uuid, ${sha256Hex("payload")}, ${certPdf.fileHashSha256},
                ${`http://localhost:3100/verify/${serial}`}, '{}'::jsonb)`);

    const t14 = fx.byCadence("EXECUTIVE_PACK_T14");
    const result = await runQueued(retentionHandlers, "retention.run", { scheduleId: t14.id });
    expect(result).toMatchObject({ status: "DRAFTED", cadenceType: "EXECUTIVE_PACK_T14" });
    const [row] = await db().select().from(schema.renewalSchedules).where(eq(schema.renewalSchedules.id, t14.id));
    expect(row.status).toBe("DRAFTED");
    expect(row.draftSubject).toContain("Leading Through Change");
    expect(row.draftBody).toContain("moved from 55.0 to 75.0 (+20.0 points) across 2 participant(s)");
    expect(row.draftBody).toContain("1 certificate(s) issued");
    const [pack] = await vaultOf(fx.pkg.id, "EXEC_PACK");
    expect(row.vaultId).toBe(pack.id);

    const [decision] = await db()
      .select()
      .from(schema.decisions)
      .where(and(eq(schema.decisions.gate, "RETENTION_PROPOSAL"), eq(schema.decisions.subjectRef, `${fx.pkg.packageCode}:T14`)));
    expect(decision).toMatchObject({ status: "PENDING", raisedBy: "retention.exec_pack_writer", raisedByTier: "L4" });
    const [run] = await rows<{ status: string }>(
      db(),
      sql`select status from tpms.agent_runs where agent = 'retention.exec_pack_writer' and package_id = ${fx.pkg.id}::uuid`,
    );
    expect(run.status).toBe("FALLBACK");

    await expect(approveRetention(t14.id, ALEX, { subject: "Hi" })).rejects.toMatchObject({ code: "INVALID_DRAFT" });
    const sent = await approveRetention(t14.id, ALEX, { subject: "Your team's results: Leading Through Change" });
    expect(sent).toMatchObject({ status: "DISPATCHED", to: "nurul@example.my", subject: "Your team's results: Leading Through Change" });
    expect(["SENT", "LOGGED"]).toContain(sent.dispatch.status);
    expect(sent.dispatch.id).toBeTruthy();

    const [after] = await db().select().from(schema.renewalSchedules).where(eq(schema.renewalSchedules.id, t14.id));
    expect(after.status).toBe("DISPATCHED");
    expect(after.dispatchedAt).toBeInstanceOf(Date);
    const [audit] = await rows<{ actor_type: string; actor_id: string; metadata_diff: Record<string, unknown> }>(
      db(),
      sql`select actor_type, actor_id, metadata_diff from tpms.audit_ledger
           where entity_type = 'TRAINING_PACKAGE' and entity_id = ${fx.pkg.id}::uuid and reason_code = 'RETENTION_CADENCE_DISPATCHED'`,
    );
    expect(audit).toMatchObject({ actor_type: "USER", actor_id: ALEX.id, metadata_diff: { cadence_type: "EXECUTIVE_PACK_T14", schedule_id: t14.id } });
    const [resolved] = await db().select().from(schema.decisions).where(eq(schema.decisions.id, decision.id));
    expect(resolved).toMatchObject({ status: "APPROVED", resolvedBy: ALEX.id });

    await expect(approveRetention(t14.id, ALEX)).rejects.toMatchObject({ code: "RETENTION_CLOSED" });
    // A retried task after the draft is a no-op.
    expect(await runRetention(t14.id)).toMatchObject({ skipped: "status is DISPATCHED" });
  });

  it("recommends the nearest higher-level course by pgvector similarity, and the designed next course when there is one", async () => {
    const s = suffix();
    const outline = "Leading teams through organisational change: communication, resistance, coaching conversations and stakeholder alignment.";
    const source = await course(`LTC-${s}`, "Leading Through Change", 1, outline);
    await course(`CHG-${s}`, "Change Communication Basics", 1, `Change communication basics for teams. ${outline}`);
    const similar = await course(`LHT-${s}`, "Leading High-Performance Teams Through Change", 2,
      "Leading high-performance teams through change: coaching conversations, resistance, communication and accountability.");
    const excel = await course(`XLS-${s}`, "Advanced Excel for Finance Teams", 3, "Pivot tables, power query, dynamic arrays, financial modelling and dashboards in Excel.");

    const fx = await scheduled();
    await updatePackageFields(fx.pkg.id, { courseId: source.id }, ALEX, "TEST_FIXTURE_COURSE");
    const result = await runQueued(retentionHandlers, "retention.run", { scheduleId: fx.byCadence("SYLLABUS_LADDER_T90").id });
    expect(result).toMatchObject({ status: "DRAFTED", recommendedCourseId: similar.id });
    const [row] = await db().select().from(schema.renewalSchedules).where(eq(schema.renewalSchedules.id, fx.byCadence("SYLLABUS_LADDER_T90").id));
    expect(row.draftSubject).toBe(`Next step after Leading Through Change: ${similar.title}`);
    expect((row.provenance as { facts: { recommendationDetail: { basis: string; similarity: number } } }).facts.recommendationDetail).toMatchObject({
      basis: "SIMILARITY",
    });

    // The curriculum designer's ladder wins over similarity.
    await db().update(schema.courseCatalog).set({ nextCourseCode: excel.courseCode }).where(eq(schema.courseCatalog.id, source.id));
    const second = await scheduled();
    await updatePackageFields(second.pkg.id, { courseId: source.id }, ALEX, "TEST_FIXTURE_COURSE");
    const designed = await runQueued(retentionHandlers, "retention.run", { scheduleId: second.byCadence("SYLLABUS_LADDER_T90").id });
    expect(designed.recommendedCourseId).toBe(excel.id);
  });

  it("drafts the levy alert and lets an operator skip it", async () => {
    const fx = await scheduled(12);
    await db().update(schema.corporateClients).set({ levyBalanceEstimate: "42000.00" }).where(eq(schema.corporateClients.id, fx.pkg.clientId));
    const t300 = fx.byCadence("LEVY_YEAR_END_T300");
    const drafted = await runQueued(retentionHandlers, "retention.run", { scheduleId: t300.id });
    expect(drafted.status).toBe("DRAFTED");
    const [row] = await db().select().from(schema.renewalSchedules).where(eq(schema.renewalSchedules.id, t300.id));
    expect(row.draftSubject).toBe("HRD Corp levy: planning your remaining training before December");
    expect(row.draftBody).toContain("RM 42,000.00");

    await expect(skipRetention(t300.id, "", ALEX)).rejects.toMatchObject({ code: "NOTES_REQUIRED" });
    const skipped = await skipRetention(t300.id, "Client has committed its remaining levy elsewhere", ALEX);
    expect(skipped).toMatchObject({ status: "SKIPPED", responseNotes: "Client has committed its remaining levy elsewhere" });
    const [decision] = await db()
      .select()
      .from(schema.decisions)
      .where(and(eq(schema.decisions.gate, "RETENTION_PROPOSAL"), eq(schema.decisions.subjectRef, `${fx.pkg.packageCode}:T300`)));
    expect(decision).toMatchObject({ status: "REJECTED", chosenOption: "SKIP" });
    await expect(approveRetention(t300.id, ALEX)).rejects.toMatchObject({ code: "RETENTION_CLOSED" });
  });
});
