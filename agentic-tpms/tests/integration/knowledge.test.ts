import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_EMBEDDING_MODEL } from "@/server/ai";
import { db, rows } from "@/server/db/client";
import { COURSE_SEEDS, KNOWLEDGE_CHUNK_SEEDS, embedCatalog, getCourseByCode, searchCourses, searchKnowledge, seedKnowledge, validateOutcomes } from "@/server/knowledge";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";

beforeAll(async () => {
  await useTestDatabase();
});
afterAll(releaseTestDatabase);

describe("knowledge base (pgvector)", () => {
  it("seeds the catalog and chunks, embedded and tagged with the model that wrote them", async () => {
    const first = await seedKnowledge(db());
    expect(first.courses).toBe(COURSE_SEEDS.length);
    expect(first.chunks).toBe(KNOWLEDGE_CHUNK_SEEDS.length);
    expect(first.embedded).toBe(COURSE_SEEDS.length + KNOWLEDGE_CHUNK_SEEDS.length);

    const [stats] = await rows<{ n: number; embedded: number; models: string[] }>(
      db(),
      sql`select count(*)::int as n, count(syllabus_embedding)::int as embedded, array_agg(distinct embedding_model) as models
            from tpms.course_catalog`,
    );
    expect(stats).toEqual({ n: 12, embedded: 12, models: [LOCAL_EMBEDDING_MODEL] });
    const [dims] = await rows<{ d: number }>(db(), sql`select vector_dims(syllabus_embedding) as d from tpms.course_catalog limit 1`);
    expect(dims.d).toBe(1536);

    const again = await seedKnowledge(db());
    expect(again).toEqual({ courses: 0, chunks: 0, embedded: 0 });
  });

  it("labels NOSS codes as illustrative placeholders, never as real JPK codes", async () => {
    const codes = await rows<{ matched_noss_code: string }>(db(), sql`select matched_noss_code from tpms.course_catalog`);
    for (const c of codes) expect(c.matched_noss_code).toMatch(/^ILLUS-/);
    const chunks = await rows<{ source_ref: string; title: string }>(db(), sql`select source_ref, title from tpms.knowledge_chunks`);
    for (const c of chunks) {
      expect(c.source_ref).toMatch(/^ILLUS-/);
      expect(c.title.toLowerCase()).toContain("illustrative");
    }
  });

  it("ranks a leadership query to the leadership course first", async () => {
    const hits = await searchCourses("strategic leadership and conflict management for senior managers leading change", { limit: 3 });
    expect(hits[0].courseCode).toBe("LEAD-201");
    expect(hits[0].matchedBy).toBe("VECTOR");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);

    const supervisors = await searchCourses("supervisory skills for newly promoted supervisors: delegation, coaching and feedback", { limit: 3 });
    expect(supervisors[0].courseCode).toBe("SUP-101");

    const safety = await searchCourses("HIRARC hazard identification risk assessment for the factory floor", { limit: 1 });
    expect(safety[0].courseCode).toBe("OSH-201");

    const audit = await searchCourses("ISO 9001 internal auditor training", { limit: 1 });
    expect(audit[0].courseCode).toBe("QMS-201");
  });

  it("filters by seniority", async () => {
    const hits = await searchCourses("leadership coaching feedback delegation", { limit: 12, seniority: "EXECUTIVE" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.targetSeniority === "EXECUTIVE")).toBe(true);
    expect(hits.map((h) => h.courseCode)).not.toContain("SUP-101");
  });

  it("keeps the supervisory → strategic leadership ladder", async () => {
    const sup = await getCourseByCode("SUP-101");
    expect(sup?.nextCourseCode).toBe("LEAD-201");
    expect(sup?.level).toBe(1);
    const lead = await getCourseByCode("LEAD-201");
    expect(lead?.level).toBe(2);
    expect(validateOutcomes(lead!.learningOutcomes).ok).toBe(true);
  });

  it("searches NOSS and focus-area chunks", async () => {
    const hits = await searchKnowledge("hazard identification and risk control", { limit: 3 });
    expect(hits.map((h) => h.sourceRef)).toContain("ILLUS-NOSS-OSH-L3");
  });

  it("never compares vectors across models: an unreachable stored model degrades to lexical search", async () => {
    // Most rows now claim a model this deployment cannot call (no key): ranking them with a local
    // query vector would be noise, so the search must fall back to full-text ranking and say so.
    await db().execute(sql`update tpms.course_catalog set embedding_model = 'vendor/some-other-embedding' where course_code <> 'LEAD-201'`);
    const lexical = await searchCourses("strategic leadership and conflict management", { limit: 3 });
    expect(lexical[0].matchedBy).toBe("LEXICAL");
    expect(lexical[0].courseCode).toBe("LEAD-201");

    const rewritten = await embedCatalog(db());
    expect(rewritten).toBe(11);
    const vector = await searchCourses("strategic leadership and conflict management", { limit: 1 });
    expect(vector[0]).toMatchObject({ courseCode: "LEAD-201", matchedBy: "VECTOR" });
  });

  it("refuses an empty query and an unknown seniority", async () => {
    await expect(searchCourses("   ")).rejects.toMatchObject({ code: "EMPTY_QUERY" });
    await expect(searchCourses("leadership", { seniority: "INTERN" as never })).rejects.toMatchObject({ code: "UNKNOWN_SENIORITY" });
  });
});
