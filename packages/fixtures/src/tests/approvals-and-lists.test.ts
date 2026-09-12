/**
 * §7 approvals — decisions, the bulk guard and the diff-equals-effects rule —
 * and the §1 list grammar the pill tabs and tables depend on.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { APPROVAL_AURORA, PROPOSAL_AURORA, USER_KELVIN } from "@trainos/contract";
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
    const decision = await api.decideApproval(APPROVAL_AURORA, { decision: "APPROVE", note: null });

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
    await api.decideApproval(APPROVAL_AURORA, { decision: "APPROVE", note: null });
    const proposal = await api.getProposal(PROPOSAL_AURORA);
    expect(proposal.status).toBe("SENT");
    const opportunity = await api.getOpportunity("OPP-0512");
    expect(opportunity.stage).toBe("PROPOSAL_SENT");
  });

  it("requires a note to reject", async () => {
    await expect(
      api.decideApproval(APPROVAL_AURORA, { decision: "REJECT", note: null }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", http: 422 });
  });

  it("409s a second decision on an approval that already moved", async () => {
    await api.decideApproval(APPROVAL_AURORA, { decision: "APPROVE", note: null });
    await expect(
      api.decideApproval(APPROVAL_AURORA, { decision: "APPROVE", note: null }),
    ).rejects.toMatchObject({ http: 409, details: { diffChanged: true } });
  });

  it("drops the badge count as approvals are cleared", async () => {
    await api.decideApproval(APPROVAL_AURORA, { decision: "APPROVE", note: null });
    const badges = await api.getBadges();
    expect(badges.approvals).toBe(6);
  });
});

describe("bulk decisions", () => {
  it("approves rows that carry no money", async () => {
    const result = await api.bulkDecideApprovals({
      ids: [APPROVAL_RULE_CHANGE, APPROVAL_ATTENDANCE],
      decision: "APPROVE",
    });
    expect(result.results).toHaveLength(2);
    expect(result.results.every((row) => row.status === "APPROVED")).toBe(true);
  });

  it("409s as soon as one selected row carries a monetary value", async () => {
    await expect(
      api.bulkDecideApprovals({ ids: [APPROVAL_RULE_CHANGE, APPROVAL_AURORA], decision: "APPROVE" }),
    ).rejects.toMatchObject({ http: 409, details: { blockers: [APPROVAL_AURORA] } });
  });

  it("leaves every row untouched when the bulk is refused", async () => {
    await api
      .bulkDecideApprovals({ ids: [APPROVAL_RULE_CHANGE, APPROVAL_AURORA], decision: "APPROVE" })
      .catch(() => undefined);
    const ruleChange = await api.getApproval(APPROVAL_RULE_CHANGE);
    expect(ruleChange.status).toBe("PENDING");
  });

  it("writes the rule with the circular's effective date, not today's", async () => {
    await api.bulkDecideApprovals({ ids: [APPROVAL_RULE_CHANGE], decision: "APPROVE" });
    const rule = await api.getComplianceRule("HRD-022");
    expect(rule.status).toBe("ACTIVE");
    expect(rule.effectiveFrom).toBe("2027-01-01");
    const superseded = await api.getComplianceRule("HRD-015");
    expect(superseded.status).toBe("SUPERSEDED");
    expect(superseded.supersededById).toBe("HRD-022");
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
