import { cn } from "@/lib/cn";

/**
 * Button class vocabulary, in a server-safe module (no "use client") so server
 * components can style a <Link> as a button without importing a client file.
 */
export const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control border text-[13px] transition-colors disabled:cursor-not-allowed";

export const KIND = {
  primary:
    "border-primary-solid bg-primary-solid px-4 py-2 font-semibold text-on-primary hover:border-primary-solid-hover hover:bg-primary-solid-hover disabled:border-border disabled:bg-surface disabled:text-ink-disabled",
  secondary:
    "border-border bg-card px-3.5 py-2 font-medium text-ink hover:bg-surface-hover disabled:bg-surface disabled:text-ink-disabled",
  ghost:
    "border-transparent bg-transparent px-3.5 py-2 font-medium text-ink-secondary hover:bg-surface-hover disabled:text-ink-disabled",
  danger:
    "border-border bg-card px-3.5 py-2 font-medium text-danger hover:bg-danger-fill hover:border-danger-border disabled:text-ink-disabled disabled:hover:bg-card",
} as const;

export const ACCENT_KIND = {
  primary:
    "border-transparent bg-[rgb(var(--on-accent))] px-4 py-2 font-semibold text-[rgb(var(--accent-ink))] hover:bg-[rgb(var(--on-accent)/0.88)] disabled:bg-[rgb(var(--on-accent)/0.35)] disabled:text-[rgb(var(--on-accent)/0.7)]",
  secondary:
    "border-[rgb(var(--on-accent)/0.45)] bg-transparent px-3.5 py-2 font-medium text-[rgb(var(--on-accent))] hover:bg-[rgb(var(--on-accent)/0.14)] disabled:border-[rgb(var(--on-accent)/0.2)] disabled:text-[rgb(var(--on-accent)/0.45)]",
  ghost:
    "border-transparent bg-transparent px-3.5 py-2 font-medium text-[rgb(var(--on-accent))] hover:bg-[rgb(var(--on-accent)/0.14)] disabled:text-[rgb(var(--on-accent)/0.45)]",
  danger:
    "border-[rgb(var(--danger-on-accent))] bg-transparent px-3.5 py-2 font-medium text-[rgb(var(--on-accent))] hover:bg-[rgb(var(--danger-on-accent)/0.18)] disabled:border-[rgb(var(--danger-on-accent)/0.4)] disabled:text-[rgb(var(--on-accent)/0.45)]",
} as const;


/** A kit-styled link that looks like a button (navigation, not an action). */
export const LINK_BUTTON = {
  secondary: cn(BASE, KIND.secondary),
  ghost: cn(BASE, KIND.ghost),
  primary: cn(BASE, KIND.primary),
  danger: cn(BASE, KIND.danger),
};
