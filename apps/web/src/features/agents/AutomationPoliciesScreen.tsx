import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ApprovalRequest, Policy } from "@trainos/contract";
import {
  ContentCard,
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  EscalationLadder,
  FilterBar,
  LifecycleStepper,
  ListToolbar,
  LoadingState,
  PillTabGroup,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  humanise,
  type Column,
  type LadderRung as KitLadderRung,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { APPROVALS_PATH } from "@/features/approvals";
import { useApprovalQueue, usePipelineConfig, usePolicies } from "./api";

/**
 * `/automation/policies` — the gates, and what is queued against each one.
 *
 * M20-S07 is cited by the LifecycleStepper rule and never drawn, so this is
 * invented under the standing rules. The distinction from `/settings/policies`
 * is the whole reason both exist and is worth stating plainly:
 *
 *   · THIS screen is operational. Which gates are firing right now, how many
 *     decisions are queued behind each, and how long they have been waiting.
 *   · `/settings/policies` is the rule text — conditions, combinator,
 *     thresholds, SLA minutes. What the gate IS rather than what it is doing.
 *
 * Both read `GET /v1/policies`; neither redraws the other's columns. Two views
 * of one record is not the divergence CLAUDE.md forbids — two components for
 * one pattern is, and both use the same kit table.
 *
 * THE STEPPER, AND WHAT IS NOT INVENTED. Each row renders its own approval
 * chain — requested, the approving role, the escalation role if the policy has
 * one — as an inline `LifecycleStepper` built from the policy record. That is
 * §11a's inline stepper: server data, never text.
 *
 * The engagement pipeline is drawn once at the top from
 * `GET /v1/config/pipelines`, because CLAUDE.md says stage names and order come
 * from configuration and never from the client. It is drawn as a REFERENCE —
 * every stage neutral, captioned as the configured pipeline — and no policy is
 * mapped onto a stage. The correspondence is suggestive (`ATTENDANCE_APPROVE`
 * beside `ATTENDANCE_LOCKED`, `INVOICE_CREATE` beside `INVOICED`) and the
 * contract publishes none of it. A client-side map over a vocabulary another
 * lane owns is exactly the seam R14 is about: it would not break when the
 * server changed, it would quietly point at the wrong stage.
 */

const TABS = {
  queued: "Decisions waiting",
  escalating: "With an escalation",
  all: "All policies",
} as const;

type TabId = keyof typeof TABS;

/**
 * The approval chain this policy describes, as ladder rungs.
 *
 * `EscalationLadder`, not `LifecycleStepper`. The kit already owns the "when X,
 * this happens, and it needs role Y" shape — the collections cadence renders
 * through it — and a policy's approval chain is that shape exactly. Reaching
 * for the lifecycle stepper here would have been a second visual language for a
 * problem the kit already solves, which CLAUDE.md calls a defect. The stepper
 * keeps the job it is for on this page: drawing the configured pipeline, whose
 * steps really are pipeline stages.
 *
 * `autonomy` is deliberately left off every rung. The kit reads an absent
 * autonomy as "a human does this", and that is the whole point of a gate.
 */
function chainOf(policy: Policy, waiting: number): KitLadderRung[] {
  const rungs: KitLadderRung[] = [
    {
      when: "On request",
      action: `${humanise(policy.actionType)} is held`,
      state: "done",
    },
    {
      when: `Within ${policy.slaMinutes} minutes`,
      action: `${humanise(policy.approverRole)} decides`,
      state: waiting > 0 ? "current" : "pending",
      ...(waiting > 0
        ? { note: `${waiting} waiting now` }
        : { note: "nothing queued against this gate" }),
    },
  ];

  if (policy.escalateToRole) {
    rungs.push({
      when: policy.escalateAfterMinutes
        ? `After ${policy.escalateAfterMinutes} minutes`
        : "On escalation",
      action: `Escalates to ${humanise(policy.escalateToRole)}`,
      state: "pending",
    });
  }

  return rungs;
}

export function AutomationPoliciesScreen() {
  useBreadcrumb([{ label: "Automation" }, { label: "Policies" }]);

  const navigate = useNavigate();
  const policies = usePolicies();
  const approvals = useApprovalQueue();
  const pipeline = usePipelineConfig("ENGAGEMENT");

  const [tab, setTab] = useState<TabId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** How many live decisions each policy is holding. */
  const waitingByPolicy = useMemo(() => {
    const index = new Map<string, number>();
    for (const approval of approvals.data?.data ?? []) {
      if (approval.status !== "PENDING") continue;
      index.set(approval.policyId, (index.get(approval.policyId) ?? 0) + 1);
    }
    return index;
  }, [approvals.data]);

  const breachingByPolicy = useMemo(() => {
    const index = new Map<string, number>();
    for (const approval of approvals.data?.data ?? []) {
      if (!approval.slaBreached) continue;
      index.set(approval.policyId, (index.get(approval.policyId) ?? 0) + 1);
    }
    return index;
  }, [approvals.data]);

  const rows = useMemo(() => policies.data?.data ?? [], [policies.data]);

  const visible = useMemo(() => {
    if (tab === "queued") return rows.filter((policy) => (waitingByPolicy.get(policy.id) ?? 0) > 0);
    if (tab === "escalating") return rows.filter((policy) => Boolean(policy.escalateToRole));
    return rows;
  }, [rows, tab, waitingByPolicy]);

  /** The selected gate, or the first one the current view offers. */
  const selected = useMemo(
    () => visible.find((policy) => policy.id === selectedId) ?? visible[0] ?? null,
    [visible, selectedId],
  );

  /** The live queue for the selected gate, oldest first. */
  const queued = useMemo<ApprovalRequest[]>(() => {
    if (!selected) return [];
    return (approvals.data?.data ?? [])
      .filter((approval) => approval.policyId === selected.id && approval.status === "PENDING")
      .sort((left, right) => left.slaDueAt.localeCompare(right.slaDueAt));
  }, [approvals.data, selected]);

  const countOf = (id: TabId) => {
    if (id === "queued") return rows.filter((p) => (waitingByPolicy.get(p.id) ?? 0) > 0).length;
    if (id === "escalating") return rows.filter((p) => Boolean(p.escalateToRole)).length;
    return rows.length;
  };

  const columns: Column<Policy>[] = [
    {
      key: "policy",
      label: "Gate",
      accessor: (policy) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{humanise(policy.actionType)}</p>
          <p className="truncate text-[12px] text-ink-muted">{policy.description}</p>
        </div>
      ),
    },
    {
      key: "approver",
      label: "Who decides",
      width: "168px",
      accessor: (policy) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] text-ink">{humanise(policy.approverRole)}</p>
          {policy.escalateToRole ? (
            <p className="truncate text-[11px] text-ink-muted">
              {`then ${humanise(policy.escalateToRole)}`}
            </p>
          ) : (
            <p className="truncate text-[11px] text-ink-muted">no escalation</p>
          )}
        </div>
      ),
    },
    {
      key: "waiting",
      label: "Waiting",
      width: "132px",
      accessor: (policy) => {
        const waiting = waitingByPolicy.get(policy.id) ?? 0;
        const breaching = breachingByPolicy.get(policy.id) ?? 0;
        if (waiting === 0) {
          return <span className="text-[12px] text-ink-muted">Nothing queued</span>;
        }
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusChip tone={breaching > 0 ? "danger" : "warning"}>
              {`${waiting} waiting`}
            </StatusChip>
            {breaching > 0 ? (
              <span className="text-[11px] text-ink-muted">{`${breaching} past SLA`}</span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "sla",
      label: "SLA",
      width: "92px",
      align: "right",
      accessor: (policy) => (
        <span className="tabular-nums text-ink-secondary">{`${policy.slaMinutes} min`}</span>
      ),
    },
  ];

  if (policies.isPending) return <LoadingState rows={8} label="Loading the policies" />;
  if (policies.isError) {
    return (
      <ErrorState
        title="The policies could not be loaded"
        error={policies.error}
        onRetry={() => void policies.refetch()}
      />
    );
  }

  const totalWaiting = [...waitingByPolicy.values()].reduce((sum, count) => sum + count, 0);

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="Automation policies"
        meta={[
          `${rows.length} gates`,
          approvals.isError ? "queue counts unavailable" : `${totalWaiting} decisions waiting`,
        ]}
        actions={
          <SecondaryButton onClick={() => navigate(APPROVALS_PATH)}>Approval inbox</SecondaryButton>
        }
        /* No primary. `GET /v1/policies` is read-only for the demo, and a solid
           button that cannot write is a promise the API does not keep. */
      />

      {approvals.isError ? (
        <div className="px-5">
          <ErrorState
            title="The approval queue could not be counted"
            /* Not swallowed into a zero. "Nothing queued" and "we could not ask"
               look identical in a count column, and only one of them is safe to
               act on. */
            error={approvals.error}
            onRetry={() => void approvals.refetch()}
          />
        </div>
      ) : null}

      <div className="px-5">
        <ContentCard title="The engagement pipeline these gates sit in">
          {pipeline.isPending ? (
            <LoadingState rows={2} label="Loading the pipeline configuration" />
          ) : null}

          {pipeline.isError ? (
            <ErrorState
              title="The pipeline configuration could not be loaded"
              error={pipeline.error}
              onRetry={() => void pipeline.refetch()}
            />
          ) : null}

          {pipeline.data ? (
            <>
              <LifecycleStepper
                variant="header"
                stages={pipeline.data.stages}
                /* Every stage neutral. This is the CONFIGURED pipeline, not a
                   record moving through it, and a stage painted "current" here
                   would be claiming a position no record holds. */
                steps={pipeline.data.stages.map((stage) => ({
                  key: stage.key,
                  label: stage.label,
                  state: "PENDING" as const,
                }))}
              />
              <p className="pt-3 text-[12px] leading-relaxed text-ink-muted">
                Stage names and order come from{" "}
                <span className="font-mono text-[11px]">GET /v1/config/pipelines</span>, never from
                this screen. No policy is drawn against a stage: the contract publishes no link
                between the two, and a mapping written here would keep pointing somewhere after the
                server moved.
              </p>
            </>
          ) : null}
        </ContentCard>
      </div>

      <div className="px-5">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Policy views"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={(Object.keys(TABS) as TabId[]).map((id) => ({
                id,
                label: TABS[id],
                count: countOf(id),
              }))}
            />
          }
          filters={<FilterBar filters={[]} shown={visible.length} total={rows.length} />}
        />
      </div>

      {/* Master and detail, the Collections composition the tightening brief
          names as the target look: the list answers "which gates are busy",
          the panel answers "and then what happens to this one". */}
      {/* Deliberately NOT the kit's `SplitWorkspace`, and the reason is not
          that this predates it.

          `SplitWorkspace` is the QUEUE-and-RECORD split: a narrow scanning
          pane capped at 40% beside a wider record the reader reads, both
          scrolling independently inside a full-height flex column, with a
          sticky header on the record. The enquiry, follow-up, leads and
          contacts screens are that shape and use it.

          This screen is the other shape: a WIDE TABLE beside a narrow
          reference card, on a page that scrolls as one. Capping the table at
          40% is what put the last two columns off the right edge in the first
          place, and this component has no full-height flex parent for the
          panes to size against, so they would collapse rather than scroll.

          Two shapes, not two variants of one — so this is not the divergence
          CLAUDE.md forbids. If the kit grows a named component for the
          table-and-reference shape, this becomes a migration in that pass.
          Flagged to the lead 13 Sep. */}
      <div className="grid grid-cols-1 gap-5 px-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <DataTable
          label="Approval policies"
          columns={columns}
          rows={visible}
          rowKey={(policy) => policy.id}
          onRowClick={(policy) => setSelectedId(policy.id)}
          empty={
            <EmptyState
              title={tab === "queued" ? "No decision is waiting" : "No policy in this view"}
              description={
                tab === "queued"
                  ? "Every gate is clear. A policy appears here the moment an action trips it and a person has to decide."
                  : "No configured policy matches this view. Switch views to see the rest."
              }
            />
          }
        />

        {selected ? (
          <ContentCard
            title={humanise(selected.actionType)}
            actions={
              queued.length > 0 ? (
                <SecondaryButton onClick={() => navigate(APPROVALS_PATH)}>
                  Open the queue
                </SecondaryButton>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-4">
              <p className="text-[13px] leading-relaxed text-ink-secondary">
                {selected.description}
              </p>

              <EscalationLadder
                label={`What happens to a held ${humanise(selected.actionType).toLowerCase()}`}
                rungs={chainOf(selected, queued.length)}
              />

              {queued.length > 0 ? (
                <div className="flex flex-col gap-1.5 border-t border-divider pt-3">
                  <p className="text-[12px] font-medium text-ink">
                    {`${queued.length} waiting, oldest first`}
                  </p>
                  {queued.slice(0, 4).map((approval) => (
                    <div key={approval.id} className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-ink-muted">{approval.ref}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">
                        {approval.subject}
                      </span>
                      <DateText
                        value={approval.slaDueAt}
                        withTime
                        className="whitespace-nowrap text-[11px] tabular-nums text-ink-muted"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                /* Not an EmptyState: the panel is not empty, the queue is, and
                   a full empty-state block for one true sentence would shout. */
                <p className="border-t border-divider pt-3 text-[12px] text-ink-muted">
                  Nothing is held against this gate right now.
                </p>
              )}
            </div>
          </ContentCard>
        ) : null}
      </div>

      <p className="px-5 text-[12px] leading-relaxed text-ink-muted">
        A policy decides whether an action executes, queues for a human, or comes back as a
        suggestion. The rule text — conditions, thresholds and who may change them — lives in
        Settings; this page is about what the gates are doing right now.
      </p>
    </div>
  );
}
