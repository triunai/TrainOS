/**
 * The rail footer's "Reset demo data" row: present only where the page keeps
 * demo changes, and it asks before it forgets anything.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/shared/i18n";
import { SidebarFooter } from "../SidebarFooter";

const demo = vi.hoisted(() => ({ enabled: false, reset: vi.fn() }));

vi.mock("@/shared/api", async () => {
  const actual = await vi.importActual<typeof import("@/shared/api")>("@/shared/api");
  return {
    ...actual,
    isDemoPersistenceEnabled: () => demo.enabled,
    resetDemoData: demo.reset,
  };
});

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

const renderFooter = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <SidebarFooter />
      </I18nProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  demo.enabled = false;
  demo.reset.mockClear();
});

describe("SidebarFooter · Reset demo data", () => {
  it("is absent when the page does not keep demo changes", () => {
    renderFooter();
    expect(screen.queryByRole("button", { name: "Reset demo data" })).not.toBeInTheDocument();
  });

  it("asks first, and Cancel forgets nothing", async () => {
    demo.enabled = true;
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole("button", { name: "Reset demo data" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset the demo data?" });
    expect(dialog).toHaveTextContent("Every change made in this browser");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(demo.reset).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resets on confirm", async () => {
    demo.enabled = true;
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole("button", { name: "Reset demo data" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset the demo data?" });
    await user.click(within(dialog).getByRole("button", { name: "Reset demo data" }));
    expect(demo.reset).toHaveBeenCalledOnce();
  });
});
