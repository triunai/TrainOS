/**
 * The two derived collections the Finance › Commissions and Knowledge ›
 * Library leaves read.
 *
 * Neither is a contract endpoint, so there is no schema to check them against.
 * That is exactly why they need a test: the rows are DERIVED from quotations,
 * invoices, the rate card and the collection rules, and a derivation nobody
 * asserts is a set of numbers somebody typed. Every assertion below re-derives
 * a figure from the record it came from rather than restating the literal.
 */

import { describe, expect, it } from "vitest";
import { createFixtureClient, isContractError } from "../index";
import * as data from "../data";

const client = () => createFixtureClient({ latencyMs: 0 });

describe("commissions", () => {
  it("takes its percentage of the sell price, to the sen", async () => {
    const { data: rows } = await client().listCommissions();
    expect(rows).toHaveLength(6);

    for (const row of rows) {
      expect(row.amount.amount).toBe(Math.round(row.dealValue.amount * row.rate));
      expect(row.amount.currency).toBe("MYR");
    }
  });

  it("reads the manager's rate from the rate card, not from the sales rate", async () => {
    const api = client();
    const rateCard = await api.getRateCard();
    const { data: rows } = await api.listCommissions();

    const manager = rows.find((row) => row.ownerRole === "SALES_MANAGER");
    expect(manager).toBeDefined();

    const band = rateCard.commissionPct.find(
      (entry) => entry.role === "SALES_MANAGER" && entry.band === "STANDARD",
    );
    expect(manager?.rate).toBe(band?.pct);
    /* The point of the row: the biggest deal on the page earns the smallest
       commission, because the rate is configuration and not a constant. */
    const biggestDeal = [...rows].sort((a, b) => b.dealValue.amount - a.dealValue.amount)[0];
    expect(biggestDeal?.id).toBe(manager?.id);
    expect(manager?.amount.amount).toBeLessThan(
      rows.filter((row) => row.id !== manager?.id).map((row) => row.amount.amount).sort((a, b) => b - a)[0] ?? 0,
    );
  });

  it("only calls a commission payable once its invoice is paid in full", async () => {
    const { data: rows } = await client().listCommissions();

    for (const row of rows) {
      if (row.status === "PAYABLE") {
        expect(row.invoiceStatus).toBe("PAID");
        expect(row.outstanding?.amount).toBe(0);
        expect(row.collectedAt).not.toBeNull();
        continue;
      }
      /* Every other state is money that has NOT been collected, so none of
         them may carry a collection timestamp. */
      expect(row.collectedAt).toBeNull();
    }

    const forecast = rows.filter((row) => row.status === "FORECAST");
    expect(forecast).toHaveLength(1);
    expect(forecast[0]?.invoiceRef).toBeNull();
  });

  it("marks an accrual at risk at the rung the collection rules put the hold on", async () => {
    const api = client();
    const rules = await api.getCollectionRules();
    const hold = rules.data.find((rule) => rule.stage === "TRADING_HOLD");
    expect(hold).toBeDefined();

    const { data: rows } = await api.listCommissions();
    for (const row of rows) {
      const pastTheHold = (row.daysOverdue ?? 0) >= (hold?.afterDays ?? Infinity);
      expect(row.status === "AT_RISK").toBe(pastTheHold);
    }
  });

  it("agrees with the quotation it was priced from", async () => {
    const api = client();
    const { data: rows } = await api.listCommissions();

    for (const row of rows.filter((candidate) => candidate.quotationRef)) {
      const quotation = await api.getQuotation(row.quotationRef as string);
      expect(row.rate).toBe(quotation.commissionRate);
      expect(row.amount).toEqual(quotation.commission);
      expect(row.dealValue).toEqual(quotation.sellPrice);
      expect(row.payableOn).toBe(quotation.commissionPayableOn);
      expect(row.rateBasis).toBe("QUOTATION");
    }
  });

  it("points every row at an engagement and an invoice that exist", async () => {
    const { data: rows } = await client().listCommissions();
    const engagements = new Set(data.engagements.map((engagement) => engagement.ref));
    const invoices = new Set(data.invoices.map((invoice) => invoice.ref));

    for (const row of rows) {
      expect(engagements.has(row.engagementRef)).toBe(true);
      if (row.invoiceRef) expect(invoices.has(row.invoiceRef)).toBe(true);
    }
  });

  it("refuses a principal who may not read a quotation", async () => {
    const api = client();
    api.signInAs("u_siti");

    await expect(api.listCommissions()).rejects.toSatisfy(
      (thrown: unknown) => isContractError(thrown) && thrown.code === "FORBIDDEN",
    );
  });
});

describe("library assets", () => {
  it("describes a record that exists, where it describes one at all", async () => {
    const { data: rows } = await client().listLibraryAssets();
    expect(rows.length).toBeGreaterThan(0);

    const subjects = new Set<string>([
      ...data.programmes.map((programme) => programme.ref),
      ...data.trainers.map((trainer) => trainer.ref),
      ...data.organisations.map((organisation) => organisation.ref),
      ...data.proposals.map((proposal) => proposal.ref),
    ]);

    for (const asset of rows) {
      if (asset.subjectRef) expect(subjects.has(asset.subjectRef)).toBe(true);
    }
  });

  it("carries the same retrieval vocabulary a knowledge source does", async () => {
    const api = client();
    const { data: assets } = await api.listLibraryAssets();
    const { data: sources } = await api.listKnowledgeSources();

    const vocabulary = new Set(sources.flatMap((source) => source.retrievalScopes));
    for (const asset of assets) {
      expect(asset.retrievalScopes.length).toBeGreaterThan(0);
      for (const scope of asset.retrievalScopes) expect(vocabulary.has(scope)).toBe(true);
    }

    /* At least one asset is internal-only, or the scope column has nothing to
       say and the policy it exists to show is invisible. */
    expect(
      assets.some((asset) => !asset.retrievalScopes.includes("CLIENT_FACING")),
    ).toBe(true);
  });

  it("has never been used where it has never been published", async () => {
    const { data: assets } = await client().listLibraryAssets();
    const draft = assets.filter((asset) => asset.status === "DRAFT");
    expect(draft.length).toBeGreaterThan(0);

    for (const asset of draft) {
      expect(asset.timesUsed).toBe(0);
      expect(asset.lastUsedAt).toBeNull();
    }
    /* And an asset that HAS been used carries the date it was last drawn on,
       so "44 uses, never used" cannot render. */
    for (const asset of assets.filter((candidate) => candidate.timesUsed > 0)) {
      expect(asset.lastUsedAt).not.toBeNull();
    }
  });
});
