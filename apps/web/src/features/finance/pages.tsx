import { useParams } from "react-router-dom";
import { InvoiceDetailScreen } from "./InvoiceDetailScreen";
import { DEFAULT_INVOICE_REF } from "./paths";

/**
 * The route-facing wrapper.
 *
 * The screen itself takes its record as a prop and knows nothing about the
 * router, so a test renders one without a URL. Reading the URL is this file's
 * only job.
 */
export function InvoiceDetailPage() {
  const { invoiceRef } = useParams();
  return <InvoiceDetailScreen invoiceRef={invoiceRef ?? DEFAULT_INVOICE_REF} />;
}
