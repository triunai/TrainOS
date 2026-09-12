/**
 * §1 · The list grammar: filters, sort, cursor pagination and saved views.
 *
 * `filter[field][op]=value` with `eq · in · gte · lte · contains · between`,
 * `sort=-receivedAt`, `page[size]` and `page[cursor]`, and `view=…` whose
 * filters merge underneath the request's — request filters win on the same
 * field, which is the rule §1 states and the only place the precedence lives.
 */

import type {
  AppliedFilter,
  FilterClause,
  ListResponse,
  Money,
  PageRequest,
  SavedView,
} from "@trainos/contract";

/** Reads a dotted path out of a record, e.g. `classification.needsHumanReview`. */
export const readPath = (source: unknown, path: string): unknown => {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const isMoney = (value: unknown): value is Money =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Money).amount === "number" &&
  typeof (value as Money).currency === "string";

/** Money compares on its minor units; everything else on its natural order. */
const comparable = (value: unknown): number | string | undefined => {
  if (isMoney(value)) return value.amount;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return undefined;
};

/**
 * Ordered comparison. Returns `null` when either side has no natural order —
 * an absent value must never satisfy `gte`, `lte` or `between`, which is the
 * difference between "no budget stated" and "a budget of zero".
 */
const compare = (left: unknown, right: unknown): number | null => {
  const a = comparable(left);
  const b = comparable(right);
  if (a === undefined || b === undefined) return null;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
};

/** Sort order only: an absent value sorts last rather than throwing the sort. */
const compareForSort = (left: unknown, right: unknown): number => compare(left, right) ?? 0;

const asList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(",");
  return [value];
};

const equals = (left: unknown, right: unknown): boolean => {
  if (isMoney(left) && isMoney(right)) return left.amount === right.amount && left.currency === right.currency;
  if (isMoney(left) && typeof right === "number") return left.amount === right;
  return left === right;
};

/** §1 evaluates one clause against one record. */
export const matchesClause = (record: unknown, clause: FilterClause): boolean => {
  const actual = readPath(record, clause.field);
  switch (clause.op) {
    case "eq":
      return equals(actual, clause.value);
    case "in":
      return asList(clause.value).some((candidate) => equals(actual, candidate));
    case "gte": {
      const result = compare(actual, clause.value);
      return result !== null && result >= 0;
    }
    case "lte": {
      const result = compare(actual, clause.value);
      return result !== null && result <= 0;
    }
    case "contains": {
      if (Array.isArray(actual)) return actual.some((item) => equals(item, clause.value));
      return String(actual ?? "")
        .toLowerCase()
        .includes(String(clause.value).toLowerCase());
    }
    case "between": {
      const bounds = asList(clause.value);
      const [low, high] = bounds;
      if (low === undefined || high === undefined) return false;
      const lower = compare(actual, low);
      const upper = compare(actual, high);
      return lower !== null && upper !== null && lower >= 0 && upper <= 0;
    }
    default:
      return false;
  }
};

/**
 * §1 merges a saved view's filters underneath the request's.
 *
 * Returns the applied set in the shape `appliedFilters[]` carries, so a screen
 * can render exactly which clause came from where.
 */
export const mergeFilters = (
  requestFilters: FilterClause[] = [],
  view?: SavedView,
): AppliedFilter[] => {
  const applied: AppliedFilter[] = requestFilters.map((clause) => ({ ...clause, source: "REQUEST" }));
  if (!view) return applied;
  const overridden = new Set(requestFilters.map((clause) => clause.field));
  for (const clause of view.filters) {
    if (overridden.has(clause.field)) continue;
    applied.push({ ...clause, source: "VIEW" });
  }
  return applied;
};

const DEFAULT_PAGE_SIZE = 25;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 over ASCII, written out rather than taken from a runtime global:
 * the package targets ES2022 with no DOM and no Node types, so neither `btoa`
 * nor `Buffer` is in scope.
 */
const symbol = (index: number): string => BASE64_ALPHABET[index] ?? "";

const encodeBase64 = (input: string): string => {
  let output = "";
  for (let index = 0; index < input.length; index += 3) {
    const a = input.charCodeAt(index);
    const b = index + 1 < input.length ? input.charCodeAt(index + 1) : Number.NaN;
    const c = index + 2 < input.length ? input.charCodeAt(index + 2) : Number.NaN;
    output += symbol(a >> 2);
    output += symbol(((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4));
    output += Number.isNaN(b) ? "=" : symbol(((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6));
    output += Number.isNaN(c) ? "=" : symbol(c & 63);
  }
  return output;
};

const decodeBase64 = (input: string): string => {
  const clean = input.replace(/=+$/, "");
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const character of clean) {
    const value = BASE64_ALPHABET.indexOf(character);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
};

/** `page[cursor]` is opaque to callers; here it encodes an offset. */
const encodeCursor = (offset: number): string => encodeBase64(JSON.stringify({ offset }));

const decodeCursor = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  try {
    const parsed: unknown = JSON.parse(decodeBase64(cursor));
    const offset = (parsed as { offset?: unknown }).offset;
    return typeof offset === "number" && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
};

/** §1 `sort=field` or `sort=-field` for descending. */
export const applySort = <T>(rows: T[], sort: string | undefined): T[] => {
  if (!sort) return rows;
  const descending = sort.startsWith("-");
  const field = descending ? sort.slice(1) : sort;
  return [...rows].sort((left, right) => {
    const result = compareForSort(readPath(left, field), readPath(right, field));
    return descending ? -result : result;
  });
};

/**
 * §1 the whole list pipeline: merge the view, filter, sort, then page.
 *
 * `page.total` is the count **after** filtering, which is what a screen needs
 * to render "18 of 18" honestly.
 */
export const paginate = <T>(rows: T[], request: PageRequest = {}, view?: SavedView): ListResponse<T> => {
  const applied = mergeFilters(request.filter, view);
  const filtered = rows.filter((row) => applied.every((clause) => matchesClause(row, clause)));
  const sorted = applySort(filtered, request.sort);
  const size = request.page?.size ?? DEFAULT_PAGE_SIZE;
  const offset = decodeCursor(request.page?.cursor);
  const page = sorted.slice(offset, offset + size);
  const nextOffset = offset + page.length;
  return {
    data: page,
    page: { next: nextOffset < sorted.length ? encodeCursor(nextOffset) : null, total: sorted.length },
    appliedFilters: applied,
  };
};
