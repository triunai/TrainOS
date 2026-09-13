/**
 * Environment in, one frozen object out.
 *
 * Parsed once at boot and never read again from `process.env`, so a
 * misconfiguration is a refusal to start rather than a surprise forty minutes
 * into a shift.
 */

import { hostname } from "node:os";
import { MAX_LEASE_SECONDS } from "./jobs/rpc";
import { DEFAULT_BYOK_RPC } from "./keys";
import type { LogLevel } from "./logging";

export interface WorkerConfig {
  /** Identity `claim_jobs` records in `claimed_by` and every later call checks. */
  workerId: string;
  databaseUrl: string;
  databaseRole: string;
  poolMax: number;
  /** Restrict this worker to some job types, or claim every type. */
  jobTypes: string[] | null;
  /** Restrict to one tenant, or claim across all of them. */
  tenantId: string | null;
  batchSize: number;
  concurrency: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
  idleSleepMs: number;
  errorSleepMs: number;
  /** Minimum gap between dispatches, for provider rate caps. Showroom's pacing. */
  pacingMs: number;
  /** How often the worker sweeps expired leases. 0 disables it. */
  reapIntervalMs: number;
  /** Wall clock one agent-run slice may spend before it checkpoints and yields. */
  sliceWallClockMs: number;
  byokRpc: string;
  byokTtlMs: number;
  port: number;
  logLevel: LogLevel;
  /** Terminal grace period: finish in-flight jobs, then exit. */
  shutdownGraceMs: number;
  email: { apiKey: string | null; from: string | null; endpoint: string };
  whatsapp: { enabled: boolean };
}

export type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): WorkerConfig {
  const databaseUrl = first(env, "WORKER_DATABASE_URL", "SUPABASE_DB_URL", "DATABASE_URL");
  if (!databaseUrl) {
    throw new Error(
      "no database URL: set WORKER_DATABASE_URL (or SUPABASE_DB_URL). The worker connects " +
        "to Postgres directly because migration 012's worker surface lives in the `app` " +
        "schema, which PostgREST does not expose.",
    );
  }
  assertNotAnonKey(env);

  const leaseSeconds = int(env.WORKER_LEASE_SECONDS, 300, 1, MAX_LEASE_SECONDS);
  // Comfortably inside the lease. A heartbeat that fires at the lease
  // boundary races the reaper and loses about half the time (S4).
  const heartbeatSeconds = int(
    env.WORKER_HEARTBEAT_SECONDS,
    Math.max(15, Math.floor(leaseSeconds / 3)),
    5,
    MAX_LEASE_SECONDS,
  );
  // T16: the clamp above bounds WORKER_HEARTBEAT_SECONDS against the global
  // MAX_LEASE_SECONDS, not the configured lease, so a 60s-lease/300s-heartbeat
  // configuration was silently accepted and did the work S4 warns about — and
  // the default formula bypasses that clamp entirely for a tiny lease (e.g.
  // leaseSeconds=10 still defaults to 15). This is the runtime invariant that
  // actually matters: whatever produced the two numbers, the heartbeat must
  // be strictly inside the lease, or a long job's lease can expire while it
  // is still heartbeating.
  if (heartbeatSeconds >= leaseSeconds) {
    throw new Error(
      `WORKER_HEARTBEAT_SECONDS (${heartbeatSeconds}) must be strictly less than ` +
        `WORKER_LEASE_SECONDS (${leaseSeconds}): a heartbeat that reaches or exceeds ` +
        "the lease can let it expire while the job is still being worked",
    );
  }
  const config: WorkerConfig = {
    workerId: env.WORKER_ID?.trim() || defaultWorkerId(),
    databaseUrl,
    databaseRole: env.WORKER_DB_ROLE?.trim() || "service_role",
    poolMax: int(env.WORKER_DB_POOL_MAX, 4, 1, 64),
    jobTypes: list(env.WORKER_JOB_TYPES),
    tenantId: env.WORKER_TENANT_ID?.trim() || null,
    batchSize: int(env.WORKER_BATCH_SIZE, 5, 1, 1000),
    concurrency: int(env.WORKER_CONCURRENCY, 4, 1, 64),
    leaseSeconds,
    heartbeatSeconds,
    idleSleepMs: int(env.WORKER_IDLE_SLEEP_MS, 2_000, 100, 300_000),
    errorSleepMs: int(env.WORKER_ERROR_SLEEP_MS, 5_000, 100, 300_000),
    pacingMs: int(env.WORKER_PACING_MS, 0, 0, 60_000),
    reapIntervalMs: int(env.WORKER_REAP_INTERVAL_MS, 60_000, 0, 3_600_000),
    // Under the lease by a margin, because the yield still has to write a
    // checkpoint and report completion after the budget is found to be spent.
    sliceWallClockMs: int(
      env.WORKER_SLICE_WALL_CLOCK_MS,
      Math.max(10_000, (leaseSeconds - 30) * 1_000),
      1_000,
      3_600_000,
    ),
    byokRpc: env.WORKER_BYOK_RPC?.trim() || DEFAULT_BYOK_RPC,
    byokTtlMs: int(env.WORKER_BYOK_TTL_MS, 60_000, 1_000, 3_600_000),
    port: int(env.PORT, 8080, 1, 65_535),
    logLevel: logLevel(env.LOG_LEVEL),
    shutdownGraceMs: int(env.WORKER_SHUTDOWN_GRACE_MS, 30_000, 0, 600_000),
    email: {
      apiKey: env.RESEND_API_KEY?.trim() || null,
      from: env.WORKER_EMAIL_FROM?.trim() || null,
      endpoint: env.WORKER_EMAIL_ENDPOINT?.trim() || "https://api.resend.com/emails",
    },
    whatsapp: { enabled: flag(env.WORKER_WHATSAPP_ENABLED, false) },
  };
  return Object.freeze(config);
}

/**
 * `claimed_by` has to survive a restart being a *different* worker: two
 * processes sharing an id would each pass the other's ownership checks, and
 * `heartbeat_job`'s whole point (012 M-14) would be gone. Host plus pid plus
 * entropy is unique across a redeploy and still legible in a log line.
 */
export function defaultWorkerId(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `worker-${hostname()}-${process.pid}-${suffix}`;
}

/**
 * The anon key is a browser credential. It cannot execute anything 012 granted
 * and its presence here means someone copied the wrong variable, so the worker
 * says so at boot instead of failing every claim with a permission error.
 */
export function assertNotAnonKey(env: Env): void {
  const anon = env.SUPABASE_ANON_KEY?.trim();
  if (!anon) return;
  for (const name of [
    "WORKER_DATABASE_URL",
    "SUPABASE_DB_URL",
    "DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (env[name]?.includes(anon)) {
      throw new Error(`${name} carries SUPABASE_ANON_KEY; the worker never authenticates as anon`);
    }
  }
}

function first(env: Env, ...names: string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`expected an integer, got ${JSON.stringify(raw)}`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`expected an integer in ${min}..${max}, got ${parsed}`);
  }
  return parsed;
}

function list(raw: string | undefined): string[] | null {
  if (!raw || raw.trim() === "") return null;
  const values = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return values.length > 0 ? values : null;
}

function flag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function logLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? "info").trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  throw new Error(`LOG_LEVEL must be debug, info, warn or error, got ${JSON.stringify(raw)}`);
}
