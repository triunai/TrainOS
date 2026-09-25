"use client";

import { useRef, useState, type ReactNode } from "react";
import { Drawer, GhostButton, KitButton, SecondaryButton } from "@/components/kit";
import { useActionRunner } from "@/components/actions/ActionButton";
import type { ActionResult } from "@/server/domain/errors";

/**
 * A drawer holding a form bound to a server action. The drawer's submit is
 * the drawer's one solid button; the trigger outside it is secondary.
 */
export function FormDrawer({
  trigger,
  title,
  subtitle,
  action,
  submitLabel,
  children,
  triggerKind = "secondary",
}: {
  trigger: string;
  title: string;
  subtitle?: string;
  action: (form: FormData) => Promise<ActionResult<unknown>>;
  submitLabel: string;
  children: ReactNode;
  triggerKind?: "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { pending, runAction } = useActionRunner();
  return (
    <>
      {triggerKind === "ghost" ? <GhostButton onClick={() => setOpen(true)}>{trigger}</GhostButton> : <SecondaryButton onClick={() => setOpen(true)}>{trigger}</SecondaryButton>}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle={subtitle}
        footer={
          <>
            <KitButton kind="primary" busy={pending} onClick={() => formRef.current?.requestSubmit()}>
              {submitLabel}
            </KitButton>
            <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
          </>
        }
      >
        <form
          ref={formRef}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            runAction(title, () => action(data), (result) => {
              if (result.ok) setOpen(false);
            });
          }}
        >
          {children}
        </form>
      </Drawer>
    </>
  );
}
