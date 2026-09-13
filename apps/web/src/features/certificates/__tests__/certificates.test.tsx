import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Engagement, Participant } from "@trainos/contract";
import { CertificatesScreen } from "../CertificatesScreen";
import { certificateRows, certificateStateOf, tallyIssuance } from "../certificates";
import { CERTIFICATES_PATH } from "../paths";
import { currentPrimaries } from "@/shared/components/kit";
import { renderScreen } from "@/test/renderScreen";

const engagement = (overrides: Partial<Engagement> = {}): Engagement =>
  ({
    ref: "ENG-0001",
    organisationRef: "ORG-0114",
    title: "A delivery",
    status: "DELIVERED",
    dates: ["2026-08-20", "2026-08-21"],
    checklist: [{ key: "CERTIFICATES_ISSUED", label: "Certificates issued", done: false }],
    metrics: { participants: 30, attended: 28, attendanceRate: 0.93 },
    ...overrides,
  }) as unknown as Engagement;

const participant = (certificateId: string | null): Participant =>
  ({
    ref: `PAR-${certificateId ?? "none"}`,
    name: "A person",
    department: "Ops",
    certificateId,
  }) as unknown as Participant;

const render = () =>
  renderScreen(<CertificatesScreen />, {
    path: CERTIFICATES_PATH,
    route: CERTIFICATES_PATH,
    role: "OPS",
  });

describe("the certificate state", () => {
  it("reads a ticked checklist item as issued", () => {
    const done = engagement({
      checklist: [{ key: "CERTIFICATES_ISSUED", label: "x", done: true }],
    });
    expect(certificateStateOf(done, "2026-09-13")).toBe("ISSUED");
  });

  it("waits for the last delivery day before anything is due", () => {
    expect(certificateStateOf(engagement(), "2026-08-20")).toBe("NOT_DUE");
    expect(certificateStateOf(engagement(), "2026-08-21")).toBe("PENDING");
  });

  it("separates an absent checklist item from an unticked one", () => {
    expect(certificateStateOf(engagement({ checklist: [] }), "2026-09-13")).toBe("UNTRACKED");
  });

  it("issues nothing for a cancelled delivery", () => {
    expect(certificateStateOf(engagement({ status: "CANCELLED" }), "2026-09-13")).toBe("NOT_DUE");
  });

  it("sorts what is owed to the top, newest first", () => {
    const rows = certificateRows(
      [
        engagement({
          ref: "ENG-DONE",
          checklist: [{ key: "CERTIFICATES_ISSUED", label: "x", done: true }],
        }),
        engagement({ ref: "ENG-OLD", dates: ["2026-05-20"] }),
        engagement({ ref: "ENG-GAP", checklist: [] }),
      ],
      "2026-09-13",
    );
    expect(rows.map((row) => row.engagementRef)).toEqual(["ENG-GAP", "ENG-OLD", "ENG-DONE"]);
  });
});

describe("the issuance tally", () => {
  it("counts only participants carrying a certificate identifier", () => {
    const tally = tallyIssuance([participant("CERT-1"), participant(null)], "ISSUED");
    expect(tally).toEqual({ registered: 2, withCertificate: 1, unbacked: false });
  });

  it("flags a roll-up that no participant record backs", () => {
    /* Three engagements in the seed report certificates issued and NO
       participant anywhere carries an identifier. The claim packet cites the
       participant records, so the disagreement matters. */
    expect(tallyIssuance([participant(null), participant(null)], "ISSUED").unbacked).toBe(true);
  });

  it("does not call an unissued delivery unbacked", () => {
    expect(tallyIssuance([participant(null)], "PENDING").unbacked).toBe(false);
    expect(tallyIssuance([], "ISSUED").unbacked).toBe(false);
  });

  it("treats an empty certificate identifier as no certificate", () => {
    expect(tallyIssuance([participant("")], "ISSUED").withCertificate).toBe(0);
  });
});

describe("the certificate register", () => {
  it("opens on what is awaiting issue and lists it", async () => {
    render();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^Pending/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
  });

  it("shows the issued deliveries on their own tab", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("tab", { name: /^Issued/ });
    await user.click(screen.getByRole("tab", { name: /^Issued/ }));

    await waitFor(() => {
      expect(screen.getAllByText("Issued").length).toBeGreaterThan(0);
    });
  });

  it("reads the participant roll only when a row is opened", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("tab", { name: /^All/ });
    await user.click(screen.getByRole("tab", { name: /^All/ }));

    const table = await screen.findByRole("table", { name: "Certificates" });
    const row = within(table).getByText("Leading Through Change").closest("tr");
    await user.click(row as HTMLElement);

    const drawer = await screen.findByRole("dialog");
    /* ENG-0231 is the one engagement with a roll: thirty registered, none of
       them carrying a certificate identifier. */
    expect(await within(drawer).findByText(/Participants · 0 of 30/)).toBeInTheDocument();
    expect(within(drawer).getAllByText("No certificate").length).toBeGreaterThan(0);
  });

  it("says so when a delivery has no participants at all", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByRole("tab", { name: /^Issued/ });
    await user.click(screen.getByRole("tab", { name: /^Issued/ }));

    const table = await screen.findByRole("table", { name: "Certificates" });
    const [firstRow] = within(table).getAllByRole("row").slice(1);
    await user.click(firstRow as HTMLElement);

    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("No participants registered")).toBeInTheDocument();
  });

  it("claims no solid primary — issuing a certificate is not an action the contract offers", async () => {
    render();
    await screen.findByRole("tab", { name: /^Pending/ });

    await waitFor(() => {
      expect(currentPrimaries()).toHaveLength(0);
    });
  });
});
