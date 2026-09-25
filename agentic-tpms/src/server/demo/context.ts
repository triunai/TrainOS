import { and, eq, sql } from "drizzle-orm";
import { addDays, todayMY } from "@/lib/dates";
import { allHandlers } from "../../../worker/handlers";
import { getQuiz, loadQuizBank, submitAssessment } from "@/server/assessments";
import type { ParticipantLinks } from "@/server/attendance";
import { type Actor, db, one, rows, schema } from "@/server/db/client";
import type { VaultDocument } from "@/server/db/schema";
import type { GuardResult } from "@/server/fsm/guards";
import { type DemoPerson, demoCohort } from "./people";
import type { DemoScenario } from "./scenarios";
import { GoldenPathError, type TaskRun, formatMyt, runQueuedTask } from "./tasks";

/**
 * What every golden-path step shares: the step vocabulary, the mutable
 * context threaded through a run, the per-step recorder (ids, notes, tasks,
 * fast-forwards, assertions), and the read helpers the steps assert with.
 * The steps themselves live in ./steps, one file per stage of the lifecycle;
 * ./goldenPath.ts drives them.
 */
export const DEMO_ACTORS = {
  director: { type: "USER", id: "usr_alex_director" },
  ops: { type: "USER", id: "usr_siti_ops" },
  finance: { type: "USER", id: "usr_raj_finance" },
} as const satisfies Record<string, Actor>;

export const GOLDEN_STEPS = [
  "reference",
  "lead.ingest",
  "lead.triage",
  "lead.qualify",
  "lead.convert",
  "proposal.draft",
  "gate1.approve",
  "client.accept",
  "grant.letter",
  "grant.confirm",
  "logistics.lock",
  "roster",
  "t14",
  "links",
  "delivery.start",
  "attendance.day1",
  "t3.day1",
  "t3.resolve",
  "attendance.rest",
  "t3.digital",
  "photos",
  "quiz.post",
  "delivery.complete",
  "claim.evidence",
  "claim.submit",
  "claim.query",
  "claim.resubmit",
  "claim.approve",
  "claim.remit",
  "ap.settle",
  "retention.t14",
  "sweep",
] as const;
export type GoldenStep = (typeof GOLDEN_STEPS)[number];

export interface StageMove {
  machine: "OPERATIONAL" | "FINANCIAL";
  from: string | null;
  to: string;
  reason: string;
  actor: string;
  warnings: GuardResult[];
}

export interface StepRecord {
  index: number;
  step: GoldenStep;
  title: string;
  operational: { from: string | null; to: string | null };
  financial: { from: string | null; to: string | null };
  /** The lead's status before and after (lead steps). */
  lead: { from: string | null; to: string | null } | null;
  /** Every stage transition this step caused, in ledger order. */
  moves: StageMove[];
  ids: Record<string, string>;
  notes: string[];
  fastForwards: string[];
  tasks: string[];
  ms: number;
}

export interface GoldenPathOptions {
  scenario?: DemoScenario;
  /** Last step to run (inclusive). Defaults to the whole path. */
  stopAfter?: GoldenStep;
  /** `auto` probes the extraction service (PADDLEOCR_URL); `off` skips Track B scans. */
  ocr?: "auto" | "off";
  /** Seed reference data through the lanes' seed functions first (idempotent). Default true. */
  reference?: boolean;
  /** Called as each step finishes (live printing). */
  onStep?: (record: StepRecord) => void;
  /** Distinguishes this run's lead payload from an earlier run's (see webFormPayload). */
  nonce?: string;
}

export interface CertificateCheck {
  serial: string;
  holder: string;
  status: string;
  url: string;
}

export interface GoldenPathResult {
  scenario: string;
  stoppedAfter: GoldenStep;
  leadId: string | null;
  packageId: string | null;
  packageCode: string | null;
  final: { operational: string | null; financial: string | null };
  ocr: { available: boolean; detail: string };
  certificates: CertificateCheck[];
  operationsUrl: string | null;
  steps: StepRecord[];
}

export const STEP_TITLES: Record<GoldenStep, string> = {
  reference: "Reference data (lane seed functions)",
  "lead.ingest": "Web-form lead ingested",
  "lead.triage": "L1 triage (lead.triage)",
  "lead.qualify": "Operator qualifies; WhatsApp micro-TNA",
  "lead.convert": "Lead converted to a DRAFT package",
  "proposal.draft": "Sourcing agent drafts the proposal",
  "gate1.approve": "Gate 1: edit, approve and dispatch",
  "client.accept": "Client accepts; e-TRiS dossier",
  "grant.letter": "e-TRiS approval letter uploaded and read (L2)",
  "grant.confirm": "Operator confirms the grant",
  "logistics.lock": "Trainer, venue BEO, agreement; lock",
  roster: "Cohort registered",
  t14: "T-14 viability check",
  links: "Magic links issued; PRE quiz",
  "delivery.start": "Delivery starts",
  "attendance.day1": "Track A check-ins, Day 1",
  "t3.day1": "Track B: Form T3 Day 1 scan + OCR",
  "t3.resolve": "Attendance exceptions resolved",
  "attendance.rest": "Track A check-ins, remaining days",
  "t3.digital": "Digital Form T3 for Track-A-only days",
  photos: "Session photos + EXIF check",
  "quiz.post": "POST quiz",
  "delivery.complete": "Delivery verified; certificates; retention",
  "claim.evidence": "JD/14 verified; claim collated",
  "claim.submit": "Gate 3: claim pack approved",
  "claim.query": "HRD Corp query recorded",
  "claim.resubmit": "Query answered and resubmitted",
  "claim.approve": "HRD Corp approval recorded",
  "claim.remit": "Remittance recorded; PVs drafted",
  "ap.settle": "Vouchers approved and paid; settled",
  "retention.t14": "T+14 executive pack drafted and sent",
  sweep: "Stale tasks swept; queue clean",
};

// ------------------------------------------------------------------ context

export interface RosterEntry extends DemoPerson {
  participantId: string;
  index: number;
}

/** Mutable state threaded through the steps. */
export class GoldenPathContext {
  readonly scenario: DemoScenario;
  readonly nonce: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly steps: StepRecord[] = [];
  ocr = { available: false, detail: "not probed", probed: false };
  leadId: string | null = null;
  packageId: string | null = null;
  packageCode: string | null = null;
  clientId: string | null = null;
  clientName: string | null = null;
  quotationId: string | null = null;
  engagementId: string | null = null;
  commitmentId: string | null = null;
  roster: RosterEntry[] = [];
  links = new Map<string, ParticipantLinks>();
  /** Day -> vault id of a Track B sheet that ended VERIFIED. */
  scannedDays = new Map<number, string>();
  certificates: CertificateCheck[] = [];
  grantId: string | null = null;
  claimSubmissionRef: string | null = null;

  constructor(scenario: DemoScenario, opts: { nonce?: string; ocr?: "auto" | "off" } = {}) {
    this.scenario = scenario;
    this.nonce = opts.nonce ?? Date.now().toString(36);
    this.startDate = addDays(todayMY(), scenario.startInDays);
    this.endDate = addDays(this.startDate, scenario.days - 1);
    if (opts.ocr === "off") this.ocr = { available: false, detail: "disabled by option", probed: true };
  }

  pkgId(step: string): string {
    if (!this.packageId) throw new GoldenPathError(step, "no package yet; run the earlier steps first");
    return this.packageId;
  }

  /** A per-package number for references that must look unique (grant id, refs). */
  refNumber(): string {
    const digits = (this.packageCode ?? "").replace(/\D/g, "");
    return digits.slice(-4).padStart(4, "0");
  }

  dayDate(day: number): string {
    return addDays(this.startDate, day - 1);
  }
}

export class Recorder {
  readonly ids: Record<string, string> = {};
  readonly notes: string[] = [];
  readonly fastForwards: string[] = [];
  readonly tasks: string[] = [];
  constructor(readonly step: GoldenStep) {}

  id(key: string, value: string | null | undefined): void {
    if (value) this.ids[key] = value;
  }
  note(text: string): void {
    this.notes.push(text);
  }
  task(run: TaskRun, summary?: string): TaskRun {
    const tag = run.byLiveWorker ? " (run by a live worker)" : "";
    this.tasks.push(`${run.type} ✓${tag}${summary ? ` — ${summary}` : ""}`);
    if (run.fastForwarded) {
      this.fastForwards.push(`⏩ fast-forward: ${run.type} was due ${formatMyt(run.dueAt)}; ran now through its handler`);
    }
    return run;
  }
  /** Assert an outcome; the message says what the step expected. */
  expect(condition: unknown, message: string, details: Record<string, unknown> = {}): asserts condition {
    if (!condition) throw new GoldenPathError(this.step, message, details);
  }
}

// ------------------------------------------------------------------ reads

export async function stagesOf(packageId: string | null): Promise<{ operational: string | null; financial: string | null }> {
  if (!packageId) return { operational: null, financial: null };
  const [p] = await db()
    .select({ o: schema.trainingPackages.operationalStage, f: schema.trainingPackages.financialStage })
    .from(schema.trainingPackages)
    .where(eq(schema.trainingPackages.id, packageId));
  return { operational: p?.o ?? null, financial: p?.f ?? null };
}

export async function ledgerHead(): Promise<number> {
  const row = await one<{ seq: number | null }>(db(), sql`select max(seq)::bigint as seq from tpms.audit_ledger`);
  return Number(row?.seq ?? 0);
}

/** Stage transitions of one package recorded after `afterSeq`, in ledger order. */
export async function ledgerMoves(packageId: string, afterSeq = 0): Promise<StageMove[]> {
  const list = await rows<{
    machine: "OPERATIONAL" | "FINANCIAL";
    from_stage: string | null;
    to_stage: string;
    reason_code: string;
    actor_type: string;
    actor_id: string;
    metadata_diff: { context?: { guard_warnings?: GuardResult[] } };
  }>(
    db(),
    sql`select machine, from_stage, to_stage, reason_code, actor_type, actor_id, metadata_diff
          from tpms.audit_ledger
         where entity_type = 'TRAINING_PACKAGE' and entity_id = ${packageId}::uuid
           and machine is not null and seq > ${afterSeq}
         order by seq`,
  );
  return list.map((r) => ({
    machine: r.machine,
    from: r.from_stage,
    to: r.to_stage,
    reason: r.reason_code,
    actor: `${r.actor_type}:${r.actor_id}`,
    warnings: r.metadata_diff?.context?.guard_warnings ?? [],
  }));
}

export async function packageRow(packageId: string) {
  const [p] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  return p;
}

export async function pendingDecision(gate: string, subjectRef: string) {
  const [d] = await db()
    .select()
    .from(schema.decisions)
    .where(and(eq(schema.decisions.gate, gate), eq(schema.decisions.subjectRef, subjectRef), eq(schema.decisions.status, "PENDING")));
  return d;
}

export async function vaultOf(packageId: string, type: string): Promise<VaultDocument[]> {
  return db()
    .select()
    .from(schema.complianceVault)
    .where(and(eq(schema.complianceVault.packageId, packageId), eq(schema.complianceVault.documentType, type)));
}

export const run = (rec: Recorder, type: Parameters<typeof runQueuedTask>[0], match: Record<string, string>, fastForward = false) =>
  runQueuedTask(type, match, { step: rec.step, handlers: allHandlers, fastForward });

export const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);
export const plusMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

/**
 * A simulated participant who knows `correct` of the answers: the first `correct` questions on
 * their own (shuffled) sitting right, the rest wrong. The demo reads the bank's key server-side
 * to choose them; the quiz page a real participant sees never carries it.
 */
export async function sitQuiz(packageId: string, participantId: string, kind: "PRE" | "POST", correct: number, reaction?: number) {
  const view = await getQuiz(packageId, participantId, kind);
  const pkg = await packageRow(packageId);
  const bank = await loadQuizBank(db(), pkg.courseId as string);
  if (!bank) throw new Error(`no quiz bank for course ${pkg.courseId}`);
  const key = new Map(bank.questions.map((q) => [q.id, q.options[q.answerIndex]]));
  const answers = view.questions.map((q, n) => {
    const right = q.options.indexOf(key.get(q.id) as string);
    return { questionId: q.id, optionIndex: n < correct ? right : (right + 1) % q.options.length };
  });
  return submitAssessment({
    packageId,
    participantId,
    kind,
    answers,
    quizVersion: view.quizVersion,
    ...(reaction ? { reaction: { rating: reaction } } : {}),
  });
}

export const USER_AGENT = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";

/** The scenario's roster (deterministic: the same scenario always registers the same people). */
export function cohortFor(s: DemoScenario): DemoPerson[] {
  return demoCohort(s.roster, { domain: s.company.domain, offset: s.rosterOffset, salt: s.rosterOffset + s.startInDays });
}

export type StepFn = (ctx: GoldenPathContext, rec: Recorder) => Promise<void>;
/** A stage's steps; goldenPath.ts checks at compile time that the stages cover GOLDEN_STEPS exactly. */
export type StepMap = Partial<Record<GoldenStep, StepFn>>;
