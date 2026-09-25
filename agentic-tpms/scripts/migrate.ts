import { loadDotEnv } from "../src/server/env";
import { migrateDown, migrateUp, resetDatabase } from "../src/server/db/migrator";

loadDotEnv();

async function main() {
  const [command = "up", arg] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (command === "up") {
    const ran = await migrateUp(url);
    console.log(ran.length ? `${ran.length} migration(s) applied` : "database is up to date");
  } else if (command === "down") {
    await migrateDown(url, Number(arg ?? 1));
  } else if (command === "reset") {
    await resetDatabase(url);
  } else {
    throw new Error(`unknown command ${command} (up | down [n] | reset)`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
