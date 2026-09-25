import { loadDotEnv } from "../src/server/env";

loadDotEnv();

/**
 * npm run golden-path [-- --stop <step>] [--ocr off] [--start-in <days>]
 *
 * Drives one package from an inbound web-form lead to SETTLED_CLOSED against
 * DATABASE_URL, using only the domain services and the worker's task
 * handlers, and prints the step table, the audit-chain verdict, the task
 * queue totals, the certificate verification URLs and the package's cockpit
 * URL. Run it on a fresh database (`npm run db:reset`): a second run on the
 * same dates finds the trainer already held and says so.
 */
const { GOLDEN_SCENARIO } = await import("../src/server/demo/scenarios");
const { GOLDEN_STEPS, runGoldenPath } = await import("../src/server/demo/goldenPath");
const { formatStepRow, formatStepTable, formatTaskTotals } = await import("../src/server/demo/report");
const { taskTotals } = await import("../src/server/demo/tasks");
const { verifyChain } = await import("../src/server/audit/ledger");
const { closePool } = await import("../src/server/db/pool");
const { env } = await import("../src/server/env");
const { todayMY } = await import("../src/lib/dates");

type Step = (typeof GOLDEN_STEPS)[number];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const stop = (arg("stop") ?? "sweep") as Step;
if (!GOLDEN_STEPS.includes(stop)) {
  console.error(`--stop must be one of: ${GOLDEN_STEPS.join(", ")}`);
  process.exit(2);
}
const startIn = arg("start-in");
const scenario = startIn ? { ...GOLDEN_SCENARIO, startInDays: Number(startIn) } : GOLDEN_SCENARIO;
const ocr = arg("ocr") === "off" ? ("off" as const) : ("auto" as const);

const redacted = env().DATABASE_URL.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");
console.log(`Golden path · ${redacted} · today ${todayMY()} (MYT) · training starts today + ${scenario.startInDays} · extraction service ${env().PADDLEOCR_URL}${ocr === "off" ? " (disabled)" : ""}`);
console.log("");
console.log(formatStepTable([]).split("\n").slice(0, 2).join("\n"));

let exitCode = 0;
try {
  const result = await runGoldenPath({
    scenario,
    stopAfter: stop,
    ocr,
    onStep: (record) => console.log([...formatStepRow(record), ""].join("\n")),
  });

  console.log("─".repeat(110));
  console.log(`Package ${result.packageCode}: operational ${result.final.operational}, financial ${result.final.financial}`);
  console.log(`Track B (OCR): ${result.ocr.available ? "ran" : "skipped"} — ${result.ocr.detail}`);
  const ff = result.steps.flatMap((s) => s.fastForwards.map((f) => `  [${s.step}] ${f}`));
  console.log(`Fast-forwarded (${ff.length}):`);
  for (const line of ff) console.log(line);

  const chain = await verifyChain();
  console.log("");
  console.log(
    chain.ok
      ? `Audit chain (tpms.audit_verify_chain()): INTACT — ${chain.rows} rows recomputed from genesis, head ${chain.head}`
      : `Audit chain (tpms.audit_verify_chain()): BROKEN at seq ${chain.firstBrokenSeq} (${chain.rows} rows)`,
  );
  if (!chain.ok) exitCode = 2;

  console.log("");
  const all = await taskTotals();
  const mine = result.packageId ? await taskTotals(result.packageId) : null;
  for (const line of formatTaskTotals("Task queue (all)", all)) console.log(line);
  if (mine) for (const line of formatTaskTotals(`Task queue (${result.packageCode})`, mine)) console.log(line);
  if (all.deadLettered.length > 0) exitCode = exitCode || 3;

  if (result.certificates.length) {
    console.log("");
    console.log(`Certificates (${result.certificates.length}, public verification):`);
    for (const c of result.certificates) console.log(`  ${c.serial}  ${c.status}  ${c.url}`);
  }
  if (result.operationsUrl) {
    console.log("");
    console.log(`Cockpit: ${result.operationsUrl}`);
  }
} catch (error) {
  console.error("");
  console.error(`GOLDEN PATH FAILED: ${error instanceof Error ? error.message : String(error)}`);
  const details = (error as { details?: Record<string, unknown> }).details;
  if (details && Object.keys(details).length) console.error(JSON.stringify(details, null, 2).slice(0, 4000));
  exitCode = 1;
} finally {
  await closePool();
}
process.exit(exitCode);
