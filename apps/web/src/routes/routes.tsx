import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/shared/components/layout";
import { LoadingState } from "@/shared/components/states";
import { ALL_NAV_ROUTES, DEFAULT_ROUTE_PATH } from "@/shared/config/nav";
import { devRoutes } from "./dev.routes";

/**
 * The route table is GENERATED from the navigation tree. There is no second
 * list of paths to keep in sync: add a nav entry and its route exists, remove
 * one and its route is gone.
 *
 * Lazy from day one. Retrofitting code splitting once the bundle is large is a
 * project; today every route resolves to the same placeholder chunk, and each
 * real screen gets its own `lazy(() => import(...))` as it lands.
 *
 * Dev routes come from `dev.routes.tsx` and mount only in a development build,
 * so another agent can register a gallery without editing this file and the two
 * changes cannot conflict.
 *
 * Route-level role guards are deliberately NOT here yet. The nav is filtered by
 * role, but a filtered rail is a convenience, not a boundary — the API decides.
 * Guards land with the real session, wrapping the element, not the path.
 */

const PlaceholderPage = lazy(() =>
  import("@/pages/PlaceholderPage").then((module) => ({ default: module.PlaceholderPage })),
);

const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
);

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={DEFAULT_ROUTE_PATH} replace />} />

        {ALL_NAV_ROUTES.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={
              <Suspense fallback={<LoadingState label={`Loading ${route.label}`} />}>
                <PlaceholderPage route={route} />
              </Suspense>
            }
          />
        ))}

        {import.meta.env.DEV
          ? devRoutes.map((route) => (
              <Route key={route.path} path={route.path} element={route.element} />
            ))
          : null}

        <Route
          path="*"
          element={
            <Suspense fallback={<LoadingState label="Loading" />}>
              <NotFoundPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
