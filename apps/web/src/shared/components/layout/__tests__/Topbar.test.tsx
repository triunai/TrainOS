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
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BreadcrumbProvider } from "../BreadcrumbProvider";
import { Topbar } from "../Topbar";

vi.mock("../useBadgeCounts", () => ({ useUnreadCount: () => 4 }));

const renderBar = () =>
  render(
    <MemoryRouter>
      <BreadcrumbProvider>
        <Topbar />
      </BreadcrumbProvider>
    </MemoryRouter>,
  );

describe("Topbar", () => {
  it("keeps search and the notification bell", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notification/i })).toBeInTheDocument();
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
