import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActionRequest,
  ActionResponse,
  FloorPriceBreachDetails,
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
import { isDomainError, queryKeys, stableIdempotencyKey, toApiError, useApi } from "@/shared/api";

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

/**
 * The `FLOOR_PRICE_BREACH` detail bag (§6 `FloorPriceBreachDetails`).
 *
 * This used to be a local interface re-declaring three fields the contract did
 * not have, read off a cast (W-65). The contract declares them now, so the
 * only thing left to do here is narrow: `ErrorDetails` is one bag keyed by
 * code, every key optional, because a caller that has not checked `code` has
 * no business assuming any of them are present.
 *
 * The narrowing is a check, not a cast. A refusal that arrives without both
 * floors is not a floor breach this screen can explain — returning a
 * half-populated object would put `undefined` into the banner's sentence, so
 * it returns null and the screen falls back to the generic refusal surface.
 *
 * It asks the SEAM whether this is a refusal, not the fixture package. The
 * test was `isContractError`, which is the oracle's own class: true for a
 * refusal the fixture client threw and false for the identical refusal raised
 * by `core.put_quotation` as SQLSTATE `TRNOS`. On Supabase the floor-price
 * banner — the whole point of M07-S03 — would simply have stopped appearing.
 * `toApiError` narrows both, and is idempotent, so an `ApiErrorException` that
 * has already been converted is not reclassified as a transport failure.
 */
export function floorBreachOf(error: unknown): FloorPriceBreachDetails | null {
  if (error === null || error === undefined) return null;
  const refusal = toApiError(error);
  if (!isDomainError(refusal) || refusal.code !== "FLOOR_PRICE_BREACH") return null;
  const details = refusal.details;
  if (
    !details ||
    details.floorPrice === undefined ||
    details.resultingMarginRate === undefined ||
    details.requiresPolicy === undefined ||
    details.absoluteFloorPrice === undefined ||
    details.marginFloorPrice === undefined ||
    details.bindingFloorBasis === undefined
  ) {
    return null;
  }
  return {
    floorPrice: details.floorPrice,
    resultingMarginRate: details.resultingMarginRate,
    requiresPolicy: details.requiresPolicy,
    absoluteFloorPrice: details.absoluteFloorPrice,
    marginFloorPrice: details.marginFloorPrice,
    bindingFloorBasis: details.bindingFloorBasis,
  };
}

/* ---- Proposals (M07-S02) -------------------------------------------- */

/**
 * Every proposal, for the list half of M07-S02.
 *
 * `listProposals` is one of the three collections §13 never published and the
 * client now carries. Nothing here filters: the facets the list needs — status,
 * whether an agent drafted it — are not server filter fields.
 */
export function useProposals() {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.proposals.lists(),
    queryFn: () => client.listProposals(),
  });
}

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
    /* An explicit "Save" click on the editor panel, not autosave-on-keystroke
       — see `ProposalBuilderPage`'s `SectionEditor` — so one toast per save is
       the right cardinality, not noise. */
    meta: { toastOnSuccess: "Section saved" },
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
    meta: { toastOnSuccess: "Section added" },
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
    /* The content changes underneath the reader without them typing anything
       — the one write here where "did that actually run" is a real question,
       not merely an unconfirmed one. */
    meta: { toastOnSuccess: "Section regenerated" },
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
       approvals. These two writes were sending none at all, then sent a fresh
       `randomUUID()` per attempt — which is no key at all wearing one, since a
       value that never repeats can never be recognised as a repeat. */
    mutationFn: (request) =>
      client.performAction(request, { idempotencyKey: stableIdempotencyKey(request) }),
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

/**
 * Every quotation, priced, for the list half of M07-S03.
 *
 * Gated as the record is: `quotation:read` is withheld from OPS, so this
 * REFUSES for that role rather than returning an empty page. R2 — a refusal is
 * the server answering, and the screen renders it as an answer.
 */
export function useQuotations() {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.quotations.lists(),
    queryFn: () => client.listQuotations(),
    /* A `FORBIDDEN` is a fact about the request, not a transport hiccup.
       Retrying it would spend three round trips arriving at the same sentence. */
    retry: false,
  });
}

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
    /* Fire-and-forget from a button: nothing awaits this call and no screen
       renders its `error`, so without the flag a refusal is invisible. R3.
       `CostingWorksheetPage`'s "Save" had no success feedback at all — the
       price simply updated on screen, indistinguishable from a click that had
       not landed yet. */
    meta: { toastOnError: true, toastOnSuccess: "Quotation saved" },
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
       approvals. These two writes were sending none at all, then sent a fresh
       `randomUUID()` per attempt — which is no key at all wearing one, since a
       value that never repeats can never be recognised as a repeat. */
    mutationFn: (request) =>
      client.performAction(request, { idempotencyKey: stableIdempotencyKey(request) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.quotations.detail(id ?? "") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.all });
    },
  });
}

/** The direct cost a set of lines adds up to, as `putQuotation` recomputes it. */
export const directCostOf = (lines: readonly QuotationLine[]): number =>
  lines.reduce((total, line) => total + line.total.amount, 0);
