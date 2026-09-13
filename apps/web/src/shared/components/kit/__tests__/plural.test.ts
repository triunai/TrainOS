import { describe, expect, it } from "vitest";
import { plural } from "@/shared/components/kit";

/**
 * The helper exists because "1 suggested next steps" reached a screenshot. The
 * cases below are the three a count line actually meets.
 */
describe("plural", () => {
  it("keeps the singular at exactly one", () => {
    expect(plural(1, "suggestion")).toBe("1 suggestion");
    expect(plural(1, "stage")).toBe("1 stage");
  });

  it("pluralises everything else, zero included", () => {
    expect(plural(0, "suggestion")).toBe("0 suggestions");
    expect(plural(4, "suggestion")).toBe("4 suggestions");
  });

  it("takes an irregular plural, because 2 companys is not a word", () => {
    expect(plural(2, "company", "companies")).toBe("2 companies");
    expect(plural(1, "company", "companies")).toBe("1 company");
  });
});
