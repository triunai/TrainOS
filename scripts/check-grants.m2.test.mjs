#!/usr/bin/env node
// scripts/check-grants.m2.test.mjs — `node scripts/check-grants.m2.test.mjs`
//
// A small, self-contained test for check-grants.mjs's M2 rule (every
// CREATE [OR REPLACE] FUNCTION in core/app/public carries an explicit
// REVOKE ... FROM PUBLIC in the same file). Builds two scratch fixture
// migrations — one with a matching REVOKE, one without — in a temp
// directory, runs check-grants.mjs against ONLY that directory (via the
// CHECK_GRANTS_MIGRATIONS_DIR / CHECK_GRANTS_TESTS_DIR overrides), and
// asserts it flags the bad fixture and not the good one.
//
// Does not touch supabase/migrations or supabase/tests. Exit 0 pass, 1 fail.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "check-grants.mjs");

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}`);
    failures++;
  }
}

function runAgainst(migrationsDir, testsDir) {
  try {
    const out = execFileSync("node", [SCRIPT], {
      env: {
        ...process.env,
        CHECK_GRANTS_MIGRATIONS_DIR: migrationsDir,
        CHECK_GRANTS_TESTS_DIR: testsDir,
      },
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 2, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

// ── Fixture 1: a migration numbered >= M2_FROM_PACK (31) whose CREATE
//    FUNCTION has NO matching REVOKE in the same file — must be flagged. ──
const badDir = mkdtempSync(join(tmpdir(), "check-grants-m2-bad-"));
writeFileSync(
  join(badDir, "031_bad_no_revoke.sql"),
  `
CREATE OR REPLACE FUNCTION app.leaky_helper(p_x uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $fn$
  SELECT '{}'::jsonb;
$fn$;
`,
);

// ── Fixture 2: the same shape, but WITH a matching same-file REVOKE — must
//    NOT be flagged. ──────────────────────────────────────────────────────
const goodDir = mkdtempSync(join(tmpdir(), "check-grants-m2-good-"));
writeFileSync(
  join(goodDir, "031_good_with_revoke.sql"),
  `
CREATE OR REPLACE FUNCTION app.safe_helper(p_x uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $fn$
  SELECT '{}'::jsonb;
$fn$;

REVOKE ALL ON FUNCTION app.safe_helper(uuid) FROM PUBLIC, anon, authenticated;
`,
);

// ── Fixture 3: same missing-REVOKE shape as fixture 1, but numbered BELOW
//    M2_FROM_PACK — must NOT be flagged (the grandfather cutoff). ─────────
const grandfatheredDir = mkdtempSync(join(tmpdir(), "check-grants-m2-old-"));
writeFileSync(
  join(grandfatheredDir, "011_old_no_revoke.sql"),
  `
CREATE OR REPLACE FUNCTION app.legacy_helper(p_x uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $fn$
  SELECT '{}'::jsonb;
$fn$;
`,
);

const emptyTests = mkdtempSync(join(tmpdir(), "check-grants-m2-tests-"));

const bad = runAgainst(badDir, emptyTests);
assert(bad.code === 1, "fixture 1 (031, no REVOKE): script exits 1 (findings)");
assert(bad.out.includes("M2") && bad.out.includes("leaky_helper"), "fixture 1: finding names M2 and app.leaky_helper");

const good = runAgainst(goodDir, emptyTests);
assert(good.code === 0, "fixture 2 (031, matching REVOKE): script exits 0 (clean)");
assert(!good.out.includes("safe_helper"), "fixture 2: safe_helper is not flagged");

const grandfathered = runAgainst(grandfatheredDir, emptyTests);
assert(grandfathered.code === 0, "fixture 3 (011, no REVOKE, below M2_FROM_PACK): script exits 0 (grandfathered)");
assert(!grandfathered.out.includes("legacy_helper"), "fixture 3: legacy_helper is not flagged (grandfathered)");

for (const dir of [badDir, goodDir, grandfatheredDir, emptyTests]) {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\ncheck-grants.m2.test: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\ncheck-grants.m2.test: all PASS.");
