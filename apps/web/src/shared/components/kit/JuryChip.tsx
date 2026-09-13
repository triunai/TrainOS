import type { JuryPolicy, ProvenanceJury } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { AI_GLYPH } from "./tokens";
import { describeJuryPolicy } from "./adapters";

/**
 * The jury chip. Kit.dc.html §10: "✦ Jury 2 of 3" in the AI tint when a jury
 * ran, a neutral "No jury" when none did — "the jury chip takes the AI tint
 * because it describes model behaviour."
 *
 * It renders two different facts, and telling them apart is the whole design:
 *
 *   `jury`   a RESULT. `ProvenanceJury` — how a jury actually voted on one run.
 *            This is M18-S04's trace.
 *   `policy` a CONFIGURATION. `JuryPolicy` — a jury that is set up but has not
 *            voted on anything. This is M18-S01's registry column and
 *            M20-S20's matrix.
 *
 * Passing a result-shaped object with an empty `agreed[]` to stand in for a
 * policy is what a screen has to do without this prop, and it produces a chip
 * whose tooltip reads "Agreed:" with nothing after it — a claim that a jury
 * voted and nobody agreed, which is the opposite of the truth.
 *
 * THE TINT RULE, and it follows the contract rather than the mode's name.
 * Only `ESCALATE` can touch a live action: §18 says `GATE` "runs at promotion
 * time against the golden set only" and `SAMPLE` "runs asynchronously after
 * the human decides and never blocks". So `ESCALATE` takes the AI tint, since
 * it may intervene in the thing the user is looking at, and the other two are
 * neutral with their mode named in the tooltip. Colouring a `GATE` row would
 * tell a user their action might be held when it never will be.
 */

export interface JuryChipProps {
  /** A jury that voted. Wins over `policy` when both are given. */
  jury?: ProvenanceJury;
  /** A configured jury that has not voted. */
  policy?: JuryPolicy;
  className?: string;
}

const TINTED =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-primary-border bg-ai-tint px-2.5 py-[3px] text-[12px] font-medium text-primary-hover";

const NEUTRAL =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-border bg-surface px-2.5 py-[3px] text-[12px] text-ink-muted";

export function JuryChip({ jury, policy, className }: JuryChipProps) {
  /* A result beats a configuration: once a jury has voted, what it decided is
     more informative than what it was set up to do. */
  if (jury) {
    const dissent = jury.dissented.map((vote) => `${vote.model}: ${vote.note}`).join("\n");
    return (
      <span
        title={dissent || `Agreed: ${jury.agreed.join(", ")}`}
        className={cn(TINTED, className)}
      >
        <span aria-hidden="true">{AI_GLYPH}</span>
        Jury {jury.quorum} of {jury.of}
      </span>
    );
  }

  if (policy) {
    const description = describeJuryPolicy(policy);

    if (policy.mode === "ESCALATE") {
      return (
        <span title={description} className={cn(TINTED, className)}>
          <span aria-hidden="true">{AI_GLYPH}</span>
          Jury {policy.quorum} of {policy.of}
        </span>
      );
    }

    /* GATE and SAMPLE never hold a live action, so they read as neutral facts
       about configuration. The mode is still named, because "No jury" would be
       wrong: there IS one, it just does not stand between the user and this. */
    return (
      <span title={description} className={cn(NEUTRAL, className)}>
        {policy.mode === "GATE" ? "Jury at promotion" : "Jury sampled"}
      </span>
    );
  }

  return <span className={cn(NEUTRAL, className)}>No jury</span>;
}
