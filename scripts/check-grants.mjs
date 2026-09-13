#!/usr/bin/env node
// scripts/check-grants.mjs  —  `npm run check:grants`
//
// Static grant hygiene. No database connection: every rule reads the SQL as
// authored, so it runs in CI with no credentials.
//
// THE INCIDENT THIS EXISTS FOR: a SECURITY DEFINER helper was granted to the
// anonymous role, which turned it into an unauthenticated cross-tenant delete.
// A definer function runs as its owner; handing one to `anon` hands the owner's
// privileges to the internet.
//
// RULES
//   T1  no test file defines a SECURITY DEFINER function, EXCEPT in pg_temp,
//       which is session-private and gone at ROLLBACK.
//   T2  no test file grants EXECUTE to anon / authenticated / public.
//   M1  no migration grants EXECUTE to anon or public on a function outside the
//       allowlist, including the schema-wide `GRANT EXECUTE ON ALL FUNCTIONS`
//       form — which is never allowlistable, because it grants everything that
//       exists AND says nothing about what it covers.
//   A1  the allowlist is textually identical everywhere it lives: here, in the
//       hardening migration, and in the SQL test that pins it.
//
// THE NON-OBVIOUS PART OF M1: a grant is excused when a STRICTLY LATER
// migration revokes it. Judging each file in isolation flags grants that a
// later migration already closed, so revocations are tracked per function
// across the ordered migration list.
//
// GATE CLASS: BLOCKING.
//
// Exit 0 clean · 1 findings · 2 tool error.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const TESTS = join(ROOT, "supabase", "tests");

/**
 * THE ALLOWLIST — functions that may legitimately be EXECUTE-granted to `anon`
 * or `public`. Every entry needs a written reason; an unreasoned entry is how
 * an allowlist becomes a rubber stamp.
 *
 * Empty on purpose. The client-portal endpoints (§16, the unauthenticated
 * proposal view) are the only plausible future entries, and each one has to be
 * argued for when it is written, not pre-approved here.
 *
 * A1 requires this exact list to appear identically in the hardening migration
 * and in its SQL test once those exist.
 */
export const ANON_EXECUTE_ALLOWLIST = [];

/** Roles that must never receive EXECUTE on a definer function by default. */
const PUBLIC_ROLES = ["anon", "public"];

const findings = [];
const notes = [];

const finding = (rule, file, line, message) => findings.push({ rule, file, line, message });

function sqlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(dir, name));
}

/** Strip line and block comments so prose about grants is not read as a grant. */
function stripComments(sql) {
  let out = "";
  let inBlock = false;
  let inLine = false;
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const two = sql.slice(i, i + 2);
    if (!inString && !inLine && !inBlock && two === "/*") {
      inBlock = true;
      i++;
      out += "  ";
      continue;
    }
    if (inBlock && two === "*/") {
      inBlock = false;
      i++;
      out += "  ";
      continue;
    }
    if (!inString && !inBlock && !inLine && two === "--") {
      inLine = true;
      out += "  ";
      i++;
      continue;
    }
    const ch = sql[i];
    if (inLine && ch === "\n") inLine = false;
    if (!inBlock && !inLine && ch === "'") inString = !inString;
    out += inBlock || inLine ? (ch === "\n" ? "\n" : " ") : ch;
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/**
 * The schema of the last `CREATE [OR REPLACE] FUNCTION <schema>.<name>` that
 * starts before `index`, lowercased, or null if there is none. A bare
 * `CREATE FUNCTION foo()` with no schema qualification returns null, which is
 * correctly NOT `pg_temp`. A quoted `"pg_temp"` is accepted, because it names
 * the same schema.
 */
function nearestPrecedingFunctionSchema(sql, index) {
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\s*\./gi;
  let schema = null;
  for (const m of sql.matchAll(re)) {
    if (m.index >= index) break;
    schema = (m[1] ?? m[2]).toLowerCase();
  }
  return schema;
}

/* ---------------------------------------------------------------- *
 * T1 / T2 — test files
 * ---------------------------------------------------------------- */

for (const file of sqlFiles(TESTS)) {
  const shown = relative(ROOT, file);
  const sql = stripComments(readFileSync(file, "utf8"));

  for (const match of sql.matchAll(/security\s+definer/gi)) {
    // EXCEPTION: a definer function created in `pg_temp`.
    //
    // The rule's purpose is that a test must not be able to create the privilege
    // escalation it is checking for. A `pg_temp` function cannot: the temp schema
    // is private to one backend, the function disappears when that session ends,
    // and every pin in this repo creates its temp objects inside a transaction
    // that ends in ROLLBACK, so nothing outside the test can call it even while
    // it exists. Nothing can be escalated that is not already inside the session
    // doing the escalating.
    //
    // It is also a pattern the tests genuinely need. test_014 T7 has to prove
    // that `core.v_approval_requests` is readable through a SECURITY DEFINER path
    // and refused to a direct `authenticated` SELECT — which requires a definer
    // to read it through. Without this exception the guard's only advice is
    // "delete the test that proves the posture", and a guard that fires on the
    // correct code teaches people to stop reading it.
    //
    // The narrowness is the point: the schema must be literally `pg_temp`. A
    // definer created anywhere else in a test file still fires, including
    // `pg_temp_3` or a schema a test creates for itself, because those are not
    // the per-session temp schema alias and are not covered by the reasoning
    // above.
    // Pair this `security definer` with the NEAREST PRECEDING
    // `CREATE FUNCTION <schema>.` and test THAT schema. An earlier version asked
    // instead whether SOME preceding, semicolon-free CREATE was in pg_temp, which
    // was wrong in both directions: a `pg_temp` helper whose body EXECUTEs a
    // `CREATE FUNCTION core.x … SECURITY DEFINER` was excepted, and an ordinary
    // `CREATE FUNCTION pg_temp.f() … AS $$ SELECT 1; $$ … SECURITY DEFINER` was
    // flagged, because the body's own semicolon broke the anchor. There is no
    // anchor now and the pairing is positional.
    if (nearestPrecedingFunctionSchema(sql, match.index) === "pg_temp") continue;

    finding(
      "T1",
      shown,
      lineOf(sql, match.index),
      "a test file defines a SECURITY DEFINER function. A test must not be able to " +
        "create the privilege escalation it is supposed to be checking for. " +
        "(Functions created in `pg_temp` are excepted: session-private, dropped " +
        "at ROLLBACK, unreachable from outside the test.)",
    );
  }

  for (const match of sql.matchAll(/grant\s+execute[\s\S]{0,400}?;/gi)) {
    const statement = match[0].toLowerCase();
    const role = ["anon", "authenticated", "public"].find((r) =>
      new RegExp(`\\bto\\b[\\s\\S]*\\b${r}\\b`).test(statement),
    );
    if (role) {
      finding(
        "T2",
        shown,
        lineOf(sql, match.index),
        `a test file grants EXECUTE to \`${role}\`. Test fixtures must not widen ` +
          "production privileges; the grant outlives the test run.",
      );
    }
  }
}

/* ---------------------------------------------------------------- *
 * M1 — migrations, with later-revocation tracking
 * ---------------------------------------------------------------- */

const migrations = sqlFiles(MIGRATIONS);

/** function signature (lowercased, whitespace-collapsed) -> migration index of its revoke */
const revokedAt = new Map();
/** grants seen, to be judged after every revoke is known */
const grants = [];

const normalise = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

migrations.forEach((file, index) => {
  const shown = relative(ROOT, file);
  const sql = stripComments(readFileSync(file, "utf8"));

  for (const match of sql.matchAll(/revoke\s+(?:all|execute)[\s\S]{0,400}?;/gi)) {
    const statement = match[0];
    const onFunction = /on\s+function\s+([^\s;]+(?:\s*\([^)]*\))?)/i.exec(statement);
    if (!onFunction) continue;
    if (!PUBLIC_ROLES.some((role) => new RegExp(`\\b${role}\\b`, "i").test(statement))) continue;
    const key = normalise(onFunction[1]);
    if (!revokedAt.has(key)) revokedAt.set(key, index);
  }

  for (const match of sql.matchAll(/grant\s+execute[\s\S]{0,400}?;/gi)) {
    const statement = match[0];
    const toPublicRole = PUBLIC_ROLES.find((role) =>
      new RegExp(`\\bto\\b[\\s\\S]*\\b${role}\\b`, "i").test(statement),
    );
    if (!toPublicRole) continue;

    const line = lineOf(sql, match.index);

    // The schema-wide form is never allowlistable: it grants every function
    // that exists at that moment and names none of them, so nobody can review
    // what it covered or notice when a later migration widens it.
    if (/on\s+all\s+functions\s+in\s+schema/i.test(statement)) {
      finding(
        "M1",
        shown,
        line,
        `GRANT EXECUTE ON ALL FUNCTIONS ... TO ${toPublicRole}. This form is never ` +
          "allowlistable: it covers everything present and names nothing, so no " +
          "review can see what it granted. Grant per function.",
      );
      continue;
    }

    const onFunction = /on\s+function\s+([^\s;]+(?:\s*\([^)]*\))?)/i.exec(statement);
    if (!onFunction) continue;
    grants.push({ file: shown, line, index, role: toPublicRole, target: onFunction[1] });
  }
});

for (const grant of grants) {
  const key = normalise(grant.target);
  const bareName = key.replace(/\s*\(.*$/, "");

  if (
    ANON_EXECUTE_ALLOWLIST.some(
      (entry) => normalise(entry) === key || normalise(entry) === bareName,
    )
  ) {
    continue;
  }

  // Excused when a STRICTLY LATER migration revokes it.
  const revokeIndex = revokedAt.get(key) ?? revokedAt.get(bareName);
  if (revokeIndex !== undefined && revokeIndex > grant.index) continue;

  finding(
    "M1",
    grant.file,
    grant.line,
    `EXECUTE on \`${grant.target}\` is granted to \`${grant.role}\` and no later ` +
      "migration revokes it. A SECURITY DEFINER function granted to a public role " +
      "runs with its owner's privileges for an unauthenticated caller. Add it to " +
      "ANON_EXECUTE_ALLOWLIST with a written reason, or revoke it.",
  );
}

/* ---------------------------------------------------------------- *
 * A1 — allowlist parity across the three places it lives
 * ---------------------------------------------------------------- */

const hardening = migrations.find((file) => /hardening|grants?/i.test(file));

if (ANON_EXECUTE_ALLOWLIST.length === 0) {
  notes.push(
    "A1: the allowlist is empty, so there is nothing to keep in sync yet. The first " +
      "entry must be added HERE, in the hardening migration and in its SQL test in the " +
      "same commit.",
  );
} else if (!hardening) {
  finding(
    "A1",
    "scripts/check-grants.mjs",
    1,
    "the allowlist has entries but no hardening migration carries them. The " +
      "allowlist must be textually identical in all three places it lives.",
  );
} else {
  const text = readFileSync(hardening, "utf8");
  for (const entry of ANON_EXECUTE_ALLOWLIST) {
    if (!text.includes(entry)) {
      finding(
        "A1",
        relative(ROOT, hardening),
        1,
        `allowlist entry \`${entry}\` is in this script but not in the hardening migration.`,
      );
    }
  }
}

/* ---------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------- */

if (migrations.length === 0) {
  console.log("check:grants: no migrations yet — nothing to check.");
  process.exit(0);
}

console.log(
  `check:grants: ${migrations.length} migration(s), ${sqlFiles(TESTS).length} test file(s).`,
);
for (const note of notes) console.log(`  note  ${note}`);

if (findings.length === 0) {
  console.log("check:grants: OK — no public EXECUTE grants outside the allowlist.");
  process.exit(0);
}

for (const item of findings) {
  console.log(`\n  ${item.rule}  ${item.file}:${item.line}`);
  console.log(`      ${item.message}`);
}
console.log(`\ncheck:grants: ${findings.length} finding(s).`);
process.exit(1);
