import { cn } from "@/shared/lib/utils";
import { IconButton } from "./Button";
import { KeyboardShortcut } from "./KeyboardShortcut";
import { FOCUS_RING } from "./tokens";

/**
 * The three pieces of the §07 top bar that the scaffold's `Topbar` does not
 * have yet: the ⌘K search trigger, the notification bell with its unread dot,
 * and the initials avatar.
 *
 * They live in the kit rather than in `components/layout` because
 * `components/layout` is the scaffold's file and this agent does not edit it.
 * Composing them into the real top bar is a one-line change there; until then
 * the showcase is where they are proven.
 */

export interface SearchTriggerProps {
  /** Opens the command palette. */
  onOpen?: () => void;
  /** Defaults to "Search". Placeholder text, not a label. */
  placeholder?: string;
  className?: string;
}

/**
 * The 180px search box in the top bar. A button, not an input: it opens the
 * palette, and typing here would create a second search surface that has to
 * behave identically to the first one. One search, one place.
 */
export function SearchTrigger({ onOpen, placeholder = "Search", className }: SearchTriggerProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-8 w-[180px] items-center gap-2 rounded-control border border-border bg-card px-2.5 text-[13px] text-ink-muted hover:bg-surface-hover",
        FOCUS_RING,
        className,
      )}
    >
      <span aria-hidden="true">⌕</span>
      <span className="truncate">{placeholder}</span>
      <KeyboardShortcut keys={["⌘", "K"]} className="ml-auto" />
    </button>
  );
}

export interface NotificationBellProps {
  /** How many unread. Only its being above zero is drawn — the dot, not a count. */
  unread?: number;
  onOpen?: () => void;
  className?: string;
}

/**
 * The bell. §07 draws "a small red unread dot", not a number: the top bar says
 * whether there is something, and the queue says how much.
 */
export function NotificationBell({ unread = 0, onOpen, className }: NotificationBellProps) {
  const has = unread > 0;

  return (
    <span className={cn("relative inline-flex", className)}>
      <IconButton
        label={has ? `Notifications, ${unread} unread` : "Notifications"}
        icon="◔"
        onClick={onOpen}
      />
      {has ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-pill bg-danger ring-2 ring-canvas"
        />
      ) : null}
    </span>
  );
}

/** Initials from a display name: "Amirah Yusof" → "AY", "Kelvin" → "K". */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export interface AvatarProps {
  name: string;
  /** 28px in the sidebar's user row, 32px in the top bar, 176px in the profile modal. */
  size?: number;
  /** An agent's avatar is graphite rather than charcoal, so a run reads as non-human. */
  kind?: "human" | "agent";
  className?: string;
}

/**
 * The initials avatar. §07: a charcoal circle with light initials. No photos
 * anywhere in the pack — a circle of initials is legible at 28px and a cropped
 * face is not.
 */
export function Avatar({ name, size = 32, kind = "human", className }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.34)) }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-pill font-mono text-on-primary",
        kind === "agent" ? "bg-surface text-ink-secondary ring-1 ring-border" : "bg-avatar",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
