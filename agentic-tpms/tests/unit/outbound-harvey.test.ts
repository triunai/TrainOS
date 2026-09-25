import { describe, expect, it } from "vitest";
import { importTargetsCsv, parseCsv } from "@/server/outbound/csv";
import { MAX_WORDS, OPT_OUT_LINE, SEQUENCE_STEPS, acceptDraft, templateTouch, withOptOut, wordCount } from "@/server/outbound/harvey";
import { isStopReply } from "@/server/outbound/suppression";

const target = {
  company: "Kenanga Retail Group Berhad",
  picName: "Nurul Hassan",
  picEmail: "nurul@kenangaretail.com.my",
  hiringSignal: "Hiring 12 production supervisors for the new Shah Alam plant (JobStreet, Sep 2026)",
};

describe("Harvey templates", () => {
  it.each(SEQUENCE_STEPS)("touch %i is under the word budget and ends with the opt-out line", (step) => {
    const draft = templateTouch(target, step, "Alex Training Sdn Bhd");
    expect(wordCount(draft.body)).toBeLessThan(MAX_WORDS);
    expect(draft.body.trimEnd().endsWith(OPT_OUT_LINE)).toBe(true);
    expect(draft.body).toMatch(/levy/i);
    expect(draft.subject.length).toBeLessThanOrEqual(255);
  });

  it("drops optional sentences, never the opt-out, when a long name eats the budget", () => {
    const long = { ...target, company: "Syarikat Perniagaan Dan Perkhidmatan Logistik Antarabangsa Wilayah Utara Sdn Bhd" };
    const draft = templateTouch(long, 1, "Alex Training & Consultancy Services Sdn Bhd");
    expect(wordCount(draft.body)).toBeLessThan(MAX_WORDS);
    expect(draft.body.endsWith(OPT_OUT_LINE)).toBe(true);
  });

  it("keeps exactly one opt-out line whatever the writer produced", () => {
    const body = withOptOut("Hello,\nSome copy.\nTo unsubscribe click here.\nReply STOP to opt out.");
    expect(body.match(/Reply STOP to opt out\./g)).toHaveLength(1);
    expect(body).not.toMatch(/unsubscribe/i);
  });

  it("replaces an over-length or placeholder-laden model draft with the template", () => {
    const fallback = templateTouch(target, 1, "Alex Training Sdn Bhd");
    const long = acceptDraft({ subject: "Hi", body: Array.from({ length: 90 }, () => "word").join(" ") }, fallback, true);
    expect(long).toMatchObject({ accepted: false, source: "TEMPLATE" });
    expect(long.accepted ? "" : long.rejectedReason).toMatch(/^OVER_WORD_BUDGET/);
    const placeholder = acceptDraft({ subject: "Levy", body: "Hi [Name], your levy is waiting for you and your team this year." }, fallback, true);
    expect(placeholder).toMatchObject({ accepted: false });
    const good = acceptDraft({ subject: "Your levy", body: "Hi Nurul, unused HRD Corp levy can fund your supervisors' training. Worth a call?" }, fallback, true);
    expect(good).toMatchObject({ accepted: true, source: "MODEL" });
    expect(good.draft.body.endsWith(OPT_OUT_LINE)).toBe(true);
  });
});

describe("permissioned CSV import", () => {
  it("parses quotes, embedded commas and newlines, and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi""\nthere"\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"\nthere'],
    ]);
  });

  it("maps header aliases and reports bad lines without dropping good ones", () => {
    const csv = [
      "Company Name,Contact Name,Email,SSM No,Notes",
      "Kenanga Retail Group Berhad,Nurul Hassan,NURUL@kenangaretail.com.my,199701012345,Hiring 12 supervisors",
      ",Nobody,nobody@x.my,,",
      "Petrosains Logistics Sdn Bhd,Tan Wei Ming,not-an-email,,",
    ].join("\n");
    const result = importTargetsCsv(csv);
    expect(result.targets).toEqual([
      {
        company: "Kenanga Retail Group Berhad",
        picName: "Nurul Hassan",
        picEmail: "nurul@kenangaretail.com.my",
        ssm: "199701012345",
        hiringSignal: "Hiring 12 supervisors",
      },
    ]);
    expect(result.errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it("refuses a file without company and email columns", () => {
    expect(() => importTargetsCsv("name,phone\nA,1")).toThrow(/company column and an email column/);
  });
});

describe("STOP replies", () => {
  it.each([
    ["Re: your levy", "STOP", true],
    ["STOP", "", true],
    ["Re: levy", "Unsubscribe me please", true],
    ["Re: levy", "Can you stop by our office next week?", false],
    ["Re: levy", "Stop by our office next week?", false],
    ["Re: levy", "Stop please.", true],
    ["Stop sending these", "Thanks", false],
  ])("%j / %j -> %s", (subject, text, expected) => {
    expect(isStopReply(subject, text)).toBe(expected);
  });
});
