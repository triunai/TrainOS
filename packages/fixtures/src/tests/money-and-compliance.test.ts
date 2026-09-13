/**
 * §6 price floors, §18 total-from-lines, §8 attendance immutability and the
 * §9 claim-packet gate — the four rules the demo turns on.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  ENGAGEMENT_AURORA,
  HRDC_CLAIM,
  PARTICIPANT_AHMAD,
  QUOTATION_AURORA,
  USER_JASON,
  USER_SITI,
} from "@trainos/contract";
import { QUOTATION_SUTERA } from "../data/proposals";
import { ENGAGEMENT_WINDOW_CLOSING } from "../data/engagements";
import { createFixtureClient, marginFloorPrice, reconcileInvoice } from "../index";
import type { FixtureClient } from "../client/FixtureClient";

let api: FixtureClient;

beforeEach(() => {
  api = createFixtureClient({ latencyMs: 0 });
});

describe("two independent price floors, the higher binding", () => {
  it("binds on the margin floor when direct cost is the constraint", async () => {
    /** RM 11,400 of direct cost at a 0.35 floor margin needs RM 17,538.46. */
    expect(marginFloorPrice({ amount: 1140000, currency: "MYR" }, 0.35).amount).toBe(1753846);

    await expect(
      api.putQuotation(QUOTATION_AURORA, { sellPrice: { amount: 1240000, currency: "MYR" } }),
    ).rejects.toMatchObject({
      code: "FLOOR_PRICE_BREACH",
      http: 422,
      details: {
        bindingFloorBasis: "MARGIN",
        floorPrice: { amount: 1753846, currency: "MYR" },
        absoluteFloorPrice: { amount: 1390000, currency: "MYR" },
        resultingMarginRate: 0.08,
        requiresPolicy: "APV-02",
      },
    });
  });

  it("binds on the absolute tier floor when that is the higher of the two", async () => {
    /** RM 3,820 of direct cost needs only RM 5,876.92, so the RM 7,350 tier floor rules. */
    expect(marginFloorPrice({ amount: 382000, currency: "MYR" }, 0.35).amount).toBe(587692);

    await expect(
      api.putQuotation(QUOTATION_SUTERA, { sellPrice: { amount: 700000, currency: "MYR" } }),
    ).rejects.toMatchObject({
      code: "FLOOR_PRICE_BREACH",
      details: {
        bindingFloorBasis: "ABSOLUTE",
        floorPrice: { amount: 735000, currency: "MYR" },
        marginFloorPrice: { amount: 587692, currency: "MYR" },
      },
    });
  });

  it("accepts a price that clears both floors and recalculates the margin", async () => {
    const quotation = await api.putQuotation(QUOTATION_AURORA, {
      sellPrice: { amount: 1850000, currency: "MYR" },
    });
    expect(quotation.sellPrice.amount).toBe(1850000);
    expect(quotation.marginRate).toBe(0.38);
    expect(quotation.commission.amount).toBe(148000);
  });

  it("applies the same floors to QUOTATION_APPLY through the action envelope", async () => {
    await expect(
      api.performAction({
        type: "QUOTATION_APPLY",
        targetRef: QUOTATION_AURORA,
        payload: { sellPrice: { amount: 1240000, currency: "MYR" } },
        requestedBy: { kind: "HUMAN", id: "u_amirah", name: "Amirah Yusof" },
      }),
    ).rejects.toMatchObject({ code: "FLOOR_PRICE_BREACH" });
  });
});

describe("total-from-lines", () => {
  it("rejects the RM 616.67 × 30 modelling error", async () => {
    const broken = {
      organisationRef: "ORG-0114",
      engagementRef: ENGAGEMENT_AURORA,
      status: "DRAFT" as const,
      issuedAt: "2026-11-14T10:00:00+08:00",
      dueAt: "2026-12-14",
      termsDays: 30,
      lines: [
        {
          description: "Leading Through Change · 2-day programme",
          qty: 30,
          unit: { amount: 61667, currency: "MYR" as const },
          amount: { amount: 1850000, currency: "MYR" as const },
        },
      ],
      subtotal: { amount: 1850000, currency: "MYR" as const },
      sst: { amount: 0, currency: "MYR" as const },
      total: { amount: 1850000, currency: "MYR" as const },
      outstanding: { amount: 1850000, currency: "MYR" as const },
      sync: { state: "NOT_SENT" as const, provider: "ACCOUNTING", uin: null, lastAttemptAt: null },
      syncLog: [],
      payments: [],
    };

    await expect(api.createInvoice(broken)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      http: 422,
      details: { reason: "TOTAL_NOT_RECONCILED" },
    });
  });

  it("accepts the same money as one package line at qty 1", async () => {
    const invoice = await api.createInvoice({
      organisationRef: "ORG-0114",
      engagementRef: ENGAGEMENT_AURORA,
      status: "DRAFT",
      issuedAt: "2026-11-14T10:00:00+08:00",
      dueAt: "2026-12-14",
      termsDays: 30,
      lines: [
        {
          description: "Leading Through Change · 2-day programme",
          qty: 1,
          unit: { amount: 1850000, currency: "MYR" },
          amount: { amount: 1850000, currency: "MYR" },
        },
      ],
      subtotal: { amount: 1850000, currency: "MYR" },
      sst: { amount: 0, currency: "MYR" },
      total: { amount: 1850000, currency: "MYR" },
      outstanding: { amount: 1850000, currency: "MYR" },
      sync: { state: "NOT_SENT", provider: "ACCOUNTING", uin: null, lastAttemptAt: null },
      syncLog: [],
      payments: [],
      display: { perPax: { amount: 61667, currency: "MYR" } },
    });

    expect(invoice.total.amount).toBe(1850000);
    expect(invoice.display?.perPax?.amount).toBe(61667);
  });

  it("rounds each line half-up before summing", () => {
    const result = reconcileInvoice({
      lines: [
        { qty: 3, unit: { amount: 1005, currency: "MYR" }, amount: { amount: 3015, currency: "MYR" } },
        { qty: 7, unit: { amount: 333, currency: "MYR" }, amount: { amount: 2331, currency: "MYR" } },
      ],
      subtotal: { amount: 5346, currency: "MYR" },
      sst: { amount: 0, currency: "MYR" },
      total: { amount: 5346, currency: "MYR" },
    });
    expect(result.reconciled).toBe(true);
  });

  it("keeps every seeded invoice reconciled", async () => {
    const invoices = await api.listInvoices({ page: { size: 50 } });
    for (const invoice of invoices.data) {
      expect(reconcileInvoice(invoice).reconciled).toBe(true);
    }
  });
});

describe("attendance is immutable once approved", () => {
  it("409s a capture against the locked day", async () => {
    await expect(
      api.captureAttendance(ENGAGEMENT_AURORA, 1, {
        participantRef: PARTICIPANT_AHMAD,
        session: "AM",
        present: false,
        method: "MANUAL",
      }),
    ).rejects.toMatchObject({
      code: "ATTENDANCE_LOCKED",
      http: 409,
      details: { unlockActionType: "ATTENDANCE_UNLOCK", unlockPath: "/v1/actions" },
    });
  });

  it("disables every capture mode from the response, not from the client", async () => {
    const locked = await api.getAttendance(ENGAGEMENT_AURORA, 1);
    expect(locked.captureModes).toEqual({ qr: false, signature: false, manual: false });
    expect(locked.immutable).toBe(true);
  });

  it("still accepts a capture on the day that is not yet locked", async () => {
    const sheet = await api.captureAttendance(ENGAGEMENT_AURORA, 2, {
      participantRef: PARTICIPANT_AHMAD,
      session: "PM",
      present: false,
      method: "MANUAL",
      reason: "WORK_CONFLICT",
    });
    expect(sheet.summary.presentPm).toBe(27);
  });

  it("locks day 2 one way through the action envelope", async () => {
    api.signInAs(USER_SITI);
    const response = await api.performAction({
      type: "ATTENDANCE_APPROVE",
      targetRef: ENGAGEMENT_AURORA,
      payload: { day: 2 },
      requestedBy: { kind: "HUMAN", id: USER_SITI, name: "Siti Nordin" },
    });
    /** OPS-01 gates the lock, and Siti cannot approve her own request. */
    expect(response.status).toBe("QUEUED_FOR_APPROVAL");
  });
});

describe("the claim packet gate", () => {
  it("422s mark-submitted while documents are missing", async () => {
    await expect(
      api.performAction({
        type: "HRDC_PACKET_MARK_SUBMITTED",
        targetRef: ENGAGEMENT_AURORA,
        payload: { reference: HRDC_CLAIM, submittedAt: "2026-11-16T14:20:00+08:00" },
        requestedBy: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      http: 422,
      details: { blockers: ["EVALUATION_SUMMARY", "TRAINING_SCHEDULE"] },
    });
  });

  it("lets a complete packet through the gate to an approval", async () => {
    api.signInAs(USER_SITI);
    const response = await api.performAction({
      type: "HRDC_PACKET_MARK_SUBMITTED",
      targetRef: ENGAGEMENT_WINDOW_CLOSING,
      payload: { reference: HRDC_CLAIM, submittedAt: "2026-11-16T14:20:00+08:00" },
      requestedBy: { kind: "HUMAN", id: USER_SITI, name: "Siti Nordin" },
    });
    expect(response.status).toBe("QUEUED_FOR_APPROVAL");
    if (response.status !== "QUEUED_FOR_APPROVAL") return;
    expect(response.approvalRequest.approverRole).toBe("FINANCE");
  });

  it("completes a packet as its documents arrive", async () => {
    const packet = await api.attachPacketDocument(ENGAGEMENT_AURORA, {
      type: "EVALUATION_SUMMARY",
      ref: `${ENGAGEMENT_AURORA}/evaluation`,
    });
    expect(packet.completeness).toBe(0.8);
    const complete = await api.attachPacketDocument(ENGAGEMENT_AURORA, {
      type: "TRAINING_SCHEDULE",
      ref: `${ENGAGEMENT_AURORA}/schedule`,
    });
    expect(complete.completeness).toBe(1);
    expect(complete.status).toBe("READY");
  });

  it("resolves grant-side and claim-side rules separately", async () => {
    const checks = await api.getComplianceChecks(ENGAGEMENT_AURORA);
    expect(checks.ruleResolution.grantSide.basis).toBe("GRANT_SUBMITTED");
    expect(checks.ruleResolution.grantSide.ruleSetVersion).toBe("rs_2026_06_15");
    expect(checks.ruleResolution.claimSide.asOf).toBeNull();
    expect(checks.summary).toEqual({ pass: 4, warn: 1, fail: 1 });
    expect(checks.checks.filter((check) => check.state === "FAIL")).toHaveLength(1);
  });
});
