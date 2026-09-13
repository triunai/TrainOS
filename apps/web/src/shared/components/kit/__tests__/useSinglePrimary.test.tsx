import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { PrimaryButton } from "@/shared/components/kit/Button";
import { CondensedRecordHeader } from "@/shared/components/kit/RecordHeader";
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

  it("warns when two PrimaryButtons share the SAME label — W-04's hole", () => {
    /* This used to be asserted the other way round. Exempting every repeated
       label was meant to cover one case, RecordHeader's condensed bar, and it
       covered four screens that rendered "Add rule" opening a drawer beside
       "Add rule" submitting it. Two solid buttons is two solid buttons. */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <>
        <PrimaryButton>Save quotation</PrimaryButton>
        <PrimaryButton>Save quotation</PrimaryButton>
      </>,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("Save quotation");
    warn.mockRestore();
  });

  it("does not warn for the condensed bar's copy of a primary already claimed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const action = <PrimaryButton>Send for approval</PrimaryButton>;

    render(
      <>
        {action}
        <CondensedRecordHeader title="PRO-2026-0184" primaryAction={action} />
      </>,
    );

    expect(warn).not.toHaveBeenCalled();
    /* One claim, though two buttons are on screen: the echo is the same action
       kept reachable, which is the exemption the label comparison generalised
       into a hole. */
    expect(currentPrimaries()).toEqual(["Send for approval"]);
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
