import { cn } from "@/shared/lib/utils";

/**
 * A keybinding hint. Kit.dc.html §05 command palette footer:
 * "↑↓ navigate · ↵ open · ⌘↵ open in drawer · esc close".
 *
 * Rendered as `<kbd>`, which is what it is, and which lets a screen reader
 * announce it as a key rather than spell out "⌘".
 */

export interface KeyboardShortcutProps {
  /** The keys, in press order: `["⌘", "K"]`, `["esc"]`. */
  keys: string[];
  /** What the binding does, rendered beside it in the palette footer. */
  action?: string;
  className?: string;
}

export function KeyboardShortcut({ keys, action, className }: KeyboardShortcutProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] text-ink-muted", className)}>
      <span className="inline-flex items-center gap-0.5">
        {keys.map((key) => (
          <kbd
            key={key}
            className="inline-flex min-w-[18px] items-center justify-center rounded border border-border bg-surface px-1 py-px font-mono text-[10px] leading-4 text-ink-secondary"
          >
            {key}
          </kbd>
        ))}
      </span>
      {action ? <span>{action}</span> : null}
    </span>
  );
}
