import { navPath } from "@/shared/config/nav";

/**
 * `/reports` — the only childless parent in the nav tree.
 *
 * `navPath` puts a parent with no children at its own slug, so this resolves to
 * `/reports` rather than to a child path under it. Deriving it keeps the rail
 * entry and the route table on the same string.
 */
export const REPORTS_PATH = navPath("Reports");
