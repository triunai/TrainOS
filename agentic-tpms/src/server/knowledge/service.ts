import { eq, sql, type SQL } from "drizzle-orm";
import { currentEmbeddingModel, embed, embedQuery, sameModelFamily } from "@/server/ai";
import { type Executor, db, rows, schema } from "../db/client";
import type { LearningOutcome } from "../db/schema";
import { DomainError } from "../domain/errors";
import { COURSE_SEEDS, KNOWLEDGE_CHUNK_SEEDS, courseEmbeddingText, type Seniority } from "./catalog";

/**
 * The Stage-2 knowledge base: course catalog + (illustrative) NOSS and
 * focus-area chunks, embedded into pgvector.
 *
 * WHY every vector query filters on `embedding_model`: vectors from two
 * models live in different spaces, and a cosine distance between them is a
 * confident-looking number that means nothing. The query is embedded with the
 * STORED rows' model (`embedQuery(text, storedModel)`), and only rows of that
 * model are ranked. When that model is unreachable (no key, budget spent,
 * outage) the search degrades to Postgres full-text ranking and says so in
 * `matchedBy`, rather than ranking by noise.
 */
export type Course = typeof schema.courseCatalog.$inferSelect;

export const SENIORITIES = ["EXECUTIVE", "SUPERVISORY", "OPERATIONAL"] as const;

export function isSeniority(value: unknown): value is Seniority {
  return typeof value === "string" && (SENIORITIES as readonly string[]).includes(value);
}

const vectorLiteral = (v: number[]): string => `[${v.join(",")}]`;

export async function seedKnowledge(executor: Executor = db()): Promise<{ courses: number; chunks: number; embedded: number }> {
  let courses = 0;
  for (const c of COURSE_SEEDS) {
    const inserted = await executor
      .insert(schema.courseCatalog)
      .values({
        courseCode: c.courseCode,
        title: c.title,
        hrdFocusArea: c.hrdFocusArea,
        matchedNossCode: c.matchedNossCode,
        targetSeniority: c.targetSeniority,
        level: c.level,
        nextCourseCode: c.nextCourseCode,
        durationDays: c.durationDays,
        learningOutcomes: c.learningOutcomes,
        masterOutlineMarkdown: c.masterOutlineMarkdown,
      })
      .onConflictDoNothing()
      .returning({ id: schema.courseCatalog.id });
    courses += inserted.length;
  }
  let chunks = 0;
  for (const k of KNOWLEDGE_CHUNK_SEEDS) {
    const inserted = await executor
      .insert(schema.knowledgeChunks)
      .values({ sourceType: k.sourceType, sourceRef: k.sourceRef, title: k.title, body: k.body })
      .onConflictDoNothing()
      .returning({ id: schema.knowledgeChunks.id });
    chunks += inserted.length;
  }
  const embedded = await embedCatalog(executor);
  return { courses, chunks, embedded };
}

/**
 * Embed every course and chunk that has no vector, or whose vector is from a
 * different model family than the one configured now. Idempotent; this is
 * also the `knowledge.embed` task body. `force` re-embeds everything.
 */
export async function embedCatalog(executor: Executor = db(), opts: { force?: boolean } = {}): Promise<number> {
  const model = await currentEmbeddingModel();
  const stale = (row: { has_vector: boolean; embedding_model: string | null }) =>
    opts.force || !row.has_vector || !row.embedding_model || !sameModelFamily(row.embedding_model, model);

  const courses = (
    await rows<{ id: string; title: string; hrd_focus_area: string; target_seniority: string; learning_outcomes: LearningOutcome[]; master_outline_markdown: string; has_vector: boolean; embedding_model: string | null }>(
      executor,
      sql`select id, title, hrd_focus_area, target_seniority, learning_outcomes, master_outline_markdown,
                 syllabus_embedding is not null as has_vector, embedding_model
            from tpms.course_catalog order by course_code`,
    )
  ).filter(stale);
  let written = 0;
  if (courses.length > 0) {
    const texts = courses.map((c) =>
      courseEmbeddingText({
        title: c.title,
        hrdFocusArea: c.hrd_focus_area,
        targetSeniority: c.target_seniority as Seniority,
        learningOutcomes: c.learning_outcomes,
        masterOutlineMarkdown: c.master_outline_markdown,
      }),
    );
    const { vectors, model: used } = await embed(texts, { agent: "knowledge.embedder" });
    for (let i = 0; i < courses.length; i += 1) {
      await executor.execute(sql`update tpms.course_catalog
           set syllabus_embedding = ${vectorLiteral(vectors[i])}::vector, embedding_model = ${used}
         where id = ${courses[i].id}::uuid`);
      written += 1;
    }
  }

  const chunks = (
    await rows<{ id: string; title: string; body: string; has_vector: boolean; embedding_model: string | null }>(
      executor,
      sql`select id, title, body, embedding is not null as has_vector, embedding_model from tpms.knowledge_chunks order by source_ref`,
    )
  ).filter(stale);
  if (chunks.length > 0) {
    const { vectors, model: used } = await embed(chunks.map((c) => `${c.title}\n${c.body}`), { agent: "knowledge.embedder" });
    for (let i = 0; i < chunks.length; i += 1) {
      await executor.execute(sql`update tpms.knowledge_chunks
           set embedding = ${vectorLiteral(vectors[i])}::vector, embedding_model = ${used}
         where id = ${chunks[i].id}::uuid`);
      written += 1;
    }
  }
  return written;
}

/** The model most of a table's vectors were written by (null when nothing is embedded). */
async function storedModel(executor: Executor, table: "course_catalog" | "knowledge_chunks"): Promise<string | null> {
  const column = table === "course_catalog" ? sql`syllabus_embedding` : sql`embedding`;
  const from = table === "course_catalog" ? sql`tpms.course_catalog` : sql`tpms.knowledge_chunks`;
  const [row] = await rows<{ embedding_model: string }>(
    executor,
    sql`select embedding_model from ${from} where ${column} is not null and embedding_model is not null
         group by embedding_model order by count(*) desc, embedding_model limit 1`,
  );
  return row?.embedding_model ?? null;
}

/** An OR-of-terms tsquery for the lexical fallback; null when the query has no usable words. */
function orTsQuery(text: string): string | null {
  const terms = [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2))].slice(0, 32);
  return terms.length ? terms.join(" | ") : null;
}

export interface CourseHit {
  id: string;
  courseCode: string;
  title: string;
  hrdFocusArea: string;
  targetSeniority: Seniority;
  level: number;
  nextCourseCode: string | null;
  durationDays: number;
  /** VECTOR: cosine similarity in [-1, 1]. LEXICAL: Postgres ts_rank_cd. Higher is closer either way. */
  score: number;
  matchedBy: "VECTOR" | "LEXICAL";
}

export interface SearchOptions {
  limit?: number;
  seniority?: Seniority;
  executor?: Executor;
}

type CourseRow = {
  id: string;
  course_code: string;
  title: string;
  hrd_focus_area: string;
  target_seniority: Seniority;
  level: number;
  next_course_code: string | null;
  duration_days: number;
  score: number;
};

export async function searchCourses(query: string, opts: SearchOptions = {}): Promise<CourseHit[]> {
  const executor = opts.executor ?? db();
  const text = query.trim();
  if (!text) throw new DomainError("EMPTY_QUERY", "Describe the training need to search the catalog");
  if (opts.seniority !== undefined && !isSeniority(opts.seniority)) {
    throw new DomainError("UNKNOWN_SENIORITY", `Unknown seniority ${String(opts.seniority)}`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50);
  const seniority: SQL = opts.seniority ? sql`and target_seniority = ${opts.seniority}` : sql``;
  const columns = sql`id, course_code, title, hrd_focus_area, target_seniority, level, next_course_code, duration_days`;

  let model = await storedModel(executor, "course_catalog");
  if (!model && (await embedCatalog(executor)) > 0) model = await storedModel(executor, "course_catalog");

  let hits: CourseRow[] = [];
  let matchedBy: CourseHit["matchedBy"] = "VECTOR";
  const q = model ? await embedQuery(text, model, { agent: "knowledge.search" }) : null;
  if (model && q?.comparable) {
    const vec = vectorLiteral(q.vector);
    hits = await rows<CourseRow>(
      executor,
      sql`select ${columns}, 1 - (syllabus_embedding <=> ${vec}::vector) as score
            from tpms.course_catalog
           where syllabus_embedding is not null and embedding_model = ${model} ${seniority}
           order by syllabus_embedding <=> ${vec}::vector, course_code
           limit ${limit}`,
    );
  } else {
    matchedBy = "LEXICAL";
    const tsq = orTsQuery(text);
    if (tsq) {
      const doc = sql`to_tsvector('english', title || ' ' || title || ' ' || hrd_focus_area || ' ' || master_outline_markdown)`;
      hits = await rows<CourseRow>(
        executor,
        sql`select ${columns}, ts_rank_cd(${doc}, to_tsquery('english', ${tsq})) as score
              from tpms.course_catalog
             where ${doc} @@ to_tsquery('english', ${tsq}) ${seniority}
             order by score desc, course_code
             limit ${limit}`,
      );
    }
  }
  return hits.map((h) => ({
    id: h.id,
    courseCode: h.course_code,
    title: h.title,
    hrdFocusArea: h.hrd_focus_area,
    targetSeniority: h.target_seniority,
    level: h.level,
    nextCourseCode: h.next_course_code,
    durationDays: h.duration_days,
    score: Number(h.score),
    matchedBy,
  }));
}

export interface ChunkHit {
  id: string;
  sourceType: string;
  sourceRef: string;
  title: string;
  body: string;
  score: number;
  matchedBy: "VECTOR" | "LEXICAL";
}

/** NOSS / focus-area context for an outline or a TNA reply. Same single-model rule as `searchCourses`. */
export async function searchKnowledge(query: string, opts: { limit?: number; executor?: Executor } = {}): Promise<ChunkHit[]> {
  const executor = opts.executor ?? db();
  const text = query.trim();
  if (!text) return [];
  const limit = Math.min(Math.max(opts.limit ?? 3, 1), 20);
  const model = await storedModel(executor, "knowledge_chunks");
  const q = model ? await embedQuery(text, model, { agent: "knowledge.search" }) : null;
  type Row = { id: string; source_type: string; source_ref: string; title: string; body: string; score: number };
  let hits: Row[] = [];
  let matchedBy: ChunkHit["matchedBy"] = "VECTOR";
  if (model && q?.comparable) {
    const vec = vectorLiteral(q.vector);
    hits = await rows<Row>(
      executor,
      sql`select id, source_type, source_ref, title, body, 1 - (embedding <=> ${vec}::vector) as score
            from tpms.knowledge_chunks
           where embedding is not null and embedding_model = ${model}
           order by embedding <=> ${vec}::vector, source_ref
           limit ${limit}`,
    );
  } else {
    matchedBy = "LEXICAL";
    const tsq = orTsQuery(text);
    if (tsq) {
      const doc = sql`to_tsvector('english', title || ' ' || body)`;
      hits = await rows<Row>(
        executor,
        sql`select id, source_type, source_ref, title, body, ts_rank_cd(${doc}, to_tsquery('english', ${tsq})) as score
              from tpms.knowledge_chunks
             where ${doc} @@ to_tsquery('english', ${tsq})
             order by score desc, source_ref
             limit ${limit}`,
      );
    }
  }
  return hits.map((h) => ({ id: h.id, sourceType: h.source_type, sourceRef: h.source_ref, title: h.title, body: h.body, score: Number(h.score), matchedBy }));
}

export async function getCourse(id: string, executor: Executor = db()): Promise<Course | undefined> {
  const [row] = await executor.select().from(schema.courseCatalog).where(eq(schema.courseCatalog.id, id));
  return row;
}

export async function getCourseByCode(code: string, executor: Executor = db()): Promise<Course | undefined> {
  const [row] = await executor.select().from(schema.courseCatalog).where(eq(schema.courseCatalog.courseCode, code));
  return row;
}
