import { toSen } from "@/lib/money";
import { daysBetween } from "@/lib/dates";
import { docsOf, type PackageSnapshot } from "../packages/snapshot";
import type { TransitionRule } from "./transitions";

/**
 * Level 0 — the deterministic policy validator.
 *
 * Pure functions over a package snapshot: no model, no I/O, no clock except
 * `snapshot.today`. A transition runs only when every blocking guard for its
 * reason passes; warnings travel into the audit row's metadata so the record
 * shows what the operator was told when they decided.
 */
export interface GuardResult {
  code: string;
  message: string;
}

export interface GuardVerdict {
  blocking: GuardResult[];
  warnings: GuardResult[];
}

export const ETRIS_GRANT_ID = /^[A-Z0-9][A-Z0-9/-]{5,63}$/;

type Guard = (s: PackageSnapshot, actor: "USER" | "SYSTEM" | "AGENT") => GuardVerdict;

const pass: GuardVerdict = { blocking: [], warnings: [] };

function verdict(checks: Array<[boolean, string, string]>, warnings: Array<[boolean, string, string]> = []): GuardVerdict {
  return {
    blocking: checks.filter(([ok]) => !ok).map(([, code, message]) => ({ code, message })),
    warnings: warnings.filter(([ok]) => !ok).map(([, code, message]) => ({ code, message })),
  };
}

/**
 * What HRD Corp will pay for this delivery. Per-pax (public) programmes are
 * pro-rated to eligible participants (>= 80% attendance) up to the approved
 * headcount; per-group (in-house / ROT) programmes claim the approved amount
 * once at least one participant is eligible.
 */
export function claimableSen(s: PackageSnapshot): number {
  const grant = toSen(s.pkg.grantApprovedAmount);
  if (grant === 0 || s.participants.eligible === 0) return 0;
  if (s.pkg.deliveryMode === "PUBLIC_PHYSICAL") {
    const approvedPax = s.pkg.grantApprovedPax ?? s.participants.active;
    if (!approvedPax) return 0;
    const billable = Math.min(s.participants.eligible, approvedPax);
    return Math.round((grant * billable) / approvedPax);
  }
  return grant;
}

const GUARDS: Record<string, Guard> = {
  COMMERCIAL_TERMS_APPROVED: (s) => {
    const q = s.latestQuotation;
    return verdict(
      [
        [Boolean(q && q.status === "APPROVED"), "QUOTATION_NOT_APPROVED", "The latest quotation must be approved on the Commercial desk"],
        [Boolean(q && toSen(q.quotedAmount) === toSen(s.pkg.quotedAmount)), "QUOTE_MISMATCH", "Package quoted amount must equal the approved quotation"],
        [Boolean(q && toSen(q.quotedAmount) <= toSen(q.allowableCap)), "CAP_BREACH", "Quoted amount exceeds the Allowable Cost Matrix cap"],
        [Boolean(s.pkg.startDate && s.pkg.endDate), "DATES_MISSING", "Training dates are required before quoting"],
        [s.pkg.paxEstimate > 0, "PAX_MISSING", "An estimated headcount is required"],
      ],
      [[Boolean(q && Number(q.marginPct) >= 20), "THIN_MARGIN", "Gross margin is below 20%"]],
    );
  },

  QUOTATION_REVISION_REQUESTED: (s) =>
    verdict([[Boolean(s.latestQuotation), "NO_QUOTATION", "There is no quotation to revise"]]),

  CLIENT_ACCEPTED_QUOTATION: (s) =>
    verdict(
      [[docsOf(s, "QUOTATION").length > 0, "QUOTATION_PDF_MISSING", "The dispatched quotation must be in the vault"]],
      [[s.client.levyRegistered, "LEVY_UNVERIFIED", "Client levy registration is not verified; e-TRiS may reject the application"]],
    ),

  GRANT_CONFIRMED_LOCKED: (s) => {
    const grant = toSen(s.pkg.grantApprovedAmount);
    const bufferDays = s.pkg.startDate ? daysBetween(s.today, s.pkg.startDate) : -1;
    return verdict(
      [
        [Boolean(s.pkg.etrisGrantId && ETRIS_GRANT_ID.test(s.pkg.etrisGrantId)), "GRANT_ID_INVALID", "A well-formed e-TRiS grant reference is required"],
        [grant > 0, "GRANT_AMOUNT_MISSING", "The approved grant amount is required"],
        [grant <= toSen(s.pkg.quotedAmount), "GRANT_EXCEEDS_QUOTE", "Approved amount exceeds the quoted amount"],
        [(s.pkg.grantApprovedPax ?? 0) > 0, "GRANT_PAX_MISSING", "Approved participant count is required"],
        [docsOf(s, "ETRIS_APPROVAL", "VERIFIED").length > 0, "APPROVAL_LETTER_UNVERIFIED", "The e-TRiS approval letter must be uploaded and verified"],
        [bufferDays >= 0, "START_DATE_PASSED", "The approved start date has already passed; reschedule first"],
      ],
      [
        [bufferDays >= 14, "SHORT_BUFFER", `Only ${Math.max(bufferDays, 0)} days between grant approval and delivery; the T-14 viability window is already open`],
        [grant === toSen(s.pkg.quotedAmount), "GRANT_BELOW_QUOTE", "HRD Corp approved less than the quotation; margins will be recomputed on the approved amount"],
      ],
    );
  },

  OPERATIONS_READINESS_LOCKED: (s) => {
    const e = s.engagement;
    const needsVenue = s.pkg.deliveryMode !== "ROT_VIRTUAL" && !s.pkg.venueByClient;
    const venueSigned = s.commitments.some((c) => c.vendorType === "VENUE" && c.status === "BEO_SIGNED");
    const tttExpiry = e?.trainer.tttCertExpiryDate;
    return verdict(
      [
        [Boolean(e && e.status === "CONFIRMED"), "TRAINER_NOT_CONFIRMED", "A confirmed trainer engagement is required"],
        [Boolean(e && e.tttCertVerified && e.trainer.tttVerified), "TTT_UNVERIFIED", "The trainer's HRD Corp TTT certificate must be verified"],
        [!tttExpiry || !s.pkg.endDate || tttExpiry >= s.pkg.endDate, "TTT_EXPIRES_BEFORE_DELIVERY", "The TTT certificate expires before the last training day"],
        [!needsVenue || venueSigned, "VENUE_NOT_LOCKED", "The venue BEO must be signed (or mark the venue as client-provided / ROT)"],
      ],
      [[docsOf(s, "TRAINER_AGREEMENT").length > 0, "AGREEMENT_MISSING", "No executed trainer agreement in the vault"]],
    );
  },

  T14_VIABILITY_PASSED: (s) =>
    verdict([
      [s.participants.active >= s.pkg.minParticipants, "COHORT_BELOW_MINIMUM",
        `${s.participants.active} registered, minimum viable cohort is ${s.pkg.minParticipants}`],
    ]),

  VIABILITY_PIVOT_ROT: (s) =>
    verdict([
      [s.pkg.deliveryMode === "ROT_VIRTUAL", "NOT_PIVOTED", "Delivery mode must be switched to ROT before this transition"],
      [!s.commitments.some((c) => c.vendorType === "VENUE" && c.status !== "CANCELLED"), "VENUE_STILL_HELD", "Venue commitments must be released for an ROT pivot"],
    ]),

  VIABILITY_OVERRIDE_PROCEED: (s) =>
    verdict([[s.participants.active >= 1, "NO_PARTICIPANTS", "Cannot proceed with an empty roster"]]),

  VIABILITY_POSTPONED: () => pass,
  VIABILITY_CANCELLED: () => pass,
  PACKAGE_CANCELLED: () => pass,

  RESCHEDULE_CONFIRMED: (s) =>
    verdict(
      [[Boolean(s.pkg.startDate && s.pkg.startDate > s.today), "NEW_DATE_REQUIRED", "A future start date is required to reschedule"]],
      [[Boolean(s.pkg.startDate && daysBetween(s.today, s.pkg.startDate) >= 14), "RESCHEDULE_INSIDE_T14", "The new date is inside the T-14 window"]],
    ),

  DELIVERY_STARTED: (s, actor) =>
    verdict(
      [
        [actor === "USER" || Boolean(s.pkg.startDate && s.today >= s.pkg.startDate), "NOT_YET_STARTED", "Delivery starts on the first training day"],
        [s.participants.active >= 1, "NO_PARTICIPANTS", "The roster is empty"],
      ],
      [[Boolean(s.pkg.startDate && s.today >= s.pkg.startDate), "STARTED_EARLY", "Delivery marked started before the scheduled first day"]],
    ),

  DELIVERY_VERIFIED_SUCCESS: (s) =>
    verdict(
      [
        [s.participants.active >= 1, "NO_PARTICIPANTS", "The roster is empty"],
        [s.attendance.missingSlots === 0, "ATTENDANCE_INCOMPLETE", `${s.attendance.missingSlots} AM/PM attendance slots are unrecorded`],
        [s.attendance.openReviews === 0, "ATTENDANCE_EXCEPTIONS_OPEN", `${s.attendance.openReviews} attendance exceptions await review`],
        [docsOf(s, "FORM_T3").length > 0, "T3_MISSING", "Form PSMB/SBL-KHAS/T3/01 must be in the vault"],
        [docsOf(s, "PHOTO_EVIDENCE").length >= 2, "PHOTOS_MISSING", "At least two session photos are required"],
        [s.participants.eligible >= 1, "NO_ELIGIBLE_PARTICIPANTS", "No participant reached 80% attendance"],
      ],
      [[s.participants.eligible === s.participants.active, "SOME_BELOW_80",
        `${s.participants.active - s.participants.eligible} participant(s) below 80% are not claimable`]],
    ),

  TRAINING_COMPLETED: (s) =>
    verdict([[s.pkg.operationalStage === "DELIVERY_COMPLETED", "DELIVERY_NOT_COMPLETE", "Operational FSM must be DELIVERY_COMPLETED"]]),

  UPFRONT_CLAIM_FILED: (s) =>
    verdict([
      [Boolean(s.pkg.etrisGrantId) && toSen(s.pkg.grantApprovedAmount) > 0, "GRANT_NOT_APPROVED", "The grant must be approved before an upfront claim"],
      [toSen(s.pkg.upfrontAmount) === Math.round(toSen(s.pkg.grantApprovedAmount) * 0.3), "UPFRONT_NOT_30PCT", "The upfront claim is 30% of the approved grant"],
    ]),

  CLAIM_EVIDENCE_VERIFIED: (s) => {
    const claimable = claimableSen(s);
    return verdict([
      [docsOf(s, "FORM_T3", "VERIFIED").length > 0, "T3_UNVERIFIED", "Form T3 must be verified"],
      [docsOf(s, "FORM_JD14", "VERIFIED").length > 0, "JD14_UNVERIFIED", "Form JD/14 (employer verification, signed and stamped) must be verified"],
      [docsOf(s, "PHOTO_EVIDENCE", "VERIFIED").length >= 2, "PHOTOS_UNVERIFIED", "At least two photos with matching EXIF must be verified"],
      [Boolean(s.invoice), "INVOICE_MISSING", "The HRD Corp tax invoice has not been drafted"],
      [Boolean(s.invoice) && toSen(s.invoice?.total) === claimable, "INVOICE_MISMATCH", "Invoice total must equal the claimable grant amount"],
    ]);
  },

  CLAIM_EVIDENCE_REOPENED: () => pass,

  CLAIM_PACK_APPROVED: (s) =>
    verdict([
      [docsOf(s, "CLAIM_PACK").length > 0, "CLAIM_PACK_MISSING", "The compiled claim pack must be in the vault"],
      [Boolean(s.pkg.claimSubmissionRef && s.pkg.claimSubmissionRef.length >= 4), "SUBMISSION_REF_MISSING", "Record the e-TRiS claim submission reference"],
    ]),

  CLAIM_QUERIED_BY_HRDC: () => pass,
  QUERY_RESPONSE_RESUBMITTED: () => pass,

  CLAIM_APPROVED_BY_HRDC: (s) =>
    verdict([
      [toSen(s.pkg.hrdcApprovedAmount) > 0, "APPROVED_AMOUNT_MISSING", "Record the amount HRD Corp approved"],
      [!s.invoice || toSen(s.pkg.hrdcApprovedAmount) <= toSen(s.invoice.total), "APPROVED_EXCEEDS_INVOICE", "Approved amount cannot exceed the invoice"],
    ]),

  REMITTANCE_RECEIVED: (s) =>
    verdict(
      [
        [toSen(s.pkg.remittanceAmount) > 0, "REMITTANCE_AMOUNT_MISSING", "Record the remitted amount"],
        [Boolean(s.pkg.remittanceReference && s.pkg.remittanceReference.length >= 4), "REMITTANCE_REF_MISSING", "Record the remittance reference"],
        [docsOf(s, "REMITTANCE_ADVICE").length > 0, "REMITTANCE_ADVICE_MISSING", "Upload the HRD Corp remittance advice"],
      ],
      [[toSen(s.pkg.remittanceAmount) + toSen(s.pkg.upfrontAmount) === toSen(s.pkg.hrdcApprovedAmount),
        "REMITTANCE_SHORT", "Remittance plus upfront does not equal the approved claim"]],
    ),

  AP_DISBURSEMENT_CONFIRMED: (s) => {
    const live = s.vouchers.filter((v) => v.status !== "CANCELLED");
    // A package can legitimately owe nothing (a staff trainer at the client's
    // premises); "no vouchers" only blocks when something is actually payable.
    const obligations =
      (s.engagement && s.engagement.status === "CONFIRMED" && toSen(s.engagement.dayRate) > 0 ? 1 : 0) +
      s.commitments.filter((c) => c.status !== "CANCELLED" && toSen(c.cost) > 0).length;
    return verdict([
      [live.length > 0 || obligations === 0, "NO_VOUCHERS", "Payables exist but no payment vouchers were drafted"],
      [live.every((v) => v.status === "PAID"), "VOUCHERS_UNPAID", `${live.filter((v) => v.status !== "PAID").length} voucher(s) not yet paid`],
      [live.every((v) => v.status !== "PAID" || (v.bankReference && v.receiptVaultId)), "PAYMENT_EVIDENCE_MISSING", "Every paid voucher needs a bank reference and a receipt"],
    ]);
  },
};

export function evaluateGuards(snapshot: PackageSnapshot, rule: TransitionRule, actor: "USER" | "SYSTEM" | "AGENT"): GuardVerdict {
  const guard = GUARDS[rule.reason];
  // R14: a reason with no guard entry is a programming error, not a free pass.
  if (!guard) throw new Error(`No L0 guard registered for reason ${rule.reason}`);
  return guard(snapshot, actor);
}

export const GUARDED_REASONS = Object.keys(GUARDS);
