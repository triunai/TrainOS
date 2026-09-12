import { lazy, Suspense, type ReactElement } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import {
  ENQUIRY_DETAIL_PATTERN,
  ENQUIRY_INBOX_PATH,
  FOLLOW_UP_QUEUE_PATH,
} from "@/features/enquiries";

/**
 * The enquiries feature's routes — M03-S01, M03-S02, M03-S06.
 *
 * `routes.tsx` overlays these ahead of the nav-generated placeholder map, so a
 * real screen wins on its own path. React Router scores two identical paths the
 * same and breaks the tie on declaration order; mounted after the generated
 * list, every screen here would lose to `PlaceholderPage`.
 *
 * Order matters inside this array too: `/sales/enquiries/follow-ups` is
 * declared before `/sales/enquiries/:enquiryId`, or the queue would be read as
 * an enquiry whose reference is the word "follow-ups".
 *
 * Lazy from the start, so an enquiry record pulls its own chunk.
 */

const EnquiryInboxPage = lazy(() =>
  import("@/features/enquiries").then((module) => ({ default: module.EnquiryInboxPage })),
);

const FollowUpQueuePage = lazy(() =>
  import("@/features/enquiries").then((module) => ({ default: module.FollowUpQueuePage })),
);

const EnquiryDetailPage = lazy(() =>
  import("@/features/enquiries").then((module) => ({ default: module.EnquiryDetailPage })),
);

export const routes: RouteObject[] = [
  {
    path: ENQUIRY_INBOX_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the enquiry inbox" />}>
        <EnquiryInboxPage />
      </Suspense>
    ),
  },
  {
    path: FOLLOW_UP_QUEUE_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the follow-up queue" />}>
        <FollowUpQueuePage />
      </Suspense>
    ),
  },
  {
    path: ENQUIRY_DETAIL_PATTERN,
    element: (
      <Suspense fallback={<LoadingState label="Loading the enquiry" />}>
        <EnquiryDetailPage />
      </Suspense>
    ),
  },
];

/**
 * The shape this file used to export, before the team settled on
 * `RouteObject[]`. Three other feature route files import the TYPE from here,
 * so it stays until they convert — deleting it would break their build for a
 * rename that gains them nothing.
 *
 * @deprecated Export `routes: RouteObject[]` instead.
 */
export interface FeatureRoute {
  path: string;
  element: ReactElement;
  label: string;
}

/**
 * The name `routes.tsx` imports today. It is the same array; the alias exists
 * only so renaming the export and rewriting the shared route table are not
 * forced into one commit in a worktree several agents are writing to.
 */
export const enquiriesRoutes = routes;
