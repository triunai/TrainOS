/**
 * FORKED FROM TrainOS shared/components/kit/tokens.ts — the kit's shared
 * class vocabulary, so every screen spells focus, captions and selection the
 * same way.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card";

/** Eyebrows, section captions, metric captions, column heads. Sentence case, UI font. */
export const SECTION_LABEL = "font-sans text-[12px] font-medium text-ink-muted";

/** The selected surface — rebinds muted ink so text stays AA on the tint. */
export const SELECTED_TINT = "bg-ai-tint-2 [--ink-muted:var(--ink-secondary)]";

/** AI is marked by this glyph plus a text label, never by fill alone. */
export const AI_GLYPH = "✦";
