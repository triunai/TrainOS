import { useState } from "react";
import { Link } from "react-router-dom";
import { Breadcrumb, NotificationBell, SearchTrigger } from "@/shared/components/kit";
import { useBreadcrumbTrail } from "./BreadcrumbProvider";
import { LocaleSwitch } from "./LocaleSwitch";
import { useT } from "@/shared/i18n";
import { useUnreadCount } from "./useBadgeCounts";

/**
 * The top bar. 56px, the height every surface lines up against — read from the
 * shell token, never retyped.
 *
 * Its padding is the pack's `padding:0 20px 0 4px`, which all 50 internal
 * artboards carry: 4px on the left so the breadcrumb starts almost flush with
 * the card below it, 20px on the right so the chrome cluster lines up with the
 * card's 14px inset plus its own gutter.
 *
 * No solid primary button lives here: solid blue means a human triggered an
 * action, and chrome triggers nothing.
 *
 * It paints the SAME surface as the sidebar and carries no bottom border. The
 * pack draws its whole 1440x900 frame on one ground with the card as the only
 * other plane, so any step in colour at the rail-to-bar junction is a seam the
 * pack does not have.
 *
 * Two slots, and only two things in them. The LEFT slot is the breadcrumb, the
 * one thing that changes per route: CLAUDE.md gives it the path and gives
 * RecordHeader the identity, so nothing here ever renders a record's name.
 * Screens fill it by calling `useBreadcrumb`. The RIGHT slot is search and the
 * notification bell — what changed, and how to go find something.
 *
 * Identity, theme and the role switch USED to sit here and now live in the
 * sidebar's footer. They are properties of the tool rather than of the route:
 * they never change as you navigate, they were the widest things in the bar,
 * and a theme select beside a breadcrumb reads as part of the page.
 */
export function Topbar() {
  const [, setPaletteOpen] = useState(false);
  const trail = useBreadcrumbTrail();
  const unread = useUnreadCount();
  const t = useT();

  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 bg-sidebar pl-1 pr-5">
      <div className="min-w-0 flex-1">
        {/* Router links, not bare anchors: an `<a href>` here would reload the
            whole application to move one level up its own breadcrumb. */}
        <Breadcrumb
          items={trail}
          linkAs={({ href, children, className }) => (
            <Link to={href} className={className}>
              {children}
            </Link>
          )}
        />
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* Opens the command palette. The trigger is a button rather than an
            input on purpose: typing here would create a second search surface
            that has to behave identically to the first one. The palette itself
            is mounted by whoever owns the app's overlays; until then this is
            wired to local state so the control is real rather than inert. */}
        <SearchTrigger onOpen={() => setPaletteOpen(true)} placeholder={t("shell.search")} />
        <NotificationBell unread={unread} />
        <LocaleSwitch />
      </div>
    </header>
  );
}
