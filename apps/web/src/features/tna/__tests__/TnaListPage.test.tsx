import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentPrimaries } from "@/shared/components/kit";
import { TnaListPage } from "../TnaListPage";
import { renderScreen } from "@/test/renderScreen";

const PATH = "/sales/tna";

const renderList = () => renderScreen(<TnaListPage />, { path: PATH, route: PATH });

describe("M05 · needs analysis list", () => {
  it("resolves each client two hops out, rather than printing an opportunity ref", async () => {
    renderList();

    /* TNA → opportunity → organisation. The record screen makes that walk per
       record; the list makes it once through the two shared books. */
    expect(await screen.findByText("Aurora Manufacturing Sdn Bhd")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs analyses", level: 1 })).toBeInTheDocument();
  });

  it("counts the analyses on the header's meta line", async () => {
    renderList();
    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    /* The count line is one string on the header's meta row: "N analyses · M
       complete". The table's own accessible name also says "Needs analyses",
       so the assertion is on the whole line rather than on the word. */
    expect(screen.getByText(/^\d+ analyses · \d+ complete$/)).toBeInTheDocument();
  });

  it("has no solid primary — a TNA starts from its opportunity, not from here", async () => {
    renderList();
    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    await waitFor(() => expect(currentPrimaries()).toEqual([]));
  });

  it("reads a gap count as typography, keeping the row's one colour on the status", async () => {
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    const table = screen.getByRole("table", { name: "Needs analyses" });
    expect(within(table).getAllByText(/high priority|none high/).length).toBeGreaterThan(0);
  });

  it("narrows on the status tab group", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    const before = screen.getByText(/of \d+ shown/).textContent ?? "";

    await user.click(screen.getByRole("tab", { name: /Sent/ }));

    await waitFor(() => {
      expect(screen.queryByText("Aurora Manufacturing Sdn Bhd")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/of \d+ shown/).textContent).not.toEqual(before);
  });

  it("empties honestly when a facet matches nothing", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    await user.type(screen.getByLabelText("Search"), "no client by this name");

    expect(await screen.findByText("No needs analysis matches these filters")).toBeInTheDocument();
  });

  it("carries a row through to its record", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByText("Aurora Manufacturing Sdn Bhd"));

    await waitFor(() => {
      expect(screen.queryByRole("table", { name: "Needs analyses" })).not.toBeInTheDocument();
    });
  });
});
