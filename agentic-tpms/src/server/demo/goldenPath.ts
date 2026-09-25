import { env } from "@/server/env";
import { isDomainError } from "@/server/domain/errors";
import { getLead } from "@/server/ingestion";
import {
  type GoldenPathOptions,
  type GoldenPathResult,
  type GoldenStep,
  type StageMove,
  type StepFn,
  type StepRecord,
  GOLDEN_STEPS,
  GoldenPathContext,
  Recorder,
  STEP_TITLES,
  ledgerHead,
  ledgerMoves,
  stagesOf,
} from "./context";
import { GOLDEN_SCENARIO } from "./scenarios";
import { CLAIMS_STEPS } from "./steps/claims";
import { COMMERCIAL_STEPS } from "./steps/commercial";
import { DELIVERY_STEPS } from "./steps/delivery";
import { INTAKE_STEPS } from "./steps/intake";
import { OPERATIONS_STEPS } from "./steps/operations";
import { GoldenPathError } from "./tasks";

/**
 * The golden path: ONE package from an inbound web-form lead to
 * SETTLED_CLOSED, driven only through the domain services and the real task
 * handlers (`allHandlers`, the same map the worker runs). No domain table is
 * written directly; reference data comes from each lane's own seed function.
 *
 * It is a list of ordered steps (./context.ts GOLDEN_STEPS, implemented in
 * ./steps by lifecycle stage), each callable on its own, so the demo seed can
 * stop a package at any point (`driveTo`). Every step asserts the state it
 * must leave behind and throws a GoldenPathError naming itself when it does
 * not, and every step records: the stage moves it caused (read back from the
 * audit ledger, with the L0 guard warnings the operator was shown), the ids
 * it created, the tasks it ran, and anything it FAST-FORWARDED.
 *
 * Time. Training starts today + 20 by default and nothing waits for a clock:
 *   - a task not yet due (T-14 check, retention runs) is run through its
 *     handler ahead of time and logged "⏩ fast-forward";
 *   - participant actions pass `now` (check-in windows, quiz windows);
 *   - delivery is started by an operator (USER may start early, with a
 *     STARTED_EARLY warning); the SYSTEM delivery.start task stays queued for
 *     07:00 on day 1 and, fast-forwarded at the end, is shown to skip a
 *     package that has already moved on rather than dead-letter.
 * Everything else (dates on vault rows, audit timestamps) is the real clock.
 */
export {
  type CertificateCheck,
  type GoldenPathOptions,
  type GoldenPathResult,
  type GoldenStep,
  type StageMove,
  type StepRecord,
  DEMO_ACTORS,
  GOLDEN_STEPS,
  GoldenPathContext,
  cohortFor,
  ledgerMoves,
} from "./context";
export { ensureReferenceData } from "./steps/intake";

/** Every step, by stage. Assigning to Record<GoldenStep, StepFn> makes a missing or unknown step a compile error. */
const STEPS: Record<GoldenStep, StepFn> = { ...INTAKE_STEPS, ...COMMERCIAL_STEPS, ...OPERATIONS_STEPS, ...DELIVERY_STEPS, ...CLAIMS_STEPS };

// ------------------------------------------------------------------ driver

/** Run one named step on a context, recording it. Exposed so callers can drive steps one at a time. */
export async function runStep(ctx: GoldenPathContext, step: GoldenStep, onStep?: (r: StepRecord) => void): Promise<StepRecord> {
  const started = Date.now();
  const before = await stagesOf(ctx.packageId);
  const leadBefore = ctx.leadId ? (await getLead(ctx.leadId)).status : null;
  const head = await ledgerHead();
  const rec = new Recorder(step);
  try {
    await STEPS[step](ctx, rec);
  } catch (error) {
    if (error instanceof GoldenPathError) throw error;
    const detail = isDomainError(error) ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
    throw new GoldenPathError(step, detail, { cause: error instanceof Error ? error.stack : String(error) });
  }
  const after = await stagesOf(ctx.packageId);
  const leadAfter = ctx.leadId ? (await getLead(ctx.leadId)).status : null;
  const moves = ctx.packageId ? await ledgerMoves(ctx.packageId, head) : [];
  const warnings = moves.flatMap((m) => m.warnings.map((w) => `${w.code}`));
  const record: StepRecord = {
    index: ctx.steps.length + 1,
    step,
    title: STEP_TITLES[step],
    operational: { from: step === "lead.convert" ? null : before.operational, to: after.operational },
    financial: { from: step === "lead.convert" ? null : before.financial, to: after.financial },
    lead: leadAfter ? { from: leadBefore, to: leadAfter } : null,
    moves,
    ids: rec.ids,
    notes: [...(warnings.length ? [`⚠ guard warnings: ${[...new Set(warnings)].join(", ")}`] : []), ...rec.notes],
    fastForwards: rec.fastForwards,
    tasks: rec.tasks,
    ms: Date.now() - started,
  };
  ctx.steps.push(record);
  onStep?.(record);
  return record;
}

/** Drive a scenario from the start through `stop` (inclusive). */
export async function driveTo(stop: GoldenStep, opts: GoldenPathOptions = {}): Promise<GoldenPathResult> {
  const ctx = new GoldenPathContext(opts.scenario ?? GOLDEN_SCENARIO, { nonce: opts.nonce, ocr: opts.ocr });
  const last = GOLDEN_STEPS.indexOf(stop);
  if (last < 0) throw new Error(`Unknown golden-path step: ${stop}`);
  for (const step of GOLDEN_STEPS.slice(0, last + 1)) {
    if (step === "reference" && opts.reference === false) continue;
    await runStep(ctx, step, opts.onStep);
  }
  const final = await stagesOf(ctx.packageId);
  return {
    scenario: ctx.scenario.key,
    stoppedAfter: stop,
    leadId: ctx.leadId,
    packageId: ctx.packageId,
    packageCode: ctx.packageCode,
    final,
    ocr: { available: ctx.ocr.available, detail: ctx.ocr.detail },
    certificates: ctx.certificates,
    operationsUrl: ctx.packageCode ? `${env().TPMS_PUBLIC_BASE_URL.replace(/\/+$/, "")}/operations/${ctx.packageCode}` : null,
    steps: ctx.steps,
  };
}

/** The whole path: lead in, SETTLED_CLOSED out, T+14 retention sent. */
export async function runGoldenPath(opts: GoldenPathOptions = {}): Promise<GoldenPathResult> {
  return driveTo(opts.stopAfter ?? "sweep", opts);
}

/** The stage transitions the full golden path must leave in the ledger, in order. */
export const GOLDEN_TRANSITIONS: Array<[StageMove["machine"], string, string, string]> = [
  ["OPERATIONAL", "DRAFT", "QUOTED", "COMMERCIAL_TERMS_APPROVED"],
  ["OPERATIONAL", "QUOTED", "GRANT_PENDING", "CLIENT_ACCEPTED_QUOTATION"],
  ["FINANCIAL", "ESTIMATE", "GRANT_RESERVED", "CLIENT_ACCEPTED_QUOTATION"],
  ["OPERATIONAL", "GRANT_PENDING", "GRANT_APPROVED", "GRANT_CONFIRMED_LOCKED"],
  ["OPERATIONAL", "GRANT_APPROVED", "OPERATIONS_LOCKED", "OPERATIONS_READINESS_LOCKED"],
  ["OPERATIONAL", "OPERATIONS_LOCKED", "READY_FOR_EVENT", "T14_VIABILITY_PASSED"],
  ["OPERATIONAL", "READY_FOR_EVENT", "DELIVERY_IN_PROGRESS", "DELIVERY_STARTED"],
  ["OPERATIONAL", "DELIVERY_IN_PROGRESS", "DELIVERY_COMPLETED", "DELIVERY_VERIFIED_SUCCESS"],
  ["FINANCIAL", "GRANT_RESERVED", "CLAIM_NOT_READY", "TRAINING_COMPLETED"],
  ["FINANCIAL", "CLAIM_NOT_READY", "CLAIM_READY", "CLAIM_EVIDENCE_VERIFIED"],
  ["FINANCIAL", "CLAIM_READY", "CLAIM_SUBMITTED", "CLAIM_PACK_APPROVED"],
  ["FINANCIAL", "CLAIM_SUBMITTED", "QUERIED", "CLAIM_QUERIED_BY_HRDC"],
  ["FINANCIAL", "QUERIED", "CLAIM_SUBMITTED", "QUERY_RESPONSE_RESUBMITTED"],
  ["FINANCIAL", "CLAIM_SUBMITTED", "APPROVED", "CLAIM_APPROVED_BY_HRDC"],
  ["FINANCIAL", "APPROVED", "REMITTED", "REMITTANCE_RECEIVED"],
  ["FINANCIAL", "REMITTED", "SETTLED_CLOSED", "AP_DISBURSEMENT_CONFIRMED"],
];
