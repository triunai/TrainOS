#!/usr/bin/env node
// scripts/guard.mjs
//
// The toggle keystone of the guardrail stack — one cross-platform chokepoint
// that the git hooks, any agent Stop hook, and `npm run guard` all route
// through.
//
// Subcommands:
//   node scripts/guard.mjs off            create the sentinel  -> guardrails PAUSED
//   node scripts/guard.mjs on             remove the sentinel  -> guardrails ON
//   node scripts/guard.mjs status         print the current state
//   node scripts/guard.mjs all            run every guardrail (advisory)
//   node scripts/guard.mjs run <check>    run one guardrail by name
//   ...append --block to make a run gate (propagate a non-zero exit)
//
// Baseline hooks deliberately do NOT route through here — they always run,
// toggle or not. Only the advisory layer is pausable.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { SENTINEL, CHECKS } from "./guardrails.config.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sentinelPath = join(ROOT, SENTINEL);

const isPaused = () => existsSync(sentinelPath);

function status() {
  if (isPaused()) {
    console.log("guardrails: OFF (paused) — baseline still runs: lint-staged, commitlint.");
    console.log(`  re-enable: npm run guardrails:on   (removes ${SENTINEL})`);
  } else {
    console.log("guardrails: ON (advisory).");
    console.log(`  pause:     npm run guardrails:off  (creates ${SENTINEL})`);
  }
}

function pause() {
  if (!isPaused()) {
    // Timestamp is informational only; presence/absence is what matters.
    writeFileSync(sentinelPath, `guardrails paused at ${new Date().toISOString()}\n`);
  }
  console.log("guardrails PAUSED — the advisory layer is off; baseline hooks still run.");
  console.log("   re-enable with: npm run guardrails:on");
}

function resume() {
  if (isPaused()) rmSync(sentinelPath);
  console.log("guardrails ON (advisory) — checks fire at their junctures again.");
}

function hasNpmScript(name) {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    return Boolean(pkg.scripts && pkg.scripts[name]);
  } catch {
    return false;
  }
}

// Phase tolerance: while the stack is built incrementally, skip a check whose
// underlying tool or script is not wired yet instead of failing the hook.
function isWired(check) {
  const req = check.requires || {};
  if (req.file && !existsSync(join(ROOT, req.file))) return false;
  if (req.npmScript && !hasNpmScript(req.npmScript)) return false;
  return true;
}

/**
 * Run one named check. ADVISORY by default — a non-zero exit is surfaced as a
 * warning and swallowed, so an advisory finding can never fail a git hook.
 * With `block: true` the exit code propagates (the ratchet to a real gate).
 */
function runCheck(name, extraArgs, { block }) {
  const check = CHECKS[name];
  if (!check) {
    console.error(`guard: unknown check "${name}". Known: ${Object.keys(CHECKS).join(", ")}`);
    return 0;
  }
  if (!isWired(check)) {
    console.log(`guard: ${name} not wired yet — skipping (advisory).`);
    return 0;
  }

  const [cmd, ...args] = check.run;
  console.log(`\n-- guard: ${check.label} ${block ? "(blocking)" : "(advisory)"} --`);
  const res = spawnSync(cmd, [...args, ...extraArgs], { cwd: ROOT, stdio: "inherit", shell: true });

  // A null exit status = the process did NOT exit normally: a SPAWN failure
  // (ENOENT/EACCES) or a signal kill. A naive `?? 0` coercion lets a check that
  // NEVER RAN read as a clean pass, so a crashed or missing tool silently
  // certifies "green". Treat it as a TOOL ERROR (>=2): surfaced loudly, and
  // fatal under --block.
  const spawnFailed = res.status == null;
  const code = spawnFailed ? 2 : res.status;

  if (code !== 0 && !block) {
    // Convention: exit 1 = findings; exit >= 2 = the tool itself errored.
    if (spawnFailed) {
      console.log(
        `guard: ${check.label} FAILED TO RUN (spawn error — tool missing / not on PATH?).`,
      );
      console.log(
        "   this check did NOT execute — advisory mode will not fail the hook, but do NOT treat it as clean.",
      );
    } else if (code >= 2) {
      console.log(`guard: ${check.label} EXITED ${code} — looks like a TOOL ERROR, not findings.`);
      console.log("   the gate may be misconfigured (advisory mode is hiding it). Investigate.");
    } else {
      console.log(`guard: ${check.label} reported findings (advisory — not blocking).`);
    }
    return 0;
  }
  return code;
}

function runMany(names, extraArgs, { block }) {
  if (isPaused()) {
    console.log("(guardrails paused — skipping all guardrail checks)");
    return 0;
  }
  let worst = 0;
  for (const name of names) {
    worst = Math.max(worst, runCheck(name, extraArgs, { block }));
  }
  return block ? worst : 0;
}

const [sub, ...rest] = process.argv.slice(2);
const block = rest.includes("--block");
const positional = rest.filter((a) => a !== "--block");

switch (sub) {
  case "off":
    pause();
    break;
  case "on":
    resume();
    break;
  case "status":
    status();
    break;
  case undefined:
  case "all":
    process.exit(runMany(Object.keys(CHECKS), [], { block }));
    break;
  case "run": {
    const [name, ...extra] = positional;
    if (!name) {
      console.error("guard: `run` needs a check name. Known: " + Object.keys(CHECKS).join(", "));
      process.exit(2);
    }
    process.exit(runMany([name], extra, { block }));
    break;
  }
  default:
    console.error(`guard: unknown subcommand "${sub}". Use: on | off | status | all | run <check>`);
    process.exit(2);
}
