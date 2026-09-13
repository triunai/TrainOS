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

/**
 * The `metricsCard` slot (tightening brief §15a).
 *
 * §15a withdrew the collapsible title row after the user saw it: the row
 * renders exactly as it always has and carries no chevron. The slot is
 * therefore the ONLY thing this header gained, and the first test is the one
 * that protects the other 26 record screens.
 */
describe("RecordHeader metricsCard", () => {
  it("leaves a header that did not pass the slot completely unchanged", () => {
    render(
      <RecordHeader
        title="Acme Sdn Bhd"
        recordRef="ORG-0114"
        meta={["Manufacturing"]}
        metrics={[{ label: "Lifetime value", value: "42" }]}
      />,
    );

    expect(screen.getByText("Lifetime value")).toBeInTheDocument();
    /* No disclosure anywhere: the title row never gained a chevron. */
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the slot in place of the plain metric strip", () => {
    render(
      <RecordHeader
        title="Send proposal"
        metrics={[{ label: "Lifetime value", value: "42" }]}
        metricsCard={<div data-testid="slot">the band</div>}
      />,
    );

    expect(screen.getByTestId("slot")).toBeInTheDocument();
    expect(screen.queryByText("Lifetime value")).toBeNull();
  });

  it("keeps the title row free of a chevron even with the slot passed", () => {
    render(
      <RecordHeader
        title="Send proposal"
        primaryAction={<button type="button">Approve</button>}
        metricsCard={<div>the band</div>}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Approve");
  });
});
