#!/usr/bin/env node
// scripts/check-sql-parse.mjs  —  `npm run lint:sql`
//
// Parses every migration, rollback and SQL test through the REAL Postgres
// grammar (libpg-query, the server's own parser compiled to WASM) before anyone
// trusts the file as executable.
//
// THE INCIDENT THIS EXISTS FOR: two migration test files were authored,
// recorded as executed and passing, and could not actually run — one carried
// psql meta-commands (`\i`, `\set`) that nothing but psql can parse. A file in
// the tree is a CLAIM that it runs. This turns the claim into a check.
//
// GATE CLASS: BLOCKING. A migration that does not parse is not a migration.
//
// Exit 0 = every file parsed. Exit 1 = a parse failure, or zero files found
// where a directory exists. Exit 2 = the tool itself could not run.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Each target is a directory plus the filename shape it is allowed to hold. */
const TARGETS = [
  { dir: join(ROOT, "supabase", "migrations"), match: /\.sql$/ },
  { dir: join(ROOT, "supabase", "rollbacks"), match: /\.sql$/ },
  { dir: join(ROOT, "supabase", "tests"), match: /\.sql$/ },
  { dir: join(ROOT, "supabase", "tables"), match: /\.sql$/ },
  // Seeds are run by hand with psql (supabase/seeds/README.md), so their
  // whole-line psql meta-commands (\ir, \set) are stripped before parsing.
  { dir: join(ROOT, "supabase", "seeds"), match: /\.sql$/, psqlMeta: true },
];

let parse;
try {
  ({ parse } = require("libpg-query"));
} catch (error) {
  console.error("lint:sql: libpg-query is not installed — cannot parse. `npm install`.");
  console.error(String(error));
  process.exit(2);
}

function collect() {
  const files = [];
  for (const target of TARGETS) {
    // A missing directory is tolerated, not a failure: not every repo state has
    // seeds or tests yet.
    if (!existsSync(target.dir)) continue;
    for (const name of readdirSync(target.dir).sort()) {
      if (target.match.test(name)) files.push({ path: join(target.dir, name), psqlMeta: target.psqlMeta === true });
    }
  }
  return files;
}

const files = collect();

if (files.length === 0) {
  const anyDir = TARGETS.some((target) => existsSync(target.dir));
  if (!anyDir) {
    console.log("lint:sql: no supabase SQL directories yet — nothing to parse.");
    process.exit(0);
  }
  console.error("lint:sql: SQL directories exist but hold no .sql files. Nothing was checked.");
  process.exit(1);
}

let failures = 0;

for (const { path: file, psqlMeta } of files) {
  const shown = relative(ROOT, file);
  const raw = readFileSync(file, "utf8");
  const sql = psqlMeta ? raw.replace(/^[ \t]*\\.*$/gm, "") : raw;

  // An empty file parses fine and proves nothing. Say so rather than pass it.
  if (sql.trim() === "") {
    console.log(`  EMPTY  ${shown}`);
    failures++;
    continue;
  }

  try {
    await parse(sql);
    console.log(`  ok     ${shown}`);
  } catch (error) {
    failures++;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  FAIL   ${shown}`);
    console.log(`         ${message.split("\n")[0]}`);
    if (/\\\w/.test(sql)) {
      console.log(
        "         hint: this file appears to contain psql meta-commands (\\i, \\set, \\gset).",
      );
      console.log(
        "         Only psql understands those. Nothing else — not the server, not CI — can run it.",
      );
    }
  }
}

console.log(`\nlint:sql: ${files.length - failures}/${files.length} files parsed.`);
process.exit(failures > 0 ? 1 : 0);
