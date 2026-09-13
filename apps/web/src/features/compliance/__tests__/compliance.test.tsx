import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClaimPacket, HrdcDeadline } from "@trainos/contract";
import { ComplianceDeadlinesScreen } from "../ComplianceDeadlinesScreen";
import { ComplianceDocumentsScreen } from "../ComplianceDocumentsScreen";
import { byUrgency, deadlineRows, documentRows } from "../registers";
import { COMPLIANCE_DEADLINES_PATH, COMPLIANCE_DOCUMENTS_PATH } from "../paths";
import { currentPrimaries } from "@/shared/components/kit";
import { renderScreen } from "@/test/renderScreen";

const deadline = (overrides: Partial<HrdcDeadline> = {}): HrdcDeadline =>
  ({
    engagementRef: "ENG-0001",
    organisationRef: "ORG-0114",
    deadlineAt: "2026-11-17T23:59:59+08:00",
    daysRemaining: 3,
    status: "AT_RISK",
    severity: "DANGER",
    ...overrides,
  }) as HrdcDeadline;

const packet = (overrides: Partial<ClaimPacket> = {}): ClaimPacket =>
  ({
    id: "pkt_1",
    engagementRef: "ENG-0001",
    organisationRef: "ORG-0114",
    scheme: "SBL_KHAS",
    status: "DRAFT",
    completeness: 0.6,
    requiredDocuments: [
      { type: "ATTENDANCE_SHEET", label: "Attendance sheet", status: "PRESENT", ref: "A/1" },
      { type: "TRAINING_SCHEDULE", status: "MISSING" },
    ],
    ...overrides,
  }) as unknown as ClaimPacket;

const deadlinesScreen = () =>
  renderScreen(<ComplianceDeadlinesScreen />, {
    path: COMPLIANCE_DEADLINES_PATH,
    route: COMPLIANCE_DEADLINES_PATH,
    role: "FINANCE",
  });

const documentsScreen = () =>
  renderScreen(<ComplianceDocumentsScreen />, {
    path: COMPLIANCE_DOCUMENTS_PATH,
    route: COMPLIANCE_DOCUMENTS_PATH,
    role: "FINANCE",
  });

describe("the deadline register's model", () => {
  it("orders by the due DATE, not by the day count the server also sends", () => {
    /* The two agree today. They stop agreeing the moment a count goes stale,
       and the date is the fact the window actually turns on. */
    const rows = deadlineRows([
      deadline({
        engagementRef: "ENG-LATE",
        deadlineAt: "2027-05-13T23:59:59+08:00",
        daysRemaining: 1,
      }),
      deadline({
        engagementRef: "ENG-SOON",
        deadlineAt: "2026-11-17T23:59:59+08:00",
        daysRemaining: 900,
      }),
    ]);
    expect(rows.map((row) => row.engagementRef)).toEqual(["ENG-SOON", "ENG-LATE"]);
  });

  it("breaks a tie on the ref, so the order does not depend on arrival", () => {
    const rows = deadlineRows([
      deadline({ engagementRef: "ENG-0002" }),
      deadline({ engagementRef: "ENG-0001" }),
    ]);
    expect(rows.map((row) => row.engagementRef)).toEqual(["ENG-0001", "ENG-0002"]);
  });

  it("takes the tone from the server's severity and reads a negative count as overdue", () => {
    expect(deadlineRows([deadline()])[0]).toMatchObject({ tone: "danger", overdue: false });
    expect(deadlineRows([deadline({ severity: "WARN" })])[0]?.tone).toBe("warning");
    expect(deadlineRows([deadline({ daysRemaining: -2 })])[0]?.overdue).toBe(true);
    /* An unknown severity is neutral rather than alarming: the chip must not
       invent an urgency the server did not send. */
    expect(deadlineRows([deadline({ severity: "NOVEL" as never })])[0]?.tone).toBe("neutral");
  });
});

describe("the document register's model", () => {
  it("keys a row by engagement AND type, because a type repeats across packets", () => {
    const rows = documentRows([packet(), packet({ id: "pkt_2", engagementRef: "ENG-0002" })]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("falls back to the HRD Corp type rather than prettifying a name the circular does not use", () => {
    const rows = documentRows([packet()]);
    expect(rows[1]?.label).toBe("TRAINING_SCHEDULE");
    expect(rows[0]?.label).toBe("Attendance sheet");
  });

  it("puts what is missing first", () => {
    const rows = byUrgency(documentRows([packet()]));
    expect(rows[0]?.present).toBe(false);
  });

  it("carries the server's own context line through untouched", () => {
    const withMeta = packet({
      requiredDocuments: [
        { type: "ATTENDANCE_SHEET", status: "PRESENT", meta: "Locked 14 Nov · 28/30 present" },
      ],
    } as Partial<ClaimPacket>);
    expect(documentRows([withMeta])[0]?.meta).toBe("Locked 14 Nov · 28/30 present");
  });
});

describe("M12 · the deadlines register", () => {
  it("lists every open claim window with its client and its urgency", async () => {
    deadlinesScreen();

    /* The client's name shares its line with the mono ref, so the matcher is a
       regex: the text is deliberately split across two elements. */
    expect(await screen.findByText(/Aurora Manufacturing Sdn Bhd/)).toBeInTheDocument();
    expect(screen.getAllByText("At risk").length).toBeGreaterThan(0);
  });

  it("opens on what needs attention and can be widened to everything", async () => {
    const user = userEvent.setup();
    deadlinesScreen();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Needs attention/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    await user.click(screen.getByRole("tab", { name: /^All/ }));
    await waitFor(() => {
      expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    });
  });

  it("builds the status facet from the data, not from a list written here", async () => {
    const user = userEvent.setup();
    deadlinesScreen();

    await screen.findByText(/Aurora Manufacturing Sdn Bhd/);
    await user.click(screen.getByRole("tab", { name: /^All/ }));

    const facet = screen.getByLabelText("Status");
    expect(within(facet).getByRole("option", { name: "Blocked" })).toBeInTheDocument();
    expect(within(facet).getByRole("option", { name: "At risk" })).toBeInTheDocument();
  });

  it("claims no solid primary — filing happens on the packet screen", async () => {
    deadlinesScreen();
    await screen.findByText(/Aurora Manufacturing Sdn Bhd/);

    await waitFor(() => {
      expect(currentPrimaries()).toHaveLength(0);
    });
  });
});

describe("M12 · the documents register", () => {
  it("gathers every packet's required documents into one list", async () => {
    documentsScreen();

    /* The four packets' missing documents, gathered across engagements. The
       label falls back to the HRD Corp type where the packet sends none. */
    expect(await screen.findByText("EVALUATION_SUMMARY")).toBeInTheDocument();
    expect(screen.getAllByText("TRAINING_SCHEDULE").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
  });

  it("shows the whole packet in the drawer, through the kit's document row", async () => {
    const user = userEvent.setup();
    documentsScreen();

    await screen.findByText("EVALUATION_SUMMARY");
    const table = screen.getByRole("table", { name: "Claim documents" });
    const [firstRow] = within(table).getAllByRole("row").slice(1);
    await user.click(firstRow as HTMLElement);

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Open the claim packet")).toBeInTheDocument();
    /* Every one of the five required documents, present ones included. */
    expect(within(drawer).getAllByText(/Attendance sheet|ATTENDANCE_SHEET/).length).toBeGreaterThan(
      0,
    );
  });

  it("narrows by document type and says so when nothing matches", async () => {
    const user = userEvent.setup();
    documentsScreen();

    await screen.findByText("EVALUATION_SUMMARY");
    await user.type(screen.getByLabelText("Search documents"), "no such document");

    expect(await screen.findByText("No document matches these filters")).toBeInTheDocument();
  });

  it("claims no solid primary", async () => {
    documentsScreen();
    await screen.findByText("EVALUATION_SUMMARY");

    await waitFor(() => {
      expect(currentPrimaries()).toHaveLength(0);
    });
  });
});
