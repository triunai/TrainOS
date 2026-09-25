import { loadDotEnv, resetEnvCache } from "@/server/env";
import { closePool } from "@/server/db/pool";
import { resetDbHandle } from "@/server/db/client";
import { resetDatabase } from "@/server/db/migrator";

/**
 * Points the app at TEST_DATABASE_URL and rebuilds it from the migrations.
 * Integration tests run against real Postgres — the guards under test live in
 * triggers, and a mock would test nothing.
 */
export async function useTestDatabase(): Promise<string> {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  if (url === process.env.DATABASE_URL_ORIGINAL) throw new Error("Refusing to reset the primary database");
  process.env.DATABASE_URL_ORIGINAL ??= process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  process.env.TPMS_STORAGE_DIR = process.env.TPMS_TEST_STORAGE_DIR ?? "./.scratch/test-storage";
  resetEnvCache();
  await closePool();
  resetDbHandle();
  await resetDatabase(url, () => undefined);
  return url;
}

export async function releaseTestDatabase(): Promise<void> {
  await closePool();
  resetDbHandle();
}

/** The Postgres message under Drizzle's "Failed query" wrapper. */
export function pgMessage(error: unknown): string {
  let current: unknown = error;
  const parts: string[] = [];
  while (current instanceof Error) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" <- ");
}

export async function expectRefusal(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!error) throw new Error(`Expected refusal matching ${pattern}, but the statement succeeded`);
  const message = pgMessage(error);
  if (!pattern.test(message)) throw new Error(`Expected refusal matching ${pattern}, got: ${message}`);
}
