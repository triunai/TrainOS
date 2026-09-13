import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { CONTACTS_DIRECTORY_PATH } from "@/features/contacts";

/** Sales › Contacts. One route; the generated placeholder stops rendering. */

const ContactsDirectoryPage = lazy(() =>
  import("@/features/contacts").then((module) => ({ default: module.ContactsDirectoryPage })),
);

export const routes: RouteObject[] = [
  {
    path: CONTACTS_DIRECTORY_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the contact directory" />}>
        <ContactsDirectoryPage />
      </Suspense>
    ),
  },
];

export const contactsRoutes = routes;
