/**
 * Fixture id → database UUID.
 *
 * The fixture world keys everything by opaque strings (`ent_eng_0259`,
 * `org_aurora`, `u_lim`) because the API contract keeps `id` opaque. The
 * schema keys everything by `uuid`. This module is the one place that bridges
 * them, and it is deterministic: the same fixture id always produces the same
 * UUID, so the emitted seed is stable across regenerations and a reviewer
 * diffing two emissions sees only real changes.
 *
 * Two kinds of id come out of here.
 *
 * **Anchors** are hand-picked and memorable, in the shape
 * `acade111-<domain>-4000-8000-<ordinal>`: the tenant slug's first letters, a
 * four-digit domain number, a version-4 nibble, and a counter. They are the ids
 * a test, a screenshot or a bug report will quote, so they are written out here
 * in full rather than derived. `supabase/seeds/fixture_world.sql`'s header
 * lists them.
 *
 * **Derived** ids are UUIDv5 over the fixture id with the namespace below. They
 * carry a version-5 nibble, so an id's provenance is visible at a glance: a `4`
 * in the third group is an anchor somebody chose, a `5` is a bulk row.
 */

import { createHash } from "node:crypto";

/**
 * The UUIDv5 namespace. Chosen once, never changed: changing it re-keys every
 * derived row in the seed and orphans anything that referenced an old id.
 */
export const NAMESPACE = "6ee0a1de-0000-4000-8000-7421a1d05eed";

const hexToBytes = (hex: string): Buffer => Buffer.from(hex.replace(/-/g, ""), "hex");

const formatUuid = (bytes: Buffer): string => {
  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

/** RFC 4122 §4.3 name-based UUID, SHA-1 flavour. */
const uuidV5 = (name: string, namespace: string): string => {
  const hash = createHash("sha1").update(hexToBytes(namespace)).update(Buffer.from(name, "utf8")).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC variant
  return formatUuid(bytes);
};

const anchor = (domain: number, ordinal: number): string =>
  `acade111-${String(domain).padStart(4, "0")}-4000-8000-${String(ordinal).padStart(12, "0")}`;

/**
 * The ids a human will quote. Domain numbers:
 * 0000 tenancy · 0001 people · 0002 parties · 0003 catalogue · 0004 sales ·
 * 0005 delivery · 0006 compliance · 0007 finance · 0008 ai-ops.
 */
export const ANCHORS: Readonly<Record<string, string>> = {
  // 0000 — the tenant itself.
  tnt_akademi_perdana: anchor(0, 1),

  // 0001 — the seven principals. Alex Selvarajah is `/me` and therefore first.
  u_lim: anchor(1, 1), // Alex Selvarajah, MD
  u_amirah: anchor(1, 2), // Amirah Yusof, SALES
  u_kelvin: anchor(1, 3), // Kelvin Tan, SALES_MANAGER
  u_siti: anchor(1, 4), // Siti Nordin, OPS
  u_jason: anchor(1, 5), // Jason Lee, FINANCE
  u_khairul: anchor(1, 6), // Khairul Anwar, ADMIN
  t_farah: anchor(1, 7), // Farah Aziz, TRAINER

  // 0002 — the six client organisations, in ref order.
  org_aurora: anchor(2, 114), // ORG-0114 Aurora Manufacturing — the in-flight deal
  org_aurora_precision: anchor(2, 115), // ORG-0115 Aurora Precision Tooling
  org_kenanga: anchor(2, 121), // ORG-0121 Kenanga Retail Group
  org_meridian: anchor(2, 128), // ORG-0128 Meridian Logistics
  org_sutera: anchor(2, 133), // ORG-0133 Sutera Hospitality
  org_perdana_utilities: anchor(2, 140), // ORG-0140 Perdana Utilities

  // 0005 — the engagement every reviewer opens first.
  ent_eng_0259: anchor(5, 259), // ENG-0259, PROPOSED, pending approval
};

const cache = new Map<string, string>();

/**
 * The UUID for a fixture key.
 *
 * `key` is the fixture's own opaque id wherever one exists. Child rows that the
 * fixture world does not give an id (a quotation line, an attendance entry)
 * pass a composed key — see `childKey`.
 */
export const uuidFor = (key: string): string => {
  const hit = cache.get(key);
  if (hit) return hit;
  if (!key) throw new Error("uuidFor called with an empty key");
  const value = ANCHORS[key] ?? uuidV5(key, NAMESPACE);
  cache.set(key, value);
  return value;
};

/**
 * The agreed cross-lane derivation for pipeline configuration ids.
 *
 * `md5(tenant_id::text || name)::uuid`, which is what the 018 lane's stage seed
 * computes in SQL, so both packs produce the same id for the same row and either
 * may write it. Ruled by the lead 2026-09-13.
 *
 * The ruling as first written was `uuid_generate_v5(tenant_id, 'pipeline:' ||
 * stage_key)` with md5 as a fallback where `uuid-ossp` is absent. Two things
 * about that had to change, and both were measured rather than reasoned:
 *
 * 1. **The two forms are different ids.** A rule that picks one per database
 *    produces one set of ids on the shim and a different set on the hosted
 *    project, which is the exact failure the determinism is for. `uuid-ossp` is
 *    not installed by 001-017 — 001 installs pgcrypto, citext, btree_gist,
 *    pg_trgm, pg_cron, pg_net and vector — so md5 is the form that actually runs
 *    everywhere, and it is now the form, not the fallback.
 * 2. **`'pipeline:' || stage_key` collides.** `WON` is a stage of BOTH the
 *    ENGAGEMENT pipeline (position 1) and the OPPORTUNITY pipeline (position 6).
 *    `core.pipeline_steps` allows that — its uniqueness is
 *    `(tenant_id, pipeline_id, step_key)` — so the two rows are legitimate and
 *    the shared id is a primary key violation on the second insert. The name
 *    therefore carries the pipeline object as well.
 *
 * Note that this is a bare md5, not a UUIDv5: no version or variant nibble is
 * set, because `md5(...)::uuid` in Postgres sets none either and the two sides
 * must agree byte for byte.
 */
export const pipelineUuid = (name: string): string =>
  formatUuid(createHash("md5").update(`${TENANT_UUID}${name}`, "utf8").digest());

/** The name half of `pipelineUuid` for a pipeline row and for one of its steps. */
export const pipelineName = (object: string): string => `pipeline:${object}`;
export const pipelineStepName = (object: string, stepKey: string): string =>
  `pipeline:${object}:${stepKey}`;

/** A stable key for a row the fixture world identifies only by position. */
export const childKey = (parent: string, kind: string, discriminator: string | number): string =>
  `${parent}::${kind}::${discriminator}`;

/** The tenant UUID, needed by every row in the seed. */
export const TENANT_UUID = uuidFor("tnt_akademi_perdana");

/**
 * A stable id for a fixture that is identified only by its business reference.
 * Refs are unique per tenant and immutable after insert, which makes them a
 * sound derivation key where a fixture record carries no opaque id.
 */
export const uuidForRef = (ref: string): string => uuidFor(`ref:${ref}`);
