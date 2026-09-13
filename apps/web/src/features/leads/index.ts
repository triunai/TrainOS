/**
 * The leads feature's public surface. Anything the route table or a sibling
 * feature needs comes from here; `no-cross-feature-internals` makes reaching
 * past this file a build error rather than a convention.
 */

export { LeadsQueuePage } from "./LeadsQueuePage";
export { LEADS_QUEUE_PATH } from "./paths";
