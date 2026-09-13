/**
 * The compliance registers' public surface.
 *
 * Cross-engagement registers over the HRD Corp data `features/hrdc` shows one
 * record at a time. Kept apart from that feature on purpose — see paths.ts.
 *
 * `ClaimPacketsScreen` is the list half of the HRD Corp nav leaf, whose path
 * constant belongs to `features/hrdc`; the screen is a register and so lives
 * here, and `routes/hrdc.routes.tsx` mounts it on that leaf.
 */

export { ClaimPacketsScreen } from "./ClaimPacketsScreen";
export { ComplianceDocumentsScreen } from "./ComplianceDocumentsScreen";
export { ComplianceDeadlinesScreen } from "./ComplianceDeadlinesScreen";
export { COMPLIANCE_DOCUMENTS_PATH, COMPLIANCE_DEADLINES_PATH } from "./paths";
export { HRDC_DOCUMENT_LABEL, hrdcDocumentLabel } from "./labels";
export {
  PACKET_TONE,
  byUrgency,
  deadlineRows,
  documentRows,
  packetRows,
  type DeadlineRow,
  type DocumentRow,
  type PacketRow,
} from "./registers";
