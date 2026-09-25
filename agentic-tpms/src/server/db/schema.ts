/**
 * Drizzle mirror of db/migrations/*.sql.
 *
 * The SQL files are the source of truth: they carry the triggers, the FSM
 * guard, the hash chain and the check constraints that Drizzle cannot express.
 * This file gives the application typed queries over the same tables, and
 * `tests/integration/schema-drift.test.ts` asserts every column declared here
 * exists in the migrated database with a compatible type, so the two cannot
 * drift without a red test.
 *
 * NUMERIC columns are strings on purpose (see `src/lib/money.ts`).
 */
import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  bigserial,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
  char,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** pgvector column; values travel as the `[1,2,3]` text literal. */
export const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType: (config) => `vector(${config?.dimensions ?? 1536})`,
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) =>
    String(value)
      .replace(/^\[|\]$/g, "")
      .split(",")
      .filter(Boolean)
      .map(Number),
});

/** Every table lives in the `tpms` schema (never `public`; see 0001_foundation.sql). */
export const tpms = pgSchema("tpms");

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => numeric(name, { precision: 10, scale: 2 });

// ---------------------------------------------------------------- foundation
export const operators = tpms.table("operators", {
  id: varchar("id", { length: 64 }).primaryKey(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  email: varchar("email", { length: 255 }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLedger = tpms.table("audit_ledger", {
  logId: uuid("log_id").primaryKey().defaultRandom(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  machine: varchar("machine", { length: 32 }),
  fromStage: varchar("from_stage", { length: 32 }),
  toStage: varchar("to_stage", { length: 32 }),
  actorType: varchar("actor_type", { length: 32 }).notNull(),
  actorId: varchar("actor_id", { length: 64 }).notNull(),
  reasonCode: varchar("reason_code", { length: 64 }).notNull(),
  reasonDetails: text("reason_details").notNull(),
  metadataDiff: jsonb("metadata_diff").$type<Record<string, unknown>>().notNull(),
  prevCheckpoint: varchar("prev_checkpoint", { length: 64 }).notNull(),
  sha256Checkpoint: varchar("sha256_checkpoint", { length: 64 }).notNull(),
  createdAt: ts("created_at").notNull(),
});

export const domainEvents = tpms.table("domain_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: uuid("entity_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const taskQueue = tpms.table("task_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskType: varchar("task_type", { length: 64 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: varchar("status", { length: 32 }).notNull().default("QUEUED"),
  priority: integer("priority").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lockedBy: varchar("locked_by", { length: 100 }),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  claimDue: ts("claim_due").notNull().defaultNow(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }),
  lastError: text("last_error"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  startedAt: ts("started_at"),
  completedAt: ts("completed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- intake
export const corporateClients = tpms.table("corporate_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  companyDomain: varchar("company_domain", { length: 100 }),
  ssmRegistration: varchar("ssm_registration", { length: 50 }),
  hrdcorpMycoid: varchar("hrdcorp_mycoid", { length: 50 }),
  industrySector: varchar("industry_sector", { length: 100 }),
  malaysianHeadcount: integer("malaysian_headcount"),
  levyRegistered: boolean("levy_registered").notNull().default(false),
  levyBalanceEstimate: numeric("levy_balance_estimate", { precision: 12, scale: 2 }),
  fiscalYearEndMonth: integer("fiscal_year_end_month"),
  accountType: varchar("account_type", { length: 30 }).notNull().default("SBL_KHAS_LEVY"),
  primaryPicName: varchar("primary_pic_name", { length: 255 }).notNull(),
  primaryPicEmail: varchar("primary_pic_email", { length: 255 }).notNull(),
  primaryPicPhone: varchar("primary_pic_phone", { length: 30 }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const rawLeadPayloads = tpms.table("raw_lead_payloads", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceChannel: varchar("source_channel", { length: 50 }).notNull(),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
  sha256Hash: char("sha256_hash", { length: 64 }).notNull(),
  adClickIdentifiers: jsonb("ad_click_identifiers").$type<Record<string, string>>(),
  status: varchar("status", { length: 30 }).notNull().default("INGESTED"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const leadRecords = tpms.table("lead_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  rawPayloadId: uuid("raw_payload_id"),
  clientId: uuid("client_id"),
  duplicateOf: uuid("duplicate_of"),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  companyDomain: varchar("company_domain", { length: 100 }),
  ssmRegistrationNumber: varchar("ssm_registration_number", { length: 50 }),
  picFullName: varchar("pic_full_name", { length: 150 }).notNull(),
  picEmail: varchar("pic_email", { length: 150 }).notNull(),
  picPhoneE164: varchar("pic_phone_e164", { length: 30 }).notNull().default(""),
  trainingTopic: varchar("training_topic", { length: 255 }),
  message: text("message"),
  triageIntent: varchar("triage_intent", { length: 50 }),
  pLevyLiable: numeric("p_levy_liable", { precision: 4, scale: 3 }),
  urgencyScore: integer("urgency_score"),
  classifierModel: varchar("classifier_model", { length: 100 }),
  classifierLatencyMs: integer("classifier_latency_ms"),
  channelSource: varchar("channel_source", { length: 50 }).notNull(),
  campaignId: varchar("campaign_id", { length: 100 }),
  adId: varchar("ad_id", { length: 100 }),
  hasWhatsappOptIn: boolean("has_whatsapp_opt_in").notNull().default(false),
  accountType: varchar("account_type", { length: 30 }).notNull().default("SBL_KHAS_LEVY"),
  estimatedPax: integer("estimated_pax"),
  deliveryPreference: varchar("delivery_preference", { length: 30 }),
  tnaProfile: jsonb("tna_profile").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 50 }).notNull().default("LEAD_INGESTED"),
  convertedPackageId: uuid("converted_package_id"),
  qualifiedAt: ts("qualified_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const outboundCampaignOutbox = tpms.table("outbound_campaign_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull(),
  sequenceStep: integer("sequence_step").notNull().default(1),
  targetCompany: varchar("target_company", { length: 255 }).notNull(),
  targetPicEmail: varchar("target_pic_email", { length: 150 }).notNull(),
  ssmNumber: varchar("ssm_number", { length: 50 }),
  hiringSignalNotes: text("hiring_signal_notes"),
  subjectLine: varchar("subject_line", { length: 255 }).notNull(),
  emailBodyText: text("email_body_text").notNull(),
  wordCount: integer("word_count").notNull(),
  hasOptOutLink: boolean("has_opt_out_link").notNull().default(true),
  isApprovedByHuman: boolean("is_approved_by_human").notNull().default(false),
  approvedByUserId: varchar("approved_by_user_id", { length: 64 }),
  approvedAt: ts("approved_at"),
  sentAt: ts("sent_at"),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 30 }).notNull().default("WAITING_APPROVAL"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- knowledge
export const courseCatalog = tpms.table("course_catalog", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseCode: varchar("course_code", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  hrdFocusArea: varchar("hrd_focus_area", { length: 100 }).notNull(),
  matchedNossCode: varchar("matched_noss_code", { length: 50 }),
  targetSeniority: varchar("target_seniority", { length: 50 }).notNull(),
  level: integer("level").notNull().default(1),
  nextCourseCode: varchar("next_course_code", { length: 50 }),
  durationDays: integer("duration_days").notNull().default(2),
  learningOutcomes: jsonb("learning_outcomes").$type<LearningOutcome[]>().notNull(),
  masterOutlineMarkdown: text("master_outline_markdown").notNull(),
  hrdcProgrammeId: varchar("hrdc_programme_id", { length: 50 }),
  syllabusEmbedding: vector("syllabus_embedding", { dimensions: 1536 }),
  embeddingModel: varchar("embedding_model", { length: 100 }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export interface LearningOutcome {
  verb: string;
  outcome: string;
  bloomLevel: number;
}

export const knowledgeChunks = tpms.table("knowledge_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: varchar("source_type", { length: 32 }).notNull(),
  sourceRef: varchar("source_ref", { length: 100 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddingModel: varchar("embedding_model", { length: 100 }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- resources
export const trainers = tpms.table("trainers", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  nricHash: varchar("nric_hash", { length: 64 }).notNull(),
  nricEncrypted: bytea("nric_encrypted").notNull(),
  nricMasked: varchar("nric_masked", { length: 20 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),
  tttCertNumber: varchar("ttt_cert_number", { length: 100 }).notNull(),
  tttCertExpiryDate: date("ttt_cert_expiry_date", { mode: "string" }),
  tttVerified: boolean("ttt_verified").notNull().default(false),
  standardDayRate: money("standard_day_rate").notNull(),
  specialties: text("specialties").array().notNull().default([]),
  unavailableDates: date("unavailable_dates", { mode: "string" }).array().notNull().default([]),
  bioSummary: text("bio_summary"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const vendors = tpms.table("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  vendorType: varchar("vendor_type", { length: 32 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  city: varchar("city", { length: 100 }),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  capacity: integer("capacity"),
  ddrPerPax: money("ddr_per_pax"),
  unitCost: money("unit_cost"),
  freePostponementDays: integer("free_postponement_days").notNull().default(7),
  cancellationNoticeDays: integer("cancellation_notice_days").notNull().default(14),
  contactEmail: varchar("contact_email", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const costMatrixPolicies = tpms.table("cost_matrix_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: varchar("version", { length: 32 }).notNull(),
  deliveryMode: varchar("delivery_mode", { length: 32 }).notNull(),
  basis: varchar("basis", { length: 20 }).notNull(),
  bands: jsonb("bands").$type<CostBand[]>().notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  active: boolean("active").notNull().default(true),
  sourceNote: text("source_note").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export interface CostBand {
  minPax: number;
  maxPax: number;
  dailyCap: number;
}

// ---------------------------------------------------------------- aggregate
export const trainingPackages = tpms.table("training_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageCode: varchar("package_code", { length: 32 }).notNull(),
  clientId: uuid("client_id").notNull(),
  leadId: uuid("lead_id"),
  courseId: uuid("course_id"),
  title: varchar("title", { length: 255 }).notNull(),
  operationalStage: varchar("operational_stage", { length: 32 }).notNull().default("DRAFT"),
  financialStage: varchar("financial_stage", { length: 32 }).notNull().default("ESTIMATE"),
  deliveryMode: varchar("delivery_mode", { length: 32 }).notNull(),
  venueByClient: boolean("venue_by_client").notNull().default(false),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  durationDays: integer("duration_days"),
  paxEstimate: integer("pax_estimate").notNull().default(0),
  minParticipants: integer("min_participants").notNull().default(5),
  etrisGrantId: varchar("etris_grant_id", { length: 64 }),
  grantApprovedAmount: money("grant_approved_amount"),
  grantApprovedPax: integer("grant_approved_pax"),
  grantApprovedAt: ts("grant_approved_at"),
  quotedAmount: money("quoted_amount").notNull().default("0"),
  allowableCostCap: money("allowable_cost_cap"),
  trainerDayRate: money("trainer_day_rate"),
  costPolicyVersion: varchar("cost_policy_version", { length: 32 }),
  upfront30pctClaimed: boolean("upfront_30pct_claimed").notNull().default(false),
  upfrontAmount: money("upfront_amount").notNull().default("0"),
  claimSubmissionRef: varchar("claim_submission_ref", { length: 100 }),
  hrdcApprovedAmount: money("hrdc_approved_amount"),
  remittanceAmount: money("remittance_amount"),
  remittanceReference: varchar("remittance_reference", { length: 100 }),
  remittedAt: ts("remitted_at"),
  vendorAutoconfirmHalted: boolean("vendor_autoconfirm_halted").notNull().default(false),
  cancellationReason: text("cancellation_reason"),
  postponedFromStart: date("postponed_from_start", { mode: "string" }),
  createdBy: varchar("created_by", { length: 64 }),
  version: integer("version").notNull().default(1),
  createdAt: ts("created_at").defaultNow(),
  updatedAt: ts("updated_at").defaultNow(),
});

export const fsmTransitions = tpms.table(
  "fsm_transitions",
  {
    machine: varchar("machine", { length: 16 }).notNull(),
    fromStage: varchar("from_stage", { length: 32 }).notNull(),
    toStage: varchar("to_stage", { length: 32 }).notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    allowedActorTypes: text("allowed_actor_types").array().notNull(),
    description: text("description").notNull(),
  },
  (t) => [primaryKey({ columns: [t.machine, t.fromStage, t.toStage, t.reasonCode] })],
);

export const trainerEngagements = tpms.table("trainer_engagements", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  trainerId: uuid("trainer_id").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("TENTATIVE_HOLD"),
  dayRate: money("day_rate").notNull(),
  tttCertVerified: boolean("ttt_cert_verified").notNull().default(false),
  holdExpiryDate: date("hold_expiry_date", { mode: "string" }).notNull(),
  payWhenPaid: boolean("pay_when_paid").notNull().default(true),
  releasedAt: ts("released_at"),
  releaseReason: varchar("release_reason", { length: 64 }),
  releasePenalty: money("release_penalty").notNull().default("0"),
  createdAt: ts("created_at").defaultNow(),
});

export const vendorCommitments = tpms.table("vendor_commitments", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  vendorId: uuid("vendor_id"),
  vendorType: varchar("vendor_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("PROVISIONAL"),
  cost: money("cost").notNull(),
  cancellationDeadline: date("cancellation_deadline", { mode: "string" }).notNull(),
  postponementDeadline: date("postponement_deadline", { mode: "string" }),
  referenceNumber: varchar("reference_number", { length: 64 }),
  cancellationPenalty: money("cancellation_penalty").notNull().default("0"),
  createdAt: ts("created_at").defaultNow(),
});

export const packageParticipants = tpms.table("package_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  nricPassportHash: varchar("nric_passport_hash", { length: 64 }).notNull(),
  nricEncrypted: bytea("nric_encrypted").notNull(),
  nricMasked: varchar("nric_masked", { length: 20 }).notNull(),
  workEmail: varchar("work_email", { length: 255 }),
  phone: varchar("phone", { length: 30 }),
  dietaryPreference: varchar("dietary_preference", { length: 100 }).notNull().default("STANDARD_HALAL"),
  registrationStatus: varchar("registration_status", { length: 20 }).notNull().default("REGISTERED"),
  attendanceRate: numeric("attendance_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  hrdClaimEligible: boolean("hrd_claim_eligible").generatedAlwaysAs(sqlTrue()),
  kirkpatrickPreScore: numeric("kirkpatrick_pre_score", { precision: 5, scale: 2 }),
  kirkpatrickPostScore: numeric("kirkpatrick_post_score", { precision: 5, scale: 2 }),
  certSerialNumber: varchar("cert_serial_number", { length: 64 }),
  certIssuedAt: ts("cert_issued_at"),
  createdAt: ts("created_at").defaultNow(),
});

// Drizzle needs an expression for generated columns; the real one lives in SQL.
function sqlTrue() {
  return "attendance_rate >= 80.00" as unknown as never;
}

export const attendanceRecords = tpms.table("attendance_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  participantId: uuid("participant_id").notNull(),
  dayIndex: integer("day_index").notNull(),
  session: varchar("session", { length: 2 }).notNull(),
  track: varchar("track", { length: 20 }).notNull(),
  present: boolean("present").notNull(),
  signedAt: ts("signed_at"),
  signatureData: text("signature_data"),
  userAgent: text("user_agent"),
  ipHash: varchar("ip_hash", { length: 64 }),
  ocrConfidence: numeric("ocr_confidence", { precision: 4, scale: 3 }),
  sourceVaultId: uuid("source_vault_id"),
  needsReview: boolean("needs_review").notNull().default(false),
  reviewReason: varchar("review_reason", { length: 100 }),
  resolvedBy: varchar("resolved_by", { length: 64 }),
  resolvedAt: ts("resolved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const participantAssessments = tpms.table("participant_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  participantId: uuid("participant_id").notNull(),
  kind: varchar("kind", { length: 4 }).notNull(),
  score: numeric("score", { precision: 5, scale: 2 }).notNull(),
  answers: jsonb("answers").$type<unknown[]>().notNull().default([]),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  reactionRating: smallint("reaction_rating"),
});

export const quizBanks = tpms.table("quiz_banks", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull(),
  questions: jsonb("questions").$type<QuizQuestion[]>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
});

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
}

export const magicLinkTokens = tpms.table("magic_link_tokens", {
  jti: uuid("jti").primaryKey(),
  packageId: uuid("package_id").notNull(),
  participantId: uuid("participant_id"),
  purpose: varchar("purpose", { length: 20 }).notNull(),
  dayIndex: integer("day_index"),
  session: varchar("session", { length: 2 }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const complianceVault = tpms.table("compliance_vault", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id"),
  trainerId: uuid("trainer_id"),
  participantId: uuid("participant_id"),
  documentType: varchar("document_type", { length: 32 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  filePath: text("file_path").notNull(),
  fileHashSha256: varchar("file_hash_sha256", { length: 64 }).notNull(),
  verificationStatus: varchar("verification_status", { length: 32 }).notNull().default("PENDING"),
  extractedMetadata: jsonb("extracted_metadata").$type<Record<string, unknown>>().notNull().default({}),
  verificationNotes: text("verification_notes"),
  verifiedBy: varchar("verified_by", { length: 64 }),
  verifiedAt: ts("verified_at"),
  uploadedBy: varchar("uploaded_by", { length: 64 }).notNull().default("sys_daemon"),
  createdAt: ts("created_at").defaultNow(),
});

export const certificates = tpms.table("certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  participantId: uuid("participant_id").notNull(),
  certificateSerial: varchar("certificate_serial", { length: 100 }).notNull(),
  documentVaultId: uuid("document_vault_id").notNull(),
  payloadSha256: char("payload_sha256", { length: 64 }).notNull(),
  sha256Hash: char("sha256_hash", { length: 64 }).notNull(),
  publicVerificationUrl: text("public_verification_url").notNull(),
  revoked: boolean("revoked").notNull().default(false),
  issuedAt: ts("issued_at").notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  revokedAt: ts("revoked_at"),
  revokedReason: text("revoked_reason"),
  revokedBy: varchar("revoked_by", { length: 64 }),
});

export const quotations = tpms.table("quotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  version: integer("version").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("DRAFT"),
  inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
  lineItems: jsonb("line_items").$type<unknown[]>().notNull(),
  computed: jsonb("computed").$type<Record<string, unknown>>().notNull(),
  allowableCap: money("allowable_cap").notNull(),
  quotedAmount: money("quoted_amount").notNull(),
  totalDirectCost: money("total_direct_cost").notNull(),
  grossMargin: money("gross_margin").notNull(),
  marginPct: numeric("margin_pct", { precision: 6, scale: 2 }).notNull(),
  costPolicyVersion: varchar("cost_policy_version", { length: 32 }).notNull(),
  courseOutline: jsonb("course_outline").$type<Record<string, unknown>>().notNull().default({}),
  sheetSnapshot: jsonb("sheet_snapshot").$type<Record<string, unknown>>(),
  generatedBy: varchar("generated_by", { length: 16 }).notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
  approvedBy: varchar("approved_by", { length: 64 }),
  approvedAt: ts("approved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const decisions = tpms.table("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  gate: varchar("gate", { length: 40 }).notNull(),
  packageId: uuid("package_id"),
  subjectRef: varchar("subject_ref", { length: 100 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  summary: text("summary").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  options: jsonb("options").$type<DecisionOption[]>().notNull().default([]),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  chosenOption: varchar("chosen_option", { length: 40 }),
  raisedBy: varchar("raised_by", { length: 64 }).notNull(),
  raisedByTier: varchar("raised_by_tier", { length: 4 }),
  resolvedBy: varchar("resolved_by", { length: 64 }),
  resolvedAt: ts("resolved_at"),
  resolutionNote: text("resolution_note"),
  slaDueAt: ts("sla_due_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export interface DecisionOption {
  id: string;
  label: string;
  description: string;
  consequence?: string;
}

// ---------------------------------------------------------------- finance
export const taxInvoices = tpms.table("tax_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  invoiceNumber: varchar("invoice_number", { length: 40 }).notNull(),
  billedTo: varchar("billed_to", { length: 255 }).notNull().default("Pembangunan Sumber Manusia Berhad (HRD Corp)"),
  employerName: varchar("employer_name", { length: 255 }).notNull(),
  employerMycoid: varchar("employer_mycoid", { length: 50 }),
  grantReference: varchar("grant_reference", { length: 64 }).notNull(),
  subtotal: money("subtotal").notNull(),
  taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  taxAmount: money("tax_amount").notNull().default("0"),
  total: money("total").notNull(),
  lineItems: jsonb("line_items").$type<unknown[]>().notNull(),
  vaultId: uuid("vault_id"),
  issuedAt: ts("issued_at").notNull().defaultNow(),
});

export const paymentVouchers = tpms.table("payment_vouchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  pvNumber: varchar("pv_number", { length: 40 }).notNull(),
  payeeType: varchar("payee_type", { length: 20 }).notNull(),
  payeeName: varchar("payee_name", { length: 255 }).notNull(),
  engagementId: uuid("engagement_id"),
  commitmentId: uuid("commitment_id"),
  agreedAmount: money("agreed_amount").notNull(),
  adjustments: jsonb("adjustments").$type<PvAdjustment[]>().notNull().default([]),
  finalAmount: money("final_amount").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
  bankReference: varchar("bank_reference", { length: 100 }),
  receiptVaultId: uuid("receipt_vault_id"),
  vaultId: uuid("vault_id"),
  approvedBy: varchar("approved_by", { length: 64 }),
  paidBy: varchar("paid_by", { length: 64 }),
  paidAt: ts("paid_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export interface PvAdjustment {
  kind: "MILEAGE" | "WITHHOLDING_TAX" | "ALLOWANCE" | "DEDUCTION" | "OTHER";
  label: string;
  amount: number;
}

export const jobFinancialLedgers = tpms.table("job_financial_ledgers", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull(),
  approvedGrantAmount: money("approved_grant_amount").notNull(),
  trainerFeeAgreed: money("trainer_fee_agreed").notNull(),
  trainerFeePaid: money("trainer_fee_paid").notNull().default("0"),
  venueAndCateringCost: money("venue_and_catering_cost").notNull().default("0"),
  materialsAndPrintingCost: money("materials_and_printing_cost").notNull().default("0"),
  grossMargin: money("gross_margin").generatedAlwaysAs(sqlTrue()),
  salesRepName: varchar("sales_rep_name", { length: 100 }),
  salesCommissionAmount: money("sales_commission_amount").notNull().default("0"),
  netRetainedProfit: money("net_retained_profit").generatedAlwaysAs(sqlTrue()),
  taxInvoiceNumber: varchar("tax_invoice_number", { length: 100 }),
  bankPaymentReference: varchar("bank_payment_reference", { length: 100 }),
  paymentReceiptVaultId: uuid("payment_receipt_vault_id"),
  claimSubmittedAt: ts("claim_submitted_at"),
  remittedAt: ts("remitted_at"),
  reconciledAt: ts("reconciled_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const renewalSchedules = tpms.table("renewal_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  sourcePackageId: uuid("source_package_id").notNull(),
  cadenceType: varchar("cadence_type", { length: 50 }).notNull(),
  scheduledFor: date("scheduled_for", { mode: "string" }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("PENDING"),
  recommendedCourseId: uuid("recommended_course_id"),
  draftSubject: varchar("draft_subject", { length: 255 }),
  draftBody: text("draft_body"),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
  vaultId: uuid("vault_id"),
  dispatchedAt: ts("dispatched_at"),
  responseNotes: text("response_notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- AI / BYOK
export const providerKeys = tpms.table("provider_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 32 }).notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  baseUrl: text("base_url"),
  keyCiphertext: text("key_ciphertext").notNull(),
  maskedKey: varchar("masked_key", { length: 64 }).notNull(),
  tiers: text("tiers").array().notNull().default([]),
  monthlyCapMyr: money("monthly_cap_myr"),
  status: varchar("status", { length: 16 }).notNull().default("UNTESTED"),
  lastTestedAt: ts("last_tested_at"),
  lastTestResult: text("last_test_result"),
  createdBy: varchar("created_by", { length: 64 }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const tierConfig = tpms.table("tier_config", {
  tier: varchar("tier", { length: 8 }).primaryKey(),
  label: varchar("label", { length: 100 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  fallback: jsonb("fallback").$type<Array<{ provider: string; model: string }>>().notNull().default([]),
  monthlyCapMyr: money("monthly_cap_myr").notNull(),
  maxTokens: integer("max_tokens").notNull().default(2048),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const agentRuns = tpms.table("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  agent: varchar("agent", { length: 64 }).notNull(),
  tier: varchar("tier", { length: 4 }).notNull(),
  packageId: uuid("package_id"),
  leadId: uuid("lead_id"),
  taskId: uuid("task_id"),
  status: varchar("status", { length: 20 }).notNull().default("RUNNING"),
  inputSummary: text("input_summary").notNull().default(""),
  output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
  costMyr: numeric("cost_myr", { precision: 16, scale: 8 }).notNull().default("0"),
  error: text("error"),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

export const llmUsage = tpms.table("llm_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id"),
  agent: varchar("agent", { length: 64 }).notNull(),
  tier: varchar("tier", { length: 8 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  keyId: uuid("key_id"),
  packageId: uuid("package_id"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 16, scale: 10 }).notNull().default("0"),
  costMyr: numeric("cost_myr", { precision: 16, scale: 8 }).notNull().default("0"),
  costEstimated: boolean("cost_estimated").notNull().default(true),
  latencyMs: integer("latency_ms").notNull().default(0),
  status: varchar("status", { length: 24 }).notNull(),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type TrainingPackage = typeof trainingPackages.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type Quotation = typeof quotations.$inferSelect;
export type VaultDocument = typeof complianceVault.$inferSelect;
export type Participant = typeof packageParticipants.$inferSelect;
export type Lead = typeof leadRecords.$inferSelect;
export type Client = typeof corporateClients.$inferSelect;
export type Trainer = typeof trainers.$inferSelect;
export type Vendor = typeof vendors.$inferSelect;
export type Task = typeof taskQueue.$inferSelect;
export type AuditRow = typeof auditLedger.$inferSelect;
