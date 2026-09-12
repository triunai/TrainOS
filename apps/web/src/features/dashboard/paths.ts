/**
 * The feature's URL vocabulary (CLAUDE.md R7).
 *
 * The dashboard's own path is a nav leaf and is derived by the one path rule.
 * The demo index is not in the nav tree at all — it is a development surface —
 * so it is named here beside the screen it belongs to.
 */

import { navPath } from "@/shared/config/nav";

/** `/dashboard` — the nav tree's leaf and the app's default route. */
export const DASHBOARD_PATH = navPath("Home", "Dashboard");

/** `/dev/demo` — development only, mounted through `routes/dev.routes.tsx`. */
export const DEMO_INDEX_PATH = "/dev/demo";
