import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type CertificatePayload,
  assertPayload,
  canonicalJson,
  certificateSerial,
  normaliseSerial,
  payloadSha256,
  verificationUrl,
} from "@/server/certificates";

const payload: CertificatePayload = {
  serial: "CERT-2026-0042-007",
  holderName: "Nur Aisyah binti Abdullah",
  nricMasked: "******-**-1234",
  courseTitle: "Leading Through Change",
  packageCode: "PKG-2026-0042",
  startDate: "2026-10-12",
  endDate: "2026-10-13",
  hours: 14,
  providerName: "Alex Training Sdn Bhd",
  providerHrdcId: "TP-102938",
  issuedOn: "2026-10-14",
};

describe("canonical certificate payload", () => {
  it("serialises with sorted keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}');
  });

  it("hashes identical facts identically, whatever the key order", () => {
    const reversed = Object.fromEntries(Object.entries(payload).reverse()) as CertificatePayload;
    expect(payloadSha256(reversed)).toBe(payloadSha256(payload));
    const expected = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    expect(payloadSha256(payload)).toBe(expected);
    expect(payloadSha256({ ...payload, holderName: "Nur Aisyah Abdullah" })).not.toBe(expected);
    expect(payloadSha256({ ...payload, hours: 21 })).not.toBe(expected);
  });

  it("refuses a raw NRIC and any key outside the closed set", () => {
    expect(() => assertPayload({ ...payload, nricMasked: "900101-14-1234" })).toThrow(/masked/);
    expect(() => assertPayload({ ...payload, nricMasked: "900101141234" })).toThrow(/masked/);
    expect(() => assertPayload({ ...payload, nric: "900101141234" })).toThrow();
    expect(assertPayload({ ...payload, nricMasked: "*****4567" }).nricMasked).toBe("*****4567");
  });
});

describe("serials", () => {
  it("formats CERT-{end year}-{package number}-{NNN}", () => {
    expect(certificateSerial("2026-10-13", "PKG-2025-0042", 7)).toBe("CERT-2026-0042-007");
    expect(certificateSerial("2027-01-02", "PKG-2026-0042", 1234)).toBe("CERT-2027-0042-1234");
    expect(() => certificateSerial("2026-10-13", "CUSTOM", 1)).toThrow(/running number/);
  });

  it("normalises public input and rejects anything not serial-shaped", () => {
    expect(normaliseSerial(" cert-2026-0042-007 ")).toBe("CERT-2026-0042-007");
    expect(normaliseSerial("CERT-2026-0042-007' or 1=1")).toBeUndefined();
    expect(normaliseSerial("")).toBeUndefined();
  });

  it("builds the public verification URL", () => {
    expect(verificationUrl("https://tpms.example.my/", "CERT-2026-0042-007")).toBe("https://tpms.example.my/verify/CERT-2026-0042-007");
  });
});
