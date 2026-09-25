import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Plain-SQL migration runner. Each forward file runs in its own transaction
 * together with its bookkeeping row, so a file is either fully applied or not
 * at all. The checksum of every applied file is stored and compared on each
 * run: editing a migration after it shipped is refused rather than ignored.
 */
const ROOT = path.resolve(process.cwd(), "db");

export interface MigrationFile {
  id: string;
  forward: string;
  rollback: string;
  checksum: string;
}

export function listMigrations(): MigrationFile[] {
  const dir = path.join(ROOT, "migrations");
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const id = file.replace(/\.sql$/, "");
      const forward = readFileSync(path.join(dir, file), "utf8");
      const rollbackPath = path.join(ROOT, "rollbacks", `${id}.down.sql`);
      let rollback: string;
      try {
        rollback = readFileSync(rollbackPath, "utf8");
      } catch {
        throw new Error(`Migration ${id} has no rollback at db/rollbacks/${id}.down.sql`);
      }
      return { id, forward, rollback, checksum: createHash("sha256").update(forward).digest("hex") };
    });
}

async function ensureBookkeeping(client: pg.PoolClient | pg.Client): Promise<void> {
  await client.query(`create schema if not exists tpms`);
  await client.query(`create table if not exists tpms.schema_migrations (
    id varchar(100) primary key,
    checksum char(64) not null,
    applied_at timestamptz not null default now()
  )`);
}

async function applied(client: pg.PoolClient | pg.Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ id: string; checksum: string }>(
    `select id, checksum from tpms.schema_migrations order by id`,
  );
  return new Map(rows.map((r) => [r.id, r.checksum]));
}

export async function migrateUp(connectionString: string, log = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await ensureBookkeeping(client);
    const done = await applied(client);
    const ran: string[] = [];
    for (const m of listMigrations()) {
      const stored = done.get(m.id);
      if (stored) {
        if (stored !== m.checksum) {
          throw new Error(
            `Migration ${m.id} was edited after it was applied (checksum drift). Write a new migration instead.`,
          );
        }
        continue;
      }
      await client.query("begin");
      try {
        await client.query(m.forward);
        await client.query(`insert into tpms.schema_migrations (id, checksum) values ($1, $2)`, [m.id, m.checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${m.id} failed: ${(error as Error).message}`);
      }
      log(`applied ${m.id}`);
      ran.push(m.id);
    }
    return ran;
  } finally {
    await client.end();
  }
}

export async function migrateDown(connectionString: string, steps = 1, log = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await ensureBookkeeping(client);
    const done = [...(await applied(client)).keys()].sort().reverse().slice(0, steps);
    const files = new Map(listMigrations().map((m) => [m.id, m]));
    const reverted: string[] = [];
    for (const id of done) {
      const m = files.get(id);
      if (!m) throw new Error(`Applied migration ${id} has no file on disk`);
      await client.query("begin");
      try {
        await client.query(m.rollback);
        await client.query(`delete from tpms.schema_migrations where id = $1`, [id]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Rollback ${id} failed: ${(error as Error).message}`);
      }
      log(`reverted ${id}`);
      reverted.push(id);
    }
    return reverted;
  } finally {
    await client.end();
  }
}

/** Drop everything and rebuild. For the test database and local resets only. */
export async function resetDatabase(connectionString: string, log = console.log): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`drop schema if exists tpms cascade`);
  } finally {
    await client.end();
  }
  await migrateUp(connectionString, log);
}
