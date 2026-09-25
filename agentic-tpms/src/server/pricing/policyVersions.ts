import { eq, sql } from "drizzle-orm";
import { todayMY } from "@/lib/dates";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Executor, db, one, rows, schema, withTx } from "../db/client";
import { DELIVERY_MODES, type DeliveryMode } from "../domain/stages";
import { DomainError } from "../domain/errors";
import { type CostPolicy, updatePolicyBands, validateBands } from "./costMatrix";

/**
 * The Allowable Cost Matrix screen (UI-2): policy versions with how many
 * quotations were priced under each, and publishing a revised version.
 *
 * WHY a new version rather than an in-place edit: a quotation records the
 * policy VERSION and daily cap it was priced under, and Gate 1 compares that
 * against `activePolicy(mode, startDate)`. Rewriting the bands of a version
 * that quotations already cite changes what that version label meant after
 * the fact. Publishing a new row (same mode and basis, a new label, an
 * effective date) keeps every past version as it was: `activePolicy` picks
 * the newest active version in force on a date, so the new one supersedes
 * from its effective date and an older date still resolves to the older one.
 * `updatePolicyBands` stays the tool for correcting a version nothing cites.
 */
export interface PolicyVersionRow extends CostPolicy {
  /** Quotations priced under this version for this delivery mode. */
  quotations: number;
  /** The version `activePolicy(mode, onDate)` resolves to. */
  inForce: boolean;
  /** Active, but its effective date is still ahead. */
  scheduled: boolean;
  /** A newer active version of the same mode is in force (or scheduled) after this one. */
  supersededBy: string | null;
}

export async function listPolicyVersions(onDate: string = todayMY(), executor: Executor = db()): Promise<PolicyVersionRow[]> {
  const policies = await executor
    .select()
    .from(schema.costMatrixPolicies)
    .orderBy(schema.costMatrixPolicies.deliveryMode, sql`${schema.costMatrixPolicies.effectiveFrom} desc`, sql`${schema.costMatrixPolicies.createdAt} desc`);
  const usage = await rows<{ version: string; mode: string; n: number }>(
    executor,
    sql`select q.cost_policy_version as version, coalesce(q.inputs ->> 'deliveryMode', p.delivery_mode) as mode, count(*)::int as n
          from tpms.quotations q
          join tpms.training_packages p on p.id = q.package_id
         group by 1, 2`,
  );
  const used = new Map(usage.map((u) => [`${u.mode}|${u.version}`, u.n]));

  // Same ordering as activePolicy: newest effective date, then newest row.
  const byRecency = (a: CostPolicy, b: CostPolicy) =>
    a.effectiveFrom === b.effectiveFrom ? (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0) : a.effectiveFrom < b.effectiveFrom ? 1 : -1;
  const inForce = new Map<string, string>();
  for (const mode of DELIVERY_MODES) {
    const candidate = policies.filter((p) => p.deliveryMode === mode && p.active && p.effectiveFrom <= onDate).sort(byRecency)[0];
    if (candidate) inForce.set(mode, candidate.id);
  }
  return policies.map((p) => {
    const newer = policies
      .filter((o) => o.deliveryMode === p.deliveryMode && o.active && o.id !== p.id && byRecency(o, p) < 0)
      .sort(byRecency)
      .at(-1);
    return {
      ...p,
      quotations: used.get(`${p.deliveryMode}|${p.version}`) ?? 0,
      inForce: inForce.get(p.deliveryMode) === p.id,
      scheduled: p.active && p.effectiveFrom > onDate,
      supersededBy: newer?.version ?? null,
    };
  });
}

const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface PublishPolicyInput {
  version: string;
  effectiveFrom: string;
  bands: unknown;
  sourceNote?: string;
}

/**
 * Publish a revised version of one delivery mode's policy. Same mode and
 * basis as `fromId`; a new version label that mode has not used; an
 * effective date no earlier than the version it revises (a revision moves
 * forward — back-dating would change which cap applied on dates already
 * priced). Only a named USER may publish; the ledger records the source
 * version and both sets of bands.
 */
export async function publishPolicyVersion(fromId: string, input: PublishPolicyInput, actor: Actor): Promise<CostPolicy> {
  if (actor.type !== "USER") throw new DomainError("USER_REQUIRED", "Only an operator can change the Allowable Cost Matrix");
  const version = (input.version ?? "").trim();
  if (!VERSION.test(version)) {
    throw new DomainError("INVALID_POLICY_VERSION", "A version label is 2–32 letters, digits, dots, dashes or underscores (e.g. ACM-2026.2)");
  }
  const effectiveFrom = (input.effectiveFrom ?? "").trim();
  if (!ISO_DATE.test(effectiveFrom) || !new Date(`${effectiveFrom}T00:00:00Z`).toISOString().startsWith(effectiveFrom)) {
    throw new DomainError("INVALID_EFFECTIVE_DATE", "The effective date is a calendar date, YYYY-MM-DD");
  }
  const bands = validateBands(input.bands);

  return withTx(actor, { reasonCode: "COST_POLICY_PUBLISHED" }, async (tx) => {
    const [source] = await tx.select().from(schema.costMatrixPolicies).where(eq(schema.costMatrixPolicies.id, fromId)).for("update");
    if (!source) throw new DomainError("COST_POLICY_NOT_FOUND", `Cost policy ${fromId} not found`);
    const mode = source.deliveryMode as DeliveryMode;
    const clash = await one<{ id: string }>(
      tx,
      sql`select id from tpms.cost_matrix_policies where delivery_mode = ${mode} and lower(version) = lower(${version})`,
    );
    if (clash) throw new DomainError("COST_POLICY_VERSION_EXISTS", `${mode} already has a version ${version}; choose a new label`);
    if (effectiveFrom < source.effectiveFrom) {
      throw new DomainError(
        "COST_POLICY_BACKDATED",
        `A revision of ${source.version} cannot take effect before it (${source.effectiveFrom}); pick ${source.effectiveFrom} or later`,
      );
    }
    const [created] = await tx
      .insert(schema.costMatrixPolicies)
      .values({
        version,
        deliveryMode: mode,
        basis: source.basis,
        bands,
        effectiveFrom,
        active: true,
        sourceNote: input.sourceNote?.trim() || `Revision of ${source.version}. ${source.sourceNote}`,
      })
      .returning();
    await recordAudit(tx, {
      entityType: "COST_POLICY",
      entityId: created.id,
      reasonCode: "COST_POLICY_PUBLISHED",
      details: `${version} ${mode} published, effective ${effectiveFrom} (revises ${source.version})`,
      metadata: {
        version,
        delivery_mode: mode,
        basis: source.basis,
        effective_from: effectiveFrom,
        supersedes: { id: source.id, version: source.version, effective_from: source.effectiveFrom },
        bands: { old: source.bands, new: bands },
      },
    });
    return created;
  });
}

/**
 * Correct a version's bands in place — only while no quotation cites it (a
 * typo in a version just published, before anything was priced under it).
 * Once a quotation was priced under a version, a change is a new version.
 */
export async function correctPolicyBands(id: string, bands: unknown, actor: Actor): Promise<CostPolicy> {
  if (actor.type !== "USER") throw new DomainError("USER_REQUIRED", "Only an operator can change the Allowable Cost Matrix");
  const row = (await listPolicyVersions()).find((p) => p.id === id);
  if (!row) throw new DomainError("COST_POLICY_NOT_FOUND", `Cost policy ${id} not found`);
  if (row.quotations > 0) {
    throw new DomainError(
      "COST_POLICY_IN_USE",
      `${row.quotations} quotation${row.quotations === 1 ? " was" : "s were"} priced under ${row.version}; publish a new version instead of rewriting it`,
      { quotations: row.quotations, version: row.version },
    );
  }
  return updatePolicyBands(id, bands, actor);
}
