/**
 * The rail, as the reader experiences it.
 *
 * Four reported faults, one test each:
 *
 *  - a group that expanded but could never be collapsed again;
 *  - a rail that grew past the viewport because everything was open at once;
 *  - a native scrollbar painted down the edge the content card begins at;
 *  - a selected state that did not follow the route.
 *
 * Then the GEOMETRY, which is the fifth fault and the reason for the rest of
 * this file. A pass here once stripped the pack's tint, connector and dots
 * down to "indent plus one selected row" and the rail went to a flat black
 * column. The pack's own geometry proof (sidebar width 240) fixes every
 * coordinate, so the coordinates are asserted rather than the class strings:
 * each test below recomputes an x position out of the classes the component
 * actually ships and checks the NUMBER, so a plausible-looking edit to the
 * padding or the indent fails here instead of on screen.
 *
 * jsdom lays nothing out, so the arithmetic is the layout: the rail is
 * `w-sidebar` with `px-3`, which is the proof's x12 -> x228 content box, and
 * every offset below is measured from it.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/shared/i18n";
import { Sidebar } from "../Sidebar";

vi.mock("@/shared/hooks/useMe", () => ({
  useMe: () => ({
    me: {
      id: "USR-0001",
      name: "Amirah Yusof",
      role: "SALES",
      permissions: [],
      dataScope: { clients: "MY_ACCOUNTS", teams: "MY_TEAM" },
      locale: "en-MY",
      timezone: "Asia/Kuala_Lumpur",
      theme: "SYSTEM",
    },
    setRole: vi.fn(),
  }),
}));

const setThemeSpy = vi.fn();

vi.mock("@/shared/theme", async () => {
  const actual = await vi.importActual<typeof import("@/shared/theme")>("@/shared/theme");
  return {
    ...actual,
    useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: setThemeSpy }),
  };
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <Sidebar role="SALES" />
      </I18nProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.clear();
  setThemeSpy.mockClear();
});

describe("Sidebar", () => {
  it("collapses a group it opened — the toggle is not one-way", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard");
    const training = screen.getByRole("button", { name: /Training/ });

    expect(training).toHaveAttribute("aria-expanded", "false");
    await user.click(training);
    expect(training).toHaveAttribute("aria-expanded", "true");
    await user.click(training);
    expect(training).toHaveAttribute("aria-expanded", "false");
  });

  it("responds to the keyboard, because the disclosure is a real button", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard");
    const training = screen.getByRole("button", { name: /Training/ });

    training.focus();
    await user.keyboard("{Enter}");
    expect(training).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(training).toHaveAttribute("aria-expanded", "false");
  });

  it("opens only the group holding the route, and leaves the rest closed", () => {
    renderAt("/training/programmes");
    const expanded = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-expanded") === "true");

    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toHaveAccessibleName(expect.stringContaining("Training"));
  });

  it("lets the reader close the group they navigated into", async () => {
    const user = userEvent.setup();
    renderAt("/training/programmes");
    const training = screen.getByRole("button", { name: /Training/ });

    expect(training).toHaveAttribute("aria-expanded", "true");
    await user.click(training);
    /* The auto-open must not fight the reader on the next render. */
    expect(training).toHaveAttribute("aria-expanded", "false");
  });

  it("remembers what the reader opened", async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt("/dashboard");
    await user.click(screen.getByRole("button", { name: /Training/ }));
    unmount();

    renderAt("/dashboard");
    expect(screen.getByRole("button", { name: /Training/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("selects exactly one row, and it is the one the route names", () => {
    const { container } = renderAt("/training/engagements/ENG-0231");
    const selected = [...container.querySelectorAll("a, button")].filter((row) =>
      row.className.includes("bg-card"),
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("Engagements");
  });

  it("scrolls the list, not the rail, so the footer stays pinned", () => {
    renderAt("/dashboard");
    const rail = screen.getByRole("navigation", { name: "Main" });
    const scroller = rail.querySelector(".overflow-y-auto");

    expect(scroller).not.toBeNull();
    expect(rail.className).not.toMatch(/overflow-y-auto/);
    /* Hiding the bar until it is scrolled is a site-wide base rule and a
       delegated listener, not a class this component opts into. */
    expect(rail.innerHTML).not.toMatch(/scrollbar-none/);
  });

  describe("geometry — the pack's proof, at sidebar width 240", () => {
    /** Tailwind's spacing scale, for the steps this component uses. */
    const STEP: Record<string, number> = {
      "1.5": 6,
      "2": 8,
      "2.5": 10,
      "3": 12,
      "4": 16,
    };

    /**
     * The px value a utility contributes, whether it is written on the scale
     * (`pl-2`) or as an exact value the scale has no step for (`pl-[30px]`).
     * Anything else is a test failure rather than a zero, because a silently
     * unread class is exactly how a geometry drifts.
     */
    const px = (className: string, prefix: string): number => {
      const arbitrary = new RegExp(`(?:^|\\s)${prefix}-\\[(\\d+)px\\]`).exec(className);
      if (arbitrary) return Number(arbitrary[1]);
      const scaled = new RegExp(`(?:^|\\s)${prefix}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`).exec(className);
      if (scaled && STEP[scaled[1]] !== undefined) return STEP[scaled[1]];
      throw new Error(`no readable "${prefix}-" utility in: ${className}`);
    };

    /** x12: the rail's own inner edge, which every other number hangs off. */
    const RAIL_INSET = 12;

    const railParts = () => {
      renderAt("/training/programmes");
      const rail = screen.getByRole("navigation", { name: "Main" });
      const training = screen.getByRole("button", { name: /Training/ });
      /* Every parent renders a Collapse, so the panel has to be the one this
         button drives — the first `[data-open]` in the tree belongs to
         whichever parent happens to sort first. */
      const panel = document.getElementById(
        training.getAttribute("aria-controls") as string,
      ) as HTMLElement;
      const list = within(panel).getByRole("list");
      const line = list.querySelector("[data-tree-line]") as HTMLElement;
      const items = [...list.querySelectorAll("li")];
      const selected = list.querySelector("[data-selected]") as HTMLElement;
      return { rail, training, list, line, items, selected };
    };

    it("puts the parent row on x12 -> x228, 36px, radius 8", () => {
      const { rail, training } = railParts();

      expect(rail.className).toMatch(/\bw-sidebar\b/);
      expect(px(rail.className, "px")).toBe(RAIL_INSET);
      expect(training.className).toMatch(/\bh-9\b/);
      expect(training.className).toMatch(/\brounded-control\b/);
      expect(training.className).toMatch(/\bw-full\b/);
    });

    it("puts the icon box on x20 -> x38 and its glyph's centre on x29", () => {
      const { training } = railParts();
      const box = training.querySelector("[data-icon-box]") as HTMLElement;

      const left = RAIL_INSET + px(training.className, "px");
      const width = px(box.className, "w");

      expect(left).toBe(20);
      expect(width).toBe(18);
      expect(left + width).toBe(38);
      expect(left + width / 2).toBe(29);
    });

    it("puts the parent label on x48 and the child label on x66", () => {
      const { training, selected } = railParts();
      const box = training.querySelector("[data-icon-box]") as HTMLElement;

      const parentLabel =
        RAIL_INSET +
        px(training.className, "px") +
        px(box.className, "w") +
        px(training.className, "gap");
      expect(parentLabel).toBe(48);

      const li = selected.closest("li") as HTMLElement;
      const childLabel =
        RAIL_INSET +
        px(li.className, "pl") +
        px(selected.className, "pl") +
        px((selected.querySelector("[data-dot]") as HTMLElement).className, "w") +
        px(selected.className, "gap");
      expect(childLabel).toBe(66);
      /* The pack states the relationship, not just the two numbers. */
      expect(childLabel - parentLabel).toBe(18);
    });

    it("runs one continuous tree line down x29, ending on the last dot's centre", () => {
      const { list, line, items } = railParts();

      expect(line).not.toBeNull();
      expect(items.length).toBeGreaterThan(1);

      /* x29 — the same x as the icon glyph's centre, which is what makes the
         line read as descending FROM the parent rather than beside it. */
      expect(RAIL_INSET + px(line.className, "left")).toBe(29);
      expect(line.className).toMatch(/\bw-px\b/);
      expect(line.className).toMatch(/\bbg-connector\b/);

      /* One element for the whole list, anchored top and bottom: it cannot be
         broken by the rows it passes, and it cannot fall out of step with the
         child count. */
      expect(list.querySelectorAll("[data-tree-line]")).toHaveLength(1);
      expect(line.className).toMatch(/\btop-0\b/);
      /* Half a 34px row: the centre of the last dot, for any number of rows. */
      expect(px(line.className, "bottom")).toBe(17);
      expect(px(line.className, "bottom") * 2).toBe(px(items[0].firstElementChild!.className, "h"));
    });

    it("cards the active child on x42 -> x228, clear of the line by 13px", () => {
      const { line, selected } = railParts();
      const li = selected.closest("li") as HTMLElement;

      const cardLeft = RAIL_INSET + px(li.className, "pl");
      expect(cardLeft).toBe(42);
      expect(cardLeft - (RAIL_INSET + px(line.className, "left"))).toBe(13);

      expect(px(selected.className, "h")).toBe(34);
      expect(selected.className).toMatch(/\brounded-control\b/);
      /* The lift is the kit's card token in both themes, not a literal. */
      expect(selected.className).toMatch(/\bbg-card\b/);
      expect(selected.className).toMatch(/\bshadow-card\b/);
    });

    it("centres every child dot on x52, 6px, and fills only the active one", () => {
      const { items, selected } = railParts();
      const li = selected.closest("li") as HTMLElement;

      const dot = selected.querySelector("[data-dot]") as HTMLElement;
      const dotLeft = RAIL_INSET + px(li.className, "pl") + px(selected.className, "pl");
      const size = px(dot.className, "w");

      expect(size).toBe(6);
      expect(dotLeft + size / 2).toBe(52);
      expect(dot.className).toMatch(/\bbg-primary\b/);
      expect(dot.className).toMatch(/\brounded-full\b/);

      /* Every row is a rung; only one is lit. */
      const dots = items.map((item) => item.querySelector("[data-dot]") as HTMLElement);
      expect(dots.every(Boolean)).toBe(true);
      expect(dots.filter((each) => each.className.includes("bg-primary"))).toHaveLength(1);
      expect(dots.filter((each) => each.className.includes("bg-ink-muted"))).toHaveLength(
        items.length - 1,
      );
    });

    it("stops the badge on x212, inside the card", () => {
      const { selected } = railParts();
      const li = selected.closest("li") as HTMLElement;

      const cardRight = 228;
      expect(RAIL_INSET + px(li.className, "pl")).toBe(42);
      expect(cardRight - px(selected.className, "pr")).toBe(212);
    });

    it("lights the parent that HOLDS the active child, and leaves the rest neutral", () => {
      const { training } = railParts();

      /* The pack's tinted row samples #EBF1FE, which is --ai-tint-2 exactly —
         the token whose own note reads "selected row, active nav". */
      expect(training.className).toMatch(/\bbg-ai-tint-2\b/);
      expect(training.className).toMatch(/\btext-primary\b/);
      expect(training).toHaveAttribute("data-lit", "true");

      const others = screen
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-expanded") !== null && button !== training);
      expect(others.length).toBeGreaterThan(0);
      for (const other of others) {
        expect(other).not.toHaveAttribute("data-lit");
        expect(other.className).not.toMatch(/bg-ai-tint|bg-card/);
      }
    });
  });

  it("puts help, shortcuts, the role switch and the build stamp in the footer", () => {
    renderAt("/dashboard");

    expect(screen.getByRole("button", { name: "Help & support" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Role (development only)" })).toBeInTheDocument();
    expect(screen.getByText(/^TrainOS .+ · API v1 · contract /)).toBeInTheDocument();
  });

  it("puts identity at the TOP of the rail, with the theme switch beside it", () => {
    const { container } = renderAt("/dashboard");
    const rail = screen.getByRole("navigation", { name: "Main" });

    const profile = screen.getByRole("button", { name: /Amirah Yusof/ });
    const nav = container.querySelector(".overflow-y-auto") as HTMLElement;

    /* Order in the document IS the order on screen here — the rail is a plain
       column. Who you are first, then where you can go. There is no wordmark:
       the product name lives in the footer build stamp and nowhere else. */
    expect(screen.queryByText("TRAINOS")).toBeNull();
    expect(rail.firstElementChild).toContainElement(profile);
    expect(profile.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByRole("switch", { name: "Dark mode" })).toBeInTheDocument();
    expect(rail.className).not.toMatch(/w-rail/);
  });

  it("has no rail-collapse control at all", () => {
    renderAt("/dashboard");

    expect(screen.queryByRole("button", { name: /Collapse the sidebar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Expand the sidebar/ })).toBeNull();
    expect(window.localStorage.getItem("trainos.sidebar.collapsed")).toBeNull();
  });

  it("keeps the theme out of any menu — it is one click, beside the name", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard");

    await user.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(setThemeSpy).toHaveBeenCalledWith("dark");
  });
});
