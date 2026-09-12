import { lazy, Suspense } from "react";
import { LoadingState } from "@/shared/components/states";
import type { DevRoute } from "./dev.routes";

/**
 * The kit showcase's registration, `/dev/kit`.
 *
 * The scaffold's `dev.routes.tsx` is a mount point whose whole purpose is for
 * the kit to add an entry, so the route lives here and `dev.routes.tsx` gains
 * one import and one array element. Kit work never touches the shared route
 * table and the two cannot conflict in a merge.
 *
 * It renders inside the real `AppShell`, which is the right place for it: a kit
 * component that only looks correct outside the app's own sidebar, top bar and
 * content card is not finished.
 *
 * KNOWN GAP, and it belongs to the build config rather than to this file.
 * `routes.tsx` mounts dev routes behind `import.meta.env.DEV`, so the ROUTE
 * does not exist in production and the chunk is unreachable there. The chunk is
 * still EMITTED — about 175 kB raw, 55 kB gzipped, in its own file that nothing
 * ever fetches. Rollup creates a chunk at every `import()` site it can resolve
 * statically, and wrapping the reference in a dead `import.meta.env.DEV` branch
 * does not change that; it was tried and measured. Removing it needs
 * `vite.config.ts` to alias `@/pages/KitShowcase` to an empty module in a
 * production build, and that file is the scaffold's. Reported to them. The cost
 * today is dist size only: the main bundle is unchanged and no user downloads
 * this.
 */

const KitShowcase = lazy(() => import("@/pages/KitShowcase"));

export const KIT_SHOWCASE_PATH = "/dev/kit";

export const kitDevRoute: DevRoute = {
  path: KIT_SHOWCASE_PATH,
  label: "Component kit",
  element: (
    <Suspense fallback={<LoadingState label="Loading the kit showcase" />}>
      <KitShowcase />
    </Suspense>
  ),
};
