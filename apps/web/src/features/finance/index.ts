/**
 * The finance feature's public surface — M13-S02 and M13-S05.
 *
 * The invoice screen takes its record as a prop; `InvoiceDetailPage` reads it
 * from the URL. Hooks, the action-outcome composition and the stand-in field
 * are the feature's own business and are deliberately not exported.
 */

export { InvoiceDetailScreen } from "./InvoiceDetailScreen";
export { CollectionsQueueScreen } from "./CollectionsQueueScreen";
export { CommissionsScreen } from "./CommissionsScreen";
export { ProfitabilityScreen } from "./ProfitabilityScreen";
export { InvoiceDetailPage } from "./pages";
export {
  COLLECTIONS_PATH,
  COMMISSIONS_PATH,
  DEFAULT_INVOICE_REF,
  INVOICES_PATH,
  INVOICE_DETAIL_PATTERN,
  PROFITABILITY_PATH,
} from "./paths";
