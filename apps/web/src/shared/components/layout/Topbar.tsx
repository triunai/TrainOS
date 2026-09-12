import { initialsOf, useMe } from "@/shared/hooks/useMe";
import { RoleToggle } from "./RoleToggle";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The top bar. 56px, the height every surface lines up against — read from the
 * shell token, never retyped.
 *
 * No solid primary button lives here: solid blue means a human triggered an
 * action, and chrome triggers nothing.
 */
export function Topbar() {
  const { me } = useMe();

  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 bg-canvas px-4">
      <div className="text-[13px] text-ink-muted">Search is not wired yet</div>

      <div className="ml-auto flex items-center gap-3">
        <RoleToggle />
        <ThemeToggle />
        <div
          aria-label={me.name}
          title={me.name}
          className="flex h-8 w-8 items-center justify-center rounded-pill bg-avatar font-mono text-[11px] text-on-primary"
        >
          {initialsOf(me.name)}
        </div>
      </div>
    </header>
  );
}
