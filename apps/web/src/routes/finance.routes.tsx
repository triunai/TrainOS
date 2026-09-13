import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import {
  COLLECTIONS_PATH,
  COMMISSIONS_PATH,
  INVOICES_PATH,
  INVOICE_DETAIL_PATTERN,
  PROFITABILITY_PATH,
} from "@/features/finance";

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
 * whose reference is missing. The leaf is the LIST; the pattern is the record.
 */

export interface FeatureRoute {
  /** Path exactly as the navigation rule derives it. */
  path: string;
  element: ReactElement;
  /** For a dev index and for error copy. A few words. */
  label: string;
}

const InvoicesListScreen = lazy(() =>
  import("@/features/finance").then((module) => ({ default: module.InvoicesListScreen })),
);

const InvoiceDetailPage = lazy(() =>
  import("@/features/finance").then((module) => ({ default: module.InvoiceDetailPage })),
);

const CollectionsQueueScreen = lazy(() =>
  import("@/features/finance").then((module) => ({ default: module.CollectionsQueueScreen })),
);

const CommissionsScreen = lazy(() =>
  import("@/features/finance").then((module) => ({ default: module.CommissionsScreen })),
);

const ProfitabilityScreen = lazy(() =>
  import("@/features/finance").then((module) => ({ default: module.ProfitabilityScreen })),
);

export const financeRoutes: FeatureRoute[] = [
  {
    /**
     * The leaf is the LIST, not a record.
     *
     * It used to mount `InvoiceDetailPage`, so Finance › Invoices opened
     * INV-2026-0311 and the breadcrumb on a list route ended at a reference.
     * A leaf that opens one invoice has no path to own and no list to go back to.
     */
    path: INVOICES_PATH,
    label: "Invoices",
    element: (
      <Suspense fallback={<LoadingState label="Loading the invoices" />}>
        <InvoicesListScreen />
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
  {
    path: COMMISSIONS_PATH,
    label: "Commissions",
    element: (
      <Suspense fallback={<LoadingState label="Loading commission accruals" />}>
        <CommissionsScreen />
      </Suspense>
    ),
  },
  {
    path: PROFITABILITY_PATH,
    label: "Profitability",
    element: (
      <Suspense fallback={<LoadingState label="Loading engagement profitability" />}>
        <ProfitabilityScreen />
      </Suspense>
    ),
  },
];
