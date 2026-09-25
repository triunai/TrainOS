import type { LearningOutcome } from "../db/schema";

/**
 * Bloom's revised taxonomy — the approved action-verb vocabulary for learning
 * outcomes on Form HRD-L&D.
 *
 * WHY an L0 check: HRD Corp evaluators read outcomes for measurable verbs
 * ("apply", "evaluate"), not "understand" or "appreciate". Every outcome an
 * agent drafts must start with a verb from this list at the level it claims;
 * an LLM draft that fails is replaced by the deterministic template.
 *
 * A verb belongs to exactly ONE level here (its primary level), so a claimed
 * level can be checked rather than argued about.
 */
export const BLOOM_LEVELS = {
  1: "Remember",
  2: "Understand",
  3: "Apply",
  4: "Analyse",
  5: "Evaluate",
  6: "Create",
} as const;
export type BloomLevel = keyof typeof BLOOM_LEVELS;

export const BLOOM_VERBS: Readonly<Record<BloomLevel, readonly string[]>> = {
  1: ["define", "list", "recall", "identify", "name", "state", "recognise", "recognize", "label", "outline"],
  2: ["explain", "describe", "summarise", "summarize", "interpret", "classify", "discuss", "illustrate", "paraphrase", "distinguish"],
  3: ["apply", "demonstrate", "use", "implement", "execute", "perform", "prepare", "conduct", "calculate", "operate", "solve", "practise", "practice", "complete", "facilitate", "handle", "communicate", "write", "build", "construct"],
  4: ["analyse", "analyze", "examine", "differentiate", "compare", "contrast", "investigate", "diagnose", "prioritise", "prioritize", "organise", "organize", "categorise", "categorize", "map", "break down", "interrogate"],
  5: ["evaluate", "assess", "justify", "critique", "judge", "recommend", "verify", "appraise", "defend", "select", "audit", "measure"],
  6: ["create", "design", "develop", "formulate", "plan", "propose", "compose", "devise", "produce", "generate", "lead", "establish"],
};

const VERB_LEVEL: ReadonlyMap<string, BloomLevel> = new Map(
  (Object.entries(BLOOM_VERBS) as Array<[string, readonly string[]]>).flatMap(([level, verbs]) =>
    verbs.map((verb) => [verb, Number(level) as BloomLevel] as const),
  ),
);

/** The Bloom level of the verb an outcome starts with, or null when it starts with no approved verb. */
export function leadingVerb(outcome: string): { verb: string; level: BloomLevel } | null {
  const words = outcome.trim().toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const two = words.slice(0, 2).join(" ");
  const twoLevel = VERB_LEVEL.get(two);
  if (twoLevel) return { verb: two, level: twoLevel };
  const oneLevel = VERB_LEVEL.get(words[0]);
  return oneLevel ? { verb: words[0], level: oneLevel } : null;
}

export function bloomLevelOf(verb: string): BloomLevel | null {
  return VERB_LEVEL.get(verb.trim().toLowerCase()) ?? null;
}

export interface OutcomeFailure {
  index: number;
  outcome: string;
  reason: "EMPTY" | "NO_APPROVED_VERB" | "VERB_FIELD_MISMATCH" | "LEVEL_MISMATCH";
  message: string;
}

export interface OutcomeVerdict {
  ok: boolean;
  failures: OutcomeFailure[];
}

/**
 * L0: every outcome starts with an approved Bloom verb, its `verb` field is
 * that verb, and its `bloomLevel` is that verb's level. An empty list fails —
 * a course outline without outcomes is not submittable.
 */
export function validateOutcomes(outcomes: readonly LearningOutcome[]): OutcomeVerdict {
  const failures: OutcomeFailure[] = [];
  if (outcomes.length === 0) {
    failures.push({ index: -1, outcome: "", reason: "EMPTY", message: "At least one learning outcome is required" });
  }
  outcomes.forEach((o, index) => {
    const text = (o.outcome ?? "").trim();
    if (!text) {
      failures.push({ index, outcome: text, reason: "EMPTY", message: `Outcome ${index + 1} is empty` });
      return;
    }
    const lead = leadingVerb(text);
    if (!lead) {
      failures.push({ index, outcome: text, reason: "NO_APPROVED_VERB", message: `Outcome ${index + 1} does not start with an approved Bloom verb: "${text}"` });
      return;
    }
    if ((o.verb ?? "").trim().toLowerCase() !== lead.verb) {
      failures.push({ index, outcome: text, reason: "VERB_FIELD_MISMATCH", message: `Outcome ${index + 1} declares verb "${o.verb}" but starts with "${lead.verb}"` });
    }
    if (o.bloomLevel !== lead.level) {
      failures.push({
        index,
        outcome: text,
        reason: "LEVEL_MISMATCH",
        message: `Outcome ${index + 1} claims Bloom level ${o.bloomLevel} but "${lead.verb}" is level ${lead.level} (${BLOOM_LEVELS[lead.level]})`,
      });
    }
  });
  return { ok: failures.length === 0, failures };
}

/** Builds a well-formed outcome from a sentence that starts with an approved verb. Throws on a bad sentence (seed-data guard). */
export function outcome(sentence: string): LearningOutcome {
  const lead = leadingVerb(sentence);
  if (!lead) throw new Error(`Seed outcome does not start with an approved Bloom verb: ${sentence}`);
  const verb = lead.verb.replace(/^./, (c) => c.toUpperCase());
  return { verb, outcome: sentence, bloomLevel: lead.level };
}
