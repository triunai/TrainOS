/**
 * Sales commission accruals — the Finance › Commissions nav leaf.
 *
 * NOT a contract surface. `API_CONTRACT.md` declares commission as three
 * fields ON a quotation (`commissionRate`, `commission`, `commissionPayableOn`,
 * §6) and a rate table on the rate card (`RateCard.commissionPct`, §18). It
 * never declares a commissions collection, and the design pack never draws the
 * screen — `docs/research/09-design-pack-inventory.md` §8 confirms the leaf has
 * no artboard. So this file is a DERIVED view over data the contract does
 * declare, in the same spirit as `FixtureReceivable`, and the derivation is
 * written out below rather than left for a reader to reverse-engineer.
 *
 * The derivation, stated once:
 *
 *  - One row per engagement that has reached a sell price. The deal, not the
 *    invoice, earns the commission; the invoice only decides when it is paid.
 *  - The RATE comes from the quotation where the deal has one, because a
 *    quotation stores the rate it was actually priced at. Where there is no
 *    quotation the rate comes from `rateCard.commissionPct` for the owner's
 *    ROLE and the deal's band — which is why ENG-0189, owned by a sales
 *    manager, accrues at 2% and not 8%. The rate is configuration in both
 *    cases and is never written into a screen.
 *  - The GATE is `commissionPayableOn`. Every fixture quotation says
 *    `COLLECTION`, so an invoiced-but-unpaid deal is accrued and not yet
 *    payable — the distinction the screen exists to draw.
 *  - `AT_RISK` is the day-75 rung of `collectionRules`, read from the same
 *    configuration the collections queue climbs. It is not a number typed here.
 */

import type { Actor, InvoiceStatus, Money, Rate, Ref, Timestamp } from "@trainos/contract";
import {
  ENGAGEMENT_AFFECTED_2,
  ENGAGEMENT_AURORA,
  ENGAGEMENT_BLOCKED,
  INVOICE_AURORA,
  INVOICE_OVERDUE,
  ORG_AURORA,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  USER_AMIRAH,
  USER_KELVIN,
} from "@trainos/contract";
import {
  ENGAGEMENT_AURORA_AT_RISK,
  ENGAGEMENT_SUTERA,
  ENGAGEMENT_WINDOW_CLOSING,
} from "./engagements";
import { INVOICE_AURORA_SPRING, INVOICE_KENANGA_PAID, INVOICE_SUTERA_STALE } from "./finance";
import { ORG_KENANGA, ORG_MERIDIAN, ORG_SUTERA } from "./organisations";
import { PROPOSAL_MERIDIAN, PROPOSAL_SUTERA, QUOTATION_MERIDIAN, QUOTATION_SUTERA } from "./proposals";
import { actorFor } from "./tenant";
import { myr } from "./_helpers";

/**
 * Where a commission stands, and what has to happen next for it to be paid.
 *
 * Four values and not three: an accrual whose invoice has climbed past the
 * trading-hold rung is not merely "unpaid", it is money the business may never
 * collect, and collapsing it into `ACCRUED` is how a forecast quietly counts
 * revenue that is in dispute.
 */
export type CommissionStatus = "FORECAST" | "ACCRUED" | "PAYABLE" | "AT_RISK";

/** Which configuration supplied the percentage. Shown on the screen. */
export type CommissionRateBasis = "QUOTATION" | "RATE_CARD";

/** One accrual. Fixture-only — see the file header for the derivation. */
export interface FixtureCommission {
  id: string;
  engagementRef: Ref;
  /** Null where the deal never reached a stored quotation. */
  quotationRef: Ref | null;
  proposalRef: Ref | null;
  organisation: { ref: Ref; name: string };
  /** Whose commission it is. Their ROLE picks the rate-card band. */
  owner: Actor;
  ownerRole: "SALES" | "SALES_MANAGER";
  /** The sell price the percentage is taken of. */
  dealValue: Money;
  rate: Rate;
  rateBasis: CommissionRateBasis;
  /** The rate card in force when the deal was priced. */
  rateCardVersion: string;
  amount: Money;
  /** §6. Every fixture deal is payable on collection. */
  payableOn: "COLLECTION" | "INVOICE";
  status: CommissionStatus;
  invoiceRef: Ref | null;
  invoiceStatus: InvoiceStatus | null;
  /** What is still owed on the invoice, or null where none was raised. */
  outstanding: Money | null;
  daysOverdue: number | null;
  /** When the invoice was paid in full — the moment the commission became payable. */
  collectedAt: Timestamp | null;
}

const RATE_CARD_VERSION = "v0-placeholder";

/**
 * The six accruals, one per engagement that reached a sell price.
 *
 * Every number here is either copied from the row it derives from or is that
 * row's value times the rate stated beside it. Nothing is rounded by hand.
 */
export const commissions: FixtureCommission[] = [
  {
    /* Won, invoiced, not collected. The screen's central case: the money is
       earned and is NOT payable, because the gate is collection. */
    id: "com_0231",
    engagementRef: ENGAGEMENT_AURORA,
    quotationRef: QUOTATION_AURORA,
    proposalRef: PROPOSAL_AURORA,
    organisation: { ref: ORG_AURORA, name: "Aurora Manufacturing Sdn Bhd" },
    owner: actorFor(USER_AMIRAH),
    ownerRole: "SALES",
    dealValue: myr(1850000),
    rate: 0.08,
    rateBasis: "QUOTATION",
    rateCardVersion: RATE_CARD_VERSION,
    amount: myr(148000),
    payableOn: "COLLECTION",
    status: "ACCRUED",
    invoiceRef: INVOICE_AURORA,
    invoiceStatus: "SENT",
    outstanding: myr(1850000),
    daysOverdue: null,
    collectedAt: null,
  },
  {
    /* Invoiced and overdue, but at 34 days it is two rungs below the hold.
       Still an accrual, and the days are the reason to look at it. */
    id: "com_0198",
    engagementRef: ENGAGEMENT_BLOCKED,
    quotationRef: null,
    proposalRef: null,
    organisation: { ref: ORG_AURORA, name: "Aurora Manufacturing Sdn Bhd" },
    owner: actorFor(USER_AMIRAH),
    ownerRole: "SALES",
    dealValue: myr(1658000),
    rate: 0.08,
    rateBasis: "RATE_CARD",
    rateCardVersion: RATE_CARD_VERSION,
    amount: myr(132640),
    payableOn: "COLLECTION",
    status: "ACCRUED",
    invoiceRef: INVOICE_OVERDUE,
    invoiceStatus: "OVERDUE",
    outstanding: myr(1240000),
    daysOverdue: 34,
    collectedAt: null,
  },
  {
    /* Quoted, proposal sent, not won. A forecast, and the screen must never
       add it to the accrued total. */
    id: "com_0251",
    engagementRef: ENGAGEMENT_AFFECTED_2,
    quotationRef: QUOTATION_MERIDIAN,
    proposalRef: PROPOSAL_MERIDIAN,
    organisation: { ref: ORG_MERIDIAN, name: "Meridian Logistics Sdn Bhd" },
    owner: actorFor(USER_AMIRAH),
    ownerRole: "SALES",
    dealValue: myr(1920000),
    rate: 0.08,
    rateBasis: "QUOTATION",
    rateCardVersion: RATE_CARD_VERSION,
    amount: myr(153600),
    payableOn: "COLLECTION",
    status: "FORECAST",
    invoiceRef: null,
    invoiceStatus: null,
    outstanding: null,
    daysOverdue: null,
    collectedAt: null,
  },
  {
    /* 78 days overdue is past the day-75 trading-hold rung, and the engagement
       itself was cancelled. The accrual is at risk, not merely late. */
    id: "com_0203",
    engagementRef: ENGAGEMENT_SUTERA,
    quotationRef: QUOTATION_SUTERA,
    proposalRef: PROPOSAL_SUTERA,
    organisation: { ref: ORG_SUTERA, name: "Sutera Hospitality Group" },
    owner: actorFor(USER_AMIRAH),
    ownerRole: "SALES",
    dealValue: myr(980000),
    rate: 0.08,
    rateBasis: "QUOTATION",
    rateCardVersion: RATE_CARD_VERSION,
    amount: myr(78400),
    payableOn: "COLLECTION",
    status: "AT_RISK",
    invoiceRef: INVOICE_SUTERA_STALE,
    invoiceStatus: "OVERDUE",
    outstanding: myr(940000),
    daysOverdue: 78,
    collectedAt: null,
  },
  {
    /* Collected in June. The gate has been met, so this one is payable. */
    id: "com_0187",
    engagementRef: ENGAGEMENT_AURORA_AT_RISK,
    quotationRef: null,
    proposalRef: null,
    organisation: { ref: ORG_AURORA, name: "Aurora Manufacturing Sdn Bhd" },
    owner: actorFor(USER_AMIRAH),
    ownerRole: "SALES",
    dealValue: myr(1850000),
    rate: 0.08,
    rateBasis: "RATE_CARD",
    rateCardVersion: RATE_CARD_VERSION,
    amount: myr(148000),
    payableOn: "COLLECTION",
    status: "PAYABLE",
    invoiceRef: INVOICE_AURORA_SPRING,
    invoiceStatus: "PAID",
    outstanding: myr(0),
    daysOverdue: null,
    collectedAt: "2026-06-20T14:00:00+08:00",
  },
  {
    /* Owned by the sales MANAGER, so the rate card gives 2% and not 8%. The
       largest deal on the page earns the smallest commission, which is the
       whole reason the rate is shown beside the number. */
    id: "com_0189",
    engagementRef: ENGAGEMENT_WINDOW_CLOSING,
    quotationRef: null,
    proposalRef: null,
    organisation: { ref: ORG_KENANGA, name: "Kenanga Retail Group Berhad" },
    owner: actorFor(USER_KELVIN),
    ownerRole: "SALES_MANAGER",
    dealValue: myr(2240000),
    rate: 0.02,
    rateBasis: "RATE_CARD",
    rateCardVersion: RATE_CARD_VERSION,
    amount: myr(44800),
    payableOn: "COLLECTION",
    status: "PAYABLE",
    invoiceRef: INVOICE_KENANGA_PAID,
    invoiceStatus: "PAID",
    outstanding: myr(0),
    daysOverdue: null,
    collectedAt: "2026-06-25T14:00:00+08:00",
  },
];
