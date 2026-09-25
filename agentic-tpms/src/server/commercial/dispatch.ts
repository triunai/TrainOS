import { and, desc, eq, ne, sql } from "drizzle-orm";
import { formatRange } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { recordAudit } from "../audit/ledger";
import { db, one, schema, withTx, SYSTEM_ACTOR } from "../db/client";
import { DomainError } from "../domain/errors";
import { env } from "../env";
import { readDocument } from "../storage/vault";
import { quotationReference } from "./documents";

/**
 * Task `commercial.dispatch_quotation` — emails the approved quotation and
 * Form HRD-L&D to the client PIC. Enqueued by the FSM on DRAFT → QUOTED, in
 * the same transaction as the move.
 *
 * WHY idempotent on the audit ledger: a worker can die after the mail left
 * but before the task completed; the retry finds QUOTATION_DISPATCHED for
 * this quotation and does not email the client twice.
 */
export interface MailAttachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

export type Sender = (message: {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
  packageId?: string;
  kind: string;
}) => Promise<{ status: "SENT" | "LOGGED"; id: string }>;

export interface DispatchResult {
  status: "SENT" | "LOGGED" | "SKIPPED";
  reason?: string;
  quotationId?: string;
  to?: string;
  mailId?: string | null;
  attachments?: string[];
}

/** Lane F's mailer, loaded lazily; if it cannot load, the dispatch is recorded as LOGGED instead of failing the gate. */
async function loadSender(): Promise<{ send: Sender | null; reason?: string }> {
  try {
    const mod = await import("@/server/messaging/mail");
    return typeof mod.sendMail === "function" ? { send: mod.sendMail } : { send: null, reason: "MAILER_EXPORT_MISSING" };
  } catch (error) {
    return { send: null, reason: `MAILER_UNAVAILABLE: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
  }
}

export async function dispatchQuotation(packageId: string, opts: { sender?: Sender } = {}): Promise<DispatchResult> {
  const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  if (pkg.operationalStage !== "QUOTED") return { status: "SKIPPED", reason: `PACKAGE_IS_${pkg.operationalStage}` };

  const [quotation] = await db()
    .select()
    .from(schema.quotations)
    .where(and(eq(schema.quotations.packageId, packageId), eq(schema.quotations.status, "APPROVED")))
    .orderBy(desc(schema.quotations.version))
    .limit(1);
  if (!quotation) throw new DomainError("NO_APPROVED_QUOTATION", `${pkg.packageCode} is QUOTED without an approved quotation`);

  const already = await one<{ n: number }>(
    db(),
    sql`select count(*)::int as n from tpms.audit_ledger
         where entity_type = 'QUOTATION' and entity_id = ${quotation.id}::uuid and reason_code = 'QUOTATION_DISPATCHED'`,
  );
  if (already && already.n > 0) return { status: "SKIPPED", reason: "ALREADY_DISPATCHED", quotationId: quotation.id };

  const docs = await db()
    .select()
    .from(schema.complianceVault)
    .where(and(eq(schema.complianceVault.packageId, packageId), ne(schema.complianceVault.verificationStatus, "FLAGGED")))
    .orderBy(desc(schema.complianceVault.createdAt));
  const forQuotation = (type: string) => docs.find((d) => d.documentType === type && d.extractedMetadata.quotation_id === quotation.id);
  const quotationDoc = forQuotation("QUOTATION");
  if (!quotationDoc) throw new DomainError("QUOTATION_PDF_MISSING", `The vault has no PDF for quotation v${quotation.version}`);
  const attachments: MailAttachment[] = [];
  for (const doc of [quotationDoc, forQuotation("FORM_HRD_LD")]) {
    if (!doc) continue;
    const read = await readDocument(doc.id);
    if (!read?.intact) throw new DomainError("VAULT_INTEGRITY", `${doc.fileName} no longer matches its recorded SHA-256`);
    attachments.push({ filename: doc.fileName, content: new Uint8Array(read.bytes), contentType: doc.mimeType });
  }

  const [client] = await db().select().from(schema.corporateClients).where(eq(schema.corporateClients.id, pkg.clientId));
  const reference = quotationReference(pkg, quotation.version);
  const subject = `Quotation ${reference}: ${pkg.title}`;
  const text = [
    `Dear ${client.primaryPicName},`,
    "",
    `Please find attached our quotation ${reference} for "${pkg.title}" (${formatRange(pkg.startDate, pkg.endDate)}, ${pkg.paxEstimate} participants)`,
    `and the Form HRD-L&D course outline for your HRD Corp SBL-Khas grant application.`,
    "",
    `Course fee: ${formatRM(quotation.quotedAmount)} (within the Allowable Cost Matrix cap of ${formatRM(quotation.allowableCap)}).`,
    "The trainer and venue are held tentatively; they are confirmed on your purchase order or the e-TRiS grant approval.",
    "",
    "Reply to this email to accept the quotation or to ask for changes.",
    "",
    "Regards,",
    env().TPMS_PROVIDER_NAME,
  ].join("\n");

  const sender = opts.sender ? { send: opts.sender } : await loadSender();
  let status: DispatchResult["status"] = "LOGGED";
  let mailId: string | null = null;
  const reason = sender.send ? undefined : sender.reason;
  if (sender.send) {
    // A transport failure propagates: the worker retries, and the idempotency check above prevents a double send.
    const sent = await sender.send({ to: client.primaryPicEmail, subject, text, attachments, packageId, kind: "QUOTATION" });
    status = sent.status;
    mailId = sent.id;
  }

  await withTx(SYSTEM_ACTOR, { reasonCode: "QUOTATION_DISPATCHED" }, (tx) =>
    recordAudit(tx, {
      entityType: "QUOTATION",
      entityId: quotation.id,
      reasonCode: "QUOTATION_DISPATCHED",
      details: `${reference} to ${client.primaryPicEmail} (${status})`,
      metadata: { package_id: packageId, to: client.primaryPicEmail, status, mail_id: mailId, reason: reason ?? null, attachments: attachments.map((a) => a.filename) },
    }),
  );
  return { status, reason, quotationId: quotation.id, to: client.primaryPicEmail, mailId, attachments: attachments.map((a) => a.filename) };
}
