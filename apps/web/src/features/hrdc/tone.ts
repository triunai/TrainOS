import { SEVERITIES, type Severity } from "@trainos/contract";
import type { StatusTone } from "@/shared/components/kit";

/**
 * The chip tone for a server-sent `Severity`.
 *
 * WHY IT LIVES HERE and not in `features/compliance`, where it was written.
 * `features/compliance` already imports `@/features/hrdc` for the packet path
 * (three screens do), so hrdc importing compliance back would be a cycle, and
 * `.dependency-cruiser.cjs`'s `no-circular` is an ERROR. Its own fix text says
 * to extract the shared piece into a module both sides import; hrdc is the
 * lower of the two, so the map comes down here and compliance re-exports it.
 * One definition, no cycle, and no second variant of a map that already exists.
 *
 * The obvious home is the kit's `statusTone.ts` beside the other twenty-five
 * tone maps, and that is where both copies should end up. It is deliberately
 * NOT done here: `statusTone.ts` is contended tonight — one lane has appended
 * maps to it and another has renamed a constant in it — so a third edit would
 * be a merge conflict for no behaviour gain. Recorded rather than done.
 *
 * TYPED EXHAUSTIVE, and that is the point. `Record<Severity, StatusTone>` makes
 * a new member of the contract's `Severity` a COMPILE error here rather than a
 * silent fall-through, which is R14 applied to a palette: the receiving side
 * rejects a value it does not know instead of quietly choosing a branch.
 */
const TONE: Record<Severity, StatusTone> = {
  INFO: "neutral",
  WARN: "warning",
  DANGER: "danger",
  ALERT: "danger",
};

/**
 * The tone for a severity, neutral for anything unrecognised.
 *
 * The runtime fallback is not redundant beside the typed map above. Several
 * fields in the contract carry a severity as a bare `string` — `HrdcDeadline`
 * is one — so a value the types promise cannot arrive still can, and a chip
 * must not be `undefined`-toned when it does. Neutral rather than alarming: a
 * chip must never invent an urgency the server did not send.
 */
export function severityTone(severity: string): StatusTone {
  return (SEVERITIES as readonly string[]).includes(severity)
    ? TONE[severity as Severity]
    : "neutral";
}

/**
 * The map itself, for the register models that index it directly.
 *
 * Prefer `severityTone`. This is exported because `features/compliance`'s
 * register models already read it as a record and changing them is not what
 * this pass is for.
 */
export const SEVERITY_TONE: Record<string, StatusTone> = TONE;
