import { useState } from "react";
import { useMe } from "@/shared/hooks/useMe";
import { Avatar, NotificationBell, SearchTrigger } from "@/shared/components/kit";
import { RoleToggle } from "./RoleToggle";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The top bar. 56px, the height every surface lines up against — read from the
 * shell token, never retyped.
 *
 * No solid primary button lives here: solid blue means a human triggered an
 * action, and chrome triggers nothing.
 *
 * Two slots, two owners. The LEFT slot belongs to the breadcrumb, which is the
 * one thing that changes per route — CLAUDE.md gives it the path and gives
 * RecordHeader the identity, so nothing here ever renders a record's name. The
 * RIGHT slot is fixed chrome and is composed from the kit.
 */
export function Topbar() {
  const { me } = useMe();
  const [, setPaletteOpen] = useState(false);

  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 bg-canvas px-4">
      {/* LEFT SLOT — the breadcrumb.
          Owned by the screens work, which is adding a BreadcrumbProvider and a
          useBreadcrumb hook so each route declares its own trail. The kit's
          `Breadcrumb` component is ready and exported; this region is
          deliberately empty rather than filled with a placeholder, so there is
          nothing to delete when the provider lands. */}
      <div className="min-w-0 flex-1" />

      <div className="flex shrink-0 items-center gap-3">
        {/* Opens the command palette. The trigger is a button rather than an
            input on purpose: typing here would create a second search surface
            that has to behave identically to the first one. The palette itself
            is mounted by whoever owns the app's overlays; until then this is
            wired to local state so the control is real rather than inert. */}
        <SearchTrigger onOpen={() => setPaletteOpen(true)} />
        <NotificationBell unread={0} />
        <RoleToggle />
        <ThemeToggle />
        <Avatar name={me.name} />
      </div>
    </header>
  );
}
