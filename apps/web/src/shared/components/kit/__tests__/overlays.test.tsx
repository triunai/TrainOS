import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Drawer } from "@/shared/components/kit/Drawer";
import { ConfirmDialog } from "@/shared/components/kit/ConfirmDialog";

// Radix's Dialog.Content measures itself on mount and calls
// `hasPointerCapture`/`scrollIntoView`, none of which jsdom implements. Stubbed
// here only — this file is the only one in the suite that mounts a Radix
// dialog, so the stub cannot leak into another agent's tests.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

describe("Drawer", () => {
  it("renders role=dialog with the title as its accessible name when open, portalled to the document", () => {
    render(
      <Drawer open onClose={() => {}} title="Audit trail">
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.getByRole("dialog", { name: "Audit trail" })).toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Audit trail">
        <p>Body</p>
      </Drawer>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when open is false", () => {
    render(
      <Drawer open={false} onClose={() => {}} title="Audit trail">
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("renders role=dialog with the title, description, confirm and cancel labels when open", () => {
    render(
      <ConfirmDialog
        open
        onCancel={() => {}}
        onConfirm={() => {}}
        title="Unlock attendance for ENG-0311?"
        description="This reopens the attendance register for editing."
        confirmLabel="Request unlock"
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Unlock attendance for ENG-0311?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This reopens the attendance register for editing."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request unlock" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("calls onConfirm and onCancel from their respective buttons", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        onCancel={onCancel}
        onConfirm={onConfirm}
        title="Unlock attendance?"
        confirmLabel="Request unlock"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Request unlock" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when open is false", () => {
    render(
      <ConfirmDialog
        open={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        title="Unlock attendance?"
        confirmLabel="Request unlock"
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
