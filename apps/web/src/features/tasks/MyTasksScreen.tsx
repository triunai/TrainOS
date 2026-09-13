import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ApprovalRequest,
  FollowUp,
  Role,
  RuleChangeSet,
  UrgencyGroup,
} from "@trainos/contract";
import { URGENCY_GROUPS } from "@trainos/contract";
import {
  APPROVAL_TONE,
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  FOLLOW_UP_TONE,
  LoadingState,
  MoneyText,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  humanise,
  type Column,
  type RowGroup,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { APPROVALS_PATH, approvalPath } from "@/features/approvals";
import { FOLLOW_UP_QUEUE_PATH } from "@/features/enquiries";
import { HRDC_RULE_CHANGES_PATH } from "@/features/hrdc";
import { useApprovalTasks, useFollowUpTasks, usePolicyIndex, useRuleChangeTasks } from "./api";

/**
 * `/my-tasks` — the one list a person opens to find out what they owe.
 *
 * There is no artboard for this screen and no `GET /v1/tasks` behind it. What a
 * human owes is published in three places already — approvals, proposed rule
 * changes, follow-ups — and the value of this page is entirely in refusing to
 * make the reader visit three queues to assemble their own morning.
 *
 * TWO DECISIONS WORTH ARGUING WITH:
 *
 * 1. **Grouped by when it is due, not by what kind of thing it is.** A day is
 *    organised by deadline; a kind is a filter, not an order. The kind is a
 *    chip in its own column and a tab above the table, so both readings are
 *    available and only one of them shapes the list.
 *
 * 2. **The bucket comes from the server wherever the server has one.**
 *    `ApprovalRequest.urgencyGroup` is computed against the SLA clock the
 *    server owns, so it is rendered as given and never recomputed here — a
 *    second opinion about whether something is breaching is how a screen ends
 *    up disagreeing with the inbox it links to. Follow-ups and rule changes
 *    publish no bucket, so this file derives one, in one function, and says so.
 *
 * The screen writes nothing. Every row is a link into the queue that owns the
 * decision, and the approvals column names the role that has to make it rather
 * than offering a button the reader may not be allowed to press.
 */

/** The buckets, in order, with the caption each one carries. */
const GROUP_CAPTION: Record<UrgencyGroup, string> = {
  BREACHING: "Overdue",
  TODAY: "Due today",
  THIS_WEEK: "This week",
  LATER: "Later",
};

type TaskKind = "APPROVAL" | "REVIEW" | "FOLLOW_UP";

const KIND_LABEL: Record<TaskKind, string> = {
  APPROVAL: "Approval",
  REVIEW: "Review",
  FOLLOW_UP: "Follow-up",
};

/**
 * One row of the queue, whatever it came from.
 *
 * `status` and `tone` are carried rather than derived at render time so the
 * chip column has one shape for three sources — the alternative is a switch in
 * the accessor, which is where a fourth source would quietly render nothing.
 */
interface Task {
  id: string;
  kind: TaskKind;
  group: UrgencyGroup;
  /** The strongest line: what this is. */
  title: string;
  /** Muted second line: why it is here. */
  detail: string;
  /** The business reference, rendered mono. */
  ref: string;
  /** What the row is waiting on — the chip. */
  status: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  dueAt: string;
  /** Who has to act, when the record names a role. */
  owner?: string;
  value?: ApprovalRequest["value"];
  to: string;
}

/**
 * The bucket for a record that does not carry one.
 *
 * Only follow-ups and rule changes reach this. Approvals carry `urgencyGroup`
 * from the server and never pass through here — see the note at the top.
 *
 * It compares against the wall clock, which makes it the one clock-dependent
 * thing on the page. That is why the follow-up path prefers the record's own
 * `status`: `OVERDUE` is a fact the server asserted, and reading it beats
 * recomputing it from a date and today's timezone.
 */
function bucketFor(dueAt: string, now = Date.now()): UrgencyGroup {
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "LATER";
  const days = Math.floor((due - now) / 86_400_000);
  if (days < 0) return "BREACHING";
  if (days === 0) return "TODAY";
  if (days <= 7) return "THIS_WEEK";
  return "LATER";
}

function approvalTask(approval: ApprovalRequest, approverRole: Role | undefined): Task {
  return {
    id: `approval:${approval.id}`,
    kind: "APPROVAL",
    /* The server's bucket, rendered as given. */
    group: approval.urgencyGroup,
    title: approval.subject,
    detail: `${humanise(approval.actionType)} · requested by ${approval.requestedBy.name}`,
    ref: approval.ref,
    status: approval.slaBreached ? "SLA breached" : humanise(approval.status),
    tone: approval.slaBreached ? "danger" : APPROVAL_TONE[approval.status],
    dueAt: approval.slaDueAt,
    ...(approval.value ? { value: approval.value } : {}),
    /* Who is allowed to decide, from the policy the request was raised under.
       Unknown is said out loud: an absent policy means the join failed, and a
       blank cell would read as "anybody". */
    owner: approverRole ? `${humanise(approverRole)} decides` : "Approver unknown",
    to: approvalPath(approval.ref),
  };
}

function followUpTask(followUp: FollowUp): Task {
  return {
    id: `follow-up:${followUp.id}`,
    kind: "FOLLOW_UP",
    /* `OVERDUE` is the server's word, so it goes straight to the overdue
       bucket. Anything else is dated, and the date decides. */
    group: followUp.status === "OVERDUE" ? "BREACHING" : bucketFor(followUp.dueDate),
    title: followUp.contact.name,
    detail: followUp.reason,
    ref: followUp.ref,
    /* Not `humanise(status)`. "Overdue" is already the caption of the block
       this row sits in, and a chip repeating its own group caption is the
       duplication CLAUDE.md calls a defect. The bucket says WHEN; the chip says
       WHAT. The tone still carries the urgency, so nothing is lost but a word. */
    status: "Reply owed",
    tone: FOLLOW_UP_TONE[followUp.status],
    dueAt: followUp.dueDate,
    owner: followUp.organisation.name,
    to: FOLLOW_UP_QUEUE_PATH,
  };
}

/**
 * A circular becomes one task, not one per extracted change.
 *
 * The review is of the document: M12-S08 decides the whole change set in one
 * pass, and a queue that listed five changes from one circular would be
 * counting the reviewer's work five times.
 */
function reviewTask(set: RuleChangeSet): Task | null {
  const proposed = set.changes.filter((change) => change.status === "PROPOSED");
  if (proposed.length === 0) return null;

  const affected = new Set(
    proposed.flatMap((change) => change.affectedEngagements.map((item) => item.ref)),
  );

  return {
    id: `review:${set.documentId}`,
    kind: "REVIEW",
    group: bucketFor(set.effectiveFrom),
    title: set.title,
    detail:
      affected.size > 0
        ? `${proposed.length} proposed change${proposed.length === 1 ? "" : "s"} · ${affected.size} engagement${affected.size === 1 ? "" : "s"} affected`
        : `${proposed.length} proposed change${proposed.length === 1 ? "" : "s"}`,
    ref: set.documentId,
    status: "Review required",
    tone: "warning",
    dueAt: set.effectiveFrom,
    owner: `Extracted by ${set.extractedBy.model}`,
    to: `${HRDC_RULE_CHANGES_PATH}/${encodeURIComponent(set.documentId)}`,
  };
}

const TABS = [
  { id: "all", label: "All" },
  { id: "APPROVAL", label: "Approvals" },
  { id: "REVIEW", label: "Reviews" },
  { id: "FOLLOW_UP", label: "Follow-ups" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function MyTasksScreen() {
  useBreadcrumb([{ label: "Home" }, { label: "My tasks" }]);

  const navigate = useNavigate();
  const approvals = useApprovalTasks();
  const reviews = useRuleChangeTasks();
  const followUps = useFollowUpTasks();
  const policies = usePolicyIndex();

  const [tab, setTab] = useState<TabId>("all");

  const approverByPolicy = useMemo(() => {
    const index = new Map<string, Role>();
    for (const policy of policies.data?.data ?? []) index.set(policy.id, policy.approverRole);
    return index;
  }, [policies.data]);

  const tasks = useMemo<Task[]>(() => {
    const rows: Task[] = [
      ...(approvals.data?.data ?? []).map((approval) =>
        approvalTask(approval, approverByPolicy.get(approval.policyId)),
      ),
      ...(reviews.data?.data ?? []).map(reviewTask).filter((task): task is Task => task !== null),
      ...(followUps.data?.data ?? [])
        .filter((row) => row.status === "DUE" || row.status === "OVERDUE")
        .map(followUpTask),
    ];
    /* Within a bucket, the nearest deadline first. The bucket already carries
       the urgency; this only settles ties inside one. */
    return rows.sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  }, [approvals.data, reviews.data, followUps.data, approverByPolicy]);

  const visible = useMemo(
    () => (tab === "all" ? tasks : tasks.filter((task) => task.kind === tab)),
    [tasks, tab],
  );

  const groups = useMemo<RowGroup<Task>[]>(
    () =>
      URGENCY_GROUPS.map((key) => ({
        caption: GROUP_CAPTION[key],
        rows: visible.filter((task) => task.group === key),
      })).filter((group) => group.rows.length > 0),
    [visible],
  );

  const columns: Column<Task>[] = [
    {
      key: "task",
      label: "Task",
      accessor: (task) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{task.title}</p>
          <p className="truncate text-[12px] text-ink-muted">{task.detail}</p>
        </div>
      ),
    },
    {
      key: "kind",
      label: "Kind",
      width: "104px",
      /* The kind is a category, not a verdict, so it spends no status colour.
         Neutral is the chip saying "this is a fact about the row". */
      accessor: (task) => <StatusChip tone="neutral">{KIND_LABEL[task.kind]}</StatusChip>,
    },
    {
      key: "status",
      label: "Waiting on",
      width: "132px",
      accessor: (task) => (
        <div className="flex flex-col items-start gap-1">
          <StatusChip tone={task.tone}>{task.status}</StatusChip>
          {task.owner ? (
            <span className="truncate text-[11px] text-ink-muted">{task.owner}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "value",
      label: "Value",
      width: "108px",
      align: "right",
      accessor: (task) =>
        task.value ? (
          <MoneyText value={task.value} compact className="whitespace-nowrap" />
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: "ref",
      label: "Reference",
      width: "128px",
      accessor: (task) => <span className="font-mono text-[12px] text-ink-muted">{task.ref}</span>,
    },
    {
      key: "due",
      label: "Due",
      width: "104px",
      accessor: (task) => (
        <DateText value={task.dueAt} className="text-[13px] tabular-nums text-ink-secondary" />
      ),
    },
  ];

  const sources = [
    { label: "Approvals", query: approvals },
    { label: "Rule changes", query: reviews },
    { label: "Follow-ups", query: followUps },
    { label: "Approval policies", query: policies },
  ] as const;

  const failed = sources.filter((source) => source.query.isError);
  const pending = sources.every((source) => source.query.isPending);
  const overdue = tasks.filter((task) => task.group === "BREACHING").length;
  const next = visible[0];

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="My tasks"
        /* The count line is a fact about the query, not a status, so it lives
           on the meta line rather than in a chip. */
        meta={[
          pending ? null : `${tasks.length} open`,
          overdue > 0 ? `${overdue} overdue` : null,
          /* Say it when the list is not the whole list. */
          approvals.data?.page.next ? "more approvals than shown" : null,
          failed.length > 0 ? `${failed.length} source unavailable` : null,
        ]}
        actions={
          <SecondaryButton onClick={() => navigate(APPROVALS_PATH)}>Approval inbox</SecondaryButton>
        }
        /* The one solid button. A queue's primary action is to start, and the
           most urgent row is what starting means. */
        primaryAction={
          next ? (
            <PrimaryButton onClick={() => navigate(next.to)}>Open next task</PrimaryButton>
          ) : undefined
        }
      />

      {/* One error block per failed source, each retryable on its own. A
          combined "something went wrong" would hide that two of three queues
          are fine, and a silent `?? []` would render a short list as if it
          were the whole list. */}
      {failed.map((source) => (
        <div key={source.label} className="px-5">
          <ErrorState
            title={`${source.label} could not be loaded`}
            error={source.query.error ?? undefined}
            onRetry={() => void source.query.refetch()}
          />
        </div>
      ))}

      {pending ? (
        <div className="px-5">
          <LoadingState rows={8} label="Loading your tasks" />
        </div>
      ) : null}

      {!pending && failed.length < sources.length ? (
        <>
          <div className="px-5">
            <PillTabGroup
              label="Task kinds"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={TABS.map((entry) => ({
                id: entry.id,
                label: entry.label,
                count:
                  entry.id === "all"
                    ? tasks.length
                    : tasks.filter((task) => task.kind === entry.id).length,
              }))}
            />
          </div>

          <div className="px-5">
            <DataTable
              label="My tasks"
              columns={columns}
              groups={groups}
              rowKey={(task) => task.id}
              onRowClick={(task) => navigate(task.to)}
              empty={
                <EmptyState
                  title={tab === "all" ? "Nothing is waiting on you" : "Nothing of this kind"}
                  description={
                    tab === "all"
                      ? "No approval, review or follow-up is assigned to you right now. New work appears here the moment a policy raises it."
                      : "Every task of this kind has been decided or sent. Switch tabs to see the rest of the queue."
                  }
                />
              }
            />
          </div>

          <p className="px-5 text-[12px] leading-relaxed text-ink-muted">
            Nothing is decided here. Each row opens the queue that owns the decision, and an
            approval names the role that has to make it — the rail a person sees is a rendering
            convenience, and the API is what actually allows or refuses the write.
          </p>
        </>
      ) : null}
    </div>
  );
}
