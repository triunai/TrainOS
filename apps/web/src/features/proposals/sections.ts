import type { ProposalSection } from "@trainos/contract";
import { humanise } from "@/shared/components/kit";

/**
 * How a proposal section describes its own origin.
 *
 * A proposal is a mixed document — agent-generated, human-edited and template
 * sections side by side — so provenance is per section rather than per record.
 * Pure functions, so the rule that decides "needs review" is testable without
 * mounting the builder.
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

/** The rail's one-line description of where a section came from. */
export function originLabel(section: ProposalSection): string {
  const provenance = section.provenance;
  if (!provenance) return "Template";
  if (provenance.editedBy) return "AI-assisted · edited";
  if (needsReview(section)) return "AI low confidence";
  return humanise(provenance.origin);
}
