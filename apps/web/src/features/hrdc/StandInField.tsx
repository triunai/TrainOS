import { useId } from "react";
import { FOCUS_RING } from "@/shared/components/kit";
import { cn } from "@/shared/lib/utils";

/**
 * TEMPORARY. Delete this file when the kit ships `TextField` / `DateField`.
 *
 * The kit has `MoneyInput` and nothing else that takes typed input, so the one
 * thing M12-S02 exists to capture — the eTRIS reference a human types after
 * filing the claim by hand — has nowhere to go. The artboard draws these two
 * fields as static placeholder boxes, which is honest for a mockup and useless
 * in a running app: without them the screen's only primary can never fire.
 *
 * Requested from the `kit` agent with the prop shape below, so the swap is an
 * import change and a rename. Nothing here invents a look: the border, radius,
 * focus ring and type scale are the kit's own tokens.
 */

export interface StandInFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function StandInField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  disabled,
  className,
}: StandInFieldProps) {
  const id = useId();

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={id}
        className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 rounded-control border border-border bg-card px-2.5 font-mono text-[13px] text-ink",
          "placeholder:text-ink-disabled disabled:bg-surface disabled:text-ink-disabled",
          FOCUS_RING,
        )}
      />
      {hint ? <p className="text-[12px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}
