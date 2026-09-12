/**
 * The feature's URL vocabulary, written once.
 *
 * CLAUDE.md R7 keeps every path in one place so there is no second list to
 * drift. The inbox's own path is a nav leaf and therefore comes from
 * `shared/config/nav` — only the detail route is this feature's to name, and it
 * hangs off the inbox rather than inventing a second root.
 */

import { navPath } from "@/shared/config/nav";

/** `/approvals` — the nav tree's own leaf, derived by the one path rule. */
export const APPROVALS_PATH = navPath("Home", "Approvals");

/** `/approvals/:ref` — the route pattern the router matches. */
export const APPROVAL_DETAIL_PATTERN = `${APPROVALS_PATH}/:ref`;

/** The link to one approval. Refs and ids are interchangeable on the API. */
export const approvalPath = (ref: string): string => `${APPROVALS_PATH}/${encodeURIComponent(ref)}`;
