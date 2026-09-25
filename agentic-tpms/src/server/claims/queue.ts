import { sql } from "drizzle-orm";
import { daysBetween, todayMY } from "@/lib/dates";
import { fromSen, toSen } from "@/lib/money";
import { db, rows } from "../db/client";
import { FIN_STAGES, type FinStage } from "../domain/stages";
import { claimableSen } from "../fsm/guards";
import { loadSnapshot } from "../packages/snapshot";
import { evaluateChecklist } from "./checklist";
import { listClaimQueue, type ClaimQueueRow } from "./gate3";

/**
 * The cross-package Claims queue (Finance › Claims): `listClaimQueue` plus
 * what the queue needs per row and the Gate 3 tab computes one package at a
 * time — the claimable amount, checklist progress, the HRD Corp claim window
 * and the open query. Read-only; every write stays on the package's tab.
 */

/** The open-claim stages in FSM display order, CLAIM_NOT_READY through REMITTED (derived, never retyped). */
export const CLAIM_QUEUE_STAGES: readonly FinStage[] = FIN_STAGES.slice(FIN_STAGES.indexOf("CLAIM_NOT_READY"), FIN_STAGES.indexOf("REMITTED") + 1);

/** HRD Corp accepts an SBL-Khas claim up to six calendar months after the last training day. */
export const CLAIM_WINDOW_MONTHS = 6;
/** Days before the deadline at which an unsubmitted claim is flagged. */
export const CLAIM_WINDOW_WARN_DAYS = 45;

/** Stages at which the claim has not reached e-TRiS yet, so the window still runs. */
const UNFILED: ReadonlySet<string> = new Set(["CLAIM_NOT_READY", "CLAIM_READY"]);

export type ClaimWindowState = "OPEN" | "CLOSING" | "LAPSED" | "FILED";
export type ClaimWindow = { deadline: string; daysLeft: number; state: ClaimWindowState };

/** Calendar-month arithmetic on YYYY-MM-DD, clamped to the month's last day (31 Mar + 6 months = 30 Sep). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function claimWindow(endDate: string, financialStage: string, today: string = todayMY()): ClaimWindow {
  const deadline = addMonths(endDate, CLAIM_WINDOW_MONTHS);
  const daysLeft = daysBetween(today, deadline);
  if (!UNFILED.has(financialStage)) return { deadline, daysLeft, state: "FILED" };
  return { deadline, daysLeft, state: daysLeft < 0 ? "LAPSED" : daysLeft <= CLAIM_WINDOW_WARN_DAYS ? "CLOSING" : "OPEN" };
}

export type ClaimQuery = { note: string; raisedAt: string; raisedBy: string; count: number };

export type ClaimQueueItem = ClaimQueueRow & {
  /** What the tax invoice must equal: the grant, pro-rated for per-pax programmes (NUMERIC string). */
  claimable: string;
  /** Still to arrive from HRD Corp for this package, net of any 30% upfront advance (NUMERIC string). */
  awaiting: string;
  checklist: { ok: number; required: number; ready: boolean; missing: string[] };
  daysSinceEnd: number | null;
  window: ClaimWindow | null;
  /** First move to CLAIM_SUBMITTED, as an ISO instant. */
  submittedAt: string | null;
  /** The latest HRD Corp query on this claim, with how many there have been. */
  query: ClaimQuery | null;
};

type AuditFacts = { packageId: string; submittedMs: number | null; queryNote: string | null; queryMs: number | null; queryBy: string | null; queries: number };

async function auditFacts(ids: string[]): Promise<Map<string, AuditFacts>> {
  if (ids.length === 0) return new Map();
  const result = await rows<AuditFacts>(
    db(),
    sql`select p.id as "packageId",
               (select (extract(epoch from min(a.created_at)) * 1000)::float8 from tpms.audit_ledger a
                 where a.entity_type = 'TRAINING_PACKAGE' and a.entity_id = p.id
                   and a.machine = 'FINANCIAL' and a.to_stage = 'CLAIM_SUBMITTED') as "submittedMs",
               q.reason_details as "queryNote",
               (extract(epoch from q.created_at) * 1000)::float8 as "queryMs",
               q.actor_id as "queryBy",
               (select count(*)::int from tpms.audit_ledger a
                 where a.entity_type = 'TRAINING_PACKAGE' and a.entity_id = p.id
                   and a.reason_code = 'CLAIM_QUERIED_BY_HRDC' and a.to_stage = 'QUERIED') as queries
          from tpms.training_packages p
          left join lateral (
            select a.reason_details, a.created_at, a.actor_id from tpms.audit_ledger a
             where a.entity_type = 'TRAINING_PACKAGE' and a.entity_id = p.id
               and a.reason_code = 'CLAIM_QUERIED_BY_HRDC' and a.to_stage = 'QUERIED'
             order by a.seq desc limit 1
          ) q on true
         where p.id = any (${`{${ids.join(",")}}`}::uuid[])`,
  );
  return new Map(result.map((r) => [r.packageId, r]));
}

const iso = (ms: number | null) => (ms === null ? null : new Date(Number(ms)).toISOString());

/** Amount HRD Corp still owes on a claim at this stage. R14: a stage outside the queue is an error. */
function awaitingSen(stage: string, claimable: number, row: ClaimQueueRow): number {
  const upfront = toSen(row.upfrontAmount);
  switch (stage) {
    case "CLAIM_NOT_READY":
    case "CLAIM_READY":
    case "CLAIM_SUBMITTED":
    case "QUERIED":
      return Math.max(claimable - upfront, 0);
    case "APPROVED":
      return Math.max(toSen(row.hrdcApprovedAmount ?? fromSen(claimable)) - upfront, 0);
    case "REMITTED":
      return 0;
    default:
      throw new Error(`Not a claim-queue stage: ${stage}`);
  }
}

/** Every open claim with its per-package detail, oldest delivery first. */
export async function listClaimQueueDetail(opts: { stages?: string[]; today?: string } = {}): Promise<ClaimQueueItem[]> {
  const today = opts.today ?? todayMY();
  const base = await listClaimQueue({ stages: opts.stages });
  const facts = await auditFacts(base.map((r) => r.packageId));
  return Promise.all(
    base.map(async (row): Promise<ClaimQueueItem> => {
      const snapshot = await loadSnapshot(db(), row.packageId, today);
      const checklist = evaluateChecklist(snapshot);
      const required = checklist.items.filter((i) => i.required);
      const claimable = claimableSen(snapshot);
      const f = facts.get(row.packageId);
      return {
        ...row,
        claimable: fromSen(claimable),
        awaiting: fromSen(awaitingSen(row.financialStage, claimable, row)),
        checklist: {
          ok: required.filter((i) => i.ok).length,
          required: required.length,
          ready: checklist.ready,
          missing: required.filter((i) => !i.ok).map((i) => i.label),
        },
        daysSinceEnd: row.endDate ? daysBetween(row.endDate, today) : null,
        window: row.endDate ? claimWindow(row.endDate, row.financialStage, today) : null,
        submittedAt: iso(f?.submittedMs ?? null),
        query: f?.queryNote !== null && f?.queryNote !== undefined && f.queryMs !== null
          ? { note: f.queryNote, raisedAt: iso(f.queryMs)!, raisedBy: f.queryBy ?? "", count: f.queries }
          : null,
      };
    }),
  );
}

export type ClaimBucket = { count: number; amount: string };

export type ClaimQueueSummary = {
  /** Every queue stage in display order, zeros included. */
  stages: Array<{ stage: FinStage; count: number }>;
  /** Claimable value of every claim not yet remitted. */
  claimable: ClaimBucket;
  notSubmitted: ClaimBucket;
  submitted: ClaimBucket;
  queried: ClaimBucket;
  /** Approved by HRD Corp, awaiting the transfer (approved amount). */
  approved: ClaimBucket;
  /** Cash still to come from HRD Corp across the queue, net of upfront advances. */
  awaitingHrdc: string;
  /** Unsubmitted claims inside the warning window or past the deadline. */
  closing: number;
  lapsed: number;
};

/** Pure: the queue's MetricStrip and tab counts, from the rows. */
export function summariseClaimQueue(items: ClaimQueueItem[]): ClaimQueueSummary {
  const bucket = (filter: (i: ClaimQueueItem) => boolean, amount: (i: ClaimQueueItem) => string | null): ClaimBucket => {
    const hit = items.filter(filter);
    return { count: hit.length, amount: fromSen(hit.reduce((acc, i) => acc + toSen(amount(i)), 0)) };
  };
  return {
    stages: CLAIM_QUEUE_STAGES.map((stage) => ({ stage, count: items.filter((i) => i.financialStage === stage).length })),
    claimable: bucket((i) => i.financialStage !== "REMITTED", (i) => i.claimable),
    notSubmitted: bucket((i) => UNFILED.has(i.financialStage), (i) => i.claimable),
    submitted: bucket((i) => i.financialStage === "CLAIM_SUBMITTED", (i) => i.claimable),
    queried: bucket((i) => i.financialStage === "QUERIED", (i) => i.claimable),
    approved: bucket((i) => i.financialStage === "APPROVED", (i) => i.hrdcApprovedAmount),
    awaitingHrdc: fromSen(items.reduce((acc, i) => acc + toSen(i.awaiting), 0)),
    closing: items.filter((i) => i.window?.state === "CLOSING").length,
    lapsed: items.filter((i) => i.window?.state === "LAPSED").length,
  };
}
