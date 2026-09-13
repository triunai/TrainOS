import type { ReactNode } from "react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast as sonner } from "sonner";
import type { Me } from "@trainos/contract";
import { fixtureClient, forbidden, resetStore } from "@trainos/fixtures";
import { ApiProvider, readableMessage, toApiError } from "@/shared/api";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { useDeadLetterRun } from "@/features/agents/api";
import { useCheckSource, useCreateSource, useReingestSource } from "@/features/knowledge/api";
import { useExportAttendance } from "@/features/engagements/api";
import { useReopenTna } from "@/features/tna/api";
import { usePatchExtraction } from "@/features/enquiries/api";
import { useSaveQuotation } from "@/features/proposals/api";

/**
 * R3 · the seven writes that used to refuse in silence.
 *
 * Each hook below is fired the way its screen fires it — bare `mutate()`, with
 * nothing awaiting the call — and no screen reads its `error`. The only thing
 * that can render the refusal is the centralised `MutationCache`, and that
 * cache renders nothing unless the mutation carries
 * `meta: { toastOnError: true }`. Delete the flag from any one of these hooks
 * and its case here fails.
 *
 * The feature `render-harness.tsx` files build their own `QueryClient` with no
 * mutation cache at all, so a screen test CANNOT see this behaviour. That is
 * why the assertion lives here, against the same cache `queryClient.ts` ships.
 *
 * The refusal is injected rather than provoked through the permission matrix on
 * purpose: what is under test is that a domain refusal reaches the reader, not
 * which role each endpoint happens to reject this month.
 */

/** The §1 refusal shape, with a sentence written for a person. */
const REFUSAL = () =>
  forbidden("Operations cannot dead-letter a run.", {
    requiredRole: "ADMIN",
    requiredPermission: "run:dead-letter",
  });

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
    /* The same wiring `shared/api/queryClient.ts` ships. Copied rather than
       imported so one test file cannot poison another through a shared cache. */
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.options.meta?.toastOnError !== true) return;
        sonner.error(readableMessage(toApiError(error)));
      },
    }),
  });

  const me: Me = { ...FIXTURE_ME, role: "OPS" };

  return (
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        <ApiProvider>{children}</ApiProvider>
      </MeContext.Provider>
    </QueryClientProvider>
  );
}

/** Each case: the client method to refuse, and the hook fired from the screen. */
const SITES = [
  {
    name: "agents · dead-letter a run (RunTraceScreen.tsx:318)",
    method: "deadLetterRun",
    fire: () => {
      const hook = renderHook(() => useDeadLetterRun(), { wrapper });
      hook.result.current.mutate({ id: "run_1", reason: "stop retrying" });
    },
  },
  {
    /* Flagged when §18 took the screen's refusal banner away: the check now
       fires from a row overflow, a drawer footer and "Check all", and nothing
       on the page reads its error. */
    name: "knowledge · check a source (KnowledgeSourcesScreen.tsx:137)",
    method: "checkKnowledgeSource",
    fire: () => {
      const hook = renderHook(() => useCheckSource(), { wrapper });
      hook.result.current.mutate("src_1");
    },
  },
  {
    name: "knowledge · re-ingest a source (KnowledgeSourcesScreen.tsx:153)",
    method: "reingestKnowledgeSource",
    fire: () => {
      const hook = renderHook(() => useReingestSource(), { wrapper });
      hook.result.current.mutate("src_1");
    },
  },
  {
    name: "knowledge · add a source (AddSourceDrawer.tsx:52)",
    method: "createKnowledgeSource",
    fire: () => {
      const hook = renderHook(() => useCreateSource(), { wrapper });
      hook.result.current.mutate({
        name: "PSMB circular 3/2026",
        type: "HRDC_CIRCULAR",
        url: "https://example.test",
        retrievalScopes: [],
      });
    },
  },
  {
    name: "engagements · HRDC attendance export (AttendanceCapturePage.tsx:139)",
    method: "exportAttendance",
    fire: () => {
      const hook = renderHook(() => useExportAttendance("eng_1"), { wrapper });
      hook.result.current.mutate("HRDC");
    },
  },
  {
    name: "tna · reopen the questionnaire (TnaDetailPage.tsx:191)",
    method: "reopenTna",
    fire: () => {
      const hook = renderHook(() => useReopenTna("tna_1"), { wrapper });
      hook.result.current.mutate();
    },
  },
  {
    name: "enquiries · correct an extracted field (EnquiryDetailPage.tsx:246)",
    method: "patchEnquiryExtraction",
    fire: () => {
      const hook = renderHook(() => usePatchExtraction("enq_1"), { wrapper });
      hook.result.current.mutate({ field: "value", value: "1" } as never);
    },
  },
  {
    name: "proposals · save the quotation (CostingWorksheetPage.tsx:153)",
    method: "putQuotation",
    fire: () => {
      const hook = renderHook(() => useSaveQuotation("quo_1"), { wrapper });
      hook.result.current.mutate({ sellPrice: { amount: 1, currency: "MYR" } } as never);
    },
  },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  resetStore();
});

describe("a refused fire-and-forget write reaches the reader", () => {
  for (const site of SITES) {
    it(`surfaces the refusal · ${site.name}`, async () => {
      const error = vi.spyOn(sonner, "error").mockImplementation(() => "");
      vi.spyOn(fixtureClient, site.method as never).mockRejectedValue(REFUSAL() as never);

      site.fire();

      await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
      /* The SERVER's sentence, not "something went wrong" — the domain branch
         of `readableMessage`, which only a correctly classified refusal takes. */
      expect(error).toHaveBeenCalledWith("Operations cannot dead-letter a run.");
    });
  }
});
