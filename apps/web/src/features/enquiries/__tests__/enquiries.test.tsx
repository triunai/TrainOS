import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fixtureClient } from "@trainos/fixtures";
import { currentPrimaries } from "@/shared/components/kit";
import { EnquiryInboxPage } from "../EnquiryInboxPage";
import { EnquiryDetailPage } from "../EnquiryDetailPage";
import { FollowUpQueuePage } from "../FollowUpQueuePage";
import { renderScreen } from "./render-harness";

const DETAIL_ROUTE = "/sales/enquiries/:enquiryId";
const DETAIL_PATH = "/sales/enquiries/ENQ-2026-0912";

describe("M03-S01 · enquiry inbox", () => {
  it("renders the saved-view pill tabs, the low-confidence row and the auto-archived row", async () => {
    renderScreen(<EnquiryInboxPage />, { path: "/sales/enquiries", route: "/sales/enquiries" });

    expect(await screen.findByRole("heading", { name: "Enquiry inbox" })).toBeInTheDocument();

    /* The pill tabs are the §2 saved views, not a hardcoded list. */
    const tablist = await screen.findByRole("tablist", { name: "Saved views" });
    expect(within(tablist).getByRole("tab", { name: /All open/ })).toBeInTheDocument();
    expect(within(tablist).getByRole("tab", { name: /Needs human review/ })).toBeInTheDocument();

    /* Below the 60% classification threshold: flagged for a human, never
       auto-archived. That pairing is the rule the pack states in prose. */
    expect(screen.getByText("Needs human classification")).toBeInTheDocument();

    /* NOT_AN_ENQUIRY at 96% arrives already archived — the other half of the
       same rule, and the state the design pack draws at 85% opacity. */
    expect(screen.getAllByText("Auto-archived").length).toBeGreaterThanOrEqual(1);
  });

  it("offers exactly one solid primary — Accept & convert — and executes it", async () => {
    const user = userEvent.setup();
    renderScreen(<EnquiryInboxPage />, { path: "/sales/enquiries", route: "/sales/enquiries" });

    /* The suggestion lives on the Aurora enquiry, so the preview has to be
       showing that row before a primary exists at all. */
    await user.click(await screen.findByText(/Nurul Hassan · Aurora Manufacturing/));

    const primary = await screen.findByRole("button", { name: "Accept & convert" });
    await waitFor(() => expect(currentPrimaries()).toEqual(["Accept & convert"]));

    await user.click(primary);

    /* EXECUTED, and the effects are the content of the confirmation — a bare
       "done" would not tell anyone what changed. */
    expect(await screen.findByText(/changes recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Created from the enquiry/)).toBeInTheDocument();
  });

  it("still offers one primary on an enquiry the agent made no suggestion for", async () => {
    const user = userEvent.setup();
    renderScreen(<EnquiryInboxPage />, { path: "/sales/enquiries", route: "/sales/enquiries" });

    /* Which enquiries carry a suggestion is seed data and it changes, so the
       row is found from the store rather than named here: the first one the
       Lead Agent proposed nothing for is the one that exercises this path. */
    const listed = await fixtureClient.listEnquiries({ page: { size: 50 } });
    const details = await Promise.all(listed.data.map((row) => fixtureClient.getEnquiry(row.ref)));
    const unsuggested = details.find(
      (row) =>
        !row.suggestedAction && row.status !== "ARCHIVED" && !row.classification.needsHumanReview,
    );
    expect(unsuggested, "the seed has no enquiry without a suggested action").toBeDefined();

    await screen.findByRole("heading", { name: "Enquiry inbox" });
    await user.click(await screen.findByText(new RegExp(unsuggested!.from.name)));

    expect(await screen.findByText(/The Lead Agent proposed no next step/)).toBeInTheDocument();

    const primary = screen.getByRole("button", { name: "Convert to lead" });
    await waitFor(() => expect(currentPrimaries()).toEqual(["Convert to lead"]));

    await user.click(primary);
    expect(await screen.findByText(/changes recorded/)).toBeInTheDocument();
  });

  it("narrows the queue when a saved view is chosen", async () => {
    const user = userEvent.setup();
    renderScreen(<EnquiryInboxPage />, { path: "/sales/enquiries", route: "/sales/enquiries" });

    await screen.findByRole("heading", { name: "Enquiry inbox" });
    await user.click(await screen.findByRole("tab", { name: /Needs human review/ }));

    await waitFor(() => {
      expect(screen.queryByText("Auto-archived")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Needs human classification")).toBeInTheDocument();
  });
});

describe("M03-S02 · enquiry detail", () => {
  it("renders the four header metrics, the citations and the overdue-invoice exception", async () => {
    renderScreen(<EnquiryDetailPage />, { path: DETAIL_PATH, route: DETAIL_ROUTE });

    expect(
      await screen.findByRole("heading", { name: "Leadership training for 30 managers" }),
    ).toBeInTheDocument();

    for (const label of ["Estimated value", "Classification", "Organisation", "Levy available"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    /* The levy arrives from the matched organisation, not from a copy on the
       enquiry — if the read were dropped the cell would show an em dash. */
    expect(await screen.findByText("RM 61,000")).toBeInTheDocument();

    /* The exception the account carries, stated where the decision is made. */
    expect(screen.getByText("Overdue invoice on this account")).toBeInTheDocument();
    /* Named twice on purpose: once in the chain list, once in the banner. */
    expect(screen.getAllByText(/INV-2026-0288/).length).toBeGreaterThanOrEqual(1);
  });

  it("opens the field a human has already corrected, and saves a new value through the patch", async () => {
    const user = userEvent.setup();
    renderScreen(<EnquiryDetailPage />, { path: DETAIL_PATH, route: DETAIL_ROUTE });

    /* Timing is the field carrying `editedBy`, so it is the one the screen
       opens — the pack's "Edit before use" moment. */
    const input = await screen.findByLabelText("Timing value");
    expect(input).toHaveValue("2026-11");

    await user.clear(input);
    await user.type(input, "2026-12");
    await user.click(screen.getByRole("button", { name: "Save" }));

    /* The patch round-trips: the field closes and reads back the new value. */
    expect(await screen.findByRole("button", { name: "Edit Timing" })).toHaveTextContent("2026-12");
  });

  it("renders budget as an absence rather than zero", async () => {
    renderScreen(<EnquiryDetailPage />, { path: DETAIL_PATH, route: DETAIL_ROUTE });

    await screen.findByRole("heading", { name: "Leadership training for 30 managers" });
    expect(screen.getByRole("button", { name: "Edit Budget" })).toHaveTextContent("not stated");
    expect(screen.queryByText("RM 0.00")).not.toBeInTheDocument();
  });

  it("converts through the action envelope and renders the outcome", async () => {
    const user = userEvent.setup();
    renderScreen(<EnquiryDetailPage />, { path: DETAIL_PATH, route: DETAIL_ROUTE });

    await screen.findByRole("heading", { name: "Leadership training for 30 managers" });

    /* The header carries the solid primary; the suggestion block repeats the
       same action as a bordered button, exactly as the artboard draws it. The
       single-primary check counts labels, so one claim is correct. */
    const buttons = screen.getAllByRole("button", { name: "Accept & convert" });
    expect(buttons).toHaveLength(2);
    await waitFor(() => expect(currentPrimaries()).toEqual(["Accept & convert"]));

    await user.click(buttons[0] as HTMLElement);

    expect(await screen.findByText(/changes recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Questionnaire sent to the client contact/)).toBeInTheDocument();
  });
});

describe("M03-S06 · follow-up queue", () => {
  it("marks the overdue rows, prices the WhatsApp send and proves consent before it", async () => {
    renderScreen(<FollowUpQueuePage />, {
      path: "/sales/enquiries/follow-ups",
      route: "/sales/enquiries/follow-ups",
    });

    expect(await screen.findByRole("heading", { name: "Follow-up queue" })).toBeInTheDocument();

    /* Two overdue rows in the seed, and overdue is the only status here that
       spends a colour. */
    await waitFor(() => expect(screen.getAllByText("Overdue").length).toBeGreaterThanOrEqual(2));

    /* The cost of the click, before the click. */
    const cost = await screen.findByRole("region", { name: "Message cost" });
    expect(within(cost).getByText("Recipients")).toBeInTheDocument();
    /* The per-message rate runs to four decimals; rounding it to the sen would
       mis-state what the send costs. */
    expect(within(cost).getByText("RM 0.0564")).toBeInTheDocument();
    /* And the dearer alternative is named, which is why this template is used. */
    expect(within(cost).getByText(/not permitted for this template/)).toBeInTheDocument();

    /* PDPA is checked in the open, not in a log. */
    expect(screen.getByText(/Consent on file: WhatsApp ✓/)).toBeInTheDocument();
  });

  it("sends on a human click and renders the executed outcome", async () => {
    const user = userEvent.setup();
    renderScreen(<FollowUpQueuePage />, {
      path: "/sales/enquiries/follow-ups",
      route: "/sales/enquiries/follow-ups",
    });

    const send = await screen.findByRole("button", { name: "Send" });
    await waitFor(() => expect(send).toBeEnabled());
    await waitFor(() => expect(currentPrimaries()).toEqual(["Send"]));

    await user.click(send);

    expect(await screen.findByText(/change recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Follow-up sent/)).toBeInTheDocument();
  });

  it("blocks the send when the contact has no PDPA consent for the channel", async () => {
    const user = userEvent.setup();
    renderScreen(<FollowUpQueuePage />, {
      path: "/sales/enquiries/follow-ups",
      route: "/sales/enquiries/follow-ups",
    });

    /* Ravi Subramaniam is the seed's no-consent contact. */
    await screen.findByRole("heading", { name: "Follow-up queue" });
    await user.click(await screen.findByText(/Ravi Subramaniam/));

    expect(await screen.findByText("No PDPA consent on file for this channel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
