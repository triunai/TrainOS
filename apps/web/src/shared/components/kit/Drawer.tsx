import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/shared/lib/utils";
import { IconButton } from "./Button";

/**
 * The drawer. One component for all three uses CLAUDE.md names — audit,
 * assistant, detail — because they are the same surface with different
 * contents, and three drawers would be three sets of focus bugs.
 *
 * Built on `@radix-ui/react-dialog`, the same primitive the scaffold's
 * `ui/sheet.tsx` and `ui/dialog.tsx` wrap. One overlay library in the repo, not
 * two. It is used directly rather than through `ui/sheet.tsx` because that file
 * paints its overlay `bg-black/80` and its panel `p-6 rounded-md` — off-palette
 * and off-geometry for this pack — and it is the scaffold's file to change, not
 * this agent's. The behaviour that actually matters comes from Radix either
 * way: focus moves in on open and returns to the trigger on close, Escape
 * closes, Tab is trapped, and the rest of the page is marked inert.
 */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** The drawer's name. Becomes the heading and the accessible name. */
  title: string;
  /** A line under the title — a record ref, a count. */
  subtitle?: string;
  children: ReactNode;
  /** Buttons pinned to the bottom. */
  footer?: ReactNode;
  /** 420px by default; the audit drawer is wider. */
  width?: string;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "420px",
  className,
}: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <Dialog.Content
          style={{ width }}
          className={cn(
            "fixed inset-y-0 right-0 z-40 flex h-full max-w-full flex-col border-l border-border bg-card shadow-raised outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            className,
          )}
        >
          <header className="flex items-start gap-3 border-b border-divider px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[15px] font-semibold text-ink">
                {title}
              </Dialog.Title>
              {subtitle ? (
                <Dialog.Description className="truncate font-mono text-[11px] text-ink-muted">
                  {subtitle}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close" icon="✕" />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">{children}</div>

          {footer ? (
            <footer className="flex flex-wrap items-center gap-2 border-t border-divider px-4 py-3">
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
