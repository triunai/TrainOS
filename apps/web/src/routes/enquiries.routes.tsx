import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import {
  ENQUIRY_DETAIL_PATTERN,
  ENQUIRY_INBOX_PATH,
  FOLLOW_UP_QUEUE_PATH,
} from "@/features/enquiries";

/**
 * The enquiries feature's route registrations — M03-S01, M03-S02, M03-S06.
 *
 * The scaffold's `routes.tsx` builds every nav path from `ALL_NAV_ROUTES` and
 * points it at `PlaceholderPage`. A real screen therefore has to be mounted
 * BEFORE that generated list, or the placeholder wins on the same path.
 *
 * Order matters inside this array too: `/sales/enquiries/follow-ups` is
 * declared before `/sales/enquiries/:enquiryId`, or the queue would be read as
 * an enquiry whose reference is the word "follow-ups".
 *
 * Lazy from the start, so an enquiry record pulls its own chunk.
 */

export interface FeatureRoute {
  /** Path exactly as the navigation rule derives it. */
  path: string;
  element: ReactElement;
  /** For a dev index and for error copy. A few words. */
  label: string;
}

const EnquiryInboxPage = lazy(() =>
  import("@/features/enquiries").then((module) => ({ default: module.EnquiryInboxPage })),
);

const FollowUpQueuePage = lazy(() =>
  import("@/features/enquiries").then((module) => ({ default: module.FollowUpQueuePage })),
);

const EnquiryDetailPage = lazy(() =>
  import("@/features/enquiries").then((module) => ({ default: module.EnquiryDetailPage })),
);

export const enquiriesRoutes: FeatureRoute[] = [
  {
    path: ENQUIRY_INBOX_PATH,
    label: "Enquiry inbox",
    element: (
      <Suspense fallback={<LoadingState label="Loading the enquiry inbox" />}>
        <EnquiryInboxPage />
      </Suspense>
    ),
  },
  {
    path: FOLLOW_UP_QUEUE_PATH,
    label: "Follow-up queue",
    element: (
      <Suspense fallback={<LoadingState label="Loading the follow-up queue" />}>
        <FollowUpQueuePage />
      </Suspense>
    ),
  },
  {
    path: ENQUIRY_DETAIL_PATTERN,
    label: "Enquiry detail",
    element: (
      <Suspense fallback={<LoadingState label="Loading the enquiry" />}>
        <EnquiryDetailPage />
      </Suspense>
    ),
  },
];
