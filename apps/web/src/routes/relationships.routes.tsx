import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { CROSS_SELL_PATH, MARKETING_PATH, RENEWALS_PATH } from "@/features/relationships";

/**
 * The three Relationships nav leaves. Each claims the path the generated
 * placeholder held; feature routes are spread first in `routes.tsx`, so
 * mounting them is the whole change.
 */

const RenewalsPage = lazy(() =>
  import("@/features/relationships").then((module) => ({ default: module.RenewalsPage })),
);

const CrossSellPage = lazy(() =>
  import("@/features/relationships").then((module) => ({ default: module.CrossSellPage })),
);

const MarketingPage = lazy(() =>
  import("@/features/relationships").then((module) => ({ default: module.MarketingPage })),
);

export const routes: RouteObject[] = [
  {
    path: RENEWALS_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the renewal book" />}>
        <RenewalsPage />
      </Suspense>
    ),
  },
  {
    path: CROSS_SELL_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the cross-sell book" />}>
        <CrossSellPage />
      </Suspense>
    ),
  },
  {
    path: MARKETING_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the marketing templates" />}>
        <MarketingPage />
      </Suspense>
    ),
  },
];

export const relationshipsRoutes = routes;
