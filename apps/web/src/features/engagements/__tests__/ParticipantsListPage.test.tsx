import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentPrimaries } from "@/shared/components/kit";
import { ParticipantsListPage } from "../ParticipantsListPage";
import { renderScreen } from "@/test/renderScreen";

const PATH = "/training/participants";

const renderList = () =>
  renderScreen(<ParticipantsListPage />, { path: PATH, route: PATH, role: "OPS" });

describe("M10 · participant directory", () => {
  it("joins every cohort's roster into one directory", async () => {
    renderList();

    expect(await screen.findByText("Ahmad Firdaus")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Participants", level: 1 })).toBeInTheDocument();
    /* The join is the point: a participant row carries the cohort it belongs
       to, because there is no participant record page to carry it instead. */
    const table = screen.getByRole("table", { name: "Participants" });
    expect(within(table).getAllByText(/Leading Through Change/).length).toBeGreaterThan(0);
  });

  it("counts participants and cohorts on the header's meta line", async () => {
    renderList();

    await screen.findByText("Ahmad Firdaus");
    expect(screen.getByText(/participants/)).toBeInTheDocument();
    expect(screen.getByText(/cohorts/)).toBeInTheDocument();
  });

  it("has no solid primary — enrolment does not start here", async () => {
    renderList();
    await screen.findByText("Ahmad Firdaus");
    await waitFor(() => expect(currentPrimaries()).toEqual([]));
  });

  it("narrows to one department and reports it as a chip", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Ahmad Firdaus");
    await user.selectOptions(screen.getByLabelText("Department"), "Quality");

    expect(await screen.findByText("Department:")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Ahmad Firdaus")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Nurul Izzati")).toBeInTheDocument();
  });

  it("narrows to one cohort through the engagement facet", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Ahmad Firdaus");

    const facet = screen.getByLabelText("Engagement");
    const options = within(facet).getAllByRole("option");
    /* The first is "Any engagement"; the second is a real cohort. */
    await user.selectOptions(facet, options[1]);

    expect(await screen.findByText("Engagement:")).toBeInTheDocument();
    expect(screen.getByText(/of \d+ shown/)).toBeInTheDocument();
  });

  it("empties honestly when the search matches nobody", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Ahmad Firdaus");
    await user.type(screen.getByLabelText("Search"), "nobody by this name");

    expect(await screen.findByText("No participant matches these filters")).toBeInTheDocument();
  });

  it("carries a row through to its cohort's attendance sheet", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByText("Ahmad Firdaus"));

    await waitFor(() => {
      expect(screen.queryByRole("table", { name: "Participants" })).not.toBeInTheDocument();
    });
  });

  it("puts the cohort status track and the filter controls on ONE row, per brief §10b", async () => {
    renderList();

    await screen.findByRole("heading", { name: "Participants", level: 1 });

    const tabs = screen.getByRole("tablist", { name: "Cohort status" });
    const filters = screen.getByRole("group", { name: "Filters" });

    /* Not "both exist" — both resolve to the SAME toolbar row. The filter row
       used to be a second band under the track, which is what §10b forbids. */
    const row = tabs.closest("[data-list-toolbar]");
    expect(row).not.toBeNull();
    expect(filters.closest("[data-list-toolbar]")).toBe(row);

    /* §16b: unfiltered, nothing counts anything — the active tab already
       prints the number, and the counter said it again on the same row. */
    expect(screen.queryByText(/\d+ of \d+ shown/)).toBeNull();

    await userEvent.type(screen.getByLabelText("Search"), "Nurul");
    const counter = await screen.findByText(/\d+ of \d+ shown/);
    expect(counter.closest("[data-list-toolbar]")).toBe(row);
  });
});
