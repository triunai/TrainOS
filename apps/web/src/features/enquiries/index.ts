/**
 * The enquiries feature's public surface.
 *
 * Anything another feature or the route table needs comes from here. The
 * dependency-cruiser rule `no-cross-feature-internals` makes that a build error
 * rather than a convention.
 */

export { EnquiryInboxPage } from "./EnquiryInboxPage";
export { EnquiryDetailPage } from "./EnquiryDetailPage";
export { FollowUpQueuePage } from "./FollowUpQueuePage";
export {
  ENQUIRY_DETAIL_PATH,
  ENQUIRY_DETAIL_PATTERN,
  ENQUIRY_INBOX_PATH,
  FOLLOW_UP_QUEUE_PATH,
} from "./paths";
