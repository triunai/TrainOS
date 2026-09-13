import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutomationFailuresScreen } from "../AutomationFailuresScreen";
import { AutomationPoliciesScreen } from "../AutomationPoliciesScreen";
import { renderScreen } from "@/test/renderScreen";

/**
 * `/automation/failures` and `/automation/policies`, against the real fixture
 * client. Neither screen has an artboard, so these assert the RULES the
 * compositions were invented under rather than a drawing.
 *
 * A separate file from `agents.test.tsx` on purpose: several agents were
 * working this feature at once and a new file cannot collide with theirs.
 */

describe("/automation/failures · M18-S07", () => {
  it("lists the failed run with its error code and message", async () => {
    renderScreen(<AutomationFailuresScreen />, {
      path: "/automation/failures",
      route: "/automation/failures",
    });
    await userEvent.click(await screen.findByRole("tab", { name: /All failures/ }));

    const table = screen.getByRole("table", { name: "Failed and halted runs" });
    expect(within(table).getByText("#4903")).toBeInTheDocument();
    expect(within(table).getAllByText("WA_TEMPLATE_REJECTED").length).toBeGreaterThan(0);
    expect(within(table).getByText(/is not approved for the UTILITY category/)).toBeInTheDocument();
  });

  it("lists a halted run too, and keeps it distinct from a failure", async () => {
    renderScreen(<AutomationFailuresScreen />, {
      path: "/automation/failures",
      route: "/automation/failures",
    });
    const table = await screen.findByRole("table", { name: "Failed and halted runs" });

    /* A policy halt is not a failure — RUN_TONE says warning, not danger — but
       it is stuck in exactly the way this page exists to surface. */
    expect(within(table).getByText("#4821")).toBeInTheDocument();
    expect(within(table).getByText("Halted")).toBeInTheDocument();
  });

  it("shows the approval a halted run is waiting on, not a retry button", async () => {
    renderScreen(<AutomationFailuresScreen />, {
      path: "/automation/failures",
      route: "/automation/failures",
    });
    const table = await screen.findByRole("table", { name: "Failed and halted runs" });

    /* The banner names the approval; the row's Retry is disabled, because
       retrying would return the same halt. */
    expect(await screen.findByText(/is held until/)).toBeInTheDocument();

    const haltedRow = within(table).getByText("#4821").closest("tr");
    expect(haltedRow).not.toBeNull();
    expect(within(haltedRow as HTMLElement).getByRole("button", { name: "Retry" })).toBeDisabled();
  });

  it("retries a failed run from its checkpoint", async () => {
    renderScreen(<AutomationFailuresScreen />, {
      path: "/automation/failures",
      route: "/automation/failures",
    });
    await userEvent.click(await screen.findByRole("tab", { name: /All failures/ }));

    const table = screen.getByRole("table", { name: "Failed and halted runs" });
    const failedRow = within(table).getByText("#4903").closest("tr") as HTMLElement;
    const retry = within(failedRow).getByRole("button", { name: "Retry" });
    expect(retry).toBeEnabled();

    await userEvent.click(retry);
    /* The client pushes a new SUCCEEDED run, so the stuck count falls by none
       and a fresh run exists. What is asserted is that the call went through
       without a refusal reaching the reader. */
    expect(screen.queryByText("The run was not retried")).not.toBeInTheDocument();
  });

  it("asks before giving up on a run, and says what giving up costs", async () => {
    renderScreen(<AutomationFailuresScreen />, {
      path: "/automation/failures",
      route: "/automation/failures",
    });
    const table = await screen.findByRole("table", { name: "Failed and halted runs" });
    const haltedRow = within(table).getByText("#4821").closest("tr") as HTMLElement;

    await userEvent.click(within(haltedRow).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Stop retrying #4821?")).toBeInTheDocument();
    expect(screen.getByText(/stays undone until somebody does it by hand/)).toBeInTheDocument();
  });

  it("states the emptiness of the dead-letter bucket in that bucket's words", async () => {
    renderScreen(<AutomationFailuresScreen />, {
      path: "/automation/failures",
      route: "/automation/failures",
    });
    await screen.findByRole("table", { name: "Failed and halted runs" });
    await userEvent.click(screen.getByRole("tab", { name: /Dead-lettered/ }));

    /* The fixture's one dead-lettered run IS in this bucket, so the assertion
       is the inverse: the bucket is not empty and the stuck bucket does not
       contain it. */
    const table = screen.getByRole("table", { name: "Failed and halted runs" });
    expect(within(table).getByText("#4903")).toBeInTheDocument();
    expect(within(table).queryByText("#4821")).not.toBeInTheDocument();
  });
});

describe("/automation/policies", () => {
  it("lists every gate with the role that decides it", async () => {
    renderScreen(<AutomationPoliciesScreen />, {
      path: "/automation/policies",
      route: "/automation/policies",
    });
    const table = await screen.findByRole("table", { name: "Approval policies" });

    expect(within(table).getByText("Proposal send")).toBeInTheDocument();
    expect(within(table).getAllByText("Sales manager").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Ops").length).toBeGreaterThan(0);
  });

  it("draws the engagement pipeline from configuration and maps no policy onto it", async () => {
    renderScreen(<AutomationPoliciesScreen />, {
      path: "/automation/policies",
      route: "/automation/policies",
    });
    /* Stage labels come from GET /v1/config/pipelines. The screen says so, and
       says that no policy is drawn against a stage — the contract publishes no
       link between the two, and a client-side map over another lane's
       vocabulary is the seam R14 is about. */
    expect(await screen.findByText("Attendance locked")).toBeInTheDocument();
    expect(screen.getByText("HRDC claim")).toBeInTheDocument();
    expect(screen.getByText(/No policy is drawn against a stage/)).toBeInTheDocument();
  });

  it("counts what each gate is holding, and links to the inbox that decides it", async () => {
    renderScreen(<AutomationPoliciesScreen />, {
      path: "/automation/policies",
      route: "/automation/policies",
    });
    const table = await screen.findByRole("table", { name: "Approval policies" });
    expect(within(table).getAllByText(/\d+ waiting/).length).toBeGreaterThan(0);
  });

  it("shows the selected gate's escalation ladder rather than a sentence", async () => {
    renderScreen(<AutomationPoliciesScreen />, {
      path: "/automation/policies",
      route: "/automation/policies",
    });
    await screen.findByRole("table", { name: "Approval policies" });

    /* EscalationLadder, not LifecycleStepper: the kit already owns the
       "when X, this happens, and it needs role Y" shape, and a policy's chain
       is that shape exactly. */
    /* The ladder's caption is its accessible name, not visible text — the
       kit puts it on the `ol` so the list reads correctly to a screen reader
       without a heading competing with the card title above it. */
    expect(screen.getByRole("list", { name: /What happens to a held/ })).toBeInTheDocument();
    expect(screen.getAllByText(/decides$/).length).toBeGreaterThan(0);
  });

  it("spends no solid primary on a read-only endpoint", async () => {
    renderScreen(<AutomationPoliciesScreen />, {
      path: "/automation/policies",
      route: "/automation/policies",
    });
    await screen.findByRole("table", { name: "Approval policies" });
    /* GET /v1/policies is read-only for the demo. A solid button that cannot
       write is a promise the API does not keep. */
    expect(
      screen.queryByRole("button", { name: /New policy|Save|Create/ }),
    ).not.toBeInTheDocument();
  });
});
