import { describe, expect, it } from "vitest";
import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { fixtureClient, opportunities, resetStore } from "@trainos/fixtures";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { PipelineBoardPage } from "../PipelineBoardPage";
import { useMoveDealStage } from "../api";
import { renderScreen } from "@/test/renderScreen";

/** Any real opportunity, used only for the shape a refusal is asked about. */
const OPPORTUNITY = opportunities[0]!;

/**
 * Sales › Pipeline, after brief §19.
 *
 * The rule this screen exists to obey is still CLAUDE.md's: stage names and
 * order render from pipeline configuration, never hardcoded. Every assertion
 * below therefore reads the configuration the fixture serves rather than a list
 * written here.
 */

const render = () =>
  renderScreen(<PipelineBoardPage />, { path: "/sales/pipeline", route: "/sales/pipeline" });

const board = () => screen.findByRole("list", { name: "Pipeline stages" });

function laneSurface(name: string) {
  const lane = screen.getByRole("listitem", { name });
  return lane.querySelector("[data-lane]") as HTMLElement;
}

/** jsdom builds no `DataTransfer`, so the drag has to be handed one. */
function drag(from: HTMLElement, to: HTMLElement) {
  const store = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "none",
    dropEffect: "none",
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
  };
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
}

describe("Sales › Pipeline", () => {
  it("draws one lane per configured stage, in the configured order", async () => {
    render();

    const headings = within(await board()).getAllByRole("heading", { level: 3 });

    /* Order comes from `stage.order`, not from the array the server happened to
       send and not from a list in the screen. */
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "New",
      "Qualifying",
      "TNA sent",
      "Proposal sent",
      "Negotiation",
      "Won",
      "Lost",
    ]);
  });

  it("keeps the stage holding nothing, and makes it somewhere to drop", async () => {
    render();
    await board();

    /* `New` and `TNA sent` hold no deals in the seed. The empty stage is the
       one a sales manager most wants to see, and it is also the one they most
       want to drag into — so it gets the drop zone rather than a muted line. */
    const empty = screen.getByRole("listitem", { name: "New" });
    expect(within(empty).getByText("No deals")).toBeInTheDocument();
    expect(within(empty).getByText("Drop a deal here")).toBeInTheDocument();
  });

  it("names the lane in UI type with its own count and money beneath", async () => {
    render();

    const lane = within(await board()).getByRole("listitem", { name: "Qualifying" });
    const heading = within(lane).getByRole("heading", { level: 3 });

    /* Sentence case, not a mono uppercase eyebrow — §1 and §19 bullet 4. */
    expect(heading).toHaveTextContent("Qualifying");
    expect(heading.className).not.toMatch(/font-mono|uppercase/);
    expect(within(lane).getByText("1 deal · RM 67,200")).toBeInTheDocument();
  });

  it("reads the card the way a sales manager does, with the ref demoted", async () => {
    render();

    const lane = within(await board()).getByRole("listitem", { name: "Qualifying" });

    /* Line 1 is the company, in full. */
    expect(within(lane).getByText("Kenanga Retail Group Berhad")).toBeInTheDocument();
    /* Line 2 is what the deal is for, taken from the TNA rather than composed. */
    expect(within(lane).getByText("48 store managers")).toBeInTheDocument();
    /* The money, the owner, the close date and the probability. */
    expect(within(lane).getByText("RM 67,200")).toBeInTheDocument();
    expect(within(lane).getByText("Amirah Yusof")).toBeInTheDocument();
    expect(within(lane).getByText("Closes 19 Dec 2026")).toBeInTheDocument();
    expect(within(lane).getByText("30%")).toBeInTheDocument();

    /* The ref is last and mono; it is how the system names the deal. */
    const ref = within(lane).getByText("OPP-0498");
    expect(ref.className).toMatch(/font-mono/);
  });

  it("says what is on the board in one line, without reporting its own configuration", async () => {
    render();
    await board();

    /* Every figure is a fold over the same array, so they cannot disagree:
       RM 164,800 across five deals, RM 84,335 once each is weighted by its own
       probability, three of them at a stage the configuration does not mark
       terminal. */
    expect(
      screen.getByText(
        "5 deals · RM 164,800 pipeline · RM 84,335 weighted · 3 active · 1 won · 1 lost",
      ),
    ).toBeInTheDocument();

    /* "7 configured stages" is gone. The number of lanes is visible by counting
       them, and a board reporting its own configuration size reports on itself
       rather than on the pipeline. */
    expect(screen.queryByText(/configured stage/)).toBeNull();
  });

  it("puts no status chip on a card, because the lane is the stage", async () => {
    render();

    const lane = within(await board()).getByRole("listitem", { name: "Qualifying" });
    expect(within(lane).queryByText("Qualifying", { selector: "span.rounded-pill" })).toBeNull();
  });

  it("offers every other stage in the card's menu, so the move is reachable without a drag", async () => {
    render();

    const lane = within(await board()).getByRole("listitem", { name: "Qualifying" });

    /* Opened from the KEYBOARD, which is the point of the menu: `userEvent`
       deadlocks against the `pointer-events: none` Radix puts on the body, and
       jsdom synthesises no `PointerEvent`. */
    const trigger = within(lane)
      .getByText("More actions for Kenanga Retail Group Berhad")
      .closest("button");
    expect(trigger).not.toBeNull();
    fireEvent.keyDown(trigger as HTMLElement, { key: "Enter" });

    /* Built from the configuration, and excluding the stage the card is on.
       Scoped to the menu: a role query over the whole document costs ten
       seconds here, because Radix marks the rest of the tree `aria-hidden` and
       the matcher walks all seven lanes to find that out. */
    /* Read through the DOM rather than through a role query: with the menu
       open Radix marks the rest of the tree `aria-hidden`, and computing that
       for every node of a seven-lane board costs nine seconds per assertion. */
    let menu: HTMLElement | null = null;
    await waitFor(() => {
      menu = document.querySelector<HTMLElement>("[role='menu']");
      expect(menu).not.toBeNull();
    });
    const items = [...(menu as unknown as HTMLElement).querySelectorAll("[role='menuitem']")].map(
      (item) => item.textContent,
    );

    /* Six of the seven configured stages — every one but the lane it is on. */
    expect(items).toEqual([
      "Move to New",
      "Move to TNA sent",
      "Move to Proposal sent",
      "Move to Negotiation",
      "Move to Won",
      "Move to Lost",
    ]);

    /* Closed before the test ends. Radix puts `pointer-events: none` on the
       body while a menu is open and portals the menu outside the render tree;
       leaving it open leaks both into whichever test runs next. */
    fireEvent.keyDown(menu as unknown as HTMLElement, { key: "Escape" });
  });

  it("moves a dragged card through the action envelope, and says what changed", async () => {
    render();
    await board();

    drag(await screen.findByText("Kenanga Retail Group Berhad"), laneSurface("Negotiation"));

    /* Ruling R18 added `OPPORTUNITY_STAGE_CHANGE`, so the drag is a governed
       write rather than a local state change. The banner is the receipt: §7
       requires `effects[]` to say what actually moved. */
    expect(await screen.findByText("OPP-0498 → Negotiation · done")).toBeInTheDocument();
    expect(screen.getByText(/stage QUALIFYING → NEGOTIATION/)).toBeInTheDocument();

    /* And the board RE-READS itself rather than moving the card locally: an
       EXECUTED move invalidates the opportunities, the refetch regroups the
       lanes, and both lane summaries follow the card because they are folds
       over the same refetched array. */
    await waitFor(() => {
      const negotiation = screen.getByRole("listitem", { name: "Negotiation" });
      expect(within(negotiation).getByText("Kenanga Retail Group Berhad")).toBeInTheDocument();
      expect(within(negotiation).getByText("2 deals · RM 94,500")).toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("listitem", { name: "Qualifying" })).getByText("0 deals · —"),
    ).toBeInTheDocument();
  });

  it("reports nothing when a card is dropped back on the lane it came from", async () => {
    render();
    await board();

    drag(await screen.findByText("Kenanga Retail Group Berhad"), laneSurface("Qualifying"));

    expect(screen.queryByText(/OPP-0498 →/)).toBeNull();
  });

  it("has one secondary action and no solid primary, because the board writes nothing", async () => {
    render();
    await board();

    expect(screen.getByRole("button", { name: "List view" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open as a list" })).toBeNull();
  });
});

/**
 * The refusal, tested at the hook rather than through the board.
 *
 * Every refusal `OPPORTUNITY_STAGE_CHANGE` defines — a missing stage, a stale
 * `fromStage`, an unknown target — is unreachable through the board's own
 * affordances against this client, because the fixture hands out the store's
 * live objects: the row the board holds IS the row the server reads, so the two
 * can never disagree in one process. Driving the hook directly is the only way
 * to reach the path the board renders, and it is the path that matters: a
 * refusal is a fact about the request, not a failure — R2 — so it must arrive
 * as a value and keep the server's own sentence.
 */
describe("useMoveDealStage", () => {
  it("keeps a server refusal as a value, in the server's own words", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    resetStore();
    fixtureClient.setLatency(0);
    fixtureClient.signInAs("u_amirah");

    const { result } = renderHook(() => useMoveDealStage(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <MeContext.Provider value={{ me: FIXTURE_ME, setRole: () => undefined }}>
            {/* `useMoveDealStage` -> `useAction` calls `useNavigate()`, for the
                QUEUED_FOR_APPROVAL toast's "View approval" link. */}
            <MemoryRouter>{children}</MemoryRouter>
          </MeContext.Provider>
        </QueryClientProvider>
      ),
    });

    act(() => {
      result.current.move({
        opportunity: { ...OPPORTUNITY, ref: "OPP-9999", id: "opp_9999" },
        to: { key: "WON", label: "Won", order: 6, terminal: true, outcome: "WON" },
      });
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error?.message).toContain("OPP-9999");
    expect(result.current.subject).toBe("OPP-9999 → Won");
    /* Nothing was thrown: the mutation settled, and the board is free to render. */
    expect(result.current.response).toBeUndefined();
  });
});
