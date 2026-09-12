import type { ReactElement } from "react";
import { kitDevRoute } from "./kit.routes";

/**
 * Dev-only route registrations.
 *
 * A mount point, deliberately empty here. The kit registers its own gallery
 * (`/dev/kit`) by adding an entry to this array, so kit work never has to touch
 * the shared route table and a merge between the two cannot conflict.
 *
 * These routes exist ONLY in a development build. `routes.tsx` mounts them
 * behind `import.meta.env.DEV`, so nothing here reaches a production bundle and
 * nothing here needs to be role-gated.
 */
export interface DevRoute {
  /** Path relative to the app root, e.g. "/dev/kit". */
  path: string;
  /** What to render. Wrap a heavy gallery in `lazy()` at the call site. */
  element: ReactElement;
  /** Shown in a future dev index. Keep it to a few words. */
  label: string;
}

export const devRoutes: DevRoute[] = [kitDevRoute];
