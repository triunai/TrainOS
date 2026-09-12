/**
 * The kit's token vocabulary, as TypeScript.
 *
 * Tailwind resolves most tokens to a class name (`bg-card`, `text-ink-muted`)
 * because the scaffold's `tailwind.config.ts` maps them. Three tokens live in
 * `styles/kit-tokens.css` instead — the scaffold's Tailwind config does not
 * know them, and that file is not mine to edit — so they are reached through
 * `rgb(var(--token))` arbitrary values. Naming them here means the string
 * `--ai-popover` is typed once in the whole kit rather than in four files.
 *
 * There are no hex literals anywhere in this directory. That is checkable:
 *   grep -rnE '#[0-9A-Fa-f]{3,8}\b' apps/web/src/shared/components/kit
 * should match nothing but this comment.
 */

/** Background of the AI badge's hover popover. Kit §02. */
export const AI_POPOVER_BG = "bg-[rgb(var(--ai-popover))]";

/** The amber dot that marks low confidence on an otherwise blue AI chip. Kit §02. */
export const WARNING_ACCENT_BG = "bg-[rgb(var(--warning-accent))]";

/** The expensive-hours band on the allowed-hours strip. Kit §10. */
export const PEAK_BG = "bg-[rgb(var(--peak))]";

/**
 * The focus ring every interactive kit element wears.
 *
 * The scaffold sets a global `:focus-visible` ring in `index.css`; this is the
 * same ring stated explicitly for elements that manage their own focus styling
 * (table rows, metric cells, tree nodes) where the global rule is overridden by
 * a background change.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card";

/**
 * The mono label used for every eyebrow, column head and metric caption.
 * 11px/uppercase/0.08em in the artboards, and muted — never smaller than 10px,
 * which is the floor the pack uses for the densest table heads.
 */
export const MONO_LABEL = "font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted";

/** The ✦ glyph. AI is marked by this plus a text label, never by fill alone. */
export const AI_GLYPH = "✦";
