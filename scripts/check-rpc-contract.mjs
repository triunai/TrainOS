#!/usr/bin/env node
// scripts/check-rpc-contract.mjs  —  `npm run check:rpc`
//
// Static drift check across the data-contract seam. No database connection.
//
// THE INCIDENT THIS EXISTS FOR: an RPC gained a sibling key alongside `data` in
// its return envelope. That flipped the client wrapper from auto-unwrap to
// pass-through, and a consumer's unchecked double cast hid the resulting shape
// mismatch from the compiler. A live page white-screened — and only on the
// session-restore path, not on first submit.
//
// WHAT IT COMPARES
//   E1  ENVELOPE. Every function in the database that returns jsonb must build
//       its result through app.ok() / app.err(). A hand-rolled
//       jsonb_build_object('success', ...) is exactly how a sibling key gets
//       added next to `data` without anyone noticing.
//   E2  CASTS. No `as unknown as` inside apps/web/src/shared/api. That double
//       cast bypasses the type-checker at precisely the layer where the
//       server-to-client shape is most fragile, which is what made the real
//       incident invisible at compile time.
//   E3  TYPE SOURCE. Every method on TrainOsClient must be typed
//       Promise<Result<T>> where T comes from @trainos/contract. A method typed
//       against a locally-invented shape is drift that has already happened.
//
// DOCUMENTED LIMITATION, stated here rather than discovered later: E1 walks
// {success, error} envelopes only. A function that RAISES instead of returning
// an envelope has nothing to compare and is invisible to this guard. So is any
// endpoint served by the REST API rather than by a database function — until
// the HTTP client exists, E3 is the only thing standing between the client
// interface and the contract.
//
// GATE CLASS: BLOCKING, in CI and in the baseline pre-push tier.
//
// Exit 0 clean (PASS/WATCH) · 1 any BROKEN · 2 tool error.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const API_DIR = join(ROOT, "apps", "web", "src", "shared", "api");
const CLIENT_FILE = join(API_DIR, "client.ts");

const rows = [];
const record = (id, verdict, where, message) => rows.push({ id, verdict, where, message });

const rel = (p) => relative(ROOT, p);

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/* ---------------------------------------------------------------- *
 * E1 — the envelope is built by the envelope builders, not by hand
 * ---------------------------------------------------------------- */

if (!existsSync(MIGRATIONS)) {
  record("E1", "WATCH", "supabase/migrations", "no migrations yet — nothing to compare.");
} else {
  const files = readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort();

  let checked = 0;
  for (const name of files) {
    const path = join(MIGRATIONS, name);
    const sql = stripSqlComments(readFileSync(path, "utf8"));

    // A hand-built success envelope anywhere outside the two builder functions
    // themselves is the drift vector.
    const definesBuilders = /create\s+(or\s+replace\s+)?function\s+app\.(ok|err)\b/i.test(sql);

    for (const match of sql.matchAll(/jsonb_build_object\s*\(\s*'success'/gi)) {
      checked++;
      if (definesBuilders) {
        record(
          "E1",
          "PASS",
          `${rel(path)}:${lineOf(sql, match.index)}`,
          "hand-built success envelope inside the migration that DEFINES app.ok/app.err — " +
            "that is the one place it belongs.",
        );
      } else {
        record(
          "E1",
          "BROKEN",
          `${rel(path)}:${lineOf(sql, match.index)}`,
          "a success envelope is built by hand instead of through app.ok() / app.err(). " +
            "A top-level sibling key next to `data` silently flips every client from " +
            "auto-unwrap to pass-through. Call the builder.",
        );
      }
    }
  }
  if (checked === 0) {
    record("E1", "PASS", "supabase/migrations", "no hand-built success envelopes found.");
  }
}

/* ---------------------------------------------------------------- *
 * E2 — no double cast in the data layer
 * ---------------------------------------------------------------- */

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const apiFiles = walk(API_DIR);
let casts = 0;
for (const file of apiFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bas\s+unknown\s+as\b/g)) {
    casts++;
    record(
      "E2",
      "BROKEN",
      `${rel(file)}:${lineOf(source, match.index)}`,
      "`as unknown as` in the data layer. This is the cast that made a real " +
        "envelope-drift incident invisible at compile time. If it is unavoidable, " +
        "pair it with a runtime guard on the same value and say why inline.",
    );
  }
}
if (casts === 0) {
  record("E2", "PASS", rel(API_DIR), `${apiFiles.length} file(s), no double casts.`);
}

/* ---------------------------------------------------------------- *
 * E3 — every client method is typed from the contract
 * ---------------------------------------------------------------- */

if (!existsSync(CLIENT_FILE)) {
  record("E3", "BROKEN", rel(CLIENT_FILE), "the client interface is missing.");
} else {
  const source = readFileSync(CLIENT_FILE, "utf8");

  // The names imported from @trainos/contract, which is the set a return type
  // is allowed to be built from.
  const importBlock = /import\s+type\s*\{([\s\S]*?)\}\s*from\s*"@trainos\/contract"/.exec(source);
  const contractTypes = new Set(
    (importBlock?.[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  if (contractTypes.size === 0) {
    record(
      "E3",
      "BROKEN",
      rel(CLIENT_FILE),
      "the client interface imports no types from @trainos/contract. Its shapes are " +
        "then locally invented, which is drift that has already happened.",
    );
  }

  const methods = [...source.matchAll(/^ {2}([a-zA-Z0-9_]+)\(([^)]*)\):\s*([^;]+);/gm)];
  let broken = 0;

  for (const [, name, , returnType] of methods) {
    const inner = /Promise<Result<([\s\S]+)>>\s*$/.exec(returnType.trim());
    if (!inner) {
      broken++;
      record(
        "E3",
        "BROKEN",
        `${rel(CLIENT_FILE)} ${name}()`,
        `returns \`${returnType.trim()}\` rather than Promise<Result<T>>. Every method ` +
          "must return the { data, error } tuple so no caller can forget the refusal path.",
      );
      continue;
    }

    const referenced = [...inner[1].matchAll(/[A-Z][A-Za-z0-9_]*/g)].map((m) => m[0]);
    const unknown = referenced.filter(
      (typeName) => !contractTypes.has(typeName) && typeName !== "Result",
    );
    if (unknown.length > 0) {
      broken++;
      record(
        "E3",
        "BROKEN",
        `${rel(CLIENT_FILE)} ${name}()`,
        `returns ${unknown.join(", ")}, which is not imported from @trainos/contract. ` +
          "Client shapes must come from the contract, not be re-declared beside it.",
      );
    }
  }

  if (broken === 0) {
    record(
      "E3",
      "PASS",
      rel(CLIENT_FILE),
      `${methods.length} method(s), every return type sourced from @trainos/contract.`,
    );
  }
}

/* ---------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------- */

const brokenRows = rows.filter((r) => r.verdict === "BROKEN");

for (const row of rows) {
  console.log(`  ${row.verdict.padEnd(6)} ${row.id}  ${row.where}`);
  if (row.verdict !== "PASS") console.log(`         ${row.message}`);
}

console.log(
  `\ncheck:rpc: ${rows.length - brokenRows.length} pass/watch, ${brokenRows.length} broken.`,
);
process.exit(brokenRows.length > 0 ? 1 : 0);
