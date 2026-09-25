import { and, eq } from "drizzle-orm";
import { type Actor, SYSTEM_ACTOR, schema, withTx } from "../db/client";
import type { VaultDocument } from "../db/schema";
import { PDF_MIME } from "../documents/pdf";
import { DomainError } from "../domain/errors";
import { assertDayIndex, parseSession, trainingDate } from "./sessions";
import { type T3Signature, loadT3Context, renderT3TemplatePdf, storeOnce } from "./t3Template";

/**
 * Form T3 evidence for a digital-only cohort: the same register layout (so
 * the same QR, fiducials and geometry — the OCR engine can even re-read it),
 * with each participant's Track A signature drawn into its cell from the
 * stored SVG path and the time of signing printed beside it.
 *
 * Stored as FORM_T3 with `extracted_metadata.source = 'TRACK_A'`, PENDING:
 * an operator still verifies it like any other claim document. An unchanged
 * set of signatures renders identical bytes and returns the existing row.
 */
export async function renderDigitalT3(packageId: string, dayIndex: number, actor: Actor = SYSTEM_ACTOR): Promise<VaultDocument> {
  return withTx(actor, { reasonCode: "T3_DIGITAL_RENDERED" }, async (tx) => {
    const ctx = await loadT3Context(tx, packageId);
    const { pkg } = ctx;
    if (!pkg.startDate) throw new DomainError("DATES_MISSING", "Training dates are required");
    assertDayIndex(dayIndex, pkg.durationDays);
    const signed = await tx
      .select()
      .from(schema.attendanceRecords)
      .where(and(
        eq(schema.attendanceRecords.packageId, packageId),
        eq(schema.attendanceRecords.dayIndex, dayIndex),
        eq(schema.attendanceRecords.track, "A_DIGITAL"),
        eq(schema.attendanceRecords.present, true),
      ));
    const active = new Set(ctx.participants.map((p) => p.id));
    const signatures = new Map<string, Partial<Record<"AM" | "PM", T3Signature>>>();
    let slots = 0;
    for (const record of signed) {
      if (!record.signatureData || !active.has(record.participantId)) continue;
      const entry = signatures.get(record.participantId) ?? {};
      entry[parseSession(record.session)] = { path: record.signatureData, signedAt: record.signedAt };
      signatures.set(record.participantId, entry);
      slots += 1;
    }
    if (slots === 0) throw new DomainError("NO_DIGITAL_SIGNATURES", `No Track A signatures recorded for Day ${dayIndex}`);
    const date = trainingDate(pkg.startDate, dayIndex);
    const bytes = await renderT3TemplatePdf({ ...ctx, dayIndex, date, signatures });
    const { doc } = await storeOnce(tx, {
      packageId,
      documentType: "FORM_T3",
      fileName: `${pkg.packageCode}-T3-D${dayIndex}-digital.pdf`,
      mimeType: PDF_MIME,
      bytes,
      uploadedBy: actor.id,
      extractedMetadata: {
        source: "TRACK_A",
        dayIndex,
        date,
        signedSlots: slots,
        participants: ctx.participants.length,
        unsignedSlots: ctx.participants.length * 2 - slots,
      },
      verificationNotes: `Compiled from ${slots} Track A e-signature(s)`,
    });
    return doc;
  });
}
