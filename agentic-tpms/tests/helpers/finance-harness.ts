import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import type { Task } from "@/server/db/schema";
import { completeTask, type TaskType } from "@/server/queue/queue";
import type { HandlerMap } from "@/server/queue/registry";
import { storeDocument } from "@/server/storage/vault";
import { ALEX } from "./factory";

/**
 * Lane E test harness: run one specific queued task through its handler the
 * way the worker would (handler, then completeTask), without leasing other
 * packages' tasks that share the database.
 */
export async function queuedTask(type: TaskType, match: Record<string, string>, id?: string): Promise<Task | undefined> {
  const [task] = await db()
    .select()
    .from(schema.taskQueue)
    .where(
      and(
        eq(schema.taskQueue.taskType, type),
        eq(schema.taskQueue.status, "QUEUED"),
        sql`${schema.taskQueue.payload} @> ${JSON.stringify(match)}::jsonb`,
        id ? eq(schema.taskQueue.id, id) : undefined,
      ),
    )
    .orderBy(asc(schema.taskQueue.createdAt))
    .limit(1);
  return task;
}

export async function runQueued(
  handlers: HandlerMap,
  type: TaskType,
  match: Record<string, string>,
  id?: string,
): Promise<Record<string, unknown>> {
  const task = await queuedTask(type, match, id);
  if (!task) throw new Error(`No queued ${type} task matching ${JSON.stringify(match)}`);
  const handler = handlers[type];
  if (!handler) throw new Error(`No handler for ${type}`);
  const result = await handler(task, { workerId: "lane-e-test", heartbeat: async () => undefined });
  await completeTask(task.id, result);
  return result;
}

export const pdfBytes = (label: string) => new TextEncoder().encode(`%PDF-1.4\n% lane-e ${label} ${Math.random()}\n%%EOF\n`);

export async function uploadEvidence(packageId: string, documentType: string, fileName = `${documentType.toLowerCase()}.pdf`) {
  return storeDocument(db(), {
    packageId,
    documentType,
    fileName,
    mimeType: "application/pdf",
    bytes: pdfBytes(documentType),
    uploadedBy: ALEX.id,
  });
}

export async function vaultOf(packageId: string, documentType?: string) {
  const all = await db().select().from(schema.complianceVault).where(eq(schema.complianceVault.packageId, packageId));
  return documentType ? all.filter((d) => d.documentType === documentType) : all;
}
