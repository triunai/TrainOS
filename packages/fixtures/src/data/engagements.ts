/**
 * §8 · Engagements, sessions, participants and attendance.
 *
 * Screens M09-S02 (engagement detail) and M10-S06 (attendance capture).
 *
 * ENG-0231 carries the two states the pack turns on: day 1 attendance is
 * LOCKED and immutable, so capture returns `409 ATTENDANCE_LOCKED`, and the
 * `HRDC_CLAIM` lifecycle step is BLOCKED because a compliance check fails —
 * not because a document count says so.
 */

import type {
  AttendanceRow,
  AttendanceSheet,
  Engagement,
  Participant,
} from "@trainos/contract";
import {
  ENGAGEMENT_AFFECTED_1,
  ENGAGEMENT_AFFECTED_2,
  ENGAGEMENT_AURORA,
  ENGAGEMENT_BLOCKED,
  INVOICE_AURORA,
  OPPORTUNITY_AURORA,
  ORG_AURORA,
  PARTICIPANT_AISYAH,
  PROGRAMME_CONFLICT,
  PROGRAMME_DATA_LITERACY,
  PROGRAMME_LEADING_CHANGE,
  RULE_SET_2026_06_15,
  SESSION_DAY_1,
  SIGNATURE_ATTENDANCE,
  TRAINER_FARAH,
  TRAINER_FARAH_REF,
  USER_SITI,
} from "@trainos/contract";
import { ORG_KENANGA, ORG_MERIDIAN, ORG_SUTERA, OPPORTUNITY_MERIDIAN } from "./organisations";
import {
  PROGRAMME_SAFETY,
  PROGRAMME_SALES_EXCELLENCE,
  TRAINER_LEE_REF,
  TRAINER_NOORA_REF,
} from "./programmes";
import { actorFor } from "./tenant";
import { entity, myr } from "./_helpers";

/** Sessions and engagements the pack names without numbering. */
export const SESSION_DAY_2 = "SES-0462";
export const ENGAGEMENT_MERIDIAN = "ENG-0228";
export const ENGAGEMENT_SUTERA = "ENG-0203";
/** Delivered in May 2026 — its six-month claim window closes on 17 Nov. */
export const ENGAGEMENT_WINDOW_CLOSING = "ENG-0189";
/** Aurora's lost deal: a repeat client, so the TNA was skipped. */
export const ENGAGEMENT_AURORA_LOST = "ENG-0176";
/** Aurora's May delivery, whose claim window also closes on 17 Nov. */
export const ENGAGEMENT_AURORA_AT_RISK = "ENG-0187";

/** The thirty registered participants, PAR-1182 through PAR-1211. */
const participantRoster: ReadonlyArray<readonly [name: string, department: string]> = [
  ["Ahmad Firdaus", "Production"],
  ["Chong Kar Wai", "Production"],
  ["Nurul Izzati", "Quality"],
  ["Rajesh Manickam", "Maintenance"],
  ["Siti Khadijah", "Planning"],
  ["Tan Boon Hock", "Production"],
  ["Vimala Devi", "Quality"],
  ["Nur Aisyah", "Logistics"],
  ["Mohd Hafiz", "Production"],
  ["Lim Sook Yee", "Planning"],
  ["Arun Prakash", "Maintenance"],
  ["Zainab Osman", "Quality"],
  ["Wong Kah Meng", "Logistics"],
  ["Hasrul Amin", "Production"],
  ["Priya Naidu", "Planning"],
  ["Khairunnisa Mohd", "Quality"],
  ["Gopal Krishnan", "Maintenance"],
  ["Lee Pei Shan", "Logistics"],
  ["Amirul Haziq", "Production"],
  ["Farhana Rosli", "Quality"],
  ["Teo Chin Guan", "Production"],
  ["Sharmila Rao", "Planning"],
  ["Mohd Nazri", "Maintenance"],
  ["Chan Yee Ling", "Logistics"],
  ["Izzat Danial", "Production"],
  ["Roslina Ahmad", "Quality"],
  ["Kumaresan Pillai", "Maintenance"],
  ["Ng Wei Chen", "Planning"],
  ["Suhaila Karim", "Logistics"],
  ["Daniel Anak Jugah", "Production"],
];

const participantRef = (index: number): string => `PAR-${1182 + index}`;

/** ENG-0231's own thirty. The other cohorts are appended below. */
const auroraParticipants: Participant[] = participantRoster.map(([name, department], index) => ({
  ...entity(
    participantRef(index),
    "2026-10-20T09:00:00+08:00",
    "2026-11-13T17:30:00+08:00",
    actorFor(USER_SITI),
  ),
  engagementRef: ENGAGEMENT_AURORA,
  name,
  department,
  email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@auroramfg.com.my`,
  phone: null,
  certificateId: null,
}));

/** Absent both sessions on day 1 — medical leave, recorded with a reason. */
const ABSENT_DAY_1 = new Set<string>([PARTICIPANT_AISYAH]);
/** Day 2 adds one work conflict, which is what takes attendance to 28 of 30. */
const ABSENT_DAY_2 = new Set<string>([PARTICIPANT_AISYAH, "PAR-1195"]);

const attendanceRows = (day: 1 | 2): AttendanceRow[] => {
  const absent = day === 1 ? ABSENT_DAY_1 : ABSENT_DAY_2;
  const date = day === 1 ? "2026-11-12" : "2026-11-13";
  return participantRoster.map(([name, department], index): AttendanceRow => {
    const ref = participantRef(index);
    if (absent.has(ref)) {
      const reason = ref === PARTICIPANT_AISYAH ? "MEDICAL_LEAVE" : "WORK_CONFLICT";
      return {
        participantRef: ref,
        name,
        department,
        am: { present: false, reason },
        pm: { present: false, reason },
      };
    }
    return {
      participantRef: ref,
      name,
      department,
      am: { present: true, at: `${date}T09:02:00+08:00`, method: "QR" },
      pm: { present: true, at: `${date}T14:05:00+08:00`, method: "QR" },
      signatureRef: index === 0 && day === 1 ? SIGNATURE_ATTENDANCE : `sig_${ref.toLowerCase()}_d${day}`,
    };
  });
};

/* ------------------------------------------------------------------ *
 * The other delivered cohorts
 *
 * `/training/participants` fans out over every engagement, so a tree where
 * only ENG-0231 had a roster read "30 participants · 9 cohorts" — true, and
 * wrong about the product: eight cohorts that had run appeared to have trained
 * nobody. These four are the ones whose days have actually run.
 *
 * Two rules the rosters follow rather than invent:
 *
 * 1. A roster's LENGTH is the engagement's own `metrics.participants`. The
 *    number was already published and other screens read it, so a roster that
 *    disagreed would make one record say two things.
 * 2. Everyone present. Not flatness for its own sake — all four already carry
 *    `attendanceRate: 1` in metrics committed before this. ENG-0231 is the
 *    exception at 28 of 30 and it is the exception on purpose, because the
 *    medical leave and the work conflict are what the attendance screen exists
 *    to show. Inventing absences here would have contradicted the metric.
 *
 * The scheduled 2027 cohorts and the two cancelled ones get no roster: nobody
 * has attended a course that has not happened, and a registration list for a
 * cancelled engagement would be a claim about people who were stood down.
 * ------------------------------------------------------------------ */

/** A cohort's people, as `[name, department]` — the same shape as ENG-0231's. */
type CohortRoster = ReadonlyArray<readonly [name: string, department: string]>;

const BLOCKED_ROSTER: CohortRoster = [
  ["Amirul Shafiq", "Production"],
  ["Ng Chee Keong", "Production"],
  ["Siti Rahmah", "Quality"],
  ["Balan Subramaniam", "Maintenance"],
  ["Yap Hui Ling", "Safety"],
  ["Mohd Faizal", "Production"],
  ["Devi Anandan", "Quality"],
  ["Cheah Ming Hui", "Logistics"],
  ["Nor Azlina", "Safety"],
  ["Ramesh Chandran", "Maintenance"],
  ["Ooi Swee Lan", "Planning"],
  ["Hafizuddin Salleh", "Production"],
  ["Jayanthi Murugan", "Quality"],
  ["Loh Kah Seng", "Logistics"],
  ["Zulaikha Hamid", "Safety"],
  ["Anbarasu Rajoo", "Maintenance"],
  ["Tey Wan Ying", "Planning"],
  ["Mohd Syafiq", "Production"],
  ["Selvi Ramakrishnan", "Quality"],
  ["Goh Beng Huat", "Logistics"],
  ["Nadiah Zulkifli", "Safety"],
  ["Prakash Menon", "Maintenance"],
  ["Sim Li Fang", "Planning"],
  ["Azman Rahim", "Production"],
  ["Kalaivani Segaran", "Quality"],
  ["Tham Yoke Lin", "Logistics"],
  ["Shamsul Bahri", "Safety"],
  ["Dinesh Kumar", "Maintenance"],
];

const WINDOW_CLOSING_ROSTER: CohortRoster = [
  ["Lim Chee Wai", "Store Operations"],
  ["Nurhidayah Jamil", "Store Operations"],
  ["Suresh Balakrishnan", "Regional"],
  ["Chew Mei Ling", "Merchandising"],
  ["Mohd Ridzuan", "Store Operations"],
  ["Anitha Gopal", "Customer Service"],
  ["Tan Seng Kiat", "Store Operations"],
  ["Fatimah Zahra", "Merchandising"],
  ["Ravi Chandra", "Regional"],
  ["Wong Li Ping", "Customer Service"],
  ["Ahmad Zaki", "Store Operations"],
  ["Puvanes Wari", "Merchandising"],
  ["Khoo Ee Lin", "Store Operations"],
  ["Syafiqah Rosman", "Customer Service"],
  ["Manoj Sivam", "Regional"],
  ["Lau Chun Meng", "Store Operations"],
  ["Rosnah Ibrahim", "Merchandising"],
  ["Thavamani Raju", "Customer Service"],
  ["Yeo Kim Huat", "Store Operations"],
  ["Nurul Farhana", "Regional"],
  ["Segaran Marimuthu", "Store Operations"],
  ["Foo Wai Kit", "Merchandising"],
  ["Adibah Hassan", "Customer Service"],
  ["Vijaya Letchumi", "Store Operations"],
  ["Lee Ann Nee", "Merchandising"],
  ["Mohd Hafizi", "Regional"],
  ["Punitha Devan", "Customer Service"],
  ["Chin Yoke Ping", "Store Operations"],
  ["Zarina Mansor", "Merchandising"],
  ["Kesavan Pillai", "Regional"],
];

const AURORA_AT_RISK_ROSTER: CohortRoster = [
  ["Rosli Hamzah", "Production"],
  ["Tan Mei Fong", "Quality"],
  ["Suriya Kumar", "Maintenance"],
  ["Noorain Sulaiman", "Planning"],
  ["Chua Kok Leong", "Production"],
  ["Bhavani Nair", "Quality"],
  ["Mohd Asyraf", "Logistics"],
  ["Heng Sin Yee", "Production"],
  ["Letchumi Arumugam", "Quality"],
  ["Faridah Zainal", "Planning"],
  ["Koh Teck Wah", "Maintenance"],
  ["Iskandar Rahman", "Production"],
  ["Saraswathy Nadason", "Logistics"],
  ["Phang Yoke Chun", "Quality"],
  ["Hidayah Rosli", "Planning"],
  ["Murugan Velayutham", "Maintenance"],
  ["Low Chee Hong", "Production"],
  ["Aznida Baharin", "Quality"],
  ["Ganeson Krishnan", "Logistics"],
  ["Toh Yin Mei", "Planning"],
  ["Shahrul Nizam", "Production"],
  ["Indira Sekaran", "Quality"],
  ["Beh Choon Guan", "Maintenance"],
  ["Marlina Idris", "Logistics"],
  ["Sivanesan Raman", "Production"],
  ["Yong Pek Har", "Planning"],
];

const MERIDIAN_ROSTER: CohortRoster = [
  ["Hassan Mokhtar", "Fleet"],
  ["Leong Sze Wei", "Warehouse"],
  ["Kamala Devi", "Freight"],
  ["Norazlan Yusof", "Fleet"],
  ["Chong Wei Ming", "Warehouse"],
  ["Shanti Raveendran", "Finance"],
  ["Aida Suhaila", "Planning"],
  ["Tee Boon Leong", "Freight"],
  ["Rajan Muthusamy", "Fleet"],
  ["Wan Norhayati", "Warehouse"],
  ["Ong Kim Seng", "Finance"],
  ["Preetha Ganesan", "Planning"],
  ["Mohd Shahrin", "Freight"],
  ["Liew Mun Yee", "Warehouse"],
  ["Santhi Perumal", "Fleet"],
  ["Hamidah Yaakob", "Finance"],
  ["Soon Chee Hoe", "Planning"],
  ["Baskaran Naidu", "Freight"],
  ["Rohaya Mahmud", "Warehouse"],
  ["Pang Sook Fun", "Fleet"],
  ["Vellasamy Ramu", "Finance"],
  ["Nik Adlin", "Planning"],
];

/**
 * Departments follow the client, not the catalogue: a retail group's managers
 * sit in store operations and merchandising, a logistics operator's in fleet
 * and warehouse. A shared department list across four different businesses
 * would have been the tell that this data was generated rather than seeded.
 */
const COHORTS: ReadonlyArray<{
  engagementRef: string;
  roster: CohortRoster;
  /** The client's mail domain — same one their contacts use in organisations.ts. */
  domain: string;
  registeredAt: string;
  days: readonly [string, string];
  trainer: { ref: string; name: string };
  lockedAt: string;
}> = [
  {
    engagementRef: ENGAGEMENT_BLOCKED,
    roster: BLOCKED_ROSTER,
    domain: "auroramfg.com.my",
    registeredAt: "2026-07-28T09:00:00+08:00",
    days: ["2026-08-20", "2026-08-21"],
    trainer: { ref: TRAINER_NOORA_REF, name: "Noora Idris" },
    lockedAt: "2026-08-22T10:15:00+08:00",
  },
  {
    engagementRef: ENGAGEMENT_WINDOW_CLOSING,
    roster: WINDOW_CLOSING_ROSTER,
    domain: "kenangaretail.com.my",
    registeredAt: "2026-04-27T09:00:00+08:00",
    days: ["2026-05-20", "2026-05-21"],
    trainer: { ref: TRAINER_LEE_REF, name: "Lee Chin Hoe" },
    lockedAt: "2026-05-22T09:40:00+08:00",
  },
  {
    engagementRef: ENGAGEMENT_AURORA_AT_RISK,
    roster: AURORA_AT_RISK_ROSTER,
    domain: "auroramfg.com.my",
    registeredAt: "2026-04-24T09:00:00+08:00",
    days: ["2026-05-16", "2026-05-17"],
    trainer: { ref: TRAINER_FARAH_REF, name: "Farah Aziz" },
    lockedAt: "2026-05-18T11:05:00+08:00",
  },
  {
    engagementRef: ENGAGEMENT_MERIDIAN,
    roster: MERIDIAN_ROSTER,
    domain: "meridianlog.com.my",
    registeredAt: "2026-09-15T09:00:00+08:00",
    days: ["2026-10-08", "2026-10-09"],
    trainer: { ref: TRAINER_LEE_REF, name: "Lee Chin Hoe" },
    lockedAt: "2026-10-10T09:20:00+08:00",
  },
];

/** PAR-1182 through PAR-1211 are ENG-0231's; these continue the run. */
let nextParticipantIndex = participantRoster.length;

const emailFor = (name: string, domain: string): string =>
  `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${domain}`;

const cohortParticipants: Participant[] = COHORTS.flatMap((cohort) =>
  cohort.roster.map(([name, department]): Participant => {
    const ref = participantRef(nextParticipantIndex);
    nextParticipantIndex += 1;
    return {
      ...entity(ref, cohort.registeredAt, `${cohort.days[1]}T17:30:00+08:00`, actorFor(USER_SITI)),
      engagementRef: cohort.engagementRef,
      name,
      department,
      email: emailFor(name, cohort.domain),
      phone: null,
      certificateId: null,
    };
  }),
);

/**
 * Both days of each cohort, locked.
 *
 * All four delivered months ago and their metrics already say every day ran,
 * so `immutable: true` and every capture mode false — the screen disables from
 * the response rather than from its own arithmetic about dates. Signatures
 * reconcile exactly because everybody attended; ENG-0231 is the only sheet in
 * the tree where they do not, which is the point of that one.
 */
const cohortAttendanceSheets: Record<string, AttendanceSheet> = Object.fromEntries(
  COHORTS.flatMap((cohort) => {
    const roster = cohortParticipants.filter((row) => row.engagementRef === cohort.engagementRef);
    return cohort.days.map((date, dayIndex) => {
      const day = (dayIndex + 1) as 1 | 2;
      const sheet: AttendanceSheet = {
        engagementRef: cohort.engagementRef,
        day,
        date,
        status: "LOCKED",
        immutable: true,
        approvedBy: { id: cohort.trainer.ref, name: cohort.trainer.name, kind: "HUMAN" },
        approvedAt: cohort.lockedAt,
        summary: {
          registered: roster.length,
          presentAm: roster.length,
          presentPm: roster.length,
          signatures: roster.length * 2,
          signaturesExpected: roster.length * 2,
        },
        rows: roster.map((participant): AttendanceRow => ({
          participantRef: participant.ref,
          name: participant.name,
          department: participant.department,
          am: { present: true, at: `${date}T09:00:00+08:00`, method: "QR" },
          pm: { present: true, at: `${date}T14:00:00+08:00`, method: "QR" },
          signatureRef: `sig_${participant.ref.toLowerCase()}_d${day}`,
        })),
        captureModes: { qr: false, signature: false, manual: false },
      };
      return [`${cohort.engagementRef}::${day}`, sheet] as const;
    });
  }),
);

/**
 * §8 `GET /v1/engagements/{id}/attendance?day=`, keyed `engagementRef::day`.
 *
 * Day 1 is locked: `immutable: true` and every capture mode false, so the UI
 * disables from the response rather than from its own logic. Day 2 is still
 * open for approval, which is what APV-2026-0774 decides.
 */
const auroraAttendanceSheets: Record<string, AttendanceSheet> = {
  [`${ENGAGEMENT_AURORA}::1`]: {
    engagementRef: ENGAGEMENT_AURORA,
    day: 1,
    date: "2026-11-12",
    status: "LOCKED",
    immutable: true,
    approvedBy: { id: TRAINER_FARAH, name: "Farah Aziz", kind: "HUMAN" },
    approvedAt: "2026-11-14T10:01:00+08:00",
    summary: { registered: 30, presentAm: 29, presentPm: 29, signatures: 58, signaturesExpected: 60 },
    rows: attendanceRows(1),
    captureModes: { qr: false, signature: false, manual: false },
  },
  [`${ENGAGEMENT_AURORA}::2`]: {
    engagementRef: ENGAGEMENT_AURORA,
    day: 2,
    date: "2026-11-13",
    status: "PENDING_APPROVAL",
    immutable: false,
    approvedBy: null,
    approvedAt: null,
    summary: { registered: 30, presentAm: 28, presentPm: 28, signatures: 56, signaturesExpected: 60 },
    rows: attendanceRows(2),
    captureModes: { qr: true, signature: true, manual: true },
  },
};

/**
 * §8 `GET /v1/engagements/{id}/participants`, every cohort.
 *
 * ENG-0231's thirty first, so its refs stay PAR-1182 through PAR-1211 and
 * every fixture, test and screenshot that names one still means that person.
 */
export const participants: Participant[] = [...auroraParticipants, ...cohortParticipants];

/** §8 `GET /v1/engagements/{id}/attendance?day=`, every cohort. */
export const attendanceSheets: Record<string, AttendanceSheet> = {
  ...auroraAttendanceSheets,
  ...cohortAttendanceSheets,
};

/** §8 `GET /v1/engagements` and `GET /v1/engagements/{id}`. */
export const engagements: Engagement[] = [
  {
    ...entity(ENGAGEMENT_AURORA, "2026-09-15T10:24:00+08:00", "2026-11-14T10:32:00+08:00", actorFor(USER_SITI)),
    title: "Leading Through Change",
    organisationRef: ORG_AURORA,
    programmeRef: PROGRAMME_LEADING_CHANGE,
    opportunityRef: OPPORTUNITY_AURORA,
    status: "DELIVERED",
    venue: "Aurora HQ Shah Alam",
    dates: ["2026-11-12", "2026-11-13"],
    owner: actorFor(USER_SITI),
    value: myr(1850000),
    metrics: {
      participants: 30,
      attended: 28,
      attendanceRate: 0.93,
      trainer: { ref: TRAINER_FARAH_REF, name: "Farah Aziz" },
      claimCompleteness: 0.62,
    },
    lifecycle: [
      { key: "WON", state: "DONE", at: "2026-09-15" },
      { key: "TRAINER_CONFIRMED", state: "DONE", at: "2026-09-16" },
      { key: "SCHEDULED", state: "DONE" },
      { key: "REGISTERED", state: "DONE" },
      { key: "DELIVERED", state: "DONE", at: "2026-11-13" },
      { key: "ATTENDANCE_LOCKED", state: "DONE", at: "2026-11-14" },
      /** BLOCKED because CHK_DOCS_COMPLETE fails, not because a count says so. */
      { key: "HRDC_CLAIM", state: "BLOCKED", note: "2 documents missing" },
      { key: "INVOICED", state: "CURRENT", ref: INVOICE_AURORA },
      { key: "PAID", state: "PENDING" },
    ],
    checklist: [
      { key: "TRAINER_LETTER", label: "Trainer engagement letter", done: true },
      { key: "JOINING_INSTRUCTIONS", label: "Joining instructions sent", done: true },
      { key: "MATERIALS_SHIPPED", label: "Materials shipped to site", done: true },
      { key: "ATTENDANCE_LOCKED", label: "Attendance locked", done: true },
      { key: "EVALUATION_SUMMARY", label: "Evaluation summary compiled", done: false },
      { key: "CERTIFICATES_ISSUED", label: "Certificates issued", done: false },
    ],
    sessions: [
      {
        ref: SESSION_DAY_1,
        day: 1,
        date: "2026-11-12",
        title: "Escalation & conflict",
        venue: "Training Room A",
        trainerRef: TRAINER_FARAH_REF,
        present: 29,
        total: 30,
      },
      {
        ref: SESSION_DAY_2,
        day: 2,
        date: "2026-11-13",
        title: "Commitments & change",
        venue: "Training Room A",
        trainerRef: TRAINER_FARAH_REF,
        present: 28,
        total: 30,
      },
    ],
    finance: {
      invoiceRef: INVOICE_AURORA,
      syncState: "VALIDATED",
      trainerPayable: myr(960000),
      realisedMarginRate: 0.41,
    },
    ruleSetVersion: RULE_SET_2026_06_15,
  },
  {
    ...entity(ENGAGEMENT_BLOCKED, "2026-07-02T09:00:00+08:00", "2026-09-30T16:00:00+08:00", actorFor(USER_SITI)),
    title: "Safety Leadership Essentials",
    organisationRef: ORG_AURORA,
    programmeRef: PROGRAMME_SAFETY,
    status: "DELIVERED",
    venue: "Aurora HQ Shah Alam",
    dates: ["2026-08-20", "2026-08-21"],
    owner: actorFor(USER_SITI),
    value: myr(1620000),
    metrics: {
      participants: 28,
      attended: 28,
      attendanceRate: 1,
      trainer: { ref: TRAINER_NOORA_REF, name: "Noora Idris" },
      claimCompleteness: 0.6,
    },
    lifecycle: [
      { key: "WON", state: "DONE", at: "2026-07-02" },
      { key: "TRAINER_CONFIRMED", state: "DONE", at: "2026-07-08" },
      { key: "SCHEDULED", state: "DONE" },
      { key: "REGISTERED", state: "DONE" },
      { key: "DELIVERED", state: "DONE", at: "2026-08-21" },
      { key: "ATTENDANCE_LOCKED", state: "DONE", at: "2026-08-25" },
      { key: "HRDC_CLAIM", state: "BLOCKED", note: "Trainer not HRD Corp accredited" },
      { key: "INVOICED", state: "DONE", ref: "INV-2026-0288" },
      { key: "PAID", state: "PENDING" },
    ],
    checklist: [
      { key: "TRAINER_LETTER", label: "Trainer engagement letter", done: true },
      { key: "ATTENDANCE_LOCKED", label: "Attendance locked", done: true },
      { key: "EVALUATION_SUMMARY", label: "Evaluation summary compiled", done: true },
      { key: "CERTIFICATES_ISSUED", label: "Certificates issued", done: false },
    ],
    sessions: [],
    finance: {
      invoiceRef: "INV-2026-0288",
      syncState: "VALIDATED",
      trainerPayable: myr(560000),
      realisedMarginRate: 0.38,
    },
    ruleSetVersion: RULE_SET_2026_06_15,
  },
  {
    ...entity(ENGAGEMENT_AFFECTED_1, "2026-11-06T16:12:00+08:00", "2026-11-13T12:00:00+08:00", actorFor(USER_SITI)),
    title: "Leading Through Change — Kenanga cohort 1",
    organisationRef: ORG_KENANGA,
    programmeRef: PROGRAMME_LEADING_CHANGE,
    status: "SCHEDULED",
    venue: "Kenanga Tower, Kuala Lumpur",
    dates: ["2027-01-14", "2027-01-15"],
    owner: actorFor(USER_SITI),
    value: myr(1650000),
    metrics: {
      participants: 24,
      attended: 0,
      attendanceRate: 0,
      trainer: { ref: TRAINER_FARAH_REF, name: "Farah Aziz" },
      claimCompleteness: 0.2,
    },
    lifecycle: [
      { key: "WON", state: "DONE", at: "2026-11-06" },
      { key: "TRAINER_CONFIRMED", state: "CURRENT" },
      { key: "SCHEDULED", state: "DONE" },
      { key: "REGISTERED", state: "PENDING" },
      { key: "DELIVERED", state: "PENDING" },
      { key: "ATTENDANCE_LOCKED", state: "PENDING" },
      { key: "HRDC_CLAIM", state: "PENDING" },
      { key: "INVOICED", state: "PENDING" },
      { key: "PAID", state: "PENDING" },
    ],
    checklist: [{ key: "TRAINER_LETTER", label: "Trainer engagement letter", done: false }],
    sessions: [],
    finance: { invoiceRef: null, syncState: "NOT_SENT", trainerPayable: myr(960000), realisedMarginRate: 0.42 },
    /** Applied at grant submission — the version the drift warning cites. */
    ruleSetVersion: RULE_SET_2026_06_15,
  },
  {
    ...entity(ENGAGEMENT_AFFECTED_2, "2026-11-10T09:40:00+08:00", "2026-11-12T10:00:00+08:00", actorFor(USER_SITI)),
    title: "Data Literacy for Managers — January cohort",
    organisationRef: ORG_MERIDIAN,
    programmeRef: PROGRAMME_DATA_LITERACY,
    opportunityRef: OPPORTUNITY_MERIDIAN,
    status: "CONFIRMED",
    venue: "Akademi Perdana, Petaling Jaya",
    dates: ["2027-01-21", "2027-01-22"],
    owner: actorFor(USER_SITI),
    value: myr(1920000),
    metrics: {
      participants: 22,
      attended: 0,
      attendanceRate: 0,
      trainer: { ref: TRAINER_LEE_REF, name: "Lee Chin Hoe" },
      claimCompleteness: 0.15,
    },
    lifecycle: [
      { key: "WON", state: "DONE", at: "2026-11-10" },
      { key: "TRAINER_CONFIRMED", state: "DONE", at: "2026-11-12" },
      { key: "SCHEDULED", state: "CURRENT" },
      { key: "REGISTERED", state: "PENDING" },
      { key: "DELIVERED", state: "PENDING" },
      { key: "ATTENDANCE_LOCKED", state: "PENDING" },
      { key: "HRDC_CLAIM", state: "PENDING" },
      { key: "INVOICED", state: "PENDING" },
      { key: "PAID", state: "PENDING" },
    ],
    checklist: [{ key: "TRAINER_LETTER", label: "Trainer engagement letter", done: true }],
    sessions: [],
    finance: { invoiceRef: null, syncState: "NOT_SENT", trainerPayable: myr(720000), realisedMarginRate: 0.48 },
    ruleSetVersion: RULE_SET_2026_06_15,
  },
  {
    ...entity(ENGAGEMENT_MERIDIAN, "2026-09-18T09:00:00+08:00", "2026-10-30T16:00:00+08:00", actorFor(USER_SITI)),
    title: "Data Literacy for Managers — October cohort",
    organisationRef: ORG_MERIDIAN,
    programmeRef: PROGRAMME_DATA_LITERACY,
    status: "CLOSED",
    venue: "Akademi Perdana, Petaling Jaya",
    dates: ["2026-10-08", "2026-10-09"],
    owner: actorFor(USER_SITI),
    value: myr(1920000),
    metrics: {
      participants: 22,
      attended: 22,
      attendanceRate: 1,
      trainer: { ref: TRAINER_LEE_REF, name: "Lee Chin Hoe" },
      claimCompleteness: 1,
    },
    lifecycle: [
      { key: "WON", state: "DONE", at: "2026-09-18" },
      { key: "TRAINER_CONFIRMED", state: "DONE", at: "2026-09-20" },
      { key: "SCHEDULED", state: "DONE" },
      { key: "REGISTERED", state: "DONE" },
      { key: "DELIVERED", state: "DONE", at: "2026-10-09" },
      { key: "ATTENDANCE_LOCKED", state: "DONE", at: "2026-10-12" },
      { key: "HRDC_CLAIM", state: "DONE", at: "2026-10-28" },
      { key: "INVOICED", state: "DONE" },
      { key: "PAID", state: "DONE", at: "2026-10-30" },
    ],
    checklist: [
      { key: "TRAINER_LETTER", label: "Trainer engagement letter", done: true },
      { key: "EVALUATION_SUMMARY", label: "Evaluation summary compiled", done: true },
      { key: "CERTIFICATES_ISSUED", label: "Certificates issued", done: true },
    ],
    sessions: [],
    finance: { invoiceRef: null, syncState: "VALIDATED", trainerPayable: myr(720000), realisedMarginRate: 0.48 },
    ruleSetVersion: RULE_SET_2026_06_15,
  },
  {
    ...entity(ENGAGEMENT_WINDOW_CLOSING, "2026-03-30T09:00:00+08:00", "2026-05-22T09:00:00+08:00", actorFor(USER_SITI)),
    title: "Sales Excellence for Store Managers — Kenanga",
    organisationRef: ORG_KENANGA,
    programmeRef: PROGRAMME_SALES_EXCELLENCE,
    status: "DELIVERED",
    venue: "Kenanga Tower, Kuala Lumpur",
    dates: ["2026-05-20", "2026-05-21"],
    owner: actorFor(USER_SITI),
    value: myr(2240000),
    metrics: {
      participants: 30,
      attended: 30,
      attendanceRate: 1,
      trainer: { ref: TRAINER_LEE_REF, name: "Lee Chin Hoe" },
      claimCompleteness: 1,
    },
    lifecycle: [
      { key: "WON", state: "DONE", at: "2026-03-30" },
      { key: "TRAINER_CONFIRMED", state: "DONE", at: "2026-04-02" },
      { key: "SCHEDULED", state: "DONE" },
      { key: "REGISTERED", state: "DONE" },
      { key: "DELIVERED", state: "DONE", at: "2026-05-21" },
      { key: "ATTENDANCE_LOCKED", state: "DONE", at: "2026-05-22" },
      /** Packet is complete; only the human eTRIS filing is outstanding, and the window closes in 3 days. */
      { key: "HRDC_CLAIM", state: "CURRENT", note: "Claim window closes 17 Nov" },
      { key: "INVOICED", state: "DONE", ref: "INV-2026-0201" },
      { key: "PAID", state: "DONE", at: "2026-06-25" },
    ],
    checklist: [
      { key: "TRAINER_LETTER", label: "Trainer engagement letter", done: true },
      { key: "EVALUATION_SUMMARY", label: "Evaluation summary compiled", done: true },
      { key: "CERTIFICATES_ISSUED", label: "Certificates issued", done: true },
    ],
    sessions: [],
    finance: {
      invoiceRef: "INV-2026-0201",
      syncState: "VALIDATED",
      trainerPayable: myr(720000),
      realisedMarginRate: 0.46,
    },
    ruleSetVersion: RULE_SET_2026_06_15,
  },
  {
    ...entity(ENGAGEMENT_AURORA_LOST, "2026-02-10T09:00:00+08:00", "2026-03-20T16:00:00+08:00", actorFor(USER_SITI)),
    title: "Conflict to Collaboration — Aurora supervisors",
    organisationRef: ORG_AURORA,
    programmeRef: PROGRAMME_CONFLICT,
    status: "CANCELLED",
    venue: "Aurora HQ Shah Alam",
    dates: ["2026-04-02"],
    owner: actorFor(USER_SITI),
    value: myr(980000),
    metrics: {
      participants: 0,
      attended: 0,
      attendanceRate: 0,
      trainer: { ref: TRAINER_FARAH_REF, name: "Farah Aziz" },
      claimCompleteness: 0,
    },
    lifecycle: [
      { key: "WON", state: "FAILED", note: "Lost on price to an in-house facilitator" },
      { key: "TRAINER_CONFIRMED", state: "SKIPPED" },
      { key: "SCHEDULED", state: "SKIPPED" },
      { key: "REGISTERED", state: "SKIPPED" },
      { key: "DELIVERED", state: "SKIPPED" },
      { key: "ATTENDANCE_LOCKED", state: "SKIPPED" },
      { key: "HRDC_CLAIM", state: "SKIPPED" },
      { key: "INVOICED", state: "SKIPPED" },
      { key: "PAID", state: "SKIPPED" },
    ],
    checklist: [],
    sessions: [],
    finance: { invoiceRef: null, syncState: "NOT_SENT", trainerPayable: myr(0), realisedMarginRate: 0 },
  },
  {
    ...entity(ENGAGEMENT_AURORA_AT_RISK, "2026-03-02T09:00:00+08:00", "2026-05-18T09:00:00+08:00", actorFor(USER_SITI)),
    title: "Leading Through Change — Aurora spring cohort",
    organisationRef: ORG_AURORA,
    programmeRef: PROGRAMME_LEADING_CHANGE,
    status: "DELIVERED",
    venue: "Aurora HQ Shah Alam",
    dates: ["2026-05-16", "2026-05-17"],
    owner: actorFor(USER_SITI),
    value: myr(1850000),
    metrics: {
      participants: 26,
      attended: 26,
      attendanceRate: 1,
      trainer: { ref: TRAINER_FARAH_REF, name: "Farah Aziz" },
      claimCompleteness: 1,
    },
    lifecycle: [
      { key: "WON", state: "DONE", at: "2026-03-02" },
      { key: "TRAINER_CONFIRMED", state: "DONE", at: "2026-03-06" },
      { key: "SCHEDULED", state: "DONE" },
      { key: "REGISTERED", state: "DONE" },
      { key: "DELIVERED", state: "DONE", at: "2026-05-17" },
      { key: "ATTENDANCE_LOCKED", state: "DONE", at: "2026-05-18" },
      /** Complete and unfiled: the only thing left is a human on eTRIS, and the window closes on 17 Nov. */
      { key: "HRDC_CLAIM", state: "CURRENT", note: "Claim window closes 17 Nov" },
      { key: "INVOICED", state: "DONE", ref: "INV-2026-0212" },
      { key: "PAID", state: "DONE", at: "2026-06-20" },
    ],
    checklist: [
      { key: "TRAINER_LETTER", label: "Trainer engagement letter", done: true },
      { key: "EVALUATION_SUMMARY", label: "Evaluation summary compiled", done: true },
      { key: "CERTIFICATES_ISSUED", label: "Certificates issued", done: true },
    ],
    sessions: [],
    finance: {
      invoiceRef: "INV-2026-0212",
      syncState: "VALIDATED",
      trainerPayable: myr(960000),
      realisedMarginRate: 0.41,
    },
    ruleSetVersion: RULE_SET_2026_06_15,
  },
  {
    ...entity(ENGAGEMENT_SUTERA, "2026-05-20T10:00:00+08:00", "2026-06-30T15:00:00+08:00", actorFor(USER_SITI)),
    title: "Conflict to Collaboration — Sutera",
    organisationRef: ORG_SUTERA,
    programmeRef: PROGRAMME_CONFLICT,
    status: "CANCELLED",
    venue: "Sutera Bukit Bintang, Kuala Lumpur",
    dates: ["2026-06-11"],
    owner: actorFor(USER_SITI),
    value: myr(980000),
    metrics: {
      participants: 0,
      attended: 0,
      attendanceRate: 0,
      trainer: { ref: TRAINER_FARAH_REF, name: "Farah Aziz" },
      claimCompleteness: 0,
    },
    lifecycle: [
      { key: "WON", state: "FAILED", note: "Opportunity lost on price" },
      { key: "TRAINER_CONFIRMED", state: "SKIPPED" },
      { key: "SCHEDULED", state: "SKIPPED" },
      { key: "REGISTERED", state: "SKIPPED" },
      { key: "DELIVERED", state: "SKIPPED" },
      { key: "ATTENDANCE_LOCKED", state: "SKIPPED" },
      { key: "HRDC_CLAIM", state: "SKIPPED" },
      { key: "INVOICED", state: "SKIPPED" },
      { key: "PAID", state: "SKIPPED" },
    ],
    checklist: [],
    sessions: [],
    finance: { invoiceRef: null, syncState: "NOT_SENT", trainerPayable: myr(0), realisedMarginRate: 0 },
  },
];
