import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Money } from "@trainos/contract";
import { WhatsAppCostStrip } from "@/shared/components/kit/WhatsAppCostStrip";

const money = (amount: number): Money => ({ amount, currency: "MYR" });

/* The real Malaysian BSP rates. Utility is RM 0.0564 and Marketing RM 0.3467,
   both of which round to a different number in integer sen — which is the whole
   reason `ratePerMessageExact` exists. */
const UTILITY_EXACT = "0.0564";
const MARKETING_EXACT = "0.3467";

describe("WhatsAppCostStrip", () => {
  it("renders the category, template, recipients and estimated cost", () => {
    render(
      <WhatsAppCostStrip
        category="UTILITY"
        templateLabel="followup_v3"
        recipients={30}
        ratePerMessage={money(6)}
        ratePerMessageExact={UTILITY_EXACT}
        estimatedCost={money(169)}
      />,
    );

    expect(screen.getByRole("region", { name: "Message cost" })).toBeInTheDocument();
    expect(screen.getByText(/Utility · followup_v3/)).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("RM 1.69")).toBeInTheDocument();
  });

  /* The bug this component was reported for. `ratePerMessage` is integer sen,
     so RM 0.0564 arrives as 6 and any arithmetic on it produces RM 0.0600 — a
     wrong number rendered to four decimal places. */
  it("shows the exact rate rather than one derived from rounded sen", () => {
    render(
      <WhatsAppCostStrip
        category="UTILITY"
        templateLabel="followup_v3"
        recipients={30}
        ratePerMessage={money(6)}
        ratePerMessageExact={UTILITY_EXACT}
        estimatedCost={money(169)}
      />,
    );

    expect(screen.getByText("RM 0.0564")).toBeInTheDocument();
    expect(screen.queryByText("RM 0.0600")).not.toBeInTheDocument();
  });

  /* Without the exact string there is no four-decimal precision to claim, so
     the rounded value must render at two rather than pretending to four. */
  it("falls back to two decimals when no exact rate is supplied", () => {
    render(
      <WhatsAppCostStrip
        category="UTILITY"
        templateLabel="followup_v3"
        recipients={30}
        ratePerMessage={money(6)}
        estimatedCost={money(169)}
      />,
    );

    expect(screen.getByText("RM 0.06")).toBeInTheDocument();
    expect(screen.queryByText(/RM 0\.0600/)).not.toBeInTheDocument();
  });

  /* The direction the artboard actually draws: the alternative is DEARER, and
     saying so is what explains why this template was the one chosen. */
  it("states the cost of a dearer alternative and does not call it a saving", () => {
    render(
      <WhatsAppCostStrip
        category="UTILITY"
        templateLabel="followup_v3"
        recipients={30}
        ratePerMessage={money(6)}
        ratePerMessageExact={UTILITY_EXACT}
        estimatedCost={money(169)}
        alternative={{ category: "MARKETING", ratePerMessage: money(35) }}
      />,
    );

    expect(screen.getByText(/Marketing category would cost/)).toBeInTheDocument();
    expect(screen.queryByText(/would save/)).not.toBeInTheDocument();
  });

  /* The defect this pins: the primary rate printed RM 0.0564 and the
     comparison beside it printed RM 0.35, so the six-fold difference the strip
     exists to show was read off two different precisions. */
  it("prints both sides of the comparison at the same precision", () => {
    render(
      <WhatsAppCostStrip
        category="UTILITY"
        templateLabel="followup_v3"
        recipients={30}
        ratePerMessage={money(6)}
        ratePerMessageExact={UTILITY_EXACT}
        estimatedCost={money(169)}
        alternative={{
          category: "MARKETING",
          ratePerMessage: money(35),
          ratePerMessageExact: MARKETING_EXACT,
        }}
      />,
    );

    expect(screen.getByText("RM 0.0564")).toBeInTheDocument();
    expect(screen.getByText("RM 0.3467")).toBeInTheDocument();
    expect(screen.queryByText("RM 0.35")).not.toBeInTheDocument();
  });

  /* Without an exact string the rounded Money is still the fallback, and it is
     printed at two decimals — four on a value that has two is a lie about
     precision, not extra care. */
  it("falls back to the rounded alternative rate when no exact string is sent", () => {
    render(
      <WhatsAppCostStrip
        category="UTILITY"
        templateLabel="followup_v3"
        recipients={30}
        ratePerMessage={money(6)}
        ratePerMessageExact={UTILITY_EXACT}
        estimatedCost={money(169)}
        alternative={{ category: "MARKETING", ratePerMessage: money(35) }}
      />,
    );

    expect(screen.getByText("RM 0.35")).toBeInTheDocument();
  });

  it("states the saving when the alternative is cheaper", () => {
    render(
      <WhatsAppCostStrip
        category="MARKETING"
        templateLabel="promo_v1"
        recipients={30}
        ratePerMessage={money(35)}
        ratePerMessageExact={MARKETING_EXACT}
        estimatedCost={money(1040)}
        alternative={{ category: "UTILITY", ratePerMessage: money(6) }}
      />,
    );

    expect(screen.getByText(/would save/)).toBeInTheDocument();
    expect(screen.getByText("RM 8.70")).toBeInTheDocument();
    expect(screen.queryByText(/would cost/)).not.toBeInTheDocument();
  });

  it("renders no comparison line when there is no alternative", () => {
    render(
      <WhatsAppCostStrip
        category="UTILITY"
        templateLabel="followup_v3"
        recipients={30}
        ratePerMessage={money(6)}
        ratePerMessageExact={UTILITY_EXACT}
        estimatedCost={money(169)}
      />,
    );

    expect(screen.queryByText(/would save|would cost/)).not.toBeInTheDocument();
  });
});
