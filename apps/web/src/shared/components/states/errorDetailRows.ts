import type { ApiError } from "@/shared/api/errors";

/**
 * Whether a failure's technical details are drawn on screen.
 *
 * On in development, and in any build with `VITE_SHOW_ERROR_DETAILS=true` —
 * which is how a tester running against a real database sees WHAT failed
 * without opening the console. Off in a production build by default, because
 * an operation name and a SQLSTATE mean nothing to the person the product is
 * for.
 *
 * Off under Vitest even though Vitest reports `DEV`: a suite that wants the
 * disclosure turns it on with `vi.stubEnv("VITE_SHOW_ERROR_DETAILS", "true")`,
 * and every other suite renders exactly what production renders.
 *
 * Read at call time, not at module load, so a stubbed env takes effect.
 */
export function errorDetailsEnabled(): boolean {
  const env = import.meta.env;
  if (env.VITE_SHOW_ERROR_DETAILS === "true") return true;
  return env.DEV === true && env.MODE !== "test";
}

/** One labelled line of the disclosure, and of the copied text. */
export interface ErrorDetailRow {
  label: string;
  value: string;
}

/**
 * The rows for an API failure.
 *
 * ONLY what the error object already carries about itself: the contract code,
 * the operation, the HTTP status, the database's own code, the message and the
 * time. Never a token, a header or a request body — `ApiError` holds none of
 * those, and this function reads nothing else, so there is nothing to leak.
 */
export function apiErrorRows(error: ApiError, at: string): ErrorDetailRow[] {
  const rows: (ErrorDetailRow | null)[] = [
    { label: "Code", value: error.code },
    error.operation === undefined ? null : { label: "Operation", value: error.operation },
    error.status === undefined ? null : { label: "HTTP status", value: String(error.status) },
    error.sourceCode === undefined ? null : { label: "Source code", value: error.sourceCode },
    { label: "Message", value: error.message },
    { label: "Time", value: at },
  ];
  return rows.filter((row): row is ErrorDetailRow => row !== null);
}

/**
 * The rows for a render crash. The stack is development-only: a production
 * stack is minified noise that also maps the bundle for whoever reads it.
 */
export function crashRows(error: unknown, at: string): ErrorDetailRow[] {
  const failure = error instanceof Error ? error : new Error(String(error));
  const rows: ErrorDetailRow[] = [
    { label: "Error", value: failure.name },
    { label: "Message", value: failure.message },
    { label: "Time", value: at },
  ];
  if (import.meta.env.DEV === true && failure.stack) {
    rows.push({ label: "Stack", value: failure.stack });
  }
  return rows;
}

/** Plain text for the clipboard, one `Label: value` per line. */
export function formatErrorDetails(rows: readonly ErrorDetailRow[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}
