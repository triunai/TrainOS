/**
 * The leads queue's path, derived from the navigation tree's one rule
 * (`shared/config/nav.ts`): a child of `Sales` lives under `/sales/`.
 *
 * Kept beside the feature rather than in the route table so a sibling screen
 * can link here without importing the route file, and so the two cannot
 * disagree about where this screen lives.
 */

export const LEADS_QUEUE_PATH = "/sales/leads";
