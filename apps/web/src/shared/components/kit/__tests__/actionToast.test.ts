import { describe, expect, it } from "vitest";
import type { ActionResponse } from "@trainos/contract";
import { defaultActionSubject, describeActionToast } from "@/shared/components/kit/actionToast";
import { extraCreatedRefs, summariseEffects } from "@/shared/components/kit/adapters";

const EXECUTED_WITH_EXTRA: ActionResponse = {
  status: "EXECUTED",
  result: {
    effects: [
      { op: "ADD", entity: "Opportunity", description: "Created from the enquiry" },
      { op: "ADD", entity: "TNA", description: "Questionnaire sent to the client contact" },
      {
        op: "UPDATE",
        entity: "Enquiry",
        ref: "ENQ-2026-0013",
        description: "status OPEN → CONVERTED",
      },
    ],
    opportunity: { id: "opp_1", ref: "OPP-2026-0005", stage: "QUALIFYING" },
  },
};

const EXECUTED_REF_ALREADY_IN_EFFECTS: ActionResponse = {
  status: "EXECUTED",
  result: {
    effects: [
      { op: "UPDATE", entity: "Invoice", ref: "INV-2026-0311", description: "Pushed to MyInvois" },
    ],
    invoice: { id: "inv_1", ref: "INV-2026-0311" },
  },
};

const QUEUED: ActionResponse = {
  status: "QUEUED_FOR_APPROVAL",
  approvalRequest: {
    id: "apv-1",
    ref: "APV-2026-0771",
    policyId: "APV-01",
    approverRole: "SALES_MANAGER",
    assignedTo: { id: "u1", name: "Kelvin", kind: "HUMAN" },
    slaDueAt: "2026-10-14T17:00:00+08:00",
    createdAt: "2026-10-14T09:00:00+08:00",
  },
};

const SUGGESTED: ActionResponse = {
  status: "SUGGESTED",
  draft: {
    id: "d1",
    type: "FOLLOWUP_SEND",
    body: "Draft reminder text",
    expiresAt: "2026-10-15T09:00:00+08:00",
  },
};

describe("summariseEffects", () => {
  it("joins every effect's description, in order", () => {
    expect(
      summariseEffects(
        EXECUTED_WITH_EXTRA.status === "EXECUTED" ? EXECUTED_WITH_EXTRA.result.effects : [],
      ),
    ).toBe(
      "Created from the enquiry · Questionnaire sent to the client contact · status OPEN → CONVERTED",
    );
  });

  it("is empty for no effects", () => {
    expect(summariseEffects([])).toBe("");
  });
});

describe("extraCreatedRefs", () => {
  it("finds a ref-carrying extra beyond `effects`", () => {
    expect(
      extraCreatedRefs(
        EXECUTED_WITH_EXTRA.status === "EXECUTED" ? EXECUTED_WITH_EXTRA.result : { effects: [] },
      ),
    ).toEqual([{ entity: "opportunity", ref: "OPP-2026-0005" }]);
  });

  it("ignores `effects` itself and any extra with no `ref`", () => {
    expect(extraCreatedRefs({ effects: [], note: "no ref here" })).toEqual([]);
  });
});

describe("defaultActionSubject", () => {
  it("humanises the action type and appends the target ref", () => {
    expect(defaultActionSubject({ type: "OPPORTUNITY_CONVERT", targetRef: "ENQ-2026-0013" })).toBe(
      "Opportunity convert · ENQ-2026-0013",
    );
  });

  it("drops the ref when there is none", () => {
    expect(defaultActionSubject({ type: "OPPORTUNITY_CONVERT", targetRef: undefined })).toBe(
      "Opportunity convert",
    );
  });
});

describe("describeActionToast", () => {
  it("EXECUTED: names the effects, and a created ref the effects list itself lacks", () => {
    const message = describeActionToast("Convert ENQ-2026-0013", { response: EXECUTED_WITH_EXTRA });
    expect(message.variant).toBe("success");
    expect(message.title).toBe("Convert ENQ-2026-0013");
    expect(message.description).toBe(
      "Created from the enquiry · Questionnaire sent to the client contact · status OPEN → CONVERTED · Opportunity OPP-2026-0005",
    );
  });

  it("EXECUTED: does not repeat a ref the effects line already carries", () => {
    const message = describeActionToast("Push INV-2026-0311", {
      response: EXECUTED_REF_ALREADY_IN_EFFECTS,
    });
    expect(message.description).toBe("Pushed to MyInvois");
  });

  /* R2: a queued action is a SUCCESS, never the error variant. */
  it("QUEUED_FOR_APPROVAL: an info toast naming the approval ref, not an error", () => {
    const message = describeActionToast("Send proposal · Aurora", { response: QUEUED });
    expect(message.variant).toBe("info");
    expect(message.title).toBe("Send proposal · Aurora · sent for approval");
    expect(message.description).toBe("Approval APV-2026-0771");
  });

  it("SUGGESTED: an info toast, with the draft body as the description", () => {
    const message = describeActionToast("Send reminder", { response: SUGGESTED });
    expect(message.variant).toBe("info");
    expect(message.title).toBe("Send reminder · saved as a suggestion");
    expect(message.description).toBe("Draft reminder text");
  });

  it("a refusal: the server's own sentence, with blockers named", () => {
    const message = describeActionToast("Close out", {
      error: { message: "Engagement cannot be closed out", blockers: ["ATTENDANCE_OPEN"] },
    });
    expect(message.variant).toBe("error");
    expect(message.title).toBe("Engagement cannot be closed out");
    expect(message.description).toBe("Blocked by Attendance open");
  });
});
