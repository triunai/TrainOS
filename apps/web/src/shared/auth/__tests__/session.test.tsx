import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { AuthPort } from "@/shared/api";
import {
  AUTH_CALLBACK_PATH,
  AuthProvider,
  RequireSession,
  SIGN_IN_PATH,
  safeReturnPath,
  signInHref,
  useAuth,
} from "@/shared/auth";
import { resetPrimaries } from "@/shared/components/kit";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { SignInPage } from "@/pages/SignInPage";
import { authRoutes } from "@/routes/auth.routes";
import { ALEX, fakeAuth } from "./fakeAuth";

/**
 * The supabase-mode session layer: guard, sign-in page and OAuth callback,
 * against an in-memory auth port.
 *
 * `VITE_API_MODE` is stubbed per test rather than for the file, because the
 * last block asserts the OPPOSITE — that fixtures mode never mounts any of it.
 */

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path: string, port: AuthPort, extra?: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider port={port}>
          <Routes>
            <Route path={SIGN_IN_PATH} element={<SignInPage />} />
            <Route path={AUTH_CALLBACK_PATH} element={<AuthCallbackPage />} />
            <Route
              element={
                <RequireSession>
                  <Outlet />
                </RequireSession>
              }
            >
              <Route path="/approvals" element={<p>Approval inbox</p>} />
              <Route path="/dashboard" element={<p>Dashboard</p>} />
              <Route path="*" element={<p>Somewhere else</p>} />
            </Route>
          </Routes>
          <Where />
          {extra}
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetPrimaries();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.documentElement.removeAttribute("data-theme");
});

describe("route guard (supabase mode)", () => {
  beforeEach(() => vi.stubEnv("VITE_API_MODE", "supabase"));

  it("sends a signed-out reader to sign-in, carrying the page they asked for", async () => {
    renderAt("/approvals?view=mine", fakeAuth(null));

    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(screen.getByTestId("where")).toHaveTextContent(
      `/sign-in?next=${encodeURIComponent("/approvals?view=mine")}`,
    );
    expect(screen.queryByText("Approval inbox")).toBeNull();
  });

  it("renders the requested page for a signed-in reader, with no detour", async () => {
    renderAt("/approvals", fakeAuth(ALEX));

    expect(await screen.findByText("Approval inbox")).toBeVisible();
    expect(screen.getByTestId("where")).toHaveTextContent("/approvals");
  });

  it("holds on a loading state until the stored session has been read", async () => {
    let resolve: (value: typeof ALEX | null) => void = () => undefined;
    const port = fakeAuth(null, {
      currentUser: () => new Promise((settle) => (resolve = settle)),
    });
    renderAt("/approvals", port);

    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    expect(screen.getByTestId("where")).toHaveTextContent("/approvals");

    resolve(ALEX);
    expect(await screen.findByText("Approval inbox")).toBeVisible();
  });

  it("returns to sign-in when the session ends", async () => {
    const port = fakeAuth(ALEX);
    function SignOut() {
      const auth = useAuth();
      return (
        <button type="button" onClick={() => void auth?.signOut()}>
          Sign out
        </button>
      );
    }
    renderAt("/dashboard", port, <SignOut />);
    await screen.findByText("Dashboard");

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(port.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("sign-in page", () => {
  beforeEach(() => vi.stubEnv("VITE_API_MODE", "supabase"));

  it("offers Google as the one solid action and email only as a note", async () => {
    renderAt(SIGN_IN_PATH, fakeAuth(null));

    const google = await screen.findByRole("button", { name: "Continue with Google" });
    expect(google.className).toContain("bg-primary-solid");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to TrainOS" })).toBeVisible();

    const note = screen.getByText("Email sign-in — coming soon");
    expect(note.closest("button, a, input, [role='button']")).toBeNull();
    expect(note.className).toContain("text-ink-muted");
  });

  it("starts Google OAuth back to this origin's callback and remembers where to land", async () => {
    const port = fakeAuth(null);
    renderAt(`${SIGN_IN_PATH}?next=${encodeURIComponent("/approvals")}`, port);

    await userEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(port.signInWithGoogle).toHaveBeenCalledWith(
      `${window.location.origin}${AUTH_CALLBACK_PATH}`,
    );
    expect(window.sessionStorage.getItem("trainos.auth.returnTo")).toBe("/approvals");
  });

  it("shows why a redirect could not start and lets the reader try again", async () => {
    const port = fakeAuth(null, {
      signInWithGoogle: vi.fn(async () => ({
        error: "Unsupported provider: provider is not enabled",
      })),
    });
    renderAt(SIGN_IN_PATH, port);

    const google = await screen.findByRole("button", { name: "Continue with Google" });
    await userEvent.click(google);

    expect(await screen.findByRole("alert")).toHaveTextContent("provider is not enabled");
    expect(google).toBeEnabled();
  });

  it("offers no Google button until it knows whether the reader is already signed in", async () => {
    let resolve: (value: typeof ALEX | null) => void = () => undefined;
    const port = fakeAuth(null, {
      currentUser: () => new Promise((settle) => (resolve = settle)),
    });
    renderAt(`${SIGN_IN_PATH}?next=${encodeURIComponent("/approvals")}`, port);

    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();

    resolve(ALEX);
    expect(await screen.findByText("Approval inbox")).toBeVisible();
  });

  it("sends an already signed-in reader straight on", async () => {
    renderAt(`${SIGN_IN_PATH}?next=${encodeURIComponent("/approvals")}`, fakeAuth(ALEX));
    expect(await screen.findByText("Approval inbox")).toBeVisible();
  });

  it.each(["light", "dark"] as const)(
    "renders the same page on theme tokens in %s",
    async (theme) => {
      const { container } = render(
        <NextThemesProvider attribute="data-theme" forcedTheme={theme} themes={["light", "dark"]}>
          <QueryClientProvider client={new QueryClient()}>
            <MemoryRouter initialEntries={[SIGN_IN_PATH]}>
              <AuthProvider port={fakeAuth(null)}>
                <SignInPage />
              </AuthProvider>
            </MemoryRouter>
          </QueryClientProvider>
        </NextThemesProvider>,
      );

      await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", theme));
      expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeVisible();

      /* Theme is a token swap on `data-theme`. A literal colour in the markup is
       the one thing that would render the same in both, so there must be none. */
      const markup = container.innerHTML;
      expect(markup).not.toMatch(
        /#[0-9a-f]{3,8}\b|rgb\(\d|bg-white|bg-black|text-white|text-black/i,
      );
    },
  );
});

describe("OAuth callback", () => {
  beforeEach(() => vi.stubEnv("VITE_API_MODE", "supabase"));

  it("waits for the exchange, then lands on the path sign-in remembered", async () => {
    window.sessionStorage.setItem("trainos.auth.returnTo", "/approvals");
    const port = fakeAuth(ALEX);
    renderAt(AUTH_CALLBACK_PATH, port);

    expect(await screen.findByText("Approval inbox")).toBeVisible();
    expect(port.ready).toHaveBeenCalled();
    expect(window.sessionStorage.getItem("trainos.auth.returnTo")).toBeNull();
  });

  it("lands on the dashboard when nothing was remembered", async () => {
    renderAt(AUTH_CALLBACK_PATH, fakeAuth(ALEX));
    await waitFor(() =>
      expect(screen.getByTestId("where")).not.toHaveTextContent("/auth/callback"),
    );
    expect(screen.getByTestId("where").textContent).toMatch(/dashboard/);
  });

  it("reports a failed exchange in its own words, not the URL's, and offers sign-in again", async () => {
    const port = fakeAuth(null, {
      ready: vi.fn(async () => ({ error: "Unable to exchange external code: access_denied" })),
    });
    renderAt(AUTH_CALLBACK_PATH, port);

    const heading = await screen.findByRole("heading", { name: "Sign-in didn't complete" });
    const card = heading.closest("main");
    expect(card).not.toBeNull();
    /* The exchange's error can carry `error_description` straight from the
       callback URL, which anyone can write. The card says a fixed sentence. */
    expect(within(card as HTMLElement).queryByText(/access_denied/)).toBeNull();
    expect(
      within(card as HTMLElement).getByText(/Google didn't finish signing you in/),
    ).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeVisible();
  });

  it("treats a callback with no session as a failed sign-in, not a success", async () => {
    renderAt(AUTH_CALLBACK_PATH, fakeAuth(null));
    expect(await screen.findByRole("heading", { name: "Sign-in didn't complete" })).toBeVisible();
    expect(screen.getByText(/No session came back from Google/)).toBeVisible();
  });
});

describe("return paths", () => {
  it("accepts only same-origin in-app paths", () => {
    expect(safeReturnPath("/approvals?x=1#top")).toBe("/approvals?x=1#top");
    expect(safeReturnPath("//evil.example/steal")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath(SIGN_IN_PATH)).toBeNull();
    expect(safeReturnPath(`${AUTH_CALLBACK_PATH}?code=abc`)).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });

  /* A browser's URL parser strips tab, newline and carriage return before it
     resolves, so `/\t/evil.example` is `//evil.example` to it: another origin,
     and a SecurityError from `history.replaceState`. */
  it.each([
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\t\\evil.example",
    "/approvals\n",
    " /approvals",
    "  //evil.example",
    "javascript:alert(1)",
    "/%2F/../\t/evil.example",
  ])("refuses a control character, leading space or scheme: %j", (raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });

  it("keeps an encoded control character, which stays a same-origin path", () => {
    expect(safeReturnPath("/%09/evil.example")).toBe("/%09/evil.example");
  });

  it("refuses a path that normalises onto the auth routes", () => {
    expect(safeReturnPath("/approvals/../sign-in")).toBeNull();
  });

  it("drops a pointless next from the guard's redirect", () => {
    expect(signInHref("/")).toBe(SIGN_IN_PATH);
    expect(signInHref("//evil.example")).toBe(SIGN_IN_PATH);
  });
});

describe("a crafted next in a real browser history", () => {
  beforeEach(() => vi.stubEnv("VITE_API_MODE", "supabase"));
  afterEach(() => window.history.replaceState(null, "", "/"));

  /* MemoryRouter never calls `history`, so only BrowserRouter shows what a
     cross-origin `next` does to the page. */
  function renderInBrowser(url: string) {
    window.history.replaceState(null, "", url);
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <BrowserRouter>
          <AuthProvider port={fakeAuth(ALEX)}>
            <Routes>
              <Route path={SIGN_IN_PATH} element={<SignInPage />} />
              <Route path={AUTH_CALLBACK_PATH} element={<AuthCallbackPage />} />
              <Route path="/dashboard" element={<p>Dashboard</p>} />
              <Route path="*" element={<p>Somewhere else</p>} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>,
    );
  }

  it("sends a signed-in reader to the dashboard instead of a blank page", async () => {
    const origin = window.location.origin;
    renderInBrowser(`${SIGN_IN_PATH}?next=${encodeURIComponent("/\t/evil.example")}`);
    expect(await screen.findByText("Dashboard")).toBeVisible();
    expect(window.location.origin).toBe(origin);
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("finishes a callback whose remembered path was crafted, on the dashboard", async () => {
    window.sessionStorage.setItem("trainos.auth.returnTo", "/\t/evil.example");
    renderInBrowser(AUTH_CALLBACK_PATH);
    expect(await screen.findByText("Dashboard")).toBeVisible();
    expect(window.location.pathname).toBe("/dashboard");
  });
});

describe("fixtures mode", () => {
  it("registers no account routes, so /sign-in and /auth/callback do not exist", () => {
    /* Decided at module load, like the client: this suite runs without the
       stub, so the module saw the fixtures default. */
    expect(authRoutes).toEqual([]);
  });

  it("mounts no session: the guard passes through and useAuth() is null", () => {
    vi.stubEnv("VITE_API_MODE", "fixtures");
    const port = fakeAuth(null);
    let seen: ReturnType<typeof useAuth> | undefined;
    function Probe() {
      seen = useAuth();
      return null;
    }

    renderAt("/approvals", port, <Probe />);

    expect(screen.getByText("Approval inbox")).toBeVisible();
    expect(seen).toBeNull();
    expect(port.onChange).not.toHaveBeenCalled();
    expect(port.currentUser).not.toHaveBeenCalled();
  });
});
