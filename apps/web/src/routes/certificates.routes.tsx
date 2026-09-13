import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { CERTIFICATES_PATH } from "@/features/certificates";

/** The certificate register — `/training/certificates`. */

const CertificatesScreen = lazy(() =>
  import("@/features/certificates").then((module) => ({ default: module.CertificatesScreen })),
);

export const routes: RouteObject[] = [
  {
    path: CERTIFICATES_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the certificate register" />}>
        <CertificatesScreen />
      </Suspense>
    ),
  },
];

export const certificatesRoutes = routes;
