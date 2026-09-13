import { INVOICE_AURORA } from "@trainos/contract";

/**
 * Where the finance screens live, and what the Invoices leaf resolves to.
 *
 * Paths follow the navigation rule (`navPath`): Finance › Invoices is
 * `/finance/invoices`, Collections is `/finance/collections`. The record
 * pattern has no nav leaf of its own, so it is written out beside the leaf it
 * hangs from.
 *
 * The pack draws M13-S02 as a record screen and the nav tree has no list above
 * it. The leaf used to open the invoice the pack is drawn from, which put a
 * record on a list route: Finance › Invoices landed on INV-2026-0311 and the
 * breadcrumb ended at a reference. `INVOICES_PATH` is now the invoices list and
 * `/:invoiceRef` opens one record.
 *
 * The default below is what the record route falls back to when the parameter
 * is absent, and naming it here keeps a route, a link and a test from
 * disagreeing about which invoice that is.
 */

export const INVOICES_PATH = "/finance/invoices";
export const INVOICE_DETAIL_PATTERN = "/finance/invoices/:invoiceRef";
export const COLLECTIONS_PATH = "/finance/collections";
export const COMMISSIONS_PATH = "/finance/commissions";
export const PROFITABILITY_PATH = "/finance/profitability";

/** INV-2026-0311 — validated now, one earlier CUSTOMER_NOT_MAPPED failure kept. */
export const DEFAULT_INVOICE_REF = INVOICE_AURORA;
