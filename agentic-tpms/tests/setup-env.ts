import { loadDotEnv } from "@/server/env";

/**
 * `npm test` reads the project's env file itself, so a contributor does not
 * have to export it into the shell first. Values already in the environment
 * win (process.loadEnvFile never overrides), so `TEST_DATABASE_URL=… npm test`
 * still points a run at a different database.
 */
loadDotEnv();
