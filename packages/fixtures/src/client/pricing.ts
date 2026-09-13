/**
 * §6 + §18 · Price floors and invoice reconciliation.
 *
 * A quotation is checked against **two independent floors**:
 *
 * 1. the **absolute floor** — the programme's own `floorPrice` for the pax
 *    band, a catalogue fact Finance sets; and
 * 2. the **margin floor** — `directCost ÷ (1 − floorMarginRate)`, derived from
 *    what the delivery actually costs.
 *
 * The **higher of the two binds**, because clearing one floor while breaching
 * the other is still a breach. `FLOOR_PRICE_BREACH` reports the binding floor
 * in `details.floorPrice` and names both, so the quotation screen can show which
 * constraint is doing the work.
 */

import type { BindingFloorBasis, Quotation, Money, Programme, Rate } from "@trainos/contract";
import { ContractError } from "./errors";
import { myr, roundHalfUpSen } from "../data/_helpers";

export interface FloorEvaluation {
  absoluteFloorPrice: Money;
  marginFloorPrice: Money;
  floorPrice: Money;
  bindingFloor: BindingFloorBasis;
  resultingMarginRate: Rate;
  breached: boolean;
}

/** `directCost ÷ (1 − floorMarginRate)`, rounded half-up to the sen. */
export const marginFloorPrice = (directCost: Money, floorMarginRate: Rate): Money => {
  if (floorMarginRate >= 1) return myr(Number.MAX_SAFE_INTEGER);
  return myr(roundHalfUpSen(directCost.amount / (1 - floorMarginRate)));
};

/** The margin a sell price actually yields against a direct cost. */
export const resultingMarginRate = (sellPrice: Money, directCost: Money): Rate => {
  if (sellPrice.amount === 0) return 0;
  return Math.round(((sellPrice.amount - directCost.amount) / sellPrice.amount) * 100) / 100;
};

/**
 * Evaluates a proposed sell price against both floors.
 *
 * The absolute floor comes from the programme's pricing tier for the headcount
 * when one is given, and from the quotation's stored `floorPrice` otherwise.
 */
export const evaluateFloors = (
  quotation: Quotation,
  sellPrice: Money,
  programme?: Programme,
): FloorEvaluation => {
  const absoluteFloorPrice = programme?.floorPrice ?? quotation.floorPrice;
  const floorMarginRate = programme?.floorMarginRate ?? quotation.floorMarginRate;
  const derived = marginFloorPrice(quotation.directCost, floorMarginRate);
  const bindingFloor: BindingFloorBasis =
    derived.amount > absoluteFloorPrice.amount ? "MARGIN" : "ABSOLUTE";
  const floorPrice = bindingFloor === "MARGIN" ? derived : absoluteFloorPrice;
  return {
    absoluteFloorPrice,
    marginFloorPrice: derived,
    floorPrice,
    bindingFloor,
    resultingMarginRate: resultingMarginRate(sellPrice, quotation.directCost),
    breached: sellPrice.amount < floorPrice.amount,
  };
};

const formatMyr = (money: Money): string =>
  `RM ${(money.amount / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** §6 the `422 FLOOR_PRICE_BREACH` the quotation screen renders as its red field state. */
/**
 * Recomputes a stored quotation's two floors and the binding basis.
 *
 * This used to return a local `QuotationWithFloors` widening, because the
 * contract's `Quotation` said which floor price applied but not which of the
 * two constraints produced it. Ruling R6 put `absoluteFloorPrice`,
 * `marginFloorPrice` and `bindingFloorBasis` on the record itself, so the
 * widening described fields the contract already had and the alias only
 * survived to re-spell `BindingFloorBasis` as `BindingFloor` (W-64).
 */
export const withFloors = (quotation: Quotation, programme?: Programme): Quotation => {
  const evaluation = evaluateFloors(quotation, quotation.sellPrice, programme);
  return {
    ...quotation,
    floorPrice: evaluation.floorPrice,
    absoluteFloorPrice: evaluation.absoluteFloorPrice,
    marginFloorPrice: evaluation.marginFloorPrice,
    bindingFloorBasis: evaluation.bindingFloor,
  };
};

export const floorPriceBreach = (
  evaluation: FloorEvaluation,
  sellPrice: Money,
  pax: number,
): ContractError =>
  new ContractError(
    "FLOOR_PRICE_BREACH",
    `${formatMyr(sellPrice)} is below the ${formatMyr(evaluation.floorPrice)} floor for ${pax} pax.`,
    {
      floorPrice: evaluation.floorPrice,
      resultingMarginRate: evaluation.resultingMarginRate,
      requiresPolicy: "APV-02",
      absoluteFloorPrice: evaluation.absoluteFloorPrice,
      marginFloorPrice: evaluation.marginFloorPrice,
      /* `bindingFloorBasis` is the contract's name (§6). The `bindingFloor`
         sibling this bag used to carry alongside it was the fixture package's
         own alias, and two keys for one fact is how a consumer ends up reading
         whichever one it happened to see first. */
      bindingFloorBasis: evaluation.bindingFloor,
    },
  );

/**
 * §18 total-from-lines.
 *
 * Each line must equal `unit × qty` rounded half-up, `subtotal` must sum the
 * rounded lines, and `total` must equal `subtotal + sst`. A payload that does
 * not reconcile is rejected with `details.reason: "TOTAL_NOT_RECONCILED"`.
 */
export interface InvoiceReconciliation {
  reconciled: boolean;
  expectedSubtotal: Money;
  expectedTotal: Money;
  offendingLines: number[];
}

export const reconcileInvoice = (input: {
  lines: readonly { qty: number; unit: Money; amount: Money }[];
  subtotal: Money;
  sst: Money;
  total: Money;
}): InvoiceReconciliation => {
  const offendingLines: number[] = [];
  let expected = 0;
  input.lines.forEach((line, index) => {
    const lineTotal = roundHalfUpSen(line.unit.amount * line.qty);
    if (lineTotal !== line.amount.amount) offendingLines.push(index);
    expected += line.amount.amount;
  });
  const expectedSubtotal = myr(expected);
  const expectedTotal = myr(expected + input.sst.amount);
  return {
    reconciled:
      offendingLines.length === 0 &&
      input.subtotal.amount === expectedSubtotal.amount &&
      input.total.amount === expectedTotal.amount,
    expectedSubtotal,
    expectedTotal,
    offendingLines,
  };
};
