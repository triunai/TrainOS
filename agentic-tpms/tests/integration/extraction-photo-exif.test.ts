import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import type { Task } from "@/server/db/schema";
import { updatePackageFields } from "@/server/fsm/service";
import { claimDue } from "@/server/queue/queue";
import { readDocument, setVerification } from "@/server/storage/vault";
import { handlers } from "@/server/attendance";
import { distanceKm, judgePhoto, readPhotoExif, uploadSessionPhoto } from "@/server/extraction/photoExif";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt, type LifecycleFixture } from "../helpers/lifecycle";

/**
 * Fixtures: tests/fixtures/photos (regenerate with
 * services/paddleocr/scripts/make_photo_fixtures.py). Their EXIF dates are
 * fixed, so the package's training dates are pinned to 2026-10-20..21 here.
 * The venue is the lifecycle helper's, at (3.0726, 101.6074).
 */
const photo = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/photos/${name}`));
const ctx = { workerId: "test-worker", heartbeat: async () => undefined };

async function check(packageId: string, name: string) {
  const upload = await uploadSessionPhoto(packageId, photo(name), "image/jpeg", name, ALEX);
  const [task] = (await claimDue("test-worker", 20, 300, ["evidence.photo_exif"])).filter(
    (t) => (t.payload as { vaultId: string }).vaultId === upload.vaultId,
  ) as Task[];
  const result = await handlers["evidence.photo_exif"]!(task, ctx);
  const doc = (await readDocument(upload.vaultId))!.doc;
  return { upload, result, doc };
}

describe("session photo EXIF verification", () => {
  let fx: LifecycleFixture;

  beforeAll(async () => {
    await useTestDatabase();
    fx = await buildPackageAt("DELIVERY_IN_PROGRESS", { participants: 5 });
    await updatePackageFields(fx.pkg.id, { startDate: "2026-10-20", endDate: "2026-10-21" }, ALEX, "TEST_DATES_PINNED");
  });
  afterAll(releaseTestDatabase);

  it("reads GPS and the capture time, assuming +08:00 when the camera wrote no offset", async () => {
    const exif = await readPhotoExif(photo("near-venue-early-no-offset.jpg"));
    expect(exif.lat).toBeCloseTo(3.07295, 5);
    expect(exif.lng).toBeCloseTo(101.60795, 5);
    // 07:30 in Malaysia is 23:30 UTC the day before: the MY date is what counts.
    expect(exif.takenAt).toBe("2026-10-19T23:30:00.000Z");
    expect(exif.takenOnMY).toBe("2026-10-20");
    expect((await readPhotoExif(photo("no-exif.jpg"))).hasExif).toBe(false);
  });

  it("VERIFIES a photo taken at the venue on a training day", async () => {
    for (const name of ["near-venue.jpg", "near-venue-early-no-offset.jpg"]) {
      const { doc, result } = await check(fx.pkg.id, name);
      expect(result).toMatchObject({ status: "VERIFIED", reasons: [] });
      expect(doc.verificationStatus).toBe("VERIFIED");
      expect(doc.verifiedBy).toBe("evidence.photo_exif");
      expect(doc.extractedMetadata).toMatchObject({ reasons: [], takenOnMY: "2026-10-20" });
      expect(doc.extractedMetadata.distanceKm as number).toBeLessThan(0.2);
    }
  });

  it("FLAGS a photo too far away, on the wrong day, without GPS, or without EXIF", async () => {
    const far = await check(fx.pkg.id, "far-away.jpg");
    expect(far.doc.verificationStatus).toBe("FLAGGED");
    expect(far.doc.extractedMetadata.reasons).toEqual(["TOO_FAR"]);
    expect(far.doc.extractedMetadata.distanceKm as number).toBeGreaterThan(10);

    expect((await check(fx.pkg.id, "wrong-day.jpg")).doc.extractedMetadata.reasons).toEqual(["OUTSIDE_TRAINING_DATES"]);
    expect((await check(fx.pkg.id, "no-gps.jpg")).doc.extractedMetadata.reasons).toEqual(["GPS_MISSING"]);
    const bare = await check(fx.pkg.id, "no-exif.jpg");
    expect(bare.doc.extractedMetadata.reasons).toEqual(["EXIF_MISSING"]);
    expect(bare.doc.verificationNotes).toContain("EXIF_MISSING");
  });

  it("never auto-verifies an ROT (remote) delivery", async () => {
    const rot = await buildPackageAt("DELIVERY_IN_PROGRESS", { participants: 5 });
    await updatePackageFields(rot.pkg.id, { startDate: "2026-10-20", endDate: "2026-10-21", deliveryMode: "ROT_VIRTUAL" }, ALEX, "TEST_DATES_PINNED");
    const { doc } = await check(rot.pkg.id, "near-venue.jpg");
    expect(doc.verificationStatus).toBe("FLAGGED");
    expect(doc.extractedMetadata.reasons).toEqual(["ROT_MANUAL_REVIEW"]);
  });

  it("dedupes an identical upload and keeps a human verdict on retry", async () => {
    const first = await uploadSessionPhoto(fx.pkg.id, photo("near-venue.jpg"), "image/jpeg", "again.jpg", ALEX);
    expect(first.duplicate).toBe(true);
    expect(first.taskId).toBeNull();

    const other = await buildPackageAt("DELIVERY_IN_PROGRESS", { participants: 5 });
    const upload = await uploadSessionPhoto(other.pkg.id, photo("far-away.jpg"), "image/jpeg", "far.jpg", ALEX);
    await setVerification(db(), upload.vaultId, "VERIFIED", ALEX.id, "Operator: taken at the client's second site");
    const [task] = (await claimDue("test-worker", 20, 300, ["evidence.photo_exif"])).filter(
      (t) => (t.payload as { vaultId: string }).vaultId === upload.vaultId,
    ) as Task[];
    expect(await handlers["evidence.photo_exif"]!(task, ctx)).toMatchObject({ status: "SKIPPED_HUMAN_VERDICT" });
    expect((await readDocument(upload.vaultId))!.doc.verifiedBy).toBe(ALEX.id);
  });

  it("refuses unsupported uploads and early stages", async () => {
    await expect(uploadSessionPhoto(fx.pkg.id, photo("near-venue.jpg"), "application/pdf", "x.pdf", ALEX)).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    const early = await buildPackageAt("OPERATIONS_LOCKED");
    await expect(uploadSessionPhoto(early.pkg.id, photo("near-venue.jpg"), "image/jpeg", "x.jpg", ALEX)).rejects.toMatchObject({ code: "PHOTO_UPLOAD_NOT_ALLOWED" });
  });

  it("judges by pure rules (distance, radius, dates, venue)", () => {
    expect(distanceKm({ lat: 3.0726, lng: 101.6074 }, { lat: 3.1579, lng: 101.7123 })).toBeCloseTo(14.9, 0);
    const exif = { hasExif: true, lat: 3.0726, lng: 101.6074, takenAt: "2026-10-20T02:00:00.000Z", takenOnMY: "2026-10-20", offset: "+08:00" };
    const pkg = { deliveryMode: "IN_HOUSE", startDate: "2026-10-20", endDate: "2026-10-21" };
    expect(judgePhoto(exif, pkg, { name: "Venue", lat: 3.0726, lng: 101.6074 }).status).toBe("VERIFIED");
    expect(judgePhoto(exif, pkg, null).reasons).toEqual(["VENUE_UNKNOWN"]);
    expect(judgePhoto({ ...exif, takenAt: null, takenOnMY: null }, pkg, { name: "V", lat: 3.0726, lng: 101.6074 }).reasons).toEqual(["TIMESTAMP_MISSING"]);
    // 1.4 km north is inside the 1.5 km radius; 1.6 km is not.
    expect(judgePhoto({ ...exif, lat: 3.0726 + 1.4 / 111.2 }, pkg, { name: "V", lat: 3.0726, lng: 101.6074 }).status).toBe("VERIFIED");
    expect(judgePhoto({ ...exif, lat: 3.0726 + 1.6 / 111.2 }, pkg, { name: "V", lat: 3.0726, lng: 101.6074 }).reasons).toEqual(["TOO_FAR"]);
  });
});
