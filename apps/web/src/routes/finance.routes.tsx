import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import { COLLECTIONS_PATH, INVOICES_PATH, INVOICE_DETAIL_PATTERN } from "@/features/finance";

/**
 * The finance feature's route registrations — M13-S02 and M13-S05.
 *
 * `routes.tsx` builds every nav path from `ALL_NAV_ROUTES` and points it at
 * `PlaceholderPage`, so a real screen has to be mounted BEFORE that generated
 * list or the placeholder wins on the same path. `FEATURE_ROUTES` there does
 * exactly that; this array only has to be added to it.
 *
 * Order matters inside the array: `/finance/invoices` is declared before
 * `/finance/invoices/:invoiceRef` so the leaf cannot be read as an invoice
 * whose reference is missing.
 */

export interface FeatureRoute {
  /** Path exactly as the navigation rule derives it. */
  path: string;
  element: ReactElement;
  /** For a dev index and for error copy. A few words. */
  label: string;
}

const InvoiceDetailPage = lazy(() =>
  import("@/features/finance").then((module) => ({ default: module.InvoiceDetailPage })),
);

const CollectionsQueueScreen = lazy(() =>
  import("@/features/finance").then((module) => ({ default: module.CollectionsQueueScreen })),
);

export const financeRoutes: FeatureRoute[] = [
  {
    path: INVOICES_PATH,
    label: "Invoice detail",
    element: (
      <Suspense fallback={<LoadingState label="Loading the invoice" />}>
        <InvoiceDetailPage />
      </Suspense>
    ),
  },
  {
    path: INVOICE_DETAIL_PATTERN,
    label: "Invoice detail",
    element: (
      <Suspense fallback={<LoadingState label="Loading the invoice" />}>
        <InvoiceDetailPage />
      </Suspense>
    ),
  },
  {
    path: COLLECTIONS_PATH,
    label: "Collections queue",
    element: (
      <Suspense fallback={<LoadingState label="Loading the collections queue" />}>
        <CollectionsQueueScreen />
      </Suspense>
    ),
  },
];
