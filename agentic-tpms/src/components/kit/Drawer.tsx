"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";

/** FORKED FROM TrainOS kit/Drawer.tsx — right-hand sheet for secondary detail and forms. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "460px",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px]" />
        <Dialog.Content style={{ width }} className="fixed inset-y-0 right-0 z-40 flex h-full max-w-full flex-col border-l border-border bg-card shadow-raised outline-none">
          <header className="flex items-start gap-3 border-b border-divider px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[15px] font-semibold text-ink">{title}</Dialog.Title>
              {subtitle ? <Dialog.Description className="truncate font-mono text-[11px] text-ink-muted">{subtitle}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close" icon="✕" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">{children}</div>
          {footer ? <footer className="flex flex-wrap items-center gap-2 border-t border-divider px-4 py-3">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A centred modal for a confirm step — where the red fill is earned. */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content className={cn("fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-modal border border-border bg-card shadow-raised outline-none")}>
          <header className="border-b border-divider px-5 py-4">
            <Dialog.Title className="text-[16px] font-semibold text-ink">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13px] text-ink-secondary">{children}</div>
          {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-divider px-5 py-3.5">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
