import { and, eq, sql } from "drizzle-orm";
import { embed } from "../ai";
import { type Executor, rows, schema } from "../db/client";
import type { TrainingPackage } from "../db/schema";

/**
 * T+90 syllabus ladder: which course to propose next.
 *
 *   1. the source course's `next_course_code`, when the catalog has it and the
 *      client has not already taken it (the curriculum designer's ladder wins);
 *   2. otherwise the nearest HIGHER-level course by pgvector cosine distance
 *      to the source syllabus (or to the package title when the package has
 *      no catalog course), excluding courses the client already took.
 *
 * The distance scan is exact on purpose (a materialised CTE, not the HNSW
 * index): the catalog is hundreds of rows, and an approximate index scan
 * combined with a WHERE filter can silently return nothing.
 */
export type LadderRecommendation = {
  courseId: string;
  courseCode: string;
  title: string;
  level: number;
  durationDays: number;
  hrdFocusArea: string;
  basis: "NEXT_COURSE_CODE" | "SIMILARITY";
  /** Cosine similarity to the source syllabus (1 = identical); null for a designed next step. */
  similarity: number | null;
  sourceCourseCode: string | null;
};

export async function recommendNextCourse(executor: Executor, pkg: TrainingPackage): Promise<LadderRecommendation | null> {
  const takenRows = await rows<{ course_id: string }>(
    executor,
    sql`select distinct course_id from tpms.training_packages
         where client_id = ${pkg.clientId}::uuid and course_id is not null and operational_stage <> 'CANCELLED'`,
  );
  const taken = new Set(takenRows.map((r) => r.course_id));
  const [source] = pkg.courseId
    ? await executor.select().from(schema.courseCatalog).where(eq(schema.courseCatalog.id, pkg.courseId))
    : [];

  if (source?.nextCourseCode) {
    const [next] = await executor.select().from(schema.courseCatalog).where(and(eq(schema.courseCatalog.courseCode, source.nextCourseCode)));
    if (next && !taken.has(next.id)) {
      return {
        courseId: next.id,
        courseCode: next.courseCode,
        title: next.title,
        level: next.level,
        durationDays: next.durationDays,
        hrdFocusArea: next.hrdFocusArea,
        basis: "NEXT_COURSE_CODE",
        similarity: null,
        sourceCourseCode: source.courseCode,
      };
    }
  }

  const vector =
    source?.syllabusEmbedding && source.syllabusEmbedding.length > 0
      ? source.syllabusEmbedding
      : (await embed([[pkg.title, source?.title, source?.masterOutlineMarkdown].filter(Boolean).join("\n")])).vectors[0];
  const literal = `[${vector.join(",")}]`;
  const excluded = `{${[...taken, ...(source ? [source.id] : [])].join(",")}}`;
  const [best] = await rows<{
    id: string;
    course_code: string;
    title: string;
    level: number;
    duration_days: number;
    hrd_focus_area: string;
    distance: number;
  }>(
    executor,
    sql`with candidates as materialized (
          select id, course_code, title, level, duration_days, hrd_focus_area,
                 syllabus_embedding <=> ${literal}::vector as distance
            from tpms.course_catalog
           where syllabus_embedding is not null
             and level > ${source?.level ?? 0}
             and not (id = any (${excluded}::uuid[]))
        )
        select * from candidates order by distance, level, course_code limit 1`,
  );
  if (!best) return null;
  return {
    courseId: best.id,
    courseCode: best.course_code,
    title: best.title,
    level: best.level,
    durationDays: best.duration_days,
    hrdFocusArea: best.hrd_focus_area,
    basis: "SIMILARITY",
    similarity: Math.round((1 - Number(best.distance)) * 1000) / 1000,
    sourceCourseCode: source?.courseCode ?? null,
  };
}
