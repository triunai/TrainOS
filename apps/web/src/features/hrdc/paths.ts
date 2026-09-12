import { DOCUMENT_CIRCULAR_09, ENGAGEMENT_AURORA } from "@trainos/contract";

/**
 * Where the HRD Corp screens live, and what the nav leaves resolve to.
 *
 * Paths follow the navigation rule (`navPath`): Compliance › HRD Corp is
 * `/compliance/hrd-corp`. The two record patterns have no nav leaf of their
 * own, so they are written out beside the leaves they hang from.
 *
 * The pack draws M12-S02 and M12-S08 as record screens and the nav tree has no
 * list above either — "HRD Corp" and "Rule changes" are leaves. Rather than
 * invent a list the pack never specified, a leaf opens the record the pack
 * itself is drawn from, and `/:ref` opens any other. Naming the default here
 * keeps a route, a link and a test from disagreeing about which record that is.
 */

export const HRDC_PACKET_PATH = "/compliance/hrd-corp";
export const HRDC_PACKET_PATTERN = "/compliance/hrd-corp/:engagementRef";
export const HRDC_RULES_PATH = "/compliance/rules";
export const HRDC_RULE_CHANGES_PATH = "/compliance/rule-changes";
export const HRDC_RULE_CHANGE_PATTERN = "/compliance/rule-changes/:documentId";

/** ENG-0231 — the packet with two documents missing that M12-S02 is drawn from. */
export const DEFAULT_PACKET_ENGAGEMENT_REF = ENGAGEMENT_AURORA;

/** DOC-0219, Circular 09/2026 — the change set M12-S08 is drawn from. */
export const DEFAULT_RULE_CHANGE_DOCUMENT_ID = DOCUMENT_CIRCULAR_09;
