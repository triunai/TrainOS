import QRCode from "qrcode";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDotEnv } from "@/server/env";
import { T3_GEOMETRY, T3_MAX_ROWS, b64ToUuid, buildLayoutPayload, renderT3TemplatePdf, uuidToB64 } from "@/server/attendance/t3Template";
import { PDFDocument } from "pdf-lib";

const PKG = "0b5e8f3e-2a41-4d7c-9a51-7c1f00d3a001";
const participant = (i: number) => ({
  id: `5a1d7c20-0000-4000-8000-${(1000 + i).toString(16).padStart(12, "0")}`,
  name: `Participant ${i + 1}`,
  nricMasked: `******-**-${1000 + i}`,
});
const input = (n: number) => ({
  pkg: { id: PKG, packageCode: "PKG-2026-0001", title: "Leading Through Change", etrisGrantId: "ETRIS-2026-001234", durationDays: 2 },
  clientName: "Kenanga Retail Group Berhad",
  trainerName: "Farah Aziz",
  venueName: "Sunway Pyramid Convention Centre",
  dayIndex: 1,
  date: "2026-10-20",
  participants: Array.from({ length: n }, (_, i) => participant(i)),
});

describe("Form T3 layout contract", () => {
  beforeAll(() => loadDotEnv());

  it("encodes UUIDs as 22-char base64url and back", () => {
    const compact = uuidToB64(PKG);
    expect(compact).toHaveLength(22);
    expect(b64ToUuid(compact)).toBe(PKG);
    expect(b64ToUuid(PKG.toUpperCase())).toBe(PKG);
    expect(() => uuidToB64("nope")).toThrow();
  });

  it("keeps a full page's QR large-moduled enough for a 200 dpi scan", () => {
    const payload = buildLayoutPayload(PKG, 1, 1, 1, Array.from({ length: T3_MAX_ROWS }, (_, i) => participant(i).id));
    const qr = QRCode.create(JSON.stringify(payload), { errorCorrectionLevel: "M" });
    const modulePt = T3_GEOMETRY.qr.size / (qr.modules.size + 4);
    // >= 1.4 pt per module = >= 3.9 px at 200 dpi.
    expect(modulePt).toBeGreaterThanOrEqual(1.4);
    expect(payload.g.f).toEqual(T3_GEOMETRY.fiducials);
    // The signature cells sit inside the table and clear of the fiducials.
    const tableBottom = T3_GEOMETRY.table.top + T3_GEOMETRY.headerHeight + T3_MAX_ROWS * T3_GEOMETRY.rowHeight;
    expect(tableBottom).toBeLessThan(T3_GEOMETRY.fiducials[2][1] - T3_GEOMETRY.fiducialSize / 2);
    expect(T3_GEOMETRY.columns.pm[0] + T3_GEOMETRY.columns.pm[1]).toBeLessThanOrEqual(T3_GEOMETRY.table.right);
  });

  it("renders deterministic bytes, one page per 15 rows", async () => {
    const a = await renderT3TemplatePdf(input(16));
    const b = await renderT3TemplatePdf(input(16));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect((await PDFDocument.load(a)).getPageCount()).toBe(2);
    await expect(renderT3TemplatePdf(input(0))).rejects.toMatchObject({ code: "NO_PARTICIPANTS" });
  });
});
