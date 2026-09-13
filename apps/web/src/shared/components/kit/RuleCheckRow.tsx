import type { ComplianceCheck } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { CitationChip } from "./CitationChip";
import { StatusChip } from "./StatusChip";
import { humanise } from "./format";
import { CHECK_TONE } from "./statusTone";

/**
 * The rule-check row. Kit.dc.html §10, whose rule is the interesting part:
 * "Every check shows the computed values, not just a verdict, and cites the
 * rule it applied."
 *
 * So the mono line is not optional decoration — it is the working. A row saying
 * only "Pass" asks the reader to trust it; a row saying "grant approved 28 Oct
 * → earliest start 11 Nov → training 12 Nov" lets them check it. The contract
 * supports this directly: `ComplianceCheck` carries `computed` (the inputs and
 * thresholds) and a pre-rendered `display` sentence.
 *
 * Provenance decides the trailing label. §17: a deterministic check carries
 * `method: "DETERMINISTIC"` and no model, and the artboard labels it
 * "Computed · no model"; an interpreted one shows the model and confidence
 * instead. Both are shown, because "a rule said so" and "a model thought so"
 * are different grounds for a compliance decision.
 */

export interface RuleCheckRowProps {
  check: ComplianceCheck;
  /** Opens the rule drawer at this check's rule and source excerpt. */
  onOpenRule?: (ruleId: string) => void;
  /** The citation label, e.g. `§ HRD-014`. Defaults to the rule id. */
  citation?: string;
  className?: string;
}

/**
 * `computed` is an open bag of inputs. When the server sent no pre-rendered
 * `display` sentence, lay the bag out as `key value · key value` rather than
 * dropping it: a raw fact beats a missing one on a compliance screen.
 */
function fallbackWorking(computed: Record<string, unknown>): string {
  return Object.entries(computed)
    .map(([key, value]) => `${humanise(key).toLowerCase()} ${String(value)}`)
    .join(" · ");
}

export function RuleCheckRow({ check, onOpenRule, citation, className }: RuleCheckRowProps) {
  const working = check.display ?? fallbackWorking(check.computed);
  const deterministic = check.provenance.method === "DETERMINISTIC";

  const basis = deterministic
    ? "Computed · no model"
    : [
        check.provenance.model,
        typeof check.provenance.confidence === "number"
          ? `${Math.round(check.provenance.confidence * 100)}%`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className={cn("flex items-start gap-3 border-t border-divider py-2.5", className)}>
      <StatusChip tone={CHECK_TONE[check.state]} className="shrink-0">
        {humanise(check.state)}
      </StatusChip>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-ink">{check.label}</p>
        {working ? <p className="pt-0.5 text-[12px] text-ink-muted">{working}</p> : null}
        {basis ? <p className="pt-0.5 text-[11px] text-ink-muted">{basis}</p> : null}
      </div>

      <CitationChip
        onOpen={onOpenRule ? () => onOpenRule(check.ruleId) : undefined}
        label={`Rule ${check.ruleId}`}
        className="shrink-0"
      >
        {citation ?? `§ ${check.ruleId}`}
      </CitationChip>
    </div>
  );
}
