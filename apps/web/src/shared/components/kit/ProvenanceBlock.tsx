import type { Provenance } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { DateText } from "./DateText";
import { SECTION_LABEL } from "./tokens";

/**
 * The canonical provenance block. Kit.dc.html §05, verbatim: two lines, six
 * facts. Line 1 is the AI marker, agent + run + source count, then
 * model/provider/cache-hit/tier in mono. Line 2 is the decision line — who
 * approved it, when, and what they edited, with links to sources and trace.
 *
 * "Nothing else belongs in this block; evidence and diffs live on the approval
 * screen instead." So this renders provenance and refuses to grow: no verdict,
 * no rationale, no diff. Those have their own components.
 *
 * Because the contract's `Provenance` is exactly the badge popover's field set
 * (§1 note: "The AI badge popover renders exactly these fields, so no screen
 * composes that string itself"), this component takes the envelope whole and
 * every screen passes it through untouched.
 */

export interface ProvenanceBlockProps {
  provenance: Provenance;
  /** Reasoning prose, shown above the facts. The popover's first line in §02. */
  reasoning?: string;
  /** Opens the cited sources, usually in the audit drawer. */
  onOpenSources?: () => void;
  /** Opens the orchestrator trace for `runId`. */
  onOpenTrace?: () => void;
  className?: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Anthropic",
  GOOGLE: "Google",
  OPENAI: "OpenAI",
  DEEPSEEK: "DeepSeek",
};

export function ProvenanceBlock({
  provenance,
  reasoning,
  onOpenSources,
  onOpenTrace,
  className,
}: ProvenanceBlockProps) {
  const {
    agentId,
    runId,
    sources,
    model,
    provider,
    cacheHitRate,
    tier,
    method,
    editedBy,
    generatedAt,
  } = provenance;

  /* A deterministic check carries `method: "DETERMINISTIC"` and no model
     (contract §17). Saying so plainly is more useful than an empty model line:
     it tells the reader there is nothing to second-guess. */
  const deterministic = method === "DETERMINISTIC";

  const identity = [
    agentId,
    runId ? `run ${runId}` : null,
    sources?.length ? `${sources.length} source${sources.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  const routing = deterministic
    ? ["Computed · no model"]
    : [
        model,
        provider ? `via ${PROVIDER_LABEL[provider] ?? provider}` : null,
        typeof cacheHitRate === "number" ? `cache ${Math.round(cacheHitRate * 100)}%` : null,
        tier ? tier.replace(/_/g, "-") : null,
      ].filter(Boolean);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {reasoning ? (
        <p className="text-[12px] leading-relaxed text-ink-secondary">{reasoning}</p>
      ) : null}

      {identity.length > 0 ? (
        <p className="font-mono text-[11px] text-ink-muted">{identity.join(" · ")}</p>
      ) : null}

      {routing.length > 0 ? (
        <p className="font-mono text-[11px] text-ink-muted">{routing.join(" · ")}</p>
      ) : null}

      {/* Line 2 — the decision line. Present only once a human has touched the
          value; before that there is no decision to record. */}
      {editedBy ? (
        <p className="border-t border-divider pt-1.5 text-[11px] text-ink-muted">
          Edited by {editedBy.name} · <DateText value={editedBy.at} withTime />
        </p>
      ) : generatedAt ? (
        <p className="border-t border-divider pt-1.5 text-[11px] text-ink-muted">
          Generated <DateText value={generatedAt} withTime />
        </p>
      ) : null}

      {onOpenSources || onOpenTrace ? (
        <p className="flex gap-3 pt-0.5 text-[11px]">
          {onOpenSources ? (
            <button
              type="button"
              onClick={onOpenSources}
              className="text-primary-hover underline-offset-2 hover:underline"
            >
              Sources
            </button>
          ) : null}
          {onOpenTrace ? (
            <button
              type="button"
              onClick={onOpenTrace}
              className="text-primary-hover underline-offset-2 hover:underline"
            >
              Trace
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The provenance block as a labelled panel section, for a drawer or a right
 * rail rather than a popover.
 */
export function ProvenancePanel(props: ProvenanceBlockProps & { title?: string }) {
  const { title = "Provenance", ...rest } = props;
  return (
    <section className="flex flex-col gap-2 rounded-control border border-border bg-ai-tint p-3">
      <h3 className={SECTION_LABEL}>{title}</h3>
      <ProvenanceBlock {...rest} />
    </section>
  );
}
