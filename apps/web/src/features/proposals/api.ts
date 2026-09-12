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
import { fixtureClient, isContractError, type FixtureClient } from "@trainos/fixtures";
import { queryKeys } from "@/shared/api";
import { useMe } from "@/shared/hooks/useMe";

/**
 * The proposals and quotations data layer.
 *
 * TEMPORARY SHAPE — `useApi()` belongs in `src/shared/api` and is duplicated
 * here only because `shared/api` is still the scaffold's NOT_IMPLEMENTED stub
 * and this feature may not write outside `features/proposals`. When the shared
 * hook lands, delete `useApi` from this file and import it; nothing else moves.
 *
 * Every governed write on these two screens goes through `performAction`. The
 * screens render the response variant — EXECUTED, QUEUED_FOR_APPROVAL or
 * SUGGESTED — rather than deciding anything themselves.
 */

/** Shell role -> the fixture principal that holds that role's permissions. */
const ACTOR_FOR_ROLE: Readonly<Record<Role, string>> = {
  SALES: USER_AMIRAH,
  SALES_MANAGER: USER_KELVIN,
  OPS: USER_SITI,
  FINANCE: USER_JASON,
  MD: "u_lim",
  ADMIN: USER_KHAIRUL,
  TRAINER: TRAINER_FARAH,
  CLIENT: USER_AMIRAH,
  AGENT: USER_AMIRAH,
};

export function useApi(): FixtureClient {
  const { me } = useMe();
  const actorId = ACTOR_FOR_ROLE[me.role];
  if (fixtureClient.actorId !== actorId) fixtureClient.signInAs(actorId);
  return fixtureClient;
}

/* ---- The action envelope --------------------------------------------- */

/**
 * `ActionRequest` leaves `payload` open and parameterised because the contract
 * gives an example per section rather than a closed schema, so the envelope's
 * default `Record<string, unknown>` and a named payload interface do not
 * structurally overlap.
 *
 * The widening happens ONCE, here, where it can be read and justified, instead
 * of as a cast at every call site. A screen keeps the named payload type — and
 * therefore the compile error when the payload's shape changes.
 */
export type AnyActionRequest = ActionRequest<Record<string, unknown>>;

export const actionRequest = <P extends object>(request: ActionRequest<P>): AnyActionRequest =>
  request as unknown as AnyActionRequest;

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
    mutationFn: (request) => client.performAction(request),
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
    mutationFn: (request) => client.performAction(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.quotations.detail(id ?? "") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.all });
    },
  });
}

/** The direct cost a set of lines adds up to, as `putQuotation` recomputes it. */
export const directCostOf = (lines: readonly QuotationLine[]): number =>
  lines.reduce((total, line) => total + line.total.amount, 0);
