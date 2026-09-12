import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isRetryable, readableMessage, toApiError } from "./errors";

/**
 * ONE place decides what a failed mutation looks like.
 *
 * Per-hook `onError: () => toast(...)` drifts in copy and in coverage. Here a
 * mutation opts in with `meta: { toastOnError: true }` and gets consistent
 * behaviour for free.
 *
 * THE ASYMMETRY RULE — this is not stylistic:
 *
 *   mutate(...) fired from a button, nothing awaits it
 *       -> meta: { toastOnError: true } is MANDATORY.
 *   await mutateAsync(...) inside a try/catch that renders an inline error
 *       -> no flag; a flag here double-reports.
 *
 * Approve and reject buttons are exactly the first shape. Omitting the flag
 * there produces the bug where a denied write shows nothing at all and the only
 * symptom is "the button does nothing".
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      // A refusal is a fact. Replaying a governed write is also how you get a
      // duplicate side effect; retries belong to the caller with an
      // idempotency key, not to a blanket default.
      retry: 0,
    },
    queries: {
      staleTime: 30_000,
      // Domain-aware retry: only transport failures that could plausibly
      // succeed on a second attempt are retried. A FORBIDDEN is never retried.
      retry: (failureCount, error) => failureCount < 1 && isRetryable(toApiError(error)),
    },
  },
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.meta?.toastOnError !== true) return;
      toast.error(readableMessage(toApiError(error)));
    },
  }),
});

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Surface this mutation's failure as a toast. Required for fire-and-forget calls. */
      toastOnError?: boolean;
    };
  }
}
