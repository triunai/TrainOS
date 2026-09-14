import type { ReactNode } from "react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast as sonner } from "sonner";
import type { Me } from "@trainos/contract";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { ApiProvider } from "@/shared/api";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { useCreateSource } from "@/features/knowledge/api";
import { useRecordPayment } from "@/features/finance/api";
import { useSaveQuotation } from "@/features/proposals/api";
import { useTestProvider } from "@/features/settings-ai/api";

/**
 * The happy-path half of `refusal-toasts.test.tsx`: writes that had no
 * confirmation at all on success, not even a refusal banner — the dialog just
 * closed, or the value on screen quietly changed, and a reader who blinked had
 * no way to tell the click had landed. `meta: { toastOnSuccess }` is the fix,
 * on the SAME centralised `MutationCache` `toastOnError` already uses (§
 * `shared/api/queryClient.ts`). Delete the flag from any one of these hooks
 * and its case here fails.
 *
 * Same caveat as the sibling file: the feature `render-harness.tsx` files
 * build their own bare `QueryClient` with no mutation cache, so a screen test
 * cannot see this behaviour — the assertion has to run against the real
 * `MutationCache` wiring, copied here rather than imported so one test file
 * cannot poison another through a shared cache.
 */

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
    mutationCache: new MutationCache({
      onSuccess: (data, variables, _context, mutation) => {
        const spec = mutation.options.meta?.toastOnSuccess;
        if (!spec) return;
        const message = typeof spec === "function" ? spec(data, variables) : spec;
        if (message) sonner.success(message);
      },
    }),
  });

  const me: Me = { ...FIXTURE_ME, role: "SALES" };

  return (
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        <ApiProvider>{children}</ApiProvider>
      </MeContext.Provider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  resetStore();
});

describe("a plain write's success reaches the reader", () => {
  it("knowledge · add a source (AddSourceDrawer.tsx:47) — names what was added", async () => {
    const success = vi.spyOn(sonner, "success").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "createKnowledgeSource").mockResolvedValue({
      id: "src_1",
      name: "PSMB circular 3/2026",
      type: "HRDC_CIRCULAR",
      status: "ACTIVE",
      monitorStatus: "AUTO",
      retrievalScopes: [],
      chunks: 0,
      embeddingStatus: "COMPLETE",
      lastCheckedAt: null,
      ingestedAt: "2026-09-15T00:00:00+08:00",
      ruleChangeSetId: null,
    } as never);

    const hook = renderHook(() => useCreateSource(), { wrapper });
    hook.result.current.mutate({
      name: "PSMB circular 3/2026",
      type: "HRDC_CIRCULAR",
      retrievalScopes: [],
    });

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith('Knowledge source "PSMB circular 3/2026" added');
  });

  it("finance · record a payment (InvoiceDetailScreen.tsx:398) — the dialog closed with no other trace", async () => {
    const success = vi.spyOn(sonner, "success").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "recordPayment").mockResolvedValue({} as never);

    const hook = renderHook(() => useRecordPayment("INV-2026-0311"), { wrapper });
    hook.result.current.mutate({
      amount: { amount: 500000, currency: "MYR" },
      at: "2026-09-15T00:00:00+08:00",
      method: "BANK_TRANSFER",
    } as never);

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith("Payment recorded · INV-2026-0311");
  });

  it("proposals · save the quotation (CostingWorksheetPage.tsx:176) — 'Save' had no success feedback at all", async () => {
    const success = vi.spyOn(sonner, "success").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "putQuotation").mockResolvedValue({} as never);

    const hook = renderHook(() => useSaveQuotation("quo_1"), { wrapper });
    hook.result.current.mutate({ sellPrice: { amount: 1, currency: "MYR" } } as never);

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith("Quotation saved");
  });

  /* `useTestProvider` answers 200 for a FAILED test too — see the doc comment
     on the hook. Only the passing verdict gets the (green) toast; INVALID and
     EXPIRING already have their own coloured `StatusChip`. */
  it("settings-ai · test a provider key (ProviderKeysScreen.tsx:191) — only the passing verdict toasts", async () => {
    const success = vi.spyOn(sonner, "success").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "testProvider").mockResolvedValue({
      status: "VALID",
      lastTestedAt: "2026-09-15T00:00:00+08:00",
    } as never);

    const hook = renderHook(() => useTestProvider(), { wrapper });
    hook.result.current.mutate("provider_1");

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith("Connection test passed");
  });

  it("settings-ai · a failed test does not fire a (green) success toast", async () => {
    const success = vi.spyOn(sonner, "success").mockImplementation(() => "");
    vi.spyOn(fixtureClient, "testProvider").mockResolvedValue({
      status: "INVALID",
      lastTestedAt: "2026-09-15T00:00:00+08:00",
      message: "The key was rejected by the provider.",
    } as never);

    const hook = renderHook(() => useTestProvider(), { wrapper });
    hook.result.current.mutate("provider_1");

    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(success).not.toHaveBeenCalled();
  });
});
