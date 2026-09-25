import { sql } from "drizzle-orm";
import { type Executor, rows, schema } from "../db/client";
import { encryptIdentitySql, identityHash, maskIdentity, normaliseIdentity } from "../lib/crypto";
import { OPERATORS } from "../auth/operator";

/**
 * Demo reference data. Every company, person and venue below is FICTIONAL
 * (names chosen to read as plausibly Malaysian); coordinates are real city
 * centres so photo-EXIF verification behaves realistically. NRICs are
 * syntactically valid and belong to no one.
 */
export const DEMO_CLIENTS = [
  { companyName: "Kenanga Retail Group Berhad", companyDomain: "kenangaretail.com.my", ssmRegistration: "201001012345", hrdcorpMycoid: "HRD-KRG-001", industrySector: "Retail", malaysianHeadcount: 1240, levyBalanceEstimate: "182000.00", fiscalYearEndMonth: 12, picName: "Nurul Hassan", picEmail: "nurul.hassan@kenangaretail.com.my", picPhone: "+60123456789" },
  { companyName: "Meridian Logistics Sdn Bhd", companyDomain: "meridianlogistics.com.my", ssmRegistration: "200801023456", hrdcorpMycoid: "HRD-MLS-014", industrySector: "Logistics", malaysianHeadcount: 420, levyBalanceEstimate: "64000.00", fiscalYearEndMonth: 6, picName: "Daniel Lim", picEmail: "daniel.lim@meridianlogistics.com.my", picPhone: "+60196543210" },
  { companyName: "Aurora Manufacturing Sdn Bhd", companyDomain: "auroramfg.com.my", ssmRegistration: "199701034567", hrdcorpMycoid: "HRD-AMS-203", industrySector: "Manufacturing", malaysianHeadcount: 860, levyBalanceEstimate: "121500.00", fiscalYearEndMonth: 3, picName: "Siti Aminah", picEmail: "siti.aminah@auroramfg.com.my", picPhone: "+60124488776" },
  { companyName: "Sutera Hospitality Group Sdn Bhd", companyDomain: "suterahospitality.com.my", ssmRegistration: "201501045678", hrdcorpMycoid: "HRD-SHG-331", industrySector: "Hospitality", malaysianHeadcount: 540, levyBalanceEstimate: "48000.00", fiscalYearEndMonth: 12, picName: "Kevin Raj", picEmail: "kevin.raj@suterahospitality.com.my", picPhone: "+60137766554" },
  { companyName: "Petaling Precision Engineering Sdn Bhd", companyDomain: "ppe.com.my", ssmRegistration: "201201056789", hrdcorpMycoid: "HRD-PPE-118", industrySector: "Engineering", malaysianHeadcount: 180, levyBalanceEstimate: "22000.00", fiscalYearEndMonth: 9, picName: "Aisyah Rahman", picEmail: "aisyah@ppe.com.my", picPhone: "+60162233445" },
  { companyName: "Borneo Agritech Berhad", companyDomain: "borneoagritech.com.my", ssmRegistration: "200501067890", hrdcorpMycoid: "HRD-BAB-077", industrySector: "Agriculture", malaysianHeadcount: 300, levyBalanceEstimate: "39000.00", fiscalYearEndMonth: 12, picName: "Joseph Ngu", picEmail: "joseph.ngu@borneoagritech.com.my", picPhone: "+60198877665" },
] as const;

export const DEMO_TRAINERS = [
  { fullName: "Farah Aziz", nric: "790312-14-5528", email: "farah.aziz@trainers.my", phone: "+60123330001", ttt: "TTT/2019/04412", expiry: "2028-06-30", verified: true, rate: "3200.00", specialties: ["leadership", "supervisory", "conflict", "communication"] },
  { fullName: "Daniel Wong", nric: "850721-10-6641", email: "daniel.wong@trainers.my", phone: "+60123330002", ttt: "TTT/2020/11873", expiry: "2027-12-31", verified: true, rate: "2800.00", specialties: ["excel", "data analytics", "power bi", "ai productivity"] },
  { fullName: "Kavitha Nair", nric: "820905-07-5132", email: "kavitha.nair@trainers.my", phone: "+60123330003", ttt: "TTT/2018/02931", expiry: "2027-03-31", verified: true, rate: "2600.00", specialties: ["customer service", "communication", "hospitality"] },
  { fullName: "Hafiz Ismail", nric: "770118-03-5099", email: "hafiz.ismail@trainers.my", phone: "+60123330004", ttt: "TTT/2017/00761", expiry: "2026-11-30", verified: true, rate: "3000.00", specialties: ["osh", "hirarc", "iso 9001", "internal audit", "safety"] },
  { fullName: "Tan Mei Ling", nric: "900226-08-6284", email: "meiling.tan@trainers.my", phone: "+60123330005", ttt: "TTT/2022/15507", expiry: "2029-01-31", verified: false, rate: "2500.00", specialties: ["digital marketing", "ai productivity", "social media"] },
  { fullName: "Rajesh Menon", nric: "740530-10-5371", email: "rajesh.menon@trainers.my", phone: "+60123330006", ttt: "TTT/2016/00233", expiry: "2027-08-31", verified: true, rate: "3500.00", specialties: ["lean six sigma", "finance", "continuous improvement", "time management"] },
] as const;

export const DEMO_VENDORS = [
  { vendorType: "VENUE", name: "Sunway Pyramid Convention Centre", city: "Petaling Jaya", latitude: "3.072600", longitude: "101.607400", capacity: 300, ddrPerPax: "95.00", freePostponementDays: 7, cancellationNoticeDays: 14 },
  { vendorType: "VENUE", name: "Hilton Kuala Lumpur — Meeting Suites", city: "Kuala Lumpur", latitude: "3.135300", longitude: "101.686200", capacity: 120, ddrPerPax: "145.00", freePostponementDays: 10, cancellationNoticeDays: 21 },
  { vendorType: "VENUE", name: "G Hotel Gurney — Function Rooms", city: "George Town", latitude: "5.438000", longitude: "100.309700", capacity: 80, ddrPerPax: "120.00", freePostponementDays: 7, cancellationNoticeDays: 14 },
  { vendorType: "VENUE", name: "Renaissance Johor Bahru — Ballroom B", city: "Johor Bahru", latitude: "1.492700", longitude: "103.741400", capacity: 60, ddrPerPax: "110.00", freePostponementDays: 7, cancellationNoticeDays: 14 },
  { vendorType: "CATERING", name: "Dapur Selera Events Catering", city: "Shah Alam", latitude: null, longitude: null, capacity: null, ddrPerPax: "38.00", freePostponementDays: 3, cancellationNoticeDays: 5 },
  { vendorType: "PRINTING", name: "Percetakan Maju Jaya Sdn Bhd", city: "Kuala Lumpur", latitude: null, longitude: null, capacity: null, ddrPerPax: null, unitCost: "18.00", freePostponementDays: 3, cancellationNoticeDays: 5 },
] as const;

export async function seedReference(executor: Executor): Promise<{ clients: number; trainers: number; vendors: number }> {
  for (const o of OPERATORS) {
    await executor.insert(schema.operators).values({ id: o.id, fullName: o.name, role: o.role, email: o.email }).onConflictDoNothing();
  }
  for (const c of DEMO_CLIENTS) {
    await executor
      .insert(schema.corporateClients)
      .values({
        companyName: c.companyName,
        companyDomain: c.companyDomain,
        ssmRegistration: c.ssmRegistration,
        hrdcorpMycoid: c.hrdcorpMycoid,
        industrySector: c.industrySector,
        malaysianHeadcount: c.malaysianHeadcount,
        levyRegistered: true,
        levyBalanceEstimate: c.levyBalanceEstimate,
        fiscalYearEndMonth: c.fiscalYearEndMonth,
        primaryPicName: c.picName,
        primaryPicEmail: c.picEmail,
        primaryPicPhone: c.picPhone,
      })
      .onConflictDoNothing();
  }
  for (const t of DEMO_TRAINERS) {
    const id = normaliseIdentity(t.nric);
    if (!id) throw new Error(`demo trainer NRIC invalid: ${t.fullName}`);
    await executor.execute(sql`insert into tpms.trainers (full_name, nric_hash, nric_encrypted, nric_masked, email, phone, ttt_cert_number,
          ttt_cert_expiry_date, ttt_verified, standard_day_rate, specialties)
        values (${t.fullName}, ${identityHash(id)}, ${encryptIdentitySql(id)}, ${maskIdentity(id)}, ${t.email}, ${t.phone}, ${t.ttt},
                ${t.expiry}, ${t.verified}, ${t.rate}, array(select jsonb_array_elements_text(${JSON.stringify(t.specialties)}::jsonb)))
        on conflict (nric_hash) do nothing`);
  }
  const [{ n }] = await rows<{ n: number }>(executor, sql`select count(*)::int as n from tpms.vendors`);
  if (n === 0) {
    for (const v of DEMO_VENDORS) {
      await executor.insert(schema.vendors).values({
        vendorType: v.vendorType,
        name: v.name,
        city: v.city,
        latitude: v.latitude,
        longitude: v.longitude,
        capacity: v.capacity,
        ddrPerPax: v.ddrPerPax,
        unitCost: "unitCost" in v ? v.unitCost : null,
        freePostponementDays: v.freePostponementDays,
        cancellationNoticeDays: v.cancellationNoticeDays,
        contactEmail: `events@${v.name.split(" ")[0].toLowerCase()}.example.my`,
      });
    }
  }
  return { clients: DEMO_CLIENTS.length, trainers: DEMO_TRAINERS.length, vendors: DEMO_VENDORS.length };
}
