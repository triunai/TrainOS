import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { KanbanBoard, type KanbanLane } from "../KanbanBoard";
import { lanesFrom } from "../board";

/**
 * The kit's one board. Brief §19.
 *
 * The three things a screen depends on and cannot check for itself: the lane is
 * a drop target whether or not it holds anything, a drop reports the move it
 * actually was, and a drop back where it started reports nothing.
 */

interface Deal {
  ref: string;
  name: string;
}

const DEALS: Record<string, Deal[]> = {
  qualifying: [{ ref: "OPP-1", name: "Kenanga Retail Group Berhad" }],
  won: [{ ref: "OPP-2", name: "Aurora Manufacturing Sdn Bhd" }],
};

function lanes(): KanbanLane<Deal>[] {
  return [
    { id: "new", label: "New", summary: "0 deals", items: [] },
    {
      id: "qualifying",
      label: "Qualifying",
      summary: "1 deal · RM 67,200",
      items: DEALS.qualifying ?? [],
    },
    {
      id: "won",
      label: "Won",
      summary: "1 deal · RM 18,500",
      items: DEALS.won ?? [],
      collapsible: true,
    },
  ];
}

/** jsdom builds no `DataTransfer`, so the drag has to be handed one. */
function transfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
  };
}

function drag(from: HTMLElement, to: HTMLElement) {
  const dataTransfer = transfer();
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
}

function laneSurface(name: string) {
  const lane = screen.getByRole("listitem", { name });
  const surface = lane.querySelector("[data-lane]");
  expect(surface).not.toBeNull();
  return surface as HTMLElement;
}

function board(props: Partial<Parameters<typeof KanbanBoard<Deal>>[0]> = {}) {
  return render(
    <KanbanBoard<Deal>
      label="Pipeline stages"
      lanes={lanes()}
      itemKey={(deal) => deal.ref}
      renderItem={(deal) => <span>{deal.name}</span>}
      emptyLabel="No deals"
      emptyHint="Drop a deal here"
      {...props}
    />,
  );
}

describe("KanbanBoard", () => {
  it("draws one lane per lane given, in the order given", () => {
    board();

    const lanesRendered = within(
      screen.getByRole("list", { name: "Pipeline stages" }),
    ).getAllByRole("heading", { level: 3 });
    expect(lanesRendered.map((heading) => heading.textContent)).toEqual([
      "New",
      "Qualifying",
      "Won",
    ]);
  });

  it("gives the empty lane a drop zone rather than hiding it", () => {
    board({ onMove: vi.fn() });

    const empty = screen.getByRole("listitem", { name: "New" });
    expect(within(empty).getByText("No deals")).toBeInTheDocument();
    expect(within(empty).getByText("Drop a deal here")).toBeInTheDocument();
  });

  it("omits the drop hint when the board cannot accept one", () => {
    /* No `onMove`, so there is nowhere to drop. A dashed box promising a drop
       that does nothing is worse than no box. */
    board();

    const empty = screen.getByRole("listitem", { name: "New" });
    expect(within(empty).getByText("No deals")).toBeInTheDocument();
    expect(within(empty).queryByText("Drop a deal here")).toBeNull();
  });

  it("reports the card, the lane it left and the lane it landed in", () => {
    const onMove = vi.fn();
    board({ onMove });

    drag(screen.getByText("Kenanga Retail Group Berhad"), laneSurface("New"));

    expect(onMove).toHaveBeenCalledWith("OPP-1", "qualifying", "new");
  });

  it("reports nothing when a card is dropped back on its own lane", () => {
    const onMove = vi.fn();
    board({ onMove });

    drag(screen.getByText("Kenanga Retail Group Berhad"), laneSurface("Qualifying"));

    expect(onMove).not.toHaveBeenCalled();
  });

  it("collapses a terminal lane to a rail that still says how many it holds", () => {
    board();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Won" }));

    const rail = screen.getByRole("listitem", { name: "Won" });
    /* The card is gone from the rail; the count is not. */
    expect(within(rail).queryByText("Aurora Manufacturing Sdn Bhd")).toBeNull();
    expect(within(rail).getByText("1")).toBeInTheDocument();

    fireEvent.click(within(rail).getByRole("button"));
    expect(screen.getByText("Aurora Manufacturing Sdn Bhd")).toBeInTheDocument();
  });
});

describe("lanesFrom", () => {
  it("orders by the configuration's own order, not by the array it arrived in", () => {
    const stages = [
      { key: "b", label: "Second", order: 2 },
      { key: "a", label: "First", order: 1 },
    ];
    const grouped = lanesFrom(stages, [{ stage: "b" }, { stage: "a" }], (item) => item.stage);

    expect(grouped.map((lane) => lane.stage.key)).toEqual(["a", "b"]);
  });

  it("keeps a stage holding nothing", () => {
    const stages = [
      { key: "a", label: "First", order: 1 },
      { key: "b", label: "Second", order: 2 },
    ];
    const grouped = lanesFrom(stages, [{ stage: "a" }], (item) => item.stage);

    expect(grouped).toHaveLength(2);
    expect(grouped[1]?.items).toEqual([]);
  });

  it("drops nothing silently — an unknown stage lands in no lane, so a caller can count the difference", () => {
    const stages = [{ key: "a", label: "First", order: 1 }];
    const grouped = lanesFrom(stages, [{ stage: "a" }, { stage: "ghost" }], (item) => item.stage);

    expect(grouped[0]?.items).toHaveLength(1);
    expect(grouped.reduce((total, lane) => total + lane.items.length, 0)).toBe(1);
  });
});
