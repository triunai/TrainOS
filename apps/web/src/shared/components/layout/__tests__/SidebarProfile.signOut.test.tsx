import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import type { AuthPort } from "@/shared/api";
import { AuthProvider } from "@/shared/auth";
import { toast } from "@/shared/components/kit";
import { I18nProvider } from "@/shared/i18n";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { ALEX, fakeAuth } from "@/shared/auth/__tests__/fakeAuth";
import { SidebarProfile } from "../SidebarProfile";

/**
 * The profile modal's "Sign out" is wired to the session in supabase mode and
 * nowhere else. Over fixtures there is no session to end, so it stays the
 * inert, drawn-but-disabled row it has always been.
 */

function renderProfile(port: AuthPort) {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthProvider port={port}>
          <MeContext.Provider value={{ me: FIXTURE_ME }}>
            <I18nProvider>
              <SidebarProfile collapsed={false} />
            </I18nProvider>
          </MeContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetStore();
  fixtureClient.setLatency(0);
});

afterEach(() => vi.unstubAllEnvs());

describe("SidebarProfile sign-out", () => {
  it("ends the session from the profile modal in supabase mode", async () => {
    vi.stubEnv("VITE_API_MODE", "supabase");
    const port = fakeAuth(ALEX);
    const user = userEvent.setup();
    renderProfile(port);

    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));
    const signOut = within(screen.getByRole("dialog")).getByRole("button", { name: /Sign out/ });
    expect(signOut).toBeEnabled();

    await user.click(signOut);

    await waitFor(() => expect(port.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says so when the session could not be ended, and offers to try again", async () => {
    vi.stubEnv("VITE_API_MODE", "supabase");
    const failing = vi.fn(async () => ({ error: "network down" }));
    const port = fakeAuth(ALEX, { signOut: failing });
    const error = vi.spyOn(toast, "error").mockImplementation(() => "toast");
    const user = userEvent.setup();
    renderProfile(port);

    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Sign out/ }));

    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    const [message, options] = error.mock.calls[0];
    expect(message).toBe("You're still signed in");
    expect(options?.description).not.toMatch(/network down/);
    options?.action?.onClick();
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2));
    error.mockRestore();
  });

  it("leaves sign-out inert over fixtures", async () => {
    vi.stubEnv("VITE_API_MODE", "fixtures");
    const port = fakeAuth(null);
    const user = userEvent.setup();
    renderProfile(port);

    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));

    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: /Sign out/ }),
    ).toBeDisabled();
    expect(port.signOut).not.toHaveBeenCalled();
  });
});
