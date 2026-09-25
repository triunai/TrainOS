import { z } from "zod";
import { CORPORATE_SUFFIX, emailDomain, extractPax, isFreeMailDomain, isPublicSectorDomain } from "./text";

/**
 * The L1 fast classifier, as typed decision primitives.
 *
 *   Choice  intent      one of INTENTS, with a confidence
 *   Score   p_levy      P(the company is an HRD Corp levy payer), in [0, 1]
 *   Score   urgency     1..5
 *   Noul    (abstain)   emitted instead of a verdict when the evidence is too
 *                       thin to route on — the lead goes to a human
 *
 * `classifyDeterministic` is the calibrated model itself: a logistic
 * regression over hand-set, documented features. It is the `template` for the
 * L1 `runTier` call, so it IS the classifier whenever no model key exists,
 * and the reference any model's output is checked against. Routing on the
 * primitives is a separate L0 rule (`routeFor`), so a model can never pick
 * the route directly — it can only move the numbers.
 */
export const INTENTS = ["TRAINING_ENQUIRY", "VENDOR_PITCH", "JOB_SEEKER", "SPAM", "OTHER"] as const;
export type Intent = (typeof INTENTS)[number];

export const MODEL_ID = "tpms-l1-logistic-v1";

export const choiceSchema = z.object({
  kind: z.literal("Choice"),
  name: z.literal("intent"),
  value: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
});
export const levyScoreSchema = z.object({
  kind: z.literal("Score"),
  name: z.literal("p_levy"),
  value: z.number().min(0).max(1),
  features: z.record(z.number()),
});
export const urgencyScoreSchema = z.object({
  kind: z.literal("Score"),
  name: z.literal("urgency"),
  value: z.number().int().min(1).max(5),
});
export const abstainSchema = z.object({
  kind: z.literal("Noul"),
  reason: z.string(),
  missing: z.array(z.string()),
});
export const l1OutputSchema = z.object({
  intent: choiceSchema,
  pLevy: levyScoreSchema,
  urgency: urgencyScoreSchema,
  abstain: abstainSchema.nullable(),
});
export type L1Output = z.infer<typeof l1OutputSchema>;

/** What the classifier reads; a projection of lead_records. */
export interface ClassifierInput {
  companyName: string;
  companyDomain: string | null;
  picEmail: string;
  picPhoneE164: string;
  ssm: string | null;
  topic: string | null;
  message: string | null;
  estimatedPax: number | null;
  channel: string;
}

// ---------------------------------------------------------------- P(levy)

/**
 * Logistic weights. Calibration anchors (asserted in tests):
 *   corporate domain + Sdn Bhd + "HRDC claimable" + 30 pax  -> ~0.98 (qualify)
 *   corporate domain, nothing else                          -> ~0.60 (review)
 *   corporate domain + Sdn Bhd, no levy words, no headcount -> ~0.83 (review)
 *   gmail, no company form, no levy words                   -> ~0.10 (private cash)
 *   anything public-sector                                  -> < 0.40 (the PSMB Act exempts government)
 */
export const WEIGHTS = {
  intercept: -1.0,
  corporateDomain: 1.4,
  freeMail: -1.2,
  corporateSuffix: 1.2,
  headcount10: 0.6,
  levyKeyword: 1.8,
  paxScaled: 0.6,
  ssmPresent: 0.5,
  publicSector: -3.0,
} as const;

const LEVY_KEYWORDS = /\b(hrdc|hrdf|hrd\s*corp(?:oration)?|psmb|levy|levi|claimable|boleh tuntut|sbl(?:[- ]khas)?|grant|geran|e-?tris)\b/i;
const PUBLIC_SECTOR = /\b(kementerian|jabatan|ministry|department of|majlis (?:perbandaran|bandaraya|daerah)|kerajaan|government|polis|angkatan|agensi kerajaan|universiti (?:malaya|kebangsaan|putra|sains|teknologi|utara|islam)|sekolah|hospital kerajaan|pejabat)\b/i;
const HEADCOUNT = /\b(\d{2,5})\s*(?:\+\s*)?(?:staff|staffs|employees|pekerja|workers|headcount|people|pax|participants|peserta)\b/i;

export interface LevyFeatures {
  corporateDomain: number;
  freeMail: number;
  corporateSuffix: number;
  headcount10: number;
  levyKeyword: number;
  paxScaled: number;
  ssmPresent: number;
  publicSector: number;
}

export function levyFeatures(input: ClassifierInput): LevyFeatures {
  const text = [input.topic, input.message, input.companyName].filter(Boolean).join("\n");
  const mailDomain = input.picEmail ? emailDomain(input.picEmail) : null;
  const pax = input.estimatedPax ?? extractPax(text);
  const headcount = HEADCOUNT.exec(text);
  const publicSector =
    isPublicSectorDomain(input.companyDomain) || isPublicSectorDomain(mailDomain) || PUBLIC_SECTOR.test(`${input.companyName}\n${text}`);
  return {
    corporateDomain: input.companyDomain && !publicSector ? 1 : 0,
    freeMail: mailDomain && isFreeMailDomain(mailDomain) ? 1 : 0,
    corporateSuffix: CORPORATE_SUFFIX.test(input.companyName) ? 1 : 0,
    headcount10: (pax !== null && pax >= 10) || (headcount !== null && Number(headcount[1]) >= 10) ? 1 : 0,
    levyKeyword: LEVY_KEYWORDS.test(text) ? 1 : 0,
    paxScaled: pax ? Math.min(pax, 60) / 60 : 0,
    ssmPresent: input.ssm ? 1 : 0,
    publicSector: publicSector ? 1 : 0,
  };
}

export function pLevy(features: LevyFeatures): number {
  const z =
    WEIGHTS.intercept +
    WEIGHTS.corporateDomain * features.corporateDomain +
    WEIGHTS.freeMail * features.freeMail +
    WEIGHTS.corporateSuffix * features.corporateSuffix +
    WEIGHTS.headcount10 * features.headcount10 +
    WEIGHTS.levyKeyword * features.levyKeyword +
    WEIGHTS.paxScaled * features.paxScaled +
    WEIGHTS.ssmPresent * features.ssmPresent +
    WEIGHTS.publicSector * features.publicSector;
  return Math.round((1 / (1 + Math.exp(-z))) * 1000) / 1000;
}

// ---------------------------------------------------------------- intent

const DEMAND = [
  /\btraining\b/i, /\bcourses?\b/i, /\bworkshops?\b/i, /\bprogram(?:me)?s?\b/i, /\bkursus\b/i, /\blatihan\b/i,
  /\bin[- ]?house\b/i, /\bupskill/i, /\breskill/i, /\bseminar\b/i, /\bcertification\b/i, /\bteam ?building\b/i,
  /\bhrd\s*corp\b|\bhrdc\b|\bhrdf\b/i, /\bclaimable\b/i, /\b\d+\s*(?:pax|participants|peserta)\b/i, /\bquotation\b|\bproposal\b|\bquote\b/i,
  /\bour (?:staff|team|employees|supervisors|managers|executives)\b/i, /\btrainers?\b.*\b(?:for|to train)\b/i,
];
const PITCH = [
  /\bdigital marketing (?:agency|services)\b/i, /\bseo\b/i, /\blead generation\b/i, /\bweb(?:site)? (?:design|development) services\b/i,
  /\bwe (?:are|re) an? (?:agency|vendor|supplier|software company|consultancy)\b/i, /\bwould like to (?:offer|introduce|propose) (?:our|you)\b/i,
  /\bpartnership opportunit/i, /\bour (?:services|solutions|platform|software) (?:can|will|help)/i, /\bbook a (?:demo|call)\b/i,
  /\breseller\b|\bwhite[- ]label\b/i, /\bgrow your (?:business|revenue|sales)\b/i, /\boutsourc/i, /\bcold email\b/i, /\bwe help training providers\b/i,
];
const JOB = [
  /\b(?:my )?resume\b|\bcv attached\b|\bcurriculum vitae\b/i, /\bjob (?:opening|vacancy|vacancies|application)\b/i,
  /\blooking for (?:a )?(?:job|position|internship|employment)\b/i, /\bapply(?:ing)? for (?:the |a )?(?:position|role|job)\b/i,
  /\binternship\b/i, /\bjawatan kosong\b|\bmohon kerja\b/i, /\bfreelance trainer\b|\bjoin (?:your|as a) (?:team as a )?trainer\b/i,
];
const SPAM = [
  /\b(?:crypto|bitcoin|forex|casino|betting|viagra|loan approval|payday loan)\b/i, /\bguest post\b|\bbacklinks?\b/i,
  /\bclick here\b/i, /\bwinner\b|\bcongratulations you\b/i, /\bunsubscribe\b.*\bmailing list\b/i,
];

const count = (patterns: RegExp[], text: string) => patterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);

/** Lead-form channels come from an ad for training; a filled form is itself a demand signal. */
const FORM_CHANNELS = new Set(["META_LEADGEN", "GOOGLE_WEBHOOK", "LINKEDIN_SYNC", "WEB_FORM"]);

export function classifyIntent(input: ClassifierInput): { value: Intent; confidence: number; signals: Record<string, number> } {
  const text = [input.topic, input.message].filter(Boolean).join("\n");
  const links = (text.match(/https?:\/\//g) ?? []).length;
  const demand = count(DEMAND, text) + (input.topic ? 1 : 0) + (FORM_CHANNELS.has(input.channel) ? 1 : 0);
  const pitch = count(PITCH, text);
  const job = count(JOB, text);
  const spam = count(SPAM, text) + (links >= 3 ? 1 : 0);
  const signals = { demand, pitch, job, spam, links };
  const margin = (winner: number, runnerUp: number) => Math.min(0.97, 0.55 + 0.12 * Math.max(0, winner - runnerUp));

  if (spam >= 2 || (spam >= 1 && demand === 0)) return { value: "SPAM", confidence: margin(spam + 1, demand), signals };
  if (job >= 1 && job >= demand) return { value: "JOB_SEEKER", confidence: margin(job + 1, demand), signals };
  if (pitch >= 1 && pitch > demand - 1) return { value: "VENDOR_PITCH", confidence: margin(pitch + 1, demand), signals };
  if (demand >= 1) return { value: "TRAINING_ENQUIRY", confidence: margin(demand, Math.max(pitch, job, spam)), signals };
  return { value: "OTHER", confidence: 0.5, signals };
}

// ---------------------------------------------------------------- urgency

const URGENT = /\b(urgent(?:ly)?|asap|as soon as possible|segera|next week|this week|this month|minggu depan|bulan ini|immediately|by (?:end of|next) (?:month|week))\b/i;
const LEVY_EXPIRY = /\b(year[- ]end|end of (?:the )?year|unutili[sz]ed|unused|expir(?:e|es|ing|y)|balance (?:left|remaining)|hujung tahun|before (?:december|dec|31 dec))\b/i;

export function urgencyScore(input: ClassifierInput, intent: Intent): number {
  if (intent !== "TRAINING_ENQUIRY") return 1;
  const text = [input.topic, input.message].filter(Boolean).join("\n");
  let score = 2;
  if (URGENT.test(text)) score += 2;
  if (LEVY_EXPIRY.test(text)) score += 1;
  if ((input.estimatedPax ?? 0) >= 20) score += 1;
  return Math.max(1, Math.min(5, score));
}

// ---------------------------------------------------------------- abstain

/**
 * Too little to route on: fewer than two independent pieces of evidence
 * about who the lead is and what they want. A Meta notification whose
 * fields were never fetched, or a WhatsApp "hi", lands here.
 */
export function abstention(input: ClassifierInput): L1Output["abstain"] {
  const missing: string[] = [];
  const hasCompany = input.companyName && input.companyName !== "Unknown company";
  if (!hasCompany) missing.push("company");
  if (!input.picEmail) missing.push("email");
  if (!input.companyDomain && !input.ssm) missing.push("company_identity");
  const text = [input.topic, input.message].filter(Boolean).join(" ");
  if (text.replace(/\s+/g, " ").trim().length < 20) missing.push("enquiry_text");
  if (input.estimatedPax === null) missing.push("headcount");
  const evidence = 5 - missing.length;
  return evidence < 2 ? { kind: "Noul", reason: `insufficient evidence (${evidence} of 5 signals)`, missing } : null;
}

// ---------------------------------------------------------------- the model

export function classifyDeterministic(input: ClassifierInput): L1Output {
  const intent = classifyIntent(input);
  const features = levyFeatures(input);
  return {
    intent: { kind: "Choice", name: "intent", value: intent.value, confidence: Math.round(intent.confidence * 100) / 100 },
    pLevy: { kind: "Score", name: "p_levy", value: pLevy(features), features: { ...features } },
    urgency: { kind: "Score", name: "urgency", value: urgencyScore(input, intent.value) },
    abstain: abstention(input),
  };
}

// ---------------------------------------------------------------- routing (L0 rule over the primitives)

export const QUALIFY_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.4;
/** A non-enquiry verdict this sure archives even a thin lead; below it, thin leads go to a human. */
export const ARCHIVE_CONFIDENCE = 0.7;

export type Route = "LEAD_QUALIFIED_TNA" | "TRIAGE_REVIEW" | "PRIVATE_CASH" | "ARCHIVED";

export function routeFor(output: L1Output, opts: { isTest?: boolean } = {}): { route: Route; reason: string } {
  if (opts.isTest) return { route: "ARCHIVED", reason: "PLATFORM_TEST_LEAD" };
  const intent = output.intent.value;
  if (intent !== "TRAINING_ENQUIRY" && intent !== "OTHER" && output.intent.confidence >= ARCHIVE_CONFIDENCE) {
    return { route: "ARCHIVED", reason: `INTENT_${intent}` };
  }
  if (output.abstain) return { route: "TRIAGE_REVIEW", reason: "ABSTAINED" };
  if (intent !== "TRAINING_ENQUIRY") return { route: "ARCHIVED", reason: `INTENT_${intent}` };
  const p = output.pLevy.value;
  if (p >= QUALIFY_THRESHOLD) return { route: "LEAD_QUALIFIED_TNA", reason: "P_LEVY_HIGH" };
  if (p >= REVIEW_THRESHOLD) return { route: "TRIAGE_REVIEW", reason: "P_LEVY_UNCERTAIN" };
  return { route: "PRIVATE_CASH", reason: "P_LEVY_LOW" };
}
