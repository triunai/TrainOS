/**
 * Public surface of the Stage-2 commercial pipeline (sourcing agent, Gate 1,
 * Stage-4 hold helpers) — server actions and the UI import from here.
 */
export {
  AGENT_ACTOR,
  DEFAULT_COST_ASSUMPTIONS,
  draftProposal,
  draftablePackages,
  proposeTrainer,
  proposeVenue,
  type DraftProposalResult,
  type ProposalWarning,
} from "./draftProposal";
export {
  approveAndDispatch,
  clientAccepted,
  confirmTrainer,
  requestRevision,
  saveQuotationRevision,
  signVenueBeo,
  type ApproveResult,
} from "./gate1";
export { dispatchQuotation, type DispatchResult, type Sender } from "./dispatch";
export { getCommercialView, requestProposalDraft, type CommercialView, type QuotationSummary } from "./view";
export {
  DAY_TIMETABLE,
  OUTLINE_AGENT,
  SESSIONS_PER_DAY,
  assembleOutline,
  buildOutline,
  parseModules,
  templateOutlineDraft,
  tnaHighlights,
  type AgendaSlot,
  type CourseModule,
  type CourseOutline,
  type OutlineContext,
  type OutlineDay,
} from "./outline";
export { quotationReference, renderOutlinePdf, renderQuotationPdf, renderTrainerAgreementPdf } from "./documents";
export {
  SOURCING_AGENT,
  firstAgentVersion,
  lineItemsDiff,
  lockPackage,
  proposalRefs,
  type LineChange,
  type ProposalRefs,
} from "./quotations";
