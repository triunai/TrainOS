/**
 * The content library — the Knowledge › Library nav leaf.
 *
 * NOT a contract surface, and drawn nowhere in the design pack. The Knowledge
 * group holds four leaves and the contract only describes two of them:
 * `GET /v1/knowledge/sources` (§17, the MONITORED external corpus) and
 * `GET /v1/templates` (§2, the document templates). The Library is the third
 * thing a training business keeps and neither of those covers: the reusable
 * SALES AND DELIVERY content — programme outlines, case studies, trainer
 * profiles, the proposal paragraphs that get reused — which the proposal
 * generator draws on when it writes.
 *
 * Two properties are deliberately shared with `KnowledgeSource` rather than
 * reinvented, because they are the same two questions asked of a different
 * corpus: `retrievalScopes` decides what an agent may cite it in, and a status
 * decides whether what it says is still true. An internal asset that is not
 * `CLIENT_FACING` can inform a staff answer and can never reach a proposal —
 * the same rule the Sources screen states, applied to the other half of the
 * corpus.
 *
 * Every asset points at a record that exists in this dataset, so nothing here
 * is a name with nothing behind it.
 */

import type { Actor, Ref, RetrievalScope, Timestamp } from "@trainos/contract";
import {
  ORG_AURORA,
  PROGRAMME_CONFLICT,
  PROGRAMME_DATA_LITERACY,
  PROGRAMME_LEADING_CHANGE,
  PROPOSAL_AURORA,
  TRAINER_FARAH_REF,
  USER_AMIRAH,
  USER_SITI,
} from "@trainos/contract";
import { PROGRAMME_SAFETY, PROGRAMME_SALES_EXCELLENCE, TRAINER_LEE_REF } from "./programmes";
import { actorFor } from "./tenant";

/** What kind of content it is. Decides how it is reused, not how it looks. */
export type LibraryAssetKind =
  | "PROGRAMME_OUTLINE"
  | "CASE_STUDY"
  | "TRAINER_PROFILE"
  | "PROPOSAL_SECTION"
  | "ONE_PAGER"
  | "EVALUATION_REPORT";

/**
 * Whether the asset can be relied on.
 *
 * `NEEDS_REVIEW` is the state that earns the screen: an asset whose subject has
 * moved on is still being cited until somebody says otherwise, which is exactly
 * the failure the Sources screen guards against on the other corpus.
 */
export type LibraryAssetStatus = "PUBLISHED" | "DRAFT" | "NEEDS_REVIEW" | "ARCHIVED";

/** One reusable piece of content. Fixture-only — see the file header. */
export interface FixtureLibraryAsset {
  id: string;
  title: string;
  kind: LibraryAssetKind;
  /** Monotonic. Shown in mono beside the title, per the tightening brief §1. */
  version: number;
  owner: Actor;
  updatedAt: Timestamp;
  /** The record the asset is about — a programme, a trainer, an account. */
  subjectRef: Ref | null;
  /** The same vocabulary a knowledge source uses. Gates client-facing reuse. */
  retrievalScopes: RetrievalScope[];
  status: LibraryAssetStatus;
  /** How many generated documents have drawn on it. */
  timesUsed: number;
  lastUsedAt: Timestamp | null;
  format: "PDF" | "DOCX" | "MD" | "PPTX";
  sizeBytes: number;
}

const AMIRAH = actorFor(USER_AMIRAH);
const SITI = actorFor(USER_SITI);

/** Nine assets. Three states, five kinds, every subject a real record. */
export const libraryAssets: FixtureLibraryAsset[] = [
  {
    id: "lib_0101",
    title: "Leading Through Change — programme outline",
    kind: "PROGRAMME_OUTLINE",
    version: 4,
    owner: SITI,
    updatedAt: "2026-10-02T09:15:00+08:00",
    subjectRef: PROGRAMME_LEADING_CHANGE,
    retrievalScopes: ["CLIENT_FACING", "COMPLIANCE"],
    status: "PUBLISHED",
    timesUsed: 31,
    lastUsedAt: "2026-11-13T16:40:00+08:00",
    format: "PDF",
    sizeBytes: 486_112,
  },
  {
    id: "lib_0104",
    title: "Data Literacy for Managers — programme outline",
    kind: "PROGRAMME_OUTLINE",
    version: 2,
    owner: SITI,
    updatedAt: "2026-09-18T11:00:00+08:00",
    subjectRef: PROGRAMME_DATA_LITERACY,
    retrievalScopes: ["CLIENT_FACING"],
    status: "PUBLISHED",
    timesUsed: 12,
    lastUsedAt: "2026-11-06T10:05:00+08:00",
    format: "PDF",
    sizeBytes: 402_880,
  },
  {
    /* The only asset whose subject changed under it: the safety programme is
       the one the HRD Corp trainer-accreditation rule bites on, and this
       outline still describes the old accreditation position. Cited 18 times
       and not reviewed since June — the case the screen is for. */
    id: "lib_0108",
    title: "Safety Leadership Essentials — programme outline",
    kind: "PROGRAMME_OUTLINE",
    version: 3,
    owner: SITI,
    updatedAt: "2026-06-11T14:20:00+08:00",
    subjectRef: PROGRAMME_SAFETY,
    retrievalScopes: ["CLIENT_FACING"],
    status: "NEEDS_REVIEW",
    timesUsed: 18,
    lastUsedAt: "2026-11-09T09:30:00+08:00",
    format: "PDF",
    sizeBytes: 511_904,
  },
  {
    id: "lib_0115",
    title: "Aurora Manufacturing — shopfloor leadership case study",
    kind: "CASE_STUDY",
    version: 1,
    owner: AMIRAH,
    updatedAt: "2026-07-30T16:45:00+08:00",
    subjectRef: ORG_AURORA,
    retrievalScopes: ["CLIENT_FACING"],
    status: "PUBLISHED",
    timesUsed: 9,
    lastUsedAt: "2026-11-12T15:20:00+08:00",
    format: "PDF",
    sizeBytes: 1_284_336,
  },
  {
    id: "lib_0119",
    title: "Farah Aziz — trainer profile",
    kind: "TRAINER_PROFILE",
    version: 6,
    owner: SITI,
    updatedAt: "2026-10-28T08:40:00+08:00",
    subjectRef: TRAINER_FARAH_REF,
    retrievalScopes: ["CLIENT_FACING", "COMPLIANCE"],
    status: "PUBLISHED",
    timesUsed: 27,
    lastUsedAt: "2026-11-13T16:40:00+08:00",
    format: "PDF",
    sizeBytes: 318_204,
  },
  {
    id: "lib_0121",
    title: "Lee Chin Hoe — trainer profile",
    kind: "TRAINER_PROFILE",
    version: 2,
    owner: SITI,
    updatedAt: "2026-09-04T13:10:00+08:00",
    subjectRef: TRAINER_LEE_REF,
    retrievalScopes: ["CLIENT_FACING", "COMPLIANCE"],
    status: "PUBLISHED",
    timesUsed: 11,
    lastUsedAt: "2026-11-06T10:05:00+08:00",
    format: "PDF",
    sizeBytes: 296_448,
  },
  {
    /* Internal only. It carries margin and delivery-cost commentary, so it may
       inform an internal answer and must never reach a client document. */
    id: "lib_0126",
    title: "Pricing and discount playbook",
    kind: "ONE_PAGER",
    version: 5,
    owner: AMIRAH,
    updatedAt: "2026-10-15T17:05:00+08:00",
    subjectRef: null,
    retrievalScopes: ["COMPLIANCE"],
    status: "PUBLISHED",
    timesUsed: 44,
    lastUsedAt: "2026-11-14T08:55:00+08:00",
    format: "MD",
    sizeBytes: 24_610,
  },
  {
    /* Written against the Aurora proposal and not yet published, so the
       generator cannot reach it. Draft is a real state, not an empty one. */
    id: "lib_0131",
    title: "HRDC claim guidance — standard paragraph",
    kind: "PROPOSAL_SECTION",
    version: 1,
    owner: AMIRAH,
    updatedAt: "2026-11-13T18:25:00+08:00",
    subjectRef: PROPOSAL_AURORA,
    retrievalScopes: ["CLIENT_FACING", "COMPLIANCE"],
    status: "DRAFT",
    timesUsed: 0,
    lastUsedAt: null,
    format: "MD",
    sizeBytes: 8_940,
  },
  {
    /* Superseded by the 2026 outline and kept for the record. Archived assets
       stay readable and are never cited. */
    id: "lib_0092",
    title: "Conflict to Collaboration — 2025 evaluation report",
    kind: "EVALUATION_REPORT",
    version: 1,
    owner: SITI,
    updatedAt: "2025-12-19T10:00:00+08:00",
    subjectRef: PROGRAMME_CONFLICT,
    retrievalScopes: ["COMPLIANCE"],
    status: "ARCHIVED",
    timesUsed: 3,
    lastUsedAt: "2026-02-11T11:45:00+08:00",
    format: "PDF",
    sizeBytes: 742_016,
  },
  {
    id: "lib_0135",
    title: "Sales Excellence for Store Managers — programme outline",
    kind: "PROGRAMME_OUTLINE",
    version: 2,
    owner: SITI,
    updatedAt: "2026-08-22T09:50:00+08:00",
    subjectRef: PROGRAMME_SALES_EXCELLENCE,
    retrievalScopes: ["CLIENT_FACING"],
    status: "PUBLISHED",
    timesUsed: 15,
    lastUsedAt: "2026-10-30T14:15:00+08:00",
    format: "PPTX",
    sizeBytes: 2_104_992,
  },
];
