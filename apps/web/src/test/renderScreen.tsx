import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Me, Role } from "@trainos/contract";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { resetPrimaries } from "@/shared/components/kit";
import { ApiProvider } from "@/shared/api";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";

/**
 * One harness for every feature's screen tests.
 *
 * There were ten of these, one per feature `__tests__/render-harness.tsx`, five
 * of them byte-identical and the rest differing by a default role, an extra
 * option, or the order of two imports. Ten copies of a 48-line file is ten
 * places for a fix to land in one and not the others — and it already had: the
 * `resetPrimaries()` call that keeps the kit's one-primary registry from
 * leaking between tests was explained in some copies and silent in others.
 *
 * Nothing here is mocked. The screens read the shared fixture client, so each
 * test starts from a fresh store at zero latency; a 120ms simulated round trip
 * per call would make the suite slow for no signal.
 *
 * Three harnesses deliberately survive this and are NOT replaced, because they
 * are different shapes rather than copies:
 *   - `features/approvals/__tests__/harness.tsx` takes `pattern` and mounts a
 *     catch-all route so a navigation under test has somewhere to land;
 *   - `features/portal/__tests__/harness.tsx` and the engagements one wrap a
 *     `BreadcrumbProvider` and a probe, so a test can read back the trail a
 *     screen DECLARES.
 */
export interface RenderScreenOptions {
  /** The URL the router starts at. Defaults to `/`. */
  path?: string;
  /** The route pattern, so `useParams` resolves. Defaults to `/`. */
  route?: string;
  /**
   * The role the SHELL paints. Defaults to SALES.
   *
   * This is a rendering convenience: it decides what `useMe()` reports and so
   * what the screen chooses to draw. The fixture client neither reads it nor
   * trusts it.
   */
  role?: Role;
  /**
   * The principal the CLIENT acts as. Defaults to `u_amirah`, as the app does.
   *
   * Distinct from `role`, and the distinction matters wherever a write is gated
   * server-side — ADMIN for the §17 tier, routing and reveal writes, the MD for
   * raising a cap. A test that wants one of those to succeed has to change who
   * is signed in, not who the shell says is signed in. Leaving it alone is what
   * exercises the refusal path.
   *
   * Passing it also drops `ApiProvider` from the tree, because the provider's
   * whole job is to keep the client's principal in step with the role toggle —
   * it would sign the client straight back in as `ACTOR_FOR_ROLE[role]` and
   * throw this away. The default context is the singleton, so the screen still
   * reads the same client; what it loses is the sync this option exists to
   * override.
   */
  actorId?: string;
}

/**
 * `resetPrimaries()` matters as much as `resetStore()`: the kit's
 * one-solid-primary check is module state, so a leaked registration from the
 * previous test would make the next one warn about a clash that is not there.
 */
export function renderScreen(
  element: ReactElement,
  options: RenderScreenOptions = {},
): RenderResult {
  resetStore();
  resetPrimaries();
  fixtureClient.setLatency(0);
  fixtureClient.signInAs(options.actorId ?? "u_amirah");

  const me: Me = { ...FIXTURE_ME, role: options.role ?? "SALES" };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const routed = (
    <MemoryRouter initialEntries={[options.path ?? "/"]}>
      <Routes>
        <Route path={options.route ?? "/"} element={element} />
      </Routes>
    </MemoryRouter>
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        {options.actorId === undefined ? <ApiProvider>{routed}</ApiProvider> : routed}
      </MeContext.Provider>
    </QueryClientProvider>,
  );
}
