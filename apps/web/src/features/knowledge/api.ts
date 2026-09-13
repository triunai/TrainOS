/**
 * Data access for the knowledge feature — M16-S05 (knowledge sources).
 *
 * Three writes, and the distinction between them is the screen's subject.
 * `checkKnowledgeSource` re-fetches a source and compares hashes; a changed
 * hash opens a rule-change review and does NOT change the corpus.
 * `reingestKnowledgeSource` rebuilds the chunks and embeddings, which does.
 * `createKnowledgeSource` adds one. Collapsing check and re-ingest into a
 * single "refresh" would let a monitoring action silently rewrite what the
 * agents are allowed to read.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  KnowledgeSource,
  KnowledgeSourceCheckResponse,
  KnowledgeSourceCreateRequest,
  KnowledgeSourceReingestResponse,
  ListResponse,
} from "@trainos/contract";
import { isContractError } from "@trainos/fixtures";
import {
  domainErrorFromEnvelope,
  queryKeys,
  transportError,
  useApi,
  type ApiError,
} from "@/shared/api";

/**
 * `ContractError` → the scaffold's `ApiError`.
 *
 * DUPLICATED in `features/agents/api.ts` and `features/settings-ai/api.ts`.
 * It belongs in `shared/api`; reported to the team lead.
 */
export function toApiError(thrown: unknown): ApiError {
  if (isContractError(thrown)) return domainErrorFromEnvelope(thrown.toEnvelope());
  const message = thrown instanceof Error ? thrown.message : "Unknown error";
  return transportError("UNKNOWN", message, { cause: thrown });
}

export const knowledgeKeys = {
  sources: queryKeys.knowledgeSources.lists(),
  root: queryKeys.knowledgeSources.all,
} as const;

export function useKnowledgeSources(): UseQueryResult<ListResponse<KnowledgeSource>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<KnowledgeSource>, ApiError>({
    queryKey: knowledgeKeys.sources,
    queryFn: () => api.listKnowledgeSources().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/** Re-fetch and hash. A changed hash opens a rule-change review; it changes nothing. */
export function useCheckSource() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<KnowledgeSourceCheckResponse, ApiError, string>({
    mutationFn: (id) =>
      api.checkKnowledgeSource(id).catch((thrown) => Promise.reject(toApiError(thrown))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: knowledgeKeys.root });
    },
  });
}

/** Rebuild chunks and embeddings. This one does change what the agents read. */
export function useReingestSource() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<KnowledgeSourceReingestResponse, ApiError, string>({
    mutationFn: (id) =>
      api.reingestKnowledgeSource(id).catch((thrown) => Promise.reject(toApiError(thrown))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: knowledgeKeys.root });
    },
  });
}

export function useCreateSource() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<KnowledgeSource, ApiError, KnowledgeSourceCreateRequest>({
    mutationFn: (body) =>
      api.createKnowledgeSource(body).catch((thrown) => Promise.reject(toApiError(thrown))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: knowledgeKeys.root });
    },
  });
}
