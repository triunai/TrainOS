import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Policy, PolicyCondition } from "@trainos/contract";
import {
  ContentCard,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  ListToolbar,
  LoadingState,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  formatMoney,
  humanise,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { AUTOMATION_POLICIES_PATH } from "@/features/agents";
import { usePolicies } from "./api";

/**
 * `/settings/policies` — the rule text behind every approval gate.
 *
 * The sibling at `/automation/policies` is the operational view: which gates
 * are firing and what is queued behind them. This one is the configuration:
 * what the gate IS. Two views of one record, each answering a question the
 * other cannot — not two components for one pattern, which is the divergence
 * CLAUDE.md forbids. Both use the same kit table, and each links to the other.
 *
 * A CONDITION IS RENDERED, NOT DESCRIBED. `PolicyCondition` is a dotted path,
 * an operator and a value, and the temptation is to write English for each
 * known combination. That is the R14 shape: a two-branch translation over a
 * vocabulary the server owns silently produces the wrong sentence the day a new
 * operator appears. So the path and the operator are printed as the server
 * sent them, in mono, and only the VALUE is formatted — because a money value
 * arrives as integer sen and `1500000` on screen would be a lie of four orders
 * of magnitude.
 *
 * READ-ONLY, AND IT SAYS SO. §2's own words: "GET /v1/policies — read-only for
 * the demo." There is no write, so there is no button and no disabled button
 * either; the page names who would have to make the change.
 */

const TABS = {
  all: "All gates",
  escalating: "With an escalation",
  money: "Money-moving",
} as const;

type TabId = keyof typeof TABS;

/**
 * A condition's value, rendered as what it is.
 *
 * The only formatting applied. A field path ending in `.amount` is money in
 * integer minor units — §1 is explicit that money is always sen — and printing
 * the raw integer would show RM 15,000 as 1500000. Everything else is printed
 * as JSON so a boolean reads as `true` and a string keeps its quotes.
 */
function conditionValue(condition: PolicyCondition): string {
  if (condition.field.endsWith(".amount") && typeof condition.value === "number") {
    return formatMoney({ amount: condition.value, currency: "MYR" });
  }
  return JSON.stringify(condition.value) ?? "null";
}

/** Gates over an action type that moves money or commits to a client. */
function movesMoney(policy: Policy): boolean {
  return policy.conditions.some((condition) => condition.field.endsWith(".amount"));
}

export function PoliciesSettingsScreen() {
  useBreadcrumb([{ label: "Settings" }, { label: "Policies" }]);

  const policies = usePolicies();
  const [tab, setTab] = useState<TabId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => policies.data?.data ?? [], [policies.data]);

  const visible = useMemo(() => {
    if (tab === "escalating") return rows.filter((policy) => Boolean(policy.escalateToRole));
    if (tab === "money") return rows.filter(movesMoney);
    return rows;
  }, [rows, tab]);

  const selected = useMemo(
    () => visible.find((policy) => policy.id === selectedId) ?? visible[0] ?? null,
    [visible, selectedId],
  );

  const countOf = (id: TabId) => {
    if (id === "escalating") return rows.filter((policy) => Boolean(policy.escalateToRole)).length;
    if (id === "money") return rows.filter(movesMoney).length;
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
      key: "when",
      label: "Fires when",
      width: "168px",
      accessor: (policy) =>
        policy.conditions.length === 0 ? (
          /* No conditions is not "never" — it is "always", and the two read
             identically in an empty cell. */
          <span className="text-[12px] text-ink-secondary">Every time</span>
        ) : (
          <span className="text-[12px] text-ink-secondary">
            {`${policy.conditions.length} condition${policy.conditions.length === 1 ? "" : "s"} · ${policy.combinator === "ANY" ? "any" : "all"}`}
          </span>
        ),
    },
    {
      key: "approver",
      label: "Approver",
      width: "148px",
      accessor: (policy) => <StatusChip tone="neutral">{humanise(policy.approverRole)}</StatusChip>,
    },
    {
      key: "sla",
      label: "SLA",
      width: "88px",
      align: "right",
      accessor: (policy) => (
        <span className="tabular-nums text-ink-secondary">{`${policy.slaMinutes} min`}</span>
      ),
    },
    {
      key: "escalation",
      label: "Escalates",
      width: "160px",
      accessor: (policy) =>
        policy.escalateToRole ? (
          <span className="text-[12px] text-ink-secondary">
            {`${humanise(policy.escalateToRole)}${policy.escalateAfterMinutes ? ` · ${policy.escalateAfterMinutes} min` : ""}`}
          </span>
        ) : (
          <span className="text-[12px] text-ink-muted">No escalation</span>
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

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="Approval policies"
        meta={[
          `${rows.length} gates`,
          `${rows.filter((policy) => policy.escalateToRole).length} escalate`,
          "read-only",
        ]}
        /* No primary, and no disabled one either: §2 says this endpoint is
           read-only, so a Save button would be an affordance for a write that
           does not exist. */
      />

      <div className="px-5">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Policy views"
              activeId={tab}
              onSelect={(id) => {
                setTab(id as TabId);
                setSelectedId(null);
              }}
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

      <div className="grid grid-cols-1 gap-5 px-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <DataTable
          label="Approval policies"
          columns={columns}
          rows={visible}
          rowKey={(policy) => policy.id}
          onRowClick={(policy) => setSelectedId(policy.id)}
          empty={
            <EmptyState
              title="No policy in this view"
              description="No configured gate matches this view. Switch views to see the rest of the rules."
            />
          }
        />

        {selected ? (
          <ContentCard
            title={humanise(selected.actionType)}
            actions={<span className="font-mono text-[11px] text-ink-muted">{selected.id}</span>}
          >
            <div className="flex flex-col gap-4">
              <p className="text-[13px] leading-relaxed text-ink-secondary">
                {selected.description}
              </p>

              <div className="flex flex-col gap-2 border-t border-divider pt-3">
                <p className="text-[12px] font-medium text-ink">
                  {selected.conditions.length === 0
                    ? "Conditions"
                    : `Conditions · ${selected.combinator === "ANY" ? "any one is enough" : "all must hold"}`}
                </p>

                {selected.conditions.length === 0 ? (
                  <p className="text-[12px] leading-relaxed text-ink-muted">
                    No condition. This gate fires on every request of this type — which is the point
                    for an action that is always somebody&rsquo;s decision, like locking attendance.
                  </p>
                ) : (
                  selected.conditions.map((condition) => (
                    <div
                      key={`${condition.field}-${condition.op}`}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px]"
                    >
                      {/* Printed as the server sent it. Translating a dotted
                          path and an operator into English is the seam that
                          quietly says the wrong thing when a new operator
                          arrives. */}
                      <span className="font-mono text-ink">{condition.field}</span>
                      <span className="font-mono text-ink-muted">{condition.op}</span>
                      <span className="font-medium text-ink">{conditionValue(condition)}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="flex flex-col gap-1.5 border-t border-divider pt-3 text-[12px]">
                <div className="flex items-baseline gap-2">
                  <span className="w-28 shrink-0 text-ink-muted">Decided by</span>
                  <span className="text-ink">{humanise(selected.approverRole)}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="w-28 shrink-0 text-ink-muted">Within</span>
                  <span className="tabular-nums text-ink">{`${selected.slaMinutes} minutes`}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="w-28 shrink-0 text-ink-muted">Then</span>
                  <span className="text-ink">
                    {selected.escalateToRole
                      ? `${humanise(selected.escalateToRole)}${selected.escalateAfterMinutes ? `, after ${selected.escalateAfterMinutes} minutes` : ""}`
                      : "Stays with the approver"}
                  </span>
                </div>
              </div>

              <p className="border-t border-divider pt-3 text-[12px] leading-relaxed text-ink-muted">
                Policies are read-only in this console. Changing a gate, its threshold or its
                approver is an administrator&rsquo;s job, and a request already queued keeps the
                rule it was raised under. What each gate is holding right now is on{" "}
                <Link className="underline" to={AUTOMATION_POLICIES_PATH}>
                  Automation › Policies
                </Link>
                .
              </p>
            </div>
          </ContentCard>
        ) : null}
      </div>
    </div>
  );
}
