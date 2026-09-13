import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/shared/components/layout";
import { LoadingState } from "@/shared/components/states";
import { ALL_NAV_ROUTES, DEFAULT_ROUTE_PATH } from "@/shared/config/nav";
import { agentsRoutes } from "./agents.routes";
import { authRoutes } from "./auth.routes";
import { approvalsRoutes } from "./approvals.routes";
import { dashboardRoutes } from "./dashboard.routes";
import { devRoutes } from "./dev.routes";
import { engagementsRoutes } from "./engagements.routes";
import { enquiriesRoutes } from "./enquiries.routes";
import { financeRoutes } from "./finance.routes";
import { hrdcRoutes } from "./hrdc.routes";
import { knowledgeRoutes } from "./knowledge.routes";
import { organisationsRoutes } from "./organisations.routes";
import { portalRoutes } from "./portal.routes";
import { programmesRoutes } from "./programmes.routes";
import { proposalsRoutes } from "./proposals.routes";
import { settingsAiRoutes } from "./settings-ai.routes";
import { tnaRoutes } from "./tna.routes";
import { leadsRoutes } from "./leads.routes";
import { contactsRoutes } from "./contacts.routes";
import { pipelineRoutes } from "./pipeline.routes";
import { relationshipsRoutes } from "./relationships.routes";
import { calendarRoutes } from "./calendar.routes";
import { trainersRoutes } from "./trainers.routes";
import { assessmentsRoutes } from "./assessments.routes";
import { certificatesRoutes } from "./certificates.routes";
import { complianceRoutes } from "./compliance.routes";
import { tasksRoutes } from "./tasks.routes";
import { reportsRoutes } from "./reports.routes";
import { settingsRoutes } from "./settings.routes";
import { PrincipalLayout } from "./PrincipalLayout";
import { PublicLayout } from "./PublicLayout";

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
 *
 * The SESSION guard is here, wrapping the element, not the path: every route
 * that needs a principal sits under `PrincipalLayout`, and the account routes
 * (`auth.routes.tsx`, supabase mode only) sit beside it.
 */

const PlaceholderPage = lazy(() =>
  import("@/pages/PlaceholderPage").then((module) => ({ default: module.PlaceholderPage })),
);

const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
);

/**
 * Every feature's real screens, in one list.
 *
 * A feature adds its own array here and changes nothing else. Keep this flat:
 * the ordering that matters is feature-routes-before-generated-routes, and each
 * feature already orders its own entries (a literal segment before a `:param`
 * that would otherwise swallow it).
 */
const FEATURE_ROUTES = [
  ...agentsRoutes,
  ...approvalsRoutes,
  ...dashboardRoutes,
  ...engagementsRoutes,
  ...enquiriesRoutes,
  ...financeRoutes,
  ...hrdcRoutes,
  ...knowledgeRoutes,
  ...organisationsRoutes,
  ...programmesRoutes,
  ...proposalsRoutes,
  ...settingsAiRoutes,
  ...tnaRoutes,
  ...leadsRoutes,
  ...contactsRoutes,
  ...pipelineRoutes,
  ...relationshipsRoutes,
  ...calendarRoutes,
  ...trainersRoutes,
  ...assessmentsRoutes,
  ...certificatesRoutes,
  ...complianceRoutes,
  ...tasksRoutes,
  ...reportsRoutes,
  ...settingsRoutes,
];

/**
 * PUBLIC routes, mounted as SIBLINGS of the shell rather than inside it.
 *
 * M07-S07, the client proposal page, is the pack's one external screen: it
 * draws its own minimal 56px bar and a client has nothing to navigate to, so
 * nesting it under `AppShell` would put a sidebar, a search field and a
 * notification bell in front of someone with no account. Another public screen
 * adds an entry to `portalRoutes` rather than a second mount point here.
 *
 * They sit under `PublicLayout`, OUTSIDE `PrincipalLayout`: a client has no
 * session and no `Me`, and the session guard would send them to sign-in.
 */
const PUBLIC_ROUTES = [...portalRoutes];

export function AppRoutes() {
  return (
    <Routes>
      {authRoutes.map((route) => (
        <Route key={route.path} path={route.path} element={route.element} />
      ))}

      <Route element={<PrincipalLayout />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={DEFAULT_ROUTE_PATH} replace />} />

          {/* Feature routes come FIRST and deliberately so. React Router scores
            two identical paths the same and breaks the tie on declaration
            order, so a real screen mounted after the generated list would lose
            to `PlaceholderPage` on its own path.

            Each feature declares its own array in `<feature>.routes.tsx` and
            adds one line here. That is the whole contract — nothing else in
            this file changes as screens land. */}
          {FEATURE_ROUTES.map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}

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
      </Route>

      <Route element={<PublicLayout />}>
        {PUBLIC_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
      </Route>
    </Routes>
  );
}
