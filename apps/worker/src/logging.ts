/**
 * Structured logging with a redaction pass that is not optional.
 *
 * The worker holds per-tenant provider keys in memory. A log line is the
 * easiest way for one to escape, so redaction happens on the way out of this
 * module rather than at each call site, where it would eventually be
 * forgotten.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values never appear in a log line, whatever they contain. */
const SECRET_KEYS = /^(.*_)?(api_?key|secret|token|password|authorization|service_role_key)$/i;

/** Anything shaped like a provider key, wherever it turns up in a string. */
const SECRET_VALUE =
  /(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+)?)/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[redacted]");
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? "[redacted]" : redact(entry, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  /** Injected so the suite can read what was logged without touching stdout. */
  sink?: (line: string) => void;
  now?: () => Date;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? "info";
  const sink = opts.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = opts.now ?? (() => new Date());
  const bindings = opts.bindings ?? {};

  function emit(at: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[at] < LEVEL_ORDER[level]) return;
    sink(
      JSON.stringify({
        at: now().toISOString(),
        level: at,
        msg: message,
        ...(redact(bindings) as Record<string, unknown>),
        ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
      }),
    );
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (extra) => createLogger({ ...opts, bindings: { ...bindings, ...extra } }),
  };
}
