import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionRequest, ActionResponse, Me } from "@trainos/contract";
import { fixtureClient, forbidden, resetStore } from "@trainos/fixtures";
import { ApiProvider, useAction } from "@/shared/api";
import { toast } from "@/shared/components/kit/toast";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";

/**
 * The toast `useAction` rings for every §3 outcome, plus the refusal — the
 * backstop for the bug the team was dispatched over: a convert that WORKED
 * with no visible confirmation, because the page's own `ActionOutcome` was
 * nested inside a section keyed off data the very same action invalidated
 * (see `EnquiryDetailPage`'s fix). The toast lives outside that page section
 * entirely, in the one `<Toaster/>` the app mounts, so it cannot be unmounted
 * by the refetch its own success triggers.
 */

const REQUEST: ActionRequest = {
  type: "OPPORTUNITY_CONVERT",
  targetRef: "ENQ-2026-0013",
  requestedBy: { id: "u_amirah", name: "Amirah Yusof", kind: "HUMAN" },
};

const EXECUTED: ActionResponse = {
  status: "EXECUTED",
  result: {
    effects: [
      {
        op: "UPDATE",
        entity: "Enquiry",
        ref: "ENQ-2026-0013",
        description: "status OPEN → CONVERTED",
      },
    ],
    opportunity: { id: "opp_1", ref: "OPP-2026-0005" },
  },
};

const QUEUED: ActionResponse = {
  status: "QUEUED_FOR_APPROVAL",
  approvalRequest: {
    id: "apv-1",
    ref: "APV-2026-0771",
    policyId: "APV-01",
    approverRole: "SALES_MANAGER",
    slaDueAt: "2026-10-14T17:00:00+08:00",
    createdAt: "2026-10-14T09:00:00+08:00",
  },
};

const SUGGESTED: ActionResponse = {
  status: "SUGGESTED",
  draft: {
    id: "d1",
    type: "FOLLOWUP_SEND",
    body: "Draft reminder text",
    expiresAt: "2026-10-15T09:00:00+08:00",
  },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  const me: Me = { ...FIXTURE_ME, role: "SALES" };

  return (
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        <MemoryRouter>
          <ApiProvider>{children}</ApiProvider>
        </MemoryRouter>
      </MeContext.Provider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  resetStore();
});

describe("useAction · the toast backstop", () => {
  it("EXECUTED: a success toast naming what changed", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "performAction").mockResolvedValue(EXECUTED);

    const { result } = renderHook(() => useAction(), { wrapper });
    result.current.mutate(REQUEST);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(
      "Opportunity convert · ENQ-2026-0013",
      expect.objectContaining({
        description: "status OPEN → CONVERTED · Opportunity OPP-2026-0005",
      }),
    );
  });

  /* R2: a queued action is a SUCCESS, never the error variant, and it links to
     the approval it raised. */
  it("QUEUED_FOR_APPROVAL: an info toast with a link to the approval", async () => {
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "performAction").mockResolvedValue(QUEUED);

    const { result } = renderHook(() => useAction(), { wrapper });
    result.current.mutate(REQUEST);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(info).toHaveBeenCalledTimes(1);
    const [title, options] = info.mock.calls[0]!;
    expect(title).toBe("Opportunity convert · ENQ-2026-0013 · sent for approval");
    expect((options as { description?: string }).description).toBe("Approval APV-2026-0771");
    expect((options as { action?: { label: string } }).action?.label).toBe("View approval");
  });

  it("SUGGESTED: an info toast, not a success", async () => {
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    const success = vi.spyOn(toast, "success").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "performAction").mockResolvedValue(SUGGESTED);

    const { result } = renderHook(() => useAction(), { wrapper });
    result.current.mutate(REQUEST);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(info).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
  });

  it("a refusal: an error toast with the server's own sentence", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "performAction").mockRejectedValue(
      forbidden("Sales cannot convert a closed enquiry.", {}),
    );

    const { result } = renderHook(() => useAction(), { wrapper });
    result.current.mutate(REQUEST);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("Sales cannot convert a closed enquiry.", undefined);
  });

  it("toast: false suppresses every outcome, for a screen with its own reliable ActionOutcome", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "performAction").mockResolvedValue(EXECUTED);

    const { result } = renderHook(() => useAction({ toast: false }), { wrapper });
    result.current.mutate(REQUEST);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(success).not.toHaveBeenCalled();
  });

  /* A disabled-while-pending button is the app's actual double-click guard
     (every touched screen already sets `disabled={mutation.isPending}`) — this
     proves that guard is sufficient: the second click never reaches `mutate`,
     so only one toast rings. */
  it("a double click on a disabled-while-pending button fires one toast, not two", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "");
    let resolvePerformAction!: (value: ActionResponse) => void;
    vi.spyOn(fixtureClient, "performAction").mockReturnValue(
      new Promise((resolve) => {
        resolvePerformAction = resolve;
      }),
    );

    function Button() {
      const action = useAction();
      return (
        <button disabled={action.isPending} onClick={() => action.mutate(REQUEST)}>
          Accept &amp; convert
        </button>
      );
    }

    render(<Button />, { wrapper });
    const button = screen.getByRole("button", { name: "Accept & convert" });

    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button); // jsdom does not dispatch click on a disabled element

    resolvePerformAction(EXECUTED);
    await waitFor(() => expect(button).not.toBeDisabled());

    expect(success).toHaveBeenCalledTimes(1);
  });
});

describe("useAction · QUEUED_FOR_APPROVAL toast's approval link", () => {
  /* The toast is rendered by sonner's own `<Toaster/>`, which this test does
     not mount — asserting the DOM would only prove sonner works. What
     `useAction` owns is the `onClick` it hands the toast, so this drives THAT
     callback directly (captured off the spy) and checks it takes the reader
     to the approval `APV-2026-0771` raised, the same URL
     `features/approvals/paths.ts#approvalPath` would build for it. */
  it("navigates to the approval the action raised", async () => {
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "performAction").mockResolvedValue(QUEUED);

    function Screen() {
      const action = useAction();
      return <button onClick={() => action.mutate(REQUEST)}>Accept &amp; convert</button>;
    }

    render(
      <MemoryRouter initialEntries={["/sales/enquiries/ENQ-2026-0013"]}>
        {(() => {
          const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
          });
          const me: Me = { ...FIXTURE_ME, role: "SALES" };
          return (
            <QueryClientProvider client={queryClient}>
              <MeContext.Provider value={{ me, setRole: () => undefined }}>
                <ApiProvider>
                  <Routes>
                    <Route path="/sales/enquiries/:id" element={<Screen />} />
                    <Route
                      path="/approvals/:ref"
                      element={<div>Approval detail: APV-2026-0771</div>}
                    />
                  </Routes>
                </ApiProvider>
              </MeContext.Provider>
            </QueryClientProvider>
          );
        })()}
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept & convert" }));
    await waitFor(() => expect(info).toHaveBeenCalledTimes(1));

    const options = info.mock.calls[0]![1] as { action?: { onClick: () => void } };
    act(() => options.action?.onClick());

    await waitFor(() => expect(screen.getByText(/APV-2026-0771/)).toBeInTheDocument());
  });
});
