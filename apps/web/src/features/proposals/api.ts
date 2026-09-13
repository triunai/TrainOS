import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActionRequest,
  ActionResponse,
  Money,
  ProposalSectionWrite,
  QuotationLine,
  QuotationWrite,
  Role,
} from "@trainos/contract";
import {
  USER_AMIRAH,
  USER_JASON,
  USER_KELVIN,
  USER_KHAIRUL,
  USER_SITI,
  TRAINER_FARAH,
} from "@trainos/contract";
import { isContractError } from "@trainos/fixtures";
import { newIdempotencyKey, queryKeys, useApi } from "@/shared/api";

/**
 * The proposals and quotations data layer.
 *
 * The client comes from `useApi()` in `shared/api`.
 *
 * Every governed write on these two screens goes through `performAction`. The
 * screens render the response variant — EXECUTED, QUEUED_FOR_APPROVAL or
 * SUGGESTED — rather than deciding anything themselves.
 */

/* ---- The action envelope --------------------------------------------- */

/**
 * A payload that is BOTH its named contract shape and an index-signature bag.
 *
 * `ActionRequest` parameterises `payload` and defaults it to
 * `Record<string, unknown>`, because §3 gives an example per section rather
 * than a closed schema. A named interface like `ProposalSendPayload` has no
 * index signature, so it does not structurally satisfy that default.
 *
 * `satisfies` at the call site is the fix rather than a cast: the object is
 * still checked against the named payload type, so a field that the contract
 * renames or retypes is still a compile error here, and the widening is a
 * property of the literal rather than something a helper hides.
 */
export type ActionPayload<P> = P & Record<string, unknown>;

/* ---- Error helpers --------------------------------------------------- */

export function errorCodeOf(error: unknown): string | null {
  return isContractError(error) ? error.code : null;
}

export function errorMessageOf(error: unknown): string {
  if (isContractError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

/**
 * The `FLOOR_PRICE_BREACH` detail bag, as `client/pricing.ts` builds it. Both
 * floors and the binding basis travel with the refusal, so the worksheet can
 * say WHICH constraint is doing the work instead of just "too low".
 */
export interface FloorBreach {
  floorPrice: Money;
  resultingMarginRate: number;
  requiresPolicy: string;
  absoluteFloorPrice?: Money;
  marginFloorPrice?: Money;
  bindingFloorBasis?: "ABSOLUTE" | "MARGIN";
}

export function floorBreachOf(error: unknown): FloorBreach | null {
  if (!isContractError(error) || error.code !== "FLOOR_PRICE_BREACH") return null;
  return (error.details ?? null) as FloorBreach | null;
}

/* ---- Proposals (M07-S02) -------------------------------------------- */

export function useProposal(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.proposals.detail(id ?? ""),
    queryFn: () => client.getProposal(id as string),
    enabled: Boolean(id),
  });
}

/**
 * The client the proposal is for.
 *
 * A `Proposal` names its opportunity and nothing else, so the organisation is
 * two hops away. The record's identity line carries the client name — that is
 * what a consultant recognises the document by — so the hops are worth making
 * rather than showing a bare reference.
 */
export function useProposalClient(opportunityRef: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.opportunities.detail(opportunityRef ?? ""), "organisation"] as const,
    queryFn: async () => {
      const opportunity = await client.getOpportunity(opportunityRef as string);
      return client.getOrganisation(opportunity.organisationRef);
    },
    enabled: Boolean(opportunityRef),
  });
}

/** A manual edit. Flips the section's origin to `AI_SUGGESTED · edited by`. */
export function useEditSection(id: string | undefined) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ n, body }: { n: number; body: ProposalSectionWrite }) =>
      client.putProposalSection(id as string, n, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.detail(id ?? "") });
    },
  });
}

/**
 * A new, empty section at the end of the document.
 *
 * Human-authored, so it lands with no provenance at all — which is exactly
 * right: absent provenance means a person wrote it, and a "Template" or
 * "System" badge on a section a consultant just typed would be a claim the
 * record cannot support.
 */
export function useAddSection(id: string | undefined) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; body?: string }) =>
      client.addProposalSection(id as string, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.detail(id ?? "") });
    },
  });
}

/** A fresh generation. Returns the new section and the run that produced it. */
export function useRegenerateSection(id: string | undefined) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (n: number) => client.regenerateProposalSection(id as string, n),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.detail(id ?? "") });
    },
  });
}

/**
 * `POST /v1/actions` `type: PROPOSAL_SEND`.
 *
 * Send is NOT a proposal endpoint — routing it through the action envelope is
 * what lets policy APV-01 intercept it above RM 15,000. A queued response is a
 * success, not a failure, and the screen renders the approval it produced.
 */
export function useSendProposal(id: string | undefined) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation<ActionResponse, unknown, ActionRequest>({
    /* §3 replays a key with the same body and refuses it with a different
       one, so a key is what stops a double-clicked send from queueing two
       approvals. These two writes were sending none at all. */
    mutationFn: (request) => client.performAction(request, { idempotencyKey: newIdempotencyKey() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.detail(id ?? "") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
    },
  });
}

/** The approval a queued send produced, for the banner's SLA and subject. */
export function useApproval(ref: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.approvals.detail(ref ?? ""),
    queryFn: () => client.getApproval(ref as string),
    enabled: Boolean(ref),
  });
}

/* ---- Quotations (M07-S03) ------------------------------------------- */

export function useQuotation(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.quotations.detail(id ?? ""),
    queryFn: () => client.getQuotation(id as string),
    enabled: Boolean(id),
  });
}

/** §18 — placeholder until Finance supplies the numbers, and labelled as such. */
export function useRateCard() {
  const client = useApi();
  return useQuery({ queryKey: ["rate-card"] as const, queryFn: () => client.getRateCard() });
}

/**
 * `PUT /v1/quotations/{id}` recalculates server-side and refuses a sell price
 * below the binding floor with `422 FLOOR_PRICE_BREACH`.
 */
export function useSaveQuotation(id: string | undefined) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: QuotationWrite) => client.putQuotation(id as string, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.quotations.detail(id ?? "") });
    },
  });
}

/** `POST /v1/actions` `type: QUOTATION_APPLY` — writes the price onto the proposal. */
export function useApplyQuotation(id: string | undefined) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation<ActionResponse, unknown, ActionRequest>({
    /* §3 replays a key with the same body and refuses it with a different
       one, so a key is what stops a double-clicked send from queueing two
       approvals. These two writes were sending none at all. */
    mutationFn: (request) => client.performAction(request, { idempotencyKey: newIdempotencyKey() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.quotations.detail(id ?? "") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.all });
    },
  });
}

/** The direct cost a set of lines adds up to, as `putQuotation` recomputes it. */
export const directCostOf = (lines: readonly QuotationLine[]): number =>
  lines.reduce((total, line) => total + line.total.amount, 0);
