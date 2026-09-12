import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AutomationRun, RunStep } from "@trainos/contract";
import { AgentRunCard } from "@/shared/components/kit/AgentRunCard";
import { RunStepRow } from "@/shared/components/kit/RunStepRow";
import { formatDuration } from "@/shared/components/kit/format";

const SUCCEEDED: AutomationRun = {
  id: "run-1",
  ref: "RUN-0001",
  agentId: "agent-1",
  trigger: { type: "ENQUIRY_RECEIVED" },
  model: "Claude Sonnet 5",
  startedAt: "2026-09-12T09:00:00+08:00",
  durationMs: 8400,
  cost: { amount: 1250, currency: "MYR" },
  tokens: { in: 100, out: 50 },
  status: "SUCCEEDED",
  guardrails: [],
  steps: [
    { seq: 1, tool: "fetch_enquiry", status: "OK", durationMs: 300 },
    { seq: 2, tool: "draft_reply", status: "OK", durationMs: 900 },
  ],
};

const FAILED: AutomationRun = {
  ...SUCCEEDED,
  id: "run-2",
  ref: "RUN-0002",
  status: "FAILED",
  failure: {
    code: "PROVIDER_TIMEOUT",
    message: "The provider did not respond in time",
    attempts: 3,
    retryable: true,
    deadLettered: false,
  },
};

describe("formatDuration", () => {
  it("formats sub-second, sub-minute and multi-minute durations", () => {
    expect(formatDuration(900)).toBe("900ms");
    expect(formatDuration(8400)).toBe("8.4s");
    expect(formatDuration(65000)).toBe("1m 5s");
  });
});

describe("AgentRunCard", () => {
  it("shows the four metrics and the step rows for a SUCCEEDED run", () => {
    render(<AgentRunCard run={SUCCEEDED} agentName="Enquiry Agent" />);
    expect(screen.getByText("Trigger")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("fetch_enquiry")).toBeInTheDocument();
    expect(screen.getByText("draft_reply")).toBeInTheDocument();
  });

  it("renders the failure code, message and retryable wording for a FAILED run", () => {
    render(<AgentRunCard run={FAILED} agentName="Enquiry Agent" />);
    expect(screen.getByText("PROVIDER_TIMEOUT")).toBeInTheDocument();
    expect(screen.getByText(/The provider did not respond in time/)).toBeInTheDocument();
    expect(screen.getByText(/retryable/)).toBeInTheDocument();
  });

  it("renders dead-lettered wording instead when the failure is dead-lettered", () => {
    render(
      <AgentRunCard
        run={{ ...FAILED, failure: { ...FAILED.failure!, deadLettered: true } }}
        agentName="Enquiry Agent"
      />,
    );
    expect(screen.getByText(/dead-lettered/)).toBeInTheDocument();
  });
});

describe("RunStepRow", () => {
  const STEP_WITH_ARGS: RunStep = {
    seq: 1,
    tool: "send_email",
    status: "OK",
    durationMs: 500,
    args: { to: "aurora@example.com", subject: "Proposal" },
  };

  const HALTED_STEP: RunStep = {
    seq: 2,
    tool: "send_invoice",
    status: "HALTED",
    durationMs: 100,
    haltedBy: {
      policyId: "policy-1",
      approvalRequestRef: "APR-0099",
      reason: "Exceeds floor price",
    },
  };

  it("is expandable when it carries args, and reveals the JSON on expand", () => {
    render(<RunStepRow step={STEP_WITH_ARGS} />);
    const button = screen.getByRole("button", { expanded: false });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/aurora@example.com/)).toBeInTheDocument();
  });

  it("shows the approval ref for a HALTED step", () => {
    render(<RunStepRow step={HALTED_STEP} />);
    expect(screen.getByText(/APR-0099/)).toBeInTheDocument();
  });
});
