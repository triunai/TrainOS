import { navPath } from "@/shared/config/nav";

/**
 * The settings feature's paths, derived from the nav tree's own rule.
 *
 * `features/settings-ai` already owns `/settings/ai-models`, `/settings/providers`
 * and `/settings/usage`. This feature owns the three that are not about AI —
 * the organisation, the templates and the policies — which is why they are a
 * separate module rather than three more screens in that folder: one file per
 * module, and "AI operations" and "how this company is configured" are two
 * different subjects that happen to share a nav parent.
 */

/** `/settings/organisation` — the tenant, its defaults and its pipelines. */
export const SETTINGS_ORGANISATION_PATH = navPath("Settings", "Organisation");

/** `/settings/templates` — every document, email and message template. */
export const SETTINGS_TEMPLATES_PATH = navPath("Settings", "Templates");

/** `/settings/policies` — the rule text behind every approval gate. */
export const SETTINGS_POLICIES_PATH = navPath("Settings", "Policies");
