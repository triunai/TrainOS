import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordHeader, CondensedRecordHeader } from "@/shared/components/kit/RecordHeader";
import { DangerButton, PrimaryButton, SecondaryButton } from "@/shared/components/kit/Button";
import { StatusChip } from "@/shared/components/kit/StatusChip";

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
 * The record variant (tightening brief §15a) — the whole header as one blue
 * gradient card.
 *
 * The first test is the one that protects the other 26 screens AND every list
 * page: the variant is opt-in, and a header that does not ask for it renders
 * exactly as it always has.
 */
describe("RecordHeader accent", () => {
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

    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).not.toContain("surface-accent-gradient");
    expect(header.className).toContain("px-5");
    expect(screen.queryByRole("button")).toBeNull();
    /* Ink, not white — the strip is still the default variant. */
    expect(screen.getByText("Lifetime value").className).toContain("text-ink-muted");
  });

  it("serves a LIST page on the same anatomy, with no record to announce", () => {
    /* The kit ruling at b0ef662: there is no PageHeader. A list is this
       component with no recordRef, no condensed bar and a count via `meta`. */
    render(<RecordHeader title="Programmes" meta={["31 programmes"]} withoutCondensed />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Programmes");
    expect(screen.getByText("31 programmes")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("paints one blue card and re-inks everything on it", () => {
    const { container } = render(
      <RecordHeader
        accent
        title="Send proposal"
        recordRef="APV-2026-0771"
        meta={["policy APV-01"]}
        chips={<StatusChip tone="warning">Awaiting your approval</StatusChip>}
        actions={<SecondaryButton>Request changes</SecondaryButton>}
        primaryAction={<PrimaryButton>Approve</PrimaryButton>}
        metrics={[{ label: "Value", value: "RM 18,500" }]}
      />,
    );

    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).toContain("bg-[image:var(--surface-accent-gradient)]");
    expect(header.className).toContain("rounded-panel");

    /* Title, meta and strip all in white. */
    expect(screen.getByRole("heading", { level: 1 }).className).toContain(
      "text-[rgb(var(--on-accent))]",
    );
    expect(screen.getByText("APV-2026-0771 · policy APV-01").className).toContain(
      "text-[rgb(var(--on-accent))]",
    );
    expect(screen.getByText("Value").className).toContain("text-[rgb(var(--on-accent))]");

    /* The controls were NOT told they are on blue — they read the card. That is
       what keeps a screen's header markup identical either way. */
    expect(screen.getByRole("button", { name: "Approve" }).className).toContain(
      "bg-[rgb(var(--on-accent))]",
    );
    expect(screen.getByRole("button", { name: "Request changes" }).className).toContain(
      "border-[rgb(var(--on-accent)/0.45)]",
    );

    /* The chip keeps its tone as DATA and loses only the hue: a warning fill is
       built for a near-white card and is a bright slab on saturated blue. */
    const chip = screen.getByText("Awaiting your approval");
    expect(chip).toHaveAttribute("data-tone", "warning");
    expect(chip.className).not.toContain("bg-warning-fill");
    expect(chip.className).toContain("text-[rgb(var(--on-accent))]");
  });

  it("collapses to the title row and the meta line, and nothing else", () => {
    const { container } = render(
      <RecordHeader
        accent
        collapsible
        recordType="approval"
        title="Send proposal"
        recordRef="APV-2026-0771"
        meta={["policy APV-01"]}
        primaryAction={<PrimaryButton>Approve</PrimaryButton>}
        metrics={[{ label: "Value", value: "RM 18,500" }]}
      />,
    );

    const chevron = screen.getByRole("button", { name: "Hide the record detail" });
    expect(chevron).toHaveAttribute("aria-expanded", "true");

    const region = container.querySelector("[data-open]") as HTMLElement;
    expect(region.dataset.open).toBe("true");

    fireEvent.click(chevron);

    /* §15a: "the card shrinks to the title row plus meta line". No residual
       strip, no condensed metric summary. */
    expect(region.dataset.open).toBe("false");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("APV-2026-0771 · policy APV-01")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    /* Still one blue card, only shorter. */
    expect(container.querySelector("header")?.className).toContain("surface-accent-gradient");
  });

  it("toggles open and shut on every click, not just the first", () => {
    /* Reported as "the click does not open it". The mechanism was sound; the
       target was 28px among 36px buttons and a real pointer missed it. This
       asserts the round trip so a regression in either direction fails. */
    const { container } = render(
      <RecordHeader
        accent
        collapsible
        recordType="approval"
        title="Send proposal"
        metrics={[{ label: "Value", value: "RM 18,500" }]}
      />,
    );

    const region = container.querySelector("[data-open]") as HTMLElement;
    const chevron = () => screen.getByRole("button", { name: /the record detail$/ });

    expect(chevron()).toHaveAttribute("aria-expanded", "true");
    expect(region.dataset.open).toBe("true");

    fireEvent.click(chevron());
    expect(chevron()).toHaveAttribute("aria-expanded", "false");
    expect(region.dataset.open).toBe("false");

    fireEvent.click(chevron());
    expect(chevron()).toHaveAttribute("aria-expanded", "true");
    expect(region.dataset.open).toBe("true");

    fireEvent.click(chevron());
    expect(region.dataset.open).toBe("false");

    /* And it is the size of the controls beside it, not the kit default. */
    expect(chevron().className).toContain("h-9");
  });

  it("puts the chevron at the card's far right, after the primary", () => {
    render(
      <RecordHeader
        accent
        collapsible
        recordType="approval"
        title="Send proposal"
        actions={<DangerButton>Reject</DangerButton>}
        primaryAction={<PrimaryButton>Approve</PrimaryButton>}
        metrics={[{ label: "Value", value: "RM 18,500" }]}
      />,
    );

    /* Chrome, not a fourth action: it sits PAST the cluster rather than inside
       it, where it read as a button competing with the three decisions. */
    const order = screen.getAllByRole("button").map((b) => b.textContent?.trim());
    expect(order).toEqual(["Reject", "Approve", "Hide the record detail"]);
  });

  it("sends the stepper out of the card, where its stage colours survive", () => {
    const { container } = render(
      <RecordHeader
        accent
        title="Aurora Manufacturing Sdn Bhd"
        metrics={[{ label: "Lifetime value", value: "RM 214,300" }]}
        stepper={<div data-testid="stepper">Enquiry → TNA → Proposal</div>}
      />,
    );

    const stepper = screen.getByTestId("stepper");
    /* Not on the blue: every stage would read the same white. */
    expect(stepper.closest("header")).toBeNull();
    expect(stepper.closest("[class*='surface-accent-gradient']")).toBeNull();
    /* But still at the card's width, directly beneath it. */
    const header = container.querySelector("header") as HTMLElement;
    expect(header.compareDocumentPosition(stepper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the stepper inside a plain header, where it always was", () => {
    render(
      <RecordHeader
        title="Aurora Manufacturing Sdn Bhd"
        metrics={[{ label: "Lifetime value", value: "RM 214,300" }]}
        stepper={<div data-testid="stepper">Enquiry → TNA → Proposal</div>}
      />,
    );
    expect(screen.getByTestId("stepper").closest("header")).not.toBeNull();
  });

  it("gives a destructive action on the card an outline, not a ghost or a fill", () => {
    render(
      <RecordHeader
        accent
        title="Send proposal"
        actions={<DangerButton>Reject</DangerButton>}
        primaryAction={<PrimaryButton>Approve</PrimaryButton>}
      />,
    );

    const reject = screen.getByRole("button", { name: "Reject" });
    /* A 1px rule is a non-text affordance at a 3:1 floor, which this colour
       clears on the ramp; red as a LABEL cannot reach 4.5:1 on this blue. */
    expect(reject.className).toContain("border-[rgb(var(--danger-on-accent))]");
    expect(reject.className).toContain("text-[rgb(var(--on-accent))]");
    expect(reject.className).not.toContain("bg-danger");
    /* Same geometry as the button beside it, so nothing shifts. */
    expect(reject.className).toContain("py-2");
  });

  it("drops to the plain surface when collapsed, if the screen asks", () => {
    const { container } = render(
      <RecordHeader
        accent
        collapsible
        plainWhenCollapsed
        recordType="approval"
        title="Send proposal"
        metrics={[{ label: "Value", value: "RM 18,500" }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide the record detail" }));

    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).not.toContain("surface-accent-gradient");
    /* And the ink comes back with the surface. */
    expect(screen.getByRole("heading", { level: 1 }).className).not.toContain("on-accent");
  });

  it("draws no chevron on a record that has nothing to collapse", () => {
    /* Nine of the eleven record pages pass chips and a ref but no metrics. A
       chevron there would open nothing. */
    render(
      <RecordHeader
        accent
        collapsible
        recordType="invoice"
        title="INV-2026-0288"
        recordRef="INV-2026-0288"
        meta={["34 days overdue"]}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("remembers the choice against the record TYPE, not the record", () => {
    const metrics = [{ label: "Value", value: "RM 18,500" }];
    const first = render(
      <RecordHeader
        accent
        collapsible
        recordType="approval"
        title="One"
        recordRef="APV-1"
        metrics={metrics}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide the record detail" }));
    first.unmount();

    render(
      <RecordHeader
        accent
        collapsible
        recordType="approval"
        title="Two"
        recordRef="APV-2"
        metrics={metrics}
      />,
    );
    expect(screen.getByRole("button", { name: "Show the record detail" })).toBeInTheDocument();
  });
});
