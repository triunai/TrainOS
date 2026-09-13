/**
 * The settings feature's ONLY public surface (CLAUDE.md R5).
 *
 * The three Settings screens that are not about AI operations —
 * `features/settings-ai` owns those. One nav parent, two modules, because
 * "which model answers" and "how this company is configured" are different
 * subjects and CLAUDE.md asks for one file per module rather than one folder
 * per menu.
 */

export { OrganisationSettingsScreen } from "./OrganisationSettingsScreen";
export { TemplatesSettingsScreen } from "./TemplatesSettingsScreen";
export { PoliciesSettingsScreen } from "./PoliciesSettingsScreen";
export {
  SETTINGS_ORGANISATION_PATH,
  SETTINGS_POLICIES_PATH,
  SETTINGS_TEMPLATES_PATH,
} from "./paths";
