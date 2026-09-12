import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
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
  return (
    <button ref={ref} type={type ?? "button"} className={cn(BASE, KIND[kind], className)} {...rest}>
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
