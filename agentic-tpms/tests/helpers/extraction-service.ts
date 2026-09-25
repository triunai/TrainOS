import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resetEnvCache } from "@/server/env";

/**
 * Runs the real extraction service (services/paddleocr) from its venv for
 * the integration tests, with the dev synthesiser enabled. A healthy dev
 * instance already listening on the port is reused (and left running).
 *
 *   python3.11 -m venv services/paddleocr/.venv
 *   services/paddleocr/.venv/bin/pip install -r services/paddleocr/requirements.txt
 */
export const SERVICE_DIR = path.resolve("services/paddleocr");
export const VENV_PYTHON = path.join(SERVICE_DIR, ".venv", "bin", "python");
export const SERVICE_PORT = Number(process.env.TPMS_TEST_OCR_PORT ?? 8866);
export const SERVICE_URL = `http://127.0.0.1:${SERVICE_PORT}`;
export const hasServiceVenv = existsSync(VENV_PYTHON);
export const MISSING_VENV_MESSAGE =
  `extraction service venv not found at ${VENV_PYTHON}; create it with ` +
  "`python3.11 -m venv services/paddleocr/.venv && services/paddleocr/.venv/bin/pip install -r services/paddleocr/requirements.txt`";

let child: ChildProcess | null = null;
let output = "";

async function health(): Promise<{ dev?: boolean } | null> {
  try {
    const res = await fetch(`${SERVICE_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? ((await res.json()) as { dev?: boolean }) : null;
  } catch {
    return null;
  }
}

/** Points PADDLEOCR_URL at the test instance (call after useTestDatabase, which reloads .env). */
export function pointAtTestService(): void {
  process.env.PADDLEOCR_URL = SERVICE_URL;
  resetEnvCache();
}

export async function startExtractionService(): Promise<void> {
  pointAtTestService();
  const existing = await health();
  if (existing) {
    if (!existing.dev) throw new Error(`An extraction service without TPMS_OCR_DEV=1 is already on port ${SERVICE_PORT}`);
    return;
  }
  child = spawn(VENV_PYTHON, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(SERVICE_PORT), "--log-level", "warning"], {
    cwd: SERVICE_DIR,
    env: { ...process.env, TPMS_OCR_DEV: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`extraction service exited (${child.exitCode}):\n${output}`);
    if (await health()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`extraction service did not become healthy on ${SERVICE_URL}:\n${output}`);
}

export async function stopExtractionService(): Promise<void> {
  const running = child;
  child = null;
  if (!running || running.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    running.once("exit", () => resolve());
    running.kill("SIGTERM");
    setTimeout(() => {
      running.kill("SIGKILL");
      resolve();
    }, 5000).unref();
  });
}
