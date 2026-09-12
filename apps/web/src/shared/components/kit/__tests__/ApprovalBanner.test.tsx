import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ApprovalRequest } from "@trainos/contract";
import { ApprovalBanner } from "@/shared/components/kit/ApprovalBanner";

const BASE: Pick<
  ApprovalRequest,
  "subject" | "value" | "slaDueAt" | "slaBreached" | "slaRemainingMinutes" | "status"
> = {
  subject: "Discount 12% — Aurora Manufacturing",
  slaDueAt: "2026-09-12T18:00:00+08:00",
  slaBreached: false,
  slaRemainingMinutes: 45,
  status: "PENDING",
};

describe("ApprovalBanner", () => {
  it("renders a PENDING approval with awaiting wording, the approver name/role, the action slot, and role=status", () => {
    render(
      <ApprovalBanner
        approval={BASE}
        approverName="Kelvin"
        approverRole="SALES_MANAGER"
        actions={<button>Approve</button>}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Awaiting approval");
    expect(banner).toHaveTextContent("Kelvin");
    expect(banner).toHaveTextContent("Sales Manager");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("renders the breach wording when slaBreached is true", () => {
    render(<ApprovalBanner approval={{ ...BASE, slaBreached: true }} />);
    expect(screen.getByRole("status")).toHaveTextContent("SLA breached");
  });

  it("renders the decided variant with the decider's name and a working View audit trail button", () => {
    const onOpenAudit = vi.fn();
    render(
      <ApprovalBanner
        approval={{ ...BASE, status: "APPROVED" }}
        decidedBy="Priya"
        onOpenAudit={onOpenAudit}
      />,
    );
    expect(screen.getByText(/Approved by Priya/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "View audit trail" });
    fireEvent.click(button);
    expect(onOpenAudit).toHaveBeenCalledTimes(1);
  });

  it("does not use role=status for a decided approval", () => {
    render(<ApprovalBanner approval={{ ...BASE, status: "REJECTED" }} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
