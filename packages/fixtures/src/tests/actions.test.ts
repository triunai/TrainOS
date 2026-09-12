/**
 * §3 · The action envelope.
 *
 * One test per documented outcome, plus the idempotency semantics and the
 * §14 events a state change is supposed to write.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ActionRequest } from "@trainos/contract";
import {
  AGENT_FOLLOWUP,
  AGENT_PROPOSAL,
  APPROVAL_AURORA,
  ENQUIRY_AURORA,
  FOLLOW_UP_AURORA,
  ORG_AURORA,
  PROPOSAL_AURORA,
  TEMPLATE_EMAIL_PROPOSAL,
  TEMPLATE_FOLLOWUP_WHATSAPP,
  USER_AMIRAH,
  USER_JASON,
} from "@trainos/contract";
import { ORG_SUTERA } from "../data/organisations";
import { PROPOSAL_MERIDIAN } from "../data/proposals";
import { createFixtureClient } from "../index";
import { ContractError } from "../client/errors";
import type { FixtureClient } from "../client/FixtureClient";

let api: FixtureClient;

beforeEach(() => {
  api = createFixtureClient({ latencyMs: 0 });
});

const humanSend = (): ActionRequest => ({
  type: "PROPOSAL_SEND",
  targetRef: PROPOSAL_AURORA,
  payload: {
    channel: "EMAIL",
    templateId: TEMPLATE_EMAIL_PROPOSAL,
    to: ["nurul.hassan@auroramfg.com.my"],
    attachPdf: true,
    value: { amount: 1850000, currency: "MYR" },
  },
  requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
});

describe("EXECUTED", () => {
  it("converts an enquiry without a policy gate and returns the effects", async () => {
    const response = await api.performAction({
      type: "OPPORTUNITY_CONVERT",
      targetRef: ENQUIRY_AURORA,
      payload: {
        value: { amount: 1850000, currency: "MYR" },
        questionnaireTemplateId: "tpl_tna_std_v3",
        programmeId: "PRG-0031",
      },
      requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
    });

    expect(response.status).toBe("EXECUTED");
    if (response.status !== "EXECUTED") return;
    expect(response.result.effects.map((effect) => effect.op)).toEqual(["ADD", "ADD", "UPDATE"]);
    expect(response.result.effects.every((effect) => effect.description.length > 0)).toBe(true);
    const enquiry = await api.getEnquiry(ENQUIRY_AURORA);
    expect(enquiry.status).toBe("CONVERTED");
  });

  it("lets a human send the follow-up an agent may only suggest", async () => {
    const response = await api.performAction({
      type: "FOLLOWUP_SEND",
      targetRef: FOLLOW_UP_AURORA,
      payload: { channel: "WHATSAPP", templateId: TEMPLATE_FOLLOWUP_WHATSAPP },
      requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
    });
    expect(response.status).toBe("EXECUTED");
  });
});

describe("QUEUED_FOR_APPROVAL", () => {
  it("intercepts a proposal send above the APV-01 threshold", async () => {
    const response = await api.performAction(humanSend());

    expect(response.status).toBe("QUEUED_FOR_APPROVAL");
    if (response.status !== "QUEUED_FOR_APPROVAL") return;
    expect(response.approvalRequest.policyId).toBe("APV-01");
    expect(response.approvalRequest.approverRole).toBe("SALES_MANAGER");
    /** The standing approval, not a duplicate queued behind it. */
    expect(response.approvalRequest.ref).toBe(APPROVAL_AURORA);
    expect(response.approvalRequest.assignedTo?.name).toBe("Kelvin Tan");
  });

  it("raises a new approval, event and badge when nothing is standing", async () => {
    const created: string[] = [];
    api.events.on("ApprovalRequested", (event) => created.push(event.payload.approvalRef));
    const frames: unknown[] = [];
    api.events.subscribe(["approvals", "badges"], (message) => frames.push(message));

    const response = await api.performAction({
      ...humanSend(),
      targetRef: PROPOSAL_MERIDIAN,
    });

    expect(response.status).toBe("QUEUED_FOR_APPROVAL");
    if (response.status !== "QUEUED_FOR_APPROVAL") return;
    expect(response.approvalRequest.ref).not.toBe(APPROVAL_AURORA);
    expect(created).toEqual([response.approvalRequest.ref]);
    expect(frames).toHaveLength(2);
    const badges = await api.getBadges();
    expect(badges.approvals).toBe(8);
  });

  it("reads the gated value from the record, not the request body", async () => {
    /** An agent understating the value must not slip under the RM 15,000 gate. */
    const response = await api.performAction({
      ...humanSend(),
      targetRef: PROPOSAL_MERIDIAN,
      payload: { ...humanSend().payload, value: { amount: 100, currency: "MYR" } },
      requestedBy: { kind: "AGENT", id: AGENT_PROPOSAL, name: "Proposal Agent" },
      confidence: 0.9,
    });

    expect(response.status).toBe("QUEUED_FOR_APPROVAL");
    if (response.status !== "QUEUED_FOR_APPROVAL") return;
    const approval = await api.getApproval(response.approvalRequest.ref);
    expect(approval.value).toEqual({ amount: 1920000, currency: "MYR" });
    expect(approval.bulkApprovable).toBe(false);
  });

  it("never assigns an approval back to the person who raised it", async () => {
    api.signInAs("u_kelvin");
    const response = await api.performAction({
      ...humanSend(),
      requestedBy: { kind: "HUMAN", id: "u_kelvin", name: "Kelvin Tan" },
    });
    expect(response.status).toBe("QUEUED_FOR_APPROVAL");
    if (response.status !== "QUEUED_FOR_APPROVAL") return;
    expect(response.approvalRequest.assignedTo?.id).not.toBe("u_kelvin");
  });

  it("refuses to bulk-approve the queued money-moving row", async () => {
    const response = await api.performAction(humanSend());
    if (response.status !== "QUEUED_FOR_APPROVAL") throw new Error("expected a queued action");
    const approval = await api.getApproval(response.approvalRequest.ref);
    expect(approval.bulkApprovable).toBe(false);
  });

  it("queues the day-75 trading hold to the MD", async () => {
    const response = await api.performAction({
      type: "ACCOUNT_TRADING_HOLD",
      targetRef: ORG_SUTERA,
      payload: {
        organisationRef: ORG_SUTERA,
        invoiceRefs: ["INV-2026-0244"],
        reason: "78 days overdue with no contact since September.",
      },
      requestedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
    });

    expect(response.status).toBe("QUEUED_FOR_APPROVAL");
    if (response.status !== "QUEUED_FOR_APPROVAL") return;
    expect(response.approvalRequest.policyId).toBe("FIN-04");
    expect(response.approvalRequest.approverRole).toBe("MD");
    const approval = await api.getApproval(response.approvalRequest.ref);
    /** The value is the account's overdue balance, read from the receivables. */
    expect(approval.value).toEqual({ amount: 940000, currency: "MYR" });
  });
});

describe("SUGGESTED", () => {
  it("hands a human the draft when the agent is only at SUGGEST", async () => {
    const response = await api.performAction({
      type: "FOLLOWUP_SEND",
      targetRef: FOLLOW_UP_AURORA,
      payload: { channel: "WHATSAPP", templateId: TEMPLATE_FOLLOWUP_WHATSAPP },
      requestedBy: { kind: "AGENT", id: AGENT_FOLLOWUP, name: "Follow-up Agent" },
      confidence: 0.82,
      reasoning: "Proposal not opened since 13 September.",
    });

    expect(response.status).toBe("SUGGESTED");
    if (response.status !== "SUGGESTED") return;
    expect(response.draft.type).toBe("FOLLOWUP_SEND");
    expect(response.draft.body).toContain("not opened");
    expect(api.lastMeta.status).toBe(200);
  });

  it("hands over a draft when an agent is under its confidence minimum", async () => {
    const response = await api.performAction({
      ...humanSend(),
      requestedBy: { kind: "AGENT", id: AGENT_PROPOSAL, name: "Proposal Agent" },
      confidence: 0.4,
    });
    expect(response.status).toBe("SUGGESTED");
  });

  it("queues rather than suggests when the agent clears its minimum", async () => {
    const response = await api.performAction({
      ...humanSend(),
      requestedBy: { kind: "AGENT", id: AGENT_PROPOSAL, name: "Proposal Agent" },
      confidence: 0.82,
    });
    expect(response.status).toBe("QUEUED_FOR_APPROVAL");
  });

  it("refuses an action routed to a paused agent", async () => {
    await expect(
      api.performAction({
        type: "BROADCAST_SEND",
        targetRef: ORG_AURORA,
        requestedBy: { kind: "AGENT", id: "agent_knowledge", name: "Knowledge Agent" },
        confidence: 0.9,
      }),
    ).rejects.toMatchObject({ code: "AGENT_PAUSED", http: 409 });
  });
});

describe("idempotency", () => {
  it("replays the original response and flags the replay", async () => {
    const request = humanSend();
    const first = await api.performAction(request, { idempotencyKey: "key-1" });
    const second = await api.performAction(request, { idempotencyKey: "key-1" });

    expect(second).toEqual(first);
    expect(api.lastMeta.status).toBe(200);
    expect(api.lastMeta.headers["Idempotent-Replay"]).toBe("true");
    const approvals = await api.listApprovals({ page: { size: 50 } });
    expect(approvals.data.filter((row) => row.actionType === "PROPOSAL_SEND")).toHaveLength(1);
  });

  it("rejects the same key with a different body", async () => {
    await api.performAction(humanSend(), { idempotencyKey: "key-2" });
    await expect(
      api.performAction(
        { ...humanSend(), payload: { ...humanSend().payload, attachPdf: false } },
        { idempotencyKey: "key-2" },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENT_REPLAY", http: 409 });
  });
});

describe("validation before the gate", () => {
  it("404s an action whose target does not exist", async () => {
    await expect(
      api.performAction({
        type: "PROPOSAL_SEND",
        targetRef: "PRO-2026-9999",
        requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", http: 404 });
  });

  it("requires a reason to archive below 0.9 confidence", async () => {
    await expect(
      api.performAction({
        type: "ENQUIRY_ARCHIVE",
        targetRef: "ENQ-2026-0931",
        requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
        confidence: 0.41,
      }),
    ).rejects.toBeInstanceOf(ContractError);
  });

  it("blocks close-out while the checklist is incomplete", async () => {
    await expect(
      api.performAction({
        type: "ENGAGEMENT_CLOSE_OUT",
        targetRef: "ENG-0231",
        requestedBy: { kind: "HUMAN", id: "u_siti", name: "Siti Nordin" },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      http: 422,
      details: { blockers: ["EVALUATION_SUMMARY_MISSING", "CERTIFICATES_ISSUED_MISSING"] },
    });
  });
});
