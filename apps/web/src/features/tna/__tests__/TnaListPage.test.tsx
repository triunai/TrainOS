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
    const sent = screen.getByRole("tab", { name: /Sent/ });
    const tabCount = sent.textContent ?? "";

    await user.click(sent);

    await waitFor(() => {
      expect(screen.queryByText("Aurora Manufacturing Sdn Bhd")).not.toBeInTheDocument();
    });

    /* §16b: the count the tab prints is the only one owed here. It used to be
       asserted through the "N of M shown" counter, which said the same number
       one control to the right. */
    expect(sent.textContent).toEqual(tabCount);
    expect(screen.queryByText(/\d+ of \d+ shown/)).toBeNull();
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

  it("puts the TNA status track and the filter controls on ONE row, per brief §10b", async () => {
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");

    const tabs = screen.getByRole("tablist", { name: "TNA status" });
    const filters = screen.getByRole("group", { name: "Filters" });

    /* Not "both exist" — both resolve to the SAME toolbar row. The filter row
       used to be a second band under the track, which is what §10b forbids. */
    const row = tabs.closest("[data-list-toolbar]");
    expect(row).not.toBeNull();
    expect(filters.closest("[data-list-toolbar]")).toBe(row);

    /* §16b: unfiltered, nothing counts anything — the active tab already
       prints the number, and the counter said it again on the same row. */
    expect(screen.queryByText(/\d+ of \d+ shown/)).toBeNull();

    await userEvent.type(screen.getByLabelText("Search"), "Aurora");
    const counter = await screen.findByText(/\d+ of \d+ shown/);
    expect(counter.closest("[data-list-toolbar]")).toBe(row);
  });
});
