import { describe, expect, it } from "vitest";
import { channelLabel, humanise } from "@/shared/components/kit/format";

describe("humanise", () => {
  /* The four that were on screen when this was reported. Lower-casing the whole
     enum and re-capitalising character zero produced "Md", "Hrdc packet mark
     submitted", "Tna questionnaire" and "Whatsapp". §13 names amateur tells as
     what the primary persona reads first. */
  it("renders the four acronyms that were wrong on screen", () => {
    expect(humanise("MD")).toBe("MD");
    expect(humanise("HRDC_PACKET_MARK_SUBMITTED")).toBe("HRDC packet mark submitted");
    expect(humanise("TNA_QUESTIONNAIRE")).toBe("TNA questionnaire");
    expect(humanise("WHATSAPP")).toBe("WhatsApp");
  });

  /* R11: a control a reviewer has to remember to check gets a machine
     assertion. Every preserved token is named here, so adding one to the set
     without a case for it is the omission this test exists to catch. */
  it.each([
    ["AI_GENERATED", "AI generated"],
    ["EXPORT_DOCX", "Export DOCX"],
    ["HRD_LEVY", "HRD levy"],
    ["HRDC_CLAIM", "HRDC claim"],
    ["EXPORT_HTML", "Export HTML"],
    ["AWAITING_MD", "Awaiting MD"],
    ["PRICE_MYR", "Price MYR"],
    ["EXPORT_PDF", "Export PDF"],
    ["EXPORT_PPTX", "Export PPTX"],
    ["QR_SCAN", "QR scan"],
    ["SBL_KHAS", "SBL khas"],
    ["SLA_BREACH", "SLA breach"],
    ["TNA_SIGNED_OFF", "TNA signed off"],
    ["TTT_CERT", "TTT cert"],
    ["UI_THEME", "UI theme"],
  ])("preserves the acronym in %s", (input, expected) => {
    expect(humanise(input)).toBe(expected);
  });

  /* Over-preserving is its own defect. Each of these is a real enum word that
     also reads as an ordinary word, and preserving any of them would put
     shouting in the middle of a label. */
  it.each(["MY_TASKS", "US_REGION", "WA_STATE", "MS_ELAPSED", "NO_ACTION", "OK_TO_SEND"])(
    "does not preserve the ambiguous word in %s",
    (input) => {
      expect(humanise(input)).toBe(
        input.charAt(0) + input.slice(1).toLowerCase().replace(/_/g, " "),
      );
    },
  );

  it("is sentence case, not title case", () => {
    expect(humanise("PROPOSAL_SENT_TO_CLIENT")).toBe("Proposal sent to client");
  });

  it("survives empty and malformed input rather than throwing", () => {
    expect(humanise("")).toBe("");
    expect(humanise("_")).toBe("");
    expect(humanise("__LEADING")).toBe("Leading");
  });

  /* channelLabel is the older, narrower version of this fix. The two must agree
     or a screen's label depends on which helper it happened to call. */
  it("agrees with channelLabel on both message channels", () => {
    expect(humanise("EMAIL")).toBe(channelLabel("EMAIL"));
    expect(humanise("WHATSAPP")).toBe(channelLabel("WHATSAPP"));
  });
});
