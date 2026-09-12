/**
 * The proposals feature's public surface — the builder, the costing worksheet
 * and the paths that reach them. `no-cross-feature-internals` makes this the
 * only door in.
 */

export { ProposalBuilderPage } from "./ProposalBuilderPage";
export { CostingWorksheetPage } from "./CostingWorksheetPage";
export {
  COSTING_WORKSHEET_PATH,
  COSTING_WORKSHEET_PATTERN,
  PROPOSALS_LIST_PATH,
  PROPOSAL_BUILDER_PATH,
  PROPOSAL_BUILDER_PATTERN,
  QUOTATIONS_LIST_PATH,
} from "./paths";
export { REVIEW_THRESHOLD, needsReview, originLabel } from "./sections";
