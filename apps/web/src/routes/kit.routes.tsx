import { lazy, Suspense } from "react";
import { Route } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";

/**
 * The kit showcase route, `/dev/kit`.
 *
 * A separate file from `routes/routes.tsx` so the kit owns its own route and the
 * scaffold's generated route table stays generated. To mount it, spread
 * `kitRoutes()` inside the app's `<Routes>`:
 *
 *   import { kitRoutes } from "@/routes/kit.routes";
 *   …
 *   <Routes>
 *     <Route element={<AppShell />}>
 *       …
 *     </Route>
 *     {kitRoutes()}
 *   </Routes>
 *
 * It sits OUTSIDE the `<Route element={<AppShell />}>` wrapper on purpose: the
 * showcase renders shell pieces of its own, and nesting it inside the real shell
 * would put two sidebars on one page.
 *
 * Lazy, so the showcase and its sample values never enter the app bundle.
 */

const KitShowcase = lazy(() => import("@/pages/KitShowcase"));

export const KIT_SHOWCASE_PATH = "/dev/kit";

export function kitRoutes() {
  return (
    <Route
      key={KIT_SHOWCASE_PATH}
      path={KIT_SHOWCASE_PATH}
      element={
        <Suspense fallback={<LoadingState label="Loading the kit showcase" />}>
          <KitShowcase />
        </Suspense>
      }
    />
  );
}
