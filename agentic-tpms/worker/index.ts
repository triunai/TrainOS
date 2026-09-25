import { loadDotEnv } from "../src/server/env";

loadDotEnv();

const { runForever, drain, assertHandlersComplete } = await import("../src/server/queue/worker");
const { allHandlers } = await import("./handlers");
const { closePool } = await import("../src/server/db/pool");

assertHandlersComplete(allHandlers);

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => controller.abort());
}

if (process.argv.includes("--drain")) {
  const counts = await drain({ handlers: allHandlers, log: console.log });
  console.log(JSON.stringify(counts));
} else {
  await runForever({ handlers: allHandlers, signal: controller.signal, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) });
}
await closePool();
