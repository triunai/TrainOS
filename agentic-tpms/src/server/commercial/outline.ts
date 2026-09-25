import { z } from "zod";
import { addDays } from "@/lib/dates";
import { runTier, type Provenance } from "@/server/ai";
import type { LearningOutcome } from "../db/schema";
import type { DeliveryMode } from "../domain/stages";
import { validateOutcomes, type Course } from "@/server/knowledge";

/**
 * Form HRD-L&D course outline: the document HRD Corp evaluates a grant
 * application against, and the syllabus the trainer agreement binds the
 * trainer to.
 *
 * WHY the timetable is fixed code, not model output: the 09:00–17:00 day with
 * tea at 10:30 and 15:30 and lunch at 13:00 is what a claim's attendance
 * (AM/PM sessions) is audited against. The L3 writer may phrase sessions,
 * outcomes and the justification; it may not move the clock. An LLM draft
 * whose outcomes fail the L0 Bloom check is discarded for the template.
 */
export const OUTLINE_AGENT = "commercial.outline_writer";

export const DAY_TIMETABLE = [
  { start: "09:00", end: "10:30", kind: "SESSION" },
  { start: "10:30", end: "10:45", kind: "BREAK", title: "Morning tea break" },
  { start: "10:45", end: "13:00", kind: "SESSION" },
  { start: "13:00", end: "14:00", kind: "LUNCH", title: "Lunch and prayer break" },
  { start: "14:00", end: "15:30", kind: "SESSION" },
  { start: "15:30", end: "15:45", kind: "BREAK", title: "Afternoon tea break" },
  { start: "15:45", end: "17:00", kind: "SESSION" },
] as const;
export const SESSIONS_PER_DAY = DAY_TIMETABLE.filter((s) => s.kind === "SESSION").length;

export interface AgendaSlot {
  start: string;
  end: string;
  kind: "SESSION" | "BREAK" | "LUNCH";
  title: string;
  topics: string[];
}

export interface OutlineDay {
  day: number;
  date: string | null;
  theme: string;
  slots: AgendaSlot[];
}

export interface CourseModule {
  title: string;
  topics: string[];
}

export interface CourseOutline {
  form: "HRD-L&D";
  courseCode: string;
  courseTitle: string;
  programmeTitle: string;
  focusArea: string;
  /** ILLUSTRATIVE placeholder code from the seed catalog — see knowledge/catalog.ts. */
  nossReference: string | null;
  seniority: string;
  level: number;
  deliveryMode: DeliveryMode;
  durationDays: number;
  totalHours: number;
  startDate: string | null;
  endDate: string | null;
  pax: number;
  targetAudience: string;
  learningOutcomes: LearningOutcome[];
  modules: CourseModule[];
  days: OutlineDay[];
  methodology: string[];
  assessment: { kirkpatrickL1: string; kirkpatrickL2: string; instruments: string[] };
  productivityJustification: string;
  tnaHighlights: string[];
  trainer: { name: string; tttCertNumber: string } | null;
  venue: string;
  generatedBy: "TEMPLATE" | "LLM";
}

export interface OutlineContext {
  packageId: string;
  packageCode: string;
  programmeTitle: string;
  course: Pick<Course, "courseCode" | "title" | "hrdFocusArea" | "matchedNossCode" | "targetSeniority" | "level" | "learningOutcomes" | "masterOutlineMarkdown">;
  client: { companyName: string; industrySector: string | null };
  deliveryMode: DeliveryMode;
  days: number;
  startDate: string | null;
  pax: number;
  tna: Record<string, unknown>;
  trainer?: { fullName: string; tttCertNumber: string } | null;
  venue?: { name: string; city: string | null } | null;
  venueByClient?: boolean;
}

// ---------------------------------------------------------------- the L3 draft contract
const draftSchema = z.object({
  learningOutcomes: z
    .array(z.object({ verb: z.string().min(2), outcome: z.string().min(10).max(300), bloomLevel: z.number().int().min(1).max(6) }))
    .min(3)
    .max(8),
  days: z
    .array(
      z.object({
        theme: z.string().min(3).max(200),
        sessions: z.array(z.object({ title: z.string().min(3).max(200), topics: z.array(z.string().min(2).max(200)).max(8) })).length(SESSIONS_PER_DAY),
      }),
    )
    .min(1)
    .max(30),
  methodology: z.array(z.string().min(5).max(300)).min(2).max(8),
  assessment: z.object({ kirkpatrickL1: z.string().min(10).max(500), kirkpatrickL2: z.string().min(10).max(500) }),
  productivityJustification: z.string().min(80).max(2500),
});
export type OutlineDraft = z.infer<typeof draftSchema>;

// ---------------------------------------------------------------- template
export function parseModules(markdown: string): CourseModule[] {
  const modules: CourseModule[] = [];
  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(?:Module\s+\d+\s*:\s*)?(.+)$/.exec(line.trim());
    if (heading) {
      modules.push({ title: heading[1].trim(), topics: [] });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line.trim());
    if (bullet && modules.length > 0) modules[modules.length - 1].topics.push(bullet[1].trim());
  }
  return modules;
}

/** Spread M modules over S session slots in order: a module may span slots, or slots may merge modules. */
function planSessions(modules: CourseModule[], slots: number): Array<{ title: string; topics: string[] }> {
  if (modules.length === 0) {
    return Array.from({ length: slots }, (_, i) => ({ title: `Session ${i + 1}: guided practice and application`, topics: [] }));
  }
  const m = modules.length;
  const plan: Array<{ title: string; topics: string[] }> = [];
  for (let i = 0; i < slots; i += 1) {
    const first = Math.floor((i * m) / slots);
    const last = Math.max(first, Math.floor(((i + 1) * m) / slots) - 1);
    if (first === last) {
      const current = modules[first];
      // Which part of this module is slot i, and how many slots does the module span?
      const spanStart = Math.ceil((first * slots) / m);
      const spanEnd = Math.ceil(((first + 1) * slots) / m) - 1;
      const parts = spanEnd - spanStart + 1;
      const part = i - spanStart;
      const per = Math.ceil(current.topics.length / parts);
      const topics = current.topics.slice(part * per, (part + 1) * per);
      plan.push({
        title: part === 0 ? `Module ${first + 1}: ${current.title}` : `Module ${first + 1}: ${current.title} (continued)`,
        topics: topics.length > 0 ? topics : ["Practical workshop: apply the module to participants' own workplace cases"],
      });
    } else {
      const merged = modules.slice(first, last + 1);
      plan.push({
        title: merged.map((mod, k) => `Module ${first + k + 1}: ${mod.title}`).join(" / "),
        topics: merged.flatMap((mod) => mod.topics.slice(0, 2)),
      });
    }
  }
  return plan;
}

const TNA_KEY = /gap|pain|challenge|objective|goal|kpi|issue|need|problem|outcome|priorit|concern|skill|target/i;

/** Human-readable highlights from a lead's TNA profile, whatever shape the intake lane stored it in. */
export function tnaHighlights(tna: Record<string, unknown>, max = 5): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim().length > 2) out.push(value.trim().slice(0, 200));
    else if (Array.isArray(value)) value.forEach(push);
  };
  for (const [key, value] of Object.entries(tna ?? {})) {
    if (TNA_KEY.test(key)) push(value);
  }
  return [...new Set(out)].slice(0, max);
}

const PRODUCTIVITY_INDICATORS: Record<string, string[]> = {
  "Leadership & People Management": ["team target attainment", "staff turnover and absenteeism", "time supervisors spend on rework and escalations"],
  Communication: ["turnaround time for reports and approvals", "rework caused by unclear instructions", "customer and internal stakeholder satisfaction"],
  "Customer Service": ["complaint resolution time", "customer satisfaction and repeat business", "escalations to management"],
  "Digital & Data Skills": ["hours spent on manual reporting", "report errors and rework", "time from data to management decision"],
  "Digital Marketing": ["cost per qualified lead", "campaign conversion rate", "time to launch a campaign"],
  "Occupational Safety & Health": ["lost-time incidents and near misses", "HIRARC coverage of work activities", "DOSH compliance findings"],
  "Quality Management": ["nonconformities per audit", "corrective actions closed on time", "customer complaints on quality"],
  "Productivity & Continuous Improvement": ["process cycle time", "defect and scrap rates", "cost savings from improvement projects"],
  "Artificial Intelligence & Automation": ["hours saved on routine drafting and summarising", "document turnaround time", "adoption of approved AI workflows"],
  "Finance & Business Acumen": ["budget variance", "cost-saving decisions supported by ROI analysis", "working capital awareness in operating teams"],
  "Personal Effectiveness": ["on-time task completion", "overtime hours", "meeting time per week"],
};

function seniorityAudience(seniority: string): string {
  switch (seniority) {
    case "EXECUTIVE":
      return "Managers, executives and professionals";
    case "SUPERVISORY":
      return "Supervisors, team leaders and newly promoted first-line managers";
    case "OPERATIONAL":
      return "Operational, front-line and support staff";
    default:
      throw new Error(`Unknown seniority ${seniority}`);
  }
}

function methodologyFor(mode: DeliveryMode): string[] {
  const common = [
    "Interactive lecture anchored on Malaysian workplace cases",
    "Group discussion, role-play and case clinics",
    "Hands-on exercises using participants' own work situations",
    "Individual action planning with a 30-day follow-up commitment",
  ];
  switch (mode) {
    case "ROT_VIRTUAL":
      return [
        "Remote Online Training (ROT) delivered live by the trainer over video conference with cameras on",
        ...common.slice(0, 3),
        "Breakout rooms for group work; attendance captured for every AM and PM session",
      ];
    case "IN_HOUSE":
    case "PUBLIC_PHYSICAL":
      return common;
    default: {
      const unknown: never = mode;
      throw new Error(`Unknown delivery mode ${String(unknown)}`);
    }
  }
}

export function templateOutlineDraft(ctx: OutlineContext): OutlineDraft {
  const modules = parseModules(ctx.course.masterOutlineMarkdown);
  const plan = planSessions(modules, ctx.days * SESSIONS_PER_DAY);
  const days = Array.from({ length: ctx.days }, (_, d) => {
    const sessions = plan.slice(d * SESSIONS_PER_DAY, (d + 1) * SESSIONS_PER_DAY).map((s) => ({ ...s, topics: [...s.topics] }));
    if (d === 0) sessions[0].topics.unshift("Registration, welcome and programme objectives", "Pre-assessment (Kirkpatrick Level 2 baseline)");
    const last = sessions[sessions.length - 1];
    if (d === ctx.days - 1) last.topics.push("Post-assessment (Kirkpatrick Level 2) and reaction evaluation (Kirkpatrick Level 1)", "Action plan commitments and closing");
    else last.topics.push("Day recap and key takeaways");
    const themes = [...new Set(sessions.map((s) => s.title.replace(/ \(continued\)$/, "").replace(/^Module \d+: /, "")))];
    return { theme: themes.join(" · ").slice(0, 200), sessions: sessions.map((s) => ({ title: s.title.slice(0, 200), topics: s.topics.slice(0, 8) })) };
  });

  const highlights = tnaHighlights(ctx.tna);
  const indicators = PRODUCTIVITY_INDICATORS[ctx.course.hrdFocusArea] ?? ["output per employee", "rework and error rates", "time to complete core tasks"];
  const verbs = ctx.course.learningOutcomes.map((o) => o.verb.toLowerCase());
  const industry = ctx.client.industrySector ? ` (${ctx.client.industrySector})` : "";
  const needs = highlights.length
    ? `The training needs analysis with ${ctx.client.companyName} identified: ${highlights.join("; ")}.`
    : `${ctx.client.companyName} requested this programme to close capability gaps in ${ctx.course.hrdFocusArea.toLowerCase()}.`;
  const justification = [
    `${ctx.client.companyName}${industry} is sending ${ctx.pax} ${seniorityAudience(ctx.course.targetSeniority).toLowerCase()} to "${ctx.programmeTitle}".`,
    needs,
    `The programme is designed so participants ${verbs.slice(0, 4).join(", ")} on real work during the sessions, not only in theory.`,
    `Expected workplace productivity improvements: ${indicators.join(", ")}.`,
    "Impact is evidenced through Kirkpatrick Level 1 reaction scores and Level 2 pre/post assessment gains, with each participant's 30-day action plan reviewed by their supervisor.",
  ].join(" ");

  return {
    learningOutcomes: ctx.course.learningOutcomes.map((o) => ({ ...o })),
    days,
    methodology: methodologyFor(ctx.deliveryMode),
    assessment: {
      kirkpatrickL1: "Level 1 (Reaction): end-of-day participant feedback on relevance, trainer effectiveness and intent to apply; target average of at least 4.0 out of 5.",
      kirkpatrickL2: "Level 2 (Learning): 10-question pre-test and post-test on the learning outcomes; target average improvement of at least 20 percentage points and a post-test pass mark of 60%.",
    },
    productivityJustification: justification.slice(0, 2500),
  };
}

function venueLine(ctx: OutlineContext): string {
  if (ctx.deliveryMode === "ROT_VIRTUAL") return "Remote Online Training (live video conference)";
  if (ctx.venueByClient) return `${ctx.client.companyName} premises (client-provided)`;
  if (ctx.venue) return ctx.venue.city ? `${ctx.venue.name}, ${ctx.venue.city}` : ctx.venue.name;
  return "To be confirmed";
}

/** The full outline: the draft's words poured into the fixed timetable. */
export function assembleOutline(ctx: OutlineContext, draft: OutlineDraft, generatedBy: CourseOutline["generatedBy"]): CourseOutline {
  const days: OutlineDay[] = draft.days.map((d, index) => {
    let session = 0;
    const slots: AgendaSlot[] = DAY_TIMETABLE.map((t) => {
      if (t.kind === "SESSION") {
        const s = d.sessions[session];
        session += 1;
        return { start: t.start, end: t.end, kind: "SESSION", title: s.title, topics: s.topics };
      }
      return { start: t.start, end: t.end, kind: t.kind, title: t.title, topics: [] };
    });
    return { day: index + 1, date: ctx.startDate ? addDays(ctx.startDate, index) : null, theme: d.theme, slots };
  });
  return {
    form: "HRD-L&D",
    courseCode: ctx.course.courseCode,
    courseTitle: ctx.course.title,
    programmeTitle: ctx.programmeTitle,
    focusArea: ctx.course.hrdFocusArea,
    nossReference: ctx.course.matchedNossCode,
    seniority: ctx.course.targetSeniority,
    level: ctx.course.level,
    deliveryMode: ctx.deliveryMode,
    durationDays: ctx.days,
    // 09:00–17:00 less 1h lunch and 2 × 15 min tea = 6.5 contact hours per day.
    totalHours: ctx.days * 6.5,
    startDate: ctx.startDate,
    endDate: ctx.startDate ? addDays(ctx.startDate, ctx.days - 1) : null,
    pax: ctx.pax,
    targetAudience: seniorityAudience(ctx.course.targetSeniority),
    learningOutcomes: draft.learningOutcomes,
    modules: parseModules(ctx.course.masterOutlineMarkdown),
    days,
    methodology: draft.methodology,
    assessment: {
      kirkpatrickL1: draft.assessment.kirkpatrickL1,
      kirkpatrickL2: draft.assessment.kirkpatrickL2,
      instruments: ["Pre-test and post-test (Level 2)", "Daily reaction evaluation form (Level 1)", "Individual 30-day action plan"],
    },
    productivityJustification: draft.productivityJustification,
    tnaHighlights: tnaHighlights(ctx.tna),
    trainer: ctx.trainer ? { name: ctx.trainer.fullName, tttCertNumber: ctx.trainer.tttCertNumber } : null,
    venue: venueLine(ctx),
    generatedBy,
  };
}

/** Why an LLM draft was refused, or null when it passes L0. */
export function draftRejection(ctx: OutlineContext, draft: OutlineDraft): string | null {
  if (draft.days.length !== ctx.days) return `L0_AGENDA_DAYS: draft has ${draft.days.length} days, the package has ${ctx.days}`;
  const verdict = validateOutcomes(draft.learningOutcomes);
  if (!verdict.ok) return `L0_BLOOM_CHECK_FAILED: ${verdict.failures.map((f) => f.message).join("; ")}`.slice(0, 500);
  return null;
}

export async function buildOutline(ctx: OutlineContext, opts: { runId?: string | null } = {}): Promise<{ outline: CourseOutline; provenance: Provenance }> {
  const template = templateOutlineDraft(ctx);
  const { output, provenance } = await runTier<OutlineDraft>({
    tier: "L3",
    agent: OUTLINE_AGENT,
    packageId: ctx.packageId,
    system: [
      "You write HRD Corp Form HRD-L&D course outlines for a Malaysian training provider.",
      "Return JSON only, matching the schema. Every learning outcome MUST start with a Bloom's taxonomy action verb,",
      "`verb` must be that first word and `bloomLevel` its level (1 Remember, 2 Understand, 3 Apply, 4 Analyse, 5 Evaluate, 6 Create).",
      `Produce exactly ${ctx.days} day(s), each with exactly ${SESSIONS_PER_DAY} sessions (09:00-10:30, 10:45-13:00, 14:00-15:30, 15:45-17:00).`,
      "Do not invent HRD Corp rules, NOSS codes or statistics. Tie the productivity justification to the TNA provided.",
    ].join(" "),
    prompt: JSON.stringify({
      programmeTitle: ctx.programmeTitle,
      client: ctx.client,
      pax: ctx.pax,
      deliveryMode: ctx.deliveryMode,
      days: ctx.days,
      course: {
        code: ctx.course.courseCode,
        title: ctx.course.title,
        focusArea: ctx.course.hrdFocusArea,
        seniority: ctx.course.targetSeniority,
        outcomes: ctx.course.learningOutcomes,
        outline: ctx.course.masterOutlineMarkdown,
      },
      tna: ctx.tna,
      referenceDraft: template,
    }),
    json: { schema: draftSchema },
    maxTokens: 4000,
    template: () => template,
  }, { runId: opts.runId ?? null });

  if (provenance.mode === "LLM") {
    const parsed = draftSchema.safeParse(output);
    const rejection = parsed.success ? draftRejection(ctx, parsed.data) : `SCHEMA: ${parsed.error.message.slice(0, 300)}`;
    if (rejection) {
      return { outline: assembleOutline(ctx, template, "TEMPLATE"), provenance: { ...provenance, mode: "TEMPLATE", fallbackReason: rejection } };
    }
    return { outline: assembleOutline(ctx, parsed.success ? parsed.data : template, "LLM"), provenance };
  }
  return { outline: assembleOutline(ctx, template, "TEMPLATE"), provenance };
}
