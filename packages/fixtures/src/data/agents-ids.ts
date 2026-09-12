/**
 * Agent ids the pack names but §0 does not pin.
 *
 * The five canonical ids live in `@trainos/contract`'s `fixtures-ids.ts`; the
 * design-pack inventory (§6.3 "Named agents") lists three more, and several
 * files reference them before `data/agents.ts` is constructed, so they sit in
 * their own module to keep the data graph acyclic.
 */

/** Drafts and sends collections reminders (M13-S05). */
export const AGENT_COLLECTIONS = "agent_collections";
/** Assembles HRD Corp claim packets and evaluates checks (M12-S02). */
export const AGENT_COMPLIANCE = "agent_compliance";
/** Matches enquiries to organisations and contacts (M03-S01). */
export const AGENT_MATCH = "agent_match";
