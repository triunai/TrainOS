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
import { tenant, users } from "../data/tenant";

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
   * `#read` clones at the boundary — `getMe`, `getBadges` and every other
   * read do the same — so a caller that mutates a response can never corrupt
   * the store or a later reader's copy. This used to pin the opposite as a
   * documented surprise: `#read` handed back the stored object itself, which
   * meant a row cached by React Query mutated under it the moment any write
   * touched the same record, and a refetch reported "no change". Two lanes
   * hit that independently; this now pins the fix instead.
   */
  it("returns a fresh copy on every read, not the stored record itself", async () => {
    const first = await api.getTenant();
    const second = await api.getTenant();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

/**
 * §2 ruled R14 · `GET /v1/me/profile`, the record behind the Kit §07 modal.
 *
 * The eleven fields were parked in the web app because `Me` does not carry
 * them. They are contract surface now, on their own endpoint rather than a
 * wider `/v1/me` — §2 calls that one "every screen", and a mobile number and
 * an account's two-factor state do not belong in every page's cache to serve
 * a modal most sessions never open.
 */
describe("getMeProfile", () => {
  it("answers for every principal the role switch offers", async () => {
    for (const user of users) {
      const api = createFixtureClient({ latencyMs: 0, actorId: user.id });
      const profile = await api.getMeProfile();
      expect(profile.id, `${user.name} has no profile`).toBe(user.id);
    }
  });

  it("returns the caller's own record and nobody else's", async () => {
    const amirah = await createFixtureClient({ latencyMs: 0, actorId: "u_amirah" }).getMeProfile();
    const alex = await createFixtureClient({ latencyMs: 0, actorId: "u_lim" }).getMeProfile();

    expect(amirah.jobTitle).toBe("Senior Sales Consultant");
    expect(alex.jobTitle).toBe("Managing Director");
    expect(alex.email).toBe("alex.selvarajah@akademiperdana.my");
    expect(alex.mobile).not.toBe(amirah.mobile);
  });

  it("refuses a principal it has no record for, rather than serving someone else's", async () => {
    const api = createFixtureClient({ latencyMs: 0, actorId: "u_nobody" });
    await expect(api.getMeProfile()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /* The panel's identity line is the tenant's, so it has to be the same tenant
     the rest of the console is configuring — one trading name, one code. */
  it("names one tenant across every principal", async () => {
    const names = new Set<string>();
    const codes = new Set<string | undefined>();
    for (const user of users) {
      const profile = await createFixtureClient({ latencyMs: 0, actorId: user.id }).getMeProfile();
      names.add(profile.tenant.name);
      codes.add(profile.tenant.code);
    }
    expect(names.size).toBe(1);
    expect(codes.size).toBe(1);
  });

  /* Two-factor is on for every principal who can approve money. DECISIONS §1
     routes discounts, trading holds and budget caps through the MD, and a demo
     that showed 2FA off on the account signing them would teach the wrong
     thing. */
  it("has two-factor on for every principal who approves money", async () => {
    for (const id of ["u_lim", "u_kelvin", "u_jason"]) {
      const profile = await createFixtureClient({ latencyMs: 0, actorId: id }).getMeProfile();
      expect(profile.session.twoFactorEnabled, `${id} approves money`).toBe(true);
    }
  });
});
