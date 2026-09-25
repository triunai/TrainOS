import { z } from "zod";
import type { Executor } from "../db/client";
import { DomainError } from "../domain/errors";
import type { HandlerMap, TaskHandler } from "../queue/registry";
import { embedCatalog, seedKnowledge } from "@/server/knowledge";
import { seedCostPolicies } from "@/server/pricing";
import { compileDossier, extractApprovalLetter } from "@/server/grant";
import { dispatchQuotation } from "./dispatch";
import { draftProposal } from "./draftProposal";

/**
 * Worker handlers for lane B (commercial + grant + knowledge).
 *
 * WHY payloads are parsed, not cast: a task row is data another lane (or an
 * older deploy) wrote. A payload that does not parse is a DomainError — the
 * worker dead-letters it immediately instead of retrying a malformed row.
 */
const packagePayload = z.object({ packageId: z.string().uuid(), revisionNote: z.string().max(2000).optional() }).passthrough();
const letterPayload = z.object({ packageId: z.string().uuid(), vaultId: z.string().uuid() }).passthrough();

function parse<T>(schema: z.ZodType<T>, payload: unknown, type: string): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw new DomainError("INVALID_TASK_PAYLOAD", `${type}: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return result.data;
}

const draft: TaskHandler = async (task) => {
  const p = parse(packagePayload, task.payload, task.taskType);
  const result = await draftProposal(p.packageId, { taskId: task.id, revisionNote: p.revisionNote ?? null });
  return { ...result };
};

const dispatch: TaskHandler = async (task) => {
  const p = parse(packagePayload, task.payload, task.taskType);
  return { ...(await dispatchQuotation(p.packageId)) };
};

const dossier: TaskHandler = async (task, ctx) => {
  const p = parse(packagePayload, task.payload, task.taskType);
  await ctx.heartbeat();
  const result = await compileDossier(p.packageId, { taskId: task.id });
  return { vaultId: result.vaultId, sha256: result.sha256, missing: result.missing, reused: result.reused, files: result.files.map((f) => f.file) };
};

const extract: TaskHandler = async (task, ctx) => {
  const p = parse(letterPayload, task.payload, task.taskType);
  await ctx.heartbeat();
  return { ...(await extractApprovalLetter(p.vaultId, { taskId: task.id })) };
};

const embed: TaskHandler = async () => ({ embedded: await embedCatalog() });

export const handlers: HandlerMap = {
  "commercial.draft_proposal": draft,
  "commercial.dispatch_quotation": dispatch,
  "grant.compile_dossier": dossier,
  "grant.extract_letter": extract,
  "knowledge.embed": embed,
};

/** Reference data the seed script loads: the Allowable Cost Matrix and the knowledge base. Idempotent. */
export async function seedCommercialReferenceData(executor?: Executor): Promise<{ policies: number; courses: number; chunks: number; embedded: number }> {
  const policies = await seedCostPolicies(executor);
  const knowledge = await seedKnowledge(executor);
  return { policies, ...knowledge };
}
