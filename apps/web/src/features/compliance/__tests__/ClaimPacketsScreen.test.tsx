import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ClaimPacket, Me } from "@trainos/contract";
import { fixtureClient, forbidden, resetStore } from "@trainos/fixtures";
import { ClaimPacketsScreen, packetRows } from "../index";
import { HRDC_PACKET_PATH, HRDC_PACKET_PATTERN } from "@/features/hrdc";
import { currentPrimaries, resetPrimaries } from "@/shared/components/kit";
import { BreadcrumbProvider } from "@/shared/components/layout";
import { ApiProvider } from "@/shared/api";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { renderScreen } from "@/test/renderScreen";

/**
 * `/compliance/hrd-corp` — the list the nav leaf did not have.
 *
 * The three state branches are asserted here rather than left to the happy
 * path, because the loading, error and empty renders of a list screen are the
 * ones nobody opens twice. Each failure is injected through the shared fixture
 * client, so what is under test is the real client answering badly and not a
 * stub written to match the screen.
 */

const packet = (overrides: Partial<ClaimPacket> = {}): ClaimPacket =>
  ({
    id: "pkt_1",
    engagementRef: "ENG-0001",
    organisationRef: "ORG-0114",
    scheme: "SBL_KHAS",
    employerCode: "E-1",
    claimValue: { amount: 100000, currency: "MYR" },
    levyAvailable: { amount: 500000, currency: "MYR" },
    status: "DRAFT",
    completeness: 0.6,
    deadlineAt: "2027-05-13T23:59:59+08:00",
    daysRemaining: 180,
    deadlineSeverity: "WARN",
    requiredDocuments: [
      { type: "ATTENDANCE_SHEET", label: "Attendance sheet", status: "PRESENT", ref: "A/1" },
      { type: "TRAINING_SCHEDULE", status: "MISSING" },
    ],
    grant: null,
    submission: null,
    submissionLog: [],
    ...overrides,
  }) as unknown as ClaimPacket;

const at = { path: HRDC_PACKET_PATH, route: HRDC_PACKET_PATH, role: "FINANCE" as const };

const list = () => renderScreen(<ClaimPacketsScreen />, at);

/** Reports the URL a navigation actually reached. */
function Landed() {
  return <div data-testid="landed" data-path={useLocation().pathname} />;
}

/**
 * The list with the PACKET route mounted beside it.
 *
 * `renderScreen` mounts one route, which is right for every other assertion
 * here and useless for a row click: without somewhere for the navigation to
 * land, a click that went nowhere and a click that went to the wrong record
 * both render a blank tree and the test passes either way.
 */
function renderWithPacketRoute() {
  resetStore();
  resetPrimaries();
  fixtureClient.setLatency(0);
  fixtureClient.signInAs("u_amirah");

  const me: Me = { ...FIXTURE_ME, role: "FINANCE" };

  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        <ApiProvider>
          <BreadcrumbProvider>
            <MemoryRouter initialEntries={[HRDC_PACKET_PATH]}>
              <Routes>
                <Route path={HRDC_PACKET_PATH} element={<ClaimPacketsScreen />} />
                <Route path={HRDC_PACKET_PATTERN} element={<Landed />} />
              </Routes>
            </MemoryRouter>
          </BreadcrumbProvider>
        </ApiProvider>
      </MeContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  fixtureClient.setLatency(0);
});

describe("the packet register's model", () => {
  it("orders the least complete packet first, on the COUNT of missing documents", () => {
    /* Not on `completeness`: that is the server's weighting, and two packets can
       share a rate while one is two documents from filing and the other one. */
    const rows = packetRows([
      packet({
        engagementRef: "ENG-NEARLY",
        completeness: 0.2,
        requiredDocuments: [
          { type: "TAX_INVOICE", status: "PRESENT" },
          { type: "TRAINING_SCHEDULE", status: "MISSING" },
        ],
      } as Partial<ClaimPacket>),
      packet({
        engagementRef: "ENG-FAR",
        completeness: 0.9,
        requiredDocuments: [
          { type: "TAX_INVOICE", status: "MISSING" },
          { type: "TRAINING_SCHEDULE", status: "MISSING" },
        ],
      } as Partial<ClaimPacket>),
    ]);
    expect(rows.map((row) => row.engagementRef)).toEqual(["ENG-FAR", "ENG-NEARLY"]);
  });

  it("breaks a tie on the ref, so four independent queries cannot reorder the page", () => {
    const rows = packetRows([
      packet({ engagementRef: "ENG-B" }),
      packet({ engagementRef: "ENG-A" }),
    ]);
    expect(rows.map((row) => row.engagementRef)).toEqual(["ENG-A", "ENG-B"]);
  });

  it("counts anything that is not PRESENT as missing and takes the tone from the server", () => {
    expect(packetRows([packet()])[0]).toMatchObject({
      missing: 1,
      complete: false,
      deadlineTone: "warning",
    });
    expect(
      packetRows([packet({ deadlineSeverity: "DANGER" } as Partial<ClaimPacket>)])[0]?.deadlineTone,
    ).toBe("danger");
    /* An unknown severity is neutral rather than alarming: a chip must not
       invent an urgency the server did not send. */
    expect(packetRows([packet({ deadlineSeverity: "NOVEL" as never })])[0]?.deadlineTone).toBe(
      "neutral",
    );
  });

  it("reports a packet with every document present as complete", () => {
    const rows = packetRows([
      packet({
        requiredDocuments: [{ type: "TAX_INVOICE", status: "PRESENT" }],
      } as Partial<ClaimPacket>),
    ]);
    expect(rows[0]).toMatchObject({ missing: 0, complete: true });
  });
});

describe("the HRD Corp list", () => {
  it("renders a LIST on the leaf, and its breadcrumb is the path rather than a record", async () => {
    list();

    await screen.findByRole("table", { name: "HRD Corp claim packets" });
    expect(screen.getByRole("heading", { name: "HRD Corp claims" })).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumb-trail")).toHaveAttribute(
      "data-trail",
      "Compliance › HRD Corp",
    );
  });

  it("carries no solid primary — filing happens on the packet, not on the list", async () => {
    list();
    await screen.findByRole("table", { name: "HRD Corp claim packets" });
    expect(currentPrimaries()).toHaveLength(0);
  });

  it("opens the packet the clicked row names", async () => {
    const user = userEvent.setup();
    renderWithPacketRoute();

    const table = await screen.findByRole("table", { name: "HRD Corp claim packets" });
    const row = within(table).getAllByRole("row")[1] as HTMLElement;
    const ref = (within(row).getByText(/^ENG-/).textContent ?? "").trim();
    await user.click(row);

    expect(await screen.findByTestId("landed")).toHaveAttribute(
      "data-path",
      `${HRDC_PACKET_PATH}/${ref}`,
    );
  });

  it("shows a loading state before the packets arrive", () => {
    fixtureClient.setLatency(50);
    list();
    expect(screen.getByText("Loading the claim packets")).toBeInTheDocument();
  });

  it("says the packets could not be loaded when the index refuses", async () => {
    vi.spyOn(fixtureClient, "listHrdcDeadlines").mockRejectedValue(
      forbidden("You may not read HRD Corp deadlines.") as never,
    );

    list();

    expect(await screen.findByText("The claim packets could not be loaded")).toBeInTheDocument();
    /* R2: a refusal is a fact about the request and a second try does not fix
       it, so the retry is withheld. */
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("names the packet it could not read rather than quietly rendering a short list", async () => {
    vi.spyOn(fixtureClient, "getClaimPacket").mockRejectedValue(
      forbidden("You may not read this packet.") as never,
    );

    list();

    expect(await screen.findByText(/the claim packet for ENG-/)).toBeInTheDocument();
  });

  it("renders an empty state when no engagement has an open claim window", async () => {
    const original = fixtureClient.listHrdcDeadlines.bind(fixtureClient);
    vi.spyOn(fixtureClient, "listHrdcDeadlines").mockImplementation((async (...args: unknown[]) => {
      const answer = await (original as (...a: unknown[]) => Promise<{ data: unknown[] }>)(...args);
      return { ...answer, data: [] };
    }) as never);

    list();

    expect(await screen.findByText("No claim packet is open")).toBeInTheDocument();
  });

  it("distinguishes an empty SEARCH from an empty tab", async () => {
    const user = userEvent.setup();
    list();

    await screen.findByRole("table", { name: "HRD Corp claim packets" });
    await user.type(screen.getByLabelText("Search claims"), "no such client");

    expect(await screen.findByText("No claim matches this search")).toBeInTheDocument();
  });
});
