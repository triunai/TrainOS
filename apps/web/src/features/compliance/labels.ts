import type { HRDCDocumentType } from "@trainos/contract";

/**
 * HRD Corp document names.
 *
 * A correction to my own first pass, which rendered the raw enum
 * (`TRAINER_TTT_CERT`) as the document's name on the theory that the type IS
 * the circular's name for it. Seeing it on screen settled that: a column of
 * SCREAMING_SNAKE reads as machine output leaking into the UI, which is exactly
 * the tell §1 and §9 of the tightening brief tell us to remove — and the table
 * already prints the readable form directly underneath, so the screen was
 * saying the same thing twice in two registers.
 *
 * A table rather than `humanise`, for the reason `features/programmes` gives
 * for the scheme names: "Trainer ttt cert" is not how HRD Corp writes it.
 * These are proper nouns. The packet's own `label` still wins where the server
 * sends one — this is the fallback, not an override.
 */
export const HRDC_DOCUMENT_LABEL: Readonly<Record<HRDCDocumentType, string>> = {
  ATTENDANCE_SHEET: "Attendance sheet",
  TRAINER_TTT_CERT: "Trainer TTT certificate",
  TAX_INVOICE: "Tax invoice",
  EVALUATION_SUMMARY: "Evaluation summary",
  TRAINING_SCHEDULE: "Training schedule",
};

export const hrdcDocumentLabel = (type: string): string =>
  HRDC_DOCUMENT_LABEL[type as HRDCDocumentType] ?? type;
