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
 * it. Rather than invent a list the pack never specified, the leaf opens the
 * invoice the pack itself is drawn from and `/:invoiceRef` opens any other.
 */

export const INVOICES_PATH = "/finance/invoices";
export const INVOICE_DETAIL_PATTERN = "/finance/invoices/:invoiceRef";
export const COLLECTIONS_PATH = "/finance/collections";

/** INV-2026-0311 — validated now, one earlier CUSTOMER_NOT_MAPPED failure kept. */
export const DEFAULT_INVOICE_REF = INVOICE_AURORA;
