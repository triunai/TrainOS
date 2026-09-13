import { useId, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { FOCUS_RING } from "./tokens";

/**
 * Labelled controls. Kit.dc.html §03, beside `MoneyInput`.
 *
 * The kit shipped `MoneyInput` and nothing else that takes typed input, so
 * every screen needing a date, a reference or a reason grew its own: two
 * byte-identical `StandInField.tsx` files, a `Field` in the portal, a
 * `ReasonField` on attendance capture, another `Field` in the provider-key
 * drawer, and a raw `<textarea>` on the approval detail. Five names, one
 * control, and each carrying the same class string copied by hand.
 *
 * ## The label is a label, not an eyebrow
 *
 * Those copies styled the label `font-mono text-[11px] uppercase` — the app's
 * SECTION EYEBROW, borrowed for a field caption because it was the nearest
 * thing to hand. `MoneyInput` already had the kit's answer, and a form where
 * "Monthly cap" and "Rotation date" are typeset differently has two visual
 * languages for one idea. These match `MoneyInput`, which means some fields
 * change appearance on the way in. That is the point: the eyebrow goes back to
 * marking sections.
 *
 * ## Every control gets a real name
 *
 * The drawer's `Field` rendered its caption as a bare `<span>` and left the
 * control unassociated, so Provider, Label, Key, Billing owner and Rotation
 * date had no accessible name at all. The id is generated here and handed to
 * the control, so a caller cannot forget it — including `Field`'s render prop,
 * which exists precisely so a `<select>` or a checkbox grid gets the same
 * wiring as the inputs below.
 */

/** The control's own classes. One string, so the six variants cannot drift. */
const CONTROL =
  "w-full rounded-control border bg-card px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-disabled disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-disabled";

const border = (invalid: boolean): string =>
  invalid ? "border-danger" : "border-border focus-within:border-primary";

/** What a control must spread to be named, described and marked invalid. */
export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

export interface FieldProps {
  /** The control's name. Required — an unlabelled control is a trap. */
  label: string;
  /** A hint under the control, shown when there is no error. */
  hint?: string;
  /** The server's sentence. Replaces the hint and reddens the border. */
  errorText?: string;
  className?: string;
  /** Receives the id and ARIA wiring the control must carry. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * The label, the caption and the wiring, around a control you supply.
 *
 * Use it for a `<select>`, a checkbox group, or anything else the three fields
 * below do not cover. For a text, date or multi-line input, use those.
 */
export function Field({ label, hint, errorText, className, children }: FieldProps) {
  const id = useId();
  const describedBy = errorText ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-ink-secondary">
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": errorText ? true : undefined,
      })}
      {errorText ? (
        <p id={`${id}-error`} className="text-[12px] text-danger">
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

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Text by default. `password` masks; the rest are keyboard hints. */
  type?: "text" | "password" | "email" | "tel" | "url";
  placeholder?: string;
  hint?: string;
  errorText?: string;
  disabled?: boolean;
  autoComplete?: string;
  /** For a value a person reads character by character — a reference, a key. */
  mono?: boolean;
  className?: string;
}

/** A single-line text input. */
export function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  errorText,
  disabled,
  autoComplete,
  mono,
  className,
}: TextFieldProps) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(errorText === undefined ? {} : { errorText })}
      {...(className === undefined ? {} : { className })}
    >
      {(control) => (
        <input
          {...control}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          className={cn(CONTROL, border(errorText !== undefined), mono && "font-mono", FOCUS_RING)}
        />
      )}
    </Field>
  );
}

export interface DateFieldProps {
  label: string;
  /** `yyyy-mm-dd`, the value a native date input reads and writes. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  hint?: string;
  errorText?: string;
  disabled?: boolean;
  className?: string;
}

/** A date input. The value is `yyyy-mm-dd`; the contract's ISO stamps are the caller's job. */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
  errorText,
  disabled,
  className,
}: DateFieldProps) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(errorText === undefined ? {} : { errorText })}
      {...(className === undefined ? {} : { className })}
    >
      {(control) => (
        <input
          {...control}
          type="date"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn(CONTROL, border(errorText !== undefined), "font-mono", FOCUS_RING)}
        />
      )}
    </Field>
  );
}

export interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
  errorText?: string;
  disabled?: boolean;
  className?: string;
}

/** A multi-line input, for a reason or a note somebody else will read. */
export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  hint,
  errorText,
  disabled,
  className,
}: TextAreaProps) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(errorText === undefined ? {} : { errorText })}
      {...(className === undefined ? {} : { className })}
    >
      {(control) => (
        <textarea
          {...control}
          value={value}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            CONTROL,
            border(errorText !== undefined),
            "resize-y leading-relaxed",
            FOCUS_RING,
          )}
        />
      )}
    </Field>
  );
}
