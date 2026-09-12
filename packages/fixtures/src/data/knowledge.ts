/**
 * §17 · Knowledge sources — M16-S05.
 *
 * Six sources, carrying the three states the screen renders: one changed and
 * quarantined from rule extraction but still searchable, one embedding still
 * pending, and one whose fetch has been failing since 07 Nov.
 */

import type { KnowledgeSource } from "@trainos/contract";
import { DOCUMENT_CIRCULAR_04, DOCUMENT_CIRCULAR_09, SOURCE_CIRCULAR_09 } from "@trainos/contract";

/** Source ids beyond the canonical `src_0219`. */
export const SOURCE_CIRCULAR_04 = "src_0188";
export const SOURCE_ACM_2026 = "src_0170";
export const SOURCE_TRAINER_GUIDELINES = "src_0155";
export const SOURCE_ETRIS_HELP = "src_0203";
export const SOURCE_INTERNAL_SOP = "src_0240";

/** §17 `GET /v1/knowledge/sources`. */
export const knowledgeSources: KnowledgeSource[] = [
  {
    id: SOURCE_CIRCULAR_09,
    name: "Circular 09/2026",
    type: "HRDC_CIRCULAR",
    version: "v1",
    ingestedAt: "2026-11-14T09:40:00+08:00",
    chunks: 142,
    embeddingStatus: "INDEXED",
    lastCheckedAt: "2026-11-14T09:40:00+08:00",
    /** Changed: quarantined from rule extraction until reviewed, still searchable. */
    monitorStatus: "CHANGED_REVIEW_PENDING",
    contentHash: "sha256:9f2c4a17d8b3e0596c71f2a4d8e0b13c7a95f2e6d40b81c93a5e7f02d6c4b8a1",
    retrievalScopes: ["COMPLIANCE", "CLIENT_FACING"],
    ruleChangeSetId: DOCUMENT_CIRCULAR_09,
  },
  {
    id: SOURCE_CIRCULAR_04,
    name: "Circular 04/2026",
    type: "HRDC_CIRCULAR",
    version: "v2",
    ingestedAt: "2026-06-18T08:00:00+08:00",
    chunks: 118,
    embeddingStatus: "INDEXED",
    lastCheckedAt: "2026-11-10T02:00:00+08:00",
    monitorStatus: "WATCHING",
    contentHash: "sha256:41b8e7c2905da6f31e8407b5c2d9f6083a1e47b29c05d8f1a6b3e920c74d5f88",
    retrievalScopes: ["COMPLIANCE"],
    ruleChangeSetId: DOCUMENT_CIRCULAR_04,
  },
  {
    id: SOURCE_ACM_2026,
    name: "Allowable Cost Matrix 2026",
    type: "HRDC_CIRCULAR",
    version: "v1",
    ingestedAt: "2026-02-14T08:00:00+08:00",
    chunks: 64,
    embeddingStatus: "INDEXED",
    lastCheckedAt: "2026-11-10T02:00:00+08:00",
    monitorStatus: "WATCHING",
    contentHash: "sha256:7d20af9163c4e8b05f72a1d9038e6c45b28f01a7d6e39c840b15f7a2e93c6d04",
    retrievalScopes: ["COMPLIANCE"],
    ruleChangeSetId: null,
  },
  {
    id: SOURCE_TRAINER_GUIDELINES,
    name: "HRD Corp trainer guidelines",
    type: "HRDC_CIRCULAR",
    version: "v3",
    ingestedAt: "2026-11-13T21:00:00+08:00",
    chunks: 0,
    /** Ingested but not yet vectorised — the pending row on M16-S05. */
    embeddingStatus: "PENDING",
    lastCheckedAt: "2026-11-13T21:00:00+08:00",
    monitorStatus: "WATCHING",
    contentHash: "sha256:0c6f38b91da24e7503c8b1f6a90d47e25b83f1c04a7d69e820b53f1c9a6e70d2",
    retrievalScopes: ["COMPLIANCE"],
    ruleChangeSetId: null,
  },
  {
    id: SOURCE_ETRIS_HELP,
    name: "eTRIS submission help centre",
    type: "HRDC_CIRCULAR",
    version: "v1",
    ingestedAt: "2026-08-02T08:00:00+08:00",
    chunks: 87,
    embeddingStatus: "FAILED",
    lastCheckedAt: "2026-11-07T02:00:00+08:00",
    /** Fetch has been failing since 07 Nov — the banner M16-S05 renders. */
    monitorStatus: "FAILED",
    contentHash: "sha256:b419d7e0532c86af1b04e93d72c5a608f1d47b2e90c36a5f8b2140e7c93d6a5b",
    retrievalScopes: ["COMPLIANCE"],
    ruleChangeSetId: null,
  },
  {
    id: SOURCE_INTERNAL_SOP,
    name: "Akademi Perdana delivery SOP",
    type: "HRDC_CIRCULAR",
    version: "v5",
    ingestedAt: "2026-09-30T08:00:00+08:00",
    chunks: 203,
    embeddingStatus: "INDEXED",
    lastCheckedAt: "2026-11-10T02:00:00+08:00",
    /** Maintained by hand, so the monitor does not watch it. */
    monitorStatus: "MANUAL",
    contentHash: "sha256:e582c10b7f439a6d25e08c1b47f2903da6b58e2c7104f3b9a8d62e5017c4b930",
    /** Searchable internally, excluded from client-facing generation. */
    retrievalScopes: ["COMPLIANCE"],
    ruleChangeSetId: null,
  },
];
