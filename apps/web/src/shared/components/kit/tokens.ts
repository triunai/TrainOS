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
 * The label every eyebrow, section caption, metric caption and column head
 * wears. UI font, 12px, medium, muted, SENTENCE CASE.
 *
 * It was `font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted`,
 * quoted from the artboards, and that string was the single largest source of
 * mono-uppercase in the app: it is read by nine kit components, so it lands on
 * a metric caption, a run-step heading, a provenance heading, a diff heading,
 * an agent-run term, a proposed-action metric and an escalation rung on every
 * screen that renders any of them. Tightening brief §1 puts labels in the UI
 * font and reserves mono for machine-ish values, and §9 names tracked
 * uppercase mono as half of the combination that reads as generated.
 *
 * The value is `DataTable`'s column head verbatim. That head migrated first
 * and carried the rule as an inline literal; a rule with two homes is the
 * divergence CLAUDE.md forbids, so the head now reads this constant and a
 * heading is one style across the kit rather than two.
 *
 * SENTENCE CASE COMES FOR FREE. Call sites already pass "Levy available",
 * "Open pipeline", "Trigger" — `uppercase` was shouting strings that were
 * written quietly. Removing it renders what the source says.
 *
 * Mono is still right for a REF, a version, a hash, a tool name, an error
 * code, a diff and `⌘K`. Those keep `font-mono` at their own call sites.
 */
export const SECTION_LABEL = "font-sans text-[12px] font-medium text-ink-muted";

/**
 * The selected surface — the fill AND the muted floor it forces, which is why
 * they are one constant rather than two classes a call site could separate.
 *
 * `--ink-muted` on `--ai-tint-2` measures 4.36:1 in light (verification row
 * 1b): under AA, light only, and not fixable in the token file, because
 * lightening the tint would land it 0.9 L* from `--ai-tint` and the suggested
 * row and the selected row would stop being two surfaces. The muted ink is
 * also inside the cell renderers a screen passes, which the kit never sees.
 *
 * So the selected surface rebinds the token for its own subtree: inside it,
 * `--ink-muted` resolves to `--ink-secondary` (6.54:1 light, 6.69:1 dark) and
 * every `text-ink-muted` descendant follows without knowing. A scope, not a
 * second colour — nothing new enters the palette.
 */
export const SELECTED_TINT = "bg-ai-tint-2 [--ink-muted:var(--ink-secondary)]";

/** The ✦ glyph. AI is marked by this plus a text label, never by fill alone. */
export const AI_GLYPH = "✦";
