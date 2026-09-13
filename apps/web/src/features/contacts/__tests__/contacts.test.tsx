import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactsDirectoryPage } from "../ContactsDirectoryPage";
import { renderScreen } from "@/test/renderScreen";

/**
 * Sales › Contacts. The screen's job is consent: who may be contacted, on which
 * channel, and since when. Every assertion below reads the fixture client.
 */

describe("Sales › Contacts", () => {
  it("puts the person first and the organisation behind them", async () => {
    renderScreen(<ContactsDirectoryPage />, { path: "/sales/contacts", route: "/sales/contacts" });

    const directory = await screen.findByRole("region", { name: "Contact directory" });

    expect(await within(directory).findByText("Nurul Hassan")).toBeInTheDocument();
    expect(
      within(directory).getByText("HR Manager · Aurora Manufacturing Sdn Bhd"),
    ).toBeInTheDocument();
  });

  it("marks only the contacts who cannot be written to", async () => {
    renderScreen(<ContactsDirectoryPage />, { path: "/sales/contacts", route: "/sales/contacts" });

    const directory = await screen.findByRole("region", { name: "Contact directory" });
    await within(directory).findByText("Ravi Subramaniam");

    /* Ravi carries `pdpaFlag: NO_CONSENT`; Nurul has consent on both channels
       and therefore no chip at all — the exception gets the component. */
    expect(within(directory).getByText("PDPA · No consent")).toBeInTheDocument();
    expect(within(directory).queryByText("Consent on record")).not.toBeInTheDocument();
  });

  it("narrows to the people with no consent, and counts them in the header", async () => {
    renderScreen(<ContactsDirectoryPage />, { path: "/sales/contacts", route: "/sales/contacts" });

    /* The count line waits on the query: asserting before the list resolves
       would be asserting on a header that has not been told anything yet. */
    expect(await screen.findByText(/6 on record · 1 cannot be contacted/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Consent missing/ }));

    const directory = screen.getByRole("region", { name: "Contact directory" });
    expect(await within(directory).findByText("Ravi Subramaniam")).toBeInTheDocument();
    expect(within(directory).queryByText("Nurul Hassan")).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 6 shown/)).toBeInTheDocument();
  });

  it("shows the dated consent record, not just the record's booleans", async () => {
    renderScreen(<ContactsDirectoryPage />, { path: "/sales/contacts", route: "/sales/contacts" });

    const record = await screen.findByRole("region", { name: "Contact record" });

    expect(await within(record).findByText("How to reach them")).toBeInTheDocument();
    expect(within(record).getAllByText(/Consent recorded/).length).toBeGreaterThan(0);
    expect(within(record).getByText("nurul.hassan@auroramfg.com.my")).toBeInTheDocument();
  });

  it("captions the relations panel as the organisation's, not the person's", async () => {
    renderScreen(<ContactsDirectoryPage />, { path: "/sales/contacts", route: "/sales/contacts" });

    const record = await screen.findByRole("region", { name: "Contact record" });

    expect(await within(record).findByText("Their organisation")).toBeInTheDocument();
    expect(
      within(record).getByText("Everything below belongs to the organisation, not to this person."),
    ).toBeInTheDocument();

    /* The relations tab group is the M04-S02 panel, and a related engagement
       carries a server lifecycle, so the inline stepper is legal here. */
    const relations = within(record).getByRole("tablist", { name: "Organisation relations" });
    expect(within(relations).getByRole("tab", { name: /^Engagements/ })).toBeInTheDocument();
    expect(await within(record).findByText("Leading Through Change")).toBeInTheDocument();
  });

  it("reads the consent refusal off the log, channel by channel", async () => {
    renderScreen(<ContactsDirectoryPage />, { path: "/sales/contacts", route: "/sales/contacts" });

    const directory = await screen.findByRole("region", { name: "Contact directory" });
    await userEvent.click(await within(directory).findByText("Ravi Subramaniam"));

    const record = screen.getByRole("region", { name: "Contact record" });
    await within(record).findByText("How to reach them");

    /* Ravi's log holds a dated row per channel and both say no, so the pane
       shows two refusals rather than one summary — and the record's own
       `pdpaFlag` is drawn beside them rather than instead of them. */
    expect(within(record).getAllByText("No consent")).toHaveLength(2);
    expect(within(record).getByText("PDPA · No consent")).toBeInTheDocument();
    expect(within(record).getByText("not on record")).toBeInTheDocument();
  });
});
