import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { PrimaryButton } from "@/shared/components/kit/Button";
import { resetPrimaries, currentPrimaries } from "@/shared/components/kit/useSinglePrimary";

describe("useSinglePrimary", () => {
  beforeEach(() => {
    resetPrimaries();
  });

  it("does not warn when a single PrimaryButton mounts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PrimaryButton>Save</PrimaryButton>);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when two PrimaryButtons with DIFFERENT labels mount at once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <>
        <PrimaryButton>Save</PrimaryButton>
        <PrimaryButton>Delete</PrimaryButton>
      </>,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("Save");
    expect(warn.mock.calls[0][0]).toContain("Delete");
    warn.mockRestore();
  });

  it("does not warn when two PrimaryButtons share the SAME label", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <>
        <PrimaryButton>Save quotation</PrimaryButton>
        <PrimaryButton>Save quotation</PrimaryButton>
      </>,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("tracks the labels currently claiming the view's primary", () => {
    render(<PrimaryButton>Save</PrimaryButton>);
    expect(currentPrimaries()).toEqual(["Save"]);
  });

  it("resetPrimaries clears the registry between tests", () => {
    render(<PrimaryButton>Save</PrimaryButton>);
    resetPrimaries();
    expect(currentPrimaries()).toEqual([]);
  });
});
