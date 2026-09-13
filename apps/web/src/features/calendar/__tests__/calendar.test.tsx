import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EngagementProjection } from "@trainos/fixtures";
import { TrainingCalendarScreen } from "../TrainingCalendarScreen";
import { daysWithin, openingAnchor, scheduleDays, todayKey } from "../schedule";
import { CALENDAR_PATH } from "../paths";
import { currentPrimaries } from "@/shared/components/kit";
import { renderScreen } from "@/test/renderScreen";

const render = () =>
  renderScreen(<TrainingCalendarScreen />, {
    path: CALENDAR_PATH,
    route: CALENDAR_PATH,
    role: "OPS",
  });

/** Two delivery days, one of them from an engagement that publishes sessions. */
const ENGAGEMENT = {
  ref: "ENG-0231",
  organisationRef: "ORG-0114",
  title: "Leading Through Change",
  status: "DELIVERED",
  venue: "Aurora HQ Shah Alam",
  dates: ["2026-11-12", "2026-11-13"],
  metrics: { trainer: { ref: "TRN-0007", name: "Farah Aziz" } },
  sessions: [{ date: "2026-11-12", title: "Escalation & conflict", venue: "Training Room A" }],
} as unknown as EngagementProjection;

describe("the schedule model", () => {
  it("makes one entry per delivery DAY, keyed so two days of one course do not collide", () => {
    const days = scheduleDays([ENGAGEMENT]);

    expect(days.map((day) => day.id)).toEqual(["ENG-0231::2026-11-12", "ENG-0231::2026-11-13"]);
    expect(days.map((day) => day.dayNumber)).toEqual([1, 2]);
    expect(days[0]?.dayCount).toBe(2);
  });

  it("prefers the session's room over the engagement's site, and falls back to the site", () => {
    const days = scheduleDays([ENGAGEMENT]);

    expect(days[0]?.venue).toBe("Training Room A");
    /* Day 2 publishes no session, which is every engagement but ENG-0231 in the
       seed — a calendar built on `sessions` alone would draw nothing here. */
    expect(days[1]?.venue).toBe("Aurora HQ Shah Alam");
    expect(days[1]?.sessionTitle).toBeNull();
  });

  it("does not invent the days between two listed dates", () => {
    const skipped = { ...ENGAGEMENT, dates: ["2026-11-12", "2026-11-16"] } as EngagementProjection;
    expect(scheduleDays([skipped]).map((day) => day.day)).toEqual(["2026-11-12", "2026-11-16"]);
  });

  it("windows a period inclusively at both ends", () => {
    const days = scheduleDays([ENGAGEMENT]);
    expect(daysWithin(days, "2026-11-12", "2026-11-12")).toHaveLength(1);
    expect(daysWithin(days, "2026-11-12", "2026-11-13")).toHaveLength(2);
    expect(daysWithin(days, "2026-12-01", "2026-12-31")).toHaveLength(0);
  });

  it("opens on the next delivery, or on the last one when every delivery is past", () => {
    const days = scheduleDays([ENGAGEMENT]);

    expect(openingAnchor(days, "2026-10-01")).toBe("2026-11-12");
    expect(openingAnchor(days, "2026-11-13")).toBe("2026-11-13");
    /* Everything is behind the reader: the most recent delivery, not an empty
       grid in whatever month the clock happens to be in. */
    expect(openingAnchor(days, "2027-03-01")).toBe("2026-11-13");
    expect(openingAnchor([], "2027-03-01")).toBe("2027-03-01");
  });

  it("reads today off the LOCAL clock, so a UTC conversion cannot ring yesterday", () => {
    /* 1 Jan 2027 at 07:00 local is 31 Dec in UTC wherever the offset is
       positive, which is every Malaysian reader. */
    expect(todayKey(new Date(2027, 0, 1, 7, 0, 0))).toBe("2027-01-01");
  });
});

describe("M-none · the training calendar", () => {
  it("draws the delivery days of the period it opens on", async () => {
    render();

    /* The seed's next delivery decides the month, so the assertion is on the
       grid being drawn and named rather than on a month the clock chooses. */
    const grid = await screen.findByRole("region", { name: /^Delivery days · / });
    expect(within(grid).getByText("Mon")).toBeInTheDocument();
  });

  it("lists every delivery day when the grid is exchanged for the list", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("region", { name: /^Delivery days · / });
    await user.click(screen.getByRole("tab", { name: /^List/ }));

    const list = await screen.findByRole("region", { name: "Delivery days" });
    /* Both of ENG-0231's days, which no single month view is guaranteed to hold. */
    expect(within(list).getAllByText("Leading Through Change").length).toBeGreaterThanOrEqual(2);
    expect(
      within(list).getAllByText("Sales Excellence for Store Managers — Kenanga").length,
    ).toBeGreaterThan(0);
  });

  it("opens the day's engagement in the detail pane, with its lifecycle", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("region", { name: /^Delivery days · / });
    await user.click(screen.getByRole("tab", { name: /^List/ }));

    const list = await screen.findByRole("region", { name: "Delivery days" });
    const [first] = within(list).getAllByRole("button");
    await user.click(first as HTMLElement);

    expect(await screen.findByText(/Open the engagement/)).toBeInTheDocument();
    expect(screen.getByText("Trainer")).toBeInTheDocument();
  });

  it("narrows the schedule by status and says so in the count line", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("region", { name: /^Delivery days · / });
    await user.click(screen.getByRole("tab", { name: /^List/ }));
    await user.selectOptions(screen.getByLabelText("Status"), "CANCELLED");

    const list = await screen.findByRole("region", { name: "Delivery days" });
    expect(within(list).getByText("Conflict to Collaboration — Sutera")).toBeInTheDocument();
    expect(within(list).queryByText("Leading Through Change")).not.toBeInTheDocument();
  });

  it("says the period is empty rather than drawing forty-two blank cells", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("region", { name: /^Delivery days · / });
    /* Far enough forward that the seed, which ends in January 2027, cannot
       reach: twelve months of Next from wherever the calendar opened. */
    for (let step = 0; step < 14; step += 1) {
      await user.click(screen.getByRole("button", { name: "Next month" }));
    }

    expect(await screen.findByText(/^Nothing is delivered in /)).toBeInTheDocument();
  });

  it("claims no solid primary — a calendar has nothing to create", async () => {
    render();
    await screen.findByRole("region", { name: /^Delivery days · / });

    await waitFor(() => {
      expect(currentPrimaries()).toHaveLength(0);
    });
  });
});
