import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelationPicker, type RelationOption } from "@/shared/components/kit/RelationPicker";

const options: RelationOption[] = [
  { ref: "ORG-0114", type: "ORGANISATION", label: "Acme Sdn Bhd" },
  { ref: "ORG-0200", type: "ORGANISATION", label: "Beta Holdings" },
];

describe("RelationPicker", () => {
  it("renders a combobox with the label, and options render with their labels", () => {
    render(
      <RelationPicker
        query=""
        onQueryChange={vi.fn()}
        options={options}
        onSelect={vi.fn()}
        label="Organisation"
      />,
    );
    expect(screen.getByRole("combobox", { name: "Organisation" })).toBeInTheDocument();
    expect(screen.getByText("Acme Sdn Bhd")).toBeInTheDocument();
    expect(screen.getByText("Beta Holdings")).toBeInTheDocument();
  });

  it("clicking an option calls onSelect with that option, and the selected option has aria-selected true", () => {
    const onSelect = vi.fn();
    render(
      <RelationPicker
        query=""
        onQueryChange={vi.fn()}
        options={options}
        selectedRef="ORG-0200"
        onSelect={onSelect}
        label="Organisation"
      />,
    );
    fireEvent.click(screen.getByText("Acme Sdn Bhd"));
    expect(onSelect).toHaveBeenCalledWith(options[0]);
    expect(screen.getByRole("option", { name: /Beta Holdings/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("the create row calls onCreate with the current query", () => {
    const onCreate = vi.fn();
    render(
      <RelationPicker
        query="Gamma"
        onQueryChange={vi.fn()}
        options={options}
        onSelect={vi.fn()}
        onCreate={onCreate}
        label="Organisation"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Create organisation/ }));
    expect(onCreate).toHaveBeenCalledWith("Gamma");
  });

  it("renders 'No matches' when options is empty", () => {
    render(
      <RelationPicker
        query="zzz"
        onQueryChange={vi.fn()}
        options={[]}
        onSelect={vi.fn()}
        label="Organisation"
      />,
    );
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
});
