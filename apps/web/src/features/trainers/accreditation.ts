import type { FixtureTrainer } from "@trainos/fixtures";
import type { StatusTone } from "@/shared/components/kit";

/**
 * Whether a trainer may be put in front of a claimable course, and why not.
 *
 * A leaf module: pure functions, no React, so the rule is testable without a
 * render and the screen file stays hot-replaceable.
 *
 * TWO independent gates, and conflating them is the defect this file exists to
 * prevent. Train-the-Trainer certification is the trainer's own qualification
 * and it EXPIRES. HRD Corp's Trainer Development Framework registration is what
 * §17's `CHK_TRAINER_ACCREDITATION` actually reads when it decides whether a
 * delivery can be claimed. Noora Idris has neither; a trainer with a current
 * TTT and no TDF would still fail the claim check, and a screen that showed one
 * green chip for "accredited" would be telling Operations they were safe to
 * book when Finance is about to lose the levy.
 *
 * `GET /v1/trainers` is in the §13 endpoint matrix but the contract publishes
 * no `Trainer` type, so `FixtureTrainer` is the shape — the same reported gap
 * `features/programmes` already builds its pool table on.
 */

export type TttState = "VALID" | "EXPIRING" | "EXPIRED" | "NONE";

export interface Accreditation {
  ttt: TttState;
  /** HRD Corp TDF registration, which is what the claim check reads. */
  hrdTdf: boolean;
  /** True only when BOTH gates pass: a delivery by this trainer can be claimed. */
  claimable: boolean;
  tone: StatusTone;
  label: string;
  /** The one sentence a reader needs when the answer is not a plain yes. */
  detail: string | null;
}

/**
 * Days before expiry at which a certificate starts reading as a problem.
 *
 * Ninety, because that is roughly the lead time between confirming an
 * engagement and delivering it: a certificate that lapses inside the window is
 * a booking decision today, not a renewal reminder later.
 */
export const EXPIRY_HORIZON_DAYS = 90;

const DAY_MS = 86_400_000;

function daysUntil(day: string, today: string): number | null {
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / DAY_MS);
}

export function tttStateOf(
  trainer: Pick<FixtureTrainer, "tttCertified" | "tttValidTo">,
  today: string,
  horizonDays: number = EXPIRY_HORIZON_DAYS,
): TttState {
  if (!trainer.tttCertified || !trainer.tttValidTo) return "NONE";
  const remaining = daysUntil(trainer.tttValidTo, today);
  if (remaining === null) return "NONE";
  if (remaining < 0) return "EXPIRED";
  return remaining <= horizonDays ? "EXPIRING" : "VALID";
}

export function accreditationOf(
  trainer: FixtureTrainer,
  today: string,
  horizonDays: number = EXPIRY_HORIZON_DAYS,
): Accreditation {
  const ttt = tttStateOf(trainer, today, horizonDays);
  const claimable = ttt !== "NONE" && ttt !== "EXPIRED" && trainer.hrdTdf;

  /* Ordered worst-first. The chip carries ONE state, so it must carry the one
     that stops a booking, and the missing TDF is the one Finance pays for. */
  if (ttt === "NONE") {
    return {
      ttt,
      hrdTdf: trainer.hrdTdf,
      claimable,
      tone: "danger",
      label: "No TTT",
      detail: "No Train-the-Trainer certificate is on record, so no HRD Corp claim can cite them.",
    };
  }

  if (ttt === "EXPIRED") {
    return {
      ttt,
      hrdTdf: trainer.hrdTdf,
      claimable,
      tone: "danger",
      label: "TTT expired",
      detail: `The Train-the-Trainer certificate lapsed on ${trainer.tttValidTo}.`,
    };
  }

  if (!trainer.hrdTdf) {
    return {
      ttt,
      hrdTdf: false,
      claimable,
      tone: "danger",
      label: "Not HRD Corp registered",
      detail:
        "The certificate is current, but the trainer is not on HRD Corp's Trainer Development Framework, which is what the claim check reads.",
    };
  }

  if (ttt === "EXPIRING") {
    return {
      ttt,
      hrdTdf: true,
      claimable,
      tone: "warning",
      label: "TTT expiring",
      detail: `The Train-the-Trainer certificate runs out on ${trainer.tttValidTo}, inside the usual booking-to-delivery window.`,
    };
  }

  return {
    ttt,
    hrdTdf: true,
    claimable,
    tone: "success",
    label: "Accredited",
    detail: null,
  };
}

/** The next committed day on or after `today`, or `null` when there is none. */
export function nextBookedDay(trainer: FixtureTrainer, today: string): string | null {
  return [...trainer.bookedDates].sort().find((day) => day >= today) ?? null;
}
