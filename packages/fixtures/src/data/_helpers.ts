/**
 * Shared helpers for the fixture dataset.
 *
 * Nothing here invents contract semantics: `myr` is the §1 money constructor,
 * `roundHalfUpSen` is the §18 rounding rule, and `entity` stamps the §1 entity
 * envelope so every seeded record carries `id · ref · createdAt · updatedAt ·
 * createdBy` without each file restating it.
 */

import type { Actor, EntityEnvelope, Money, Timestamp } from "@trainos/contract";

/** §1 money — integer sen, currency always MYR. */
export const myr = (amount: number): Money => ({ amount, currency: "MYR" });

/** §18 — each line is `unitPrice × qty` rounded half-up to the sen. */
export const roundHalfUpSen = (value: number): number => Math.floor(value + 0.5);

/** §18 — the rounded line total for a unit price and quantity. */
export const lineTotal = (unit: Money, qty: number): Money =>
  myr(roundHalfUpSen(unit.amount * qty));

/** §18 — totals sum the **rounded** lines, never the unrounded products. */
export const sumMoney = (values: readonly Money[]): Money =>
  myr(values.reduce((total, value) => total + value.amount, 0));

/**
 * Opaque entity id. The contract keeps `id` (opaque) and `ref` (business
 * reference) separate, so fixtures derive a stable opaque id from the ref
 * rather than reusing it.
 */
export const idFor = (ref: string): string => `ent_${ref.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

/** The system actor behind ingest and scheduled work (§1). */
export const SYSTEM_ACTOR: Actor = { id: "ingest_email", name: "Email ingest", kind: "SYSTEM" };

/** The scheduler actor behind assembled packets and monitors. */
export const SCHEDULER_ACTOR: Actor = { id: "sys_scheduler", name: "Scheduler", kind: "SYSTEM" };

/** §1 the entity envelope, filled from a ref plus the two timestamps. */
export const entity = (
  ref: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  createdBy: Actor,
): EntityEnvelope => ({ id: idFor(ref), ref, createdAt, updatedAt, createdBy });

/** The tenant every fixture belongs to (§1 — implicit from auth, never in a path). */
export const TENANT_ID = "tnt_akademi_perdana";

/**
 * The demo clock. Every relative statement in the pack ("3 days remaining",
 * "34 days overdue") is computed against this instant, so screens do not drift
 * as real time passes.
 */
export const NOW: Timestamp = "2026-11-14T10:32:00+08:00";
