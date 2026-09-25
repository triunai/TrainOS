import { loadDotEnv } from "../src/server/env";

loadDotEnv();

/**
 * Recomputes the audit ledger's SHA-256 chain from genesis. Exit code 0 when
 * intact, 2 when broken — suitable for a nightly cron that pages someone.
 */
const { verifyChain } = await import("../src/server/audit/ledger");
const { closePool } = await import("../src/server/db/pool");
const verdict = await verifyChain();
await closePool();
if (verdict.ok) {
  console.log(`audit chain intact: ${verdict.rows} rows, head ${verdict.head}`);
} else {
  console.error(`AUDIT CHAIN BROKEN at seq ${verdict.firstBrokenSeq} (${verdict.rows} rows checked)`);
  process.exit(2);
}
