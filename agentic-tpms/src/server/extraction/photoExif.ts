import exifr from "exifr";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { todayMY } from "@/lib/dates";
import { finishAgentRun, startAgentRun } from "../ai/runs";
import { parsePayload } from "../attendance/payload";
import { type Actor, db, rows, withTx } from "../db/client";
import type { Task } from "../db/schema";
import { DomainError } from "../domain/errors";
import { enqueue } from "../queue/queue";
import { readDocument, setVerification } from "../storage/vault";
import { storeOnce } from "../attendance/t3Template";

/**
 * Session-photo evidence check (L2, deterministic — no model).
 *
 * HRD Corp asks for session photos as proof the training happened where and
 * when it was claimed. We read the photo's own EXIF: GPS position and
 * DateTimeOriginal. VERIFIED needs BOTH within 1.5 km of the booked venue
 * AND a Malaysia-time date inside the training dates; anything else is
 * FLAGGED with every reason that applied, for a human to judge. ROT
 * (remote) delivery has no venue to compare against, so it is never
 * auto-verified.
 *
 * EXIF timestamps carry no zone unless OffsetTimeOriginal is present; a
 * camera in Malaysia is on +08:00, so that is the assumption otherwise.
 */
export const PHOTO_AGENT = "evidence.photo_exif";
export const VENUE_RADIUS_KM = 1.5;
export const PHOTO_REASONS = [
  "EXIF_MISSING",
  "GPS_MISSING",
  "TIMESTAMP_MISSING",
  "TOO_FAR",
  "OUTSIDE_TRAINING_DATES",
  "VENUE_UNKNOWN",
  "ROT_MANUAL_REVIEW",
] as const;
export type PhotoReason = (typeof PHOTO_REASONS)[number];

const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/tiff"]);
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const PHOTO_STAGES = new Set(["READY_FOR_EVENT", "DELIVERY_IN_PROGRESS", "DELIVERY_COMPLETED"]);
const EXTRACTOR: Actor = { type: "SYSTEM", id: PHOTO_AGENT };

export interface PhotoExif {
  hasExif: boolean;
  lat: number | null;
  lng: number | null;
  /** ISO instant. */
  takenAt: string | null;
  /** YYYY-MM-DD in Malaysia time. */
  takenOnMY: string | null;
  offset: string | null;
}

const EXIF_DATETIME = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

export async function readPhotoExif(bytes: Uint8Array): Promise<PhotoExif> {
  const buffer = Buffer.from(bytes);
  const tags = (await exifr
    .parse(buffer, { reviveValues: false, translateValues: false, pick: ["DateTimeOriginal", "OffsetTimeOriginal", "CreateDate", "DateTimeDigitized", "OffsetTime", "Make", "Model"] })
    .catch(() => undefined)) as Record<string, unknown> | undefined;
  const gps = (await exifr.gps(buffer).catch(() => undefined)) as { latitude?: number; longitude?: number } | undefined;
  const lat = gps && Number.isFinite(gps.latitude) ? (gps.latitude as number) : null;
  const lng = gps && Number.isFinite(gps.longitude) ? (gps.longitude as number) : null;
  const raw = [tags?.DateTimeOriginal, tags?.CreateDate, tags?.DateTimeDigitized].find((v) => typeof v === "string" && EXIF_DATETIME.test(v)) as string | undefined;
  const offsetTag = [tags?.OffsetTimeOriginal, tags?.OffsetTime].find((v) => typeof v === "string" && /^[+-]\d{2}:\d{2}$/.test(v)) as string | undefined;
  let takenAt: Date | null = null;
  if (raw) {
    const m = EXIF_DATETIME.exec(raw) as RegExpExecArray;
    const candidate = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offsetTag ?? "+08:00"}`);
    takenAt = Number.isNaN(candidate.getTime()) ? null : candidate;
  }
  return {
    hasExif: Boolean(tags && Object.keys(tags).length > 0) || lat !== null,
    lat,
    lng,
    takenAt: takenAt ? takenAt.toISOString() : null,
    takenOnMY: takenAt ? todayMY(takenAt) : null,
    offset: raw ? (offsetTag ?? "+08:00 (assumed)") : null,
  };
}

/** Great-circle distance in km (haversine, mean Earth radius). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PhotoVerdict {
  status: "VERIFIED" | "FLAGGED";
  reasons: PhotoReason[];
  lat: number | null;
  lng: number | null;
  takenAt: string | null;
  takenOnMY: string | null;
  distanceKm: number | null;
  venue: { name: string; lat: number; lng: number } | null;
}

/** Pure decision over the EXIF reading and the package's venue and dates. */
export function judgePhoto(
  exif: PhotoExif,
  pkg: { deliveryMode: string; startDate: string | null; endDate: string | null },
  venue: { name: string; lat: number | null; lng: number | null } | null,
): PhotoVerdict {
  const reasons: PhotoReason[] = [];
  const rot = pkg.deliveryMode === "ROT_VIRTUAL";
  if (rot) reasons.push("ROT_MANUAL_REVIEW");
  let distance: number | null = null;
  const venuePoint = venue && venue.lat !== null && venue.lng !== null ? { name: venue.name, lat: venue.lat, lng: venue.lng } : null;
  if (!exif.hasExif) {
    reasons.push("EXIF_MISSING");
  } else {
    if (!rot) {
      if (exif.lat === null || exif.lng === null) reasons.push("GPS_MISSING");
      else if (!venuePoint) reasons.push("VENUE_UNKNOWN");
      else {
        distance = distanceKm({ lat: exif.lat, lng: exif.lng }, venuePoint);
        if (distance > VENUE_RADIUS_KM) reasons.push("TOO_FAR");
      }
    }
    if (!exif.takenOnMY) reasons.push("TIMESTAMP_MISSING");
    else if (!pkg.startDate || !pkg.endDate || exif.takenOnMY < pkg.startDate || exif.takenOnMY > pkg.endDate) {
      reasons.push("OUTSIDE_TRAINING_DATES");
    }
  }
  return {
    status: reasons.length === 0 ? "VERIFIED" : "FLAGGED",
    reasons,
    lat: exif.lat,
    lng: exif.lng,
    takenAt: exif.takenAt,
    takenOnMY: exif.takenOnMY,
    distanceKm: distance === null ? null : Math.round(distance * 1000) / 1000,
    venue: venuePoint,
  };
}

async function packageAndVenue(packageId: string) {
  const [pkg] = await rows<{ id: string; delivery_mode: string; start_date: string | null; end_date: string | null; operational_stage: string }>(
    db(),
    sql`select id, delivery_mode, start_date, end_date, operational_stage from tpms.training_packages where id = ${packageId}::uuid`,
  );
  const [venue] = await rows<{ name: string; latitude: string | null; longitude: string | null }>(
    db(),
    sql`select v.name, v.latitude, v.longitude from tpms.vendor_commitments c join tpms.vendors v on v.id = c.vendor_id
         where c.package_id = ${packageId}::uuid and c.vendor_type = 'VENUE' and c.status <> 'CANCELLED'
         order by c.created_at desc limit 1`,
  );
  return {
    pkg,
    venue: venue ? { name: venue.name, lat: venue.latitude === null ? null : Number(venue.latitude), lng: venue.longitude === null ? null : Number(venue.longitude) } : null,
  };
}

export async function uploadSessionPhoto(
  packageId: string,
  bytes: Uint8Array,
  mime: string,
  fileName: string,
  actor: Actor,
): Promise<{ vaultId: string; taskId: string | null; duplicate: boolean }> {
  if (!PHOTO_MIME.has(mime)) throw new DomainError("UNSUPPORTED_MEDIA", `Session photos must be JPEG, PNG, HEIC, WebP or TIFF (got ${mime})`);
  if (bytes.byteLength === 0) throw new DomainError("EMPTY_FILE", "The uploaded photo is empty");
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new DomainError("FILE_TOO_LARGE", "Session photos are limited to 20 MB");
  return withTx(actor, { reasonCode: "SESSION_PHOTO_UPLOADED" }, async (tx) => {
    const [pkg] = await rows<{ operational_stage: string }>(tx, sql`select operational_stage from tpms.training_packages where id = ${packageId}::uuid`);
    if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
    if (!PHOTO_STAGES.has(pkg.operational_stage)) {
      throw new DomainError("PHOTO_UPLOAD_NOT_ALLOWED", `Session photos are accepted from READY_FOR_EVENT onward (package is ${pkg.operational_stage})`);
    }
    const { doc, created } = await storeOnce(tx, {
      packageId, documentType: "PHOTO_EVIDENCE", fileName, mimeType: mime, bytes, uploadedBy: actor.id,
      extractedMetadata: { source: "SESSION_PHOTO" },
    });
    const taskId = await enqueue(tx, { type: "evidence.photo_exif", payload: { packageId, vaultId: doc.id }, idempotencyKey: `exif:${doc.id}` });
    return { vaultId: doc.id, taskId, duplicate: !created };
  });
}

export const photoTaskPayload = z.object({ packageId: z.string().uuid(), vaultId: z.string().uuid() });

export async function handlePhotoExif(task: Pick<Task, "id" | "payload">): Promise<PhotoVerdict | { status: "SKIPPED_HUMAN_VERDICT"; vaultId: string }> {
  const { packageId, vaultId } = parsePayload(photoTaskPayload, task.payload, "evidence.photo_exif");
  const read = await readDocument(vaultId);
  if (!read || read.doc.packageId !== packageId || read.doc.documentType !== "PHOTO_EVIDENCE") {
    throw new DomainError("PHOTO_DOCUMENT_MISMATCH", "The task does not point at this package's session photo");
  }
  if (!read.intact) throw new DomainError("VAULT_TAMPERED", "The stored photo no longer matches its SHA-256");
  // A human's verdict is final; a retried task never overwrites it.
  if (read.doc.verificationStatus !== "PENDING" && read.doc.verifiedBy && read.doc.verifiedBy !== PHOTO_AGENT) {
    return { status: "SKIPPED_HUMAN_VERDICT", vaultId };
  }
  const runId = await startAgentRun(db(), { agent: PHOTO_AGENT, tier: "L2", packageId, taskId: task.id, inputSummary: `PHOTO_EVIDENCE ${read.doc.fileName}` });
  try {
    const started = Date.now();
    const exif = await readPhotoExif(new Uint8Array(read.bytes));
    const { pkg, venue } = await packageAndVenue(packageId);
    if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
    const verdict = judgePhoto(exif, { deliveryMode: pkg.delivery_mode, startDate: pkg.start_date, endDate: pkg.end_date }, venue);
    const note = verdict.status === "VERIFIED"
      ? `Taken ${verdict.takenOnMY}, ${verdict.distanceKm} km from ${verdict.venue?.name}`
      : `Needs review: ${verdict.reasons.join(", ")}`;
    await withTx(EXTRACTOR, { reasonCode: "PHOTO_EXIF_CHECKED" }, (tx) =>
      setVerification(tx, vaultId, verdict.status, PHOTO_AGENT, note, {
        ...read.doc.extractedMetadata,
        lat: verdict.lat,
        lng: verdict.lng,
        takenAt: verdict.takenAt,
        takenOnMY: verdict.takenOnMY,
        timezone: exif.offset,
        distanceKm: verdict.distanceKm,
        reasons: verdict.reasons,
        venue: verdict.venue,
        radiusKm: VENUE_RADIUS_KM,
        trainingDates: { start: pkg.start_date, end: pkg.end_date },
        engine: "exifr",
        checkedAt: new Date().toISOString(),
      }));
    await finishAgentRun(db(), runId, {
      status: "SUCCEEDED",
      output: { ...verdict },
      provenance: { tier: "L2", agent: PHOTO_AGENT, mode: "EXTRACTION", provider: "exifr", model: "exif-gps-rule", costMyr: 0, latencyMs: Date.now() - started, confidence: verdict.status === "VERIFIED" ? 1 : 0 },
    });
    return verdict;
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) });
    throw error;
  }
}
