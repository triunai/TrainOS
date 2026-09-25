import { sql } from "drizzle-orm";
import { type Executor, db, rows } from "../db/client";
import type { Seniority } from "./catalog";

/**
 * Read models for the Course catalog screen (UI-2). The catalog list never
 * carries the 1536-d syllabus vector: it is a search index, not something a
 * page renders, and it would be ~12 KB of JSON per course on the wire.
 */
export interface CourseSummary {
  id: string;
  courseCode: string;
  title: string;
  hrdFocusArea: string;
  matchedNossCode: string | null;
  targetSeniority: Seniority;
  level: number;
  nextCourseCode: string | null;
  durationDays: number;
  outcomeCount: number;
  /** Whether a syllabus vector exists, and which model wrote it. */
  embedded: boolean;
  embeddingModel: string | null;
  /** Training packages built on this course. */
  packages: number;
}

export async function listCourses(executor: Executor = db()): Promise<CourseSummary[]> {
  const result = await rows<{
    id: string;
    course_code: string;
    title: string;
    hrd_focus_area: string;
    matched_noss_code: string | null;
    target_seniority: Seniority;
    level: number;
    next_course_code: string | null;
    duration_days: number;
    outcome_count: number;
    embedded: boolean;
    embedding_model: string | null;
    packages: number;
  }>(
    executor,
    sql`select c.id, c.course_code, c.title, c.hrd_focus_area, c.matched_noss_code, c.target_seniority, c.level,
               c.next_course_code, c.duration_days, jsonb_array_length(c.learning_outcomes)::int as outcome_count,
               c.syllabus_embedding is not null as embedded, c.embedding_model,
               (select count(*)::int from tpms.training_packages p where p.course_id = c.id) as packages
          from tpms.course_catalog c
         order by c.hrd_focus_area, c.level, c.course_code`,
  );
  return result.map((r) => ({
    id: r.id,
    courseCode: r.course_code,
    title: r.title,
    hrdFocusArea: r.hrd_focus_area,
    matchedNossCode: r.matched_noss_code,
    targetSeniority: r.target_seniority,
    level: r.level,
    nextCourseCode: r.next_course_code,
    durationDays: r.duration_days,
    outcomeCount: r.outcome_count,
    embedded: r.embedded,
    embeddingModel: r.embedding_model,
    packages: r.packages,
  }));
}
