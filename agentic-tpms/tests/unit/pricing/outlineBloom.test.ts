import { beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ output: null as unknown, mode: "TEMPLATE" as "TEMPLATE" | "LLM" }));

vi.mock("@/server/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai")>();
  return {
    ...actual,
    runTier: vi.fn(async (input: { template: () => unknown; tier: string; agent: string }) => ({
      output: llm.mode === "LLM" ? llm.output : await input.template(),
      provenance: {
        tier: input.tier,
        agent: input.agent,
        mode: llm.mode,
        provider: llm.mode === "LLM" ? "stub" : "template",
        model: llm.mode === "LLM" ? "stub-model" : "deterministic-template",
        costMyr: 0,
        latencyMs: 1,
        ...(llm.mode === "TEMPLATE" ? { fallbackReason: "NO_PROVIDER_CONFIGURED" } : {}),
      },
    })),
  };
});

import { COURSE_SEEDS, validateOutcomes, leadingVerb } from "@/server/knowledge";
import {
  DAY_TIMETABLE,
  buildOutline,
  parseModules,
  templateOutlineDraft,
  tnaHighlights,
  type OutlineContext,
} from "@/server/commercial/outline";

const course = (code: string) => {
  const c = COURSE_SEEDS.find((x) => x.courseCode === code);
  if (!c) throw new Error(code);
  return { ...c, matchedNossCode: c.matchedNossCode };
};

const ctx = (over: Partial<OutlineContext> = {}): OutlineContext => ({
  packageId: "00000000-0000-0000-0000-000000000001",
  packageCode: "PKG-2026-0001",
  programmeTitle: "Leading Through Change",
  course: course("SUP-101"),
  client: { companyName: "Kenanga Retail Group Berhad", industrySector: "Retail" },
  deliveryMode: "IN_HOUSE",
  days: 2,
  startDate: "2026-11-02",
  pax: 20,
  tna: { skillGaps: ["Supervisors avoid difficult conversations"], kpis: ["Outlet staff turnover"], department: "Retail" },
  trainer: { fullName: "Farah Aziz", tttCertNumber: "TTT/1001" },
  venue: { name: "Sunway Pyramid Convention Centre", city: "Petaling Jaya" },
  ...over,
});

beforeEach(() => {
  llm.mode = "TEMPLATE";
  llm.output = null;
});

describe("Bloom's taxonomy L0 check", () => {
  it("accepts every seeded course's outcomes", () => {
    for (const c of COURSE_SEEDS) {
      const verdict = validateOutcomes(c.learningOutcomes);
      expect(verdict.failures, c.courseCode).toEqual([]);
    }
  });

  it("refuses outcomes that do not start with an approved verb, or claim the wrong level", () => {
    const verdict = validateOutcomes([
      { verb: "Understand", outcome: "Understand the importance of leadership", bloomLevel: 2 },
      { verb: "Apply", outcome: "Apply the GROW model in coaching conversations", bloomLevel: 5 },
      { verb: "Explain", outcome: "Analyse team performance data", bloomLevel: 4 },
      { verb: "Apply", outcome: "   ", bloomLevel: 3 },
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => [f.index, f.reason])).toEqual([
      [0, "NO_APPROVED_VERB"],
      [1, "LEVEL_MISMATCH"],
      [2, "VERB_FIELD_MISMATCH"],
      [3, "EMPTY"],
    ]);
    expect(validateOutcomes([]).failures[0].reason).toBe("EMPTY");
  });

  it("reads two-word verbs and British and American spellings", () => {
    expect(leadingVerb("Break down a process into steps")).toEqual({ verb: "break down", level: 4 });
    expect(leadingVerb("Analyze trends")?.level).toBe(4);
    expect(leadingVerb("Prioritise tasks")?.level).toBe(4);
  });
});

describe("Form HRD-L&D outline template", () => {
  it("parses the master outline into modules and topics", () => {
    const modules = parseModules(course("SUP-101").masterOutlineMarkdown);
    expect(modules).toHaveLength(5);
    expect(modules[0].title).toBe("The Supervisor's Role");
    expect(modules[0].topics.length).toBeGreaterThan(1);
  });

  it("lays out 09:00–17:00 days with fixed tea and lunch breaks", async () => {
    const { outline, provenance } = await buildOutline(ctx());
    expect(provenance.mode).toBe("TEMPLATE");
    expect(outline.generatedBy).toBe("TEMPLATE");
    expect(outline.days).toHaveLength(2);
    expect(outline.totalHours).toBe(13);
    expect(outline.endDate).toBe("2026-11-03");
    for (const day of outline.days) {
      expect(day.slots.map((s) => `${s.start}-${s.end}:${s.kind}`)).toEqual(DAY_TIMETABLE.map((t) => `${t.start}-${t.end}:${t.kind}`));
    }
    expect(outline.days[0].slots[1]).toMatchObject({ start: "10:30", end: "10:45", kind: "BREAK" });
    expect(outline.days[0].slots[3]).toMatchObject({ start: "13:00", end: "14:00", kind: "LUNCH" });
    expect(outline.days[0].slots[5]).toMatchObject({ start: "15:30", end: "15:45", kind: "BREAK" });
    expect(outline.days[0].slots[0].topics.join(" ")).toMatch(/Pre-assessment \(Kirkpatrick Level 2 baseline\)/);
    expect(outline.days[1].slots[6].topics.join(" ")).toMatch(/Post-assessment \(Kirkpatrick Level 2\).*Kirkpatrick Level 1/);
    expect(outline.assessment.kirkpatrickL1).toMatch(/Level 1/);
    expect(outline.assessment.kirkpatrickL2).toMatch(/pre-test and post-test/);
    expect(validateOutcomes(outline.learningOutcomes).ok).toBe(true);
  });

  it("ties the productivity justification to the lead's TNA", () => {
    const draft = templateOutlineDraft(ctx());
    expect(draft.productivityJustification).toContain("Supervisors avoid difficult conversations");
    expect(draft.productivityJustification).toContain("Kenanga Retail Group Berhad");
    expect(tnaHighlights({ painPoints: "Slow reports", noise: "ignored", goals: ["Faster month-end"] })).toEqual(["Slow reports", "Faster month-end"]);
  });

  it("covers every module whether the course is compressed or stretched", () => {
    const compressed = templateOutlineDraft(ctx({ days: 1 }));
    const titles1 = compressed.days.flatMap((d) => d.sessions.map((s) => s.title)).join(" | ");
    for (let m = 1; m <= 5; m += 1) expect(titles1).toContain(`Module ${m}:`);
    const stretched = templateOutlineDraft(ctx({ days: 3, course: course("TMG-101") }));
    const titles3 = stretched.days.flatMap((d) => d.sessions.map((s) => s.title));
    expect(titles3).toHaveLength(12);
    for (let m = 1; m <= 4; m += 1) expect(titles3.join(" | ")).toContain(`Module ${m}:`);
    expect(titles3.some((t) => t.endsWith("(continued)"))).toBe(true);
  });

  it("uses ROT methodology for remote online training", async () => {
    const { outline } = await buildOutline(ctx({ deliveryMode: "ROT_VIRTUAL", venue: null }));
    expect(outline.methodology[0]).toMatch(/Remote Online Training/);
    expect(outline.venue).toMatch(/Remote Online Training/);
  });

  it("keeps an LLM draft that passes L0, and discards one that fails the Bloom check", async () => {
    const good = templateOutlineDraft(ctx());
    good.productivityJustification = `${good.productivityJustification} (model-written)`;
    llm.mode = "LLM";
    llm.output = good;
    const accepted = await buildOutline(ctx());
    expect(accepted.outline.generatedBy).toBe("LLM");
    expect(accepted.outline.productivityJustification).toMatch(/model-written/);

    const bad = templateOutlineDraft(ctx());
    bad.learningOutcomes = [
      { verb: "Understand", outcome: "Understand leadership", bloomLevel: 2 },
      { verb: "Appreciate", outcome: "Appreciate diversity in teams", bloomLevel: 3 },
      { verb: "Know", outcome: "Know the company policy", bloomLevel: 1 },
    ];
    llm.output = bad;
    const rejected = await buildOutline(ctx());
    expect(rejected.outline.generatedBy).toBe("TEMPLATE");
    expect(rejected.provenance.mode).toBe("TEMPLATE");
    expect(rejected.provenance.fallbackReason).toMatch(/^L0_BLOOM_CHECK_FAILED/);
    expect(validateOutcomes(rejected.outline.learningOutcomes).ok).toBe(true);

    const wrongDays = templateOutlineDraft(ctx({ days: 1 }));
    llm.output = wrongDays;
    const refused = await buildOutline(ctx());
    expect(refused.provenance.fallbackReason).toMatch(/^L0_AGENDA_DAYS/);
  });
});
