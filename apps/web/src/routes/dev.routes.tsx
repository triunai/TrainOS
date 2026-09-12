import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import { DEMO_INDEX_PATH } from "@/features/dashboard";
import { kitDevRoute } from "./kit.routes";

/**
 * Dev-only route registrations.
 *
 * A mount point, deliberately empty here. The kit registers its own gallery
 * (`/dev/kit`) by adding an entry to this array, so kit work never has to touch
 * the shared route table and a merge between the two cannot conflict.
 *
 * These routes exist ONLY in a development build, in two senses that are worth
 * keeping apart. `routes.tsx` mounts them behind `import.meta.env.DEV`, so the
 * ROUTE does not exist in production. That alone does not remove the CODE:
 * Rollup emits a chunk at every `import()` it can resolve statically, dead
 * branch or not, and a dev gallery shipped as its own 175 kB chunk until this
 * was caught. `vite.config.ts` therefore aliases this whole module to
 * `dev.routes.prod.ts` in a production build, which cuts the import graph here
 * and removes everything registered below.
 *
 * Nothing here needs to be role-gated.
 */
export interface DevRoute {
  /** Path relative to the app root, e.g. "/dev/kit". */
  path: string;
  /** What to render. Wrap a heavy gallery in `lazy()` at the call site. */
  element: ReactElement;
  /** Shown in a future dev index. Keep it to a few words. */
  label: string;
}

/**
 * M22-S04, the demo script, rendered as a live index rather than a printed
 * one: each of the nineteen steps links to the running screen. Lazy, so the
 * step table and its copy stay out of every other chunk.
 */
const DemoIndex = lazy(() =>
  import("@/features/dashboard").then((module) => ({ default: module.DemoIndex })),
);

const demoDevRoute: DevRoute = {
  path: DEMO_INDEX_PATH,
  label: "Demo script",
  element: (
    <Suspense fallback={<LoadingState label="Loading the demo script" />}>
      <DemoIndex />
    </Suspense>
  ),
};

export const devRoutes: DevRoute[] = [kitDevRoute, demoDevRoute];
