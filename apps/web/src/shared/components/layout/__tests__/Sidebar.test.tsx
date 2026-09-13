/**
 * The rail, as the reader experiences it.
 *
 * Four reported faults, one test each, plus the two design rules that make the
 * rail readable at 240px:
 *
 *  - a group that expanded but could never be collapsed again;
 *  - a rail that grew past the viewport because everything was open at once;
 *  - a native scrollbar painted down the edge the content card begins at;
 *  - a selected state that did not follow the route.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
      <Sidebar role="SALES" />
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

  it("uses indent and one selected treatment, and no third hierarchy device", () => {
    const { container } = renderAt("/training/programmes");
    const panel = container.querySelector("[data-open]");
    const list = within(panel as HTMLElement).getByRole("list");

    /* No connector rule down the children, and no bullet per row. */
    expect(list.className).not.toMatch(/border-l|border-connector/);
    expect(list.querySelectorAll("span[aria-hidden='true']")).toHaveLength(0);

    /* The parent of a selected child carries no lit background of its own. */
    const training = screen.getByRole("button", { name: /Training/ });
    expect(training.className).not.toMatch(/bg-card|bg-ai-tint/);
  });

  it("puts help, shortcuts, the role switch and the build stamp in the footer", () => {
    renderAt("/dashboard");

    expect(screen.getByRole("button", { name: "Help & support" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Role (development only)" })).toBeInTheDocument();
    expect(screen.getByText(/^TrainOS .+ · API v1 · contract /)).toBeInTheDocument();
  });

  it("puts identity at the TOP, under the wordmark, with the theme switch beside it", () => {
    const { container } = renderAt("/dashboard");
    const rail = screen.getByRole("navigation", { name: "Main" });

    const wordmark = screen.getByText("TRAINOS");
    const profile = screen.getByRole("button", { name: /Amirah Yusof/ });
    const nav = container.querySelector(".overflow-y-auto") as HTMLElement;

    /* Order in the document IS the order on screen here — the rail is a plain
       column. Wordmark, then who you are, then where you can go. */
    expect(
      wordmark.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
