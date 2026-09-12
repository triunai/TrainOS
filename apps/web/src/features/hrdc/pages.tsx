import { useParams } from "react-router-dom";
import { ClaimPacketScreen } from "./ClaimPacketScreen";
import { RuleChangeReviewScreen } from "./RuleChangeReviewScreen";
import { DEFAULT_PACKET_ENGAGEMENT_REF, DEFAULT_RULE_CHANGE_DOCUMENT_ID } from "./paths";

/**
 * The route-facing wrappers.
 *
 * The screens themselves take their record as a prop and know nothing about the
 * router, so a test renders one without a MemoryRouter's URL and a drawer or a
 * preview can reuse it. Reading the URL is this file's only job.
 */

export function ClaimPacketPage() {
  const { engagementRef } = useParams();
  return <ClaimPacketScreen engagementRef={engagementRef ?? DEFAULT_PACKET_ENGAGEMENT_REF} />;
}

export function RuleChangeReviewPage() {
  const { documentId } = useParams();
  return <RuleChangeReviewScreen documentId={documentId ?? DEFAULT_RULE_CHANGE_DOCUMENT_ID} />;
}
