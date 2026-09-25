import { readFileSync } from "node:fs";
import path from "node:path";

/** Reads a realistic platform payload from tests/fixtures/payloads. A fresh copy each call, so tests can mutate it. */
export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/payloads", name), "utf8")) as T;
}
