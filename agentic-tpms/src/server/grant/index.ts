/**
 * Public surface of Stage 3 (e-TRiS grant): dossier, approval letter,
 * grant confirmation and the 30% upfront claim.
 */
export { DOSSIER_AGENT, compileDossier, renderTrainerProfilePdf, type DossierEntry, type DossierResult } from "./dossier";
export {
  LETTER_AGENT,
  extractApprovalLetter,
  extractionSchema,
  recordApprovalLetter,
  type ExtractLetterResult,
  type Extractor,
  type GrantLetterExtraction,
} from "./letter";
export {
  UPFRONT_CLAIM_RATE,
  confirmGrant,
  confirmGrantSchema,
  fileUpfrontClaim,
  flagApprovalLetter,
  upfrontAmountSen,
  type ConfirmGrantInput,
} from "./service";
