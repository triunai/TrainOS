import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R11 · the consolidation rule for the empty state, made machine-checkable.
 *
 * CLAUDE.md: "Any pattern that appears on more than two screens with the same
 * behaviour must be standardised as a named component before it is used again…
 * When two variants of one pattern exist, the newer one wins and the older is
 * migrated in the same pass — divergence is a defect, not a style."
 *
 * The kit has `EmptyState`, and two screens had grown their own anyway:
 * `EngagementDetailPage` passed `empty={<p className="px-4 py-6 …">No sessions
 * scheduled yet.</p>}` to two tables, and `ProposalBuilderPage` used an
 * `ExceptionBanner` — a component whose entire job is to interrupt the reader
 * about something that went wrong — to say a proposal had not been written yet.
 * Neither is a style choice. Both are a second answer to a question the kit had
 * already answered, and both were invisible to review because each looked
 * perfectly reasonable in its own file.
 *
 * The scan is deliberately narrow: it checks the `empty` prop, which is the one
 * place a table declares what it shows when it has no rows. A screen can still
 * write an emptiness by hand somewhere this cannot see. What it cannot do is
 * hand a table a hand-rolled one, which is where all three of the migrated
 * cases lived.
 */

const SRC = path.resolve(__dirname, "..");

interface Site {
  file: string;
  line: number;
  block: string;
}

/** Every `.tsx` a screen is built from. Tests and the kit itself are exempt. */
function screenFiles(): string[] {
  const files: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "__screenshots__") continue;
        walk(full);
        continue;
      }
      if (entry.name.endsWith(".tsx")) files.push(full);
    }
  };

  walk(path.join(SRC, "features"));
  walk(path.join(SRC, "pages"));
  return files;
}

/**
 * `empty={ … }` up to its balanced closing brace.
 *
 * Counting braces rather than matching a lazy `}` matters: every real one of
 * these contains a JSX element with props of its own, so the first `}` after
 * the prop name is almost never the prop's own.
 */
function emptyPropSites(): Site[] {
  const sites: Site[] = [];

  for (const file of screenFiles()) {
    const source = readFileSync(file, "utf8");
    const opener = /\bempty=\{/g;
    let match: RegExpExecArray | null;

    while ((match = opener.exec(source)) !== null) {
      let depth = 1;
      let index = match.index + match[0].length;
      while (index < source.length && depth > 0) {
        const character = source[index];
        if (character === "{") depth += 1;
        else if (character === "}") depth -= 1;
        index += 1;
      }
      sites.push({
        file: path.relative(SRC, file),
        line: source.slice(0, match.index).split("\n").length,
        block: source.slice(match.index, index),
      });
    }
  }

  return sites;
}

describe("consolidation · an empty state is the kit's EmptyState", () => {
  const sites = emptyPropSites();

  it("finds the empty-state sites, so a broken scan cannot pass vacuously", () => {
    /* Nineteen across the built screens when this was written, and the number
       only grows as list screens land. */
    expect(sites.length).toBeGreaterThanOrEqual(15);
  });

  it("leaves no table declaring an emptiness the kit does not own", () => {
    const divergent = sites
      .filter((site) => !site.block.includes("<EmptyState"))
      .map((site) => `${site.file}:${site.line} — ${site.block.slice(0, 90).replace(/\s+/g, " ")}`);

    expect(divergent).toEqual([]);
  });

  it("never uses ExceptionBanner to say something is empty", () => {
    /* A banner interrupts the reader about something that went wrong. Nothing
       has gone wrong when a record simply has no children yet, and drawing one
       there is how a page teaches people to ignore its real banners. */
    const misused: string[] = [];

    for (const file of screenFiles()) {
      const source = readFileSync(file, "utf8");
      const pattern = /<ExceptionBanner\b[\s\S]*?\/>/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        if (!/\bno\s+\w+\s+yet\b|\bnothing\s+\w+\s+yet\b|\bis\s+empty\b/i.test(match[0])) continue;
        misused.push(
          `${path.relative(SRC, file)}:${source.slice(0, match.index).split("\n").length}`,
        );
      }
    }

    expect(misused).toEqual([]);
  });
});
