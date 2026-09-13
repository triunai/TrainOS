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

import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role } from "@trainos/contract";
import { ApiProvider } from "@/shared/api";
import { I18nProvider } from "@/shared/i18n";
import { BreadcrumbProvider } from "../BreadcrumbProvider";
import { Sidebar } from "../Sidebar";
import { Topbar } from "../Topbar";

vi.mock("../useBadgeCounts", () => ({ useUnreadCount: () => 4 }));

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

/**
 * The profile band reads `GET /v1/me/profile` through the query cache, so the
 * rail needs a client even in a test that is only measuring its geometry. The
 * query is `enabled` only while the modal is open, so the tests below that
 * never open it make no request at all.
 */
const withProviders = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ApiProvider>
      <I18nProvider>{children}</I18nProvider>
    </ApiProvider>
  </QueryClientProvider>
);

/** The route, in the DOM, so a test can assert that a click did NOT move it. */
function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-pathname={pathname} />;
}

/** `ADMIN` is the one shell role whose tree holds a LEAF parent — Reports, the
    only nav item that is a link rather than a disclosure, and therefore the
    only one that can prove the closed rail swallows a navigation. */
const renderAt = (path: string, role: Role = "SALES") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      {withProviders(
        <>
          <Sidebar role={role} />
          <LocationProbe />
        </>,
      )}
    </MemoryRouter>,
  );

const pathname = () => (document.querySelector("[data-pathname]") as HTMLElement).dataset.pathname;

/** The rail and the bar together, which is the only way to compare their tops. */
const renderShellTop = () =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      {withProviders(
        <BreadcrumbProvider>
          <Topbar />
          <Sidebar role="SALES" />
        </BreadcrumbProvider>,
      )}
    </MemoryRouter>,
  );

/** The height utility a row ships, whether it is a token or a literal. */
const heightClass = (el: HTMLElement) => /(?:^|\s)(h-\S+)/.exec(el.className)?.[1];

const profileBand = () =>
  screen.getByRole("navigation", { name: "Main" }).firstElementChild as HTMLElement;

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
      .filter((button) => button.getAttribute("aria-expanded") === "true")
      /* The rail's own collapse control is a disclosure too, and it is open. */
      .filter((button) => !button.hasAttribute("data-rail-toggle"));

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
      /* `text-primary-hover`, and matched to the END of the class rather than
         with a trailing `\b`: `/\btext-primary\b/` matches BOTH names, because
         the hyphen it stops at is a word boundary. That is how the row sat on
         `text-primary` at 4.05:1 on the dark map with a green test over it.
         Every other consumer of this tint pairs it with `--primary-hover`. */
      expect(training.className).toMatch(/\btext-primary-hover(?:\s|$)/);
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

    expect(rail.className).not.toMatch(/w-rail/);
  });

  /**
   * THE THEME SWITCH IS BESIDE THE NAME. 64d464d moved it into the profile
   * modal to buy room for a collapse control in this band; the control went to
   * the caption row instead, and the switch came back to the row it describes.
   */
  it("keeps the theme switch in the band beside the name, not inside the modal", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard");
    const band = profileBand();

    const themeSwitch = screen.getByRole("switch", { name: "Dark mode" });
    expect(band).toContainElement(themeSwitch);
    /* Last child of the band IS its right edge — the band is a plain row. */
    expect(band.lastElementChild?.contains(themeSwitch)).toBe(true);
    /* One click, no menu and no modal in the way. */
    await user.click(themeSwitch);
    expect(setThemeSpy).toHaveBeenCalledWith("dark");
    expect(screen.queryByRole("dialog")).toBeNull();

    /* And it is not ALSO in the modal: two switches for one preference is the
       divergence the consolidation rule exists to stop. */
    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByRole("switch", { name: "Dark mode" })).toBeNull();
  });

  it("gives the name the room the switch does not take: nothing in the band truncates", () => {
    renderAt("/dashboard");
    const band = profileBand();

    /* The band is 216px of content box and the name has to survive it. The
       stack is `min-w-0 flex-1` inside a `min-w-0 flex-1` button, which is what
       lets the text shrink rather than push the switch off the row — jsdom
       lays nothing out, so the assertion is the mechanism, and the pixels are
       measured in the browser. */
    const name = within(band).getByText("Amirah Yusof");
    expect(name.parentElement?.className).toMatch(/\bmin-w-0\b/);
    expect(name.closest("button")?.className).toMatch(/\bmin-w-0\b/);
    expect(screen.getByRole("switch", { name: "Dark mode" }).closest("span")?.className).toMatch(
      /\binline-flex\b/,
    );
  });

  /**
   * THE TOP BAND. The rail's first row and the breadcrumb are the two things
   * at the top of the frame and the pack draws them on one line. They were not
   * on one line: the rail's `py-4` plus the row's own `pt-2 pb-4` ran the band
   * to 72px starting 16px down, so the role line crossed the bar's 56px bottom
   * edge and read as clipped against the content card (73.png).
   */
  describe("the profile band is the top bar's own height", () => {
    it("takes its height from the SAME token the top bar does", () => {
      const { container } = renderShellTop();
      const bar = container.querySelector("header") as HTMLElement;
      const band = profileBand();

      /* Equal because it is one token, not because two literals agree today. */
      expect(heightClass(band)).toBe("h-topbar");
      expect(heightClass(bar)).toBe("h-topbar");
      expect(heightClass(band)).toBe(heightClass(bar));
    });

    it("centres the row in the band instead of padding it out of it", () => {
      renderAt("/dashboard");
      const band = profileBand();

      expect(band).toHaveClass("items-center");
      /* Vertical padding on a fixed-height band is how the row left it. */
      expect(band.className).not.toMatch(/\b(?:py|pt|pb)-/);
      expect(screen.getByRole("navigation", { name: "Main" }).className).not.toMatch(
        /\b(?:py|pt)-/,
      );
    });

    it("clips nothing: the band hides no overflow, it fits", () => {
      renderAt("/dashboard");
      const band = profileBand();
      const rail = screen.getByRole("navigation", { name: "Main" });

      expect(band.className).not.toMatch(/overflow-hidden/);
      expect(rail.className).not.toMatch(/overflow-hidden/);

      /* 18 + 15 = 33px of type inside 56px. Explicit leading, because
         `text-[13px]` sets a font size and nothing else — inherited leading
         would put the stack's height outside this component's control, which
         is exactly how it overran the band. */
      const name = within(band).getByText("Amirah Yusof");
      const role = within(band).getByText("Sales Consultant");
      expect(name.className).toMatch(/leading-\[18px\]/);
      expect(role.className).toMatch(/leading-\[15px\]/);
    });
  });

  /**
   * THE COLLAPSE CONTROL. 63888e5 put it at the footer's edge, 0abe2ad removed
   * it, 64d464d put it in the profile band; it is on the MAIN caption row now,
   * right-aligned, and the band spends its 216px on the name and the switch.
   * The footer chevron stays gone.
   */
  describe("the rail collapses, from the MAIN caption row", () => {
    const control = () => screen.getByRole("button", { name: /the sidebar/ });
    const captionRows = () => [
      ...screen.getByRole("navigation", { name: "Main" }).querySelectorAll("[data-caption-row]"),
    ];

    it("sits on the first caption row, not in the band and not in the footer", () => {
      renderAt("/dashboard");
      const rows = captionRows();

      /* The row the caption MAIN is printed on, and its last child, which is
         its right edge — the row is a plain flex row. */
      expect(rows.length).toBeGreaterThan(1);
      expect(rows[0]).toHaveTextContent("Main");
      expect(rows[0]).toContainElement(control());
      expect(rows[0].lastElementChild).toBe(control());

      /* Exactly one row carries it: a control per group would be four. */
      for (const row of rows.slice(1)) expect(row).not.toContainElement(control());

      expect(profileBand()).not.toContainElement(control());
      const footer = screen.getByRole("button", { name: "Help & support" })
        .parentElement as HTMLElement;
      expect(footer).not.toContainElement(control());
      expect(footer.textContent).not.toMatch(/[«»]/);
    });

    it("is 24px, and every caption row is the same height whether it holds it or not", () => {
      renderAt("/dashboard");
      const rows = captionRows();

      expect(control().className).toMatch(/\bh-6\b/);
      expect(control().className).toMatch(/\bw-6\b/);
      /* One rhythm: MAIN must not be a taller group than the rest just for
         carrying a button. */
      for (const row of rows) expect(heightClass(row as HTMLElement)).toBe("h-6");
    });

    it("ends on x220, the column every group's disclosure glyph already ends on", () => {
      renderAt("/dashboard");
      const row = captionRows()[0] as HTMLElement;
      const parent = screen.getByRole("button", { name: /Training/ });

      /* The caption row carries the PARENT row's own padding, which is the
         whole mechanism: x12 + px-2 = x20 for the caption and the icon boxes
         alike, and 240 - 12 - 8 = x220 for the control and for the +/- glyph
         beneath it. Measured in the browser at 1440 and 1920, both themes. */
      expect(/(?:^|\s)px-2(?:\s|$)/.test(row.className)).toBe(true);
      expect(/(?:^|\s)px-2(?:\s|$)/.test(parent.className)).toBe(true);
      /* `flex-1` on the caption is what pushes the control to that edge — a
         `ml-auto` would read the same until a caption ran long. */
      expect((row.firstElementChild as HTMLElement).className).toMatch(/\bflex-1\b/);
    });

    it("is a disclosure button: aria-expanded, and it names the rail", () => {
      renderAt("/dashboard");
      const rail = screen.getByRole("navigation", { name: "Main" });

      expect(control()).toHaveAccessibleName("Collapse the sidebar");
      expect(control()).toHaveAttribute("aria-expanded", "true");
      expect(control().getAttribute("aria-controls")).toBe(rail.id);
      expect(rail.id).not.toBe("");
    });

    it("keeps the control where the caption row was, once the rail is closed", async () => {
      const user = userEvent.setup();
      renderAt("/dashboard");
      await user.click(control());

      const rail = screen.getByRole("navigation", { name: "Main" });
      const rows = [...rail.querySelectorAll("[data-caption-row]")];

      /* One row left, holding the control alone: no caption survives 64px. */
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContainElement(control());
      expect(rows[0].textContent).not.toMatch(/Main/i);
      expect(rows[0].className).toMatch(/justify-center/);
      /* Still above the navigation, where the reader last saw it. */
      expect(
        control().compareDocumentPosition(screen.getByRole("button", { name: /Training/ })) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("collapses to the 64px rail and expands back", async () => {
      const user = userEvent.setup();
      renderAt("/dashboard");
      const rail = screen.getByRole("navigation", { name: "Main" });

      expect(rail.className).toMatch(/\bw-sidebar\b/);
      await user.click(control());

      expect(rail.className).toMatch(/\bw-rail\b/);
      expect(rail.className).not.toMatch(/\bw-sidebar\b/);
      expect(control()).toHaveAccessibleName("Expand the sidebar");
      expect(control()).toHaveAttribute("aria-expanded", "false");

      await user.click(control());
      expect(rail.className).toMatch(/\bw-sidebar\b/);
    });

    it("remembers the rail across reloads, under the key 63888e5 wrote", async () => {
      const user = userEvent.setup();
      const { unmount } = renderAt("/dashboard");
      await user.click(control());
      expect(window.localStorage.getItem("trainos.sidebar.collapsed")).toBe("true");
      unmount();

      renderAt("/dashboard");
      expect(screen.getByRole("navigation", { name: "Main" }).className).toMatch(/\bw-rail\b/);
    });

    it("toggles on `[`, and not while someone is typing", async () => {
      const user = userEvent.setup();
      renderAt("/dashboard");
      const rail = screen.getByRole("navigation", { name: "Main" });

      /* `[[` is how user-event types a literal `[`: a single one opens its
         own key-descriptor syntax. */
      await user.keyboard("[[");
      expect(rail.className).toMatch(/\bw-rail\b/);
      await user.keyboard("[[");
      expect(rail.className).toMatch(/\bw-sidebar\b/);

      /* A bare key that fires inside a field would shut the rail every time
         someone typed a bracket into search. */
      const field = document.createElement("input");
      document.body.appendChild(field);
      field.focus();
      await user.keyboard("[[");
      expect(rail.className).toMatch(/\bw-sidebar\b/);
      field.remove();
    });

    it("in the rail: icons with tooltips, counts as dots, the branch still lit", async () => {
      const user = userEvent.setup();
      renderAt("/training/programmes");
      await user.click(control());

      const training = screen.getByRole("button", { name: /Training/ });
      expect(training).toHaveAttribute("title", "Training");
      expect(training.className).toMatch(/justify-center/);
      /* The branch you are in is still the one lit row. */
      expect(training).toHaveAttribute("data-lit", "true");

      /* No child rows at 64px, and no group captions either. */
      expect(screen.queryByRole("link", { name: /Programmes/ })).toBeNull();
      expect(screen.queryByText("OPERATIONS")).toBeNull();

      const rail = screen.getByRole("navigation", { name: "Main" });
      expect(rail.querySelectorAll("[data-badge-dot]").length).toBeGreaterThan(0);
      expect(rail.innerHTML).not.toMatch(/min-w-\[20px\]/);
    });
  });

  /**
   * THE CLOSED RAIL IS ONE BIG OPEN BUTTON. A column of unlabelled glyphs is a
   * thing a reader clicks to find out what it is, so every click inside it
   * spends itself opening the rail and does nothing else — no navigation, no
   * modal, no menu, no group. Once open, every item behaves normally.
   */
  describe("the closed rail opens from anywhere inside it", () => {
    const control = () => screen.getByRole("button", { name: /the sidebar/ });

    /** Collapsed, at a route the rail can light, for whichever role's tree. */
    const closedRail = async (user: ReturnType<typeof userEvent.setup>, role?: Role) => {
      renderAt("/training/programmes", role);
      await user.click(control());
      const rail = screen.getByRole("navigation", { name: "Main" });
      expect(rail.className).toMatch(/\bw-rail\b/);
      return rail;
    };

    it("opens on a click on a group glyph, and does not open that group", async () => {
      const user = userEvent.setup();
      const rail = await closedRail(user);

      await user.click(screen.getByRole("button", { name: "Sales" }));
      expect(rail.className).toMatch(/\bw-sidebar\b/);
      /* The click was spent on the rail. Sales is where it was. */
      expect(screen.getByRole("button", { name: "Sales" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    it("opens on a click on the avatar, and does not open the profile modal", async () => {
      const user = userEvent.setup();
      const rail = await closedRail(user);

      await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));
      expect(rail.className).toMatch(/\bw-sidebar\b/);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens on a click on a leaf link, and does not navigate", async () => {
      const user = userEvent.setup();
      const rail = await closedRail(user, "ADMIN");

      const reports = screen.getByRole("link", { name: "Reports" });
      await user.click(reports);

      expect(rail.className).toMatch(/\bw-sidebar\b/);
      expect(pathname()).toBe("/training/programmes");
      /* And the rail did not repaint around a route it never went to. */
      expect(reports).not.toHaveAttribute("data-lit");
      expect(screen.getByRole("button", { name: "Training" })).toHaveAttribute("data-lit", "true");
    });

    it("opens on a click on a footer row, and does not open its drawer", async () => {
      const user = userEvent.setup();
      const rail = await closedRail(user);

      await user.click(screen.getByRole("button", { name: "Help & support" }));
      expect(rail.className).toMatch(/\bw-sidebar\b/);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens on a click on the empty rail surface", async () => {
      const user = userEvent.setup();
      const rail = await closedRail(user);

      await user.click(rail);
      expect(rail.className).toMatch(/\bw-sidebar\b/);
    });

    it("opens on Enter or Space on a focused rail item, exactly once", async () => {
      const user = userEvent.setup();
      const rail = await closedRail(user, "ADMIN");

      screen.getByRole("button", { name: "Sales" }).focus();
      await user.keyboard("{Enter}");
      /* Once, not twice: preventing the key's default is also what stops a
         focused button from synthesising the click that would close it again. */
      expect(rail.className).toMatch(/\bw-sidebar\b/);
      expect(screen.getByRole("button", { name: "Sales" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      await user.click(control());
      expect(rail.className).toMatch(/\bw-rail\b/);

      /* Space on a link does nothing at all natively, so it is the case a
         click-only guard would miss. */
      screen.getByRole("link", { name: "Reports" }).focus();
      await user.keyboard(" ");
      expect(rail.className).toMatch(/\bw-sidebar\b/);
      expect(pathname()).toBe("/training/programmes");
    });

    it("navigates and opens normally once the rail is open", async () => {
      const user = userEvent.setup();
      const rail = await closedRail(user, "ADMIN");
      await user.click(rail);
      expect(rail.className).toMatch(/\bw-sidebar\b/);

      await user.click(screen.getByRole("button", { name: "Sales" }));
      expect(screen.getByRole("button", { name: "Sales" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      await user.click(screen.getByRole("link", { name: "Reports" }));
      expect(pathname()).toBe("/reports");

      await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });
  });
});
