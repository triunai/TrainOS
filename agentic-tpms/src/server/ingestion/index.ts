/**
 * Public surface of Stage 1 intake: hybrid ingestion, dedupe, L1 triage,
 * the WhatsApp micro-TNA and lead -> package conversion.
 */
export { ingestLead, ingestWebhook, createManualLead, canonicalJson, type IngestOptions, type IngestResult } from "./ingest";
export { triageLead, resolveTriage, TRIAGE_OPTIONS, type TriageResult, type TriageRoute } from "./triage";
export { sendMicroTna, handleWhatsAppReply, parseTnaReply, microTnaTemplate, type TnaAnswer, type ReplyOutcome } from "./microTna";
export {
  convertLeadToPackage,
  createPackageDirect,
  createClient,
  type ConversionResult,
  type PackageFields,
  type ClientInput,
} from "./convert";
export { getLead, getLeadDetail, listLeads, leadStatusCounts, intakeOf, type LeadDetail } from "./queries";
export {
  classifyDeterministic,
  routeFor,
  INTENTS,
  QUALIFY_THRESHOLD,
  REVIEW_THRESHOLD,
  type Intent,
  type L1Output,
  type Route,
} from "./classifier";
export { normalise, splitWebhook, detectMailMode } from "./normalise";
export { normaliseMalaysianPhone, isWhatsAppCapable } from "./phone";
export {
  handleLeadWebhookGet,
  handleLeadWebhookPost,
  handleWhatsAppWebhookGet,
  handleWhatsAppWebhookPost,
  handleInboundMail,
  verifyMetaSignature,
} from "./http";
export { LEAD_CHANNELS, LEAD_STATUSES, type LeadChannel, type LeadStatus, type NormalisedLead, type IntakeMeta } from "./types";
export { handlers } from "./tasks";
