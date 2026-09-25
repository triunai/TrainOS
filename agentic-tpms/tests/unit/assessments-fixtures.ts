import { sql } from "drizzle-orm";
import { type Executor, rows } from "@/server/db/client";
import type { CourseForQuiz } from "@/server/assessments";

/**
 * Lane D's own tiny catalogue — two courses in different focus areas, so the
 * template generator has cross-catalogue distractors. Deliberately independent
 * of the product seed.
 */
export const CHANGE_COURSE = {
  courseCode: "LD-CHG-101",
  title: "Leading Through Change",
  hrdFocusArea: "Leadership and Management",
  targetSeniority: "SUPERVISORY",
  learningOutcomes: [
    { verb: "Explain", outcome: "the four stages of the change curve and how people move through them", bloomLevel: 2 },
    { verb: "Apply", outcome: "the ADKAR model to plan a change initiative", bloomLevel: 3 },
    { verb: "Analyse", outcome: "sources of resistance within a team", bloomLevel: 4 },
    { verb: "Design", outcome: "a stakeholder communication plan for a restructuring", bloomLevel: 6 },
  ],
  masterOutlineMarkdown: [
    "# Leading Through Change",
    "## Module 1: Why change fails",
    "- The change curve",
    "- Common failure patterns",
    "## Module 2: The ADKAR model",
    "- Awareness and desire",
    "- Knowledge, ability and reinforcement",
    "## Module 3: Managing resistance",
    "- Diagnosing resistance",
    "- Coaching conversations",
    "## Module 4: Communicating change",
    "- Stakeholder mapping",
    "- Message sequencing",
  ].join("\n"),
};

export const EXCEL_COURSE = {
  courseCode: "DT-XLS-201",
  title: "Excel for Operations Reporting",
  hrdFocusArea: "Digital Transformation",
  targetSeniority: "OPERATIONAL",
  learningOutcomes: [
    { verb: "Build", outcome: "a pivot table that summarises weekly output by line", bloomLevel: 3 },
    { verb: "Use", outcome: "XLOOKUP to join production and downtime data", bloomLevel: 3 },
    { verb: "Create", outcome: "a one-page operations dashboard", bloomLevel: 6 },
  ],
  masterOutlineMarkdown: [
    "## Module 1: Clean data",
    "- Tables and structured references",
    "- Removing duplicates",
    "## Module 2: Summaries",
    "- Pivot tables",
    "- Slicers",
  ].join("\n"),
};

export function asCourse(id: string, c: typeof CHANGE_COURSE): CourseForQuiz {
  return { id, ...c };
}

export async function insertCourse(executor: Executor, c: typeof CHANGE_COURSE): Promise<string> {
  const [row] = await rows<{ id: string }>(
    executor,
    sql`insert into tpms.course_catalog (course_code, title, hrd_focus_area, target_seniority, duration_days,
                                         learning_outcomes, master_outline_markdown)
        values (${c.courseCode}, ${c.title}, ${c.hrdFocusArea}, ${c.targetSeniority}, 2,
                ${JSON.stringify(c.learningOutcomes)}::jsonb, ${c.masterOutlineMarkdown})
        returning id`,
  );
  return row.id;
}
