import { sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rows } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

/**
 * R11: the Drizzle mirror and the SQL migrations are two claims about one
 * schema. This asserts every table and column Drizzle declares exists in the
 * migrated database, with a type family that matches, and that every table
 * lives in `tpms` (never `public`).
 */
const FAMILY: Record<string, string[]> = {
  PgUUID: ["uuid"],
  PgVarchar: ["character varying"],
  PgChar: ["character"],
  PgText: ["text"],
  PgArray: ["ARRAY"],
  PgBoolean: ["boolean"],
  PgInteger: ["integer"],
  PgSerial: ["integer"],
  PgBigInt53: ["bigint"],
  PgNumeric: ["numeric"],
  PgTimestamp: ["timestamp with time zone"],
  PgDateString: ["date"],
  PgJsonb: ["jsonb"],
  PgCustomColumn: ["bytea", "USER-DEFINED"],
};

describe("schema parity: Drizzle mirror vs migrated database", () => {
  it("every declared column exists with a compatible type, in the tpms schema", async () => {
    const actual = await rows<{ table_name: string; column_name: string; data_type: string }>(
      db(),
      sql`select table_name, column_name, data_type from information_schema.columns where table_schema = 'tpms'`,
    );
    const index = new Map(actual.map((c) => [`${c.table_name}.${c.column_name}`, c.data_type]));
    const problems: string[] = [];
    let checked = 0;
    for (const value of Object.values(schema)) {
      if (!(value instanceof PgTable)) continue;
      const config = getTableConfig(value);
      if (config.schema !== "tpms") problems.push(`${config.name} is not in the tpms schema`);
      for (const column of config.columns) {
        checked += 1;
        const type = index.get(`${config.name}.${column.name}`);
        if (!type) {
          problems.push(`${config.name}.${column.name} missing in database`);
          continue;
        }
        const family = FAMILY[column.columnType];
        if (family && !family.includes(type)) problems.push(`${config.name}.${column.name}: drizzle ${column.columnType} vs db ${type}`);
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(250);
  });

  it("no application table is left in public", async () => {
    const leaked = await rows<{ table_name: string }>(
      db(),
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(leaked).toEqual([]);
  });

  it("every tpms function pins its search_path", async () => {
    const unpinned = await rows<{ proname: string }>(
      db(),
      sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'tpms' and (p.proconfig is null or not exists (
             select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`,
    );
    expect(unpinned).toEqual([]);
  });

  it("the audit ledger refuses mutation even for the table owner (triggers present and enabled)", async () => {
    const triggers = await rows<{ tgname: string; tgenabled: string }>(
      db(),
      sql`select tgname, tgenabled from pg_trigger where tgrelid = 'tpms.audit_ledger'::regclass and not tgisinternal order by tgname`,
    );
    expect(triggers).toEqual([
      { tgname: "trg_audit_chain", tgenabled: "O" },
      { tgname: "trg_audit_no_truncate", tgenabled: "O" },
      { tgname: "trg_audit_no_update", tgenabled: "O" },
    ]);
  });
});
