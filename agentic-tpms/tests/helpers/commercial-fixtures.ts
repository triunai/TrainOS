import { eq, sql } from "drizzle-orm";
import { addDays, todayMY } from "@/lib/dates";
import { db, rows, schema, withTx } from "@/server/db/client";
import type { TrainingPackage } from "@/server/db/schema";
import { encryptIdentitySql, identityHash, maskIdentity, normaliseIdentity } from "@/server/lib/crypto";
import { seedCommercialReferenceData } from "@/server/commercial/tasks";
import { approveAndDispatch, clientAccepted, draftProposal } from "@/server/commercial";
import { getCourseByCode } from "@/server/knowledge";
import { ALEX, makeClient, makeOperator } from "./factory";

/**
 * Lane-B fixtures: reference data (cost matrix + knowledge base), a small
 * trainer and venue register designed so the sourcing rules are observable,
 * and DRAFT packages with a lead TNA.
 *
 * The register is built so that the "obvious" pick is wrong for a reason:
 *   - the cheapest leadership trainer (Lim) is NOT TTT-verified
 *   - the second-cheapest (Farah) is the correct pick for leadership courses
 *   - the cheapest venue seats only 15, so a 20-pax cohort must skip it
 */
export interface CommercialWorld {
  trainers: Record<"farah" | "kumar" | "lim" | "hafiz" | "tan", string>;
  venues: Record<"small" | "sunway" | "hilton", string>;
}

let nricSeq = 0;
function trainerNric(): string {
  nricSeq += 1;
  const i = nricSeq + Math.floor(Math.random() * 5000);
  const mm = String((i % 12) + 1).padStart(2, "0");
  const dd = String((i % 28) + 1).padStart(2, "0");
  return `75${mm}${dd}10${String(1000 + (i % 9000)).padStart(4, "0")}`;
}

export async function makeTrainer(t: {
  name: string;
  rate: string;
  specialties: string[];
  verified?: boolean;
  expiry?: string | null;
  unavailable?: string[];
  bio?: string;
}): Promise<string> {
  const id = normaliseIdentity(trainerNric());
  if (!id) throw new Error("fixture NRIC invalid");
  const expiry = t.expiry === undefined ? addDays(todayMY(), 730) : t.expiry;
  const unavailable = `{${(t.unavailable ?? []).join(",")}}`;
  const specialties = `{${t.specialties.map((s) => `"${s}"`).join(",")}}`;
  const [row] = await rows<{ id: string }>(
    db(),
    sql`insert into tpms.trainers (full_name, nric_hash, nric_encrypted, nric_masked, email, phone, ttt_cert_number,
            ttt_cert_expiry_date, ttt_verified, standard_day_rate, specialties, unavailable_dates, bio_summary)
        values (${t.name}, ${identityHash(id)}, ${encryptIdentitySql(id)}, ${maskIdentity(id)},
                ${`${t.name.split(" ")[0].toLowerCase()}@trainers.example.my`}, '+60123334444',
                ${`TTT/${1000 + nricSeq}`}, ${expiry}, ${t.verified ?? true}, ${t.rate}, ${specialties}::text[],
                ${unavailable}::date[], ${t.bio ?? null})
        returning id`,
  );
  return row.id;
}

export async function makeVenue(v: { name: string; capacity: number; ddr: string; city?: string; cancelDays?: number; postponeDays?: number }): Promise<string> {
  const [row] = await db()
    .insert(schema.vendors)
    .values({
      vendorType: "VENUE",
      name: v.name,
      city: v.city ?? "Kuala Lumpur",
      capacity: v.capacity,
      ddrPerPax: v.ddr,
      cancellationNoticeDays: v.cancelDays ?? 14,
      freePostponementDays: v.postponeDays ?? 7,
    })
    .returning({ id: schema.vendors.id });
  return row.id;
}

export async function seedCommercialWorld(): Promise<CommercialWorld> {
  await makeOperator();
  await seedCommercialReferenceData(db());
  const trainers = {
    farah: await makeTrainer({ name: "Farah Aziz", rate: "3000.00", specialties: ["leadership", "coaching"], bio: "Former HR director; 15 years developing supervisors." }),
    kumar: await makeTrainer({ name: "Kumar Rajendran", rate: "3500.00", specialties: ["Leadership", "conflict management"] }),
    lim: await makeTrainer({ name: "Lim Mei Ling", rate: "2000.00", specialties: ["leadership"], verified: false }),
    hafiz: await makeTrainer({ name: "Hafiz Osman", rate: "2800.00", specialties: ["osh", "safety"] }),
    tan: await makeTrainer({ name: "Tan Wei Jie", rate: "2600.00", specialties: ["excel", "data analytics"] }),
  };
  const venues = {
    small: await makeVenue({ name: "Seri Pacific Meeting Room", capacity: 15, ddr: "85.00" }),
    sunway: await makeVenue({ name: "Sunway Pyramid Convention Centre", capacity: 60, ddr: "95.00", city: "Petaling Jaya" }),
    hilton: await makeVenue({ name: "Hilton KL Ballroom", capacity: 200, ddr: "180.00" }),
  };
  return { trainers, venues };
}

export interface DraftPackageOptions {
  title?: string;
  pax?: number;
  mode?: "IN_HOUSE" | "PUBLIC_PHYSICAL" | "ROT_VIRTUAL";
  days?: number;
  startInDays?: number;
  courseCode?: string;
  venueByClient?: boolean;
  tna?: Record<string, unknown>;
  topic?: string;
  withDates?: boolean;
}

export const LEADERSHIP_TNA = {
  skillGaps: ["Supervisors avoid difficult conversations and conflicts escalate to HR", "New managers struggle to lead change"],
  businessGoals: ["Reduce staff turnover in outlets by 15%"],
  seniority: "EXECUTIVE",
  department: "Retail Operations",
};

/** Each package gets its own dates unless a test asks for a clash, so holds never collide by accident. */
let dateSlot = 0;

export async function makeDraftPackage(opts: DraftPackageOptions = {}): Promise<TrainingPackage> {
  const client = await makeClient();
  dateSlot += 1;
  const [lead] = await db()
    .insert(schema.leadRecords)
    .values({
      clientId: client.id,
      companyName: client.companyName,
      picFullName: client.primaryPicName,
      picEmail: client.primaryPicEmail,
      channelSource: "MANUAL",
      trainingTopic: opts.topic ?? "Leadership and conflict management for managers",
      tnaProfile: opts.tna ?? LEADERSHIP_TNA,
      estimatedPax: opts.pax ?? 20,
      deliveryPreference: opts.mode ?? "IN_HOUSE",
      status: "CONVERTED",
    })
    .returning();
  const course = opts.courseCode ? await getCourseByCode(opts.courseCode) : undefined;
  if (opts.courseCode && !course) throw new Error(`fixture course ${opts.courseCode} not seeded`);
  const start = addDays(todayMY(), opts.startInDays ?? 40 + dateSlot * 3);
  const days = opts.days ?? 2;
  const withDates = opts.withDates ?? true;
  return withTx(ALEX, { reasonCode: "PACKAGE_CREATED" }, async (tx) => {
    const [pkg] = await tx
      .insert(schema.trainingPackages)
      .values({
        packageCode: "",
        clientId: client.id,
        leadId: lead.id,
        courseId: course?.id ?? null,
        title: opts.title ?? "Leading Through Change",
        deliveryMode: opts.mode ?? "IN_HOUSE",
        venueByClient: opts.venueByClient ?? false,
        startDate: withDates ? start : null,
        endDate: withDates ? addDays(start, days - 1) : null,
        paxEstimate: opts.pax ?? 20,
        createdBy: ALEX.id,
      })
      .returning();
    return pkg;
  });
}

export async function reload(packageId: string): Promise<TrainingPackage> {
  const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  return pkg;
}

/** DRAFT → (agent draft) → Gate 1 approval → QUOTED → client accepts → GRANT_PENDING, all through lane-B code. */
export async function driveToGrantPending(opts: DraftPackageOptions = {}) {
  const pkg = await makeDraftPackage(opts);
  const draft = await draftProposal(pkg.id);
  const approval = await approveAndDispatch(pkg.id, draft.quotationId, ALEX);
  await clientAccepted(pkg.id, ALEX);
  return { pkg: await reload(pkg.id), draft, approval };
}
