/**
 * Public surface of the certification engine. Callers (the worker, the
 * `/verify/[serial]` page, the certificates screen, the executive pack)
 * import from here.
 */
export {
  CERT_ACTOR,
  CERT_AGENT,
  buildPayload,
  issueCertificates,
  type IssueResult,
  type SkipReason,
} from "./issue";
export {
  HOURS_PER_DAY,
  SERIAL_PATTERN,
  assertPayload,
  canonicalJson,
  certificateSerial,
  normaliseSerial,
  payloadSha256,
  verificationUrl,
  type CertificatePayload,
} from "./payload";
export { renderCertificatePdf } from "./pdf";
export {
  readCertificatePdf,
  verifyCertificate,
  type VerificationResult,
  type VerificationStatus,
  type VerifiedCertificate,
} from "./verify";
export { listCertificates, revokeCertificate, type CertificateListItem } from "./registry";
export { certificatesBundleZip, type CertificateBundle } from "./bundle";
export { handlers } from "./tasks";
