import { useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/shared/lib/utils";
import { SecondaryButton } from "./Button";

/**
 * The destructive-confirm dialog. Kit.dc.html §03/§05: a white bordered card
 * with an elevated shadow, a bold question, muted consequence text, a red
 * confirm and a Cancel.
 *
 * This is the one place a red FILL is allowed. `DangerButton` is deliberately
 * bordered-white everywhere else; here the user has already been stopped and
 * asked, so the fill marks the point of no return rather than decorating a
 * toolbar. M10-S06's "Request unlock" is the canonical caller.
 *
 * Cancel takes the opening focus, not confirm. A dialog that opens with the
 * destructive button focused turns a stray Enter into a deleted record —
 * `onOpenAutoFocus` is what makes that deterministic rather than dependent on
 * DOM order.
 *
 * Same Radix dialog primitive as `Drawer`, so the repo has one overlay library.
 */

export interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** The question, as a question. "Unlock attendance for ENG-0311?" */
  title: string;
  /** What happens if they say yes. Specific consequences, not reassurance. */
  description?: ReactNode;
  /** The verb, e.g. "Request unlock". Never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Disable both buttons while the mutation is in flight. */
  busy?: boolean;
  className?: string;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  busy,
  className,
}: ConfirmDialogProps) {
  const cancel = useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/25 data-[state=open]:animate-in data-[state=open]:fade-in-0" />

        <Dialog.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancel.current?.focus();
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-raised outline-none",
            className,
          )}
        >
          <Dialog.Title className="text-[15px] font-semibold text-ink">{title}</Dialog.Title>

          {description ? (
            <Dialog.Description className="text-[13px] leading-relaxed text-ink-secondary">
              {description}
            </Dialog.Description>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <SecondaryButton ref={cancel} onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </SecondaryButton>
            {/* The one red fill in the kit. Not a `PrimaryButton`: this is not
                the view's primary action, it is the end of a question. */}
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-control border border-danger bg-danger px-4 py-2 text-[13px] font-semibold text-on-primary hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
