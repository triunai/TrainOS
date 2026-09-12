import { useEffect } from "react";

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
 * The check compares labels rather than counting mounts, because the same
 * action legitimately renders twice at once: `RecordHeader` keeps a copy of the
 * primary in its 48px condensed bar so it stays reachable at any scroll depth.
 * Same label, same action, no warning. Two different labels is the defect.
 */

const mounted = new Map<symbol, string>();

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

/** Test seam: the labels currently claiming the view's single primary. */
export function currentPrimaries(): string[] {
  return [...mounted.values()];
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
  useEffect(() => {
    if (!import.meta.env.DEV || !enabled) return;

    const token = Symbol(label);
    /* A DIFFERENT label is the violation. The same label twice is the same
       action rendered in two places at once — a RecordHeader's primary and the
       copy its condensed scroll bar keeps reachable — which the design pack
       explicitly requires, so it must not warn. */
    const clashes = [...mounted.values()].filter((other) => other !== label);
    mounted.set(token, label);

    if (clashes.length > 0) {
      /* A design-rule violation must be loud in development. */
      console.warn(
        `[kit] Two solid primary buttons are rendering at once: "${clashes.join(
          '", "',
        )}" and "${label}". CLAUDE.md allows one per view — demote the lesser action to SecondaryButton.`,
      );
    }

    return () => {
      mounted.delete(token);
    };
  }, [label]);
}
