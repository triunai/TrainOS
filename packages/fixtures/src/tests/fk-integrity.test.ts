/**
 * Referential integrity across the whole dataset.
 *
 * Walks every FK-shaped field in every seeded record — anything named `ref`,
 * `…Ref`, `…Refs`, `…Id` or `…Ids` — and asserts the thing it points at exists.
 * A dangling reference is what makes a fixture look real until someone clicks
 * it, so this is the test that keeps the demo honest.
 */

import { describe, expect, it } from "vitest";
import {
  DOCUMENT_CIRCULAR_04,
  DOCUMENT_CIRCULAR_09,
  HRDC_EMPLOYER_CODE,
  ORCHESTRATOR_PROPOSAL,
  RULE_SET_2026_06_15,
  RULE_SET_2027_01_01,
} from "@trainos/contract";
import * as data from "../data";

/**
 * Keys that look like references but are not.
 *
 * `evidenceRefs` holds questionnaire question ids (`Q4`, `Q7`) and
 * `signatureRef` holds an opaque signature blob id; neither addresses an
 * entity in this dataset.
 */
const NOT_A_REFERENCE = new Set(["evidenceRefs", "signatureRef"]);

const REFERENCE_KEY = /^refs?$|Refs?$|Ids?$/;

/** Every id and ref anything in the dataset is allowed to point at. */
const buildRegistry = (): Set<string> => {
  const registry = new Set<string>();
  const add = (...values: (string | null | undefined)[]): void => {
    for (const value of values) if (value) registry.add(value);
  };

  for (const user of data.users) add(user.id);
  for (const pipeline of data.pipelines) add(pipeline.object);
  for (const row of data.organisations) add(row.id, row.ref);
  for (const row of data.contacts) add(row.id, row.ref);
  for (const row of data.opportunities) add(row.id, row.ref);
  for (const row of data.enquiries) add(row.id, row.ref);
  for (const row of data.followUps) add(row.id, row.ref);
  for (const row of data.programmes) add(row.id, row.ref);
  for (const row of data.trainers) add(row.id, row.ref, row.tttRef);
  for (const row of data.tnas) add(row.id, row.ref);
  for (const row of data.proposals) add(row.id, row.ref);
  for (const row of data.quotations) add(row.id, row.ref);
  for (const row of data.approvals) add(row.id, row.ref);
  for (const row of data.policies) add(row.id);
  for (const row of data.engagements) {
    add(row.id, row.ref);
    for (const session of row.sessions) add(session.ref);
  }
  for (const row of data.participants) add(row.id, row.ref);
  for (const row of data.claimPackets) {
    add(row.id, row.engagementRef, row.grant?.reference);
    for (const document of row.requiredDocuments) add(document.ref);
  }
  for (const row of data.complianceRules) add(row.id, row.source.documentId);
  for (const row of data.ruleChangeSets) {
    add(row.documentId);
    for (const change of row.changes) add(change.id);
  }
  for (const row of data.invoices) add(row.id, row.ref);
  for (const row of data.agents) add(row.id);
  for (const row of data.runs) {
    add(row.id, row.ref);
    /** Trace node ids: `parentId` addresses a sibling inside the same run. */
    for (const node of row.nodes ?? []) add(node.id);
  }
  for (const row of data.modelTiers) add(row.key);
  for (const row of data.providerKeys) add(row.id);
  for (const row of data.budgets) add(`${row.scope}/${row.key}`);
  for (const row of data.knowledgeSources) add(row.id);
  for (const row of data.templates) add(row.id);
  for (const row of data.savedViews) add(row.id);

  /** References the pack names that are not rows in any collection. */
  add(
    DOCUMENT_CIRCULAR_04,
    DOCUMENT_CIRCULAR_09,
    RULE_SET_2026_06_15,
    RULE_SET_2027_01_01,
    HRDC_EMPLOYER_CODE,
    "HRDC-1908-4417",
    "HRDC-2102-6620",
    "HRDC-2204-1190",
    "HRDC-2007-3312",
    "HRDC-1806-9021",
    /** The catalogue wildcard the TNA cites as its source. */
    "PRG-*",
    /** Orchestrator and trace node names carried on run records. */
    ORCHESTRATOR_PROPOSAL,
  );

  return registry;
};

const registry = buildRegistry();

/** Composite refs like `ENG-0231/attendance` resolve to their base entity. */
const resolves = (value: string): boolean => {
  if (registry.has(value)) return true;
  const base = value.split("/")[0];
  return base !== undefined && base !== value && registry.has(base);
};

interface Dangling {
  path: string;
  value: string;
}

const walk = (node: unknown, path: string, found: Dangling[]): void => {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, found));
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (NOT_A_REFERENCE.has(key)) continue;
    const isReferenceKey = REFERENCE_KEY.test(key) || key === "recordPointers";
    if (isReferenceKey) {
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (typeof candidate !== "string" || candidate.length === 0) continue;
        if (!resolves(candidate)) found.push({ path: childPath, value: candidate });
      }
      if (!Array.isArray(value)) continue;
    }
    walk(value, childPath, found);
  }
};

describe("referential integrity", () => {
  it("resolves every reference-shaped field in the dataset", () => {
    const found: Dangling[] = [];
    for (const [name, collection] of Object.entries(data)) {
      if (typeof collection === "function" || typeof collection === "string") continue;
      walk(collection, name, found);
    }
    expect(found).toEqual([]);
  });

  it("registers the canonical fixture ids the contract publishes", () => {
    expect(resolves("ORG-0114")).toBe(true);
    expect(resolves("PRO-2026-0184")).toBe(true);
    expect(resolves("APV-2026-0771")).toBe(true);
    expect(resolves("ENG-0231")).toBe(true);
    expect(resolves("run_4821")).toBe(true);
  });

  it("rejects a reference nothing defines", () => {
    expect(resolves("ORG-9999")).toBe(false);
  });
});
