import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Agent, AutonomyGrant } from "@trainos/contract";
import {
  AutonomyChip,
  ContentCard,
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  formatMoney,
  GhostButton,
  humanise,
  JuryChip,
  LoadingState,
  MoneyText,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  RefusalBanner,
  SecondaryButton,
  StatusChip,
  TierChip,
  type Column,
  type PillTab,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { Switch } from "@/shared/components/ui/switch";
import { usePauseAgent, useAgentRegistry } from "./api";
import { AGENT_REGISTRY_PATH, RUNS_PATH } from "./paths";

/**
 * M18-S01 · Agent registry.
 *
 * Primary user: System Admin. Primary button: "Register agent" — a promotion up
 * the autonomy ladder is policy-gated to the MD, so the only thing an admin may
 * do unilaterally from this page is add an agent or pull a kill switch.
 *
 * The table is the screen. Its unusual column is "Autonomy by action type":
 * an agent does not have *an* autonomy, it has one grant per governed action
 * type, and the whole point of DECISIONS §1 is that `PROPOSAL_DRAFT` can be
 * Autonomous on the same agent whose `PROPOSAL_SEND` is capped at
 * act-with-approval. Flattening that to a single chip per row would hide the
 * one fact the page exists to show, so the grants stack inside the cell and
 * each carries its ceiling reason.
 *
 * States rendered (§4): the Knowledge Agent paused after an eval regression,
 * with the reason AND the resume condition stated — a paused agent with no
 * stated way back is an outage, not a control.
 */

const TAB_ALL = "ALL";
const TAB_ATTENTION = "ATTENTION";
const TAB_AUTONOMOUS = "AUTONOMOUS";
const TAB_PAUSED = "PAUSED";

/** An agent needs attention when it is paused, killed, or any grant is paused. */
function needsAttention(agent: Agent): boolean {
  return (
    agent.status === "PAUSED" || agent.killSwitch || agent.autonomy.some((grant) => grant.paused)
  );
}

function hasAutonomous(agent: Agent): boolean {
  return agent.autonomy.some((grant) => grant.level === "AUTONOMOUS");
}

/**
 * `PROPOSAL_SEND` → `Proposal send`. The contract speaks enums; a reader does
 * not.
 *
 * `humanise` sentence-cases the whole string, which turns the two acronyms in
 * this enum into words nobody uses: "Tna recommendation accept" and "Hrdc
 * packet mark submitted". They are restored here rather than in the kit,
 * because this is the only table that prints a `GovernedActionType` in full.
 */
const ACRONYM_CASE: Record<string, string> = { Tna: "TNA", Hrdc: "HRD Corp" };

function actionLabel(actionType: AutonomyGrant["actionType"]): string {
  return humanise(actionType).replace(/\b(Tna|Hrdc)\b/g, (word) => ACRONYM_CASE[word] ?? word);
}

function AutonomyCell({ grants }: { grants: AutonomyGrant[] }) {
  if (grants.length === 0) {
    return <span className="text-[12px] text-ink-muted">No governed actions</span>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {grants.map((grant) => (
        /* Label above chip, not beside it. The chips hold a fixed 118px so the
           ladder lines up as a column down the table — the artboard's own
           reason — and a label beside one would push that column ragged. */
        <li key={grant.actionType} className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-secondary">{actionLabel(grant.actionType)}</span>
          <span className="flex flex-wrap items-center gap-2">
            <AutonomyChip level={grant.level} />
            {grant.paused ? (
              <StatusChip tone="warning" shape="square">
                Paused
              </StatusChip>
            ) : null}
            {/* The ceiling is the interesting half of the grant: it says what
                this action type may NEVER become, and why. Without it a reader
                cannot tell a deliberate cap from a setting nobody raised. */}
            {grant.ceiling && grant.ceiling !== grant.level ? (
              <span className="text-[11px] text-ink-muted">
                ceiling {humanise(grant.ceiling).toLowerCase()}
                {grant.ceilingReason ? ` · ${humanise(grant.ceilingReason).toLowerCase()}` : ""}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AgentRegistryScreen() {
  /* The breadcrumb lives in the Topbar, not in the content card. CLAUDE.md:
     the breadcrumb owns the path and RecordHeader owns the identity, and a
     trail inside the card breaks both halves at once. */
  useBreadcrumb([{ label: "Automation" }, { label: "Agents" }, { label: "Registry" }]);

  const registry = useAgentRegistry();
  const pause = usePauseAgent();
  const [tab, setTab] = useState<string>(TAB_ALL);

  const agents = useMemo(() => registry.data?.data ?? [], [registry.data]);

  const tabs = useMemo<PillTab[]>(
    () => [
      { id: TAB_ALL, label: "All", count: agents.length },
      {
        id: TAB_ATTENTION,
        label: "Needs attention",
        count: agents.filter(needsAttention).length,
      },
      { id: TAB_AUTONOMOUS, label: "Autonomous", count: agents.filter(hasAutonomous).length },
      {
        id: TAB_PAUSED,
        label: "Paused",
        count: agents.filter((agent) => agent.status === "PAUSED").length,
      },
    ],
    [agents],
  );

  const rows = useMemo(() => {
    if (tab === TAB_ATTENTION) return agents.filter(needsAttention);
    if (tab === TAB_AUTONOMOUS) return agents.filter(hasAutonomous);
    if (tab === TAB_PAUSED) return agents.filter((agent) => agent.status === "PAUSED");
    return agents;
  }, [agents, tab]);

  /* The paused agent drives the page banner. One banner, at the top, outside
     any scroll pane — three of these teach a reader to ignore all of them. */
  const paused = agents.find((agent) => agent.status === "PAUSED");

  const columns = useMemo<Column<Agent>[]>(
    () => [
      {
        key: "name",
        label: "Agent",
        accessor: (agent) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] font-medium text-ink">{agent.name}</span>
            <span className="truncate text-[11px] text-ink-muted">{agent.scopes.join(", ")}</span>
          </div>
        ),
        width: "165px",
      },
      {
        key: "status",
        label: "Status",
        accessor: (agent) => (
          <StatusChip tone={agent.status === "PAUSED" ? "warning" : "neutral"}>
            {humanise(agent.status)}
          </StatusChip>
        ),
        width: "95px",
      },
      {
        key: "autonomy",
        label: "Autonomy by action type",
        accessor: (agent) => <AutonomyCell grants={agent.autonomy} />,
      },
      {
        key: "tier",
        label: "Default tier",
        accessor: (agent) => (agent.defaultTier ? <TierChip tier={agent.defaultTier} /> : "—"),
        width: "110px",
      },
      {
        key: "jury",
        label: "Jury",
        accessor: (agent) => (
          /* The chip takes the POLICY, not a fabricated result. A configured
             jury has not voted, so there is nothing honest to put in
             `agreed[]`; the kit renders the mode and tints only ESCALATE,
             which is the only mode that can stand between a user and the
             action in front of them. */
          <JuryChip policy={agent.jury} />
        ),
        width: "105px",
      },
      {
        key: "cache",
        label: "Cache 30d",
        align: "right",
        accessor: (agent) =>
          typeof agent.cacheHitRate30d === "number"
            ? `${Math.round(agent.cacheHitRate30d * 100)}%`
            : "—",
        width: "85px",
      },
      {
        /* Two facts, one column. Eleven columns do not fit 1440px beside a
           240px rail, and the per-run cost is only ever read against the
           month's — never on its own. */
        key: "cost",
        label: "Cost",
        align: "right",
        accessor: (agent) => (
          <div className="flex flex-col items-end gap-0.5 whitespace-nowrap">
            <MoneyText value={agent.costMonth} />
            <span className="whitespace-nowrap text-[11px] text-ink-muted">
              {agent.costPerRun30d ? `${formatMoney(agent.costPerRun30d)} / run` : "no runs"}
            </span>
          </div>
        ),
        width: "132px",
      },
      {
        key: "eval",
        label: "Eval",
        align: "right",
        accessor: (agent) => (
          <span className="font-mono tabular-nums">{agent.evalScore.toFixed(2)}</span>
        ),
        width: "70px",
      },
      {
        key: "lastRun",
        label: "Last run",
        accessor: (agent) =>
          agent.status === "PAUSED" && agent.pausedAt ? (
            <span className="text-[12px] text-ink-muted">
              paused <DateText value={agent.pausedAt} />
            </span>
          ) : (
            <DateText value={agent.lastRunAt} withTime className="text-[12px] text-ink-secondary" />
          ),
        width: "125px",
      },
      {
        key: "kill",
        label: "Kill switch",
        accessor: (agent) => (
          <Switch
            checked={agent.killSwitch || agent.status === "PAUSED"}
            disabled={pause.isPending}
            aria-label={`Kill switch for ${agent.name}`}
            onCheckedChange={() => pause.mutate({ id: agent.id, body: { actionType: null } })}
          />
        ),
        width: "85px",
      },
    ],
    [pause],
  );

  if (registry.isPending) return <LoadingState rows={8} label="Loading the agent registry" />;
  if (registry.isError) {
    return (
      <ErrorState
        title="The agent registry could not be loaded"
        error={registry.error}
        onRetry={() => void registry.refetch()}
      />
    );
  }

  const summary = registry.data.summary;
  const pausedGrants = agents.reduce(
    (total, agent) => total + agent.autonomy.filter((grant) => grant.paused).length,
    0,
  );

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="Agents"
        meta={[
          `${agents.length} registered`,
          `${agents.filter((agent) => agent.status === "PAUSED").length} paused`,
          pausedGrants > 0 ? `${pausedGrants} action types paused` : null,
        ]}
        actions={
          <>
            <SecondaryButton>Autonomy ladder</SecondaryButton>
            <SecondaryButton>Eval dashboard</SecondaryButton>
          </>
        }
        primaryAction={<PrimaryButton>Register agent</PrimaryButton>}
        metrics={[
          { label: "Actions this month", value: summary.actionsMonth.toLocaleString("en-MY") },
          {
            label: "Cost",
            value: formatMoney(summary.cost),
            sub: `of ${formatMoney(summary.budget, true)} budget`,
            bar: summary.budget.amount === 0 ? 0 : summary.cost.amount / summary.budget.amount,
          },
          { label: "Approvals raised", value: summary.approvalsRaised },
          {
            label: "Auto-approved",
            value: summary.autoApproved,
            sub: "no money at Autonomous",
          },
          { label: "Median eval", value: summary.medianEval.toFixed(2) },
          { label: "Incidents", value: summary.incidents30d, sub: "30 days" },
        ]}
      />

      {paused ? (
        <div className="px-5">
          <ExceptionBanner
            severity="WARN"
            title={`${paused.name} paused since ${formatPausedAt(paused)}`}
            subtitle={pausedExplanation(paused)}
            action={<GhostButton>Open evals</GhostButton>}
          />
        </div>
      ) : null}

      <div className="px-5">
        <PillTabGroup tabs={tabs} activeId={tab} onSelect={setTab} label="Agent filters" />
      </div>

      <div className="px-5">
        <ContentCard flush>
          <DataTable
            label="Agent registry"
            columns={columns}
            rows={rows}
            rowKey={(agent) => agent.id}
            stickyHeader
            empty={
              <EmptyState
                title="No agents in this view"
                description="Every registered agent is outside the filter you have selected."
              />
            }
          />
        </ContentCard>
      </div>

      {pause.isError ? (
        <div className="px-5">
          <RefusalBanner title="The kill switch was refused" error={pause.error} />
        </div>
      ) : null}

      <p className="px-5 text-[12px] leading-relaxed text-ink-muted">
        A kill switch is immediate and audited — it does not wait for an approval, because an agent
        that needs a second signature to stop is not a kill switch. Raising an agent up the autonomy
        ladder is the opposite: it is gated to the MD, and money-moving action types are capped at
        act-with-approval whatever the jury says.
      </p>
      <p className="px-5 text-[12px] text-ink-muted">
        Runs and traces for every agent are at{" "}
        <Link className="underline" to={RUNS_PATH}>
          Automation › Runs
        </Link>
        .
      </p>
    </div>
  );
}

function formatPausedAt(agent: Agent): string {
  if (!agent.pausedAt) return "an unrecorded time";
  const parsed = new Date(agent.pausedAt);
  return Number.isNaN(parsed.getTime())
    ? "an unrecorded time"
    : parsed.toLocaleDateString("en-MY", { day: "2-digit", month: "short" });
}

/**
 * Why it stopped AND what would let it start again.
 *
 * §4's "states rendered" asks for both. A resume condition the server holds
 * (`evalScore >= 0.85`) is rendered from the record rather than described in
 * prose, so the page cannot drift from the rule the server will actually apply.
 */
function pausedExplanation(agent: Agent): string {
  const reason = agent.pausedReason
    ? `${humanise(agent.pausedReason)} · eval ${agent.evalScore.toFixed(2)}`
    : `Eval ${agent.evalScore.toFixed(2)}`;
  const resume = agent.resumeCondition
    ? ` Resume requires ${agent.resumeCondition.metric} ${resumeOperator(agent.resumeCondition.op)} ${agent.resumeCondition.value}.`
    : " No resume condition is recorded, so this agent cannot restart itself.";
  return `${reason}.${resume}`;
}

function resumeOperator(op: string): string {
  if (op === "gte") return "at or above";
  if (op === "gt") return "above";
  if (op === "lte") return "at or below";
  if (op === "lt") return "below";
  return op;
}
