/**
 * `getTenant()` — the read behind `/settings/organisation`.
 *
 * The contract has no tenant endpoint on purpose: §1 keeps tenancy implicit in
 * the token, so the tenant never appears in a path or a body. The record exists
 * in the store anyway, because every emitted event is stamped with it. This
 * test pins the accessor that `/settings/organisation` reads, and pins the two
 * facts the screen renders as data rather than as prose — the currency the
 * money formatter has to agree with, and the zone every date on the page is
 * rendered in.
 *
 * A separate file rather than a block inside `screens.test.ts`: several agents
 * work this tree at once, and a new file cannot collide with theirs.
 */

import { describe, expect, it } from "vitest";
import { createFixtureClient } from "../index";
import { tenant } from "../data/tenant";

const api = createFixtureClient({ latencyMs: 0 });

describe("getTenant", () => {
  it("returns the organisation the console is configuring", async () => {
    const record = await api.getTenant();
    expect(record.name).toBe("Akademi Perdana Sdn Bhd");
    expect(record.id).toBe(tenant.id);
  });

  it("carries the currency and the zone the screens format against", async () => {
    const record = await api.getTenant();
    /* MYR is not a display preference. Money is integer minor units across the
       contract, and a screen that formatted sen as anything else would be
       wrong rather than merely differently styled. */
    expect(record.currency).toBe("MYR");
    expect(record.timezone).toBe("Asia/Kuala_Lumpur");
    expect(record.locale).toBe("en-MY");
  });

  /**
   * Pinned because it is surprising, not because it is desirable.
   *
   * `#read` hands back the stored object itself — `getMe`, `getBadges` and
   * every other read do the same — so a caller that mutates the result has
   * edited the store for everyone until `reset()`. A screen must treat the
   * response as read-only. Asserting it here means that the day reads start
   * cloning, this test fails and the change is made deliberately rather than
   * discovered later through a screen that quietly stopped corrupting data.
   */
  it("hands back the stored record itself, as every other read does", async () => {
    const first = await api.getTenant();
    const second = await api.getTenant();
    expect(second).toBe(first);
  });
});
