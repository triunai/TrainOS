/**
 * Public surface of the outbound lane: the Harvey writer, the HITL outbox and
 * the opt-out list. Targets come only from permissioned lists (CSV import) and
 * our own webhooks; scraping private channels or registries is out of scope.
 */
export {
  draftSequence,
  requestDraftSequence,
  approveBatch,
  rejectBatch,
  editOutboxDraft,
  dispatchBatch,
  assertDispatchable,
  listOutboxBatches,
  listOutbox,
  type DraftSequenceInput,
  type DraftSequenceResult,
  type SkippedTarget,
  type ReviewResult,
  type DispatchResult,
  type OutboxBatchSummary,
  type OutboxRow,
} from "./service";
export { importTargetsCsv, parseCsv, type CsvImportResult } from "./csv";
export { suppressAddress, isSuppressed, listSuppressions, isStopReply, type SuppressionReason } from "./suppression";
export {
  HARVEY_AGENT,
  MAX_WORDS,
  OPT_OUT_LINE,
  SEQUENCE_STEPS,
  STEP_DELAY_DAYS,
  templateTouch,
  wordCount,
  type OutboundTarget,
  type SequenceStep,
} from "./harvey";
export { handlers } from "./tasks";
export { batchNotes, listDraftRequests, type DraftRequest } from "./requests";
