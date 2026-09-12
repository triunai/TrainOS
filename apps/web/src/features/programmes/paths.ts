/**
 * The feature's own paths, derived from the navigation tree's rule
 * (`shared/config/nav.ts`): a child of `Training` lives under `/training/`.
 *
 * Kept here rather than in the route file so a screen can link to a sibling
 * without importing the route table, and so the two cannot disagree.
 */

export const PROGRAMMES_LIST_PATH = "/training/programmes";

export const PROGRAMME_DETAIL_PATTERN = "/training/programmes/:programmeRef";

export const PROGRAMME_DETAIL_PATH = (ref: string): string =>
  `${PROGRAMMES_LIST_PATH}/${encodeURIComponent(ref)}`;
