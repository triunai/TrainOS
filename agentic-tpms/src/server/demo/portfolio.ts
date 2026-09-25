import { DEMO_CLIENTS } from "../seed/reference";
import { type GoldenPathResult, type GoldenStep, type StepRecord, driveTo, ensureReferenceData } from "./goldenPath";
import { type DemoScenario, GOLDEN_SCENARIO } from "./scenarios";

/**
 * The demo portfolio: a dozen packages spread across both state machines,
 * each built by driving its scenario down the golden path and STOPPING at a
 * chosen step, plus three leads that never became packages. Nothing is
 * inserted by hand; every row on the board got there through the same
 * services an operator's clicks call.
 *
 * Dates are real and all in the future (grant confirmation refuses a start
 * date already past, so a package cannot honestly be backdated). Trainers
 * are calendared so no two holds overlap: the sourcing agent would otherwise
 * — correctly — refuse a trainer already booked on those days.
 *
 * Every company, person and reference is FICTIONAL.
 */
export interface PortfolioEntry {
  scenario: DemoScenario;
  stop: GoldenStep;
  /** What the board should show once the entry is built (asserted by the seed test). */
  expect: { operational: string; financial: string } | { lead: string };
  label: string;
}

type Ref = (typeof DEMO_CLIENTS)[number];
const ref = (name: string): Ref => {
  const client = DEMO_CLIENTS.find((c) => c.companyName.startsWith(name));
  if (!client) throw new Error(`reference client ${name} is not in DEMO_CLIENTS`);
  return client;
};
const companyOf = (c: Ref): DemoScenario["company"] => ({
  formName: c.companyName,
  domain: c.companyDomain,
  mycoid: c.hrdcorpMycoid,
  picName: c.picName,
  picEmail: c.picEmail,
  picPhone: c.picPhone,
});

const CLAIM_DEFAULT: DemoScenario["claim"] = {
  query: "HRD Corp query: the Day 2 session photo is too dark to read the slide; provide a clearer photo or the trainer's attendance declaration.",
  response: "Uploaded the trainer's signed attendance declaration and a second session photo on e-TRiS; resubmitted.",
};

function scenario(s: Omit<DemoScenario, "triageNote" | "claim"> & Partial<Pick<DemoScenario, "triageNote" | "claim">>): DemoScenario {
  return { triageNote: "Confirmed by phone: active HRD Corp levy contributor", claim: CLAIM_DEFAULT, ...s };
}

const kenanga = companyOf(ref("Kenanga"));
const meridian = companyOf(ref("Meridian"));
const aurora = companyOf(ref("Aurora"));
const sutera = companyOf(ref("Sutera"));
const ppe = companyOf(ref("Petaling"));
const borneo = companyOf(ref("Borneo"));

export const DEMO_PORTFOLIO: PortfolioEntry[] = [
  {
    label: "Settled: the golden path itself",
    scenario: GOLDEN_SCENARIO,
    stop: "sweep",
    expect: { operational: "DELIVERY_COMPLETED", financial: "SETTLED_CLOSED" },
  },
  {
    label: "Remitted, vouchers drafted and waiting to be paid",
    stop: "claim.remit",
    expect: { operational: "DELIVERY_COMPLETED", financial: "REMITTED" },
    scenario: scenario({
      key: "kenanga-cse",
      company: kenanga,
      enquiry: "We need Customer Service Excellence training for 18 outlet supervisors across our Klang Valley stores. HRD Corp claimable please, early October.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes, we are an active levy contributor. 18 pax, early October.",
      title: "Customer Service Excellence for Outlet Supervisors",
      deliveryMode: "IN_HOUSE",
      courseCode: "CSE-101",
      startInDays: 3,
      days: 2,
      pax: 18,
      minParticipants: 8,
      roster: 10,
      rosterOffset: 12,
      gate1Edit: { cell: "VenueDDRPerPax", delta: "-5.00", why: "Sunway agreed a RM 90 weekday DDR" },
      mileage: { label: "Mileage KL - Petaling Jaya return, 2 days (36 km at RM 0.60)", amount: "21.60" },
    }),
  },
  {
    label: "Queried by HRD Corp (absent participant)",
    stop: "claim.query",
    expect: { operational: "DELIVERY_COMPLETED", financial: "QUERIED" },
    scenario: scenario({
      key: "aurora-osh",
      company: aurora,
      enquiry: "Please quote HIRARC training for 15 line leaders at our Shah Alam factory. We are HRD Corp registered; early October.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Ya, levi aktif. 15 orang, awal Oktober.",
      title: "HIRARC for Production Line Leaders",
      deliveryMode: "IN_HOUSE",
      courseCode: "OSH-201",
      startInDays: 5,
      days: 2,
      pax: 15,
      minParticipants: 6,
      roster: 9,
      rosterOffset: 3,
      gate1Edit: { cell: "MaterialsCostPerPax", delta: "-10.00", why: "PPE handouts printed in-house" },
      absentee: { index: 4, day: 2, session: "AM", reason: "On medical leave on Day 2 morning (MC submitted)" },
      claim: {
        query: "HRD Corp query: the Day 2 AM register shows 8 of 9 signatures; confirm the absent participant and the claimable headcount.",
        response: "Replied with the MC and the attendance matrix: the participant is below 80% and excluded; the per-group claim is unchanged.",
      },
      mileage: { label: "Mileage KL - Shah Alam return, 2 days (84 km at RM 0.60)", amount: "50.40" },
    }),
  },
  {
    label: "Claim submitted on e-TRiS",
    stop: "claim.submit",
    expect: { operational: "DELIVERY_COMPLETED", financial: "CLAIM_SUBMITTED" },
    scenario: scenario({
      key: "meridian-lss",
      company: meridian,
      enquiry: "Lean Six Sigma Yellow Belt for 16 warehouse supervisors, 3 days, under HRDC SBL-Khas.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes active. 16 pax, next week if possible.",
      title: "Lean Six Sigma Yellow Belt for Warehouse Supervisors",
      deliveryMode: "IN_HOUSE",
      courseCode: "LSS-101",
      startInDays: 2,
      days: 3,
      pax: 16,
      minParticipants: 8,
      roster: 10,
      rosterOffset: 7,
      gate1Edit: { cell: "TrainerDailyRate", delta: "-300.00", why: "Trainer agreed RM 3,200/day for a three-day run" },
      mileage: { label: "Mileage KL - Port Klang return, 3 days (126 km at RM 0.60)", amount: "75.60" },
    }),
  },
  {
    label: "Claim ready: Gate 3 review pending (public class, pro-rated claim)",
    stop: "claim.evidence",
    expect: { operational: "DELIVERY_COMPLETED", financial: "CLAIM_READY" },
    scenario: scenario({
      key: "ppe-qms",
      company: ppe,
      enquiry: "We'd like to send 12 QA engineers to your ISO 9001 internal audit public class in October. Claimable under HRD Corp?",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes, registered with HRD Corp. 12 engineers.",
      title: "ISO 9001:2015 Internal Audit (public class)",
      deliveryMode: "PUBLIC_PHYSICAL",
      courseCode: "QMS-201",
      startInDays: 9,
      days: 2,
      pax: 12,
      minParticipants: 6,
      roster: 8,
      rosterOffset: 16,
      gate1Edit: { cell: "OtherCosts", delta: "150.00", why: "Courier for printed audit checklists" },
      absentee: { index: 2, day: 1, session: "PM", reason: "Recalled to the plant for a customer audit on Day 1 afternoon" },
    }),
  },
  {
    label: "Delivered; claim not ready (JD/14 outstanding)",
    stop: "delivery.complete",
    expect: { operational: "DELIVERY_COMPLETED", financial: "CLAIM_NOT_READY" },
    scenario: scenario({
      key: "sutera-comm",
      company: sutera,
      enquiry: "Business communication and report writing for 14 front office supervisors at our KL hotels. HRDC claimable.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes, we pay the HRD Corp levy. 14 supervisors.",
      title: "Business Communication for Front Office Supervisors",
      deliveryMode: "IN_HOUSE",
      courseCode: "COMM-101",
      startInDays: 7,
      days: 2,
      pax: 14,
      minParticipants: 6,
      roster: 9,
      rosterOffset: 20,
      gate1Edit: { cell: "TrainerDailyRate", delta: "-100.00", why: "Repeat-client rate" },
    }),
  },
  {
    label: "In delivery today: Day 1 attendance only, T3 exception open",
    stop: "t3.day1",
    expect: { operational: "DELIVERY_IN_PROGRESS", financial: "GRANT_RESERVED" },
    scenario: scenario({
      key: "borneo-data",
      company: borneo,
      enquiry: "Excel data analytics (Power Query, PivotTables) for 12 plantation executives, HRD Corp SBL-Khas, urgently.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes levy active, 12 pax, as soon as possible.",
      title: "Excel Data Analytics for Plantation Executives",
      deliveryMode: "IN_HOUSE",
      courseCode: "DATA-201",
      startInDays: 0,
      days: 2,
      pax: 12,
      minParticipants: 6,
      roster: 10,
      rosterOffset: 9,
      gate1Edit: { cell: "MaterialsCostPerPax", delta: "-20.00", why: "Workbooks shared digitally" },
      absentee: { index: 6, day: 1, session: "AM", reason: "Flight from Kuching delayed; arrived after lunch" },
    }),
  },
  {
    label: "Ready for event: links out, PRE quiz done",
    stop: "links",
    expect: { operational: "READY_FOR_EVENT", financial: "GRANT_RESERVED" },
    scenario: scenario({
      key: "kenanga-sup",
      company: kenanga,
      enquiry: "Effective supervisory skills for 20 newly promoted store supervisors, HRD Corp claimable, mid October.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes, 20 supervisors, mid October.",
      title: "Effective Supervisory Skills for New Store Supervisors",
      deliveryMode: "IN_HOUSE",
      courseCode: "SUP-101",
      startInDays: 10,
      days: 2,
      pax: 20,
      minParticipants: 10,
      roster: 14,
      rosterOffset: 14,
      gate1Edit: { cell: "TrainerDailyRate", delta: "-200.00", why: "Trainer agreed RM 200/day off for a repeat client" },
    }),
  },
  {
    label: "Gate 2: below minimum at T-14, viability decision pending",
    stop: "t14",
    expect: { operational: "OPERATIONS_LOCKED", financial: "GRANT_RESERVED" },
    scenario: scenario({
      key: "meridian-fin",
      company: meridian,
      enquiry: "Finance for non-finance managers for 12 operations managers, HRDC levy funded, early October.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes, levy active. Around 12 managers.",
      title: "Finance for Non-Finance Operations Managers",
      deliveryMode: "IN_HOUSE",
      courseCode: "FIN-101",
      startInDays: 12,
      days: 2,
      pax: 12,
      minParticipants: 8,
      roster: 3,
      rosterOffset: 24,
      gate1Edit: { cell: "OtherCosts", delta: "100.00", why: "Printed case-study packs" },
    }),
  },
  {
    label: "Grant approved; logistics not yet locked",
    stop: "grant.confirm",
    expect: { operational: "GRANT_APPROVED", financial: "GRANT_RESERVED" },
    scenario: scenario({
      key: "aurora-data",
      company: aurora,
      enquiry: "Excel data analytics for 25 production planners; HRD Corp claimable; early November.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Ya, pencarum levi. 25 orang, awal November.",
      title: "Excel Data Analytics for Production Planners",
      deliveryMode: "IN_HOUSE",
      courseCode: "DATA-201",
      startInDays: 30,
      days: 2,
      pax: 25,
      minParticipants: 10,
      roster: 0,
      rosterOffset: 0,
      gate1Edit: { cell: "VenueDDRPerPax", delta: "-5.00", why: "Negotiated weekday DDR" },
    }),
  },
  {
    label: "Grant pending: e-TRiS dossier with the client's HR",
    stop: "client.accept",
    expect: { operational: "GRANT_PENDING", financial: "GRANT_RESERVED" },
    scenario: scenario({
      key: "cahaya-tmg",
      company: {
        formName: "Cahaya Maju Pharmaceuticals Sdn Bhd",
        domain: "cahayamaju.com.my",
        mycoid: "HRD-CMP-512",
        picName: "Lee Wai Kuen",
        picEmail: "waikuen.lee@cahayamaju.com.my",
        picPhone: "016-332 8190",
      },
      enquiry: "Time management and personal productivity workshop for 20 regulatory affairs staff. We are an HRD Corp levy payer.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes, active HRD Corp contributor. 20 staff, end of October.",
      title: "Time Management for Regulatory Affairs",
      deliveryMode: "IN_HOUSE",
      courseCode: "TMG-101",
      startInDays: 35,
      days: 1,
      pax: 20,
      minParticipants: 8,
      roster: 0,
      rosterOffset: 0,
      gate1Edit: { cell: "MaterialsCostPerPax", delta: "-10.00", why: "Digital workbook" },
    }),
  },
  {
    label: "Quoted: quotation dispatched, awaiting the client",
    stop: "gate1.approve",
    expect: { operational: "QUOTED", financial: "ESTIMATE" },
    scenario: scenario({
      key: "sutera-cse",
      company: sutera,
      enquiry: "Customer service excellence for 24 front desk and F&B staff, HRDC claimable, November.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes. 24 staff in November.",
      title: "Customer Service Excellence for Front Desk and F&B",
      deliveryMode: "IN_HOUSE",
      courseCode: "CSE-101",
      startInDays: 40,
      days: 2,
      pax: 24,
      minParticipants: 10,
      roster: 0,
      rosterOffset: 0,
      gate1Edit: { cell: "TrainerDailyRate", delta: "-200.00", why: "Repeat-client rate" },
    }),
  },
  {
    label: "Draft: AI quotation awaiting Gate 1",
    stop: "proposal.draft",
    expect: { operational: "DRAFT", financial: "ESTIMATE" },
    scenario: scenario({
      key: "lumen-lead",
      company: {
        formName: "Lumen Semikonduktor Sdn Bhd",
        domain: "lumensemi.com.my",
        mycoid: "HRD-LSK-088",
        picName: "Ravi Chandran",
        picEmail: "ravi.chandran@lumensemi.com.my",
        picPhone: "019-455 7021",
      },
      enquiry: "Strategic leadership and conflict management for 16 senior engineers moving into management. HRD Corp claimable.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes we are levy registered. 16 engineers, November.",
      title: "Strategic Leadership for Engineering Leads",
      deliveryMode: "IN_HOUSE",
      courseCode: "LEAD-201",
      startInDays: 45,
      days: 2,
      pax: 16,
      minParticipants: 8,
      roster: 0,
      rosterOffset: 0,
    }),
  },
  {
    label: "Lead: qualified, micro-TNA answered, not yet converted",
    stop: "lead.qualify",
    expect: { lead: "LEAD_QUALIFIED_TNA" },
    scenario: scenario({
      key: "tekun-lead",
      company: {
        formName: "Tekun Engineering Works Sdn Bhd",
        domain: "tekuneng.com.my",
        mycoid: "HRD-TEW-301",
        picName: "Chong Kah Wai",
        picEmail: "kahwai.chong@tekuneng.com.my",
        picPhone: "017-288 4105",
      },
      enquiry: "Need ISO 9001 internal auditor training for 10 QA staff, HRD Corp SBL-Khas, before year end.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "Yes we are levy registered, 10 pax, before December.",
      title: "ISO 9001 Internal Auditor Training",
      deliveryMode: "IN_HOUSE",
      startInDays: 60,
      days: 2,
      pax: 10,
      minParticipants: 5,
      roster: 0,
      rosterOffset: 0,
    }),
  },
  {
    label: "Lead: triaged into the review band, LEAD_TRIAGE decision pending",
    stop: "lead.triage",
    expect: { lead: "TRIAGE_REVIEW" },
    scenario: scenario({
      key: "sinar-lead",
      company: {
        formName: "Sinar Jaya Plastics",
        domain: "sinarjayaplastics.com.my",
        mycoid: "HRD-SJP-000",
        picName: "Mohd Rizal Hamid",
        picEmail: "rizal.hamid@sinarjayaplastics.com.my",
        picPhone: "03-5192 4410",
      },
      enquiry: "Could you share information on your training programmes for our production team?",
      expectRoute: "TRIAGE_REVIEW",
      whatsappReply: "",
      title: "(not converted)",
      deliveryMode: "IN_HOUSE",
      startInDays: 60,
      days: 1,
      pax: 10,
      minParticipants: 5,
      roster: 0,
      rosterOffset: 0,
    }),
  },
  {
    label: "Lead: fresh, not yet triaged (lead.triage queued)",
    stop: "lead.ingest",
    expect: { lead: "LEAD_INGESTED" },
    scenario: scenario({
      key: "harmoni-lead",
      company: {
        formName: "Harmoni Healthcare Sdn Bhd",
        domain: "harmonihealth.com.my",
        mycoid: "HRD-HHC-412",
        picName: "Aina Kamal",
        picEmail: "aina.kamal@harmonihealth.com.my",
        picPhone: "012-903 6618",
      },
      enquiry: "HIRARC and OSH refresher for 30 nurses and porters, HRDC claimable, December.",
      expectRoute: "LEAD_QUALIFIED_TNA",
      whatsappReply: "",
      title: "(not converted)",
      deliveryMode: "IN_HOUSE",
      startInDays: 60,
      days: 1,
      pax: 30,
      minParticipants: 5,
      roster: 0,
      rosterOffset: 0,
    }),
  },
];

export interface PortfolioBuild {
  entry: PortfolioEntry;
  result: GoldenPathResult;
}

/**
 * Build every entry in order (reference data once, first). `onStep` sees each
 * package's steps as they finish; a failing entry throws, naming its step.
 */
export async function buildDemoPortfolio(opts: {
  ocr?: "auto" | "off";
  nonce?: string;
  entries?: PortfolioEntry[];
  onEntry?: (entry: PortfolioEntry, index: number) => void;
  onStep?: (entry: PortfolioEntry, record: StepRecord) => void;
} = {}): Promise<PortfolioBuild[]> {
  await ensureReferenceData();
  const nonce = opts.nonce ?? Date.now().toString(36);
  const built: PortfolioBuild[] = [];
  for (const [index, entry] of (opts.entries ?? DEMO_PORTFOLIO).entries()) {
    opts.onEntry?.(entry, index);
    const result = await driveTo(entry.stop, {
      scenario: entry.scenario,
      reference: false,
      ocr: opts.ocr,
      nonce,
      onStep: (record) => opts.onStep?.(entry, record),
    });
    built.push({ entry, result });
  }
  return built;
}
