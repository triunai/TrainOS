import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createFixtureClient, isContractError } from "@trainos/fixtures";
import { ClaimPacketScreen } from "../ClaimPacketScreen";
import { RulesRegistryScreen } from "../RulesRegistryScreen";
import { RuleChangeReviewScreen } from "../RuleChangeReviewScreen";
import { DEFAULT_PACKET_ENGAGEMENT_REF, DEFAULT_RULE_CHANGE_DOCUMENT_ID } from "../paths";
import { renderScreen } from "@/test/renderScreen";

/**
 * The states the design-pack inventory says each screen must render, asserted
 * against the fixture client rather than against props a test invented.
 */

describe("M12-S02 · claim packet", () => {
  /**
   * NO TEST FOR THE CLAIM-WINDOW CHIP'S TONE, and that is a finding rather than
   * an omission.
   *
   * The chip took `deadlineSeverity === "INFO" ? "neutral" : "warning"`, a
   * two-branch ternary over a FOUR-member `Severity`, so DANGER and ALERT both
   * asked for "warning". It now asks the kit's `SEVERITY_TONE`, which is right
   * and which the kit tests on its own values.
   *
   * But the tone never reaches the screen. This header is `accent` and does not
   * pass `plainWhenCollapsed`, so `RecordHeader`'s `showCard` is permanently
   * true, and `StatusChip` on the accent card renders `ACCENT_TONE` and ignores
   * `tone` entirely (`StatusChip.tsx:118`). An urgent claim window and a routine
   * one are the same pixels today. A DOM assertion here would therefore pass
   * against the ternary, against the map, and against a tone of "success" —
   * which is a test that proves nothing.
   *
   * Raised for a ruling instead: either the severity belongs somewhere it can
   * be seen, or the chip should not carry a tone at all.
   */

  it("renders two missing documents, the completeness bar and the six-month deadline", async () => {
    renderScreen(<ClaimPacketScreen engagementRef={DEFAULT_PACKET_ENGAGEMENT_REF} />, {
      role: "FINANCE",
    });

    /* §15a: the title NAMES the record and `recordRef` carries the reference,
       so the two are asserted separately rather than as one concatenated h1. */
    expect(await screen.findByRole("heading", { name: "Claim packet" })).toBeInTheDocument();
    /* `recordRef` is the first item of the joined mono meta line, not its own node. */
    expect(screen.getByText(/^ENG-0231 · /)).toBeInTheDocument();

    /* Two missing documents, and the metric that counts them. */
    expect(screen.getAllByText("Missing")).toHaveLength(2);
    expect(screen.getByText("Evaluation summary")).toBeInTheDocument();
    expect(screen.getByText("Training schedule")).toBeInTheDocument();
    expect(screen.getByText("2 missing")).toBeInTheDocument();

    /* The completeness bar — 62%, from the packet, in two places by design:
       the metric cell and the card's own bar. */
    expect(screen.getAllByText("62%").length).toBeGreaterThan(0);
  });

  it("shows every rule check with its computed values and a no-model basis", async () => {
    renderScreen(<ClaimPacketScreen engagementRef={DEFAULT_PACKET_ENGAGEMENT_REF} />, {
      role: "FINANCE",
    });

    /* The FAIL that blocks the filing, with its working shown, not just a verdict. */
    expect(await screen.findByText("Required documents complete")).toBeInTheDocument();
    expect(screen.getByText("3 of 5 documents present")).toBeInTheDocument();

    /* Deterministic checks are labelled as computed — a rule said so, not a model. */
    expect(screen.getAllByText("Computed · no model")).toHaveLength(6);

    /* Every check cites the rule it applied. */
    expect(screen.getAllByText("§ HRD-011").length).toBeGreaterThan(0);
  });

  it("cites the six-month claim window, not the five-working-day reading", async () => {
    renderScreen(<ClaimPacketScreen engagementRef={DEFAULT_PACKET_ENGAGEMENT_REF} />, {
      role: "FINANCE",
    });

    const banner = await screen.findByText(/Claim window closes in 180 days/);
    expect(banner).toBeInTheDocument();
    expect(
      screen.getByText(/Six months from completion under Circular 2\/2026 §5\.2/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("§ HRD-009").length).toBeGreaterThan(0);
  });

  it("disables the filing primary while the packet is incomplete and offers no submit-to-HRD-Corp button", async () => {
    renderScreen(<ClaimPacketScreen engagementRef={DEFAULT_PACKET_ENGAGEMENT_REF} />, {
      role: "FINANCE",
    });

    const primary = await screen.findByRole("button", { name: "Mark as submitted on eTRIS" });
    expect(primary).toBeDisabled();

    /* The screen's whole argument: TrainOS cannot file the claim. */
    expect(screen.getByText("TrainOS does not submit to HRD Corp")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit to HRD Corp/i })).not.toBeInTheDocument();

    /* Attaching is a secondary action on each missing row, and exporting is the
       header's secondary — neither competes with the one primary. */
    expect(screen.getAllByRole("button", { name: "Attach" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Export packet (.zip)" })).toBeInTheDocument();
  });

  it("refuses the filing with a 422 naming the blockers", async () => {
    /* The client disables the primary on the same condition the server checks,
       so the refusal is asserted where it is reachable: at the action envelope.
       `ActionOutcome` renders `details.blockers` when it ever fires. */
    const client = createFixtureClient({ latencyMs: 0 });

    await expect(
      client.performAction({
        type: "HRDC_PACKET_MARK_SUBMITTED",
        targetRef: DEFAULT_PACKET_ENGAGEMENT_REF,
        payload: { reference: "CLM-2026-118834", submittedAt: "2026-11-14T00:00:00+08:00" },
        requestedBy: { kind: "HUMAN", id: "u_jason", name: "Jason Lee" },
      }),
    ).rejects.toSatisfy(
      (thrown: unknown) =>
        isContractError(thrown) &&
        thrown.http === 422 &&
        (thrown.details as { blockers?: string[] }).blockers?.length === 2,
    );
  });
});

describe("M12-S07 · rules registry", () => {
  it("shows a superseded rule with the rule that replaced it", async () => {
    renderScreen(<RulesRegistryScreen />, { role: "FINANCE" });

    await screen.findByText("HRD Corp rules");
    await userEvent.click(screen.getByRole("tab", { name: /Superseded/ }));
    await userEvent.click(await screen.findByText("HRD-006"));

    const drawer = await screen.findByRole("dialog");
    /* The quoted circular text, so the superseded wording stays checkable. */
    expect(within(drawer).getByText(/seven \(7\) days/)).toBeInTheDocument();
    /* And what replaced it. */
    expect(within(drawer).getByText(/HRD-014/)).toBeInTheDocument();
  });

  it("shows an active rule whose replacement is dated but not yet in force", async () => {
    renderScreen(<RulesRegistryScreen />, { role: "FINANCE" });

    await screen.findByText("HRD Corp rules");
    /* HRD-015 is a public-programme rule, so the SBL-Khas filter has to go. */
    await userEvent.click(screen.getByRole("tab", { name: /All/ }));
    await userEvent.click(screen.getByRole("button", { name: /Remove filter Scheme/i }));
    await userEvent.click(await screen.findByText("HRD-015"));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(/HRD-022/)).toBeInTheDocument();
    expect(within(drawer).getByText(/01 Jan 2027/)).toBeInTheDocument();
  });

  it("shows a proposed rule as awaiting verification", async () => {
    renderScreen(<RulesRegistryScreen />, { role: "FINANCE" });

    await screen.findByText("HRD Corp rules");
    await userEvent.click(screen.getByRole("tab", { name: /Proposed/ }));

    expect(await screen.findByText("HRD-023")).toBeInTheDocument();
    expect(screen.getAllByText("Awaiting verification").length).toBeGreaterThan(0);
  });

  it("carries one primary that opens the add-rule drawer", async () => {
    renderScreen(<RulesRegistryScreen />, { role: "FINANCE" });

    const primary = await screen.findByRole("button", { name: "Add rule" });
    await userEvent.click(primary);

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(/does not take effect/)).toBeInTheDocument();
  });

  it("puts the status track and the filter controls on ONE row, per brief §10b", async () => {
    renderScreen(<RulesRegistryScreen />, { role: "FINANCE" });

    await screen.findByText("HRD Corp rules");

    const tabs = screen.getByRole("tablist", { name: "Rule status" });
    const filters = screen.getByRole("group", { name: "Filters" });

    /* Not "both exist" — both resolve to the SAME toolbar row. The filter row
       used to be a second band under the track, which is what §10b forbids. */
    const row = tabs.closest("[data-list-toolbar]");
    expect(row).not.toBeNull();
    expect(filters.closest("[data-list-toolbar]")).toBe(row);
  });
});

describe("M12-S08 · rule change review", () => {
  it("highlights the source span the selected diff card was read from", async () => {
    renderScreen(<RuleChangeReviewScreen documentId={DEFAULT_RULE_CHANGE_DOCUMENT_ID} />, {
      role: "FINANCE",
    });

    expect(await screen.findByText("Circular 09/2026 · proposed rule changes")).toBeInTheDocument();

    /* The span and the card say the same thing, which is the point of the pane. */
    expect(
      screen.getByText(/employers are required to submit grant applications for public/),
    ).toBeInTheDocument();
    expect(screen.getByText("training_start ≥ grant_approval + 14 days")).toBeInTheDocument();
  });

  it("calls out the open engagements a change would break, before approval", async () => {
    renderScreen(<RuleChangeReviewScreen documentId={DEFAULT_RULE_CHANGE_DOCUMENT_ID} />, {
      role: "FINANCE",
    });

    expect(await screen.findByText(/One change affects \d+ open engagements/)).toBeInTheDocument();
    expect(screen.getByText("ENG-0244")).toBeInTheDocument();
    expect(screen.getByText("ENG-0251")).toBeInTheDocument();
  });

  it("withholds a change read below the confidence floor", async () => {
    renderScreen(<RuleChangeReviewScreen documentId={DEFAULT_RULE_CHANGE_DOCUMENT_ID} />, {
      role: "FINANCE",
    });

    expect(await screen.findByText("Held for manual transcription")).toBeInTheDocument();
    expect(screen.getByText(/read at 0\.62 confidence, below the 0\.80 floor/)).toBeInTheDocument();
  });

  it("queues the approval rather than activating the rule", async () => {
    renderScreen(<RuleChangeReviewScreen documentId={DEFAULT_RULE_CHANGE_DOCUMENT_ID} />, {
      role: "FINANCE",
    });

    const primary = await screen.findByRole("button", { name: "Approve selected" });
    expect(primary).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: /Include chg_1/ }));
    expect(primary).toBeEnabled();

    await userEvent.click(primary);

    await waitFor(() => {
      expect(screen.getByText(/Rule changes · Circular 09\/2026/)).toBeInTheDocument();
    });
  });
});
