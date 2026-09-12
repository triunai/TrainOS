/**
 * §17 · Knowledge sources — M16-S05.
 *
 * Corpus freshness and monitoring. A changed source is quarantined from rule
 * extraction until reviewed but stays searchable.
 */

import type { Timestamp } from '../envelope';
import type {
  EmbeddingStatus,
  KnowledgeSourceType,
  MonitorStatus,
  RetrievalScope,
} from '../enums';

/** §17 one ingested source document. */
export interface KnowledgeSource {
  id: string;
  name: string;
  type: KnowledgeSourceType;
  version: string;
  ingestedAt: Timestamp;
  chunks: number;
  embeddingStatus: EmbeddingStatus;
  lastCheckedAt: Timestamp | null;
  monitorStatus: MonitorStatus;
  /** e.g. `sha256:9f2c…` — the basis for `SourceChanged`. */
  contentHash: string;
  retrievalScopes: RetrievalScope[];
  /** Links the source to the rule-change set extracted from it (§17 M12-S08). */
  ruleChangeSetId: string | null;
}

/** §17 `POST /v1/knowledge/sources`. */
export interface KnowledgeSourceCreateRequest {
  name: string;
  type: KnowledgeSourceType;
  url?: string;
  retrievalScopes: RetrievalScope[];
}

/** §17 `POST /v1/knowledge/sources/{id}/check` — re-fetch and compare hashes. */
export interface KnowledgeSourceCheckResponse {
  id: string;
  monitorStatus: MonitorStatus;
  lastCheckedAt: Timestamp;
  contentHash: string;
  changed: boolean;
}

/** §17 `POST /v1/knowledge/sources/{id}/reingest`. */
export interface KnowledgeSourceReingestResponse {
  id: string;
  embeddingStatus: EmbeddingStatus;
  chunks: number;
  runId?: string;
}
