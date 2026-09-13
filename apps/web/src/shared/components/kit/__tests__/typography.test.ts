import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTION_LABEL, SELECTED_TINT } from "../tokens";

/**
 * The kit's typography rules, asserted over the kit's own SOURCE.
 *
 * Tightening brief §1 puts mono down 70–80% and §9 names tracked uppercase mono
 * as half of the combination that reads as generated. Those are rules about
 * where a class may appear, not about what one component renders, so a render
 * test cannot hold them: a new primitive reaching for `font-mono uppercase`
 * would render perfectly and still break the rule. Reading the directory is
 * what makes the rule apply to files nobody has written yet.
 *
 * The verification sweep counted mono-uppercase runs per route and found every
 * one of 63 routes carrying more than one. Most of that traced to two strings —
 * the shared label constant and `MoneyText` — and both are fixed. This keeps
 * them fixed.
 */

const KIT_DIR = resolve(__dirname, "..");

const SOURCES = readdirSync(KIT_DIR)
  .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(resolve(KIT_DIR, name), "utf8") }));

/** Comments quote the old classes on purpose, so they are not source. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the kit's label style", () => {
  it("is the UI font, sentence case, and says so in one place", () => {
    expect(SECTION_LABEL).toContain("font-sans");
    expect(SECTION_LABEL).not.toContain("font-mono");
    expect(SECTION_LABEL).not.toContain("uppercase");
    expect(SECTION_LABEL).not.toContain("tracking-");
    expect(SECTION_LABEL).toContain("text-ink-muted");
  });

  it("is the only label style: no kit primitive re-rolls a muted caption", () => {
    /* `DataTable`'s column head held this string as a literal before the
       constant existed. A second copy is the divergence CLAUDE.md calls a
       defect, so the literal may appear exactly once — in `tokens.ts`, as the
       constant's own definition. */
    const copies = SOURCES.filter(({ text }) => code(text).includes(SECTION_LABEL));
    expect(copies.map(({ name }) => name)).toEqual(["tokens.ts"]);
  });
});

describe("mono is reserved for machine-ish values", () => {
  it("never pairs a monospace face with uppercase on the same element", () => {
    /* The §9 combination. Checked per class STRING rather than per file, so a
       component may still set `uppercase` on one element and `font-mono` on
       another — a ref beside a chip is fine; a tracked uppercase mono eyebrow
       is not. */
    const offenders: string[] = [];
    for (const { name, text } of SOURCES) {
      for (const literal of code(text).match(/"[^"\n]*"|`[^`\n]*`/g) ?? []) {
        if (literal.includes("font-mono") && literal.includes("uppercase")) {
          offenders.push(`${name}: ${literal.slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never reaches for a monospace face to align a number", () => {
    /* §1: numbers align with `tabular-nums`. A class string carrying both is
       the tell that mono is being used as an alignment tool, which is the
       commonest way it spreads across a screen. */
    const offenders: string[] = [];
    for (const { name, text } of SOURCES) {
      for (const literal of code(text).match(/"[^"\n]*"|`[^`\n]*`/g) ?? []) {
        if (literal.includes("font-mono") && literal.includes("tabular-nums")) {
          offenders.push(`${name}: ${literal.slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps mono where the brief keeps it", () => {
    /* The rule is a reduction, not a ban, and a test that drove `font-mono` to
       zero would be enforcing the wrong thing. These are the machine-ish values
       §1 names: a ref, a keyboard shortcut, a diff, a tool name, a raw payload.
       If one of these loses its monospace face the reduction has overshot. */
    const monoIn = (name: string) => code(SOURCES.find((s) => s.name === name)?.text ?? "");
    for (const name of [
      "RefChip.tsx",
      "CitationChip.tsx",
      "KeyboardShortcut.tsx",
      "DiffBlock.tsx",
      "RunStepRow.tsx",
    ]) {
      expect(monoIn(name), name).toContain("font-mono");
    }
  });
});

describe("the selected surface", () => {
  it("carries its own muted floor, so the fill cannot be used without it", () => {
    /* Verification row 1b. The pair the reader sees is asserted numerically in
       `styles/__tests__/tokens.contrast.test.ts`; this asserts the mechanism
       that delivers it. */
    expect(SELECTED_TINT).toContain("bg-ai-tint-2");
    expect(SELECTED_TINT).toContain("[--ink-muted:var(--ink-secondary)]");
  });

  it("is what every tinted selected surface in the kit uses", () => {
    /* `DataTable` rows, its bulk bar and both of `CalendarGrid`'s selected
       surfaces paint this tint under content the kit does not own. Any of them
       reaching for the bare class again would reopen the gap for exactly the
       muted cells the scope exists to raise. */
    const bare = SOURCES.filter(
      ({ name, text }) =>
        name !== "tokens.ts" &&
        !name.endsWith(".test.ts") &&
        /"[^"\n]*\bbg-ai-tint-2\b/.test(code(text)),
    ).map(({ name }) => name);
    /* PillTabGroup, FilterBar, LifecycleStepper, RelationPicker,
       ExternalMinimalShell, CommandPalette, AllowedHoursStrip, ContentCard and
       CitationChip all pair the tint with `text-primary-hover` or `text-ink`
       and hold no muted content, so they are allowed the bare class. */
    expect(bare).not.toContain("DataTable.tsx");
    expect(bare).not.toContain("CalendarGrid.tsx");
  });
});
