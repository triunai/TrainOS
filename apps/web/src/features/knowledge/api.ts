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
import { queryKeys, toApiError, useApi, type ApiError } from "@/shared/api";

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
    /* Fired from a row overflow, a drawer footer and "Check all", none of which
       awaits it, and the screen no longer stacks a refusal banner of its own —
       §18 allows the page one banner and the changed source owns it. R11. */
    /* No `toastOnSuccess`: `KnowledgeSourcesScreen#runCheck` already fires a
       richer one per call — the source's name and whether a rule-change
       review opened — which a generic central copy would only flatten. */
    meta: { toastOnError: true },
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
    /* Fire-and-forget from a button: nothing awaits this call and no screen
       renders its `error`, so without the flag a refusal is invisible. R3.
       No `toastOnSuccess`: `KnowledgeSourcesScreen#runReingest` already fires
       one with the source's name in it. */
    meta: { toastOnError: true },
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
    /* Fire-and-forget from a button: nothing awaits this call and no screen
       renders its `error`, so without the flag a refusal is invisible. R3. */
    meta: {
      toastOnError: true,
      toastOnSuccess: (data) => `Knowledge source "${(data as KnowledgeSource).name}" added`,
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: knowledgeKeys.root });
    },
  });
}
