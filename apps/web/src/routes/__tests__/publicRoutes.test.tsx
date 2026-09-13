import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { PORTAL_TOKEN_AURORA } from "@trainos/fixtures";
import { AuthProvider } from "@/shared/auth";
import { resetFixtures } from "@/features/portal/__tests__/harness";
import { fakeAuth } from "@/shared/auth/__tests__/fakeAuth";
import { AppRoutes } from "@/routes/routes";

/**
 * The client proposal link is PUBLIC in every mode: the signed token is the
 * authorization, and a client has no account to sign in with. It must never
 * sit behind the session guard.
 *
 * `VITE_API_MODE` is stubbed per test, as in the session suite: the guard reads
 * it at render, while the client underneath stays the fixture client this file
 * loaded with, so the page has a proposal to draw.
 */

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

beforeEach(resetFixtures);
afterEach(() => vi.unstubAllEnvs());

describe("public routes", () => {
  it("opens a proposal link for a signed-out reader in supabase mode, with no sign-in detour", async () => {
    vi.stubEnv("VITE_API_MODE", "supabase");
    const port = fakeAuth(null);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[`/p/${PORTAL_TOKEN_AURORA}`]}>
          <AuthProvider port={port}>
            <AppRoutes />
            <Where />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole(
        "heading",
        { name: /Proposal for Aurora Manufacturing Sdn Bhd/ },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PORTAL_TOKEN_AURORA}`);
    expect(screen.queryByText("Checking your session")).toBeNull();
  });
});
