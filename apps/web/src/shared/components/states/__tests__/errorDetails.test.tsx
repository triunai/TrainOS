import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createRpcApiClient } from "@/shared/api/apiClient";
import { toApiError, transportError, withDiagnostics } from "@/shared/api/errors";
import { createRpcClient } from "@/shared/api/rpcClient";
import { __setTransportForTests } from "@/shared/api/supabase";
import type { RpcTransport, TransportResponse } from "@/shared/api/transport";
import { resetPrimaries } from "@/shared/components/kit";
import { AppShell } from "@/shared/components/layout/AppShell";
import { CrashState, ErrorBoundary, ErrorState, NotDeployedState } from "..";

vi.mock("@/shared/hooks/useMe", () => ({
  useMe: () => ({ me: { role: "SALES" } }),
}));

vi.mock("@/shared/components/layout/Sidebar", () => ({
  Sidebar: () => <nav aria-label="Main">sidebar</nav>,
}));

vi.mock("@/shared/components/layout/Topbar", () => ({
  Topbar: () => <header>topbar</header>,
}));

/**
 * S0 · failures a tester can read off the screen.
 *
 * The disclosure is gated: on in development and wherever
 * `VITE_SHOW_ERROR_DETAILS=true`, off otherwise — and off under Vitest unless a
 * test turns it on, so every other suite renders what production renders.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __setTransportForTests(null);
  resetPrimaries();
});

const answering = (response: TransportResponse): RpcTransport => ({
  rpc: () => Promise.resolve(response),
  from: () => ({
    select: () =>
      Object.assign(Promise.resolve(response), { match: () => Promise.resolve(response) }),
  }),
});

describe("the Details disclosure", () => {
  it("is not drawn unless enabled", () => {
    render(<ErrorState title="Nope" error={transportError("SERVER", "boom", { status: 500 })} />);

    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("names the code, operation, status, database code, message and time, and copies them", async () => {
    vi.stubEnv("VITE_SHOW_ERROR_DETAILS", "true");
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    __setTransportForTests(
      answering({
        data: null,
        error: { message: 'invalid input syntax for type uuid: "APV-1"', code: "22P02" },
      }),
    );
    const failure = await createRpcClient().getApproval("APV-1");
    expect(failure.error).not.toBeNull();

    render(
      <ErrorState title="That approval could not be opened" error={failure.error ?? undefined} />,
    );
    await user.click(screen.getByRole("button", { name: "Details" }));

    const list = screen.getByText("Operation").closest("dl") as HTMLElement;
    expect(within(list).getByText("SERVER")).toBeInTheDocument();
    expect(within(list).getByText("get_approval")).toBeInTheDocument();
    expect(within(list).getByText("500")).toBeInTheDocument();
    expect(within(list).getByText("22P02")).toBeInTheDocument();
    expect(within(list).getByText(/invalid input syntax for type uuid/)).toBeInTheDocument();
    expect(within(list).getByText(/^\d{4}-\d{2}-\d{2}T/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy details" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain("Operation: get_approval");
    expect(copied).toContain("Source code: 22P02");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("keeps the operation on a domain refusal the adapter rethrows", async () => {
    __setTransportForTests(
      answering({
        data: null,
        error: {
          message: "an APPROVE must carry the diff hash",
          code: "TRNOS",
          details: JSON.stringify({ code: "VALIDATION_FAILED" }),
        },
      }),
    );

    const thrown = await createRpcApiClient(createRpcClient())
      .getApproval("APV-1")
      .catch((error: unknown) => error);

    expect(toApiError(thrown)).toMatchObject({
      kind: "domain",
      code: "VALIDATION_FAILED",
      operation: "get_approval",
      sourceCode: "TRNOS",
    });
  });

  it("names the missing operation on the not-available state", async () => {
    vi.stubEnv("VITE_SHOW_ERROR_DETAILS", "true");
    const user = userEvent.setup();

    const thrown = await createRpcApiClient(createRpcClient())
      .listInvoices()
      .catch((error: unknown) => error);

    render(<NotDeployedState subject="The invoice list" error={toApiError(thrown)} />);

    expect(screen.getByText("The invoice list is not available here yet")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("NOT_DEPLOYED")).toBeInTheDocument();
    expect(screen.getByText("listInvoices()")).toBeInTheDocument();
  });

  it("stamps a view read with its view name", async () => {
    __setTransportForTests(
      answering({ data: null, error: { message: "permission denied", code: "42501" } }),
    );

    const result = await createRpcClient().listBudgets();

    expect(result.error).toMatchObject({
      code: "NOT_DEPLOYED",
      operation: "v_budgets",
      sourceCode: "42501",
    });
  });

  it("never lets an earlier stamp be overwritten", () => {
    const stamped = withDiagnostics(transportError("SERVER", "x"), { operation: "first" });
    expect(withDiagnostics(stamped, { operation: "second" }).operation).toBe("first");
  });
});

function Throws(): never {
  throw new Error("render exploded");
}

describe("render crashes", () => {
  it("a screen that throws is replaced inside the shell, and the shell stays", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <MemoryRouter initialEntries={["/broken"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/broken" element={<Throws />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("This screen hit an error");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByText("topbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to dashboard" })).toBeInTheDocument();
  });

  it("the app boundary offers a reload and the dashboard, with the stack in Details in development", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("VITE_SHOW_ERROR_DETAILS", "true");
    const user = userEvent.setup();
    const goHome = vi.fn();

    render(
      <ErrorBoundary
        fallback={(error) => <CrashState scope="app" error={error} onGoHome={goHome} />}
      >
        <Throws />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "TrainOS hit an error it could not recover from",
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to dashboard" }));
    expect(goHome).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("render exploded")).toBeInTheDocument();
    expect(screen.getByText("Stack")).toBeInTheDocument();
  });

  it("clears the crash when the reset key changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fallback = () => <p>crashed</p>;

    const { rerender } = render(
      <ErrorBoundary resetKey="/a" fallback={fallback}>
        <Throws />
      </ErrorBoundary>,
    );
    expect(screen.getByText("crashed")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/b" fallback={fallback}>
        <p>recovered</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
