import { describe, expect, it } from "vitest";
import {
  type ClassifierInput,
  QUALIFY_THRESHOLD,
  REVIEW_THRESHOLD,
  classifyDeterministic,
  levyFeatures,
  pLevy,
  routeFor,
} from "@/server/ingestion/classifier";
import { parseTnaReply } from "@/server/ingestion/microTna";

const base: ClassifierInput = {
  companyName: "Unknown company",
  companyDomain: null,
  picEmail: "",
  picPhoneE164: "",
  ssm: null,
  topic: null,
  message: null,
  estimatedPax: null,
  channel: "WEB_FORM",
};

describe("L1 classifier calibration anchors", () => {
  it("a clear corporate HRDC enquiry qualifies", () => {
    const out = classifyDeterministic({
      ...base,
      companyName: "Kenanga Retail Group Berhad",
      companyDomain: "kenangaretail.com.my",
      picEmail: "nurul@kenangaretail.com.my",
      topic: "Leadership",
      message: "In-house leadership training for 30 pax, HRDC claimable please.",
      estimatedPax: 30,
    });
    expect(out.intent.value).toBe("TRAINING_ENQUIRY");
    expect(out.abstain).toBeNull();
    expect(out.pLevy.value).toBeGreaterThanOrEqual(QUALIFY_THRESHOLD);
    expect(routeFor(out).route).toBe("LEAD_QUALIFIED_TNA");
  });

  it("a corporate domain with nothing else is uncertain", () => {
    const p = pLevy(levyFeatures({ ...base, companyName: "Brightwave", companyDomain: "brightwave.com.my", picEmail: "d@brightwave.com.my" }));
    expect(p).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(p).toBeLessThan(QUALIFY_THRESHOLD);
  });

  it("a gmail individual is private cash", () => {
    const out = classifyDeterministic({
      ...base,
      picEmail: "ahmad.zaki88@gmail.com",
      message: "Hi, I would like to join your Excel course for my own career. How much is the fee?",
      topic: "Microsoft Excel",
    });
    expect(out.pLevy.value).toBeLessThan(REVIEW_THRESHOLD);
    expect(routeFor(out).route).toBe("PRIVATE_CASH");
  });

  it("the public sector is penalised below review even with levy words", () => {
    const out = classifyDeterministic({
      ...base,
      companyName: "Jabatan Kerja Raya",
      companyDomain: "jkr.gov.my",
      picEmail: "pegawai@jkr.gov.my",
      message: "Kursus latihan untuk 40 peserta, boleh tuntut HRDC?",
      estimatedPax: 40,
    });
    expect(out.pLevy.features.publicSector).toBe(1);
    expect(out.pLevy.value).toBeLessThan(REVIEW_THRESHOLD);
  });

  it("a vendor pitch is archived whatever its levy score", () => {
    const out = classifyDeterministic({
      ...base,
      companyName: "Growthleads",
      companyDomain: "growthleads.io",
      picEmail: "jason@growthleads.io",
      message:
        "Hi team, we are a digital marketing agency and we help training providers get 3x more leads. Our services can help you grow your business with SEO and lead generation. Can we book a call?",
      channel: "INBOUND_MAIL",
    });
    expect(out.intent.value).toBe("VENDOR_PITCH");
    expect(routeFor(out)).toEqual({ route: "ARCHIVED", reason: "INTENT_VENDOR_PITCH" });
  });

  it("a job seeker is archived", () => {
    const out = classifyDeterministic({ ...base, picEmail: "k@gmail.com", message: "Dear HR, please find my resume attached. I am applying for the trainer position.", channel: "INBOUND_MAIL" });
    expect(out.intent.value).toBe("JOB_SEEKER");
    expect(routeFor(out).route).toBe("ARCHIVED");
  });

  it("abstains (Noul) on a notification with no fields, routing to a human", () => {
    const out = classifyDeterministic({ ...base, channel: "META_LEADGEN" });
    expect(out.abstain).toMatchObject({ kind: "Noul" });
    expect(routeFor(out)).toEqual({ route: "TRIAGE_REVIEW", reason: "ABSTAINED" });
  });

  it("a platform test lead is archived", () => {
    expect(routeFor(classifyDeterministic(base), { isTest: true }).route).toBe("ARCHIVED");
  });

  it("urgency rises with deadline words and levy expiry", () => {
    const calm = classifyDeterministic({ ...base, companyName: "A Sdn Bhd", picEmail: "a@a.com.my", companyDomain: "a.com.my", message: "Leadership training for our team please" });
    const hot = classifyDeterministic({
      ...base,
      companyName: "A Sdn Bhd",
      picEmail: "a@a.com.my",
      companyDomain: "a.com.my",
      message: "Urgent: leadership training for 25 pax before year end, our levy balance is unutilised",
      estimatedPax: 25,
    });
    expect(calm.urgency.value).toBe(2);
    expect(hot.urgency.value).toBe(5);
  });
});

describe("micro-TNA reply parsing (English and Malay)", () => {
  it.each([
    ["Yes, about 25 pax in March", { levyActive: true, cohortSize: 25, timeline: "March" }],
    ["Ya, kami berdaftar. 30 orang, bulan depan", { levyActive: true, cohortSize: 30, timeline: "bulan depan" }],
    ["No, we are not registered", { levyActive: false, cohortSize: null, timeline: null }],
    ["Tidak", { levyActive: false, cohortSize: null, timeline: null }],
    ["Not sure, need to check with finance", { levyActive: null, cohortSize: null, timeline: null }],
    ["yes but not sure about the balance, 20-25 pax", { levyActive: true, cohortSize: 25, timeline: null }],
    ["Yes. Maybe 15 November", { levyActive: true, cohortSize: null, timeline: "15 November" }],
  ])("%j", (text, expected) => {
    expect(parseTnaReply(text)).toEqual(expected);
  });
});
