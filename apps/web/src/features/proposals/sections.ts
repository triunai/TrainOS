import type { ProposalSection } from "@trainos/contract";
import { aiVariantOf, type AIChipVariant } from "@/shared/components/kit";

/**
 * How a proposal section describes its own origin.
 *
 * A proposal is a mixed document — agent-generated, human-edited and template
 * sections side by side — so provenance is per section rather than per record.
 *
 * The rail and the section's AI chip must never disagree about the same
 * section, so both read from `aiVariantOf`, the kit's one decision about what a
 * provenance envelope means. This file supplies the words for the rail and, for
 * the one state the kit has no word for, for the chip as well.
 */

/** The confidence floor below which a section is flagged for review. */
export const REVIEW_THRESHOLD = 0.6;

/**
 * A section warns when the server flagged it or when its confidence sits under
 * the floor. It never hard-blocks the send: the pack is explicit that low
 * confidence warns, and that the flag must travel to the approver instead.
 */
export function needsReview(section: ProposalSection): boolean {
  if (section.needsReview === true) return true;
  const confidence = section.provenance?.confidence;
  return typeof confidence === "number" && confidence < REVIEW_THRESHOLD;
}

/**
 * A human touched an AI-written section.
 *
 * `aiVariantOf` collapses this into `suggested`, because the kit's variants
 * describe how much to trust a value rather than who last held the pen. On a
 * proposal the distinction is the point — the pack calls this state out by name
 * — so it is named here and passed to the chip as an explicit label rather than
 * left to disagree with the rail.
 */
export function isEdited(section: ProposalSection): boolean {
  return section.provenance?.editedBy !== undefined;
}

const VARIANT_LABEL: Record<AIChipVariant, string> = {
  human: "Template",
  system: "System",
  suggested: "AI suggested",
  executed: "AI executed",
  awaiting: "Awaiting approval",
  "low-confidence": "AI low confidence",
  failed: "AI failed",
};

export const EDITED_LABEL = "AI-assisted · edited";

/** The one-line description of where a section came from. */
export function originLabel(section: ProposalSection): string {
  if (isEdited(section)) return EDITED_LABEL;
  return VARIANT_LABEL[aiVariantOf(section.provenance, REVIEW_THRESHOLD)];
}
