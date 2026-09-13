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
 * No kit component carries a hex literal — every colour resolves to a token.
 * That is checkable, and the only matches are comments quoting the design pack:
 *
 *   grep -rnE '#[0-9A-Fa-f]{3,8}' apps/web/src/shared/components/kit \
 *     --include='*.tsx' --include='*.ts' | grep -v '/__tests__/'
 *
 * A match on a line that is not a comment is a defect.
 */

/*
 * These three were arbitrary values — `bg-[rgb(var(--ai-popover))]` — while the
 * tokens existed in CSS but not in the Tailwind colours block. They are real
 * colours now, so the escape hatch is gone: `bg-ai-popover` says what it means,
 * the arbitrary form said how it was plumbed. Kept as constants because the
 * three carry rules worth stating once rather than at each call site.
 */

/** Background of the AI badge's hover popover. Kit §02. */
export const AI_POPOVER_BG = "bg-ai-popover";

/** The amber dot that marks low confidence on an otherwise blue AI chip. Kit §02. */
export const WARNING_ACCENT_BG = "bg-warning-accent";

/** The expensive-hours band on the allowed-hours strip. Kit §10. */
export const PEAK_BG = "bg-peak";

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
