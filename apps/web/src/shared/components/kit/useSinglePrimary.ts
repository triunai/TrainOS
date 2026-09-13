import { createContext, useContext, useEffect } from "react";

/**
 * The one-solid-primary-button rule, enforced at runtime in development.
 *
 * CLAUDE.md: "One solid primary button per view." A lint rule cannot see this —
 * whether two primaries render depends on props, routes and conditionals — so
 * the check lives where the truth is, in the render. Every mounted
 * `PrimaryButton` registers itself; a second concurrent registration warns with
 * both labels so the offender is named, not merely counted.
 *
 * Production is untouched: the whole body is behind `import.meta.env.DEV`, and
 * the registry is module state, not React state, so a violation costs no render.
 *
 * Two documented exemptions exist in the design pack (M07-S07 and M10-S06 are
 * locked states with no primary at all, which this cannot fire on). A view that
 * genuinely needs a second solid button is a design defect, not a prop.
 *
 * ## Why this counts instances, not labels
 *
 * It used to compare LABELS, and deliberately ignored a repeated one, because
 * `RecordHeader` keeps a copy of the primary in its 48px condensed bar so the
 * action stays reachable at any scroll depth. Same label, same action — a real
 * exemption, wrongly generalised. Exempting every repeated label meant four
 * screens rendered a header primary that only OPENS a drawer plus the drawer's
 * own submit button, both solid, both labelled "Record payment" or "Add rule",
 * and the guard could not fire on the thing it was built to catch.
 *
 * So the exemption is now attached to the surface that earns it rather than to
 * the coincidence of a matching string: `CondensedRecordHeader` marks its
 * subtree an ECHO, an echo never claims and never warns, and TWO claims are a
 * violation however they are labelled.
 */

/**
 * Inside the condensed scroll bar, a primary is a re-rendering of one claimed
 * above it rather than a second claim.
 *
 * `CondensedRecordHeader` is the only thing that may provide this, which is
 * what keeps the exemption specific: a screen cannot opt its own second solid
 * button out of the rule by wrapping it.
 */
export const CondensedPrimaryEcho = createContext(false);

interface Claim {
  label: string;
  /** A condensed-bar re-render of a claim made above it, not a new one. */
  echo: boolean;
}

const mounted = new Map<symbol, Claim>();

let enabled = true;

/**
 * Turn the check off for a surface that is deliberately not a view.
 *
 * There is exactly one such surface: `/dev/kit`, the showcase, which renders
 * every variant of every component side by side on purpose. A catalogue of
 * buttons is not a screen with an action, so warning about it would train
 * everyone to ignore the warning that matters. Nothing else may call this.
 */
export function setSinglePrimaryCheck(value: boolean): void {
  enabled = value;
}

/**
 * Test seam: the labels currently CLAIMING the view's single primary.
 *
 * Echoes are excluded on purpose. A screen with a `RecordHeader` would
 * otherwise report its one action twice and force every caller to deduplicate
 * — which is how the assertion in `proposals.test.tsx` came to be wrapped in a
 * `Set` and stopped being able to fail. One claim per solid button on screen,
 * so `toEqual(["Send for approval"])` means what it says.
 */
export function currentPrimaries(): string[] {
  return [...mounted.values()].filter((claim) => !claim.echo).map((claim) => claim.label);
}

/** Test seam: forget every registration. Call between renders in a test file. */
export function resetPrimaries(): void {
  mounted.clear();
}

/**
 * Claim the view's one primary action. Warns in development if another
 * `PrimaryButton` already holds the claim.
 *
 * @param label the button's visible text, used to name the clash
 */
export function useSinglePrimary(label: string): void {
  const echo = useContext(CondensedPrimaryEcho);

  useEffect(() => {
    if (!import.meta.env.DEV || !enabled) return;

    const token = Symbol(label);
    /* Read before registering, so this mount does not clash with itself. */
    const held = [...mounted.values()].filter((other) => !other.echo).map((other) => other.label);
    mounted.set(token, { label, echo });

    if (!echo && held.length > 0) {
      /* A design-rule violation must be loud in development. Naming both
         labels matters most when they are the SAME one: "Add rule" opening a
         drawer and "Add rule" submitting it is the case the old label
         comparison waved through. */
      console.warn(
        `[kit] Two solid primary buttons are rendering at once: "${held.join(
          '", "',
        )}" and "${label}". CLAUDE.md allows one per view — demote the lesser action to SecondaryButton. A button that only OPENS a drawer is not the view's action.`,
      );
    }

    return () => {
      mounted.delete(token);
    };
  }, [label, echo]);
}
