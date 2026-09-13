import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { useOnAccent } from "./onAccent";
import { useSinglePrimary } from "./useSinglePrimary";

/**
 * The button family. Kit.dc.html §03 "Buttons & inputs".
 *
 * Four kinds, one geometry: 13px label, 8px radius, 8px/14px padding, 1px
 * border on every kind so nothing shifts by a pixel when a button changes kind.
 * Only `primary` carries a fill — CLAUDE.md: solid blue means a human triggered
 * the action, so a solid button is a promise, not a decoration.
 *
 * `danger` is bordered white with a red label, NOT a red fill: status colour
 * lives on chips, and a destructive action is confirmed in a dialog (see
 * `ConfirmDialog`), where the red fill is earned by the confirmation step.
 */

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control border text-[13px] transition-colors disabled:cursor-not-allowed";

const KIND = {
  primary:
    "border-primary bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover disabled:border-border disabled:bg-surface disabled:text-ink-disabled",
  secondary:
    "border-border bg-card px-3.5 py-2 font-medium text-ink hover:bg-surface-hover disabled:bg-surface disabled:text-ink-disabled",
  ghost:
    "border-transparent bg-transparent px-3.5 py-2 font-medium text-ink-secondary hover:bg-surface-hover disabled:text-ink-disabled",
  danger:
    "border-border bg-card px-3.5 py-2 font-medium text-danger hover:bg-danger-fill hover:border-danger-border disabled:text-ink-disabled disabled:hover:bg-card",
} as const;

/**
 * The same four kinds, on the blue record card (§15a).
 *
 * One geometry with `KIND`, so a button does not move by a pixel when a header
 * gains or loses its accent. Only the ink changes.
 *
 * The four kinds keep one geometry, so nothing moves by a pixel when a header
 * gains or loses its accent.
 *
 * `danger` carries the destructive signal in its BORDER, not its label and not
 * a fill. The artboard draws Reject as pale red type, which cannot work: no red
 * reaches 4.5:1 as text on this blue (#FFDEDB, already almost white, peaks at
 * 3.63:1). A 1px rule is a non-text affordance at a 3:1 floor, which
 * `--danger-on-accent` clears everywhere on the ramp, so the outline says
 * "destructive" and white type says the rest. The red FILL is still earned in
 * the confirm step, which is what this file's contract has always said.
 *
 * The solid button's label is `--accent-ink` rather than `--primary`, because
 * `--primary` theme-swaps and its dark value reads 3.53:1 on white.
 */
const ACCENT_KIND = {
  primary:
    "border-transparent bg-[rgb(var(--on-accent))] px-4 py-2 font-semibold text-[rgb(var(--accent-ink))] hover:bg-[rgb(var(--on-accent)/0.88)] disabled:bg-[rgb(var(--on-accent)/0.35)] disabled:text-[rgb(var(--on-accent)/0.7)]",
  secondary:
    "border-[rgb(var(--on-accent)/0.45)] bg-transparent px-3.5 py-2 font-medium text-[rgb(var(--on-accent))] hover:bg-[rgb(var(--on-accent)/0.14)] disabled:border-[rgb(var(--on-accent)/0.2)] disabled:text-[rgb(var(--on-accent)/0.45)]",
  ghost:
    "border-transparent bg-transparent px-3.5 py-2 font-medium text-[rgb(var(--on-accent))] hover:bg-[rgb(var(--on-accent)/0.14)] disabled:text-[rgb(var(--on-accent)/0.45)]",
  danger:
    "border-[rgb(var(--danger-on-accent))] bg-transparent px-3.5 py-2 font-medium text-[rgb(var(--on-accent))] hover:bg-[rgb(var(--danger-on-accent)/0.18)] disabled:border-[rgb(var(--danger-on-accent)/0.4)] disabled:text-[rgb(var(--on-accent)/0.45)]",
} as const;

export type ButtonKind = keyof typeof KIND;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** A glyph or icon placed before the label. Decorative; label it in the text. */
  leading?: ReactNode;
  /** A glyph placed after the label, e.g. the `▾` on a menu trigger. */
  trailing?: ReactNode;
}

interface KindedButtonProps extends ButtonProps {
  kind: ButtonKind;
}

/**
 * The shared button body. Exported for the rare call site that picks its kind
 * from data (a `RecordHeader` action list, say) rather than at the type level.
 * Prefer the named exports — a literal `kind="primary"` is greppable.
 */
export const KitButton = forwardRef<HTMLButtonElement, KindedButtonProps>(function KitButton(
  { kind, leading, trailing, className, children, type, ...rest },
  ref,
) {
  /* Read, never passed. A screen's header markup is the same whether or not the
     header is accented; the card decides what its controls are sitting on. */
  const onAccent = useOnAccent();

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(BASE, (onAccent ? ACCENT_KIND : KIND)[kind], className)}
      {...rest}
    >
      {leading ? <span aria-hidden="true">{leading}</span> : null}
      {children}
      {trailing ? <span aria-hidden="true">{trailing}</span> : null}
    </button>
  );
});

/**
 * The view's one solid action.
 *
 * Registers itself with {@link useSinglePrimary}, which warns in development
 * when a second one mounts. If you need two, one of them is a `SecondaryButton`.
 */
export const PrimaryButton = forwardRef<HTMLButtonElement, ButtonProps>(
  function PrimaryButton(props, ref) {
    useSinglePrimary(typeof props.children === "string" ? props.children : "(unlabelled)");
    return <KitButton ref={ref} kind="primary" {...props} />;
  },
);

/** Every action that is not the one. Bordered, white, no fill. */
export const SecondaryButton = forwardRef<HTMLButtonElement, ButtonProps>(
  function SecondaryButton(props, ref) {
    return <KitButton ref={ref} kind="secondary" {...props} />;
  },
);

/** Tertiary: dismissals, "Clear filters", inline affordances. No border until hover. */
export const GhostButton = forwardRef<HTMLButtonElement, ButtonProps>(
  function GhostButton(props, ref) {
    return <KitButton ref={ref} kind="ghost" {...props} />;
  },
);

/** A destructive action, bordered with a red label. The fill is earned in the confirm step. */
export const DangerButton = forwardRef<HTMLButtonElement, ButtonProps>(
  function DangerButton(props, ref) {
    return <KitButton ref={ref} kind="danger" {...props} />;
  },
);

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Required. An icon button has no visible text, so this is its only name. */
  label: string;
  icon: ReactNode;
}

/**
 * A square 32px affordance carrying one glyph. Chrome only: the bell, the
 * column menu, a drawer's close.
 *
 * `label` is mandatory and becomes both the accessible name and the tooltip —
 * an icon button with no name is unusable by anything that is not a mouse.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        BASE,
        "h-8 w-8 border-transparent p-0 text-ink-secondary hover:bg-surface-hover disabled:text-ink-disabled",
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
});
