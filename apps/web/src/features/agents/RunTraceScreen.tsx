import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AutomationRun, JuryVote, TraceNode } from "@trainos/contract";
import {
  AgentRunCard,
  Breadcrumb,
  ContentCard,
  DataTable,
  ErrorState,
  ExceptionBanner,
  JuryChip,
  LoadingState,
  MoneyText,
  PrimaryButton,
  RecordHeader,
  RUN_TONE,
  RunStepRow,
  SecondaryButton,
  StateCardPanel,
  StatusChip,
  TierChip,
  TraceTreeNode,
  formatDuration,
  formatMoney,
  humanise,
  type Column,
} from "@/shared/components/kit";
import { useAgentRegistry, useDeadLetterRun, useRetryRun, useRun, useRuns } from "./api";
import { RunEventRow } from "./RunEventRow";
import { RunNowPanel } from "./RunNowPanel";
import { AGENT_REGISTRY_PATH, RUNS_PATH, runTracePath } from "./paths";

/**
 * M18-S04 · Run / trace viewer.
 *
 * Primary user: System Admin, and approvers who arrive here from an approval.
 * Primary button: "Open approval" — because on the run this screen was drawn
 * for, the useful next step is not anything to do with the run. The run is over.
 * It stopped at a policy and raised APV-2026-0771, and the only thing left to
 * do is decide that.
 *
 * The claim the whole page is making is that the agent never sent anything.
 * `haltedBy` is what proves it: a policy id, an approval ref and a reason,
 * recorded on the node where the send would have happened. That is a fact in
 * the trace rather than an inference from the absence of a log line, which is
 * why the halted node, the halted step and the POLICY_HALT event all render it
 * and all say the same thing.
 *
 * Three columns, per §5's trace-viewer template: the run rail on the left, the
 * execution tree and event log in the middle, the state card on the right. The
 * state card is reference material for the person reading the trace and is
 * never inside the tree.
 */

/** The failed run the §4 row asks for: "a failed run in the rail with a live checkpoint". */
function findFailed(runs: AutomationRun[]): AutomationRun | undefined {
  return runs.find((run) => run.status === "FAILED");
}

/** Depth by walking `parentId`, so a node cannot claim a depth its parent contradicts. */
function depthOf(node: TraceNode, nodes: TraceNode[]): number {
  let depth = 0;
  let current = node;
  for (let guard = 0; guard < nodes.length && current.parentId; guard += 1) {
    const parent = nodes.find((candidate) => candidate.id === current.parentId);
    if (!parent) break;
    current = parent;
    depth += 1;
  }
  return depth;
}

/** The jury as the run actually voted, for the header chip. */
function juryOf(run: AutomationRun) {
  const event = run.events?.find((candidate) => candidate.type === "JURY");
  if (!event) return undefined;
  const votes: JuryVote[] = event.detail.votes ?? [];
  return {
    quorum: event.detail.quorum ?? votes.filter((vote) => vote.agrees).length,
    of: event.detail.of ?? votes.length,
    agreed: votes.filter((vote) => vote.agrees).map((vote) => vote.model),
    dissented: votes
      .filter((vote) => !vote.agrees)
      .map((vote) => ({ model: vote.model, note: vote.dissent ?? "dissented" })),
  };
}

export function RunTraceScreen() {
  const { runRef } = useParams<{ runRef: string }>();
  const navigate = useNavigate();
  const runs = useRuns();
  const registry = useAgentRegistry();
  const retry = useRetryRun();
  const deadLetter = useDeadLetterRun();
  const [mockRun, setMockRun] = useState<AutomationRun | null>(null);

  /* No `:runRef` means "pick one". This page IS the trace viewer, so it picks
     the newest run that actually has a trace to view, and only falls back to
     the newest run of any kind if none does. Landing on a single-node run and
     showing "this run recorded no orchestrator tree" is a true statement and a
     poor front door. */
  const fallbackId = (
    runs.data?.data.find((entry) => (entry.nodes?.length ?? 0) > 0) ?? runs.data?.data[0]
  )?.id;
  const selectedId = runRef ?? fallbackId;
  const fetched = useRun(selectedId);

  const run = mockRun ?? fetched.data;
  const failed = useMemo(() => findFailed(runs.data?.data ?? []), [runs.data]);

  const agentName = useMemo(() => {
    if (!run) return "";
    return registry.data?.data.find((agent) => agent.id === run.agentId)?.name ?? run.agentId;
  }, [registry.data, run]);

  /** `agent_compliance` is an id. A rail is for reading, so it gets the name. */
  const nameOf = useMemo(() => {
    const byId = new Map((registry.data?.data ?? []).map((agent) => [agent.id, agent.name]));
    return (entry: AutomationRun) =>
      entry.orchestrator
        ? humanise(entry.orchestrator)
        : (byId.get(entry.agentId) ?? entry.agentId);
  }, [registry.data]);

  const railColumns = useMemo<Column<AutomationRun>[]>(
    () => [
      {
        key: "run",
        label: "Run",
        /* One column, stacked. The rail is 260px wide; a ref, an agent name and
           a status chip laid out as three table columns would scroll sideways,
           and a rail you have to scroll sideways is not a rail. */
        accessor: (entry) => (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[12px] text-ink">{entry.ref}</span>
              <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                {formatDuration(entry.durationMs)}
              </span>
            </div>
            <span className="truncate text-[11px] text-ink-muted">{nameOf(entry)}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusChip tone={RUN_TONE[entry.status]}>{humanise(entry.status)}</StatusChip>
              {entry.failure ? (
                <span className="truncate font-mono text-[11px] text-danger">
                  {entry.failure.code}
                </span>
              ) : null}
            </span>
          </div>
        ),
      },
    ],
    [nameOf],
  );

  if (runs.isPending || fetched.isPending) {
    return <LoadingState rows={10} label="Loading the run trace" />;
  }
  if (runs.isError) {
    return (
      <ErrorState
        title="The run list could not be loaded"
        error={runs.error}
        onRetry={() => void runs.refetch()}
      />
    );
  }
  if (fetched.isError || !run) {
    return (
      <ErrorState
        title="That run could not be loaded"
        error={fetched.error ?? undefined}
        onRetry={() => void fetched.refetch()}
        action={
          <Link className="text-[13px] underline" to={RUNS_PATH}>
            Back to the most recent run
          </Link>
        }
      />
    );
  }

  const nodes = run.nodes ?? [];
  const events = run.events ?? [];
  const steps = run.steps ?? [];
  const haltedNode = nodes.find((node) => node.haltedBy) ?? null;
  const haltedBy = haltedNode?.haltedBy ?? steps.find((step) => step.haltedBy)?.haltedBy ?? null;
  const jury = juryOf(run);
  const subAgents = nodes.filter((node) => node.kind === "SUB_AGENT").length;
  const toolCalls = steps.length || nodes.filter((node) => node.kind === "TOOL").length;

  return (
    <div className="flex flex-col gap-4 pb-10">
      <div className="px-5 pt-4">
        <Breadcrumb
          items={[{ label: "Automation" }, { label: "Runs", href: RUNS_PATH }, { label: run.ref }]}
          linkAs={({ href, children, className }) => (
            <Link to={href} className={className}>
              {children}
            </Link>
          )}
        />
      </div>

      <RecordHeader
        title={`Run ${run.ref} · ${run.orchestrator ? humanise(run.orchestrator) : agentName}`}
        meta={[
          run.trigger.ref ? `trigger ${run.trigger.type} · ${run.trigger.ref}` : run.trigger.type,
          `${subAgents} sub-agents`,
          `${toolCalls} tool calls`,
          haltedBy ? `policy ${haltedBy.policyId} matched` : null,
        ]}
        chips={
          <>
            <StatusChip tone={RUN_TONE[run.status]} live>
              {run.status === "HALTED" ? "Halted at policy" : humanise(run.status)}
            </StatusChip>
            <JuryChip jury={jury} />
          </>
        }
        actions={
          <>
            <SecondaryButton>Download trace</SecondaryButton>
            <SecondaryButton>Replay in sandbox</SecondaryButton>
          </>
        }
        primaryAction={
          haltedBy ? (
            <PrimaryButton>Open approval {haltedBy.approvalRequestRef}</PrimaryButton>
          ) : undefined
        }
        metrics={[
          { label: "Duration", value: formatDuration(run.durationMs) },
          /* Formatted, not passed as Money: MetricCell compacts a Money to
             whole ringgit, and RM 0.38 compacted is RM 0 — a different
             number, on the one metric a reader is most likely to quote. */
          { label: "Cost", value: formatMoney(run.cost) },
          {
            label: "Tokens",
            value: (run.tokens.in + run.tokens.out).toLocaleString("en-MY"),
            sub: `in ${run.tokens.in.toLocaleString("en-MY")} / out ${run.tokens.out.toLocaleString("en-MY")}`,
          },
          {
            label: "Cache hit",
            value:
              typeof run.cacheHitRate === "number" ? `${Math.round(run.cacheHitRate * 100)}%` : "—",
            bar: run.cacheHitRate,
          },
          {
            label: "Tiers used",
            value: run.tiersUsed?.length ?? 0,
            sub: run.tiersUsed?.map((tier) => tier.replace(/_(\d)$/, "-$1")).join(" · "),
          },
        ]}
      />

      {/* The claim, stated once and in the reader's words. §4: the halted state
          must say the agent never sent anything, not merely that a policy fired. */}
      {haltedBy ? (
        <div className="px-5">
          <ExceptionBanner
            severity="WARN"
            title="The agent never sent anything"
            subtitle={`${haltedBy.reason}. Policy ${haltedBy.policyId} stopped the run before the send and raised ${haltedBy.approvalRequestRef} instead. Being stopped is the gate working; a run that had sent this without an approval would be the defect.`}
          />
        </div>
      ) : null}

      {import.meta.env.DEV ? (
        <div className="px-5">
          <RunNowPanel
            onRun={setMockRun}
            showingMock={mockRun !== null}
            onClear={() => setMockRun(null)}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 px-5 xl:grid-cols-[260px_minmax(0,1fr)_330px]">
        {/* ---- Left: the run rail --------------------------------------- */}
        <div className="flex flex-col gap-4">
          <ContentCard title="Recent runs" flush>
            <DataTable
              label="Recent runs"
              density="compact"
              columns={railColumns}
              rows={runs.data.data}
              rowKey={(entry) => entry.id}
              onRowClick={(entry) => navigate(runTracePath(entry.id))}
            />
          </ContentCard>

          {/* The failed variant, with its live checkpoint. A dead-lettered run
              is held for a human, and the two things a human can do to it —
              resume from the checkpoint, or stop retrying — are the only
              actions offered. */}
          {failed ? (
            <div className="flex flex-col gap-2">
              <AgentRunCard
                run={failed}
                withSteps={false}
                agentName={
                  registry.data?.data.find((agent) => agent.id === failed.agentId)?.name ??
                  failed.agentId
                }
                actions={
                  <>
                    <SecondaryButton
                      disabled={retry.isPending}
                      onClick={() => retry.mutate({ id: failed.id, from: "checkpoint" })}
                    >
                      Retry from checkpoint
                    </SecondaryButton>
                    <SecondaryButton
                      disabled={deadLetter.isPending || failed.failure?.deadLettered}
                      onClick={() =>
                        deadLetter.mutate({
                          id: failed.id,
                          reason: "Held for a human after three failed attempts.",
                        })
                      }
                    >
                      Dead-letter
                    </SecondaryButton>
                  </>
                }
              />
              <p className="text-[12px] leading-relaxed text-ink-muted">
                Held for a human. The checkpoint written before the failing step is intact, so a
                retry resumes from there rather than re-running the work that already succeeded.
              </p>
              {retry.isError ? (
                <ExceptionBanner
                  severity="DANGER"
                  title="The retry was refused"
                  subtitle={retry.error.message}
                />
              ) : null}
              {retry.isSuccess ? (
                <ExceptionBanner
                  severity="INFO"
                  title={`Resumed as ${retry.data.ref}`}
                  subtitle="The retry carries the same state card the original run stopped with."
                  action={
                    <Link className="text-[13px] underline" to={runTracePath(retry.data.id)}>
                      Open it
                    </Link>
                  }
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ---- Middle: the execution tree, the steps, the events --------- */}
        <div className="flex min-w-0 flex-col gap-4">
          <ContentCard title="Execution tree" eyebrow={`${nodes.length} nodes`} flush>
            {nodes.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-ink-muted">
                This run recorded no orchestrator tree. Its tool calls are below.
              </p>
            ) : (
              <ul role="tree" aria-label="Execution tree">
                {nodes.map((node) => (
                  <TraceTreeNode key={node.id} node={node} depth={depthOf(node, nodes)} />
                ))}
              </ul>
            )}
          </ContentCard>

          {nodes.length > 0 ? (
            <ContentCard title="Per-node model and spend" flush>
              <NodeCostTable nodes={nodes} />
            </ContentCard>
          ) : null}

          {steps.length > 0 ? (
            <ContentCard title="Tool calls" eyebrow={`${steps.length} steps`} flush>
              {steps.map((step) => (
                <RunStepRow key={step.seq} step={step} expandable />
              ))}
            </ContentCard>
          ) : null}

          <ContentCard title="Events" eyebrow={`${events.length} recorded`} flush>
            {events.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-ink-muted">
                No escalation, jury, truncation, handoff or policy event was recorded for this run.
              </p>
            ) : (
              <ul>
                {/* Keyed by position, not by type-and-timestamp. A real run
                    emits two CHECKPOINTs inside the same second, which made
                    that composite key collide — caught by the mock run, not by
                    the fixture, whose timestamps happen to be distinct. The
                    list is append-only and never reordered, so the index is a
                    stable identity here. */}
                {events.map((event, index) => (
                  <RunEventRow key={`${index}-${event.type}`} event={event} />
                ))}
              </ul>
            )}
          </ContentCard>
        </div>

        {/* ---- Right: the state card ------------------------------------ */}
        <div className="flex flex-col gap-3">
          {run.stateCard ? (
            <StateCardPanel fluid stateCard={run.stateCard} />
          ) : (
            <ContentCard title="State card">
              <p className="text-[13px] text-ink-muted">
                This run kept no state card. Only an orchestrated run carries one — a single-node
                run has nothing to hand forward.
              </p>
            </ContentCard>
          )}
          <p className="text-[12px] leading-relaxed text-ink-muted">
            Per run. Exceeding either budget writes a HANDOFF and restarts the node from this card
            rather than truncating it, so the run keeps its working memory and loses only the
            conversation.
          </p>
          <p className="text-[12px] text-ink-muted">
            Tiers link to{" "}
            <Link className="underline" to="/settings/ai-models">
              Settings › AI Models
            </Link>
            , cost to{" "}
            <Link className="underline" to="/settings/usage">
              Usage
            </Link>
            , the agent to{" "}
            <Link className="underline" to={AGENT_REGISTRY_PATH}>
              the registry
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-node tier, model, cache and spend.
 *
 * §4 wants tier, model, cache-hit, tokens and cost visible per node.
 * `TraceTreeNode` carries the first three in its meta line and deliberately
 * shows only duration and cost on the right — it is a tree, and a tree that
 * also tries to be a table stops reading as either. So the numbers get a real
 * table beside it, and the tree keeps its shape.
 */
function NodeCostTable({ nodes }: { nodes: TraceNode[] }) {
  const columns: Column<TraceNode>[] = [
    {
      key: "name",
      label: "Node",
      accessor: (node) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] text-ink">{node.name}</span>
          <span className="text-[11px] text-ink-muted">{humanise(node.kind)}</span>
        </div>
      ),
    },
    {
      key: "tier",
      label: "Tier · model",
      accessor: (node) =>
        node.tier ? <TierChip tier={node.tier} model={node.model} /> : <span>—</span>,
    },
    {
      key: "provider",
      label: "Provider",
      accessor: (node) => (node.provider ? humanise(node.provider) : "—"),
    },
    {
      key: "cache",
      label: "Cache",
      align: "right",
      accessor: (node) =>
        typeof node.cacheHitRate === "number" ? `${Math.round(node.cacheHitRate * 100)}%` : "—",
    },
    {
      key: "tokens",
      label: "Tokens",
      align: "right",
      accessor: (node) =>
        node.tokens ? (
          <span className="font-mono tabular-nums">
            {(node.tokens.in + node.tokens.out).toLocaleString("en-MY")}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "cost",
      label: "Cost",
      align: "right",
      accessor: (node) => (node.cost ? <MoneyText value={node.cost} /> : "—"),
    },
  ];

  return (
    <DataTable
      label="Per-node model and spend"
      density="compact"
      columns={columns}
      rows={nodes}
      rowKey={(node) => node.id}
    />
  );
}
