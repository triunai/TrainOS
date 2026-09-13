/**
 * The HRD Corp feature's public surface — M12-S02, M12-S07 and M12-S08.
 *
 * Screens take their record as a prop; the `*Page` wrappers read it from the
 * URL. Everything else — hooks, the action-outcome composition, the stand-in
 * field — is the feature's own business and is deliberately not exported.
 */

export { SEVERITY_TONE, severityTone } from "./tone";
export { ClaimPacketScreen } from "./ClaimPacketScreen";
export { RulesRegistryScreen } from "./RulesRegistryScreen";
export { RuleChangeReviewScreen } from "./RuleChangeReviewScreen";
export { ClaimPacketPage, RuleChangeReviewPage } from "./pages";
export {
  DEFAULT_PACKET_ENGAGEMENT_REF,
  DEFAULT_RULE_CHANGE_DOCUMENT_ID,
  HRDC_PACKET_PATH,
  HRDC_PACKET_PATTERN,
  HRDC_RULES_PATH,
  HRDC_RULE_CHANGES_PATH,
  HRDC_RULE_CHANGE_PATTERN,
} from "./paths";
