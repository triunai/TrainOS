import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentPrimaries } from "@/shared/components/kit";
import { OrganisationsListPage } from "../OrganisationsListPage";
import { renderScreen } from "@/test/renderScreen";

const PATH = "/sales/organisations";

const renderList = () => renderScreen(<OrganisationsListPage />, { path: PATH, route: PATH });

describe("M04 · organisation directory", () => {
  it("lists the directory under one heading, with the count line in the header", async () => {
    renderList();

    /* The title paints before the directory arrives — it is not waiting on
       data — so the row is what the test waits for. */
    expect(await screen.findByText("Aurora Manufacturing Sdn Bhd")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Organisations", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Kenanga Retail Group Berhad")).toBeInTheDocument();
    expect(screen.getByText("Sutera Hospitality Group")).toBeInTheDocument();

    /* The count line lives on the header's meta row, not in a second title. */
    expect(screen.getByText(/6 organisations/)).toBeInTheDocument();
  });

  it("has no solid primary — a directory offers nothing to create here", async () => {
    renderList();
    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    await waitFor(() => expect(currentPrimaries()).toEqual([]));
  });

  it("narrows to a status through the tab group and keeps the counts honest", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");

    await user.click(screen.getByRole("tab", { name: /Dormant/ }));

    expect(await screen.findByText("Sutera Hospitality Group")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Aurora Manufacturing Sdn Bhd")).not.toBeInTheDocument();
    });
  });

  it("narrows on industry and reports the narrowing as a chip and a count", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    await user.selectOptions(screen.getByLabelText("Industry"), "RETAIL");

    expect(await screen.findByText("Industry:")).toBeInTheDocument();
    expect(screen.getByText("Kenanga Retail Group Berhad")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Sutera Hospitality Group")).not.toBeInTheDocument();
    });
    expect(screen.getByText("1 of 6 shown")).toBeInTheDocument();
  });

  it("sends the search needle to the server read and empties honestly", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    await user.type(screen.getByLabelText("Search"), "Kenanga");

    expect(await screen.findByText("Kenanga Retail Group Berhad")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Aurora Manufacturing Sdn Bhd")).not.toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText("Search"));
    await user.type(screen.getByLabelText("Search"), "Nothing by this name");

    expect(await screen.findByText("No organisation matches this search")).toBeInTheDocument();
  });

  it("reads HRD Corp registration as its employer code, not as a chip", async () => {
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    const table = screen.getByRole("table", { name: "Organisations" });

    /* Registration is a routing fact, so it reads as the code itself. Every
       seeded organisation is registered, which is also why the "Not
       registered" facet is the screen's empty state below. */
    expect(within(table).getByText("HRDC-1908-4417")).toBeInTheDocument();
  });

  it("empties honestly when a facet matches nothing", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    await user.selectOptions(screen.getByLabelText("HRD Corp"), "NOT_REGISTERED");

    expect(await screen.findByText("No organisation matches this search")).toBeInTheDocument();
    expect(screen.getByText("HRD Corp:")).toBeInTheDocument();
  });
});
