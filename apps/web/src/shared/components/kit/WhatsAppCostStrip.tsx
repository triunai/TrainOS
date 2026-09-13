import type { AlternativeCategoryRate, MessageCategory, Money } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { formatMoney } from "./format";
import { MoneyText } from "./Money";
import { MONO_LABEL } from "./tokens";

/**
 * The WhatsApp cost strip. Kit.dc.html §03, used on M03-S06 and M13-S05.
 *
 * It exists because a send that costs money should say so before it is sent.
 * The Malaysian BSP rates differ by a factor of six between categories — the
 * pack quotes Utility at RM 0.0564 and Marketing at RM 0.3467 — so the category
 * a template sits in is a real cost, and the comparison line is what makes that
 * visible at the moment of sending.
 *
 * THE RATE IS NOT DERIVED FROM `ratePerMessage`. That field is `Money`, which
 * the contract defines as integer sen, so RM 0.0564 arrives as 6 sen and any
 * arithmetic on it renders RM 0.0600 — a wrong number, shown to four decimal
 * places, which is the most convincing way to be wrong. The contract carries
 * `ratePerMessageExact` as an unrounded decimal string for exactly this reason
 * and it is preferred whenever present. The rounded `Money` is the fallback,
 * and it is then rendered at two decimals rather than four, because four
 * decimals on a value that only has two is a lie about precision.
 *
 * WHEN THE LOOKUP FAILS the two money fields are absent, which is contract
 * §16 Q4 / ruling R11: a required `ratePerMessage` left a server whose rate
 * lookup had failed with nothing honest to send, so it sent a stale rate or a
 * zero and this strip rendered it to four decimal places with no hedge. The
 * strip now says the rate is unavailable and that the send still works, which
 * is true and is what the person about to press send needs to know.
 *
 * The comparison line reads the alternative's own exact string for the same
 * reason. It used to print the rounded `Money` while the primary rate beside
 * it printed the exact one, so the two halves of a six-fold comparison were
 * shown at different precisions — RM 0.0564 against RM 0.35, when the
 * marketing rate is RM 0.3467.
 */

export interface WhatsAppCostStripProps {
  category: MessageCategory;
  templateLabel: string;
  recipients: number;
  /**
   * Rounded to the sen at estimate time. Used for arithmetic, not for display.
   * Absent when the BSP rate lookup failed — see the unavailable state below.
   */
  ratePerMessage?: Money;
  /** Unrounded decimal string, e.g. `"0.0564"`. Preferred for display. */
  ratePerMessageExact?: string;
  /** `recipients × rate`, computed server-side so the two cannot disagree. */
  estimatedCost?: Money;
  /**
   * The other category's rate, from the contract's `alternativeCategoryRate`.
   * Rendered whichever way it points — see the note on the comparison below.
   */
  alternative?: AlternativeCategoryRate;
  className?: string;
}

const CATEGORY_LABEL: Record<MessageCategory, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utility",
  SERVICE: "Service",
};

const CURRENCY_SYMBOL: Record<string, string> = { MYR: "RM" };

/** The per-message rate as the pack prints it, exact string preferred. */
function rateText(rate: Money, exact?: string): string {
  const symbol = CURRENCY_SYMBOL[rate.currency] ?? rate.currency;
  if (exact) return `${symbol} ${exact}`;
  return formatMoney(rate);
}

export function WhatsAppCostStrip({
  category,
  templateLabel,
  recipients,
  ratePerMessage,
  ratePerMessageExact,
  estimatedCost,
  alternative,
  className,
}: WhatsAppCostStripProps) {
  /*
   * The comparison renders in BOTH directions, and the dearer one is the one
   * the artboard actually draws: "Marketing category would cost RM 0.3467 —
   * not permitted for this template". Only ever showing a saving answers a
   * question nobody asked, while the dearer direction answers the one they did:
   * why is this template the one being sent? Same component, two sentences,
   * chosen by which way the rates point.
   */
  const dearer =
    ratePerMessage && alternative && alternative.ratePerMessage.amount > ratePerMessage.amount
      ? alternative
      : undefined;

  const cheaper =
    ratePerMessage && alternative && alternative.ratePerMessage.amount < ratePerMessage.amount
      ? alternative
      : undefined;

  const saving =
    cheaper && ratePerMessage && estimatedCost
      ? {
          amount: (ratePerMessage.amount - cheaper.ratePerMessage.amount) * recipients,
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
          {ratePerMessage ? rateText(ratePerMessage, ratePerMessageExact) : "Unavailable"}
        </Field>
        <Field label="Estimated">
          {estimatedCost ? (
            <MoneyText value={estimatedCost} className="font-semibold text-ink" />
          ) : (
            "Not estimated"
          )}
        </Field>
      </div>

      {ratePerMessage && estimatedCost ? null : (
        <p className="border-t border-divider pt-2 text-[12px] text-ink-secondary">
          The per-message rate could not be read from the messaging provider, so this send has no
          cost estimate. Sending still works; the charge lands on the provider bill.
        </p>
      )}

      {dearer ? (
        <p className="border-t border-divider pt-2 text-[12px] text-ink-secondary">
          {CATEGORY_LABEL[dearer.category]} category would cost{" "}
          <span className="font-medium text-ink">
            {rateText(dearer.ratePerMessage, dearer.ratePerMessageExact)}
          </span>{" "}
          per message — not permitted for this template.
        </p>
      ) : null}

      {saving && cheaper ? (
        <p className="border-t border-divider pt-2 text-[12px] text-ink-secondary">
          A {CATEGORY_LABEL[cheaper.category].toLowerCase()} template would save{" "}
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
