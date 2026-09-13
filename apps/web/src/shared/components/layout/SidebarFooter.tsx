import { useState } from "react";
import { useLocation } from "react-router-dom";
import type { Role } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { Avatar, Drawer, KeyboardShortcut } from "@/shared/components/kit";
import { FOCUS_RING } from "@/shared/components/kit/tokens";
import { ROLE_LABEL, SHELL_ROLES } from "@/shared/config/roles";
import { useMe } from "@/shared/hooks/useMe";
import { THEME_CHOICES, useTheme } from "@/shared/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { APP_VERSION, VERSION_LINE } from "./version";

/**
 * The sidebar's footer: the things a reader reaches for about the APPLICATION
 * rather than about a record.
 *
 * They live here, not in the top bar, for one reason: the top bar's left slot
 * is the breadcrumb and its right slot is search and notifications — both are
 * about WHERE YOU ARE and WHAT CHANGED. Identity, theme, help and the build
 * number are about the tool itself, they never change as you navigate, and
 * putting them in the bar meant every screen paid for them in horizontal space
 * and in reading order.
 *
 * Everything here opens UPWARD. A menu that opens down from the bottom of the
 * viewport has nowhere to go.
 */

const ROW =
  "flex w-full items-center gap-2 rounded-control px-2 text-[13px] text-ink-secondary hover:bg-surface-hover";

function Glyph({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="w-4 shrink-0 text-center text-ink-muted">
      {children}
    </span>
  );
}

/** The shortcuts the shell itself owns. Screens add their own in context. */
const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["⌘", "K"], action: "Open the command palette" },
  { keys: ["J"], action: "Next item in a queue" },
  { keys: ["K"], action: "Previous item in a queue" },
  { keys: ["↵"], action: "Open the selected item" },
  { keys: ["⌘", "↵"], action: "Open it in a drawer" },
  { keys: ["esc"], action: "Close the drawer or palette" },
];

export function SidebarFooter({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { me, setRole } = useMe();
  const { theme, setTheme } = useTheme();
  const { pathname } = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  /* Pre-filled so the first reply is not "which version, and where were you?".
     A mailto rather than a form: there is no issue endpoint yet, and a dead
     button is worse than an honest email client. */
  const reportHref =
    `mailto:support@trainos.app` +
    `?subject=${encodeURIComponent(`TrainOS issue on ${pathname}`)}` +
    `&body=${encodeURIComponent(
      `\n\n---\nVersion: ${APP_VERSION}\nRoute: ${pathname}\nWhat happened:\n`,
    )}`;

  return (
    <div className="mt-auto flex flex-col gap-0.5 border-t border-divider pt-2">
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
        aria-pressed={collapsed}
        className={cn(ROW, "h-7 justify-center", FOCUS_RING)}
      >
        <Glyph>{collapsed ? "»" : "«"}</Glyph>
        {collapsed ? null : <span className="sr-only">Collapse the sidebar</span>}
      </button>

      {collapsed ? (
        <div className="flex justify-center py-1">
          <Avatar name={me.name} size={26} />
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className={cn(ROW, "h-7", FOCUS_RING)}
          >
            <Glyph>?</Glyph>
            <span>Help &amp; support</span>
          </button>

          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className={cn(ROW, "h-7", FOCUS_RING)}
          >
            <Glyph>⌘</Glyph>
            <span>Shortcuts</span>
          </button>

          {import.meta.env.DEV ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(ROW, "h-7", FOCUS_RING)}
                aria-label="Role (development only)"
              >
                <Glyph>◑</Glyph>
                <span className="truncate">{ROLE_LABEL[me.role]}</span>
                <span aria-hidden="true" className="ml-auto text-ink-muted">
                  ⌃
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted">
                  Role · development only
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={me.role}
                  onValueChange={(value) => setRole(value as Role)}
                >
                  {SHELL_ROLES.map((role) => (
                    <DropdownMenuRadioItem key={role} value={role} className="text-[13px]">
                      {ROLE_LABEL[role]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-surface-hover",
                FOCUS_RING,
              )}
            >
              <Avatar name={me.name} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{me.name}</span>
                <span className="block truncate text-[11px] text-ink-muted">
                  {ROLE_LABEL[me.role]}
                </span>
              </span>
              <span aria-hidden="true" className="text-ink-muted">
                ⌃
              </span>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side="top"
              align="start"
              className="w-[var(--radix-dropdown-menu-trigger-width)]"
            >
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted">
                Theme
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                {THEME_CHOICES.map((choice) => (
                  <DropdownMenuRadioItem key={choice} value={choice} className="text-[13px]">
                    {choice[0]?.toUpperCase()}
                    {choice.slice(1)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />

              {/* There is no session to end yet. The item is here because its
                  absence is the thing readers report; it does nothing, and it
                  says so rather than pretending. */}
              <DropdownMenuItem disabled className="text-[13px]">
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 10px, not the 11px floor the type scale gives readable text: this
              is a build stamp a reader quotes into a bug report, not prose, and
              at 11px the full line does not fit 240px minus its gutters. */}
          <p className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] leading-4 text-ink-muted">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-pill bg-success"
              title="All systems normal"
            />
            <span className="truncate">{VERSION_LINE}</span>
          </p>
        </>
      )}

      <Drawer open={helpOpen} onClose={() => setHelpOpen(false)} title="Help & support">
        <div className="flex flex-col gap-4 text-[13px] text-ink-secondary">
          <section className="flex flex-col gap-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted">
              Documentation
            </h3>
            <a href="https://docs.trainos.app/getting-started">Getting started</a>
            <a href="https://docs.trainos.app/hrd-corp">HRD Corp claims</a>
            <a href="https://docs.trainos.app/agents">Agents and autonomy</a>
          </section>

          <section className="flex flex-col gap-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted">
              Contact
            </h3>
            <a href="mailto:support@trainos.app">support@trainos.app</a>
            <span>Weekdays, 9am–6pm MYT</span>
          </section>

          <section className="flex flex-col gap-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted">
              Something wrong?
            </h3>
            <a href={reportHref}>Report an issue</a>
            <span className="text-ink-muted">
              Opens an email with the version and the page you are on already filled in.
            </span>
          </section>

          <p className="font-mono text-[11px] text-ink-muted">{VERSION_LINE}</p>
        </div>
      </Drawer>

      <Drawer
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
        subtitle="⌘K opens the command palette from anywhere"
      >
        <ul className="flex flex-col gap-2.5">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.action} className="flex items-center justify-between gap-4">
              <span className="text-[13px] text-ink-secondary">{shortcut.action}</span>
              <KeyboardShortcut keys={shortcut.keys} />
            </li>
          ))}
        </ul>
      </Drawer>
    </div>
  );
}
