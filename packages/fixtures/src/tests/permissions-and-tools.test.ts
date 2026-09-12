/**
 * §2 permissions and the role-dependent projections they drive, plus the
 * agent-runtime tool reads.
 *
 * The tenancy design withholds `quotation:read` from OPS, so an OPS principal
 * cannot open a quotation at all and sees an engagement without its finance
 * block. A missing field is honest; a zeroed one would be a lie.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  ENGAGEMENT_AURORA,
  PROGRAMME_LEADING_CHANGE,
  QUOTATION_AURORA,
  PROPOSAL_AURORA,
  QUOTATION_PERMISSIONS,
  TRAINER_DANIEL_REF,
  TRAINER_FARAH_REF,
  USER_AMIRAH,
  USER_JASON,
  USER_KELVIN,
  USER_SITI,
} from "@trainos/contract";
import { QUOTATION_SUTERA } from "../data/proposals";
import { ORG_KENANGA } from "../data/organisations";
import { createFixtureClient, isContractError } from "../index";
import type { FixtureClient } from "../client/FixtureClient";

let api: FixtureClient;

beforeEach(() => {
  api = createFixtureClient({ latencyMs: 0 });
});

describe("quotation permissions", () => {
  it("grants SALES all three and OPS none", async () => {
    api.signInAs(USER_AMIRAH);
    const sales = await api.getMe();
    for (const permission of QUOTATION_PERMISSIONS) {
      expect(sales.permissions).toContain(permission);
    }

    api.signInAs(USER_SITI);
    const ops = await api.getMe();
    for (const permission of QUOTATION_PERMISSIONS) {
      expect(ops.permissions).not.toContain(permission);
    }
  });

  it("403s an OPS read of a quotation, naming the role that holds the grant", async () => {
    api.signInAs(USER_SITI);
    await expect(api.getQuotation(QUOTATION_AURORA)).rejects.toMatchObject({
      code: "FORBIDDEN",
      http: 403,
      details: { requiredRole: "SALES", requiredPermission: "quotation:read" },
    });
  });

  it("403s a write from a principal who may only read", async () => {
    api.signInAs(USER_KELVIN);
    await expect(api.getQuotation(QUOTATION_AURORA)).resolves.toBeDefined();
    await expect(
      api.putQuotation(QUOTATION_AURORA, { sellPrice: { amount: 1850000, currency: "MYR" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", details: { requiredPermission: "quotation:write" } });
  });

  it("lets FINANCE read and write, since Finance owns the rate card", async () => {
    api.signInAs(USER_JASON);
    const quotation = await api.putQuotation(QUOTATION_AURORA, {
      sellPrice: { amount: 1850000, currency: "MYR" },
    });
    expect(quotation.sellPrice.amount).toBe(1850000);
  });
});

describe("the OPS projection of an engagement", () => {
  it("drops the finance block rather than zeroing it", async () => {
    api.signInAs(USER_SITI);
    const engagement = await api.getEngagement(ENGAGEMENT_AURORA);
    expect(engagement.finance).toBeUndefined();
    expect("finance" in engagement).toBe(false);
    /** Everything OPS actually needs is still there. */
    expect(engagement.sessions.length).toBe(2);
    expect(engagement.metrics.attendanceRate).toBe(0.93);
  });

  it("keeps the finance block for a principal who may see pricing", async () => {
    api.signInAs(USER_JASON);
    const engagement = await api.getEngagement(ENGAGEMENT_AURORA);
    expect(engagement.finance?.realisedMarginRate).toBe(0.41);
  });

  it("projects the list the same way it projects the record", async () => {
    api.signInAs(USER_SITI);
    const list = await api.listEngagements({ page: { size: 50 } });
    expect(list.data.every((row) => row.finance === undefined)).toBe(true);
  });
});

describe("both floors on the quotation itself", () => {
  it("names MARGIN as the binding basis when direct cost is the constraint", async () => {
    const quotation = await api.getQuotation(QUOTATION_AURORA);
    expect(quotation.absoluteFloorPrice).toEqual({ amount: 1390000, currency: "MYR" });
    expect(quotation.marginFloorPrice).toEqual({ amount: 1753846, currency: "MYR" });
    expect(quotation.bindingFloorBasis).toBe("MARGIN");
    expect(quotation.floorPrice).toEqual(quotation.marginFloorPrice);
  });

  it("names ABSOLUTE when the tier floor is the higher of the two", async () => {
    const quotation = await api.getQuotation(QUOTATION_SUTERA);
    expect(quotation.absoluteFloorPrice).toEqual({ amount: 735000, currency: "MYR" });
    expect(quotation.marginFloorPrice).toEqual({ amount: 587692, currency: "MYR" });
    expect(quotation.bindingFloorBasis).toBe("ABSOLUTE");
    expect(quotation.floorPrice).toEqual(quotation.absoluteFloorPrice);
  });
});

describe("agent-runtime tool reads", () => {
  it("prices a delivery to the same direct cost the seeded quotation carries", async () => {
    const computed = await api.computeQuotation({ programmeRef: PROGRAMME_LEADING_CHANGE, pax: 30 });

    expect(computed.directCost).toEqual({ amount: 1140000, currency: "MYR" });
    expect(computed.proposalValue).toEqual({ amount: 1850000, currency: "MYR" });
    expect(computed.marginRate).toBe(0.38);
    expect(computed.bindingFloorBasis).toBe("MARGIN");
    expect(computed.belowFloor).toBe(false);
    expect(computed.rateCardVersion).toBe("v0-placeholder");
  });

  it("keeps proposalValue separate from total so tax cannot cross a gate", async () => {
    const computed = await api.computeQuotation({ programmeRef: PROGRAMME_LEADING_CHANGE, pax: 30 });
    expect(computed.sst).toEqual({ amount: 0, currency: "MYR" });
    expect(computed.proposalValue).toEqual(computed.total);
    expect(computed.proposalValue.amount + computed.sst.amount).toBe(computed.total.amount);
  });

  it("quotes a package price as one line at qty 1, per-pax display only", async () => {
    const computed = await api.computeQuotation({ programmeRef: PROGRAMME_LEADING_CHANGE, pax: 30 });
    expect(computed.lines).toHaveLength(1);
    expect(computed.lines[0]?.qty).toBe(1);
    expect(computed.display.perPax).toEqual({ amount: 61667, currency: "MYR" });
  });

  it("flags a discount that breaks the binding floor", async () => {
    const computed = await api.computeQuotation({
      programmeRef: PROGRAMME_LEADING_CHANGE,
      pax: 30,
      discountRate: 0.2,
    });
    expect(computed.proposalValue).toEqual({ amount: 1480000, currency: "MYR" });
    expect(computed.belowFloor).toBe(true);
  });

  it("prices the smaller pax band from the tier below", async () => {
    const computed = await api.computeQuotation({ programmeRef: PROGRAMME_LEADING_CHANGE, pax: 18 });
    expect(computed.proposalValue).toEqual({ amount: 1450000, currency: "MYR" });
  });

  it("reads trainer availability from real bookings", async () => {
    /** Daniel Wong is committed across the client's November window. */
    const november = await api.listTrainerAvailability(
      PROGRAMME_LEADING_CHANGE,
      "2026-11-12",
      "2026-11-13",
    );
    expect(november.find((row) => row.trainerRef === TRAINER_DANIEL_REF)?.available).toBe(false);

    /** Farah Aziz is free for the January cohort. */
    const january = await api.listTrainerAvailability(
      PROGRAMME_LEADING_CHANGE,
      "2027-01-14",
      "2027-01-15",
    );
    expect(january.find((row) => row.trainerRef === TRAINER_FARAH_REF)?.available).toBe(true);
  });

  it("resolves the organisation to its opportunity when drafting a proposal", async () => {
    const result = await api.draftProposal({
      organisationRef: ORG_KENANGA,
      programmeRef: PROGRAMME_LEADING_CHANGE,
      sections: [{ heading: "Understanding your needs", body: "Your 48 store managers…" }],
    });

    /** OPP-0498 is Kenanga's open opportunity; the caller never had to know that. */
    expect(result.opportunityRef).toBe("OPP-0498");
    expect(result.organisationRef).toBe(ORG_KENANGA);
    expect(result.proposal.opportunityRef).toBe("OPP-0498");
    expect(result.proposal.status).toBe("DRAFT");
    expect(result.proposal.sections[0]?.title).toBe("Understanding your needs");

    /** The draft is a real record, reachable by the ref it came back with. */
    const stored = await api.getProposal(result.proposal.ref);
    expect(stored.ref).toBe(result.proposal.ref);
  });

  it("binds a quotation to the proposal it was drafted for", async () => {
    const result = await api.draftProposal({
      organisationRef: ORG_KENANGA,
      programmeRef: PROGRAMME_LEADING_CHANGE,
      quotationRef: QUOTATION_SUTERA,
    });
    const quotation = await api.getQuotation(QUOTATION_SUTERA);
    expect(quotation.proposalRef).toBe(result.proposal.ref);
  });

  it("404s an organisation with nothing to propose against", async () => {
    await expect(
      api.draftProposal({ organisationRef: "ORG-0115", programmeRef: PROGRAMME_LEADING_CHANGE }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", http: 404 });
  });

  it("searches organisations and programmes by name", async () => {
    const organisations = await api.searchOrganisations("aurora");
    expect(organisations).toHaveLength(2);
    const programmes = await api.searchProgrammes("", ["LEADERSHIP"]);
    expect(programmes.every((row) => row.category === "LEADERSHIP")).toBe(true);
  });
});

describe("the last rung of the collections ladder", () => {
  it("proposes a trading hold past day 75, awaiting the MD", async () => {
    const queue = await api.getCollectionsQueue();
    const hold = queue.data.find((row) => row.stage === "TRADING_HOLD");
    expect(hold?.daysOverdue).toBe(78);
    expect(hold?.nextAction.type).toBe("ACCOUNT_TRADING_HOLD");
    expect(hold?.nextAction.autonomy).toBe("OBSERVE");
  });

  it("reconciles the aging strip with the queue", async () => {
    const queue = await api.getCollectionsQueue();
    const overdue = queue.data.reduce((total, row) => total + row.amount.amount, 0);
    const aged =
      queue.aging.d1_30.amount + queue.aging.d31_60.amount + queue.aging.d60_plus.amount;
    expect(aged).toBe(overdue);
  });
});

/**
 * The guard a UI boundary uses to tell a refusal from a transport failure.
 *
 * Getting this wrong puts a retry button on a policy decision, so it is worth
 * a test of its own — including the structural path, which is what survives a
 * bundler ending up with two copies of the module.
 */
describe("isContractError", () => {
  it("recognises a thrown refusal and carries its code through toEnvelope", async () => {
    const thrown = await api
      .getQuotation("QUO-2026-9999")
      .then(() => null)
      .catch((error: unknown) => error);

    expect(isContractError(thrown)).toBe(true);
    if (!isContractError(thrown)) return;
    expect(thrown.code).toBe("NOT_FOUND");
    expect(thrown.http).toBe(404);
    expect(thrown.toEnvelope()).toEqual({
      error: { code: "NOT_FOUND", message: expect.stringContaining("QUO-2026-9999") },
    });
  });

  it("recognises a structurally identical error from another module instance", () => {
    const fromAnotherCopy = {
      name: "ContractError",
      code: "FORBIDDEN",
      http: 403,
      message: "quotation:read is not granted to OPS.",
      toEnvelope: () => ({ error: { code: "FORBIDDEN", message: "…" } }),
    };
    expect(isContractError(fromAnotherCopy)).toBe(true);
  });

  it("does not mistake an ordinary error for a refusal", () => {
    expect(isContractError(new Error("socket hang up"))).toBe(false);
    expect(isContractError({ code: "NOT_FOUND" })).toBe(false);
    expect(isContractError(null)).toBe(false);
  });
});

/**
 * M07-S02's "Add section" control.
 *
 * The contract publishes no endpoint for adding a section, only for editing
 * and regenerating one that exists, so this is a fixture-side method and a
 * reported gap.
 */
describe("adding a proposal section", () => {
  it("appends after the highest existing section number", async () => {
    const before = await api.getProposal(PROPOSAL_AURORA);
    /** Snapshot the numbers, not the object: reads return live store references. */
    const highest = Math.max(...before.sections.map((section) => section.n));
    const countBefore = before.sections.length;

    const after = await api.addProposalSection(PROPOSAL_AURORA, {
      title: "Terms and conditions",
      body: "Payment within 30 days of invoice.",
    });

    const added = after.sections.at(-1);
    expect(added?.n).toBe(highest + 1);
    expect(added?.title).toBe("Terms and conditions");
    expect(after.sections).toHaveLength(countBefore + 1);
  });

  it("hands back a live store reference, not a snapshot", async () => {
    /**
     * Worth pinning because it differs from an HTTP client, which returns a
     * fresh object per call. A caller holding an earlier read sees later
     * writes through it.
     */
    const first = await api.getProposal(PROPOSAL_AURORA);
    const second = await api.getProposal(PROPOSAL_AURORA);
    expect(first).toBe(second);

    await api.addProposalSection(PROPOSAL_AURORA, { title: "Terms" });
    expect(first.sections.at(-1)?.title).toBe("Terms");
  });

  it("leaves the new section without provenance, because a person wrote it", async () => {
    const after = await api.addProposalSection(PROPOSAL_AURORA, { title: "Terms" });
    expect(after.sections.at(-1)?.provenance).toBeUndefined();
  });

  it("gives the new section a real number the editor can then write to", async () => {
    const added = await api.addProposalSection(PROPOSAL_AURORA, { title: "Terms" });
    const n = added.sections.at(-1)?.n ?? 0;
    const edited = await api.putProposalSection(PROPOSAL_AURORA, n, { body: "Revised wording." });
    expect(edited.sections.find((section) => section.n === n)?.body).toBe("Revised wording.");
  });

  it("422s a section with no title", async () => {
    await expect(api.addProposalSection(PROPOSAL_AURORA, { title: "  " })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      http: 422,
    });
  });

  it("404s an unknown proposal", async () => {
    await expect(
      api.addProposalSection("PRO-2026-9999", { title: "Terms" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", http: 404 });
  });
});
