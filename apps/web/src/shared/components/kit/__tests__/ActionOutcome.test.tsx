import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ActionResponse } from "@trainos/contract";
import { ActionOutcome } from "@/shared/components/kit/ActionOutcome";
import { describeActionError } from "@/shared/components/kit/adapters";

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

const EXECUTED: ActionResponse = {
  status: "EXECUTED",
  result: {
    effects: [{ op: "ADD", entity: "Proposal", description: "Proposal PRO-2026-0188 is sent" }],
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

describe("ActionOutcome", () => {
  it("renders nothing before an answer arrives", () => {
    const { container } = render(<ActionOutcome subject="Send proposal" />);
    expect(container).toBeEmptyDOMElement();
  });

  /* The rule this component exists to hold: a queued action is a SUCCESS. It
     must not read as a failure, or people learn to treat the policy gate as a
     bug and the approval queue becomes invisible. */
  it("renders a queued action as a pending approval, not as an error", () => {
    render(<ActionOutcome subject="Send proposal · Aurora" response={QUEUED} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Awaiting approval/)).toBeInTheDocument();
    expect(screen.getByText(/Kelvin/)).toBeInTheDocument();
    expect(screen.getByText(/Send proposal · Aurora/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists the effects of an executed action", () => {
    render(<ActionOutcome subject="Send proposal" response={EXECUTED} />);
    expect(screen.getByText("Send proposal · done")).toBeInTheDocument();
    expect(screen.getByText(/Proposal PRO-2026-0188 is sent/)).toBeInTheDocument();
  });

  it("shows a suggestion as a draft that was not executed", () => {
    render(<ActionOutcome subject="Send reminder" response={SUGGESTED} />);
    expect(screen.getByText("Returned as a draft, not executed")).toBeInTheDocument();
    expect(screen.getByText("Draft reminder text")).toBeInTheDocument();
  });

  /* The blockers are the only actionable part of a refusal, so they are
     rendered as themselves rather than collapsed into a generic sentence. */
  it("names every blocker on a refusal", () => {
    render(
      <ActionOutcome
        subject="Close out"
        error={{
          message: "Engagement cannot be closed out",
          blockers: ["ATTENDANCE_OPEN", "INVOICE_MISSING"],
        }}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Engagement cannot be closed out")).toBeInTheDocument();
    expect(screen.getByText(/Blocked by 2/)).toBeInTheDocument();
    expect(screen.getByText(/Attendance open/)).toBeInTheDocument();
    expect(screen.getByText(/Invoice missing/)).toBeInTheDocument();
  });

  it("offers a dismiss affordance on every branch when asked", () => {
    const onDismiss = vi.fn();
    render(<ActionOutcome subject="Send proposal" response={QUEUED} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("describeActionError", () => {
  it("pulls the message, code and blockers off a thrown domain error", () => {
    const described = describeActionError({
      message: "Engagement cannot be closed out",
      code: "VALIDATION_FAILED",
      details: { blockers: ["ATTENDANCE_OPEN"] },
    });

    expect(described.message).toBe("Engagement cannot be closed out");
    expect(described.code).toBe("VALIDATION_FAILED");
    expect(described.blockers).toEqual(["ATTENDANCE_OPEN"]);
  });

  it("accepts a bare string", () => {
    expect(describeActionError("Network unreachable").message).toBe("Network unreachable");
  });

  /* This runs on the failure path. A describe function that throws while
     describing a throw turns a handled refusal into a blank screen. */
  it("always produces a sentence, whatever it is handed", () => {
    expect(describeActionError(undefined).message).toBe("The action did not go through");
    expect(describeActionError(null).message).toBe("The action did not go through");
    expect(describeActionError({}).message).toBe("The action did not go through");
    expect(describeActionError({ details: { blockers: "not an array" } }).blockers).toBeUndefined();
    expect(describeActionError({ code: "SYNC_FAILED" }).message).toBe("Sync failed");
  });
});
