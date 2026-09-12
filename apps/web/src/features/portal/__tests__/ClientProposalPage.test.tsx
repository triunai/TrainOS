import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PORTAL_TOKEN_AURORA, PORTAL_TOKEN_MERIDIAN } from "@trainos/fixtures";
import { currentPrimaries } from "@/shared/components/kit";
import { ClientProposalPage, PORTAL_PROPOSAL_PATTERN } from "@/features/portal";
import { renderAt, resetFixtures } from "./harness";

/**
 * M07-S07. The assertions track the design pack's "states rendered" row:
 * accepted and locked, with no primary action anywhere on the page.
 */
describe("ClientProposalPage · M07-S07", () => {
  beforeEach(resetFixtures);

  const open = (token: string) =>
    render(renderAt(`/p/${token}`, PORTAL_PROPOSAL_PATTERN, <ClientProposalPage />));

  it("renders the accepted-and-locked state with no solid primary button", async () => {
    open(PORTAL_TOKEN_AURORA);

    expect(
      await screen.findByRole("heading", { name: /Proposal for Aurora Manufacturing Sdn Bhd/ }),
    ).toBeInTheDocument();

    /* The one exception REPORT.md documents: a locked state has no primary. */
    expect(currentPrimaries()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Accept proposal" })).not.toBeInTheDocument();

    /* No breadcrumb: the portal mounts outside the shell, and a client with no
       account has nowhere to navigate to. A trail here would be decoration. */
    expect(screen.getByTestId("breadcrumb-trail")).toBeEmptyDOMElement();

    expect(screen.getByText(/Accepted 15 Sep 2026/)).toBeInTheDocument();
    expect(
      screen.getByText(/This proposal was accepted on 15 Sep 2026 at 10:24/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Signed electronically by Nurul Hassan, HR Manager/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Signature, IP address and audit record retained/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download signed copy" })).toBeInTheDocument();
  });

  it("renders the sections, the investment figures and the comment thread", async () => {
    open(PORTAL_TOKEN_AURORA);

    expect(await screen.findByText("1 · Understanding your needs")).toBeInTheDocument();
    expect(screen.getByText("5 · HRDC claim guidance")).toBeInTheDocument();

    expect(screen.getByText("RM 18,500.00")).toBeInTheDocument();
    expect(screen.getByText(/HRD Corp claimable · SBL-KHAS/)).toBeInTheDocument();
    expect(screen.getByText("up to 100%")).toBeInTheDocument();
    expect(screen.getByText("Your available levy")).toBeInTheDocument();

    expect(screen.getByText("Comments · 2")).toBeInTheDocument();
    expect(screen.getByText(/Can we confirm the November dates/)).toBeInTheDocument();
  });

  it("posts a comment through addPortalComment and shows it in the thread", async () => {
    const user = userEvent.setup();
    open(PORTAL_TOKEN_AURORA);

    await screen.findByText("Comments · 2");
    await user.type(screen.getByLabelText("Add a comment"), "Please send the invoice to finance.");
    await user.click(screen.getByRole("button", { name: "Post comment" }));

    expect(await screen.findByText("Comments · 3")).toBeInTheDocument();
    expect(screen.getByText("Please send the invoice to finance.")).toBeInTheDocument();
  });

  it("accepts an unaccepted proposal and records the e-signature", async () => {
    const user = userEvent.setup();
    open(PORTAL_TOKEN_MERIDIAN);

    const accept = await screen.findByRole("button", { name: "Accept proposal" });
    expect(accept).toBeDisabled();
    expect(currentPrimaries()).toEqual(["Accept proposal"]);

    await user.type(screen.getByLabelText("Full name"), "Wong Kah Meng");
    await user.type(screen.getByLabelText("Your role"), "Head of Operations");
    await user.click(screen.getByRole("button", { name: "Accept proposal" }));

    expect(
      await screen.findByText(/Signed electronically by Wong Kah Meng, Head of Operations/),
    ).toBeInTheDocument();
    await waitFor(() => expect(currentPrimaries()).toHaveLength(0));
  });

  it("renders a refusal, not a retry, for an unknown token", async () => {
    open("tok_does_not_exist");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /This proposal link cannot be opened/,
    );
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
