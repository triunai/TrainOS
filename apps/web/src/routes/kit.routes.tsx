import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";

/**
 * The kit showcase's registration, `/dev/kit`.
 *
 * `dev.routes.tsx` is a mount point whose whole purpose is for the kit to add
 * an entry, so the route lives here and `dev.routes.tsx` gains one import and
 * one array element. Kit work never touches the shared route table and the two
 * cannot conflict in a merge.
 *
 * This file deliberately does NOT import the `DevRoute` type from
 * `dev.routes.tsx`. That import is type-only and erased at build, but
 * dependency-cruiser reads the source and counts it, so it showed up as a real
 * `no-circular` violation. The shape is declared structurally here instead, and
 * `dev.routes.tsx` still annotates its array as `DevRoute[]` — so a mismatch
 * between the two is still a compile error, in exactly the place that should
 * fail. Type safety kept, cycle gone.
 *
 * It renders inside the real `AppShell`, which is the right place for it: a kit
 * component that only looks correct outside the app's own sidebar, top bar and
 * content card is not finished.
 */

const KitShowcase = lazy(() => import("@/pages/KitShowcase"));

export const KIT_SHOWCASE_PATH = "/dev/kit";

export const kitDevRoute: { path: string; element: ReactElement; label: string } = {
  path: KIT_SHOWCASE_PATH,
  label: "Component kit",
  element: (
    <Suspense fallback={<LoadingState label="Loading the kit showcase" />}>
      <KitShowcase />
    </Suspense>
  ),
};
