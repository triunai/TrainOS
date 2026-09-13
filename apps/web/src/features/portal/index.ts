/**
 * The `portal` feature — M07-S07, the client-facing proposal page.
 *
 * The only public, unauthenticated surface in the app. Everything it needs is
 * re-exported here, because `.dependency-cruiser.cjs` allows another module to
 * reach this feature only through its root index.
 */
/** The public path, owned here so `routes/portal.routes.tsx` cannot drift. */
export const PORTAL_PROPOSAL_PATTERN = "/p/:token";
export const portalProposalPath = (token: string) => `/p/${token}`;

export { ClientProposalPage } from "./ClientProposalPage";
export { AcceptancePanel, type AcceptancePanelProps } from "./AcceptancePanel";
export { CommentThread, type CommentThreadProps } from "./CommentThread";
export { InvestmentPanel, ProposalSections } from "./ProposalSections";
export {
  asApiError,
  portalKeys,
  useAcceptPortalProposal,
  useAddPortalComment,
  usePortalProposal,
} from "./api";
