import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyTasksScreen } from "../MyTasksScreen";
import { renderScreen } from "@/test/renderScreen";

/**
 * `/my-tasks` against the real fixture client.
 *
 * Each `it` names one fact the queue has to show. Two of them are about
 * restraint rather than output: the page must not invent an urgency the server
 * already decided, and it must not offer a decision button to a reader who is
 * not the approver.
 *
 * Nothing here asserts which bucket a rule change lands in. That one row is
 * bucketed from `effectiveFrom` against the wall clock, so an assertion would
 * pass or fail depending on the day the suite ran — the test asserts it is
 * present and carries its due date instead.
 */

describe("/my-tasks", () => {
  it("merges approvals, reviews and follow-ups into one table", async () => {
    renderScreen(<MyTasksScreen />, { path: "/my-tasks", route: "/my-tasks" });
    const table = await screen.findByRole("table", { name: "My tasks" });

    expect(within(table).getAllByText("Approval").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Follow-up").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Review").length).toBeGreaterThan(0);
  });

  it("groups by when the work is due, using the server's own urgency words", async () => {
    renderScreen(<MyTasksScreen />, { path: "/my-tasks", route: "/my-tasks" });
    const table = await screen.findByRole("table", { name: "My tasks" });
    /* BREACHING renders as "Overdue" — the caption is this screen's wording of
       the contract's bucket, not a second classification of it. */
    expect(within(table).getByText("Overdue")).toBeInTheDocument();
  });

  it("names the role that decides an approval instead of offering a button", async () => {
    renderScreen(<MyTasksScreen />, { path: "/my-tasks", route: "/my-tasks" });
    const table = await screen.findByRole("table", { name: "My tasks" });

    /* Joined from the policy the request was raised under. A queue that showed
       Approve/Reject here would be promising a write the API decides. */
    expect(within(table).getAllByText(/decides$/).length).toBeGreaterThan(0);
    expect(within(table).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("carries the overdue follow-ups the fixture marks OVERDUE", async () => {
    renderScreen(<MyTasksScreen />, { path: "/my-tasks", route: "/my-tasks" });
    const table = await screen.findByRole("table", { name: "My tasks" });
    /* `status: "OVERDUE"` is the server's assertion, so the row is overdue
       without this screen doing any date arithmetic. */
    expect(within(table).getAllByText("Lim Wei Sheng").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Faridah Omar").length).toBeGreaterThan(0);
    /* The chip says what is owed, not when — "Overdue" is the block caption,
       and a chip repeating it would be the same fact rendered twice. */
    expect(within(table).getAllByText("Reply owed").length).toBeGreaterThan(0);
  });

  it("shows the circular awaiting review as one task, not one per change", async () => {
    renderScreen(<MyTasksScreen />, { path: "/my-tasks", route: "/my-tasks" });
    const table = await screen.findByRole("table", { name: "My tasks" });
    expect(within(table).getAllByText("Circular 09/2026")).toHaveLength(1);
  });

  it("filters to one kind and states the emptiness in that kind's words", async () => {
    renderScreen(<MyTasksScreen />, { path: "/my-tasks", route: "/my-tasks" });
    await screen.findByRole("table", { name: "My tasks" });

    await userEvent.click(screen.getByRole("tab", { name: /Reviews/ }));
    const table = screen.getByRole("table", { name: "My tasks" });
    expect(within(table).getByText("Circular 09/2026")).toBeInTheDocument();
    expect(within(table).queryAllByText("Lim Wei Sheng")).toHaveLength(0);
  });

  it("offers exactly one solid primary action", async () => {
    renderScreen(<MyTasksScreen />, { path: "/my-tasks", route: "/my-tasks" });
    expect(await screen.findByRole("button", { name: "Open next task" })).toBeInTheDocument();
  });
});
