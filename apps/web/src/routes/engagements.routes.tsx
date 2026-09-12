import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import { ATTENDANCE_CAPTURE_PATTERN, ENGAGEMENT_DETAIL_PATTERN } from "@/features/engagements";

/**
 * The engagements feature's route registrations — M09-S02 and M10-S06.
 *
 * Paths follow `shared/config/nav`'s one path rule: a child lives under its
 * parent's slug, so a record hangs off `/training/engagements`. Attendance
 * hangs off Training → Participants instead, because that is the nav entry
 * M10-S06's breadcrumb walks: `Training › Participants › ENG-0231 attendance`.
 *
 * Both mount INSIDE the app shell, before the generated placeholder list.
 * `portal.routes.tsx` is the one that does not — it is a public page.
 *
 * Lazy from the start, so a record screen and its tables never load for someone
 * who only opens the list.
 */

export interface FeatureRoute {
  /** Path exactly as the navigation rule derives it. */
  path: string;
  element: ReactElement;
  /** For a dev index and for error copy. A few words. */
  label: string;
}

const EngagementDetailPage = lazy(() =>
  import("@/features/engagements").then((module) => ({ default: module.EngagementDetailPage })),
);

const AttendanceCapturePage = lazy(() =>
  import("@/features/engagements").then((module) => ({ default: module.AttendanceCapturePage })),
);

export const engagementsRoutes: FeatureRoute[] = [
  {
    path: ENGAGEMENT_DETAIL_PATTERN,
    label: "Engagement detail",
    element: (
      <Suspense fallback={<LoadingState label="Loading the engagement" />}>
        <EngagementDetailPage />
      </Suspense>
    ),
  },
  {
    path: ATTENDANCE_CAPTURE_PATTERN,
    label: "Attendance capture",
    element: (
      <Suspense fallback={<LoadingState label="Loading the attendance sheet" />}>
        <AttendanceCapturePage />
      </Suspense>
    ),
  },
];
