import { describe, expect, it } from "vitest";
import { buildExifJpeg, toDmsRationals, trainingRoomScene } from "@/server/demo/exifJpeg";
import { judgePhoto, readPhotoExif } from "@/server/extraction/photoExif";

/** Walk the JPEG marker segments up to SOS: each marker with the offset of its segment payload. */
function segments(bytes: Uint8Array): Array<{ marker: number; at: number }> {
  const seen: Array<{ marker: number; at: number }> = [];
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  let i = 2;
  while (i < bytes.length) {
    expect(bytes[i]).toBe(0xff);
    const marker = bytes[i + 1];
    seen.push({ marker, at: i + 4 });
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + length;
    if (marker === 0xda) break; // entropy-coded data follows
  }
  return seen;
}

describe("demo JPEG-with-EXIF builder", () => {
  const venue = { name: "Sunway Pyramid Convention Centre", lat: 3.0726, lng: 101.6074 };

  it("writes GPS and DateTimeOriginal + OffsetTimeOriginal that readPhotoExif reads back exactly", async () => {
    const jpeg = buildExifJpeg({ lat: 3.07281, lng: 101.60762, takenAt: "2026-10-15T10:32:05", offset: "+08:00" });
    const exif = await readPhotoExif(jpeg);
    expect(exif.hasExif).toBe(true);
    expect(exif.lat).toBeCloseTo(3.07281, 6);
    expect(exif.lng).toBeCloseTo(101.60762, 6);
    expect(exif.takenAt).toBe("2026-10-15T02:32:05.000Z");
    expect(exif.takenOnMY).toBe("2026-10-15");
    expect(exif.offset).toBe("+08:00");
  });

  it("is judged VERIFIED against the venue on a training day, and FLAGGED off-site or off-date", async () => {
    const pkg = { deliveryMode: "IN_HOUSE", startDate: "2026-10-15", endDate: "2026-10-16" };
    const onSite = await readPhotoExif(buildExifJpeg({ lat: 3.07281, lng: 101.60762, takenAt: "2026-10-16T15:05:00", offset: "+08:00" }));
    expect(judgePhoto(onSite, pkg, venue)).toMatchObject({ status: "VERIFIED", reasons: [] });

    const klcc = await readPhotoExif(buildExifJpeg({ lat: 3.1579, lng: 101.7116, takenAt: "2026-10-16T15:05:00", offset: "+08:00" }));
    expect(judgePhoto(klcc, pkg, venue).reasons).toEqual(["TOO_FAR"]);

    // A camera on UTC that wrote 23:30 on the 14th took the photo at 07:30 on the 15th in Malaysia: a training day.
    const early = await readPhotoExif(buildExifJpeg({ lat: 3.07281, lng: 101.60762, takenAt: "2026-10-14T23:30:00", offset: "+00:00" }));
    expect(early.takenOnMY).toBe("2026-10-15");
    const dayBefore = await readPhotoExif(buildExifJpeg({ lat: 3.07281, lng: 101.60762, takenAt: "2026-10-14T18:00:00", offset: "+08:00" }));
    expect(judgePhoto(dayBefore, pkg, venue).reasons).toEqual(["OUTSIDE_TRAINING_DATES"]);
  });

  it("assumes +08:00 when no offset is written, and handles the southern and western hemispheres", async () => {
    const exif = await readPhotoExif(buildExifJpeg({ lat: -33.8688, lng: -70.6693, takenAt: "2026-10-16T07:30:00", offset: null }));
    expect(exif.lat).toBeCloseTo(-33.8688, 6);
    expect(exif.lng).toBeCloseTo(-70.6693, 6);
    expect(exif.offset).toBe("+08:00 (assumed)");
    expect(exif.takenAt).toBe("2026-10-15T23:30:00.000Z");
  });

  it("is a well-formed baseline JPEG: SOI, APP1 Exif, DQT, SOF0, DHT x2, SOS ... EOI", () => {
    const jpeg = buildExifJpeg({ lat: 3.07, lng: 101.6, takenAt: "2026-10-15T09:00:00", offset: "+08:00", width: 100, height: 60, scene: trainingRoomScene(1) });
    const segs = segments(jpeg);
    expect(segs.map((s) => s.marker)).toEqual([0xe1, 0xdb, 0xc0, 0xc4, 0xc4, 0xda]);
    expect(Buffer.from(jpeg.subarray(6, 12)).toString("latin1")).toBe("Exif\0\0");
    expect([jpeg[jpeg.length - 2], jpeg[jpeg.length - 1]]).toEqual([0xff, 0xd9]);
    // SOF0 (precision, height, width, components) carries the size rounded up to whole 8x8 blocks.
    const sof = segs.find((s) => s.marker === 0xc0)!.at;
    expect({ precision: jpeg[sof], height: (jpeg[sof + 1] << 8) | jpeg[sof + 2], width: (jpeg[sof + 3] << 8) | jpeg[sof + 4], components: jpeg[sof + 5] })
      .toEqual({ precision: 8, height: 64, width: 104, components: 3 });
  });

  it("differs byte-for-byte when the capture time differs (the vault de-duplicates identical bytes)", () => {
    const a = buildExifJpeg({ lat: 3.07, lng: 101.6, takenAt: "2026-10-15T09:00:00", offset: "+08:00" });
    const b = buildExifJpeg({ lat: 3.07, lng: 101.6, takenAt: "2026-10-15T09:00:01", offset: "+08:00" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("encodes DMS rationals and refuses malformed input", () => {
    expect(toDmsRationals(3.0726)).toEqual([[3, 1], [4, 1], [213_600, 10_000]]);
    expect(() => buildExifJpeg({ lat: 91, lng: 0, takenAt: "2026-10-15T09:00:00" })).toThrow(/Latitude/);
    expect(() => buildExifJpeg({ lat: 3, lng: 101, takenAt: "2026-10-15 09:00" })).toThrow(/takenAt/);
    expect(() => buildExifJpeg({ lat: 3, lng: 101, takenAt: "2026-10-15T09:00:00", offset: "8" })).toThrow(/Offset/);
  });
});
