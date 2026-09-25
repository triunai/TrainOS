import { desc, sql } from "drizzle-orm";
import { type Actor, type Executor, db, one, withTx } from "@/server/db/client";
import { recordAudit } from "@/server/audit/ledger";
import { DomainError } from "@/server/domain/errors";
import { sha256Hex } from "@/server/lib/crypto";
import { type OutboundSuppression, outboundSuppressions } from "@/server/messaging/schema";

/**
 * The opt-out list behind "Reply STOP to opt out." An address on it is never
 * drafted into a new sequence and never dispatched to, even from a batch a
 * human already approved — the opt-out outranks the approval.
 */
export type SuppressionReason = "STOP_REPLY" | "BOUNCED" | "MANUAL";
const REASONS: readonly SuppressionReason[] = ["STOP_REPLY", "BOUNCED", "MANUAL"];

export async function suppressAddress(
  email: string,
  reason: SuppressionReason,
  source: string,
  actor: Actor,
): Promise<{ email: string; created: boolean }> {
  if (!REASONS.includes(reason)) throw new DomainError("UNKNOWN_SUPPRESSION_REASON", `Unknown suppression reason: ${String(reason)}`);
  const lower = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) throw new DomainError("SUPPRESSION_INVALID_EMAIL", `Not an email address: ${email}`);
  return withTx(actor, { reasonCode: `OUTBOUND_SUPPRESSED_${reason}` }, async (tx) => {
    const inserted = await one<{ email_lower: string }>(
      tx,
      sql`insert into tpms.outbound_suppressions (email_lower, reason, source, created_by)
          values (${lower}, ${reason}, ${source.slice(0, 500)}, ${actor.id})
          on conflict (email_lower) do nothing
          returning email_lower`,
    );
    if (inserted) {
      // The ledger records that an opt-out happened, keyed by a digest of the
      // address rather than the address itself.
      await recordAudit(tx, {
        entityType: "OUTBOUND_SUPPRESSION",
        entityId: suppressionEntityId(lower),
        reasonCode: `OUTBOUND_SUPPRESSED_${reason}`,
        details: source.slice(0, 200),
        metadata: { reason, domain: lower.split("@")[1] ?? null },
      });
      // Anything still waiting for this address stops here; a STOP reply also
      // marks what was already sent as replied, which ends the sequence too.
      await tx.execute(sql`update tpms.outbound_campaign_outbox
           set status = case when status = 'WAITING_APPROVAL' then 'REJECTED'
                             when status = 'DISPATCHED' and ${reason}::text = 'STOP_REPLY' then 'REPLIED'
                             when status = 'DISPATCHED' and ${reason}::text = 'BOUNCED' then 'BOUNCED'
                             else status end,
               provenance = provenance || jsonb_build_object('suppressed', ${reason}::text)
         where lower(target_pic_email) = ${lower} and status in ('WAITING_APPROVAL', 'APPROVED', 'DISPATCHED')`);
    }
    return { email: lower, created: !!inserted };
  });
}

/** A stable uuid-shaped digest of the address: the same opt-out always has the same ledger entity. */
export function suppressionEntityId(emailLower: string): string {
  const h = sha256Hex(`outbound-suppression:${emailLower}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function isSuppressed(email: string, executor: Executor = db()): Promise<boolean> {
  const hit = await one<{ n: number }>(
    executor,
    sql`select 1 as n from tpms.outbound_suppressions where email_lower = ${email.trim().toLowerCase()}`,
  );
  return !!hit;
}

export async function listSuppressions(limit = 500): Promise<OutboundSuppression[]> {
  return db().select().from(outboundSuppressions).orderBy(desc(outboundSuppressions.createdAt)).limit(limit);
}

/**
 * "STOP", "unsubscribe", "remove me", "berhenti" — alone, as the subject or
 * the whole first line of a reply. "Stop by our office next week" is not an
 * opt-out, so the keyword must stand on its own (a polite "please" allowed).
 */
const STOP_LINE = /^\s*(?:re:\s*)?(?:stop|unsubscribe|remove me|opt[- ]?out|berhenti)(?:\s+(?:me|please|now|all|thanks|thank you))*\s*[.!]*\s*$/i;

export function isStopReply(subject: string | null | undefined, text: string | null | undefined): boolean {
  const firstLine = (text ?? "").split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return STOP_LINE.test(firstLine) || /^\s*(?:re:\s*)?(?:stop|unsubscribe)\s*$/i.test(subject ?? "");
}
