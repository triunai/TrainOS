import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Engagement } from "@trainos/contract";
import { AssessmentsScreen } from "../AssessmentsScreen";
import { assessmentRows, countByState, evaluationStateOf } from "../evaluations";
import { ASSESSMENTS_PATH } from "../paths";
import { currentPrimaries } from "@/shared/components/kit";
import { renderScreen } from "@/test/renderScreen";

const engagement = (overrides: Partial<Engagement> = {}): Engagement =>
  ({
    ref: "ENG-0001",
    organisationRef: "ORG-0114",
    programmeRef: "PRG-0031",
    title: "A delivery",
    status: "DELIVERED",
    dates: ["2026-11-12", "2026-11-13"],
    checklist: [{ key: "EVALUATION_SUMMARY", label: "Evaluation summary compiled", done: false }],
    metrics: { participants: 30, attended: 28, attendanceRate: 0.93 },
    ...overrides,
  }) as unknown as Engagement;

const render = () =>
  renderScreen(<AssessmentsScreen />, {
    path: ASSESSMENTS_PATH,
    route: ASSESSMENTS_PATH,
    role: "OPS",
  });

describe("the evaluation state", () => {
  it("reads a ticked checklist item as compiled", () => {
    const done = engagement({
      checklist: [{ key: "EVALUATION_SUMMARY", label: "Evaluation summary", done: true }],
    });
    expect(evaluationStateOf(done, "2026-11-14")).toBe("COMPILED");
  });

  it("owes nothing until the last delivery day has passed", () => {
    expect(evaluationStateOf(engagement(), "2026-11-12")).toBe("NOT_DUE");
    expect(evaluationStateOf(engagement(), "2026-11-13")).toBe("OUTSTANDING");
  });

  it("distinguishes an ABSENT checklist item from an unticked one", () => {
    /* The defect this pins: collapsing the two reports a delivery nobody has
       set up for evaluation as merely overdue, and sends Operations chasing a
       box that does not exist. */
    expect(evaluationStateOf(engagement({ checklist: [] }), "2026-11-14")).toBe("UNTRACKED");
    expect(evaluationStateOf(engagement(), "2026-11-14")).toBe("OUTSTANDING");
  });

  it("owes nothing for a delivery that never happened", () => {
    expect(evaluationStateOf(engagement({ status: "CANCELLED" }), "2026-11-14")).toBe("NOT_DUE");
  });

  it("puts what is owed at the top, newest delivery first", () => {
    const rows = assessmentRows(
      [
        engagement({
          ref: "ENG-DONE",
          checklist: [{ key: "EVALUATION_SUMMARY", label: "x", done: true }],
        }),
        engagement({ ref: "ENG-OLD", dates: ["2026-05-20"] }),
        engagement({ ref: "ENG-NEW" }),
        engagement({ ref: "ENG-GAP", checklist: [] }),
      ],
      "2026-11-14",
    );

    expect(rows.map((row) => row.engagementRef)).toEqual([
      "ENG-GAP",
      "ENG-NEW",
      "ENG-OLD",
      "ENG-DONE",
    ]);
  });

  it("counts every state, including the ones with no rows", () => {
    expect(countByState(assessmentRows([engagement()], "2026-11-14"))).toEqual({
      COMPILED: 0,
      OUTSTANDING: 1,
      NOT_DUE: 0,
      UNTRACKED: 0,
    });
  });
});

describe("the assessments register", () => {
  it("lands on a tab with rows in it, and names the deliveries", async () => {
    render();

    /* The seed owes nothing, so the opening tab is All rather than an empty
       Owed — an empty default tab reads as a broken screen. */
    await screen.findByRole("tab", { name: /^Owed/ });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getAllByText(/Leading Through Change/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Compiled").length).toBeGreaterThan(0);
  });

  it("says every evaluation is in rather than showing a blank Owed tab", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("tab", { name: /^Owed/ });
    await user.click(screen.getByRole("tab", { name: /^Owed/ }));

    expect(await screen.findByText("Every evaluation is in")).toBeInTheDocument();
  });

  it("opens the drawer with the state's explanation and the programme benchmark", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("tab", { name: /^Owed/ });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
    });
    const table = screen.getByRole("table", { name: "Assessments" });
    const [firstRow] = within(table).getAllByRole("row").slice(1);
    await user.click(firstRow as HTMLElement);

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Programme benchmark")).toBeInTheDocument();
    expect(within(drawer).getByText("Open the engagement")).toBeInTheDocument();
  });

  it("narrows by search and says so when nothing matches", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("tab", { name: /^Owed/ });
    await user.type(screen.getByLabelText("Search deliveries"), "no such delivery");

    expect(await screen.findByText("No delivery matches this search")).toBeInTheDocument();
  });

  it("claims no solid primary — compiling a summary is not an action this API offers", async () => {
    render();
    await screen.findByRole("tab", { name: /^Owed/ });

    await waitFor(() => {
      expect(currentPrimaries()).toHaveLength(0);
    });
  });
});
