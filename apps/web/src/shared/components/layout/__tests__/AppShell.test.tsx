/**
 * The shell frame.
 *
 * The pack's 1440x900 artboards all draw the same frame, and these are the
 * numbers they draw it with (`docs/research/09-design-pack-inventory.md` §5,
 * confirmed against the inline styles in `docs/design/*.dc.html`):
 *
 *   - the sidebar is 240px and the top bar 56px;
 *   - the content card takes `margin:0 14px 14px 0` — flush to the sidebar's
 *     right edge and the top bar's bottom edge, 14px of canvas on its right
 *     and below it (50 of 50 internal artboards);
 *   - the card is `display:flex; flex-direction:column`, and its page template
 *     is a fixed header block plus a `flex:1; min-height:0` body that owns its
 *     own scroll pane.
 *
 * That last line is the one worth a test. It is invisible until a screen
 * relies on it: the inbox and dashboard templates declare `min-h-0 flex-1` on
 * their root, and when the card was a plain block those declarations were
 * inert, so the inbox grew to 2080px inside an 828px card instead of fitting
 * it. Nothing failed — it just silently stopped being the pack's layout.
 *
 * jsdom cannot measure a box, so this pins the contract that produces the box.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../AppShell";

vi.mock("@/shared/hooks/useMe", () => ({
  useMe: () => ({ me: { role: "SALES_CONSULTANT" } }),
}));

vi.mock("../Sidebar", () => ({
  Sidebar: () => <nav aria-label="Main" />,
}));

vi.mock("../Topbar", () => ({
  Topbar: () => <header />,
}));

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>a screen</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe("AppShell", () => {
  it("renders the route inside the content card", () => {
    renderShell();
    expect(screen.getByText("a screen")).toBeInTheDocument();
  });

  it("makes the content card a flex column so a screen's `flex-1` body can fill it", () => {
    renderShell();
    const card = screen.getByRole("main");

    expect(card).toHaveClass("flex");
    expect(card).toHaveClass("flex-col");
    expect(card).toHaveClass("min-h-0");
  });

  it("gives the content card the scroll, so the document never scrolls", () => {
    renderShell();
    const card = screen.getByRole("main");

    expect(card).toHaveClass("overflow-y-auto");
    expect(card).toHaveClass("flex-1");
  });

  it("insets the card on its right and bottom only, as the pack does", () => {
    renderShell();
    const card = screen.getByRole("main");

    expect(card).toHaveClass("mr-inset");
    expect(card).toHaveClass("mb-inset");
    /* Flush to the sidebar and the top bar. A left or top inset here is the
       divergence, not the fix. */
    expect(card.className).not.toMatch(/\bml-inset\b/);
    expect(card.className).not.toMatch(/\bmt-inset\b/);
  });

  it("paints one ground behind the rail, the bar and the card's gutters", () => {
    const { container } = renderShell();
    const root = container.firstElementChild as HTMLElement;

    /* The pack draws its whole frame on a single colour with the card as the
       only other plane. A second surface token here is what put a visible
       cutoff at the rail-to-bar junction. */
    expect(root).toHaveClass("bg-sidebar");
  });

  it("fills the viewport height and clips at it", () => {
    const { container } = renderShell();
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass("h-dvh");
    expect(root).toHaveClass("overflow-hidden");
  });
});
