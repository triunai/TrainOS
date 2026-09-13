import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ActionRequest,
  ActionResponse,
  Actor,
  CollectionRule,
  CollectionsQueueResponse,
  Invoice,
  ListResponse,
  MessageChannel,
  MessageDraft,
  PaymentRecordRequest,
  ReceivablesAging,
} from "@trainos/contract";
import { isContractError } from "@trainos/fixtures";
import { ApiErrorException, domainErrorFromEnvelope, queryKeys, useApi } from "@/shared/api";

/**
 * The finance feature's data boundary. Screens call hooks from this file and
 * never touch a client directly; the client itself comes from `useApi()` in
 * `shared/api`, which is the one seam for the whole app.
 */

/**
 * Fixture errors are THROWN `ContractError`s; the app's query layer speaks
 * `ApiError`. Translating at the boundary keeps the shared retry rule correct —
 * a refusal is a fact and must never be replayed — and lets `ErrorState` show
 * the server's own sentence.
 *
 * Belongs in `shared/api` beside `toApiError` once that module owns the fixture
 * client; it is here because a feature may not write to shared.
 */
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (thrown) {
    if (isContractError(thrown)) {
      throw new ApiErrorException(domainErrorFromEnvelope(thrown.toEnvelope()));
    }
    throw thrown;
  }
}

/**
 * Who the action envelope records as the requester.
 *
 * Returns the QUERY, not the actor. It used to destructure `{ data }` and
 * return `data ? {...} : undefined`, which threw the error away inside the
 * hook: a `getMe()` that 403s or times out was indistinguishable from one still
 * in flight, at every call site, forever. The two writes below then reported it
 * as `new Error("The principal is not loaded yet.")` — a sentence about
 * loading, printed over a refusal.
 *
 * Everything else in this file returns the query result for the same reason, so
 * this is the shape the screens already know how to render.
 */
export function useActor(): UseQueryResult<Actor, Error> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => call(() => api.getMe()),
    select: (me): Actor => ({ kind: "HUMAN", id: me.id, name: me.name }),
  });
}

/**
 * The principal a governed write needs, or the reason there isn't one.
 *
 * Both writes below need the actor inside `mutationFn`, where there is no
 * render to branch on. Rethrowing the identity failure is what puts the real
 * refusal on `mutation.error` instead of a generic sentence about loading.
 */
function requireActor(actor: UseQueryResult<Actor, Error>): Actor {
  if (actor.error) throw actor.error;
  if (!actor.data) throw new Error("The principal is not loaded yet.");
  return actor.data;
}

/* ---- M13-S02 · invoice detail --------------------------------------- */

export function useInvoice(invoiceRef: string) {
  const api = useApi();
  return useQuery<Invoice>({
    queryKey: queryKeys.invoices.detail(invoiceRef),
    queryFn: () => call(() => api.getInvoice(invoiceRef)),
  });
}

/** Every invoice, so the detail screen can show the account's other one. */
export function useInvoices() {
  const api = useApi();
  return useQuery<ListResponse<Invoice>>({
    queryKey: queryKeys.invoices.list(),
    queryFn: () => call(() => api.listInvoices()),
  });
}

/**
 * Recording a payment. §9 makes creating an invoice policy-gated (FIN-01) and
 * recording a payment not, so this goes straight to the resource rather than
 * through the action envelope.
 */
export function useRecordPayment(invoiceRef: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation<Invoice, unknown, PaymentRecordRequest>({
    mutationFn: (body) =>
      call(() =>
        api.recordPayment(invoiceRef, body, {
          idempotencyKey: `payment-${invoiceRef}-${body.reference ?? body.at}`,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.collections.all });
    },
  });
}

/**
 * Re-pushing to the accounting package. Policy FIN-… routes it to Finance, so
 * the screen renders whichever outcome comes back rather than assuming a push.
 */
export function useRepushInvoice(invoiceRef: string) {
  const api = useApi();
  const actor = useActor();
  const queryClient = useQueryClient();

  return useMutation<ActionResponse, unknown, void>({
    mutationFn: () => {
      const requestedBy = requireActor(actor);
      const request: ActionRequest = {
        type: "INVOICE_PUSH",
        targetRef: invoiceRef,
        payload: { provider: "ACCOUNTING" },
        requestedBy,
      };
      return call(() => api.performAction(request, { idempotencyKey: `push-${invoiceRef}` }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    },
  });
}

/* ---- M13-S05 · collections queue ------------------------------------ */

export function useCollectionsQueue() {
  const api = useApi();
  return useQuery<CollectionsQueueResponse>({
    queryKey: queryKeys.collections.list(),
    queryFn: () => call(() => api.getCollectionsQueue()),
  });
}

/**
 * The ageing buckets. Read separately from the queue even though the queue
 * carries a copy, because the strip is the screen's own claim about the ledger
 * and must reconcile with `GET /v1/receivables/aging`, not with a page of rows.
 */
export function useReceivablesAging() {
  const api = useApi();
  return useQuery<ReceivablesAging>({
    queryKey: [...queryKeys.collections.all, "aging"],
    queryFn: () => call(() => api.getReceivablesAging()),
  });
}

/** The ladder the agent climbs. Configuration, never hardcoded in a screen. */
export function useCollectionRules() {
  const api = useApi();
  return useQuery<ListResponse<CollectionRule>>({
    queryKey: [...queryKeys.collections.all, "rules"],
    queryFn: () => call(() => api.getCollectionRules()),
  });
}

/**
 * The agent's draft for one invoice. Not every row has one — an item the ladder
 * has escalated past the agent's autonomy carries no draft, and a 404 there is
 * the correct answer rather than an error to shout about.
 */
export function useCollectionDraft(invoiceRef: string | null) {
  const api = useApi();
  return useQuery<MessageDraft>({
    queryKey: [...queryKeys.collections.all, "draft", invoiceRef],
    queryFn: () => call(() => api.getCollectionDraft(invoiceRef as string)),
    enabled: invoiceRef !== null,
    retry: false,
  });
}

/**
 * Sending a reminder. Policy FIN-03 has no conditions: nothing leaves without a
 * human, so this always comes back `QUEUED_FOR_APPROVAL` and the screen says so
 * rather than claiming the message went.
 */
export function useSendReminder(invoiceRef: string | null) {
  const api = useApi();
  const actor = useActor();
  const queryClient = useQueryClient();

  return useMutation<
    ActionResponse,
    unknown,
    { channel: MessageChannel; templateId: string; stage: string; body: string }
  >({
    mutationFn: (payload) => {
      const requestedBy = requireActor(actor);
      if (invoiceRef === null) throw new Error("No invoice is selected.");
      const request: ActionRequest = {
        type: "REMINDER_SEND",
        targetRef: invoiceRef,
        payload: { ...payload, invoiceRef },
        requestedBy,
      };
      return call(() =>
        api.performAction(request, {
          idempotencyKey: `reminder-${invoiceRef}-${payload.stage}-${payload.channel}`,
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.collections.all });
    },
  });
}
