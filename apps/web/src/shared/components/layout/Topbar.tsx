import { useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "@/shared/hooks/useMe";
import { Avatar, Breadcrumb, NotificationBell, SearchTrigger } from "@/shared/components/kit";
import { useBreadcrumbTrail } from "./BreadcrumbProvider";
import { useUnreadCount } from "./useBadgeCounts";
import { RoleToggle } from "./RoleToggle";
import { ThemeToggle } from "./ThemeToggle";

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
 * Two slots. The LEFT slot is the breadcrumb, the one thing that changes per
 * route: CLAUDE.md gives it the path and gives RecordHeader the identity, so
 * nothing here ever renders a record's name. Screens fill it by calling
 * `useBreadcrumb`. The RIGHT slot is fixed chrome, composed from the kit.
 */
export function Topbar() {
  const { me } = useMe();
  const [, setPaletteOpen] = useState(false);
  const trail = useBreadcrumbTrail();
  const unread = useUnreadCount();

  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 bg-canvas pl-1 pr-5">
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
        <SearchTrigger onOpen={() => setPaletteOpen(true)} />
        <NotificationBell unread={unread} />
        <RoleToggle />
        <ThemeToggle />
        <Avatar name={me.name} />
      </div>
    </header>
  );
}
