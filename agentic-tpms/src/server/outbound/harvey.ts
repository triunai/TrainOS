import { z } from "zod";

/**
 * The "Harvey" outbound writer: a three-touch cold sequence about unutilised
 * HRD Corp levy. The L4 tone model may write the words; the L0 rules here
 * decide whether those words are allowed out:
 *
 *   - the body is under MAX_WORDS words, counted on the final text
 *   - it ends with the opt-out line, which cannot be edited away
 *   - no unfilled placeholder ("[Name]", "{company}") survives
 *
 * A model draft that breaks a rule is replaced by the deterministic template,
 * never trimmed into shape — a truncated sales email reads worse than a plain one.
 */
export const HARVEY_AGENT = "outbound.harvey_writer";
/** Bodies must be strictly under this many words, opt-out line included. */
export const MAX_WORDS = 75;
export const OPT_OUT_LINE = "Reply STOP to opt out.";
export const SEQUENCE_STEPS = [1, 2, 3] as const;
export type SequenceStep = (typeof SEQUENCE_STEPS)[number];
/** Days after approval that each touch becomes due. */
export const STEP_DELAY_DAYS: Record<SequenceStep, number> = { 1: 0, 2: 3, 3: 7 };

export interface OutboundTarget {
  company: string;
  picName?: string | null;
  picEmail: string;
  ssm?: string | null;
  hiringSignal?: string | null;
}

export interface Draft {
  subject: string;
  body: string;
}

export const draftSchema = z.object({
  subject: z.string().min(3).max(200),
  body: z.string().min(20).max(2000),
});

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const OPT_OUT_LIKE = /(reply\s+stop|unsubscribe|opt[- ]?out)/i;

/** Drops any opt-out wording the writer produced and appends the canonical line, so there is exactly one. */
export function withOptOut(body: string): string {
  const kept = body
    .split(/\r?\n/)
    .filter((line) => !OPT_OUT_LIKE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return `${kept}\n\n${OPT_OUT_LINE}`;
}

function firstWords(text: string, n: number): string {
  const words = text.trim().replace(/[.!?]+$/, "").split(/\s+/);
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ");
}

function greeting(target: OutboundTarget): string {
  const name = target.picName?.trim();
  return name ? `Hi ${name},` : "Hello,";
}

/**
 * The deterministic sequence. Sentences are listed required-first; optional
 * ones are dropped from the end until the body fits the word budget, so a
 * long company name costs the hiring-signal line, never the opt-out.
 */
export function templateTouch(target: OutboundTarget, step: SequenceStep, providerName: string): Draft {
  const company = target.company.trim();
  const signal = target.hiringSignal?.trim()
    ? `Given ${firstWords(target.hiringSignal, 12).replace(/^./, (c) => c.toLowerCase())}, onboarding training could be fully levy-funded.`
    : null;
  const variants: Record<SequenceStep, { subject: string; required: string[]; optional: string[] }> = {
    1: {
      subject: `${company}: put unutilised HRD Corp levy to work`,
      required: [
        "Many employers reach year end with HRD Corp levy still unutilised.",
        `We run SBL-Khas claimable in-house programmes for teams like ${company}'s, with zero upfront cash.`,
        "Worth a 15-minute call to check your levy balance?",
      ],
      optional: [signal, "We handle the grant application for you."].filter((s): s is string => !!s),
    },
    2: {
      subject: `Re: ${company} levy balance`,
      required: [
        "A quick follow-up on your HRD Corp levy.",
        "Unused levy is budget your people never see, and SBL-Khas lets you spend it on training built around your team.",
        "Shall I send a one-page levy utilisation plan?",
      ],
      optional: ["Leadership, safety and digital skills are the most requested."],
    },
    3: {
      subject: `Closing the loop on ${company}'s levy`,
      required: [
        "I will close the loop here.",
        "If using your HRD Corp levy before year end becomes a priority, reply with a date and we will prepare a claimable proposal within 48 hours.",
      ],
      optional: [],
    },
  };
  const variant = variants[step];
  const optional = [...variant.optional];
  for (;;) {
    const body = withOptOut([greeting(target), "", [...variant.required, ...optional].join(" "), "", providerName].join("\n"));
    if (wordCount(body) < MAX_WORDS || optional.length === 0) {
      return { subject: variant.subject.slice(0, 255), body };
    }
    optional.pop();
  }
}

export type DraftVerdict =
  | { accepted: true; draft: Draft; words: number; source: "MODEL" }
  | { accepted: false; draft: Draft; words: number; source: "TEMPLATE"; rejectedReason: string | null };

/** The L0 gate over whatever the writer produced. */
export function acceptDraft(candidate: Draft, fallback: Draft, fromModel: boolean): DraftVerdict {
  const templated = (reason: string | null): DraftVerdict => ({
    accepted: false,
    draft: fallback,
    words: wordCount(fallback.body),
    source: "TEMPLATE",
    rejectedReason: reason,
  });
  if (!fromModel) return templated(null);
  const body = withOptOut(candidate.body);
  const subject = candidate.subject.replace(/\s+/g, " ").trim();
  const words = wordCount(body);
  if (words >= MAX_WORDS) return templated(`OVER_WORD_BUDGET_${words}`);
  if (/\[[A-Za-z ]+\]|\{[A-Za-z_ ]+\}/.test(`${subject}\n${body}`)) return templated("UNFILLED_PLACEHOLDER");
  if (!subject || subject.length > 255) return templated("BAD_SUBJECT");
  return { accepted: true, draft: { subject, body }, words, source: "MODEL" };
}

export function harveySystemPrompt(providerName: string): string {
  return [
    `You write B2B cold emails for ${providerName}, a Malaysian HRD Corp registered training provider.`,
    "Angle: employers with unutilised or expiring HRD Corp levy balances can fund in-house training under SBL-Khas with zero upfront cash.",
    `Hard rules: the body is under ${MAX_WORDS - 8} words; plain text; no links; no emojis; no placeholders; no invented facts about the recipient;`,
    "use a hiring signal only if one is given. Touch 1 introduces, touch 2 follows up with one new reason, touch 3 closes the loop politely.",
    'Return {"subject": string, "body": string}. Do not add an opt-out line; it is appended for you.',
  ].join("\n");
}
