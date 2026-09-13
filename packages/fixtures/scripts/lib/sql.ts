/**
 * SQL emission helpers for `emit-seed.ts`.
 *
 * Everything here exists to make the emitted seed satisfy the three rules in
 * `supabase/seeds/README.md`: idempotent, literal, and readable by a human who
 * is reviewing a diff rather than running it.
 *
 * The idempotence rule is the one with teeth. A plain `ON CONFLICT DO UPDATE`
 * re-runs "successfully" while touching every row, which bumps `updated_at`
 * through `app.set_updated_at()` and makes "a second run changes nothing"
 * false. Every statement this module emits therefore carries a
 * `WHERE (target...) IS DISTINCT FROM (EXCLUDED...)` guard, so the second run
 * of an unchanged seed performs zero updates and the pin can assert it.
 */

/** A pre-formatted SQL fragment that must not be quoted again. */
export interface RawSql {
  readonly __raw: string;
}

export const raw = (sql: string): RawSql => ({ __raw: sql });

const isRaw = (value: unknown): value is RawSql =>
  typeof value === "object" && value !== null && "__raw" in value;

/** Single-quote a string for SQL, doubling embedded quotes. */
export const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * A SQL literal for a JavaScript value.
 *
 * Numbers are emitted verbatim so integer minor units stay integers; there is
 * no float formatting anywhere in the seed. `undefined` and `null` are the same
 * thing here — a fixture that omits an optional field means SQL NULL.
 */
export const lit = (value: unknown): string => {
  if (isRaw(value)) return value.__raw;
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite number in seed: ${value}`);
    return String(value);
  }
  if (typeof value === "string") return quote(value);
  if (value instanceof Date) return quote(value.toISOString());
  throw new Error(`no SQL literal for ${typeof value}: ${JSON.stringify(value)}`);
};

/** `'{...}'::jsonb`, or NULL. jsonb columns in this schema are never `'null'`. */
export const j = (value: unknown): RawSql =>
  value === null || value === undefined
    ? raw("NULL")
    : raw(`${quote(JSON.stringify(value))}::jsonb`);

/** A typed Postgres array literal. Empty arrays still carry their type. */
export const arr = (values: readonly unknown[] | null | undefined, type = "text"): RawSql => {
  if (values === null || values === undefined) return raw("NULL");
  if (values.length === 0) return raw(`'{}'::${type}[]`);
  return raw(`ARRAY[${values.map((v) => lit(v)).join(", ")}]::${type}[]`);
};

/** An explicit cast, for the few places a bare literal is ambiguous. */
export const cast = (value: unknown, type: string): RawSql => raw(`${lit(value)}::${type}`);

export type Row = Record<string, unknown>;

export interface UpsertSpec {
  /** Schema-qualified table, e.g. `core.organisations`. */
  table: string;
  /** The conflict target columns — a unique index this table actually has. */
  conflict: readonly string[];
  rows: readonly Row[];
  /**
   * Columns written on INSERT but never on UPDATE, and excluded from the
   * change comparison. `ref` and `created_at` belong here: both are frozen by
   * `app.enforce_immutable_columns()` and re-asserting them is noise.
   */
  frozen?: readonly string[];
  /** A comment emitted above the statement. */
  note?: string;
}

/** Rows per INSERT. Keeps individual statements reviewable in a diff. */
const CHUNK = 50;

/**
 * An idempotent multi-row upsert.
 *
 * Every row in `rows` must carry the same key set; a fixture that omits a
 * column on some rows is a bug in the caller, not something to paper over with
 * per-row column lists, because the column list is what the reviewer reads.
 */
export const upsert = (spec: UpsertSpec): string => {
  const { table, conflict, rows, frozen = [], note } = spec;
  if (rows.length === 0) return "";

  const columns = Object.keys(rows[0]!);
  for (const row of rows) {
    const keys = Object.keys(row);
    if (keys.length !== columns.length || keys.some((k, i) => k !== columns[i])) {
      throw new Error(
        `${table}: inconsistent column set.\n  first: ${columns.join(",")}\n  other: ${keys.join(",")}`,
      );
    }
  }

  const updatable = columns.filter((c) => !conflict.includes(c) && !frozen.includes(c));
  const alias = "target";
  const out: string[] = [];

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk
      .map((row) => `  (${columns.map((c) => lit(row[c])).join(", ")})`)
      .join(",\n");

    const head =
      (note && i === 0 ? `-- ${note}\n` : "") +
      `INSERT INTO ${table} AS ${alias}\n  (${columns.join(", ")})\nVALUES\n${values}\n`;

    if (updatable.length === 0) {
      out.push(`${head}ON CONFLICT (${conflict.join(", ")}) DO NOTHING;`);
      continue;
    }

    const setList = updatable.map((c) => `  ${c} = EXCLUDED.${c}`).join(",\n");
    const lhs = updatable.map((c) => `${alias}.${c}`).join(", ");
    const rhs = updatable.map((c) => `EXCLUDED.${c}`).join(", ");
    const guard =
      updatable.length === 1
        ? `WHERE ${lhs} IS DISTINCT FROM ${rhs};`
        : `WHERE (${lhs})\n   IS DISTINCT FROM (${rhs});`;

    out.push(`${head}ON CONFLICT (${conflict.join(", ")}) DO UPDATE SET\n${setList}\n${guard}`);
  }

  return out.join("\n\n");
};

/** A `-- ───` section banner, so the emitted file reads like the hand-written packs. */
export const banner = (title: string): string => {
  const line = "─".repeat(Math.max(4, 72 - title.length));
  return `-- ${title} ${line}`;
};

/** Statement blocks joined with one blank line, empties dropped. */
export const block = (...parts: (string | undefined | null)[]): string =>
  parts.filter((p): p is string => Boolean(p && p.trim())).join("\n\n");
