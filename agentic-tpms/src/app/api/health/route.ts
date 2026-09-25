import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await db().execute(sql`select (select count(*) from tpms.schema_migrations)::int as migrations,
      (select count(*) from tpms.task_queue where status = 'QUEUED' and claim_due <= now())::int as due_tasks`);
    return NextResponse.json({ status: "ok", ...(result.rows[0] as object) });
  } catch (error) {
    return NextResponse.json({ status: "degraded", error: (error as Error).message }, { status: 503 });
  }
}
