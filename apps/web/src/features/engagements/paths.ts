/**
 * The engagements feature's paths, derived from the navigation tree's rule
 * (`shared/config/nav.ts`): a child lives under its parent's slug.
 *
 * These lived in `index.ts` while the feature had only two record routes. The
 * other three sales features each keep a `paths.ts`, and a fourth placement for
 * the same kind of constant is the divergence CLAUDE.md calls a defect — so the
 * constants moved here and the barrel re-exports them. No name changed.
 *
 * Attendance hangs off Training → Participants rather than Training →
 * Engagements, because that is the nav entry M10-S06's breadcrumb walks:
 * `Training › Participants › ENG-0231 attendance`.
 */

export const ENGAGEMENTS_LIST_PATH = "/training/engagements";
export const ENGAGEMENT_DETAIL_PATTERN = "/training/engagements/:id";

export const PARTICIPANTS_LIST_PATH = "/training/participants";
export const ATTENDANCE_CAPTURE_PATTERN = "/training/participants/:id/attendance";

/** Build a link to one engagement, so no screen concatenates the path itself. */
export const engagementPath = (ref: string): string =>
  `${ENGAGEMENTS_LIST_PATH}/${encodeURIComponent(ref)}`;

export const attendancePath = (ref: string, day?: number): string =>
  `${PARTICIPANTS_LIST_PATH}/${encodeURIComponent(ref)}/attendance${
    day === undefined ? "" : `?day=${day}`
  }`;
