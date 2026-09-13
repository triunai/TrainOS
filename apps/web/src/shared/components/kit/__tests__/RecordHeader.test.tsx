import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordHeader, CondensedRecordHeader } from "@/shared/components/kit/RecordHeader";

/**
 * React DOM registers a window `error` handler of its own for as long as a
 * tree is mounted. It belongs to the test environment, not to the component
 * under test, so it is filtered out here — anything else this spy catches is a
 * listener the component added and did not take back.
 */
function ownListeners(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter((call) => call[0] !== "error");
}

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
 * The `collapsible` variant (tightening brief §15).
 *
 * The first test is the one that protects the other 26 record screens: the
 * variant is additive, so a header that does not ask for it must render exactly
 * as it did before — no chevron, no clipped region, no changed spacing.
 */
describe("RecordHeader collapsible", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("leaves a header that did not opt in completely unchanged", () => {
    const { container } = render(
      <RecordHeader
        title="Acme Sdn Bhd"
        recordRef="ORG-0114"
        meta={["Manufacturing"]}
        metrics={[{ label: "Lifetime value", value: "42" }]}
      />,
    );

    expect(screen.queryByRole("button", { name: /record details/i })).toBeNull();
    expect(container.querySelector("[data-open]")).toBeNull();
    /* Row spacing still lives on the header, not inside a clipped region. */
    expect(container.querySelector("header")?.className).toContain("gap-3.5");
  });

  it("opens expanded, and the chevron closes rows 2 and 3 without touching row 1", () => {
    const { container } = render(
      <RecordHeader
        collapsible
        recordType="approval"
        title="Send proposal"
        recordRef="APV-2026-0771"
        meta={["policy APV-01"]}
        primaryAction={<button type="button">Approve</button>}
      />,
    );

    const chevron = screen.getByRole("button", { name: "Hide the record details" });
    expect(chevron).toHaveAttribute("aria-expanded", "true");

    const region = container.querySelector("[data-open]") as HTMLElement;
    expect(region.dataset.open).toBe("true");

    /* `aria-controls` points at the element that actually holds the content —
       the clipped row inside the wrapper, not the wrapper. */
    const controlled = document.getElementById(chevron.getAttribute("aria-controls") ?? "");
    expect(controlled).not.toBeNull();
    expect(region.contains(controlled)).toBe(true);
    expect(controlled).toHaveTextContent("APV-2026-0771 · policy APV-01");

    fireEvent.click(chevron);

    /* Collapsed leaves ONE row: the title, the status chip and the actions. */
    expect(region.dataset.open).toBe("false");
    expect(screen.getByRole("heading", { name: "Send proposal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show the record details" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    /* The header's own gap is gone, so the collapse leaves no residual band. */
    expect(container.querySelector("header")?.className).not.toContain("gap-3.5");
  });

  it("remembers the choice against the record TYPE, not the record", () => {
    const first = render(
      <RecordHeader collapsible recordType="approval" title="Send proposal" recordRef="APV-1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide the record details" }));
    first.unmount();

    /* A different record of the same type inherits the preference. */
    render(
      <RecordHeader
        collapsible
        recordType="approval"
        title="Discount below floor"
        recordRef="APV-2"
      />,
    );
    expect(screen.getByRole("button", { name: "Show the record details" })).toBeInTheDocument();
  });

  it("renders the metricsCard slot in place of the plain metric strip", () => {
    render(
      <RecordHeader
        collapsible
        recordType="approval"
        title="Send proposal"
        metrics={[{ label: "Lifetime value", value: "42" }]}
        metricsCard={<div data-testid="slot">the band</div>}
      />,
    );

    expect(screen.getByTestId("slot")).toBeInTheDocument();
    expect(screen.queryByText("Lifetime value")).toBeNull();
  });

  it("leaves no listener or timer behind when a collapsible header unmounts", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const timeoutSpy = vi.spyOn(window, "setTimeout");

    /* No `recordType`, so nothing is written to storage — jsdom dispatches its
       own storage event through `setTimeout`, which would be the environment's
       timer showing up in a test about the component's. */
    const { unmount } = render(<RecordHeader collapsible title="Send proposal" withoutCondensed />);
    fireEvent.click(screen.getByRole("button", { name: "Hide the record details" }));
    unmount();

    expect(ownListeners(addSpy)).toEqual([]);
    expect(timeoutSpy).not.toHaveBeenCalled();

    addSpy.mockRestore();
    timeoutSpy.mockRestore();
  });
});
