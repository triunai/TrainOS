/**
 * The trainers feature's paths, by the navigation tree's one rule
 * (`shared/config/nav.ts`): a child of Training lives under `/training/`.
 *
 * The record route is not a nav leaf, which is normal here — twelve detail
 * routes are mounted that the rail never names. The list is the leaf; the
 * record is reached from it.
 */

export const TRAINERS_LIST_PATH = "/training/trainers";

export const TRAINER_DETAIL_PATTERN = "/training/trainers/:trainerRef";

export const trainerPath = (ref: string): string =>
  `${TRAINERS_LIST_PATH}/${encodeURIComponent(ref)}`;
