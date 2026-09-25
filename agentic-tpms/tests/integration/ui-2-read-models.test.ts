import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_ACTOR, db, rows } from "@/server/db/client";
import { convertLeadToPackage, ingestLead, leadAgentRuns, listLeadInbox, leadInboxRow, triageLead } from "@/server/ingestion";
import { COURSE_SEEDS, listCourses, seedKnowledge } from "@/server/knowledge";
import { batchNotes, draftSequence, listDraftRequests, requestDraftSequence } from "@/server/outbound";
import { correctPolicyBands, listPolicies, listPolicyVersions, publishPolicyVersion, seedCostPolicies } from "@/server/pricing";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX, makeOperator } from "../helpers/factory";
import { buildPackageAt } from "../helpers/lifecycle";

beforeAll(async () => {
  await useTestDatabase();
  await makeOperator();
});
afterAll(releaseTestDatabase);

let n = 0;
function corporateForm() {
  n += 1;
  return {
    name: `Aminah ${n}`,
    email: `aminah${n}@ui2-kilang${n}.com.my`,
    phone: `012-55${String(n).padStart(2, "0")} 1234`,
    company: `Kilang ${n} Sdn Bhd`,
    topic: "Supervisory skills",
    message: "We are an HRD Corp levy payer and need HRDC claimable supervisory training for 25 staff.",
  };
}

describe("listLeadInbox — the Leads inbox read model", () => {
  it("carries the latest L1 run's provenance, honestly marked as the template when no model ran", async () => {
    const ingested = await ingestLead("WEB_FORM", corporateForm(), { verified: true });
    const leadId = ingested.leadId!;
    const before = await leadInboxRow(leadId);
    expect(before).toMatchObject({ status: "LEAD_INGESTED", channel: "WEB_FORM", verified: true, l1: null, packageCode: null });

    await triageLead(leadId);
    const row = (await leadInboxRow(leadId))!;
    expect(row.status).toBe("LEAD_QUALIFIED_TNA");
    expect(row.l1).toMatchObject({ tier: "L1", mode: "TEMPLATE", runStatus: "FALLBACK", intent: "TRAINING_ENQUIRY", route: "LEAD_QUALIFIED_TNA", abstain: null });
    expect(row.l1!.fallbackReason).toBeTruthy();
    expect(row.l1!.intentConfidence).toBeGreaterThan(0);
    expect(row.l1!.pLevy).toBeGreaterThanOrEqual(0.85);
    // No syllabus-sized blobs: the row is what the table renders.
    expect(JSON.stringify(row).length).toBeLessThan(4000);

    const runs = await leadAgentRuns(leadId);
    expect(runs[0]).toMatchObject({ id: row.l1!.runId, agent: "ingestion.l1_classifier", tier: "L1", status: "FALLBACK" });
    expect(runs[0].provenance.mode).toBe("TEMPLATE");
    expect(await leadAgentRuns("nope")).toEqual([]);
  });

  it("filters by status, refuses an unknown one, and links a converted lead to its package code", async () => {
    const a = (await ingestLead("WEB_FORM", corporateForm(), { verified: true })).leadId!;
    await triageLead(a);
    const { package: pkg } = await convertLeadToPackage(a, { title: "Supervisory Skills", deliveryMode: "IN_HOUSE", pax: 25 }, ALEX);
    const converted = await listLeadInbox({ status: "CONVERTED" });
    expect(converted.map((r) => r.id)).toContain(a);
    expect(converted.every((r) => r.status === "CONVERTED")).toBe(true);
    expect(converted.find((r) => r.id === a)?.packageCode).toBe(pkg.packageCode);
    expect((await listLeadInbox({ status: "ARCHIVED" })).map((r) => r.id)).not.toContain(a);
    await expect(listLeadInbox({ status: "WON" as never })).rejects.toThrow(/Unknown lead status/);
    expect(await leadInboxRow("not-a-uuid")).toBeUndefined();
  });
});

describe("listCourses — the catalog list", () => {
  it("lists every course without the vector, with embedding and usage facts", async () => {
    await seedKnowledge(db());
    const courses = await listCourses();
    expect(courses).toHaveLength(COURSE_SEEDS.length);
    const first = courses[0] as unknown as Record<string, unknown>;
    expect(first).not.toHaveProperty("syllabusEmbedding");
    expect(courses.every((c) => c.embedded && c.embeddingModel && c.outcomeCount > 0 && c.packages === 0)).toBe(true);
    const sup = courses.find((c) => c.courseCode === "SUP-101")!;
    expect(sup).toMatchObject({ targetSeniority: "SUPERVISORY", level: 1, nextCourseCode: "LEAD-201", durationDays: 2 });
  });
});

describe("Cost matrix versions — publish, never rewrite", () => {
  it("counts quotations per version and mode, and resolves the version in force", async () => {
    await seedCostPolicies(db());
    await buildPackageAt("QUOTED"); // an IN_HOUSE package with one ACM-2026.1 quotation
    const versions = await listPolicyVersions("2026-06-01");
    const inHouse = versions.find((v) => v.deliveryMode === "IN_HOUSE" && v.version === "ACM-2026.1")!;
    const rot = versions.find((v) => v.deliveryMode === "ROT_VIRTUAL")!;
    expect(inHouse).toMatchObject({ quotations: 1, inForce: true, scheduled: false, supersededBy: null });
    expect(rot.quotations).toBe(0);
    expect((await listPolicyVersions("2025-06-01")).some((v) => v.inForce)).toBe(false);
  });

  it("publishes a revised version that supersedes from its effective date and leaves the old row untouched", async () => {
    const source = (await listPolicies()).find((p) => p.deliveryMode === "IN_HOUSE" && p.version === "ACM-2026.1")!;
    const next = [
      { minPax: 1, maxPax: 10, dailyCap: 6500 },
      { minPax: 11, maxPax: 25, dailyCap: 9000 },
      { minPax: 26, maxPax: 60, dailyCap: 14000 },
    ];
    const created = await publishPolicyVersion(source.id, { version: "ACM-2027.1", effectiveFrom: "2027-01-01", bands: next }, ALEX);
    expect(created).toMatchObject({ version: "ACM-2027.1", deliveryMode: "IN_HOUSE", basis: source.basis, effectiveFrom: "2027-01-01", active: true, bands: next });

    const still = (await listPolicies()).find((p) => p.id === source.id)!;
    expect(still.bands).toEqual(source.bands);

    const mid2026 = await listPolicyVersions("2026-06-01");
    expect(mid2026.find((v) => v.id === source.id)).toMatchObject({ inForce: true, supersededBy: "ACM-2027.1" });
    expect(mid2026.find((v) => v.id === created.id)).toMatchObject({ inForce: false, scheduled: true, quotations: 0 });
    const y2027 = await listPolicyVersions("2027-02-01");
    expect(y2027.find((v) => v.id === created.id)).toMatchObject({ inForce: true, scheduled: false });
    expect(y2027.find((v) => v.id === source.id)?.inForce).toBe(false);

    const [audit] = await rows<{ actor_id: string; reason_code: string; metadata_diff: { supersedes: { version: string }; bands: { old: unknown; new: unknown } } }>(
      db(),
      sql`select actor_id, reason_code, metadata_diff from tpms.audit_ledger where entity_type = 'COST_POLICY' and entity_id = ${created.id}::uuid`,
    );
    expect(audit).toMatchObject({ actor_id: ALEX.id, reason_code: "COST_POLICY_PUBLISHED" });
    expect(audit.metadata_diff.supersedes.version).toBe("ACM-2026.1");
    expect(audit.metadata_diff.bands).toEqual({ old: source.bands, new: next });
  });

  it("refuses a reused label, a back-dated revision, gapped bands and a non-operator", async () => {
    const source = (await listPolicies()).find((p) => p.deliveryMode === "IN_HOUSE" && p.version === "ACM-2026.1")!;
    const before = (await listPolicies()).length;
    await expect(publishPolicyVersion(source.id, { version: "acm-2027.1", effectiveFrom: "2027-03-01", bands: source.bands }, ALEX)).rejects.toMatchObject({
      code: "COST_POLICY_VERSION_EXISTS",
    });
    await expect(publishPolicyVersion(source.id, { version: "ACM-2025.9", effectiveFrom: "2025-12-01", bands: source.bands }, ALEX)).rejects.toMatchObject({
      code: "COST_POLICY_BACKDATED",
    });
    await expect(
      publishPolicyVersion(source.id, { version: "ACM-2027.2", effectiveFrom: "2027-03-01", bands: [{ minPax: 2, maxPax: 60, dailyCap: 9000 }] }, ALEX),
    ).rejects.toMatchObject({ code: "INVALID_COST_BANDS" });
    await expect(publishPolicyVersion(source.id, { version: "ACM-2027.2", effectiveFrom: "2027-02-30", bands: source.bands }, ALEX)).rejects.toMatchObject({
      code: "INVALID_EFFECTIVE_DATE",
    });
    await expect(publishPolicyVersion(source.id, { version: "ACM 2027", effectiveFrom: "2027-03-01", bands: source.bands }, ALEX)).rejects.toMatchObject({
      code: "INVALID_POLICY_VERSION",
    });
    await expect(publishPolicyVersion(source.id, { version: "ACM-2027.2", effectiveFrom: "2027-03-01", bands: source.bands }, SYSTEM_ACTOR)).rejects.toMatchObject({
      code: "USER_REQUIRED",
    });
    expect((await listPolicies()).length).toBe(before);
  });

  it("corrects bands in place only while no quotation cites the version", async () => {
    const cited = (await listPolicies()).find((p) => p.deliveryMode === "IN_HOUSE" && p.version === "ACM-2026.1")!;
    await expect(correctPolicyBands(cited.id, cited.bands, ALEX)).rejects.toMatchObject({ code: "COST_POLICY_IN_USE" });
    const fresh = (await listPolicies()).find((p) => p.version === "ACM-2027.1")!;
    const fixed = [
      { minPax: 1, maxPax: 10, dailyCap: 6500 },
      { minPax: 11, maxPax: 25, dailyCap: 9100 },
      { minPax: 26, maxPax: 60, dailyCap: 14000 },
    ];
    expect((await correctPolicyBands(fresh.id, fixed, ALEX)).bands).toEqual(fixed);
    await expect(correctPolicyBands(fresh.id, fixed, SYSTEM_ACTOR)).rejects.toMatchObject({ code: "USER_REQUIRED" });
  });
});

describe("listDraftRequests — queued outbound drafting", () => {
  it("shows a request the worker has not drafted yet", async () => {
    const { taskId } = await requestDraftSequence(
      { targets: [{ company: "Ui2 Target Sdn Bhd", picEmail: "hr@ui2-target.com.my" }, { company: "Ui2 Other Bhd", picEmail: "hr@ui2-other.com.my" }], campaignNote: "UI-2 test" },
      ALEX,
    );
    const open = await listDraftRequests();
    expect(open.find((r) => r.taskId === taskId)).toMatchObject({ status: "QUEUED", targets: 2, campaignNote: "UI-2 test", requestedBy: ALEX.id, attempts: 0 });
    await db().execute(sql`update tpms.task_queue set status = 'COMPLETED', completed_at = now() where id = ${taskId}::uuid`);
    expect((await listDraftRequests()).map((r) => r.taskId)).not.toContain(taskId);
  });

  it("labels each batch with its campaign note and drafter", async () => {
    const drafted = await draftSequence({ targets: [{ company: "Ui2 Notes Sdn Bhd", picEmail: "hr@ui2-notes.com.my" }], campaignNote: "Levy expiry Q4" }, ALEX);
    const notes = await batchNotes([drafted.batchId, "not-a-uuid"]);
    expect(notes).toEqual({ [drafted.batchId]: { campaignNote: "Levy expiry Q4", draftedBy: ALEX.id } });
    expect(await batchNotes([])).toEqual({});
  });
});
