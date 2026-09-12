import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoneyInput } from "@/shared/components/kit/MoneyInput";
import { toEditable, toSen } from "@/shared/components/kit/format";

describe("toSen / toEditable", () => {
  it("toSen converts a decimal string to integer sen", () => {
    expect(toSen("18500.50")).toBe(1850050);
  });

  it("toSen returns null for an empty string", () => {
    expect(toSen("")).toBeNull();
  });

  it("toEditable converts a Money back to the editable two-decimal string", () => {
    expect(toEditable({ amount: 1850050, currency: "MYR" })).toBe("18500.50");
  });
});

describe("MoneyInput", () => {
  it("the label is associated with the input", () => {
    render(<MoneyInput value={null} onChange={vi.fn()} label="Quotation amount" />);
    expect(screen.getByLabelText("Quotation amount")).toBeInTheDocument();
  });

  it("typing a value calls onChange with a Money whose amount is integer sen", () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} onChange={onChange} label="Amount" />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "185.00" } });
    expect(onChange).toHaveBeenCalledWith({ amount: 18500, currency: "MYR" });
  });

  it("an errorText renders with role=alert and sets aria-invalid on the input", () => {
    render(
      <MoneyInput
        value={null}
        onChange={vi.fn()}
        label="Amount"
        errorText="Below the RM 12,000 floor · margin would be 18%"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Below the RM 12,000 floor");
    expect(screen.getByLabelText("Amount")).toHaveAttribute("aria-invalid", "true");
  });
});
