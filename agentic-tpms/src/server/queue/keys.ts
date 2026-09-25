/**
 * Idempotency keys that more than one module enqueues under. A key is a seam:
 * if two callers spell it differently, the queue's dedupe silently stops
 * deduping (R14). So each shared key is written once, here.
 */

/**
 * `commercial.draft_proposal` for one package version. Conversion from a
 * lead, direct creation, "Draft now" and a revision request all enqueue under
 * this key, so a freshly converted package gets one L3 draft, not two; a
 * revision bumps the package version and so earns a new draft.
 */
export function draftProposalKey(packageId: string, packageVersion: number): string {
  return `draft:${packageId}:v${packageVersion}`;
}
