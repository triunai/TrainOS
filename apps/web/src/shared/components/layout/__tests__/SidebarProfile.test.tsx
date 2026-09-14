import { useState, type ReactNode } from "react";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role } from "@trainos/contract";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { ApiProvider } from "@/shared/api";
import { createRpcApiClient } from "@/shared/api/apiClient";
import { __setTransportForTests } from "@/shared/api/supabase";
import { I18nProvider } from "@/shared/i18n";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { okEnvelope } from "@/shared/api/__tests__/oracleTransport";
import { SidebarProfile } from "../SidebarProfile";

/**
 * The profile modal reads `GET /v1/me/profile`, and this is the test that says
 * so.
 *
 * Until the endpoint landed the eleven fields came from
 * `shared/config/profileDetails.ts`, one hardcoded object holding Amirah
 * Yusof's values. A constant renders identically for every principal, so the
 * only assertion that can tell the wired modal from the hardcoded one is that
 * switching WHO IS SIGNED IN changes what the panel says. Asserting "Senior
 * Sales Consultant" is on screen would have passed against the constant too.
 *
 * The role toggle is the dev switcher's real mechanism: `ApiProvider` maps the
 * shell role to a fixture principal through `ACTOR_FOR_ROLE` and signs the
 * client in as them, so changing the role here is the same path the switcher
 * takes.
 */
function Harness({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("SALES");

  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MeContext.Provider
          value={{
            me: { ...FIXTURE_ME, role, name: role === "MD" ? "Alex Selvarajah" : FIXTURE_ME.name },
            setRole,
          }}
        >
          <ApiProvider>
            <I18nProvider>
              {children}
              {/* The dev role switcher, reduced to the one thing under test. */}
              <button type="button" onClick={() => setRole("MD")}>
                Switch to MD
              </button>
            </I18nProvider>
          </ApiProvider>
        </MeContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const renderProfile = () =>
  render(
    <Harness>
      <SidebarProfile collapsed={false} />
    </Harness>,
  );

beforeEach(() => {
  resetStore();
  fixtureClient.setLatency(0);
});

afterEach(() => {
  __setTransportForTests(null);
});

describe("SidebarProfile", () => {
  it("fills the modal from /v1/me/profile, and switching role changes whose record it is", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));

    /* Scoped to the dialog throughout: the rail band behind it also prints a
       role, and for the MD "Managing Director" is BOTH the role label and the
       job title. An unscoped query matches twice and the assertion stops
       meaning what it says. */
    const panel = () => within(screen.getByRole("dialog"));

    /* And read the field by its CARD, not by its text: the panel prints the
       role in its identity chip too, and for the MD the role label and the job
       title are the same words. */
    const field = (label: string) => {
      const card = panel().getByText(label).closest("div");
      if (card === null) throw new Error(`no card for "${label}"`);
      return card.textContent?.replace(label, "").trim() ?? "";
    };

    await panel().findByText("Senior Sales Consultant");
    expect(field("Job title")).toBe("Senior Sales Consultant");
    expect(field("Email")).toBe("amirah.yusof@akademiperdana.my");

    /* Close first: the modal is a Radix dialog, so while it is open the rest of
       the document is inert and the rail's own switcher is genuinely
       unreachable — in the test and in the browser alike. */
    await user.keyboard("{Escape}");

    /* The switcher signs the client in as the MD's principal. A hardcoded
       constant could not follow it; the endpoint does. */
    await user.click(screen.getByRole("button", { name: "Switch to MD" }));
    await user.click(screen.getByRole("button", { name: /Alex Selvarajah/ }));

    await panel().findByText("alex.selvarajah@akademiperdana.my");
    expect(field("Job title")).toBe("Managing Director");
    expect(field("Email")).toBe("alex.selvarajah@akademiperdana.my");
    expect(screen.queryByText("Senior Sales Consultant")).not.toBeInTheDocument();
  });

  it("does not ask for the profile until the modal is opened", async () => {
    const user = userEvent.setup();
    renderProfile();

    /* Closed, nothing has been fetched, so no field is on screen at all —
       `/v1/me` is the shell bootstrap and this payload is deliberately not
       part of it. */
    expect(screen.queryByText("Senior Sales Consultant")).not.toBeInTheDocument();
    expect(screen.queryByText("Job title")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));
    expect(await screen.findByText("Senior Sales Consultant")).toBeInTheDocument();
  });

  it("says the request failed rather than drawing an empty staff number", async () => {
    const user = userEvent.setup();
    /* A principal the fixture has no profile record for: the endpoint refuses
       with NOT_FOUND rather than serving somebody else's. */
    fixtureClient.signInAs("u_nobody");
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MeContext.Provider value={{ me: FIXTURE_ME, setRole: () => {} }}>
            <I18nProvider>
              <SidebarProfile collapsed={false} />
            </I18nProvider>
          </MeContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));

    /* "Unavailable", never blank: a blank value beside "Staff no." reads as
       "you have no staff number", which is a different claim from "we could
       not ask". */
    expect(await screen.findAllByText("Unavailable")).not.toHaveLength(0);
  });

  it("leaves Save, Change password and Sign out disabled, because nothing is behind them", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));
    await screen.findByText("Senior Sales Consultant");

    for (const name of [/Save/, /Change password/, /Sign out/]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  /**
   * `location`, `jobTitle`, `department` and `staffNumber` went optional on
   * `MeProfile`: no table stores them for a principal (`public.user_profiles`
   * has no such columns — those names belong to `core.contacts`, a different
   * entity), so `core.me_profile()` (020/022) answers `null` for each. The
   * fixture oracle always fills them in, so this drives the real Supabase
   * client against a hand-built envelope to prove the null case, the way
   * `notDeployed.render.test.tsx` drives it against a hand-built refusal.
   */
  /**
   * `core.me_profile()`'s FINAL shape (022, PR #46 2551359, sql-022):
   * `location`/`jobTitle`/`department`/`staffNumber` are `null` (no table
   * stores them), and WITHIN a present `session`, `browser`/`place` are
   * always `null` and `twoFactorEnabled` can be `null` (guarded against
   * hosted GoTrue the SQL lane could not confirm). `lastSignInAt` and
   * `activeSessions` are real whenever `session` is present at all — see the
   * next test for the case where `session` itself is `null`.
   */
  it("shows an em dash for a profile field no table stores, and drops twoFactorEnabled/browser/place the SQL lane could not confirm or has no source for", async () => {
    const user = userEvent.setup();

    const transport = {
      rpc: (name: string) =>
        name === "me_profile"
          ? Promise.resolve(
              okEnvelope({
                id: "u_test",
                tenant: { name: "Akademi Perdana", code: "APSB" },
                location: null,
                jobTitle: null,
                department: null,
                email: "amirah.yusof@akademiperdana.my",
                staffNumber: null,
                moduleCount: 7,
                session: {
                  lastSignInAt: "2026-09-11T08:04:22+08:00",
                  browser: null,
                  place: null,
                  activeSessions: 3,
                  twoFactorEnabled: null,
                },
              }),
            )
          : Promise.reject(new Error(`unexpected rpc: ${name}`)),
      from: () => {
        throw new Error("SidebarProfile does not read a view");
      },
    };
    __setTransportForTests(transport);

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MeContext.Provider value={{ me: FIXTURE_ME, setRole: () => {} }}>
            <ApiProvider client={createRpcApiClient()}>
              <I18nProvider>
                <SidebarProfile collapsed={false} />
              </I18nProvider>
            </ApiProvider>
          </MeContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));

    const panel = () => within(screen.getByRole("dialog"));
    const field = (label: string) => {
      const card = panel().getByText(label).closest("div");
      if (card === null) throw new Error(`no card for "${label}"`);
      return card.textContent?.replace(label, "").trim() ?? "";
    };

    await panel().findByText("Staff no.");
    expect(field("Job title")).toBe("—");
    expect(field("Department")).toBe("—");
    expect(field("Staff no.")).toBe("—");

    /* The identity rail's "org · location" line and the tenant banner's org
       name are drawn separately (`orgAndLocation` vs `orgName`), and read the
       same text ONLY when the rail correctly dropped the missing location
       instead of joining in "undefined" or "null". */
    expect(panel().getAllByText("Akademi Perdana")).toHaveLength(2);
    expect(panel().queryByText(/undefined/i)).not.toBeInTheDocument();
    expect(panel().queryByText(/null/i)).not.toBeInTheDocument();

    /* `lastSignInAt` is real whenever `session` is present — the line
       renders, not omitted and not "01-01-1970" (`new Date(null)`'s silent
       epoch date, which is what a bug reintroducing a per-field null check
       for this field would produce against the real shape). */
    expect(panel().getByText(/Last sign in 11-09-2026/)).toBeInTheDocument();

    /* `browser`/`place` null (always, not just here): the session line falls
       back to just the timezone's own GMT offset rather than joining in
       "undefined". */
    expect(panel().getByText("GMT+8")).toBeInTheDocument();

    /* `twoFactorEnabled` null: the chip that would otherwise assert a false
       "2FA off" is dropped rather than drawn wrong. */
    expect(panel().queryByText(/2FA/)).not.toBeInTheDocument();

    /* `activeSessions` is real whenever `session` is present — unlike
       `twoFactorEnabled`, it still renders. */
    expect(panel().getByText("3 active sessions")).toBeInTheDocument();
    expect(panel().getByText("7 modules")).toBeInTheDocument();
  });

  /**
   * `core.me_profile()`'s FINAL shape: `session` is `null` AS A WHOLE
   * precisely when `lastSignInAt` cannot be derived — the guard withholds
   * the whole block rather than leaving it partial. Nothing inside `session`
   * can be read at all in that case, so the "Last sign in" line, the
   * "browser · place, GMT+8" line and both session chips have to be gone
   * together, not fall back to a GMT-only line the way the per-field-null
   * case above does.
   */
  it("omits the whole session block when the server sends session: null, rather than reading into it", async () => {
    const user = userEvent.setup();

    const transport = {
      rpc: (name: string) =>
        name === "me_profile"
          ? Promise.resolve(
              okEnvelope({
                id: "u_test",
                tenant: { name: "Akademi Perdana", code: "APSB" },
                location: "Klang Valley",
                jobTitle: "Senior Sales Consultant",
                department: "Commercial",
                email: "amirah.yusof@akademiperdana.my",
                staffNumber: "APSB-0142",
                moduleCount: 7,
                session: null,
              }),
            )
          : Promise.reject(new Error(`unexpected rpc: ${name}`)),
      from: () => {
        throw new Error("SidebarProfile does not read a view");
      },
    };
    __setTransportForTests(transport);

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MeContext.Provider value={{ me: FIXTURE_ME, setRole: () => {} }}>
            <ApiProvider client={createRpcApiClient()}>
              <I18nProvider>
                <SidebarProfile collapsed={false} />
              </I18nProvider>
            </ApiProvider>
          </MeContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Amirah Yusof/ }));

    const panel = () => within(screen.getByRole("dialog"));
    await panel().findByText("Senior Sales Consultant");

    /* Neither line the session powers is drawn — not even a GMT-offset-only
       fallback, which is the per-field-null case's answer, not this one. */
    expect(panel().queryByText(/Last sign in/)).not.toBeInTheDocument();
    expect(panel().queryByText(/GMT\+/)).not.toBeInTheDocument();
    expect(panel().queryByText(/2FA/)).not.toBeInTheDocument();
    expect(panel().queryByText(/active sessions/)).not.toBeInTheDocument();

    /* Everything that does NOT depend on `session` is unaffected. */
    expect(panel().getByText("Akademi Perdana · Klang Valley")).toBeInTheDocument();
    expect(panel().getByText("7 modules")).toBeInTheDocument();
  });
});
