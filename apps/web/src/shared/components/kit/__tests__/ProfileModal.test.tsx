/**
 * The profile modal, Kit.dc.html §07 "Profile modal · 960".
 *
 * The assertions worth having are about HONESTY rather than layout: the modal
 * shows eleven fields the API does not return, and two controls that cannot act
 * yet. A modal that renders an enabled Save which saves nothing, or a language
 * select that changes nothing, is the failure mode here.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileModal, type ProfileModalProps } from "../ProfileModal";

const props: ProfileModalProps = {
  open: true,
  onClose: vi.fn(),
  name: "Amirah Yusof",
  roleLabel: "Sales Consultant",
  orgAndLocation: "Akademi Perdana · Klang Valley",
  lastSignIn: "Last sign in 11-09-2026 08:04:22 AM",
  session: "Chrome · Shah Alam, GMT+8",
  version: "TrainOS 0.0.0 · API v1 · contract 0.1.0",
  orgName: "Akademi Perdana",
  orgCode: "APSB",
  fields: [
    { label: "Job title", value: "Senior Sales Consultant" },
    { label: "Department", value: "Commercial" },
    { label: "Email", value: "amirah.yusof@akademiperdana.my" },
    { label: "Mobile", value: "+60 12-448 9021" },
    { label: "Staff no.", value: "APSB-0142" },
    { label: "Language & timezone", value: "Coming soon", pending: true },
  ],
  chips: [
    { label: "7 modules", tone: "accent" },
    { label: "2FA on", tone: "success" },
    { label: "2 active sessions" },
  ],
  dataScope: { clients: "My accounts", teams: "My team" },
};

describe("ProfileModal", () => {
  it("names itself by the person, so the dialog announces who it is about", () => {
    render(<ProfileModal {...props} />);
    expect(screen.getByRole("dialog", { name: "Amirah Yusof" })).toBeInTheDocument();
  });

  it("draws the artboard's record: the tenant, the session and all six cards", () => {
    render(<ProfileModal {...props} />);

    expect(screen.getByText("Akademi Perdana · Klang Valley")).toBeInTheDocument();
    expect(screen.getByText("APSB")).toBeInTheDocument();
    expect(screen.getByText("Chrome · Shah Alam, GMT+8")).toBeInTheDocument();

    for (const field of props.fields) {
      expect(screen.getByText(field.label)).toBeInTheDocument();
    }
    for (const chip of props.chips) {
      expect(screen.getByText(chip.label)).toBeInTheDocument();
    }
  });

  it("disables Save, because there is no endpoint behind it", () => {
    render(<ProfileModal {...props} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("disables an account action with no handler rather than pretending", () => {
    render(<ProfileModal {...props} />);
    expect(screen.getByRole("button", { name: /Change password/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeDisabled();
  });

  it("enables an account action once it is given one", () => {
    const onSignOut = vi.fn();
    render(<ProfileModal {...props} onSignOut={onSignOut} />);
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeEnabled();
  });

  it("closes from the banner's control", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ProfileModal {...props} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(<ProfileModal {...props} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
