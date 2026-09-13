import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentPrimaries } from "@/shared/components/kit";
import { EngagementsListPage } from "../EngagementsListPage";
import { renderScreen } from "@/test/renderScreen";

const PATH = "/training/engagements";

const renderList = () =>
  renderScreen(<EngagementsListPage />, { path: PATH, route: PATH, role: "OPS" });

describe("M09 · engagements list", () => {
  it("lists the schedule under one heading, with the count line in the header", async () => {
    renderList();

    expect(await screen.findByText("Leading Through Change")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Engagements", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/engagements/)).toBeInTheDocument();
  });

  it("resolves the client name rather than printing its reference", async () => {
    renderList();

    await screen.findByText("Leading Through Change");
    const table = screen.getByRole("table", { name: "Engagements" });
    expect(within(table).getAllByText(/Aurora Manufacturing Sdn Bhd/).length).toBeGreaterThan(0);
  });

  it("renders the lifecycle chain from the server's steps, labelled from pipeline config", async () => {
    renderList();

    await screen.findByText("Leading Through Change");
    const table = screen.getByRole("table", { name: "Engagements" });

    /* §11a: one focusable image per row whose accessible name enumerates every
       stage. The label text comes from `GET /v1/config/pipelines`, never from
       a list in this repo — CLAUDE.md's standing rule. */
    const chains = within(table).getAllByRole("img");
    expect(chains.length).toBeGreaterThan(0);
    expect(chains[0]).toHaveAttribute("tabindex", "0");
    expect(chains[0].getAttribute("aria-label") ?? "").not.toHaveLength(0);
  });

  it("has no solid primary — the list creates nothing", async () => {
    renderList();
    await screen.findByText("Leading Through Change");
    await waitFor(() => expect(currentPrimaries()).toEqual([]));
  });

  /* This test used to read "…and keeps a shown-of-total count". §16b withdrew
     the count on a tab narrowing: the tab the user just clicked prints its own
     number, so a counter beside it restated the click. What the tab must still
     do is narrow the table, and that is what is asserted now. */
  it("narrows on the status tab group, and counts nothing the tab already says", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Leading Through Change");
    const scheduled = screen.getByRole("tab", { name: /Scheduled/ });
    const tabCount = scheduled.textContent ?? "";

    await user.click(scheduled);

    await waitFor(() => {
      const table = screen.getByRole("table", { name: "Engagements" });
      expect(within(table).queryByText("Leading Through Change")).not.toBeInTheDocument();
    });

    /* The tab kept its own count, and nothing else on the page repeated it. */
    expect(scheduled.textContent).toEqual(tabCount);
    expect(screen.queryByText(/\d+ of \d+ shown/)).toBeNull();
  });

  it("narrows on a free-text search and empties honestly", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Leading Through Change");
    await user.type(screen.getByLabelText("Search"), "no such programme");

    expect(await screen.findByText("No engagement matches these filters")).toBeInTheDocument();
    expect(screen.getByText("Search:")).toBeInTheDocument();
  });

  it("carries a row through to its record", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByText("Leading Through Change"));

    /* The route pattern under test is the list itself, so the assertion is that
       the click navigated away from it rather than what it landed on. */
    await waitFor(() => {
      expect(screen.queryByRole("table", { name: "Engagements" })).not.toBeInTheDocument();
    });
  });

  it("puts the engagement status track and the filter controls on ONE row, per brief §10b", async () => {
    renderList();

    await screen.findByRole("heading", { name: "Engagements", level: 1 });

    const tabs = screen.getByRole("tablist", { name: "Engagement status" });
    const filters = screen.getByRole("group", { name: "Filters" });

    /* Not "both exist" — both resolve to the SAME toolbar row. The filter row
       used to be a second band under the track, which is what §10b forbids. */
    const row = tabs.closest("[data-list-toolbar]");
    expect(row).not.toBeNull();
    expect(filters.closest("[data-list-toolbar]")).toBe(row);

    /* §16b: unfiltered, nothing counts anything — the active tab already
       prints the number, and the counter said it again on the same row. */
    expect(screen.queryByText(/\d+ of \d+ shown/)).toBeNull();

    /* Narrow it and the count comes back, inside the same row. */
    await userEvent.type(screen.getByLabelText("Search"), "Aurora");
    const counter = await screen.findByText(/\d+ of \d+ shown/);
    expect(counter.closest("[data-list-toolbar]")).toBe(row);
  });
});
