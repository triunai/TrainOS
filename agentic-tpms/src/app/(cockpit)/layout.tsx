import type { ReactNode } from "react";
import { sql } from "drizzle-orm";
import { Sidebar } from "@/components/shell/Sidebar";
import { db, rows } from "@/server/db/client";
import { OPERATORS, currentOperator } from "@/server/auth/operator";

export const dynamic = "force-dynamic";

async function badgeCounts() {
  try {
    const [r] = await rows<{ decisions: number; breached: number; triage: number; exceptions: number; claims: number }>(
      db(),
      sql`select
        (select count(*) from tpms.decisions where status = 'PENDING')::int as decisions,
        (select count(*) from tpms.decisions where status = 'PENDING' and sla_due_at < now())::int as breached,
        (select count(*) from tpms.lead_records where status = 'TRIAGE_REVIEW')::int as triage,
        (select count(*) from tpms.attendance_records r
           join tpms.package_participants p on p.id = r.participant_id
          where r.needs_review and r.resolved_at is null and p.registration_status <> 'WITHDRAWN')::int as exceptions,
        (select count(*) from tpms.training_packages where financial_stage in ('CLAIM_READY','QUERIED','REMITTED'))::int as claims`,
    );
    return {
      decisions: { count: r.decisions, alert: r.breached > 0 },
      triage: { count: r.triage },
      exceptions: { count: r.exceptions, alert: r.exceptions > 0 },
      claims: { count: r.claims },
    };
  } catch (error) {
    // A badge must never take the whole cockpit down, but a failing count is
    // still a fault someone should see in the server log.
    console.error("[cockpit] badge counts failed", error);
    return {};
  }
}

/** The cockpit shell: the rail persists across navigations; each page renders its own Frame. */
export default async function CockpitLayout({ children }: { children: ReactNode }) {
  const operator = currentOperator();
  const badges = await badgeCounts();
  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-sidebar">
      <Sidebar
        badges={badges}
        operator={{ id: operator.id, name: operator.name, roleLabel: operator.roleLabel }}
        operators={OPERATORS.map((o) => ({ id: o.id, name: o.name, roleLabel: o.roleLabel }))}
        version="TPMS 0.1 · single-tenant · FSM v1"
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
