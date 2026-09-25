/**
 * Drizzle definitions for the messaging tables (db/migrations/0009_messaging.sql).
 * They live with the module that owns them rather than in the shared schema
 * file; `tpms` is the same pgSchema object, so queries are schema-qualified.
 */
import { jsonb, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { tpms } from "@/server/db/schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export interface AttachmentRecord {
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  sha256: string;
}

export const outboundMessages = tpms.table("outbound_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: varchar("channel", { length: 16 }).notNull(),
  kind: varchar("kind", { length: 48 }).notNull(),
  toAddress: varchar("to_address", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }),
  body: text("body").notNull(),
  attachments: jsonb("attachments").$type<AttachmentRecord[]>().notNull().default([]),
  packageId: uuid("package_id"),
  leadId: uuid("lead_id"),
  status: varchar("status", { length: 16 }).notNull(),
  providerMessageId: varchar("provider_message_id", { length: 255 }),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const outboundSuppressions = tpms.table("outbound_suppressions", {
  emailLower: varchar("email_lower", { length: 255 }).primaryKey(),
  reason: varchar("reason", { length: 32 }).notNull(),
  source: text("source").notNull().default(""),
  createdBy: varchar("created_by", { length: 64 }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type OutboundSuppression = typeof outboundSuppressions.$inferSelect;
