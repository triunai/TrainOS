/**
 * The feature's own paths, derived from the navigation tree's rule
 * (`shared/config/nav.ts`): a child of `Sales` lives under `/sales/`.
 *
 * Kept here rather than in the route file so a screen can link to a sibling
 * without importing the route table, and so the two cannot disagree.
 *
 * The follow-up queue has no nav entry of its own in the design pack's TREE —
 * its breadcrumb reads Sales › Enquiries › Follow-up queue — so it lives under
 * the enquiries path. It is declared BEFORE the `:enquiryRef` pattern wherever
 * the two are mounted, or `follow-ups` would match as a record reference.
 */

export const ENQUIRY_INBOX_PATH = "/sales/enquiries";

export const FOLLOW_UP_QUEUE_PATH = "/sales/enquiries/follow-ups";

export const ENQUIRY_DETAIL_PATTERN = "/sales/enquiries/:enquiryId";

export const ENQUIRY_DETAIL_PATH = (ref: string): string =>
  `${ENQUIRY_INBOX_PATH}/${encodeURIComponent(ref)}`;
