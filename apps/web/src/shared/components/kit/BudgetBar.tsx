import type { Budget, BudgetState, Money } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { MiniBar, type BarState } from "./Bar";
import { formatMoney } from "./Money";

/**
 * The budget bar. Kit.dc.html §10, and its rule verbatim: "Budget bars stay ink
 * until they near or hit a cap."
 *
 * The colour comes from the contract's `BudgetState`, never from the ratio.
 * That matters: 87% of a cap the server has flagged `NEAR` is amber, and 87% of
 * one it has not is still ink. Inferring the colour here would mean this
 * component deciding policy, and a tripped cap is a policy event — §17 pauses
 * the routing entry and returns `409 AGENT_PAUSED` with `reason: BUDGET_CAP`.
 */

const STATE: Record<BudgetState, BarState> = {
  WITHIN: "within",
  NEAR: "near",
  PAUSED: "over",
};

export interface BudgetBarProps {
  /** Spend, cap and state, straight from `GET /v1/ai/usage`. */
  budget: Pick<Budget, "spend" | "cap" | "state">;
  /** What the budget covers, e.g. "Proposal Agent" or "STRONG-1". */
  label: string;
  className?: string;
}

export function BudgetBar({ budget, label, className }: BudgetBarProps) {
  const ratio = budget.cap.amount === 0 ? 0 : budget.spend.amount / budget.cap.amount;
  const valueText = `${formatMoney(budget.spend)} of ${formatMoney(budget.cap)}`;

  return (
    <div className={cn("flex min-w-[150px] flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate text-ink-secondary">{label}</span>
        <span className="whitespace-nowrap font-mono text-ink-muted">{valueText}</span>
      </div>
      <MiniBar value={ratio} state={STATE[budget.state]} label={label} valueText={valueText} />
      {budget.state === "PAUSED" ? (
        <p role="status" className="text-[11px] text-danger">
          Cap reached · runs requesting this budget are paused
        </p>
      ) : null}
    </div>
  );
}

export interface TokenBudgetBarProps {
  used: number;
  limit: number;
  label?: string;
  className?: string;
}

/** The state card's token budget, same bar, counts rather than money. */
export function TokenBudgetBar({ used, limit, label = "Tokens", className }: TokenBudgetBarProps) {
  const ratio = limit === 0 ? 0 : used / limit;
  const format = (value: number) => new Intl.NumberFormat("en-MY").format(value);
  const valueText = `${format(used)} of ${format(limit)}`;

  return (
    <div className={cn("flex min-w-[150px] flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-ink-secondary">
          {label} {format(used)}
        </span>
        <span className="whitespace-nowrap font-mono text-ink-muted">of {format(limit)}</span>
      </div>
      <MiniBar value={ratio} label={label} valueText={valueText} />
    </div>
  );
}

export interface CostBudgetBarProps {
  used: Money;
  limit: Money;
  label?: string;
  className?: string;
}

/** The state card's cost budget. Same shape, money values. */
export function CostBudgetBar({ used, limit, label = "Cost", className }: CostBudgetBarProps) {
  return (
    <BudgetBar
      label={label}
      budget={{ spend: used, cap: limit, state: "WITHIN" }}
      className={className}
    />
  );
}
