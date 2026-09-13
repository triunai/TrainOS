/**
 * The top bar after the chrome moved out of it.
 *
 * Two things it must hold and three it must not. The bar is about WHERE YOU
 * ARE and WHAT CHANGED; identity, theme and the development role switch are
 * about the tool, they never change as you navigate, and they now live in the
 * sidebar's footer. The surface assertion is the other half of the same fix:
 * the bar and the rail are one ground, so there is no cutoff at the junction.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/shared/i18n";
import { BreadcrumbProvider } from "../BreadcrumbProvider";
import { Topbar } from "../Topbar";

vi.mock("../useBadgeCounts", () => ({ useUnreadCount: () => 4 }));

vi.mock("@/shared/hooks/useMe", () => ({
  useMe: () => ({
    me: { id: "USR-0001", name: "Amirah Yusof", role: "SALES", locale: "en-MY" },
    setRole: vi.fn(),
  }),
}));

const renderBar = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <BreadcrumbProvider>
          <Topbar />
        </BreadcrumbProvider>
      </I18nProvider>
    </MemoryRouter>,
  );

describe("Topbar", () => {
  it("keeps search and the notification bell", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notification/i })).toBeInTheDocument();
  });

  it("draws the unread COUNT on the bell, as every artboard does", () => {
    renderBar();
    /* Four: approvals plus HRD Corp deadlines plus agent failures, which is
       what M06's top bar shows. A dot says a queue exists; the number is what
       decides whether the reader goes there now. */
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications, 4 unread" })).toBeInTheDocument();
  });

  it("carries the EN | BM switch", () => {
    renderBar();
    const group = screen.getByRole("group", { name: "Language" });

    expect(within(group).getByRole("button", { name: "EN" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(group).getByRole("button", { name: "BM" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("no longer carries the theme select, the role select or the avatar", () => {
    renderBar();
    expect(screen.queryByLabelText("Theme")).toBeNull();
    expect(screen.queryByLabelText("Role (development only)")).toBeNull();
    expect(screen.queryByText("Amirah Yusof")).toBeNull();
  });

  it("paints the sidebar's surface and draws no line under itself", () => {
    const { container } = renderBar();
    const bar = container.querySelector("header") as HTMLElement;

    expect(bar).toHaveClass("bg-sidebar");
    expect(bar.className).not.toMatch(/border-b/);
  });

  it("uses the pack's 4px / 20px padding", () => {
    const { container } = renderBar();
    const bar = container.querySelector("header") as HTMLElement;

    expect(bar).toHaveClass("pl-1");
    expect(bar).toHaveClass("pr-5");
  });
});
