import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, db, rows, schema, withTx } from "../db/client";
import { DomainError } from "../domain/errors";
import { recordAudit } from "../audit/ledger";
import { encryptIdentitySql, identityHash, maskIdentity, normaliseIdentity } from "../lib/crypto";
import { storeDocument } from "../storage/vault";

/**
 * The trainer credential registry and the vendor directory — the supply side
 * of the Trainer × Venue × Participants triangle. Trainer NRICs get the same
 * PII treatment as participants: HMAC hash, pgcrypto ciphertext, mask.
 */
export const trainerInput = z.object({
  fullName: z.string().trim().min(3).max(255),
  nric: z.string().trim().min(6),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7).max(50),
  tttCertNumber: z.string().trim().min(3).max(100),
  tttCertExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  standardDayRate: z.coerce.number().positive().max(100000),
  specialties: z.array(z.string().trim().min(2)).default([]),
  bioSummary: z.string().max(4000).optional().nullable(),
});

export async function createTrainer(input: z.input<typeof trainerInput>, actor: Actor): Promise<string> {
  const parsed = trainerInput.parse(input);
  const id = normaliseIdentity(parsed.nric);
  if (!id) throw new DomainError("NRIC_INVALID", "Not a valid MyKad (YYMMDD-PB-####) or passport number");
  return withTx(actor, { reasonCode: "TRAINER_REGISTERED" }, async (tx) => {
    const [existing] = await rows<{ id: string }>(tx, sql`select id from tpms.trainers where nric_hash = ${identityHash(id)}`);
    if (existing) throw new DomainError("TRAINER_EXISTS", "A trainer with this identity is already registered");
    const [row] = await rows<{ id: string }>(
      tx,
      sql`insert into tpms.trainers (full_name, nric_hash, nric_encrypted, nric_masked, email, phone, ttt_cert_number,
            ttt_cert_expiry_date, ttt_verified, standard_day_rate, specialties, bio_summary)
          values (${parsed.fullName}, ${identityHash(id)}, ${encryptIdentitySql(id)}, ${maskIdentity(id)}, ${parsed.email},
                  ${parsed.phone}, ${parsed.tttCertNumber}, ${parsed.tttCertExpiryDate ?? null}, false, ${parsed.standardDayRate},
                  array(select jsonb_array_elements_text(${JSON.stringify(parsed.specialties)}::jsonb)), ${parsed.bioSummary ?? null})
          returning id`,
    );
    await recordAudit(tx, { entityType: "TRAINER", entityId: row.id, reasonCode: "TRAINER_REGISTERED", details: parsed.fullName, metadata: { ttt: parsed.tttCertNumber } });
    return row.id;
  });
}

/**
 * TTT verification is a human act against the certificate itself: the
 * certificate file goes into the vault and the verifier is named in the ledger.
 * L0 then refuses to lock operations for any trainer without it.
 */
export async function verifyTrainerTtt(
  trainerId: string,
  cert: { bytes: Uint8Array; mimeType: string; fileName: string } | null,
  expiry: string | null,
  actor: Actor,
): Promise<void> {
  if (actor.type !== "USER") throw new DomainError("HUMAN_DECISION_REQUIRED", "TTT verification is done by a named operator");
  await withTx(actor, { reasonCode: "TTT_VERIFIED" }, async (tx) => {
    const [trainer] = await tx.select().from(schema.trainers).where(eq(schema.trainers.id, trainerId));
    if (!trainer) throw new DomainError("TRAINER_NOT_FOUND", "Trainer not found");
    let vaultId: string | null = null;
    if (cert) {
      const doc = await storeDocument(tx, {
        trainerId,
        documentType: "TTT_CERT",
        fileName: cert.fileName,
        mimeType: cert.mimeType,
        bytes: cert.bytes,
        uploadedBy: actor.id,
        verificationStatus: "VERIFIED",
        verifiedBy: actor.id,
      });
      vaultId = doc.id;
    }
    await tx.update(schema.trainers).set({ tttVerified: true, tttCertExpiryDate: expiry ?? trainer.tttCertExpiryDate }).where(eq(schema.trainers.id, trainerId));
    await tx.execute(sql`update tpms.trainer_engagements set ttt_cert_verified = true where trainer_id = ${trainerId}::uuid and status <> 'RELEASED'`);
    await recordAudit(tx, { entityType: "TRAINER", entityId: trainerId, reasonCode: "TTT_VERIFIED", details: trainer.tttCertNumber, metadata: { vault_id: vaultId, expiry } });
  });
}

export const vendorInput = z.object({
  vendorType: z.enum(["VENUE", "CATERING", "PRINTING"]),
  name: z.string().trim().min(2).max(255),
  city: z.string().trim().max(100).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  capacity: z.coerce.number().int().positive().optional().nullable(),
  ddrPerPax: z.coerce.number().nonnegative().optional().nullable(),
  unitCost: z.coerce.number().nonnegative().optional().nullable(),
  freePostponementDays: z.coerce.number().int().min(0).max(90).default(7),
  cancellationNoticeDays: z.coerce.number().int().min(0).max(120).default(14),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
});

export async function createVendor(input: z.input<typeof vendorInput>, actor: Actor): Promise<string> {
  const v = vendorInput.parse(input);
  return withTx(actor, { reasonCode: "VENDOR_REGISTERED" }, async (tx) => {
    const [row] = await tx
      .insert(schema.vendors)
      .values({
        vendorType: v.vendorType,
        name: v.name,
        city: v.city ?? null,
        latitude: v.latitude?.toString() ?? null,
        longitude: v.longitude?.toString() ?? null,
        capacity: v.capacity ?? null,
        ddrPerPax: v.ddrPerPax?.toString() ?? null,
        unitCost: v.unitCost?.toString() ?? null,
        freePostponementDays: v.freePostponementDays,
        cancellationNoticeDays: v.cancellationNoticeDays,
        contactEmail: v.contactEmail ?? null,
        contactPhone: v.contactPhone ?? null,
      })
      .returning({ id: schema.vendors.id });
    await recordAudit(tx, { entityType: "VENDOR", entityId: row.id, reasonCode: "VENDOR_REGISTERED", details: v.name, metadata: { type: v.vendorType } });
    return row.id;
  });
}

export interface TrainerRow {
  id: string;
  fullName: string;
  nricMasked: string;
  email: string;
  phone: string;
  tttCertNumber: string;
  tttCertExpiryDate: string | null;
  tttVerified: boolean;
  standardDayRate: string;
  specialties: string[];
  activeEngagements: number;
  deliveredDays: number;
  marginAvg: string | null;
}

export async function listTrainers(): Promise<TrainerRow[]> {
  return rows<TrainerRow>(
    db(),
    sql`select t.id, t.full_name as "fullName", t.nric_masked as "nricMasked", t.email, t.phone,
               t.ttt_cert_number as "tttCertNumber", t.ttt_cert_expiry_date as "tttCertExpiryDate",
               t.ttt_verified as "tttVerified", t.standard_day_rate as "standardDayRate", t.specialties,
               (select count(*) from tpms.trainer_engagements e where e.trainer_id = t.id and e.status <> 'RELEASED')::int as "activeEngagements",
               coalesce((select sum(p.duration_days) from tpms.trainer_engagements e join tpms.training_packages p on p.id = e.package_id
                          where e.trainer_id = t.id and p.operational_stage = 'DELIVERY_COMPLETED'), 0)::int as "deliveredDays",
               (select avg(l.gross_margin)::numeric(10,2) from tpms.job_financial_ledgers l
                  join tpms.trainer_engagements e on e.package_id = l.package_id where e.trainer_id = t.id) as "marginAvg"
          from tpms.trainers t order by t.full_name`,
  );
}

export async function listVendors() {
  return db().select().from(schema.vendors).orderBy(schema.vendors.vendorType, schema.vendors.name);
}
