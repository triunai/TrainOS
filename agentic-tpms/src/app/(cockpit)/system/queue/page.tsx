import { sql } from "drizzle-orm";
import { Body, DataTable, MetricStrip, PageHeader, Section, StatusChip, type StatusTone } from "@/components/kit";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { db, rows } from "@/server/db/client";
import { plain } from "@/server/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Task queue" };

const TONE: Record<string, StatusTone> = { QUEUED: "neutral", PROCESSING: "info", COMPLETED: "success", FAILED: "danger" };

interface TaskRow {
  id: string;
  task_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  claim_due: Date;
  locked_by: string | null;
  locked_until: Date | null;
  last_error: string | null;
  package_code: string | null;
  completed_at: Date | null;
}

export default async function QueuePage() {
  const [stats] = await rows<{ queued: number; due: number; processing: number; failed: number; completed24h: number; expired: number }>(
    db(),
    sql`select count(*) filter (where status = 'QUEUED')::int as queued,
               count(*) filter (where status = 'QUEUED' and claim_due <= now())::int as due,
               count(*) filter (where status = 'PROCESSING')::int as processing,
               count(*) filter (where status = 'FAILED')::int as failed,
               count(*) filter (where status = 'COMPLETED' and completed_at > now() - interval '24 hours')::int as "completed24h",
               count(*) filter (where status = 'PROCESSING' and locked_until < now())::int as expired
          from tpms.task_queue`,
  );
  const tasks = await rows<TaskRow>(
    db(),
    sql`select t.id, t.task_type, t.status, t.attempts, t.max_attempts, t.claim_due, t.locked_by, t.locked_until, t.last_error,
               t.completed_at, p.package_code
          from tpms.task_queue t
          left join tpms.training_packages p on p.id::text = t.payload->>'packageId'
         order by case t.status when 'FAILED' then 0 when 'PROCESSING' then 1 when 'QUEUED' then 2 else 3 end, t.claim_due desc
         limit 200`,
  );
  return (
    <Frame crumbs={[{ label: "Automation" }, { label: "Task queue" }]}>
      <PageHeader title="Task queue" summary="Postgres-leased with SELECT … FOR UPDATE SKIP LOCKED · 5-minute leases · exponential backoff · refusals dead-letter immediately">
        <MetricStrip
          cells={[
            { label: "Due now", value: String(stats.due) },
            { label: "Scheduled", value: String(stats.queued - stats.due) },
            { label: "Processing", value: String(stats.processing), sub: stats.expired ? `${stats.expired} lease expired` : undefined },
            { label: "Completed 24h", value: String(stats.completed24h) },
            { label: "Dead-lettered", value: String(stats.failed) },
          ]}
        />
      </PageHeader>
      <Body>
        <Section title="Tasks" flush>
          <DataTable
            label="Tasks"
            density="compact"
            rows={plain(tasks)}
            rowKey={(r) => r.id}
            columns={[
              { key: "type", label: "Task", cell: (r) => r.task_type, mono: true },
              { key: "pkg", label: "Package", cell: (r) => r.package_code ?? "—", mono: true },
              { key: "status", label: "Status", cell: (r) => <StatusChip tone={TONE[r.status] ?? "neutral"}>{r.status.toLowerCase()}</StatusChip> },
              { key: "due", label: "Due", cell: (r) => formatDate(r.claim_due, true) },
              { key: "attempts", label: "Attempts", align: "right", cell: (r) => `${r.attempts}/${r.max_attempts}` },
              { key: "lease", label: "Lease", cell: (r) => (r.locked_by ? `${r.locked_by} → ${formatDate(r.locked_until, true)}` : "—") },
              { key: "error", label: "Last error", cell: (r) => <span className="line-clamp-1 max-w-[320px] text-[12px] text-ink-secondary" title={r.last_error ?? ""}>{r.last_error ?? ""}</span> },
            ]}
          />
        </Section>
      </Body>
    </Frame>
  );
}
