import { useState } from "react";
import { useLocation } from "react-router-dom";
import type { Role } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { Drawer, KeyboardShortcut } from "@/shared/components/kit";
import { FOCUS_RING } from "@/shared/components/kit/tokens";
import { ROLE_LABEL, SHELL_ROLES } from "@/shared/config/roles";
import { useMe } from "@/shared/hooks/useMe";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { APP_VERSION, VERSION_LINE } from "./version";

/**
 * The sidebar's footer: the things a reader reaches for about the APPLICATION
 * rather than about a record, or about themselves.
 *
 * They live here, not in the top bar, for one reason: the top bar's left slot
 * is the breadcrumb and its right slot is search and notifications — both are
 * about WHERE YOU ARE and WHAT CHANGED. Help, the shortcut list and the build
 * number are about the tool itself, they never change as you navigate, and
 * putting them in the bar meant every screen paid for them in horizontal space
 * and in reading order.
 *
 * Identity is NOT here. It moved to the top of the rail, under the wordmark,
 * with the theme switch beside it.
 *
 * The role menu opens UPWARD. A menu that opens down from the bottom of the
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

export function SidebarFooter() {
  const { me, setRole } = useMe();
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

      {/* 10px, not the 11px floor the type scale gives readable text: this is a
          build stamp a reader quotes into a bug report, not prose, and at 11px
          the full line does not fit 240px minus its gutters. */}
      <p className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] leading-4 text-ink-muted">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-pill bg-success"
          title="All systems normal"
        />
        <span className="truncate">{VERSION_LINE}</span>
      </p>

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
