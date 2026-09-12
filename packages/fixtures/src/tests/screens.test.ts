/**
 * Every screen in the design-pack inventory §4 has a primary read, and that
 * read returns data.
 *
 * The table below is the screen-id column of that inventory. If a screen is
 * added to the pack and nothing here fails, the fixture is behind.
 */

import { describe, expect, it } from "vitest";
import { SCREEN_IDS } from "@trainos/contract";
import {
  APPROVAL_AURORA,
  DOCUMENT_CIRCULAR_09,
  ENGAGEMENT_AURORA,
  ENQUIRY_AURORA,
  INVOICE_AURORA,
  ORG_AURORA,
  PROGRAMME_LEADING_CHANGE,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  RUN_PROPOSAL,
  TNA_AURORA,
} from "@trainos/contract";
import { PORTAL_TOKEN_AURORA } from "../data/proposals";
import { createFixtureClient } from "../index";
import type { FixtureClient } from "../client/FixtureClient";

const api = createFixtureClient({ latencyMs: 0 });

/** A screen's primary read, and how many rows or keys make it non-empty. */
const screenReads: Record<string, (client: FixtureClient) => Promise<unknown>> = {
  "M01-S01": (client) => client.getExecutiveDashboard("2026-11"),
  "M02-S01": (client) => client.listApprovals(),
  "M02-S02": (client) => client.getApproval(APPROVAL_AURORA),
  "M03-S01": (client) => client.listEnquiries(),
  "M03-S02": (client) => client.getEnquiry(ENQUIRY_AURORA),
  "M03-S06": (client) => client.listFollowUps(),
  "M04-S02": (client) => client.getOrganisation(ORG_AURORA),
  "M05-S02": (client) => client.getTna(TNA_AURORA),
  "M06-S02": (client) => client.getProgramme(PROGRAMME_LEADING_CHANGE),
  "M07-S02": (client) => client.getProposal(PROPOSAL_AURORA),
  "M07-S03": (client) => client.getQuotation(QUOTATION_AURORA),
  "M07-S07": (client) => client.getPortalProposal(PORTAL_TOKEN_AURORA),
  "M09-S02": (client) => client.getEngagement(ENGAGEMENT_AURORA),
  "M10-S06": (client) => client.getAttendance(ENGAGEMENT_AURORA, 1),
  "M12-S02": (client) => client.getClaimPacket(ENGAGEMENT_AURORA),
  "M12-S07": (client) => client.listComplianceRules(),
  "M12-S08": (client) => client.getRuleChangeSet(DOCUMENT_CIRCULAR_09),
  "M13-S02": (client) => client.getInvoice(INVOICE_AURORA),
  "M13-S05": (client) => client.getCollectionsQueue(),
  "M16-S05": (client) => client.listKnowledgeSources(),
  "M18-S01": (client) => client.listAgents(),
  "M18-S04": (client) => client.getRun(RUN_PROPOSAL),
  "M20-S16": (client) => client.getUsage("2026-11", "TIER"),
  "M20-S20": (client) => client.getAiTiers(),
  "M20-S21": (client) => client.listProviders(),
};

/** §13 — the demo script is a static document and calls no endpoint. */
const SCREENS_WITHOUT_ENDPOINTS = new Set(["M22-S04"]);

const isNonEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data.length > 0;
    return Object.keys(record).length > 0;
  }
  return true;
};

describe("screen coverage", () => {
  it("covers every screen the contract's matrix names", () => {
    const covered = new Set([...Object.keys(screenReads), ...SCREENS_WITHOUT_ENDPOINTS]);
    const missing = SCREEN_IDS.filter((screenId) => !covered.has(screenId));
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(screenReads))("%s primary read returns data", async (screenId) => {
    const read = screenReads[screenId];
    expect(read).toBeDefined();
    const result = await read!(api);
    expect(isNonEmpty(result)).toBe(true);
  });

  it("returns the secondary reads M04-S02 and M05-S02 also render", async () => {
    const relations = await api.getOrganisationRelations(ORG_AURORA);
    expect(relations.engagements?.length).toBeGreaterThan(0);
    expect(relations.contacts?.length).toBeGreaterThan(0);
    expect(relations.hrdc?.packets.length).toBeGreaterThan(0);

    const suggestions = await api.getOrganisationSuggestions(ORG_AURORA);
    expect(suggestions.data.length).toBeGreaterThan(0);

    const recommendations = await api.getTnaRecommendations(TNA_AURORA);
    expect(recommendations.data.length).toBe(3);
    expect(recommendations.data.at(-1)?.fitScore).toBe(0.22);
  });

  it("renders the states the pack names on the screens that own them", async () => {
    const enquiries = await api.listEnquiries({ page: { size: 50 } });
    expect(enquiries.data.some((row) => row.classification.needsHumanReview)).toBe(true);
    expect(enquiries.data.some((row) => row.status === "ARCHIVED")).toBe(true);

    const proposal = await api.getProposal(PROPOSAL_AURORA);
    expect(proposal.sections.some((section) => section.needsReview)).toBe(true);
    expect(proposal.warnings?.[0]?.code).toBe("LOW_CONFIDENCE_SECTION");

    const packet = await api.getClaimPacket(ENGAGEMENT_AURORA);
    expect(packet.requiredDocuments.filter((doc) => doc.status === "MISSING")).toHaveLength(2);

    const engagement = await api.getEngagement(ENGAGEMENT_AURORA);
    expect(engagement.lifecycle.find((step) => step.key === "HRDC_CLAIM")?.state).toBe("BLOCKED");

    const invoice = await api.getInvoice(INVOICE_AURORA);
    expect(invoice.syncLog.some((entry) => entry.state === "ERROR")).toBe(true);
    expect(invoice.payments).toEqual([]);

    const runs = await api.listRuns({ page: { size: 50 } });
    expect(runs.data.some((run) => run.failure?.deadLettered === true)).toBe(true);
    expect(runs.data.some((run) => run.steps?.some((step) => step.status === "RETRIED"))).toBe(true);

    const tiers = await api.getAiTiers();
    expect(tiers.data.some((tier) => tier.status === "DEGRADED")).toBe(true);
    expect(tiers.data.some((tier) => tier.status === "PAUSED_BY_CAP")).toBe(true);

    const providers = await api.listProviders();
    expect(providers.data.some((key) => key.status === "INVALID")).toBe(true);
    expect(providers.data.some((key) => key.status === "EXPIRING")).toBe(true);
    expect(providers.data.some((key) => key.status === "NOT_SET")).toBe(true);

    const sources = await api.listKnowledgeSources();
    expect(sources.data.some((source) => source.monitorStatus === "CHANGED_REVIEW_PENDING")).toBe(true);
    expect(sources.data.some((source) => source.embeddingStatus === "PENDING")).toBe(true);
    expect(sources.data.some((source) => source.monitorStatus === "FAILED")).toBe(true);

    const agents = await api.listAgents();
    expect(agents.data.some((agent) => agent.status === "PAUSED" && agent.pausedReason === "EVAL_REGRESSION")).toBe(true);

    const rules = await api.listComplianceRules();
    expect(rules.data.some((rule) => rule.status === "SUPERSEDED")).toBe(true);
    expect(rules.data.some((rule) => rule.status === "PROPOSED" && rule.verifiedBy === null)).toBe(true);

    const drift = await api.getComplianceChecks("ENG-0244");
    expect(drift.versionDrift).toHaveLength(1);
    expect(drift.versionDrift[0]?.appliedVersion).not.toBe(drift.versionDrift[0]?.currentVersion);

    const queue = await api.getCollectionsQueue();
    expect(queue.data.some((row) => row.daysOverdue === 48 && row.nextAction.autonomy === "OBSERVE")).toBe(true);
  });

  it("labels hours saved as illustrative rather than measured", async () => {
    const report = await api.getHoursSaved();
    expect(report.basis).toBe("ILLUSTRATIVE");
    expect(report.haircut).toBe(0.7);
    expect(report.actionTypes.length).toBeGreaterThan(0);
  });

  it("marks the rate card as a placeholder so nobody quotes from it", async () => {
    const rateCard = await api.getRateCard();
    expect(rateCard.version).toBe("v0-placeholder");
  });
});

/**
 * The run-trace shape M18-S04 can rely on.
 *
 * The agent runtime emits its own `run_4821`, and since it now resumes across
 * workers the node count and event list are a function of how the run was
 * sliced. So these assert what is stable about a trace — the id, a single
 * root, every parent resolving inside the run, and the APV-01 halt — and
 * deliberately never assert how many nodes there are.
 */
describe("run trace shape", () => {
  it("has one root and resolves every parent inside the run", async () => {
    const run = await api.getRun(RUN_PROPOSAL);
    const nodes = run.nodes ?? [];
    expect(nodes.length).toBeGreaterThan(0);

    const roots = nodes.filter((node) => node.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.kind).toBe("ORCHESTRATOR");

    const ids = new Set(nodes.map((node) => node.id));
    for (const node of nodes) {
      if (node.parentId === null) continue;
      expect(ids.has(node.parentId)).toBe(true);
    }
  });

  it("proves the agent never sent anything, by naming what halted it", async () => {
    const run = await api.getRun(RUN_PROPOSAL);
    expect(run.status).toBe("HALTED");
    expect(run.outcome).toBe("QUEUED_FOR_APPROVAL");

    const halted = (run.nodes ?? []).find((node) => node.status === "HALTED");
    expect(halted?.haltedBy?.policyId).toBe("APV-01");
    expect(halted?.haltedBy?.approvalRequestRef).toBe(APPROVAL_AURORA);

    /** The halt is on the event log too, so the trace and the log agree. */
    expect((run.events ?? []).some((event) => event.type === "POLICY_HALT")).toBe(true);
  });

  it("carries a state card a checkpoint retry could resume from", async () => {
    const run = await api.getRun(RUN_PROPOSAL);
    expect(run.stateCard?.goal).toBeTruthy();
    expect(run.stateCard?.plan.length).toBeGreaterThan(0);
    expect(run.stateCard?.budgets.tokens.used).toBeLessThan(run.stateCard?.budgets.tokens.limit ?? 0);

    const resumed = await api.retryRun(RUN_PROPOSAL, "checkpoint");
    expect(resumed.id).not.toBe(RUN_PROPOSAL);
    expect(resumed.outcome).toBe("RESUMED_FROM_CHECKPOINT");
  });
});
