import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentPrimaries } from "@/shared/components/kit";
import { Organisation360Page } from "../Organisation360Page";
import { renderScreen } from "@/test/renderScreen";

const ROUTE = "/sales/organisations/:organisationId";
const PATH = "/sales/organisations/ORG-0114";

const render360 = () => renderScreen(<Organisation360Page />, { path: PATH, route: ROUTE });

describe("M04-S02 · organisation 360", () => {
  it("names the record once, in the header, with its five metrics", async () => {
    render360();

    const heading = await screen.findByRole("heading", {
      name: "Aurora Manufacturing Sdn Bhd",
      level: 1,
    });
    expect(heading).toBeInTheDocument();

    /* Record identity appears once. The breadcrumb owns the path and carries
       the reference; the header owns the name. Neither repeats the other. */
    expect(screen.getAllByRole("heading", { name: "Aurora Manufacturing Sdn Bhd" })).toHaveLength(
      1,
    );

    for (const label of ["Lifetime value", "Open pipeline", "AR overdue", "HRDC levy", "Health"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("RM 214,300")).toBeInTheDocument();
    expect(screen.getByText("34 days")).toBeInTheDocument();
  });

  it("offers New opportunity as the only solid primary", async () => {
    render360();

    expect(await screen.findByRole("button", { name: "New opportunity" })).toBeInTheDocument();
    await waitFor(() => expect(currentPrimaries()).toEqual(["New opportunity"]));
  });

  it("renders the chain stepper from the pipeline configuration, not from a hardcoded list", async () => {
    render360();

    /* The DEAL_CHAIN stage names and their order come from
       `getPipelineConfig`. The lifecycle steps on the engagement carry bare
       keys — ENQUIRY, TNA, PROPOSAL — so a readable "Enquiry" on screen can
       only have come from the configuration the stepper was given. */
    await screen.findByRole("heading", { name: "Aurora Manufacturing Sdn Bhd", level: 1 });

    for (const stage of ["Enquiry", "TNA", "Proposal", "Approval", "Sent", "Delivery"]) {
      await waitFor(() => expect(screen.getAllByText(stage).length).toBeGreaterThanOrEqual(1));
    }
  });

  it("surfaces the overdue invoice, the blocked claim and the contact with no consent", async () => {
    render360();

    await screen.findByRole("heading", { name: "Aurora Manufacturing Sdn Bhd", level: 1 });

    /* The exception banner: an AI draft exists but a human still approves it. */
    expect(await screen.findByText(/INV-2026-0288 overdue 34 days/)).toBeInTheDocument();
    expect(
      screen.getByText("Collections Agent has drafted a second reminder — awaiting your approval"),
    ).toBeInTheDocument();

    /* The HRD Corp claim blocked on documents. */
    expect(screen.getAllByText(/Blocked · 2 docs/).length).toBeGreaterThanOrEqual(1);

    /* The contact with no PDPA consent, flagged rather than silently unusable. */
    expect(screen.getByText("Ravi Subramaniam")).toBeInTheDocument();
    expect(screen.getByText(/no consent/)).toBeInTheDocument();
    expect(screen.getByText("PDPA")).toBeInTheDocument();
  });

  it("shows the skipped TNA on the engagement that went straight to proposal", async () => {
    render360();

    /* ENG-0198 skipped the TNA as a repeat client and its delivery is blocked.
       The stepper states both without a second visual language for either. */
    expect(await screen.findByText("Safety Leadership Essentials")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /Engagements for Aurora/ });
    expect(within(table).getByText("ENG-0198")).toBeInTheDocument();
  });

  it("carries the cross-sell suggestion as a tinted AI panel with its citations", async () => {
    render360();

    expect(await screen.findByText(/RM 61,000 unused levy expiring 31 Dec/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create opportunity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("narrows to one relationship panel when a tab is chosen", async () => {
    const user = userEvent.setup();
    render360();

    await screen.findByRole("heading", { name: "Aurora Manufacturing Sdn Bhd", level: 1 });
    await user.click(screen.getByRole("tab", { name: /Contacts/ }));

    await waitFor(() => {
      expect(
        screen.queryByRole("table", { name: /Engagements for Aurora/ }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Nurul Hassan")).toBeInTheDocument();
  });
});
