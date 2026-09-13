import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FixtureTrainer } from "@trainos/fixtures";
import { TrainersListPage } from "../TrainersListPage";
import { TrainerRecordPage } from "../TrainerRecordPage";
import { accreditationOf, nextBookedDay, tttStateOf } from "../accreditation";
import { TRAINERS_LIST_PATH, TRAINER_DETAIL_PATTERN, trainerPath } from "../paths";
import { currentPrimaries } from "@/shared/components/kit";
import { renderScreen } from "@/test/renderScreen";

const trainer = (overrides: Partial<FixtureTrainer> = {}): FixtureTrainer => ({
  id: "trn_x",
  ref: "TRN-0001",
  name: "Test Trainer",
  email: "test@akademiperdana.my",
  bands: "A",
  tttCertified: true,
  tttRef: "TTT-2020-0001",
  tttValidTo: "2027-06-30",
  hrdTdf: true,
  rating: 4.5,
  programmeRefs: [],
  bookedDates: [],
  lastDeliveredAt: null,
  ...overrides,
});

const list = () =>
  renderScreen(<TrainersListPage />, {
    path: TRAINERS_LIST_PATH,
    route: TRAINERS_LIST_PATH,
    role: "OPS",
  });

const record = (ref: string) =>
  renderScreen(<TrainerRecordPage />, {
    path: trainerPath(ref),
    route: TRAINER_DETAIL_PATTERN,
    role: "OPS",
  });

describe("accreditation — two gates, not one", () => {
  it("reads a current certificate and a TDF registration as claimable", () => {
    const result = accreditationOf(trainer(), "2026-11-14");
    expect(result).toMatchObject({ ttt: "VALID", hrdTdf: true, claimable: true, tone: "success" });
    expect(result.detail).toBeNull();
  });

  it("refuses a trainer with a current certificate but no HRD Corp registration", () => {
    /* The defect this exists to stop: one green "accredited" chip would tell
       Operations they were safe to book while Finance loses the levy. */
    const result = accreditationOf(trainer({ hrdTdf: false }), "2026-11-14");
    expect(result.claimable).toBe(false);
    expect(result.tone).toBe("danger");
    expect(result.label).toBe("Not HRD Corp registered");
  });

  it("treats a certificate lapsing inside the booking window as a warning, not a pass", () => {
    const result = accreditationOf(trainer({ tttValidTo: "2026-12-20" }), "2026-11-14");
    expect(result.ttt).toBe("EXPIRING");
    expect(result.tone).toBe("warning");
    /* Still claimable today — the warning is about the delivery date, and
       saying otherwise would block a booking the rules allow. */
    expect(result.claimable).toBe(true);
  });

  it("reads a lapsed certificate and a missing one as different facts", () => {
    expect(tttStateOf({ tttCertified: true, tttValidTo: "2026-01-01" }, "2026-11-14")).toBe(
      "EXPIRED",
    );
    expect(tttStateOf({ tttCertified: false, tttValidTo: null }, "2026-11-14")).toBe("NONE");
    expect(accreditationOf(trainer({ tttValidTo: "2026-01-01" }), "2026-11-14").label).toBe(
      "TTT expired",
    );
    expect(
      accreditationOf(
        trainer({ tttCertified: false, tttRef: null, tttValidTo: null }),
        "2026-11-14",
      ).label,
    ).toBe("No TTT");
  });

  it("finds the next committed day and reports none when the diary is behind", () => {
    const booked = trainer({ bookedDates: ["2026-11-12", "2026-11-13", "2027-01-14"] });
    expect(nextBookedDay(booked, "2026-11-13")).toBe("2026-11-13");
    expect(nextBookedDay(booked, "2026-11-14")).toBe("2027-01-14");
    expect(nextBookedDay(booked, "2027-06-01")).toBeNull();
  });
});

describe("the trainer pool", () => {
  it("lists the pool and flags the trainer who cannot be cited on a claim", async () => {
    list();

    expect(await screen.findByText("Farah Aziz")).toBeInTheDocument();
    expect(screen.getByText("Noora Idris")).toBeInTheDocument();
    /* Noora has neither certificate nor TDF, which is the negative case the
       fixture seed exists to carry. */
    expect(screen.getByText("No TTT")).toBeInTheDocument();
  });

  it("narrows to the trainers who need attention through the toolbar's tabs", async () => {
    const user = userEvent.setup();
    list();

    await screen.findByText("Farah Aziz");
    await user.click(screen.getByRole("tab", { name: /Needs attention/ }));

    await waitFor(() => {
      expect(screen.queryByText("Farah Aziz")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Noora Idris")).toBeInTheDocument();
  });

  it("searches by name, ref or email and shows the search as a chip", async () => {
    const user = userEvent.setup();
    list();

    await screen.findByText("Farah Aziz");
    await user.type(screen.getByLabelText("Search trainers"), "chinhoe");

    await waitFor(() => {
      expect(screen.getByText("Lee Chin Hoe")).toBeInTheDocument();
    });
    expect(screen.queryByText("Farah Aziz")).not.toBeInTheDocument();
    expect(screen.getByText("Search:")).toBeInTheDocument();
  });

  it("says so when a filter matches nothing, rather than showing a blank table", async () => {
    const user = userEvent.setup();
    list();

    await screen.findByText("Farah Aziz");
    await user.type(screen.getByLabelText("Search trainers"), "nobody at all");

    expect(await screen.findByText("No trainer matches these filters")).toBeInTheDocument();
  });
});

describe("M08-S02 · the trainer record", () => {
  it("renders the identity once, the four metrics and the accreditation facts", async () => {
    record("TRN-0007");

    expect(await screen.findByRole("heading", { name: "Farah Aziz" })).toBeInTheDocument();
    for (const label of ["Rating", "Programmes", "Days committed", "TTT valid to"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Registered")).toBeInTheDocument();
    expect(screen.getByText("Can be cited")).toBeInTheDocument();
  });

  it("explains the refusal in a banner on the trainer who fails the claim check", async () => {
    record("TRN-0024");

    expect(await screen.findByRole("heading", { name: "Noora Idris" })).toBeInTheDocument();
    expect(screen.getByText(/No Train-the-Trainer certificate is on record/)).toBeInTheDocument();
  });

  it("switches to the programmes this trainer may deliver", async () => {
    const user = userEvent.setup();
    record("TRN-0007");

    await screen.findByRole("heading", { name: "Farah Aziz" });
    await user.click(screen.getByRole("tab", { name: /Programmes/ }));

    expect(await screen.findByText("Leading Through Change")).toBeInTheDocument();
  });

  it("shows the committed diary, marking what is past", async () => {
    const user = userEvent.setup();
    record("TRN-0007");

    await screen.findByRole("heading", { name: "Farah Aziz" });
    await user.click(screen.getByRole("tab", { name: /Availability/ }));

    const diary = await screen.findByRole("region", { name: "Committed days" });
    expect(within(diary).getAllByText(/^(Ahead|Past)$/).length).toBe(2);
  });

  it("says which trainer is missing rather than rendering an error for a bad ref", async () => {
    record("TRN-9999");

    expect(await screen.findByText("No trainer with the reference TRN-9999")).toBeInTheDocument();
  });

  it("claims no solid primary — the contract has no trainer write", async () => {
    record("TRN-0007");
    await screen.findByRole("heading", { name: "Farah Aziz" });

    await waitFor(() => {
      expect(currentPrimaries()).toHaveLength(0);
    });
  });
});
