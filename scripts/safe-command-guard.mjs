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
  // rm -rf against dangerous / broad targets.
  // Narrow paths (rm -rf node_modules/.vite, rm -rf dist) are normal hygiene
  // and are ALLOWED. Only broad or system targets are blocked.
  {
    test: (cmd) => {
      const n = norm(cmd);
      if (!isRmRecursiveForce(n)) return false;
      const targets = rmTargets(n);
      // No discernible target but recursive-force present -> treat as unsafe.
      if (targets.length === 0) return true;
      return targets.some((t) => {
        if (t === "/" || t === "/*" || t === "~" || t === "~/" || t === "~/*") return true;
        if (t === "." || t === "./" || t === ".." || t === "../" || t === "./*" || t === "../*")
          return true;
        if (t === "*" || t === "*.*") return true;
        if (/^[a-z]:[\\/]?$/.test(t) || /^[a-z]:[\\/]\*$/.test(t)) return true;
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

  // git push --force / -f.
  // --force-with-lease is explicitly ALLOWED: it aborts if the remote moved.
  {
    test: (cmd) => {
      const n = norm(cmd);
      if (!/\bgit\b.*\bpush\b/.test(n)) return false;
      if (/--force-with-lease\b/.test(n)) return false;
      return /--force\b/.test(n) || /\s-f\b/.test(n) || /\s-\w*f\b/.test(n);
    },
    reason:
      "Blocked: `git push --force` / `-f` rewrites remote history and can destroy work that is not in your local clone. Use `git push --force-with-lease`, which aborts if the remote has moved.",
  },

  // git worktree remove --force / -f.
  // Real incident class: this command has deleted a worktree's .git plus
  // hundreds of working files when node_modules was present.
  {
    test: (cmd) => {
      const n = norm(cmd);
      if (!/\bgit\b.*\bworktree\b.*\bremove\b/.test(n)) return false;
      return /--force\b/.test(n) || /\s-f\b/.test(n);
    },
    reason:
      "Blocked: `git worktree remove --force` has, in practice, deleted a worktree's `.git` plus its entire working tree — especially on worktrees containing node_modules. Instead: `git worktree prune`, then delete the directory manually.",
  },

  // curl/wget piped into a shell.
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
      "Blocked: piping a network download straight into a shell (`curl ... | bash`, `wget ... | sh`, `... | bash -c`) executes unreviewed remote code. Download to a file, inspect it, then run it deliberately.",
  },

  // Printing a dotenv file.
  // .env.example / .sample / .template are explicitly ALLOWED.
  {
    test: (cmd) => {
      const n = norm(cmd);
      const reads = /\b(cat|type|get-content|gc|bat|less|more|head|tail)\b/.test(n);
      if (!reads) return false;
      return (
        /(^|[\s"'=/\\])\.env(\.[a-z]+)?\b/.test(n) &&
        !/\.env(\.[a-z]+)?\.(example|sample|template)\b/.test(n) &&
        !/\.env\.example\b/.test(n)
      );
    },
    reason:
      "Blocked: printing a `.env` / `.env.local` file dumps live secrets into the transcript. Read `.env.example` for the variable names, or reference specific values another way. (`.env.example` is allowed.)",
  },

  // Echoing a secret-shaped env var.
  // CRITICAL CARVE-OUT: VITE_-prefixed vars are public-by-design (they ship in
  // the client bundle) and are never blocked.
  {
    test: (cmd) => {
      const n = norm(cmd);
      const prints =
        /\b(echo|printenv|print-env|printf|write-output|write-host)\b/.test(n) ||
        /\bset\b\s*$/.test(n) ||
        /\benv\b\s*$/.test(n);
      if (!prints) return false;
      const secretName =
        /(?<!vite_)(service_role(_key)?|_service_role|sb_secret|stripe_secret|stripe_sk|sk_live|sk_test|secret_key|private_key|access_token|auth_token|password|client_secret)/;
      return secretName.test(n);
    },
    reason:
      "Blocked: this command would print a secret env var (a secret API key, private key, auth token, password) into the transcript. `VITE_`-prefixed vars are public-by-design and are NOT blocked — use those if you need a client-side value.",
  },

  // chmod -R 777.
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

  // git reset --hard.
  {
    test: (cmd) => {
      const n = norm(cmd);
      return /\bgit\b\s+reset\b.*--hard\b/.test(n);
    },
    reason:
      "Blocked: `git reset --hard` permanently discards uncommitted changes. Use `git stash` (recoverable) — stash, verify, then drop the stash if you really meant to throw the work away.",
  },
];

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
    return allow(); // unparseable stdin -> fail OPEN. Never block on our own bug.
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
