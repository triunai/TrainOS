import type {
  AppliedFilter,
  AutonomyLevel,
  JuryPolicy,
  EvidenceType,
  Provenance,
  ProvenanceOrigin,
  SavedView,
} from "@trainos/contract";
import { formatMoney, humanise } from "./format";

/**
 * Contract shape → kit prop shape, in one leaf module.
 *
 * Sibling to `format.ts` and there for the same two structural reasons: a leaf
 * module cannot take part in an import cycle, and a file that exports both a
 * component and a plain function cannot be hot-replaced.
 *
 * The rule for what belongs: a function here turns something the API sent into
 * something a kit component takes. It imports no React and no component.
 * Anything that turns a value into a display string lives in `format.ts`.
 *
 * Why these live in the kit rather than on each screen: every one of them is a
 * decision that must come out the same on every screen. A low-confidence value
 * looks the same in the enquiry list and in the approval queue because
 * `aiVariantOf` decides it once, here.
 */

/* ---- AI provenance -------------------------------------------------- */

export type AIChipVariant =
  "human" | "system" | "suggested" | "executed" | "awaiting" | "low-confidence" | "failed";

/**
 * Pick the AI badge variant from a contract `Provenance`.
 *
 * `lowConfidenceBelow` is the threshold at which a normal AI badge becomes the
 * amber-dotted one. REPORT.md is explicit that low confidence WARNS and never
 * blocks, and that the flag must travel to the approver — so this changes how
 * the badge looks and never whether the value is usable.
 *
 * Absent provenance is human-authored (contract §1), which is why `human` is
 * the answer for undefined rather than an error.
 */
export function aiVariantOf(
  provenance: Provenance | undefined,
  lowConfidenceBelow = 0.6,
): AIChipVariant {
  if (!provenance) return "human";

  const origin: ProvenanceOrigin = provenance.origin;
  if (origin === "HUMAN") return "human";
  if (origin === "SYSTEM") return "system";

  if (typeof provenance.confidence === "number" && provenance.confidence < lowConfidenceBelow) {
    return "low-confidence";
  }

  return origin === "AI_EXECUTED" ? "executed" : "suggested";
}

/* ---- Autonomy ladder ------------------------------------------------ */

/**
 * The four rungs, with the wording and the paint each one carries.
 *
 * Border weight rises with the rung — verbatim from the artboard: "Border
 * weight rises with autonomy, so the riskiest state reads hardest at a glance
 * without a second hue." OBSERVE is neutral because observing is not an AI
 * action a user has to weigh.
 */
export const AUTONOMY_RUNGS: Record<
  AutonomyLevel,
  { label: string; caption: string; className: string }
> = {
  OBSERVE: {
    label: "Observe",
    caption: "logs only",
    className: "bg-surface text-ink-secondary border border-border",
  },
  SUGGEST: {
    label: "Suggest",
    caption: "drafts, human sends",
    className: "bg-ai-tint text-primary-hover border border-primary-border",
  },
  ACT_WITH_APPROVAL: {
    label: "Act w/ approval",
    caption: "queued to Approvals",
    className: "bg-ai-tint text-primary-hover border border-primary-border",
  },
  AUTONOMOUS: {
    label: "Autonomous",
    caption: "acts, notifies after",
    className: "bg-ai-tint text-primary-hover border-[1.5px] border-primary font-semibold",
  },
};

/** The ladder in order, lowest rung first. Drives the matrix and the showcase. */
export const AUTONOMY_LADDER: AutonomyLevel[] = [
  "OBSERVE",
  "SUGGEST",
  "ACT_WITH_APPROVAL",
  "AUTONOMOUS",
];

/** The wording a rung uses, so a screen's copy cannot drift from the chip's. */
export function autonomyCaption(level: AutonomyLevel): string {
  return AUTONOMY_RUNGS[level].caption;
}

/* ---- Jury ----------------------------------------------------------- */

/** What a configured jury will actually do, as a sentence for the tooltip. */
export function describeJuryPolicy(policy: JuryPolicy): string {
  const quorum = `${policy.quorum} of ${policy.of}`;

  if (policy.mode === "GATE") {
    return `Gate · ${quorum} at promotion time against the golden set. Never blocks a live action.`;
  }

  if (policy.mode === "SAMPLE") {
    const rate =
      typeof policy.sampleRate === "number"
        ? ` ${Math.round(policy.sampleRate * 100)}% of actions.`
        : "";
    return `Sample · ${quorum} after the human decides, for drift monitoring.${rate} Never blocks.`;
  }

  const triggers = policy.triggers;
  if (!triggers) return `Escalate · ${quorum} when a trigger fires.`;

  const conditions = [
    `below confidence ${triggers.minConfidence}`,
    `above ${formatMoney(triggers.maxValue, true)}`,
    triggers.firstOfKind ? "first-of-kind" : null,
  ].filter(Boolean);

  return `Escalate · ${quorum} blocks ${conditions.join(", or ")}.`;
}

/* ---- Typed record tags ---------------------------------------------- */

/**
 * Contract `EvidenceType` → the artboards' three-letter tag.
 *
 * Type first, then identity. In a mixed result list the tag is what makes the
 * list scannable, and three characters is the width that keeps a column of
 * them aligned.
 */
export const TYPE_TAG: Record<EvidenceType, string> = {
  EMAIL: "EML",
  TNA: "TNA",
  PROGRAMME: "PRG",
  TRAINER: "TRN",
  TRAINER_AVAILABILITY: "AVL",
  QUOTATION: "QUO",
  QUESTIONNAIRE: "QNR",
  HISTORY: "HIS",
  CATALOGUE: "CAT",
  HRDC_STATEMENT: "HRD",
  PARTICIPANT_QUERY: "PTQ",
  ORGANISATION: "ORG",
  CONTACT: "CON",
  INVOICE: "INV",
  PROPOSAL: "PRO",
  ACTION: "ACT",
};

/* ---- Action outcomes ------------------------------------------------ */

export interface ActionError {
  /** The sentence to show. The server's own wording beats anything composed here. */
  message: string;
  /** A machine code, shown small beneath the message when there are no blockers. */
  code?: string;
  /** §8 `details.blockers[]`. Rendered individually; this is the actionable part. */
  blockers?: string[];
}

/**
 * Pull an {@link ActionError} out of whatever a mutation threw.
 *
 * Defensive on purpose: this runs on the failure path, and a describe function
 * that throws while describing a throw turns a handled refusal into a blank
 * screen. Every access is guarded and there is always a sentence at the end.
 */
export function describeActionError(
  error: unknown,
  fallback = "The action did not go through",
): ActionError {
  if (typeof error === "string") return { message: error };

  const bag = (error ?? {}) as Record<string, unknown>;
  const details = (bag.details ?? {}) as Record<string, unknown>;

  const rawBlockers = details.blockers;
  const blockers = Array.isArray(rawBlockers)
    ? rawBlockers.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  const message =
    (typeof bag.message === "string" && bag.message) ||
    (typeof bag.code === "string" && humanise(bag.code)) ||
    fallback;

  return {
    message,
    ...(typeof bag.code === "string" ? { code: bag.code } : {}),
    ...(blockers && blockers.length > 0 ? { blockers } : {}),
  };
}

/* ---- List chrome ---------------------------------------------------- */

export interface FilterChipModel {
  /** Stable id for dismissal. Usually `${field}:${op}`. */
  id: string;
  /** The field's display name, e.g. "Stage". */
  label: string;
  /** The value as a user would read it, e.g. "Proposal sent". */
  value: string;
  /** A `VIEW` filter belongs to the saved view and cannot be dismissed alone. */
  locked?: boolean;
}

/**
 * Map contract filters onto chips. `format` turns an opaque value into words.
 *
 * `AppliedFilter.source` decides `locked`: a `VIEW` filter came from the saved
 * view and a `REQUEST` filter from the user, and the two dismiss differently —
 * removing a view's filter means leaving the view.
 */
export function chipsFromFilters(
  filters: AppliedFilter[],
  format: (filter: AppliedFilter) => { label: string; value: string },
): FilterChipModel[] {
  return filters.map((filter) => ({
    id: `${filter.field}:${filter.op}`,
    locked: filter.source === "VIEW",
    ...format(filter),
  }));
}

export interface PillTab {
  id: string;
  label: string;
  /** Rendered as a muted suffix. Omit when unknown, not when zero. */
  count?: number;
}

/**
 * Map contract saved views onto tabs.
 *
 * Saved views are server-side "so pill tabs and their counts stay consistent
 * across devices" (contract §2), which is why the count comes from the view
 * rather than from counting rows on the client.
 */
export function tabsFromViews(views: SavedView[]): PillTab[] {
  return views.map((view) => ({ id: view.id, label: view.label, count: view.count }));
}
