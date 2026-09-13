import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentRegistryScreen } from "../AgentRegistryScreen";
import { RunTraceScreen } from "../RunTraceScreen";
import { renderScreen } from "@/test/renderScreen";

/**
 * The §4 "states rendered" for M18-S01 and M18-S04, asserted against the real
 * fixture client rather than a hand-made stub.
 *
 * Each `it` names one fact the design pack requires the screen to show, so a
 * failure says which requirement regressed rather than "the screen changed".
 */

describe("M18-S01 · agent registry", () => {
  it("offers exactly one solid primary action: Register agent", async () => {
    renderScreen(<AgentRegistryScreen />);
    expect(await screen.findByRole("button", { name: "Register agent" })).toBeInTheDocument();
  });

  it("states why the Knowledge Agent is paused AND what would let it resume", async () => {
    renderScreen(<AgentRegistryScreen />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/Knowledge Agent paused since/i);
    /* The reason alone is an outage report; the resume condition is what makes
       it a control. §4 asks for both. */
    expect(banner).toHaveTextContent(/Eval regression/i);
    expect(banner).toHaveTextContent(/Resume requires evalScore at or above 0.85/i);
  });

  it("renders autonomy per action type, not one chip per agent", async () => {
    renderScreen(<AgentRegistryScreen />);
    const table = await screen.findByRole("table", { name: "Agent registry" });
    /* The Proposal Agent holds three different grants at three different rungs;
       a single chip for the row would hide exactly the fact this page exists
       to show. */
    expect(within(table).getByText("Proposal draft")).toBeInTheDocument();
    expect(within(table).getByText("Proposal send")).toBeInTheDocument();
    expect(within(table).getAllByText("Autonomous").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Act w/ approval").length).toBeGreaterThan(0);
  });

  it("names the ceiling and its reason on a money-moving action type", async () => {
    renderScreen(<AgentRegistryScreen />);
    const table = await screen.findByRole("table", { name: "Agent registry" });
    expect(
      within(table).getAllByText(/ceiling act with approval · money moving/i).length,
    ).toBeGreaterThan(0);
  });

  it("shows the default tier, the jury, 30-day cache hit and cost per run", async () => {
    renderScreen(<AgentRegistryScreen />);
    const table = await screen.findByRole("table", { name: "Agent registry" });
    expect(within(table).getAllByText("STRONG-1").length).toBeGreaterThan(0);
    /* A configured jury is never "No jury": ESCALATE is the tinted "Jury 2 of
       3" because it can block, GATE runs at promotion time and SAMPLE runs
       after the human decides, and the column says which. */
    expect(within(table).getAllByText(/Jury 2 of 3/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Jury at promotion").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Jury sampled").length).toBeGreaterThan(0);
    expect(within(table).queryByText("No jury")).not.toBeInTheDocument();
    /* Lead Agent: cacheHitRate30d 0.71, costPerRun30d RM 0.01. */
    expect(within(table).getAllByText("71%").length).toBeGreaterThan(0);
  });

  it("pulls a kill switch through pauseAgent and reflects the paused agent", async () => {
    renderScreen(<AgentRegistryScreen />);
    const table = await screen.findByRole("table", { name: "Agent registry" });
    const killSwitch = within(table).getByRole("switch", { name: "Kill switch for Lead Agent" });
    expect(killSwitch).toHaveAttribute("data-state", "unchecked");

    await userEvent.click(killSwitch);

    expect(
      await within(table).findByRole("switch", { name: "Kill switch for Lead Agent" }),
    ).toHaveAttribute("data-state", "checked");
  });

  it("filters to the agents that need attention", async () => {
    renderScreen(<AgentRegistryScreen />);
    await screen.findByRole("table", { name: "Agent registry" });
    await userEvent.click(screen.getByRole("tab", { name: /Needs attention/ }));

    const table = screen.getByRole("table", { name: "Agent registry" });
    expect(within(table).getByText("Knowledge Agent")).toBeInTheDocument();
    expect(within(table).queryByText("Match Agent")).not.toBeInTheDocument();
  });
});

describe("M18-S04 · run trace viewer", () => {
  const at = { path: "/automation/runs/run_4821", route: "/automation/runs/:runRef" };

  it("makes the approval the primary action on a halted run", async () => {
    renderScreen(<RunTraceScreen />, at);
    expect(
      await screen.findByRole("button", { name: "Open approval APV-2026-0771" }),
    ).toBeInTheDocument();
  });

  it("says the agent never sent anything, and proves it with the policy halt", async () => {
    renderScreen(<RunTraceScreen />, at);
    const banner = await screen.findByText("The agent never sent anything");
    expect(banner).toBeInTheDocument();
    expect(banner.parentElement).toHaveTextContent(/Policy APV-01 stopped the run before the send/);
    expect(banner.parentElement).toHaveTextContent(/APV-2026-0771/);
  });

  it("renders the execution tree orchestrator → Reader, Matcher, Drafter, Verifier", async () => {
    renderScreen(<RunTraceScreen />, at);
    const tree = await screen.findByRole("tree", { name: "Execution tree" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Orchestrator"),
      expect.stringContaining("Reader"),
      expect.stringContaining("Matcher"),
      expect.stringContaining("Drafter"),
      expect.stringContaining("Verifier"),
      expect.stringContaining("send_proposal"),
    ]);
    /* Depth is derived from parentId: the orchestrator is level 1 and every
       sub-agent hangs off it at level 2. */
    expect(items[0]).toHaveAttribute("aria-level", "1");
    expect(items[1]).toHaveAttribute("aria-level", "2");
  });

  it("gives every node its tier, model, cache hit, tokens and cost", async () => {
    renderScreen(<RunTraceScreen />, at);
    const table = await screen.findByRole("table", { name: "Per-node model and spend" });
    /* Drafter and Verifier both ran on STRONG-1, so the model name is on two rows. */
    expect(within(table).getAllByText("Claude Sonnet 5")).toHaveLength(2);
    expect(within(table).getAllByText("Anthropic").length).toBeGreaterThan(0);
    expect(within(table).getByText("82%")).toBeInTheDocument();
    expect(within(table).getByText("4,700")).toBeInTheDocument();
  });

  it("expands a tool call to its arguments and result", async () => {
    renderScreen(<RunTraceScreen />, at);
    const step = await screen.findByRole("button", { name: /read_tna succeeded/ });
    expect(step).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(step);
    expect(step).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("renders an event row for the escalation, jury, truncation, handoff and policy halt", async () => {
    renderScreen(<RunTraceScreen />, at);
    expect(await screen.findByText("Escalated FAST → MID")).toBeInTheDocument();
    expect(screen.getByText("Jury: 2 of 3 agree")).toBeInTheDocument();
    expect(screen.getByText("Truncated fetch_rate_card")).toBeInTheDocument();
    expect(screen.getByText("Context handoff — restarted from the state card")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint written at step 4")).toBeInTheDocument();
    expect(screen.getByText("Halted by policy APV-01")).toBeInTheDocument();
    /* The dissent is named, not hidden: a 2-of-3 one model argued against is a
       different fact from a unanimous verdict. */
    expect(screen.getByText(/GPT-5.6 Terra dissented/)).toBeInTheDocument();
  });

  it("renders the state card with its goal, plan, decisions, constraints, open questions and both budgets", async () => {
    renderScreen(<RunTraceScreen />, at);
    const card = await screen.findByRole("complementary", { name: "Run state card" });
    expect(within(card).getByText(/Draft and send a proposal for OPP-0512/)).toBeInTheDocument();
    expect(within(card).getByText("Rank programmes")).toBeInTheDocument();
    expect(within(card).getByText(/PRG-0031 over PRG-0018/)).toBeInTheDocument();
    expect(within(card).getByText("November delivery")).toBeInTheDocument();
    expect(within(card).getByText(/Section 5 HRDC wording unverified/)).toBeInTheDocument();
    expect(within(card).getAllByRole("progressbar")).toHaveLength(2);
  });

  it("shows the failed run in the rail with its dead-letter state and a retry from checkpoint", async () => {
    renderScreen(<RunTraceScreen />, at);
    /* Once in the rail row's status column, once on the failed run card. */
    expect((await screen.findAllByText("WA_TEMPLATE_REJECTED")).length).toBeGreaterThan(0);
    expect(screen.getByText(/dead-lettered/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry from checkpoint" })).toBeInTheDocument();
  });

  it("resumes a failed run from its checkpoint", async () => {
    renderScreen(<RunTraceScreen />, at);
    await userEvent.click(await screen.findByRole("button", { name: "Retry from checkpoint" }));
    expect(await screen.findByText(/^Resumed as #/)).toBeInTheDocument();
  });

  it("falls back to the newest run that actually has a trace when none is named", async () => {
    renderScreen(<RunTraceScreen />, { path: "/automation/runs", route: "/automation/runs" });
    /* run_4930 is newer but single-node; the viewer picks the newest run it can
       actually draw a tree for rather than opening on an empty pane. */
    expect(await screen.findByRole("tree", { name: "Execution tree" })).toBeInTheDocument();
    expect(screen.getByText(/^Run #4821/)).toBeInTheDocument();
  });
});
