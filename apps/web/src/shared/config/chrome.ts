/**
 * Chrome constants — bar heights, rail widths, z-index, in ONE file.
 *
 * This exists to prevent a specific, recurring bug: four different bar heights
 * across four surfaces that are all supposed to line up. Anything that needs a
 * shell dimension reads it from here or from the matching CSS custom property
 * in `src/styles/tokens.css`; nothing hardcodes a pixel value at a call site.
 *
 * Values are the built dimensions from docs/research/09-design-pack-inventory.md
 * §5. Note the discrepancy recorded there: the Foundations panel text says the
 * sidebar is 232px, the built components use 240px. The built value wins.
 */
export const CHROME = {
  /** Expanded sidebar width. */
  sidebarWidth: 240,
  /** Collapsed rail width, flyout on hover. */
  railWidth: 64,
  /** Top bar height. */
  topbarHeight: 56,
  /** Margin between the content card and the canvas edge. */
  contentInset: 14,
  /** Desktop artboard the pack is drawn at. */
  designCanvas: { width: 1440, height: 900 },
  z: {
    content: 0,
    sidebar: 20,
    topbar: 30,
    drawer: 40,
    modal: 50,
    toast: 60,
  },
} as const;
