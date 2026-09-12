import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROGRAMME_LEADING_CHANGE } from "@trainos/contract";
import { ProgrammesListPage } from "../ProgrammesListPage";
import { ProgrammeDetailPage } from "../ProgrammeDetailPage";
import { nearestWindow, poolRows } from "../availability";
import { renderScreen } from "./render-harness";

const DETAIL_ROUTE = "/training/programmes/:programmeRef";
const detailPath = `/training/programmes/${PROGRAMME_LEADING_CHANGE}`;

describe("M06 · programmes list", () => {
  it("lists the catalogue and narrows it with the duration facet", async () => {
    const user = userEvent.setup();
    renderScreen(<ProgrammesListPage />, {
      path: "/training/programmes",
      route: "/training/programmes",
    });

    expect(await screen.findByText("Leading Through Change")).toBeInTheDocument();
    expect(screen.getByText("Conflict to Collaboration")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Duration"), "1");

    await waitFor(() => {
      expect(screen.queryByText("Leading Through Change")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Conflict to Collaboration")).toBeInTheDocument();
  });

  it("filters on HRDC claimability and shows the applied filter as a chip", async () => {
    const user = userEvent.setup();
    renderScreen(<ProgrammesListPage />, {
      path: "/training/programmes",
      route: "/training/programmes",
    });

    await screen.findByText("Leading Through Change");
    await user.selectOptions(screen.getByLabelText("HRDC"), "NOT_CLAIMABLE");

    /* Every seeded programme is claimable, so this is also the empty state. */
    expect(await screen.findByText("No programme matches these filters")).toBeInTheDocument();
    /* The chip, not the select option that set it. */
    expect(screen.getByText("HRDC:")).toBeInTheDocument();
  });
});

describe("M06-S02 · programme detail", () => {
  it("renders the five metrics, the outcomes, the modules and the past deliveries", async () => {
    renderScreen(<ProgrammeDetailPage />, { path: detailPath, route: DETAIL_ROUTE });

    expect(
      await screen.findByRole("heading", { name: "Leading Through Change" }),
    ).toBeInTheDocument();

    /* "Duration" is also a modules-table column header and "Trainer pool" is
       also a section heading, so the ambiguous labels are asserted by count. */
    for (const label of ["List price", "Delivered", "Avg evaluation"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of ["Duration", "Trainer pool"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    expect(
      screen.getByText("Name the four escalation patterns that stall cross-team work"),
    ).toBeInTheDocument();
    expect(screen.getByText("Reading the escalation")).toBeInTheDocument();
    expect(await screen.findByText("Aurora Manufacturing Sdn Bhd")).toBeInTheDocument();
  });

  it("shows the absolute floor beside the pricing tiers, because M07-S03 validates against it", async () => {
    renderScreen(<ProgrammeDetailPage />, { path: detailPath, route: DETAIL_ROUTE });

    expect(await screen.findByText(/Absolute floor/)).toBeInTheDocument();
    expect(screen.getByText("RM 13,900.00")).toBeInTheDocument();
  });

  it("renders the second trainer as booked in the delivery window", async () => {
    renderScreen(<ProgrammeDetailPage />, { path: detailPath, route: DETAIL_ROUTE });

    expect(await screen.findByText("Daniel Wong")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Booked")).toBeInTheDocument();
    });
    expect(screen.getByText(/already booked across/)).toBeInTheDocument();
  });

  it("hides the catalogue primary from Sales and offers it to Admin", async () => {
    const sales = renderScreen(<ProgrammeDetailPage />, { path: detailPath, route: DETAIL_ROUTE });
    await screen.findByRole("heading", { name: "Leading Through Change" });
    expect(screen.queryByRole("button", { name: "Edit programme" })).not.toBeInTheDocument();
    sales.unmount();

    renderScreen(<ProgrammeDetailPage />, { path: detailPath, route: DETAIL_ROUTE, role: "ADMIN" });
    await screen.findByRole("heading", { name: "Leading Through Change" });
    expect(await screen.findByRole("button", { name: "Edit programme" })).toBeInTheDocument();
  });

  it("renders the error state when the programme does not exist", async () => {
    renderScreen(<ProgrammeDetailPage />, {
      path: "/training/programmes/PRG-9999",
      route: DETAIL_ROUTE,
    });

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Could not load this programme")).toBeInTheDocument();
  });
});

describe("trainer availability", () => {
  const window = {
    ref: "ENG-0231",
    dates: ["2026-11-12", "2026-11-13"],
    metrics: { trainer: { ref: "TRN-0007", name: "Farah Aziz" } },
  } as unknown as Parameters<typeof poolRows>[2];

  it("marks the assigned trainer delivering and an overlapping trainer booked", () => {
    const rows = poolRows(
      [
        { trainerRef: "TRN-0007", name: "Farah Aziz", tttCertified: true },
        { trainerRef: "TRN-0012", name: "Daniel Wong", tttCertified: true },
      ],
      [
        {
          ref: "TRN-0007",
          bookedDates: ["2026-11-12", "2026-11-13"],
        } as never,
        {
          ref: "TRN-0012",
          bookedDates: ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"],
        } as never,
      ],
      window,
    );

    expect(rows[0]?.status).toBe("DELIVERING");
    expect(rows[1]?.status).toBe("BOOKED");
  });

  it("picks the window nearest to today in either direction", () => {
    const past = { ref: "ENG-A", dates: ["2026-11-12"] } as never;
    const far = { ref: "ENG-B", dates: ["2027-01-14"] } as never;
    expect(nearestWindow([far, past], "2026-11-14")?.ref).toBe("ENG-A");
  });
});
