import { useQuery } from "@tanstack/react-query";
import type { ComplianceRule, ListResponse, Template } from "@trainos/contract";
import type { FixtureLibraryAsset } from "@trainos/fixtures";
import { queryKeys, toApiError, useApi, type ApiError } from "@/shared/api";

/**
 * The data boundary for the three Knowledge leaves that are not Sources —
 * Library, Templates and Knowledge base.
 *
 * Separate from `api.ts` rather than appended to it: `api.ts` holds the source
 * reads and the three writes M16-S05 depends on, and R9 makes committing
 * another lane's in-flight edits to that file the specific failure to avoid.
 * Same feature, same barrel, same error translation.
 *
 * All three reads. Nothing here writes, because nothing in the contract or the
 * fixture client offers a write for these collections, and a button that only
 * looks like it works is worse than no button.
 */

/** The reusable sales and delivery content. Fixture-derived; see the data file. */
export function useLibraryAssets() {
  const api = useApi();
  return useQuery<ListResponse<FixtureLibraryAsset>, ApiError>({
    queryKey: queryKeys.libraryAssets.lists(),
    queryFn: () => api.listLibraryAssets().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/** §2 `GET /v1/templates`. Read-only for the demo, as the contract says. */
export function useTemplates() {
  const api = useApi();
  return useQuery<ListResponse<Template>, ApiError>({
    queryKey: queryKeys.templates.lists(),
    queryFn: () => api.listTemplates().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * §17 the extracted rules, for a COUNT and nothing more.
 *
 * The Knowledge base screen says how much law has been read out of the corpus
 * and links to the registry that owns it. It deliberately does not restate the
 * rules: `features/hrdc/RulesRegistryScreen.tsx` already renders them with
 * their lineage and their quoted source text, and a second table over the same
 * rows is the divergence CLAUDE.md calls a defect.
 */
export function useExtractedRules() {
  const api = useApi();
  return useQuery<ListResponse<ComplianceRule>, ApiError>({
    queryKey: queryKeys.complianceRules.lists(),
    queryFn: () => api.listComplianceRules().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}
