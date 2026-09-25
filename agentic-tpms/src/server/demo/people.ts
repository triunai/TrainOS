/**
 * Fictional demo participants. Names are chosen to read as a plausible
 * Malaysian workforce; every identity number is a syntactically valid MyKad
 * (a real calendar date, a real place-of-birth code) that belongs to no one.
 *
 * PDPA discipline applies to demo data too: the raw NRIC only ever travels
 * from here into `addParticipant` (which hashes, encrypts and masks it) and
 * into the last-four check of the session-QR flow. It is never logged,
 * printed, or written anywhere else.
 */
export interface DemoPerson {
  fullName: string;
  /** YYMMDD-PB-####; the last digit is odd for men and even for women, as on a real MyKad. */
  nric: string;
  workEmail: string;
  phone: string;
}

type Given = { name: string; female: boolean; email: string };

const GIVEN: Given[] = [
  { name: "Ahmad Faizal bin Rahman", female: false, email: "ahmad.faizal" },
  { name: "Nurul Aina binti Zakaria", female: true, email: "nurul.aina" },
  { name: "Tan Wei Ming", female: false, email: "weiming.tan" },
  { name: "Lim Siew Ling", female: true, email: "siewling.lim" },
  { name: "Rajesh a/l Subramaniam", female: false, email: "rajesh.s" },
  { name: "Priya a/p Krishnan", female: true, email: "priya.k" },
  { name: "Muhammad Hafiz bin Omar", female: false, email: "hafiz.omar" },
  { name: "Siti Nur Aisyah binti Kamal", female: true, email: "aisyah.kamal" },
  { name: "Wong Kah Mun", female: true, email: "kahmun.wong" },
  { name: "Chong Li Ting", female: true, email: "liting.chong" },
  { name: "Mohd Firdaus bin Ismail", female: false, email: "firdaus.ismail" },
  { name: "Kavitha a/p Raman", female: true, email: "kavitha.raman" },
  { name: "Lee Jia Hui", female: true, email: "jiahui.lee" },
  { name: "Faridah binti Yusof", female: true, email: "faridah.yusof" },
  { name: "Goh Chee Keong", female: false, email: "cheekeong.goh" },
  { name: "Nor Azlina binti Hassan", female: true, email: "azlina.hassan" },
  { name: "Arjun a/l Pillai", female: false, email: "arjun.pillai" },
  { name: "Ng Mei Yee", female: true, email: "meiyee.ng" },
  { name: "Zulkifli bin Abdullah", female: false, email: "zulkifli.a" },
  { name: "Teoh Kok Leong", female: false, email: "kokleong.teoh" },
  { name: "Aida Suhaila binti Rosli", female: true, email: "aida.rosli" },
  { name: "Daniel Ong Chee Wai", female: false, email: "daniel.ong" },
  { name: "Suresh a/l Muniandy", female: false, email: "suresh.m" },
  { name: "Hazwani binti Mohd Noor", female: true, email: "hazwani.noor" },
  { name: "Yap Soon Huat", female: false, email: "soonhuat.yap" },
  { name: "Nadia binti Saiful", female: true, email: "nadia.saiful" },
  { name: "Kumaresan a/l Velu", female: false, email: "kumaresan.v" },
  { name: "Chan Pui Yee", female: true, email: "puiyee.chan" },
];

/** Place-of-birth codes (KL, Selangor, Johor, Penang, Perak, Kedah, Sabah, Sarawak). */
const BIRTH_PLACES = ["14", "10", "01", "07", "08", "02", "12", "13"];

/**
 * `count` people for one cohort. `offset` rotates the name list so two
 * packages in the same demo do not share a roster, and `salt` makes the
 * identity numbers of different cohorts differ even when names repeat.
 */
export function demoCohort(count: number, opts: { domain: string; offset?: number; salt?: number }): DemoPerson[] {
  const offset = opts.offset ?? 0;
  const salt = opts.salt ?? 0;
  if (count > GIVEN.length) throw new Error(`The demo cohort list has ${GIVEN.length} names; asked for ${count}`);
  return Array.from({ length: count }, (_, i) => {
    const given = GIVEN[(offset + i) % GIVEN.length];
    const k = offset + i + salt * 7;
    const year = 78 + (k * 5 + salt) % 22; // 1978..1999
    const month = ((k * 7 + salt) % 12) + 1;
    const day = ((k * 11 + salt * 3) % 28) + 1;
    const place = BIRTH_PLACES[(k + salt) % BIRTH_PLACES.length];
    const serial = 100 + ((k * 389 + salt * 97) % 899); // three digits
    const last = ((k + salt) % 5) * 2 + (given.female ? 0 : 1); // parity encodes sex
    const nric = `${String(year).padStart(2, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}-${place}-${serial}${last}`;
    return {
      fullName: given.name,
      nric,
      workEmail: `${given.email}@${opts.domain}`,
      phone: `+6011${String(20_000_000 + ((k * 7919 + salt * 131) % 9_999_999)).slice(0, 8)}`,
    };
  });
}

/** The last four characters a participant types at the room display. */
export function lastFour(person: DemoPerson): string {
  return person.nric.replace(/[^0-9A-Z]/gi, "").slice(-4);
}

/**
 * A plausible handwritten-signature path for the Track A check-in pad:
 * a flourish of cubic curves whose shape varies by person and slot, sized to
 * pass `validateSignaturePath` comfortably.
 */
export function signaturePath(seed: number): string {
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const x0 = 12 + Math.round(r(1) * 20);
  const y0 = 42 + Math.round(r(2) * 14);
  const loops = 3 + Math.floor(r(3) * 3);
  let path = `M ${x0} ${y0}`;
  let x = x0;
  for (let i = 0; i < loops; i += 1) {
    const w = 22 + Math.round(r(10 + i) * 18);
    const up = 8 + Math.round(r(20 + i) * 26);
    const down = 50 + Math.round(r(30 + i) * 22);
    path += ` C ${x + Math.round(w * 0.3)} ${y0 - up}, ${x + Math.round(w * 0.7)} ${y0 - up}, ${x + w} ${y0} S ${x + w + Math.round(w * 0.6)} ${down}, ${x + w + Math.round(w * 0.9)} ${y0 - 4}`;
    x += w + Math.round(w * 0.9);
  }
  path += ` L ${x + 14} ${y0 - 10} M ${x0 + 6} ${y0 + 18} L ${x - 10} ${y0 + 14}`;
  return path;
}
