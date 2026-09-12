#!/usr/bin/env node
// scripts/hygiene-check.mjs
//
// Advisory doc/state staleness nudge. Routed through scripts/guard.mjs
// (advisory + toggle-aware) and run at pre-push. It answers one question
// deterministically: "have you committed a bunch since the project-state spine
// was last refreshed?" If so, it suggests a wrap-session pass. It NEVER blocks.
//
// The UPDATE itself stays a human/skill judgment call; this only reminds.

import { execFileSync } from "node:child_process";

const HOT_STATE = "ai/hot-state.md";
const THRESHOLD = 3; // commits since the last hot-state touch before nudging

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const lastHotStateCommit = git(["log", "-1", "--format=%H", "--", HOT_STATE]);

if (!lastHotStateCommit) {
  console.log(`hygiene-check: ${HOT_STATE} has no commit history yet — skipping.`);
  process.exit(0);
}

const count = parseInt(git(["rev-list", "--count", `${lastHotStateCommit}..HEAD`]) || "0", 10);

if (count >= THRESHOLD) {
  console.log(`hygiene-check: ${count} commits since ${HOT_STATE} was last updated.`);
  console.log("   the project-state spine may be stale. Refresh hot-state + the session log.");
} else {
  console.log(`hygiene-check: ${HOT_STATE} is fresh (${count} commit(s) since last update).`);
}

process.exit(0); // advisory — never blocks
