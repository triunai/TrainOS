/**
 * Business reference → database UUID.
 *
 * The fixture world points at things by `ref` far more often than by id: a
 * contact names `ORG-0114`, a certificate names `ENG-0231`, an invoice line
 * names `PRG-0022`. Every one of those has to resolve to the SAME uuid the
 * owning row was inserted with, and the owning row is keyed by its fixture id
 * (`org_aurora`), not its ref.
 *
 * So the map is built once, here, from the fixture collections themselves, and
 * every slice resolves through it. A ref with no entry is a fixture pointing at
 * something that does not exist, which is a fixture bug worth failing on rather
 * than papering over with a derived id that nothing else will ever produce.
 */

import * as fx from "../../src/data/index.ts";
import { uuidFor } from "./ids.ts";

const index = new Map<string, string>();

const register = (ref: string | undefined | null, key: string): void => {
  if (!ref) return;
  const existing = index.get(ref);
  if (existing && existing !== key) {
    throw new Error(`ref ${ref} maps to two fixture keys: ${existing} and ${key}`);
  }
  index.set(ref, key);
};

const registerAll = (rows: readonly { id?: string; ref?: string }[]): void => {
  for (const row of rows) if (row.ref && row.id) register(row.ref, row.id);
};

registerAll(fx.organisations as never);
registerAll(fx.contacts as never);
registerAll(fx.trainers as never);
registerAll(fx.programmes as never);
registerAll(fx.enquiries as never);
registerAll(fx.opportunities as never);
registerAll(fx.tnas as never);
registerAll(fx.proposals as never);
registerAll(fx.quotations as never);
registerAll(fx.engagements as never);
registerAll(fx.participants as never);
registerAll(fx.invoices as never);
registerAll(fx.followUps as never);
registerAll(fx.agents as never);
registerAll(fx.knowledgeSources as never);
registerAll(fx.templates as never);
registerAll(fx.savedViews as never);
registerAll(fx.claimPackets as never);
registerAll(fx.runs as never);
registerAll(fx.approvals as never);

/** The fixture key a ref belongs to, or undefined if nothing owns it. */
export const keyForRef = (ref: string): string | undefined => index.get(ref);

/**
 * The uuid a ref resolves to.
 *
 * Throws on an unknown ref: silently deriving one produces an id that points at
 * no row, and a foreign key violation three slices later is a much worse way to
 * find out.
 */
export const refUuid = (ref: string): string => {
  const key = index.get(ref);
  if (!key) throw new Error(`no fixture owns ref ${ref}`);
  return uuidFor(key);
};

/** `refUuid`, but NULL-tolerant for optional pointers. */
export const refUuidOrNull = (ref: string | null | undefined): string | null =>
  ref ? refUuid(ref) : null;

/** Every ref the fixture world owns, for diagnostics. */
export const allRefs = (): readonly string[] => [...index.keys()].sort();
