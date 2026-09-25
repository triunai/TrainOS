import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { sha256Hex } from "@/server/lib/crypto";
import { type AttachmentRecord, type OutboundMessage, outboundMessages } from "./schema";

/**
 * The outbound message log. Every adapter writes exactly one row per send
 * attempt, whether a provider took it (SENT), no provider is configured
 * (LOGGED), or the provider refused it (FAILED). The row is written through
 * its own connection, never the caller's transaction: a message that left the
 * building must stay recorded even if the caller's work later rolls back.
 */
export type MessageChannel = "EMAIL" | "WHATSAPP";
export type MessageStatus = "SENT" | "LOGGED" | "FAILED";

const KIND_PATTERN = /^[A-Z0-9_]{2,48}$/;

/**
 * `kind` is a vocabulary every lane contributes to (QUOTATION, MAGIC_LINK,
 * OUTBOUND_COLD, MICRO_TNA, ...). The shape is enforced here and in the
 * table's CHECK so a typo cannot land as a new silent category.
 */
export function assertMessageKind(kind: string): string {
  if (!KIND_PATTERN.test(kind)) {
    throw new Error(`Message kind must be UPPER_SNAKE_CASE (2-48 chars), got: ${JSON.stringify(kind)}`);
  }
  return kind;
}

export function describeAttachments(
  attachments: ReadonlyArray<{ filename: string; content: Uint8Array; contentType?: string }> | undefined,
): AttachmentRecord[] {
  return (attachments ?? []).map((a) => ({
    filename: a.filename,
    contentType: a.contentType ?? null,
    sizeBytes: a.content.byteLength,
    sha256: sha256Hex(a.content),
  }));
}

export interface LogInput {
  channel: MessageChannel;
  kind: string;
  toAddress: string;
  subject?: string | null;
  body: string;
  attachments?: AttachmentRecord[];
  packageId?: string | null;
  leadId?: string | null;
  status: MessageStatus;
  providerMessageId?: string | null;
  error?: string | null;
}

export async function logOutboundMessage(input: LogInput): Promise<string> {
  const [row] = await db()
    .insert(outboundMessages)
    .values({
      channel: input.channel,
      kind: assertMessageKind(input.kind),
      toAddress: input.toAddress.slice(0, 255),
      subject: input.subject ? input.subject.slice(0, 255) : null,
      body: input.body,
      attachments: input.attachments ?? [],
      packageId: input.packageId ?? null,
      leadId: input.leadId ?? null,
      status: input.status,
      providerMessageId: input.providerMessageId ? input.providerMessageId.slice(0, 255) : null,
      error: input.error ? input.error.slice(0, 4000) : null,
    })
    .returning({ id: outboundMessages.id });
  return row.id;
}

export async function listOutboundMessages(
  opts: { limit?: number; packageId?: string; leadId?: string; channel?: MessageChannel; kind?: string } = {},
): Promise<OutboundMessage[]> {
  const where: SQL[] = [];
  if (opts.packageId) where.push(eq(outboundMessages.packageId, opts.packageId));
  if (opts.leadId) where.push(eq(outboundMessages.leadId, opts.leadId));
  if (opts.channel) where.push(eq(outboundMessages.channel, opts.channel));
  if (opts.kind) where.push(eq(outboundMessages.kind, opts.kind));
  return db()
    .select()
    .from(outboundMessages)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(outboundMessages.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 1000));
}
