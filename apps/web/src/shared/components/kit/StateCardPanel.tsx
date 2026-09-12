import type { RunStateCard } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { CostBudgetBar, TokenBudgetBar } from "./BudgetBar";
import { MONO_LABEL } from "./tokens";

/**
 * The state-card panel. Kit.dc.html §10, and its reason for existing, verbatim:
 * "A long orchestrator run is not a list of tool calls; it is a working memory
 * that survives restarts."
 *
 * This is the artifact a HANDOFF carries forward and what
 * `POST /v1/runs/{id}/retry?from=checkpoint` resumes from, so it renders the
 * contract's `RunStateCard` completely — goal, plan, decisions, constraints,
 * record pointers, open questions and both budgets. The artboard's sample shows
 * only four of those; the data contract lists all eight, and a section that is
 * empty is simply omitted rather than being unsupported.
 *
 * Placement rule, verbatim: "Right column of the trace viewer, 330px, never
 * inside the tree. It is reference material for the person reading the trace,
 * not part of the execution." The 330px is baked in for that reason — a state
 * card that stretches has been put somewhere it does not belong.
 */

const PLAN_GLYPH: Record<string, { mark: string; className: string }> = {
  DONE: { mark: "✓", className: "text-success" },
  COMPLETE: { mark: "✓", className: "text-success" },
  PENDING: { mark: "·", className: "text-ink-disabled" },
  HALTED: { mark: "⏸", className: "text-primary-hover" },
  FAILED: { mark: "✕", className: "text-danger" },
};

export interface StateCardPanelProps {
  stateCard: RunStateCard;
  /** Let the panel fill its column instead of holding the pack's 330px. */
  fluid?: boolean;
  className?: string;
}

export function StateCardPanel({ stateCard, fluid, className }: StateCardPanelProps) {
  const { goal, plan, decisions, constraints, recordPointers, openQuestions, budgets } = stateCard;

  return (
    <aside
      aria-label="Run state card"
      className={cn(
        "flex flex-col gap-3.5 rounded-card border border-border bg-card p-5",
        fluid ? "min-w-0" : "w-[330px] shrink-0",
        className,
      )}
    >
      <Section title="Goal">
        <p className="text-[13px] leading-relaxed text-ink">{goal}</p>
      </Section>

      {plan.length > 0 ? (
        <Section title="Plan">
          <ol className="flex flex-col gap-1">
            {plan.map((step) => {
              const glyph = PLAN_GLYPH[step.status.toUpperCase()] ?? PLAN_GLYPH.PENDING;
              return (
                <li key={step.n} className="flex items-baseline gap-2 text-[13px] text-ink">
                  <span className="w-3 shrink-0 font-mono text-[11px] text-ink-muted">
                    {step.n}
                  </span>
                  <span className="min-w-0 flex-1">{step.label}</span>
                  <span aria-hidden="true" className={cn("shrink-0", glyph.className)}>
                    {glyph.mark}
                  </span>
                  <span className="sr-only">{step.status.toLowerCase()}</span>
                </li>
              );
            })}
          </ol>
        </Section>
      ) : null}

      {decisions.length > 0 ? (
        <Section title="Decisions">
          <Lines items={decisions} />
        </Section>
      ) : null}

      {constraints.length > 0 ? (
        <Section title="Constraints">
          <Lines items={constraints} />
        </Section>
      ) : null}

      {recordPointers.length > 0 ? (
        <Section title="Records">
          <p className="flex flex-wrap gap-1.5 font-mono text-[11px] text-ink-secondary">
            {recordPointers.map((pointer) => (
              <span key={pointer} className="rounded-[4px] border border-border px-1.5 py-0.5">
                {pointer}
              </span>
            ))}
          </p>
        </Section>
      ) : null}

      {openQuestions.length > 0 ? (
        <Section title="Open questions">
          <Lines items={openQuestions} />
        </Section>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-divider pt-3.5">
        <TokenBudgetBar used={budgets.tokens.used} limit={budgets.tokens.limit} />
        <CostBudgetBar used={budgets.cost.used} limit={budgets.cost.limit} />
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={MONO_LABEL}>{title}</h3>
      {children}
    </section>
  );
}

function Lines({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item} className="text-[13px] leading-relaxed text-ink">
          {item}
        </li>
      ))}
    </ul>
  );
}
