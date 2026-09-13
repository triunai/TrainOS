import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* The real stylesheet, as text.
   NOT `import "../tokens.css?raw"`: the suite sets `css: false`, so Vite stubs
   CSS modules and `?raw` comes back as the empty string — a parser fed "" finds
   no tokens and every assertion below would vacuously pass.
   NOT `import.meta.url` either: in jsdom it is an http URL, not a file one.
   So the file is read from disk, and the path is searched rather than assumed
   so the suite runs the same from the workspace root or from `apps/web`. */
const TOKENS_PATH = ["src/styles/tokens.css", "apps/web/src/styles/tokens.css"]
  .map((candidate) => resolve(process.cwd(), candidate))
  .find(existsSync);

if (!TOKENS_PATH) throw new Error(`tokens.css not found from ${process.cwd()}`);

const TOKENS_CSS = readFileSync(TOKENS_PATH, "utf8");

/**
 * Contrast is a property of a PAIR of tokens, and nothing in the repo held the
 * pairs. `tokens.css` states each colour's intent in a comment, but a comment
 * cannot fail, so a value could drift under AA and only an axe sweep over 63
 * routes would notice — which is how the dark map arrived with an accent that
 * does not clear 4.5:1 on its own tint.
 *
 * So this file reads the REAL stylesheet — not a copy of the values, which
 * would drift out of step with it and assert nothing — resolves each theme the
 * way the cascade does, and measures the pairs the shell actually composes.
 *
 * `--sidebar: var(--canvas)` means the resolver has to follow indirection, and
 * `[data-theme="dark"]` redefines only part of the map, so dark inherits the
 * rest from light. Both behaviours are reproduced below; a resolver that
 * skipped either would measure a colour the browser never paints.
 */

/* ── Parsing ──────────────────────────────────────────────────────────── */

/** Comments carry hex literals and prose braces, so they go before parsing. */
const withoutComments = TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function block(selector: RegExp): Record<string, string> {
  const match = withoutComments.match(new RegExp(`${selector.source}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`tokens.css has no ${selector.source} block`);
  const declarations: Record<string, string> = {};
  for (const line of match[1].split(";")) {
    const decl = line.match(/(--[\w-]+)\s*:\s*(.+)/);
    if (decl) declarations[decl[1]] = decl[2].trim();
  }
  return declarations;
}

const LIGHT = block(/:root,\s*\[data-theme="light"\]/);
const DARK_OVERRIDES = block(/\[data-theme="dark"\]/);
/* Dark redefines only part of the map and inherits the rest, exactly as the
   cascade does. */
const DARK = { ...LIGHT, ...DARK_OVERRIDES };

type Theme = "light" | "dark";
const THEMES: Record<Theme, Record<string, string>> = { light: LIGHT, dark: DARK };

/** Resolves `var(--other)` indirection, then the `R G B` triplet. */
function rgb(theme: Theme, name: string, seen = new Set<string>()): [number, number, number] {
  const map = THEMES[theme];
  const raw = map[`--${name}`];
  if (raw === undefined) throw new Error(`--${name} is not defined in the ${theme} map`);
  const indirect = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (indirect) {
    if (seen.has(indirect[1])) throw new Error(`--${name} resolves in a cycle`);
    seen.add(indirect[1]);
    return rgb(theme, indirect[1].slice(2), seen);
  }
  const channels = raw.split(/\s+/).map(Number);
  if (channels.length !== 3 || channels.some((c) => !Number.isFinite(c))) {
    throw new Error(`--${name} is not an "R G B" triplet in ${theme}: ${raw}`);
  }
  return channels as [number, number, number];
}

/* ── WCAG ─────────────────────────────────────────────────────────────── */

/** WCAG 2.x relative luminance (sRGB). */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(theme: Theme, fg: string, bg: string): number {
  const a = luminance(rgb(theme, fg));
  const b = luminance(rgb(theme, bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** CIE L*, the perceptual lightness a surface step is judged by. */
function lightness(theme: Theme, name: string): number {
  const y = luminance(rgb(theme, name));
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;
/** A borderless plane has to clear this to read as its own surface. */
const SURFACE_STEP = 3;

const themes: Theme[] = ["light", "dark"];

/* ── The shell's own pairs ────────────────────────────────────────────── */

describe("tokens.css resolves the way the cascade does", () => {
  it("follows var() indirection: --sidebar is --canvas in both themes", () => {
    for (const theme of themes) {
      expect(rgb(theme, "sidebar")).toEqual(rgb(theme, "canvas"));
    }
  });

  it("inherits the light value for every token the dark map does not override", () => {
    expect(DARK_OVERRIDES["--ink"]).toBeDefined();
    expect(DARK_OVERRIDES["--radius-card"]).toBeUndefined();
    expect(DARK["--radius-card"]).toBe(LIGHT["--radius-card"]);
  });
});

describe("sidebar text clears AA on both of its backdrops", () => {
  /* The rail paints two grounds: the shell ground it sits on, and the tint the
     parent holding the active child rides. */

  /* On the rail ground: `--ink` is the selected child, `--ink-secondary` is
     every idle row (`PARENT_IDLE`/`CHILD_IDLE`), `--ink-muted` is the group
     caption. */
  for (const theme of themes) {
    for (const label of ["ink", "ink-secondary", "ink-muted"] as const) {
      it(`${theme}: --${label} on the rail ground`, () => {
        expect(contrast(theme, label, "sidebar")).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }

  /* On the lit parent's tint. `--primary-hover` is the token the kit uses for
     text on `--ai-tint-2` everywhere else it appears — PillTabGroup, FilterBar,
     CommandPalette, LifecycleStepper, RelationPicker — so it is the pair with a
     contract to keep. (`Sidebar.tsx` is the one call site reading `--primary`
     there instead, which is the gap recorded at the bottom of this file.) */
  it.each(themes)("%s: --primary-hover on the lit parent's tint", (theme) => {
    expect(contrast(theme, "primary-hover", "ai-tint-2")).toBeGreaterThanOrEqual(AA_TEXT);
    /* And it is the pairing with the headroom, which is why the rail follows
       the kit here rather than reaching for `--primary`: on the dark map that
       one measures 4.05:1 against this same tint. */
    expect(contrast(theme, "primary-hover", "ai-tint-2")).toBeGreaterThan(
      contrast(theme, "primary", "ai-tint-2"),
    );
  });

  it.each(themes)("%s: --ink and --ink-secondary on the lit parent's tint", (theme) => {
    expect(contrast(theme, "ink", "ai-tint-2")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(theme, "ink-secondary", "ai-tint-2")).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(themes)("%s: the selected child's label on its raised card", (theme) => {
    expect(contrast(theme, "ink", "card")).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("sidebar non-text affordances clear 3:1", () => {
  /* CLAUDE.md sets 3:1 for non-text UI affordances. These are the rail's:
     the child dot, which is `--ink-muted` idle and `--primary` on the selected
     row, and the collapsed rail's badge dot.

     The tree line is deliberately NOT here. `--connector` measures 1.38:1 in
     BOTH themes — the light value was drawn that way too — which puts it in the
     same family as `--border` (1.24:1) and `--divider` (1.15:1): a hairline
     that repeats structure the indent and the dots already carry, not an
     affordance a reader has to find. Holding dark to 3:1 while light stays at
     1.38 would make the two themes diverge, which is the defect, not the fix.
     If the line is ever ruled load-bearing, both themes move together. */

  it.each(themes)("%s: the idle dot on the rail ground", (theme) => {
    expect(contrast(theme, "ink-muted", "sidebar")).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it.each(themes)("%s: the idle dot on the lit parent's tint", (theme) => {
    expect(contrast(theme, "ink-muted", "ai-tint-2")).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it.each(themes)("%s: the selected dot on its raised card", (theme) => {
    expect(contrast(theme, "primary", "card")).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it.each(themes)("%s: the collapsed rail's badge dots", (theme) => {
    expect(contrast(theme, "primary", "sidebar")).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast(theme, "danger", "sidebar")).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("holds the tree line at parity across the two themes", () => {
    /* Guards the divergence described above rather than the ratio itself. */
    expect(contrast("light", "connector", "sidebar")).toBeCloseTo(
      contrast("dark", "connector", "sidebar"),
      1,
    );
  });
});

/* ── The surface ladder ───────────────────────────────────────────────── */

describe("L1 reads as its own plane against the card it sits on", () => {
  /* The kanban lane is `--surface` on `--card` with no border at all, so this
     step IS the lane. Asserted in both themes because a plane that separates
     in one and vanishes in the other is the divergence CLAUDE.md forbids. */
  it.each(themes)("%s: --surface steps clear of --card", (theme) => {
    const delta = Math.abs(lightness(theme, "surface") - lightness(theme, "card"));
    expect(delta).toBeGreaterThanOrEqual(SURFACE_STEP);
  });

  it.each(themes)("%s: L1 stays a recess, not a second card", (theme) => {
    /* Past ~8 L* the tint stops reading as a recess and starts reading as its
       own card, which is the other way this token fails. */
    const delta = Math.abs(lightness(theme, "surface") - lightness(theme, "card"));
    expect(delta).toBeLessThan(8);
  });

  it.each(themes)("%s: muted text stays readable on L1", (theme) => {
    /* The lane's summary line and its item count are `--ink-muted` directly on
       this surface, so the step above is bounded by AA, not by taste. */
    expect(contrast(theme, "ink-muted", "surface")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(theme, "ink-secondary", "surface")).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

/* ── The solid primary: the fill is a token of its own ────────────────── */

describe("the one solid button clears AA in both themes", () => {
  /*
   * WAS THE LAST KNOWN GAP. `--primary` was the fill AND the accent as text,
   * and the dark map lifts it to #4C82FF so the accent can be read on #171C25
   * — which put `--on-primary` on the fill at 3.24:1. The fill is now
   * `--primary-solid`, which is the brand hex in both themes.
   *
   * These cases are the contract that keeps the split honest: if someone ever
   * "tidies" the fill back onto `--primary`, or lifts the fill for dark the way
   * the text token is lifted, the label goes under AA and this goes red.
   */

  it.each(themes)("%s: --on-primary on the solid fill", (theme) => {
    expect(contrast(theme, "on-primary", "primary-solid")).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(themes)("%s: --on-primary on the solid fill, hovered", (theme) => {
    expect(contrast(theme, "on-primary", "primary-solid-hover")).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(themes)("%s: the resting fill reads as a control on every ground", (theme) => {
    /* CLAUDE.md's 3:1 floor for a non-text affordance. The button's boundary is
       what says "control" before the label is read, so it is measured against
       each ground a primary button actually sits on: the page, a card, and the
       recessed L1 surface a toolbar sits in. The HOVER fill is deliberately not
       here — it is under the reader's cursor with a 6.5:1 label on it, not a
       resting edge they have to find. */
    for (const ground of ["canvas", "card", "surface"] as const) {
      expect(contrast(theme, "primary-solid", ground)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it("the fill is theme-stable, and that is the mechanism, not a coincidence", () => {
    /* The whole split rests on the dark map NOT redefining these two. A dark
       override would reintroduce exactly the conflict that was removed. */
    expect(DARK_OVERRIDES["--primary-solid"]).toBeUndefined();
    expect(DARK_OVERRIDES["--primary-solid-hover"]).toBeUndefined();
    expect(rgb("dark", "primary-solid")).toEqual(rgb("light", "primary-solid"));
    expect(rgb("light", "primary-solid")).toEqual(rgb("light", "primary"));
  });

  it("the accent as TEXT is still lifted for dark, which is why the split exists", () => {
    /* The other half of the same contract: `--primary` must stay readable on
       the dark card. If it were darkened to serve the fill, every link and mark
       would fail instead — which is the trade the split removes. */
    expect(contrast("dark", "primary", "card")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast("light", "primary", "card")).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

/* ── The selected surface ─────────────────────────────────────────────── */

describe("a selected row is readable in both themes", () => {
  /*
   * WAS A KNOWN GAP, light only: `--ink-muted` on `--ai-tint-2` is 4.36:1.
   * `SELECTED_TINT` rebinds `--ink-muted` to `--ink-secondary` inside the
   * selected subtree, so the pair the reader actually sees is the second one
   * below. The first is kept as the REASON — it records why the rebinding is
   * there, and it goes red the day someone changes the tint enough to make the
   * scope unnecessary, which is the prompt to delete the scope with it.
   */

  it("light muted ink on the raw tint is why SELECTED_TINT exists", () => {
    expect(contrast("light", "ink-muted", "ai-tint-2")).toBeLessThan(AA_TEXT);
  });

  it.each(themes)("%s: the raised floor a selected row actually paints", (theme) => {
    expect(contrast(theme, "ink-secondary", "ai-tint-2")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(theme, "ink", "ai-tint-2")).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(themes)("%s: the SUGGESTED row needs no raising", (theme) => {
    /* `--ai-tint` is the other AI surface, and muted ink clears AA on it
       unaided — 4.61:1 light, 5.09:1 dark. Asserted so that a future nudge to
       either tint cannot quietly put the suggested row where the selected row
       was. */
    expect(contrast(theme, "ink-muted", "ai-tint")).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(themes)("%s: the two AI surfaces stay two surfaces", (theme) => {
    /* The reason lightening `--ai-tint-2` was rejected as the fix for row 1b:
       at parity the selected row and the suggested row become one surface and
       the table loses a state. They sit 2.15 L* apart in light and 4.19 in
       dark; the floor below is the distance, not the direction. */
    const delta = Math.abs(lightness(theme, "ai-tint") - lightness(theme, "ai-tint-2"));
    expect(delta).toBeGreaterThanOrEqual(2);
  });

  it.each(themes)("%s: the selection rule reads as an affordance", (theme) => {
    /* The 2px inset rule is `--primary` and is the only non-text mark that says
       "this row is selected" to a reader who cannot see the tint. */
    expect(contrast(theme, "primary", "ai-tint-2")).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

/* ── Type: the two roles the tokens name ──────────────────────────────── */

describe("the type tokens name a role each", () => {
  /* Brief §1 asks for `--font-ui` / `--font-code` by name, and the split is the
     whole mono-reduction rule made checkable: if the two ever resolve to the
     same stack the rule has no teeth, and if `tailwind.config.ts` stops reading
     them the tokens are decoration. */
  const TYPE = withoutComments.match(/--font-ui:\s*([^;]+);[\s\S]*?--font-code:\s*([^;]+);/);

  it("defines both roles, once, in the light map", () => {
    expect(TYPE).not.toBeNull();
    expect(TYPE?.[1]).toMatch(/Inter/);
    expect(TYPE?.[2]).toMatch(/JetBrains Mono/);
  });

  it("does not theme-swap a typeface", () => {
    expect(DARK_OVERRIDES["--font-ui"]).toBeUndefined();
    expect(DARK_OVERRIDES["--font-code"]).toBeUndefined();
  });

  it("is what Tailwind's two families actually read", () => {
    const config = readFileSync(
      ["tailwind.config.ts", "apps/web/tailwind.config.ts"]
        .map((candidate) => resolve(process.cwd(), candidate))
        .find(existsSync) ?? "",
      "utf8",
    );
    expect(config).toMatch(/sans:\s*\['var\(--font-ui/);
    expect(config).toMatch(/mono:\s*\['var\(--font-code/);
    /* The old names are gone, not aliased. Two names for one face is the
       divergence CLAUDE.md calls a defect. */
    expect(config).not.toMatch(/--font-sans/);
    expect(config).not.toMatch(/--font-mono\b/);
    expect(withoutComments).not.toMatch(/--font-sans/);
    expect(withoutComments).not.toMatch(/--font-mono\s*:/);
  });
});
