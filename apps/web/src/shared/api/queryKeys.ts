/**
 * The hierarchical query-key factory. Hooks never hardcode a key array.
 *
 * Hierarchy is what makes invalidation safe: invalidating `approvals.all`
 * clears every list and every detail beneath it without a hook having to know
 * which lists exist.
 */

import type { PageRequest } from "@trainos/contract";

const list = <const T extends readonly string[]>(root: T) =>
  ({
    all: root,
    lists: () => [...root, "list"] as const,
    list: (page?: PageRequest) => [...root, "list", page ?? null] as const,
    details: () => [...root, "detail"] as const,
    detail: (id: string) => [...root, "detail", id] as const,
  }) as const;

export const queryKeys = {
  me: ["me"] as const,
  navigation: ["navigation"] as const,
  badges: ["badges"] as const,
  pipelineConfig: ["config", "pipelines"] as const,
  search: (query: string) => ["search", query] as const,

  enquiries: list(["enquiries"] as const),
  followUps: list(["follow-ups"] as const),
  organisations: list(["organisations"] as const),
  contacts: list(["contacts"] as const),
  opportunities: list(["opportunities"] as const),
  tnas: list(["tnas"] as const),
  programmes: list(["programmes"] as const),
  proposals: list(["proposals"] as const),
  quotations: list(["quotations"] as const),
  approvals: list(["approvals"] as const),
  engagements: list(["engagements"] as const),
  complianceRules: list(["compliance-rules"] as const),
  ruleChanges: list(["rule-changes"] as const),
  hrdcDeadlines: list(["hrdc-deadlines"] as const),
  claimPackets: list(["claim-packets"] as const),
  invoices: list(["invoices"] as const),
  collections: list(["collections"] as const),
  knowledgeSources: list(["knowledge-sources"] as const),
  agents: list(["agents"] as const),
  runs: list(["runs"] as const),
  modelTiers: ["model-tiers"] as const,
  usage: ["usage"] as const,
  executiveDashboard: ["reports", "executive-dashboard"] as const,
} as const;
