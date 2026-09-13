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
 * The frame is the design pack's 1440x900 artboard frame, verbatim: a 240px
 * sidebar, a 56px top bar, and a card that takes `margin:0 14px 14px 0` — the
 * inline layout every one of the pack's 50 internal artboards carries. The card
 * is deliberately FLUSH to the sidebar's right edge and to the top bar's
 * bottom edge; the only gutters are the 14px on its right and bottom.
 *
 * The card is a FLEX COLUMN, as it is in the pack (`display:flex;
 * flex-direction:column`). That is load-bearing, not cosmetic: the pack's page
 * templates are built as a fixed header block plus a `flex:1; min-height:0`
 * body that owns its own scroll pane, and a screen can only do that if the box
 * above it is a column. As a plain block, `flex-1` on a screen's root was inert
 * and a two-pane inbox grew past the card instead of fitting inside it.
 *
 * `main` owns the scroll, so the document never scrolls and the 14px canvas
 * band below the card stays put while a long record scrolls inside it.
 *
 * The card carries no padding of its own, again as in the pack: each page
 * template supplies the pack's 20px gutter on its own header and body blocks,
 * which is what lets a split view run a divider the full height of the card.
 *
 * `BreadcrumbProvider` wraps BOTH the top bar and the outlet, and it has to:
 * the screen inside the outlet declares the trail and the top bar above it
 * renders it, so the state they share must sit above them both.
 */
export function AppShell() {
  const { me } = useMe();

  return (
    <BreadcrumbProvider>
      <div className="flex h-dvh w-full overflow-hidden bg-sidebar">
        <Sidebar role={me.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="mb-inset mr-inset flex min-h-0 flex-1 flex-col overflow-y-auto rounded-card-lg border border-border bg-card shadow-card">
            <Outlet />
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
