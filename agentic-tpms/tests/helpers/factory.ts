import { sql } from "drizzle-orm";
import { db, rows, schema, withTx, type Actor } from "@/server/db/client";
import { encryptIdentitySql, identityHash, maskIdentity, normaliseIdentity } from "@/server/lib/crypto";

export const ALEX: Actor = { type: "USER", id: "usr_alex_director" };

export async function makeOperator(): Promise<void> {
  await db()
    .insert(schema.operators)
    .values({ id: ALEX.id, fullName: "Alex Tan", role: "MD", email: "alex@example.my" })
    .onConflictDoNothing();
}

export async function makeClient(name = "Kenanga Retail Group Berhad") {
  const [client] = await db()
    .insert(schema.corporateClients)
    .values({
      companyName: name,
      companyDomain: `${name.split(" ")[0].toLowerCase()}${Math.floor(Math.random() * 1e6)}.com.my`,
      levyRegistered: true,
      malaysianHeadcount: 240,
      primaryPicName: "Nurul Hassan",
      primaryPicEmail: "nurul@example.my",
      primaryPicPhone: "+60123456789",
    })
    .returning();
  return client;
}

export async function makePackage(opts: { startDate?: string; endDate?: string; mode?: "IN_HOUSE" | "PUBLIC_PHYSICAL" | "ROT_VIRTUAL"; quoted?: string } = {}) {
  const client = await makeClient();
  return withTx(ALEX, { reasonCode: "PACKAGE_CREATED" }, async (tx) => {
    const [pkg] = await tx
      .insert(schema.trainingPackages)
      .values({
        packageCode: "",
        clientId: client.id,
        title: "Leading Through Change",
        deliveryMode: opts.mode ?? "IN_HOUSE",
        startDate: opts.startDate ?? null,
        endDate: opts.endDate ?? null,
        paxEstimate: 20,
        quotedAmount: opts.quoted ?? "0",
      })
      .returning();
    return pkg;
  });
}

export async function addParticipant(packageId: string, name: string, nric: string, status: "REGISTERED" | "CONFIRMED" = "CONFIRMED") {
  const id = normaliseIdentity(nric);
  if (!id) throw new Error(`bad nric ${nric}`);
  const [row] = await rows<{ id: string }>(
    db(),
    sql`insert into tpms.package_participants (package_id, full_name, nric_passport_hash, nric_encrypted, nric_masked, registration_status)
        values (${packageId}::uuid, ${name}, ${identityHash(id)}, ${encryptIdentitySql(id)}, ${maskIdentity(id)}, ${status})
        returning id`,
  );
  return row.id;
}

export { schema };
