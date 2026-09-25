import type { DeliveryMode } from "@/server/domain/stages";

/**
 * Deterministic extractors shared by every normaliser and by the L1
 * classifier: email domains, headcount, topic, delivery mode, company names.
 * No model is involved, so they run in the webhook request path.
 */

// ---------------------------------------------------------------- email + domains

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_EXACT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function cleanEmail(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/^mailto:/i, "").toLowerCase();
  return EMAIL_EXACT.test(trimmed) ? trimmed : "";
}

export function findEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL_IN_TEXT) ?? []).map((e) => e.toLowerCase()))];
}

/**
 * Consumer mailbox providers. A lead writing from one of these tells us
 * nothing about their employer, and two strangers on gmail.com are not the
 * same company — so these domains are never a company domain and never a
 * dedupe key. Malaysian residential ISP mailboxes (Streamyx / TMnet) count.
 */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.com.my", "ymail.com", "rocketmail.com",
  "hotmail.com", "hotmail.my", "outlook.com", "outlook.my", "live.com", "live.com.my", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "gmx.com", "gmx.net", "mail.com", "zoho.com", "zohomail.com", "yandex.com", "tutanota.com",
  "hey.com", "qq.com", "163.com", "126.com", "streamyx.com", "tm.net.my",
]);
/** Provider brands that also appear under country suffixes (yahoo.co.uk, hotmail.sg...). */
const FREE_MAIL_BRANDS = new Set([
  "gmail", "googlemail", "yahoo", "ymail", "rocketmail", "hotmail", "outlook", "live", "msn",
  "icloud", "aol", "proton", "protonmail", "gmx", "yandex",
]);
/** Second-level registries under which the registrable domain is three labels. */
const TWO_PART_SUFFIXES = new Set([
  "com.my", "net.my", "org.my", "edu.my", "gov.my", "mil.my", "name.my", "biz.my",
  "co.uk", "org.uk", "ac.uk", "com.sg", "edu.sg", "gov.sg", "co.id", "or.id", "go.id", "com.au",
  "net.au", "org.au", "co.jp", "co.in", "com.ph", "co.th", "com.hk", "com.cn", "co.nz", "com.bn",
]);

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** `hr.petronas.com.my` -> `petronas.com.my`: one company, one key. */
export function registrableDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return TWO_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  if (FREE_MAIL_DOMAINS.has(d)) return true;
  const registrable = registrableDomain(d);
  if (FREE_MAIL_DOMAINS.has(registrable)) return true;
  const [brand, ...rest] = registrable.split(".");
  const suffix = rest.join(".");
  // `yahoo.co.uk` is free mail; `mail.acme.com.my` is not (its registrable
  // domain is acme.com.my, so the brand test never sees "mail").
  return FREE_MAIL_BRANDS.has(brand) && (TWO_PART_SUFFIXES.has(suffix) || /^[a-z]{2,3}$/.test(suffix));
}

/** The company domain for an email, or null for free mail / no email. */
export function corporateDomainOf(email: string): string | null {
  const domain = emailDomain(email);
  if (!domain || isFreeMailDomain(domain)) return null;
  return registrableDomain(domain);
}

export function isPublicSectorDomain(domain: string | null | undefined): boolean {
  return !!domain && /\.(gov|mil|edu)\.my$/.test(domain.toLowerCase());
}

/** `petronas.com.my` -> `Petronas`; the fallback name when a lead gave none. */
export function companyNameFromDomain(domain: string): string {
  const label = registrableDomain(domain).split(".")[0] ?? domain;
  return label
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------- headcount

const NUMBER_WORDS: Record<string, number> = {
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15,
  twenty: 20, "twenty-five": 25, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100,
};
const PEOPLE = "(?:pax|participants?|peserta|orang|people|persons?|staffs?|employees|trainees|attendees|pekerja|learners|headcount|members|executives|supervisors|managers|technicians|operators|workers)";
const N = "(\\d{1,4}|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty-five|twenty|thirty|forty|fifty|sixty|hundred)";

const PAX_PATTERNS: RegExp[] = [
  // "20-25 pax", "20 to 25 participants": the upper bound is the estimate
  new RegExp(`\\b(\\d{1,4})\\s*(?:-|–|to|hingga|~)\\s*${N}\\s*${PEOPLE}\\b`, "i"),
  // "24 estate supervisors": one qualifying word may sit between the number and the people
  new RegExp(`\\b${N}\\s*(?:x\\s*)?(?:[A-Za-z-]+[ \\t]+)?${PEOPLE}\\b`, "i"),
  new RegExp(`\\b(?:team|group|batch|cohort|class)\\s+of\\s+(?:about\\s+|around\\s+|approx\\.?\\s+)?${N}\\b`, "i"),
  new RegExp(`\\b(?:headcount|pax|participants?|no\\.? of (?:pax|participants?))\\s*(?:of|is|:|=|-)?\\s*(?:about\\s+|around\\s+)?${N}\\b`, "i"),
  new RegExp(`\\b${N}[-\\s](?:person|member|man|pax)\\s+(?:team|group|cohort)\\b`, "i"),
];

function toCount(token: string | undefined): number | null {
  if (!token) return null;
  const n = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token.toLowerCase()];
  return n !== undefined && Number.isFinite(n) && n >= 1 && n <= 5000 ? n : null;
}

/** "30 pax", "20 participants", "team of 15", "20-25 pax" (-> 25). Null when none. */
export function extractPax(text: string | null | undefined): number | null {
  if (!text) return null;
  for (const [index, pattern] of PAX_PATTERNS.entries()) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = index === 0 ? toCount(match[2]) : toCount(match[1]);
    if (value !== null) return value;
  }
  return null;
}

/** A bare number from a form field ("30", "30 pax", "20-25"). */
export function parsePaxField(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 5000 ? value : null;
  if (typeof value !== "string") return null;
  const range = /(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})/.exec(value);
  if (range) return toCount(range[2]);
  const bare = /(\d{1,4})/.exec(value);
  return bare ? toCount(bare[1]) : extractPax(value);
}

// ---------------------------------------------------------------- topic

/** Canonical HRD Corp-fundable topics, in match-priority order. */
const TOPICS: Array<[RegExp, string]> = [
  [/\b(train[- ]the[- ]trainers?|ttt)\b/i, "Train the Trainer (TTT)"],
  [/\b(chat ?gpt|generative ai|gen ?ai|artificial intelligence|\bai\b tools?|prompt engineering|copilot)\b/i, "AI & ChatGPT for the workplace"],
  [/\b(power ?bi|data analytics?|data analysis|dashboards?|tableau)\b/i, "Data analytics & Power BI"],
  [/\b(excel|spreadsheets?|pivot tables?|vlookup)\b/i, "Microsoft Excel"],
  [/\b(cyber ?security|phishing|information security)\b/i, "Cybersecurity awareness"],
  [/\b(digital marketing|social media marketing|seo|content marketing)\b/i, "Digital marketing"],
  [/\b(leadership|leading teams?|people management|manag(?:ing|ement) skills|leading through change)\b/i, "Leadership"],
  [/\b(supervisory|supervisors?|first[- ]line manag)/i, "Supervisory skills"],
  [/\b(customer service|service excellence|customer experience|handling complaints)\b/i, "Customer service excellence"],
  [/\b(sales|selling|negotiation|key account)\b/i, "Sales & negotiation"],
  [/\b(communication|business writing|email writing|presentation skills?|public speaking)\b/i, "Communication & presentation"],
  [/\b(business english|english proficiency)\b/i, "Business English"],
  [/\b(project management|pmp|agile|scrum)\b/i, "Project management"],
  [/\b(time management|productivity)\b/i, "Time management & productivity"],
  [/\b(emotional intelligence|\beq\b|mindfulness|stress management|mental health)\b/i, "Emotional intelligence & wellbeing"],
  [/\b(problem[- ]solving|critical thinking|decision[- ]making|design thinking|creativ)/i, "Problem solving & critical thinking"],
  [/\b(team ?building|teamwork|team work)\b/i, "Team building"],
  [/\b(finance for non[- ]finance|financial literacy|budgeting)\b/i, "Finance for non-finance"],
  [/\b(employment act|industrial relations|hr management|human resource)\b/i, "HR & Employment Act"],
  [/\b(osh|oshe|hirarc|safety|forklift|confined space|working at height|dosh|niosh|scaffold)\b/i, "Occupational safety & health"],
  [/\b(first aid|cpr|aed)\b/i, "First aid & CPR"],
  [/\b(iso ?9001|iso ?14001|iso ?45001|iso ?27001|internal audit|iso)\b/i, "ISO standards & internal audit"],
  [/\b(lean|six sigma|5s|kaizen|tpm)\b/i, "Lean, 5S & continuous improvement"],
  [/\b(haccp|gmp|food safety|food handling)\b/i, "Food safety (HACCP / GMP)"],
];

export function extractTopic(text: string | null | undefined): string | null {
  if (!text) return null;
  let best: { index: number; topic: string } | null = null;
  for (const [pattern, topic] of TOPICS) {
    const match = pattern.exec(text);
    if (match && (best === null || match.index < best.index)) best = { index: match.index, topic };
  }
  if (best) return best.topic;
  const phrase = /\b(?:training|course|workshop|programme|program|kursus|latihan)\s+(?:on|in|for|about|regarding|berkenaan|mengenai)\s+([A-Za-z][\w&/ -]{2,60}?)(?:[.,;!?\n]|\s+for\b|\s+with\b|$)/i.exec(text);
  return phrase ? capitalise(phrase[1].trim()) : null;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// ---------------------------------------------------------------- delivery mode

export function extractDeliveryPreference(text: string | null | undefined): DeliveryMode | null {
  if (!text) return null;
  if (/\b(in[- ]?house|on[- ]?site|onsite|at our (?:premises|office|site|plant|factory)|dalaman)\b/i.test(text)) return "IN_HOUSE";
  if (/\b(online|virtual|zoom|ms teams|microsoft teams|google meet|webinar|remote|rot)\b/i.test(text)) return "ROT_VIRTUAL";
  if (/\b(public (?:class|classes|programme|program|course|run|session|workshop)|open (?:enrol+ment|registration)|kursus awam)\b/i.test(text)) return "PUBLIC_PHYSICAL";
  return null;
}

// ---------------------------------------------------------------- company names

export const CORPORATE_SUFFIX = /\b(sdn\.?\s*bhd\.?|berhad|bhd\.?|plc)\b/i;

/** Legal-form suffixes, spelled out case by case so the name words stay capitalised-only. */
const SUFFIX_SRC =
  "(?:Sdn\\.?\\s*Bhd\\.?|SDN\\.?\\s*BHD\\.?|Berhad|BERHAD|Bhd\\.?|BHD\\.?|PLC|Plc|Pte\\.?\\s*Ltd\\.?|PTE\\.?\\s*LTD\\.?|" +
  "Ltd\\.?|LTD\\.?|Enterprise|ENTERPRISE|Holdings|HOLDINGS|Corporation|CORPORATION|Group|GROUP)";
const WORD_SRC = "[A-Z0-9][\\w&.'\u2019-]*";
// Words are joined by spaces only: a company name never spans a line break.
const COMPANY_AFTER_PREPOSITION = new RegExp(
  `\\b(?:[Ff]rom|[Aa]t|[Oo]f|[Dd]ari|[Ww]ith|[Rr]epresenting|[Ww]akil)[ \\t]+((?:${WORD_SRC}[ \\t]+){0,6}${SUFFIX_SRC})`,
);
const COMPANY_LINE = new RegExp(`^((?:${WORD_SRC}[ \\t]+){0,6}${SUFFIX_SRC})\\.?(?:[ \\t]*\\([^)]*\\))?$`);

/** "from Kenanga Retail Group Berhad" / "dari ABC Sdn Bhd", or a signature line that is only a company name. */
export function extractCompanyName(text: string | null | undefined): string | null {
  if (!text) return null;
  const inline = COMPANY_AFTER_PREPOSITION.exec(text);
  if (inline) return tidyName(inline[1]);
  for (const line of text.split(/\r?\n/)) {
    const match = COMPANY_LINE.exec(line.trim());
    if (match) return tidyName(match[1]);
  }
  return null;
}

function tidyName(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.,]$/, "");
}

export function looksLikeSsm(value: string): boolean {
  // New format 202001012345 (12 digits) or old 1234567-X.
  return /^\d{12}$/.test(value.replace(/[\s-]/g, "")) || /^\d{4,7}-?[A-Z]$/i.test(value.trim());
}

export function extractSsm(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /\b(?:ssm|reg(?:istration)?\.?\s*(?:no\.?|number)?|company no\.?)\s*[:#]?\s*(\d{12}|\d{4,7}-?[A-Z])\b/i.exec(text);
  return match ? match[1].toUpperCase() : null;
}

// ---------------------------------------------------------------- misc

export function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  return /^(y|yes|ya|true|1|on|agree|agreed|i agree|opt[- ]?in|setuju)$/i.test(value.trim());
}
