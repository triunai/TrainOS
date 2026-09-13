import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionRequest, Me } from "@trainos/contract";
import { PROPOSAL_AURORA, TEMPLATE_EMAIL_PROPOSAL, USER_AMIRAH } from "@trainos/contract";
import { fixtureClient, isContractError, resetStore } from "@trainos/fixtures";
import { stableIdempotencyKey, useAction } from "@/shared/api";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";

/**
 * W-02 · one user intent is one governed action, however many times it is sent.
 *
 * §3 recognises a repeat by its idempotency key, so the key decides whether a
 * double-clicked button is one approval or two. Four features built the key as
 * `${type}:${targetRef}:${Date.now()}` and two more from a fresh
 * `randomUUID()` — keys guaranteed unique per ATTEMPT, which is the exact
 * inverse of the purpose. On `usePerformAction`, the envelope every governed
 * write in those features passes through, that meant a double-click or a retry
 * after a transport failure created two distinct money-or-approval actions.
 *
 * The two halves of §3 are both under test here, because a naive fix breaks the
 * second: a key derived from type and target alone would collapse a CORRECTED
 * request into a 409 IDEMPOTENT_REPLAY instead of writing it.
 *
 * What the assertions watch matters. Counting approvals cannot prove either
 * half on its own — `#queueForApproval` already treats an identical PENDING
 * approval as the same request whatever key arrives, so the count stays at one
 * even for a key that never repeats. The recorded key set is the thing the key
 * derivation actually controls, so that is what these tests read.
 */

const PROPOSAL_SEND = (): ActionRequest => ({
  type: "PROPOSAL_SEND",
  targetRef: PROPOSAL_AURORA,
  payload: {
    channel: "EMAIL",
    templateId: TEMPLATE_EMAIL_PROPOSAL,
    to: ["nurul.hassan@auroramfg.com.my"],
    attachPdf: true,
    value: { amount: 1850000, currency: "MYR" },
  },
  requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  const me: Me = { ...FIXTURE_ME, role: "SALES" };

  return (
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me, setRole: () => undefined }}>{children}</MeContext.Provider>
    </QueryClientProvider>
  );
}

/** The keys §1 has on record. One per intent is the whole claim under test. */
const recordedKeys = () => [...fixtureClient.store.idempotency.keys()];

const proposalApprovals = async () => {
  const approvals = await fixtureClient.listApprovals({ page: { size: 50 } });
  return approvals.data.filter((row) => row.actionType === "PROPOSAL_SEND");
};

afterEach(() => {
  resetStore();
});

describe("useAction · the key comes from the intent, not the attempt", () => {
  it("sends one key for a double invoke with the same arguments", async () => {
    resetStore();
    fixtureClient.setLatency(0);

    const hook = renderHook(() => useAction(), { wrapper });

    hook.result.current.mutate(PROPOSAL_SEND());
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    const first = hook.result.current.data;

    hook.result.current.mutate(PROPOSAL_SEND());
    await waitFor(() => expect(hook.result.current.data).not.toBe(first));

    /* Not "the second call failed" — the second call REPLAYED. A refusal here
       would mean the key had collided on a different body. */
    expect(hook.result.current.data?.kind).toBe("QUEUED_FOR_APPROVAL");
    /* The assertion the old `Date.now()` key fails: two attempts, one key. */
    expect(recordedKeys()).toHaveLength(1);
    expect(await proposalApprovals()).toHaveLength(1);
  });

  it("sends a different key for a genuinely different request", async () => {
    resetStore();
    fixtureClient.setLatency(0);

    const hook = renderHook(() => useAction(), { wrapper });
    const base = PROPOSAL_SEND();

    hook.result.current.mutate(base);
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    const first = hook.result.current.data;

    hook.result.current.mutate({
      ...base,
      payload: { ...(base.payload as Record<string, unknown>), attachPdf: false },
    });
    await waitFor(() => expect(hook.result.current.data).not.toBe(first));

    /* A key of type+target alone would make this a 409 and lose the correction
       — see the direct proof below. The correction is written instead. */
    expect(hook.result.current.data?.kind).toBe("QUEUED_FOR_APPROVAL");
    expect(recordedKeys()).toHaveLength(2);
  });
});

describe("§3 · the half a payload-blind key would break", () => {
  it("refuses the same key with a different body as IDEMPOTENT_REPLAY", async () => {
    resetStore();
    fixtureClient.setLatency(0);

    const base = PROPOSAL_SEND();
    /* The key the four features would have produced with `Date.now()` removed:
       stable, but blind to everything the user actually changed. */
    const payloadBlind = `${base.type}:${base.targetRef}`;

    await fixtureClient.performAction(base, { idempotencyKey: payloadBlind });

    const corrected: ActionRequest = {
      ...base,
      payload: { ...(base.payload as Record<string, unknown>), attachPdf: false },
    };
    const thrown = await fixtureClient
      .performAction(corrected, { idempotencyKey: payloadBlind })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(isContractError(thrown)).toBe(true);
    expect(isContractError(thrown) ? thrown.code : null).toBe("IDEMPOTENT_REPLAY");
  });
});

describe("stableIdempotencyKey", () => {
  it("is the same for two requests built in a different field order", () => {
    const a: ActionRequest = {
      type: "PROPOSAL_SEND",
      targetRef: PROPOSAL_AURORA,
      payload: { channel: "EMAIL", attachPdf: true },
      requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
    };
    const b: ActionRequest = {
      requestedBy: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
      payload: { attachPdf: true, channel: "EMAIL" },
      targetRef: PROPOSAL_AURORA,
      type: "PROPOSAL_SEND",
    };

    expect(stableIdempotencyKey(a)).toBe(stableIdempotencyKey(b));
  });

  it("differs when the payload differs", () => {
    const base = PROPOSAL_SEND();
    const changed: ActionRequest = {
      ...base,
      payload: { ...(base.payload as Record<string, unknown>), attachPdf: false },
    };

    expect(stableIdempotencyKey(base)).not.toBe(stableIdempotencyKey(changed));
  });

  it("differs when a different principal proposes the same write", () => {
    const base = PROPOSAL_SEND();
    const other: ActionRequest = {
      ...base,
      requestedBy: { kind: "HUMAN", id: "u_lim", name: "Lim Wei Sheng" },
    };

    /* Two principals proposing one write is two audit trails, not a replay. */
    expect(stableIdempotencyKey(base)).not.toBe(stableIdempotencyKey(other));
  });
});
