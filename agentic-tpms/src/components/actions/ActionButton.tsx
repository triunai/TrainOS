"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { DangerButton, GhostButton, KitButton, Modal, PrimaryButton, SecondaryButton, TextArea, type ButtonKind } from "@/components/kit";
import type { ActionResult } from "@/server/domain/errors";

/**
 * A button bound to a server action. Fire-and-forget by design, so it MUST
 * surface a failure (TrainOS R3): a domain refusal toasts its reason (the L0
 * guard's message, e.g. "The trainer's TTT certificate must be verified");
 * a transport failure toasts as an error. Optional confirm step and an
 * optional required reason (recorded as the audit `reason_details`).
 */
// Server actions have heterogeneous signatures; the button only appends the optional reason.
export type AnyAction = (...args: any[]) => Promise<ActionResult<unknown>>;

export function ActionButton({
  action,
  args,
  label,
  kind = "secondary",
  confirm,
  reason,
  success,
  leading,
  disabled,
}: {
  action: AnyAction;
  args: unknown[];
  label: string;
  kind?: ButtonKind;
  confirm?: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean };
  reason?: { label: string; placeholder?: string; minLength?: number };
  success?: string;
  leading?: ReactNode;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const run = () =>
    start(async () => {
      const result = await (reason ? action(...args, note) : action(...args));
      if (result.ok) {
        toast.success(result.message ?? success ?? `${label}: done`);
        setOpen(false);
        setNote("");
        router.refresh();
      } else if (result.kind === "domain") {
        toast.warning(`${label} refused`, { description: result.message, duration: 9000 });
      } else {
        toast.error(`${label} failed`, { description: result.message });
      }
    });

  const Button = kind === "primary" ? PrimaryButton : kind === "danger" ? DangerButton : kind === "ghost" ? GhostButton : SecondaryButton;
  const needsDialog = Boolean(confirm || reason);
  const tooShort = reason ? note.trim().length < (reason.minLength ?? 5) : false;

  return (
    <>
      <Button busy={pending} disabled={disabled} leading={leading} onClick={() => (needsDialog ? setOpen(true) : run())}>
        {label}
      </Button>
      {needsDialog ? (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={confirm?.title ?? label}
          footer={
            <>
              <GhostButton onClick={() => setOpen(false)}>Back</GhostButton>
              <KitButton kind={confirm?.danger ? "danger" : "primary"} busy={pending} disabled={tooShort} onClick={run}>
                {confirm?.confirmLabel ?? label}
              </KitButton>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {confirm?.body}
            {reason ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-muted">{reason.label}</span>
                <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason.placeholder} />
                <span className="text-[12px] text-ink-muted">Recorded verbatim in the audit ledger.</span>
              </label>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Submit a form to a server action and surface the result the same way. */
export function useActionRunner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const runAction = (label: string, work: () => Promise<ActionResult<unknown>>, onDone?: (r: ActionResult<unknown>) => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(result.message ?? `${label}: done`);
        router.refresh();
      } else if (result.kind === "domain") {
        toast.warning(`${label} refused`, { description: result.message, duration: 9000 });
      } else {
        toast.error(`${label} failed`, { description: result.message });
      }
      onDone?.(result);
    });
  return { pending, runAction };
}
