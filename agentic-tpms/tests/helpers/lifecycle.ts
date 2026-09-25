import { eq, sql } from "drizzle-orm";
import { addDays, todayMY } from "@/lib/dates";
import { db, schema, SYSTEM_ACTOR, type Actor } from "@/server/db/client";
import type { TrainingPackage } from "@/server/db/schema";
import { transition } from "@/server/fsm/service";
import { encryptIdentitySql, identityHash, maskIdentity, normaliseIdentity } from "@/server/lib/crypto";
import { setVerification, storeDocument } from "@/server/storage/vault";
import { ALEX, addParticipant, makeOperator, makePackage } from "./factory";

/**
 * Drives a package through both state machines to a named milestone using
 * only the core (FSM service, vault, raw fixtures) — no feature lane code. Every
 * step goes through `transition()`, so this helper doubles as a check that the
 * L0 guards and the cross-machine coupling accept a realistic happy path.
 */
export const MILESTONES = [
  "DRAFT",
  "QUOTED",
  "GRANT_PENDING",
  "GRANT_APPROVED",
  "OPERATIONS_LOCKED",
  "READY_FOR_EVENT",
  "DELIVERY_IN_PROGRESS",
  "DELIVERY_COMPLETED",
  "CLAIM_READY",
  "CLAIM_SUBMITTED",
  "APPROVED",
  "REMITTED",
  "SETTLED_CLOSED",
] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface LifecycleFixture {
  pkg: TrainingPackage;
  trainerId?: string;
  engagementId?: string;
  venueId?: string;
  participantIds: string[];
}

const QUOTE = "16000.00"; // IN_HOUSE, 11–20 pax band (RM 8,000/day) x 2 days
const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.4\n% fixture ${label} ${Math.random()}\n%%EOF\n`);

async function doc(packageId: string, type: string, verified = false, extra: Record<string, unknown> = {}) {
  return storeDocument(db(), {
    packageId,
    documentType: type,
    fileName: `${type.toLowerCase()}.pdf`,
    mimeType: "application/pdf",
    bytes: pdf(type),
    uploadedBy: ALEX.id,
    verificationStatus: verified ? "VERIFIED" : "PENDING",
    extractedMetadata: extra,
  });
}

/** A syntactically valid MyKad number: YYMMDD + place-of-birth 14 + a 4-digit tail. */
export function fixtureNric(year: number, i: number): string {
  const mm = String((i % 12) + 1).padStart(2, "0");
  const dd = String((i % 28) + 1).padStart(2, "0");
  return `${year}${mm}${dd}14${String(1000 + (i % 9000)).padStart(4, "0")}`;
}

export async function buildPackageAt(target: Milestone, opts: { actor?: Actor; participants?: number } = {}): Promise<LifecycleFixture> {
  const actor = opts.actor ?? ALEX;
  const reach = (m: Milestone) => MILESTONES.indexOf(target) >= MILESTONES.indexOf(m);
  await makeOperator();

  const start = addDays(todayMY(), 30);
  let pkg = await makePackage({ startDate: start, endDate: addDays(start, 1), mode: "IN_HOUSE" });
  const fixture: LifecycleFixture = { pkg, participantIds: [] };
  const refresh = async () => {
    [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, pkg.id));
    fixture.pkg = pkg;
  };

  if (reach("QUOTED")) {
    await db().insert(schema.quotations).values({
      packageId: pkg.id,
      version: 1,
      status: "APPROVED",
      inputs: { pax: 20, days: 2 },
      lineItems: [],
      computed: {},
      allowableCap: QUOTE,
      quotedAmount: QUOTE,
      totalDirectCost: "9600.00",
      grossMargin: "6400.00",
      marginPct: "40.00",
      costPolicyVersion: "ACM-2026.1",
      generatedBy: "USER",
      approvedBy: actor.id,
      approvedAt: new Date(),
    });
    await transition({
      packageId: pkg.id, machine: "OPERATIONAL", to: "QUOTED", reason: "COMMERCIAL_TERMS_APPROVED", actor,
      patch: { quotedAmount: QUOTE, allowableCostCap: QUOTE, costPolicyVersion: "ACM-2026.1" },
    });
  }
  if (reach("GRANT_PENDING")) {
    await doc(pkg.id, "QUOTATION");
    await transition({ packageId: pkg.id, machine: "OPERATIONAL", to: "GRANT_PENDING", reason: "CLIENT_ACCEPTED_QUOTATION", actor });
  }
  if (reach("GRANT_APPROVED")) {
    await doc(pkg.id, "ETRIS_APPROVAL", true);
    await transition({
      packageId: pkg.id, machine: "OPERATIONAL", to: "GRANT_APPROVED", reason: "GRANT_CONFIRMED_LOCKED", actor,
      patch: { etrisGrantId: "ETRIS-2026-001234", grantApprovedAmount: QUOTE, grantApprovedPax: 20, grantApprovedAt: new Date() },
    });
  }
  if (reach("OPERATIONS_LOCKED")) {
    const id = normaliseIdentity(fixtureNric(80, Math.floor(Math.random() * 9000)));
    if (!id) throw new Error("fixture nric invalid");
    const [trainer] = (
      await db().execute(sql`insert into tpms.trainers (full_name, nric_hash, nric_encrypted, nric_masked, email, phone,
            ttt_cert_number, ttt_cert_expiry_date, ttt_verified, standard_day_rate, specialties)
          values ('Farah Aziz', ${identityHash(id)}, ${encryptIdentitySql(id)}, ${maskIdentity(id)},
                  'farah@example.my', '+60129998888', 'TTT/12345', ${addDays(start, 365)}, true, 3000, '{leadership}')
          returning id`)
    ).rows as Array<{ id: string }>;
    const [engagement] = await db()
      .insert(schema.trainerEngagements)
      .values({ packageId: pkg.id, trainerId: trainer.id, status: "CONFIRMED", dayRate: "3000.00", tttCertVerified: true, holdExpiryDate: start })
      .returning();
    const [venue] = await db()
      .insert(schema.vendors)
      .values({ vendorType: "VENUE", name: "Sunway Pyramid Convention Centre", city: "Petaling Jaya", latitude: "3.072600", longitude: "101.607400", capacity: 60, ddrPerPax: "95.00" })
      .returning();
    await db().insert(schema.vendorCommitments).values({
      packageId: pkg.id, vendorId: venue.id, vendorType: "VENUE", status: "BEO_SIGNED", cost: "3800.00",
      cancellationDeadline: addDays(start, -14), postponementDeadline: addDays(start, -7), referenceNumber: "BEO-7781",
    });
    await doc(pkg.id, "TRAINER_AGREEMENT");
    fixture.trainerId = trainer.id;
    fixture.engagementId = engagement.id;
    fixture.venueId = venue.id;
    await transition({ packageId: pkg.id, machine: "OPERATIONAL", to: "OPERATIONS_LOCKED", reason: "OPERATIONS_READINESS_LOCKED", actor });
  }
  if (reach("READY_FOR_EVENT")) {
    const n = opts.participants ?? 6;
    for (let i = 0; i < n; i += 1) {
      fixture.participantIds.push(await addParticipant(pkg.id, `Participant ${i + 1}`, fixtureNric(90, i)));
    }
    await transition({ packageId: pkg.id, machine: "OPERATIONAL", to: "READY_FOR_EVENT", reason: "T14_VIABILITY_PASSED", actor: SYSTEM_ACTOR });
  }
  if (reach("DELIVERY_IN_PROGRESS")) {
    await transition({ packageId: pkg.id, machine: "OPERATIONAL", to: "DELIVERY_IN_PROGRESS", reason: "DELIVERY_STARTED", actor });
  }
  if (reach("DELIVERY_COMPLETED")) {
    for (const participantId of fixture.participantIds) {
      for (const day of [1, 2]) {
        for (const session of ["AM", "PM"]) {
          await db().insert(schema.attendanceRecords).values({
            packageId: pkg.id, participantId, dayIndex: day, session, track: "A_DIGITAL", present: true, signedAt: new Date(),
          });
        }
      }
    }
    await db().execute(sql`update tpms.package_participants set attendance_rate = 100 where package_id = ${pkg.id}::uuid`);
    await doc(pkg.id, "FORM_T3");
    await doc(pkg.id, "PHOTO_EVIDENCE");
    await doc(pkg.id, "PHOTO_EVIDENCE");
    await transition({ packageId: pkg.id, machine: "OPERATIONAL", to: "DELIVERY_COMPLETED", reason: "DELIVERY_VERIFIED_SUCCESS", actor });
  }
  if (reach("CLAIM_READY")) {
    const vault = await db().select().from(schema.complianceVault).where(eq(schema.complianceVault.packageId, pkg.id));
    for (const d of vault.filter((v) => ["FORM_T3", "PHOTO_EVIDENCE"].includes(v.documentType))) {
      await setVerification(db(), d.id, "VERIFIED", actor.id);
    }
    await doc(pkg.id, "FORM_JD14", true);
    await db().insert(schema.taxInvoices).values({
      packageId: pkg.id, invoiceNumber: `INV-TEST-${pkg.packageCode}`, employerName: "Kenanga Retail Group Berhad",
      grantReference: "ETRIS-2026-001234", subtotal: QUOTE, total: QUOTE, lineItems: [],
    });
    await transition({ packageId: pkg.id, machine: "FINANCIAL", to: "CLAIM_READY", reason: "CLAIM_EVIDENCE_VERIFIED", actor: SYSTEM_ACTOR });
  }
  if (reach("CLAIM_SUBMITTED")) {
    await doc(pkg.id, "CLAIM_PACK", true);
    await transition({
      packageId: pkg.id, machine: "FINANCIAL", to: "CLAIM_SUBMITTED", reason: "CLAIM_PACK_APPROVED", actor,
      patch: { claimSubmissionRef: "CLM-2026-88812" },
    });
  }
  if (reach("APPROVED")) {
    await transition({ packageId: pkg.id, machine: "FINANCIAL", to: "APPROVED", reason: "CLAIM_APPROVED_BY_HRDC", actor, patch: { hrdcApprovedAmount: QUOTE } });
  }
  if (reach("REMITTED")) {
    await doc(pkg.id, "REMITTANCE_ADVICE", true);
    await transition({
      packageId: pkg.id, machine: "FINANCIAL", to: "REMITTED", reason: "REMITTANCE_RECEIVED", actor,
      patch: { remittanceAmount: QUOTE, remittanceReference: "HRDC-RMT-55120", remittedAt: new Date() },
    });
  }
  if (reach("SETTLED_CLOSED")) {
    const receipt = await doc(pkg.id, "PAYMENT_RECEIPT", true);
    await db().insert(schema.paymentVouchers).values({
      packageId: pkg.id, pvNumber: `PV-TEST-${pkg.packageCode}`, payeeType: "TRAINER", payeeName: "Farah Aziz",
      engagementId: fixture.engagementId, agreedAmount: "6000.00", finalAmount: "6000.00", status: "PAID",
      bankReference: "MBB-TRX-99812", receiptVaultId: receipt.id, paidBy: actor.id, paidAt: new Date(),
    });
    await transition({ packageId: pkg.id, machine: "FINANCIAL", to: "SETTLED_CLOSED", reason: "AP_DISBURSEMENT_CONFIRMED", actor });
  }

  await refresh();
  return fixture;
}
