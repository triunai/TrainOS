"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useOnAccent } from "./onAccent";

/**
 * FORKED FROM TrainOS kit/Button.tsx. Four kinds, one geometry. Only `primary`
 * carries a fill: solid blue means a human triggered the action, so a view has
 * exactly one. `danger` is a red label on white — the red fill is earned in the
 * confirm step.
 */
import { ACCENT_KIND, BASE, KIND } from "./buttonStyles";

export type ButtonKind = keyof typeof KIND;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Shows a busy label and disables the button while an action is in flight. */
  busy?: boolean;
}

export const KitButton = forwardRef<HTMLButtonElement, ButtonProps & { kind: ButtonKind }>(function KitButton(
  { kind, leading, trailing, className, children, type, busy, disabled, ...rest },
  ref,
) {
  const onAccent = useOnAccent();
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(BASE, (onAccent ? ACCENT_KIND : KIND)[kind], className)}
      {...rest}
    >
      {leading ? <span aria-hidden="true">{leading}</span> : null}
      {children}
      {trailing ? <span aria-hidden="true">{trailing}</span> : null}
    </button>
  );
});

export const PrimaryButton = forwardRef<HTMLButtonElement, ButtonProps>(function PrimaryButton(props, ref) {
  return <KitButton ref={ref} kind="primary" {...props} />;
});
export const SecondaryButton = forwardRef<HTMLButtonElement, ButtonProps>(function SecondaryButton(props, ref) {
  return <KitButton ref={ref} kind="secondary" {...props} />;
});
export const GhostButton = forwardRef<HTMLButtonElement, ButtonProps>(function GhostButton(props, ref) {
  return <KitButton ref={ref} kind="ghost" {...props} />;
});
export const DangerButton = forwardRef<HTMLButtonElement, ButtonProps>(function DangerButton(props, ref) {
  return <KitButton ref={ref} kind="danger" {...props} />;
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  icon: ReactNode;
}

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
      className={cn(BASE, "h-8 w-8 border-transparent p-0 text-ink-secondary hover:bg-surface-hover disabled:text-ink-disabled", className)}
      {...rest}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
});
