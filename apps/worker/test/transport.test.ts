import { describe, expect, it } from "vitest";
import { quoteIdentifier } from "../src/transport";

describe("quoteIdentifier", () => {
  it("quotes a plain role name, because SET ROLE takes an identifier and not a parameter", () => {
    expect(quoteIdentifier("service_role")).toBe('"service_role"');
  });

  it("refuses anything that is not a plain identifier rather than escaping it", () => {
    for (const bad of ["service role", 'svc"; drop role x', "", "1role"]) {
      expect(() => quoteIdentifier(bad)).toThrow(/not a plain identifier/);
    }
  });
});
