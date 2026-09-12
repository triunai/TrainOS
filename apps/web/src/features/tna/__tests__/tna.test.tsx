import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentPrimaries } from "@/shared/components/kit";
import { TnaDetailPage } from "../TnaDetailPage";
import { renderScreen } from "./render-harness";

const ROUTE = "/sales/tna/:tnaId";
const PATH = "/sales/tna/TNA-0042";

const renderTna = () => renderScreen(<TnaDetailPage />, { path: PATH, route: ROUTE });

describe("M05-S02 · TNA detail", () => {
  it("renders each gap with its evidence, its priority and its confidence", async () => {
    renderTna();

    const table = await screen.findByRole("table", { name: "Competency gaps" });

    expect(within(table).getByText("Conflict resolution")).toBeInTheDocument();
    expect(within(table).getByText("Cross-functional communication")).toBeInTheDocument();
    expect(within(table).getByText("Giving corrective feedback")).toBeInTheDocument();

    /* The evidence is the questionnaire answers, named — a gap asserted with no
       question behind it is uncited AI prose, which the pack forbids. */
    expect(within(table).getByText("Q4, Q7")).toBeInTheDocument();
    expect(within(table).getByText("Q12")).toBeInTheDocument();

    expect(within(table).getAllByText("High")).toHaveLength(2);
    expect(within(table).getByText("Medium")).toBeInTheDocument();
  });

  it("ranks the recommendations honestly, including the 22% that does not fit", async () => {
    renderTna();

    expect(await screen.findByText("Leading Through Change")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();

    /* The point of the third card: a ranking that hides what was considered
       and rejected teaches nobody anything. */
    expect(screen.getByText("Data Literacy for Managers")).toBeInTheDocument();
    expect(screen.getByText("22%")).toBeInTheDocument();
    expect(screen.getByText("No gap match; listed for completeness.")).toBeInTheDocument();
  });

  it("renders an absent budget as an absence, never as zero", async () => {
    renderTna();

    await screen.findByText("Leading Through Change");

    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getAllByText("not stated").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("RM 0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("RM 0")).not.toBeInTheDocument();

    /* The third recommendation has no price indication either, and says so
       rather than inventing one. */
    expect(screen.getByText("no price indication")).toBeInTheDocument();
  });

  it("accepts the leading recommendation through the action envelope", async () => {
    const user = userEvent.setup();
    renderTna();

    await screen.findByText("Leading Through Change");

    /* Header primary plus the bordered repeat on the leading card, as drawn. */
    const buttons = screen.getAllByRole("button", { name: "Use recommendation" });
    expect(buttons).toHaveLength(2);
    await waitFor(() => expect(currentPrimaries()).toEqual(["Use recommendation"]));

    await user.click(buttons[0] as HTMLElement);

    expect(await screen.findByText(/· done$/)).toBeInTheDocument();
    expect(screen.getByText(/Drafted from the accepted recommendation/)).toBeInTheDocument();
  });

  it("lists the cited evidence behind the ranking", async () => {
    renderTna();

    await screen.findByText("Leading Through Change");
    expect(screen.getByText("TNA-0042/responses")).toBeInTheDocument();
    expect(screen.getByText("PRG-*/nov-availability")).toBeInTheDocument();
  });
});
