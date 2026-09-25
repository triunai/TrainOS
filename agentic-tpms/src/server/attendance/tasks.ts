import type { HandlerMap } from "../queue/registry";
import { handlePhotoExif } from "../extraction/photoExif";
import { handleOcrT3 } from "./ingestT3";
import { handleIssueMagicLinks } from "./magicLinks";

/**
 * Lane C task handlers, composed by worker/handlers.ts.
 *
 *   attendance.ocr_t3           {packageId, vaultId}  Track B scan -> records, exceptions
 *   delivery.issue_magic_links  {packageId}           Track A links (+ email when the mailer exists)
 *   evidence.photo_exif         {packageId, vaultId}  session photo GPS/date check
 *
 * Each throws a DomainError for a refusal (dead-lettered, never retried) and
 * a plain Error for transport trouble (the extraction service is down).
 */
export const handlers: HandlerMap = {
  "attendance.ocr_t3": async (task) => ({ ...(await handleOcrT3(task)) }),
  "delivery.issue_magic_links": (task) => handleIssueMagicLinks(task),
  "evidence.photo_exif": async (task) => ({ ...(await handlePhotoExif(task)) }),
};
