import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActionRequest,
  ActionResponse,
  Actor,
  ClaimPacket,
  ComplianceChecksResponse,
  ComplianceRule,
  HrdcDocumentAttachRequest,
  HrdcPacketExport,
  ListResponse,
  RuleChangeSet,
} from "@trainos/contract";
import { fixtureClient, isContractError, type FixtureClient } from "@trainos/fixtures";
import { ApiErrorException, domainErrorFromEnvelope, queryKeys } from "@/shared/api";

/**
 * The HRD Corp feature's data boundary. Screens call hooks from this file and
 * never touch a client directly.
 *
 * `useApi()` is the seam. Today it hands back the fixture singleton; when the
 * scaffold lands a shared provider, only this function changes and no screen
 * moves. It is deliberately a hook rather than a bare import so a test can
 * swap the instance later without a module mock.
 */
export function useApi(): FixtureClient {
  return fixtureClient;
}

/**
 * Fixture errors are THROWN `ContractError`s; the app's query layer speaks
 * `ApiError`. Translating at the boundary is what makes the shared retry rule
 * correct — a 422 is a fact about the request and must never be replayed —
 * and what lets `ErrorState` show the server's own sentence.
 *
 * This belongs in `shared/api` beside `toApiError` once that module owns the
 * fixture client; it is here because a feature may not write to shared.
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

/** Who the action envelope records as the requester. */
export function useActor(): Actor | undefined {
  const api = useApi();
  const { data } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => call(() => api.getMe()),
  });
  return data ? { kind: "HUMAN", id: data.id, name: data.name } : undefined;
}

/* ---- M12-S02 · claim packet ----------------------------------------- */

export function useClaimPacket(engagementRef: string) {
  const api = useApi();
  return useQuery<ClaimPacket>({
    queryKey: queryKeys.claimPackets.detail(engagementRef),
    queryFn: () => call(() => api.getClaimPacket(engagementRef)),
  });
}

export function useComplianceChecks(engagementRef: string) {
  const api = useApi();
  return useQuery<ComplianceChecksResponse>({
    queryKey: [...queryKeys.complianceRules.all, "checks", engagementRef],
    queryFn: () => call(() => api.getComplianceChecks(engagementRef)),
  });
}

/**
 * The one governed write on M12-S02.
 *
 * No toast: the screen renders the refusal inline, next to the disabled
 * button, because a 422 here names the documents that are missing and that
 * list is the whole answer.
 */
export function useMarkPacketSubmitted(engagementRef: string) {
  const api = useApi();
  const actor = useActor();
  const queryClient = useQueryClient();

  return useMutation<ActionResponse, unknown, { reference: string; submittedAt: string }>({
    mutationFn: (payload) => {
      if (!actor) throw new Error("The principal is not loaded yet.");
      const request: ActionRequest = {
        type: "HRDC_PACKET_MARK_SUBMITTED",
        targetRef: engagementRef,
        payload,
        requestedBy: actor,
      };
      return call(() =>
        api.performAction(request, { idempotencyKey: `hrdc-submit-${engagementRef}` }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.claimPackets.all });
    },
  });
}

export function useAttachDocument(engagementRef: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation<ClaimPacket, unknown, HrdcDocumentAttachRequest>({
    mutationFn: (body) => call(() => api.attachPacketDocument(engagementRef, body)),
    meta: { toastOnError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.claimPackets.all });
    },
  });
}

export function useExportPacket(engagementRef: string) {
  const api = useApi();
  return useMutation<HrdcPacketExport, unknown, void>({
    mutationFn: () => call(() => api.exportClaimPacket(engagementRef)),
    meta: { toastOnError: true },
  });
}

/* ---- M12-S07 · rules registry --------------------------------------- */

export function useComplianceRules() {
  const api = useApi();
  return useQuery<ListResponse<ComplianceRule>>({
    queryKey: queryKeys.complianceRules.list(),
    queryFn: () => call(() => api.listComplianceRules()),
  });
}

/**
 * Adding a rule by hand. DECISIONS §3: it loads as PROPOSED and unverified —
 * the client cannot make a rule active, and the server ignores any attempt.
 */
export function useCreateComplianceRule() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation<ComplianceRule, unknown, Omit<ComplianceRule, "status">>({
    mutationFn: (body) => call(() => api.createComplianceRule(body)),
    meta: { toastOnError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.complianceRules.all });
    },
  });
}

/* ---- M12-S08 · rule change review ----------------------------------- */

export function useRuleChangeSet(documentId: string) {
  const api = useApi();
  return useQuery<RuleChangeSet>({
    queryKey: queryKeys.ruleChanges.detail(documentId),
    queryFn: () => call(() => api.getRuleChangeSet(documentId)),
  });
}

/**
 * Activating extracted rules. Ingestion proposes and never activates, so this
 * is an action-envelope call and the screen renders whichever of the three
 * outcomes comes back rather than assuming it executed.
 */
export function useApproveRuleChanges(documentId: string) {
  const api = useApi();
  const actor = useActor();
  const queryClient = useQueryClient();

  return useMutation<ActionResponse, unknown, { changeIds: string[] }>({
    mutationFn: ({ changeIds }) => {
      if (!actor) throw new Error("The principal is not loaded yet.");
      const request: ActionRequest = {
        type: "RULE_CHANGE_APPROVE",
        targetRef: documentId,
        payload: { documentId, changeIds },
        requestedBy: actor,
      };
      return call(() =>
        api.performAction(request, {
          idempotencyKey: `rule-change-${documentId}-${changeIds.join("+")}`,
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ruleChanges.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.complianceRules.all });
    },
  });
}
