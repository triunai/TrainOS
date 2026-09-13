#!/usr/bin/env node
/**
 * Every module a barrel exports must be TRACKED BY GIT, not merely present on
 * the disk of whoever wrote it.
 *
 * The kit barrel exported `./KanbanBoard` before `KanbanBoard.tsx` was
 * committed, and every existing gate passed: typecheck, lint, depcruise and
 * vitest all resolve against the working tree, where the file was sitting
 * untracked. The barrel was committed by pathspec without it. Anyone cloning
 * that commit gets a kit barrel that cannot resolve its own export, and the
 * first honest signal is a broken build on someone else's machine.
 *
 * R11: a control a reviewer must remember to check is not enforced. This is
 * that control, as a machine assertion.
 *
 * Two failure modes, reported separately because they are fixed differently:
 *   UNTRACKED — the file resolves on disk but git does not know it. `git add`
 *               it in the same commit as the barrel line.
 *   UNRESOLVED — nothing on disk answers the specifier at all. The export line
 *               is wrong, or the file was deleted and the barrel not updated.
 *
 * Only RELATIVE specifiers are checked. A bare specifier is a package and
 * belongs to the dependency graph `depcruise` already walks.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** Every path git tracks, as absolute paths, for O(1) membership tests. */
const tracked = new Set(
  execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean)
    .map((rel) => path.join(REPO, rel)),
);

/** Every `index.ts`/`index.tsx` under src is a barrel. */
function barrels(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "__screenshots__") continue;
      found.push(...barrels(full));
    } else if (entry.name === "index.ts" || entry.name === "index.tsx") {
      found.push(full);
    }
  }
  return found;
}

/**
 * The specifier of every `export … from "…"` and `import … from "…"`, plus
 * bare `export * from "…"`. Comments are stripped first so a specifier inside
 * a doc block cannot be mistaken for a real one.
 */
function specifiers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...code.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/** How TypeScript resolves a relative specifier, in the order it tries. */
function resolve(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    base,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const untracked = [];
const unresolved = [];

for (const barrel of barrels(SRC)) {
  for (const spec of specifiers(fs.readFileSync(barrel, "utf8"))) {
    if (!spec.startsWith(".")) continue;
    const target = resolve(barrel, spec);
    const where = `${path.relative(REPO, barrel)} -> "${spec}"`;
    if (target === null) unresolved.push(where);
    else if (!tracked.has(target)) untracked.push(`${where}  (${path.relative(REPO, target)})`);
  }
}

if (unresolved.length === 0 && untracked.length === 0) {
  console.log(`✔ every barrel export resolves to a tracked file (${barrels(SRC).length} barrels)`);
  process.exit(0);
}

if (unresolved.length > 0) {
  console.error(`\n✖ ${unresolved.length} barrel export(s) resolve to NOTHING on disk:`);
  for (const line of unresolved) console.error(`    ${line}`);
  console.error("  The export line is wrong, or the file was deleted without updating the barrel.");
}

if (untracked.length > 0) {
  console.error(`\n✖ ${untracked.length} barrel export(s) point at a file git does not track:`);
  for (const line of untracked) console.error(`    ${line}`);
  console.error(
    "  A clone of this commit cannot resolve them. `git add` the file with the barrel.",
  );
}

process.exit(1);
