"use client";

import { useState } from "react";
import { Banner, Field, KitButton, SecondaryButton, TextArea, TextInput } from "@/components/kit";
import { useActionRunner } from "@/components/actions/ActionButton";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/server/domain/errors";

export interface ViabilityOptionView {
  id: "POSTPONE" | "PIVOT_ROT" | "CANCEL" | "PROCEED";
  label: string;
  description: string;
  consequence?: string;
}

/**
 * HITL Gate 2 surface. Three contingency playbooks plus an explicit override,
 * each showing its consequence (exposure, grant amendment) before the choice.
 * Only the chosen option's inputs appear; the confirm button is the view's one
 * solid action, and it stays disabled until the choice is complete.
 */
export function ViabilityDesk({
  code,
  options,
  defaultStart,
  defaultEnd,
  resolve,
  halted,
}: {
  code: string;
  options: ViabilityOptionView[];
  defaultStart: string;
  defaultEnd: string;
  halted: boolean;
  resolve: (code: string, choice: ViabilityOptionView["id"], newStartDate?: string, newEndDate?: string, note?: string) => Promise<ActionResult<unknown>>;
}) {
  const [choice, setChoice] = useState<ViabilityOptionView["id"] | null>(null);
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [note, setNote] = useState("");
  const { pending, runAction } = useActionRunner();

  const complete =
    choice !== null &&
    (choice !== "POSTPONE" || (start && end && end >= start)) &&
    (choice !== "PROCEED" || note.trim().length >= 10) &&
    (choice !== "CANCEL" || note.trim().length >= 5);

  return (
    <div className="flex flex-col gap-3">
      {halted ? (
        <Banner tone="warning" title="Automatic vendor confirmations are halted">
          The T-14 check found the cohort below the minimum viable size. Nothing is confirmed with the venue, caterer or printer until you choose.
        </Banner>
      ) : null}
      <div role="radiogroup" aria-label="Contingency" className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {options.map((o) => {
          const active = choice === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setChoice(o.id)}
              className={cn(
                "flex flex-col gap-1 rounded-panel border p-3 text-left transition-colors",
                active ? "border-primary bg-ai-tint-2 [--ink-muted:var(--ink-secondary)]" : "border-border bg-card hover:bg-surface-hover",
              )}
            >
              <span className="text-[13px] font-semibold text-ink">{o.label}</span>
              <span className="text-[12px] text-ink-secondary">{o.description}</span>
              {o.consequence ? <span className="text-[12px] text-ink-muted">{o.consequence}</span> : null}
            </button>
          );
        })}
      </div>
      {choice === "POSTPONE" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="New start date">
            <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="New end date">
            <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
      ) : null}
      {choice ? (
        <Field label={choice === "PROCEED" ? "Why proceed below the minimum? (required)" : choice === "CANCEL" ? "Reason (required)" : "Note for the audit trail (optional)"}>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Recorded verbatim in the audit ledger" />
        </Field>
      ) : null}
      <div className="flex items-center gap-2">
        <KitButton
          kind="primary"
          busy={pending}
          disabled={!complete}
          onClick={() => choice && runAction("Gate 2", () => resolve(code, choice, choice === "POSTPONE" ? start : undefined, choice === "POSTPONE" ? end : undefined, note || undefined))}
        >
          {choice ? `Confirm: ${options.find((o) => o.id === choice)?.label}` : "Choose a contingency"}
        </KitButton>
        {choice ? <SecondaryButton onClick={() => setChoice(null)}>Clear</SecondaryButton> : null}
      </div>
    </div>
  );
}
