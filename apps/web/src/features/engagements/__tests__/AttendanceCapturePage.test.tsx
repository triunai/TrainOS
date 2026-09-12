import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ENGAGEMENT_AURORA } from "@trainos/contract";
import { currentPrimaries } from "@/shared/components/kit";
import { ATTENDANCE_CAPTURE_PATTERN, AttendanceCapturePage } from "@/features/engagements";
import { renderAt, resetFixtures } from "./harness";

/**
 * M10-S06. The assertions track the design pack's "states rendered" row: locked
 * is the state shown, capture modes are disabled, and one participant is absent
 * both sessions with a recorded reason.
 */
describe("AttendanceCapturePage · M10-S06", () => {
  beforeEach(resetFixtures);

  const open = (day?: number) =>
    render(
      renderAt(
        `/training/participants/${ENGAGEMENT_AURORA}/attendance${
          day === undefined ? "" : `?day=${day}`
        }`,
        ATTENDANCE_CAPTURE_PATTERN,
        <AttendanceCapturePage />,
        "OPS",
      ),
    );

  it("renders the locked day with no solid primary button", async () => {
    open(1);

    expect(
      await screen.findByRole("heading", { name: /Attendance · ENG-0231/ }),
    ).toBeInTheDocument();

    /* The second documented exception to the one-primary rule. */
    expect(currentPrimaries()).toHaveLength(0);

    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("Approved 14 Nov 2026")).toBeInTheDocument();
    expect(
      screen.getByText(/Attendance approved on 14 Nov 2026 at 10:01 and locked/),
    ).toBeInTheDocument();
    expect(screen.getByText(/approved attendance records to be immutable/)).toBeInTheDocument();
  });

  it("disables every capture control from the response, not from its own logic", async () => {
    open(1);

    expect(await screen.findByText("Capture modes disabled while locked")).toBeInTheDocument();
    for (const label of ["QR check-in", "Signature", "Manual"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }

    /* The per-row marks read `captureModes.manual`, which is false once locked. */
    expect(screen.getByRole("button", { name: /Ahmad Firdaus AM · present/ })).toBeDisabled();
  });

  it("shows the AM and PM marks per day, and the absentee's recorded reason", async () => {
    open(1);

    const table = await screen.findByRole("table", { name: "Attendance for day 1" });
    expect(within(table).getByText("Ahmad Firdaus")).toBeInTheDocument();
    expect(within(table).getAllByText("✓ 09:02").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("✓ 14:05").length).toBeGreaterThan(0);

    const absent = within(table).getAllByText("medical leave");
    expect(absent).toHaveLength(2);
    expect(screen.getByText(/Nur Aisyah \(medical leave\)/)).toBeInTheDocument();
  });

  it("surfaces the 409 ATTENDANCE_LOCKED refusal when the locked day is approved again", async () => {
    const user = userEvent.setup();
    open(1);

    await user.click(await screen.findByRole("button", { name: "Approve day" }));

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent(/day 1 is already locked/i);
    expect(refusal).toHaveTextContent("ATTENDANCE_LOCKED");
  });

  it("allows capture on the day that is still open, and records the change", async () => {
    const user = userEvent.setup();
    open(2);

    const table = await screen.findByRole("table", { name: "Attendance for day 2" });
    expect(screen.getByText("Capture modes")).toBeInTheDocument();

    const mark = within(table).getByRole("button", { name: /Ahmad Firdaus AM · present/ });
    expect(mark).toBeEnabled();
    await user.click(mark);

    expect(
      await within(table).findByRole("button", { name: /Ahmad Firdaus AM · absent/ }),
    ).toBeInTheDocument();
  });

  it("requires a reason before an unlock request is sent", async () => {
    const user = userEvent.setup();
    open(1);

    await user.click(await screen.findByRole("button", { name: "Request unlock" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/voids the claim packet/);

    await user.click(within(dialog).getByRole("button", { name: "Request unlock" }));

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent(/requires a reason/i);
  });

  it("switches days from the pill tabs", async () => {
    const user = userEvent.setup();
    open(1);

    await user.click(await screen.findByRole("tab", { name: /Day 2 · 13 Nov 2026/ }));
    expect(await screen.findByRole("table", { name: "Attendance for day 2" })).toBeInTheDocument();
  });
});
