import { and, asc, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { toSen, type Sen } from "@/lib/money";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Executor, db, schema, withTx } from "../db/client";
import type { CostBand } from "../db/schema";
import { DELIVERY_MODES, type DeliveryMode } from "../domain/stages";
import { DomainError } from "../domain/errors";

/**
 * The HRD Corp Allowable Cost Matrix, as versioned policy DATA.
 *
 * WHY data and not constants: HRD Corp revises the matrix by circular. An
 * operator edits the bands on the settings screen (audited), every quotation
 * records the policy version and daily cap it was priced under, and a stale
 * quotation is refused at Gate 1 rather than silently re-priced.
 *
 * Units: `CostBand.dailyCap` is whole ringgit per day exactly as a circular
 * writes it (e.g. 8000 = RM 8,000/day). Arithmetic converts to integer sen at
 * the boundary (`dailyCapFor` returns sen).
 */
export const COST_BASES = ["PER_GROUP_DAY", "PER_PAX_DAY"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export type CostPolicy = typeof schema.costMatrixPolicies.$inferSelect;

export interface CostPolicySeed {
  version: string;
  deliveryMode: DeliveryMode;
  basis: CostBasis;
  bands: CostBand[];
  effectiveFrom: string;
  sourceNote: string;
}

export const DEFAULT_POLICY_VERSION = "ACM-2026.1";

const SOURCE_NOTE =
  "Configured from the TPMS handoff spec v4.2 (in-house RM 6,000–14,000/day by group size with RM 10,500 as the reference " +
  "rate; public programmes RM 1,300 per pax per day). The ROT (remote online training) bands are ILLUSTRATIVE placeholders. " +
  "Every value MUST be verified against the current HRD Corp Allowable Cost Matrix circular before production use.";

export const DEFAULT_COST_POLICIES: readonly CostPolicySeed[] = [
  {
    version: DEFAULT_POLICY_VERSION,
    deliveryMode: "IN_HOUSE",
    basis: "PER_GROUP_DAY",
    bands: [
      { minPax: 1, maxPax: 10, dailyCap: 6000 },
      { minPax: 11, maxPax: 20, dailyCap: 8000 },
      { minPax: 21, maxPax: 25, dailyCap: 10500 },
      { minPax: 26, maxPax: 35, dailyCap: 12000 },
      { minPax: 36, maxPax: 60, dailyCap: 14000 },
    ],
    effectiveFrom: "2026-01-01",
    sourceNote: SOURCE_NOTE,
  },
  {
    version: DEFAULT_POLICY_VERSION,
    deliveryMode: "PUBLIC_PHYSICAL",
    basis: "PER_PAX_DAY",
    bands: [{ minPax: 1, maxPax: 999, dailyCap: 1300 }],
    effectiveFrom: "2026-01-01",
    sourceNote: SOURCE_NOTE,
  },
  {
    version: DEFAULT_POLICY_VERSION,
    deliveryMode: "ROT_VIRTUAL",
    basis: "PER_GROUP_DAY",
    bands: [
      { minPax: 1, maxPax: 10, dailyCap: 4000 },
      { minPax: 11, maxPax: 25, dailyCap: 6000 },
      { minPax: 26, maxPax: 60, dailyCap: 8000 },
    ],
    effectiveFrom: "2026-01-01",
    sourceNote: SOURCE_NOTE,
  },
];

const bandSchema = z
  .object({
    minPax: z.number().int().min(1),
    maxPax: z.number().int().min(1),
    dailyCap: z.number().positive().max(1_000_000),
  })
  .strict()
  .refine((b) => b.maxPax >= b.minPax, { message: "maxPax must be >= minPax" })
  .refine((b) => Math.abs(b.dailyCap * 100 - Math.round(b.dailyCap * 100)) < 1e-6, {
    message: "dailyCap has at most two decimals",
  });

/**
 * Bands must start at 1 pax and be contiguous and non-overlapping: a gap is
 * a headcount the matrix silently cannot price, an overlap is two caps for one
 * headcount. Both are refused (R14) rather than resolved by "first match".
 */
export function validateBands(input: unknown): CostBand[] {
  const parsed = z.array(bandSchema).min(1).safeParse(input);
  if (!parsed.success) {
    throw new DomainError("INVALID_COST_BANDS", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const bands = [...parsed.data].sort((a, b) => a.minPax - b.minPax);
  if (bands[0].minPax !== 1) throw new DomainError("INVALID_COST_BANDS", "The first band must start at 1 participant");
  for (let i = 1; i < bands.length; i += 1) {
    if (bands[i].minPax !== bands[i - 1].maxPax + 1) {
      throw new DomainError(
        "INVALID_COST_BANDS",
        `Bands must be contiguous: ${bands[i - 1].minPax}–${bands[i - 1].maxPax} is followed by ${bands[i].minPax}–${bands[i].maxPax}`,
      );
    }
  }
  return bands;
}

function assertBasis(value: string): CostBasis {
  if (!(COST_BASES as readonly string[]).includes(value)) throw new Error(`Unknown cost basis: ${value}`);
  return value as CostBasis;
}

export function assertDeliveryMode(value: string): DeliveryMode {
  if (!(DELIVERY_MODES as readonly string[]).includes(value)) throw new DomainError("UNKNOWN_DELIVERY_MODE", `Unknown delivery mode: ${value}`);
  return value as DeliveryMode;
}

/** Idempotent: (version, delivery_mode) is unique, an existing row is left as the operator configured it. */
export async function seedCostPolicies(executor: Executor = db()): Promise<number> {
  let inserted = 0;
  for (const seed of DEFAULT_COST_POLICIES) {
    const rows = await executor
      .insert(schema.costMatrixPolicies)
      .values({
        version: seed.version,
        deliveryMode: seed.deliveryMode,
        basis: seed.basis,
        bands: seed.bands,
        effectiveFrom: seed.effectiveFrom,
        active: true,
        sourceNote: seed.sourceNote,
      })
      .onConflictDoNothing()
      .returning({ id: schema.costMatrixPolicies.id });
    inserted += rows.length;
  }
  return inserted;
}

/** The newest active policy for a delivery mode that is in effect on `onDate` (YYYY-MM-DD). */
export async function activePolicy(mode: string, onDate: string, executor: Executor = db()): Promise<CostPolicy> {
  const deliveryMode = assertDeliveryMode(mode);
  const [row] = await executor
    .select()
    .from(schema.costMatrixPolicies)
    .where(
      and(
        eq(schema.costMatrixPolicies.deliveryMode, deliveryMode),
        eq(schema.costMatrixPolicies.active, true),
        lte(schema.costMatrixPolicies.effectiveFrom, onDate),
      ),
    )
    .orderBy(desc(schema.costMatrixPolicies.effectiveFrom), desc(schema.costMatrixPolicies.createdAt))
    .limit(1);
  if (!row) {
    throw new DomainError("NO_ACTIVE_COST_POLICY", `No active Allowable Cost Matrix policy for ${deliveryMode} on ${onDate}`, {
      deliveryMode,
      onDate,
    });
  }
  assertBasis(row.basis);
  return row;
}

/** Daily cap in SEN for a headcount. No band covering `pax` is a refusal, never a nearest-band guess. */
export function dailyCapFor(policy: Pick<CostPolicy, "bands" | "version" | "deliveryMode">, pax: number): Sen {
  if (!Number.isInteger(pax) || pax < 1) {
    throw new DomainError("PAX_OUTSIDE_MATRIX", `Headcount must be a positive whole number (got ${pax})`);
  }
  const band = policy.bands.find((b) => pax >= b.minPax && pax <= b.maxPax);
  if (!band) {
    const max = Math.max(...policy.bands.map((b) => b.maxPax));
    throw new DomainError(
      "PAX_OUTSIDE_MATRIX",
      `${pax} participants is outside the ${policy.deliveryMode} bands of ${policy.version} (max ${max}); split the cohort`,
      { pax, version: policy.version, deliveryMode: policy.deliveryMode },
    );
  }
  return toSen(band.dailyCap);
}

/** PER_GROUP_DAY: cap × days. PER_PAX_DAY: cap × pax × days. All in sen. */
export function allowableCapSen(basis: CostBasis, dailyCap: Sen, pax: number, days: number): Sen {
  switch (basis) {
    case "PER_GROUP_DAY":
      return dailyCap * days;
    case "PER_PAX_DAY":
      return dailyCap * pax * days;
    default: {
      const unknown: never = basis;
      throw new Error(`Unknown cost basis: ${String(unknown)}`);
    }
  }
}

/** The pricing view of a policy: what `computeQuote` needs, with the cap already resolved for `pax`. */
export function policyTerms(policy: CostPolicy, pax: number): { version: string; basis: CostBasis; dailyCap: Sen } {
  return { version: policy.version, basis: assertBasis(policy.basis), dailyCap: dailyCapFor(policy, pax) };
}

export async function listPolicies(executor: Executor = db()): Promise<CostPolicy[]> {
  return executor
    .select()
    .from(schema.costMatrixPolicies)
    .orderBy(asc(schema.costMatrixPolicies.deliveryMode), desc(schema.costMatrixPolicies.effectiveFrom), desc(schema.costMatrixPolicies.version));
}

/**
 * Settings-screen edit. Only a named USER may change policy data; the old and
 * new bands land in the hash-chained ledger so a later dispute about which cap
 * applied can be answered from the record.
 */
export async function updatePolicyBands(id: string, bands: unknown, actor: Actor): Promise<CostPolicy> {
  if (actor.type !== "USER") throw new DomainError("USER_REQUIRED", "Only an operator can change the Allowable Cost Matrix");
  const next = validateBands(bands);
  return withTx(actor, { reasonCode: "COST_POLICY_UPDATED" }, async (tx) => {
    const [current] = await tx.select().from(schema.costMatrixPolicies).where(eq(schema.costMatrixPolicies.id, id)).for("update");
    if (!current) throw new DomainError("COST_POLICY_NOT_FOUND", `Cost policy ${id} not found`);
    const [updated] = await tx
      .update(schema.costMatrixPolicies)
      .set({ bands: next })
      .where(eq(schema.costMatrixPolicies.id, id))
      .returning();
    await recordAudit(tx, {
      entityType: "COST_POLICY",
      entityId: id,
      reasonCode: "COST_POLICY_UPDATED",
      details: `${current.version} ${current.deliveryMode} bands edited`,
      metadata: {
        version: current.version,
        delivery_mode: current.deliveryMode,
        bands: { old: current.bands, new: next },
      },
    });
    return updated;
  });
}
