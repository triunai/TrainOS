import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, type Executor, db, rows, schema, withTx } from "../db/client";
import { DomainError } from "../domain/errors";
import { recordAudit } from "../audit/ledger";
import { encryptIdentitySql, identityHash, maskIdentity, normaliseIdentity } from "../lib/crypto";

/**
 * The cohort roster. Registration validates MyKad/passport syntax (Stage 4:
 * "validates participant NRIC/Passport syntax"), stores the identity only as
 * HMAC hash + pgcrypto ciphertext + mask, and refuses a duplicate person on the
 * same package. The roster is frozen once delivery completes — attendance and
 * certificates are computed against it.
 */
const FROZEN = new Set(["DELIVERY_COMPLETED", "CANCELLED"]);

export const participantInput = z.object({
  fullName: z.string().trim().min(3, "name is too short").max(255),
  nric: z.string().trim().min(6, "NRIC/passport is required"),
  workEmail: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  phone: z.string().trim().max(30).optional().nullable(),
  dietaryPreference: z.string().trim().max(100).optional().nullable(),
  confirmed: z.boolean().optional(),
});
export type ParticipantInput = z.input<typeof participantInput>;

async function assertEditable(executor: Executor, packageId: string) {
  const [pkg] = await executor.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", "Package not found");
  if (FROZEN.has(pkg.operationalStage)) throw new DomainError("ROSTER_FROZEN", `The roster is frozen at ${pkg.operationalStage.toLowerCase().replace(/_/g, " ")}`);
  return pkg;
}

async function insertOne(executor: Executor, packageId: string, input: ParticipantInput): Promise<{ id: string; masked: string }> {
  const parsed = participantInput.parse(input);
  const identity = normaliseIdentity(parsed.nric);
  if (!identity) throw new DomainError("NRIC_INVALID", `${parsed.fullName}: not a valid MyKad (YYMMDD-PB-####) or passport number`);
  const hash = identityHash(identity);
  const [dupe] = await rows<{ id: string }>(
    executor,
    sql`select id from tpms.package_participants where package_id = ${packageId}::uuid and nric_passport_hash = ${hash}`,
  );
  if (dupe) throw new DomainError("PARTICIPANT_DUPLICATE", `${parsed.fullName} (${maskIdentity(identity)}) is already on this roster`);
  const [row] = await rows<{ id: string }>(
    executor,
    sql`insert into tpms.package_participants (package_id, full_name, nric_passport_hash, nric_encrypted, nric_masked,
          work_email, phone, dietary_preference, registration_status)
        values (${packageId}::uuid, ${parsed.fullName}, ${hash}, ${encryptIdentitySql(identity)}, ${maskIdentity(identity)},
                ${parsed.workEmail ?? null}, ${parsed.phone ?? null}, ${parsed.dietaryPreference || "STANDARD_HALAL"},
                ${parsed.confirmed ? "CONFIRMED" : "REGISTERED"})
        returning id`,
  );
  return { id: row.id, masked: maskIdentity(identity) };
}

export async function addParticipant(packageId: string, input: ParticipantInput, actor: Actor): Promise<string> {
  return withTx(actor, { reasonCode: "PARTICIPANT_REGISTERED" }, async (tx) => {
    const pkg = await assertEditable(tx, packageId);
    const { id, masked } = await insertOne(tx, packageId, input);
    await recordAudit(tx, { entityType: "PARTICIPANT", entityId: id, reasonCode: "PARTICIPANT_REGISTERED", details: masked, metadata: { package_id: pkg.id } });
    return id;
  });
}

export interface ImportRowResult {
  line: number;
  name: string;
  ok: boolean;
  error?: string;
}

/**
 * CSV import (header row optional): name, nric, email, phone, dietary.
 * Each row stands alone — one bad NRIC does not reject the batch — and the
 * whole import is one audit entry with per-row outcomes (masked, no NRIC).
 */
export async function importParticipantsCsv(packageId: string, csv: string, actor: Actor): Promise<ImportRowResult[]> {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new DomainError("CSV_EMPTY", "The file has no rows");
  const header = /name/i.test(lines[0]) && /(nric|ic|passport)/i.test(lines[0]);
  const body = header ? lines.slice(1) : lines;
  if (body.length > 500) throw new DomainError("CSV_TOO_LARGE", "Import at most 500 participants at a time");
  const results: ImportRowResult[] = [];
  await withTx(actor, { reasonCode: "PARTICIPANTS_IMPORTED" }, async (tx) => {
    await assertEditable(tx, packageId);
    for (const [i, line] of body.entries()) {
      const cells = parseCsvLine(line);
      const [fullName = "", nric = "", workEmail = "", phone = "", dietary = ""] = cells;
      await tx.execute(sql`savepoint participant_row`);
      try {
        await insertOne(tx, packageId, { fullName, nric, workEmail: workEmail || null, phone: phone || null, dietaryPreference: dietary || null });
        await tx.execute(sql`release savepoint participant_row`);
        results.push({ line: i + (header ? 2 : 1), name: fullName, ok: true });
      } catch (error) {
        await tx.execute(sql`rollback to savepoint participant_row`);
        const message = error instanceof DomainError ? error.message : error instanceof z.ZodError ? error.issues.map((x) => x.message).join("; ") : "row rejected";
        results.push({ line: i + (header ? 2 : 1), name: fullName || "(blank)", ok: false, error: message });
      }
    }
    await recordAudit(tx, {
      entityType: "TRAINING_PACKAGE",
      entityId: packageId,
      reasonCode: "PARTICIPANTS_IMPORTED",
      details: `${results.filter((r) => r.ok).length} imported, ${results.filter((r) => !r.ok).length} rejected`,
      metadata: { package_id: packageId, rejected_lines: results.filter((r) => !r.ok).map((r) => r.line) },
    });
  });
  return results;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

export async function setRegistrationStatus(participantId: string, status: "CONFIRMED" | "WITHDRAWN" | "REGISTERED", actor: Actor): Promise<void> {
  await withTx(actor, { reasonCode: `PARTICIPANT_${status}` }, async (tx) => {
    const [p] = await tx.select().from(schema.packageParticipants).where(eq(schema.packageParticipants.id, participantId));
    if (!p) throw new DomainError("PARTICIPANT_NOT_FOUND", "Participant not found");
    await assertEditable(tx, p.packageId);
    await tx.update(schema.packageParticipants).set({ registrationStatus: status }).where(and(eq(schema.packageParticipants.id, participantId)));
    await recordAudit(tx, { entityType: "PARTICIPANT", entityId: participantId, reasonCode: `PARTICIPANT_${status}`, details: p.nricMasked, metadata: { package_id: p.packageId, from: p.registrationStatus } });
  });
}

export interface RosterRow {
  id: string;
  fullName: string;
  nricMasked: string;
  workEmail: string | null;
  phone: string | null;
  dietaryPreference: string;
  registrationStatus: string;
  attendanceRate: string;
  hrdClaimEligible: boolean;
  preScore: string | null;
  postScore: string | null;
  certSerial: string | null;
}

export async function listRoster(packageId: string): Promise<RosterRow[]> {
  return rows<RosterRow>(
    db(),
    sql`select id, full_name as "fullName", nric_masked as "nricMasked", work_email as "workEmail", phone,
               dietary_preference as "dietaryPreference", registration_status as "registrationStatus",
               attendance_rate::text as "attendanceRate", hrd_claim_eligible as "hrdClaimEligible",
               kirkpatrick_pre_score::text as "preScore", kirkpatrick_post_score::text as "postScore",
               cert_serial_number as "certSerial"
          from tpms.package_participants where package_id = ${packageId}::uuid
         order by registration_status = 'WITHDRAWN', full_name`,
  );
}
