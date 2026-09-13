import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AutomationRun, HaltedBy } from "@trainos/contract";
import {
  ApprovalBanner,
  ConfirmDialog,
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  FilterBar,
  GhostButton,
  ListToolbar,
  LoadingState,
  MoneyText,
  PillTabGroup,
  PrimaryButton,
  RUN_TONE,
  RecordHeader,
  RefusalBanner,
  SecondaryButton,
  StatusChip,
  formatDuration,
  humanise,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { useMe } from "@/shared/hooks/useMe";
import { useAgentRegistry, useDeadLetterRun, useRetryRun, useRuns } from "./api";
import { AGENT_REGISTRY_PATH, runTracePath } from "./paths";

/**
 * `/automation/failures` — M18-S07, the dead-letter list.
 *
 * Named in `Kit.dc.html` as a wiring target and never drawn, so the
 * composition here is invented under the standing rules rather than
 * transcribed. What it has to answer, in this order: is anything stuck, why,
 * and can I unstick it.
 *
 * THE LIST IS WIDER THAN "FAILED". A run that a policy HALTED is not a failure
 * — `RUN_TONE` is explicit that halted is warning, not danger, because
 * something stopped on purpose. But it is stuck in exactly the way this page
 * exists to surface, and leaving it out would mean the one screen about stuck
 * automation quietly omitted the runs a human has to unblock. So both are
 * listed, the chip keeps the distinction, and the two need different actions:
 *
 *   · A FAILED run can be retried, unless it is dead-lettered and not retryable.
 *   · A HALTED run cannot. `haltedBy` names the policy that stopped it and the
 *     approval that has to be decided first, so the row shows the approval
 *     banner instead of a button that would return the same halt.
 *
 * RETRY AND DISMISS REPORT DIFFERENTLY, ON PURPOSE (R3). `useRetryRun` carries
 * no `toastOnError`, so its refusal is rendered inline by this screen.
 * `useDeadLetterRun` DOES carry the flag, so its refusal arrives as a toast and
 * is deliberately not rendered again here — reporting it twice is the other
 * half of the same bug.
 */

const TABS = {
  stuck: "Needs attention",
  dead: "Dead-lettered",
  all: "All failures",
} as const;

type TabId = keyof typeof TABS;

/** A run this page is about: it failed, or a policy stopped it. */
function isStuck(run: AutomationRun): boolean {
  return run.status === "FAILED" || run.status === "HALTED";
}

/**
 * The halt, wherever the trace recorded it.
 *
 * §10 puts `haltedBy` on a flat step; §17 puts it on a trace node. A run may
 * carry either, and a screen that read only one would show "halted" with no
 * reason for half the runs in the store.
 */
function haltOf(run: AutomationRun): HaltedBy | undefined {
  return (
    run.steps?.find((step) => step.haltedBy)?.haltedBy ??
    run.nodes?.find((node) => node.haltedBy)?.haltedBy
  );
}

function tabOf(run: AutomationRun): Exclude<TabId, "all"> {
  return run.failure?.deadLettered ? "dead" : "stuck";
}

export function AutomationFailuresScreen() {
  useBreadcrumb([{ label: "Automation" }, { label: "Failures" }]);

  const navigate = useNavigate();
  const { me } = useMe();
  const runs = useRuns();
  const registry = useAgentRegistry();
  const retry = useRetryRun();
  const deadLetter = useDeadLetterRun();

  const [tab, setTab] = useState<TabId>("stuck");
  const [dismissing, setDismissing] = useState<AutomationRun | null>(null);

  const agentNames = useMemo(() => {
    const index = new Map<string, string>();
    for (const agent of registry.data?.data ?? []) index.set(agent.id, agent.name);
    return index;
  }, [registry.data]);

  const stuck = useMemo(() => (runs.data?.data ?? []).filter(isStuck), [runs.data]);

  const visible = useMemo(
    () => (tab === "all" ? stuck : stuck.filter((run) => tabOf(run) === tab)),
    [stuck, tab],
  );

  const countOf = (id: TabId) =>
    id === "all" ? stuck.length : stuck.filter((run) => tabOf(run) === id).length;

  /* The first halted run drives the banner. One halt is the fixture's reality
     and one banner is the artboards' grammar; if a second appears the row's own
     chip still says so, and the banner names which run it is about. */
  const halted = visible.find((run) => run.status === "HALTED");
  const halt = halted ? haltOf(halted) : undefined;

  const columns: Column<AutomationRun>[] = [
    {
      key: "run",
      label: "Run",
      accessor: (run) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-[12px] text-ink">{run.ref}</p>
          <p className="truncate text-[12px] text-ink-muted">
            {agentNames.get(run.agentId) ?? run.agentId}
          </p>
        </div>
      ),
    },
    {
      key: "failure",
      label: "Why it stopped",
      accessor: (run) => {
        const stopped = haltOf(run);
        if (run.failure) {
          return (
            <div className="min-w-0">
              <p className="truncate font-mono text-[12px] text-ink">{run.failure.code}</p>
              <p className="truncate text-[12px] text-ink-muted">{run.failure.message}</p>
            </div>
          );
        }
        if (stopped) {
          return (
            <div className="min-w-0">
              <p className="truncate font-mono text-[12px] text-ink">{stopped.policyId}</p>
              <p className="truncate text-[12px] text-ink-muted">{stopped.reason}</p>
            </div>
          );
        }
        /* Neither a failure block nor a halt. The run says it stopped and the
           trace does not say why — rendered as the gap it is, rather than as
           an empty cell that reads like "no problem". */
        return <span className="text-[12px] text-ink-muted">No reason recorded</span>;
      },
    },
    {
      key: "status",
      label: "Status",
      width: "116px",
      accessor: (run) => (
        <div className="flex flex-col items-start gap-1">
          <StatusChip tone={RUN_TONE[run.status]}>{humanise(run.status)}</StatusChip>
          {run.failure?.deadLettered ? (
            <span className="text-[11px] text-ink-muted">dead-lettered</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "attempts",
      label: "Attempts",
      width: "84px",
      align: "right",
      accessor: (run) => (
        <span className="tabular-nums text-ink-secondary">{run.failure?.attempts ?? "—"}</span>
      ),
    },
    {
      key: "cost",
      label: "Cost",
      width: "96px",
      align: "right",
      accessor: (run) => <MoneyText value={run.cost} className="whitespace-nowrap" />,
    },
    {
      key: "when",
      label: "Started",
      width: "142px",
      accessor: (run) => (
        <div className="min-w-0">
          <DateText
            value={run.startedAt}
            withTime
            className="text-[12px] tabular-nums text-ink-secondary"
          />
          <p className="text-[11px] tabular-nums text-ink-muted">
            {formatDuration(run.durationMs)}
          </p>
        </div>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      width: "182px",
      srOnlyLabel: true,
      accessor: (run) => {
        const blocked = run.status === "HALTED";
        const retryable = run.failure?.retryable ?? !blocked;
        return (
          /* The row itself opens the trace, so an action inside it has to stop
             the event: without this, pressing Retry navigates away before the
             mutation's result can be read, and Dismiss opens its dialog on a
             screen that is already unmounting. */
          <div
            className="flex items-center justify-end gap-1.5"
            onClick={(event) => event.stopPropagation()}
          >
            <SecondaryButton
              disabled={blocked || !retryable || retry.isPending}
              onClick={() => retry.mutate({ id: run.id, from: "checkpoint" })}
            >
              Retry
            </SecondaryButton>
            <GhostButton
              disabled={run.failure?.deadLettered || deadLetter.isPending}
              onClick={() => setDismissing(run)}
            >
              Dismiss
            </GhostButton>
          </div>
        );
      },
    },
  ];

  if (runs.isPending) return <LoadingState rows={8} label="Loading the failed runs" />;
  if (runs.isError) {
    return (
      <ErrorState
        title="The failed runs could not be loaded"
        error={runs.error}
        onRetry={() => void runs.refetch()}
      />
    );
  }

  const deadLettered = stuck.filter((run) => run.failure?.deadLettered).length;

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="Automation failures"
        meta={[
          `${stuck.length} stuck`,
          deadLettered > 0 ? `${deadLettered} dead-lettered` : null,
          halted ? "1 waiting on an approval" : null,
        ]}
        actions={
          <SecondaryButton onClick={() => navigate(AGENT_REGISTRY_PATH)}>Agents</SecondaryButton>
        }
        /* The one solid button, and it only exists when there is something to
           point it at: retrying everything retryable is the action this queue
           is for. */
        primaryAction={
          visible.some((run) => run.status === "FAILED" && run.failure?.retryable) ? (
            <PrimaryButton
              disabled={retry.isPending}
              onClick={() => {
                for (const run of visible) {
                  if (run.status === "FAILED" && run.failure?.retryable) {
                    retry.mutate({ id: run.id, from: "checkpoint" });
                  }
                }
              }}
            >
              Retry all retryable
            </PrimaryButton>
          ) : undefined
        }
      />

      {/* An approval, not an error. A halted run is the policy gate working:
          the agent stopped before it did the thing, and what it is waiting for
          is a person, not a retry. */}
      {halted && halt ? (
        <div className="px-5">
          <ApprovalBanner
            approval={{
              subject: `${halted.ref} is held until ${halt.approvalRequestRef} is decided`,
              slaDueAt: halted.startedAt,
              slaBreached: false,
              status: "PENDING",
            }}
            actions={
              <SecondaryButton onClick={() => navigate(runTracePath(halted.ref))}>
                Open the trace
              </SecondaryButton>
            }
          />
        </div>
      ) : null}

      {/* `useRetryRun` carries no toastOnError, so this is the only place its
          refusal reaches the reader. A policy refusal here is a fact about the
          request, not a transport failure — it says so and offers no retry. */}
      {retry.isError ? (
        <div className="px-5">
          <RefusalBanner title="The run was not retried" error={retry.error} />
        </div>
      ) : null}

      {registry.isError ? (
        <div className="px-5">
          <ErrorState
            title="The agent names could not be loaded"
            /* Said out loud rather than swallowed: without the registry each
               row falls back to the raw agent id, and a reader deserves to
               know why the column looks like that. */
            error={registry.error}
            onRetry={() => void registry.refetch()}
          />
        </div>
      ) : null}

      <div className="px-5">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Failure buckets"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={(Object.keys(TABS) as TabId[]).map((id) => ({
                id,
                label: TABS[id],
                count: countOf(id),
              }))}
            />
          }
          filters={<FilterBar filters={[]} shown={visible.length} total={stuck.length} />}
        />
      </div>

      <div className="px-5">
        <DataTable
          label="Failed and halted runs"
          columns={columns}
          rows={visible}
          rowKey={(run) => run.id}
          onRowClick={(run) => navigate(runTracePath(run.ref))}
          empty={
            <EmptyState
              title={tab === "dead" ? "Nothing has been dead-lettered" : "Nothing is stuck"}
              description={
                tab === "dead"
                  ? "No run has been given up on. A run reaches this bucket only when a human stops retrying it."
                  : "Every run either finished or is still going. Failures land here the moment a run exhausts its retries or a policy halts it."
              }
            />
          }
        />
      </div>

      <p className="px-5 text-[12px] leading-relaxed text-ink-muted">
        Retrying resumes from the run&rsquo;s last checkpoint using its stored state card, so the
        steps that already succeeded are not repeated. Dismissing is the opposite: it records that
        nobody is going to retry this, and it is the reason a queue of stuck work does not grow
        without bound.
      </p>

      <ConfirmDialog
        open={dismissing !== null}
        busy={deadLetter.isPending}
        title={dismissing ? `Stop retrying ${dismissing.ref}?` : "Stop retrying this run?"}
        description={
          dismissing ? (
            <>
              {`The run is marked dead-lettered and leaves the "needs attention" bucket. Whatever ${agentNames.get(dismissing.agentId) ?? dismissing.agentId} was doing does not happen, and anything downstream of it stays undone until somebody does it by hand.`}
            </>
          ) : undefined
        }
        confirmLabel="Stop retrying"
        onCancel={() => setDismissing(null)}
        onConfirm={() => {
          if (!dismissing) return;
          /* The reason is stored on the run and read back on the trace, so it
             records WHO gave up and from where rather than the word
             "dismissed". */
          deadLetter.mutate({
            id: dismissing.id,
            reason: `Dismissed from the failures queue by ${me.name}`,
          });
          setDismissing(null);
        }}
      />
    </div>
  );
}
