/**
 * The organisations feature's paths, derived from the navigation tree's rule
 * (`shared/config/nav.ts`): a child of `Sales` lives under `/sales/`.
 *
 * The pack has no M04 module file — the organisation record exists only as the
 * Kit's canonical record proof — so the list path is the nav entry and the 360
 * view is its record route.
 */

export const ORGANISATIONS_LIST_PATH = "/sales/organisations";

export const ORGANISATION_DETAIL_PATTERN = "/sales/organisations/:organisationId";

export const ORGANISATION_DETAIL_PATH = (ref: string): string =>
  `${ORGANISATIONS_LIST_PATH}/${encodeURIComponent(ref)}`;
