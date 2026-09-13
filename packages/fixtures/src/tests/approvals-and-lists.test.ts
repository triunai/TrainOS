/**
 * §7 approvals — decisions, the bulk guard and the diff-equals-effects rule —
 * and the §1 list grammar the pill tabs and tables depend on.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { APPROVAL_AURORA, PROPOSAL_AURORA, USER_KELVIN, USER_SITI } from "@trainos/contract";
import { APPROVAL_ATTENDANCE, APPROVAL_RULE_CHANGE } from "../data/approvals";
import { createFixtureClient } from "../index";
import type { FixtureClient } from "../client/FixtureClient";

let api: FixtureClient;

beforeEach(() => {
  api = createFixtureClient({ latencyMs: 0, actorId: USER_KELVIN });
});

describe("the approval inbox", () => {
  it("groups seven pending approvals the way M02-S01 renders them", async () => {
    const inbox = await api.listApprovals({ page: { size: 50 } });
    expect(inbox.page.total).toBe(7);
    expect(inbox.groups).toEqual([
      { key: "BREACHING", count: 1 },
      { key: "TODAY", count: 4 },
      { key: "THIS_WEEK", count: 2 },
    ]);
    expect(inbox.summary?.medianDecisionSeconds).toBe(220);
  });

  it("carries an SLA-breached row that never blocks", async () => {
    const inbox = await api.listApprovals({ page: { size: 50 } });
    const breaching = inbox.data.filter((row) => row.slaBreached);
    expect(breaching).toHaveLength(1);
    expect(breaching[0]?.urgencyGroup).toBe("BREACHING");
    expect(breaching[0]?.status).toBe("PENDING");
  });

  it("marks every money-carrying row as not bulk-approvable", async () => {
    const inbox = await api.listApprovals({ page: { size: 50 } });
    for (const row of inbox.data) {
      expect(row.bulkApprovable).toBe(row.value === undefined);
    }
  });
});

describe("deciding one approval", () => {
  it("returns effects that match the rendered diff, line for line", async () => {
    const detail = await api.getApproval(APPROVAL_AURORA);
    const decision = await api.decideApproval(APPROVAL_AURORA, {
      decision: "APPROVE",
      note: null,
      diffHash: detail.diffHash,
    });

    expect(decision.status).toBe("APPROVED");
    expect(decision.effects).toHaveLength(detail.diff.length);
    decision.effects.forEach((effect, index) => {
      const line = detail.diff[index];
      expect(effect.op).toBe(line?.op);
      expect(effect.entity).toBe(line?.entity);
      expect(effect.ref).toBe(line?.ref);
      expect(effect.description).toBe(line?.description);
    });
  });

  it("applies what the diff promised", async () => {
    const detail = await api.getApproval(APPROVAL_AURORA);
    await api.decideApproval(APPROVAL_AURORA, {
      decision: "APPROVE",
      note: null,
      diffHash: detail.diffHash,
    });
    const proposal = await api.getProposal(PROPOSAL_AURORA);
    expect(proposal.status).toBe("SENT");
    const opportunity = await api.getOpportunity("OPP-0512");
    expect(opportunity.stage).toBe("PROPOSAL_SENT");
  });

  it("requires a note to reject", async () => {
    const detail = await api.getApproval(APPROVAL_AURORA);
    await expect(
      api.decideApproval(APPROVAL_AURORA, {
        decision: "REJECT",
        note: null,
        diffHash: detail.diffHash,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", http: 422 });
  });

  it("409s a second decision on an approval that already moved", async () => {
    const detail = await api.getApproval(APPROVAL_AURORA);
    await api.decideApproval(APPROVAL_AURORA, {
      decision: "APPROVE",
      note: null,
      diffHash: detail.diffHash,
    });
    await expect(
      api.decideApproval(APPROVAL_AURORA, {
        decision: "APPROVE",
        note: null,
        diffHash: detail.diffHash,
      }),
    ).rejects.toMatchObject({ http: 409, details: { diffChanged: true } });
  });

  /**
   * §7 finding #6 (docs/reviews/2026-09-13-codex-retrofit-014-017.md): the
   * fixture oracle must enforce the same optimistic-concurrency guard
   * `011:2781-2787` does, or the guard is provably dead as soon as the client
   * omits — or gets wrong — the hash it renders.
   */
  it("refuses to approve against a diff hash that no longer matches", async () => {
    await expect(
      api.decideApproval(APPROVAL_AURORA, {
        decision: "APPROVE",
        note: null,
        diffHash: "stale-hash",
      }),
    ).rejects.toMatchObject({ code: "DIFF_CHANGED", http: 409, details: { diffChanged: true } });
  });

  it("drops the badge count as approvals are cleared", async () => {
    const detail = await api.getApproval(APPROVAL_AURORA);
    await api.decideApproval(APPROVAL_AURORA, {
      decision: "APPROVE",
      note: null,
      diffHash: detail.diffHash,
    });
    const badges = await api.getBadges();
    expect(badges.approvals).toBe(6);
  });
});

describe("bulk decisions", () => {
  it("approves rows that carry no money", async () => {
    const ruleChange = await api.getApproval(APPROVAL_RULE_CHANGE);
    const attendance = await api.getApproval(APPROVAL_ATTENDANCE);
    const result = await api.bulkDecideApprovals({
      items: [
        { approvalId: APPROVAL_RULE_CHANGE, diffHash: ruleChange.diffHash },
        { approvalId: APPROVAL_ATTENDANCE, diffHash: attendance.diffHash },
      ],
      decision: "APPROVE",
    });
    expect(result.results).toHaveLength(2);
    expect(result.results.every((row) => row.status === "APPROVED")).toBe(true);
  });

  /**
   * 011:3558-3571 (11508ed): `BULK_NOT_PERMITTED`, with one `{id, ref, reason}`
   * per blocked row under `notBulkApprovable`. The fixture used to raise
   * `AGENT_PAUSED` with `blockers: [ref]`, a code and a field name the
   * database never sends.
   */
  it("409s as soon as one selected row carries a monetary value", async () => {
    const ruleChange = await api.getApproval(APPROVAL_RULE_CHANGE);
    const aurora = await api.getApproval(APPROVAL_AURORA);
    await expect(
      api.bulkDecideApprovals({
        items: [
          { approvalId: APPROVAL_RULE_CHANGE, diffHash: ruleChange.diffHash },
          { approvalId: APPROVAL_AURORA, diffHash: aurora.diffHash },
        ],
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject({
      code: "BULK_NOT_PERMITTED",
      http: 409,
      message: "one or more approvals may not be decided in bulk",
      details: {
        notBulkApprovable: [{ id: aurora.id, ref: APPROVAL_AURORA, reason: "MONETARY_VALUE" }],
      },
    });
  });

  it("leaves every row untouched when the bulk is refused", async () => {
    const ruleChange = await api.getApproval(APPROVAL_RULE_CHANGE);
    const aurora = await api.getApproval(APPROVAL_AURORA);
    await api
      .bulkDecideApprovals({
        items: [
          { approvalId: APPROVAL_RULE_CHANGE, diffHash: ruleChange.diffHash },
          { approvalId: APPROVAL_AURORA, diffHash: aurora.diffHash },
        ],
        decision: "APPROVE",
      })
      .catch(() => undefined);
    const after = await api.getApproval(APPROVAL_RULE_CHANGE);
    expect(after.status).toBe("PENDING");
  });

  it("writes the rule with the circular's effective date, not today's", async () => {
    const ruleChange = await api.getApproval(APPROVAL_RULE_CHANGE);
    await api.bulkDecideApprovals({
      items: [{ approvalId: APPROVAL_RULE_CHANGE, diffHash: ruleChange.diffHash }],
      decision: "APPROVE",
    });
    const rule = await api.getComplianceRule("HRD-022");
    expect(rule.status).toBe("ACTIVE");
    expect(rule.effectiveFrom).toBe("2027-01-01");
    const superseded = await api.getComplianceRule("HRD-015");
    expect(superseded.status).toBe("SUPERSEDED");
    expect(superseded.supersededById).toBe("HRD-022");
  });

  /**
   * 011:3462-3468 (11508ed): `app.bulk_decide` refuses an empty `p_items` as
   * its FIRST check. The fixture resolved `{results: []}`, so a bulk approve of
   * nothing reported success here and would be refused by the database.
   */
  it("refuses an empty batch the way the database does, before any other check", async () => {
    await expect(
      api.bulkDecideApprovals({ items: [], decision: "APPROVE" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      http: 422,
      message: "items must be a non-empty array",
      details: { reason: "INVALID_APPROVAL_IDS" },
    });
  });

  /**
   * 011:3474-3483 (11508ed): `app.bulk_decide` counts DISTINCT approval ids
   * against the array length and refuses a batch naming one approval twice,
   * AHEAD of the missing-hash check. The fixture applied the approval twice and
   * returned two results.
   */
  it("refuses a batch that names one approval twice, ahead of the missing-hash check", async () => {
    const ruleChange = await api.getApproval(APPROVAL_RULE_CHANGE);
    const refusal = {
      code: "VALIDATION_FAILED",
      http: 422,
      message: "items must be a non-empty set of distinct approvalId values",
      details: { reason: "INVALID_APPROVAL_IDS" },
    };
    await expect(
      api.bulkDecideApprovals({
        items: [
          { approvalId: APPROVAL_RULE_CHANGE, diffHash: ruleChange.diffHash },
          { approvalId: APPROVAL_RULE_CHANGE, diffHash: ruleChange.diffHash },
        ],
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject(refusal);
    /* A hashless duplicate still refuses as a duplicate: 011 checks ids first. */
    await expect(
      api.bulkDecideApprovals({
        items: [
          { approvalId: APPROVAL_RULE_CHANGE, diffHash: "" },
          { approvalId: APPROVAL_RULE_CHANGE, diffHash: ruleChange.diffHash },
        ],
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject(refusal);
    const after = await api.getApproval(APPROVAL_RULE_CHANGE);
    expect(after.status).toBe("PENDING");
  });

  /**
   * 011:3407-3479 (062e5e2): `core.bulk_decide_approvals` refuses an APPROVE
   * item with no hash BEFORE any item in the batch is applied — the fixture
   * oracle enforces the same order, or the guard is dead as soon as a caller
   * omits the hash on just one row of a batch.
   */
  it("refuses an APPROVE item with no diff hash, before applying any item in the batch", async () => {
    const attendance = await api.getApproval(APPROVAL_ATTENDANCE);
    await expect(
      api.bulkDecideApprovals({
        items: [
          { approvalId: APPROVAL_RULE_CHANGE, diffHash: "" },
          { approvalId: APPROVAL_ATTENDANCE, diffHash: attendance.diffHash },
        ],
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      http: 422,
      details: { missingFor: [APPROVAL_RULE_CHANGE] },
    });
    const after = await api.getApproval(APPROVAL_ATTENDANCE);
    expect(after.status).toBe("PENDING");
  });

  /**
   * §7 finding #6 (docs/reviews/2026-09-13-codex-retrofit-014-017.md), through
   * the bulk door: a repriced approval refuses `DIFF_CHANGED` here exactly as
   * `decideApproval` refuses it on the single path, and nothing in the batch
   * is applied.
   */
  it("refuses a stale diff hash through the bulk door, before applying any item", async () => {
    await expect(
      api.bulkDecideApprovals({
        items: [{ approvalId: APPROVAL_RULE_CHANGE, diffHash: "stale-hash" }],
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject({ code: "DIFF_CHANGED", http: 409, details: { diffChanged: true } });
    const after = await api.getApproval(APPROVAL_RULE_CHANGE);
    expect(after.status).toBe("PENDING");
  });
});

describe("the list grammar", () => {
  it("pages with an opaque cursor and reports the filtered total", async () => {
    const first = await api.listEnquiries({ page: { size: 5 }, sort: "-receivedAt" });
    expect(first.data).toHaveLength(5);
    expect(first.page.total).toBe(18);
    expect(first.page.next).not.toBeNull();

    const second = await api.listEnquiries({
      page: { size: 5, cursor: first.page.next ?? undefined },
      sort: "-receivedAt",
    });
    expect(second.data).toHaveLength(5);
    expect(second.data[0]?.ref).not.toBe(first.data[0]?.ref);

    const last = await api.listEnquiries({ page: { size: 20 }, sort: "-receivedAt" });
    expect(last.page.next).toBeNull();
    expect(last.data).toHaveLength(18);
  });

  it("supports every documented operator", async () => {
    const eq = await api.listEnquiries({ filter: [{ field: "channel", op: "eq", value: "WHATSAPP" }], page: { size: 50 } });
    expect(eq.data.every((row) => row.channel === "WHATSAPP")).toBe(true);

    const inList = await api.listEnquiries({
      filter: [{ field: "channel", op: "in", value: ["EMAIL", "WHATSAPP"] }],
      page: { size: 50 },
    });
    expect(inList.data.every((row) => row.channel === "EMAIL" || row.channel === "WHATSAPP")).toBe(true);

    const gte = await api.listEnquiries({
      filter: [{ field: "estimatedValue", op: "gte", value: 2000000 }],
      page: { size: 50 },
    });
    expect(gte.data.every((row) => (row.estimatedValue?.amount ?? 0) >= 2000000)).toBe(true);

    const contains = await api.listEnquiries({
      filter: [{ field: "subject", op: "contains", value: "leadership" }],
      page: { size: 50 },
    });
    expect(contains.data.length).toBeGreaterThan(0);

    const between = await api.listEnquiries({
      filter: [{ field: "receivedAt", op: "between", value: ["2026-11-09", "2026-11-13"] }],
      page: { size: 50 },
    });
    expect(between.data.length).toBeGreaterThan(0);

    const lte = await api.listEnquiries({
      filter: [{ field: "classification.provenance.confidence", op: "lte", value: 0.5 }],
      page: { size: 50 },
    });
    expect(lte.data).toHaveLength(1);
  });

  it("merges a saved view underneath the request, and the request wins", async () => {
    const viaView = await api.listEnquiries({ view: "view_whatsapp", page: { size: 50 } });
    expect(viaView.data.every((row) => row.channel === "WHATSAPP")).toBe(true);
    expect(viaView.appliedFilters?.some((clause) => clause.source === "VIEW")).toBe(true);

    const overridden = await api.listEnquiries({
      view: "view_whatsapp",
      filter: [{ field: "channel", op: "eq", value: "EMAIL" }],
      page: { size: 50 },
    });
    expect(overridden.data.every((row) => row.channel === "EMAIL")).toBe(true);
    expect(overridden.appliedFilters?.filter((clause) => clause.field === "channel")).toHaveLength(1);
  });

  it("sorts ascending and descending on a dotted path", async () => {
    const descending = await api.listEnquiries({ sort: "-receivedAt", page: { size: 50 } });
    const ascending = await api.listEnquiries({ sort: "receivedAt", page: { size: 50 } });
    expect(descending.data[0]?.ref).toBe(ascending.data.at(-1)?.ref);
  });
});

describe("the audit drawer", () => {
  it("returns the event trail behind the proposal", async () => {
    const audit = await api.getAudit("proposals", PROPOSAL_AURORA);
    expect(audit.data.length).toBeGreaterThan(0);
    expect(audit.data.some((entry) => entry.event === "ProposalDrafted")).toBe(true);
    expect(audit.data.some((entry) => entry.runId === "run_4821")).toBe(true);
  });
});

/**
 * §6 the three collections §13 never published.
 *
 * The nav tree has a leaf above each of these records, so the list has to
 * exist for the screen above it to be honest. These assert the two things a
 * screen depends on and a reviewer would otherwise have to remember: that the
 * list returns the same rows the record does, and that the quotation list is
 * gated exactly as the quotation record is.
 */
describe("the collections the contract left out", () => {
  it("lists every TNA the store holds, reachable by ref", async () => {
    const list = await api.listTnas({ page: { size: 50 } });
    expect(list.data.length).toBeGreaterThan(0);

    const first = list.data[0];
    await expect(api.getTna(first!.ref)).resolves.toMatchObject({ ref: first!.ref });
  });

  it("lists every proposal, and the list row equals the record", async () => {
    const list = await api.listProposals({ page: { size: 50 } });
    const row = list.data.find((proposal) => proposal.ref === PROPOSAL_AURORA);
    expect(row).toBeDefined();

    const record = await api.getProposal(PROPOSAL_AURORA);
    expect(row!.status).toBe(record.status);
    expect(row!.value).toEqual(record.value);
  });

  it("prices every quotation row, so a list can name the binding floor", async () => {
    const list = await api.listQuotations({ page: { size: 50 } });
    expect(list.data.length).toBeGreaterThan(0);

    for (const quotation of list.data) {
      expect(["ABSOLUTE", "MARGIN"]).toContain(quotation.bindingFloorBasis);
      expect(quotation.absoluteFloorPrice).toBeDefined();
      expect(quotation.marginFloorPrice).toBeDefined();
    }
  });

  it("refuses the quotation list to OPS, exactly as it refuses the record", async () => {
    const ops = createFixtureClient({ latencyMs: 0, actorId: USER_SITI });

    await expect(ops.listQuotations()).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { requiredRole: "SALES", requiredPermission: "quotation:read" },
    });
  });
});
