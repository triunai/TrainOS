import type { MessageCategory, Money } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { MoneyText, formatMoney } from "./Money";
import { MONO_LABEL } from "./tokens";

/**
 * The WhatsApp cost strip. Kit.dc.html §03, used on M03-S06 and M13-S05.
 *
 * It exists because a send that costs money should say so before it is sent.
 * The Malaysian BSP rates differ by an order of magnitude between categories —
 * the artboard quotes Utility at RM 0.0564 and Marketing at RM 0.3467 — so a
 * template categorised wrongly is a real cost, and the saving caption is what
 * makes that visible at the moment of sending.
 *
 * Rates arrive as `Money` from `GET /v1/templates` (`ratePerMessage`), never as
 * a constant here: a BSP rate change must not require a frontend release.
 */

export interface WhatsAppCostStripProps {
  category: MessageCategory;
  templateLabel: string;
  recipients: number;
  ratePerMessage: Money;
  /** `recipients × rate`, computed server-side so the two cannot disagree. */
  estimatedCost: Money;
  /**
   * The cheaper category's rate, when one applies. Renders the saving line —
   * the artboard's "a caption computes the Utility-template savings delta".
   */
  alternativeCategory?: MessageCategory;
  alternativeRate?: Money;
  className?: string;
}

const CATEGORY_LABEL: Record<MessageCategory, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utility",
  SERVICE: "Service",
};

export function WhatsAppCostStrip({
  category,
  templateLabel,
  recipients,
  ratePerMessage,
  estimatedCost,
  alternativeCategory,
  alternativeRate,
  className,
}: WhatsAppCostStripProps) {
  const saving =
    alternativeRate && alternativeRate.amount < ratePerMessage.amount
      ? {
          amount: (ratePerMessage.amount - alternativeRate.amount) * recipients,
          currency: estimatedCost.currency,
        }
      : undefined;

  return (
    <section
      aria-label="Message cost"
      className={cn(
        "flex flex-col gap-2.5 rounded-control border border-border bg-surface px-3.5 py-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <Field label="Template">
          {CATEGORY_LABEL[category]} · {templateLabel}
        </Field>
        <Field label="Recipients">{recipients}</Field>
        <Field label="Rate">
          {/* Per-message rates run to four decimals, so the standard two-decimal
              money format would round RM 0.0564 to RM 0.06 and mis-state it. */}
          {formatMoney(ratePerMessage).replace(
            /[\d,.]+$/,
            (ratePerMessage.amount / 100).toFixed(4),
          )}
        </Field>
        <Field label="Estimated">
          <MoneyText value={estimatedCost} className="font-semibold text-ink" />
        </Field>
      </div>

      {saving && alternativeCategory ? (
        <p className="border-t border-divider pt-2 text-[12px] text-ink-secondary">
          A {CATEGORY_LABEL[alternativeCategory].toLowerCase()} template would save{" "}
          <MoneyText value={saving} className="font-medium text-ink" /> on this send.
        </p>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-1">
      <span className={MONO_LABEL}>{label}</span>
      <span className="text-[13px] text-ink">{children}</span>
    </span>
  );
}
