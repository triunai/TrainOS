import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/shared/theme";
import KitShowcase from "@/pages/KitShowcase";
import "./index.css";

/**
 * A dev-only entry that mounts the kit showcase on its own, at
 * `/dev-kit.html`.
 *
 * It exists because the real route, `/dev/kit`, has to be spread into
 * `routes/routes.tsx`, which the scaffold owns and this agent does not edit —
 * see `routes/kit.routes.tsx` for the two-line change. This entry is how the
 * showcase is rendered and screenshotted in the meantime, and it is useful
 * afterwards too: the showcase loads with nothing but the theme provider
 * around it, so a kit component that only works because of some app-level
 * context fails here loudly instead of quietly.
 *
 * It never ships. `vite.config.ts` sets no `rollupOptions.input`, so the
 * production build takes `index.html` alone and this file is not in it.
 */
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <KitShowcase />
    </ThemeProvider>
  </StrictMode>,
);
