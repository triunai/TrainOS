import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateField, Field, TextArea, TextField } from "@/shared/components/kit";

/**
 * W-35 and W-30 · one labelled control, and it has a name.
 *
 * Five local implementations of this existed under three names, and the one in
 * `AddProviderKeyDrawer` rendered its caption as a bare `<span>` with no
 * `htmlFor` — so Provider, Label, Key, Billing owner and Rotation date had no
 * accessible name at all. Generating the id inside the component is what makes
 * that unforgettable, so every test below finds its control BY ITS LABEL.
 */

describe("the kit's labelled controls", () => {
  it("gives a text input an accessible name and reports what is typed", async () => {
    const onChange = vi.fn();
    render(<TextField label="Bank reference" value="" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("Bank reference"), "F");

    expect(onChange).toHaveBeenCalledWith("F");
  });

  it("names a date input and keeps its yyyy-mm-dd value", () => {
    render(<DateField label="Received on" value="2026-09-13" onChange={() => undefined} />);

    const input = screen.getByLabelText("Received on") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("2026-09-13");
  });

  it("names a textarea", () => {
    render(<TextArea label="Say why" value="" onChange={() => undefined} />);

    expect(screen.getByLabelText("Say why").tagName).toBe("TEXTAREA");
  });

  it("wires a control it does not own — the case the drawer's Field got wrong", () => {
    render(
      <Field label="Billing owner">
        {(control) => (
          <select {...control} value="CLIENT_ACCOUNT" onChange={() => undefined}>
            <option value="CLIENT_ACCOUNT">Client account</option>
          </select>
        )}
      </Field>,
    );

    expect(screen.getByLabelText("Billing owner").tagName).toBe("SELECT");
  });

  it("describes the control by its hint", () => {
    render(<TextField label="Key" value="" onChange={() => undefined} hint="Stored encrypted." />);

    expect(screen.getByLabelText("Key")).toHaveAccessibleDescription("Stored encrypted.");
  });

  it("replaces the hint with the error and marks the control invalid", () => {
    render(
      <TextField
        label="Key"
        value=""
        onChange={() => undefined}
        hint="Stored encrypted."
        errorText="That key was rejected by the provider."
      />,
    );

    const input = screen.getByLabelText("Key");
    expect(input).toHaveAccessibleDescription("That key was rejected by the provider.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Stored encrypted.")).toBeNull();
  });
});
