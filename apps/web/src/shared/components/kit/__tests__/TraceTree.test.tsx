import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TraceNode } from "@trainos/contract";
import { TraceTree, TraceTreeNode } from "@/shared/components/kit/TraceTreeNode";

const NODES: TraceNode[] = [
  { id: "n1", parentId: null, kind: "ORCHESTRATOR", name: "Orchestrator", status: "OK" },
  { id: "n2", parentId: "n1", kind: "SUB_AGENT", name: "Proposal drafting", status: "OK" },
  {
    id: "n3",
    parentId: "n2",
    kind: "TOOL",
    name: "send_invoice",
    status: "HALTED",
    haltedBy: { policyId: "p1", approvalRequestRef: "APR-0055", reason: "Floor price" },
  },
];

describe("TraceTree", () => {
  it("renders role=tree with its label and one treeitem per node", () => {
    render(<TraceTree nodes={NODES} label="Execution trace" />);
    expect(screen.getByRole("tree", { name: "Execution trace" })).toBeInTheDocument();
    expect(screen.getAllByRole("treeitem")).toHaveLength(3);
  });

  it("derives depth from parentId: the root is aria-level 1, its child is aria-level 2", () => {
    render(<TraceTree nodes={NODES} />);
    const items = screen.getAllByRole("treeitem");
    expect(items[0]).toHaveAttribute("aria-level", "1");
    expect(items[1]).toHaveAttribute("aria-level", "2");
  });

  it("renders the approval ref for a HALTED node", () => {
    render(<TraceTree nodes={NODES} />);
    expect(screen.getByText(/APR-0055/)).toBeInTheDocument();
  });
});

describe("TraceTreeNode", () => {
  it("with onToggle renders a button whose accessible name names the node", () => {
    const onToggle = vi.fn();
    render(
      <ul>
        <TraceTreeNode node={NODES[0]} onToggle={onToggle} expanded={false} />
      </ul>,
    );
    expect(screen.getByRole("button", { name: "Expand Orchestrator" })).toBeInTheDocument();
  });
});
