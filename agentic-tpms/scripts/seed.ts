import { loadDotEnv } from "../src/server/env";

loadDotEnv();

/**
 * npm run db:seed [-- --reset] [--ocr off] [--verbose]
 *
 * Reference data through each lane's own seed function, then a believable
 * demo portfolio: 13 packages across both state machines and 3 open leads,
 * every one built by driving the golden path's steps up to a stopping point
 * (see src/server/demo/portfolio.ts). Idempotent enough: reference seeds
 * never duplicate, and the portfolio is only built into a database that has
 * no packages yet. `--reset` first drops and re-migrates the database
 * (scripts/migrate.ts reset) for a clean demo.
 *
 * Stop `npm run worker` against the same database while seeding: the seed runs
 * each package's due tasks itself, and a live worker would race it for them.
 * The extraction service (PADDLEOCR_URL, dev mode) is optional; without it
 * Track B scans are skipped and the digital Form T3 is used instead.
 */
const reset = process.argv.includes("--reset");
const verbose = process.argv.includes("--verbose");
const ocr = process.argv.includes("--ocr") && process.argv[process.argv.indexOf("--ocr") + 1] === "off" ? ("off" as const) : ("auto" as const);

const { env } = await import("../src/server/env");
const { resetDatabase } = await import("../src/server/db/migrator");
const { closePool } = await import("../src/server/db/pool");
const { db, rows } = await import("../src/server/db/client");
const { sql } = await import("drizzle-orm");
const { verifyChain } = await import("../src/server/audit/ledger");
const { buildDemoPortfolio, DEMO_PORTFOLIO } = await import("../src/server/demo/portfolio");
const { ensureReferenceData } = await import("../src/server/demo/goldenPath");
const { formatStepRow, formatTaskTotals } = await import("../src/server/demo/report");
const { taskTotals } = await import("../src/server/demo/tasks");
const { todayMY } = await import("../src/lib/dates");

const url = env().DATABASE_URL;
const redacted = url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");
let exitCode = 0;

try {
  if (reset) {
    console.log(`Resetting ${redacted} (drop schema tpms, re-run every migration)…`);
    await resetDatabase(url, () => undefined);
  }
  const [{ n: packages }] = await rows<{ n: number }>(db(), sql`select count(*)::int as n from tpms.training_packages`);
  if (packages > 0) {
    await ensureReferenceData();
    console.log(`Reference data checked. ${packages} package(s) already exist in ${redacted}: the demo portfolio is only built into an empty database.`);
    console.log("Run `npm run db:seed -- --reset` for a clean demo.");
  } else {
    console.log(`Seeding ${redacted} · today ${todayMY()} (MYT) · extraction service ${env().PADDLEOCR_URL}${ocr === "off" ? " (disabled)" : ""}`);
    const started = Date.now();
    const built = await buildDemoPortfolio({
      ocr,
      onEntry: (entry, i) => console.log(`\n[${i + 1}/${DEMO_PORTFOLIO.length}] ${entry.label} — ${entry.scenario.company.formName} (stop after ${entry.stop})`),
      onStep: (_entry, record) => {
        if (verbose) console.log(formatStepRow(record).join("\n"));
        for (const f of record.fastForwards) console.log(`   ${f}`);
      },
    });
    console.log(`\nBuilt ${built.length} entries in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    const ocrState = built.find((b) => b.result.ocr.detail !== "not probed")?.result.ocr;
    if (ocrState) console.log(`Track B (OCR): ${ocrState.available ? "ran" : "skipped"} — ${ocrState.detail}`);
  }

  const board = await rows<{ package_code: string; company_name: string; title: string; operational_stage: string; financial_stage: string; start_date: string | null }>(
    db(),
    sql`select p.package_code, c.company_name, p.title, p.operational_stage, p.financial_stage, p.start_date
          from tpms.training_packages p join tpms.corporate_clients c on c.id = p.client_id
         order by p.package_code`,
  );
  console.log("\nStage distribution (operational / financial):");
  for (const p of board) {
    console.log(`  ${p.package_code}  ${p.operational_stage.padEnd(20)} ${p.financial_stage.padEnd(16)} ${String(p.start_date ?? "").padEnd(10)}  ${p.company_name} — ${p.title}`);
  }
  const leads = await rows<{ status: string; company_name: string }>(
    db(),
    sql`select status, company_name from tpms.lead_records where status <> 'CONVERTED' order by created_at`,
  );
  if (leads.length) {
    console.log("Open leads:");
    for (const l of leads) console.log(`  ${l.status.padEnd(20)} ${l.company_name}`);
  }
  const pending = await rows<{ gate: string; n: number }>(db(), sql`select gate, count(*)::int as n from tpms.decisions where status = 'PENDING' group by gate order by gate`);
  console.log(`Pending decisions: ${pending.map((d) => `${d.gate} ${d.n}`).join(", ") || "none"}`);

  const chain = await verifyChain();
  console.log(
    chain.ok ? `\nAudit chain: INTACT — ${chain.rows} rows, head ${chain.head}` : `\nAudit chain: BROKEN at seq ${chain.firstBrokenSeq} (${chain.rows} rows)`,
  );
  if (!chain.ok) exitCode = 2;
  for (const line of formatTaskTotals("Task queue", await taskTotals())) console.log(line);
} catch (error) {
  console.error(`\nSEED FAILED: ${error instanceof Error ? error.message : String(error)}`);
  const details = (error as { details?: Record<string, unknown> }).details;
  if (details && Object.keys(details).length) console.error(JSON.stringify(details, null, 2).slice(0, 4000));
  exitCode = 1;
} finally {
  await closePool();
}
process.exit(exitCode);
