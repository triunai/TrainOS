import type { Money } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";

/**
 * Money, rendered. Contract §1: `Money` is integer sen and a currency code,
 * never a float and never a bare number, so formatting is this component's
 * job and no screen's.
 *
 * Right-aligned mono is the pack's rule for every amount (Kit §08 "money
 * columns right-aligned mono"), which is why alignment is baked in rather than
 * left to the caller: a column of amounts that do not line up is unreadable
 * whatever the caller intended.
 */

export interface MoneyTextProps {
  value: Money;
  /**
   * Drop the decimals. The artboards write `RM 214,300` in a MetricStrip cell
   * and `RM 18,500.00` on a quotation line — same amount, different density.
   * Rounds for display only; the underlying sen are untouched.
   */
  compact?: boolean;
  /** Render `—` instead of `RM 0.00` when the amount is zero. */
  dashWhenZero?: boolean;
  className?: string;
}

const SYMBOL: Record<string, string> = { MYR: "RM" };

/**
 * Format a `Money` to its display string, e.g. `RM 18,500.00`.
 *
 * Exported because table sorting, CSV export and `title` attributes need the
 * string without a React element around it. `en-MY` grouping, always.
 */
export function formatMoney(value: Money, compact = false): string {
  const symbol = SYMBOL[value.currency] ?? value.currency;
  const major = value.amount / 100;
  const digits = compact ? 0 : 2;
  const formatted = new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
  return `${symbol} ${formatted}`;
}

export function MoneyText({ value, compact, dashWhenZero, className }: MoneyTextProps) {
  if (dashWhenZero && value.amount === 0) {
    return (
      <span className={cn("font-mono tabular-nums text-ink-muted", className)} aria-label="none">
        —
      </span>
    );
  }

  return (
    <span
      /* The exact amount is always available even when the display is compact,
         so a rounded metric never hides the sen from a reader who needs them. */
      title={compact ? formatMoney(value) : undefined}
      className={cn("font-mono tabular-nums", className)}
    >
      {formatMoney(value, compact)}
    </span>
  );
}
