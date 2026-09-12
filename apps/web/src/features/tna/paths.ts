/**
 * The TNA feature's paths, derived from the navigation tree's rule
 * (`shared/config/nav.ts`): a child of `Sales` lives under `/sales/`.
 */

export const TNA_LIST_PATH = "/sales/tna";

export const TNA_DETAIL_PATTERN = "/sales/tna/:tnaId";

export const TNA_DETAIL_PATH = (ref: string): string =>
  `${TNA_LIST_PATH}/${encodeURIComponent(ref)}`;
