/**
 * The feature's own paths, derived from the navigation tree's rule
 * (`shared/config/nav.ts`): `Proposals` is a child of `Sales`, `Quotations` a
 * child of `Finance`.
 *
 * The costing worksheet lives under Finance because that is where the nav puts
 * quotations, even though Sales is its primary user — the rail is derived from
 * one tree, and a second placement for the same record would be the divergence
 * CLAUDE.md forbids.
 */

export const PROPOSALS_LIST_PATH = "/sales/proposals";
export const PROPOSAL_BUILDER_PATTERN = "/sales/proposals/:proposalRef";
export const PROPOSAL_BUILDER_PATH = (ref: string): string =>
  `${PROPOSALS_LIST_PATH}/${encodeURIComponent(ref)}`;

export const QUOTATIONS_LIST_PATH = "/finance/quotations";
export const COSTING_WORKSHEET_PATTERN = "/finance/quotations/:quotationRef";
export const COSTING_WORKSHEET_PATH = (ref: string): string =>
  `${QUOTATIONS_LIST_PATH}/${encodeURIComponent(ref)}`;
