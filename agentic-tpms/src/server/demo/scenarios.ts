import type { DeliveryMode } from "../domain/stages";
import type { Session } from "../attendance/sessions";

/**
 * A demo scenario is everything that differs between two packages driven
 * down the golden path: who enquired and how, what was sold, when it runs,
 * who attends, and the references the outside world (HRD Corp, the bank,
 * the venue) hands back. The steps themselves are shared; see goldenPath.ts.
 *
 * All companies, people and references are FICTIONAL.
 */
export type LeadRoute = "TRIAGE_REVIEW" | "LEAD_QUALIFIED_TNA";
export type QuoteCell = "TrainerDailyRate" | "VenueDDRPerPax" | "MaterialsCostPerPax" | "OtherCosts";

export interface DemoScenario {
  key: string;
  company: {
    /** What the PIC typed in the web form's company field. */
    formName: string;
    domain: string;
    mycoid: string;
    picName: string;
    picEmail: string;
    /** As typed (local format is fine; ingestion normalises it). */
    picPhone: string;
  };
  /** The web-form enquiry text. */
  enquiry: string;
  /** Where the deterministic L1 classifier routes this enquiry; the step asserts it. */
  expectRoute: LeadRoute;
  /** The operator's note when resolving a TRIAGE_REVIEW lead. */
  triageNote: string;
  /** The PIC's WhatsApp answer to the micro-TNA. */
  whatsappReply: string;

  title: string;
  deliveryMode: DeliveryMode;
  /** Pin a catalogue course; omit to let the sourcing agent's pgvector search pick one. */
  courseCode?: string;
  startInDays: number;
  days: number;
  pax: number;
  minParticipants: number;
  /** Participants registered before T-14. */
  roster: number;
  /** Rotates the demo name list so cohorts differ. */
  rosterOffset: number;

  /** The Gate 1 edit an operator makes on the agent's sheet (one input cell); omit to approve the draft as priced. */
  gate1Edit?: { cell: QuoteCell; delta: string; why: string };
  /** One participant misses one session (stays below 80%, not claimable). */
  absentee?: { index: number; day: number; session: Session; reason: string };
  /** One participant checks in at the room display instead of their own link. */
  sessionQr?: { index: number; day: number; session: Session };

  claim: { query: string; response: string };
  /** A trainer mileage claim added to the trainer's payment voucher. */
  mileage?: { label: string; amount: string };
}

/**
 * The golden path's own package: a food manufacturer's HR manager asks, on
 * the website, for in-house leadership training for 20 supervisors. She typed
 * the company without "Sdn Bhd" and gave no levy words, so L1 is unsure
 * (P(levy) about 0.77) and a human qualifies the lead.
 */
export const GOLDEN_SCENARIO: DemoScenario = {
  key: "seri-mutiara",
  company: {
    formName: "Seri Mutiara Foods",
    domain: "serimutiarafoods.com.my",
    mycoid: "HRD-SMF-2207",
    picName: "Farhana Ismail",
    picEmail: "farhana.ismail@serimutiarafoods.com.my",
    picPhone: "012-718 4402",
  },
  enquiry:
    "Hi, we would like to run an in-house leadership programme for 20 staff (newly promoted line supervisors) at our Shah Alam plant. " +
    "Could you propose a 2-day workshop in mid October?",
  expectRoute: "TRIAGE_REVIEW",
  triageNote: "Called Farhana: 180 staff in Shah Alam, active HRD Corp levy contributor, wants the SBL-Khas route",
  whatsappReply: "Ya, kami pencarum levi HRD Corp yang aktif. 20 orang, pertengahan Oktober.",
  title: "Leading Through Change for Line Supervisors",
  deliveryMode: "IN_HOUSE",
  startInDays: 20,
  days: 2,
  pax: 20,
  minParticipants: 10,
  roster: 12,
  rosterOffset: 0,
  gate1Edit: { cell: "TrainerDailyRate", delta: "-200.00", why: "Trainer agreed RM 200/day off her standard rate for a two-day booking" },
  absentee: { index: 8, day: 1, session: "PM", reason: "Left after lunch on Day 1 for a family emergency" },
  sessionQr: { index: 3, day: 1, session: "AM" },
  claim: {
    query: "HRD Corp query: one participant on the T3 register is marked absent for the Day 1 PM session; confirm the claim headcount.",
    response: "Replied on e-TRiS: the per-group claim is unchanged; the participant is excluded from the eligible list and did not receive a certificate.",
  },
  mileage: { label: "Mileage KL - Shah Alam return, 2 days (84 km at RM 0.60)", amount: "50.40" },
};

/**
 * The web-form payload for a scenario. `lead_id` is the form tool's own
 * submission id: the normaliser keeps it out of the lead's message, and the
 * `nonce` in it keeps a re-run from being a byte-identical REPLAY.
 */
export function webFormPayload(s: DemoScenario, nonce: string): Record<string, unknown> {
  return {
    name: s.company.picName,
    email: s.company.picEmail,
    phone: s.company.picPhone,
    company: s.company.formName,
    message: s.enquiry,
    utm_source: "website",
    utm_campaign: "q4-levy-push",
    whatsapp_opt_in: "yes",
    lead_id: `${s.key}-${nonce}`,
  };
}
