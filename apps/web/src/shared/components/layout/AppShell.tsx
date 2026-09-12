import { Outlet } from "react-router-dom";
import { useMe } from "@/shared/hooks/useMe";
import { BreadcrumbProvider } from "./BreadcrumbProvider";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * The app shell: sidebar, top bar, and a white content card inset from the
 * canvas edge.
 *
 * Dimensions come from the shell tokens (`--shell-*`), which the Tailwind
 * `spacing` scale exposes as `w-sidebar`, `h-topbar`, `m-inset`. Nothing here
 * carries a pixel literal.
 *
 * `BreadcrumbProvider` wraps BOTH the top bar and the outlet, and it has to:
 * the screen inside the outlet declares the trail and the top bar above it
 * renders it, so the state they share must sit above them both.
 */
export function AppShell() {
  const { me } = useMe();

  return (
    <BreadcrumbProvider>
      <div className="flex h-screen w-full overflow-hidden bg-canvas">
        <Sidebar role={me.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="min-h-0 flex-1 overflow-auto rounded-card-lg border border-border bg-card shadow-card mb-inset mr-inset">
            <Outlet />
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
