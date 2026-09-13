import { useId, type ChangeEvent } from "react";
import type { Money } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { toEditable, toSen } from "./format";
import { FOCUS_RING } from "./tokens";

/**
 * The RM money input. Kit.dc.html §03 "Money input · RM", with a default and a
 * below-floor error state.
 *
 * The contract stores money as integer sen and is explicit that a float is never
 * acceptable (§1, §18: "lines are truth and totals are sums"). So this component
 * owns the conversion in both directions and callers only ever see `Money`. A
 * screen that parses `parseFloat(event.target.value) * 100` is how rounding
 * error gets into a quotation.
 *
 * Right-aligned mono, two decimals on entry — the pack's rule for every amount.
 *
 * The error state is a border and a caption, not a shake or a toast. §6 of the
 * contract returns `FLOOR_PRICE_BREACH` with the floor and the resulting margin,
 * so `errorText` is the server's sentence, rendered, and this component invents
 * no validation of its own.
 */

export interface MoneyInputProps {
  /** The current amount. `null` renders an empty field, not `RM 0.00`. */
  value: Money | null;
  onChange: (value: Money | null) => void;
  /** The field's name. Required — a money field with no label is a trap. */
  label: string;
  /** Server-sent, e.g. "Below the RM 12,000 floor · margin would be 18%". */
  errorText?: string;
  /** A hint under the field when there is no error. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function MoneyInput({
  value,
  onChange,
  label,
  errorText,
  hint,
  disabled,
  className,
}: MoneyInputProps) {
  const id = useId();
  const describedBy = errorText ? `${id}-error` : hint ? `${id}-hint` : undefined;

  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    const sen = toSen(event.target.value);
    onChange(sen === null ? null : { amount: sen, currency: "MYR" });
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-ink-secondary">
        {label}
      </label>

      <div
        className={cn(
          "flex items-center overflow-hidden rounded-control border bg-card",
          errorText ? "border-danger" : "border-border focus-within:border-primary",
          disabled && "bg-surface",
        )}
      >
        <span
          aria-hidden="true"
          className="border-r border-border bg-surface px-2.5 py-2 text-[12px] text-ink-muted"
        >
          RM
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={toEditable(value)}
          onChange={handle}
          disabled={disabled}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full bg-transparent px-2.5 py-2 text-right text-[13px] tabular-nums text-ink outline-none placeholder:text-ink-disabled disabled:cursor-not-allowed disabled:text-ink-disabled",
            FOCUS_RING,
          )}
        />
      </div>

      {errorText ? (
        <p id={`${id}-error`} role="alert" className="text-[12px] text-danger">
          {errorText}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
