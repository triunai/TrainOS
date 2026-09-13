import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiModelsScreen } from "../AiModelsScreen";
import { ProviderKeysScreen } from "../ProviderKeysScreen";
import { UsageBudgetsScreen } from "../UsageBudgetsScreen";
import { renderScreen } from "@/test/renderScreen";

/**
 * The §4 "states rendered" for the three §17 settings screens.
 *
 * Every write on these screens is role-gated by the server, and the default
 * fixture principal is a SALES user, so the refusal paths are asserted too:
 * a screen that hides a policy decision behind "something went wrong" has lost
 * the one piece of information the reader needed.
 */

describe("M20-S20 · AI models, tiers and routing", () => {
  it("names its primary action for what it actually does — future runs only", async () => {
    renderScreen(<AiModelsScreen />);
    expect(await screen.findByRole("button", { name: "Apply to future runs" })).toBeInTheDocument();
  });

  it("names the live fallback carrying the degraded tier's traffic", async () => {
    renderScreen(<AiModelsScreen />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/STRONG-2 degraded · fallback active/);
    expect(banner).toHaveTextContent(
      /Gemini 3\.1 Pro is failing with PROVIDER_5XX above threshold/,
    );
    expect(banner).toHaveTextContent(/has run on DEEP THINK since/);
  });

  it("says in the same banner that SPECIAL is paused by its cap", async () => {
    renderScreen(<AiModelsScreen />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/SPECIAL has spent its whole monthly cap/);
  });

  it("renders all nine tiers with their fallback chain, cache strategy and allowed hours", async () => {
    renderScreen(<AiModelsScreen />);
    const table = await screen.findByRole("table", { name: "Model tiers" });
    expect(within(table).getAllByRole("row")).toHaveLength(10); // 9 tiers + the head
    expect(within(table).getByText("STRONG-3 → MID")).toBeInTheDocument();
    expect(within(table).getAllByText("Context · 1h").length).toBeGreaterThan(0);
    expect(
      within(table).getAllByRole("img", { name: /Allowed hours, Malaysia time/ }),
    ).toHaveLength(9);
  });

  it("puts the twelve-row action-to-tier matrix in its own scroll pane", async () => {
    renderScreen(<AiModelsScreen />);
    const matrix = await screen.findByRole("table", { name: "Action type to tier assignment" });
    expect(within(matrix).getAllByRole("row")).toHaveLength(13); // 12 action types + the head
    /* One radio per tier per row, so a row can name exactly one tier. */
    expect(within(matrix).getAllByRole("radio", { name: /^Route Proposal draft to/ })).toHaveLength(
      9,
    );
    /* REPORT.md: the matrix scrolls inside itself and the page banner does not
       scroll with it. */
    const pane = matrix.parentElement as HTMLElement;
    expect(pane.className).toContain("overflow-auto");
    expect(pane.contains(screen.getByRole("alert"))).toBe(false);
  });

  it("stages exactly two edits — the action types routed to the degraded and capped tiers", async () => {
    renderScreen(<AiModelsScreen />);
    expect(await screen.findByText("2 unsaved")).toBeInTheDocument();
    expect(screen.getByText("staged: SPECIAL → STRONG-1")).toBeInTheDocument();
    expect(screen.getByText("staged: STRONG-2 → DEEP THINK")).toBeInTheDocument();
  });

  it("renders the jury as a mode, never as a boolean", async () => {
    renderScreen(<AiModelsScreen />);
    await screen.findByText("Proposal draft");
    expect(screen.getAllByText("Gate").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Sample · 5%$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Escalate · below 0\.[78] confidence$/).length).toBeGreaterThan(0);
  });

  it("clears staged edits without applying them", async () => {
    renderScreen(<AiModelsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Clear edits" }));
    expect(screen.queryByText("2 unsaved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply to future runs" })).toBeDisabled();
  });

  it("says who decides when the server refuses the routing change", async () => {
    renderScreen(<AiModelsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Apply to future runs" }));
    expect(await screen.findByText("Routing was not applied")).toBeInTheDocument();
    expect(screen.getByText(/decided by ADMIN/)).toBeInTheDocument();
  });

  it("applies the routing change when an ADMIN is signed in", async () => {
    renderScreen(<AiModelsScreen />, { actorId: "u_khairul" });
    await userEvent.click(await screen.findByRole("button", { name: "Apply to future runs" }));
    expect(await screen.findByText("Applied to future runs")).toBeInTheDocument();
  });
});

describe("M20-S21 · provider keys, BYOK", () => {
  it("offers Add provider key as its one solid primary", async () => {
    renderScreen(<ProviderKeysScreen />);
    expect(await screen.findByRole("button", { name: "Add provider key" })).toBeInTheDocument();
  });

  it("makes the BYOK claim on the page rather than leaving it to a sales deck", async () => {
    renderScreen(<ProviderKeysScreen />);
    expect(await screen.findByText("Any key works.")).toBeInTheDocument();
    expect(
      screen.getByText(/TrainOS owns the tiers, the fallback chains, the escalation ladders/),
    ).toBeInTheDocument();
  });

  it("names the tier now serving the invalid key's traffic, not just 'invalid'", async () => {
    renderScreen(<ProviderKeysScreen />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/Anthropic direct key is invalid/);
    expect(banner).toHaveTextContent(/STRONG-1 has fallen back to STRONG-2/);
    expect(banner).toHaveTextContent(/still serving traffic/);
  });

  it("shows the key at 90% of its cap and says what happens past it", async () => {
    renderScreen(<ProviderKeysScreen />);
    expect(await screen.findByText(/At 90% of\s+its cap/)).toBeInTheDocument();
  });

  it("shows the expiring key with the days remaining", async () => {
    renderScreen(<ProviderKeysScreen />);
    expect(await screen.findByText(/Expires in 17 days/)).toBeInTheDocument();
  });

  it("renders the embeddings slot as an empty state rather than hiding it", async () => {
    renderScreen(<ProviderKeysScreen />);
    expect(await screen.findByText("No embeddings key")).toBeInTheDocument();
    expect(
      screen.getByText(/fall back to keyword matching until an embeddings key is added/),
    ).toBeInTheDocument();
  });

  it("only ever shows a masked key until a reveal is asked for", async () => {
    renderScreen(<ProviderKeysScreen />);
    expect(await screen.findByText("sk-ant-••••••••••••9a41")).toBeInTheDocument();
    expect(screen.getByText("AIza••••••••••••7c22")).toBeInTheDocument();
  });

  it("treats a reveal as an audited action and refuses it for a non-admin", async () => {
    renderScreen(<ProviderKeysScreen />);
    const cards = await screen.findAllByRole("button", { name: "Reveal key" });
    await userEvent.click(cards[0]!);
    expect(await screen.findByText("The key was not revealed")).toBeInTheDocument();
    expect(screen.getByText(/decided by ADMIN/)).toBeInTheDocument();
  });

  it("reveals once, and says so, for an admin", async () => {
    renderScreen(<ProviderKeysScreen />, { actorId: "u_khairul" });
    const cards = await screen.findAllByRole("button", { name: "Reveal key" });
    await userEvent.click(cards[0]!);
    expect(
      await screen.findByText("Shown once. This reveal has been written to the audit log."),
    ).toBeInTheDocument();
  });

  it("opens the add-key drawer with the residency note shown before the key is saved", async () => {
    renderScreen(<ProviderKeysScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Add provider key" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Data residency · US")).toBeInTheDocument();
    expect(
      within(drawer).getByText(/Any OpenAI-compatible endpoint also works/),
    ).toBeInTheDocument();
  });
});

describe("M20-S16 · usage, cost and budgets", () => {
  it("makes raising the paused cap its primary action", async () => {
    renderScreen(<UsageBudgetsScreen />);
    expect(await screen.findByRole("button", { name: "Raise SPECIAL cap" })).toBeInTheDocument();
  });

  it("says SPECIAL is paused by its cap and what a run requesting it now gets", async () => {
    renderScreen(<UsageBudgetsScreen />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/SPECIAL is paused by its cap/);
    expect(banner).toHaveTextContent(
      /Every run requesting SPECIAL is refused with AGENT_PAUSED and reason BUDGET_CAP/,
    );
  });

  it("says the month-end forecast is still inside the cap", async () => {
    renderScreen(<UsageBudgetsScreen />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/forecast is still inside the overall cap/);
    expect(screen.getByText("illustrative · baseline not yet measured")).toBeInTheDocument();
  });

  it("shows rule extraction at 98% of its cap as a near-cap budget", async () => {
    renderScreen(<UsageBudgetsScreen />);
    const table = await screen.findByRole("table", { name: "Budget caps" });
    /* The scope cell and the budget bar's label both name the budget, so the
       row is found from the first of the two. */
    const row = within(table).getAllByText("Rule change approve")[0]?.closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Near cap")).toBeInTheDocument();
    expect(
      within(row as HTMLElement).getByRole("progressbar", { name: "Rule change approve" }),
    ).toHaveAttribute("aria-valuenow", "98");
  });

  it("drills every breakdown row through to the runs behind it, using the server's own query", async () => {
    renderScreen(<UsageBudgetsScreen />);
    const links = await screen.findAllByRole("link", { name: "runs" });
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAttribute(
      "href",
      "/v1/runs?filter[tier][eq]=SPECIAL&filter[period][eq]=2026-11",
    );
  });

  it("regroups the breakdown by agent", async () => {
    renderScreen(<UsageBudgetsScreen />);
    await screen.findByText("Claude Opus 5");
    await userEvent.click(screen.getByRole("tab", { name: "By agent" }));
    expect(await screen.findByText("Proposal Agent")).toBeInTheDocument();
  });

  it("routes the cap raise to the MD rather than reporting a failure", async () => {
    renderScreen(<UsageBudgetsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Raise SPECIAL cap" }));
    expect(await screen.findByText("The cap was not raised")).toBeInTheDocument();
    expect(screen.getByText(/decided by MD/)).toBeInTheDocument();
  });

  it("raises the cap when the MD is signed in", async () => {
    renderScreen(<UsageBudgetsScreen />, { actorId: "u_lim" });
    await userEvent.click(await screen.findByRole("button", { name: "Raise SPECIAL cap" }));
    expect(await screen.findByText(/SPECIAL cap raised to RM 250/)).toBeInTheDocument();
  });
});
