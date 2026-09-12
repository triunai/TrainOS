import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordHeader, CondensedRecordHeader } from "@/shared/components/kit/RecordHeader";

describe("RecordHeader", () => {
  it("renders the title exactly once as a heading", () => {
    render(<RecordHeader title="Acme Sdn Bhd" />);
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Acme Sdn Bhd");
  });

  it("joins recordRef and meta into one mono line with ' · ' separators", () => {
    render(
      <RecordHeader
        title="Acme Sdn Bhd"
        recordRef="ORG-0114"
        meta={["Manufacturing", "Shah Alam", null, undefined, "owner Amirah"]}
      />,
    );
    expect(
      screen.getByText("ORG-0114 · Manufacturing · Shah Alam · owner Amirah"),
    ).toBeInTheDocument();
  });

  it("renders primaryAction and actions", () => {
    render(
      <RecordHeader
        title="Acme Sdn Bhd"
        actions={<button type="button">Export</button>}
        primaryAction={<button type="button">Approve</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("CondensedRecordHeader renders title, first chip only, and the primary action", () => {
    const onClick = vi.fn();
    render(
      <CondensedRecordHeader
        title="Acme Sdn Bhd"
        chips={[<span key="a">Active</span>, <span key="b">VIP</span>]}
        primaryAction={
          <button type="button" onClick={onClick}>
            Approve
          </button>
        }
      />,
    );
    expect(screen.getByText("Acme Sdn Bhd")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("VIP")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Approve" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
