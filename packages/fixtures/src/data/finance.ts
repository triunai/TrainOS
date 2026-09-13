/**
 * §9 · Invoices, payments, receivables and collections.
 *
 * Screens M13-S02 (invoice detail) and M13-S05 (collections queue).
 *
 * §18 / DECISIONS §7 is applied: lines are truth and totals are sums. The
 * RM 18,500 package price for 30 participants is **one line at `qty: 1`** with
 * the RM 616.67 per-pax figure carried as `display.perPax`, because
 * 61667 × 30 is RM 18,500.10 and a per-pax figure that does not multiply
 * cleanly must never become a line. The §9 example's 30 × RM 616.67 line is
 * the modelling error §18 exists to correct.
 */

import type {
  AnyActionType,
  AutonomyLevel,
  CollectionRule,
  Invoice,
  MessageDraft,
  Receivable,
  ReceivablesAging,
} from "@trainos/contract";
import {
  ACCOUNTING_CUSTOMER,
  ACCOUNTING_DOCUMENT,
  CONTACT_NURUL,
  ENGAGEMENT_AURORA,
  ENGAGEMENT_BLOCKED,
  INVOICE_AURORA,
  INVOICE_OVERDUE,
  INVOICE_UIN,
  ENGAGEMENT_AFFECTED_1,
  ORG_AURORA,
  USER_JASON,
} from "@trainos/contract";
import { AGENT_COLLECTIONS } from "./agents-ids";
import {
  ENGAGEMENT_AURORA_AT_RISK,
  ENGAGEMENT_MERIDIAN,
  ENGAGEMENT_SUTERA,
  ENGAGEMENT_WINDOW_CLOSING,
} from "./engagements";
import { ORG_KENANGA, ORG_MERIDIAN, ORG_SUTERA } from "./organisations";
import { actorFor } from "./tenant";
import { entity, myr, sumMoney } from "./_helpers";

/** Invoices the pack implies but does not number. */
export const INVOICE_KENANGA_PAID = "INV-2026-0201";
export const INVOICE_MERIDIAN_OVERDUE = "INV-2026-0279";
export const INVOICE_SYNC_FAILED = "INV-2026-0295";
export const INVOICE_MERIDIAN_OPEN = "INV-2026-0308";
export const INVOICE_KENANGA_OPEN = "INV-2026-0305";
export const INVOICE_KENANGA_RECENT = "INV-2026-0301";
/** The stale Sutera invoice that carries the ladder past its last rung. */
export const INVOICE_SUTERA_STALE = "INV-2026-0244";
/** Aurora's spring cohort, paid in June — the tax invoice its claim packet cites. */
export const INVOICE_AURORA_SPRING = "INV-2026-0212";

/** §9 `GET /v1/invoices/{id}`. */
export const invoices: Invoice[] = [
  {
    ...entity(INVOICE_AURORA, "2026-11-14T10:00:00+08:00", "2026-11-14T10:04:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_AURORA,
    engagementRef: ENGAGEMENT_AURORA,
    status: "SENT",
    issuedAt: "2026-11-14T10:00:00+08:00",
    dueAt: "2026-12-14",
    termsDays: 30,
    lines: [
      {
        description: "Leading Through Change · 2-day programme",
        detail: "12–13 Nov 2026 · Aurora HQ Shah Alam · up to 30 participants",
        qty: 1,
        unit: myr(1850000),
        amount: myr(1850000),
      },
    ],
    subtotal: myr(1850000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(1850000),
    outstanding: myr(1850000),
    sync: {
      state: "VALIDATED",
      provider: "ACCOUNTING",
      uin: INVOICE_UIN,
      lastAttemptAt: "2026-11-14T10:04:00+08:00",
    },
    syncLog: [
      {
        at: "2026-11-14T09:58:00+08:00",
        state: "ERROR",
        providerCode: "CUSTOMER_NOT_MAPPED",
        detail: '"Aurora Mfg" did not match a customer',
        resolution: `Mapped ${ORG_AURORA} → ${ACCOUNTING_CUSTOMER}`,
      },
      { at: "2026-11-14T10:02:00+08:00", state: "SENT", detail: "Pushed to accounting package" },
      {
        at: "2026-11-14T10:04:00+08:00",
        state: "VALIDATED",
        detail: "MyInvois validation returned UIN",
        uin: INVOICE_UIN,
      },
    ],
    payments: [],
    /** §18 — informational only, never a line. */
    display: { perPax: myr(61667) },
  },
  {
    ...entity(INVOICE_OVERDUE, "2026-09-10T10:00:00+08:00", "2026-11-14T08:30:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_AURORA,
    engagementRef: ENGAGEMENT_BLOCKED,
    status: "OVERDUE",
    issuedAt: "2026-09-10T10:00:00+08:00",
    dueAt: "2026-10-10",
    termsDays: 30,
    lines: [
      {
        description: "Safety Leadership Essentials · 2-day programme",
        detail: "20–21 Aug 2026 · Aurora HQ Shah Alam",
        qty: 1,
        unit: myr(1620000),
        amount: myr(1620000),
      },
      { description: "Additional workbooks", qty: 20, unit: myr(1900), amount: myr(38000) },
    ],
    subtotal: myr(1658000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(1658000),
    outstanding: myr(1240000),
    sync: {
      state: "VALIDATED",
      provider: "ACCOUNTING",
      uin: "MY-2026-XXXXXXXX-0288",
      lastAttemptAt: "2026-09-10T10:06:00+08:00",
    },
    syncLog: [
      { at: "2026-09-10T10:04:00+08:00", state: "SENT", detail: "Pushed to accounting package" },
      {
        at: "2026-09-10T10:06:00+08:00",
        state: "VALIDATED",
        detail: "MyInvois validation returned UIN",
        uin: "MY-2026-XXXXXXXX-0288",
      },
    ],
    payments: [
      {
        id: "pay_0288_1",
        at: "2026-10-08T11:20:00+08:00",
        amount: myr(418000),
        method: "BANK_TRANSFER",
        reference: "FT26100812004",
      },
    ],
  },
  {
    ...entity(INVOICE_SYNC_FAILED, "2026-11-02T09:00:00+08:00", "2026-11-02T09:12:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_MERIDIAN,
    engagementRef: ENGAGEMENT_MERIDIAN,
    status: "SENT",
    issuedAt: "2026-11-02T09:00:00+08:00",
    dueAt: "2026-11-02",
    termsDays: 0,
    lines: [
      { description: "Consultancy · needs analysis workshop", qty: 1, unit: myr(890000), amount: myr(890000) },
    ],
    subtotal: myr(890000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(890000),
    outstanding: myr(890000),
    /** The unresolved sync failure: reported by the package, never asserted by us. */
    sync: {
      state: "ERROR",
      provider: "ACCOUNTING",
      uin: null,
      lastAttemptAt: "2026-11-02T09:12:00+08:00",
    },
    syncLog: [
      { at: "2026-11-02T09:06:00+08:00", state: "SENT", detail: "Pushed to accounting package" },
      {
        at: "2026-11-02T09:12:00+08:00",
        state: "ERROR",
        providerCode: "TAX_CODE_UNKNOWN",
        detail: 'Tax code "TRAINING_EXEMPT" is not configured in the accounting package',
      },
    ],
    payments: [],
  },
  {
    ...entity(INVOICE_MERIDIAN_OVERDUE, "2026-09-12T09:00:00+08:00", "2026-11-14T08:30:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_MERIDIAN,
    engagementRef: ENGAGEMENT_MERIDIAN,
    status: "OVERDUE",
    issuedAt: "2026-09-12T09:00:00+08:00",
    dueAt: "2026-09-27",
    termsDays: 15,
    lines: [
      { description: "Data Literacy for Managers · October cohort", qty: 1, unit: myr(1920000), amount: myr(1920000) },
      { description: "Venue hire · own venue", qty: 2, unit: myr(175000), amount: myr(350000) },
    ],
    subtotal: myr(2270000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(2270000),
    outstanding: myr(2270000),
    sync: { state: "VALIDATED", provider: "ACCOUNTING", uin: "MY-2026-XXXXXXXX-0279", lastAttemptAt: "2026-09-12T09:05:00+08:00" },
    syncLog: [{ at: "2026-09-12T09:05:00+08:00", state: "VALIDATED", detail: "MyInvois validation returned UIN" }],
    payments: [],
  },
  {
    ...entity(INVOICE_KENANGA_RECENT, "2026-11-01T09:00:00+08:00", "2026-11-01T09:05:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_KENANGA,
    engagementRef: ENGAGEMENT_WINDOW_CLOSING,
    status: "OVERDUE",
    issuedAt: "2026-11-01T09:00:00+08:00",
    dueAt: "2026-11-05",
    termsDays: 4,
    lines: [{ description: "Refresher half-day · store managers", qty: 1, unit: myr(1380000), amount: myr(1380000) }],
    subtotal: myr(1380000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(1380000),
    outstanding: myr(1380000),
    sync: { state: "VALIDATED", provider: "ACCOUNTING", uin: "MY-2026-XXXXXXXX-0301", lastAttemptAt: "2026-11-01T09:05:00+08:00" },
    syncLog: [{ at: "2026-11-01T09:05:00+08:00", state: "VALIDATED", detail: "MyInvois validation returned UIN" }],
    payments: [],
  },
  {
    ...entity(INVOICE_MERIDIAN_OPEN, "2026-11-10T09:00:00+08:00", "2026-11-10T09:05:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_MERIDIAN,
    engagementRef: ENGAGEMENT_MERIDIAN,
    status: "SENT",
    issuedAt: "2026-11-10T09:00:00+08:00",
    dueAt: "2026-12-10",
    termsDays: 30,
    lines: [{ description: "Data Literacy for Managers · January cohort deposit", qty: 1, unit: myr(1920000), amount: myr(1920000) }],
    subtotal: myr(1920000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(1920000),
    outstanding: myr(1920000),
    sync: { state: "VALIDATED", provider: "ACCOUNTING", uin: "MY-2026-XXXXXXXX-0308", lastAttemptAt: "2026-11-10T09:05:00+08:00" },
    syncLog: [{ at: "2026-11-10T09:05:00+08:00", state: "VALIDATED", detail: "MyInvois validation returned UIN" }],
    payments: [],
  },
  {
    ...entity(INVOICE_KENANGA_OPEN, "2026-11-05T09:00:00+08:00", "2026-11-05T09:05:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_KENANGA,
    engagementRef: ENGAGEMENT_AFFECTED_1,
    status: "SENT",
    issuedAt: "2026-11-05T09:00:00+08:00",
    dueAt: "2026-12-05",
    termsDays: 30,
    lines: [{ description: "Safety leadership pilot · 1 cohort", qty: 1, unit: myr(2360000), amount: myr(2360000) }],
    subtotal: myr(2360000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(2360000),
    outstanding: myr(2360000),
    sync: { state: "VALIDATED", provider: "ACCOUNTING", uin: "MY-2026-XXXXXXXX-0305", lastAttemptAt: "2026-11-05T09:05:00+08:00" },
    syncLog: [{ at: "2026-11-05T09:05:00+08:00", state: "VALIDATED", detail: "MyInvois validation returned UIN" }],
    payments: [],
  },
  {
    ...entity(INVOICE_SUTERA_STALE, "2026-07-20T09:00:00+08:00", "2026-11-14T08:30:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_SUTERA,
    engagementRef: ENGAGEMENT_SUTERA,
    status: "OVERDUE",
    issuedAt: "2026-07-20T09:00:00+08:00",
    dueAt: "2026-08-28",
    termsDays: 39,
    lines: [{ description: "Service recovery pilot · half day", qty: 1, unit: myr(940000), amount: myr(940000) }],
    subtotal: myr(940000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(940000),
    outstanding: myr(940000),
    sync: { state: "VALIDATED", provider: "ACCOUNTING", uin: "MY-2026-XXXXXXXX-0244", lastAttemptAt: "2026-07-20T09:05:00+08:00" },
    syncLog: [{ at: "2026-07-20T09:05:00+08:00", state: "VALIDATED", detail: "MyInvois validation returned UIN" }],
    payments: [],
  },
  {
    ...entity(INVOICE_AURORA_SPRING, "2026-05-20T09:00:00+08:00", "2026-06-20T14:00:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_AURORA,
    engagementRef: ENGAGEMENT_AURORA_AT_RISK,
    status: "PAID",
    issuedAt: "2026-05-20T09:00:00+08:00",
    dueAt: "2026-06-19",
    termsDays: 30,
    lines: [
      {
        description: "Leading Through Change · 2-day programme",
        detail: "16–17 May 2026 · Aurora HQ Shah Alam",
        qty: 1,
        unit: myr(1850000),
        amount: myr(1850000),
      },
    ],
    subtotal: myr(1850000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(1850000),
    outstanding: myr(0),
    sync: { state: "VALIDATED", provider: "ACCOUNTING", uin: "MY-2026-XXXXXXXX-0212", lastAttemptAt: "2026-05-20T09:05:00+08:00" },
    syncLog: [{ at: "2026-05-20T09:05:00+08:00", state: "VALIDATED", detail: "MyInvois validation returned UIN" }],
    payments: [
      { id: "pay_0212_1", at: "2026-06-20T14:00:00+08:00", amount: myr(1850000), method: "BANK_TRANSFER", reference: "FT26062011884" },
    ],
  },
  {
    ...entity(INVOICE_KENANGA_PAID, "2026-05-25T09:00:00+08:00", "2026-06-25T14:00:00+08:00", actorFor(USER_JASON)),
    organisationRef: ORG_KENANGA,
    engagementRef: ENGAGEMENT_WINDOW_CLOSING,
    status: "PAID",
    issuedAt: "2026-05-25T09:00:00+08:00",
    dueAt: "2026-06-24",
    termsDays: 30,
    lines: [
      { description: "Sales Excellence for Store Managers · 2-day programme", qty: 1, unit: myr(2240000), amount: myr(2240000) },
    ],
    subtotal: myr(2240000),
    sst: myr(0),
    sstReason: "TRAINING_EXEMPT",
    total: myr(2240000),
    outstanding: myr(0),
    sync: { state: "VALIDATED", provider: "ACCOUNTING", uin: "MY-2026-XXXXXXXX-0201", lastAttemptAt: "2026-05-25T09:05:00+08:00" },
    syncLog: [{ at: "2026-05-25T09:05:00+08:00", state: "VALIDATED", detail: "MyInvois validation returned UIN" }],
    payments: [
      {
        id: "pay_0201_1",
        at: "2026-06-25T14:00:00+08:00",
        amount: myr(2240000),
        method: "BANK_TRANSFER",
        reference: "FT26062514771",
      },
    ],
  },
];

/** The accounting-package document ids, so a webhook replay can find its invoice. */
export const accountingDocuments: Record<string, string> = {
  [ACCOUNTING_DOCUMENT]: INVOICE_AURORA,
};



/**
 * §9 `GET /v1/collections/queue`.
 *
 * INV-2026-0279 is the 48-day item: the ladder puts it at reminder 3, which
 * DECISIONS §1 says is always human, so the agent stops and the next action
 * carries OBSERVE rather than a draft.
 */
export const receivables: Receivable[] = [
  {
    /**
     * Seventy-eight days overdue: past the day-75 rung, so the ladder proposes
     * a trading hold, which §9 makes MD-approved and ruling R3 gives an action
     * type of its own.
     */
    invoiceRef: INVOICE_SUTERA_STALE,
    organisation: { ref: ORG_SUTERA, name: "Sutera Hospitality Group" },
    daysOverdue: 78,
    amount: myr(940000),
    stage: "TRADING_HOLD",
    nextAction: { type: "ACCOUNT_TRADING_HOLD", status: "AWAITING_MD", autonomy: "OBSERVE" },
    nextActionAt: "2026-11-14T17:00:00+08:00",
  },
  {
    invoiceRef: INVOICE_MERIDIAN_OVERDUE,
    organisation: { ref: ORG_MERIDIAN, name: "Meridian Logistics Sdn Bhd" },
    daysOverdue: 48,
    amount: myr(2270000),
    stage: "REMINDER_3",
    nextAction: { type: "REMINDER_SEND", status: "HUMAN_REQUIRED", autonomy: "OBSERVE" },
    nextActionAt: "2026-11-14T16:00:00+08:00",
  },
  {
    invoiceRef: INVOICE_OVERDUE,
    organisation: { ref: ORG_AURORA, name: "Aurora Manufacturing Sdn Bhd" },
    daysOverdue: 34,
    amount: myr(1240000),
    stage: "REMINDER_2",
    nextAction: { type: "REMINDER_SEND", status: "DRAFT_READY", autonomy: "ACT_WITH_APPROVAL" },
    nextActionAt: "2026-11-14T14:30:00+08:00",
  },
  {
    invoiceRef: INVOICE_KENANGA_RECENT,
    organisation: { ref: ORG_KENANGA, name: "Kenanga Retail Group Berhad" },
    daysOverdue: 9,
    amount: myr(1380000),
    stage: "REMINDER_1",
    nextAction: { type: "REMINDER_SEND", status: "DRAFT_READY", autonomy: "ACT_WITH_APPROVAL" },
    nextActionAt: "2026-11-14T12:00:00+08:00",
  },
  {
    invoiceRef: INVOICE_SYNC_FAILED,
    organisation: { ref: ORG_MERIDIAN, name: "Meridian Logistics Sdn Bhd" },
    daysOverdue: 12,
    amount: myr(890000),
    stage: "REMINDER_1",
    nextAction: { type: "REMINDER_SEND", status: "BLOCKED_ON_SYNC", autonomy: "OBSERVE" },
  },
];

/**
 * §9 `GET /v1/receivables/aging`.
 *
 * Buckets are the sum of the seeded receivables, so the strip and the queue
 * reconcile. `current` is the three invoices not yet due; `d31_60` carries the
 * 34-day and 48-day items, which is why it is larger than the §9 example's
 * figure — that example predates the 48-day row the pack asks for.
 */
export const receivablesAging: ReceivablesAging = {
  current: sumMoney([myr(1850000), myr(1920000), myr(2360000)]),
  d1_30: sumMoney([myr(1380000), myr(890000)]),
  d31_60: sumMoney([myr(1240000), myr(2270000)]),
  d60_plus: myr(940000),
  dsoDays: 41,
};

/**
 * §9 `GET /v1/collections/rules` — 7 / 30 / 45, human call at 60, trading hold
 * at 75 with MD approval.
 */
export const collectionRules: CollectionRule[] = [
  { stage: "REMINDER_1", afterDays: 7, channel: "EMAIL", autonomy: "ACT_WITH_APPROVAL" },
  { stage: "REMINDER_2", afterDays: 30, channel: "EMAIL", autonomy: "ACT_WITH_APPROVAL" },
  { stage: "REMINDER_3", afterDays: 45, channel: "WHATSAPP", autonomy: "OBSERVE" },
  { stage: "HUMAN_CALL", afterDays: 60, channel: "PHONE", autonomy: "OBSERVE" },
  {
    stage: "TRADING_HOLD",
    afterDays: 75,
    autonomy: "OBSERVE",
    requiresApprovalFromRole: "MD",
  },
];

/** §9 `GET /v1/collections/{invoiceRef}/draft` — mirrors the follow-up draft shape. */
export const collectionDrafts: Record<string, MessageDraft> = {
  [INVOICE_OVERDUE]: {
    channel: "EMAIL",
    templateId: "tpl_collections_reminder2_v2",
    category: "UTILITY",
    body: "Dear Puan Nurul,\n\nOur records show invoice INV-2026-0288 for RM 12,400 is now 34 days past due…",
    recipients: 1,
    ratePerMessage: myr(0),
    estimatedCost: myr(0),
    /** §16 Q4 / R11: these fixtures model a live BSP lookup. */
    rateSource: "LIVE",
    consent: { channel: "EMAIL", granted: true, recordedAt: "2024-03-04T10:12:00+08:00" },
    provenance: {
      origin: "AI_SUGGESTED",
      confidence: 0.88,
      agentId: AGENT_COLLECTIONS,
      runId: "run_4926",
      tier: "MID",
      model: "DeepSeek V4 Pro",
      provider: "DEEPSEEK",
      cacheHitRate: 0.74,
      generatedAt: "2026-11-14T08:30:00+08:00",
      sources: [
        { type: "INVOICE", ref: INVOICE_OVERDUE },
        { type: "CONTACT", ref: CONTACT_NURUL },
      ],
    },
  },
  [INVOICE_KENANGA_RECENT]: {
    channel: "EMAIL",
    templateId: "tpl_collections_reminder1_v2",
    category: "UTILITY",
    body: "Dear Wei Sheng,\n\nA gentle reminder that invoice INV-2026-0301 for RM 13,800 fell due on 5 November…",
    recipients: 1,
    ratePerMessage: myr(0),
    estimatedCost: myr(0),
    /** §16 Q4 / R11: these fixtures model a live BSP lookup. */
    rateSource: "LIVE",
    consent: { channel: "EMAIL", granted: true, recordedAt: "2023-07-11T09:20:00+08:00" },
    provenance: {
      origin: "AI_SUGGESTED",
      confidence: 0.91,
      agentId: AGENT_COLLECTIONS,
      runId: "run_4926",
      generatedAt: "2026-11-14T08:30:00+08:00",
    },
  },
};
