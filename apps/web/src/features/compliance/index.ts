/**
 * The compliance registers' public surface.
 *
 * Two cross-engagement registers over the HRD Corp data `features/hrdc` shows
 * one record at a time. Kept apart from that feature on purpose — see paths.ts.
 */

export { ComplianceDocumentsScreen } from "./ComplianceDocumentsScreen";
export { ComplianceDeadlinesScreen } from "./ComplianceDeadlinesScreen";
export { COMPLIANCE_DOCUMENTS_PATH, COMPLIANCE_DEADLINES_PATH } from "./paths";
export { HRDC_DOCUMENT_LABEL, hrdcDocumentLabel } from "./labels";
export {
  SEVERITY_TONE,
  byUrgency,
  deadlineRows,
  documentRows,
  type DeadlineRow,
  type DocumentRow,
} from "./registers";
