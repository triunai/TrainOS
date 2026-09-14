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
//   M2  every CREATE [OR REPLACE] FUNCTION in core/app/public carries an
//       explicit REVOKE ALL ... FROM PUBLIC (and anon), in the SAME FILE.
//       PUBLIC holds EXECUTE on a new function by default in this Postgres
//       and ALTER DEFAULT PRIVILEGES does not close it (001:199-224); M1
//       catches an explicit grant, M2 catches the default nobody revoked.
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
// Overridable so scripts/check-grants.m2.test.mjs can point this at a scratch
// fixture directory instead of the real migration tree, without touching it.
const MIGRATIONS = process.env.CHECK_GRANTS_MIGRATIONS_DIR
  ? resolve(process.env.CHECK_GRANTS_MIGRATIONS_DIR)
  : join(ROOT, "supabase", "migrations");
const TESTS = process.env.CHECK_GRANTS_TESTS_DIR
  ? resolve(process.env.CHECK_GRANTS_TESTS_DIR)
  : join(ROOT, "supabase", "tests");

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
 * M2 — every CREATE [OR REPLACE] FUNCTION in core/app/public carries an
 *       explicit REVOKE, IN THE SAME FILE.
 *
 * 001's own header (001:199-224) measured this directly: PUBLIC holds
 * EXECUTE on a new function BY DEFAULT in this Postgres, and
 * `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
 * records nothing in pg_default_acl and changes nothing — a function
 * created afterwards is still executable by PUBLIC and by `anon`. The one
 * guard 001 names as measured to work is "every migration REVOKEs EXECUTE
 * per function, at creation." M1 above catches an EXPLICIT grant to a
 * public role; M2 catches the far more common way this actually breaks —
 * a function that is simply never revoked from PUBLIC at all, silently
 * inheriting the default no migration author had to write down.
 *
 * Same-file, not same-migration-set-so-far: a function created in one
 * migration and revoked only by a LATER one is still PUBLIC-executable for
 * every statement in between, on any database that stops applying migrations
 * partway (exactly the state a fresh `supabase db reset` interrupted by a
 * failure, or a review database built to an intermediate pack, is in). The
 * rule the codebase already follows (018's `REVOKE ALL ON FUNCTION x(...)
 * FROM PUBLIC, anon, authenticated;` immediately after each definition) is
 * asserted here as a requirement, not inferred as a convention.
 *
 * ⚠ GRANDFATHERED BELOW `M2_FROM_PACK`. Run without a cutoff, this rule finds
 * 166 pre-existing same-file gaps in 011, 012, 013, 018, 021 and 023 — not
 * false positives from a bad regex; they are real files that never repeat a
 * per-function REVOKE for a function they CREATE OR REPLACE that an EARLIER
 * migration already revoked (021 replacing several 018 RPCs without a fresh
 * REVOKE), or that revoke their whole set through a DYNAMIC loop this static
 * script cannot read (011 §13's `EXECUTE pg_catalog.format('REVOKE ALL ON
 * FUNCTION %s FROM PUBLIC, anon, authenticated', v_function)` over an ARRAY
 * of bare names — a deliberate, documented pattern, not an oversight).
 * `test_014` T1c/T1d/T1e (has_table_privilege, not this script) and this
 * migration set's own runtime enumeration (`supabase/tests/
 * test_zz_anon_surface.sql`, added alongside this rule) already confirm
 * `anon` holds EXECUTE on NONE of them on a real built database — measured,
 * not assumed, by querying `has_function_privilege` directly. So this is a
 * static-analysis gap in files already on hosted, not a live hole, and
 * fixing 166 findings across six already-applied migrations is a hardening
 * migration of its own, not this commit's scope. `M2_FROM_PACK` grandfathers
 * every migration numbered below it; a NEW migration at or above it gets no
 * such excuse. Lower this number (or remove it) the day someone does that
 * hardening pass.
 * ---------------------------------------------------------------- */

const M2_FROM_PACK = 31;

const CREATE_FN_RE =
  /create\s+(?:or\s+replace\s+)?function\s+((?:core|app|public)\.[a-z_][a-z0-9_]*)\s*\(/gi;

for (const file of migrations) {
  const shown = relative(ROOT, file);
  const packNumber = parseInt(shown.match(/(\d{3})_/)?.[1] ?? "0", 10);
  if (packNumber < M2_FROM_PACK) continue;
  const sql = stripComments(readFileSync(file, "utf8"));

  // Every REVOKE ... ON FUNCTION <name>(...) FROM ... in THIS file that
  // names a public role, keyed by the bare schema.name it targets. Same
  // extraction shape as M1's `onFunction`, so a REVOKE this rule accepts is
  // one M1 would also recognise as closing a grant.
  const revokedHere = new Set();
  for (const match of sql.matchAll(/revoke\s+(?:all|execute)[\s\S]{0,400}?;/gi)) {
    const statement = match[0];
    if (!PUBLIC_ROLES.some((role) => new RegExp(`\\b${role}\\b`, "i").test(statement))) continue;
    const onFunction = /on\s+function\s+([^\s;(]+)/i.exec(statement);
    if (!onFunction) continue;
    revokedHere.add(onFunction[1].toLowerCase());
  }

  for (const match of sql.matchAll(CREATE_FN_RE)) {
    const bareName = match[1].toLowerCase();
    if (revokedHere.has(bareName)) continue;

    finding(
      "M2",
      shown,
      lineOf(sql, match.index),
      `CREATE [OR REPLACE] FUNCTION ${match[1]} has no matching ` +
        "REVOKE ALL ON FUNCTION ... FROM PUBLIC (and anon) in this same file. PUBLIC " +
        "holds EXECUTE on a new function by default in this Postgres (001:199-224) " +
        "and ALTER DEFAULT PRIVILEGES does not close it — an explicit per-function " +
        "REVOKE, written in the migration that creates the function, is the only " +
        "guard measured to work.",
    );
  }
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
