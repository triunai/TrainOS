"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { Drawer, GhostButton, KitButton, SecondaryButton } from "@/components/kit";
import { useActionRunner } from "@/components/actions/ActionButton";
import type { ActionResult } from "@/server/domain/errors";

/**
 * FormDrawer, plus one behaviour: when the action succeeds and returns
 * `{ href }`, the browser goes there (a lead converted to a package opens the
 * package; a new lead opens its own page). Same trigger/footer geometry as
 * `@/components/forms/FormDrawer`.
 *
 * PROMOTION NOTE (UI-2): FormDrawer could adopt this directly — navigate
 * when `result.data.href` is a string — and this file would go away.
 */
export function NavigatingFormDrawer({
  trigger,
  title,
  subtitle,
  action,
  submitLabel,
  children,
  triggerKind = "secondary",
  width,
}: {
  trigger: string;
  title: string;
  subtitle?: string;
  action: (form: FormData) => Promise<ActionResult<{ href?: string } | undefined>>;
  submitLabel: string;
  children: ReactNode;
  triggerKind?: "secondary" | "ghost";
  width?: string;
}) {
  const router = useRouter();
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
        width={width}
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
              if (!result.ok) return;
              setOpen(false);
              const href = (result.data as { href?: unknown } | undefined)?.href;
              if (typeof href === "string") router.push(href);
            });
          }}
        >
          {children}
        </form>
      </Drawer>
    </>
  );
}
