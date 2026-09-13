/**
 * The compliance feature's paths, by the navigation tree's one rule: a child of
 * Compliance lives under `/compliance/`.
 *
 * Deliberately NOT in `features/hrdc`. That folder is the M12 record screens —
 * the claim packet, the rules registry, the rule-change review — and these two
 * are cross-engagement registers over the same data. One more screen in a
 * folder of three unrelated ones is how a feature stops being a black box.
 */

export const COMPLIANCE_DOCUMENTS_PATH = "/compliance/documents";
export const COMPLIANCE_DEADLINES_PATH = "/compliance/deadlines";
