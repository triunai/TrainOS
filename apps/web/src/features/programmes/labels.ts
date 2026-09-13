import type { HRDCScheme } from "@trainos/contract";

/**
 * Domain copy the kit's generic `humanise` cannot get right.
 *
 * `humanise("SBL_KHAS")` yields "Sbl khas", which is not how HRD Corp writes
 * its own scheme names and not how the design pack writes them either. These
 * are proper nouns, so they get a table rather than a transformation.
 *
 * This is copy, not a second visual language: the chip, its tone and its shape
 * still come from the kit's StatusChip.
 */
export const HRDC_SCHEME_LABEL: Readonly<Record<HRDCScheme, string>> = {
  SBL_KHAS: "SBL-Khas",
  SBL: "SBL",
  HRDC_PLACEMENT: "HRDC Placement",
};

export const hrdcSchemeLabel = (scheme: HRDCScheme): string => HRDC_SCHEME_LABEL[scheme] ?? scheme;
