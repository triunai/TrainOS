# Guardrails and self-healing checks

Two layers, and the distinction is the whole design.

**Tier 1 — safety.** `safe-command-guard.mjs`. Blocks a small, precise set of catastrophic
shell commands. Always on, never pausable, fires on every Bash tool call. Port it verbatim
on day one; it has no project coupling.

**Tier 2 — quality.** Everything routed through `guard.mjs`. Advisory by default, pausable
via a sentinel file, and each check ratchets to blocking individually once its baseline is
clean.

A check that has genuinely earned the right to block gets wired into the `baseline` hook
tier directly, bypassing `guard.mjs` entirely, so the pause can never silence it.

Build order: §1 → §2 → §3 → §4 → §5 → §6 → then the Supabase-coupled family in §7 once a
database exists.

---

## 1. scripts/safe-command-guard.mjs

Wired as the `PreToolUse(Bash)` hook in `.claude/settings.json` with a 10-second timeout.

**Design bias, stated so it is not eroded: false positives are worse than misses.** This
runs before every single Bash call. A bad match blocks legitimate work and trains the
operator to distrust the guard. Rules are deliberately narrow; anything unmatched is
silently allowed. Malformed input, a non-Bash tool call, or unreadable stdin all fail
open.

```js
#!/usr/bin/env node
// scripts/safe-command-guard.mjs
//
// Tier-1 ALWAYS-ON SAFETY guard — a Claude Code PreToolUse(Bash) hook that
// blocks a small, precise set of catastrophic shell commands before they run.
//
// CRITICAL distinction: this is SAFETY, not a quality gate. Unlike the advisory
// guardrail layer routed through scripts/guard.mjs, this hook is NOT silenced
// by the `.guardrails-off` toggle. It fires on EVERY Bash tool call, toggle or
// not. The blast radius of the commands it catches (deleting the repo,
// force-pushing over history, destroying a worktree, leaking secrets) is
// irreversible, so it stays on unconditionally.
//
// DESIGN BIAS — false positives are worse than misses. A bad match blocks
// legitimate work and trains the operator to distrust the guard. The rules are
// deliberately narrow: when in doubt, ALLOW. Anything unmatched is a silent
// allow.
//
// PROTOCOL:
//   Input (stdin JSON):  { "tool_name": "Bash", "tool_input": { "command": "..." }, ... }
//   Block (recommended): stdout JSON
//       { "hookSpecificOutput": {
//           "hookEventName": "PreToolUse",
//           "permissionDecision": "deny",
//           "permissionDecisionReason": "<why>" } }
//   A non-zero exit with the reason on stderr is also honoured as a blocking
//   signal. BOTH are emitted for maximum robustness across harness versions.
//   Allow: exit 0 with no output — the call proceeds through the normal
//   permission flow (silence does NOT auto-approve; it defers).
//
// Pure Node, zero dependencies.

/** Collapse whitespace and lower-case — order/spacing-tolerant matching. */
const norm = (cmd) => cmd.toLowerCase().replace(/\s+/g, " ").trim();

/** True if the command is an `rm` invocation with recursive AND force flags. */
function isRmRecursiveForce(n) {
  // Any order: -rf, -fr, -r -f, --recursive --force, -Rf. Word-boundary
  // anchored so `npm`/`charm` do not match.
  if (!/(^|[;&|]|\s)rm\s/.test(" " + n)) return false;
  const hasR = /\s-\w*r\w*\b/.test(n) || /--recursive\b/.test(n);
  const hasF = /\s-\w*f\w*\b/.test(n) || /--force\b/.test(n);
  return hasR && hasF;
}

/** Best-effort target operands of an rm command, flags stripped. */
function rmTargets(n) {
  const after = n.replace(/^.*?\brm\s/, "");
  return after.split(" ").filter((t) => t && !t.startsWith("-"));
}

const RULES = [
  // ── rm -rf against dangerous / broad targets ─────────────────────────────
  // Narrow paths (rm -rf node_modules/.vite, rm -rf dist) are normal hygiene
  // and are ALLOWED. Only broad or system targets are blocked.
  {
    test: (cmd) => {
      const n = norm(cmd);
      if (!isRmRecursiveForce(n)) return false;
      const targets = rmTargets(n);
      // No discernible target but recursive-force present → treat as unsafe.
      if (targets.length === 0) return true;
      return targets.some((t) => {
        if (t === "/" || t === "/*" || t === "~" || t === "~/" || t === "~/*") return true;
        if (t === "." || t === "./" || t === ".." || t === "../" || t === "./*" || t === "../*") return true;
        if (t === "*" || t === "*.*") return true;
        if (/^[a-z]:[\\/]?$/.test(t) || /^[a-z]:[\\/]\*$/.test(t)) return true; // C:\  C:/  C:\*
        if (/^\$home\b/.test(t) || /^%userprofile%/.test(t)) return true;
        // A one-segment absolute path (/etc, /usr) — recursive-force on a
        // top-level system directory.
        if (/^\/[a-z_]+\/?$/.test(t)) return true;
        return false;
      });
    },
    reason:
      "Blocked: `rm -rf` targeting the filesystem root, home, the repo/current directory, a bare drive root, or a broad glob (`*`, `.`). This is irreversible and can wipe the whole tree. If you truly mean a narrow path (e.g. `rm -rf node_modules/.vite`), name the explicit subdirectory.",
  },

  // ── git push --force / -f ────────────────────────────────────────────────
  // --force-with-lease is explicitly ALLOWED: it aborts if the remote moved.
  {
    test: (cmd) => {
      const n = norm(cmd);
      if (!/\bgit\b.*\bpush\b/.test(n)) return false;
      if (/--force-with-lease\b/.test(n)) return false; // safe variant — allow
      return /--force\b/.test(n) || /\s-f\b/.test(n) || /\s-\w*f\b/.test(n);
    },
    reason:
      "Blocked: `git push --force` / `-f` rewrites remote history and can destroy work that is not in your local clone. Use `git push --force-with-lease`, which aborts if the remote has moved.",
  },

  // ── git worktree remove --force / -f ─────────────────────────────────────
  // Real incident class: this command has deleted a worktree's .git plus
  // hundreds of working files when node_modules was present.
  {
    test: (cmd) => {
      const n = norm(cmd);
      if (!/\bgit\b.*\bworktree\b.*\bremove\b/.test(n)) return false;
      return /--force\b/.test(n) || /\s-f\b/.test(n);
    },
    reason:
      "Blocked: `git worktree remove --force` has, in practice, deleted a worktree's `.git` plus its entire working tree — especially on Windows worktrees containing node_modules. Instead: `git worktree prune`, then delete the directory manually.",
  },

  // ── curl/wget piped into a shell ─────────────────────────────────────────
  {
    test: (cmd) => {
      const n = norm(cmd);
      const fetches = /\b(curl|wget|iwr|invoke-webrequest)\b/.test(n);
      if (!fetches) return false;
      if (/\|\s*(sudo\s+)?(bash|sh|zsh|ksh|dash|fish|pwsh|powershell|cmd)\b/.test(n)) return true;
      if (/\|\s*\S*\s+-c\b/.test(n)) return true;
      return false;
    },
    reason:
      "Blocked: piping a network download straight into a shell (`curl … | bash`, `wget … | sh`, `… | bash -c`) executes unreviewed remote code. Download to a file, inspect it, then run it deliberately.",
  },

  // ── Printing a dotenv file ───────────────────────────────────────────────
  // .env.example / .sample / .template are explicitly ALLOWED.
  {
    test: (cmd) => {
      const n = norm(cmd);
      const reads = /\b(cat|type|get-content|gc|bat|less|more|head|tail)\b/.test(n);
      if (!reads) return false;
      return /(^|[\s"'=/\\])\.env(\.[a-z]+)?\b/.test(n) &&
        !/\.env(\.[a-z]+)?\.(example|sample|template)\b/.test(n) &&
        !/\.env\.example\b/.test(n);
    },
    reason:
      "Blocked: printing a `.env` / `.env.local` file dumps live secrets into the transcript. Read `.env.example` for the variable names, or reference specific values another way. (`.env.example` is allowed.)",
  },

  // ── Echoing a secret-shaped env var ──────────────────────────────────────
  // CRITICAL CARVE-OUT: VITE_-prefixed vars are public-by-design (they ship in
  // the client bundle) and are never blocked.
  {
    test: (cmd) => {
      const n = norm(cmd);
      const prints = /\b(echo|printenv|print-env|printf|write-output|write-host)\b/.test(n) ||
        /\bset\b\s*$/.test(n) || /\benv\b\s*$/.test(n);
      if (!prints) return false;
      const secretName =
        /(?<!vite_)(service_role(_key)?|_service_role|sb_secret|stripe_secret|stripe_sk|sk_live|sk_test|secret_key|private_key|access_token|auth_token|password|client_secret)/;
      return secretName.test(n);
    },
    reason:
      "Blocked: this command would print a secret env var (a secret API key, private key, auth token, password) into the transcript. `VITE_`-prefixed vars are public-by-design and are NOT blocked — use those if you need a client-side value.",
  },

  // ── chmod -R 777 ─────────────────────────────────────────────────────────
  {
    test: (cmd) => {
      const n = norm(cmd);
      if (!/\bchmod\b/.test(n)) return false;
      const recursive = /\s-\w*r\w*\b/.test(n) || /--recursive\b/.test(n);
      return recursive && /\b777\b/.test(n);
    },
    reason:
      "Blocked: `chmod -R 777` makes an entire tree world-writable and executable — a security foot-gun. Grant the narrowest permission the task actually needs, on the specific path.",
  },

  // ── git reset --hard ─────────────────────────────────────────────────────
  {
    test: (cmd) => {
      const n = norm(cmd);
      return /\bgit\b\s+reset\b.*--hard\b/.test(n);
    },
    reason:
      "Blocked: `git reset --hard` permanently discards uncommitted changes. Use `git stash` (recoverable) — stash, verify, then drop the stash if you really meant to throw the work away.",
  },
];

// ── Decision emitter ───────────────────────────────────────────────────────

function deny(reason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(payload));
  process.stderr.write(reason + "\n");
  process.exit(2);
}

/** Allow: no output, clean exit — defers to the normal permission flow. */
function allow() {
  process.exit(0);
}

// ── stdin read + dispatch ──────────────────────────────────────────────────

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return allow(); // unparseable stdin → fail OPEN. Never block on our own bug.
  }

  if (!input || input.tool_name !== "Bash") return allow();

  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== "string" || command.trim() === "") return allow();

  for (const rule of RULES) {
    let matched = false;
    try {
      matched = rule.test(command);
    } catch {
      matched = false; // a rule that throws must never block legitimate work
    }
    if (matched) return deny(rule.reason);
  }

  return allow();
});

// If stdin never delivers (no pipe attached), do not hang — allow on close.
process.stdin.on("error", () => allow());
```

### Verifying it

```bash
# should deny (exit 2)
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | node scripts/safe-command-guard.mjs; echo "exit=$?"
# should allow (exit 0, no output)
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force-with-lease"}}' | node scripts/safe-command-guard.mjs; echo "exit=$?"
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf node_modules/.vite"}}' | node scripts/safe-command-guard.mjs; echo "exit=$?"
```

---

## 2. scripts/guardrails.config.mjs

One file holding the sentinel name, the critical-seam manifest, and the check registry, so
three copies cannot drift apart.

```js
// scripts/guardrails.config.mjs
//
// Single source of truth for the guardrail stack. Read by scripts/guard.mjs
// (the toggle runner) and by any diff-gated review trigger. Keeping the
// sentinel name, the seam manifest and the check registry in ONE file is
// deliberate: three copies would drift, and drift between a contract and its
// consumers is the failure class this stack exists to prevent.

/**
 * Toggle sentinel. When this file exists at the repo root, the advisory
 * guardrail layer is PAUSED — only the baseline hooks run. Gitignored,
 * machine-local, created/removed via `npm run guardrails:off|on`.
 */
export const SENTINEL = ".guardrails-off";

/**
 * Critical-seam manifest (globs, repo-root-relative). A diff touching ANY of
 * these is a contract-risk diff; a diff touching none is routine. Used by any
 * diff-gated review trigger you add later (§8).
 *
 * EDIT THIS LIST as the surface evolves. Seed it with the data-layer contract,
 * the auth path, and the guardrail control plane itself.
 */
export const SEAM_GLOBS = [
  "src/lib/rpc.ts",
  "src/lib/rpc.types.ts",
  "src/lib/supabase.ts",
  "src/**/useAuth*",
  "supabase/migrations/**",
  "supabase/rollbacks/**",
  ".semgrep/rules.yml",
  // The guardrail CONTROL PLANE itself: editing the jail must trigger review
  // OF that edit. Without these, an agent under finish-pressure could weaken
  // guard.mjs, drop a CHECKS entry, or rip out the hook with zero review.
  // Listed as LITERAL paths — a `scripts/guard*.mjs` glob would miss siblings,
  // and the hooks live in settings.json, not a hooks directory.
  "scripts/guard.mjs",
  "scripts/guardrails.config.mjs",
  "scripts/safe-command-guard.mjs",
  "lefthook.yml",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".dependency-cruiser-known-violations.json",
];

/**
 * Check registry. guard.mjs routes every guardrail through here.
 *   - `run`: argv to spawn (shell:true, so npm/npx resolve on Windows).
 *   - `requires`: phase-tolerance probe. While the stack is built
 *     incrementally, a check whose tool or script is not wired yet is SKIPPED
 *     quietly instead of erroring — so a partial state never breaks a hook.
 *
 * All checks are ADVISORY by default (guard.mjs swallows non-zero exits).
 * Pass --block to make one gate. Ratchet individual checks to blocking once
 * their baseline is clean: never set a number you cannot immediately hit.
 */
export const CHECKS = {
  depcruise: {
    label: "dependency-cruiser boundaries",
    run: ["npm", "run", "arch:graph"],
    requires: { npmScript: "arch:graph" },
  },
  hygiene: {
    label: "doc/state hygiene staleness",
    run: ["node", "scripts/hygiene-check.mjs"],
    requires: { file: "scripts/hygiene-check.mjs" },
  },
  bundle: {
    label: "bundle size budget",
    run: ["node", "scripts/bundle-budget-check.mjs"],
    requires: { file: "scripts/bundle-budget-check.mjs" },
  },
};
```

Add to `CHECKS` as each script lands: `edgeDeploy`, and any project-specific ratchet.

---

## 3. scripts/guard.mjs

One cross-platform chokepoint. Node rather than shell `test -f` on purpose: these hooks
run on Windows too, where POSIX `[ -f … ]` is not portable.

```js
#!/usr/bin/env node
// scripts/guard.mjs
//
// The toggle keystone of the guardrail stack — one cross-platform chokepoint
// that the git hooks, any agent Stop hook, and `npm run guard` all route
// through.
//
// Subcommands:
//   node scripts/guard.mjs off            create the sentinel  → guardrails PAUSED
//   node scripts/guard.mjs on             remove the sentinel  → guardrails ON
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
  console.log(`\n── guard: ${check.label} ${block ? "(blocking)" : "(advisory)"} ──`);
  const res = spawnSync(cmd, [...args, ...extraArgs], { cwd: ROOT, stdio: "inherit", shell: true });

  // A null exit status = the process did NOT exit normally: a SPAWN failure
  // (ENOENT/EACCES — common on Windows PATH hiccups) or a signal kill. A naive
  // `?? 0` coercion lets a check that NEVER RAN read as a clean pass, so a
  // crashed or missing tool silently certifies "green". Treat it as a TOOL
  // ERROR (>=2): surfaced loudly, and fatal under --block.
  const spawnFailed = res.status == null;
  const code = spawnFailed ? 2 : res.status;

  if (code !== 0 && !block) {
    // Convention: exit 1 = findings; exit >= 2 = the tool itself errored.
    // Advisory mode will not fail the hook, but a gate that silently "passes"
    // because it crashed is worse than a noisy one — surface non-finding
    // failures loudly so a broken gate cannot masquerade as a clean one.
    if (spawnFailed) {
      console.log(`guard: ${check.label} FAILED TO RUN (spawn error — tool missing / not on PATH?).`);
      console.log("   this check did NOT execute — advisory mode will not fail the hook, but do NOT treat it as clean.");
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

// ── dispatch ──────────────────────────────────────────────────────────────
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
```

**CI must never call `guard.mjs`.** It calls the underlying npm scripts individually, so a
locally paused toggle cannot skip a CI job.

---

## 4. .dependency-cruiser.cjs

Three rules, all blocking once run. Rules 1 and 2 apply the moment `src/features/<name>/`
exists with barrels. Rule 3 applies only once `src/shared/` exists — add it then.

```js
/**
 * dependency-cruiser configuration — {{PROJECT}}
 * ==============================================
 *
 * WHAT THIS ENFORCES
 * ------------------
 * The feature-module boundary. Each `src/features/<name>/` exposes a single
 * public surface via its `index.ts` barrel; its components/, hooks/, schemas/,
 * utils/, types/, stores/, pages/ subfolders are PRIVATE internals.
 *
 *   1. no-circular               (error) — no dependency cycles anywhere.
 *   2. no-cross-feature-internals (error) — THE HEADLINE RULE. Feature A may
 *      only reach feature B through `src/features/B/index.ts`. Importing your
 *      OWN feature's internals is allowed.
 *   3. shared-no-features        (error) — `src/shared/**` must not depend on
 *      `src/features/**`. Add this rule when src/shared/ is created.
 *
 * `.dependency-cruiser-known-violations.json` starts as `[]` and must stay
 * empty. A new repo has no legacy to baseline.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "This dependency is part of a circular relationship. Cycles make modules " +
        "impossible to reason about in isolation, break tree-shaking, and cause " +
        "non-deterministic init order (a frequent source of `undefined is not a " +
        "function` at module load). FIX: invert one edge — extract the shared piece " +
        "into a lower-level module that BOTH sides import, instead of importing " +
        "each other.",
      from: {},
      to: {
        circular: true,
      },
    },

    // HOW THE REGEX WORKS (the subtle part):
    //   from.path captures the SOURCE feature name in group $1:
    //       ^src/features/([^/]+)/
    //   to.path matches every feature file except its root index.ts(x):
    //       ^src/features/[^/]+/(?!index\.[cm]?[jt]sx?$).+
    //   This includes top-level internals such as `types.ts`, not only
    //   subfolders. to.pathNot then EXCLUDES same-feature imports via the $1
    //   back-reference, so a module importing its OWN internals is not flagged.
    //
    // Net effect: flagged ⇔ (to is some feature's internal path) AND
    //                       (that feature ≠ the importing feature).
    {
      name: "no-cross-feature-internals",
      severity: "error",
      comment:
        "A feature module reached into ANOTHER feature's internals instead of its " +
        "public barrel. Features are black boxes: import siblings through " +
        "`@/features/<name>` (the index.ts barrel) only — never " +
        "`@/features/<name>/components/...`, `/hooks/...`, `/utils/...`. " +
        "FIX: import the symbol from `@/features/<name>`; if it is not exported " +
        "there, ADD it to that feature's barrel (make it part of the public " +
        "surface) rather than deep-linking the internal path. Importing your OWN " +
        "feature's internals is fine and is not flagged.",
      from: {
        path: "^src/features/([^/]+)/",
      },
      to: {
        path: "^src/features/([^/]+)/(?!index\\.[cm]?[jt]sx?$).+",
        pathNot: "^src/features/$1/",
      },
    },

    // Enable once src/shared/ exists.
    // {
    //   name: "shared-no-features",
    //   severity: "error",
    //   comment:
    //     "`src/shared/**` (cross-cutting code) must not import from " +
    //     "`src/features/**`. The dependency arrow points features → shared, " +
    //     "never the reverse — otherwise shared cannot be reused or extracted " +
    //     "and you invite cycles. FIX: move the feature-specific logic INTO the " +
    //     "feature that needs it, or hoist the genuinely cross-cutting piece " +
    //     "down into src/shared/ and import it from there.",
    //   from: { path: "^src/shared/" },
    //   to: { path: "^src/features/" },
    // },
  ],

  options: {
    // Follow TypeScript's pre-compilation graph so type-only imports count —
    // critical, because many cross-feature edges are type-only.
    tsPreCompilationDeps: true,

    tsConfig: {
      fileName: "tsconfig.app.json",
    },

    doNotFollow: {
      path: "node_modules",
    },

    // Match the bundler's resolution order so `@/x` → `src/x.ts(x)` resolves.
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },

    exclude: {
      path: "(^|/)(node_modules|dist)/|\\.(test|spec)\\.[jt]sx?$",
    },
  },
};
```

Deliberately **not** added: a "the database client may only be imported from `src/lib`"
rule. The raw client is legitimately imported outside `src/lib` (auth, storage), and the
narrower dangerous call is better banned by a lint rule. A cruiser rule here manufactures
false positives.

Create `.dependency-cruiser-known-violations.json` containing `[]`.

---

## 5. .semgrep/rules.yml

Custom static analysis for the things a lint rule cannot express. Every rule here should
correspond to an explicit rule in `CLAUDE.md` — this file is the enforcement copy of that
institutional knowledge, and the two must be updated in lockstep.

Rules 1, 3 and 4 are stack-agnostic; ship them immediately. Rule 2 and rule 5 are
data-layer-coupled; ship them once the data layer exists, re-targeting the API shape if it
differs. Rule 6 is a heuristic starter — keep it advisory or drop it.

```yaml
# ===========================================================================
# .semgrep/rules.yml — {{PROJECT}} custom static-analysis rules
# ---------------------------------------------------------------------------
# The project's domain-specific analyzers. This is the SAST equivalent of a
# custom `no-restricted-syntax` selector in eslint.config.js — but Semgrep can
# express multi-construct / metavariable-flow patterns ESLint cannot.
#
# Every rule here transcribes an EXPLICIT rule from CLAUDE.md. When CLAUDE.md's
# coding rules change, update these in lockstep.
#
# Run locally:  npm run sast        (needs `semgrep` on PATH)
#       Docker: docker run --rm -v "${PWD}:/src" -w /src semgrep/semgrep \
#                 semgrep scan --config .semgrep/rules.yml
# Run in CI:    .github/workflows/ci.yml -> sast-semgrep job
#               ERROR rules block; WARNING/INFO are advisory.
# ===========================================================================
rules:
  # =========================================================================
  # 1. XSS — dangerouslySetInnerHTML is categorically banned.
  # =========================================================================
  - id: no-dangerously-set-inner-html
    languages: [typescript, javascript]
    severity: ERROR
    message: >-
      dangerouslySetInnerHTML is forbidden. It is the primary React XSS vector.
      If you must render rich text, sanitize through a vetted library (e.g.
      DOMPurify) and document the trust boundary inline.
    pattern: dangerouslySetInnerHTML={$HTML}
    paths:
      include:
        - src
    metadata:
      category: security
      cwe: "CWE-79: Improper Neutralization of Input During Web Page Generation (XSS)"
      owasp: "A03:2021 - Injection"
      confidence: HIGH

  # =========================================================================
  # 2. Security model — RPC-only data access. No direct table CRUD.
  #    Ship once the data layer exists. Re-target the call shape if the
  #    backend is not Supabase.
  # =========================================================================
  - id: no-direct-supabase-table-access
    languages: [typescript, javascript]
    severity: ERROR
    message: >-
      Direct table access bypasses the RPC-only security model. RLS is
      REVOKE-ALL; all reads and writes go through SECURITY DEFINER RPCs via
      rpc()/rpcEnvelope() from @/lib/rpc. A direct .from() call returns nothing
      under RLS today — and silently leaks if RLS is ever misconfigured
      tomorrow.
    pattern-either:
      - pattern: supabase.from(...).select(...)
      - pattern: supabase.from(...).insert(...)
      - pattern: supabase.from(...).update(...)
      - pattern: supabase.from(...).delete(...)
      - pattern: supabase.from(...).upsert(...)
    paths:
      include:
        - src
    metadata:
      category: security
      cwe: "CWE-284: Improper Access Control"
      owasp: "A01:2021 - Broken Access Control"
      confidence: HIGH

  # =========================================================================
  # 3. ABI fragility — `as unknown as T` double-cast.
  #    WARNING, not ERROR: legitimate sites exist. The goal is to stop NEW
  #    unguarded ones from landing.
  # =========================================================================
  - id: as-unknown-as-double-cast
    languages: [typescript]
    severity: WARNING
    message: >-
      `as unknown as <Type>` bypasses the type-checker at exactly the layer
      where the backend-to-client ABI is most fragile. A real envelope-drift
      incident was invisible at compile time BECAUSE of this cast. If
      unavoidable: pair it with a runtime guard (Zod .parse(), explicit shape
      check) on the same value and comment the trust assumption.
    pattern: $EXPR as unknown as $TYPE
    paths:
      include:
        - src
    metadata:
      category: correctness
      confidence: MEDIUM

  # =========================================================================
  # 4. console.log in shipped code.
  # =========================================================================
  - id: no-console-log-in-src
    languages: [typescript, javascript]
    severity: WARNING
    message: >-
      console.log leaks internal state to the browser console. The production
      build strips it via esbuild `drop`, but a build-config change would ship
      it verbatim. Remove before merge, or route through a logger that no-ops
      in production. console.warn / console.error are acceptable for genuine
      error paths.
    pattern: console.log(...)
    paths:
      include:
        - src
      exclude:
        - "*.test.ts"
        - "*.test.tsx"
    metadata:
      category: best-practice
      confidence: HIGH

  # =========================================================================
  # 5. Keyset pagination only — no offset/range pagination.
  # =========================================================================
  - id: no-offset-pagination
    languages: [typescript, javascript]
    severity: WARNING
    message: >-
      Use keyset (cursor) pagination, never offset. Offset pagination
      table-scans on large offsets and silently double-counts or skips rows
      under concurrent inserts. Use a (created_at DESC, id DESC) keyset cursor.
    pattern-either:
      - pattern: $Q.range($FROM, $TO)
      - pattern: $Q.offset($N)
    paths:
      include:
        - src
    metadata:
      category: correctness
      confidence: LOW

  # =========================================================================
  # 6. Structural-typing trap — a loose type holding a load-bearing meaning.
  #    ADVISORY HEURISTIC, name-based. A bare string/string[] whose NAME
  #    implies a canonical / comparison-key / token contract is a trap:
  #    TypeScript's structural typing cannot see the contract, so a raw value
  #    masquerades as a canonical one. Tune the regex and paths if noisy, or
  #    drop the rule — the real catch is a review gate, not this.
  # =========================================================================
  - id: structural-typing-trap-loose-canonical-field
    languages: [typescript]
    severity: WARNING
    message: >-
      Field "$FIELD" is a bare string/string[] but its name implies a
      LOAD-BEARING canonical / comparison-key / token meaning. TypeScript cannot
      see that contract, so a raw value can masquerade as a canonical one.
      Convert to a BRANDED type
      (`type CanonicalKey = string & { [Brand]: true }`) so the compiler
      enforces the meaning.
    patterns:
      - pattern-either:
          - pattern: "$FIELD: string[]"
          - pattern: "$FIELD: string"
      - metavariable-regex:
          metavariable: $FIELD
          regex: "(?i).*(comparison_?keys?|canonical|_tokens?)$"
    paths:
      include:
        - src/features
      exclude:
        - "*.test.ts"
        - "*.test.tsx"
    metadata:
      category: correctness
      confidence: LOW
```

**Deliberately not included**: a theme-token misuse rule from the source repo. It ships
there as an unfinished starter with open `TODO` decisions about recall versus precision
and about its own severity. The *technique* — a name-based detector for a raw value being
fed somewhere it must be resolved first — is worth remembering; the rule is not worth
copying.

---

## 6. Ratchet checks

### scripts/bundle-budget-check.mjs

Answers "what actually ships". Gzip-measures every emitted JS chunk from a scratch build
against a committed baseline, catching a mis-imported vendor or a broken lazy boundary.

Two mechanics worth understanding before you touch it:

- **The dev-server probe is a content probe, not a TCP probe.** Building while the dev
  server is live corrupts its module graph and produces duplicate module instances, which
  surfaces as "must be used within a Provider" white screens. But a non-dev process
  squatting the port is harmless to a build and must not false-positive the skip, so the
  probe looks for the dev client marker in the response body.
- **The baseline gate runs before the build.** A check with no baseline must fail fast;
  paying for a full build only to discover there is nothing to compare against taxes every
  push with zero signal. Missing baseline exits 2 (tool error), not 0.

```js
#!/usr/bin/env node
// scripts/bundle-budget-check.mjs
//
// Bundle-size budget — the "what actually SHIPS" fitness function. Builds to a
// scratch outDir and gzip-measures every emitted JS chunk against a committed
// baseline (.bundle-size-baseline.json). Same ratchet philosophy as every other
// baseline here: never set a number you cannot immediately hit.
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
const BASELINE_PATH = join(ROOT, ".bundle-size-baseline.json");
const OUT_DIR = ".bundle-check"; // scratch build target, gitignored
const DEV_PORT = 8080; // must match vite.config.ts server.port

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
  console.log(`bundle-budget: building to ${OUT_DIR}/ (scratch — dist/ untouched)...`);
  const res = spawnSync(
    "npx",
    ["--no-install", "vite", "build", "--outDir", OUT_DIR, "--emptyOutDir", "--logLevel", "warn"],
    { cwd: ROOT, stdio: "inherit", shell: true },
  );
  if (res.status !== 0) {
    console.error(`bundle-budget: vite build failed (exit ${res.status ?? "spawn-error"}).`);
    process.exit(2);
  }
}

// `index-DhP7bNqq.js` -> `index`: strip the 8-char content hash so baseline
// keys survive hash churn across builds.
const stableName = (file) => file.replace(/-[A-Za-z0-9_-]{8}\.js$/, "");

function measure() {
  const assetsDir = join(ROOT, OUT_DIR, "assets");
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
  const html = readFileSync(join(ROOT, OUT_DIR, "index.html"), "utf8");
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
  if (!(name in current.chunks)) console.log(`  chunk gone: ${name} (was ${kb(baseline.chunks[name])})`);
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
  console.log("\nbundle-budget: total shrank meaningfully — ratchet it in: npm run bundle:baseline");
}

console.log("\nbundle-budget: OK — within the committed baseline.");
process.exit(0);
```

Generate the first baseline immediately after the first successful build:
`npm run bundle:baseline`, then commit `.bundle-size-baseline.json`.

### scripts/hygiene-check.mjs

One deterministic advisory nudge, never a gate. Runs at pre-push, not on every turn —
push is roughly "end of feature", the right moment to refresh project state; nudging every
turn just nags.

```js
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
```

### The ratchet-with-justification pattern (optional, project-specific)

If this project has a recurring, greppable regression class — an expensive CSS property on
a perf-sensitive surface, a banned import in a specific tree — the shape that works is:

1. Walk a **narrow** set of scan roots, not the whole tree.
2. Match an offender regex per line, tracking block-comment state line by line (not just a
   line-local regex) so prose inside a multi-line comment is not counted and real code
   starting with `*` is not skipped.
3. Excuse a hit when the same line or the line directly above carries a justification
   marker comment, e.g. `perf-ok: translucent overlay above scrolling content`.
4. Compare per-file hit counts against a committed baseline JSON. Reducing is always
   allowed; growing requires a marker comment or an explicit `--baseline` re-ratchet.
5. Exit 0 clean, 1 findings, 2 no baseline.

**Gotcha to document wherever the baseline lives**: renaming a file with grandfathered hits
resets its allowance to zero. Re-ratchet in the same commit as the rename.

Do not create such a check speculatively. Write it when you have the second instance of the
regression, not the first.

---

## 7. Supabase-coupled checks — patterns, with the incident that motivated each

Implement these once a database exists. The *patterns* are the point; the parsing logic in
the source repo is specific to its own SQL conventions and is not reusable as-is.

### SQL parse-lint — `npm run lint:sql`

**Incident**: two migration test files were authored, recorded as executed and passing, and
could not actually run — one carried psql meta-commands unparseable by anything but psql.

**Pattern**: parse every migration, rollback and test file through the real target-database
grammar (a Postgres parser compiled to WASM) before trusting any of it as executable.
Targets `supabase/migrations/*.sql`, `supabase/tests/test_*.sql`, `supabase/rollbacks/*.sql`;
a missing directory is tolerated, not a failure. Exit 0 all parse, 1 any parse failure or
zero files found.

**Gate class: blocking.** A migration that does not parse is not a migration.

### RPC contract drift — `npm run check:rpc`

**Incident**: an RPC gained a sibling key alongside `data` in its return envelope. That
flipped the client wrapper from auto-unwrap to pass-through, and a consumer's unchecked
double cast hid the resulting shape mismatch from the compiler. A live page white-screened,
and only on the session-restore path, not on first submit.

**Pattern**: a static drift-checker across four artifacts — the SQL envelope shape as
authored, the wrapper's unwrap behaviour, the declared `RpcMap` response type, and every
consumer cast site. Classify each entry PASS / WATCH / BROKEN; exit 1 on any BROKEN.

**Documented limitation, worth stating in the script's own header**: it walks
`{success, error}` envelopes, so an RPC that raises instead of returning an envelope has
nothing to compare and is invisible to the guard.

**Gate class: blocking, in both CI and the `baseline` pre-push tier.**

### Grant hygiene — `npm run check:grants`

**Incident**: a `SECURITY DEFINER` helper was granted to the anonymous role, which turned
it into an unauthenticated cross-tenant delete.

**Pattern**, all static, no database connection:

| Rule | Checks |
|---|---|
| T1 | no test file defines a `SECURITY DEFINER` function |
| T2 | no test file grants EXECUTE to anon/authenticated/public |
| M1 | no migration after the hardening cutoff grants EXECUTE to anon/public on a function outside the allowlist, including the schema-wide `GRANT EXECUTE ON ALL FUNCTIONS` form (never allowlistable) |
| A1 | the allowlist is textually identical in all three places it lives: the script, the hardening migration, and the SQL test |

The non-obvious part of M1: a grant is excused if a **strictly later** migration revokes it.
Track per-function revoked-at migration numbers rather than judging each file in isolation,
or you will flag grants that a later migration already closed.

**Gate class: blocking.**

### Applied-vs-authored parity — `npm run check:applied`

**Incident**: a migration sat in the repo, was cited by later migrations as established
fact, and had never been applied. The live database's actual state was an unrelated open
security hole, closed three months later by a different migration.

**Pattern**: a file in version control is a *claim*, not a *fact*, about a deployed system.
Compare the migration directory against a **committed snapshot** of the applied-migrations
ledger, so the check runs in CI with no production credentials. Match by slug, not by
number — ledger names are operator-typed and neither reliably unique nor reliably numbered.
Keep a `DELIBERATE_NON_APPLIES` map requiring a reason and a citation per entry, printed in
full on every run, and flag an entry that appears in the ledger (the excuse is now false)
or has no matching file (stale excuse).

Two limits to state in the header: it compares the tree against a *record* of the ledger,
not against production, so it cannot catch a snapshot recorded by someone who never read
production. And it does not compare body hashes — measured at roughly 87% false positives,
because the ledger stores executed SQL rather than the file's byte range.

**Gate class**: manual, at migration-review time.

### Out-of-band deploy parity — `npm run check:edge`

**Incident**: an edge function's allowlist was fixed in the repo two hours after the last
deploy. For three days every customer reaching four of five options got a 400, despite a
fully green test suite and a clean contract check. `git push` does nothing to edge
functions.

**Pattern**: for each function, resolve the transitive closure of the **local** files it
imports (follow only relative specifiers; a remote import's version bump changes the
entrypoint's own bytes and is caught anyway), hash the sorted path-plus-content set with
SHA-256 — hash the path too, so moving a file between a shared directory and a function
directory is visible even with identical bytes — and compare against the hash recorded at
last deploy. Status per function: IN SYNC / SKEWED / UNRECORDED. Recording is part of
deploying, not a step afterwards.

**Gate class**: advisory, registered in `CHECKS`.

**Generalise this**: anything that deploys out of band from `git push` — edge functions,
serverless functions, dashboard-configured settings — needs a content-hash-versus-last-known-deploy
parity check, whatever the platform.

---

## 8. Diff-gated review trigger (optional, build last)

Build this only once `SEAM_GLOBS` has real entries worth protecting and there is an agent
runner available to launch in the background.

The architecture is the reusable part:

1. Resolve a diff base by trying an explicit `--base=<ref>`, then the remote default, then
   the local default branch, then the previous commit; fall back to working-tree-vs-HEAD.
2. Changed files = union of the base diff and the staged diff.
3. Match against `SEAM_GLOBS`. Exclude test and spec files from ever counting as a seam
   touch — a config *test* changing is not a contract change.
4. Zero seam files touched → silent exit 0.
5. Fingerprint = SHA-256 of (sorted seam file list + diff body), truncated. A ledger file
   already existing for that fingerprint means the same diff is never re-reviewed.
6. Daily cap on launches, since a review may be paid. Record a ledger entry when capped.
7. Spawn the review **detached and unref'd** so the hook returns immediately and never
   holds a commit or push.
8. Record a ledger entry regardless of outcome, best-effort, wrapped so a ledger-write
   failure cannot break the gate.
9. **Exit 0 on every code path.** This must never fail a hook.

Wire it into the `baseline` tier and any agent Stop hook, **not** through `guard.mjs`, so
pausing the noisy advisory layer can never silence the reviewer. That asymmetry — you can
turn off the noise but not the review — is deliberate: the agent operating the toggle
cannot also be the only control on whether its own work gets reviewed.

The review prompt's contents are entirely project-specific. Write this project's own three
to five regression classes into it; do not carry another project's.

---

## 9. Load-test safety contract (for later)

Not something to build now. When there is a rate-limited or latency-sensitive surface worth
load-testing, the discipline to copy is:

- Writes go **only** to a hardcoded QA-target allowlist, held in config, never a parameter.
- Every written row carries a uniform marker prefix so cleanup can be precise.
- Public/anon credentials only — the suite should refuse a key that looks privileged.
- Bounded rates, short windows. No stress, breakpoint or soak runs against shared
  infrastructure.
- Three cleanup layers: purge before, purge after, and an **independent auditor** that is
  not the purge mechanism, so a bug in one cannot hide a leak in the other.
- If the API always returns HTTP 200 with the verdict inside the response body, the
  built-in HTTP-status checks are meaningless. Parse correctness out of the body into
  custom metrics, and let thresholds — not diagnostic checks — gate the run.
