/**
 * The approvals feature's ONLY public surface (CLAUDE.md R5).
 *
 * M02-S01 the grouped inbox, M02-S02 the decision screen, and the two paths the
 * route table and any sibling feature need to link to them. Everything else —
 * the hooks, the client adapter, the column definitions — is private.
 */

export { ApprovalInbox } from "./ApprovalInbox";
export { ApprovalDetail } from "./ApprovalDetail";
export { APPROVALS_PATH, APPROVAL_DETAIL_PATTERN, approvalPath } from "./paths";
