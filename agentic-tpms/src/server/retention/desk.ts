import { inArray } from "drizzle-orm";
import { db, schema } from "../db/client";
import { listRetention, type RetentionRow } from "./schedule";

/**
 * The Retention desk's rows: `listRetention` plus who an approved draft goes
 * to (the client's primary PIC, the address `approveRetention` sends to) and,
 * for the T+90 ladder, the recommended course. An operator approving an
 * outbound email sees its recipient before it leaves.
 */
export type RetentionDeskRow = RetentionRow & {
  picName: string;
  picEmail: string;
  recommendedCourse: { code: string; title: string } | null;
};

export async function listRetentionDesk(opts: { status?: string } = {}): Promise<RetentionDeskRow[]> {
  const base = await listRetention({ status: opts.status });
  const clientIds = [...new Set(base.map((r) => r.clientId))];
  const courseIds = [...new Set(base.map((r) => r.recommendedCourseId).filter((id): id is string => Boolean(id)))];
  const [clients, courses] = await Promise.all([
    clientIds.length
      ? db()
          .select({ id: schema.corporateClients.id, name: schema.corporateClients.primaryPicName, email: schema.corporateClients.primaryPicEmail })
          .from(schema.corporateClients)
          .where(inArray(schema.corporateClients.id, clientIds))
      : Promise.resolve([]),
    courseIds.length
      ? db()
          .select({ id: schema.courseCatalog.id, code: schema.courseCatalog.courseCode, title: schema.courseCatalog.title })
          .from(schema.courseCatalog)
          .where(inArray(schema.courseCatalog.id, courseIds))
      : Promise.resolve([]),
  ]);
  const client = new Map(clients.map((c) => [c.id, c]));
  const course = new Map(courses.map((c) => [c.id, c]));
  return base.map((r) => {
    const c = client.get(r.clientId);
    if (!c) throw new Error(`Retention schedule ${r.id} has no client ${r.clientId}`);
    const k = r.recommendedCourseId ? course.get(r.recommendedCourseId) : undefined;
    return { ...r, picName: c.name, picEmail: c.email, recommendedCourse: k ? { code: k.code, title: k.title } : null };
  });
}

