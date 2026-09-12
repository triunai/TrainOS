#!/usr/bin/env node
// scripts/bundle-budget-check.mjs
//
// Bundle-size budget — the "what actually SHIPS" fitness function. Builds
// apps/web to a scratch outDir and gzip-measures every emitted JS chunk against
// a committed baseline (.bundle-size-baseline.json). Same ratchet philosophy as
// every other baseline here: never set a number you cannot immediately hit.
//
// SAFETY: `vite build` while the dev server is live corrupts its module graph
// (node_modules/.vite) -> duplicate module instances -> provider white screens.
// The check probes the dev port FIRST and SKIPS (exit 0, loudly) when a dev
// server is listening. Do not bypass this by hand.
//
// Usage:
//   node scripts/bundle-budget-check.mjs             # check (exit 1 = findings)
//   node scripts/bundle-budget-check.mjs --baseline  # rebuild + regenerate

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The app is a workspace: the build runs in apps/web and emits relative to it.
const WEB = join(ROOT, "apps", "web");
const BASELINE_PATH = join(ROOT, ".bundle-size-baseline.json");
const OUT_DIR = ".bundle-check"; // scratch build target inside apps/web, gitignored
const DEV_PORT = Number(process.env.TRAINOS_DEV_PORT ?? 5180); // must match apps/web/vite.config.ts server.port

// A chunk drifts a little between builds (hash noise, tiny edits); the
// regressions worth catching are tens-to-hundreds of KB. Tolerances in gzip
// bytes.
const chunkTolerance = (base) => Math.max(4096, Math.round(base * 0.03));
const totalTolerance = (base) => Math.max(8192, Math.round(base * 0.02));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/**
 * Content probe, not a bare TCP probe: only the dev server owns
 * node_modules/.vite. Another process squatting the port is harmless to a build
 * and must not false-positive the skip. Returns "vite" | "other" | "none".
 */
function probeDevPort(host, port, timeoutMs = 1500) {
  return new Promise((resolveProbe) => {
    let settled = false;
    const settle = (verdict) => {
      if (!settled) {
        settled = true;
        resolveProbe(verdict);
      }
    };
    const req = http.get({ host, port, path: "/", timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
        if (body.includes("/@vite/client")) {
          settle("vite");
          req.destroy();
        } else if (body.length > 262144) {
          settle("other");
          req.destroy();
        }
      });
      res.on("end", () => settle(body.includes("/@vite/client") ? "vite" : "other"));
      res.on("close", () => settle("other"));
    });
    req.on("timeout", () => {
      req.destroy();
      settle("other"); // answered the socket but not HTTP in time
    });
    req.on("error", () => settle("none"));
  });
}

async function devServerState() {
  // vite.config.ts binds host "::" — probe both stacks.
  const verdicts = await Promise.all([
    probeDevPort("127.0.0.1", DEV_PORT),
    probeDevPort("::1", DEV_PORT),
  ]);
  if (verdicts.includes("vite")) return "vite";
  if (verdicts.includes("other")) return "other";
  return "none";
}

function build() {
  console.log(`bundle-budget: building apps/web to ${OUT_DIR}/ (scratch — dist/ untouched)...`);
  const res = spawnSync(
    "npx",
    ["--no-install", "vite", "build", "--outDir", OUT_DIR, "--emptyOutDir", "--logLevel", "warn"],
    { cwd: WEB, stdio: "inherit", shell: true },
  );
  if (res.status !== 0) {
    console.error(`bundle-budget: vite build failed (exit ${res.status ?? "spawn-error"}).`);
    process.exit(2);
  }
}

// `index-DhP7bNqq.js` -> `index`: strip the content hash so baseline keys
// survive hash churn across builds.
const stableName = (file) => file.replace(/-[A-Za-z0-9_-]{8}\.js$/, "");

function measure() {
  const assetsDir = join(WEB, OUT_DIR, "assets");
  if (!existsSync(assetsDir)) {
    console.error(`bundle-budget: ${OUT_DIR}/assets missing after build — nothing to measure.`);
    process.exit(2);
  }

  const chunks = {};
  for (const file of readdirSync(assetsDir)) {
    if (!file.endsWith(".js")) continue;
    const size = gzipSync(readFileSync(join(assetsDir, file))).length;
    const name = stableName(file);
    chunks[name] = (chunks[name] ?? 0) + size; // sum on stable-name collision
  }

  // The entry chunk is whatever index.html actually loads. Label-only: the
  // budget gates ALL chunks uniformly via the per-chunk ratchet below.
  const html = readFileSync(join(WEB, OUT_DIR, "index.html"), "utf8");
  const entryMatch = html.match(/<script[^>]*type="module"[^>]*src="[^"]*\/assets\/([^"]+\.js)"/);
  const entry = entryMatch ? stableName(entryMatch[1]) : null;

  const totalGzipJs = Object.values(chunks).reduce((n, s) => n + s, 0);
  return { entry, chunks, totalGzipJs };
}

function report({ entry, chunks, totalGzipJs }) {
  const rows = Object.entries(chunks).sort(([, a], [, b]) => b - a);
  for (const [name, size] of rows) {
    console.log(`  ${kb(size).padStart(10)}  ${name}${name === entry ? "   <- entry" : ""}`);
  }
  console.log(`  ${kb(totalGzipJs).padStart(10)}  TOTAL gzip JS (${rows.length} chunks)`);
}

const isBaselineRun = process.argv.includes("--baseline");

const devState = await devServerState();
if (devState === "vite") {
  console.log(
    `bundle-budget: SKIPPED — a dev server is listening on :${DEV_PORT}.\n` +
      `  Building while the dev server is live corrupts its module graph\n` +
      `  (node_modules/.vite) -> provider white screens. Stop it, then run:\n` +
      `  npm run bundle:${isBaselineRun ? "baseline" : "check"}`,
  );
  process.exit(0);
}
if (devState === "other") {
  console.log(
    `bundle-budget: note — :${DEV_PORT} is held by a non-dev-server process. ` +
      `Safe to build, but \`npm run dev\` will fight it for the port.`,
  );
}

// Baseline gate BEFORE the build: a check with no baseline must fail fast. The
// baseline ships committed, so its absence means it was DELETED — exit 2 (tool
// error, loud under guard.mjs advisory) rather than a silent pass.
let baseline;
if (!isBaselineRun) {
  if (!existsSync(BASELINE_PATH)) {
    console.error(
      "bundle-budget: no baseline found — run `npm run bundle:baseline` (dev server stopped) and commit .bundle-size-baseline.json.",
    );
    process.exit(2);
  }
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`bundle-budget: baseline unreadable (${BASELINE_PATH}).`);
    process.exit(2);
  }
}

build();
const current = measure();

if (isBaselineRun) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  console.log(`bundle-budget: baseline written (${Object.keys(current.chunks).length} chunks):`);
  report(current);
  process.exit(0);
}

let findings = 0;

for (const [name, size] of Object.entries(current.chunks)) {
  const base = baseline.chunks?.[name];
  if (base === undefined) {
    console.log(`  new chunk: ${name} (${kb(size)}) — counted in the total check below.`);
    continue;
  }
  const allowed = base + chunkTolerance(base);
  if (size > allowed) {
    findings++;
    console.log(`x ${name} grew ${kb(base)} -> ${kb(size)} (allowed ${kb(allowed)})`);
  }
}
for (const name of Object.keys(baseline.chunks ?? {})) {
  if (!(name in current.chunks))
    console.log(`  chunk gone: ${name} (was ${kb(baseline.chunks[name])})`);
}

const totalAllowed = baseline.totalGzipJs + totalTolerance(baseline.totalGzipJs);
if (current.totalGzipJs > totalAllowed) {
  findings++;
  console.log(
    `x TOTAL gzip JS grew ${kb(baseline.totalGzipJs)} -> ${kb(current.totalGzipJs)} (allowed ${kb(totalAllowed)})`,
  );
}

console.log("\nbundle-budget: current build:");
report(current);

if (findings) {
  console.log(
    `\nbundle-budget: ${findings} budget regression(s) vs .bundle-size-baseline.json.` +
      `\n  Dig in:   npm run bundle:analyze   (treemap — what is inside the chunk)` +
      `\n  Accept:   npm run bundle:baseline  (deliberate growth only — ratchet, do not rubber-stamp)`,
  );
  process.exit(1);
}

if (current.totalGzipJs < baseline.totalGzipJs - totalTolerance(baseline.totalGzipJs)) {
  console.log(
    "\nbundle-budget: total shrank meaningfully — ratchet it in: npm run bundle:baseline",
  );
}

console.log("\nbundle-budget: OK — within the committed baseline.");
process.exit(0);
