import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ContractError } from "@trainos/fixtures";
import type { Me } from "@trainos/contract";
import { ApiErrorException, transportError, type AuthPort } from "@/shared/api";
import { AuthProvider } from "@/shared/auth";
import { resetPrimaries } from "@/shared/components/kit";
import { MeProvider } from "@/shared/hooks/MeProvider";
import { FIXTURE_ME, useMe } from "@/shared/hooks/useMe";
import { NoWorkspacePage } from "@/pages/NoWorkspacePage";
import { ALEX, fakeAuth } from "@/shared/auth/__tests__/fakeAuth";

/**
 * Where `useMe()` comes from in each mode, and what a signed-in account with
 * no workspace sees instead of a white screen.
 *
 * The refusals are built the way the RPC client builds them from `core.me()`'s
 * real failures: `require_tenant_id()`'s SQLSTATE 42501 arrives as a transport
 * `UNAUTHENTICATED`, and 018's `app.err('FORBIDDEN', {reason})` as a domain
 * `ContractError` — the shape `apiClient.ts`'s `must()` rethrows.
 */

const REAL_ME: Me = {
  id: ALEX.id,
  name: "Alex Selvarajah",
  role: "MD",
  permissions: ["approval:decide"],
  dataScope: { clients: "ALL", teams: "ALL" },
  locale: "en-MY",
  timezone: "Asia/Kuala_Lumpur",
  theme: "SYSTEM",
};

const noTenant = () =>
  new ApiErrorException(transportError("UNAUTHENTICATED", "NO_TENANT", { status: 401 }));

function Principal() {
  const { me, setRole } = useMe();
  return (
    <p>
      {me.name} · {me.role} · {setRole ? "role switch" : "no role switch"}
    </p>
  );
}

function renderProvider(port: AuthPort, loadMe: () => Promise<Me>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider port={port}>
          <MeProvider unlinked={<NoWorkspacePage />} loadMe={loadMe}>
            <Principal />
          </MeProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => resetPrimaries());
afterEach(() => vi.unstubAllEnvs());

describe("MeProvider · supabase mode", () => {
  beforeEach(() => vi.stubEnv("VITE_API_MODE", "supabase"));

  it("serves core.me() for the session, with no role switch", async () => {
    const loadMe = vi.fn(async () => REAL_ME);
    renderProvider(fakeAuth(ALEX), loadMe);

    expect(await screen.findByText("Alex Selvarajah · MD · no role switch")).toBeVisible();
    expect(loadMe).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state, not the app, until me answers", () => {
    renderProvider(fakeAuth(ALEX), () => new Promise<Me>(() => undefined));
    expect(screen.getByRole("status")).toHaveTextContent("Loading your workspace");
    expect(screen.queryByText(/Alex Selvarajah/)).toBeNull();
  });

  it("shows the no-workspace state, with the signed-in email, when the token carries no tenant", async () => {
    renderProvider(fakeAuth(ALEX), async () => {
      throw noTenant();
    });

    expect(
      await screen.findByRole("heading", { name: "Your account isn't linked to a workspace yet" }),
    ).toBeVisible();
    expect(screen.getByText("alex@example.my")).toBeVisible();
    expect(screen.getByRole("button", { name: "Check again" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  it.each(["NO_MEMBERSHIP", "NO_APP_ROLE"])(
    "treats FORBIDDEN %s from core.me() as not linked",
    async (reason) => {
      renderProvider(fakeAuth(ALEX), async () => {
        throw new ContractError("FORBIDDEN", "You do not have permission to do that.", { reason });
      });
      expect(
        await screen.findByRole("heading", {
          name: "Your account isn't linked to a workspace yet",
        }),
      ).toBeVisible();
    },
  );

  it("does not guess an unknown refusal into 'not linked'", async () => {
    renderProvider(fakeAuth(ALEX), async () => {
      throw new ContractError("FORBIDDEN", "Tenant suspended.", { reason: "TENANT_SUSPENDED" });
    });

    expect(
      await screen.findByRole("heading", { name: "We couldn't load your account" }),
    ).toBeVisible();
    expect(screen.getByText("Tenant suspended.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("Check again refreshes the token BEFORE re-asking, and lets the linked account in", async () => {
    const port = fakeAuth(ALEX);
    const order: string[] = [];
    let linked = false;
    port.refresh = vi.fn(async () => {
      order.push("refresh");
      linked = true;
      return { error: null };
    });
    const loadMe = vi.fn(async () => {
      order.push("me");
      if (!linked) throw noTenant();
      return REAL_ME;
    });
    renderProvider(port, loadMe);

    await userEvent.click(await screen.findByRole("button", { name: "Check again" }));

    expect(await screen.findByText("Alex Selvarajah · MD · no role switch")).toBeVisible();
    expect(order).toEqual(["me", "refresh", "me"]);
  });

  it("says so when Check again still finds no workspace", async () => {
    renderProvider(fakeAuth(ALEX), async () => {
      throw noTenant();
    });

    await userEvent.click(await screen.findByRole("button", { name: "Check again" }));

    expect(await screen.findByText(/Still not linked/)).toBeVisible();
  });

  it("Sign out from the no-workspace state ends the session", async () => {
    const port = fakeAuth(ALEX);
    renderProvider(port, async () => {
      throw noTenant();
    });

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(port.signOut).toHaveBeenCalledTimes(1));
  });
});

describe("MeProvider · fixtures mode", () => {
  it("serves the fixture principal and the role switch, and never asks for me", () => {
    vi.stubEnv("VITE_API_MODE", "fixtures");
    const port = fakeAuth(null);
    const loadMe = vi.fn(async () => REAL_ME);

    renderProvider(port, loadMe);

    expect(screen.getByText(`${FIXTURE_ME.name} · ${FIXTURE_ME.role} · role switch`)).toBeVisible();
    expect(loadMe).not.toHaveBeenCalled();
    expect(port.currentUser).not.toHaveBeenCalled();
  });
});
