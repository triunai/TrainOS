import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhatsAppCostStrip } from "@/shared/components/kit/WhatsAppCostStrip";

describe("WhatsAppCostStrip", () => {
  it("renders the category, recipients, and estimated cost", () => {
    render(
      <WhatsAppCostStrip
        category="UTILITY"
        templateLabel="Booking confirmation"
        recipients={100}
        ratePerMessage={{ amount: 5.64, currency: "MYR" }}
        estimatedCost={{ amount: 564, currency: "MYR" }}
      />,
    );
    expect(screen.getByText(/Utility/)).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("RM 5.64")).toBeInTheDocument();
  });

  it("renders the per-message rate with four decimal places, not rounded to two", () => {
    render(
      <WhatsAppCostStrip
        category="UTILITY"
        templateLabel="Booking confirmation"
        recipients={100}
        ratePerMessage={{ amount: 5.64, currency: "MYR" }}
        estimatedCost={{ amount: 564, currency: "MYR" }}
      />,
    );
    expect(screen.getByText("RM 0.0564")).toBeInTheDocument();
    expect(screen.queryByText("RM 0.06")).not.toBeInTheDocument();
  });

  it("renders the saving line only when alternativeRate is cheaper than ratePerMessage", () => {
    const { rerender } = render(
      <WhatsAppCostStrip
        category="MARKETING"
        templateLabel="Promo blast"
        recipients={100}
        ratePerMessage={{ amount: 34.67, currency: "MYR" }}
        estimatedCost={{ amount: 3467, currency: "MYR" }}
        alternativeCategory="UTILITY"
        alternativeRate={{ amount: 5.64, currency: "MYR" }}
      />,
    );
    expect(screen.getByText(/would save/)).toBeInTheDocument();

    rerender(
      <WhatsAppCostStrip
        category="MARKETING"
        templateLabel="Promo blast"
        recipients={100}
        ratePerMessage={{ amount: 34.67, currency: "MYR" }}
        estimatedCost={{ amount: 3467, currency: "MYR" }}
      />,
    );
    expect(screen.queryByText(/would save/)).not.toBeInTheDocument();
  });
});
